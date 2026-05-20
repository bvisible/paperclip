//// Neocompany Modification — Reed-Blake-derived starter scenes.
////
//// Ported verbatim from `/Users/jeremy/GitHub/Reed-Blake-communication/
//// src/product_image_gen_mcp/prompts.py` (5 styles × 29 variants), plus
//// 4 new `story_vertical` variants created here to fill the Story / Reel
//// (9:16) gap that Reed-Blake didn't cover.
////
//// All bodies use `{descriptor}` for the product reference (interpolated
//// from `formatProductDescriptor(product)` — title + colour + matière +
//// semelle) and leave the location names verbatim (Geneva, Lausanne,
//// Lavaux…). Tenants other than Reed-Blake should clone & edit via the
//// /content/scenes UI to match their own brand.
//// End Neocompany Modification

import type { SceneVariantData } from "./types.js";

function v(
  style: SceneVariantData["style"],
  order: number,
  displayName: string,
  body: string,
  audience: SceneVariantData["audience"] = [],
): SceneVariantData {
  return { style, displayName, body, audience, order, isDefault: true };
}

const LIFESTYLE: SceneVariantData[] = [
  v(
    "lifestyle", 1,
    "Geneva old town walking — wool tailored",
    "Photorealistic close-up of a man walking through a Geneva old-town street, " +
    "wearing these exact {descriptor}. Tight mid-stride crop on the shoes: " +
    "visible leather/suede grain, lacing, stitching and welt, the sole catching " +
    "the light. Tailored charcoal wool trousers cropped at mid-calf. Soft " +
    "daylight, shallow depth of field, 50mm aesthetic, high fashion menswear " +
    "photography, sharp focus on the shoes. Stay ultra-faithful to the reference: " +
    "same color, same material, same sole, same silhouette. No text, no watermark, " +
    "no logo. Square format.",
    ["casual", "formal"],
  ),
  v(
    "lifestyle", 2,
    "Crossed legs sole exposed — selvedge denim",
    "Photorealistic close-up of a man sitting with legs crossed wearing these " +
    "exact {descriptor}. The shoe on the floor shows the upper in rich detail " +
    "(material grain, lacing, stitching, welt); the crossed leg exposes the sole. " +
    "Dark indigo selvedge denim hem, slight cuff. High fashion menswear " +
    "photography, sharp focus on the shoes, neutral indoor light. Stay " +
    "ultra-faithful to the reference: preserve the exact color, material, sole " +
    "pattern and stitching of the product. Do not invent a different shoe. No " +
    "text, no watermark, square format.",
    ["casual"],
  ),
  v(
    "lifestyle", 3,
    "Lausanne cobblestones — stone chino",
    "Photorealistic close-up shot from below knee-level of a man standing on " +
    "Lausanne old-town cobblestones, wearing these exact {descriptor}. " +
    "Stone-colored chino trousers cuffed at the ankle, no socks visible if the " +
    "shoe is a loafer or sneaker. Reflected boutique window light catches the " +
    "upper. 35mm film aesthetic, sharp focus on the shoes. Stay ultra-faithful " +
    "to the reference: same color, same material, same sole, no creative license " +
    "on the shoe itself. No text, no watermark, square format.",
    ["casual"],
  ),
  v(
    "lifestyle", 4,
    "Café terrace summer — tailored stone shorts",
    "Photorealistic close-up of a man sitting on a Geneva café terrace in summer, " +
    "wearing these exact {descriptor}. Tailored stone-colored linen shorts " +
    "cropped just above the knee, no socks if the shoe is a loafer or sneaker. " +
    "Soft warm daylight, espresso cup blurred in background, mid-thigh tight crop " +
    "down to the floor. 50mm aesthetic, high fashion menswear photography, sharp " +
    "focus on the shoes. Stay ultra-faithful to the reference: same color, same " +
    "material, same sole. No text, no watermark, square format.",
    ["casual"],
  ),
  v(
    "lifestyle", 5,
    "Park bench — raw selvedge jeans",
    "Photorealistic close-up of a man sitting on a wooden park bench with legs " +
    "crossed, wearing these exact {descriptor}. Raw selvedge indigo jeans with a " +
    "generous cuff, exposing the sole of the crossed shoe. Soft overcast daylight, " +
    "autumn or spring palette, 50mm aesthetic, sharp focus on the shoes. Stay " +
    "ultra-faithful to the reference: preserve the exact color, material, lacing " +
    "and sole. No text, no watermark, square format.",
    ["casual"],
  ),
  v(
    "lifestyle", 6,
    "Office stairs — tailored navy wool",
    "Photorealistic close-up of a man descending wide stone office stairs in a " +
    "sunlit historic Geneva building, wearing these exact {descriptor}. Tailored " +
    "navy wool trousers with a sharp crease cropped at the ankle, fine ribbed " +
    "dark dress socks visible. Architectural side light, soft shadows, 35mm film " +
    "aesthetic, sharp focus on the shoes. Stay ultra-faithful to the reference: " +
    "same exact color, leather grain, lacing, welt and sole. No text, no " +
    "watermark, no logo. Square format.",
    ["formal"],
  ),
  v(
    "lifestyle", 7,
    "Boardroom corner — tailored grey flannel",
    "Photorealistic close-up shot from below knee-level of a man standing in a " +
    "quiet wood-panelled boardroom corner, wearing these exact {descriptor}. " +
    "Mid-grey tailored flannel trousers with a clean break, thin dress socks " +
    "visible. Diffused window light, hyperrealistic 50mm aesthetic, sharp focus " +
    "on the shoes. Stay ultra-faithful to the reference: preserve the exact " +
    "color, material, lacing, welt and sole pattern. No text, no watermark, " +
    "square format.",
    ["formal"],
  ),
];

