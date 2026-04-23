import { useEffect, useState } from "react";
import Navbar from "../components/Navbar";
import {
  fetchWarehouse, syncWarehouse, fetchAssetLocations,
  fetchAppSettings, saveAppSettings,
} from "../api/client";
import type { Character, WarehouseItem, AssetLocation, AppSettings } from "../types";

interface Props {
  character: Character;
}

// Group locations by character
function groupByChar(locs: AssetLocation[]): Map<number, { name: string; locs: AssetLocation[] }> {
  const map = new Map<number, { name: string; locs: AssetLocation[] }>();
  for (const loc of locs) {
    if (!map.has(loc.character_id)) {
      map.set(loc.character_id, { name: loc.character_name, locs: [] });
    }
    map.get(loc.character_id)!.locs.push(loc);
  }
  return map;
}

function SourcePicker({
  onPick,
  onCancel,
  current,
}: {
  onPick: (loc: AssetLocation) => void;
  onCancel: () => void;
  current: { char_id: number | null; loc_id: number | null };
}) {
  const [locations, setLocations] = useState<AssetLocation[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchAssetLocations()
      .then(setLocations)
      .catch((e) => setError(e?.response?.data?.detail ?? "Failed to load locations"))
      .finally(() => setLoading(false));
  }, []);

  const grouped = groupByChar(locations);

  return (
    <div className="bg-eve-surface border border-eve-border rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-eve-text">Select Warehouse Location</h2>
        <button onClick={onCancel} className="text-xs text-eve-muted hover:text-eve-orange transition-colors">
          Cancel
        </button>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-900/20 border border-red-700/30 rounded px-3 py-2">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-6 text-eve-muted text-sm">
          Fetching assets from ESI…
        </div>
      ) : locations.length === 0 ? (
        <div className="text-center py-6 text-eve-muted text-sm">
          No assets found. Sync first in the Warehouse tab.
        </div>
      ) : (
        <div className="space-y-4 max-h-96 overflow-y-auto">
          {[...grouped.entries()].map(([charId, { name, locs }]) => (
            <div key={charId}>
              <div className="flex items-center gap-2 mb-2">
                <img
                  src={`https://images.evetech.net/characters/${charId}/portrait?size=32`}
                  alt={name}
                  className="w-5 h-5 rounded-full border border-eve-border"
                />
                <span className="text-xs font-semibold text-eve-muted uppercase tracking-widest">
                  {name}
                </span>
              </div>
              <div className="space-y-1 pl-2">
                {locs.map((loc) => {
                  const isActive = current.char_id === charId && current.loc_id === loc.loc_id;
                  return (
                    <button
                      key={`${charId}-${loc.loc_id}`}
                      onClick={() => onPick(loc)}
                      className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded
                                  border transition-colors
                                  ${isActive
                                    ? "border-eve-orange bg-eve-orange/10 text-eve-text"
                                    : "border-eve-border/50 hover:border-eve-orange/40 hover:bg-eve-bg text-eve-muted"
                                  }`}
                    >
                      <span className="text-xs">
                        {loc.is_container ? "📦" : "🏭"}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-eve-text truncate">{loc.location_name}</div>
                        {loc.is_container ? (
                          <div className="text-xs text-eve-muted/60">Container</div>
                        ) : null}
                      </div>
                      <div className="text-right shrink-0 text-xs text-eve-muted">
                        <div>{loc.type_count} types</div>
                        <div>{(loc.total_quantity ?? 0).toLocaleString()} units</div>
                      </div>
                      {isActive && (
                        <span className="text-xs text-eve-orange font-semibold">✓ Active</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function WarehousePage({ character }: Props) {
  const [items, setItems]         = useState<WarehouseItem[]>([]);
  const [loading, setLoading]     = useState(true);
  const [syncing, setSyncing]     = useState(false);
  const [syncMsg, setSyncMsg]     = useState<string | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [filter, setFilter]       = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);

  const loadWarehouse = () => {
    setLoading(true);
    setError(null);
    fetchWarehouse()
      .then(setItems)
      .catch((e) => setError(e?.response?.data?.detail ?? "Failed to load warehouse"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchAppSettings()
      .then((s) => setAppSettings(s))
      .catch(() => {});
    loadWarehouse();
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    setError(null);
    try {
      const result = await syncWarehouse();
      setSyncMsg(`Synced ${result.synced} item types.`);
      loadWarehouse();
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handlePickSource = async (loc: AssetLocation) => {
    const label = `${loc.character_name} › ${loc.location_name}`;
    const updated = await saveAppSettings({
      ...(appSettings ?? {}),
      warehouse_character_id:  loc.character_id,
      warehouse_location_id:   loc.loc_id,
      warehouse_location_name: label,
    }).catch(() => null);
    if (updated) {
      setAppSettings(updated);
    }
    setShowPicker(false);
    loadWarehouse();
  };

  const handleClearSource = async () => {
    const updated = await saveAppSettings({
      ...(appSettings ?? {}),
      warehouse_character_id:  null,
      warehouse_location_id:   null,
      warehouse_location_name: null,
    }).catch(() => null);
    if (updated) setAppSettings(updated);
    loadWarehouse();
  };

  const filtered = filter.trim()
    ? items.filter((i) => i.type_name.toLowerCase().includes(filter.toLowerCase()))
    : items;

  const totalTypes = items.length;
  const totalUnits = items.reduce((s, i) => s + i.quantity, 0);

  const sourceName = appSettings?.warehouse_location_name;

  return (
    <div className="min-h-screen bg-eve-bg font-eve">
      <Navbar character={character} />

      <main className="max-w-screen-2xl mx-auto px-4 py-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-lg font-semibold text-eve-text">Warehouse</h1>
            {!loading && (
              <div className="text-xs text-eve-muted mt-0.5">
                {totalTypes} item types · {totalUnits.toLocaleString()} units
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            {syncMsg && <span className="text-xs text-green-400">{syncMsg}</span>}
            <button
              onClick={handleSync}
              disabled={syncing || loading}
              className="px-4 py-1.5 bg-eve-orange hover:bg-eve-orange/90
                         disabled:opacity-40 text-white text-sm font-semibold rounded transition-colors"
            >
              {syncing ? "Syncing…" : "Sync from ESI"}
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-3 text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Warehouse source */}
        {!showPicker ? (
          <div className="bg-eve-surface border border-eve-border rounded-lg p-4 flex items-center gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold uppercase tracking-widest text-eve-muted mb-1">
                Warehouse Source
              </div>
              {sourceName ? (
                <div className="text-sm text-eve-text truncate">{sourceName}</div>
              ) : (
                <div className="text-sm text-eve-muted/60">
                  All characters' hangars (aggregated)
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {sourceName && (
                <button
                  onClick={handleClearSource}
                  className="text-xs text-eve-muted hover:text-red-400 transition-colors px-2 py-1"
                >
                  Clear
                </button>
              )}
              <button
                onClick={() => setShowPicker(true)}
                className="px-3 py-1.5 bg-eve-bg border border-eve-border rounded
                           text-xs text-eve-muted hover:text-eve-orange hover:border-eve-orange/60
                           transition-colors"
              >
                {sourceName ? "Change Source" : "Set Source"}
              </button>
            </div>
          </div>
        ) : (
          <SourcePicker
            current={{
              char_id: appSettings?.warehouse_character_id ?? null,
              loc_id:  appSettings?.warehouse_location_id ?? null,
            }}
            onPick={handlePickSource}
            onCancel={() => setShowPicker(false)}
          />
        )}

        {/* Filter */}
        {items.length > 0 && !showPicker && (
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter items…"
            className="w-full max-w-xs bg-eve-surface border border-eve-border rounded px-3 py-1.5
                       text-sm text-eve-text focus:outline-none focus:border-eve-orange"
          />
        )}

        {/* Items table */}
        {!showPicker && (
          loading ? (
            <div className="text-center py-10 text-eve-muted text-sm">Loading…</div>
          ) : items.length === 0 ? (
            <div className="text-center py-16 text-eve-muted text-sm">
              <div className="text-4xl mb-3">📦</div>
              <div>No items found.</div>
              <div className="mt-1 text-eve-muted/60">
                Click <strong className="text-eve-text">Sync from ESI</strong> or set a warehouse source.
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-eve-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-eve-border bg-eve-surface">
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-widest text-eve-muted">Item</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-widest text-eve-muted w-36">Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item, i) => (
                    <tr key={`${item.type_id}-${i}`} className="border-b border-eve-border/50 hover:bg-eve-surface/50">
                      <td className="px-3 py-2 flex items-center gap-2">
                        <img
                          src={`https://images.evetech.net/types/${item.type_id}/icon?size=32`}
                          alt=""
                          className="w-6 h-6 rounded border border-eve-border"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                        <span className="text-eve-text">{item.type_name}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-eve-text">
                        {item.quantity.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </main>
    </div>
  );
}
