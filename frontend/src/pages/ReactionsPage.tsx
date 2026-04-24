import { useEffect, useState, useMemo } from "react";
import Navbar from "../components/Navbar";
import BlueprintTable from "../components/BlueprintTable";
import CharacterSkillBadges from "../components/CharacterSkillBadges";
import { fetchReactions, fetchAppSettings } from "../api/client";
import { DEFAULT_SETTINGS, StatCard, Spinner, fmtISK } from "./DashboardPage";
import { useRefresh } from "../context/RefreshContext";
import type { BlueprintResult, Character, Settings } from "../types";

interface Props {
  character: Character;
}

function FilterToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-colors border
        ${active 
          ? "bg-purple-500/20 border-purple-500 text-purple-400" 
          : "bg-eve-bg border-eve-border text-eve-muted hover:border-eve-muted"}`}
    >
      {label}
    </button>
  );
}

export default function ReactionsPage({ character }: Props) {
  const [settings, setSettings]     = useState<Settings>(DEFAULT_SETTINGS);
  const [reactions, setReactions]   = useState<BlueprintResult[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [hasLoaded, setHasLoaded]   = useState(false);
  const { pricesKey } = useRefresh();

  // Quick filters
  const [showProfitable, setShowProfitable]     = useState(true);
  const [showUnprofitable, setShowUnprofitable] = useState(true);

  // Fetch global settings and auto-calculate
  useEffect(() => {
    async function init() {
      try {
        const appSettings = await fetchAppSettings();
        if (!appSettings) {
          setError("Failed to load application settings.");
          setLoading(false);
          return;
        }

        const newSettings: Settings = {
          ...DEFAULT_SETTINGS,
          solar_system_id:      appSettings.default_system_id ?? null,
          price_region_id:      appSettings.default_price_region ?? 10000002,
          broker_fee:           appSettings.broker_fee ?? 0.0368,
          sales_tax:            appSettings.sales_tax ?? 0.0360,
          facility_tax:         appSettings.facility_tax ?? 0.0,
          structure_me_bonus:   appSettings.structure_me_bonus ?? 0,
          structure_te_bonus:   appSettings.structure_te_bonus ?? 0,
          structure_cost_bonus: appSettings.structure_cost_bonus ?? 0,
          runs:                 appSettings.runs ?? 1,
          min_profit:           appSettings.min_profit ?? 0,
          material_order_type:  appSettings.material_order_type ?? "sell",
          product_order_type:   appSettings.product_order_type ?? "sell",
          reaction_facility_tax: appSettings.reaction_facility_tax ?? 0,
          reaction_me_bonus:     appSettings.reaction_me_bonus ?? 0,
          reaction_te_bonus:     appSettings.reaction_te_bonus ?? 0,
          reaction_cost_bonus:   appSettings.reaction_cost_bonus ?? 0,
        };
        setSettings(newSettings);

        if (newSettings.solar_system_id && newSettings.solar_system_id > 0) {
          const results = await fetchReactions({ ...newSettings, min_profit: -1e15 }, false);
          setReactions(results);
          setHasLoaded(true);
        } else {
          setError("No system configured. Please go to Settings.");
        }
      } catch (e: unknown) {
        console.error("Init failed:", e);
        setError(e instanceof Error ? e.message : "Failed to load reactions");
      } finally {
        setLoading(false);
      }
    }
    setLoading(true);
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricesKey]);

  const handleRunsChange = (val: number) => {
    const s = { ...settings, runs: val };
    setSettings(s);
    setLoading(true);
    fetchReactions({ ...s, min_profit: -1e15 }, false)
      .then(setReactions)
      .finally(() => setLoading(false));
  };

  const profitable = reactions.filter((b) => b.profit > 0).length;

  const filtered = useMemo(() => {
    return reactions.filter((bp) => {
      if (bp.profit > 0 && !showProfitable) return false;
      if (bp.profit <= 0 && !showUnprofitable) return false;
      return true;
    });
  }, [reactions, showProfitable, showUnprofitable]);

  return (
    <div className="min-h-screen bg-eve-bg font-eve">
      <Navbar character={character} />

      <main className="max-w-screen-2xl mx-auto px-4 py-6 space-y-5">
        {!loading && hasLoaded && (
          <div className="bg-eve-surface border border-eve-border rounded-lg px-4 py-2 flex items-center justify-between text-xs text-eve-muted">
            <div className="flex items-center gap-6">
              <div className="flex gap-4 border-r border-eve-border pr-6 items-center">
                <span>Runs: <span className="text-eve-text font-bold">{settings.runs}</span></span>
                <input
                    type="range" min="1" max="1000" step="1"
                    value={settings.runs}
                    onChange={(e) => handleRunsChange(parseInt(e.target.value))}
                    className="w-32 accent-purple-500"
                />
                <span>Tax: <span className="text-eve-text">{(settings.reaction_facility_tax * 100).toFixed(1)}%</span></span>
              </div>
              
              <div className="flex items-center gap-2 border-r border-eve-border pr-6">
                <span className="text-[9px] uppercase font-bold text-eve-muted/60">Result:</span>
                <div className="flex gap-1">
                  <FilterToggle label="Profits" active={showProfitable} onClick={() => setShowProfitable(!showProfitable)} />
                  <FilterToggle label="Losses" active={showUnprofitable} onClick={() => setShowUnprofitable(!showUnprofitable)} />
                </div>
              </div>

            </div>
            <CharacterSkillBadges activity="react" />
          </div>
        )}

        {hasLoaded && !loading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Formulas found" value={reactions.length.toString()} />
            <StatCard label="Profitable"    value={profitable.toString()} accent />
            <StatCard
              label="Best profit"
              value={reactions.length > 0 ? fmtISK(Math.max(...reactions.map((b) => b.profit))) : "–"}
              accent
            />
            <StatCard
              label="Best margin"
              value={reactions.length > 0 ? Math.max(...reactions.map((b) => b.margin_pct)).toFixed(1) + "%" : "–"}
            />
          </div>
        )}

        {error && (
          <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-3 text-red-300 text-sm">
            {error}
          </div>
        )}

        {loading && <Spinner label="Fetching owned reaction formulas and calculating profits…" />}

        {!loading && hasLoaded && <BlueprintTable blueprints={filtered} />}

        {!loading && !hasLoaded && !error && (
          <div className="text-center py-20 text-eve-muted text-sm">
            <div className="text-4xl mb-4">🧪</div>
            Initializing...
          </div>
        )}
      </main>
    </div>
  );
}
