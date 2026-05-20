//// Neocompany Modification — Scene picker + product descriptor.
////
//// Ports the audience-filter + variant-rotation logic from Reed-Blake's
//// `prompts.py:_audience_for + _select_variant_pool + build_prompt`. The
//// pool selection is driven by:
////   1. The chosen `style` (lifestyle / studio / etc.)
////   2. The product's audience derived from its category names
////       (sneakers → casual, richelieus → formal, unknown → neutral)
//// Neutral variants always pass; audience-tagged variants pass only when
//// their audience intersects the product's audience.
//// End Neocompany Modification

import type { ProductData } from "../products/types.js";
import type { SceneAudience, SceneStyle, SceneVariantData } from "./types.js";

// Default category keyword hints. The list is brand-specific to footwear
// (Reed-Blake context) — for other industries the tenant either edits the
// scenes' audience tags directly or the audience filter stays neutral.
const CASUAL_CAT_HINTS = ["baskets", "sneaker", "mocassin", "loafer"];
const FORMAL_CAT_HINTS = ["richelieu", "brogue"];

/**
 * Decide which audience(s) a product belongs to from its category names.
 * Returns an empty array (= neutral) when the category gives no hint.
 */
export function audienceForProduct(categoryNames: string[]): SceneAudience[] {
  if (!categoryNames || categoryNames.length === 0) return [];
  const joined = categoryNames.join(" ").toLowerCase();
  const isCasual = CASUAL_CAT_HINTS.some((h) => joined.includes(h));
  const isFormal = FORMAL_CAT_HINTS.some((h) => joined.includes(h));
  if (isCasual && !isFormal) return ["casual"];
  if (isFormal && !isCasual) return ["formal"];
  return [];
}

/**
 * Filter a pool of variants down to those compatible with the product's
 * audience. Neutral variants (empty audience) always pass; tagged variants
 * pass only if their audience intersects `productAudience`. If `productAudience`
 * is empty, the whole pool passes.
 */
export function selectVariantPool(args: {
  variants: SceneVariantData[];
  style: SceneStyle;
  productAudience: SceneAudience[];
}): SceneVariantData[] {
  const styleMatches = args.variants.filter((v) => v.style === args.style);
  if (args.productAudience.length === 0) {
    // Neutral product: any variant of the right style passes.
    return [...styleMatches].sort((a, b) => a.order - b.order);
  }
  const audienceSet = new Set(args.productAudience);
  const filtered = styleMatches.filter((v) => {
    if (v.audience.length === 0) return true; // neutral variant
    return v.audience.some((a) => audienceSet.has(a));
  });
  return filtered.sort((a, b) => a.order - b.order);
}

/**
 * Pick a single variant from a (filtered) pool by index, wrapping modulo
 * the pool size. Returns `null` if the pool is empty.
 */
export function pickVariantByIndex(
  pool: SceneVariantData[],
  index: number,
): SceneVariantData | null {
  if (pool.length === 0) return null;
  const wrapped = ((index % pool.length) + pool.length) % pool.length;
  return pool[wrapped] ?? null;
}

// ---------------------------------------------------------------------------
// Product descriptor — `name + colour + matière + semelle`
// ---------------------------------------------------------------------------

const ATTR_ALIASES = {
  color: ["pa_color", "color", "couleur", "colour"],
  material: ["pa_matiere", "matiere", "matière", "pa_material", "material"],
  sole: ["pa_semelle", "semelle", "sole"],
};

function readAttr(
  attributes: Record<string, string> | undefined,
  aliases: string[],
): string | undefined {
  if (!attributes) return undefined;
  for (const key of aliases) {
    const raw = attributes[key];
    if (typeof raw === "string" && raw.trim().length > 0) return raw.trim();
  }
  // Case-insensitive fallback.
  const lowerMap = new Map(
    Object.entries(attributes).map(([k, v]) => [k.toLowerCase(), v]),
  );
  for (const key of aliases) {
    const raw = lowerMap.get(key.toLowerCase());
    if (typeof raw === "string" && raw.trim().length > 0) return raw.trim();
  }
  return undefined;
}

/**
 * Build a compact human-readable descriptor that combines the product's
 * name with the most useful attributes (colour / matière / semelle). Skips
 * attributes that are already mentioned in the name to avoid repetition.
 */
export function formatProductDescriptor(
  product: Pick<ProductData, "name" | "attributes">,
): string {
  const name = product.name ?? "";
  const color = readAttr(product.attributes, ATTR_ALIASES.color);
  const material = readAttr(product.attributes, ATTR_ALIASES.material);
  const sole = readAttr(product.attributes, ATTR_ALIASES.sole);

  const lowerName = name.toLowerCase();
  const bits = [name];
  if (color && !lowerName.includes(color.toLowerCase())) bits.push(color);
  if (material && !lowerName.includes(material.toLowerCase())) bits.push(material);
  if (sole && !lowerName.includes(sole.toLowerCase())) bits.push(`sole ${sole}`);
  return bits.length > 1 ? bits.join(" — ") : name;
}

// ---------------------------------------------------------------------------
// Body interpolation
// ---------------------------------------------------------------------------

export interface InterpolationTokens {
  descriptor: string;
  title: string;
  brand: string;
  description: string;
  city?: string;
}

/**
 * Replace `{token}` placeholders in `body` with values from `tokens`.
 * Unknown tokens are left as-is so the body stays auditable.
 */
export function interpolateBody(body: string, tokens: InterpolationTokens): string {
  let out = body;
  out = out.replaceAll("{descriptor}", tokens.descriptor);
  out = out.replaceAll("{title}", tokens.title);
  out = out.replaceAll("{brand}", tokens.brand);
  out = out.replaceAll("{description}", tokens.description);
  if (tokens.city !== undefined) out = out.replaceAll("{city}", tokens.city);
  // Squash any runs of whitespace introduced by missing tokens.
  return out.split(/\s+/).join(" ").trim();
}
