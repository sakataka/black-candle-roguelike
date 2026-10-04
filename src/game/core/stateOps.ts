import { getGameConfig } from "../content/config";
import { blocksSight, chebyshev, inBounds, linePoints, tileAt } from "./spatial";
import type { Entity, GameMessage, GameState, Point } from "../types";

// 核の各モジュールが共有する小さな状態操作。game.ts に依存させない。

export function pushMessage(state: GameState, text: string, tone: GameMessage["tone"]): GameMessage[] {
  return [...state.messages, message(state.turn, text, tone)].slice(-80);
}

export function message(turn: number, text: string, tone: GameMessage["tone"]): GameMessage {
  return { turn, text, tone };
}

export function hasLineOfSight(state: GameState, from: Point, to: Point): boolean {
  // 敵の視線は闇の余波を受けない。暗さで目が利かなくなるのは探索者の視界（updateVisibility）だけ。
  if (chebyshev(from, to) > getGameConfig().rules.fovRadius) {
    return false;
  }
  for (const point of linePoints(from, to)) {
    if (!inBounds(state, point) || blocksSight(tileAt(state, point).kind)) {
      return false;
    }
  }
  return true;
}

export function recordStrike(state: GameState, attacker: Entity, defender: Entity, ranged: boolean): void {
  state.strikes = [...(state.strikes ?? []), { attackerId: attacker.id, defenderId: defender.id, from: { ...attacker.pos }, to: { ...defender.pos }, ranged }];
}

export function roleTraits(roleId: string) {
  return getGameConfig().roles.find((role) => role.id === roleId)?.traits;
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
