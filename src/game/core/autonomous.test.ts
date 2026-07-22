import { beforeAll, describe, expect, test } from "bun:test";
import { loadBunGameConfig } from "../content/config";
import type { GameState } from "../types";
import {
  calculateScore,
  campaignProgress,
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

  test("危機介入は即時効果と評価を記録する", () => {
    const state = createInitialGame(20260504, "role.oathbound");
    const player = state.entities.find((entry) => entry.id === state.playerId);
    if (!player?.stats) throw new Error("Missing player stats");
    player.stats.hp = 6;
    state.pendingDecision = createContextDecision(state, 1, "test");
    const option = state.pendingDecision.options.find((entry) => entry.requiresRevelation);
    expect(option?.effect).toBeDefined();
    const next = applyAction(state, { type: "resolveDecision", optionId: option?.id ?? "" });
    expect(next.entities.find((entry) => entry.id === next.playerId)?.stats?.hp).toBeGreaterThan(6);
    expect(next.story.interventionScore).toBe(250);
    expect(next.story.decisions.at(-1)?.effectSummary).toBeTruthy();
  });

  test("遠征任務の達成で報酬と得点を得る", () => {
    const state = createInitialGame(20260504, "role.ash-scout", { missionId: "relic-ledger" });
    state.story.discoveries = ["a", "b", "c", "d", "e", "f"];
    const next = applyAction(state, { type: "wait" });
    expect(next.story.missionCompleted).toBe(true);
    expect(next.revelationsRemaining).toBe(3);
    expect(calculateScore(next).autonomy).toBe(1500);
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
    expect(campaign.expeditions[0].missionId).toBe(state.story.missionId);
    const lost = structuredClone(state) as GameState;
    lost.status = "lost";
    expect(recordCampaignResult(createCampaignState(), lost, "combat").roleTruths).toEqual([]);
  });

  test("遠征録から最高到達階、自己ベスト、物語進捗を集計する", () => {
    const state = createInitialGame(20260504, "role.oathbound", { missionId: "guardian-vow" });
    state.status = "won";
    state.floor = 10;
    state.story.maxFloorReached = 10;
    state.story.missionCompleted = true;
    state.story.endingId = "inherit-flame";
    const campaign = recordCampaignResult(createCampaignState(), state, null);
    const progress = campaignProgress(campaign);
    expect(progress.highestFloor).toBe(10);
    expect(progress.bestScore).toBeGreaterThan(0);
    expect(progress.completedMissionIds).toEqual(["guardian-vow"]);
    expect(progress.milestones.find((entry) => entry.label === "結末")?.unlocked).toBe(true);
  });

  test("version 1の遠征録は失わずversion 2へ移行する", () => {
    const state = createInitialGame(20260504, "role.ash-scout");
    state.status = "returned";
    state.floor = 4;
    state.story.maxFloorReached = 4;
    const currentRecord = recordCampaignResult(createCampaignState(), state, null).expeditions[0];
    const {
      missionId: _missionId,
      missionCompleted: _missionCompleted,
      discoveryCount: _discoveryCount,
      interventionCount: _interventionCount,
      ...legacyRecord
    } = currentRecord;
    const migrated = normalizeCampaignState({ version: 1, roleTruths: ["shared-oath"], expeditions: [legacyRecord] });
    expect(migrated.version).toBe(2);
    expect(migrated.roleTruths).toEqual(["shared-oath"]);
    expect(migrated.expeditions).toHaveLength(1);
    expect(migrated.expeditions[0].floor).toBe(4);
    expect(migrated.expeditions[0].missionId).toBe("swift-route");
    expect(migrated.expeditions[0].missionCompleted).toBe(false);
  });

  test("不正な保存データはversion 2の初期状態へ戻す", () => {
    expect(normalizeCampaignState({ version: 9, roleTruths: ["shared-oath"] })).toEqual(createCampaignState());
  });
});
