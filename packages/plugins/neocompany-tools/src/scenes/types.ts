//// Neocompany Modification — Scene variants for image generation.
////
//// Ports the catalogue from Reed-Blake-communication's `product_image_gen_mcp/prompts.py`:
//// 5 styles × N variants, each variant carrying a pre-written body that
//// describes a specific scene/location/lighting/wardrobe. The orchestrator
//// rotates through variants for batch generation so 5 images of the same
//// product don't end up with 5 copies of the same setting.
////
//// Stored as company-scoped plugin entities so each tenant edits their own
//// pool. A seed action ships the Reed-Blake-derived starter set; tenants
//// can add / edit / delete / reorder via the /content/scenes UI.
//// End Neocompany Modification

export const SCENE_VARIANT_ENTITY_TYPE = "scene_variant";

/**
 * Top-level scene style. Each style maps to a target social format:
 *   - lifestyle / studio_creative / seasonal / summer_pole → square or
 *     portrait (1:1, 4:5)
 *   - slide_hero → landscape (16:9), wide editorial composition
 *   - story_vertical → 9:16, full-body or low-angle vertical compositions
 *     (story / reel / TikTok)
 */
export type SceneStyle =
  | "lifestyle"
  | "studio_creative"
  | "seasonal"
  | "slide_hero"
  | "summer_pole"
  | "story_vertical";

export const ALL_SCENE_STYLES: readonly SceneStyle[] = [
  "lifestyle",
  "studio_creative",
  "seasonal",
  "slide_hero",
  "summer_pole",
  "story_vertical",
] as const;

/**
 * Audience marker for variants that depend on the type of product worn.
 * `casual` variants (jeans, shorts, chinos) only apply to sneakers /
 * mocassins / loafers. `formal` variants (tailored wool, flannel) only
 * apply to richelieus / brogues. Variants without any audience are
 * treated as neutral — they work for any product.
 */
export type SceneAudience = "casual" | "formal";

export interface SceneVariantData {
  /** Top-level grouping (drives format compatibility). */
  style: SceneStyle;
  /** Short human-readable name shown in the editor and the picker. */
  displayName: string;
  /**
   * Prompt body fed to codex / gpt-image-2. Supports {token} interpolation —
   * see picker.ts:interpolateBody for the supported tokens.
   *
   * The body is the *scene* description (location, lighting, props,
   * wardrobe, composition). The product itself is conditioned via the
   * reference images attached as `-i`; the body should reference the
   * shoe via the `{descriptor}` token and instruct the model to stay
   * faithful to the references.
   */
  body: string;
  /**
   * Audience filter. Empty array = neutral (works for any product). When
   * non-empty, the variant only enters the pool if the product's audience
   * (derived from category names) intersects this set.
   */
  audience: SceneAudience[];
  /** Sort key inside the style — lower first. */
  order: number;
  /**
   * `true` if the variant comes from the Reed-Blake-derived seed. Tenants
   * can still edit / delete it; the flag is informative for the editor UI
   * (e.g. show a "reset to default" affordance later).
   */
  isDefault?: boolean;
}

/**
 * Format → style compatibility. Drives which styles are surfaced in the
 * Generate dialog given the chosen aspect format.
 */
export type AspectFormatKey = "1:1" | "4:5" | "9:16" | "16:9";

export const STYLES_FOR_FORMAT: Record<AspectFormatKey, readonly SceneStyle[]> = {
  "1:1": ["lifestyle", "studio_creative", "seasonal", "summer_pole"],
  "4:5": ["lifestyle", "studio_creative", "seasonal", "summer_pole"],
  "9:16": ["story_vertical"],
  "16:9": ["slide_hero"],
};
