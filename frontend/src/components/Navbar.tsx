import { NavLink } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import type { Character, CharacterGroup } from "../types";
import { fetchCharacterGroup } from "../api/client";
import { useRefresh } from "../context/RefreshContext";

interface Props {
  character: Character;
}

const TABS = [
  { to: "/slots",     label: "Dashboard"    },
  { to: "/explorer",  label: "Explorer"     },
  { to: "/seller",    label: "Seller"       },
  { to: "/dashboard", label: "To Build"     },
  { to: "/invention", label: "To Invent"    },
  { to: "/copying",   label: "To Copy"      },
  { to: "/reactions", label: "To React"     },
  { to: "/warehouse", label: "Warehouse"    },
  { to: "/plans",     label: "Plans"        },
  { to: "/settings",  label: "Settings"     },
];

function timeAgo(ts: number | null): string {
  if (!ts) return "never";
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60)   return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export default function Navbar({ character }: Props) {
  const [group, setGroup] = useState<CharacterGroup | null>(null);
  const [showCharMenu, setShowCharMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [, setTick] = useState(0);

  const {
    pricesAt, esiAt, sdeAt,
    refreshingPrices, refreshingEsi, refreshingSde,
    doRefreshPrices, doRefreshEsi, doRefreshSde,
  } = useRefresh();

  useEffect(() => {
    fetchCharacterGroup().then(setGroup).catch(() => {});
  }, []);

  // Re-render every minute so "X ago" stays accurate
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowCharMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const characters = group?.characters ?? [character];

  return (
    <header className="border-b border-eve-border bg-eve-surface sticky top-0 z-40">
      {/* Main nav row */}
      <div className="max-w-screen-2xl mx-auto px-4 h-12 flex items-center gap-6">
        <span className="font-bold tracking-wider text-eve-text shrink-0">
          EVE <span className="text-eve-orange">Industrialist</span>
        </span>

        <nav className="flex items-center gap-1 flex-1">
          {TABS.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded text-sm transition-colors ${
                  isActive
                    ? "bg-eve-orange/15 text-eve-orange font-semibold"
                    : "text-eve-muted hover:text-eve-text hover:bg-eve-bg"
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Character menu */}
        <div className="relative shrink-0" ref={menuRef}>
          <button
            onClick={() => setShowCharMenu((p) => !p)}
            className="flex items-center gap-2 px-2 py-1 rounded hover:bg-eve-bg transition-colors"
          >
            <div className="flex -space-x-1.5">
              {characters.slice(0, 3).map((c) => (
                <img
                  key={c.character_id}
                  src={`https://images.evetech.net/characters/${c.character_id}/portrait?size=32`}
                  alt={c.character_name}
                  className="w-7 h-7 rounded-full border border-eve-border"
                />
              ))}
              {characters.length > 3 && (
                <div className="w-7 h-7 rounded-full border border-eve-border bg-eve-bg
                                flex items-center justify-center text-xs text-eve-muted">
                  +{characters.length - 3}
                </div>
              )}
            </div>
            <span className="text-sm text-eve-text hidden sm:inline">
              {character.character_name}
            </span>
            <svg className="w-3 h-3 text-eve-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showCharMenu && (
            <div className="absolute right-0 top-full mt-1 w-56 bg-eve-surface border border-eve-border
                            rounded-lg shadow-xl z-50 py-1">
              <div className="px-3 py-1.5 text-xs text-eve-muted uppercase tracking-widest font-semibold border-b border-eve-border/50 mb-1">
                Characters
              </div>
              {characters.map((c) => (
                <div key={c.character_id} className="flex items-center gap-2 px-3 py-1.5">
                  <img
                    src={`https://images.evetech.net/characters/${c.character_id}/portrait?size=32`}
                    alt={c.character_name}
                    className="w-6 h-6 rounded-full border border-eve-border"
                  />
                  <span className="text-sm text-eve-text flex-1 truncate">{c.character_name}</span>
                  {c.character_id === group?.primary_character_id && (
                    <span className="text-xs text-eve-orange">main</span>
                  )}
                </div>
              ))}
              <div className="border-t border-eve-border/50 mt-1 pt-1">
                <button
                  onClick={() => { window.location.href = "/auth/add-character"; }}
                  className="w-full text-left px-3 py-1.5 text-sm text-eve-muted
                             hover:text-eve-orange hover:bg-eve-bg transition-colors"
                >
                  + Add Character
                </button>
                <button
                  onClick={() => { window.location.href = "/auth/logout"; }}
                  className="w-full text-left px-3 py-1.5 text-sm text-eve-muted
                             hover:text-red-400 hover:bg-eve-bg transition-colors"
                >
                  Logout
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Global refresh bar */}
      <div className="border-t border-eve-border/40 bg-eve-bg/60">
        <div className="max-w-screen-2xl mx-auto px-4 h-8 flex items-center gap-6">
          {/* Prices */}
          <div className="flex items-center gap-2">
            <button
              onClick={doRefreshPrices}
              disabled={refreshingPrices}
              className="flex items-center gap-1.5 px-2.5 py-0.5 rounded
                         border border-eve-border/60 text-xs text-eve-muted
                         hover:border-eve-orange/50 hover:text-eve-orange
                         disabled:opacity-40 disabled:cursor-not-allowed
                         transition-colors"
            >
              <span className={refreshingPrices ? "animate-spin" : ""}>↻</span>
              {refreshingPrices ? "Refreshing…" : "Refresh Prices"}
            </button>
            <span className="text-xs text-eve-muted/50">
              {refreshingPrices ? "" : timeAgo(pricesAt)}
            </span>
          </div>

          <div className="w-px h-4 bg-eve-border/40" />

          {/* ESI */}
          <div className="flex items-center gap-2">
            <button
              onClick={doRefreshEsi}
              disabled={refreshingEsi}
              className="flex items-center gap-1.5 px-2.5 py-0.5 rounded
                         border border-eve-border/60 text-xs text-eve-muted
                         hover:border-eve-orange/50 hover:text-eve-orange
                         disabled:opacity-40 disabled:cursor-not-allowed
                         transition-colors"
            >
              <span className={refreshingEsi ? "animate-spin" : ""}>↻</span>
              {refreshingEsi ? "Syncing…" : "Refresh ESI"}
            </button>
            <span className="text-xs text-eve-muted/50">
              {refreshingEsi ? "" : timeAgo(esiAt)}
            </span>
          </div>

          <div className="w-px h-4 bg-eve-border/40" />

          {/* SDE */}
          <div className="flex items-center gap-2">
            <button
              onClick={doRefreshSde}
              disabled={refreshingSde}
              className="flex items-center gap-1.5 px-2.5 py-0.5 rounded
                         border border-eve-border/60 text-xs text-eve-muted
                         hover:border-eve-orange/50 hover:text-eve-orange
                         disabled:opacity-40 disabled:cursor-not-allowed
                         transition-colors"
            >
              <span className={refreshingSde ? "animate-spin" : ""}>↻</span>
              {refreshingSde ? "Importing…" : "Refresh SDE"}
            </button>
            <span className="text-xs text-eve-muted/50">
              {refreshingSde ? "" : timeAgo(sdeAt)}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
