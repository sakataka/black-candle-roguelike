import { getGameConfig } from "../content/config";
import type { GameAction, GameMessage, GameState } from "../types";

export type PaceKind = "calm" | "traversal" | "exploration" | "danger";

/**
 * 次の自動行動までの表示間隔の種類を決める。
 * 敵が見えない移動は早送りし、戦闘や被害が出た手はゆっくり見せる。
 */
export function paceKindFor(lastAction: GameAction, state: GameState, messageDelta: GameMessage[]): PaceKind {
  if (messageDelta.some((message) => message.tone === "combat" || message.tone === "danger")) return "danger";
  if (lastAction.type !== "move") return "exploration";
  return hasVisibleHostile(state) ? "traversal" : "calm";
}

export function paceDelayMs(kind: PaceKind): number {
  const pacing = getGameConfig().autonomous.pacingMs;
  return pacing[kind] ?? pacing.traversal;
}

function hasVisibleHostile(state: GameState): boolean {
  return state.entities.some((entity) => entity.kind === "monster" && entity.hostile && state.tiles[entity.pos.y * state.width + entity.pos.x]?.visible);
}
