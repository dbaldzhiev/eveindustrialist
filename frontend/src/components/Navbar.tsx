import { NavLink } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import type { Character, CharacterGroup } from "../types";
import { fetchCharacterGroup } from "../api/client";

interface Props {
  character: Character;
}

const TABS = [
  { to: "/slots",     label: "Dashboard"    },
  { to: "/dashboard", label: "My Blueprints" },
  { to: "/explorer",  label: "Explorer"     },
  { to: "/warehouse", label: "Warehouse"    },
  { to: "/plans",     label: "Plans"        },
  { to: "/settings",  label: "Settings"     },
];

export default function Navbar({ character }: Props) {
  const [group, setGroup] = useState<CharacterGroup | null>(null);
  const [showCharMenu, setShowCharMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchCharacterGroup().then(setGroup).catch(() => {});
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowCharMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleLogout = () => {
    window.location.href = "/auth/logout";
  };

  const handleAddCharacter = () => {
    window.location.href = "/auth/add-character";
  };

  const characters = group?.characters ?? [character];

  return (
    <header className="border-b border-eve-border bg-eve-surface sticky top-0 z-40">
      <div className="max-w-screen-2xl mx-auto px-4 h-12 flex items-center gap-6">
        <span className="font-bold tracking-wider text-eve-text shrink-0">
          EVE <span className="text-eve-orange">Industrialist</span>
        </span>

        {/* Tab navigation */}
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
            {/* Show avatars for all characters (max 3) */}
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
                  onClick={handleAddCharacter}
                  className="w-full text-left px-3 py-1.5 text-sm text-eve-muted
                             hover:text-eve-orange hover:bg-eve-bg transition-colors"
                >
                  + Add Character
                </button>
                <button
                  onClick={handleLogout}
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
    </header>
  );
}
