import React, { useState, useMemo } from "react";
import type { BlueprintResult, MarketStats, SortKey } from "../types";
import { useEligibilityMap, useCharacterSkillData } from "../hooks/useEligibleCharacters";
import { CharacterMiniPortraits } from "./CharacterMiniPortraits";
import { OwnerPortraits } from "./OwnerPortraits";

interface Props {
  blueprints:  BlueprintResult[];
  showGroups?: boolean;
  activity?:   string;
}

const ISK_FORMAT = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const PCT_FORMAT = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function fmtISK(val: number) {
  return ISK_FORMAT.format(val) + " ISK";
}

function fmtVol(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(0);
}

const TREND = {
  up:   { icon: "↑", cls: "text-green-400" },
  down: { icon: "↓", cls: "text-red-400"   },
  flat: { icon: "→", cls: "text-eve-muted/50" },
} as const;

function getTechColorClass(bpName: string, product_name: string, techLevel?: number) {
  if (techLevel === 3) return "text-red-500";
  if (techLevel === 2) return "text-eve-orange";

  const name = (bpName + " " + product_name).toLowerCase();
  // T3 Heuristics
  const t3Keywords = ["proteus", "tengu", "legion", "loki", "confessor", "svipul", "jackdaw", "hecate", "subsystem"];
  if (name.includes(" iii ") || name.endsWith(" iii") || name.includes(" iii blueprint") || t3Keywords.some(k => name.includes(k))) {
    return "text-red-500";
  }
  // T2 Heuristics
  if (name.includes(" ii ") || name.endsWith(" ii") || name.includes(" ii blueprint")) {
    return "text-eve-orange";
  }
  return "text-eve-text";
}

