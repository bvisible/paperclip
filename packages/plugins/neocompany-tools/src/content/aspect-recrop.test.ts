//// Neocompany Modification — Aspect re-crop tests.
//// Builds synthetic PNGs at various aspect ratios and checks the output
//// dimensions match the requested target within tolerance.
//// End Neocompany Modification

import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { centerCropToAspect } from "./aspect-recrop.js";

async function makeSolidPng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 128, g: 128, b: 128 } },
  })
    .png()
    .toBuffer();
}

describe("centerCropToAspect", () => {
  it("no-ops when input already matches target ratio (within tolerance)", async () => {
    const png = await makeSolidPng(1920, 1080);
    const result = await centerCropToAspect(png, 16, 9);
    expect(result.cropped).toBe(false);
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
    expect(result.buffer).toBe(png); // same reference returned
  });

  it("crops a square down to 16:9 (trims top + bottom)", async () => {
    const png = await makeSolidPng(1024, 1024);
    const result = await centerCropToAspect(png, 16, 9);
    expect(result.cropped).toBe(true);
    expect(result.width).toBe(1024);
    expect(result.height).toBe(Math.round(1024 / (16 / 9)));
    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBe(result.width);
    expect(meta.height).toBe(result.height);
    expect(Math.abs(meta.width! / meta.height! - 16 / 9)).toBeLessThan(0.005);
  });

  it("crops a square down to 9:16 (trims left + right)", async () => {
    const png = await makeSolidPng(1024, 1024);
    const result = await centerCropToAspect(png, 9, 16);
    expect(result.cropped).toBe(true);
    expect(result.height).toBe(1024);
    expect(result.width).toBe(Math.round(1024 * (9 / 16)));
    const meta = await sharp(result.buffer).metadata();
    expect(Math.abs(meta.width! / meta.height! - 9 / 16)).toBeLessThan(0.005);
  });

  it("crops a 4:3 photo down to 1:1 square", async () => {
    const png = await makeSolidPng(800, 600);
    const result = await centerCropToAspect(png, 1, 1);
    expect(result.cropped).toBe(true);
    expect(result.width).toBe(result.height);
    expect(result.width).toBe(600); // limited by the smaller dimension
  });

  it("crops a 16:9 photo down to 4:5 portrait", async () => {
    const png = await makeSolidPng(1920, 1080);
    const result = await centerCropToAspect(png, 4, 5);
    expect(result.cropped).toBe(true);
    const meta = await sharp(result.buffer).metadata();
    expect(Math.abs(meta.width! / meta.height! - 4 / 5)).toBeLessThan(0.005);
  });

  it("rejects non-positive target dimensions", async () => {
    const png = await makeSolidPng(100, 100);
    await expect(centerCropToAspect(png, 0, 1)).rejects.toThrow(/positive/i);
    await expect(centerCropToAspect(png, -16, 9)).rejects.toThrow(/positive/i);
  });
});
