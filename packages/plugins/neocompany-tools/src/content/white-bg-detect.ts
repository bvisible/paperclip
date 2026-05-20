//// Neocompany Modification — White-background detection.
////
//// Ported from Reed-Blake's `image_analysis.py:detect_white_bg` (PIL) to
//// TypeScript + sharp. A "white background" reference image is what we want
//// to feed codex via `-i`: the model can reliably extract the product
//// silhouette and condition the new render on it. Lifestyle/outdoor shots
//// make poor refs because the model picks up on the background context.
////
//// Heuristic: convert to raw RGB, sample the outer `border` frame of pixels,
//// count those whose all three channels exceed `threshold`. If the ratio
//// of such pixels is ≥ `ratio`, the image is treated as white-bg.
//// End Neocompany Modification

import sharp from "sharp";

export interface WhiteBgDetectOptions {
  /** Per-channel value (0-255) above which a pixel is considered "white". */
  threshold?: number;
  /** Fraction of the image used as a frame on each side (0–0.5). */
  border?: number;
  /** Minimum fraction of border pixels that must be white for `isWhiteBg=true`. */
  ratio?: number;
}

export interface WhiteBgResult {
  isWhiteBg: boolean;
  /** Actual measured white-pixel ratio in the border sample (0–1). */
  ratio: number;
  /** Total pixels sampled (the size of the border frame). */
  sampleSize: number;
}

const DEFAULTS = {
  threshold: 240,
  border: 0.08,
  ratio: 0.85,
} as const;

/**
 * Decide whether `imageBuffer` has a white background.
 *
 * Sampling strategy: raw RGB buffer, count pixels in the top/bottom/left/right
 * `border` strips whose R,G,B are all > `threshold`. Corners are counted once
 * (top+bottom rows cover them; left+right columns skip them).
 *
 * Returns the boolean decision plus the measured ratio so callers can sort
 * by quality (Reed-Blake keeps the top-N white-bg refs ordered by ratio).
 */
export async function detectWhiteBg(
  imageBuffer: Buffer,
  options: WhiteBgDetectOptions = {},
): Promise<WhiteBgResult> {
  const threshold = options.threshold ?? DEFAULTS.threshold;
  const borderFrac = Math.min(0.5, Math.max(0, options.border ?? DEFAULTS.border));
  const ratioThreshold = options.ratio ?? DEFAULTS.ratio;

  //// Neocompany Modification — normalise to a guaranteed 3-channel sRGB
  //// raw buffer. `removeAlpha()` alone does NOT convert grayscale (1ch) or
  //// CMYK (4ch) JPEGs — those throw "expected 3 channels" downstream.
  //// `flatten` composites any transparency onto white, `toColourspace`
  //// forces sRGB so the raw output is always RGB.
  //// End Neocompany Modification
  const { data, info } = await sharp(imageBuffer)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .toColourspace("srgb")
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width: w, height: h, channels } = info;
  if (channels !== 3) {
    throw new Error(`detectWhiteBg expected 3 channels, got ${channels}`);
  }

  const bw = Math.max(1, Math.floor(w * borderFrac));
  const bh = Math.max(1, Math.floor(h * borderFrac));

  let whiteCount = 0;
  let total = 0;

  // Helper to read R,G,B at (x, y) from the packed RGB buffer.
  const isWhite = (x: number, y: number): boolean => {
    const off = (y * w + x) * 3;
    return data[off] > threshold && data[off + 1] > threshold && data[off + 2] > threshold;
  };

  // Top and bottom strips (full width).
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < w; x++) {
      total += 1;
      if (isWhite(x, y)) whiteCount += 1;
    }
  }
  for (let y = h - bh; y < h; y++) {
    for (let x = 0; x < w; x++) {
      total += 1;
      if (isWhite(x, y)) whiteCount += 1;
    }
  }
  // Left and right strips (excluding the corners we already covered above).
  for (let x = 0; x < bw; x++) {
    for (let y = bh; y < h - bh; y++) {
      total += 1;
      if (isWhite(x, y)) whiteCount += 1;
    }
  }
  for (let x = w - bw; x < w; x++) {
    for (let y = bh; y < h - bh; y++) {
      total += 1;
      if (isWhite(x, y)) whiteCount += 1;
    }
  }

  const actualRatio = total > 0 ? whiteCount / total : 0;
  return {
    isWhiteBg: actualRatio >= ratioThreshold,
    ratio: actualRatio,
    sampleSize: total,
  };
}
