import { beforeAll, expect, test } from "bun:test";
import { loadBunGameConfig } from "../content/config";
import { createInitialGame, observeGame } from "../core/game";
import { getPlayer } from "../core/state";
import { DIRECTION_DELTAS } from "../core/spatial";
import { chooseAutoplayAction, resetAutoplayState } from "./autoplay";

beforeAll(() => loadBunGameConfig());

function arena() {
  resetAutoplayState();
  const state = createInitialGame(123, "role.oathbound", { directive: "conquest" });
  state.width = 13;
  state.height = 9;
  state.tiles = Array.from({ length: 117 }, () => ({ kind: "wall" as const, visible: true, explored: true }));
  const player = getPlayer(state);
  player.pos = { x: 2, y: 4 };
  player.inventory = [];
  player.skillCooldown = 99;
  state.entities = [player];
  return state;
}

test("敵への接近は直線で近い行き止まりより、歩数の短い通路を選ぶ", () => {
  const state = arena();
  const open = (x: number, y: number) => { state.tiles[y * state.width + x] = { kind: "floor", visible: true, explored: true }; };
  for (let y = 1; y <= 6; y++) open(2, y);
  for (let x = 2; x <= 7; x++) open(x, 1);
  for (let y = 1; y <= 4; y++) open(7, y);
  for (let x = 2; x <= 8; x++) open(x, 6);
  open(8, 5);
  open(8, 4);
  state.entities.push({ id: "rat", contentId: "monster.ash-rat", kind: "monster", pos: { x: 8, y: 4 }, hostile: true, blocksMovement: true, stats: { hp: 30, maxHp: 30, attack: 1, defense: 0 } });
  expect(chooseAutoplayAction(observeGame(state))).toEqual({ type: "move", direction: "south" });
});

test("傷を癒す運試しの候補に毒の罠を混ぜない", () => {
  const state = arena();
  state.tiles = state.tiles.map(() => ({ kind: "floor", visible: true, explored: true }));
  state.tiles[4 * state.width + 10].kind = "stairsDown";
  getPlayer(state).stats = { hp: 40, maxHp: 100, attack: 10, defense: 0 };
  state.entities.push({ id: "trap", kind: "trap", contentId: "trap.venom-mist", pos: { x: 1, y: 4 }, blocksMovement: false });
  expect(chooseAutoplayAction(observeGame(state))).toEqual({ type: "move", direction: "east" });
  state.entities[1].contentId = "trap.risk-panel";
  resetAutoplayState();
  expect(chooseAutoplayAction(observeGame(state))).toEqual({ type: "move", direction: "west" });
});

test("未探索の敵・イベント・罠は観測にも移動判断にも漏れない", () => {
  const state = arena();
  state.tiles = state.tiles.map(() => ({ kind: "floor", visible: true, explored: true }));
  const hidden = { x: 11, y: 7 };
  state.tiles[hidden.y * state.width + hidden.x] = { kind: "floor", visible: false, explored: false };
  const original = chooseAutoplayAction(observeGame(state));
  for (const kind of ["monster", "event", "trap"] as const) {
    state.entities.push({ id: `hidden-${kind}`, kind, contentId: kind === "monster" ? "monster.ash-rat" : kind === "event" ? "event.mend-shrine" : "trap.venom-mist", pos: hidden, hostile: kind === "monster", blocksMovement: kind === "monster" });
  }
  const observation = observeGame(state);
  expect(observation.knownEntities.some(entity => entity.id.startsWith("hidden-"))).toBe(false);
  expect(observation.visibleEntities.some(entity => entity.id.startsWith("hidden-"))).toBe(false);
  resetAutoplayState();
  expect(chooseAutoplayAction(observation)).toEqual(original);
});

test("既知の階段へ向かう長い通路を、訪問済みという理由で引き返さない", () => {
  const state = arena();
  state.tiles = state.tiles.map(() => ({ kind: "floor", visible: true, explored: true }));
  state.tiles[4 * state.width + 10].kind = "stairsDown";
  // 戦闘などで同じ場所に長くいた後でも、目的地への距離を縮める。
  for (let turn = 0; turn < 30; turn++) {
    state.turn = state.runTurn = turn;
    chooseAutoplayAction(observeGame(state));
  }
  for (let x = 2; x < 10; x++) {
    const player = getPlayer(state);
    player.pos = { x, y: 4 };
    state.turn++;
    state.runTurn++;
    const action = chooseAutoplayAction(observeGame(state));
    expect(action.type).toBe("move");
    if (action.type === "move") expect(DIRECTION_DELTAS[action.direction].x).toBe(1);
  }
});
