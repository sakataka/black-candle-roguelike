import { beforeAll, describe, expect, test } from "bun:test";
import { loadBunGameConfig } from "../content/config";
import type { GameState } from "../types";
import {
  availableMissions,
  calculateShards,
  campaignProgress,
  createCampaignState,
  createCheckpointDecision,
  createContextDecision,
  createFinalDecision,
  createRunIdentity,
  normalizeCampaignState,
  recommendedMission,
  recordCampaignResult,
  shardForecast,
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

  test("伝言の猶予中も通常行動と時計が進む", () => {
    const state = createInitialGame(20260504, "role.oathbound");
    state.pendingDecision = createContextDecision(state, 1, "test");
    const next = applyAction(state, { type: "move", direction: "north" });
    expect(next).not.toBe(state);
    expect(next.runTurn).toBe(state.runTurn + 1);
    expect(next.pendingDecision).not.toBeNull();
  });

  test("同じseed・候補者・選択方針は同じ遠征結果を再現する", async () => {
    const input = { seed: 20260504, roleId: "role.oathbound", turns: 320, configPath: "public/config/game-balance.json", label: "replay", decisionPolicy: "always-continue" as const };
    const first = await runSimulation(input);
    const second = await runSimulation(input);
    expect({ status: first.status, floor: first.floor, turns: first.turns, actions: first.actions, shards: first.shards, decisions: first.review.decisions })
      .toEqual({ status: second.status, floor: second.floor, turns: second.turns, actions: second.actions, shards: second.shards, decisions: second.review.decisions });
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

  test("危機介入は即時効果と判断を記録する", () => {
    const state = createInitialGame(20260504, "role.oathbound");
    const player = state.entities.find((entry) => entry.id === state.playerId);
    if (!player?.stats) throw new Error("Missing player stats");
    player.stats.hp = 6;
    state.pendingDecision = createContextDecision(state, 1, "test");
    const option = state.pendingDecision.options.find((entry) => entry.requiresRevelation);
    expect(option?.effect).toBeDefined();
    const next = applyAction(state, { type: "resolveDecision", optionId: option?.id ?? "" });
    expect(next.entities.find((entry) => entry.id === next.playerId)?.stats?.hp).toBeGreaterThan(6);
    expect(next.story.decisions.at(-1)?.effectSummary).toBeTruthy();
  });

  test("任務の条件を満たすと灯火を得て、報酬の灯片は生還した時だけ受け取る", () => {
    const state = createInitialGame(20260504, "role.ash-scout", { missionId: "relic-ledger" });
    state.lantern.embers = 0;
    state.story.discoveries = ["a", "b", "c", "d", "e", "f"];
    const next = applyAction(state, { type: "wait" });
    expect(next.story.missionCompleted).toBe(true);
    expect(next.lantern.embers).toBe(1);
    const returned = structuredClone(next) as GameState;
    returned.status = "returned";
    const lost = structuredClone(next) as GameState;
    lost.status = "lost";
    expect(calculateShards(returned).mission).toBe(5);
    expect(calculateShards(lost).mission).toBe(0);
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

  test("帰還路の既定は任務に従う。真相を抱えた真相任務は帰還し、続行には啓示を要する", () => {
    const identity = { name: "テスト", roleId: "role.oathbound", temperament: "bold" as const };
    const truth = createInitialGame(20260504, identity.roleId, { identity, missionId: "truth-return" });
    truth.floor = 6;
    truth.story.carriedTruthId = "shared-oath";
    const decision = createCheckpointDecision(truth);
    expect(decision.defaultOptionId).toBe("return");
    expect(decision.options.filter((option) => option.outcome === "continue").every((option) => option.requiresRevelation)).toBe(true);
    const core = createInitialGame(20260504, identity.roleId, { identity: { ...identity, temperament: "cautious" }, missionId: "black-core" });
    core.floor = 6;
    core.story.carriedTruthId = "shared-oath";
    expect(createCheckpointDecision(core).defaultOptionId).toBe("continue-survival");
  });

  test("灯片は生還時だけ生還・持ち帰り・真相を含み、倒れると到達分の一部だけ残る", () => {
    const returned = createInitialGame(20260504, "role.oathbound");
    returned.status = "returned";
    returned.playerProgress.gold = 300;
    returned.story.maxFloorReached = 6;
    returned.story.bossesDefeated = 2;
    returned.story.carriedTruthId = "shared-oath";
    const lost = structuredClone(returned) as GameState;
    lost.status = "lost";
    const kept = calculateShards(returned);
    const left = calculateShards(lost);
    expect(kept.survival).toBe(3);
    expect(kept.carried).toBe(3);
    expect(kept.truth).toBe(5);
    expect(kept.depth).toBe(6);
    expect(left.survival + left.carried + left.truth + left.mission).toBe(0);
    expect(left.depth).toBe(3);
    expect(left.guardians).toBe(2);
    const playing = structuredClone(returned) as GameState;
    playing.status = "playing";
    expect(shardForecast(playing)).toEqual({ ifReturned: kept.total, ifLost: left.total });
  });

  test("既に記録した真相は灯片を増やさない", () => {
    const state = createInitialGame(20260504, "role.oathbound", { knownRoleTruths: ["shared-oath"] });
    state.status = "returned";
    state.story.carriedTruthId = "shared-oath";
    expect(calculateShards(state).truth).toBe(0);
  });

  test("三職業の真相が揃うと分灯が最終選択へ現れる", () => {
    const state = createInitialGame(20260504, "role.oathbound", {
      knownRoleTruths: ["shared-oath", "furnace-map", "purified-flame"],
    });
    const decision = createFinalDecision(state);
    expect(decision.options.some((option) => option.endingId === "divide-flame")).toBe(true);
  });

  test("真相が揃わないまま第十層の番人を越えると、問いを挟まず踏破で終わる", () => {
    const state = createInitialGame(20260504, "role.oathbound", { missionId: "black-core" });
    state.floor = 10;
    const player = state.entities.find((entry) => entry.id === state.playerId)!;
    const stairs = state.tiles.findIndex((tile) => tile.kind === "stairsDown");
    if (stairs < 0) throw new Error("Missing stairs");
    player.pos = { x: stairs % state.width, y: Math.floor(stairs / state.width) };
    state.entities = state.entities.filter((entry) => entry.kind !== "monster");
    const next = applyAction(state, { type: "descend" });
    expect(next.status).toBe("won");
    expect(next.pendingDecision).toBeNull();
    expect(next.story.missionCompleted).toBe(true);
    expect(calculateShards(next).mission).toBe(10);
  });

  test("任務は探索者と灰灯院の状況から推奨し、墓標がなければ弔いを出さない", () => {
    const fresh = { roleId: "role.ash-scout", knownRoleTruths: [], graveCount: 0 };
    expect(recommendedMission(fresh)).toBe("truth-return");
    expect(availableMissions(fresh).some((mission) => mission.id === "memorial")).toBe(false);
    const known = { roleId: "role.ash-scout", knownRoleTruths: ["furnace-map" as const], graveCount: 1 };
    expect(recommendedMission(known)).toBe("memorial");
    expect(recommendedMission({ ...known, graveCount: 0 })).toBe("black-core");
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

  test("遠征録から最高到達階、最多灯片、黒燭への道を集計する", () => {
    const state = createInitialGame(20260504, "role.oathbound", { missionId: "black-core" });
    state.status = "won";
    state.floor = 10;
    state.story.maxFloorReached = 10;
    state.story.missionCompleted = true;
    state.story.endingId = "inherit-flame";
    const campaign = recordCampaignResult(createCampaignState(), state, null);
    const progress = campaignProgress(campaign);
    expect(progress.highestFloor).toBe(10);
    expect(progress.bestShards).toBeGreaterThan(0);
    expect(progress.completedMissionIds).toEqual(["black-core"]);
    expect(progress.roadmap.find((entry) => entry.id === "ending")?.done).toBe(true);
    expect(progress.roadmap.find((entry) => entry.id === "black-core")?.done).toBe(true);
    expect(progress.nextChapter?.id).toBe("first-truth");
  });

  test("version 1の遠征録は失わず現行versionへ移行する", () => {
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
    expect(migrated.version).toBe(4);
    expect(migrated.shards).toBe(0);
    expect(migrated.roster).toEqual([]);
    expect(migrated.roleTruths).toEqual(["shared-oath"]);
    expect(migrated.expeditions).toHaveLength(1);
    expect(migrated.expeditions[0].floor).toBe(4);
    expect(migrated.expeditions[0].missionId).toBe("truth-return");
    expect(migrated.expeditions[0].missionCompleted).toBe(false);
  });

  test("version 3 の得点つき記録は灯片の合計を保ち、旧任務は未達として読む", () => {
    const state = createInitialGame(20260504, "role.ash-scout");
    state.status = "returned";
    const { shards: _shards, ...record } = recordCampaignResult(createCampaignState(), state, null).expeditions[0];
    const legacy = { ...record, score: { total: 16448 }, shardsEarned: 22, missionId: "guardian-vow", missionCompleted: true };
    const migrated = normalizeCampaignState({ version: 3, roleTruths: [], expeditions: [legacy], shards: 22 });
    expect(migrated.expeditions[0].shards.total).toBe(22);
    expect(migrated.expeditions[0].missionCompleted).toBe(false);
    expect("score" in migrated.expeditions[0]).toBe(false);
    expect(campaignProgress(migrated).bestShards).toBe(22);
  });

  test("不正な保存データは初期状態へ戻す", () => {
    expect(normalizeCampaignState({ version: 9, roleTruths: ["shared-oath"] })).toEqual(createCampaignState());
  });
});
