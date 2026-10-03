import { chooseAutoplayAction, resetAutoplayState } from "../ai/autoplay";
import { chooseDecisionAction } from "../core/autonomous";
import { applyAction, observeGame } from "../core/game";
import { realtimeConfig } from "../content/realtime";
import type { GameState } from "../types";

export type RolloutOutcome = {
  status: GameState["status"];
  maxFloor: number;
  runTurn: number;
};

export type LookaheadSummary = {
  optionId: string;
  rollouts: number;
  survived: number;
  lost: number;
  stranded: number;
  reachedCore: number;
  averageMaxFloor: number;
};

/**
 * 判断時点の状態から、選択肢を適用したあと探索者に任せた未来を1本だけ走らせる。
 * rolloutIndex ごとに seed をずらし、戦闘の乱数と未踏階層の生成を変える。
 * 灯守の追加介入はしない前提（「このまま見守った場合」）。
 */
export function runRollout(origin: GameState, optionId: string, rolloutIndex: number, maxSteps = 2400, tactics?: string[]): RolloutOutcome {
  resetAutoplayState();
  let state: GameState = structuredClone(origin);
  state.seed = perturbSeed(origin.seed, rolloutIndex);
  state = applyAction(state, { type: "resolveDecision", optionId, tactics });
  for (let step = 0; step < maxSteps && state.status === "playing"; step += 1) {
    const observation = observeGame(state);
    const action = observation.pendingDecision && !realtimeConfig().enabled ? chooseDecisionAction(observation, "temperament") : chooseAutoplayAction(observation);
    const next = applyAction(state, action);
    if (next === state) break;
    state = next;
  }
  return { status: state.status, maxFloor: state.story.maxFloorReached, runTurn: state.runTurn };
}

export function summarizeRollouts(optionId: string, outcomes: RolloutOutcome[]): LookaheadSummary {
  const count = outcomes.length;
  return {
    optionId,
    rollouts: count,
    survived: outcomes.filter((outcome) => outcome.status === "won" || outcome.status === "returned").length,
    lost: outcomes.filter((outcome) => outcome.status === "lost").length,
    stranded: outcomes.filter((outcome) => outcome.status === "stranded" || outcome.status === "playing").length,
    reachedCore: outcomes.filter((outcome) => outcome.maxFloor >= 10).length,
    averageMaxFloor: count === 0 ? 0 : outcomes.reduce((sum, outcome) => sum + outcome.maxFloor, 0) / count,
  };
}

function perturbSeed(seed: number, index: number): number {
  if (index === 0) return seed;
  return (Math.imul(seed ^ (index * 0x9e3779b1), 2654435761) >>> 0) % 100_000_000;
}
