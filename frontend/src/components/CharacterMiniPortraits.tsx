import type { EligibleChar } from "../hooks/useEligibleCharacters";

interface Props {
  characters: EligibleChar[];
  size?: number;
}

export function CharacterMiniPortraits({ characters, size = 20 }: Props) {
  if (characters.length === 0) return null;
  return (
    <div className="flex items-center gap-0.5">
      {characters.map(c => (
        <div key={c.character_id} className="relative group/port">
          <img
            src={`https://images.evetech.net/characters/${c.character_id}/portrait?size=32`}
            alt={c.character_name}
            className="rounded-full border border-green-500/50 hover:border-green-400 transition-colors"
            style={{ width: size, height: size }}
          />
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5
                          bg-eve-surface border border-eve-border rounded text-[9px] text-eve-text
                          whitespace-nowrap opacity-0 group-hover/port:opacity-100 transition-opacity
                          pointer-events-none z-50 shadow-lg">
            {c.character_name}
          </div>
        </div>
      ))}
    </div>
  );
}
