//// Neocompany Modification — White-bg detection tests.
//// Builds synthetic PNGs with sharp (pure white, pure black, dark with
//// white border) to exercise the heuristic without filesystem fixtures.
//// End Neocompany Modification

import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { detectWhiteBg } from "./white-bg-detect.js";

async function makeSolidPng(width: number, height: number, r: number, g: number, b: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r, g, b },
    },
  })
    .png()
    .toBuffer();
}

/**
 * Build a fake "studio shot" : white border + dark center (the product
 * silhouette). Mimics a real product photo on white seamless paper.
 */
async function makeStudioShotPng(size: number, productSize: number): Promise<Buffer> {
  const margin = Math.floor((size - productSize) / 2);
  const overlay = await sharp({
    create: { width: productSize, height: productSize, channels: 3, background: { r: 30, g: 30, b: 30 } },
  })
    .png()
    .toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([{ input: overlay, left: margin, top: margin }])
    .png()
    .toBuffer();
}

describe("detectWhiteBg", () => {
  it("returns isWhiteBg=true on a pure white image", async () => {
    const png = await makeSolidPng(200, 200, 255, 255, 255);
    const result = await detectWhiteBg(png);
    expect(result.isWhiteBg).toBe(true);
    expect(result.ratio).toBeGreaterThanOrEqual(0.99);
    expect(result.sampleSize).toBeGreaterThan(0);
  });

  it("returns isWhiteBg=false on a pure dark image", async () => {
    const png = await makeSolidPng(200, 200, 30, 30, 30);
    const result = await detectWhiteBg(png);
    expect(result.isWhiteBg).toBe(false);
    expect(result.ratio).toBeLessThan(0.01);
  });

  it("returns isWhiteBg=true on a studio shot (dark center on white background)", async () => {
    // 400x400 canvas, 200x200 dark product centered. The 8% border (32px)
    // never reaches the dark center, so the border is all-white.
    const png = await makeStudioShotPng(400, 200);
    const result = await detectWhiteBg(png);
    expect(result.isWhiteBg).toBe(true);
    expect(result.ratio).toBeGreaterThanOrEqual(0.95);
  });

  it("returns isWhiteBg=false when the dark area bleeds into the border", async () => {
    // 200x200 canvas, 180x180 dark product centered — the 10px margin is
    // narrower than the 8% border (16px) so the border catches dark pixels.
    const png = await makeStudioShotPng(200, 180);
    const result = await detectWhiteBg(png);
    expect(result.isWhiteBg).toBe(false);
    expect(result.ratio).toBeLessThan(0.85);
  });

  it("respects custom threshold + ratio options", async () => {
    // Pale gray (220,220,220) — below default threshold 240, above 200.
    const png = await makeSolidPng(200, 200, 220, 220, 220);
    const defaults = await detectWhiteBg(png);
    expect(defaults.isWhiteBg).toBe(false);
    const lenient = await detectWhiteBg(png, { threshold: 200 });
    expect(lenient.isWhiteBg).toBe(true);
  });
});
