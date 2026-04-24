import { useEffect, useRef, useState } from "react";
import { fetchCharacterSkills } from "../api/client";
import type { CharacterSkillData } from "../api/client";
import { useRefresh } from "../context/RefreshContext";

type Activity = "build" | "invent" | "copy" | "react";

type SkillMap = CharacterSkillData["skills"];

interface SkillRow {
  key:      keyof SkillMap;
  label:    string;
  required: number;    // 0 = informational, >0 = hard requirement
  effect:   string;
}

const ACTIVITY_CONFIG: Record<Activity, { label: string; canDo: (s: SkillMap) => boolean; skills: SkillRow[] }> = {
  build: {
    label: "Manufacturing",
    canDo: () => true,
    skills: [
      { key: "industry",            label: "Industry",              required: 0, effect: "−4% time/lvl"     },
      { key: "adv_industry",        label: "Advanced Industry",     required: 0, effect: "−3% time/lvl"     },
      { key: "mass_production",     label: "Mass Production",       required: 0, effect: "+1 mfg slot/lvl"  },
      { key: "adv_mass_production", label: "Adv. Mass Production",  required: 0, effect: "+1 mfg slot/lvl"  },
    ],
  },
  invent: {
    label: "Invention",
    canDo: (s) => s.science >= 1 && s.lab_operation >= 1,
    skills: [
      { key: "science",           label: "Science",               required: 1, effect: "Required ≥ 1"       },
      { key: "lab_operation",     label: "Lab Operation",         required: 1, effect: "+1 lab slot/lvl"    },
      { key: "adv_lab_operation", label: "Adv. Lab Operation",    required: 0, effect: "+1 lab slot/lvl"    },
    ],
  },
  copy: {
    label: "Copying",
    canDo: (s) => s.science >= 1 && s.lab_operation >= 1,
    skills: [
      { key: "science",           label: "Science",               required: 1, effect: "Required ≥ 1"       },
      { key: "lab_operation",     label: "Lab Operation",         required: 1, effect: "+1 lab slot/lvl"    },
      { key: "adv_lab_operation", label: "Adv. Lab Operation",    required: 0, effect: "+1 lab slot/lvl"    },
    ],
  },
  react: {
    label: "Reactions",
    canDo: (s) => s.mass_reactions >= 1,
    skills: [
      { key: "mass_reactions", label: "Mass Reactions", required: 1, effect: "+1 reaction slot/lvl" },
    ],
  },
};

function SkillPips({ level }: { level: number }) {
  return (
    <span className="flex gap-0.5 ml-1">
      {[1,2,3,4,5].map((i) => (
        <span key={i} className={`w-1.5 h-1.5 rounded-full ${i <= level ? "bg-eve-orange" : "bg-eve-border"}`} />
      ))}
    </span>
  );
}

interface TooltipProps {
  char:     CharacterSkillData;
  activity: Activity;
}

function Tooltip({ char, activity }: TooltipProps) {
  const config  = ACTIVITY_CONFIG[activity];
  const canDo   = config.canDo(char.skills);

  return (
    <div className="w-56 p-3 space-y-2">
      <div className="flex items-center gap-2 pb-2 border-b border-eve-border/60">
        <img
          src={`https://images.evetech.net/characters/${char.character_id}/portrait?size=32`}
          alt={char.character_name}
          className="w-6 h-6 rounded-full border border-eve-border"
        />
        <span className="text-xs font-semibold text-eve-text truncate flex-1">{char.character_name}</span>
        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
          canDo ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
        }`}>
          {canDo ? "Eligible" : "Missing skills"}
        </span>
      </div>

      <div className="space-y-1.5">
        {config.skills.map((row) => {
          const level   = char.skills[row.key] ?? 0;
          const missing = row.required > 0 && level < row.required;
          return (
            <div key={row.key} className="flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className={`text-[11px] truncate ${missing ? "text-red-400" : "text-eve-text"}`}>
                  {missing && <span className="mr-1">✗</span>}
                  {row.label}
                </div>
                <div className="text-[9px] text-eve-muted/60">{row.effect}</div>
              </div>
              <div className="flex items-center shrink-0">
                <span className={`text-xs font-mono mr-1 ${missing ? "text-red-400" : "text-eve-muted"}`}>
                  {level}
                </span>
                <SkillPips level={level} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface BadgeProps {
  char:     CharacterSkillData;
  activity: Activity;
}

function Badge({ char, activity }: BadgeProps) {
  const config  = ACTIVITY_CONFIG[activity];
  const canDo   = config.canDo(char.skills);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <div className="relative cursor-default">
        <img
          src={`https://images.evetech.net/characters/${char.character_id}/portrait?size=32`}
          alt={char.character_name}
          className={`w-8 h-8 rounded-full border-2 transition-colors ${
            canDo ? "border-green-500/70" : "border-red-500/50"
          }`}
        />
        <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border border-eve-bg flex items-center justify-center text-[8px] font-bold ${
          canDo ? "bg-green-500" : "bg-red-500"
        }`}>
          {canDo ? "✓" : "✗"}
        </span>
      </div>

      {open && (
        <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50
                        bg-eve-surface border border-eve-border rounded-lg shadow-xl
                        pointer-events-none">
          <Tooltip char={char} activity={activity} />
        </div>
      )}
    </div>
  );
}

interface Props {
  activity: Activity;
}

export default function CharacterSkillBadges({ activity }: Props) {
  const [characters, setCharacters] = useState<CharacterSkillData[]>([]);
  const [loading, setLoading]       = useState(true);
  const { esiKey } = useRefresh();

  useEffect(() => {
    setLoading(true);
    fetchCharacterSkills()
      .then(setCharacters)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [esiKey]);

  if (loading || characters.length === 0) return null;

  const config = ACTIVITY_CONFIG[activity];

  return (
    <div className="flex items-center gap-3">
      <span className="text-[9px] uppercase tracking-widest text-eve-muted/50 font-semibold">
        {config.label}
      </span>
      <div className="flex items-center gap-1.5">
        {characters.map((char) => (
          <Badge key={char.character_id} char={char} activity={activity} />
        ))}
      </div>
    </div>
  );
}