const STUDIO_CREATIVE: SceneVariantData[] = [
  v(
    "studio_creative", 1,
    "Walnut + warm rim light",
    "High-end commercial product still-life of these exact {descriptor}. Placed " +
    "on a polished dark walnut surface, single warm directional rim light from " +
    "the side, deep contrast, soft halo on the upper, hyperrealistic 35mm " +
    "aesthetic, sharp focus on the shoes. Stay ultra-faithful to the reference: " +
    "preserve the exact color, material grain, lacing, stitching, welt and sole. " +
    "No styling props, no text, no watermark, no logo. Square format.",
  ),
  v(
    "studio_creative", 2,
    "Marble + crumpled raw linen",
    "Editorial commercial still-life of these exact {descriptor}. Set on a " +
    "Carrara marble slab with a piece of crumpled raw linen draped under one " +
    "shoe, cool soft north-window light, minimal palette, tight 50mm composition, " +
    "hyperrealistic. Stay ultra-faithful to the reference: same exact color, " +
    "same material, same sole, same silhouette. No other props, no text, no " +
    "watermark, square format.",
  ),
  v(
    "studio_creative", 3,
    "Dark velvet + amber backlight",
    "Luxury editorial still-life of these exact {descriptor}. Set on a deep " +
    "emerald velvet cloth, single warm amber backlight casting a soft halo " +
    "around the shoes, dark moody palette, very shallow depth of field, 85mm " +
    "aesthetic, hyperrealistic. Stay ultra-faithful to the reference: preserve " +
    "the exact color, material, lacing, welt and sole pattern. No props, no " +
    "text, no watermark, square format.",
  ),
  v(
    "studio_creative", 4,
    "Polished concrete + window shadow lines",
    "Architectural product photograph of these exact {descriptor}. Resting on " +
    "raw polished concrete with sharp shadow lines from a window blind, " +
    "contemporary minimalist palette, hard directional side light, 35mm " +
    "aesthetic, hyperrealistic. Stay ultra-faithful to the reference: same color, " +
    "same material, same sole, no invented detail. No props, no text, no " +
    "watermark, square format.",
  ),
];

