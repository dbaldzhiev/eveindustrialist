import { useEffect, useState, useMemo } from "react";
import Navbar from "../components/Navbar";
import CharacterSkillBadges from "../components/CharacterSkillBadges";
import { OwnerPortraits } from "../components/OwnerPortraits";
import { fetchBlueprints, fetchAppSettings } from "../api/client";
import { useCharacterSkillData } from "../hooks/useEligibleCharacters";
import { DEFAULT_SETTINGS, Spinner } from "./DashboardPage";
import type { BlueprintResult, Character, Settings } from "../types";

interface Props {
  character: Character;
}

type SortKey = "blueprint_name" | "bpc_count" | "bpc_total_runs";

export default function CopyingPage({ character }: Props) {
  const [blueprints, setBlueprints] = useState<BlueprintResult[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);

  // Character name mapping
  const charSkillData = useCharacterSkillData();
  const charNameMap = useMemo(() =>
    new Map(charSkillData.map(c => [c.character_id, c.character_name])),
  [charSkillData]);

  // Filters & Sort
  const [filterWithBpcs, setFilterWithBpcs] = useState(true);
  const [filterNoBpcs, setFilterNoBpcs]     = useState(true);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [sortKey, setSortKey]               = useState<SortKey>("blueprint_name");
  const [sortDir, setSortDir]               = useState<"asc" | "desc">("asc");

  useEffect(() => {
    async function init() {
      try {
        const appSettings = await fetchAppSettings();
        const s_id = appSettings.default_system_id;

        if (s_id) {
          // We still need a full settings object for the API, even if we don't store it in state
          const s: Settings = {
            ...DEFAULT_SETTINGS,
            solar_system_id: s_id,
            price_region_id: appSettings.default_price_region,
          };
          const results = await fetchBlueprints(s, false, "copy");
          setBlueprints(results);
        } else {
          setError("Please configure a solar system in Settings.");
        }
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    blueprints.forEach(b => { if (b.category_name) cats.add(b.category_name); });
    return Array.from(cats).sort();
  }, [blueprints]);

  const sortedAndFiltered = useMemo(() => {
    let list = blueprints.filter(bp => {
      const hasBpcs = (bp.bpc_count || 0) > 0;
      if (hasBpcs && !filterWithBpcs) return false;
      if (!hasBpcs && !filterNoBpcs) return false;
      if (selectedCategories.length > 0 && bp.category_name && !selectedCategories.includes(bp.category_name)) return false;
      return true;
    });

    list.sort((a, b) => {
      let valA = a[sortKey] ?? 0;
      let valB = b[sortKey] ?? 0;

      if (typeof valA === "string" && typeof valB === "string") {
        return sortDir === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      const numA = Number(valA);
      const numB = Number(valB);
      return sortDir === "asc" ? numA - numB : numB - numA;
    });

    return list;
  }, [blueprints, filterWithBpcs, filterNoBpcs, selectedCategories, sortKey, sortDir]);

  const handleToggleCategory = (cat: string) => {
    setSelectedCategories(prev => 
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  return (
    <div className="min-h-screen bg-eve-bg font-eve">
      <Navbar character={character} />
      <main className="max-w-screen-2xl mx-auto px-4 py-6 space-y-5">
        
        {/* Filters Header */}
        <div className="bg-eve-surface border border-eve-border rounded-lg px-4 py-3 flex flex-wrap items-center gap-6 text-xs">
          <div className="flex items-center gap-2 border-r border-eve-border pr-6">
            <span className="text-eve-muted font-bold uppercase text-[9px]">Inventory:</span>
            <div className="flex gap-1">
               <FilterBtn label="With BPCs" active={filterWithBpcs} onClick={() => setFilterWithBpcs(!filterWithBpcs)} color="border-green-500 text-green-400 bg-green-500/10" />
               <FilterBtn label="No BPCs" active={filterNoBpcs} onClick={() => setFilterNoBpcs(!filterNoBpcs)} color="border-red-500 text-red-400 bg-red-500/10" />
            </div>
          </div>

          <div className="ml-auto">
            <CharacterSkillBadges activity="copy" />
          </div>

          <div className="flex flex-wrap gap-1 items-center w-full border-t border-eve-border/40 pt-2">
            <span className="text-eve-muted font-bold uppercase text-[9px] mr-2">Categories:</span>
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => handleToggleCategory(cat)}
                className={`px-2 py-0.5 rounded border transition-colors ${
                  selectedCategories.includes(cat)
                    ? "bg-eve-orange/20 border-eve-orange text-eve-orange"
                    : "bg-eve-bg border-eve-border text-eve-muted"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {loading && <Spinner label="Loading owned BPOs and BPC counts..." />}
        {error && <div className="text-red-400">{error}</div>}

        {!loading && (
          <div className="bg-eve-surface border border-eve-border rounded-lg overflow-hidden shadow-xl">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="bg-eve-bg/50 text-eve-muted text-[10px] uppercase tracking-wider font-bold border-b border-eve-border">
                  <th className="px-4 py-3 cursor-pointer hover:text-eve-text transition-colors" onClick={() => toggleSort("blueprint_name")}>
                    Blueprint / Category {sortKey === "blueprint_name" && (sortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th className="px-4 py-3 text-center">BPO Owners</th>
                  <th className="px-4 py-3 text-right">ME / TE</th>
                  <th className="px-4 py-3 text-right cursor-pointer hover:text-eve-text transition-colors" onClick={() => toggleSort("bpc_count")}>
                    Owned BPCs {sortKey === "bpc_count" && (sortDir === "asc" ? "↑" : "↓")}
                  </th>
                  <th className="px-4 py-3 text-center">BPC Owners</th>
                  <th className="px-4 py-3 text-right cursor-pointer hover:text-eve-text transition-colors" onClick={() => toggleSort("bpc_total_runs")}>
                    Total BPC Runs {sortKey === "bpc_total_runs" && (sortDir === "asc" ? "↑" : "↓")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-eve-border/50">
                {sortedAndFiltered.map(bp => (
                  <tr key={bp.blueprint_type_id} className="hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-eve-text">{bp.blueprint_name}</div>
                      <div className="text-[10px] text-eve-muted uppercase font-bold">{bp.category_name}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-center">
                        <OwnerPortraits ids={bp.character_ids || []} nameMap={charNameMap} size={24} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-eve-muted">
                      <span className="text-blue-400">{bp.me}</span> / <span className="text-purple-400">{bp.te}</span>
                    </td>
                    <td className={`px-4 py-3 text-right font-medium ${(bp.bpc_count || 0) > 0 ? "text-green-400" : "text-eve-muted"}`}>
                      {bp.bpc_count || 0}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-center">
                        <OwnerPortraits ids={bp.bpc_character_ids || []} nameMap={charNameMap} size={24} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-eve-text font-mono">
                      {(bp.bpc_total_runs || 0).toLocaleString()}
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

function FilterBtn({ label, active, onClick, color }: { label: string; active: boolean; onClick: () => void; color: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 rounded border transition-all uppercase text-[9px] font-bold ${
        active ? color : "bg-eve-bg border-eve-border text-eve-muted"
      }`}
    >
      {label}
    </button>
  );
}
