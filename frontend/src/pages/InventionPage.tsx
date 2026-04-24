import React, { useEffect, useState, useMemo } from "react";
import Navbar from "../components/Navbar";
import BlueprintTable from "../components/BlueprintTable";
import CharacterSkillBadges from "../components/CharacterSkillBadges";
import { fetchBlueprints, fetchAppSettings, fetchDecryptors } from "../api/client";
import type { Decryptor } from "../api/client";
import { StatCard, Spinner, fmtISK } from "./DashboardPage";
import { useRefresh } from "../context/RefreshContext";
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
  reaction_facility_tax: 0,
  reaction_me_bonus:     0,
  reaction_te_bonus:     0,
  reaction_cost_bonus:   0,
};

interface Props {
  character: Character;
}

export default function InventionPage({ character }: Props) {
  const [settings, setSettings]     = useState<Settings>(DEFAULT_SETTINGS);
  const [blueprints, setBlueprints] = useState<BlueprintResult[]>([]);
  const [decryptors, setDecryptors] = useState<Decryptor[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [hasLoaded, setHasLoaded]   = useState(false);
  const { pricesKey } = useRefresh();

  // Decryptor strategy
  const [strategy, setStrategy] = useState<string>("none"); // "none", "optimized", "specific"
  const [selectedDecryptorId, setSelectedDecryptorId] = useState<number | null>(null);

  // Quick filters
  const [showProfitable, setShowProfitable]     = useState(true);
  const [showUnprofitable, setShowUnprofitable] = useState(true);
  const [showGroups, setShowGroups]             = useState(true);

  // Fetch global settings and auto-calculate
  useEffect(() => {
    async function init() {
      try {
        const [appSettings, decList] = await Promise.all([
          fetchAppSettings(),
          fetchDecryptors(),
        ]);
        setDecryptors(decList);

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
        };
        setSettings(newSettings);

        if (newSettings.solar_system_id && newSettings.solar_system_id > 0) {
          // Always fetch all blueprints (including losses) for frontend filtering
          const results = await fetchBlueprints(
            { ...newSettings, min_profit: -1e15 }, 
            false, 
            "invent",
            strategy,
            selectedDecryptorId
          );
          setBlueprints(results);
          setHasLoaded(true);
        } else {
          setError("No manufacturing system configured. Please go to Settings and select a Default System.");
        }
      } catch (e: unknown) {
        console.error("Init failed:", e);
        setError(e instanceof Error ? e.message : "Failed to load blueprints");
      } finally {
        setLoading(false);
      }
    }
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategy, selectedDecryptorId, pricesKey]);

  const profitable = blueprints.filter((b) => b.profit > 0).length;

  const filtered = useMemo(() => {
    return blueprints.filter((bp) => {
      if (bp.profit > 0 && !showProfitable) return false;
      if (bp.profit <= 0 && !showUnprofitable) return false;
      return true;
    });
  }, [blueprints, showProfitable, showUnprofitable]);

  return (
    <div className="min-h-screen bg-eve-bg font-eve">
      <Navbar character={character} />

      <main className="max-w-screen-2xl mx-auto px-4 py-6 space-y-5">
        <div className="bg-eve-surface/50 border border-eve-blue/30 rounded-lg px-4 py-2 text-xs text-eve-muted">
          <span className="text-eve-blue font-semibold uppercase mr-2">Invention opportunities</span>
          This view shows the potential manufacturing profit of T2 items you could invent from your currently owned blueprints. 
          Assumes standard invention results (2% ME, 4% TE).
        </div>

        {/* Settings Summary Banner */}
        {!loading && hasLoaded && (
          <div className="bg-eve-surface border border-eve-border rounded-lg px-4 py-2 flex items-center justify-between text-xs text-eve-muted">
            <div className="flex items-center gap-6">
              <div className="flex gap-4 border-r border-eve-border pr-6">
                <span>Runs: <span className="text-eve-text">{settings.runs}</span></span>
                <span>Market Hub ID: <span className="text-eve-text">{settings.price_region_id}</span></span>
                <span>Min Profit: <span className="text-eve-text">{fmtISK(settings.min_profit)}</span></span>
              </div>
              
              <div className="flex items-center gap-6 border-r border-eve-border pr-6">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] uppercase font-bold text-eve-muted/60">Result:</span>
                  <div className="flex gap-1">
                    <FilterToggle label="Profits" active={showProfitable} onClick={() => setShowProfitable(!showProfitable)} />
                    <FilterToggle label="Losses" active={showUnprofitable} onClick={() => setShowUnprofitable(!showUnprofitable)} />
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <span className="text-[9px] uppercase font-bold text-eve-muted/60">View:</span>
                  <FilterToggle label="Grouped" active={showGroups} onClick={() => setShowGroups(!showGroups)} />
                </div>

                <div className="flex items-center gap-2 border-l border-eve-border pl-6 ml-2">
                  <span className="text-[9px] uppercase font-bold text-eve-muted/60">Decryptor:</span>
                  <div className="flex gap-2">
                    <select
                      value={strategy}
                      onChange={(e) => setStrategy(e.target.value)}
                      className="bg-eve-bg border border-eve-border rounded px-2 py-0.5 text-[10px] text-eve-text focus:outline-none focus:border-eve-orange"
                    >
                      <option value="none">None</option>
                      <option value="optimized">Optimized (Max Profit)</option>
                      <option value="specific">Specific Decryptor</option>
                    </select>

                    {strategy === "specific" && (
                      <select
                        value={selectedDecryptorId ?? ""}
                        onChange={(e) => setSelectedDecryptorId(parseInt(e.target.value) || null)}
                        className="bg-eve-bg border border-eve-border rounded px-2 py-0.5 text-[10px] text-eve-text focus:outline-none focus:border-eve-orange"
                      >
                        <option value="">Select...</option>
                        {decryptors.filter(d => d.type_id).map(d => (
                          <option key={d.type_id} value={d.type_id!}>{d.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              </div>

            </div>
            <CharacterSkillBadges activity="invent" />
          </div>
        )}

        {hasLoaded && !loading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="T2 variants found" value={blueprints.length.toString()} />
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

        {loading && <Spinner label="Calculating invention opportunities..." />}

        {!loading && hasLoaded && <BlueprintTable blueprints={filtered} showGroups={showGroups} activity="invent" />}

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

function FilterToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-colors border
        ${active 
          ? "bg-eve-orange/20 border-eve-orange text-eve-orange" 
          : "bg-eve-bg border-eve-border text-eve-muted hover:border-eve-muted"}`}
    >
      {label}
    </button>
  );
}
