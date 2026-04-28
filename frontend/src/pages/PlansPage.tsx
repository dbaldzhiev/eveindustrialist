import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import Navbar from "../components/Navbar";
import { useEligibilityMap, useCharacterSkillData, type EligibleChar } from "../hooks/useEligibleCharacters";
import { CharacterMiniPortraits } from "../components/CharacterMiniPortraits";
import { OwnerPortraits } from "../components/OwnerPortraits";
import {
  fetchPlans, createPlan, deletePlan, fetchPlanRename,
  fetchPlanItems, addPlanItem, deletePlanItem,
  fetchPlanStats, fetchPlanShoppingList,
  searchBlueprintsApi, fetchAppSettings,
  fetchSuggestedPlan, fetchBlueprints, fetchWarehouse,
  updatePlanItemApi,
} from "../api/client";
import type { SuggestResult, BlueprintSearchResult } from "../api/client";
import type {
  Character, Plan, PlanItem, PlanStats, PlanShoppingResult,
  Settings, BlueprintResult,
} from "../types";

interface Props {
  character: Character;
}

const DEFAULT_SETTINGS: Settings = {
  solar_system_id:       null,
  runs:                  1,
  broker_fee:            0.0368,
  sales_tax:             0.036,
  facility_tax:          0.0,
  min_profit:            0,
  price_region_id:       10000002,
  material_order_type:   "sell",
  product_order_type:    "sell",
  structure_me_bonus:    0,
  structure_te_bonus:    0,
  structure_cost_bonus:  0,
  assumed_me:            0,
  assumed_te:            0,
  reaction_facility_tax: 0,
  reaction_me_bonus:     0,
  reaction_te_bonus:     0,
  reaction_cost_bonus:   0,
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

function fmtVolCompact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(0);
}

const PLAN_TREND = { up: "↑", down: "↓", flat: "→" } as const;

