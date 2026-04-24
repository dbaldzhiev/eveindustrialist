import React, { useState, useMemo } from "react";
import type { BlueprintResult, SortKey } from "../types";

interface Props {
  blueprints: BlueprintResult[];
  showGroups?: boolean;
}

const ISK_FORMAT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});

function isk(v: number) {
  return ISK_FORMAT.format(v) + " ISK";
}

function pct(v: number) {
  return v.toFixed(1) + "%";
}

function profitColor(v: number) {
  if (v > 0) return "text-eve-profit";
  if (v < 0) return "text-eve-loss";
  return "text-eve-muted";
}

const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "blueprint_name", label: "Blueprint" },
  { key: "profit",         label: "Profit" },
  { key: "margin_pct",     label: "Margin" },
  { key: "isk_per_hour",   label: "ISK/h" },
  { key: "material_cost",  label: "Mat. Cost" },
  { key: "total_cost",     label: "Total Cost" },
  { key: "revenue",        label: "Revenue" },
];

interface GroupedBlueprint {
  id: string; // Unique ID for this row (group or BPO)
  blueprint_type_id: number;
  blueprint_name: string;
  product_type_id: number;
  summary: BlueprintResult;
  items: BlueprintResult[];
  isBpo: boolean;
  isGroup: boolean;
}

