import { beforeAll, describe, expect, test } from "bun:test";
import { chooseAutoplayAction, getAutoplayDebugState, resetAutoplayState } from "../ai/autoplay";
import { loadBunGameConfig } from "../content/config";
import { chooseDecisionAction, createRunIdentity } from "./autonomous";
import { applyAction, createInitialGame, observeGame } from "./game";
import { analyzeRun, createRunLog, recordTurn } from "./runLog";
import { buildRunInsights } from "./runInsights";

beforeAll(async () => {
  await loadBunGameConfig("public/config/game-balance.json");
});

describe("遠征の振り返り", () => {
  test("倒れた遠征から軌跡・転機・次回への示唆を組み立てる", () => {
    const seed = 20260507;
    const roleId = "role.oathbound";
    resetAutoplayState();
    const identity = createRunIdentity(seed, roleId);
    let state = createInitialGame(seed, roleId, { identity });
    const log = createRunLog(seed, roleId, {}, identity);
    for (let step = 0; step < 2000 && state.status === "playing"; step += 1) {
      const observation = observeGame(state);
      const action = observation.pendingDecision ? chooseDecisionAction(observation, "temperament") : chooseAutoplayAction(observation);
      const debug = getAutoplayDebugState(observation);
      const before = state;
      state = applyAction(state, action);
      recordTurn({ log, before, action, after: state, actor: "ai", aiDebug: debug });
    }
    expect(state.status).toBe("lost");
    const review = analyzeRun(log, state);
    const insights = buildRunInsights(log, state, review.deathCause);
    expect(insights.timeline.length).toBeGreaterThan(10);
    expect(insights.markers.some((marker) => marker.kind === "death")).toBe(true);
    expect(insights.turningPoints.some((point) => point.title === "最期")).toBe(true);
    expect(insights.advice.length).toBeGreaterThan(0);
  });
});
