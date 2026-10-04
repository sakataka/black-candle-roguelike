import { beforeEach, expect, test } from "bun:test";
import { chooseAutoplayAction, resetAutoplayState } from "../ai/autoplay";
import { assetForContent, assetCatalog } from "../content/assets";
import { getGameConfig, loadBunGameConfig, setGameConfig } from "../content/config";
import type { Entity, GameState, Point } from "../types";
import { roleTruthFor } from "./autonomous";
import { applyAction, createInitialGame, observeGame } from "./game";
import { generateFloorMap } from "./generation";
import { preferredEquipment } from "./inventory";
import { getPlayer } from "./state";
import { deriveVisualEvents } from "./visualEvents";
import { runSimulation } from "../sim/simulation";

beforeEach(async () => { await loadBunGameConfig(); resetAutoplayState(); });

function arena(role = "role.oathbound"): GameState {
  const state = createInitialGame(20260504, role);
  state.tiles = state.tiles.map(() => ({ kind: "floor", explored: true, visible: true }));
  state.entities = [getPlayer(state)];
  getPlayer(state).pos = { x: 10, y: 10 };
  state.pendingDecision = null;
  return state;
}

function enemy(state: GameState, pos: Point, contentId = "monster.ash-rat", hp = 30): Entity {
  const entity: Entity = { id: "target", kind: "monster", contentId, pos, hostile: true, blocksMovement: true, stats: { hp, maxHp: hp, attack: 1, defense: 0 } };
  state.entities.push(entity);
  return entity;
}

test("納品137セルを元台帳どおりに読み、PNG寸法と有効indexを満たす", async () => {
  const manifest = await Bun.file("docs/art-expansion/asset-manifest.json").json();
  let cells = 0;
  for (const sheet of manifest.sheets) {
    const bytes = new DataView(await Bun.file(sheet.file).arrayBuffer());
    expect(bytes.getUint32(16)).toBe(sheet.columns * 128);
    expect(bytes.getUint32(20)).toBe(sheet.rows * 128);
    for (const cell of sheet.cells) {
      expect(assetCatalog[cell.assetId]).toEqual({ contentId: cell.contentId, path: `/${sheet.file.slice("public/".length)}`, sheet: { columns: sheet.columns, rows: sheet.rows, index: cell.index } });
      cells += 1;
    }
  }
  expect(cells).toBe(137);
  expect(assetForContent("item.hunter-spear")?.sheet.index).not.toBe(assetForContent("item.iron-axe")?.sheet.index);
});

test("テーマ部屋は全3種類が生成され、開始地点と階段、接続を変えない", () => {
  const config = structuredClone(getGameConfig());
  config.expansion!.roomChancePercent = 100;
  const themes = new Set();
  for (const floor of [1, 4, 8]) {
    for (let seed = 20260504; seed <= 20260513; seed += 1) {
      setGameConfig(config);
      const expanded = generateFloorMap(seed, floor, config.rules);
      setGameConfig({ ...config, expansion: { ...config.expansion!, enabled: false } });
      const original = generateFloorMap(seed, floor, config.rules);
      expect(expanded.start).toEqual(original.start);
      expect(expanded.stairs).toEqual(original.stairs);
      expect(expanded.tiles.map((tile) => tile.kind)).toEqual(original.tiles.map((tile) => tile.kind));
      expect(expanded.tiles[expanded.start.y * config.rules.mapWidth + expanded.start.x].roomTheme).toBeUndefined();
      expect(expanded.tiles[expanded.stairs.y * config.rules.mapWidth + expanded.stairs.x].roomTheme).toBeUndefined();
      if (expanded.themedRoom) themes.add(expanded.themedRoom.definition.theme);
    }
  }
  expect([...themes].sort()).toEqual(["ore-mine", "sunken-archive", "thorn-chapel"]);
});

test("未発見の部屋・報酬・罠と視界外の敵は観測に漏れず、既知罠は種類を保持する", () => {
  const state = arena();
  const pos = { x: 25, y: 10 };
  const tile = state.tiles[pos.y * state.width + pos.x];
  Object.assign(tile, { explored: false, visible: false, roomTheme: "ore-mine" });
  state.entities.push({ id: "hidden-trap", kind: "trap", contentId: "trap.venom-mist", pos, blocksMovement: false });
  enemy(state, pos);
  let observation = observeGame(state);
  expect(observation.knownEntities.some((entity) => entity.id === "hidden-trap")).toBe(false);
  expect(observation.knownTiles.some((known) => known.x === pos.x && known.y === pos.y)).toBe(false);
  tile.explored = true;
  observation = observeGame(state);
  expect(observation.knownEntities.find((entity) => entity.id === "hidden-trap")?.contentId).toBe("trap.venom-mist");
  expect(observation.knownEntities.some((entity) => entity.id === "target")).toBe(false);
});

