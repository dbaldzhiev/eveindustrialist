import { useEffect, useState, useRef } from "react";
import Navbar from "../components/Navbar";
import {
  fetchPlans, createPlan, deletePlan,
  fetchPlanItems, addPlanItem, deletePlanItem,
  fetchPlanStats, fetchPlanShoppingList,
  searchBlueprintsApi,
} from "../api/client";
import type {
  Character, Plan, PlanItem, PlanStats, PlanShoppingResult, Settings,
} from "../types";
import type { BlueprintSearchResult } from "../api/client";

interface Props {
  character: Character;
}

const DEFAULT_SETTINGS: Settings = {
  solar_system_id:      null,
  runs:                 1,
  broker_fee:           0.0368,
  sales_tax:            0.036,
  facility_tax:         0.0,
  min_profit:           0,
  price_region_id:      10000002,
  material_order_type:  "sell",
  product_order_type:   "sell",
  structure_me_bonus:   0,
  structure_te_bonus:   0,
  structure_cost_bonus: 0,
  assumed_me:           0,
  assumed_te:           0,
  industry_level:       0,
  adv_industry_level:   0,
};

function isk(v: number) {
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toFixed(0);
}

function fmtNum(v: number) {
  return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

// ---------------------------------------------------------------------------
// Add blueprint row
// ---------------------------------------------------------------------------
function AddBlueprintRow({ planId, onAdded }: { planId: number; onAdded: () => void }) {
  const [query, setQuery]       = useState("");
  const [results, setResults]   = useState<BlueprintSearchResult[]>([]);
  const [selected, setSelected] = useState<BlueprintSearchResult | null>(null);
  const [runs, setRuns]         = useState(1);
  const [me, setMe]             = useState(0);
  const [te, setTe]             = useState(0);
  const [adding, setAdding]     = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onInput = (v: string) => {
    setQuery(v);
    setSelected(null);
    if (timer.current) clearTimeout(timer.current);
    if (v.length < 2) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      const res = await searchBlueprintsApi(v).catch(() => []);
      setResults(res);
    }, 250);
  };

  const pick = (r: BlueprintSearchResult) => {
    setSelected(r);
    setQuery(r.blueprint_name);
    setResults([]);
  };

  const handleAdd = async () => {
    if (!selected) return;
    setAdding(true);
    try {
      await addPlanItem(planId, {
        blueprint_type_id: selected.blueprint_type_id,
        blueprint_name:    selected.blueprint_name,
        product_type_id:   selected.product_type_id,
        product_name:      selected.product_name,
        runs, me, te,
      });
      setQuery("");
      setSelected(null);
      setRuns(1);
      setMe(0);
      setTe(0);
      onAdded();
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="flex gap-2 items-end flex-wrap pt-3 border-t border-eve-border/50">
      {/* Blueprint search */}
      <div className="relative flex-1 min-w-48">
        <label className="text-xs text-eve-muted block mb-1">Blueprint</label>
        <input
          type="text"
          value={query}
          onChange={(e) => onInput(e.target.value)}
          placeholder="Search blueprint…"
          className="w-full bg-eve-bg border border-eve-border rounded px-3 py-1.5
                     text-sm text-eve-text focus:outline-none focus:border-eve-orange"
        />
        {results.length > 0 && (
          <ul className="absolute z-20 top-full mt-1 w-full bg-eve-surface border
                         border-eve-border rounded shadow-lg max-h-48 overflow-y-auto">
            {results.map((r) => (
              <li
                key={r.blueprint_type_id}
                onClick={() => pick(r)}
                className="px-3 py-1.5 text-sm hover:bg-eve-orange/20 cursor-pointer"
              >
                <span className="text-eve-text">{r.blueprint_name}</span>
                <span className="text-eve-muted ml-2 text-xs">→ {r.product_name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Runs */}
      <label className="flex flex-col gap-1 w-16">
        <span className="text-xs text-eve-muted">Runs</span>
        <input type="number" min="1" value={runs}
          onChange={(e) => setRuns(parseInt(e.target.value) || 1)}
          className="w-full bg-eve-bg border border-eve-border rounded px-2 py-1.5
                     text-sm text-eve-text focus:outline-none focus:border-eve-orange" />
      </label>

      {/* ME */}
      <label className="flex flex-col gap-1 w-14">
        <span className="text-xs text-eve-muted">ME</span>
        <input type="number" min="0" max="10" value={me}
          onChange={(e) => setMe(parseInt(e.target.value) || 0)}
          className="w-full bg-eve-bg border border-eve-border rounded px-2 py-1.5
                     text-sm text-eve-text focus:outline-none focus:border-eve-orange" />
      </label>

      {/* TE */}
      <label className="flex flex-col gap-1 w-14">
        <span className="text-xs text-eve-muted">TE</span>
        <input type="number" min="0" max="20" step="2" value={te}
          onChange={(e) => setTe(parseInt(e.target.value) || 0)}
          className="w-full bg-eve-bg border border-eve-border rounded px-2 py-1.5
                     text-sm text-eve-text focus:outline-none focus:border-eve-orange" />
      </label>

      <button
        onClick={handleAdd}
        disabled={!selected || adding}
        className="px-4 py-1.5 bg-eve-orange hover:bg-eve-orange/90
                   disabled:opacity-40 disabled:cursor-not-allowed
                   text-white text-sm font-semibold rounded transition-colors"
      >
        {adding ? "Adding…" : "Add"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plan detail panel
// ---------------------------------------------------------------------------
function PlanDetail({
  plan,
  onClose,
}: {
  plan: Plan;
  onClose: () => void;
}) {
  const [items, setItems]               = useState<PlanItem[]>([]);
  const [stats, setStats]               = useState<PlanStats | null>(null);
  const [shopping, setShopping]         = useState<PlanShoppingResult | null>(null);
  const [useWarehouse, setUseWarehouse] = useState(false);
  const [loadingStats, setLoadingStats] = useState(false);
  const [loadingShopping, setLoadingShopping] = useState(false);
  const [copied, setCopied]             = useState(false);
  const [settings] = useState<Settings>(DEFAULT_SETTINGS);

  const loadItems = () => {
    fetchPlanItems(plan.id).then(setItems).catch(() => {});
  };

  const loadStats = () => {
    setLoadingStats(true);
    fetchPlanStats(plan.id, settings)
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoadingStats(false));
  };

  const loadShopping = () => {
    setLoadingShopping(true);
    fetchPlanShoppingList(plan.id, settings, useWarehouse)
      .then(setShopping)
      .catch(() => {})
      .finally(() => setLoadingShopping(false));
  };

  useEffect(() => { loadItems(); }, [plan.id]);

  const handleDeleteItem = async (itemId: number) => {
    await deletePlanItem(plan.id, itemId);
    loadItems();
    setStats(null);
    setShopping(null);
  };

  const copyMultibuy = () => {
    if (!shopping?.multibuy) return;
    navigator.clipboard.writeText(shopping.multibuy).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="bg-eve-surface border border-eve-border rounded-lg p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-eve-text">{plan.name}</h2>
        <button
          onClick={onClose}
          className="text-xs text-eve-muted hover:text-eve-orange transition-colors"
        >
          ← Back to plans
        </button>
      </div>

      {/* Items table */}
      {items.length === 0 ? (
        <div className="text-sm text-eve-muted/60 italic py-2">
          No items yet. Add blueprints below.
        </div>
      ) : (
        <div className="overflow-x-auto rounded border border-eve-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-eve-border bg-eve-bg">
                <th className="px-3 py-2 text-left text-xs text-eve-muted">Blueprint</th>
                <th className="px-3 py-2 text-left text-xs text-eve-muted">Product</th>
                <th className="px-3 py-2 text-right text-xs text-eve-muted w-14">Runs</th>
                <th className="px-3 py-2 text-right text-xs text-eve-muted w-10">ME</th>
                <th className="px-3 py-2 text-right text-xs text-eve-muted w-10">TE</th>
                <th className="px-3 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-eve-border/40 hover:bg-eve-bg/50">
                  <td className="px-3 py-2 text-eve-text">{item.blueprint_name}</td>
                  <td className="px-3 py-2 text-eve-muted">{item.product_name}</td>
                  <td className="px-3 py-2 text-right text-eve-text">{item.runs}</td>
                  <td className="px-3 py-2 text-right text-eve-muted">{item.me}</td>
                  <td className="px-3 py-2 text-right text-eve-muted">{item.te}</td>
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => handleDeleteItem(item.id)}
                      className="text-eve-muted hover:text-red-400 transition-colors"
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

      {/* Add row */}
      <AddBlueprintRow planId={plan.id} onAdded={() => { loadItems(); setStats(null); setShopping(null); }} />

      {/* Stats */}
      {items.length > 0 && (
        <div className="pt-3 border-t border-eve-border/50 space-y-3">
          <div className="flex items-center gap-3">
            <button
              onClick={loadStats}
              disabled={loadingStats}
              className="px-4 py-1.5 bg-eve-orange/80 hover:bg-eve-orange
                         disabled:opacity-40 text-white text-sm font-semibold rounded transition-colors"
            >
              {loadingStats ? "Calculating…" : "Calculate Stats"}
            </button>
            <span className="text-xs text-eve-muted">
              Uses current price region &amp; settings
            </span>
          </div>

          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Material Cost",  value: isk(stats.total_material_cost) + " ISK" },
                { label: "Job Cost",       value: isk(stats.total_job_cost) + " ISK" },
                { label: "Total Revenue",  value: isk(stats.total_revenue) + " ISK" },
                { label: "Total Profit",   value: isk(stats.total_profit) + " ISK", highlight: stats.total_profit > 0 },
              ].map(({ label, value, highlight }) => (
                <div key={label} className="bg-eve-bg rounded p-3 border border-eve-border/50">
                  <div className="text-xs text-eve-muted mb-1">{label}</div>
                  <div className={`text-sm font-mono font-semibold ${highlight ? "text-green-400" : "text-eve-text"}`}>
                    {value}
                  </div>
                </div>
              ))}
            </div>
          )}

          {stats && stats.items.length > 0 && (
            <div className="overflow-x-auto rounded border border-eve-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-eve-border bg-eve-bg">
                    <th className="px-3 py-2 text-left text-xs text-eve-muted">Product</th>
                    <th className="px-3 py-2 text-right text-xs text-eve-muted w-14">Runs</th>
                    <th className="px-3 py-2 text-right text-xs text-eve-muted w-28">Profit</th>
                    <th className="px-3 py-2 text-right text-xs text-eve-muted w-28">ISK/h</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.items.map((item, i) => (
                    <tr key={i} className="border-b border-eve-border/40 hover:bg-eve-bg/50">
                      <td className="px-3 py-2 text-eve-text">{item.product_name}</td>
                      <td className="px-3 py-2 text-right text-eve-muted">{item.runs}</td>
                      <td className={`px-3 py-2 text-right font-mono ${item.profit >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {isk(item.profit)} ISK
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-eve-muted">
                        {isk(item.isk_per_hour)}/h
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Shopping list */}
      {items.length > 0 && (
        <div className="pt-3 border-t border-eve-border/50 space-y-3">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-xs font-semibold text-eve-muted uppercase tracking-widest">
              Shopping List
            </span>
            <label className="flex items-center gap-2 text-xs text-eve-muted cursor-pointer">
              <input
                type="checkbox"
                checked={useWarehouse}
                onChange={(e) => { setUseWarehouse(e.target.checked); setShopping(null); }}
                className="accent-eve-orange"
              />
              Subtract warehouse stock
            </label>
            <button
              onClick={loadShopping}
              disabled={loadingShopping}
              className="px-4 py-1.5 bg-eve-bg hover:bg-eve-surface border border-eve-border
                         disabled:opacity-40 text-eve-text text-sm rounded transition-colors"
            >
              {loadingShopping ? "Loading…" : "Generate"}
            </button>
          </div>

          {shopping && (
            <>
              {shopping.materials.length === 0 ? (
                <div className="text-sm text-eve-muted italic">All materials covered by warehouse stock.</div>
              ) : (
                <div className="overflow-x-auto rounded border border-eve-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-eve-border bg-eve-bg">
                        <th className="px-3 py-2 text-left text-xs text-eve-muted">Material</th>
                        <th className="px-3 py-2 text-right text-xs text-eve-muted w-24">Needed</th>
                        {useWarehouse && (
                          <th className="px-3 py-2 text-right text-xs text-eve-muted w-24">In Stock</th>
                        )}
                        <th className="px-3 py-2 text-right text-xs text-eve-muted w-24">To Buy</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shopping.materials.map((m) => (
                        <tr key={m.type_id} className="border-b border-eve-border/40 hover:bg-eve-bg/50">
                          <td className="px-3 py-2 flex items-center gap-2">
                            <img
                              src={`https://images.evetech.net/types/${m.type_id}/icon?size=32`}
                              alt=""
                              className="w-5 h-5 rounded border border-eve-border"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                            />
                            <span className="text-eve-text">{m.name}</span>
                          </td>
                          <td className="px-3 py-2 text-right text-eve-muted font-mono">{fmtNum(m.needed)}</td>
                          {useWarehouse && (
                            <td className="px-3 py-2 text-right font-mono text-blue-400">{fmtNum(m.in_stock)}</td>
                          )}
                          <td className="px-3 py-2 text-right font-mono text-eve-orange">{fmtNum(m.to_buy)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {shopping.multibuy && shopping.materials.length > 0 && (
                <div className="flex items-center gap-3">
                  <button
                    onClick={copyMultibuy}
                    className="px-4 py-1.5 bg-eve-orange hover:bg-eve-orange/90
                               text-white text-sm font-semibold rounded transition-colors"
                  >
                    {copied ? "Copied!" : "Copy Multibuy"}
                  </button>
                  <span className="text-xs text-eve-muted">Paste directly into EVE multibuy window</span>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plans list
// ---------------------------------------------------------------------------
export default function PlansPage({ character }: Props) {
  const [plans, setPlans]       = useState<Plan[]>([]);
  const [selected, setSelected] = useState<Plan | null>(null);
  const [newName, setNewName]   = useState("");
  const [creating, setCreating] = useState(false);

  const loadPlans = () => {
    fetchPlans().then(setPlans).catch(() => {});
  };

  useEffect(() => { loadPlans(); }, []);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const plan = await createPlan(name);
      setNewName("");
      setPlans((prev) => [plan, ...prev]);
      setSelected(plan);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (planId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    await deletePlan(planId);
    setPlans((prev) => prev.filter((p) => p.id !== planId));
    if (selected?.id === planId) setSelected(null);
  };

  if (selected) {
    return (
      <div className="min-h-screen bg-eve-bg font-eve">
        <Navbar character={character} />
        <main className="max-w-screen-lg mx-auto px-4 py-6">
          <PlanDetail plan={selected} onClose={() => setSelected(null)} />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-eve-bg font-eve">
      <Navbar character={character} />

      <main className="max-w-screen-lg mx-auto px-4 py-6 space-y-5">
        <h1 className="text-lg font-semibold text-eve-text">Plans</h1>

        {/* Create plan */}
        <div className="bg-eve-surface border border-eve-border rounded-lg p-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-eve-muted mb-3">
            New Plan
          </h2>
          <div className="flex gap-3 items-end">
            <label className="flex-1 flex flex-col gap-1">
              <span className="text-xs text-eve-muted">Plan Name</span>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                placeholder="e.g. Weekly Rig Production"
                className="w-full bg-eve-bg border border-eve-border rounded px-3 py-1.5
                           text-sm text-eve-text focus:outline-none focus:border-eve-orange"
              />
            </label>
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || creating}
              className="px-5 py-1.5 bg-eve-orange hover:bg-eve-orange/90
                         disabled:opacity-40 disabled:cursor-not-allowed
                         text-white text-sm font-semibold rounded transition-colors"
            >
              {creating ? "Creating…" : "Create"}
            </button>
          </div>
        </div>

        {/* Plans list */}
        {plans.length === 0 ? (
          <div className="text-center py-16 text-eve-muted text-sm">
            No plans yet. Create one above to get started.
          </div>
        ) : (
          <div className="space-y-2">
            {plans.map((plan) => (
              <div
                key={plan.id}
                onClick={() => setSelected(plan)}
                className="flex items-center gap-3 bg-eve-surface border border-eve-border
                           rounded-lg px-4 py-3 cursor-pointer hover:border-eve-orange/40
                           hover:bg-eve-surface/80 transition-colors group"
              >
                <div className="flex-1">
                  <div className="text-sm font-semibold text-eve-text">{plan.name}</div>
                  <div className="text-xs text-eve-muted">
                    Created {new Date(plan.created_at * 1000).toLocaleDateString()}
                  </div>
                </div>
                <button
                  onClick={(e) => handleDelete(plan.id, e)}
                  className="text-eve-muted hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 px-2"
                  title="Delete plan"
                >
                  Delete
                </button>
                <svg className="w-4 h-4 text-eve-muted group-hover:text-eve-orange transition-colors"
                  fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
