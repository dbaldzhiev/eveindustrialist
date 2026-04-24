import { useEffect, useState } from "react";
import Navbar from "../components/Navbar";
import { fetchSlots } from "../api/client";
import { useRefresh } from "../context/RefreshContext";
import type { Character, CharacterSlots, ActiveJob } from "../types";

interface Props {
  character: Character;
}

function isk(v: number) {
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toFixed(0);
}

function timeLeft(endDate: string) {
  const diff = new Date(endDate).getTime() - Date.now();
  if (diff <= 0) return "Done";
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function SlotBar({ used, max, color }: { used: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-eve-bg rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-eve-muted w-10 text-right">{used}/{max}</span>
    </div>
  );
}

function JobRow({ job }: { job: ActiveJob }) {
  return (
    <div className="flex items-center gap-2 py-1 border-b border-eve-border/30 last:border-0">
      <span className="text-xs text-eve-muted w-24 shrink-0">{job.activity_name}</span>
      <span className="text-xs text-eve-text flex-1 truncate">{job.product_name}</span>
      <span className="text-xs text-eve-muted shrink-0">×{job.runs}</span>
      <span className="text-xs text-eve-orange shrink-0 w-16 text-right">{timeLeft(job.end_date)}</span>
    </div>
  );
}

function CharacterCard({ slots }: { slots: CharacterSlots }) {
  const freeMfg      = slots.mfg_max - slots.mfg_used;
  const freeResearch = slots.research_max - slots.research_used;
  const freeReaction = slots.reaction_max - slots.reaction_used;

  return (
    <div className="bg-eve-surface border border-eve-border rounded-lg p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <img
          src={`https://images.evetech.net/characters/${slots.character_id}/portrait?size=64`}
          alt={slots.character_name}
          className="w-10 h-10 rounded-full border border-eve-border"
        />
        <div>
          <div className="font-semibold text-eve-text">{slots.character_name}</div>
          <div className="text-xs text-eve-muted">
            {freeMfg} mfg · {freeResearch} research · {freeReaction} reaction slots free
          </div>
        </div>
      </div>

      {/* Slot bars */}
      <div className="space-y-2">
        <div>
          <div className="flex justify-between text-xs text-eve-muted mb-1">
            <span>Manufacturing</span>
            <span className={freeMfg > 0 ? "text-green-400" : "text-eve-muted"}>{freeMfg} free</span>
          </div>
          <SlotBar used={slots.mfg_used} max={slots.mfg_max} color="bg-eve-orange" />
        </div>
        <div>
          <div className="flex justify-between text-xs text-eve-muted mb-1">
            <span>Research</span>
            <span className={freeResearch > 0 ? "text-green-400" : "text-eve-muted"}>{freeResearch} free</span>
          </div>
          <SlotBar used={slots.research_used} max={slots.research_max} color="bg-blue-500" />
        </div>
        <div>
          <div className="flex justify-between text-xs text-eve-muted mb-1">
            <span>Reactions</span>
            <span className={freeReaction > 0 ? "text-green-400" : "text-eve-muted"}>{freeReaction} free</span>
          </div>
          <SlotBar used={slots.reaction_used} max={slots.reaction_max} color="bg-purple-500" />
        </div>
      </div>

      {/* Active jobs */}
      {slots.active_jobs.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-eve-muted uppercase tracking-widest mb-2">
            Active Jobs
          </div>
          <div>
            {slots.active_jobs.map((job) => (
              <JobRow key={job.job_id} job={job} />
            ))}
          </div>
        </div>
      )}

      {/* Suggestions */}
      {slots.suggestions.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-eve-muted uppercase tracking-widest mb-2">
            Slot Suggestions (by ISK/h)
          </div>
          <div className="space-y-1">
            {slots.suggestions.map((s) => (
              <div
                key={s.blueprint_type_id}
                className="flex items-center gap-2 py-1 border-b border-eve-border/30 last:border-0"
              >
                <img
                  src={`https://images.evetech.net/types/${s.blueprint_type_id}/icon?size=32`}
                  alt=""
                  className="w-6 h-6 rounded border border-eve-border shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-eve-text truncate">{s.product_name}</div>
                  <div className="text-xs text-eve-muted">{s.blueprint_name}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs text-green-400 font-mono">{isk(s.profit)} ISK</div>
                  <div className="text-xs text-eve-muted">{isk(s.isk_per_hour)}/h</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {slots.suggestions.length === 0 && freeMfg > 0 && (
        <div className="text-xs text-eve-muted/60 italic">
          No profitable suggestions found. Configure system &amp; prices in settings.
        </div>
      )}
    </div>
  );
}

export default function SlotsPage({ character }: Props) {
  const [slots, setSlots]     = useState<CharacterSlots[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const { esiKey } = useRefresh();

  const load = () => {
    setLoading(true);
    setError(null);
    fetchSlots()
      .then(setSlots)
      .catch((e) => setError(e?.response?.data?.detail ?? "Failed to load slots"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [esiKey]);

  return (
    <div className="min-h-screen bg-eve-bg font-eve">
      <Navbar character={character} />

      <main className="max-w-screen-2xl mx-auto px-4 py-6 space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-eve-text">Dashboard</h1>
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-700/40 rounded-lg p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {loading && slots.length === 0 ? (
          <div className="text-center py-16 text-eve-muted text-sm">Loading character data…</div>
        ) : slots.length === 0 ? (
          <div className="text-center py-16 text-eve-muted text-sm">
            No character data available. Make sure your characters are linked and the ESI scopes include industry jobs.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {slots.map((s) => (
              <CharacterCard key={s.character_id} slots={s} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
