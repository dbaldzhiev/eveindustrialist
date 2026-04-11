import { useState } from "react";
import Navbar from "../components/Navbar";
import SettingsPanel from "../components/SettingsPanel";
import BlueprintTable from "../components/BlueprintTable";
import { fetchBlueprints } from "../api/client";
import type { BlueprintResult, Character, Settings, SolarSystem } from "../types";

export const DEFAULT_SETTINGS: Settings = {
  solar_system_id:      null,
  runs:                 1,
  broker_fee:           0.0368,
  sales_tax:            0.0360,
  facility_tax:         0.0,
  min_profit:           0,
  price_region_id:      10000002,
  material_order_type:  "sell",
  product_order_type:   "sell",
  structure_me_bonus:   0,
  structure_te_bonus:   0,
  structure_cost_bonus: 0,
  assumed_me:           10,
  assumed_te:           20,
};

interface Props {
  character: Character;
}

export default function DashboardPage({ character }: Props) {
  const [settings, setSettings]     = useState<Settings>(DEFAULT_SETTINGS);
  const [system, setSystem]         = useState<SolarSystem | null>(null);
  const [blueprints, setBlueprints] = useState<BlueprintResult[]>([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [hasLoaded, setHasLoaded]   = useState(false);

  const handleSystemChange = (sys: SolarSystem) => {
    setSystem(sys);
    setSettings((prev) => ({ ...prev, solar_system_id: sys.solar_system_id }));
  };

  const handleApply = async () => {
    if (!settings.solar_system_id) return;
    setLoading(true);
    setError(null);
    try {
      const results = await fetchBlueprints(settings);
      setBlueprints(results);
      setHasLoaded(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load blueprints");
    } finally {
      setLoading(false);
    }
  };

  const profitable = blueprints.filter((b) => b.profit > 0).length;

  return (
    <div className="min-h-screen bg-eve-bg font-eve">
      <Navbar character={character} />

      <main className="max-w-screen-2xl mx-auto px-4 py-6 space-y-5">
        <SettingsPanel
          settings={settings}
          system={system}
          onSystemChange={handleSystemChange}
          onChange={setSettings}
          onApply={handleApply}
          loading={loading}
        />

        {hasLoaded && !loading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Blueprints found" value={blueprints.length.toString()} />
            <StatCard label="Profitable"        value={profitable.toString()} accent />
            <StatCard
              label="Best profit"
              value={blueprints.length > 0 ? fmtISK(Math.max(...blueprints.map((b) => b.profit))) : "–"}
              accent
            />
            <StatCard
              label="Best margin"
              value={blueprints.length > 0 ? Math.max(...blueprints.map((b) => b.margin_pct)).toFixed(1) + "%" : "–"}
            />
          </div>
        )}

        {error && (
          <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-3 text-red-300 text-sm">
            {error}
          </div>
        )}

        {loading && <Spinner label="Fetching blueprints and market prices…" />}

        {!loading && hasLoaded && <BlueprintTable blueprints={blueprints} />}

        {!loading && !hasLoaded && (
          <div className="text-center py-20 text-eve-muted text-sm">
            <div className="text-4xl mb-4">🏭</div>
            Select a manufacturing system and click{" "}
            <span className="text-eve-orange">Calculate Profits</span> to analyze your blueprints.
          </div>
        )}
      </main>
    </div>
  );
}

export function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-eve-surface border border-eve-border rounded-lg px-4 py-3">
      <div className="text-xs text-eve-muted mb-1">{label}</div>
      <div className={`text-lg font-semibold ${accent ? "text-eve-orange" : "text-eve-text"}`}>{value}</div>
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center py-16 gap-3 text-eve-muted">
      <svg className="animate-spin w-5 h-5 text-eve-orange" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
      </svg>
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function fmtISK(v: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v) + " ISK";
}
