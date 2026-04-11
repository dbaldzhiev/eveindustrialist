import { useEffect, useState } from "react";
import Navbar from "../components/Navbar";
import { fetchWarehouse, syncWarehouse } from "../api/client";
import type { Character, WarehouseItem } from "../types";

interface Props {
  character: Character;
}

export default function WarehousePage({ character }: Props) {
  const [items, setItems]       = useState<WarehouseItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [syncing, setSyncing]   = useState(false);
  const [syncMsg, setSyncMsg]   = useState<string | null>(null);
  const [filter, setFilter]     = useState("");

  const load = () => {
    setLoading(true);
    fetchWarehouse()
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleSync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const result = await syncWarehouse();
      setSyncMsg(`Synced ${result.synced} item types from ESI assets.`);
      load();
    } catch (e: any) {
      setSyncMsg(e?.response?.data?.detail ?? "Sync failed.");
    } finally {
      setSyncing(false);
    }
  };

  const filtered = filter
    ? items.filter((i) => i.type_name.toLowerCase().includes(filter.toLowerCase()))
    : items;

  const totalTypes = items.length;
  const totalUnits = items.reduce((s, i) => s + i.quantity, 0);

  // Group by location if available
  const locations = [...new Set(items.map((i) => i.location ?? "Unknown").filter(Boolean))];

  return (
    <div className="min-h-screen bg-eve-bg font-eve">
      <Navbar character={character} />

      <main className="max-w-screen-2xl mx-auto px-4 py-6 space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-lg font-semibold text-eve-text">Warehouse</h1>
          <span className="text-xs text-eve-muted">
            {totalTypes} item types · {totalUnits.toLocaleString()} total units
          </span>
        </div>

        {/* Sync from ESI */}
        <div className="bg-eve-surface border border-eve-border rounded-lg p-4 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-eve-muted mb-1">
                Sync from EVE Assets
              </h2>
              <p className="text-xs text-eve-muted/70">
                Pulls hangar contents from all linked characters via ESI. Cached for 15 minutes.
              </p>
            </div>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="shrink-0 px-5 py-1.5 bg-eve-orange hover:bg-eve-orange/90
                         disabled:opacity-40 disabled:cursor-not-allowed
                         text-white text-sm font-semibold rounded transition-colors"
            >
              {syncing ? "Syncing…" : "Sync Now"}
            </button>
          </div>

          {syncMsg && (
            <div className="text-xs text-eve-muted bg-eve-bg border border-eve-border/50 rounded px-3 py-2">
              {syncMsg}
            </div>
          )}
        </div>

        {/* Filter */}
        {items.length > 0 && (
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
        {loading ? (
          <div className="text-center py-10 text-eve-muted text-sm">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-center py-16 text-eve-muted text-sm">
            <div className="text-4xl mb-3">📦</div>
            <div>No items found.</div>
            <div className="mt-1 text-eve-muted/60">
              Click <strong className="text-eve-text">Sync Now</strong> to pull assets from your EVE characters.
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-eve-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-eve-border bg-eve-surface">
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-widest text-eve-muted">Item</th>
                  {locations.length > 1 && (
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-widest text-eve-muted">Location</th>
                  )}
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
                    {locations.length > 1 && (
                      <td className="px-3 py-2 text-eve-muted text-xs">{item.location ?? "—"}</td>
                    )}
                    <td className="px-3 py-2 text-right font-mono text-eve-text">
                      {item.quantity.toLocaleString()}
                    </td>
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
