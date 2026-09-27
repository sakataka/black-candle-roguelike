/// <reference lib="webworker" />
import { setGameConfig } from "../content/config";
import { runRollout, summarizeRollouts, type LookaheadSummary, type RolloutOutcome } from "./rollout";
import type { GameConfig, GameState } from "../types";

export type LookaheadRequest = {
  requestId: string;
  config: GameConfig;
  state: GameState;
  optionId: string;
  rollouts: number;
  tactics?: string[];
};

export type LookaheadProgress = {
  requestId: string;
  summary: LookaheadSummary;
  done: boolean;
};

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<LookaheadRequest>) => {
  const { requestId, config, state, optionId, rollouts, tactics } = event.data;
  setGameConfig(config);
  const outcomes: RolloutOutcome[] = [];
  for (let index = 0; index < rollouts; index += 1) {
    outcomes.push(runRollout(state, optionId, index, undefined, tactics));
    const done = index === rollouts - 1;
    // 数本ごとに途中結果を返し、判断画面の数字を徐々に確定させる。
    if (done || index % 2 === 1) {
      scope.postMessage({ requestId, summary: summarizeRollouts(optionId, outcomes), done } satisfies LookaheadProgress);
    }
  }
};
