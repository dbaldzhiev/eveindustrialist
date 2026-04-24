import { useEffect, useState } from "react";
import Navbar from "../components/Navbar";
import SettingsPanel from "../components/SettingsPanel";
import BlueprintTable from "../components/BlueprintTable";
import { fetchExplore, fetchAppSettings } from "../api/client";
import { DEFAULT_SETTINGS, StatCard, Spinner, fmtISK } from "./DashboardPage";
import { useRefresh } from "../context/RefreshContext";
import type { BlueprintResult, Character, Settings, SolarSystem } from "../types";

interface Props {
  character: Character;
}

export default function ExplorerPage({ character }: Props) {
  const [settings, setSettings]     = useState<Settings>(DEFAULT_SETTINGS);
  const [blueprints, setBlueprints] = useState<BlueprintResult[]>([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [hasLoaded, setHasLoaded]   = useState(false);
  const { pricesKey } = useRefresh();

  // Fetch global settings on mount
  useEffect(() => {
    fetchAppSettings()
      .then((appSettings) => {
        setSettings((prev) => ({
          ...prev,
          solar_system_id:      appSettings.default_system_id,
          price_region_id:      appSettings.default_price_region,
          broker_fee:           appSettings.broker_fee,
          sales_tax:            appSettings.sales_tax,
          facility_tax:         appSettings.facility_tax,
          structure_me_bonus:   appSettings.structure_me_bonus,
          structure_te_bonus:   appSettings.structure_te_bonus,
          structure_cost_bonus: appSettings.structure_cost_bonus,
          runs:                 appSettings.runs,
          min_profit:           appSettings.min_profit,
          material_order_type:  appSettings.material_order_type,
          product_order_type:   appSettings.product_order_type,
        }));
      })
      .catch((err) => console.error("Failed to fetch app settings:", err));
  }, []);

  const handleApply = async (forceRefresh = false) => {
    if (!settings.solar_system_id) {
      setError("No manufacturing system configured. Please set one in Settings.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const results = await fetchExplore(settings, forceRefresh);
      setBlueprints(results);
      setHasLoaded(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load blueprints");
    } finally {
      setLoading(false);
    }
  };

  // Re-run with fresh prices when globally refreshed (only if results already showing)
  useEffect(() => {
    if (!hasLoaded || pricesKey === 0) return;
    handleApply(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricesKey]);

  const profitable = blueprints.filter((b) => b.profit > 0).length;

  return (
    <div className="min-h-screen bg-eve-bg font-eve">
      <Navbar character={character} />

      <main className="max-w-screen-2xl mx-auto px-4 py-6 space-y-5">
        <div className="bg-eve-surface/50 border border-eve-blue/30 rounded-lg px-4 py-2 text-xs text-eve-muted">
          <span className="text-eve-blue font-semibold">Explorer mode</span> — scans all
          published blueprints in the SDE. Assumes the ME and TE you set below.
          First load may take up to a minute while market data is fetched and cached.
        </div>

        <SettingsPanel
          settings={settings}
          onChange={setSettings}
          onApply={handleApply}
          loading={loading}
          explorerMode
        />

        {hasLoaded && !loading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="BPs scanned"  value={blueprints.length.toString()} />
            <StatCard label="Profitable"    value={profitable.toString()} accent />
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

        {loading && <Spinner label="Scanning all blueprints and fetching market prices — this may take a minute on first load…" />}

        {!loading && hasLoaded && <BlueprintTable blueprints={blueprints} />}

        {!loading && !hasLoaded && (
          <div className="text-center py-20 text-eve-muted text-sm">
            <div className="text-4xl mb-4">🔭</div>
            Select a system and click{" "}
            <span className="text-eve-orange">Calculate Profits</span> to scan all
            EVE blueprints for profitable manufacturing opportunities.
          </div>
        )}
      </main>
    </div>
  );
}