test("AIと装備処理は盾込みで両手武器を選び、持ち替えを繰り返さない", () => {
  let state = arena();
  getPlayer(state).inventory = [
    { contentId: "item.sun-sigil-blade", quantity: 1, equipped: true },
    { contentId: "item.ironbreaker-greataxe", quantity: 1 },
    { contentId: "item.ward-shield", quantity: 1, equipped: true },
  ];
  const preferred = preferredEquipment(getPlayer(state));
  expect(preferred.has("item.sun-sigil-blade")).toBe(true);
  expect(preferred.has("item.ironbreaker-greataxe")).toBe(false);
  for (let step = 0; step < 12; step += 1) {
    const action = chooseAutoplayAction(observeGame(state));
    expect(action.type).not.toBe("equip");
    state = applyAction(state, action);
    expect(getPlayer(state).inventory?.filter((entry) => entry.equipped).map((entry) => entry.contentId)).toEqual(["item.sun-sigil-blade", "item.ward-shield"]);
  }
});

test("弓はAIも同じactionで撃ち、射程外・壁越し・視界外では手番を失わない", () => {
  const state = arena();
  getPlayer(state).inventory = [{ contentId: "item.hunter-longbow", quantity: 1, equipped: true }];
  enemy(state, { x: 13, y: 10 });
  expect(chooseAutoplayAction(observeGame(state))).toEqual({ type: "shoot", targetId: "target" });
  const shot = applyAction(state, { type: "shoot", targetId: "target" });
  expect(shot.entities.find((entity) => entity.id === "target")!.stats!.hp).toBeLessThan(30);
  expect(shot.runTurn).toBe(state.runTurn + 1);
  state.tiles[10 * state.width + 12].kind = "wall";
  expect(applyAction(state, { type: "shoot", targetId: "target" })).toBe(state);
  state.tiles[10 * state.width + 12].kind = "floor";
  state.entities[1].pos.x = 20;
  expect(applyAction(state, { type: "shoot", targetId: "target" })).toBe(state);
  state.entities[1].pos.x = 13;
  state.tiles[10 * state.width + 13].visible = false;
  expect(applyAction(state, { type: "shoot", targetId: "target" })).toBe(state);
});

test("新しい投げ刃と透視水晶をAIが使い、投げ刃は射程を守る", () => {
  const state = arena();
  getPlayer(state).inventory = [{ contentId: "item.light-throwing-blade", quantity: 2 }];
  enemy(state, { x: 13, y: 10 });
  expect(chooseAutoplayAction(observeGame(state))).toEqual({ type: "useItem", contentId: "item.light-throwing-blade", targetId: "target" });
  state.entities[1].pos.x = 18;
  expect(applyAction(state, { type: "useItem", contentId: "item.light-throwing-blade", targetId: "target" })).toBe(state);
  state.entities[1].pos.x = 13;
  state.tiles[10 * state.width + 13].visible = false;
  expect(applyAction(state, { type: "useItem", contentId: "item.light-throwing-blade", targetId: "target" })).toBe(state);
  state.entities = [getPlayer(state)];
  getPlayer(state).inventory = [{ contentId: "item.scrying-crystal", quantity: 1 }];
  state.tiles.forEach((tile) => { tile.explored = tile.visible = false; });
  state.tiles[10 * state.width + 10].visible = true;
  expect(chooseAutoplayAction(observeGame(state))).toEqual({ type: "useItem", contentId: "item.scrying-crystal" });
  expect(observeGame(applyAction(state, { type: "useItem", contentId: "item.scrying-crystal" })).knownTiles.length).toBeGreaterThan(1);
});

test("新4職は既存3つの真相へ接続し、灰薬師の治療効率と解毒後回復が効く", () => {
  expect(roleTruthFor("role.relic-surveyor")).toBe("furnace-map");
  expect(roleTruthFor("role.ash-apothecary")).toBe("purified-flame");
  expect(roleTruthFor("role.iron-oath-vanguard")).toBe("shared-oath");
  expect(roleTruthFor("role.keyshadow-rogue")).toBe("furnace-map");
  const state = arena("role.ash-apothecary");
  getPlayer(state).stats!.hp = 1;
  getPlayer(state).conditions = [{ kind: "venomed", turns: 4 }];
  const healed = getPlayer(applyAction(state, { type: "useItem", contentId: "item.bloodmoss-salve" }));
  expect(healed.stats!.hp).toBe(33);
  expect(healed.conditions?.some((condition) => condition.kind === "venomed")).toBe(false);
});