// ---------------------------------------------------------------------------
// Add blueprint row (used in PlanDetail)
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
      setQuery(""); setSelected(null); setRuns(1); setMe(0); setTe(0);
      onAdded();
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="flex gap-2 items-end flex-wrap pt-3 border-t border-eve-border/50">
      <div className="relative flex-1 min-w-48">
        <label className="text-xs text-eve-muted block mb-1">Blueprint</label>
        <input
          type="text" value={query}
          onChange={(e) => onInput(e.target.value)}
          placeholder="Search blueprint…"
          className="w-full bg-eve-bg border border-eve-border rounded px-3 py-1.5
                     text-sm text-eve-text focus:outline-none focus:border-eve-orange"
        />
        {results.length > 0 && (
          <ul className="absolute z-20 top-full mt-1 w-full bg-eve-surface border
                         border-eve-border rounded shadow-lg max-h-48 overflow-y-auto">
            {results.map((r) => (
              <li key={r.blueprint_type_id} onClick={() => pick(r)}
                  className="px-3 py-1.5 text-sm hover:bg-eve-orange/20 cursor-pointer">
                <span className="text-eve-text">{r.blueprint_name}</span>
                <span className="text-eve-muted ml-2 text-xs">→ {r.product_name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <label className="flex flex-col gap-1 w-16">
        <span className="text-xs text-eve-muted">Runs</span>
        <input type="number" min="1" value={runs}
          onChange={(e) => setRuns(parseInt(e.target.value) || 1)}
          className="w-full bg-eve-bg border border-eve-border rounded px-2 py-1.5
                     text-sm text-eve-text focus:outline-none focus:border-eve-orange" />
      </label>
      <label className="flex flex-col gap-1 w-14">
        <span className="text-xs text-eve-muted">ME</span>
        <input type="number" min="0" max="10" value={me}
          onChange={(e) => setMe(parseInt(e.target.value) || 0)}
          className="w-full bg-eve-bg border border-eve-border rounded px-2 py-1.5
                     text-sm text-eve-text focus:outline-none focus:border-eve-orange" />
      </label>
      <label className="flex flex-col gap-1 w-14">
        <span className="text-xs text-eve-muted">TE</span>
        <input type="number" min="0" max="20" step="2" value={te}
          onChange={(e) => setTe(parseInt(e.target.value) || 0)}
          className="w-full bg-eve-bg border border-eve-border rounded px-2 py-1.5
                     text-sm text-eve-text focus:outline-none focus:border-eve-orange" />
      </label>
      <button onClick={handleAdd} disabled={!selected || adding}
        className="px-4 py-1.5 bg-eve-orange hover:bg-eve-orange/90
                   disabled:opacity-40 disabled:cursor-not-allowed
                   text-white text-sm font-semibold rounded transition-colors">
        {adding ? "Adding…" : "Add"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plan detail panel
// ---------------------------------------------------------------------------
function PlanDetail({ plan, charNameMap, onClose, onRename, onDelete }: { 
  plan: Plan; 
  charNameMap: Map<number, string>;
  onClose: () => void; 
  onRename: (p: Plan) => void; 
  onDelete: (id: number) => void;
}) {
  const [items, setItems]               = useState<PlanItem[]>([]);
  const [stats, setStats]               = useState<PlanStats | null>(null);
  const [shopping, setShopping]         = useState<PlanShoppingResult | null>(null);
  const [useWarehouse, setUseWarehouse] = useState(true);

  // ...

  useEffect(() => {
    if (shopping) loadShopping();
  }, [useWarehouse]);
  const [loadingStats, setLoadingStats] = useState(false);
  const [loadingShopping, setLoadingShopping] = useState(false);
  const [copied, setCopied]             = useState(false);
  const [settings, setSettings]         = useState<Settings>(DEFAULT_SETTINGS);
  const [editingId, setEditingId]       = useState<number | null>(null);
  const [editRuns, setEditRuns]         = useState(1);
  const [editMe, setEditMe]             = useState(0);
  const [editTe, setEditTe]             = useState(0);

  const loadItems = () => {
    fetchPlanItems(plan.id).then(setItems).catch(() => {});
  };

  useEffect(() => {
    loadItems();
    fetchAppSettings()
      .then((app) => setSettings((prev) => ({
        ...prev,
        solar_system_id:      app.default_system_id,
        price_region_id:      app.default_price_region,
        broker_fee:           app.broker_fee,
        sales_tax:            app.sales_tax,
        facility_tax:         app.facility_tax,
        structure_me_bonus:   app.structure_me_bonus,
        structure_te_bonus:   app.structure_te_bonus,
        structure_cost_bonus: app.structure_cost_bonus,
        runs:                 app.runs,
        min_profit:           app.min_profit,
        material_order_type:  app.material_order_type,
        product_order_type:   app.product_order_type,
      })))
      .catch(() => {});
  }, [plan.id]);

  const loadStats = () => {
    setLoadingStats(true);
    fetchPlanStats(plan.id, settings)
      .then(setStats).catch(() => {}).finally(() => setLoadingStats(false));
  };

  const loadShopping = () => {
    setLoadingShopping(true);
    fetchPlanShoppingList(plan.id, settings, useWarehouse)
      .then(setShopping).catch(() => {}).finally(() => setLoadingShopping(false));
  };

  const handleDeleteItem = async (itemId: number) => {
    await deletePlanItem(plan.id, itemId);
    loadItems(); setStats(null); setShopping(null);
  };

  const startEdit = (item: PlanItem) => {
    setEditingId(item.id);
    setEditRuns(item.runs);
    setEditMe(item.me);
    setEditTe(item.te);
  };

  const commitEdit = async (itemId: number) => {
    await updatePlanItemApi(plan.id, itemId, editRuns, editMe, editTe).catch(() => {});
    setEditingId(null);
    loadItems(); setStats(null); setShopping(null);
  };

  const toggleItemDone = async (item: PlanItem) => {
    const newStatus = item.status === "done" ? "active" : "done";
    try {
      await updatePlanItemApi(plan.id, item.id, item.runs, item.me, item.te, newStatus);
      loadItems(); setStats(null); setShopping(null);
    } catch (e: any) {
      alert("Failed to update item: " + e.message);
    }
  };

  const copyMultibuy = () => {
    if (!shopping?.multibuy) return;
    navigator.clipboard.writeText(shopping.multibuy).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="bg-eve-surface border border-eve-border rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between border-b border-eve-border pb-3 mb-2">
        <div className="flex items-center gap-4">
          <button onClick={onClose}
            className="text-xs text-eve-muted hover:text-eve-orange transition-colors"
            title="Back to plans">
            ← Back
          </button>
          <h2 className="text-lg font-bold text-eve-orange">{plan.name}</h2>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => onRename(plan)}
            className="text-[10px] text-eve-muted hover:text-eve-text uppercase font-bold"
          >
            Rename
          </button>
          <button
            onClick={() => { if (confirm("Delete this plan?")) onDelete(plan.id); }}
            className="text-[10px] text-red-500/70 hover:text-red-500 uppercase font-bold"
          >
            Delete
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="text-sm text-eve-muted/60 italic py-2">
          No items yet. Add blueprints below.
        </div>
      ) : (
        <div className="overflow-x-auto rounded border border-eve-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-eve-border bg-eve-bg">
                <th className="px-3 py-2 text-center text-xs text-eve-muted w-10">Done</th>
                <th className="px-3 py-2 text-left text-xs text-eve-muted">Blueprint</th>
                <th className="px-3 py-2 text-left text-xs text-eve-muted">Product</th>
                <th className="px-3 py-2 text-right text-xs text-eve-muted w-20">Runs</th>
                <th className="px-3 py-2 text-right text-xs text-eve-muted w-14">ME</th>
                <th className="px-3 py-2 text-right text-xs text-eve-muted w-14">TE</th>
                <th className="px-3 py-2 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const isEditing = editingId === item.id;
                const isDone = item.status === "done";
                return (
                  <tr key={item.id} className={`border-b border-eve-border/40 hover:bg-eve-bg/50 transition-colors ${isDone ? "opacity-50 grayscale-[0.5]" : ""}`}>
                    <td className="px-3 py-2 text-center">
                      <input type="checkbox" checked={isDone} onChange={() => toggleItemDone(item)}
                             className="accent-eve-orange cursor-pointer" />
                    </td>
                    <td className={`px-3 py-2 text-eve-text ${isDone ? "line-through" : ""}`}>
                      <div className="flex items-center gap-2">
                        {item.blueprint_name}
                        {item.character_id && (
                          <OwnerPortraits ids={[item.character_id]} nameMap={charNameMap} size={14} />
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-eve-muted">{item.product_name}</td>
                    {isEditing ? (
                      <>
                        <td className="px-1 py-1">
                          <input type="number" min="1" value={editRuns}
                            onChange={e => setEditRuns(parseInt(e.target.value) || 1)}
                            className="w-full bg-eve-bg border border-eve-orange rounded px-1 py-0.5 text-xs text-right text-eve-text focus:outline-none" />
                        </td>
                        <td className="px-1 py-1">
                          <input type="number" min="0" max="10" value={editMe}
                            onChange={e => setEditMe(parseInt(e.target.value) || 0)}
                            className="w-full bg-eve-bg border border-eve-orange rounded px-1 py-0.5 text-xs text-right text-eve-text focus:outline-none" />
                        </td>
                        <td className="px-1 py-1">
                          <input type="number" min="0" max="20" step="2" value={editTe}
                            onChange={e => setEditTe(parseInt(e.target.value) || 0)}
                            className="w-full bg-eve-bg border border-eve-orange rounded px-1 py-0.5 text-xs text-right text-eve-text focus:outline-none" />
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 text-right text-eve-text">{item.runs}</td>
                        <td className="px-3 py-2 text-right text-eve-muted">{item.me}</td>
                        <td className="px-3 py-2 text-right text-eve-muted">{item.te}</td>
                      </>
                    )}
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-center gap-2">
                        {isEditing ? (
                          <>
                            <button onClick={() => commitEdit(item.id)}
                              className="text-green-400 hover:text-green-300 text-xs transition-colors">✓</button>
                            <button onClick={() => setEditingId(null)}
                              className="text-eve-muted hover:text-eve-text text-xs transition-colors">✕</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => startEdit(item)}
                              className="text-eve-muted hover:text-eve-orange transition-colors text-xs" title="Edit">✎</button>
                            <button onClick={() => handleDeleteItem(item.id)}
                              className="text-eve-muted hover:text-red-400 transition-colors" title="Remove">×</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <AddBlueprintRow planId={plan.id} onAdded={() => { loadItems(); setStats(null); setShopping(null); }} />

      {items.length > 0 && (
        <div className="pt-3 border-t border-eve-border/50 space-y-3">
          <div className="flex items-center gap-3">
            <button onClick={loadStats} disabled={loadingStats}
              className="px-4 py-1.5 bg-eve-orange/80 hover:bg-eve-orange
                         disabled:opacity-40 text-white text-sm font-semibold rounded transition-colors">
              {loadingStats ? "Calculating…" : "Calculate Stats"}
            </button>
            <span className="text-xs text-eve-muted">Uses current price region &amp; settings</span>
          </div>

          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Material Cost", value: isk(stats.total_material_cost) + " ISK" },
                { label: "Job Cost",      value: isk(stats.total_job_cost) + " ISK" },
                { label: "Total Revenue", value: isk(stats.total_revenue) + " ISK" },
                { label: "Total Profit",  value: isk(stats.total_profit) + " ISK", highlight: stats.total_profit > 0 },
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
                    <th className="px-3 py-2 text-left text-xs text-eve-muted">Blueprint</th>
                    <th className="px-3 py-2 text-left text-xs text-eve-muted">Product</th>
                    <th className="px-3 py-2 text-right text-xs text-eve-muted w-14">Runs</th>
                    <th className="px-3 py-2 text-right text-xs text-eve-muted w-28">Profit</th>
                    <th className="px-3 py-2 text-right text-xs text-eve-muted w-28">ISK/h</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.items.map((item, i) => (
                    <tr key={i} className="border-b border-eve-border/40 hover:bg-eve-bg/50">
                      <td className="px-3 py-2 text-eve-muted text-xs">
                        <div className="flex items-center gap-2">
                          {item.blueprint_name}
                          {item.character_id && (
                            <OwnerPortraits ids={[item.character_id]} nameMap={charNameMap} size={14} />
                          )}
                        </div>
                      </td>
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

      {items.length > 0 && (
        <div className="pt-3 border-t border-eve-border/50 space-y-3">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-xs font-semibold text-eve-muted uppercase tracking-widest">
              Shopping List
            </span>
            <label className="flex items-center gap-2 text-xs text-eve-muted cursor-pointer">
              <input type="checkbox" checked={useWarehouse}
                onChange={(e) => setUseWarehouse(e.target.checked)}
                className="accent-eve-orange" />
              Subtract warehouse stock
            </label>
            <button onClick={loadShopping} disabled={loadingShopping}
              className="px-4 py-1.5 bg-eve-bg hover:bg-eve-surface border border-eve-border
                         disabled:opacity-40 text-eve-text text-sm rounded transition-colors">
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
                            <img src={`https://images.evetech.net/types/${m.type_id}/icon?size=32`}
                              alt="" className="w-5 h-5 rounded border border-eve-border"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
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
                  <button onClick={copyMultibuy}
                    className="px-4 py-1.5 bg-eve-orange hover:bg-eve-orange/90
                               text-white text-sm font-semibold rounded transition-colors">
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
// Build Simulator — individual blueprint copy components
// ---------------------------------------------------------------------------
interface QueueItem {
  id:          string;
  bp:          BlueprintResult;  // one physical copy; bp.runs = that copy's actual run count
  chosen_runs: number;
}

interface BpVariant {
  me:     number;
  te:     number;
  is_bpo: boolean;
  copies: (BlueprintResult & { shoppingCost?: number })[]; // individual physical copies, sorted runs desc
}

interface BpGroup {
  name:     string;
  variants: BpVariant[];
  minGroupCost?: number;
}

function BpCopyRow({
  bp, noPrices, eligibilityMap, onAdd, sortByShoppingCost,
}: {
  bp: BlueprintResult & { shoppingCost?: number };
  noPrices: boolean;
  eligibilityMap: Map<number, EligibleChar[]>;
  onAdd: (bp: BlueprintResult, runs: number) => void;
  sortByShoppingCost: boolean;
}) {
  const maxRuns = bp.is_bpo ? 1 : bp.runs;
  const profitPerRun = bp.runs > 0 ? bp.profit / bp.runs : 0;
  const eligible = eligibilityMap.get(bp.blueprint_type_id) ?? [];
  const charSkillData = useCharacterSkillData();
  const charNameMap = useMemo(() =>
    new Map(charSkillData.map(c => [c.character_id, c.character_name])),
  [charSkillData]);

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-eve-bg/50 border border-eve-border/30
                    rounded hover:border-eve-orange/30 transition-colors">
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          {!noPrices && (
            <span className={`text-[10px] font-mono font-semibold
                             ${profitPerRun * maxRuns >= 0 ? "text-green-400" : "text-red-400"}`}>
              {isk(profitPerRun * maxRuns)} ISK
            </span>
          )}
          {sortByShoppingCost && bp.shoppingCost !== undefined && (
            <span className="text-[10px] text-eve-orange font-mono font-semibold">
              Buy: {isk(bp.shoppingCost)}
            </span>
          )}
        </div>
        {bp.market_stats && bp.market_stats.vol_7d > 0 && (
          <span className="text-[8px] text-eve-muted/50 font-mono">
            {PLAN_TREND[bp.market_stats.trend]}
            {" "}{fmtVolCompact(bp.market_stats.vol_1d)}/d
            {" · "}7d {fmtVolCompact(bp.market_stats.vol_7d)}
          </span>
        )}
      </div>
      {bp.character_ids && bp.character_ids.length > 0 && (
        <OwnerPortraits ids={bp.character_ids} nameMap={charNameMap} />
      )}
      <CharacterMiniPortraits characters={eligible} size={18} />
      <div className="flex items-center gap-1 shrink-0 mr-2">
        <span className="text-[10px] text-eve-text font-bold">{maxRuns}</span>
        <span className="text-[8px] text-eve-muted uppercase">Run{maxRuns !== 1 ? "s" : ""}</span>
      </div>
      <button
        onClick={() => onAdd(bp, maxRuns)}
        className="px-2.5 py-1 bg-eve-orange/20 hover:bg-eve-orange text-eve-orange
                   hover:text-white text-[10px] font-bold uppercase rounded transition-all">
        + Add
      </button>
    </div>
  );
}

function BpVariantSection({
  variant, noPrices, eligibilityMap, onAdd, sortByShoppingCost,
}: {
  variant: BpVariant;
  noPrices: boolean;
  eligibilityMap: Map<number, EligibleChar[]>;
  onAdd: (bp: BlueprintResult, runs: number) => void;
  sortByShoppingCost: boolean;
}) {
  const runsList = variant.copies.map(c => c.runs);
  const variantProfit = variant.copies.reduce((s, c) => s + c.profit, 0);
  const showVariantProfit = !noPrices && variant.copies.length > 1;
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5 px-1 pt-0.5">
        <span className={`text-[9px] font-bold uppercase px-1 py-0.5 rounded leading-none
                          ${variant.is_bpo
                            ? "bg-amber-500/20 text-amber-400"
                            : "bg-blue-500/20 text-blue-400"}`}>
          {variant.is_bpo ? "BPO" : "BPC"}
        </span>
        <span className="text-[10px] text-eve-muted font-mono">
          ME{variant.me} / TE{variant.te}
        </span>
        {!variant.is_bpo && (
          <span className="text-[9px] text-eve-muted/60">
            {variant.copies.length} cop{variant.copies.length !== 1 ? "ies" : "y"}
            {" · "}
            {runsList.join(", ")} run{runsList.length > 1 || runsList[0] !== 1 ? "s" : ""}
          </span>
        )}
        {showVariantProfit && (
          <span className={`ml-auto text-[9px] font-mono font-semibold shrink-0
                            ${variantProfit >= 0 ? "text-green-400" : "text-red-400"}`}>
            {isk(variantProfit)} ISK
          </span>
        )}
      </div>
      <div className="space-y-0.5">
        {variant.copies.map((copy, i) => (
          <BpCopyRow
            key={copy.item_id ?? `${copy.me}-${copy.te}-${copy.runs}-${i}`}
            bp={copy} noPrices={noPrices} eligibilityMap={eligibilityMap} onAdd={onAdd}
            sortByShoppingCost={sortByShoppingCost}
          />
        ))}
      </div>
    </div>
  );
}


function BpGroupRow({
  group, expanded, noPrices, eligibilityMap, onToggle, onAdd, sortByShoppingCost,
}: {
  group: BpGroup;
  expanded: boolean;
  noPrices: boolean;
  eligibilityMap: Map<number, EligibleChar[]>;
  onToggle: () => void;
  onAdd: (bp: BlueprintResult, runs: number) => void;
  sortByShoppingCost: boolean;
}) {
  const isSingle = group.variants.length === 1 && group.variants[0].copies.length === 1;
  const totalBpcCopies = group.variants
    .filter(v => !v.is_bpo)
    .reduce((s, v) => s + v.copies.length, 0);
  const hasBpo = group.variants.some(v => v.is_bpo);
  const groupProfit = group.variants.flatMap(v => v.copies).reduce((s, c) => s + c.profit, 0);

  if (isSingle) {
    return (
      <div className="space-y-0.5">
        <div className="flex items-center justify-between px-1 pt-1 pb-0.5">
          <span className="text-[10px] font-semibold text-eve-text truncate flex-1 min-w-0">
            {group.name}
          </span>
          <div className="flex items-center gap-2 shrink-0 ml-2">
            {sortByShoppingCost && group.minGroupCost !== undefined && (
              <span className="text-[9px] text-eve-orange font-mono font-semibold">
                Buy: {isk(group.minGroupCost)}
              </span>
            )}
            {!noPrices && (
              <span className={`text-[9px] font-mono font-semibold
                                ${groupProfit >= 0 ? "text-green-400" : "text-red-400"}`}>
                {isk(groupProfit)} ISK
              </span>
            )}
          </div>
        </div>
        <BpVariantSection variant={group.variants[0]} noPrices={noPrices} eligibilityMap={eligibilityMap} onAdd={onAdd} sortByShoppingCost={sortByShoppingCost} />
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-1 pt-1 pb-0.5 text-left
                   hover:text-eve-orange transition-colors group/hdr"
      >
        <span className="text-[10px] font-semibold text-eve-text group-hover/hdr:text-eve-orange flex-1 truncate min-w-0">
          {group.name}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {sortByShoppingCost && group.minGroupCost !== undefined && (
            <span className="text-[9px] text-eve-orange font-mono font-semibold">
              Buy: {isk(group.minGroupCost)}
            </span>
          )}
          {!noPrices && (
            <span className={`text-[9px] font-mono font-semibold
                              ${groupProfit >= 0 ? "text-green-400" : "text-red-400"}`}>
              {isk(groupProfit)} ISK
            </span>
          )}
        </div>
        <span className="text-[9px] text-eve-muted shrink-0">
          {hasBpo && "BPO"}
          {totalBpcCopies > 0 && ` · ${totalBpcCopies} cop${totalBpcCopies !== 1 ? "ies" : "y"}`}
        </span>
        <svg
          className={`w-3 h-3 text-eve-muted shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="pl-2 space-y-1">
          {group.variants.map((variant) => (
            <BpVariantSection
              key={`${variant.me}-${variant.te}-${String(variant.is_bpo)}`}
              variant={variant} noPrices={noPrices} eligibilityMap={eligibilityMap} onAdd={onAdd}
              sortByShoppingCost={sortByShoppingCost}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Simulation Mode
// ---------------------------------------------------------------------------
function SimulationMode({ onClose }: { onClose: (newPlan?: Plan) => void }) {
  const [blueprints, setBlueprints] = useState<BlueprintResult[]>([]);
  const [warehouse, setWarehouse]   = useState<Record<number, number>>({});
  const [queue, setQueue]           = useState<QueueItem[]>([]);
  const [useWarehouse, setUseWarehouse] = useState(false);
  const [saving, setSaving]         = useState(false);
  const [loading, setLoading]       = useState(true);
  const [loadError, setLoadError]   = useState<string | null>(null);
  const [noPrices, setNoPrices]     = useState(false);
  const [copied, setCopied]         = useState(false);
  const [search, setSearch]         = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  // Include queued blueprints so portraits remain visible after a BP is moved to the queue
  const allBps = useMemo(
    () => [...blueprints, ...queue.map(q => q.bp)],
    [blueprints, queue],
  );
  const eligibilityMap = useEligibilityMap(allBps);

  const [showProfitableOnly, setShowProfitableOnly] = useState(false);
  const [hideBpos, setHideBpos] = useState(false);
  const [sortByShoppingCost, setSortByShoppingCost] = useState(false);

  // Holds the settings used to load BPs (so we can save plan items with correct me/te/runs)
  const simSettingsRef = useRef<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    async function init() {
      try {
        const app = await fetchAppSettings();
        const s: Settings = {
          ...DEFAULT_SETTINGS,
          solar_system_id:      app.default_system_id,
          price_region_id:      app.default_price_region,
          broker_fee:           app.broker_fee,
          sales_tax:            app.sales_tax,
          facility_tax:         app.facility_tax,
          structure_me_bonus:   app.structure_me_bonus,
          structure_te_bonus:   app.structure_te_bonus,
          structure_cost_bonus: app.structure_cost_bonus,
          runs:                 app.runs,
          min_profit:           app.min_profit,
          material_order_type:  app.material_order_type,
          product_order_type:   app.product_order_type,
        };
        simSettingsRef.current = s;

        if (!s.solar_system_id) setNoPrices(true);

        const [bps, wh] = await Promise.all([
          fetchBlueprints({ ...s, min_profit: -1e15 }, false, "build", "none", null, true),
          fetchWarehouse().catch(() => []),
        ]);

        if (bps.length === 0) {
          setLoadError("No blueprints found in your characters' assets. Sync blueprints via ESI first.");
        } else {
          setBlueprints(bps);
        }

        const whMap: Record<number, number> = {};
        wh.forEach(i => { whMap[i.type_id] = i.quantity; });
        setWarehouse(whMap);
      } catch (e: any) {
        setLoadError(e?.message ?? "Failed to load blueprints.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  // Calculate remaining warehouse after queue consumption
  const remainingWarehouse = useMemo(() => {
    const rem = { ...warehouse };
    queue.forEach(({ bp, chosen_runs }) => {
      const scale = bp.runs > 0 ? chosen_runs / bp.runs : 1;
      bp.materials.forEach(m => {
        const needed = Math.ceil(m.quantity * scale);
        rem[m.type_id] = (rem[m.type_id] || 0) - needed;
      });
    });
    return rem;
  }, [warehouse, queue]);

  // Group individual copies by blueprint_name → (me, te, is_bpo) variant
  const groups = useMemo((): BpGroup[] => {
    const q = search.toLowerCase();
    
    // 1. Filter by search + profitability + BPO status
    let filtered = blueprints.filter(bp =>
      (bp.blueprint_name.toLowerCase().includes(q) ||
       bp.product_name.toLowerCase().includes(q) ||
       bp.category_name?.toLowerCase().includes(q)) &&
      (!showProfitableOnly || bp.profit > 0) &&
      (!hideBpos || !!!bp.is_bpo)
    );

    // 2. Pre-calculate shopping cost for each blueprint if sorting is enabled
    const bpCosts = new Map<string, number>();
    if (sortByShoppingCost) {
      filtered.forEach(bp => {
        let cost = 0;
        // BPO cost is calculated for 1 run (initial add), BPC for its full runs.
        const targetRuns = (!!bp.is_bpo) ? 1 : bp.runs;
        const scale = bp.runs > 0 ? targetRuns / bp.runs : 1;
        
        bp.materials.forEach(m => {
          const inStock = Math.max(0, remainingWarehouse[m.type_id] || 0);
          const needed = Math.ceil(m.quantity * scale);
          const toBuy = Math.max(0, needed - inStock);
          cost += toBuy * m.unit_price;
        });
        bpCosts.set(bp.item_id ? bp.item_id.toString() : `${bp.blueprint_type_id}-${bp.me}-${bp.te}-${bp.runs}`, cost);
      });
    }

    const nameMap = new Map<string, BlueprintResult[]>();
    filtered.forEach(bp => {
      if (!nameMap.has(bp.blueprint_name)) nameMap.set(bp.blueprint_name, []);
      nameMap.get(bp.blueprint_name)!.push(bp);
    });

    const result = Array.from(nameMap.entries())
      .map(([name, copies]) => {
        const variantMap = new Map<string, BlueprintResult[]>();
        copies.forEach(bp => {
          const key = `${bp.me}:${bp.te}:${bp.is_bpo}`;
          if (!variantMap.has(key)) variantMap.set(key, []);
          variantMap.get(key)!.push(bp);
        });
        const variants: BpVariant[] = Array.from(variantMap.values())
          .map(vCopies => ({
            me: vCopies[0].me,
            te: vCopies[0].te,
            is_bpo: vCopies[0].is_bpo,
            copies: vCopies.slice().sort((a, b) => b.runs - a.runs).map(cp => ({
              ...cp,
              shoppingCost: bpCosts.get(cp.item_id ? cp.item_id.toString() : `${cp.blueprint_type_id}-${cp.me}-${cp.te}-${cp.runs}`),
            })),
          }))
          .sort((a, b) => {
            if (a.is_bpo !== b.is_bpo) return a.is_bpo ? -1 : 1;
            return b.me - a.me;
          });
        
        // Calculate min shopping cost for this group if sorting
        let minGroupCost = 0;
        if (sortByShoppingCost) {
          minGroupCost = Math.min(...copies.map(bp => bpCosts.get(bp.item_id ? bp.item_id.toString() : `${bp.blueprint_type_id}-${bp.me}-${bp.te}-${bp.runs}`) ?? 0));
        }

        return { name, variants, minGroupCost };
      });

    // 3. Sort groups
    if (sortByShoppingCost) {
      return result.sort((a, b) => (a.minGroupCost ?? 0) - (b.minGroupCost ?? 0) || a.name.localeCompare(b.name));
    } else {
      return result.sort((a, b) => a.name.localeCompare(b.name));
    }
  }, [blueprints, search, showProfitableOnly, hideBpos, sortByShoppingCost, remainingWarehouse]);

  const toggleGroup = useCallback((name: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }, []);

  const addToQueue = useCallback((bp: BlueprintResult, chosenRuns: number) => {
    setQueue(prev => [
      ...prev,
      { id: Math.random().toString(36).slice(2), bp, chosen_runs: chosenRuns },
    ]);
    setBlueprints(prev => {
      if (bp.item_id !== undefined) {
        return prev.filter(b => b.item_id !== bp.item_id);
      }
      const idx = prev.findIndex(b =>
        b.blueprint_type_id === bp.blueprint_type_id &&
        b.me === bp.me && b.te === bp.te && b.runs === bp.runs
      );
      return idx >= 0 ? [...prev.slice(0, idx), ...prev.slice(idx + 1)] : prev;
    });
  }, []);

  const removeFromQueue = useCallback((id: string) => {
    setQueue(prev => {
      const item = prev.find(q => q.id === id);
      if (item) setBlueprints(bps => [...bps, item.bp]);
      return prev.filter(q => q.id !== id);
    });
  }, []);

  const updateQueueRuns = useCallback((id: string, runs: number) => {
    setQueue(prev => prev.map(item => {
      if (item.id !== id) return item;
      const max = item.bp.is_bpo ? 1 : item.bp.runs;
      const r = Math.min(Math.max(1, runs), max);
      return { ...item, chosen_runs: r };
    }));
  }, []);

  // Aggregate totals with linear scaling
  const { totalProfit, totalMatCost, totalRevenue, aggregatedMats } = useMemo(() => {
    let totalProfit = 0, totalMatCost = 0, totalRevenue = 0;
    const matMap: Record<number, { name: string; needed: number; unit_price: number }> = {};

    queue.forEach(({ bp, chosen_runs }) => {
      const scale = bp.runs > 0 ? chosen_runs / bp.runs : 1;
      totalProfit   += bp.profit        * scale;
      totalMatCost  += bp.material_cost * scale;
      totalRevenue  += bp.revenue       * scale;

      bp.materials.forEach(m => {
        if (!matMap[m.type_id]) matMap[m.type_id] = { name: m.name, needed: 0, unit_price: m.unit_price };
        matMap[m.type_id].needed += Math.ceil(m.quantity * scale);
      });
    });

    const aggregatedMats = Object.entries(matMap)
      .map(([tid, info]) => ({
        type_id:    parseInt(tid),
        name:       info.name,
        needed:     info.needed,
        in_stock:   warehouse[parseInt(tid)] || 0,
        unit_price: info.unit_price,
      }))
      .sort((a, b) => b.needed - a.needed);

    return { totalProfit, totalMatCost, totalRevenue, aggregatedMats };
  }, [queue, warehouse]);

  const shoppingList = useMemo(() =>
    aggregatedMats
      .map(m => ({ ...m, to_buy: Math.max(0, m.needed - (useWarehouse ? m.in_stock : 0)) }))
      .filter(m => m.to_buy > 0),
    [aggregatedMats, useWarehouse],
  );

  const purchaseCost = useMemo(() =>
    shoppingList.reduce((s, m) => s + m.to_buy * m.unit_price, 0),
    [shoppingList],
  );

  const multibuyText = shoppingList.map(m => `${m.name} ${m.to_buy}`).join("\n");

  const copyMultibuy = () => {
    if (!multibuyText) return;
    navigator.clipboard.writeText(multibuyText).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleSave = async () => {
    if (queue.length === 0) return;
    setSaving(true);
    try {
      const plan = await createPlan(`Simulated Plan (${new Date().toLocaleTimeString()})`);
      for (let i = 0; i < queue.length; i++) {
        const { bp, chosen_runs } = queue[i];
        await addPlanItem(plan.id, {
          blueprint_type_id: bp.blueprint_type_id,
          blueprint_name:    bp.blueprint_name,
          product_type_id:   bp.product_type_id,
          product_name:      bp.product_name,
          runs: chosen_runs,
          me:   bp.me,
          te:   bp.te,
          character_id: bp.character_ids?.[0] || null,
        });
      }
      onClose(plan);
    } catch (e: any) {
      alert("Failed to save plan: " + (e.response?.data?.detail || e.message));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="py-24 text-center text-eve-muted text-sm">Loading your blueprints…</div>;
  }

  return (
    <div className="space-y-4 font-eve">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-eve-text">Build Simulator</h1>
          <p className="text-[10px] uppercase text-eve-muted tracking-widest">
            Your owned blueprints · actual ME/TE · global facility settings
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => onClose()}
            className="px-3 py-1.5 bg-eve-bg border border-eve-border text-eve-muted
                       text-xs font-bold uppercase rounded hover:text-eve-text transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving || queue.length === 0}
            className="px-4 py-1.5 bg-eve-orange text-white text-xs font-bold uppercase rounded
                       disabled:opacity-50 shadow-lg shadow-eve-orange/20 hover:bg-eve-orange/90 transition-colors">
            {saving ? "Saving…" : `Save as Plan (${queue.length})`}
          </button>
        </div>
      </div>

      {/* Banners */}
      {noPrices && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded px-4 py-2 text-xs text-amber-400">
          ⚠ No manufacturing system configured in Settings — profit and cost will show as zero.
          Materials are still correct.
        </div>
      )}
      {loadError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded px-4 py-2 text-xs text-red-400">
          {loadError}
        </div>
      )}

      {/* Main grid */}
      {!loadError && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 h-[calc(100vh-280px)] min-h-[500px]">

          {/* LEFT: Owned Blueprint Panel */}
          <div className="lg:col-span-3 bg-eve-surface border border-eve-border rounded-lg flex flex-col overflow-hidden">
            <div className="p-3 border-b border-eve-border bg-eve-bg/50 flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <div className="text-[10px] uppercase font-bold text-eve-muted tracking-widest shrink-0">
                  Owned Blueprints
                </div>
                <span className="text-[9px] text-eve-muted/60">
                  {blueprints.length} bp{blueprints.length !== 1 ? "s" : ""}
                </span>
                <input
                  type="text"
                  placeholder="Filter name…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="flex-1 bg-eve-bg border border-eve-border rounded px-2 py-1
                             text-xs text-eve-text focus:outline-none focus:border-eve-orange transition-colors"
                />
              </div>
              <div className="flex items-center gap-4 border-t border-eve-border/30 pt-2">
                <label className="flex items-center gap-1.5 text-[10px] text-eve-muted cursor-pointer select-none">
                  <input type="checkbox" checked={showProfitableOnly}
                    onChange={e => setShowProfitableOnly(e.target.checked)}
                    className="accent-eve-orange" />
                  Profitable Only
                </label>
                <label className="flex items-center gap-1.5 text-[10px] text-eve-muted cursor-pointer select-none">
                  <input type="checkbox" checked={hideBpos}
                    onChange={e => setHideBpos(e.target.checked)}
                    className="accent-eve-orange" />
                  Hide BPOs
                </label>
                <label className="flex items-center gap-1.5 text-[10px] text-eve-muted cursor-pointer select-none group">
                  <input type="checkbox" checked={sortByShoppingCost}
                    onChange={e => setSortByShoppingCost(e.target.checked)}
                    className="accent-eve-orange" />
                  Sort by Shopping Cost
                  <span className="hidden group-hover:inline ml-1 text-[9px] text-eve-orange/60">
                    (Minimizes ISK to buy)
                  </span>
                </label>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
              {groups.length === 0 ? (
                <div className="py-12 text-center text-eve-muted text-xs italic">
                  {blueprints.length === 0 ? "No blueprints loaded." : "No blueprints match the filter."}
                </div>
              ) : (
                groups.map(group => (
                  <BpGroupRow
                    key={group.name}
                    group={group}
                    expanded={expandedGroups.has(group.name)}
                    noPrices={noPrices}
                    eligibilityMap={eligibilityMap}
                    onToggle={() => toggleGroup(group.name)}
                    onAdd={addToQueue}
                    sortByShoppingCost={sortByShoppingCost}
                  />
                ))
              )}
            </div>
          </div>

          {/* RIGHT: Queue + Materials */}
          <div className="lg:col-span-2 flex flex-col gap-4 overflow-hidden">

            {/* Build Queue */}
            <div className="bg-eve-surface border border-eve-border rounded-lg flex flex-col overflow-hidden shadow-sm"
                 style={{ flex: "0 1 auto", maxHeight: "50%" }}>
              <div className="p-3 border-b border-eve-border bg-eve-bg/50 flex justify-between items-center">
                <span className="text-[10px] uppercase font-bold text-eve-muted tracking-widest">
                  Build Queue — {queue.length} {queue.length === 1 ? "job" : "jobs"}
                </span>
                {queue.length > 0 && (
                  <button onClick={() => {
                    setBlueprints(prev => [...prev, ...queue.map(q => q.bp)]);
                    setQueue([]);
                  }}
                    className="text-[10px] text-eve-muted hover:text-red-400 uppercase transition-colors">
                    Clear All
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar">
                {queue.length === 0 ? (
                  <div className="h-full min-h-[100px] flex items-center justify-center">
                    <span className="text-eve-muted/40 text-[10px] uppercase tracking-widest italic">
                      Select blueprints from the left
                    </span>
                  </div>
                ) : (
                  <div className="p-2 space-y-1">
                    {queue.map(item => {
                      const scale = item.bp.runs > 0 ? item.chosen_runs / item.bp.runs : 1;
                      const profit = item.bp.profit * scale;
                      return (
                        <div key={item.id}
                          className="border border-eve-border/50 rounded px-3 py-2 flex items-center gap-2
                                     bg-eve-bg/40 hover:border-eve-orange/30 transition-colors">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[11px] font-bold text-eve-text truncate">
                                {item.bp.blueprint_name}
                              </span>
                              <div className="flex items-center bg-eve-bg border border-eve-border/40 rounded px-1 shrink-0">
                                <span className="text-[8px] text-eve-muted mr-0.5">×</span>
                                <input
                                  type="number" min="1" max={item.bp.is_bpo ? 999999 : item.bp.runs}
                                  value={item.chosen_runs}
                                  onChange={e => updateQueueRuns(item.id, parseInt(e.target.value) || 1)}
                                  className="w-10 bg-transparent text-[10px] font-bold text-eve-text focus:outline-none text-center"
                                />
                              </div>
                              <span className="text-[9px] text-eve-muted shrink-0">
                                ME{item.bp.me}/TE{item.bp.te}
                              </span>
                              <span className={`text-[9px] font-bold px-1 rounded shrink-0
                                               ${item.bp.is_bpo
                                                 ? "text-amber-400 bg-amber-400/10"
                                                 : "text-blue-400 bg-blue-400/10"}`}>
                                {item.bp.is_bpo ? "BPO" : "BPC"}
                              </span>
                              <CharacterMiniPortraits characters={eligibilityMap.get(item.bp.blueprint_type_id) ?? []} size={18} />
                            </div>
                            <div className="text-[9px] text-eve-muted">{item.bp.product_name}</div>
                          </div>
                          <div className="text-right shrink-0 min-w-[80px]">
                            {noPrices ? (
                              <span className="text-[10px] text-eve-muted">—</span>
                            ) : (
                              <>
                                <div className={`text-[11px] font-bold font-mono
                                                 ${profit >= 0 ? "text-green-400" : "text-red-400"}`}>
                                  {isk(profit)} ISK
                                </div>
                                <div className="text-[9px] text-eve-muted font-mono">
                                  {isk(item.bp.isk_per_hour)}/h
                                </div>
                              </>
                            )}
                          </div>
                          <button onClick={() => removeFromQueue(item.id)}
                            className="text-eve-muted hover:text-red-400 transition-colors px-1 text-base">
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {queue.length > 0 && (
                <div className="p-3 border-t border-eve-border bg-eve-bg/30 grid grid-cols-3 gap-3">
                  <div>
                    <div className="text-[9px] text-eve-muted uppercase tracking-wider">Mat Cost</div>
                    <div className="text-xs font-mono font-semibold text-eve-text">
                      {noPrices ? "—" : isk(totalMatCost) + " ISK"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] text-eve-muted uppercase tracking-wider">Revenue</div>
                    <div className="text-xs font-mono font-semibold text-eve-text">
                      {noPrices ? "—" : isk(totalRevenue) + " ISK"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] text-eve-muted uppercase tracking-wider">Total Profit</div>
                    <div className={`text-xs font-mono font-bold
                                     ${noPrices ? "text-eve-muted"
                                       : totalProfit >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {noPrices ? "—" : isk(totalProfit) + " ISK"}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Materials Panel */}
            <div className="bg-eve-surface border border-eve-border rounded-lg flex flex-col overflow-hidden shadow-sm"
                 style={{ flex: "1 1 0" }}>
              <div className="p-3 border-b border-eve-border bg-eve-bg/50 flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold text-eve-muted tracking-widest">
                  Materials — {aggregatedMats.length} types
                </span>
                <label className="flex items-center gap-2 text-[10px] text-eve-muted cursor-pointer select-none">
                  <input type="checkbox" checked={useWarehouse}
                    onChange={e => setUseWarehouse(e.target.checked)}
                    className="accent-eve-orange" />
                  Deduct Warehouse
                </label>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar">
                {aggregatedMats.length === 0 ? (
                  <div className="h-full min-h-[100px] flex items-center justify-center">
                    <span className="text-eve-muted/40 text-[10px] uppercase tracking-widest italic">
                      Queue jobs to see materials
                    </span>
                  </div>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="sticky top-0">
                      <tr className="border-b border-eve-border bg-eve-bg">
                        <th className="px-3 py-1.5 text-left text-[10px] text-eve-muted">Material</th>
                        <th className="px-3 py-1.5 text-right text-[10px] text-eve-muted">Needed</th>
                        {useWarehouse && (
                          <th className="px-3 py-1.5 text-right text-[10px] text-eve-muted">In Stock</th>
                        )}
                        <th className="px-3 py-1.5 text-right text-[10px] text-eve-muted">To Buy</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aggregatedMats.map(m => {
                        const toBuy = useWarehouse ? Math.max(0, m.needed - m.in_stock) : m.needed;
                        return (
                          <tr key={m.type_id}
                            className="border-b border-eve-border/20 hover:bg-eve-bg/30">
                            <td className="px-3 py-1 flex items-center gap-1.5">
                              <img
                                src={`https://images.evetech.net/types/${m.type_id}/icon?size=32`}
                                alt="" className="w-4 h-4 rounded shrink-0"
                                onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                              />
                              <span className="text-eve-text truncate">{m.name}</span>
                            </td>
                            <td className="px-3 py-1 text-right font-mono text-eve-muted">
                              {fmtNum(m.needed)}
                            </td>
                            {useWarehouse && (
                              <td className="px-3 py-1 text-right font-mono text-blue-400">
                                {fmtNum(m.in_stock)}
                              </td>
                            )}
                            <td className={`px-3 py-1 text-right font-mono font-semibold
                                            ${toBuy > 0 ? "text-eve-orange" : "text-green-500"}`}>
                              {fmtNum(toBuy)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {shoppingList.length > 0 && (
                <div className="p-2 border-t border-eve-border bg-eve-bg/30 space-y-2">
                  {!noPrices && (
                    <div className="flex items-center justify-between px-1">
                      <span className="text-[9px] text-eve-muted uppercase tracking-wider">Purchase Cost</span>
                      <span className="text-xs font-mono font-semibold text-eve-orange">
                        {isk(purchaseCost)} ISK
                      </span>
                    </div>
                  )}
                  <button onClick={copyMultibuy}
                    className="w-full px-3 py-1.5 bg-eve-orange/10 hover:bg-eve-orange border
                               border-eve-orange/30 hover:border-eve-orange text-eve-orange
                               hover:text-white text-xs font-bold uppercase rounded transition-all">
                    {copied ? "✓ Copied!" : `Copy Multibuy (${shoppingList.length} types)`}
                  </button>
                </div>
              )}
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plans list (main page)
// ---------------------------------------------------------------------------
export default function PlansPage({ character }: Props) {
  const charSkillData = useCharacterSkillData();
  const charNameMap = useMemo(() =>
    new Map(charSkillData.map(c => [c.character_id, c.character_name])),
  [charSkillData]);

  const [plans, setPlans]           = useState<Plan[]>([]);

  const [selected, setSelected] = useState<Plan | null>(null);
  const [newName, setNewName]   = useState("");
  const [creating, setCreating] = useState(false);
  const [simMode, setSimMode]   = useState(false);

  const [suggestResult, setSuggestResult]   = useState<SuggestResult | null>(null);
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const [maxIsk, setMaxIsk]                 = useState<string>("1000"); // in Millions
  const [maxItems, setMaxItems]             = useState<string>("");

  const loadPlans = () => {
    fetchPlans()
      .then(setPlans)
      .catch((e) => {
        console.error("Failed to load plans:", e);
        alert("Failed to load plans: " + (e.response?.data?.detail || e.message));
      });
  };

  useEffect(() => { loadPlans(); }, []);

  const handleSuggest = async (strategy: string) => {
    setLoadingSuggest(true);
    setSuggestResult(null);
    try {
      const iskLimit = parseFloat(maxIsk) * 1_000_000;
      const itemCount = maxItems ? parseInt(maxItems) : undefined;
      const res = await fetchSuggestedPlan(strategy, iskLimit, itemCount);
      setSuggestResult(res);
    } catch (e: any) {
      alert(e.message || "Failed to get suggestions");
    } finally {
      setLoadingSuggest(false);
    }
  };

  const handleSaveSuggested = async () => {
    if (!suggestResult || suggestResult.suggested_items.length === 0) return;
    setCreating(true);
    try {
      const name = `Auto Plan (${suggestResult.strategy} @ ${new Date().toLocaleTimeString()})`;
      const plan = await createPlan(name);
      for (const item of suggestResult.suggested_items) {
        await addPlanItem(plan.id, {
          blueprint_type_id: item.blueprint_type_id,
          blueprint_name:    item.blueprint_name,
          product_type_id:   item.product_type_id,
          product_name:      item.product_name,
          runs: item.runs, me: item.me, te: item.te,
          character_id: item.character_ids?.[0] || null,
        });
      }
      setSuggestResult(null);
      loadPlans();
    } finally {
      setCreating(false);
    }
  };

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

  if (simMode) {
    return (
      <div className="min-h-screen bg-eve-bg font-eve">
        <Navbar character={character} />
        <main className="max-w-screen-2xl mx-auto px-4 py-6">
          <SimulationMode onClose={(plan) => { setSimMode(false); loadPlans(); if (plan) setSelected(plan); }} />
        </main>
      </div>
    );
  }

  if (selected) {
    return (
      <div className="min-h-screen bg-eve-bg font-eve">
        <Navbar character={character} />
        <main className="max-w-screen-lg mx-auto px-4 py-6">
          <PlanDetail 
            plan={selected} 
            charNameMap={charNameMap}
            onClose={() => setSelected(null)} 
            onRename={(p) => {
              const name = prompt("Enter new plan name:", p.name);
              if (name && name.trim()) {
                fetchPlanRename(p.id, name.trim()).then(() => {
                  setSelected({...p, name: name.trim()});
                  loadPlans();
                });
              }
            }}
            onDelete={(id) => {
              deletePlan(id).then(() => {
                setSelected(null);
                loadPlans();
              });
            }}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-eve-bg font-eve">
      <Navbar character={character} />

      <main className="max-w-screen-lg mx-auto px-4 py-6 space-y-5">
        <div className="flex justify-between items-center">
          <h1 className="text-lg font-semibold text-eve-text">Plans</h1>
          <button
            onClick={() => setSimMode(true)}
            className="bg-eve-orange hover:bg-eve-orange/90 text-white text-xs font-bold uppercase
                       px-4 py-2 rounded shadow-lg transition-all active:scale-95">
            Start Build Simulator
          </button>
        </div>

        <div className="bg-eve-surface border border-eve-border rounded-lg p-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-eve-muted mb-3">
            New Plan
          </h2>
          <div className="flex gap-3 items-end">
            <label className="flex-1 flex flex-col gap-1">
              <span className="text-xs text-eve-muted">Plan Name</span>
              <input type="text" value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                placeholder="e.g. Weekly Rig Production"
                className="w-full bg-eve-bg border border-eve-border rounded px-3 py-1.5
                           text-sm text-eve-text focus:outline-none focus:border-eve-orange" />
            </label>
            <button onClick={handleCreate} disabled={!newName.trim() || creating}
              className="px-5 py-1.5 bg-eve-orange hover:bg-eve-orange/90
                         disabled:opacity-40 disabled:cursor-not-allowed
                         text-white text-sm font-semibold rounded transition-colors">
              {creating ? "Creating…" : "Create"}
            </button>
          </div>
        </div>

        <div className="bg-eve-surface border border-eve-border rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-eve-muted">
              Auto-Suggest Plan
            </h2>
            <div className="text-[10px] text-eve-muted uppercase">Fill open character slots</div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-eve-muted uppercase">Max ISK to buy (Millions)</span>
              <input type="number" value={maxIsk}
                onChange={(e) => setMaxIsk(e.target.value)}
                className="bg-eve-bg border border-eve-border rounded px-2 py-1 text-xs text-eve-text focus:outline-none focus:border-eve-orange" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-eve-muted uppercase">Max items to build</span>
              <input type="number" value={maxItems}
                onChange={(e) => setMaxItems(e.target.value)}
                placeholder="Optional"
                className="bg-eve-bg border border-eve-border rounded px-2 py-1 text-xs text-eve-text focus:outline-none focus:border-eve-orange" />
            </label>
          </div>

          <div className="flex gap-3">
            <button onClick={() => handleSuggest("profit")} disabled={loadingSuggest || creating}
              className="flex-1 px-4 py-2 bg-eve-bg border border-eve-orange/30 hover:border-eve-orange
                         text-eve-orange text-xs font-bold rounded transition-colors">
              {loadingSuggest ? "Finding…" : "Most Profitable"}
            </button>
            <button onClick={() => handleSuggest("materials")} disabled={loadingSuggest || creating}
              className="flex-1 px-4 py-2 bg-eve-bg border border-eve-blue/30 hover:border-eve-blue
                         text-eve-blue text-xs font-bold rounded transition-colors">
              {loadingSuggest ? "Finding…" : "Minimum Materials"}
            </button>
          </div>

          {suggestResult && (
            <div className="bg-eve-bg/50 border border-eve-border rounded p-3 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-eve-muted">
                  Found <span className="text-eve-text font-bold">{suggestResult.suggested_items.length}</span> items
                  for <span className="text-eve-text font-bold">{suggestResult.open_slots}</span> open slots
                </span>
                <button onClick={handleSaveSuggested} disabled={creating}
                  className="text-eve-orange font-bold uppercase hover:underline">
                  {creating ? "Saving…" : "Save as Plan"}
                </button>
              </div>
              <div className="space-y-1">
                {suggestResult.suggested_items.map((item, idx) => (
                  <div key={idx}
                    className="flex items-center justify-between text-[11px] border-b border-eve-border/30 pb-1">
                    <div className="flex items-center gap-2 truncate max-w-[200px]">
                      <span className="text-eve-text truncate">{item.blueprint_name}</span>
                      {item.character_ids && item.character_ids.length > 0 && (
                        <OwnerPortraits ids={item.character_ids} nameMap={charNameMap} size={14} />
                      )}
                    </div>
                    <span className="text-eve-muted">
                      {suggestResult.strategy === "profit"
                        ? `${isk(item.isk_per_hour)}/h`
                        : `${isk(item.profit)} profit`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {plans.length === 0 ? (
          <div className="text-center py-16 text-eve-muted text-sm">
            No plans yet. Create one above or launch the Build Simulator.
          </div>
        ) : (
          <div className="space-y-2">
            {plans.map((plan) => (
              <div key={plan.id} onClick={() => setSelected(plan)}
                className="flex items-center gap-3 bg-eve-surface border border-eve-border
                           rounded-lg px-4 py-3 cursor-pointer hover:border-eve-orange/40
                           hover:bg-eve-surface/80 transition-colors group">
                <div className="flex-1">
                  <div className="text-sm font-semibold text-eve-text">{plan.name}</div>
                  <div className="text-xs text-eve-muted">
                    Created {new Date(plan.created_at * 1000).toLocaleDateString()}
                  </div>
                </div>
                <button onClick={(e) => handleDelete(plan.id, e)}
                  className="text-eve-muted hover:text-red-400 transition-colors
                             opacity-0 group-hover:opacity-100 px-2 text-sm">
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
