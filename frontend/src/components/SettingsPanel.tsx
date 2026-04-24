import { useEffect, useState } from "react";
import type { Settings, MarketHub } from "../types";
import type { SolarSystem } from "../types";
import SystemPicker from "./SystemPicker";
import { fetchMarketHubs } from "../api/client";

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
  onApply: () => void;
  onRefresh?: () => void;
  loading: boolean;
  /** Extra fields shown only in Explorer mode */
  explorerMode?: boolean;
}

function PctInput({
  label,
  value,
  field,
  max,
  onChange,
}: {
  label: string;
  value: number;
  field: keyof Settings;
  max?: number;
  onChange: (f: keyof Settings, v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-eve-muted">{label}</span>
      <div className="relative">
        <input
          type="number"
          min="0"
          max={max ?? 100}
          step="0.1"
          value={(value * 100).toFixed(2)}
          onChange={(e) => onChange(field, parseFloat(e.target.value) / 100 || 0)}
          className="w-full bg-eve-bg border border-eve-border rounded px-3 py-1.5
                     pr-8 text-sm text-eve-text focus:outline-none focus:border-eve-orange"
        />
        <span className="absolute right-2.5 top-1.5 text-eve-muted text-sm">%</span>
      </div>
    </label>
  );
}

function SelectInput({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | number;
  options: { value: string | number; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-eve-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-eve-bg border border-eve-border rounded px-3 py-1.5
                   text-sm text-eve-text focus:outline-none focus:border-eve-orange"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function SkillInput({
  label,
  value,
  field,
  onChange,
}: {
  label: string;
  value: number;
  field: keyof Settings;
  onChange: (f: keyof Settings, v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-eve-muted">{label}</span>
      <input
        type="number"
        min="0"
        max="5"
        value={value}
        onChange={(e) => onChange(field, Math.min(5, Math.max(0, parseInt(e.target.value) || 0)))}
        className="w-full bg-eve-bg border border-eve-border rounded px-3 py-1.5
                   text-sm text-eve-text focus:outline-none focus:border-eve-orange"
      />
    </label>
  );
}

export default function SettingsPanel({
  settings,
  onChange,
  onApply,
  onRefresh,
  loading,
  explorerMode = false,
}: Props) {
  const [hubs, setHubs] = useState<MarketHub[]>([]);

  useEffect(() => {
    fetchMarketHubs().then(setHubs).catch(() => {});
  }, []);

  const set = (field: keyof Settings, value: number | string) =>
    onChange({ ...settings, [field]: value });

  const hubOptions = hubs.map((h) => ({ value: h.region_id, label: h.name }));

  return (
    <div className="bg-eve-surface border border-eve-border rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-eve-muted">
          Settings
        </h2>
        <div className="text-[10px] text-eve-muted/50 uppercase tracking-tight">
          Facility bonuses applied from global settings
        </div>
      </div>

      {/* Main row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 items-end">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-eve-muted">Runs per BP</span>
          <input
            type="number"
            min="1"
            max="10000"
            value={settings.runs}
            onChange={(e) => set("runs", parseInt(e.target.value) || 1)}
            className="w-full bg-eve-bg border border-eve-border rounded px-3 py-1.5
                       text-sm text-eve-text focus:outline-none focus:border-eve-orange"
          />
        </label>

        {hubOptions.length > 0 && (
          <SelectInput
            label="Market Hub"
            value={settings.price_region_id}
            options={hubOptions}
            onChange={(v) => set("price_region_id", parseInt(v))}
          />
        )}

        {explorerMode && (
          <div className="grid grid-cols-2 gap-2 col-span-2 sm:col-span-1 lg:col-span-1">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-eve-muted whitespace-nowrap">Assume ME</span>
              <input
                type="number" min="0" max="10"
                value={settings.assumed_me}
                onChange={(e) => set("assumed_me", parseInt(e.target.value) || 0)}
                className="w-full bg-eve-bg border border-eve-border rounded px-3 py-1.5
                           text-sm text-eve-text focus:outline-none focus:border-eve-orange"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-eve-muted whitespace-nowrap">Assume TE</span>
              <input
                type="number" min="0" max="20"
                value={settings.assumed_te}
                onChange={(e) => set("assumed_te", parseInt(e.target.value) || 0)}
                className="w-full bg-eve-bg border border-eve-border rounded px-3 py-1.5
                           text-sm text-eve-text focus:outline-none focus:border-eve-orange"
              />
            </label>
          </div>
        )}
      </div>

      {/* Market source row */}
      <div className="grid grid-cols-2 gap-4 items-end">
        <SelectInput
          label="Buy Materials via"
          value={settings.material_order_type}
          options={[
            { value: "sell", label: "Sell Orders (immediate)" },
            { value: "buy",  label: "Buy Orders (cheaper)" },
          ]}
          onChange={(v) => set("material_order_type", v)}
        />
        <SelectInput
          label="Sell Products via"
          value={settings.product_order_type}
          options={[
            { value: "sell", label: "Sell Orders (higher)" },
            { value: "buy",  label: "Buy Orders (instant)" },
          ]}
          onChange={(v) => set("product_order_type", v)}
        />
      </div>

      {/* Bottom row: min profit + apply button */}
      <div className="flex items-center gap-4 pt-1">
        <label className="flex items-center gap-2 text-xs text-eve-muted">
          Min. profit
          <input
            type="number"
            min="0"
            value={settings.min_profit}
            onChange={(e) => set("min_profit", parseFloat(e.target.value) || 0)}
            className="w-32 bg-eve-bg border border-eve-border rounded px-3 py-1.5
                       text-sm text-eve-text focus:outline-none focus:border-eve-orange"
          />
          <span>ISK</span>
        </label>

        <div className="ml-auto flex items-center gap-3">
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={loading}
              className="px-4 py-2 text-eve-orange border border-eve-orange/30 hover:bg-eve-orange/10
                         disabled:opacity-40 disabled:cursor-not-allowed
                         text-sm font-semibold rounded transition-colors"
            >
              Refresh Prices
            </button>
          )}
          <button
            onClick={onApply}
            disabled={loading || !settings.solar_system_id}
            className="px-6 py-2 bg-eve-orange hover:bg-eve-orange/90
                       disabled:opacity-40 disabled:cursor-not-allowed
                       text-white text-sm font-semibold rounded
                       transition-colors active:scale-95"
          >
            {loading ? "Loading…" : "Calculate Profits"}
          </button>
        </div>
      </div>
    </div>
  );
}
