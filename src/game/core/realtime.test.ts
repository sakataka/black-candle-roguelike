import { beforeEach, describe, expect, test } from "bun:test";
import { loadBunGameConfig, getGameConfig } from "../content/config";
import { realtimeConfig } from "../content/realtime";
import { delverSpeech } from "../content/speech";
import { applyAction, canBorrowFlame, canPlaceLantern, createInitialGame, observeGame } from "./game";
import { createContextDecision, recordCampaignResult, createCampaignState, campaignRunModifiers } from "./autonomous";
import { chooseAutoplayAction, describeAutoplayIntent, resetAutoplayState, resolveAutoplayPolicy } from "../ai/autoplay";
import { chooseDelverSpeech, createSpeechMemory } from "../ai/speech";
import { telegraphTiles, updateVow } from "./realtime";
import type { Entity, GameState, Point } from "../types";

beforeEach(async () => { await loadBunGameConfig(); resetAutoplayState(); });

function arena(): GameState {
  const state = createInitialGame(20260504);
  state.width = 11;
  state.height = 11;
  state.tiles = Array.from({ length: 121 }, (_, i) => ({ kind: i % 11 === 0 || i % 11 === 10 || i < 11 || i >= 110 ? "wall" as const : "floor" as const, explored: true, visible: true }));
  const player = state.entities.find((e) => e.id === state.playerId)!;
  player.pos = { x: 4, y: 4 };
  player.stats = { hp: 40, maxHp: 40, attack: 18, defense: 4 };
  player.inventory = [];
  state.entities = [player];
  state.pendingDecision = null;
  return state;
}

function enemy(state: GameState, contentId: string, pos: Point): Entity {
  const entity: Entity = { id: `test-${contentId}`, kind: "monster", contentId, pos, hostile: true, blocksMovement: true, stats: { hp: 35, maxHp: 35, attack: 10, defense: 2 } };
  state.entities.push(entity);
  return entity;
}

