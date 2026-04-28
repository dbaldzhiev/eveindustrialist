import { useState, useEffect } from "react";
import Navbar from "../components/Navbar";
import { fetchSellerPrices, fetchMarketHubs, fetchAppSettings, type SellerItem } from "../api/client";
import type { Character, MarketHub } from "../types";

interface Props {
  character: Character;
}

export default function SellerPage({ character }: Props) {
  const [rawText, setRawText] = useState("");
  const [items, setItems] = useState<SellerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [hubs, setHubs] = useState<MarketHub[]>([]);
  const [selectedHub, setSelectedHub] = useState<number>(10000002);

  useEffect(() => {
    fetchMarketHubs().then(setHubs).catch(console.error);
    fetchAppSettings().then(settings => {
      if (settings.default_price_region) {
        setSelectedHub(settings.default_price_region);
      }
    }).catch(console.error);
  }, []);

  const handleFetch = async () => {
    if (!rawText.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchSellerPrices(rawText, selectedHub);
      setItems(result.items);
    } catch (err: any) {
      setError(err.message || "Failed to fetch prices");
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setRawText("");
    setItems([]);
    setError(null);
  };

  const copyToClipboard = (text: string) => {
    // Try modern API first
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).catch(err => {
        console.error("Modern clipboard API failed: ", err);
        fallbackCopyTextToClipboard(text);
      });
    } else {
      fallbackCopyTextToClipboard(text);
    }
  };

  const fallbackCopyTextToClipboard = (text: string) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    
    // Ensure the textarea is not visible but part of the DOM
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    textArea.style.top = "0";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    try {
      const successful = document.execCommand("copy");
      if (!successful) {
        console.error("Fallback copy failed");
      }
    } catch (err) {
      console.error("Fallback copy exception: ", err);
    }

    document.body.removeChild(textArea);
  };

  const copyAllPrices = () => {
    const lines = items.map(item => `${item.name} ${item.undercut_price.toFixed(2)}`).join("\n");
    copyToClipboard(lines);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const formatIsk = (val: number) => 
    val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const selectedHubName = hubs.find(h => h.region_id === selectedHub)?.name || "Market";

  return (
    <div className="min-h-screen bg-eve-bg text-eve-text pb-20">
      <Navbar character={character} />

      <main className="max-w-screen-2xl mx-auto px-4 py-6">
        <div className="flex flex-col gap-6">
          <section className="bg-eve-surface border border-eve-border rounded-lg p-6 shadow-lg">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <span className="text-eve-orange">Seller</span> Price Calculator
                </h2>
                <p className="text-eve-muted text-sm mt-1">
                  Paste your exported sell list here (TypeIDs or Name + Price).
                </p>
              </div>
              
              <div className="flex flex-col items-end gap-1">
                <label className="text-xs text-eve-muted uppercase font-bold tracking-wider">Pricing Region</label>
                <select
                  value={selectedHub}
                  onChange={(e) => setSelectedHub(Number(e.target.value))}
                  className="bg-eve-bg border border-eve-border rounded px-3 py-1.5 text-sm outline-none focus:border-eve-orange"
                >
                  {hubs.map(hub => (
                    <option key={hub.region_id} value={hub.region_id}>{hub.name}</option>
                  ))}
                </select>
              </div>
            </div>
            
            <textarea
              className="w-full h-48 bg-eve-bg border border-eve-border rounded p-3 text-sm font-mono focus:border-eve-orange outline-none transition-colors"
              placeholder="Veldspar 2.01&#10;Rifter 400,000.01"
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
            />

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                onClick={handleFetch}
                disabled={loading || !rawText.trim()}
                className="bg-eve-orange hover:bg-eve-orange/80 disabled:opacity-50 text-white font-bold py-2 px-6 rounded transition-colors shadow-sm"
              >
                {loading ? "Fetching..." : `Fetch Realtime ${selectedHubName} Prices`}
              </button>
              <button
                onClick={handleClear}
                className="bg-eve-surface border border-eve-border hover:bg-eve-bg text-eve-text py-2 px-6 rounded transition-colors"
              >
                Clear
              </button>
              {items.length > 0 && (
                <button
                  onClick={copyAllPrices}
                  className={`${
                    copiedAll ? "bg-green-500/20 border-green-500 text-green-500" : "bg-eve-orange/20 border-eve-orange text-eve-orange"
                  } border hover:bg-opacity-30 font-bold py-2 px-6 rounded transition-colors shadow-sm ml-auto`}
                >
                  {copiedAll ? "✓ Prices Copied!" : "Copy All Prices for EVE"}
                </button>
              )}
            </div>
          </section>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded-lg">
              {error}
            </div>
          )}

          {items.length > 0 && (
            <section className="bg-eve-surface border border-eve-border rounded-lg shadow-lg overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-eve-bg/50 border-b border-eve-border text-xs uppercase tracking-wider text-eve-muted font-semibold">
                    <th className="px-6 py-3">Item</th>
                    <th className="px-6 py-3 text-right">{selectedHubName} Realtime Sell</th>
                    <th className="px-6 py-3 text-right text-eve-orange">My Price (Undercut)</th>
                    <th className="px-6 py-3 w-20"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-eve-border/50">
                  {items.map((item, idx) => (
                    <tr key={`${item.type_id}-${idx}`} className="hover:bg-eve-orange/5 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <img
                            src={`https://images.evetech.net/types/${item.type_id}/icon?size=32`}
                            className="w-8 h-8 rounded"
                            alt={item.name}
                          />
                          <span className="font-medium">{item.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-sm">
                        {formatIsk(item.original_price)}
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-sm text-eve-orange font-bold">
                        {formatIsk(item.undercut_price)}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => copyToClipboard(item.undercut_price.toFixed(2))}
                          className="p-1.5 rounded hover:bg-eve-bg text-eve-muted hover:text-eve-orange transition-colors"
                          title="Copy price"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
