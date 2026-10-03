import { getGameConfig } from "./config";
import type { RealtimeConfig } from "../types";

/** 古い候補configは従来ルールとして比較できる。新しい閾値はJSON側で上書きする。 */
export const defaultRealtimeConfig: RealtimeConfig = {
  enabled: false,
  decisionTurns: { checkpoint: 24, context: 14, final: 28 },
  telegraphs: {
    "monster.hollow-archer": { kind: "shot", windup: 2, cooldown: 4, recovery: 1, range: 6, damageScale: 1.3 },
    "monster.blackstone-colossus": { kind: "sweep", windup: 3, cooldown: 4, recovery: 2, range: 2, damageScale: 1.4 },
    "monster.ash-warlock": { kind: "hex", windup: 3, cooldown: 5, recovery: 1, range: 5, damageScale: 1.2 },
    "monster.black-candle-warden": { kind: "hex", windup: 3, cooldown: 4, recovery: 2, range: 5, damageScale: 1.3 },
    "monster.fallen-keeper": { kind: "sweep", windup: 3, cooldown: 4, recovery: 2, range: 2, damageScale: 1.3 },
  },
  ai: { dodgeHpRatio: 1, terrainHpRatio: 0.75, terrainCooldown: 8, coverWeight: 3, hostileWeight: 5, trapLureWeight: 6, recoveryDamageBonus: 2, lessonHealBonus: 0.05, lessonTrapPatience: 8 },
  light: { cost: 1, duration: 14, radius: 3, lureRange: 6, maxActive: 1, watcherReserve: 1, watcherHostiles: 2 },
  loan: { healPercent: 22, guardedTurns: 4, debt: 2, embers: 2, watcherHpRatio: 0.24 },
  laws: { cryptWakeEveryKills: 3, cryptWakeLimit: 2, cryptWakeRadius: 6, cryptAttackBonus: 1, furnacePeriod: 12, furnaceWindup: 3, furnaceDuration: 2, furnaceDamage: 3, furnaceVentLimit: 3 },
  vows: { memorialHpRatio: 0.5, resolveBossTarget: 2, rewardEmbers: 1 },
  dialogue: { minTurns: 6, repeatTurns: 60, minMs: 2200, holdMs: 2500 },
};

export function realtimeConfig(): RealtimeConfig {
  return getGameConfig().realtime ?? defaultRealtimeConfig;
}

export function floorLawDescription(biome: "blackstone" | "crypt" | "furnace" | "black-candle"): string {
  const law = realtimeConfig().laws;
  return biome === "blackstone" ? "黒石は射線を遮る。柱の陰と狭い通路を使える。"
    : biome === "crypt" ? `${law.cryptWakeEveryKills}体倒すごとに近くの亡者が目覚める（この階で最大${law.cryptWakeLimit}体）。`
      : biome === "furnace" ? `通気口は${law.furnaceWindup}手の予告後、${law.furnaceDuration}手燃える。敵も熱を受ける。`
        : "灯を捧げると守り手の構えが変わる。新しい予告を見て動く。";
}
