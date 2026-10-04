import { beforeEach, describe, expect, test } from "bun:test";
import { chooseAutoplayAction, resetAutoplayState } from "../ai/autoplay";
import { getGameConfig, loadBunGameConfig, setGameConfig } from "../content/config";
import { bossForFloor } from "../content/floors";
import { applyElite } from "./bestiary";
import type { Entity, GameState, InventoryEntry, Point } from "../types";
import { applyAction, createInitialGame, observeGame } from "./game";
import { addInventoryItem, pieceName, preferredEquipment } from "./inventory";
import { drawEquipment, rollEquipmentPiece } from "./loot";
import { Rng } from "./rng";
import { getPlayer } from "./state";

beforeEach(async () => { await loadBunGameConfig(); resetAutoplayState(); });

function arena(role = "role.oathbound", weapon?: InventoryEntry): GameState {
  let state = createInitialGame(20260504, role);
  state.tiles = state.tiles.map(() => ({ kind: "floor", explored: true, visible: true }));
  const player = getPlayer(state);
  state.entities = [player];
  player.pos = { x: 10, y: 10 };
  player.skillCooldown = 99;
  if (weapon) {
    player.inventory = [{ ...weapon, equipped: true }];
    state.turn += 1;
    state = applyAction(state, { type: "equip", contentId: weapon.contentId });
  }
  state.pendingDecision = null;
  return state;
}

function enemy(state: GameState, pos: Point, contentId = "monster.ash-rat", hp = 30, defense = 0, id = `${contentId}.${pos.x}.${pos.y}`): Entity {
  const entity: Entity = { id, kind: "monster", contentId, pos, hostile: true, blocksMovement: true, alerted: true, stats: { hp, maxHp: hp, attack: 1, defense } };
  state.entities.push(entity);
  return entity;
}

function hpOf(state: GameState, id: string): number {
  return state.entities.find((entity) => entity.id === id)?.stats?.hp ?? 0;
}

describe("職業の能力値", () => {
  test("レベルが上がっても職業の素の攻撃と成長が残る", () => {
    const vanguard = arena("role.iron-oath-vanguard");
    const rogue = arena("role.keyshadow-rogue");
    for (const state of [vanguard, rogue]) {
      state.playerProgress.xp = getGameConfig().rules.xpThresholds[5];
      state.entities.push({ id: "fodder", kind: "monster", contentId: "monster.ash-rat", pos: { x: 11, y: 10 }, hostile: true, blocksMovement: true, alerted: true, stats: { hp: 1, maxHp: 1, attack: 0, defense: 0 } });
    }
    const v = applyAction(vanguard, { type: "move", direction: "east" });
    const r = applyAction(rogue, { type: "move", direction: "east" });
    expect(v.playerProgress.level).toBeGreaterThanOrEqual(5);
    expect(getPlayer(v).stats!.maxHp - getPlayer(r).stats!.maxHp).toBeGreaterThan(5);
    expect(getPlayer(v).stats!.defense).toBeGreaterThan(getPlayer(r).stats!.defense);
  });
});

