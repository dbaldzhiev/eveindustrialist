import React from "react";

interface Props {
  ids: number[];
  nameMap: Map<number, string>;
  size?: number;
}

export function OwnerPortraits({ ids, nameMap, size = 16 }: Props) {
  if (!ids || ids.length === 0) return null;

  return (
    <div className="flex items-center gap-0.5">
      {ids.map(id => {
        const name = nameMap.get(id) ?? `#${id}`;
        return (
          <div key={id} className="relative group/owner">
            <img
              src={`https://images.evetech.net/characters/${id}/portrait?size=64`}
              alt={name}
              className="rounded-full border border-eve-border/60 bg-eve-bg"
              style={{ width: size, height: size }}
            />
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5
                            bg-eve-surface border border-eve-border rounded text-[9px] text-eve-text
                            whitespace-nowrap opacity-0 group-hover/owner:opacity-100 transition-opacity
                            pointer-events-none z-50 shadow-lg">
              {name}
            </div>
          </div>
        );
      })}
    </div>
  );
}
