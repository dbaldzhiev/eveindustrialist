import React, { useState, useMemo } from "react";
import type { BlueprintResult, SortKey } from "../types";
import { useCharacterSkillData, getEligibleForBp } from "../hooks/useEligibleCharacters";
import { CharacterMiniPortraits } from "./CharacterMiniPortraits";

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

export default function BlueprintTable({ blueprints, activity }: Props) {
  const [sortKey, setSortKey]     = useState<SortKey>("profit");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const eligibleChars = useEligibleCharacters(activity ?? "");
  const colCount = activity ? 7 : 6;

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

  const sortedBlueprints = useMemo(() => {
    let filtered = blueprints;
    if (deselectedCategories.length > 0) {
      filtered = filtered.filter(b => !b.category_name || !deselectedCategories.includes(b.category_name));
    }

    return [...filtered].sort((a, b) => {
      let valA = a[sortKey] ?? 0;
      let valB = b[sortKey] ?? 0;

      if (sortKey === "blueprint_name") {
        valA = a.blueprint_name.toLowerCase();
        valB = b.blueprint_name.toLowerCase();
      }

      if (valA < valB) return sortOrder === "asc" ? -1 : 1;
      if (valA > valB) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });
  }, [blueprints, sortKey, sortOrder, deselectedCategories]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortOrder("desc");
    }
  };

  const toggleExpand = (bp: BlueprintResult) => {
    const id = `${bp.blueprint_type_id}-${bp.me}-${bp.te}-${bp.decryptor_name || ""}`;
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
            {sortedBlueprints.map((bp) => {
              const rowId = `${bp.blueprint_type_id}-${bp.me}-${bp.te}-${bp.decryptor_name || ""}`;
              const isExpanded = expandedId === rowId;
              const cleanBpName = bp.blueprint_name.replace(" (Potential)", "");

              return (
                <React.Fragment key={rowId}>
                  <tr
                    className={`group hover:bg-white/5 transition-colors cursor-pointer ${isExpanded ? "bg-white/5" : ""}`}
                    onClick={() => toggleExpand(bp)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="font-semibold text-eve-text group-hover:text-eve-orange transition-colors">
                          {cleanBpName}
                        </span>
                        <div className="flex gap-2 text-[10px] mt-0.5">
                          <span className="text-eve-muted font-bold uppercase">{bp.category_name}</span>
                          <span className="text-blue-400">ME {bp.me}</span>
                          <span className="text-purple-400">TE {bp.te}</span>
                          {bp.decryptor_name && <span className="text-eve-orange">D: {bp.decryptor_name}</span>}
                          {bp.is_bpo ? <span className="text-green-500 font-bold uppercase">BPO</span> : <span className="text-yellow-500 font-bold uppercase">BPC</span>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-eve-muted font-medium">
                      {bp.runs}
                    </td>
                    <td className={`px-4 py-3 text-right font-bold ${bp.profit > 0 ? "text-green-400" : "text-red-400"}`}>
                      {fmtISK(bp.profit)}
                    </td>
                    <td className={`px-4 py-3 text-right font-medium ${bp.margin_pct > 0 ? "text-green-500/80" : "text-red-500/80"}`}>
                      {PCT_FORMAT.format(bp.margin_pct)}%
                    </td>
                    <td className="px-4 py-3 text-right text-eve-text font-medium">
                      {fmtISK(bp.isk_per_hour)}
                    </td>
                    {activity && (
                      <td className="px-3 py-3">
                        <CharacterMiniPortraits characters={eligibleChars} size={22} />
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
                              {bp.materials.map((mat) => (
                                <div key={mat.type_id} className="flex justify-between text-xs group/mat">
                                  <span className="text-eve-text group-hover/mat:text-eve-orange transition-colors">
                                    {mat.name}
                                  </span>
                                  <div className="flex gap-4">
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
