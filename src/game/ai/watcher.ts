import { getGameConfig } from "../content/config";
import { contentEntities } from "../content/entities";
import { realtimeConfig } from "../content/realtime";
import { visibleDangerTiles } from "../core/realtime";
import type { GameAction, GameObservation, LanternRiteId, Point } from "../types";

export type WatcherPolicy = "none" | "lantern";

export type WatcherSuggestion = {
  action: GameAction;
  /** 画面の呼びかけに出す、なぜ今なのかの一文。 */
  reason: string;
  /** crisis は命や遠征に関わる場面、spare は灯火が満ちて溢れそうな場面。 */
  urgency: "crisis" | "spare";
};

/**
 * 灯守（人間の観戦者）の介入を模したルールベース判断。
 * batch simulation で灯介入の効果を測るために使い、探索者AIとは独立させる。
 */
export function chooseWatcherAction(observation: GameObservation, policy: WatcherPolicy): GameAction | null {
  if (policy === "none") return null;
  const suggestion = suggestLanternAction(observation);
  if (!suggestion) return null;
  // 灯守AIは従来どおり、危機と長引く探索にだけ灯を使う。満ちた灯火の消費は人間向けの提案に留める。
  return suggestion.urgency === "crisis" || isWatcherGuide(observation) ? suggestion.action : null;
}

/** 観戦画面の呼びかけ。灯守AIと同じ判断に理由を添え、灯火が満ちている時は使い道も示す。 */
export function suggestLanternAction(observation: GameObservation): WatcherSuggestion | null {
  if ((observation.pendingDecision && !realtimeConfig().enabled) || observation.status !== "playing") return null;
  const { rites, watcher } = getGameConfig().lantern;
  const embers = observation.lantern.embers;
  const affordable = (rite: LanternRiteId) => embers >= rites[rite].cost;
  const stats = observation.player.stats;
  if (!stats) return null;
  const hpRatio = stats.hp / stats.maxHp;
  const hpLabel = `命火${Math.round(hpRatio * 100)}%`;
  const afflicted = observation.player.conditions?.some((condition) => condition.kind === "bleeding" || condition.kind === "venomed") ?? false;
  const guarded = observation.player.conditions?.some((condition) => condition.kind === "guarded") ?? false;
  const hostiles = observation.visibleEntities.filter((entity) => entity.kind === "monster" && entity.hostile);
  const undazedHostiles = hostiles.filter((entity) => !isDazedVisible(entity));
  const adjacent = undazedHostiles.filter((entity) => distance(entity.pos, observation.player.pos) <= 1);
  const ranged = undazedHostiles.filter((entity) => getGameConfig().rangedMonsters.includes(entity.contentId) && distance(entity.pos, observation.player.pos) <= 6);
  const bossNear = undazedHostiles.some((entity) => contentEntities[entity.contentId]?.tier === "boss" && distance(entity.pos, observation.player.pos) <= 2);
  const crisis = (action: GameAction, reason: string): WatcherSuggestion => ({ action, reason, urgency: "crisis" });
  const dynamics = observation.expedition;
  if (realtimeConfig().enabled && dynamics) {
    if (!dynamics.borrowed && !dynamics.debt && embers === 0 && hpRatio <= realtimeConfig().loan.watcherHpRatio) return crisis({ type: "borrowFlame" }, `灯火が尽き、${hpLabel}`);
    const predictedDanger = visibleDangerTiles(observation).some((p) => p.x === observation.player.pos.x && p.y === observation.player.pos.y);
    if (predictedDanger && adjacent.length >= 2 && affordable("flare")) return crisis({ type: "invokeLantern", rite: "flare" }, `予告の危険範囲で${adjacent.length}体に囲まれている`);
    const lureable = hostiles.filter((e) => ["beast", "undead"].includes(contentEntities[e.contentId]?.family ?? "") && contentEntities[e.contentId]?.tier !== "boss" && distance(e.pos, observation.player.pos) > 1);
    if (embers >= realtimeConfig().light.cost + realtimeConfig().light.watcherReserve && dynamics.lights.length < realtimeConfig().light.maxActive && lureable.length >= realtimeConfig().light.watcherHostiles && hpRatio < watcher.wardHpRatio) {
      return crisis({ type: "placeLantern" }, `獣や亡者${lureable.length}体が迫っている。退路の灯で引きつけられる`);
    }
  }

  if (affordable("mend") && (hpRatio <= watcher.mendHpRatio || (afflicted && hpRatio <= watcher.mendAfflictedHpRatio))) {
    return crisis({ type: "invokeLantern", rite: "mend" }, afflicted ? `${hpLabel}、出血や毒に苦しんでいる` : `${hpLabel}まで削られた`);
  }
  if (affordable("flare") && (adjacent.length >= watcher.flareAdjacentHostiles || (bossNear && hpRatio <= watcher.flareBossHpRatio))) {
    return crisis({ type: "invokeLantern", rite: "flare" }, bossNear && adjacent.length < watcher.flareAdjacentHostiles ? `守り手の間合いで${hpLabel}` : `${adjacent.length}体に囲まれている`);
  }
  if (affordable("ward") && !guarded && ranged.length >= watcher.wardRangedThreats && hpRatio <= watcher.wardHpRatio) {
    return crisis({ type: "invokeLantern", rite: "ward" }, `射手${ranged.length}体に狙われ、${hpLabel}`);
  }
  if (isWatcherGuide(observation)) {
    return { action: { type: "invokeLantern", rite: "guide" }, reason: "階段が見つからず探索が長引いている", urgency: "spare" };
  }
  // 灯火が満ちている時は、次に得る灯火が溢れる。静かなうちに導灯で先を照らす使い道を示す。
  if (embers >= observation.lantern.maxEmbers && affordable("guide") && hostiles.length === 0 && !observation.exploration.reachableStairs) {
    return { action: { type: "invokeLantern", rite: "guide" }, reason: "灯火が満ちている。次の灯火は溢れて消える", urgency: "spare" };
  }
  return null;
}

function isWatcherGuide(observation: GameObservation): boolean {
  const { rites, watcher } = getGameConfig().lantern;
  const embers = observation.lantern.embers;
  const hostiles = observation.visibleEntities.some((entity) => entity.kind === "monster" && entity.hostile);
  return embers >= rites.guide.cost && embers >= watcher.guideMinEmbers && observation.turn >= watcher.guideFloorTurns && !observation.exploration.reachableStairs && !hostiles;
}

function isDazedVisible(entity: GameObservation["visibleEntities"][number]): boolean {
  return entity.conditions?.some((condition) => condition.kind === "dazed") ?? false;
}

function distance(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}
