import { beforeAll, describe, expect, test } from "bun:test";
import { loadBunGameConfig } from "../content/config";
import { applyAction, canInvokeLantern, createInitialGame } from "./game";
import { deriveVisualEvents } from "./visualEvents";
import type { Entity, GameState } from "../types";

beforeAll(async () => {
  await loadBunGameConfig("public/config/game-balance.json");
});

function withVisibleMonster(state: GameState): GameState {
  const player = state.entities.find((entity) => entity.id === state.playerId) as Entity;
  const spot = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]
    .map((delta) => ({ x: player.pos.x + delta.x, y: player.pos.y + delta.y }))
    .find((point) => state.tiles[point.y * state.width + point.x].kind === "floor");
  if (!spot) throw new Error("no open tile next to player");
  state.tiles[spot.y * state.width + spot.x].visible = true;
  state.entities.push({ id: "test-rat", kind: "monster", contentId: "monster.ash-rat", pos: spot, blocksMovement: true, hostile: true, stats: { hp: 5, maxHp: 5, attack: 1, defense: 0 } });
  return state;
}

describe("灯守の介入", () => {
  test("介入は探索者の手番とターンを消費しない", () => {
    const state = withVisibleMonster(createInitialGame(20260504, "role.oathbound"));
    const next = applyAction(state, { type: "invokeLantern", rite: "flare" });
    expect(next.runTurn).toBe(state.runTurn);
    expect(next.lantern.embers).toBe(state.lantern.embers - 1);
    const rat = next.entities.find((entity) => entity.id === "test-rat");
    expect(rat?.conditions?.some((condition) => condition.kind === "dazed")).toBe(true);
  });

  test("怯んだ敵は手番を失う", () => {
    const state = withVisibleMonster(createInitialGame(20260504, "role.oathbound"));
    const dazed = applyAction(state, { type: "invokeLantern", rite: "flare" });
    const afterWait = applyAction(dazed, { type: "wait" });
    const player = afterWait.entities.find((entity) => entity.id === afterWait.playerId);
    const before = dazed.entities.find((entity) => entity.id === dazed.playerId);
    expect(player?.stats?.hp).toBe(before?.stats?.hp);
  });

  test("効果が空振りする介入と灯火不足の介入は受け付けない", () => {
    const state = createInitialGame(20260504, "role.oathbound");
    expect(canInvokeLantern(state, "flare")).toBe(false);
    expect(canInvokeLantern(state, "mend")).toBe(false);
    expect(applyAction(state, { type: "invokeLantern", rite: "flare" })).toBe(state);
    state.lantern.embers = 0;
    expect(canInvokeLantern(state, "guide")).toBe(false);
  });

  test("階層を降りると灯火が戻る", () => {
    const state = createInitialGame(20260504, "role.oathbound");
    state.lantern.embers = 1;
    const player = state.entities.find((entity) => entity.id === state.playerId) as Entity;
    const stairsIndex = state.tiles.findIndex((tile) => tile.kind === "stairsDown");
    player.pos = { x: stairsIndex % state.width, y: Math.floor(stairsIndex / state.width) };
    const next = applyAction(state, { type: "descend" });
    expect(next.floor).toBe(2);
    expect(next.lantern.embers).toBe(2);
  });
});

describe("描画演出イベント", () => {
  test("攻撃とダメージを差分から導出する", () => {
    const state = withVisibleMonster(createInitialGame(20260504, "role.oathbound"));
    const player = state.entities.find((entity) => entity.id === state.playerId) as Entity;
    const rat = state.entities.find((entity) => entity.id === "test-rat") as Entity;
    const direction = rat.pos.x > player.pos.x ? "east" : rat.pos.x < player.pos.x ? "west" : rat.pos.y > player.pos.y ? "south" : "north";
    const next = applyAction(state, { type: "move", direction });
    const events = deriveVisualEvents(state, next);
    expect(events.some((event) => event.kind === "strike" && event.attackerId === state.playerId)).toBe(true);
    expect(events.some((event) => (event.kind === "damage" && event.entityId === "test-rat") || (event.kind === "death" && event.entityId === "test-rat"))).toBe(true);
  });
});
