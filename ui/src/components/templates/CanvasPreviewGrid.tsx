import { TemplateCanvas } from "./TemplateCanvas";
import { SAMPLE_IMAGES, type TemplateConfig } from "./types";

const PREVIEW_FORMATS = [
  { label: "Square 1:1", width: 1080, height: 1080 },
  { label: "Story 9:16", width: 1080, height: 1920 },
  { label: "Landscape 1.91:1", width: 1200, height: 628 },
];

interface Props {
  config: TemplateConfig;
  logoUrl?: string;
}

/**
 * Shows the same template applied to 3 different aspect ratios side by side,
 * each with a different sample image. Helps visualize cross-format consistency.
 */
export function CanvasPreviewGrid({ config, logoUrl }: Props) {
  const samples = SAMPLE_IMAGES.slice(1); // skip "None"
  return (
    <div className="flex gap-4 flex-wrap justify-center">
      {PREVIEW_FORMATS.map((fmt, idx) => {
        const sample = samples[idx % samples.length];
        const scale = Math.min(0.2, 220 / Math.max(fmt.width, fmt.height));
        return (
          <div key={fmt.label} className="flex flex-col items-center gap-2">
            <TemplateCanvas
              width={fmt.width}
              height={fmt.height}
              config={config}
              logoUrl={logoUrl}
              sampleImageUrl={sample.url}
              scale={scale}
              showLabel={false}
            />
            <span className="text-xs text-muted-foreground">{fmt.label}</span>
          </div>
        );
      })}
    </div>
  );
}
