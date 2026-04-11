import { useEffect, useState } from "react";
import type { Settings, MarketHub } from "../types";
import type { SolarSystem } from "../types";
import SystemPicker from "./SystemPicker";
import { fetchMarketHubs } from "../api/client";

interface Props {
  settings: Settings;
  system: SolarSystem | null;
  onSystemChange: (sys: SolarSystem) => void;
  onChange: (s: Settings) => void;
  onApply: () => void;
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
  system,
  onSystemChange,
  onChange,
  onApply,
  loading,
  explorerMode = false,
}: Props) {
  const [hubs, setHubs] = useState<MarketHub[]>([]);
  const [showStructure, setShowStructure] = useState(false);
  const [showSkills, setShowSkills] = useState(false);

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
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowSkills((p) => !p)}
            className="text-xs text-eve-muted hover:text-eve-orange transition-colors"
          >
            {showSkills ? "Hide" : "Show"} Skills
          </button>
          <button
            onClick={() => setShowStructure((p) => !p)}
            className="text-xs text-eve-muted hover:text-eve-orange transition-colors"
          >
            {showStructure ? "Hide" : "Show"} Structure Bonuses
          </button>
        </div>
      </div>

      {/* Main row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 items-end">
        <div className="col-span-2 sm:col-span-1 lg:col-span-2 flex flex-col gap-1">
          <span className="text-xs text-eve-muted">Manufacturing System</span>
          <SystemPicker value={system} onChange={onSystemChange} />
        </div>

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

        <PctInput label="Broker Fee"   value={settings.broker_fee}   field="broker_fee"   onChange={set} />
        <PctInput label="Sales Tax"    value={settings.sales_tax}    field="sales_tax"    onChange={set} />
        <PctInput label="Facility Tax" value={settings.facility_tax} field="facility_tax" onChange={set} />
      </div>

      {/* Market source row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 items-end">
        {hubOptions.length > 0 && (
          <SelectInput
            label="Market Hub"
            value={settings.price_region_id}
            options={hubOptions}
            onChange={(v) => set("price_region_id", parseInt(v))}
          />
        )}
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

        {explorerMode && (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-eve-muted">Assume ME</span>
              <input
                type="number" min="0" max="10"
                value={settings.assumed_me}
                onChange={(e) => set("assumed_me", parseInt(e.target.value) || 0)}
                className="w-full bg-eve-bg border border-eve-border rounded px-3 py-1.5
                           text-sm text-eve-text focus:outline-none focus:border-eve-orange"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-eve-muted">Assume TE</span>
              <input
                type="number" min="0" max="20"
                value={settings.assumed_te}
                onChange={(e) => set("assumed_te", parseInt(e.target.value) || 0)}
                className="w-full bg-eve-bg border border-eve-border rounded px-3 py-1.5
                           text-sm text-eve-text focus:outline-none focus:border-eve-orange"
              />
            </label>
          </>
        )}
      </div>

      {/* Character skills (collapsible) */}
      {showSkills && (
        <div className="pt-2 border-t border-eve-border/50 space-y-2">
          <div className="text-xs text-eve-muted font-semibold">Character Skills</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <SkillInput
              label="Industry (0–5)"
              value={settings.industry_level}
              field="industry_level"
              onChange={set}
            />
            <SkillInput
              label="Adv. Industry (0–5)"
              value={settings.adv_industry_level}
              field="adv_industry_level"
              onChange={set}
            />
          </div>
          <div className="text-xs text-eve-muted/70">
            Industry: −4% mfg time/level · Advanced Industry: −3% mfg time/level
          </div>
        </div>
      )}

      {/* Structure bonuses (collapsible) */}
      {showStructure && (
        <div className="pt-2 border-t border-eve-border/50 space-y-2">
          <div className="text-xs text-eve-muted font-semibold">Structure Bonuses</div>
          <div className="grid grid-cols-3 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-eve-muted">ME Bonus %</span>
              <input
                type="number" min="0" max="5" step="0.1"
                value={settings.structure_me_bonus}
                onChange={(e) => set("structure_me_bonus", parseFloat(e.target.value) || 0)}
                className="w-full bg-eve-bg border border-eve-border rounded px-3 py-1.5
                           text-sm text-eve-text focus:outline-none focus:border-eve-orange"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-eve-muted">TE Bonus %</span>
              <input
                type="number" min="0" max="30" step="0.1"
                value={settings.structure_te_bonus}
                onChange={(e) => set("structure_te_bonus", parseFloat(e.target.value) || 0)}
                className="w-full bg-eve-bg border border-eve-border rounded px-3 py-1.5
                           text-sm text-eve-text focus:outline-none focus:border-eve-orange"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-eve-muted">Cost Bonus %</span>
              <input
                type="number" min="0" max="25" step="0.1"
                value={settings.structure_cost_bonus}
                onChange={(e) => set("structure_cost_bonus", parseFloat(e.target.value) || 0)}
                className="w-full bg-eve-bg border border-eve-border rounded px-3 py-1.5
                           text-sm text-eve-text focus:outline-none focus:border-eve-orange"
              />
            </label>
          </div>
          <div className="text-xs text-eve-muted/70">
            Raitaru: 1% ME, 15% TE, 3% Cost &nbsp;·&nbsp; Azbel: 2% ME, 20% TE, 4% Cost
          </div>
        </div>
      )}

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

        <button
          onClick={onApply}
          disabled={loading || !settings.solar_system_id}
          className="ml-auto px-6 py-2 bg-eve-orange hover:bg-eve-orange/90
                     disabled:opacity-40 disabled:cursor-not-allowed
                     text-white text-sm font-semibold rounded
                     transition-colors active:scale-95"
        >
          {loading ? "Loading…" : "Calculate Profits"}
        </button>
      </div>
    </div>
  );
}