describe("武器の型", () => {
  test("短剣は2回刺し、眠った敵には不意打ちで深く入る", () => {
    const state = arena("role.keyshadow-rogue", { contentId: "item.oath-knife", quantity: 1 });
    const awake = enemy(state, { x: 11, y: 10 }, "monster.ash-rat", 200, 0, "awake");
    const next = applyAction(state, { type: "move", direction: "east" });
    expect(next.messages.filter((message) => message.text.startsWith("灰かぶり鼠に")).length).toBe(2);
    const sleeping = arena("role.keyshadow-rogue", { contentId: "item.oath-knife", quantity: 1 });
    const sleeper = enemy(sleeping, { x: 11, y: 10 }, "monster.ash-rat", 200, 0, "sleeper");
    sleeper.asleep = true;
    sleeper.alerted = false;
    const ambushed = applyAction(sleeping, { type: "move", direction: "east" });
    expect(200 - hpOf(ambushed, "sleeper")).toBeGreaterThan((200 - hpOf(next, awake.id)) * 2);
  });

  test("斧は隣の敵をまとめてなぎ払う", () => {
    const state = arena("role.iron-oath-vanguard", { contentId: "item.hatchet", quantity: 1 });
    enemy(state, { x: 11, y: 10 }, "monster.ash-rat", 50, 0, "front");
    enemy(state, { x: 10, y: 11 }, "monster.ash-rat", 50, 0, "side");
    const next = applyAction(state, { type: "move", direction: "east" });
    expect(hpOf(next, "front")).toBeLessThan(50);
    expect(hpOf(next, "side")).toBeLessThan(50);
  });

  test("槍は2マス先を突き、後ろの敵まで貫く", () => {
    const state = arena("role.ash-apothecary", { contentId: "item.hunter-spear", quantity: 1 });
    enemy(state, { x: 12, y: 10 }, "monster.ash-rat", 50, 0, "near");
    enemy(state, { x: 13, y: 10 }, "monster.ash-rat", 50, 0, "behind");
    const next = applyAction(state, { type: "shoot", targetId: "near" });
    expect(hpOf(next, "near")).toBeLessThan(50);
    expect(hpOf(next, "behind")).toBeLessThan(50);
    expect(getPlayer(next).pos).toEqual({ x: 10, y: 10 });
  });

  test("鈍器は防御を打ち抜き、盾持ちにも軽減されない", () => {
    const mace = arena("role.lantern-priest", { contentId: "item.studded-club", quantity: 1 });
    const blade = arena("role.lantern-priest", { contentId: "item.rusted-sword", quantity: 1 });
    for (const state of [mace, blade]) enemy(state, { x: 11, y: 10 }, "monster.blackstone-sentinel", 200, 6, "sentinel");
    const maced = 200 - hpOf(applyAction(mace, { type: "move", direction: "east" }), "sentinel");
    const bladed = 200 - hpOf(applyAction(blade, { type: "move", direction: "east" }), "sentinel");
    expect(maced).toBeGreaterThan(bladed * 2);
  });
});

describe("修正値と印", () => {
  test("同じ装備を拾うと鍛え直して修正値が上がり、印を引き継ぐ", () => {
    const state = arena();
    const player = getPlayer(state);
    player.inventory = [{ contentId: "item.iron-axe", quantity: 1, plus: 1, seals: ["keen"] }];
    addInventoryItem(player, "item.iron-axe", 1, { plus: 0, seals: ["drain"] });
    const axe = player.inventory.find((entry) => entry.contentId === "item.iron-axe")!;
    expect(player.inventory.filter((entry) => entry.contentId === "item.iron-axe")).toHaveLength(1);
    expect(axe.plus).toBe(2);
    expect(axe.seals).toEqual(["keen", "drain"]);
    expect(pieceName(axe)).toBe("鉄の戦斧+2［会吸］");
  });

  test("深い階ほど修正値と印が付きやすく、守り手の遺品には印が必ず付く", () => {
    const shallow = Array.from({ length: 200 }, (_, index) => rollEquipmentPiece("item.iron-axe", 1, new Rng(20260504 + index * 7919)));
    const deep = Array.from({ length: 200 }, (_, index) => rollEquipmentPiece("item.iron-axe", 9, new Rng(20260504 + index * 7919)));
    const average = (pieces: Array<{ plus?: number }>) => pieces.reduce((sum, piece) => sum + (piece.plus ?? 0), 0) / pieces.length;
    expect(average(deep)).toBeGreaterThan(average(shallow) + 0.8);
    expect(deep.filter((piece) => piece.seals?.length).length).toBeGreaterThan(shallow.filter((piece) => piece.seals?.length).length);
    expect(rollEquipmentPiece("item.iron-axe", 1, new Rng(1), { minSeals: 1 }).seals?.length).toBeGreaterThanOrEqual(1);
  });

  test("格の抽選は得意な型へ寄せられるが、ほかの型も出る", () => {
    const types = Array.from({ length: 200 }, (_, index) => getGameConfig().equipment[drawEquipment(new Rng(20260504 + index * 7919), { tier: "early", slot: "weapon", favoredRoleId: "role.keyshadow-rogue", favoredChancePercent: 50 })].weaponType);
    expect(types.filter((type) => type === "dagger").length).toBeGreaterThan(70);
    expect(new Set(types).size).toBeGreaterThanOrEqual(4);
  });

  test("吸命の印は与えた傷の一部で命火を戻す", () => {
    const state = arena("role.oathbound", { contentId: "item.rusted-sword", quantity: 1, seals: ["drain"] });
    getPlayer(state).stats!.hp = 10;
    enemy(state, { x: 11, y: 10 }, "monster.ash-rat", 100);
    expect(getPlayer(applyAction(state, { type: "move", direction: "east" })).stats!.hp).toBeGreaterThan(10);
  });

  test("接近戦では弓より近接武器を選ぶ", () => {
    const state = arena("role.ash-scout");
    getPlayer(state).inventory = [{ contentId: "item.hunter-longbow", quantity: 1, equipped: true }, { contentId: "item.bone-javelin", quantity: 1 }];
    expect(preferredEquipment(getPlayer(state), "melee").has("item.bone-javelin")).toBe(true);
  });
});

