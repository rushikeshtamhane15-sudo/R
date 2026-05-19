import React from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ArrowUp, ArrowDown, Eye, EyeOff, AlignLeft, AlignCenter, AlignRight, GripVertical, RotateCw } from "lucide-react";

/**
 * Admin editor for the /restaurant hero layout.
 *
 * Two layers of control:
 *   1. Layout template — picks the overall container width/padding/alignment.
 *      Choices: default · centered · stacked-compact · split.
 *   2. Per-element rows — admin can reorder (up/down), toggle visible, set
 *      align (left/center/right) and free-position offsets (x percent,
 *      y pixels).
 *
 * State shape exchanged with parent:
 *   layout: string ("default" | "centered" | "stacked-compact" | "split")
 *   elements: [{key, visible, align, x_offset_pct, y_offset_px}, ...]
 */

const ELEMENT_LABELS = {
  pure_veg_overline: "Top row · Pure Veg badge + overline",
  title: "Hero title",
  hindi_quote: "Hindi promise quote",
  tagline: "Delivery tagline",
  ninety_min: "90-minute fresh banner",
};

const DEFAULT_ELEMENTS = [
  { key: "pure_veg_overline", visible: true, align: "left", x_offset_pct: 0, y_offset_px: 0 },
  { key: "title",             visible: true, align: "left", x_offset_pct: 0, y_offset_px: 0 },
  { key: "hindi_quote",       visible: true, align: "left", x_offset_pct: 0, y_offset_px: 0 },
  { key: "tagline",           visible: true, align: "left", x_offset_pct: 0, y_offset_px: 0 },
  { key: "ninety_min",        visible: true, align: "left", x_offset_pct: 0, y_offset_px: 0 },
];

const LAYOUT_OPTIONS = [
  { value: "default",          label: "Default — left-aligned, wide" },
  { value: "centered",         label: "Centered — narrow column, center-aligned" },
  { value: "stacked-compact",  label: "Compact — tight padding, left-aligned" },
  { value: "split",            label: "Split — left text + right badge" },
];

export default function AdminHeroLayoutEditor({ layout, elements, onChange }) {
  const eff = (Array.isArray(elements) && elements.length > 0) ? elements : DEFAULT_ELEMENTS;
  const eff_layout = layout || "default";

  const updateAt = (idx, patch) => {
    const next = eff.map((e, i) => (i === idx ? { ...e, ...patch } : e));
    onChange({ layout: eff_layout, elements: next });
  };
  const move = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= eff.length) return;
    const next = [...eff];
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange({ layout: eff_layout, elements: next });
  };
  const reset = () => onChange({ layout: "default", elements: DEFAULT_ELEMENTS });

  return (
    <section className="rounded-2xl border border-border bg-card p-5 space-y-4" data-testid="hero-layout-editor">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="font-display font-extrabold flex items-center gap-2">
            <GripVertical className="h-4 w-4 text-primary" /> Hero layout
          </p>
          <p className="text-xs text-muted-foreground mt-1">Reorder rows, toggle visibility, align left/center/right, or nudge with offsets.</p>
        </div>
        <Button variant="outline" size="sm" onClick={reset} className="rounded-full" data-testid="hero-layout-reset">
          <RotateCw className="h-3.5 w-3.5 mr-1.5" /> Reset
        </Button>
      </div>

      {/* Layout template picker */}
      <label className="block">
        <span className="text-[10px] tracking-overline uppercase font-bold text-muted-foreground">Layout template</span>
        <select
          value={eff_layout}
          onChange={(e) => onChange({ layout: e.target.value, elements: eff })}
          className="mt-1.5 w-full h-10 rounded-2xl border border-input bg-background px-3 text-sm"
          data-testid="hero-layout-template"
        >
          {LAYOUT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>

      {/* Per-element rows */}
      <ul className="divide-y divide-border rounded-xl border border-border overflow-hidden">
        {eff.map((el, idx) => (
          <li key={el.key} className="p-3 sm:p-4 bg-background/50" data-testid={`hero-el-${el.key}`}>
            <div className="flex items-center justify-between gap-3 mb-2">
              <p className="font-semibold text-sm">{ELEMENT_LABELS[el.key] || el.key}</p>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(idx, -1)} disabled={idx === 0} data-testid={`hero-el-up-${el.key}`}>
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(idx, +1)} disabled={idx === eff.length - 1} data-testid={`hero-el-down-${el.key}`}>
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant={el.visible === false ? "outline" : "ghost"}
                  className="h-8 w-8"
                  onClick={() => updateAt(idx, { visible: !(el.visible !== false) })}
                  data-testid={`hero-el-vis-${el.key}`}
                  aria-label="Toggle visibility"
                >
                  {el.visible === false ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {/* Alignment */}
              <div>
                <span className="text-[9px] tracking-overline uppercase font-bold text-muted-foreground">Align</span>
                <div className="mt-1 inline-flex rounded-lg border border-border overflow-hidden">
                  {[
                    { v: "left",   I: AlignLeft },
                    { v: "center", I: AlignCenter },
                    { v: "right",  I: AlignRight },
                  ].map(({ v, I }) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => updateAt(idx, { align: v })}
                      className={`h-7 w-9 flex items-center justify-center text-xs ${el.align === v ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}
                      data-testid={`hero-el-align-${el.key}-${v}`}
                      aria-label={`Align ${v}`}
                    >
                      <I className="h-3 w-3" />
                    </button>
                  ))}
                </div>
              </div>

              {/* X offset */}
              <label>
                <span className="text-[9px] tracking-overline uppercase font-bold text-muted-foreground">X offset (−50…50%)</span>
                <Input
                  type="number"
                  step="1"
                  min={-50}
                  max={50}
                  value={el.x_offset_pct ?? 0}
                  onChange={(e) => updateAt(idx, { x_offset_pct: Number(e.target.value) || 0 })}
                  className="mt-1 h-8 text-xs"
                  data-testid={`hero-el-xpct-${el.key}`}
                />
              </label>

              {/* Y offset */}
              <label>
                <span className="text-[9px] tracking-overline uppercase font-bold text-muted-foreground">Y offset (−40…40px)</span>
                <Input
                  type="number"
                  step="1"
                  min={-40}
                  max={40}
                  value={el.y_offset_px ?? 0}
                  onChange={(e) => updateAt(idx, { y_offset_px: Number(e.target.value) || 0 })}
                  className="mt-1 h-8 text-xs"
                  data-testid={`hero-el-ypx-${el.key}`}
                />
              </label>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
