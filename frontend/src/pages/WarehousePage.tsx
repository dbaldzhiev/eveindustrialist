import { useEffect, useState, useMemo } from "react";
import Navbar from "../components/Navbar";
import {
    fetchWarehouse, fetchAppSettings,
    fetchAssetLocations, saveAppSettings
} from "../api/client";
import { Spinner, fmtISK } from "./DashboardPage";
import { useRefresh } from "../context/RefreshContext";
import type { WarehouseItem, Character, AppSettings, AssetLocation } from "../types";

interface Props {
  character: Character;
}

export default function WarehousePage({ character }: Props) {
  const [items, setItems]             = useState<WarehouseItem[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const { esiKey } = useRefresh();

  // Location Picker State
  const [showPicker, setShowPicker]   = useState(false);
  const [locations, setLocations]     = useState<AssetLocation[]>([]);
  const [loadingLocs, setLoadingLocs] = useState(false);
  const [locSearch, setLocSearch]     = useState("");

  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [inv, settings] = await Promise.all([fetchWarehouse(), fetchAppSettings()]);
      setItems(inv);
      setAppSettings(settings);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [esiKey]);

  const handleOpenPicker = async () => {
    setShowPicker(true);
    setLoadingLocs(true);
    try {
        const locs = await fetchAssetLocations();
        setLocations(locs);
    } catch (e: any) {
        setError("Failed to load locations: " + e.message);
    } finally {
        setLoadingLocs(false);
    }
  };

  const handleSelectLocation = async (loc: AssetLocation | null) => {
    try {
        setLoading(true);
        const newSettings = await saveAppSettings({
            warehouse_character_id:  loc?.character_id  ?? null,
            warehouse_location_id:   loc?.loc_id        ?? null,
            warehouse_location_name: loc ? `${loc.character_name} - ${loc.location_name}` : null
        });
        setAppSettings(newSettings);
        setShowPicker(false);
        const inv = await fetchWarehouse();
        setItems(inv);
    } catch (e: any) {
        setError("Failed to save source: " + e.message);
    } finally {
        setLoading(false);
    }
  };

  const categories = useMemo(() => {
    const cats = new Set<string>();
    items.forEach(i => { if (i.category_name) cats.add(i.category_name); });
    return Array.from(cats).sort();
  }, [items]);

  const filtered = useMemo(() => {
    if (selectedCategories.length === 0) return items;
    return items.filter(i => i.category_name && selectedCategories.includes(i.category_name));
  }, [items, selectedCategories]);

  const filteredLocs = useMemo(() => {
    return locations.filter(l => 
        l.location_name.toLowerCase().includes(locSearch.toLowerCase()) ||
        l.character_name.toLowerCase().includes(locSearch.toLowerCase())
    );
  }, [locations, locSearch]);

  const handleToggleCategory = (cat: string) => {
    setSelectedCategories(prev => 
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };

  const totalValue = filtered.reduce((acc, i) => acc + ((i.estimated_price || 0) * i.quantity), 0);

  return (
    <div className="min-h-screen bg-eve-bg font-eve text-eve-text">
      <Navbar character={character} />
      <main className="max-w-screen-2xl mx-auto px-4 py-6 space-y-5">
        
        {/* Header & Source Selection */}
        <div className="bg-eve-surface border border-eve-border rounded-lg p-4 flex flex-col md:flex-row justify-between gap-6 shadow-xl">
          <div className="space-y-3">
            <div>
                <h1 className="text-xl font-bold text-white flex items-center gap-2">
                    <span className="text-eve-orange">📦</span> Warehouse
                </h1>
                <p className="text-xs text-eve-muted">
                    Inventory tracking for manufacturing simulation.
                </p>
            </div>
            
            <div className="flex flex-col gap-1">
                <span className="text-[10px] uppercase font-bold text-eve-muted tracking-widest">Inventory Source</span>
                <div className="flex items-center gap-3 bg-black/40 border border-eve-border rounded px-3 py-2">
                    <div className="flex-1">
                        {appSettings?.warehouse_location_name ? (
                            <div className="text-sm font-semibold text-eve-orange">{appSettings.warehouse_location_name}</div>
                        ) : (
                            <div className="text-sm text-eve-muted italic">All character hangars (Aggregated)</div>
                        )}
                    </div>
                    <button 
                        onClick={handleOpenPicker}
                        className="text-[10px] font-bold uppercase bg-eve-orange/10 hover:bg-eve-orange/20 text-eve-orange border border-eve-orange/30 px-2 py-1 rounded transition-colors"
                    >
                        Select Container
                    </button>
                    {appSettings?.warehouse_location_id && (
                        <button 
                            onClick={() => handleSelectLocation(null)}
                            className="text-[10px] font-bold uppercase text-red-400 hover:text-red-300"
                        >
                            Reset
                        </button>
                    )}
                </div>
            </div>
          </div>

          <div className="flex items-center gap-6 self-end md:self-center">
            <div className="text-right">
                <div className="text-[10px] uppercase font-bold text-eve-muted">Estimated Value</div>
                <div className="text-2xl font-bold text-eve-orange">{fmtISK(totalValue)}</div>
            </div>
          </div>
        </div>

        {/* Location Picker Modal */}
        {showPicker && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                <div className="bg-eve-surface border border-eve-border rounded-lg w-full max-w-2xl flex flex-col max-h-[80vh] shadow-2xl">
                    <div className="p-4 border-b border-eve-border flex justify-between items-center">
                        <div>
                            <h2 className="text-lg font-bold text-white">Select Inventory Container</h2>
                            <p className="text-xs text-eve-muted">Choose a specific station hangar or container as your warehouse source.</p>
                        </div>
                        <button onClick={() => setShowPicker(false)} className="text-eve-muted hover:text-white text-xl">×</button>
                    </div>
                    
                    <div className="p-4 bg-eve-bg/50">
                        <input 
                            type="text" 
                            placeholder="Search by station or character name..."
                            value={locSearch}
                            onChange={(e) => setLocSearch(e.target.value)}
                            className="w-full bg-eve-bg border border-eve-border rounded px-3 py-2 text-sm focus:outline-none focus:border-eve-orange"
                        />
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-2">
                        {loadingLocs ? (
                            <div className="text-center py-10 text-eve-muted italic">Scanning assets across all characters...</div>
                        ) : filteredLocs.length === 0 ? (
                            <div className="text-center py-10 text-eve-muted">No matching locations found.</div>
                        ) : (
                            filteredLocs.map((l, i) => (
                                <div 
                                    key={i} 
                                    onClick={() => handleSelectLocation(l)}
                                    className="bg-eve-bg/40 border border-eve-border/50 hover:border-eve-orange/50 hover:bg-eve-orange/5 rounded p-3 cursor-pointer group transition-all"
                                >
                                    <div className="flex justify-between items-start">
                                        <div className="flex-1 min-w-0">
                                            <div className="text-xs font-bold text-eve-muted uppercase tracking-tighter mb-0.5">{l.character_name}</div>
                                            <div className="text-sm font-semibold text-eve-text group-hover:text-white truncate">{l.location_name}</div>
                                        </div>
                                        <div className="text-right ml-4">
                                            <div className="text-[10px] font-bold text-eve-orange uppercase">{l.type_count} Types</div>
                                            <div className="text-[10px] text-eve-muted">{l.total_quantity.toLocaleString()} Items</div>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                    
                    <div className="p-4 border-t border-eve-border bg-eve-bg/30 text-right">
                         <button onClick={() => setShowPicker(false)} className="text-xs font-bold uppercase text-eve-muted hover:text-white px-4">Close</button>
                    </div>
                </div>
            </div>
        )}

        {/* Categories */}
        <div className="bg-eve-surface/30 border border-eve-border/50 rounded-lg p-3 flex flex-wrap gap-1.5 items-center">
            <span className="text-[10px] uppercase font-bold text-eve-muted mr-2">Filter Categories:</span>
            {categories.map(cat => (
                <button
                    key={cat}
                    onClick={() => handleToggleCategory(cat)}
                    className={`px-3 py-1 rounded-full text-[10px] font-bold border transition-all ${
                        selectedCategories.includes(cat)
                            ? "bg-eve-orange border-eve-orange text-white shadow-lg shadow-eve-orange/20"
                            : "bg-eve-bg border-eve-border text-eve-muted hover:border-eve-muted hover:text-eve-text"
                    }`}
                >
                    {cat}
                </button>
            ))}
            {selectedCategories.length > 0 && (
                 <button onClick={() => setSelectedCategories([])} className="text-[10px] font-bold text-red-400 ml-2 uppercase hover:underline">Reset Filters</button>
            )}
        </div>

        {loading && <Spinner label="Loading warehouse data..." />}
        {error && <div className="bg-red-900/20 border border-red-700/50 rounded p-4 text-red-400 text-sm">{error}</div>}

        {!loading && (
          <div className="bg-eve-surface border border-eve-border rounded-lg overflow-hidden shadow-2xl">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="bg-eve-bg/50 text-eve-muted text-[10px] uppercase tracking-wider font-bold border-b border-eve-border">
                  <th className="px-4 py-3">Item / Category</th>
                  <th className="px-4 py-3 text-right">Quantity</th>
                  <th className="px-4 py-3 text-right">Est. Unit Price</th>
                  <th className="px-4 py-3 text-right">Total Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-eve-border/50">
                {filtered.length === 0 ? (
                    <tr>
                        <td colSpan={4} className="px-4 py-20 text-center text-eve-muted italic">
                            No items found in this warehouse source.
                        </td>
                    </tr>
                ) : filtered.map(item => (
                  <tr key={item.type_id} className="hover:bg-white/5 transition-colors group">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                          <img 
                            src={`https://images.evetech.net/types/${item.type_id}/icon?size=32`} 
                            alt="" 
                            className="w-8 h-8 rounded border border-eve-border bg-black/40"
                            onError={(e) => (e.target as HTMLImageElement).style.display = 'none'}
                          />
                          <div>
                            <div className="font-semibold text-eve-text group-hover:text-eve-orange transition-colors">{item.type_name}</div>
                            <div className="text-[10px] text-eve-muted uppercase font-bold">{item.category_name}</div>
                          </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-eve-text font-mono font-medium">
                      {item.quantity.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-eve-muted font-mono">
                      {fmtISK(item.estimated_price || 0)}
                    </td>
                    <td className="px-4 py-3 text-right text-eve-orange font-bold font-mono">
                      {fmtISK((item.estimated_price || 0) * item.quantity)}
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