describe("固有技", () => {
  test("突進は直線上の敵へ詰め寄って怯ませる", () => {
    const state = arena("role.iron-oath-vanguard");
    getPlayer(state).skillCooldown = 0;
    enemy(state, { x: 14, y: 10 }, "monster.ash-rat", 100, 0, "far");
    const next = applyAction(state, { type: "skill", targetId: "far" });
    expect(getPlayer(next).pos).toEqual({ x: 13, y: 10 });
    expect(hpOf(next, "far")).toBeLessThan(100);
    expect(getPlayer(next).skillCooldown).toBe(getGameConfig().skills["charge"].cooldown);
  });

  test("影渡りは敵の陰へ移り、不意打ちを入れる", () => {
    const state = arena("role.keyshadow-rogue");
    getPlayer(state).skillCooldown = 0;
    enemy(state, { x: 13, y: 10 }, "monster.ash-rat", 100, 0, "mark");
    const next = applyAction(state, { type: "skill", targetId: "mark" });
    expect(Math.max(Math.abs(getPlayer(next).pos.x - 13), Math.abs(getPlayer(next).pos.y - 10))).toBe(1);
    expect(next.messages.some((message) => message.text.includes("不意打ち"))).toBe(true);
  });

  test("看破した敵は防御と盾が効かなくなる", () => {
    const state = arena("role.relic-surveyor", { contentId: "item.rusted-sword", quantity: 1 });
    getPlayer(state).skillCooldown = 0;
    enemy(state, { x: 13, y: 10 }, "monster.blackstone-sentinel", 200, 6, "sentinel");
    const exposed = applyAction(state, { type: "skill", targetId: "sentinel" });
    expect(exposed.entities.find((entity) => entity.id === "sentinel")?.conditions?.some((condition) => condition.kind === "exposed")).toBe(true);
  });

  test("AIは技の待機が明けていれば、使いどころで技を選ぶ", () => {
    const state = arena("role.iron-oath-vanguard");
    getPlayer(state).skillCooldown = 0;
    enemy(state, { x: 13, y: 10 }, "monster.hollow-archer", 30, 0, "archer");
    expect(chooseAutoplayAction(observeGame(state))).toEqual({ type: "skill", targetId: "archer" });
  });
});

