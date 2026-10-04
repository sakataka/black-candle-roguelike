import { beforeAll, expect, test } from "bun:test";
import { loadBunGameConfig } from "../content/config";
import { campaignRunModifiers, createCampaignState, normalizeCampaignState, recordCampaignResult, upgradeFacility } from "./autonomous";
import { applyAction, createInitialGame, observeGame } from "./game";
import { contentEntities } from "../content/entities";
import { journeyProgress } from "./journey";

beforeAll(() => loadBunGameConfig("public/config/game-balance.json"));

test("二度の踏破で覚醒し、帰還や敗北では進まず、対応する踏破でのみ突破する", () => {
  let campaign = createCampaignState();
  for (let seed = 1; seed <= 2; seed++) {
    const state = createInitialGame(seed);
    state.status = "won";
    campaign = recordCampaignResult(campaign, state, null);
  }
  expect(journeyProgress(campaign).trial).toBe(1);
  for (const status of ["lost", "returned"] as const) {
    const state = createInitialGame(3, "role.oathbound", campaignRunModifiers(campaign));
    state.status = status;
    campaign = recordCampaignResult(campaign, state, null);
    expect(journeyProgress(campaign).trial).toBe(1);
  }
  const wrong = createInitialGame(4);
  wrong.status = "won";
  expect(recordCampaignResult(campaign, wrong, null).journey?.trialsCleared).toBe(0);
  const victory = createInitialGame(5, "role.oathbound", campaignRunModifiers(campaign));
  victory.status = "won";
  campaign = recordCampaignResult(campaign, victory, null);
  expect(campaign.journey?.trialsCleared).toBe(1);
  expect(journeyProgress(campaign).trial).toBe(0);
});

test("施設で灯片を消費しても鍛錬は残り、新人へ継承され、装備更新で攻撃補正を失わない", () => {
  const campaign = { ...createCampaignState(), shards: 100, journey: { victories: 0, trialsCleared: 0, lifetimeShards: 240 } };
  const spent = upgradeFacility(campaign, "altar");
  expect(journeyProgress(spent).rank).toBe(4);
  const base = createInitialGame(20260504);
  let trained = createInitialGame(20260504, "role.oathbound", campaignRunModifiers(spent));
  const stats = (state: typeof trained) => state.entities.find((e) => e.id === state.playerId)!.stats!;
  expect(stats(trained).maxHp - stats(base).maxHp).toBe(20);
  expect(stats(trained).attack - stats(base).attack).toBe(4);
  trained = applyAction(trained, { type: "equip", contentId: "item.rusted-sword" });
  const equippedBase = applyAction(base, { type: "equip", contentId: "item.rusted-sword" });
  expect(stats(trained).attack - stats(equippedBase).attack).toBe(4);
});

test("旧記録を移行し、保存一覧の上限を超えても累計と突破を保持する", () => {
  const state = createInitialGame(1);
  state.status = "won";
  const old = recordCampaignResult(createCampaignState(), state, null);
  const { journey: _, ...legacy } = old;
  const migrated = normalizeCampaignState(legacy);
  expect(migrated.journey?.victories).toBe(1);
  expect(migrated.journey?.lifetimeShards).toBe(old.expeditions[0].shards.total);
  const long = { ...migrated, journey: { victories: 123, trialsCleared: 3, lifetimeShards: 900 }, expeditions: Array(100).fill(old.expeditions[0]) };
  const next = normalizeCampaignState(recordCampaignResult(long, state, null));
  expect(next.expeditions).toHaveLength(100);
  expect(next.journey?.victories).toBe(124);
  expect(next.journey?.trialsCleared).toBe(3);
  expect(journeyProgress(next).rank).toBe(12);
});

test("覚醒は第六階と第十層の守り手だけに効き、第三階と道中は同じ強さを保つ", () => {
  function floorState(floor: number, trial: number) {
    let state = createInitialGame(20260504, "role.oathbound", { modifiers: { bossTrial: trial }, missionId: "black-core" });
    while (state.floor < floor) {
      state.entities = state.entities.filter((e) => e.kind === "player");
      state.pendingDecision = null;
      const stairs = state.tiles.findIndex((t) => t.kind === "stairsDown");
      state.entities[0].pos = { x: stairs % state.width, y: Math.floor(stairs / state.width) };
      state = applyAction(state, { type: "descend" });
      if (state.pendingDecision) {
        const choice = state.pendingDecision.options.find((o) => o.outcome === "continue")!;
        state = applyAction(state, { type: "resolveDecision", optionId: choice.id });
      }
    }
    return state;
  }
  for (const floor of [3, 6, 10]) {
    const normal = floorState(floor, 0);
    const trial = floorState(floor, 1);
    const boss = (state: typeof normal) => state.entities.find((e) => contentEntities[e.contentId]?.tier === "boss")!;
    if (floor === 3) expect(boss(trial).stats).toEqual(boss(normal).stats);
    else expect(boss(trial).stats!.maxHp).toBeGreaterThan(boss(normal).stats!.maxHp);
    expect(trial.entities.filter((e) => e.kind === "monster" && contentEntities[e.contentId]?.tier !== "boss").map((e) => e.stats)).toEqual(normal.entities.filter((e) => e.kind === "monster" && contentEntities[e.contentId]?.tier !== "boss").map((e) => e.stats));
    // 階段は生きている守り手によって封じられ、部屋の拡張で素通りできない。
    const stairs = trial.tiles.findIndex((t) => t.kind === "stairsDown");
    trial.entities.find((e) => e.id === trial.playerId)!.pos = { x: stairs % trial.width, y: Math.floor(stairs / trial.width) };
    expect(applyAction(trial, { type: "descend" }).floor).toBe(floor);
    // 視界外の守り手は観測へ漏れない。
    trial.tiles.forEach((t) => { t.visible = false; });
    expect(observeGame(trial).visibleEntities.some((e) => e.id === boss(trial).id)).toBe(false);
  }
});
