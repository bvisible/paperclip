//// Neocompany Modification — pure addition (Neocompany fork on top of paperclipai/paperclip)
//// This file does not exist upstream. Safe across upstream merges.

import { useCallback } from "react";
import { Plus, X, Locate } from "lucide-react";
import {
  AVAILABLE_FONTS,
  DIMENSION_PRESETS,
  TEXT_ZONE_PRESETS,
  type TemplateConfig,
  type TextZone,
} from "./types";

// ---------------------------------------------------------------------------
// Slider — reusable
// ---------------------------------------------------------------------------

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  unit?: string;
}

function Slider({ label, value, min, max, step = 1, onChange, unit = "%" }: SliderProps) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-muted-foreground">
        {label} ({value}{unit})
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Dimensions
// ---------------------------------------------------------------------------

interface DimensionsProps {
  width: number;
  height: number;
  onWidthChange: (v: number) => void;
  onHeightChange: (v: number) => void;
}

export function DimensionsTab({ width, height, onWidthChange, onHeightChange }: DimensionsProps) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5">
          Presets
        </label>
        <div className="grid grid-cols-2 gap-2">
          {DIMENSION_PRESETS.map((p) => {
            const active = width === p.width && height === p.height;
            return (
              <button
                key={p.key}
                onClick={() => {
                  onWidthChange(p.width);
                  onHeightChange(p.height);
                }}
                className={`rounded-md border px-3 py-2 text-left transition-colors ${
                  active
                    ? "border-primary bg-primary/5 text-foreground"
                    : "border-border bg-card hover:bg-muted/50"
                }`}
              >
                <div className="text-xs font-medium">{p.label}</div>
                <div className="text-[10px] text-muted-foreground tabular-nums">
                  {p.width} × {p.height}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Width (px)</label>
          <input
            type="number"
            value={width}
            onChange={(e) => onWidthChange(Number(e.target.value))}
            min={100}
            max={4096}
            className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Height (px)</label>
          <input
            type="number"
            value={height}
            onChange={(e) => onHeightChange(Number(e.target.value))}
            min={100}
            max={4096}
            className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Logo
// ---------------------------------------------------------------------------

interface LogoProps {
  config: TemplateConfig;
  logoUrl?: string;
  onLogoUrlChange: (url: string | undefined) => void;
  onConfigChange: (patch: Partial<TemplateConfig>) => void;
}

export function LogoTab({ config, logoUrl, onLogoUrlChange, onConfigChange }: LogoProps) {
  const logo = config.logo;
  const updateLogo = (patch: Partial<typeof logo>) =>
    onConfigChange({ logo: { ...logo, ...patch } });

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onLogoUrlChange(reader.result as string);
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1.5">Logo image</label>
        {logoUrl ? (
          <div className="flex items-center gap-3 rounded-md border border-border bg-card p-2">
            <div className="shrink-0 w-12 h-12 flex items-center justify-center rounded bg-muted/50 overflow-hidden">
              <img src={logoUrl} alt="" className="max-w-full max-h-full object-contain" />
            </div>
            <span className="flex-1 text-xs text-muted-foreground">Logo selected</span>
            <button
              onClick={() => onLogoUrlChange(undefined)}
              className="text-xs text-destructive hover:underline"
            >
              Remove
            </button>
          </div>
        ) : (
          <label className="flex items-center gap-2 rounded-md border border-dashed border-border bg-card p-3 cursor-pointer hover:border-primary hover:bg-primary/5 transition-colors">
            <Plus className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Choose a logo (PNG, SVG, JPEG)</span>
            <input type="file" accept="image/*" onChange={handleFile} className="hidden" />
          </label>
        )}
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          Tip: Set your brand logo in <code>Company Settings → Appearance</code> to reuse it across templates.
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-medium text-muted-foreground">Logo position</label>
          <button
            onClick={() => updateLogo({ position: "custom", x: 50, y: 50 })}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <Locate className="h-3 w-3" /> Center
          </button>
        </div>
        <div className="space-y-3 rounded-md bg-muted/30 p-3">
          <Slider
            label="X — Horizontal"
            value={logo?.x ?? 50}
            min={0}
            max={100}
            onChange={(v) => updateLogo({ position: "custom", x: v })}
          />
          <Slider
            label="Y — Vertical"
            value={logo?.y ?? 85}
            min={0}
            max={100}
            onChange={(v) => updateLogo({ position: "custom", y: v })}
          />
        </div>
      </div>

      <Slider
        label="Logo scale"
        value={logo?.scale ?? 15}
        min={3}
        max={50}
        onChange={(v) => updateLogo({ scale: v })}
      />

      <Slider
        label="Logo opacity"
        value={logo?.opacity ?? 100}
        min={10}
        max={100}
        onChange={(v) => updateLogo({ opacity: v })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Text
// ---------------------------------------------------------------------------

interface TextProps {
  config: TemplateConfig;
  onConfigChange: (patch: Partial<TemplateConfig>) => void;
}

export function TextTab({ config, onConfigChange }: TextProps) {
  const zones = config.textZones || [];

  const addZone = useCallback(
    (zone: TextZone) => {
      onConfigChange({ textZones: [...zones, zone] });
    },
    [zones, onConfigChange],
  );

  const updateZone = useCallback(
    (id: string, patch: Partial<TextZone>) => {
      onConfigChange({
        textZones: zones.map((z) => (z.id === id ? { ...z, ...patch } : z)),
      });
    },
    [zones, onConfigChange],
  );

  const removeZone = useCallback(
    (id: string) => {
      onConfigChange({ textZones: zones.filter((z) => z.id !== id) });
    },
    [zones, onConfigChange],
  );

  const addBlankZone = () => {
    addZone({
      id: `zone-${Date.now()}`,
      name: `Text ${zones.length + 1}`,
      x: 5, y: 80, width: 90, height: 12,
      fontSize: 32, fontColor: "#ffffff",
      fontFamily: "Arial", textAlign: "center",
      defaultText: "Your text here",
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">
          Text zones {zones.length > 0 && `· ${zones.length}`}
        </label>
        <button
          onClick={addBlankZone}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <Plus className="h-3 w-3" /> Add zone
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {TEXT_ZONE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            onClick={() => addZone(preset.create())}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
          >
            + {preset.label}
          </button>
        ))}
      </div>

      {zones.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
          No text zones yet. Use a preset or "Add zone" to get started.
        </p>
      ) : (
        <div className="space-y-3">
          {zones.map((z) => (
            <div key={z.id} className="rounded-md border border-border bg-card p-3 space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={z.name}
                  onChange={(e) => updateZone(z.id, { name: e.target.value })}
                  className="flex-1 rounded-md border border-input bg-transparent px-2 py-1 text-sm font-medium"
                />
                <button
                  onClick={() => removeZone(z.id)}
                  className="rounded-md p-1 text-destructive hover:bg-destructive/10"
                  title="Remove zone"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Slider label="X" value={z.x} min={0} max={100} onChange={(v) => updateZone(z.id, { x: v })} />
                <Slider label="Y" value={z.y} min={0} max={100} onChange={(v) => updateZone(z.id, { y: v })} />
                <Slider label="Width" value={z.width} min={0} max={100} onChange={(v) => updateZone(z.id, { width: v })} />
                <Slider label="Height" value={z.height} min={0} max={100} onChange={(v) => updateZone(z.id, { height: v })} />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground">Size</label>
                  <input
                    type="number"
                    value={z.fontSize}
                    min={8}
                    max={200}
                    onChange={(e) => updateZone(z.id, { fontSize: Number(e.target.value) })}
                    className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground">Color</label>
                  <input
                    type="color"
                    value={z.fontColor}
                    onChange={(e) => updateZone(z.id, { fontColor: e.target.value })}
                    className="w-full h-7 rounded-md border border-input cursor-pointer"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground">Align</label>
                  <select
                    value={z.textAlign}
                    onChange={(e) => updateZone(z.id, { textAlign: e.target.value as TextZone["textAlign"] })}
                    className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                  >
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-medium text-muted-foreground">Font</label>
                <select
                  value={z.fontFamily}
                  onChange={(e) => updateZone(z.id, { fontFamily: e.target.value })}
                  className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                >
                  {AVAILABLE_FONTS.map((f) => (
                    <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-medium text-muted-foreground">Default text</label>
                <input
                  type="text"
                  value={z.defaultText ?? ""}
                  onChange={(e) => updateZone(z.id, { defaultText: e.target.value })}
                  className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Style
// ---------------------------------------------------------------------------

export function StyleTab({ config, onConfigChange }: TextProps) {
  const updateOverlay = (patch: Partial<TemplateConfig["overlay"]>) =>
    onConfigChange({ overlay: { ...config.overlay, ...patch } });
  const updateBorder = (patch: Partial<TemplateConfig["border"]>) =>
    onConfigChange({ border: { ...config.border, ...patch } });

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Image fit</label>
        <select
          value={config.imageFit}
          onChange={(e) => onConfigChange({ imageFit: e.target.value as TemplateConfig["imageFit"] })}
          className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
        >
          <option value="cover">Cover (crop to fill)</option>
          <option value="contain">Contain (fit without crop)</option>
          <option value="fill">Fill (stretch)</option>
        </select>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Background color</label>
        <input
          type="color"
          value={config.backgroundColor}
          onChange={(e) => onConfigChange({ backgroundColor: e.target.value })}
          className="w-full h-9 rounded-md border border-input cursor-pointer"
        />
      </div>

      <div className="space-y-2 rounded-md bg-muted/30 p-3">
        <span className="text-xs font-medium text-muted-foreground">Color overlay</span>
        <input
          type="color"
          value={config.overlay.color}
          onChange={(e) => updateOverlay({ color: e.target.value })}
          className="w-full h-8 rounded-md border border-input cursor-pointer"
        />
        <Slider
          label="Overlay opacity"
          value={config.overlay.opacity}
          min={0}
          max={100}
          onChange={(v) => updateOverlay({ opacity: v })}
        />
      </div>

      <div className="space-y-2 rounded-md bg-muted/30 p-3">
        <span className="text-xs font-medium text-muted-foreground">Border</span>
        <Slider
          label="Border width"
          value={config.border.width}
          min={0}
          max={50}
          onChange={(v) => updateBorder({ width: v })}
          unit="px"
        />
        <input
          type="color"
          value={config.border.color}
          onChange={(e) => updateBorder({ color: e.target.value })}
          className="w-full h-8 rounded-md border border-input cursor-pointer"
        />
        <Slider
          label="Border radius"
          value={config.border.radius}
          min={0}
          max={100}
          onChange={(v) => updateBorder({ radius: v })}
          unit="px"
        />
      </div>

      <div className="space-y-2 rounded-md bg-muted/30 p-3">
        <span className="text-xs font-medium text-muted-foreground">Filters</span>
        <Slider
          label="Brightness"
          value={config.filters.brightness}
          min={-100}
          max={100}
          onChange={(v) => onConfigChange({ filters: { ...config.filters, brightness: v } })}
        />
        <Slider
          label="Contrast"
          value={config.filters.contrast}
          min={-100}
          max={100}
          onChange={(v) => onConfigChange({ filters: { ...config.filters, contrast: v } })}
        />
        <Slider
          label="Saturation"
          value={config.filters.saturation}
          min={-100}
          max={100}
          onChange={(v) => onConfigChange({ filters: { ...config.filters, saturation: v } })}
        />
        <Slider
          label="Blur"
          value={config.filters.blur}
          min={0}
          max={100}
          onChange={(v) => onConfigChange({ filters: { ...config.filters, blur: v } })}
        />
      </div>
    </div>
  );
}