const SEASONAL: SceneVariantData[] = [
  v(
    "seasonal", 1,
    "Autumn — Geneva walking, leaves on cobblestones",
    "Photorealistic close-up of a man walking through Geneva in autumn, wearing " +
    "these exact {descriptor}. Cobblestones with scattered fallen leaves, " +
    "mid-stride crop on the shoes, wool trouser hem visible, golden hour light, " +
    "35mm film aesthetic, sharp focus on the shoes. Stay ultra-faithful to the " +
    "reference: same color, same material, same sole, same silhouette. No text, " +
    "no watermark, square format.",
  ),
  v(
    "seasonal", 2,
    "Winter — fireside, shoes off, sole visible",
    "Photorealistic close-up of these exact {descriptor} placed on aged " +
    "flagstone floor in front of a stone fireplace, warm firelight glow, a " +
    "folded cashmere scarf draped beside, low ambient light, cozy moody " +
    "palette, 35mm aesthetic. One shoe slightly tilted to expose the sole. " +
    "Stay ultra-faithful to the reference: same color, same material grain, " +
    "same exact sole pattern. No text, no watermark, square format.",
  ),
  v(
    "seasonal", 3,
    "Spring — Lausanne lakeside bench, crossed legs",
    "Photorealistic close-up of a man sitting with legs crossed on a weathered " +
    "teak bench by Lake Geneva in Lausanne, wearing these exact {descriptor}. " +
    "The shoe on the ground shows the upper, the crossed leg exposes the sole. " +
    "Soft overcast spring daylight, cherry blossom petals nearby, 50mm lens, " +
    "sharp focus on the shoes. Stay ultra-faithful to the reference: preserve " +
    "the exact color, material, lacing and sole. No text, no watermark, square " +
    "format.",
  ),
  v(
    "seasonal", 4,
    "Summer — terrace, linen, walking close-up",
    "Photorealistic close-up of a man walking on a sunlit terrace in summer, " +
    "wearing these exact {descriptor}. Light linen trousers cropped at " +
    "mid-calf, golden hour back-light, soft warm shadows, mid-stride tight " +
    "crop on the shoes. 35mm aesthetic, sharp focus. Stay ultra-faithful to " +
    "the reference: preserve the exact color, material, sole pattern and " +
    "silhouette. No text, no watermark, square format.",
  ),
];

const SLIDE_HERO: SceneVariantData[] = [
  v(
    "slide_hero", 1,
    "Geneva café terrace — wide editorial 16:9",
    "Editorial wide cinematic 16:9 widescreen photograph of a man sitting on a " +
    "sunlit Geneva café terrace in early summer, wearing these exact " +
    "{descriptor}. Composition is panoramic and horizontal: subject placed " +
    "slightly left of center, wide negative space on the right with blurred " +
    "café tables, brass railing and a hint of Lake Geneva. Warm golden hour " +
    "back-light, soft warm shadows, lots of horizontal headroom and footroom, " +
    "linen trousers cropped at the calf, no socks if loafer or sneaker. The " +
    "shoes are clearly visible in the lower third of the frame, in sharp focus, " +
    "centered horizontally with breathing room on both sides. 35mm film " +
    "aesthetic, high fashion menswear photography, hyperrealistic. Stay " +
    "ultra-faithful to the reference: same exact color, same material, same " +
    "sole, same silhouette. No text, no watermark, no logo. 16:9 cinematic " +
    "widescreen aspect ratio, landscape orientation, do NOT produce a vertical " +
    "or square image.",
  ),
  v(
    "slide_hero", 2,
    "Lake Geneva promenade — wide horizontal landscape",
    "Editorial wide cinematic 16:9 widescreen photograph of a man walking " +
    "along the Lake Geneva promenade in late spring, wearing these exact " +
    "{descriptor}. Wide horizontal panoramic composition: subject centered " +
    "with generous negative space on both sides, long lake view stretching " +
    "to the Alps in soft haze on the right, weathered wooden bench on the " +
    "left. Soft overcast spring daylight, light linen or cotton trousers " +
    "cropped at the ankle. The shoes are sharp and centered in the lower " +
    "third, with breathing room around them. 35mm film aesthetic, soft warm " +
    "palette, hyperrealistic. Stay ultra-faithful to the reference: preserve " +
    "the exact color, material, lacing, welt and sole pattern. No text, no " +
    "watermark, no logo. 16:9 cinematic widescreen aspect ratio, landscape " +
    "orientation, do NOT produce a vertical or square image.",
  ),
  v(
    "slide_hero", 3,
    "Sun-drenched grass / park — relaxed summer hero",
    "Editorial wide cinematic 16:9 widescreen photograph of a man sitting on a " +
    "sun-drenched grassy lawn in a Geneva park, wearing these exact " +
    "{descriptor}. Wide horizontal panoramic composition: legs extended across " +
    "the centre of the frame, shoes prominently in sharp focus, blurred green " +
    "meadow and dappled sunlight stretching far on both sides. Warm " +
    "late-morning light, light cotton chinos rolled at the ankle, no socks if " +
    "loafer or sneaker. Lots of horizontal breathing room, very shallow depth " +
    "of field, hyperrealistic 50mm aesthetic. Stay ultra-faithful to the " +
    "reference: same color, same material, same sole, no creative license on " +
    "the shoe itself. No text, no watermark, no logo. 16:9 cinematic widescreen " +
    "aspect ratio, landscape orientation, do NOT produce a vertical or square " +
    "image.",
  ),
  v(
    "slide_hero", 4,
    "Riviera-style stone steps — luxury editorial slide",
    "Editorial wide cinematic 16:9 widescreen photograph of a man standing on " +
    "warm sun-bleached stone steps overlooking a Riviera-style harbour in early " +
    "summer, wearing these exact {descriptor}. Wide horizontal panoramic " +
    "composition: subject framed slightly left of center, blurred Mediterranean " +
    "blue water and pale stone wall stretching to the right for plenty of " +
    "negative space, terracotta pot with olive tree on the left. Light tailored " +
    "linen trousers cropped above the ankle. The shoes occupy the lower-third " +
    "center of the frame, sharp focus, with generous breathing room. Soft warm " +
    "Mediterranean daylight, hyperrealistic 35mm aesthetic. Stay ultra-faithful " +
    "to the reference: preserve the exact color, material, lacing, welt and " +
    "sole pattern. No text, no watermark, no logo. 16:9 cinematic widescreen " +
    "aspect ratio, landscape orientation, do NOT produce a vertical or square " +
    "image.",
  ),
];

