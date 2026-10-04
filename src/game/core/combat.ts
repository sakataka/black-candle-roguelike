import { getGameConfig } from "../content/config";
import { contentEntities, getContentName } from "../content/entities";
import { realtimeConfig } from "../content/realtime";
import { hasCondition, upsertCondition } from "./conditions";
import { equippedEntry, equippedSeals, equippedWeaponSpecialDamage, equippedWeaponType, pieceSeals } from "./inventory";
import { Rng } from "./rng";
import { chebyshev, inBounds, isWalkable, samePoint, tileAt } from "./spatial";
import { getPlayer } from "./state";
import { hasLineOfSight, pushMessage, recordStrike, roleTraits } from "./stateOps";
import { maybeSplit, shieldScale } from "./monsterBehaviors";
import { entityName } from "./bestiary";
import type { Entity, GameState, Point } from "../types";

// 探索者の攻撃と、武器の型・印の効果。撃破の後始末（経験値・報酬・守り手の判断）は game.ts へ委ねる。

type DefeatHandler = (state: GameState, defeated: Entity) => GameState;
let onDefeat: DefeatHandler = (state) => state;

export function registerDefeatHandler(handler: DefeatHandler): void {
  onDefeat = handler;
}

/** 気づいていない・眠っている・構え中・隙のある・怯んだ敵。短剣の不意打ちが入る。 */
export function isOpenToBackstab(target: Pick<Entity, "alerted" | "asleep" | "recoveryTurns" | "telegraph" | "conditions">): boolean {
  return !target.alerted || !!target.asleep || (target.recoveryTurns ?? 0) > 0 || !!target.telegraph || (target.conditions?.some((condition) => condition.kind === "dazed" && condition.turns > 0) ?? false);
}

type HitOptions = { scale?: number; allowBackstab?: boolean; forceBackstab?: boolean; base?: number; procs?: boolean };
type HitResult = { damage: number; notes: string[] };

function combatRng(state: GameState, salt: number): Rng {
  return new Rng(state.seed + state.turn * 97 + salt * 131 + 13);
}

function weaponSeals(player: Entity) {
  const weapon = equippedEntry(player, "weapon");
  return weapon ? pieceSeals(weapon) : [];
}

function computeHit(player: Entity, target: Entity, rng: Rng, options: HitOptions): HitResult {
  const weapon = equippedWeaponType(player)?.config;
  const notes: string[] = [];
  const recovering = (target.recoveryTurns ?? 0) > 0;
  const opening = recovering ? Math.round(realtimeConfig().ai.recoveryDamageBonus * (weapon?.openingMultiplier ?? 1)) : 0;
  if (recovering && (weapon?.openingMultiplier ?? 1) > 1) notes.push("隙");
  const special = equippedWeaponSpecialDamage(player, target.contentId);
  if (special > 0) notes.push("特効");
  let raw = ((options.base ?? player.stats?.attack ?? 1) + rng.int(0, getGameConfig().rules.attackRandomBonusMax) + special + opening) * (options.scale ?? 1);
  const open = isOpenToBackstab(target);
  if (options.forceBackstab || (options.allowBackstab && weapon?.backstabMultiplier && open)) {
    raw *= roleTraits(player.contentId)?.backstabMultiplier ?? weapon?.backstabMultiplier ?? 2;
    notes.push("不意打ち");
  }
  const shield = shieldScale(target, player, open || !!options.forceBackstab);
  if (shield < 1) {
    raw *= shield;
    notes.push("盾に阻まれる");
  }
  const exposed = hasCondition(target, "exposed");
  if (exposed) {
    raw *= getGameConfig().rules.exposedDamagePercent / 100;
    notes.push("看破");
  }
  const keen = weaponSeals(player).find((seal) => seal.critPercent);
  if (keen && rng.int(1, 100) <= (keen.critPercent ?? 0)) {
    raw *= keen.critMultiplier ?? 1.5;
    notes.push("会心");
  }
  const defense = exposed ? 0 : Math.round((target.stats?.defense ?? 0) * (1 - (weapon?.defenseIgnorePercent ?? 0) / 100));
  return { damage: Math.max(1, Math.round(raw) - defense), notes };
}