test("解錠具の自動使用・盗賊の特性・満杯時に床へ残る報酬が成立する", () => {
  for (const role of ["role.oathbound", "role.keyshadow-rogue"]) {
    const state = arena(role);
    getPlayer(state).inventory = [{ contentId: "item.lockpick-bundle", quantity: 1 }];
    state.entities.push({ id: "cache", kind: "event", contentId: "prop.ore-mine.locked-cache", pos: { x: 11, y: 10 }, blocksMovement: false });
    const opened = applyAction(state, { type: "move", direction: "east" });
    expect(opened.entities.some((entity) => entity.id === "cache")).toBe(false);
    expect(opened.entities.some((entity) => entity.kind === "item" && entity.id === "cache.reward")).toBe(true);
    expect(getPlayer(opened).inventory!.some((entry) => entry.contentId === "item.lockpick-bundle")).toBe(role === "role.keyshadow-rogue");
    expect(opened.playerProgress.gold).toBe(role === "role.keyshadow-rogue" ? 30 : 18);
  }
  const full = arena();
  getPlayer(full).inventory = Array.from({ length: getGameConfig().rules.inventorySlotLimit }, (_, index) => ({ contentId: `test.${index}`, quantity: 1 }));
  full.entities.push({ id: "cache", kind: "event", contentId: "prop.ore-mine.locked-cache", pos: { x: 11, y: 10 }, blocksMovement: false });
  expect(applyAction(full, { type: "move", direction: "east" }).entities.some((entity) => entity.id === "cache.reward")).toBe(true);
});

test("抗毒装備は継続毒を防ぎ、指輪1枠で探索か再生を選ぶ", () => {
  const state = arena();
  getPlayer(state).inventory = [{ contentId: "item.venomguard-cloak", quantity: 1, equipped: true }, { contentId: "item.regrowth-ring", quantity: 1, equipped: true }];
  getPlayer(state).conditions = [{ kind: "venomed", turns: 4 }];
  getPlayer(state).stats!.hp = 20;
  state.runTurn = 12;
  const next = applyAction(state, { type: "wait" });
  expect(getPlayer(next).stats!.hp).toBe(21);
  expect(getPlayer(next).conditions?.some((condition) => condition.kind === "venomed")).toBe(false);
  getPlayer(state).inventory!.push({ contentId: "item.searcher-ring", quantity: 1 });
  expect([...preferredEquipment(getPlayer(state))].filter((id) => getGameConfig().equipment[id]?.slot === "ring")).toHaveLength(1);
});

test("反射の盾は可視遠隔敵へ反撃し、撃破処理と記録を通す", () => {
  for (const telegraphed of [false, true]) {
  const state = arena();
  getPlayer(state).inventory = [{ contentId: "item.reflecting-shield", quantity: 1, equipped: true }];
  enemy(state, { x: 13, y: 10 }, "monster.hollow-archer", 2);
  state.entities[1].attackCooldown = 20;
  if (telegraphed) state.entities[1].telegraph = { kind: "shot", origin: { x: 13, y: 10 }, remaining: 1, tiles: [{ x: 10, y: 10 }] };
  const next = applyAction(state, { type: "wait" });
  expect(next.entities.some((entity) => entity.id === "target")).toBe(false);
  expect(next.strikes?.some((strike) => strike.attackerId === state.playerId)).toBe(true);
  }
});

test("視界で寄り道目標が入れ替わっても同じ2マスに停滞しない", async () => {
  const result = await runSimulation({ seed: 20260522, turns: 1600, roleId: "role.iron-oath-vanguard", configPath: "public/config/game-balance.json", label: "detour-regression" });
  expect(result.status).not.toBe("playing");
  expect(result.maxTurnsWithoutKnownTileGrowth).toBeLessThan(200);
});

test("新FXは可視状態差分で導出し、隠れた敵の状態を描画へ漏らさない", () => {
  const before = arena();
  enemy(before, { x: 14, y: 10 });
  const after = structuredClone(before);
  after.entities[1].conditions = [{ kind: "dazed", turns: 3 }];
  expect(deriveVisualEvents(before, after).some((event) => event.kind === "statusFx" && event.effect === "frost-bind")).toBe(true);
  after.tiles[10 * after.width + 14].visible = false;
  expect(deriveVisualEvents(before, after).some((event) => event.kind === "statusFx")).toBe(false);
});
