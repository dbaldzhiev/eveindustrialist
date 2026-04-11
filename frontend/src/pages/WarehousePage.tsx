import { useEffect, useState, useRef } from "react";
import Navbar from "../components/Navbar";
import {
  fetchWarehouse, setWarehouseItem, deleteWarehouseItem, searchTypes,
} from "../api/client";
import type { Character, WarehouseItem, TypeResult } from "../types";

interface Props {
  character: Character;
}

export default function WarehousePage({ character }: Props) {
  const [items, setItems]               = useState<WarehouseItem[]>([]);
  const [loading, setLoading]           = useState(true);

  // Add item state
  const [typeQuery, setTypeQuery]       = useState("");
  const [suggestions, setSuggestions]   = useState<TypeResult[]>([]);
  const [selectedType, setSelectedType] = useState<TypeResult | null>(null);
  const [qty, setQty]                   = useState(0);
  const [adding, setAdding]             = useState(false);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchWarehouse().then(setItems).finally(() => setLoading(false));
  }, []);

  const onTypeInput = (v: string) => {
    setTypeQuery(v);
    setSelectedType(null);
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    if (v.length < 2) { setSuggestions([]); return; }
    suggestTimer.current = setTimeout(async () => {
      const res = await searchTypes(v).catch(() => []);
      setSuggestions(res);
    }, 250);
  };

  const pickType = (t: TypeResult) => {
    setSelectedType(t);
    setTypeQuery(t.type_name);
    setSuggestions([]);
  };

  const handleAdd = async () => {
    if (!selectedType || qty <= 0) return;
    setAdding(true);
    try {
      await setWarehouseItem({ type_id: selectedType.type_id, type_name: selectedType.type_name, quantity: qty });
      const updated = await fetchWarehouse();
      setItems(updated);
      setTypeQuery("");
      setSelectedType(null);
      setQty(0);
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (typeId: number) => {
    await deleteWarehouseItem(typeId);
    setItems((prev) => prev.filter((i) => i.type_id !== typeId));
  };

  const handleQtyChange = async (item: WarehouseItem, newQty: number) => {
    await setWarehouseItem({ ...item, quantity: newQty });
    if (newQty <= 0) {
      setItems((prev) => prev.filter((i) => i.type_id !== item.type_id));
    } else {
      setItems((prev) => prev.map((i) => i.type_id === item.type_id ? { ...i, quantity: newQty } : i));
    }
  };

  const totalItems = items.reduce((s, i) => s + i.quantity, 0);

  return (
    <div className="min-h-screen bg-eve-bg font-eve">
      <Navbar character={character} />

      <main className="max-w-screen-2xl mx-auto px-4 py-6 space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-eve-text">Warehouse</h1>
          <span className="text-xs text-eve-muted">
            {items.length} item types · {totalItems.toLocaleString()} total units
          </span>
        </div>

        {/* Add item */}
        <div className="bg-eve-surface border border-eve-border rounded-lg p-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-eve-muted mb-3">
            Add / Update Item
          </h2>
          <div className="flex gap-3 items-end flex-wrap">
            {/* Type search */}
            <div className="relative flex-1 min-w-48">
              <label className="text-xs text-eve-muted block mb-1">Item Type</label>
              <input
                type="text"
                value={typeQuery}
                onChange={(e) => onTypeInput(e.target.value)}
                placeholder="Search item name…"
                className="w-full bg-eve-bg border border-eve-border rounded px-3 py-1.5
                           text-sm text-eve-text focus:outline-none focus:border-eve-orange"
              />
              {suggestions.length > 0 && (
                <ul className="absolute z-20 top-full mt-1 w-full bg-eve-surface border
                               border-eve-border rounded shadow-lg max-h-48 overflow-y-auto">
                  {suggestions.map((t) => (
                    <li
                      key={t.type_id}
                      onClick={() => pickType(t)}
                      className="px-3 py-1.5 text-sm text-eve-text hover:bg-eve-orange/20 cursor-pointer"
                    >
                      {t.type_name}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Quantity */}
            <label className="flex flex-col gap-1">
              <span className="text-xs text-eve-muted">Quantity</span>
              <input
                type="number" min="0"
                value={qty || ""}
                onChange={(e) => setQty(parseInt(e.target.value) || 0)}
                placeholder="0"
                className="w-32 bg-eve-bg border border-eve-border rounded px-3 py-1.5
                           text-sm text-eve-text focus:outline-none focus:border-eve-orange"
              />
            </label>

            <button
              onClick={handleAdd}
              disabled={!selectedType || qty <= 0 || adding}
              className="px-5 py-1.5 bg-eve-orange hover:bg-eve-orange/90
                         disabled:opacity-40 disabled:cursor-not-allowed
                         text-white text-sm font-semibold rounded transition-colors"
            >
              {adding ? "Saving…" : "Set"}
            </button>
          </div>
        </div>

        {/* Items table */}
        {loading ? (
          <div className="text-center py-10 text-eve-muted text-sm">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-center py-16 text-eve-muted text-sm">
            <div className="text-4xl mb-3">📦</div>
            Your warehouse is empty. Add items above to track your stock.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-eve-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-eve-border bg-eve-surface">
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-widest text-eve-muted">Item</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-widest text-eve-muted w-40">Quantity</th>
                  <th className="px-3 py-2.5 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.type_id} className="border-b border-eve-border/50 hover:bg-eve-surface/50">
                    <td className="px-3 py-2 flex items-center gap-2">
                      <img
                        src={`https://images.evetech.net/types/${item.type_id}/icon?size=32`}
                        alt=""
                        className="w-6 h-6 rounded border border-eve-border"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                      <span className="text-eve-text">{item.type_name}</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        min="0"
                        value={item.quantity}
                        onChange={(e) => handleQtyChange(item, parseInt(e.target.value) || 0)}
                        className="w-32 text-right bg-eve-bg border border-eve-border rounded px-2 py-0.5
                                   text-sm text-eve-text focus:outline-none focus:border-eve-orange"
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => handleDelete(item.type_id)}
                        className="text-eve-muted hover:text-red-400 transition-colors text-base leading-none"
                        title="Remove"
                      >
                        ×
                      </button>
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
