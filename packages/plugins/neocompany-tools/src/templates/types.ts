/**
 * Brand template types — ported from the legacy Postiz stack
 * (brand-template.dto.ts). Pure TypeScript, no class-validator.
 * All coordinates are in percentages (0-100).
 */

// ---------------------------------------------------------------------------
// Template config types
// ---------------------------------------------------------------------------

export type LogoPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "bottom-center"
  | "center"
  | "custom";

export interface LogoConfig {
  position: LogoPosition;
  x?: number;       // 0-100% (only for "custom")
  y?: number;       // 0-100%
  scale: number;    // 3-50%
  opacity: number;  // 10-100%
}

export interface TextZone {
  id: string;
  name: string;
  x: number;        // 0-100%
  y: number;        // 0-100%
  width: number;    // 0-100%
  height: number;   // 0-100%
  fontSize: number; // 8-200
  fontColor: string;
  fontFamily: string;
  textAlign: "left" | "center" | "right";
  defaultText?: string;
}

export interface FilterConfig {
  brightness: number;  // -100 to 100
  contrast: number;    // -100 to 100
  saturation: number;  // -100 to 100
  blur: number;        // 0-100
}

export interface OverlayConfig {
  color: string;
  opacity: number;  // 0-100
}

export interface BorderConfig {
  width: number;    // 0-50
  color: string;
  radius: number;   // 0-100
}

export interface TemplateConfig {
  logo: LogoConfig;
  textZones: TextZone[];
  filters: FilterConfig;
  overlay: OverlayConfig;
  border: BorderConfig;
  backgroundColor: string;
  imageFit: "cover" | "contain" | "fill";
}

// ---------------------------------------------------------------------------
// Entity shape (stored via ctx.entities)
// ---------------------------------------------------------------------------

export interface BrandTemplateData {
  name: string;
  description?: string;
  width: number;
  height: number;
  config: TemplateConfig;
  previewDataUrl?: string; // base64 PNG for preview thumbnail
  isDefault: boolean;
}

// ---------------------------------------------------------------------------
// Dimension presets (ported from Postiz DIMENSION_PRESETS)
// ---------------------------------------------------------------------------

export interface DimensionPreset {
  key: string;
  label: string;
  width: number;
  height: number;
}

export const DIMENSION_PRESETS: DimensionPreset[] = [
  { key: "instagram-square",   label: "Instagram square",   width: 1080, height: 1080 },
  { key: "instagram-portrait", label: "Instagram portrait", width: 1080, height: 1350 },
  { key: "instagram-story",    label: "Instagram story",    width: 1080, height: 1920 },
  { key: "facebook-post",      label: "Facebook post",      width: 1200, height: 630 },
  { key: "facebook-story",     label: "Facebook story",     width: 1080, height: 1920 },
  { key: "linkedin-post",      label: "LinkedIn post",      width: 1200, height: 627 },
  { key: "twitter-post",       label: "Twitter post",       width: 1200, height: 675 },
  { key: "pinterest-pin",      label: "Pinterest pin",      width: 1000, height: 1500 },
  { key: "youtube-thumbnail",  label: "YouTube thumbnail",  width: 1280, height: 720 },
];

// ---------------------------------------------------------------------------
// Default config (new template starting point)
// ---------------------------------------------------------------------------

export const DEFAULT_TEMPLATE_CONFIG: TemplateConfig = {
  logo: { position: "bottom-right", scale: 15, opacity: 90 },
  textZones: [],
  filters: { brightness: 0, contrast: 0, saturation: 0, blur: 0 },
  overlay: { color: "#000000", opacity: 0 },
  border: { width: 0, color: "#ffffff", radius: 0 },
  backgroundColor: "#ffffff",
  imageFit: "cover",
};

// ---------------------------------------------------------------------------
// Text zone presets (quick-add)
// ---------------------------------------------------------------------------

export const TEXT_ZONE_PRESETS = [
  {
    name: "Bottom Band",
    zone: { x: 0, y: 80, width: 100, height: 20, fontSize: 24, fontColor: "#ffffff", fontFamily: "Arial", textAlign: "center" as const },
  },
  {
    name: "Top Band",
    zone: { x: 0, y: 0, width: 100, height: 15, fontSize: 20, fontColor: "#ffffff", fontFamily: "Arial", textAlign: "center" as const },
  },
  {
    name: "Center Overlay",
    zone: { x: 10, y: 35, width: 80, height: 30, fontSize: 32, fontColor: "#ffffff", fontFamily: "Arial", textAlign: "center" as const },
  },
];

export const AVAILABLE_FONTS = [
  "Arial",
  "Helvetica",
  "Times New Roman",
  "Georgia",
  "Courier New",
  "Verdana",
  "Impact",
  "Trebuchet MS",
];

export const ENTITY_TYPE = "brand_template";
