import { useEffect, useState } from "react";
import Navbar from "../components/Navbar";
import SystemPicker from "../components/SystemPicker";
import { fetchAppSettings, saveAppSettings, fetchMarketHubs } from "../api/client";
import type { Character, AppSettings, MarketHub, SolarSystem } from "../types";

interface Props {
  character: Character;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-eve-muted">{label}</span>
      {children}
    </label>
  );
}

function PctField({
  label, value, onChange, max = 100, step = "0.01",
}: { label: string; value: number; onChange: (v: number) => void; max?: number; step?: string }) {
  return (
    <Field label={label}>
      <div className="relative">
        <input
          type="number" min="0" max={max} step={step}
          value={(value * 100).toFixed(2)}
          onChange={(e) => onChange(parseFloat(e.target.value) / 100 || 0)}
          className="w-full bg-eve-bg border border-eve-border rounded px-3 py-1.5
                     pr-8 text-sm text-eve-text focus:outline-none focus:border-eve-orange"
        />
        <span className="absolute right-2.5 top-1.5 text-eve-muted text-sm">%</span>
      </div>
    </Field>
  );
}

function NumField({
  label, value, onChange, min = 0, max,
}: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <Field label={label}>
      <input
        type="number" min={min} max={max}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value) || 0)}
        className="w-full bg-eve-bg border border-eve-border rounded px-3 py-1.5
                   text-sm text-eve-text focus:outline-none focus:border-eve-orange"
      />
    </Field>
  );
}

const DEFAULTS: AppSettings = {
  default_system_id:       null,
  default_price_region:    10000002,
  broker_fee:              0.0368,
  sales_tax:               0.036,
  facility_tax:            0.0,
  structure_me_bonus:      0.0,
  structure_te_bonus:      0.0,
  structure_cost_bonus:    0.0,
  industry_level:          0,
  adv_industry_level:      0,
  warehouse_character_id:  null,
  warehouse_location_id:   null,
  warehouse_location_name: null,
};

export default function SettingsPage({ character }: Props) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULTS);
  const [system, setSystem]     = useState<SolarSystem | null>(null);
  const [hubs, setHubs]         = useState<MarketHub[]>([]);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    Promise.all([fetchAppSettings(), fetchMarketHubs()])
      .then(([s, h]) => {
        setSettings({ ...DEFAULTS, ...s });
        setHubs(h);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    setSettings((prev) => ({ ...prev, [key]: value }));

  const handleSystemChange = (sys: SolarSystem) => {
    setSystem(sys);
    set("default_system_id", sys.solar_system_id);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const saved = await saveAppSettings(settings);
      setSettings({ ...DEFAULTS, ...saved });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-eve-bg font-eve">
      <Navbar character={character} />

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        <h1 className="text-lg font-semibold text-eve-text">Global Settings</h1>

        {loading ? (
          <div className="text-center py-10 text-eve-muted text-sm">Loading…</div>
        ) : (
          <>
            {/* Manufacturing Facility */}
            <section className="bg-eve-surface border border-eve-border rounded-lg p-4 space-y-4">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-eve-muted">
                Manufacturing Facility
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 flex flex-col gap-1">
                  <span className="text-xs text-eve-muted">Default Manufacturing System</span>
                  <SystemPicker value={system} onChange={handleSystemChange} />
                  {settings.default_system_id && !system && (
                    <span className="text-xs text-eve-muted/60">
                      Saved system ID: {settings.default_system_id} (search to change)
                    </span>
                  )}
                </div>
                <PctField label="Structure ME Bonus %" value={settings.structure_me_bonus}
                  onChange={(v) => set("structure_me_bonus", v)} max={5} step="0.1" />
                <PctField label="Structure TE Bonus %" value={settings.structure_te_bonus}
                  onChange={(v) => set("structure_te_bonus", v)} max={30} step="0.1" />
                <PctField label="Structure Cost Bonus %" value={settings.structure_cost_bonus}
                  onChange={(v) => set("structure_cost_bonus", v)} max={25} step="0.1" />
                <PctField label="Facility Tax %" value={settings.facility_tax}
                  onChange={(v) => set("facility_tax", v)} max={25} step="0.1" />
              </div>
              <div className="text-xs text-eve-muted/60">
                Raitaru: 1% ME, 15% TE, 3% Cost · Azbel: 2% ME, 20% TE, 4% Cost · Sotiyo: 2.4% ME, 20% TE, 5% Cost
              </div>
            </section>

            {/* Market */}
            <section className="bg-eve-surface border border-eve-border rounded-lg p-4 space-y-4">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-eve-muted">
                Market
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Market Hub">
                  <select
                    value={settings.default_price_region}
                    onChange={(e) => set("default_price_region", parseInt(e.target.value))}
                    className="w-full bg-eve-bg border border-eve-border rounded px-3 py-1.5
                               text-sm text-eve-text focus:outline-none focus:border-eve-orange"
                  >
                    {hubs.map((h) => (
                      <option key={h.region_id} value={h.region_id}>{h.name}</option>
                    ))}
                  </select>
                </Field>
                <PctField label="Broker Fee %" value={settings.broker_fee}
                  onChange={(v) => set("broker_fee", v)} max={10} />
                <PctField label="Sales Tax %" value={settings.sales_tax}
                  onChange={(v) => set("sales_tax", v)} max={10} />
              </div>
            </section>

            {/* Character Skills */}
            <section className="bg-eve-surface border border-eve-border rounded-lg p-4 space-y-4">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-eve-muted">
                Character Skills
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <NumField label="Industry level (0–5)" value={settings.industry_level}
                  onChange={(v) => set("industry_level", Math.min(5, Math.max(0, v)))} min={0} max={5} />
                <NumField label="Advanced Industry level (0–5)" value={settings.adv_industry_level}
                  onChange={(v) => set("adv_industry_level", Math.min(5, Math.max(0, v)))} min={0} max={5} />
              </div>
              <div className="text-xs text-eve-muted/60">
                Industry: −4% manufacturing time per level · Advanced Industry: −3% per level
              </div>
            </section>

            {/* Warehouse source (read-only here, configure in Warehouse tab) */}
            {settings.warehouse_location_name && (
              <section className="bg-eve-surface border border-eve-border rounded-lg p-4">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-eve-muted mb-2">
                  Warehouse Source
                </h2>
                <div className="text-sm text-eve-text">
                  {settings.warehouse_location_name}
                </div>
                <div className="text-xs text-eve-muted/60 mt-1">
                  Configure in the Warehouse tab.
                </div>
              </section>
            )}

            {/* Save */}
            <div className="flex items-center gap-3 justify-end">
              {saved && (
                <span className="text-xs text-green-400">Settings saved.</span>
              )}
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-6 py-2 bg-eve-orange hover:bg-eve-orange/90
                           disabled:opacity-40 text-white text-sm font-semibold rounded
                           transition-colors active:scale-95"
              >
                {saving ? "Saving…" : "Save Settings"}
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
