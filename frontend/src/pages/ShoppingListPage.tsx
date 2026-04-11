import { useEffect, useState, useRef } from "react";
import Navbar from "../components/Navbar";
import {
  fetchShoppingList, addShoppingItem, updateShoppingItemRuns,
  removeShoppingItem, clearShoppingList, fetchShoppingMaterials,
  searchBlueprintsApi, type BlueprintSearchResult,
} from "../api/client";
import type { Character, ShoppingListItem, ShoppingMaterial } from "../types";

interface Props {
  character: Character;
}

export default function ShoppingListPage({ character }: Props) {
  const [items, setItems]           = useState<ShoppingListItem[]>([]);
  const [materials, setMaterials]   = useState<ShoppingMaterial[]>([]);
  const [multibuy, setMultibuy]     = useState("");
  const [loading, setLoading]       = useState(true);
  const [calcLoading, setCalcLoading] = useState(false);
  const [copied, setCopied]         = useState(false);

  // Add BP state
  const [bpQuery, setBpQuery]         = useState("");
  const [bpSuggestions, setBpSuggs]   = useState<BlueprintSearchResult[]>([]);
  const [addRuns, setAddRuns]         = useState(1);
  const [addMe, setAddMe]             = useState(10);
  const [addTe, setAddTe]             = useState(20);
  const [selectedBp, setSelectedBp]   = useState<BlueprintSearchResult | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchShoppingList().then(setItems).finally(() => setLoading(false));
  }, []);

  const onBpInput = (v: string) => {
    setBpQuery(v);
    setSelectedBp(null);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (v.length < 2) { setBpSuggs([]); return; }
    searchTimer.current = setTimeout(async () => {
      const res = await searchBlueprintsApi(v).catch(() => []);
      setBpSuggs(res);
    }, 300);
  };

  const pickBp = (bp: BlueprintSearchResult) => {
    setSelectedBp(bp);
    setBpQuery(bp.blueprint_name);
    setBpSuggs([]);
  };

  const handleAdd = async () => {
    if (!selectedBp) return;
    const item = await addShoppingItem({
      blueprint_type_id: selectedBp.blueprint_type_id,
      blueprint_name:    selectedBp.blueprint_name,
      product_type_id:   selectedBp.product_type_id,
      product_name:      selectedBp.product_name,
      runs:              addRuns,
      me:                addMe,
      te:                addTe,
    });
    setItems((prev) => [...prev, item]);
    setBpQuery("");
    setSelectedBp(null);
    setMaterials([]);
  };

  const handleRunsChange = async (item: ShoppingListItem, runs: number) => {
    if (runs < 1) return;
    await updateShoppingItemRuns(item.id, runs);
    setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, runs } : i));
    setMaterials([]);
  };

  const handleRemove = async (id: number) => {
    await removeShoppingItem(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
    setMaterials([]);
  };

  const handleClear = async () => {
    await clearShoppingList();
    setItems([]);
    setMaterials([]);
    setMultibuy("");
  };

  const handleCalculate = async () => {
    setCalcLoading(true);
    try {
      const result = await fetchShoppingMaterials();
      setMaterials(result.materials);
      setMultibuy(result.multibuy);
    } finally {
      setCalcLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(multibuy).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const toBuy = materials.filter((m) => m.to_buy > 0);
  const covered = materials.filter((m) => m.to_buy === 0 && m.needed > 0);

  return (
    <div className="min-h-screen bg-eve-bg font-eve">
      <Navbar character={character} />

      <main className="max-w-screen-2xl mx-auto px-4 py-6 space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-eve-text">Shopping List</h1>
          {items.length > 0 && (
            <button
              onClick={handleClear}
              className="text-xs text-eve-muted hover:text-red-400 transition-colors"
            >
              Clear all
            </button>
          )}
        </div>

        {/* Add blueprint */}
        <div className="bg-eve-surface border border-eve-border rounded-lg p-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-eve-muted mb-3">
            Add Blueprint
          </h2>
          <div className="flex gap-3 items-end flex-wrap">
            {/* Blueprint search */}
            <div className="relative flex-1 min-w-52">
              <label className="text-xs text-eve-muted block mb-1">Blueprint</label>
              <input
                type="text"
                value={bpQuery}
                onChange={(e) => onBpInput(e.target.value)}
                placeholder="Search blueprint name…"
                className="w-full bg-eve-bg border border-eve-border rounded px-3 py-1.5
                           text-sm text-eve-text focus:outline-none focus:border-eve-orange"
              />
              {bpSuggestions.length > 0 && (
                <ul className="absolute z-20 top-full mt-1 w-full bg-eve-surface border
                               border-eve-border rounded shadow-lg max-h-48 overflow-y-auto">
                  {bpSuggestions.map((bp) => (
                    <li
                      key={bp.blueprint_type_id}
                      onClick={() => pickBp(bp)}
                      className="px-3 py-1.5 text-sm text-eve-text hover:bg-eve-orange/20 cursor-pointer"
                    >
                      {bp.blueprint_name}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-eve-muted">Runs</span>
              <input
                type="number" min="1" max="10000"
                value={addRuns}
                onChange={(e) => setAddRuns(parseInt(e.target.value) || 1)}
                className="w-20 bg-eve-bg border border-eve-border rounded px-3 py-1.5
                           text-sm text-eve-text focus:outline-none focus:border-eve-orange"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-eve-muted">ME</span>
              <input
                type="number" min="0" max="10"
                value={addMe}
                onChange={(e) => setAddMe(parseInt(e.target.value) || 0)}
                className="w-16 bg-eve-bg border border-eve-border rounded px-3 py-1.5
                           text-sm text-eve-text focus:outline-none focus:border-eve-orange"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-eve-muted">TE</span>
              <input
                type="number" min="0" max="20"
                value={addTe}
                onChange={(e) => setAddTe(parseInt(e.target.value) || 0)}
                className="w-16 bg-eve-bg border border-eve-border rounded px-3 py-1.5
                           text-sm text-eve-text focus:outline-none focus:border-eve-orange"
              />
            </label>

            <button
              onClick={handleAdd}
              disabled={!selectedBp}
              className="px-5 py-1.5 bg-eve-orange hover:bg-eve-orange/90
                         disabled:opacity-40 disabled:cursor-not-allowed
                         text-white text-sm font-semibold rounded transition-colors"
            >
              Add
            </button>
          </div>
        </div>

        {/* Blueprint list */}
        {loading ? (
          <div className="text-center py-6 text-eve-muted text-sm">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-center py-14 text-eve-muted text-sm">
            <div className="text-4xl mb-3">🛒</div>
            Add blueprints above to build your shopping list.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-eve-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-eve-border bg-eve-surface">
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-widest text-eve-muted">Blueprint</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-widest text-eve-muted">Product</th>
                    <th className="px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-widest text-eve-muted w-24">Runs</th>
                    <th className="px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-widest text-eve-muted w-16">ME</th>
                    <th className="px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-widest text-eve-muted w-16">TE</th>
                    <th className="px-3 py-2.5 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="border-b border-eve-border/50 hover:bg-eve-surface/50">
                      <td className="px-3 py-2 text-eve-text">{item.blueprint_name}</td>
                      <td className="px-3 py-2 text-eve-muted">{item.product_name || item.blueprint_name.replace(" Blueprint", "")}</td>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="number" min="1" max="10000"
                          value={item.runs}
                          onChange={(e) => handleRunsChange(item, parseInt(e.target.value) || 1)}
                          className="w-20 text-center bg-eve-bg border border-eve-border rounded px-2 py-0.5
                                     text-sm text-eve-text focus:outline-none focus:border-eve-orange"
                        />
                      </td>
                      <td className="px-3 py-2 text-center text-eve-muted">{item.me}</td>
                      <td className="px-3 py-2 text-center text-eve-muted">{item.te}</td>
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => handleRemove(item.id)}
                          className="text-eve-muted hover:text-red-400 transition-colors text-base leading-none"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              onClick={handleCalculate}
              disabled={calcLoading}
              className="px-6 py-2 bg-eve-orange hover:bg-eve-orange/90
                         disabled:opacity-40 disabled:cursor-not-allowed
                         text-white text-sm font-semibold rounded transition-colors"
            >
              {calcLoading ? "Calculating…" : "Calculate Materials"}
            </button>
          </>
        )}

        {/* Material breakdown */}
        {materials.length > 0 && (
          <div className="space-y-4">
            {toBuy.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-widest text-eve-muted mb-2">
                  To Buy ({toBuy.length} types)
                </h2>
                <MaterialTable rows={toBuy} highlight />
              </div>
            )}

            {covered.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-widest text-eve-muted mb-2">
                  Covered by Warehouse ({covered.length} types)
                </h2>
                <MaterialTable rows={covered} />
              </div>
            )}

            {/* Multibuy block */}
            {multibuy && (
              <div className="bg-eve-surface border border-eve-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-eve-muted">
                    Multibuy (paste into EVE)
                  </h2>
                  <button
                    onClick={handleCopy}
                    className="text-xs px-3 py-1 rounded border border-eve-border
                               text-eve-muted hover:text-eve-orange hover:border-eve-orange
                               transition-colors"
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
                <pre className="font-mono text-xs text-eve-text bg-eve-bg rounded p-3
                                max-h-64 overflow-y-auto whitespace-pre-wrap">
                  {multibuy}
                </pre>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function MaterialTable({ rows, highlight }: { rows: ShoppingMaterial[]; highlight?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-eve-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-eve-border bg-eve-surface">
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-widest text-eve-muted">Material</th>
            <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-widest text-eve-muted">Needed</th>
            <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-widest text-eve-muted">In Stock</th>
            <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-widest text-eve-muted">To Buy</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.type_id} className="border-b border-eve-border/40 hover:bg-eve-surface/40">
              <td className="px-3 py-1.5 flex items-center gap-2">
                <img
                  src={`https://images.evetech.net/types/${m.type_id}/icon?size=32`}
                  alt=""
                  className="w-5 h-5 rounded border border-eve-border"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
                <span className="text-eve-text">{m.name}</span>
              </td>
              <td className="px-3 py-1.5 text-right text-eve-muted">{m.needed.toLocaleString()}</td>
              <td className="px-3 py-1.5 text-right text-eve-profit">{m.in_stock.toLocaleString()}</td>
              <td className={`px-3 py-1.5 text-right font-semibold ${highlight && m.to_buy > 0 ? "text-eve-orange" : "text-eve-muted"}`}>
                {m.to_buy.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