const SUMMER_POLE: SceneVariantData[] = [
  v(
    "summer_pole", 1,
    "Lake Geneva pier — weathered teak boards",
    "Photorealistic close-up of a man sitting on a weathered teak pier platform " +
    "on Lake Geneva in early summer, wearing these exact {descriptor}. Tight " +
    "crop from mid-thigh down to the planks. Light linen trousers cropped above " +
    "the ankle, no socks if loafer or sneaker. The shoes resting on the warm " +
    "wooden boards, soft sparkling water behind, gentle midday haze. 50mm " +
    "aesthetic, hyperrealistic, sharp focus on the shoes. Stay ultra-faithful " +
    "to the reference: same exact color, material, lacing, sole pattern and " +
    "silhouette. No text, no watermark, no logo, square format.",
  ),
  v(
    "summer_pole", 2,
    "Lavaux vineyard stone steps",
    "Photorealistic close-up shot from below knee-level of a man stepping up " +
    "rough stone steps between green vine rows in the Lavaux vineyards above " +
    "Lake Geneva, wearing these exact {descriptor}. Tailored cotton trousers " +
    "cropped at the ankle. Morning sun back-light, dust catching the rays, soft " +
    "shadow on warm pale stone. 35mm film aesthetic, sharp focus on the shoes. " +
    "Stay ultra-faithful to the reference: preserve the exact color, material, " +
    "lacing, sole pattern and silhouette. No text, no watermark, square format.",
  ),
  v(
    "summer_pole", 3,
    "Convertible roadster running board",
    "Photorealistic close-up of a man's foot resting on the polished chrome " +
    "running board of a vintage Riviera convertible roadster parked by a " +
    "sun-bleached harbour stone wall, wearing these exact {descriptor}. The " +
    "other shoe planted on warm cobbles. Tailored cropped linen trousers, no " +
    "socks if loafer or sneaker. Mediterranean blue strip in the soft-blurred " +
    "background. Hyperrealistic 50mm aesthetic, sharp focus on the shoes. Stay " +
    "ultra-faithful to the reference: same exact color, material, lacing, welt " +
    "and sole. No text, no watermark, square format.",
  ),
  v(
    "summer_pole", 4,
    "Park lawn — cuffed denim, shoes on grass",
    "Photorealistic close-up of a man sitting on a sun-drenched grass lawn in a " +
    "Lausanne park, legs extended, wearing these exact {descriptor}. Selvedge " +
    "denim cuffed at the ankle, golden midday light, dappled shadow from a tree, " +
    "blades of grass curling around the welts. Tight crop from mid-thigh down. " +
    "50mm aesthetic, hyperrealistic, sharp focus on the shoes. Stay " +
    "ultra-faithful to the reference: preserve the exact color, material, " +
    "lacing, welt and sole pattern. No text, no watermark, square format.",
  ),
  v(
    "summer_pole", 5,
    "Wooden dock — coiled mooring rope",
    "Photorealistic close-up still-life of these exact {descriptor} placed on " +
    "warm sun-bleached wooden dock planks, with a coiled hemp mooring rope and " +
    "a single brass cleat beside, soft early-morning light, calm water " +
    "reflections in the very edge of frame. Tight 50mm composition, " +
    "hyperrealistic. Stay ultra-faithful to the reference: same exact color, " +
    "same material grain, same sole pattern and silhouette. No props beyond " +
    "the rope and cleat, no text, no watermark, square format.",
  ),
  v(
    "summer_pole", 6,
    "Lausanne old town cobblestones — mid-stride",
    "Photorealistic close-up shot from below knee-level of a man mid-stride on " +
    "Lausanne old-town cobblestones, wearing these exact {descriptor}. " +
    "Sun-bleached pale stone wall in the soft-blurred background, late morning " +
    "side-light, stone-coloured chino trousers cropped above the ankle. 35mm " +
    "film aesthetic, sharp focus on the shoes. Stay ultra-faithful to the " +
    "reference: same color, same material, same sole, same silhouette. No text, " +
    "no watermark, square format.",
  ),
  v(
    "summer_pole", 7,
    "Garden estate stone path — dappled sunlight",
    "Photorealistic close-up of a man walking along a fine gravel path in a " +
    "Geneva garden estate, dappled sunlight filtering through tall trees, " +
    "wearing these exact {descriptor}. Tailored cotton trousers cropped at " +
    "mid-calf, mid-stride tight crop. Soft warm ambient light, very shallow " +
    "depth of field, 50mm aesthetic, hyperrealistic. Stay ultra-faithful to " +
    "the reference: preserve the exact color, material, lacing, sole pattern " +
    "and silhouette. No text, no watermark, square format.",
  ),
  v(
    "summer_pole", 8,
    "Marché Plainpalais — wicker basket of olives",
    "Photorealistic close-up of a man standing beside a wicker basket of olives " +
    "at the Plainpalais farmer's market in Geneva on a sunny morning, wearing " +
    "these exact {descriptor}. Hand-laid pavés underfoot, market crates softly " +
    "blurred behind. Tailored linen trousers cropped above the ankle. 35mm film " +
    "aesthetic, sharp focus on the shoes, hyperrealistic. Stay ultra-faithful " +
    "to the reference: same exact color, material, lacing, sole pattern. No " +
    "text, no watermark, square format.",
  ),
  v(
    "summer_pole", 9,
    "Hotel pool deck — wooden lounger, Mediterranean light",
    "Photorealistic close-up of these exact {descriptor} placed on warm wooden " +
    "pool-deck planks beside a folded white linen towel and a low teak lounger, " +
    "with the pale-blue water of a Riviera hotel pool softly blurred at the " +
    "very top of frame. Hyperrealistic 50mm aesthetic, soft midday " +
    "Mediterranean light, sharp focus on the shoes. Stay ultra-faithful to the " +
    "reference: preserve the exact color, material grain, lacing, welt and " +
    "sole pattern. No text, no watermark, square format.",
  ),
  v(
    "summer_pole", 10,
    "Tennis club terrace — terracotta tiles, panama hat",
    "Photorealistic close-up of these exact {descriptor} resting on warm " +
    "terracotta tiles of a sun-drenched private tennis club terrace, a panama " +
    "straw hat lying nearby, blurred clay court visible in the background, " +
    "late afternoon golden side-light. Hyperrealistic 35mm aesthetic, sharp " +
    "focus on the shoes. Stay ultra-faithful to the reference: same exact " +
    "color, same material, same sole pattern and silhouette. No text, no " +
    "watermark, square format.",
  ),
];