describe("敵の振る舞い", () => {
  test("骨の従僕は鈍器でなければ一度崩れて起き上がる", () => {
    const blade = arena("role.oathbound", { contentId: "item.rusted-sword", quantity: 1 });
    enemy(blade, { x: 11, y: 10 }, "monster.bone-thrall", 1, 0, "bones");
    const after = applyAction(blade, { type: "move", direction: "east" });
    expect(after.entities.find((entity) => entity.id === "bones")?.dormant).toBeGreaterThan(0);
    const mace = arena("role.lantern-priest", { contentId: "item.studded-club", quantity: 1 });
    enemy(mace, { x: 11, y: 10 }, "monster.bone-thrall", 1, 0, "bones");
    expect(applyAction(mace, { type: "move", direction: "east" }).entities.some((entity) => entity.id === "bones")).toBe(false);
  });

  test("酸だまりは傷を受けると分かれる", () => {
    const state = arena("role.oathbound", { contentId: "item.rusted-sword", quantity: 1 });
    enemy(state, { x: 11, y: 10 }, "monster.acid-ooze", 60, 0, "ooze");
    const next = applyAction(state, { type: "move", direction: "east" });
    expect(next.entities.filter((entity) => entity.contentId === "monster.acid-ooze")).toHaveLength(2);
  });

  test("影小鬼は携行品を盗んで逃げ、倒せば取り返せる", () => {
    const state = arena();
    getPlayer(state).inventory = [{ contentId: "item.ember-tonic", quantity: 1 }];
    const imp = enemy(state, { x: 11, y: 10 }, "monster.shadow-imp", 5, 0, "imp");
    imp.stats!.attack = 3;
    const robbed = applyAction(state, { type: "wait" });
    expect(getPlayer(robbed).inventory?.some((entry) => entry.contentId === "item.ember-tonic")).toBe(false);
    expect(robbed.entities.find((entity) => entity.id === "imp")?.fleeing).toBe(true);
  });

  test("倍速の敵は2回動くが、噛みつくのは1手に1回まで", () => {
    const state = arena();
    const bat = enemy(state, { x: 13, y: 10 }, "monster.venom-bat", 30, 0, "bat");
    bat.stats!.attack = 2;
    const moved = applyAction(state, { type: "wait" });
    expect(moved.entities.find((entity) => entity.id === "bat")?.pos).toEqual({ x: 11, y: 10 });
    const bitten = applyAction(moved, { type: "wait" });
    expect(bitten.messages.filter((message) => message.text.startsWith("毒羽の蝙蝠はあなたに")).length).toBe(1);
  });

  test("突進は一直線に予告し、横へ外れれば空を切る", () => {
    let state = arena();
    const brute = enemy(state, { x: 14, y: 10 }, "monster.moss-brute", 40, 0, "brute");
    brute.stats!.attack = 6;
    state = applyAction(state, { type: "wait" });
    expect(state.entities.find((entity) => entity.id === "brute")?.telegraph?.kind).toBe("charge");
    state = applyAction(state, { type: "move", direction: "north" });
    const missed = state.entities.find((entity) => entity.id === "brute")!;
    expect(missed.recoveryTurns).toBeGreaterThan(0);
    expect(getPlayer(state).stats!.hp).toBe(getPlayer(state).stats!.maxHp);
  });
});

describe("階の変化", () => {
  test("守り手は候補から遠征ごとに選ばれる", () => {
    const bosses = new Set(Array.from({ length: 12 }, (_, index) => bossForFloor(3, 20260504 + index)));
    expect(bosses.size).toBeGreaterThanOrEqual(2);
  });

  test("兆しは階ごとに引かれ、濃霧は視界を狭める", () => {
    const config = getGameConfig();
    const seen = new Set<string>();
    for (let seed = 20260504; seed < 20260534; seed += 1) {
      const state = createInitialGame(seed, "role.oathbound");
      if (state.floorOmen) seen.add(state.floorOmen);
    }
    expect(seen.size).toBe(0);
    const foggy = structuredClone(config);
    foggy.omens.chanceByFloor = [{ maxFloor: 99, percent: 100 }];
    foggy.omens.definitions = { fog: { ...config.omens.definitions.fog, minFloor: 1 } };
    const clear = createInitialGame(20260504, "role.oathbound");
    setGameConfig(foggy);
    const misty = createInitialGame(20260504, "role.oathbound");
    expect(misty.floorOmen).toBe("fog");
    expect(misty.tiles.filter((tile) => tile.visible).length).toBeLessThan(clear.tiles.filter((tile) => tile.visible).length);
  });

  test("精鋭は銘を冠し、倒すと印つきの装備を落とす", () => {
    const state = arena("role.oathbound", { contentId: "item.rusted-sword", quantity: 1 });
    const elite = enemy(state, { x: 11, y: 10 }, "monster.ash-rat", 10, 0, "elite");
    applyElite(elite, "brute");
    elite.stats!.hp = 1;
    const next = applyAction(state, { type: "move", direction: "east" });
    const drop = next.entities.find((entity) => entity.kind === "item" && getGameConfig().equipment[entity.contentId]);
    expect(next.messages.some((message) => message.text.includes("剛力の灰かぶり鼠を倒した"))).toBe(true);
    expect(drop?.seals?.length).toBeGreaterThanOrEqual(1);
  });
});