describe("止めずに介入する遠征", () => {
  test("伝言の期限が過ぎれば本人が進み、灯介入で期限は延びない", () => {
    let state = arena();
    state.pendingDecision = createContextDecision(state, 1, "test");
    state.pendingDecision.remainingTurns = 2;
    const before = state.runTurn;
    state = applyAction(state, { type: "invokeLantern", rite: "guide" });
    expect(state.pendingDecision?.remainingTurns).toBe(2);
    expect(state.runTurn).toBe(before);
    state = applyAction(state, { type: "move", direction: "north" });
    expect(state.pendingDecision?.remainingTurns).toBe(1);
    state = applyAction(state, { type: "move", direction: "south" });
    expect(state.pendingDecision).toBeNull();
    expect(state.story.decisions).toHaveLength(1);
    expect(state.runTurn).toBe(before + 2);
  });

  test("伝言中でも敵が攻撃する", () => {
    const state = arena();
    state.pendingDecision = createContextDecision(state, 1, "test");
    enemy(state, "monster.ash-rat", { x: 5, y: 4 });
    const next = applyAction(state, { type: "wait" });
    expect(next.entities[0].stats!.hp).toBeLessThan(state.entities[0].stats!.hp);
  });

  test("予告の外へ避け、その後の隙を攻撃に使える", () => {
    let state = arena();
    enemy(state, "monster.hollow-archer", { x: 8, y: 4 });
    state = applyAction(state, { type: "wait" });
    expect(state.entities[1].telegraph?.remaining).toBe(2);
    const observation = observeGame(state);
    const action = chooseAutoplayAction(observation);
    expect(describeAutoplayIntent(observation, action)?.topic).toBe("dodge");
    state = applyAction(state, action);
    const hp = state.entities[0].stats!.hp;
    state = applyAction(state, { type: "wait" });
    expect(state.entities[0].stats!.hp).toBe(hp);
    expect(state.entities[1].recoveryTurns).toBe(1);
    expect(state.expedition!.stats.dodges).toBe(1);
    state.entities[1].pos = { x: state.entities[0].pos.x + 1, y: state.entities[0].pos.y };
    const withoutOpening = structuredClone(state);
    withoutOpening.entities[1].recoveryTurns = 0;
    const openingObservation = observeGame(state);
    const strike = chooseAutoplayAction(openingObservation);
    expect(describeAutoplayIntent(openingObservation, strike)?.topic).toBe("opening");
    const opened = applyAction(state, strike);
    const guarded = applyAction(withoutOpening, strike);
    expect(opened.entities[1].stats!.hp).toBeLessThan(guarded.entities[1].stats!.hp);
  });

  test("予告内に留まると発動し、見えていない敵の予告は観測へ出ない", () => {
    let state = arena();
    const archer = enemy(state, "monster.hollow-archer", { x: 8, y: 4 });
    state = applyAction(state, { type: "wait" });
    const firstHp = state.entities[0].stats!.hp;
    state = applyAction(applyAction(state, { type: "wait" }), { type: "wait" });
    expect(state.entities[0].stats!.hp).toBeLessThan(firstHp);
    state.tiles[archer.pos.y * state.width + archer.pos.x].visible = false;
    expect(observeGame(state).visibleEntities.find((e) => e.id === archer.id)).toBeUndefined();
  });

  test("閃灯は構えを止め、灯火と探索者の時計を分離する", () => {
    let state = arena();
    enemy(state, "monster.hollow-archer", { x: 8, y: 4 });
    state = applyAction(state, { type: "wait" });
    const turn = state.runTurn;
    state = applyAction(state, { type: "invokeLantern", rite: "flare" });
    expect(state.runTurn).toBe(turn);
    state = applyAction(state, { type: "wait" });
    expect(state.entities[1].telegraph).toBeUndefined();
    expect(state.entities[0].stats!.hp).toBe(40);
  });

  test("置灯へ敵を誘い、寿命は探索者の手でのみ進む", () => {
    let state = arena();
    enemy(state, "monster.bone-thrall", { x: 8, y: 4 });
    const origin = state.runTurn;
    state = applyAction(state, { type: "placeLantern", pos: { x: 6, y: 4 } });
    expect(state.runTurn).toBe(origin);
    expect(state.expedition!.lights[0].turns).toBe(realtimeConfig().light.duration);
    const next = applyAction(state, { type: "move", direction: "west" });
    expect(next.entities[1].pos).toEqual({ x: 7, y: 4 });
    expect(next.expedition!.lights[0].turns).toBe(realtimeConfig().light.duration - 1);
    expect(canPlaceLantern(next)).toBe(false);
    expect(canPlaceLantern(arena(), { x: -1, y: 0 })).toBe(false);
  });

  test("灯の視界も壁に遮られ、人間とAIへ同じ可視情報を渡す", () => {
    let state = arena();
    for (let y = 1; y <= 9; y++) state.tiles[y * state.width + 6].kind = "wall";
    state = applyAction(state, { type: "placeLantern", pos: { x: 5, y: 4 } });
    expect(state.tiles[4 * state.width + 7].visible).toBe(false);
    expect(observeGame(state).visibleTiles.some((t) => t.x === 7 && t.y === 4)).toBe(false);
  });

  test("護灯で押し戻した敵の構えは崩れる", () => {
    let state = arena();
    enemy(state, "monster.hollow-archer", { x: 6, y: 4 });
    state = applyAction(state, { type: "wait" });
    expect(state.entities[1].telegraph).toBeDefined();
    const displaced = applyAction(state, { type: "invokeLantern", rite: "ward" });
    expect(displaced.entities[1].pos.x).toBeGreaterThan(state.entities[1].pos.x);
    expect(displaced.entities[1].telegraph).toBeUndefined();
    expect(displaced.entities[1].recoveryTurns).toBeGreaterThan(0);
    expect(displaced.runTurn).toBe(state.runTurn);
  });

  test("既知の罠へ敵を誘い、自分は安全な脇道を通る", () => {
    let state = arena();
    state.entities[0].stats!.hp = 20;
    enemy(state, "monster.bone-thrall", { x: 6, y: 4 });
    const distant = enemy(state, "monster.ash-rat", { x: 9, y: 8 });
    distant.id = "distant";
    for (const p of [{ x: 5, y: 3 }, { x: 5, y: 5 }, { x: 6, y: 3 }, { x: 6, y: 5 }]) state.tiles[p.y * state.width + p.x].kind = "wall";
    state.entities.push({ id: "bait", kind: "trap", contentId: "trap.blood-needle", pos: { x: 5, y: 4 }, blocksMovement: false });
    const observation = observeGame(state);
    const action = chooseAutoplayAction(observation);
    expect(describeAutoplayIntent(observation, action)?.topic).toBe("lure");
    state = applyAction(state, action);
    expect(state.entities[0].pos).not.toEqual({ x: 5, y: 4 });
    expect(state.entities[1].stats!.hp).toBeLessThan(35);
    expect(state.expedition!.stats.terrainLures).toBe(1);
  });

  test("墓標と誓いの残り火も返済に回り、誓いの報酬を重複させない", () => {
    let state = arena();
    state.lantern.embers = 0;
    state.expedition!.debt = 2;
    state.expedition!.vow = { id: "memorial", label: "先人を弔う", progress: 0, target: 1, completed: false };
    state.modifiers.graves = [{ id: "past", name: "先人", roleId: "role.oathbound", floor: 1 }];
    state.entities.push({ id: "event.grave-marker.past", kind: "event", contentId: "event.grave-marker", pos: { x: 3, y: 4 }, blocksMovement: false });
    state = applyAction(state, { type: "move", direction: "west" });
    expect(state.expedition!.debt).toBe(0);
    expect(state.expedition!.vow.completed).toBe(true);
    expect(state.lantern.embers).toBe(0);
    updateVow(state);
    expect(state.lantern.embers).toBe(0);
  });

  test("借灯は一度だけ、後の獲得灯を返済し、未返済分は次の遠征へ残る", () => {
    let state = arena();
    state.entities[0].stats!.hp = 10;
    state.lantern.embers = 0;
    state = applyAction(state, { type: "borrowFlame" });
    expect(state.runTurn).toBe(0);
    expect(state.entities[0].stats!.hp).toBeGreaterThan(10);
    expect(state.expedition!.debt).toBe(realtimeConfig().loan.debt);
    expect(state.lantern.embers).toBe(realtimeConfig().loan.embers);
    state.lantern.embers = 0;
    expect(canBorrowFlame(state)).toBe(false);
    state.tiles[4 * state.width + 4].kind = "stairsDown";
    const descended = applyAction(state, { type: "descend" });
    expect(descended.floor).toBe(2);
    expect(descended.expedition!.debt).toBe(state.expedition!.debt - getGameConfig().lantern.embersPerFloor);
    state.status = "returned";
    const campaign = recordCampaignResult(createCampaignState(), state, null);
    const carried = campaignRunModifiers(campaign);
    const next = createInitialGame(20260505, "role.oathbound", { modifiers: carried.modifiers });
    expect(next.lantern.embers).toBe(getGameConfig().lantern.startEmbers - campaign.flameDebt!);
    expect(next.expedition!.debt).toBe(0);
  });

  test("墓所の覚醒、炉の熱、中枢の構えの変化が通常の時計で進む", () => {
    let state = arena();
    state.biome = "crypt";
    state.expedition!.floorKills = realtimeConfig().laws.cryptWakeEveryKills - 1;
    const victim = enemy(state, "monster.bone-thrall", { x: 5, y: 4 });
    victim.stats!.hp = 1;
    const sleeper = enemy(state, "monster.bone-thrall", { x: 7, y: 4 });
    sleeper.id = "sleeper";
    state = applyAction(state, { type: "move", direction: "east" });
    expect(state.entities.find((e) => e.id === "sleeper")!.awakened).toBe(true);
    state = arena();
    state.biome = "furnace";
    state.expedition!.heat = [{ pos: { x: 4, y: 4 }, remaining: 1, active: false }];
    const burned = applyAction(state, { type: "wait" });
    expect(burned.entities[0].stats!.hp).toBe(40 - realtimeConfig().laws.furnaceDamage);
    expect(state.expedition!.heat[0].active).toBe(false);
    state = arena();
    state.biome = "black-candle";
    const boss = enemy(state, "monster.black-candle-warden", { x: 7, y: 4 });
    boss.telegraph = { kind: "hex", origin: boss.pos, tiles: telegraphTiles("hex", boss.pos, state.entities[0].pos), remaining: 1 };
    const lit = applyAction(state, { type: "invokeLantern", rite: "guide" });
    expect(lit.entities[1].telegraph!.remaining).toBe(realtimeConfig().telegraphs[boss.contentId].windup);
    expect(lit.entities[1].telegraph!.tiles).not.toEqual(boss.telegraph.tiles);
    expect(lit.runTurn).toBe(state.runTurn);
  });

  test("殉職者の最後の判断を墓標から受け継ぎ、後のAI方針へ反映する", () => {
    const fallen = arena();
    fallen.status = "lost";
    fallen.story.killedBy = { cause: "rangedCombat", contentId: "monster.hollow-archer" };
    fallen.expedition!.trail = [{ action: "射手へ踏み込んだ", hp: 0, pos: { x: 4, y: 4 } }];
    const campaign = recordCampaignResult(createCampaignState(), fallen, "rangedCombat");
    const grave = campaignRunModifiers(campaign).modifiers.graves![0];
    let successor = arena();
    successor.modifiers.graves = [grave];
    successor.entities.push({ id: `event.grave-marker.${grave.id}`, kind: "event", contentId: "event.grave-marker", pos: { x: 3, y: 4 }, blocksMovement: false });
    successor = applyAction(successor, { type: "move", direction: "west" });
    expect(successor.expedition!.memories[0].echoes[0].action).toBe("射手へ踏み込んだ");
    expect(resolveAutoplayPolicy(observeGame(successor)).coverApproach).toBe(true);
    successor.status = "returned";
    const inherited = recordCampaignResult(campaign, successor, null);
    expect(inherited.lessons).toContain("ranged");
    expect(inherited.fallen[0].recovered).toBe(true);
  });

  test("台詞は戦闘状態を変えず、読み時間・繰り返しを抑える", () => {
    const state = arena();
    const snapshot = structuredClone(state);
    const observation = observeGame(state);
    const action = chooseAutoplayAction(observation);
    const memory = createSpeechMemory();
    const intent = describeAutoplayIntent(observation, action);
    const first = chooseDelverSpeech(observation, action, intent, memory, 0);
    expect(first?.topic).toBe("vow");
    expect(chooseDelverSpeech(observation, action, intent, memory, 10)).toBeNull();
    expect(state).toEqual(snapshot);
    expect(chooseDelverSpeech(observation, action, intent, createSpeechMemory(), 0)).toEqual(first);
    expect(Object.values(delverSpeech).flatMap((v) => Object.values(v).flat()).length).toBeGreaterThan(100);
  });
});