function applyHit(state: GameState, player: Entity, target: Entity, result: HitResult, rng: Rng, options: { procs: boolean; verb: string; ranged?: boolean }): void {
  if (!target.stats || !player.stats) return;
  target.stats.hp -= result.damage;
  target.alerted = true;
  target.asleep = false;
  recordStrike(state, player, target, options.ranged ?? false);
  const notes = result.notes.length ? `（${result.notes.join("・")}）` : "";
  state.messages = pushMessage(state, `${entityName(target)}${options.verb}${result.damage}ダメージ${notes}。`, "combat");
  if (target.stats.hp > 0) maybeSplit(state, target);
  if (!options.procs || target.stats.hp <= 0) {
    if (options.procs) drainLife(state, player, result.damage);
    return;
  }
  drainLife(state, player, result.damage);
  for (const seal of weaponSeals(player)) {
    if (seal.inflict && rng.int(1, 100) <= seal.inflict.chancePercent) {
      target.conditions = upsertCondition(target.conditions, seal.inflict.kind, seal.inflict.turns);
      state.messages = pushMessage(state, `${entityName(target)}に${seal.label}の印が残った。`, "combat");
    }
  }
  const dazeChance = (equippedWeaponType(player)?.config.dazeChancePercent ?? 0) + weaponSeals(player).reduce((sum, seal) => sum + (seal.dazeChancePercent ?? 0), 0);
  const isBoss = contentEntities[target.contentId]?.tier === "boss";
  if (dazeChance > 0 && rng.int(1, 100) <= (isBoss ? Math.floor(dazeChance / 2) : dazeChance)) {
    target.conditions = upsertCondition(target.conditions, "dazed", 1);
    target.telegraph = undefined;
    state.messages = pushMessage(state, `${entityName(target)}がよろめいた。`, "combat");
  }
}

function drainLife(state: GameState, player: Entity, damage: number): void {
  const percent = weaponSeals(player).reduce((sum, seal) => sum + (seal.drainPercent ?? 0), 0);
  if (!percent || !player.stats) return;
  const healed = Math.min(player.stats.maxHp - player.stats.hp, Math.max(1, Math.round(damage * percent / 100)));
  if (healed > 0) player.stats.hp += healed;
}

function settleDefeats(state: GameState, victims: Entity[]): GameState {
  for (const victim of victims) {
    if (state.status !== "playing") break;
    if ((victim.stats?.hp ?? 1) <= 0 && state.entities.some((entity) => entity.id === victim.id)) state = onDefeat(state, victim);
  }
  return state;
}

function hostileAt(state: GameState, point: Point): Entity | undefined {
  return state.entities.find((entity) => entity.kind === "monster" && entity.hostile && entity.stats && entity.stats.hp > 0 && samePoint(entity.pos, point));
}

function unitStep(from: Point, to: Point): Point {
  return { x: Math.sign(to.x - from.x), y: Math.sign(to.y - from.y) };
}

/** 槍が2マス先へ届くか。直線か斜めで、間のマスが空いていること。 */
export function canReach(state: GameState, player: Entity, target: Entity): boolean {
  const reach = equippedWeaponType(player)?.config.reach ?? 1;
  const dx = target.pos.x - player.pos.x;
  const dy = target.pos.y - player.pos.y;
  if (reach < 2 || chebyshev(player.pos, target.pos) !== 2 || (dx !== 0 && dy !== 0 && Math.abs(dx) !== Math.abs(dy)) || (dx === 0 && dy === 0)) return false;
  if ((Math.abs(dx) !== 0 && Math.abs(dx) !== 2) || (Math.abs(dy) !== 0 && Math.abs(dy) !== 2)) return false;
  const middle = { x: player.pos.x + Math.sign(dx), y: player.pos.y + Math.sign(dy) };
  return inBounds(state, middle) && isWalkable(tileAt(state, middle).kind) && !state.entities.some((entity) => entity.blocksMovement && samePoint(entity.pos, middle));
}

/** 近接と槍の間合い攻撃。型ごとの打撃数・なぎ払い・貫通をまとめて解決する。 */
export function playerWeaponAttack(state: GameState, target: Entity): GameState {
  const player = getPlayer(state);
  if (!player.stats || !target.stats) return state;
  const weapon = equippedWeaponType(player)?.config;
  const rng = combatRng(state, target.id.length + target.pos.x);
  const open = isOpenToBackstab(target);
  const victims = [target];
  const strikes = weapon?.strikes ?? 1;
  for (let index = 0; index < strikes && target.stats.hp > 0; index += 1) {
    const result = computeHit(player, target, rng, { scale: weapon?.strikeScale ?? 1, allowBackstab: open });
    applyHit(state, player, target, result, rng, { procs: true, verb: chebyshev(player.pos, target.pos) > 1 ? "を突き、" : "に" });
  }
  if (weapon?.cleaveScale) {
    for (const other of state.entities.filter((entity) => entity !== target && entity.kind === "monster" && entity.hostile && entity.stats && entity.stats.hp > 0 && chebyshev(entity.pos, player.pos) <= 1)) {
      applyHit(state, player, other, computeHit(player, other, rng, { scale: weapon.cleaveScale }), rng, { procs: false, verb: "をなぎ払い、" });
      victims.push(other);
    }
  }
  if (weapon?.pierceScale) {
    const step = unitStep(player.pos, target.pos);
    const behind = hostileAt(state, { x: target.pos.x + step.x, y: target.pos.y + step.y });
    if (behind && hasLineOfSight(state, player.pos, behind.pos)) {
      applyHit(state, player, behind, computeHit(player, behind, rng, { scale: weapon.pierceScale }), rng, { procs: false, verb: "まで貫き、" });
      victims.push(behind);
    }
  }
  return settleDefeats(state, victims);
}

