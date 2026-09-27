import { getGameConfig } from "../content/config";
import { contentEntities } from "../content/entities";
import type { GameAction, GameObservation, LanternRiteId, Point } from "../types";

export type WatcherPolicy = "none" | "lantern";

/**
 * 灯守（人間の観戦者）の介入を模したルールベース判断。
 * batch simulation で灯介入の効果を測るために使い、探索者AIとは独立させる。
 */
export function chooseWatcherAction(observation: GameObservation, policy: WatcherPolicy): GameAction | null {
  if (policy === "none" || observation.pendingDecision || observation.status !== "playing") return null;
  const { rites, watcher } = getGameConfig().lantern;
  const embers = observation.lantern.embers;
  const affordable = (rite: LanternRiteId) => embers >= rites[rite].cost;
  const stats = observation.player.stats;
  if (!stats) return null;
  const hpRatio = stats.hp / stats.maxHp;
  const afflicted = observation.player.conditions?.some((condition) => condition.kind === "bleeding" || condition.kind === "venomed") ?? false;
  const guarded = observation.player.conditions?.some((condition) => condition.kind === "guarded") ?? false;
  const hostiles = observation.visibleEntities.filter((entity) => entity.kind === "monster" && entity.hostile);
  const undazedHostiles = hostiles.filter((entity) => !isDazedVisible(entity));
  const adjacent = undazedHostiles.filter((entity) => distance(entity.pos, observation.player.pos) <= 1);
  const ranged = undazedHostiles.filter((entity) => getGameConfig().rangedMonsters.includes(entity.contentId) && distance(entity.pos, observation.player.pos) <= 6);
  const bossNear = undazedHostiles.some((entity) => contentEntities[entity.contentId]?.tier === "boss" && distance(entity.pos, observation.player.pos) <= 2);

  if (affordable("mend") && (hpRatio <= watcher.mendHpRatio || (afflicted && hpRatio <= watcher.mendAfflictedHpRatio))) {
    return { type: "invokeLantern", rite: "mend" };
  }
  if (affordable("flare") && (adjacent.length >= watcher.flareAdjacentHostiles || (bossNear && hpRatio <= watcher.flareBossHpRatio))) {
    return { type: "invokeLantern", rite: "flare" };
  }
  if (affordable("ward") && !guarded && ranged.length >= watcher.wardRangedThreats && hpRatio <= watcher.wardHpRatio) {
    return { type: "invokeLantern", rite: "ward" };
  }
  if (affordable("guide") && embers >= watcher.guideMinEmbers && observation.turn >= watcher.guideFloorTurns && !observation.exploration.reachableStairs && hostiles.length === 0) {
    return { type: "invokeLantern", rite: "guide" };
  }
  return null;
}

function isDazedVisible(entity: GameObservation["visibleEntities"][number]): boolean {
  return entity.conditions?.some((condition) => condition.kind === "dazed") ?? false;
}

function distance(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}
