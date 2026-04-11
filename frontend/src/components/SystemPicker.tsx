import { useState, useRef, useEffect } from "react";
import { searchSystems } from "../api/client";
import type { SolarSystem } from "../types";

interface Props {
  value: SolarSystem | null;
  onChange: (system: SolarSystem) => void;
}

function secColor(sec: number): string {
  if (sec >= 0.5) return "text-green-400";
  if (sec >= 0.1) return "text-yellow-400";
  return "text-red-400";
}

export default function SystemPicker({ value, onChange }: Props) {
  const [query, setQuery]     = useState("");
  const [results, setResults] = useState<SolarSystem[]>([]);
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleInput = (q: string) => {
    setQuery(q);
    if (timer.current) clearTimeout(timer.current);
    if (q.length < 2) { setResults([]); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await searchSystems(q);
        setResults(res);
        setOpen(true);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    }, 300);
  };

  const select = (sys: SolarSystem) => {
    onChange(sys);
    setQuery(sys.name);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative w-full">
      <input
        type="text"
        value={query}
        onChange={(e) => handleInput(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder="System name (e.g. Jita)"
        className="w-full bg-eve-bg border border-eve-border rounded px-3 py-1.5
                   text-sm text-eve-text placeholder:text-eve-muted
                   focus:outline-none focus:border-eve-orange"
      />
      {loading && (
        <span className="absolute right-3 top-2 text-eve-muted text-xs">…</span>
      )}
      {open && results.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full bg-eve-surface border border-eve-border
                       rounded shadow-xl max-h-64 overflow-y-auto">
          {results.map((s) => (
            <li
              key={s.solar_system_id}
              onClick={() => select(s)}
              className="px-3 py-2 flex items-center justify-between
                         hover:bg-eve-border cursor-pointer text-sm"
            >
              <span className="text-eve-text">{s.name}</span>
              <span className="flex items-center gap-2 text-xs text-eve-muted">
                <span className={secColor(s.security)}>
                  {s.security.toFixed(1)}
                </span>
                <span>{s.region_name}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
