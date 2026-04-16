/**
 * Image compositor — applies a BrandTemplate config on top of a source
 * image using Sharp. Ported from the Postiz CompositorService but as a
 * pure function (no NestJS injectable, no upload factory).
 *
 * Pipeline: fetch → resize/fit → filters → color overlay → border →
 * logo overlay → text overlays → output PNG buffer.
 */

import type { TemplateConfig, LogoPosition } from "./types.js";

// Sharp is loaded lazily via dynamic import() to work with ESM workers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sharp: any = null;
let sharpLoadAttempted = false;

async function getSharp() {
  if (sharp) return sharp;
  if (sharpLoadAttempted) throw new Error("sharp is not available in this environment");
  sharpLoadAttempted = true;
  try {
    const mod = await import("sharp");
    sharp = mod.default ?? mod;
    return sharp;
  } catch (err) {
    throw new Error(`sharp failed to load: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export interface CompositeResult {
  buffer: Buffer;
  mimeType: string;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function compositeImage(
  sourceImageUrl: string,
  config: TemplateConfig,
  width: number,
  height: number,
  logoUrl?: string,
): Promise<CompositeResult> {
  const sharpFn = await getSharp();

  // 1. Fetch source image
  const sourceBuffer = await fetchImage(sourceImageUrl);

  // 2. Resize to target dimensions
  const fitMap: Record<string, string> = { cover: "cover", contain: "inside", fill: "fill" };
  let img = sharpFn(sourceBuffer).resize(width, height, {
    fit: (fitMap[config.imageFit] ?? "cover") as "cover" | "inside" | "fill",
    background: config.backgroundColor,
  });

  // 3. Flatten alpha (ensures consistent output)
  img = img.flatten({ background: config.backgroundColor });

  // 4. Apply filters
  const { brightness, contrast, saturation, blur } = config.filters;
  if (brightness !== 0 || contrast !== 0) {
    // Sharp linear: output = a * input + b
    const a = (1 + contrast / 100) * (1 + brightness / 200);
    const b = (brightness / 2) * (1 + contrast / 100);
    img = img.linear(a, b);
  }
  if (saturation !== 0) {
    img = img.modulate({ saturation: 1 + saturation / 100 });
  }
  if (blur > 0) {
    const sigma = Math.max(0.3, (blur / 100) * 10);
    img = img.blur(sigma);
  }

  // Convert to buffer for compositing steps
  let buf = await img.png().toBuffer();

  // 5. Color overlay
  if (config.overlay.opacity > 0) {
    const rgba = parseColor(config.overlay.color);
    const alpha = Math.round((config.overlay.opacity / 100) * 255);
    const overlayBuf = await sharpFn({
      create: { width, height, channels: 4, background: { r: rgba.r, g: rgba.g, b: rgba.b, alpha: alpha / 255 } },
    }).png().toBuffer();
    buf = await sharpFn(buf).composite([{ input: overlayBuf, blend: "over" }]).png().toBuffer();
  }

  // 6. Border
  if (config.border.width > 0) {
    const bw = config.border.width;
    const bc = parseColor(config.border.color);
    const br = config.border.radius;
    // Draw an SVG border frame and composite it
    const svg = `<svg width="${width}" height="${height}">
      <rect x="${bw / 2}" y="${bw / 2}" width="${width - bw}" height="${height - bw}"
        rx="${br}" ry="${br}" fill="none" stroke="rgb(${bc.r},${bc.g},${bc.b})" stroke-width="${bw}"/>
    </svg>`;
    buf = await sharpFn(buf)
      .composite([{ input: Buffer.from(svg), blend: "over" }])
      .png()
      .toBuffer();
  }

  // 7. Logo overlay
  if (logoUrl && config.logo.position !== "custom" || (config.logo.position === "custom" && config.logo.x !== undefined)) {
    try {
      const logoBuf = await fetchImage(logoUrl!);
      const logoScale = config.logo.scale / 100;
      const logoW = Math.round(width * logoScale);
      const logoH = Math.round(height * logoScale);
      const resizedLogo = await sharpFn(logoBuf).resize(logoW, logoH, { fit: "inside" }).png().toBuffer();
      const meta = await sharpFn(resizedLogo).metadata();
      const actualW = meta.width ?? logoW;
      const actualH = meta.height ?? logoH;

      const { left, top } = resolveLogoPosition(config.logo.position, width, height, actualW, actualH, config.logo.x, config.logo.y);

      // Apply opacity via alpha channel
      const opacity = config.logo.opacity / 100;
      let logoLayer = sharp(resizedLogo);
      if (opacity < 1) {
        const alphaBuf = await sharpFn({
          create: { width: actualW, height: actualH, channels: 4, background: { r: 255, g: 255, b: 255, alpha: opacity } },
        }).png().toBuffer();
        const compositedLogo = await sharpFn(resizedLogo)
          .composite([{ input: alphaBuf, blend: "dest-in" }])
          .png()
          .toBuffer();
        logoLayer = sharp(compositedLogo);
      }

      buf = await sharpFn(buf)
        .composite([{ input: await logoLayer.toBuffer(), left, top }])
        .png()
        .toBuffer();
    } catch {
      // Logo fetch/processing failed — skip silently
    }
  }

  // 8. Text overlays
  if (config.textZones.length > 0) {
    const textComposites = config.textZones
      .filter((tz) => tz.defaultText)
      .map((tz) => {
        const x = Math.round((tz.x / 100) * width);
        const y = Math.round((tz.y / 100) * height);
        const w = Math.round((tz.width / 100) * width);
        const h = Math.round((tz.height / 100) * height);
        const align = tz.textAlign === "center" ? "middle" : tz.textAlign === "right" ? "end" : "start";
        const anchorX = tz.textAlign === "center" ? w / 2 : tz.textAlign === "right" ? w - 4 : 4;
        const svg = `<svg width="${w}" height="${h}">
          <text x="${anchorX}" y="${h / 2 + tz.fontSize / 3}"
            font-family="${escapeXml(tz.fontFamily)}" font-size="${tz.fontSize}"
            fill="${tz.fontColor}" text-anchor="${align}">
            ${escapeXml(tz.defaultText ?? "")}
          </text>
        </svg>`;
        return { input: Buffer.from(svg), left: x, top: y };
      });
    if (textComposites.length > 0) {
      buf = await sharpFn(buf).composite(textComposites).png().toBuffer();
    }
  }

  return { buffer: buf, mimeType: "image/png", width, height };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchImage(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Fetch ${url} failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

function parseColor(color: string): { r: number; g: number; b: number } {
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0]! + hex[0], 16),
        g: parseInt(hex[1]! + hex[1], 16),
        b: parseInt(hex[2]! + hex[2], 16),
      };
    }
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }
  const m = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (m) return { r: +m[1]!, g: +m[2]!, b: +m[3]! };
  return { r: 0, g: 0, b: 0 };
}

function resolveLogoPosition(
  position: LogoPosition,
  canvasW: number,
  canvasH: number,
  logoW: number,
  logoH: number,
  customX?: number,
  customY?: number,
): { left: number; top: number } {
  const margin = Math.round(canvasW * 0.03);
  switch (position) {
    case "top-left":      return { left: margin, top: margin };
    case "top-right":     return { left: canvasW - logoW - margin, top: margin };
    case "bottom-left":   return { left: margin, top: canvasH - logoH - margin };
    case "bottom-right":  return { left: canvasW - logoW - margin, top: canvasH - logoH - margin };
    case "bottom-center": return { left: Math.round((canvasW - logoW) / 2), top: canvasH - logoH - margin };
    case "center":        return { left: Math.round((canvasW - logoW) / 2), top: Math.round((canvasH - logoH) / 2) };
    case "custom":
      return {
        left: Math.round(((customX ?? 50) / 100) * canvasW - logoW / 2),
        top: Math.round(((customY ?? 50) / 100) * canvasH - logoH / 2),
      };
    default: return { left: margin, top: margin };
  }
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