//// Neocompany Modification — Story vertical (9:16) — NEW POOL.
//// Reed-Blake didn't ship Story/Reel templates; created here to fill the
//// IG Story / TikTok / Reel format slot.
const STORY_VERTICAL: SceneVariantData[] = [
  v(
    "story_vertical", 1,
    "Full-body walking — vertical street",
    "Editorial vertical 9:16 photograph of a man walking down a narrow Geneva " +
    "old-town alley, wearing these exact {descriptor}. Full-body shot from head " +
    "to toe, subject centered in the vertical frame with generous headroom and " +
    "footroom. Tailored cotton trousers cropped at the ankle, linen shirt. " +
    "Golden hour side-light, warm shadows on pale stone walls. The shoes are " +
    "fully visible at the bottom of the frame, sharp focus, with clear margin " +
    "below the soles. 35mm film aesthetic, hyperrealistic. Stay ultra-faithful " +
    "to the reference: same color, same material, same sole, same silhouette. " +
    "No text, no watermark, no logo. 9:16 vertical orientation, do NOT produce " +
    "a square or horizontal image.",
  ),
  v(
    "story_vertical", 2,
    "Low-angle hero — shoes from below",
    "Editorial vertical 9:16 photograph shot from a very low ground-level angle " +
    "looking up at a man standing on a sun-bleached pavement, wearing these " +
    "exact {descriptor}. The shoes dominate the lower two-thirds of the frame " +
    "in sharp focus and rich detail (upper grain, welt, sole pattern, lacing); " +
    "the silhouette of the man tapers upward into the soft-blurred sky. Soft " +
    "warm afternoon light. Hyperrealistic 24mm aesthetic. Stay ultra-faithful " +
    "to the reference: preserve the exact color, material, lacing, welt and " +
    "sole pattern. No text, no watermark, no logo. 9:16 vertical orientation, " +
    "do NOT produce a square or horizontal image.",
  ),
  v(
    "story_vertical", 3,
    "Stairs descending — vertical motion",
    "Editorial vertical 9:16 photograph of a man descending a long stone " +
    "staircase in a sunlit historic Geneva courtyard, wearing these exact " +
    "{descriptor}. Camera positioned at mid-stair level, looking slightly up; " +
    "the man centered in the vertical frame mid-step, shoes clearly visible " +
    "and sharp on the next step down, with breathing room below the soles. " +
    "Tailored navy wool or stone linen trousers cropped above the ankle. " +
    "Architectural side-light, soft shadows. 35mm film aesthetic, " +
    "hyperrealistic. Stay ultra-faithful to the reference: same exact color, " +
    "leather grain, lacing, welt and sole. No text, no watermark, no logo. " +
    "9:16 vertical orientation, do NOT produce a square or horizontal image.",
  ),
  v(
    "story_vertical", 4,
    "Vertical still-life flat-lay",
    "Editorial vertical 9:16 still-life of these exact {descriptor} laid flat " +
    "side-by-side on a textured warm canvas surface, viewed from directly above. " +
    "Generous vertical headroom above and below the shoes. A folded soft cotton " +
    "shirt and a single brass key placed beside as minimal styling props. Soft " +
    "diffused window light from one side, gentle natural shadows. Hyperrealistic " +
    "50mm overhead aesthetic, sharp focus on every detail of the shoes (upper " +
    "grain, lacing, welt, sole pattern). Stay ultra-faithful to the reference: " +
    "preserve the exact color, material, lacing, welt and sole. No text, no " +
    "watermark. 9:16 vertical orientation, do NOT produce a square or horizontal " +
    "image.",
  ),
];

export function getStarterScenes(): SceneVariantData[] {
  return [
    ...LIFESTYLE,
    ...STUDIO_CREATIVE,
    ...SEASONAL,
    ...SLIDE_HERO,
    ...SUMMER_POLE,
    ...STORY_VERTICAL,
  ];
}
