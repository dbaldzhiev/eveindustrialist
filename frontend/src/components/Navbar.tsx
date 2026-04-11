import { NavLink } from "react-router-dom";
import type { Character } from "../types";

interface Props {
  character: Character;
}

const TABS = [
  { to: "/dashboard",    label: "My Blueprints" },
  { to: "/explorer",     label: "Explorer"      },
  { to: "/warehouse",    label: "Warehouse"     },
  { to: "/shopping-list", label: "Shopping List" },
];

export default function Navbar({ character }: Props) {
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

        {/* Character info */}
        <div className="flex items-center gap-3 shrink-0">
          <img
            src={`https://images.evetech.net/characters/${character.character_id}/portrait?size=32`}
            alt={character.character_name}
            className="w-7 h-7 rounded-full border border-eve-border"
          />
          <span className="text-sm text-eve-text hidden sm:inline">
            {character.character_name}
          </span>
          <a
            href="/auth/logout"
            className="text-xs text-eve-muted hover:text-eve-orange transition-colors"
          >
            Logout
          </a>
        </div>
      </div>
    </header>
  );
}
