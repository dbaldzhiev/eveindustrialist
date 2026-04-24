import { useState, useEffect } from "react";
import { fetchCharacterSkills, type CharacterSkillData } from "../api/client";
import { useRefresh } from "../context/RefreshContext";
import type { RequiredSkill } from "../types";

export interface EligibleChar {
  character_id:   number;
  character_name: string;
}

/**
 * Fetches all character skill data once; re-fetches when ESI is refreshed.
 */
export function useCharacterSkillData(): CharacterSkillData[] {
  const [chars, setChars] = useState<CharacterSkillData[]>([]);
  const { esiKey } = useRefresh();

  useEffect(() => {
    fetchCharacterSkills().then(setChars).catch(() => {});
  }, [esiKey]);

  return chars;
}

/**
 * Filters characters to those who have ALL required skills at the required levels.
 * If required_skills is empty, all characters qualify.
 */
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
        (parseInt(c.all_skills?.[String(req.skill_id)] as any ?? "0") || 0) >= req.level
      )
    )
    .map(c => ({ character_id: c.character_id, character_name: c.character_name }));
}

// Keep the simple activity-level hook for CharacterSkillBadges (page-level summary).
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
