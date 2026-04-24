import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { fetchCharacterSkills, type CharacterSkillData } from "../api/client";
import { useRefresh } from "../context/RefreshContext";
import type { BlueprintResult, RequiredSkill } from "../types";

export interface EligibleChar {
  character_id:   number;
  character_name: string;
}

function skillsFingerprint(chars: CharacterSkillData[]): string {
  return chars.map(c => `${c.character_id}:${JSON.stringify(c.all_skills)}`).join("|");
}

export function useCharacterSkillData(): CharacterSkillData[] {
  const [chars, setChars] = useState<CharacterSkillData[]>([]);
  const { esiKey } = useRefresh();
  const fingerprintRef = useRef("");

  const fetchAndSet = useCallback(async () => {
    try {
      const fresh = await fetchCharacterSkills();
      const fp = skillsFingerprint(fresh);
      if (fp !== fingerprintRef.current) {
        fingerprintRef.current = fp;
        setChars(fresh);
      }
    } catch {}
  }, []);

  useEffect(() => { fetchAndSet(); }, [esiKey, fetchAndSet]);

  // Auto-poll every 10 minutes; only triggers downstream recomputation if skills changed
  useEffect(() => {
    const id = setInterval(fetchAndSet, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [fetchAndSet]);

  return chars;
}

export function getEligibleForBp(
  chars: CharacterSkillData[],
  requiredSkills: RequiredSkill[] | undefined,
): EligibleChar[] {
  if (!requiredSkills || requiredSkills.length === 0) {
    return chars.map(c => ({ character_id: c.character_id, character_name: c.character_name }));
  }
  return chars
    .filter(c =>
      requiredSkills.every(req =>
        (c.all_skills?.[String(req.skill_id)] ?? 0) >= req.level
      )
    )
    .map(c => ({ character_id: c.character_id, character_name: c.character_name }));
}

/**
 * Precomputes eligibility for an entire blueprint list at once.
 * Deduplicates by required-skill signature so blueprints sharing the same
 * skill requirements are computed once. The map is only rebuilt when
 * `blueprints` or character skills actually change.
 */
export function useEligibilityMap(blueprints: BlueprintResult[]): Map<number, EligibleChar[]> {
  const charSkillData = useCharacterSkillData();
  return useMemo(() => {
    const sigCache = new Map<string, EligibleChar[]>();
    const map     = new Map<number, EligibleChar[]>();
    for (const bp of blueprints) {
      if (map.has(bp.blueprint_type_id)) continue;
      const sig = (bp.required_skills ?? [])
        .slice()
        .sort((a, b) => a.skill_id - b.skill_id)
        .map(s => `${s.skill_id}:${s.level}`)
        .join(",");
      if (!sigCache.has(sig)) {
        sigCache.set(sig, getEligibleForBp(charSkillData, bp.required_skills));
      }
      map.set(bp.blueprint_type_id, sigCache.get(sig)!);
    }
    return map;
  }, [blueprints, charSkillData]);
}

// Activity-level hook kept for CharacterSkillBadges page-summary badges.
const CAN_DO: Record<string, (s: Record<string, number>) => boolean> = {
  build:  () => true,
  invent: (s) => s.science >= 1 && s.lab_operation >= 1,
  copy:   (s) => s.science >= 1 && s.lab_operation >= 1,
  react:  (s) => s.mass_reactions >= 1,
};

export function useEligibleCharacters(activity: string): EligibleChar[] {
  const chars = useCharacterSkillData();
  if (!activity) return [];
  const test = CAN_DO[activity] ?? (() => true);
  return chars
    .filter(c => test(c.skills))
    .map(c => ({ character_id: c.character_id, character_name: c.character_name }));
}
