/**
 * Shared types for the template editor.
 * Mirrors the neocompany-tools plugin's templates/types.ts but kept local
 * so the UI doesn't depend on the plugin package directly.
 */

export interface LogoConfig {
  x: number;       // 0-100% (center point)
  y: number;       // 0-100% (center point)
  scale: number;   // 3-50% of canvas width
  opacity: number; // 10-100
}

export interface TextZone {
  id: string;
  name: string;
  x: number;        // 0-100% (top-left)
  y: number;        // 0-100%
  width: number;    // 0-100%
  height: number;   // 0-100%
  fontSize: number; // 8-200 px at full canvas
  fontColor: string;
  fontFamily: string;
  textAlign: "left" | "center" | "right";
  defaultText?: string;
}

export interface FilterConfig {
  brightness: number;
  contrast: number;
  saturation: number;
  blur: number;
}

export interface OverlayConfig {
  color: string;
  opacity: number; // 0-100
}

export interface BorderConfig {
  width: number;  // 0-50 px at full canvas
  color: string;
  radius: number; // 0-100 px at full canvas
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

export interface BrandTemplateData {
  name: string;
  description?: string;
  width: number;
  height: number;
  config: TemplateConfig;
  previewDataUrl?: string;
  isDefault: boolean;
}

export const DIMENSION_PRESETS = [
  { key: "instagram-square",   label: "Instagram square",   width: 1080, height: 1080 },
  { key: "instagram-portrait", label: "Instagram portrait", width: 1080, height: 1350 },
  { key: "instagram-story",    label: "Instagram story",    width: 1080, height: 1920 },
  { key: "facebook-post",      label: "Facebook post",      width: 1200, height: 630 },
  { key: "linkedin-post",      label: "LinkedIn post",      width: 1200, height: 627 },
  { key: "twitter-post",       label: "Twitter post",       width: 1200, height: 675 },
  { key: "pinterest-pin",      label: "Pinterest pin",      width: 1000, height: 1500 },
  { key: "youtube-thumbnail",  label: "YouTube thumbnail",  width: 1280, height: 720 },
];

export const AVAILABLE_FONTS = [
  "Arial", "Courier New", "Forum", "Georgia", "Helvetica",
  "Impact", "Inter", "Karla", "Montserrat", "Open Sans",
  "Playfair Display", "Poppins", "Roboto", "Times New Roman",
  "Trebuchet MS", "Verdana",
];

export const DEFAULT_TEMPLATE_CONFIG: TemplateConfig = {
  logo: { x: 50, y: 85, scale: 15, opacity: 100 },
  textZones: [],
  filters: { brightness: 0, contrast: 0, saturation: 0, blur: 0 },
  overlay: { color: "#000000", opacity: 0 },
  border: { width: 0, color: "#ffffff", radius: 0 },
  backgroundColor: "#ffffff",
  imageFit: "cover",
};

export const SAMPLE_IMAGES = [
  { label: "None", url: undefined as string | undefined },
  { label: "Tech",    url: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800" },
  { label: "Watch",   url: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800" },
  { label: "Polaroid", url: "https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=800" },
];

export const TEXT_ZONE_PRESETS: Array<{
  id: string;
  label: string;
  create: () => TextZone;
}> = [
  {
    id: "bottom-band",
    label: "Bottom Band",
    create: () => ({
      id: `zone-${Date.now()}`,
      name: "Bottom Band",
      x: 0, y: 92, width: 100, height: 8,
      fontSize: 24, fontColor: "#ffffff",
      fontFamily: "Arial", textAlign: "center",
      defaultText: "www.your-brand.com",
    }),
  },
  {
    id: "top-band",
    label: "Top Band",
    create: () => ({
      id: `zone-${Date.now() + 1}`,
      name: "Top Band",
      x: 0, y: 0, width: 100, height: 6,
      fontSize: 20, fontColor: "#ffffff",
      fontFamily: "Arial", textAlign: "center",
      defaultText: "BRAND NAME",
    }),
  },
  {
    id: "center-overlay",
    label: "Center Overlay",
    create: () => ({
      id: `zone-${Date.now() + 2}`,
      name: "Center Overlay",
      x: 10, y: 40, width: 80, height: 20,
      fontSize: 36, fontColor: "#ffffff",
      fontFamily: "Georgia", textAlign: "center",
      defaultText: "YOUR BRAND",
    }),
  },
];