export default function BlueprintTable({ blueprints, activity, showGroups }: Props) {
  const [sortKey, setSortKey]     = useState<SortKey>("profit");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const eligibilityMap = useEligibilityMap(activity ? blueprints : []);
  const colCount = activity ? 7 : 6;
  const charSkillData = useCharacterSkillData();
  const charNameMap = useMemo(() =>
    new Map(charSkillData.map(c => [c.character_id, c.character_name])),
  [charSkillData]);

  // Category Filtering
  const categories = useMemo(() => {
    const cats = new Set<string>();
    blueprints.forEach(b => { if (b.category_name) cats.add(b.category_name); });
    return Array.from(cats).sort();
  }, [blueprints]);

  // All categories are enabled (selected) by default
  const [deselectedCategories, setDeselectedCategories] = useState<string[]>([]);

  const handleToggleCategory = (cat: string) => {
    setDeselectedCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };

  const processedItems = useMemo(() => {
    let filtered = blueprints;
    if (deselectedCategories.length > 0) {
      filtered = filtered.filter(b => !b.category_name || !deselectedCategories.includes(b.category_name));
    }

    if (showGroups) {
      const grouped: Record<string, any> = {};
      filtered.forEach(bp => {
        const name = bp.blueprint_name.replace(" (Potential)", "");
        if (!grouped[name]) {
          grouped[name] = {
            ...bp,
            blueprint_name: name,
            is_group: true,
            variants: [],
            total_profit: 0,
            total_isk_per_hour: 0,
            total_margin_pct: 0,
            runs: 0,
            character_ids: [],
          };
        }
        grouped[name].variants.push(bp);
        grouped[name].profit += bp.profit;
        grouped[name].isk_per_hour += bp.isk_per_hour;
        grouped[name].runs += bp.runs;
        if (bp.character_ids) {
          bp.character_ids.forEach(cid => {
            if (!grouped[name].character_ids.includes(cid)) {
              grouped[name].character_ids.push(cid);
            }
          });
        }
      });

      // Calculate averages for margin
      Object.values(grouped).forEach(g => {
        if (g.variants.length > 0) {
          g.margin_pct = g.variants.reduce((acc: number, v: any) => acc + v.margin_pct, 0) / g.variants.length;
        }
      });

      const list = Object.values(grouped);
      return list.sort((a, b) => {
        let valA = a[sortKey];
        let valB = b[sortKey];

        if (sortKey === "blueprint_name") {
          const strA = (valA || "").toString().toLowerCase();
          const strB = (valB || "").toString().toLowerCase();
          if (strA < strB) return sortOrder === "asc" ? -1 : 1;
          if (strA > strB) return sortOrder === "asc" ? 1 : -1;
          return 0;
        }

        const numA = Number(valA) || 0;
        const numB = Number(valB) || 0;
        if (numA < numB) return sortOrder === "asc" ? -1 : 1;
        if (numA > numB) return sortOrder === "asc" ? 1 : -1;
        return 0;
      });
    }

    // Individual mode
    return [...filtered].sort((a, b) => {
      let valA = a[sortKey];
      let valB = b[sortKey];

      if (sortKey === "blueprint_name") {
        const strA = (valA || "").toString().toLowerCase();
        const strB = (valB || "").toString().toLowerCase();
        if (strA < strB) return sortOrder === "asc" ? -1 : 1;
        if (strA > strB) return sortOrder === "asc" ? 1 : -1;
        return 0;
      }

      const numA = Number(valA) || 0;
      const numB = Number(valB) || 0;
      if (numA < numB) return sortOrder === "asc" ? -1 : 1;
      if (numA > numB) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });
  }, [blueprints, sortKey, sortOrder, deselectedCategories, showGroups]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortOrder("desc");
    }
  };

  const toggleExpand = (bp: any) => {
    const id = bp.is_group 
      ? `group-${bp.blueprint_name}`
      : `${bp.blueprint_type_id}-${bp.me}-${bp.te}-${bp.decryptor_name || ""}`;
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <div className="space-y-4">
      {/* Category Filter Chips */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2 py-2">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => handleToggleCategory(cat)}
              className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase transition-all border ${
                !deselectedCategories.includes(cat)
                  ? "bg-eve-orange text-white border-eve-orange"
                  : "bg-eve-surface text-eve-muted border-eve-border hover:border-eve-muted"
              }`}
            >
              {cat}
            </button>
          ))}
          {deselectedCategories.length > 0 && (
            <button
              onClick={() => setDeselectedCategories([])}
              className="px-3 py-1 text-[10px] font-bold uppercase text-red-400 hover:text-red-300 transition-colors"
            >
              Reset Filters
            </button>
          )}
        </div>
      )}

      <div className="bg-eve-surface border border-eve-border rounded-lg overflow-hidden shadow-xl">
        <table className="w-full text-left text-sm border-collapse">
          <thead>
            <tr className="bg-eve-bg/50 text-eve-muted text-[10px] uppercase tracking-wider font-bold border-b border-eve-border">
              <th className="px-4 py-3 cursor-pointer hover:text-eve-text" onClick={() => toggleSort("blueprint_name")}>
                Blueprint / Category {sortKey === "blueprint_name" && (sortOrder === "asc" ? "↑" : "↓")}
              </th>
              <th className="px-4 py-3 text-right">Runs</th>
              <th className="px-4 py-3 text-right cursor-pointer hover:text-eve-text" onClick={() => toggleSort("profit")}>
                Total Profit {sortKey === "profit" && (sortOrder === "asc" ? "↑" : "↓")}
              </th>
              <th className="px-4 py-3 text-right cursor-pointer hover:text-eve-text" onClick={() => toggleSort("shopping_cost")}>
                Shopping {sortKey === "shopping_cost" && (sortOrder === "asc" ? "↑" : "↓")}
              </th>
              <th className="px-4 py-3 text-right cursor-pointer hover:text-eve-text" onClick={() => toggleSort("warehouse_value_used")}>
                Warehouse {sortKey === "warehouse_value_used" && (sortOrder === "asc" ? "↑" : "↓")}
              </th>
              <th className="px-4 py-3 text-right cursor-pointer hover:text-eve-text" onClick={() => toggleSort("margin_pct")}>
                Margin {sortKey === "margin_pct" && (sortOrder === "asc" ? "↑" : "↓")}
              </th>
              <th className="px-4 py-3 text-right cursor-pointer hover:text-eve-text" onClick={() => toggleSort("isk_per_hour")}>
                ISK/Hr {sortKey === "isk_per_hour" && (sortOrder === "asc" ? "↑" : "↓")}
              </th>
              {activity && <th className="px-3 py-3 text-center">Who</th>}
              <th className="px-2 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-eve-border/50">
            {processedItems.map((bp) => {
              const rowId = bp.is_group 
                ? `group-${bp.blueprint_name}`
                : `${bp.blueprint_type_id}-${bp.me}-${bp.te}-${bp.decryptor_name || ""}`;
              const isExpanded = expandedId === rowId;
              const cleanBpName = bp.blueprint_name.replace(" (Potential)", "");
              const eligible = activity ? (eligibilityMap.get(bp.blueprint_type_id) ?? []) : [];

              if (bp.is_group) {
                return (
                  <React.Fragment key={rowId}>
                    <tr
                      className={`group hover:bg-white/5 transition-colors cursor-pointer ${isExpanded ? "bg-white/5 text-eve-orange" : ""}`}
                      onClick={() => toggleExpand(bp)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2">
                            <span className={`font-semibold group-hover:text-eve-orange transition-colors ${getTechColorClass(bp.blueprint_name, bp.product_name || "", bp.tech_level)}`}>
                              {cleanBpName}
                            </span>
                            <span className="text-[10px] bg-eve-bg px-1.5 py-0.5 rounded border border-eve-border text-eve-muted font-bold uppercase">
                              {bp.variants.length} Variant{bp.variants.length !== 1 ? "s" : ""}
                            </span>
                            {bp.character_ids && bp.character_ids.length > 0 && (
                              <OwnerPortraits ids={bp.character_ids} nameMap={charNameMap} />
                            )}
                          </div>
                          <div className="flex gap-2 text-[10px] mt-0.5">
                            <span className="text-eve-muted font-bold uppercase">{bp.category_name}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-eve-muted font-medium">
                        {bp.runs}
                        {activity === "invent" && bp.base_bpc_info?.count > 0 && (
                          <div className="text-[10px] text-green-400 font-bold">
                            {bp.base_bpc_info.count} BPCs
                          </div>
                        )}
                      </td>
                      <td className={`px-4 py-3 text-right font-bold ${bp.profit > 0 ? "text-green-400" : "text-red-400"}`}>
                        <div className="flex flex-col">
                          <span>{fmtISK(bp.profit)}</span>
                          {bp.profit_per_run && (
                            <span className="text-[10px] text-eve-muted font-normal">
                              {fmtISK(bp.profit_per_run)} / run
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-red-400 font-mono text-[11px]">
                        {bp.shopping_cost > 0 ? fmtISK(bp.shopping_cost) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-green-400 font-mono text-[11px]">
                        {bp.warehouse_value_used > 0 ? fmtISK(bp.warehouse_value_used) : "—"}
                      </td>
                      <td className={`px-4 py-3 text-right font-medium ${bp.margin_pct > 0 ? "text-green-500/80" : "text-red-500/80"}`}>
                        {PCT_FORMAT.format(bp.margin_pct)}%
                      </td>
                      <td className="px-4 py-3 text-right text-eve-text font-medium">
                        {fmtISK(bp.isk_per_hour)}
                      </td>
                      {activity && (
                        <td className="px-3 py-3">
                          {/* Aggregate eligibility: anyone who can do any variant */}
                        </td>
                      )}
                      <td className="px-2 py-3 text-right">
                        <span className="text-eve-muted text-xs">{isExpanded ? "−" : "+"}</span>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-eve-bg/30">
                        <td colSpan={colCount} className="px-0 py-0 border-b border-eve-border">
                          <div className="bg-eve-bg/50 px-4 py-3">
                            <div className="text-[10px] font-bold uppercase tracking-widest text-eve-muted mb-3 pb-1 border-b border-eve-border/30">
                              Blueprint Variants
                            </div>
                            <div className="space-y-2">
                              {bp.variants.map((v: any) => {
                                const vEligible = activity ? (eligibilityMap.get(v.blueprint_type_id) ?? []) : [];
                                return (
                                  <div key={`${v.blueprint_type_id}-${v.me}-${v.te}-${v.decryptor_name || ""}`} 
                                       className="flex flex-col bg-eve-surface/50 border border-eve-border/30 rounded px-3 py-2 text-xs">
                                    <div className="flex items-center justify-between mb-2">
                                      <div className="flex flex-col gap-0.5">
                                        <div className="flex items-center gap-2">
                                          <span className={v.is_bpo ? "text-green-500 font-bold uppercase text-[9px]" : "text-yellow-500 font-bold uppercase text-[9px]"}>
                                            {v.is_bpo ? "BPO" : "BPC"}
                                          </span>
                                          <span className="text-blue-400 text-[10px]">ME {v.me}</span>
                                          <span className="text-purple-400 text-[10px]">TE {v.te}</span>
                                          {v.decryptor_name && <span className="text-eve-orange text-[10px]">D: {v.decryptor_name}</span>}
                                          <span className="text-eve-muted">· {v.runs} runs</span>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-6">
                                        <div className="text-right">
                                          <div className={`font-bold ${v.profit > 0 ? "text-green-400" : "text-red-400"}`}>{fmtISK(v.profit)}</div>
                                          <div className="text-[10px] text-eve-muted">{PCT_FORMAT.format(v.margin_pct)}% margin</div>
                                        </div>
                                        <div className="text-right w-24">
                                          <div className="font-medium text-eve-text">{fmtISK(v.isk_per_hour)}/h</div>
                                        </div>
                                        {activity && (
                                          <div className="w-20 flex justify-center">
                                            <CharacterMiniPortraits characters={vEligible} size={18} />
                                          </div>
                                        )}
                                      </div>
                                    </div>

                                    {(activity === "invent" || v.is_invention) && (
                                      <div className="border-t border-eve-border/20 pt-2 mt-1 grid grid-cols-2 gap-4">
                                        <div>
                                          <div className="text-[9px] uppercase text-eve-muted font-bold mb-1">Invention Materials</div>
                                          <div className="flex flex-wrap gap-x-3 gap-y-1">
                                            {v.invent_materials?.map((m: any) => (
                                              <span key={m.type_id} className="text-[10px] text-eve-text whitespace-nowrap">
                                                {m.quantity}x {m.name}
                                              </span>
                                            ))}
                                          </div>
                                        </div>
                                        <div className="flex justify-end items-center gap-4">
                                          <div className="text-right">
                                            <div className="text-[9px] uppercase text-eve-muted font-bold">Source BPCs</div>
                                            <div className={`text-[10px] font-bold ${v.base_bpc_info?.count > 0 ? "text-green-400" : "text-red-400"}`}>
                                              {v.base_bpc_info?.count || 0} ({v.base_bpc_info?.runs || 0} runs)
                                            </div>
                                          </div>
                                          <div className="text-right">
                                            <div className="text-[9px] uppercase text-eve-muted font-bold">Success</div>
                                            <div className="text-[10px] font-bold text-blue-400">
                                              {Math.round((v.base_probability || 0) * 100)}%
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              }

              return (
                <React.Fragment key={rowId}>
                  <tr
                    className={`group hover:bg-white/5 transition-colors cursor-pointer ${isExpanded ? "bg-white/5" : ""}`}
                    onClick={() => toggleExpand(bp)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className={`font-semibold group-hover:text-eve-orange transition-colors ${getTechColorClass(bp.blueprint_name, bp.product_name, bp.tech_level)}`}>
                            {cleanBpName}
                          </span>
                          {bp.character_ids && bp.character_ids.length > 0 && (
                            <OwnerPortraits ids={bp.character_ids} nameMap={charNameMap} />
                          )}
                        </div>
                        <div className="flex gap-2 text-[10px] mt-0.5">
                          <span className="text-eve-muted font-bold uppercase">{bp.category_name}</span>
                          <span className="text-blue-400">ME {bp.me}</span>
                          <span className="text-purple-400">TE {bp.te}</span>
                          {bp.decryptor_name && <span className="text-eve-orange">D: {bp.decryptor_name}</span>}
                          {bp.is_invention ? (
                            <span className="text-purple-400 font-bold uppercase">Potential</span>
                          ) : (
                            bp.is_bpo ? <span className="text-green-500 font-bold uppercase">BPO</span> : <span className="text-yellow-500 font-bold uppercase">BPC</span>
                          )}
                        </div>
                        {bp.market_stats && bp.market_stats.vol_7d > 0 && (
                          <MarketStatsInline stats={bp.market_stats} />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-eve-muted font-medium">
                      {bp.runs}
                      {activity === "invent" && bp.base_bpc_info?.count > 0 && (
                        <div className="text-[10px] text-green-400 font-bold">
                          {bp.base_bpc_info.count} BPCs
                        </div>
                      )}
                    </td>
                    <td className={`px-4 py-3 text-right font-bold ${bp.profit > 0 ? "text-green-400" : "text-red-400"}`}>
                      <div className="flex flex-col">
                        <span>{fmtISK(bp.profit)}</span>
                        {bp.profit_per_run && (
                          <span className="text-[10px] text-eve-muted font-normal">
                            {fmtISK(bp.profit_per_run)} / run
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-red-400 font-mono text-[11px]">
                      {bp.shopping_cost > 0 ? fmtISK(bp.shopping_cost) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-green-400 font-mono text-[11px]">
                      {bp.warehouse_value_used > 0 ? fmtISK(bp.warehouse_value_used) : "—"}
                    </td>
                    <td className={`px-4 py-3 text-right font-medium ${bp.margin_pct > 0 ? "text-green-500/80" : "text-red-500/80"}`}>
                      {PCT_FORMAT.format(bp.margin_pct)}%
                    </td>
                    <td className="px-4 py-3 text-right text-eve-text font-medium">
                      {fmtISK(bp.isk_per_hour)}
                    </td>
                    {activity && (
                      <td className="px-3 py-3">
                        <CharacterMiniPortraits characters={eligible} size={22} />
                      </td>
                    )}
                    <td className="px-2 py-3 text-right">
                      <span className="text-eve-muted text-xs">{isExpanded ? "−" : "+"}</span>
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr className="bg-eve-bg/30">
                      <td colSpan={colCount} className="px-4 py-6 border-b border-eve-border">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                          {/* Unit breakdown */}
                          <div className="space-y-4">
                            <h4 className="text-[10px] font-bold uppercase tracking-widest text-eve-muted border-b border-eve-border/30 pb-1">
                              Profit Breakdown
                            </h4>
                            <div className="grid grid-cols-3 gap-3">
                              <ExpandCard label="Single Item" value={fmtISK(bp.profit / Math.max(1, bp.product_quantity))} />
                              <ExpandCard label="Single Run" value={fmtISK(bp.profit / Math.max(1, bp.runs))} />
                              <ExpandCard label="Full Job" value={fmtISK(bp.profit)} />
                            </div>
                            <div className="grid grid-cols-2 gap-3 mt-4">
                                <ExpandCard label="Unit Revenue" value={fmtISK(bp.sell_price)} />
                                <ExpandCard label="Unit Cost" value={fmtISK(bp.total_cost / Math.max(1, bp.product_quantity))} />
                            </div>
                          </div>

                          {/* Material list */}
                          <div className="space-y-4">
                            <h4 className="text-[10px] font-bold uppercase tracking-widest text-eve-muted border-b border-eve-border/30 pb-1">
                              Required Materials (for {bp.runs} runs)
                            </h4>
                            <div className="space-y-1.5">
                              {bp.materials.map((mat: any) => (
                                <div key={mat.type_id} className="flex justify-between text-xs group/mat py-0.5">
                                  <div className="flex flex-col">
                                    <span className="text-eve-text group-hover/mat:text-eve-orange transition-colors">
                                      {mat.name}
                                    </span>
                                    {mat.in_stock !== undefined && (
                                      <div className="flex gap-2 text-[9px] uppercase font-bold">
                                        <span className="text-eve-muted/80">Stock: <span className={mat.in_stock >= mat.quantity ? "text-green-400" : "text-yellow-500"}>{mat.in_stock.toLocaleString()}</span></span>
                                        {mat.to_buy > 0 && (
                                          <span className="text-red-400">Missing: {mat.to_buy.toLocaleString()}</span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex gap-4 items-center">
                                    <span className="text-eve-muted">
                                      {mat.quantity.toLocaleString()} × {fmtISK(mat.unit_price)}
                                    </span>
                                    <span className="text-eve-text font-medium min-w-[100px] text-right">
                                      {fmtISK(mat.total_cost)}
                                    </span>
                                  </div>
                                </div>
                              ))}
                              <div className="pt-2 mt-2 border-t border-eve-border/30 flex justify-between font-bold">
                                <span className="text-eve-muted uppercase text-[10px]">Total Material Cost</span>
                                <span className="text-eve-orange">{fmtISK(bp.material_cost)}</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Market data row */}
                        {bp.market_stats && bp.market_stats.vol_7d > 0 && (
                          <MarketStatsExpanded stats={bp.market_stats} />
                        )}

                        {/* Invention data row */}
                        {(activity === "invent" || bp.is_invention) && (
                          <div className="mt-8 pt-6 border-t border-eve-border/30 grid grid-cols-1 lg:grid-cols-2 gap-8">
                             {/* Invention Materials */}
                             <div className="space-y-4">
                               <h4 className="text-[10px] font-bold uppercase tracking-widest text-eve-muted border-b border-eve-border/30 pb-1 flex justify-between items-center">
                                 <span>Invention Materials</span>
                                 <span className="text-eve-orange">{fmtISK(bp.invent_cost || 0)}</span>
                               </h4>
                               <div className="space-y-1.5">
                                 {bp.invent_materials?.map((mat: any) => (
                                   <div key={mat.type_id} className="flex justify-between text-xs group/mat py-0.5">
                                      <div className="flex flex-col">
                                        <span className="text-eve-text group-hover/mat:text-eve-orange transition-colors">
                                          {mat.name}
                                        </span>
                                      </div>
                                     <div className="flex gap-4 items-center">
                                       <span className="text-eve-muted">
                                         {mat.quantity.toLocaleString()} × {fmtISK(mat.unit_price)}
                                       </span>
                                       <span className="text-eve-text font-medium min-w-[100px] text-right">
                                         {fmtISK(mat.total_cost)}
                                       </span>
                                     </div>
                                   </div>
                                 ))}
                                 {(!bp.invent_materials || bp.invent_materials.length === 0) && (
                                   <div className="text-eve-muted italic text-xs">No invention materials data found.</div>
                                 )}
                               </div>
                             </div>

                             {/* Base BPC Info */}
                             <div className="space-y-4">
                               <h4 className="text-[10px] font-bold uppercase tracking-widest text-eve-muted border-b border-eve-border/30 pb-1">
                                 Source Blueprint Status
                               </h4>
                               <div className="bg-eve-bg/50 border border-eve-border/30 rounded p-4 space-y-4">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs text-eve-muted uppercase font-bold">Owned Source BPCs</span>
                                    <span className={`text-sm font-bold ${bp.base_bpc_info?.count > 0 ? "text-green-400" : "text-red-400"}`}>
                                      {bp.base_bpc_info?.count || 0}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs text-eve-muted uppercase font-bold">Total Source Runs</span>
                                    <span className="text-sm font-bold text-eve-text">
                                      {bp.base_bpc_info?.runs || 0}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between border-t border-eve-border/20 pt-4 mt-2">
                                    <span className="text-xs text-eve-muted uppercase font-bold">Base Success Chance</span>
                                    <span className="text-sm font-bold text-blue-400">
                                      {Math.round((bp.base_probability || 0) * 100)}%
                                    </span>
                                  </div>
                               </div>
                             </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExpandCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-eve-surface rounded px-3 py-2 border border-eve-border/50 shadow-inner">
      <div className="text-[10px] uppercase font-bold text-eve-muted mb-0.5">{label}</div>
      <div className="text-eve-text font-medium">{value}</div>
    </div>
  );
}

function MarketStatsInline({ stats }: { stats: MarketStats }) {
  const t = TREND[stats.trend];
  return (
    <div className="flex items-center gap-1.5 text-[9px] mt-0.5 text-eve-muted/60">
      <span className={`font-bold ${t.cls}`}>{t.icon}</span>
      <span>{fmtVol(stats.vol_1d)}/d</span>
      <span className="text-eve-muted/30">·</span>
      <span>7d: {fmtVol(stats.vol_7d)}</span>
      <span className="text-eve-muted/30">·</span>
      <span>avg {fmtVol(stats.avg_daily)}/d</span>
      <span className="text-eve-muted/30">·</span>
      <span className="text-eve-muted/80">
        {new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(stats.avg_price)} ISK
      </span>
    </div>
  );
}

function MarketStatsExpanded({ stats }: { stats: MarketStats }) {
  const t = TREND[stats.trend];
  const trendLabel = { up: "Rising", down: "Falling", flat: "Stable" }[stats.trend];
  const fmtCompact = (v: number) =>
    new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v);

  return (
    <div className="mt-6 pt-4 border-t border-eve-border/30 space-y-2">
      <h4 className="text-[10px] font-bold uppercase tracking-widest text-eve-muted pb-1">
        Market Liquidity
      </h4>
      <div className="grid grid-cols-5 gap-3">
        <ExpandCard label="Yesterday Vol"  value={fmtVol(stats.vol_1d)} />
        <ExpandCard label="7-Day Vol"      value={fmtVol(stats.vol_7d)} />
        <ExpandCard label="Avg Daily"      value={fmtVol(stats.avg_daily)} />
        <ExpandCard label="Avg Price"      value={fmtCompact(stats.avg_price) + " ISK"} />
        <div className="bg-eve-surface rounded px-3 py-2 border border-eve-border/50 shadow-inner">
          <div className="text-[10px] uppercase font-bold text-eve-muted mb-0.5">Price Trend</div>
          <div className={`font-bold ${t.cls}`}>{t.icon} {trendLabel}</div>
        </div>
      </div>
    </div>
  );
}
