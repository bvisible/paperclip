import { useMemo } from "react";
import type { TemplateConfig } from "./types";

interface TemplateCanvasProps {
  width: number;           // logical canvas width
  height: number;          // logical canvas height
  config: TemplateConfig;
  logoUrl?: string;
  sampleImageUrl?: string;
  scale?: number;          // default 0.5
  showLabel?: boolean;     // shows dimensions badge
}

/**
 * Live CSS-based preview of a brand template. No server round-trip —
 * percentages are converted to pixels at render time.
 */
export function TemplateCanvas({
  width,
  height,
  config,
  logoUrl,
  sampleImageUrl,
  scale = 0.5,
  showLabel = true,
}: TemplateCanvasProps) {
  const canvasWidth = width * scale;
  const canvasHeight = height * scale;

  const logoPosition = useMemo(() => {
    if (!config.logo) return null;
    const { x = 50, y = 50, scale: logoScale = 15 } = config.logo;
    const logoSize = (logoScale / 100) * canvasWidth;
    return {
      left: (x / 100) * canvasWidth - logoSize / 2,
      top: (y / 100) * canvasHeight - logoSize / 2,
      size: logoSize,
    };
  }, [config.logo, canvasWidth, canvasHeight]);

  const filterStyle = useMemo(() => {
    if (!config.filters) return "";
    const parts: string[] = [];
    if (config.filters.brightness) parts.push(`brightness(${1 + config.filters.brightness / 100})`);
    if (config.filters.contrast) parts.push(`contrast(${1 + config.filters.contrast / 100})`);
    if (config.filters.saturation) parts.push(`saturate(${1 + config.filters.saturation / 100})`);
    if (config.filters.blur) parts.push(`blur(${(config.filters.blur / 100) * 10}px)`);
    return parts.join(" ");
  }, [config.filters]);

  return (
    <div
      className="relative overflow-hidden"
      style={{
        width: canvasWidth,
        height: canvasHeight,
        backgroundColor: config.backgroundColor || "#ffffff",
        borderStyle: "solid",
        borderWidth: (config.border?.width || 0) * scale,
        borderColor: config.border?.color || "#000000",
        borderRadius: (config.border?.radius || 0) * scale,
      }}
    >
      {/* Source image */}
      {sampleImageUrl && (
        <img
          src={sampleImageUrl}
          alt=""
          className="absolute inset-0 w-full h-full"
          style={{
            objectFit: config.imageFit || "cover",
            filter: filterStyle || undefined,
          }}
        />
      )}

      {/* Color overlay */}
      {config.overlay && config.overlay.opacity > 0 && (
        <div
          className="absolute inset-0"
          style={{
            backgroundColor: config.overlay.color,
            opacity: (config.overlay.opacity || 0) / 100,
          }}
        />
      )}

      {/* Text zones */}
      {(config.textZones || []).map((zone) => (
        <div
          key={zone.id}
          className="absolute border border-dashed border-blue-400/70 bg-blue-400/5 flex items-center overflow-hidden"
          style={{
            left: (zone.x / 100) * canvasWidth,
            top: (zone.y / 100) * canvasHeight,
            width: (zone.width / 100) * canvasWidth,
            height: (zone.height / 100) * canvasHeight,
            justifyContent:
              zone.textAlign === "center" ? "center" :
              zone.textAlign === "right" ? "flex-end" : "flex-start",
          }}
        >
          <span
            className="truncate px-1"
            style={{
              fontSize: Math.max(6, (zone.fontSize || 24) * scale),
              color: zone.fontColor || "#ffffff",
              textAlign: zone.textAlign,
              fontFamily: zone.fontFamily || "Arial, sans-serif",
            }}
          >
            {zone.defaultText || zone.name}
          </span>
        </div>
      ))}

      {/* Logo */}
      {logoPosition && logoUrl && (
        <div
          className="absolute"
          style={{
            left: logoPosition.left,
            top: logoPosition.top,
            width: logoPosition.size,
            height: logoPosition.size,
            opacity: (config.logo?.opacity || 100) / 100,
          }}
        >
          <img src={logoUrl} alt="" className="w-full h-full object-contain" />
        </div>
      )}
      {logoPosition && !logoUrl && (
        <div
          className="absolute border-2 border-dashed border-green-500/70 bg-green-500/10 flex items-center justify-center"
          style={{
            left: logoPosition.left,
            top: logoPosition.top,
            width: logoPosition.size,
            height: logoPosition.size,
          }}
        >
          <span className="text-[10px] text-green-700 font-medium">Logo</span>
        </div>
      )}

      {/* Dimensions label */}
      {showLabel && (
        <div className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white font-medium tabular-nums">
          {width}×{height}
        </div>
      )}
    </div>
  );
}