/** 技から使う一撃。倍率や不意打ちの強制を指定し、撃破まで解決する。 */
export function playerStrike(state: GameState, target: Entity, options: { scale?: number; forceBackstab?: boolean; verb?: string; ranged?: boolean }): GameState {
  const player = getPlayer(state);
  if (!player.stats || !target.stats) return state;
  const rng = combatRng(state, target.id.length + 41);
  applyHit(state, player, target, computeHit(player, target, rng, { scale: options.scale, allowBackstab: true, forceBackstab: options.forceBackstab }), rng, { procs: true, verb: options.verb ?? "に", ranged: options.ranged });
  return settleDefeats(state, [target]);
}

/** 技や毒の瓶など、防御を無視した固定の傷。撃破まで解決する。 */
export function applyFixedDamage(state: GameState, targets: Entity[], damage: number, verb: string): GameState {
  const player = getPlayer(state);
  for (const target of targets) {
    if (!target.stats) continue;
    target.stats.hp -= damage;
    target.alerted = true;
    target.asleep = false;
    recordStrike(state, player, target, true);
    state.messages = pushMessage(state, `${entityName(target)}${verb}${damage}ダメージ。`, "combat");
    if (target.stats.hp > 0) maybeSplit(state, target);
  }
  return settleDefeats(state, targets);
}

export function bowFor(player: Entity) {
  const weapon = equippedEntry(player, "weapon");
  return weapon ? getGameConfig().equipment[weapon.contentId]?.rangedAttack : undefined;
}

/** 弓の射撃。修正値・得意補正・印の会心と特効を乗せる。 */
export function playerBowShot(state: GameState, target: Entity): GameState {
  const player = getPlayer(state);
  const bow = bowFor(player);
  if (!bow || !target.stats) return state;
  const rng = combatRng(state, target.id.length + 7);
  // 矢の威力は探索者の攻撃（弓の修正値と得意補正を含む）に、弓ごとの張りの強さを足す。
  const base = (player.stats?.attack ?? 1) + bow.damage - getGameConfig().rules.bowDamageOffset;
  applyHit(state, player, target, computeHit(player, target, rng, { base }), rng, { procs: true, verb: "へ矢を放ち、", ranged: true });
  return settleDefeats(state, [target]);
}

/** 剣の返し斬り。近接で殴られて立っていれば、確率で斬り返す。 */
export function counterAttack(state: GameState, attacker: Entity): GameState {
  const player = getPlayer(state);
  const weapon = equippedWeaponType(player)?.config;
  if (!weapon?.counterChancePercent || !attacker.stats || attacker.stats.hp <= 0 || (player.stats?.hp ?? 0) <= 0 || chebyshev(player.pos, attacker.pos) > 1) return state;
  const rng = combatRng(state, attacker.id.length + 29);
  if (rng.int(1, 100) > weapon.counterChancePercent) return state;
  applyHit(state, player, attacker, computeHit(player, attacker, rng, { scale: weapon.counterScale ?? 0.75 }), rng, { procs: true, verb: "へ返し斬り、" });
  return settleDefeats(state, [attacker]);
}

/** 棘返しの印。近接で殴ってきた敵へ痛みを返す。 */
export function thornsAttack(state: GameState, attacker: Entity): GameState {
  const player = getPlayer(state);
  const thorns = equippedSeals(player).reduce((sum, seal) => sum + (seal.thorns ?? 0), 0);
  if (!thorns || !attacker.stats || attacker.stats.hp <= 0) return state;
  attacker.stats.hp -= thorns;
  state.messages = pushMessage(state, `棘が${entityName(attacker)}へ${thorns}ダメージを返した。`, "combat");
  return settleDefeats(state, [attacker]);
}

/** 敵に残った毒の進行。探索者の印や技で付いた毒だけが対象。 */
export function tickMonsterAfflictions(state: GameState): GameState {
  const victims: Entity[] = [];
  for (const monster of state.entities.filter((entity) => entity.kind === "monster" && hasCondition(entity, "exposed"))) {
    monster.conditions = monster.conditions
      ?.map((condition) => condition.kind === "exposed" ? { ...condition, turns: condition.turns - 1 } : condition)
      .filter((condition) => condition.turns > 0);
  }
  for (const monster of state.entities.filter((entity) => entity.kind === "monster" && entity.stats && hasCondition(entity, "venomed"))) {
    const damage = 1 + Math.floor(state.floor / 3);
    monster.stats!.hp -= damage;
    monster.conditions = monster.conditions
      ?.map((condition) => condition.kind === "venomed" ? { ...condition, turns: condition.turns - 1 } : condition)
      .filter((condition) => condition.turns > 0);
    if (tileAt(state, monster.pos).visible) state.messages = pushMessage(state, `${entityName(monster)}が毒に蝕まれ、${damage}ダメージ。`, "combat");
    victims.push(monster);
  }
  return settleDefeats(state, victims);
}
