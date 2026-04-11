import { useState } from "react";
import type { BlueprintResult, SortKey } from "../types";

interface Props {
  blueprints: BlueprintResult[];
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

export default function BlueprintTable({ blueprints }: Props) {
  const [sortKey, setSortKey]     = useState<SortKey>("profit");
  const [sortAsc, setSortAsc]     = useState(false);
  const [expanded, setExpanded]   = useState<number | null>(null);

  const sorted = [...blueprints].sort((a, b) => {
    const av = a[sortKey] as number | string;
    const bv = b[sortKey] as number | string;
    const cmp = typeof av === "string"
      ? (av as string).localeCompare(bv as string)
      : (av as number) - (bv as number);
    return sortAsc ? cmp : -cmp;
  });

  const handleSort = (key: SortKey) => {
    if (key === sortKey) setSortAsc((p) => !p);
    else { setSortKey(key); setSortAsc(false); }
  };

  if (blueprints.length === 0) {
    return (
      <div className="text-center py-16 text-eve-muted text-sm">
        No blueprints found. Make sure you have blueprints in your assets
        and have selected a solar system.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-eve-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-eve-border bg-eve-surface">
            {SORT_COLUMNS.map(({ key, label }) => (
              <th
                key={key}
                onClick={() => handleSort(key)}
                className="px-3 py-2.5 text-left text-xs font-semibold uppercase
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
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase
                           tracking-widest text-eve-muted">
              ME / TE
            </th>
            <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase
                           tracking-widest text-eve-muted">
              Type
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((bp) => {
            const isExpanded = expanded === bp.blueprint_type_id;
            return (
              <>
                <tr
                  key={bp.blueprint_type_id}
                  onClick={() =>
                    setExpanded(isExpanded ? null : bp.blueprint_type_id)
                  }
                  className="border-b border-eve-border/50 hover:bg-eve-surface/60
                             cursor-pointer transition-colors"
                >
                  {/* Blueprint name */}
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <img
                        src={`https://images.evetech.net/types/${bp.product_type_id}/icon?size=32`}
                        alt=""
                        className="w-6 h-6 rounded border border-eve-border"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                      <span className="text-eve-text">{bp.blueprint_name}</span>
                    </div>
                  </td>

                  {/* Profit */}
                  <td className={`px-3 py-2.5 font-semibold ${profitColor(bp.profit)}`}>
                    {isk(bp.profit)}
                  </td>

                  {/* Margin */}
                  <td className={`px-3 py-2.5 ${profitColor(bp.profit)}`}>
                    {pct(bp.margin_pct)}
                  </td>

                  {/* ISK/h */}
                  <td className="px-3 py-2.5 text-eve-text">
                    {isk(bp.isk_per_hour)}
                  </td>

                  {/* Material cost */}
                  <td className="px-3 py-2.5 text-eve-muted">
                    {isk(bp.material_cost)}
                  </td>

                  {/* Total cost */}
                  <td className="px-3 py-2.5 text-eve-muted">
                    {isk(bp.total_cost)}
                  </td>

                  {/* Revenue */}
                  <td className="px-3 py-2.5 text-eve-text">
                    {isk(bp.revenue)}
                  </td>

                  {/* ME / TE */}
                  <td className="px-3 py-2.5 text-eve-muted">
                    {bp.me} / {bp.te}
                  </td>

                  {/* Type */}
                  <td className="px-3 py-2.5">
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded border
                        ${bp.is_bpo
                          ? "border-eve-blue/50 text-eve-blue"
                          : "border-eve-orange/50 text-eve-orange"}`}
                    >
                      {bp.is_bpo ? "BPO" : "BPC"}
                    </span>
                  </td>
                </tr>

                {/* Expanded detail row */}
                {isExpanded && (
                  <tr key={`${bp.blueprint_type_id}-detail`}
                      className="border-b border-eve-border bg-eve-bg">
                    <td colSpan={9} className="px-4 py-4">
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4 text-xs">
                        <Stat label="Sell price"     value={isk(bp.sell_price)} />
                        <Stat label="Products"       value={`${bp.product_quantity}× ${bp.product_name}`} />
                        <Stat label="Job cost"       value={isk(bp.job_cost)} />
                        <Stat label="Net revenue"    value={isk(bp.revenue)} />
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
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
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
