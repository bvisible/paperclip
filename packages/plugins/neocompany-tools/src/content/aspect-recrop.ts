//// Neocompany Modification — Center-crop fallback to a target aspect ratio.
////
//// Ported from Reed-Blake's `image_analysis.py:center_crop_to_aspect`. Used
//// when codex / gpt-image-2 ignores the aspect-ratio hint in the prompt and
//// returns a square or 3:2 PNG even though the request asked for 16:9. The
//// subject is always composed near the center of the frame, so a centered
//// horizontal/vertical crop keeps it intact.
//// End Neocompany Modification

import sharp from "sharp";

export interface AspectRecropResult {
  buffer: Buffer;
  /** True if a crop was performed (false → input already matched ratio). */
  cropped: boolean;
  /** Final dimensions after the crop. */
  width: number;
  height: number;
}

/**
 * Re-crop `imageBuffer` to the aspect ratio `targetW:targetH`, centered.
 *
 * The crop is purely about the aspect ratio — the function does NOT resize
 * to the literal pixel dimensions. (Resizing happens upstream when codex
 * receives the size hint; if we resized here we'd blur on upscale.)
 *
 * - `tolerance` (0–1, default 0.02 = 2%) — input ratios within this margin
 *   of the target are returned unchanged.
 * - On a portrait input (taller than target) the top + bottom are trimmed.
 * - On a landscape input (wider than target) the left + right are trimmed.
 */
export async function centerCropToAspect(
  imageBuffer: Buffer,
  targetW: number,
  targetH: number,
  tolerance = 0.02,
): Promise<AspectRecropResult> {
  if (targetW <= 0 || targetH <= 0) {
    throw new Error(`centerCropToAspect: targetW and targetH must be positive (got ${targetW}x${targetH})`);
  }
  const targetRatio = targetW / targetH;
  const meta = await sharp(imageBuffer).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w === 0 || h === 0) {
    throw new Error("centerCropToAspect: source image has no dimensions");
  }
  const currentRatio = w / h;
  if (Math.abs(currentRatio - targetRatio) / targetRatio <= tolerance) {
    return { buffer: imageBuffer, cropped: false, width: w, height: h };
  }

  let newW: number;
  let newH: number;
  let left: number;
  let top: number;
  if (currentRatio > targetRatio) {
    // Too wide — trim left and right (keep full height).
    newW = Math.round(h * targetRatio);
    newH = h;
    left = Math.floor((w - newW) / 2);
    top = 0;
  } else {
    // Too tall — trim top and bottom (keep full width).
    newW = w;
    newH = Math.round(w / targetRatio);
    left = 0;
    top = Math.floor((h - newH) / 2);
  }

  const out = await sharp(imageBuffer)
    .extract({ left, top, width: newW, height: newH })
    .png()
    .toBuffer();

  return { buffer: out, cropped: true, width: newW, height: newH };
}