export default function BlueprintTable({ blueprints = [], showGroups = true }: Props) {
  const [sortKey, setSortKey]     = useState<SortKey>("profit");
  const [sortAsc, setSortAsc]     = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedRows, setExpandedRows] = useState<string | null>(null);

  const toggleGroup = (id: string) => {
    const next = new Set(expandedGroups);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedGroups(next);
  };

  const displayData = useMemo(() => {
    if (!blueprints || !Array.isArray(blueprints)) return [];
    
    if (!showGroups) {
      return blueprints
        .map((bp, idx) => ({
          id: `raw-${bp.blueprint_type_id}-${bp.me}-${bp.te}-${idx}`,
          blueprint_type_id: bp.blueprint_type_id,
          blueprint_name: bp.blueprint_name,
          product_type_id: bp.product_type_id,
          summary: bp,
          items: [bp],
          isBpo: bp.is_bpo,
          isGroup: false,
        }))
        .sort((a, b) => {
          const av = a.summary[sortKey] as number | string;
          const bv = b.summary[sortKey] as number | string;
          const cmp = typeof av === "string"
            ? (av as string).localeCompare(bv as string)
            : (av as number) - (bv as number);
          return sortAsc ? cmp : -cmp;
        });
    }

    const groupsMap = new Map<number, BlueprintResult[]>();
    const bpos: BlueprintResult[] = [];

    for (const bp of blueprints) {
      if (bp.is_bpo) {
        bpos.push(bp);
      } else {
        if (!groupsMap.has(bp.blueprint_type_id)) groupsMap.set(bp.blueprint_type_id, []);
        groupsMap.get(bp.blueprint_type_id)!.push(bp);
      }
    }

    const result: GroupedBlueprint[] = [];

    // Add BPOs as individual entries
    bpos.forEach((bp, idx) => {
      result.push({
        id: `bpo-${bp.blueprint_type_id}-${idx}`,
        blueprint_type_id: bp.blueprint_type_id,
        blueprint_name: bp.blueprint_name,
        product_type_id: bp.product_type_id,
        summary: bp,
        items: [bp],
        isBpo: true,
        isGroup: false,
      });
    });

    // Add BPC groups
    groupsMap.forEach((items, typeId) => {
      if (items.length === 1) {
        result.push({
          id: `bpc-single-${typeId}`,
          blueprint_type_id: typeId,
          blueprint_name: items[0].blueprint_name,
          product_type_id: items[0].product_type_id,
          summary: items[0],
          items: items,
          isBpo: false,
          isGroup: false,
        });
      } else {
        // Calculate totals for the group header
        const totalProfit = items.reduce((s, i) => s + i.profit, 0);
        const totalRevenue = items.reduce((s, i) => s + i.revenue, 0);
        const totalMatCost = items.reduce((s, i) => s + i.material_cost, 0);
        const totalJobCost = items.reduce((s, i) => s + i.job_cost, 0);
        const totalCost = items.reduce((s, i) => s + i.total_cost, 0);
        const totalIskHr = items.reduce((s, i) => s + i.isk_per_hour, 0);
        const avgMargin = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

        const summary: BlueprintResult = {
          ...items[0],
          profit: totalProfit,
          revenue: totalRevenue,
          material_cost: totalMatCost,
          job_cost: totalJobCost,
          total_cost: totalCost,
          isk_per_hour: totalIskHr,
          margin_pct: avgMargin,
        };

        result.push({
          id: `bpc-group-${typeId}`,
          blueprint_type_id: typeId,
          blueprint_name: items[0].blueprint_name,
          product_type_id: items[0].product_type_id,
          summary,
          items: [...items].sort((a, b) => b.profit - a.profit),
          isBpo: false,
          isGroup: true,
        });
      }
    });

    return result.sort((a, b) => {
      const av = a.summary[sortKey] as number | string;
      const bv = b.summary[sortKey] as number | string;
      const cmp = typeof av === "string"
        ? (av as string).localeCompare(bv as string)
        : (av as number) - (bv as number);
      return sortAsc ? cmp : -cmp;
    });
  }, [blueprints, sortKey, sortAsc, showGroups]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) setSortAsc((p) => !p);
    else { setSortKey(key); setSortAsc(false); }
  };

  if (!blueprints || blueprints.length === 0) {
    return (
      <div className="text-center py-16 text-eve-muted text-sm">
        No blueprints found. Make sure you have blueprints in your assets
        and have selected a solar system in Settings.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-eve-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-eve-border bg-eve-surface text-left">
            {SORT_COLUMNS.map(({ key, label }) => (
              <th
                key={key}
                onClick={() => handleSort(key)}
                className="px-3 py-2.5 text-xs font-semibold uppercase
                           tracking-widest text-eve-muted cursor-pointer
                           select-none hover:text-eve-text transition-colors"
              >
                {label}
                {sortKey === key && (
                  <span className="ml-1 text-eve-orange">
                    {sortAsc ? "↑" : "↓"}
                  </span>
                )}
              </th>
            ))}
            <th className="px-3 py-2.5 text-xs font-semibold uppercase
                           tracking-widest text-eve-muted">
              ME / TE
            </th>
            <th className="px-3 py-2.5 text-xs font-semibold uppercase
                           tracking-widest text-eve-muted">
              Type
            </th>
            {blueprints.some(b => b.decryptor_name) && (
              <th className="px-3 py-2.5 text-xs font-semibold uppercase
                             tracking-widest text-eve-muted">
                Decryptor
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {displayData.map((group) => {
            const isGroupExpanded = expandedGroups.has(group.id);
            const isRowExpanded = expandedRows === group.id;
            const hasDecryptors = blueprints.some(b => b.decryptor_name);

            return (
              <React.Fragment key={group.id}>
                {/* Header Row */}
                <tr
                  onClick={() => {
                    if (group.isGroup) toggleGroup(group.id);
                    else setExpandedRows(isRowExpanded ? null : group.id);
                  }}
                  className={`border-b border-eve-border/50 hover:bg-eve-surface/60
                             cursor-pointer transition-colors ${group.isGroup ? "bg-eve-surface/20" : ""}`}
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-4 flex items-center justify-center">
                        {group.isGroup && (
                          <span className="text-[10px] text-eve-orange">
                            {isGroupExpanded ? "▼" : "▶"}
                          </span>
                        )}
                      </div>
                      <img
                        src={`https://images.evetech.net/types/${group.product_type_id}/icon?size=32`}
                        alt=""
                        className="w-6 h-6 rounded border border-eve-border"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                      <div className="flex flex-col">
                        <span className="text-eve-text font-medium">{group.blueprint_name}</span>
                        {group.isGroup && (
                          <span className="text-[10px] text-eve-muted">
                            Total for {group.items.length} copies
                          </span>
                        )}
                      </div>
                    </div>
                  </td>

                  <td className={`px-3 py-2.5 font-semibold ${profitColor(group.summary.profit)}`}>
                    {isk(group.summary.profit)}
                  </td>
                  <td className={`px-3 py-2.5 ${profitColor(group.summary.profit)}`}>
                    {pct(group.summary.margin_pct)}
                  </td>
                  <td className="px-3 py-2.5 text-eve-text">{isk(group.summary.isk_per_hour)}</td>
                  <td className="px-3 py-2.5 text-eve-muted">{isk(group.summary.material_cost)}</td>
                  <td className="px-3 py-2.5 text-eve-muted">{isk(group.summary.total_cost)}</td>
                  <td className="px-3 py-2.5 text-eve-text">{isk(group.summary.revenue)}</td>
                  
                  <td className="px-3 py-2.5 text-eve-muted">
                    {!group.isGroup ? `${group.summary.me} / ${group.summary.te}` : "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    {!group.isGroup ? (
                      <TypeBadge isBpo={group.isBpo} isInvention={group.summary.is_invention} />
                    ) : (
                      <span className="text-[10px] text-eve-muted uppercase">Multiple</span>
                    )}
                  </td>
                  {hasDecryptors && (
                    <td className="px-3 py-2.5 text-[10px] text-eve-blue font-bold uppercase">
                      {group.summary.decryptor_name || "—"}
                    </td>
                  )}
                </tr>

                {/* Individual rows within group */}
                {group.isGroup && isGroupExpanded && group.items.map((bp, idx) => {
                  const subId = `${group.id}-${idx}`;
                  const isSubExpanded = expandedRows === subId;
                  return (
                    <React.Fragment key={subId}>
                      <tr
                        onClick={() => setExpandedRows(isSubExpanded ? null : subId)}
                        className="border-b border-eve-border/30 bg-eve-bg hover:bg-eve-surface/40
                                   cursor-pointer transition-colors"
                      >
                        <td className="px-3 py-2 pl-12 text-eve-muted">
                          Copy #{idx + 1}
                        </td>
                        <td className={`px-3 py-2 font-medium ${profitColor(bp.profit)}`}>
                          {isk(bp.profit)}
                        </td>
                        <td className={`px-3 py-2 ${profitColor(bp.profit)}`}>
                          {pct(bp.margin_pct)}
                        </td>
                        <td className="px-3 py-2 text-eve-muted">{isk(bp.isk_per_hour)}</td>
                        <td className="px-3 py-2 text-eve-muted/50">{isk(bp.material_cost)}</td>
                        <td className="px-3 py-2 text-eve-muted/50">{isk(bp.total_cost)}</td>
                        <td className="px-3 py-2 text-eve-muted">{isk(bp.revenue)}</td>
                        <td className="px-3 py-2 text-eve-muted">{bp.me} / {bp.te}</td>
                        <td className="px-3 py-2">
                          <TypeBadge isBpo={bp.is_bpo} isInvention={bp.is_invention} />
                        </td>
                        {hasDecryptors && (
                          <td className="px-3 py-2 text-[10px] text-eve-blue/70 uppercase">
                            {bp.decryptor_name || "—"}
                          </td>
                        )}
                      </tr>
                      {isSubExpanded && <DetailRow bp={bp} hasDecryptors={hasDecryptors} />}
                    </React.Fragment>
                  );
                })}

                {/* Single item expansion */}
                {!group.isGroup && isRowExpanded && (
                  <DetailRow bp={group.summary} hasDecryptors={hasDecryptors} />
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TypeBadge({ isBpo, isInvention }: { isBpo: boolean; isInvention?: boolean }) {
  if (isInvention) {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded border border-eve-blue/50 bg-eve-blue/10 text-eve-blue">
        POT
      </span>
    );
  }
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded border
        ${isBpo
          ? "border-eve-blue/50 text-eve-blue"
          : "border-eve-orange/50 text-eve-orange"}`}
    >
      {isBpo ? "BPO" : "BPC"}
    </span>
  );
}

function DetailRow({ bp, hasDecryptors }: { bp: BlueprintResult, hasDecryptors?: boolean }) {
  return (
    <tr className="border-b border-eve-border bg-eve-bg">
      <td colSpan={hasDecryptors ? 10 : 9} className="px-4 py-4">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-4 text-xs">
          <Stat label="Sell price"     value={isk(bp.sell_price)} />
          <Stat label="Products"       value={`${bp.product_quantity}× ${bp.product_name}`} />
          <Stat label="Job cost"       value={isk(bp.job_cost)} />
          <Stat label="Net revenue"    value={isk(bp.revenue)} />
          {hasDecryptors && <Stat label="Decryptor" value={bp.decryptor_name || "None"} />}
        </div>

        <h3 className="text-xs font-semibold uppercase tracking-widest
                       text-eve-muted mb-2">
          Materials ({bp.materials.length})
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1">
          {bp.materials.map((m) => (
            <div
              key={m.type_id}
              className="flex items-center justify-between
                         bg-eve-surface rounded px-2 py-1.5 text-xs"
            >
              <span className="text-eve-text truncate max-w-[120px]"
                    title={m.name}>
                {m.name}
              </span>
              <span className="text-eve-muted ml-2 shrink-0">
                {m.quantity.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </td>
    </tr>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-eve-surface rounded px-3 py-2">
      <div className="text-eve-muted mb-0.5">{label}</div>
      <div className="text-eve-text font-medium">{value}</div>
    </div>
  );
}
