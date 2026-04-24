import React, { useEffect, useState, useMemo } from "react";
import Navbar from "../components/Navbar";
import { fetchBlueprints, fetchAppSettings } from "../api/client";
import { StatCard, Spinner } from "./DashboardPage";
import type { BlueprintResult, Character, Settings } from "../types";

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
  industry_level:       0,
  adv_industry_level:   0,
};

interface Props {
  character: Character;
}

export default function CopyingPage({ character }: Props) {
  const [settings, setSettings]     = useState<Settings>(DEFAULT_SETTINGS);
  const [blueprints, setBlueprints] = useState<BlueprintResult[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [hasLoaded, setHasLoaded]   = useState(false);

  const [showMissingOnly, setShowMissingOnly] = useState(false);

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
        };
        setSettings(newSettings);

        // Fetch BPO status
        const results = await fetchBlueprints(newSettings, false, "copy");
        setBlueprints(results);
        setHasLoaded(true);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load blueprints");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  const handleRefresh = async () => {
    setLoading(true);
    try {
      const results = await fetchBlueprints(settings, true, "copy");
      setBlueprints(results);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to refresh");
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    return blueprints.filter(bp => !showMissingOnly || (bp.bpc_count || 0) === 0);
  }, [blueprints, showMissingOnly]);

  const needCopies = blueprints.filter(bp => (bp.bpc_count || 0) === 0).length;

  return (
    <div className="min-h-screen bg-eve-bg font-eve">
      <Navbar character={character} />

      <main className="max-w-screen-2xl mx-auto px-4 py-6 space-y-5">
        <div className="bg-eve-surface/50 border border-eve-blue/30 rounded-lg px-4 py-2 text-xs text-eve-muted">
          <span className="text-eve-blue font-semibold uppercase mr-2">Blueprint Original (BPO) Status</span>
          Identifies BPOs that need copying for manufacturing or invention.
        </div>

        {/* Action Banner */}
        {!loading && hasLoaded && (
          <div className="bg-eve-surface border border-eve-border rounded-lg px-4 py-2 flex items-center justify-between text-xs text-eve-muted">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <span className="text-[9px] uppercase font-bold text-eve-muted/60">Filters:</span>
                <button
                  onClick={() => setShowMissingOnly(!showMissingOnly)}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-colors border
                    ${showMissingOnly 
                      ? "bg-eve-orange/20 border-eve-orange text-eve-orange" 
                      : "bg-eve-bg border-eve-border text-eve-muted"}`}
                >
                  Missing Only
                </button>
              </div>

              <button
                onClick={handleRefresh}
                className="text-eve-orange hover:text-eve-orange/80 font-semibold uppercase tracking-tighter transition-colors"
              >
                Refresh Inventory
              </button>
            </div>
          </div>
        )}

        {hasLoaded && !loading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Total BPOs" value={blueprints.length.toString()} />
            <StatCard label="Needs Copying" value={needCopies.toString()} accent={needCopies > 0} />
          </div>
        )}

        {error && (
          <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-3 text-red-300 text-sm">
            {error}
          </div>
        )}

        {loading && <Spinner label="Checking BPO status across characters..." />}

        {!loading && hasLoaded && (
          <div className="overflow-x-auto rounded-lg border border-eve-border">
            <table className="w-full text-sm">
              <thead className="bg-eve-surface border-b border-eve-border text-left">
                <tr>
                  <th className="px-3 py-2 text-xs font-semibold uppercase tracking-widest text-eve-muted">BPO Name</th>
                  <th className="px-3 py-2 text-xs font-semibold uppercase tracking-widest text-eve-muted">ME/TE</th>
                  <th className="px-3 py-2 text-xs font-semibold uppercase tracking-widest text-eve-muted">Owned BPCs</th>
                  <th className="px-3 py-2 text-xs font-semibold uppercase tracking-widest text-eve-muted">Total BPC Runs</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(bp => (
                  <tr key={`${bp.blueprint_type_id}-${bp.item_id}`} className="border-b border-eve-border/50 hover:bg-eve-surface/40 transition-colors">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                         <img
                          src={`https://images.evetech.net/types/${bp.product_type_id}/icon?size=32`}
                          alt=""
                          className="w-6 h-6 rounded border border-eve-border"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                        <span className="text-eve-text font-medium">{bp.blueprint_name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-eve-muted">{bp.me} / {bp.te}</td>
                    <td className={`px-3 py-2 font-bold ${bp.bpc_count === 0 ? "text-eve-orange" : "text-eve-text"}`}>
                      {bp.bpc_count || 0}
                      {bp.bpc_count === 0 && <span className="ml-2 px-1.5 py-0.5 bg-eve-orange/10 border border-eve-orange/30 rounded text-[10px] uppercase tracking-tighter">Needs Copy</span>}
                    </td>
                    <td className="px-3 py-2 text-eve-text">{bp.bpc_total_runs || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
