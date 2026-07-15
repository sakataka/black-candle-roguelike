import { beforeAll, describe, expect, test } from "bun:test";
import { loadBunGameConfig } from "../content/config";
import type { GameState } from "../types";
import {
  calculateScore,
  createCampaignState,
  createCheckpointDecision,
  createContextDecision,
  createFinalDecision,
  createRunIdentity,
  normalizeCampaignState,
  recordCampaignResult,
} from "./autonomous";
import { applyAction, createInitialGame } from "./game";
import { runSimulation } from "../sim/simulation";

beforeAll(async () => {
  await loadBunGameConfig("public/config/game-balance.json");
});

describe("自律遠征", () => {
  test("候補者はseedと職業から決定的に生成される", () => {
    expect(createRunIdentity(20260504, "role.oathbound")).toEqual(createRunIdentity(20260504, "role.oathbound"));
    expect(createRunIdentity(20260504, "role.oathbound")).not.toEqual(createRunIdentity(20260505, "role.oathbound"));
  });

  test("選択待ちでは通常行動を受け付けない", () => {
    const state = createInitialGame(20260504, "role.oathbound");
    state.pendingDecision = createContextDecision(state, 1, "test");
    expect(applyAction(state, { type: "move", direction: "north" })).toBe(state);
  });

  test("同じseed・候補者・選択方針は同じ遠征結果を再現する", async () => {
    const input = { seed: 20260504, roleId: "role.oathbound", turns: 320, configPath: "public/config/game-balance.json", label: "replay", decisionPolicy: "always-continue" as const };
    const first = await runSimulation(input);
    const second = await runSimulation(input);
    expect({ status: first.status, floor: first.floor, turns: first.turns, actions: first.actions, score: first.score, decisions: first.review.decisions })
      .toEqual({ status: second.status, floor: second.floor, turns: second.turns, actions: second.actions, score: second.score, decisions: second.review.decisions });
    expect(first.review.stats.turns).toBe(first.turns);
  });

  test("啓示で方針を上書きしてもターンを消費しない", () => {
    const state = createInitialGame(20260504, "role.oathbound");
    state.pendingDecision = createContextDecision(state, 1, "test");
    const option = state.pendingDecision.options.find((entry) => entry.requiresRevelation);
    expect(option).toBeDefined();
    const next = applyAction(state, { type: "resolveDecision", optionId: option?.id ?? "" });
    expect(next.runTurn).toBe(0);
    expect(next.revelationsRemaining).toBe(1);
    expect(next.directive).toBe(option?.directive);
    expect(next.pendingDecision).toBeNull();
  });

  test("章間帰還は敵ターンを発生させず戦果を確定する", () => {
    const state = createInitialGame(20260504, "role.oathbound");
    const hp = state.entities.find((entry) => entry.id === state.playerId)?.stats?.hp;
    state.pendingDecision = createCheckpointDecision(state);
    const next = applyAction(state, { type: "resolveDecision", optionId: "return" });
    expect(next.status).toBe("returned");
    expect(next.runTurn).toBe(0);
    expect(next.entities.find((entry) => entry.id === next.playerId)?.stats?.hp).toBe(hp);
  });

  test("慎重な探索者は6階で帰還を選び、続行には啓示を要する", () => {
    const identity = { name: "テスト", roleId: "role.oathbound", temperament: "cautious" as const };
    const state = createInitialGame(20260504, identity.roleId, { identity });
    state.floor = 6;
    const decision = createCheckpointDecision(state);
    expect(decision.defaultOptionId).toBe("return");
    expect(decision.options.filter((option) => option.outcome === "continue").every((option) => option.requiresRevelation)).toBe(true);
  });

  test("得点は生還時だけ持帰りと生還点を含む", () => {
    const returned = createInitialGame(20260504, "role.oathbound");
    returned.status = "returned";
    returned.playerProgress.gold = 100;
    const lost = structuredClone(returned) as GameState;
    lost.status = "lost";
    expect(calculateScore(returned).survival).toBe(2000);
    expect(calculateScore(returned).recoveredValue).toBeGreaterThan(0);
    expect(calculateScore(lost).survival).toBe(0);
    expect(calculateScore(lost).recoveredValue).toBe(0);
  });

  test("三職業の真相が揃うと分灯が最終選択へ現れる", () => {
    const state = createInitialGame(20260504, "role.oathbound", {
      knownRoleTruths: ["shared-oath", "furnace-map", "purified-flame"],
    });
    const decision = createFinalDecision(state);
    expect(decision.options.some((option) => option.endingId === "divide-flame")).toBe(true);
  });

  test("生還した固有の真相だけcampaignへ記録する", () => {
    const state = createInitialGame(20260504, "role.ash-scout");
    state.status = "returned";
    state.story.carriedTruthId = "furnace-map";
    const campaign = recordCampaignResult(createCampaignState(), state, null);
    expect(campaign.roleTruths).toEqual(["furnace-map"]);
    const lost = structuredClone(state) as GameState;
    lost.status = "lost";
    expect(recordCampaignResult(createCampaignState(), lost, "combat").roleTruths).toEqual([]);
  });

  test("不正な保存データはversion 1の初期状態へ戻す", () => {
    expect(normalizeCampaignState({ version: 9, roleTruths: ["shared-oath"] })).toEqual(createCampaignState());
  });
});
