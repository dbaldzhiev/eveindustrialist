import React, { useEffect, useState, useMemo } from "react";
import Navbar from "../components/Navbar";
import BlueprintTable from "../components/BlueprintTable";
import { fetchBlueprints, fetchAppSettings } from "../api/client";
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
  reaction_facility_tax: 0,
  reaction_me_bonus:     0,
  reaction_te_bonus:     0,
  reaction_cost_bonus:   0,
};

interface Props {
  character: Character;
}

export default function DashboardPage({ character }: Props) {
  const [settings, setSettings]     = useState<Settings>(DEFAULT_SETTINGS);
  const [blueprints, setBlueprints] = useState<BlueprintResult[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [hasLoaded, setHasLoaded]   = useState(false);

  // Quick filters
  const [showBpo, setShowBpo]                   = useState(true);
  const [showBpc, setShowBpc]                   = useState(true);
  const [showProfitable, setShowProfitable]     = useState(true);
  const [showUnprofitable, setShowUnprofitable] = useState(true);
  const [showGroups, setShowGroups]             = useState(true);

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
          industry_level:       appSettings.industry_level ?? 0,
          adv_industry_level:   appSettings.adv_industry_level ?? 0,
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
          // Always fetch all blueprints (including losses) for frontend filtering
          const results = await fetchBlueprints({ ...newSettings, min_profit: -1e15 }, false, "build");
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
  }, []);

  const handleRefresh = async () => {
    setLoading(true);
    try {
      const results = await fetchBlueprints({ ...settings, min_profit: -1e15 }, true, "build");
      setBlueprints(results);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to refresh prices");
    } finally {
      setLoading(false);
    }
  };

  const profitable = blueprints.filter((b) => b.profit > 0).length;

  const filtered = useMemo(() => {
    return blueprints.filter((bp) => {
      // BPO/BPC filter
      if (bp.is_bpo && !showBpo) return false;
      if (!bp.is_bpo && !showBpc) return false;
      // Profitability filter
      if (bp.profit > 0 && !showProfitable) return false;
      if (bp.profit <= 0 && !showUnprofitable) return false;
      return true;
    });
  }, [blueprints, showBpo, showBpc, showProfitable, showUnprofitable]);

  return (
    <div className="min-h-screen bg-eve-bg font-eve">
      <Navbar character={character} />

      <main className="max-w-screen-2xl mx-auto px-4 py-6 space-y-5">
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
                  <span className="text-[9px] uppercase font-bold text-eve-muted/60">Type:</span>
                  <div className="flex gap-1">
                    <FilterToggle label="BPO" active={showBpo} onClick={() => setShowBpo(!showBpo)} />
                    <FilterToggle label="BPC" active={showBpc} onClick={() => setShowBpc(!showBpc)} />
                  </div>
                </div>

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
              </div>

              <button
                onClick={handleRefresh}
                className="text-eve-orange hover:text-eve-orange/80 font-semibold uppercase tracking-tighter transition-colors"
              >
                Refresh Prices
              </button>
            </div>
            <div className="text-[10px] uppercase tracking-wider hidden xl:block">
              Calculated using global facility settings
            </div>
          </div>
        )}

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

        {loading && <Spinner label="Fetching blueprints and calculating profits using global settings…" />}

        {!loading && hasLoaded && <BlueprintTable blueprints={filtered} showGroups={showGroups} />}

        {!loading && !hasLoaded && !error && (
          <div className="text-center py-20 text-eve-muted text-sm">
            <div className="text-4xl mb-4">🏭</div>
            Initializing...
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
