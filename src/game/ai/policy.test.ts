import { beforeAll, describe, expect, test } from "bun:test";
import { loadBunGameConfig } from "../content/config";
import { applyAction, createInitialGame, normalizeTactics, observeGame } from "../core/game";
import { createCheckpointDecision } from "../core/autonomous";
import { chooseAutoplayAction, resetAutoplayState, resolveAutoplayPolicy } from "./autoplay";

beforeAll(async () => {
  await loadBunGameConfig("public/config/game-balance.json");
});

describe("作戦と方針", () => {
  test("射手狩りの投げ針は近い近接敵を越えて射手へ命中する", () => {
    resetAutoplayState();
    const state = createInitialGame(20260504, "role.ash-scout", { tactics: ["tactic.archer-hunt"] });
    const player = state.entities.find((entity) => entity.id === state.playerId)!;
    player.pos = { x: 5, y: 5 };
    player.inventory = [{ contentId: "item.ember-dart", quantity: 2 }];
    state.tiles = state.tiles.map(() => ({ kind: "floor", visible: true, explored: true }));
    state.entities = [player, ...[
      { id: "near-rat", contentId: "monster.ash-rat", pos: { x: 7, y: 5 } },
      { id: "far-archer", contentId: "monster.hollow-archer", pos: { x: 9, y: 5 } },
    ].map((enemy) => ({ ...enemy, kind: "monster" as const, hostile: true, blocksMovement: true, stats: { hp: 30, maxHp: 30, attack: 1, defense: 0 } }))];
    const action = chooseAutoplayAction(observeGame(state));
    expect(action.type).toBe("useItem");
    const hidden = structuredClone(state);
    hidden.tiles[5 * hidden.width + 9].visible = false;
    expect(applyAction(hidden, action)).toBe(hidden);
    expect(applyAction(state, { type: "useItem", contentId: "item.ember-dart", targetId: "missing" })).toBe(state);
    expect(applyAction(state, { type: "useItem", contentId: "item.ember-dart", targetId: state.playerId })).toBe(state);
    const next = applyAction(state, action);
    expect(next.entities.find((entity) => entity.id === "far-archer")?.stats?.hp).toBeLessThan(30);
    expect(next.entities.find((entity) => entity.id === "near-rat")?.stats?.hp).toBe(30);
    const legacy = applyAction(state, { type: "useItem", contentId: "item.ember-dart" });
    expect(legacy.entities.find((entity) => entity.id === "near-rat")?.stats?.hp).toBeLessThan(30);
    expect(legacy.entities.find((entity) => entity.id === "far-archer")?.stats?.hp).toBe(30);
  });

  test("斜めに隣接した敵へそのまま斬りかかり、斜めに歩いて近づく", () => {
    resetAutoplayState();
    const state = createInitialGame(20260504, "role.oathbound");
    const player = state.entities.find((entity) => entity.id === state.playerId)!;
    player.pos = { x: 5, y: 5 };
    player.inventory = [];
    state.tiles = state.tiles.map(() => ({ kind: "floor", visible: true, explored: true }));
    const rat = { id: "rat", kind: "monster" as const, contentId: "monster.ash-rat", pos: { x: 6, y: 6 }, hostile: true, blocksMovement: true, stats: { hp: 30, maxHp: 30, attack: 1, defense: 0 } };
    state.entities = [player, rat];
    const attack = chooseAutoplayAction(observeGame(state));
    expect(attack).toEqual({ type: "move", direction: "southeast" });
    expect(applyAction(state, attack).entities.find((entity) => entity.id === "rat")?.stats?.hp).toBeLessThan(30);

    rat.pos = { x: 8, y: 8 };
    expect(chooseAutoplayAction(observeGame(state))).toEqual({ type: "move", direction: "southeast" });
  });

  test("方針は気質の傾向を上書きし、作戦はさらにその上から効く", () => {
    const identity = { name: "テスト", roleId: "role.oathbound", temperament: "bold" as const };
    const bold = resolveAutoplayPolicy({ runIdentity: identity, directive: "conquest", tactics: [] });
    const survival = resolveAutoplayPolicy({ runIdentity: identity, directive: "survival", tactics: [] });
    expect(bold.huntWeakEnemies).toBe(true);
    expect(survival.huntWeakEnemies).toBe(false);
    expect(survival.combatHp).toBeGreaterThan(bold.combatHp);
    const withCare = resolveAutoplayPolicy({ runIdentity: identity, directive: "survival", tactics: ["tactic.early-care"] });
    expect(withCare.healBonus).toBeGreaterThan(survival.healBonus);
  });

  test("作戦は定義済みのものだけを枠数まで残し、開始時の携行品を付与する", () => {
    expect(normalizeTactics(["tactic.hoard", "tactic.hoard", "unknown", "tactic.duelist", "tactic.thorough"])).toEqual(["tactic.hoard", "tactic.duelist"]);
    const plain = createInitialGame(20260504, "role.ash-scout");
    const volley = createInitialGame(20260504, "role.ash-scout", { tactics: ["tactic.dart-volley"] });
    const darts = (state: typeof plain) => state.entities.find((entity) => entity.id === state.playerId)?.inventory?.find((entry) => entry.contentId === "item.ember-dart")?.quantity ?? 0;
    expect(darts(volley)).toBe(darts(plain) + 5);
  });

  test("節目の判断でだけ作戦を組み替えられる", () => {
    const state = createInitialGame(20260504, "role.oathbound", { tactics: ["tactic.hoard"] });
    state.floor = 3;
    state.pendingDecision = createCheckpointDecision(state);
    const next = applyAction(state, { type: "resolveDecision", optionId: "continue-survival", tactics: ["tactic.archer-hunt", "tactic.straight-path"] });
    expect(next.tactics).toEqual(["tactic.archer-hunt", "tactic.straight-path"]);
  });
});
