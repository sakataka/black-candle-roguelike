import { getGameConfig } from "../content/config";
import type { AbilityEffects, Entity, RunModifiers } from "../types";
import { roleTraits } from "./stateOps";

// 遠征に付けたアビリティの効果。職業特性と同じ種類は足し合わせる。
// 固有技と職業専用イベントは職業IDで判定したまま、ここでは扱わない。

const additiveKeys = [
  "trapAvoidPercent", "rangedDefense", "healPercent", "stealth", "cleansingGuardTurns", "attack", "defense", "maxHp",
  "descentHeal", "startEmbers", "maxEmbers", "bossDamagePercent", "conditionDamageReduction", "roomTrapReveal", "freeUnlock",
] as const satisfies readonly (keyof AbilityEffects)[];

/** 付けたアビリティの効果を合計する。未定義のIDは無視する。 */
export function abilityEffects(abilityIds: readonly string[] = []): AbilityEffects {
  const definitions = getGameConfig().abilities?.definitions ?? {};
  const total: AbilityEffects = {};
  for (const id of abilityIds) {
    const effects = definitions[id]?.effects;
    if (!effects) continue;
    for (const key of additiveKeys) {
      if (effects[key]) total[key] = (total[key] ?? 0) + effects[key];
    }
    if (effects.roomRevealRadius) total.roomRevealRadius = Math.max(total.roomRevealRadius ?? 0, effects.roomRevealRadius);
    total.bossReward ??= effects.bossReward;
  }
  return total;
}

export function runAbilityEffects(state: { modifiers: Pick<RunModifiers, "abilities"> }): AbilityEffects {
  return abilityEffects(state.modifiers.abilities);
}

/** 探索者なら職業特性にアビリティを重ねた特性、敵なら職業特性（通常は無し）。 */
export function playerTraits(state: { modifiers: Pick<RunModifiers, "abilities"> }, actor: Pick<Entity, "kind" | "contentId">) {
  const role = roleTraits(actor.contentId);
  if (actor.kind !== "player") return role;
  const effects = runAbilityEffects(state);
  return {
    ...role,
    trapAvoidPercent: (role?.trapAvoidPercent ?? 0) + (effects.trapAvoidPercent ?? 0),
    rangedDefense: (role?.rangedDefense ?? 0) + (effects.rangedDefense ?? 0),
    healPercent: (role?.healPercent ?? 0) + (effects.healPercent ?? 0),
    stealth: (role?.stealth ?? 0) + (effects.stealth ?? 0),
    roomRevealRadius: Math.max(role?.roomRevealRadius ?? 0, effects.roomRevealRadius ?? 0) || undefined,
    bossReward: role?.bossReward ?? effects.bossReward,
  };
}
