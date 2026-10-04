import { chebyshev, samePoint } from "./spatial";
import type { Entity, GameState, Point } from "../types";

/**
 * 1アクション前後の状態差分から描画演出用のイベントを導出する。
 * ルール処理には関与せず、renderer と UI がダメージ表示や撃破演出に使う。
 */
export type VisualEvent =
  | { kind: "damage"; entityId: string; pos: Point; amount: number; isPlayer: boolean }
  | { kind: "heal"; entityId: string; pos: Point; amount: number; isPlayer: boolean }
  | { kind: "death"; entityId: string; contentId: string; pos: Point }
  | { kind: "strike"; attackerId: string; defenderId: string; from: Point; to: Point; ranged: boolean }
  | { kind: "pickup"; contentId: string; pos: Point }
  | { kind: "levelUp"; pos: Point; level: number }
  | { kind: "statusFx"; effect: "ward-aura" | "venom-impact" | "frost-bind" | "repulsion-gust"; pos: Point }
  | { kind: "floorChanged"; floor: number };

export function deriveVisualEvents(before: GameState, after: GameState): VisualEvent[] {
  if (before === after) return [];
  if (before.floor !== after.floor || before.seed !== after.seed) {
    return [{ kind: "floorChanged", floor: after.floor }];
  }
  const events: VisualEvent[] = [];
  for (const strike of after.strikes ?? []) {
    events.push({ kind: "strike", ...strike });
  }
  const afterById = new Map(after.entities.map((entity) => [entity.id, entity]));
  const player = afterById.get(after.playerId);
  for (const previous of before.entities) {
    const current = afterById.get(previous.id);
    if (!current) {
      if (previous.kind === "monster") {
        events.push({ kind: "death", entityId: previous.id, contentId: previous.contentId, pos: { ...previous.pos } });
      } else if (previous.kind === "item" && player && samePoint(previous.pos, player.pos)) {
        events.push({ kind: "pickup", contentId: previous.contentId, pos: { ...previous.pos } });
      }
      continue;
    }
    const delta = hpDelta(previous, current);
    if (after.tiles[current.pos.y * after.width + current.pos.x]?.visible) {
      for (const condition of current.conditions ?? []) {
        const oldTurns = previous.conditions?.find((entry) => entry.kind === condition.kind)?.turns ?? 0;
        const effect = condition.kind === "guarded" ? "ward-aura" : condition.kind === "venomed" ? "venom-impact" : condition.kind === "dazed" ? "frost-bind" : null;
        if (effect && condition.turns > oldTurns) events.push({ kind: "statusFx", effect, pos: { ...current.pos } });
      }
      // 押し戻された敵と、突進・影渡り・退き足で一気に動いた探索者。
      if ((current.kind === "monster" || current.kind === "player") && chebyshev(previous.pos, current.pos) > 1) events.push({ kind: "statusFx", effect: "repulsion-gust", pos: { ...previous.pos } });
    }
    if (delta < 0) {
      events.push({ kind: "damage", entityId: current.id, pos: { ...current.pos }, amount: -delta, isPlayer: current.id === after.playerId });
    } else if (delta > 0) {
      events.push({ kind: "heal", entityId: current.id, pos: { ...current.pos }, amount: delta, isPlayer: current.id === after.playerId });
    }
  }
  if (player && after.playerProgress.level > before.playerProgress.level) {
    events.push({ kind: "levelUp", pos: { ...player.pos }, level: after.playerProgress.level });
  }
  return events;
}

function hpDelta(previous: Entity, current: Entity): number {
  if (!previous.stats || !current.stats) return 0;
  return current.stats.hp - previous.stats.hp;
}
