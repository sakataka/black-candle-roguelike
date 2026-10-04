import { getGameConfig } from "../content/config";
import { getContentName } from "../content/entities";
import { hasCondition } from "./conditions";
import { equipmentSlot, equippedEntry, pieceName, pieceSeals, weaponTypeOf } from "./inventory";
import { Rng } from "./rng";
import { chebyshev, inBounds, isWalkable, samePoint, tileAt } from "./spatial";
import { getPlayer } from "./state";
import { hasLineOfSight, pushMessage } from "./stateOps";
import type { Entity, GameState, MonsterBehavior, Point } from "../types";

// 敵ごとの振る舞い。数値の強さではなく、どう崩すかを変える。設定は monsterBehaviors にある。

export function behaviorOf(contentId: string): MonsterBehavior {
  return getGameConfig().monsterBehaviors?.[contentId] ?? {};
}

function visible(state: GameState, pos: Point): boolean {
  return tileAt(state, pos).visible;
}

function freeAdjacent(state: GameState, center: Point, rng: Rng): Point | null {
  const options: Point[] = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const point = { x: center.x + dx, y: center.y + dy };
      if ((dx || dy) && inBounds(state, point) && isWalkable(tileAt(state, point).kind) && !state.entities.some((entity) => entity.blocksMovement && samePoint(entity.pos, point))) options.push(point);
    }
  }
  return options.length ? rng.pick(options) : null;
}

/** 群れ。同じ敵が探索者の隣にいるほど噛みつきが重くなる。 */
export function packBonus(state: GameState, attacker: Entity, defender: Entity): number {
  const pack = behaviorOf(attacker.contentId).pack;
  if (!pack) return 0;
  const allies = state.entities.filter((entity) => entity !== attacker && entity.kind === "monster" && entity.contentId === attacker.contentId && chebyshev(entity.pos, defender.pos) <= 1).length;
  return allies * pack;
}

/** 盾持ち。鈍器以外の正面からの打撃を軽減する。隙・不意打ち・看破には効かない。 */
export function shieldScale(target: Entity, player: Entity, open: boolean): number {
  const shielded = behaviorOf(target.contentId).shielded;
  if (!shielded || open || hasCondition(target, "exposed")) return 1;
  return weaponTypeOf(equippedEntry(player, "weapon")?.contentId) === "mace" ? 1 : 1 - shielded / 100;
}

/** 敵の近接が探索者に当たった後。盗みと錆び。 */
export function afterMonsterHitsPlayer(state: GameState, monster: Entity): void {
  const behavior = behaviorOf(monster.contentId);
  const player = getPlayer(state);
  const rng = new Rng(state.seed + state.turn * 61 + monster.id.length * 19);
  if (behavior.thief && !monster.fleeing) {
    const loot = (player.inventory ?? []).filter((entry) => !entry.equipped && entry.quantity > 0 && !equipmentSlot(entry.contentId));
    if (loot.length) {
      const entry = rng.pick(loot);
      entry.quantity -= 1;
      player.inventory = player.inventory?.filter((candidate) => candidate.quantity > 0);
      monster.inventory = [...(monster.inventory ?? []), { contentId: entry.contentId, quantity: 1 }];
      state.messages = pushMessage(state, `${getContentName(monster.contentId)}に${getContentName(entry.contentId)}を盗まれた。倒せば取り返せる。`, "danger");
    } else if (state.playerProgress.gold > 0) {
      const amount = Math.min(state.playerProgress.gold, 10 + state.floor * 3);
      state.playerProgress = { ...state.playerProgress, gold: state.playerProgress.gold - amount };
      monster.goldAmount = (monster.goldAmount ?? 0) + amount;
      state.messages = pushMessage(state, `${getContentName(monster.contentId)}に古銭を${amount}枚かすめ取られた。`, "danger");
    } else {
      return;
    }
    monster.fleeing = true;
  }
  if (behavior.corrode && rng.int(1, 100) <= behavior.corrode) {
    const targets = (["armor", "shield", "weapon"] as const)
      .flatMap((slot) => {
        const entry = equippedEntry(player, slot);
        return entry && !pieceSeals(entry).some((seal) => seal.rustproof) && (entry.plus ?? 0) > -3 ? [entry] : [];
      });
    if (targets.length) {
      const entry = targets[0];
      entry.plus = (entry.plus ?? 0) - 1;
      state.messages = pushMessage(state, `${getContentName(monster.contentId)}にかじられ、${pieceName(entry)}になった。`, "danger");
    }
  }
}

/** 分裂。傷を受けて生き残ると、残りの命を分けて隣に増える。 */
export function maybeSplit(state: GameState, target: Entity): void {
  const split = behaviorOf(target.contentId).split;
  if (!split || !target.stats || target.stats.hp < split.minHp || (target.splitGeneration ?? 0) >= split.max) return;
  const rng = new Rng(state.seed + state.turn * 71 + target.pos.x * 3 + target.pos.y);
  const point = freeAdjacent(state, target.pos, rng);
  if (!point) return;
  const half = Math.floor(target.stats.hp / 2);
  target.stats.hp -= half;
  target.splitGeneration = (target.splitGeneration ?? 0) + 1;
  state.entities.push({
    id: `${target.contentId}.split.${state.floor}.${state.turn}.${state.entities.length}`,
    kind: "monster",
    contentId: target.contentId,
    pos: point,
    blocksMovement: true,
    hostile: true,
    alerted: true,
    splitGeneration: target.splitGeneration,
    stats: { ...target.stats, hp: half },
  });
  if (visible(state, target.pos)) state.messages = pushMessage(state, `${getContentName(target.contentId)}が裂けて二つに分かれた。`, "combat");
}

/** 蘇り。鈍器や浄化の刃でなければ、一度だけ崩れたまま蠢き、数手後に起き上がる。 */
export function tryRevive(state: GameState, defeated: Entity): boolean {
  const revive = behaviorOf(defeated.contentId).revive;
  if (!revive || defeated.revived || !defeated.stats) return false;
  const player = getPlayer(state);
  const weapon = equippedEntry(player, "weapon");
  const holy = weapon && (pieceSeals(weapon).some((seal) => seal.bonusVsFamilies?.families.includes("undead")) || getGameConfig().equipment[weapon.contentId]?.specialDamage?.families.includes("undead"));
  if (weaponTypeOf(weapon?.contentId) === "mace" || holy) return false;
  defeated.revived = true;
  defeated.dormant = revive.turns;
  defeated.stats.hp = Math.ceil(defeated.stats.maxHp / 2);
  defeated.conditions = [];
  defeated.telegraph = undefined;
  if (visible(state, defeated.pos)) state.messages = pushMessage(state, `${getContentName(defeated.contentId)}は崩れたが、骨がまだ蠢いている。砕くなら今だ。`, "combat");
  return true;
}

/** 倒れた時の置き土産。爆ぜる敵と、盗んだ品を抱えた敵。 */
export function onMonsterDefeated(state: GameState, defeated: Entity): void {
  const behavior = behaviorOf(defeated.contentId);
  const player = getPlayer(state);
  if (behavior.explode && chebyshev(player.pos, defeated.pos) <= 1 && player.stats) {
    const damage = behavior.explode.damage + Math.floor(state.floor * behavior.explode.perFloor);
    player.stats.hp -= damage;
    state.messages = pushMessage(state, `${getContentName(defeated.contentId)}が爆ぜ、${damage}ダメージを受けた。`, "danger");
    if (player.stats.hp <= 0) {
      state.status = "lost";
      state.story.killedBy = { cause: "combat", contentId: defeated.contentId };
      state.messages = pushMessage(state, "迷宮の暗闇に倒れた。", "danger");
    }
  }
  for (const entry of defeated.inventory ?? []) {
    state.entities.push({ id: `${entry.contentId}.recovered.${state.turn}.${state.entities.length}`, kind: "item", contentId: entry.contentId, pos: { ...defeated.pos }, blocksMovement: false });
  }
  if (defeated.goldAmount) {
    state.playerProgress = { ...state.playerProgress, gold: state.playerProgress.gold + defeated.goldAmount };
    state.messages = pushMessage(state, `取られた古銭${defeated.goldAmount}枚を取り返した。`, "loot");
  }
}

/**
 * 敵の手番の最初に行う振る舞い。行動を使い切った場合は true を返す。
 * 崩れた亡者の待機、再生、癒し手の祈り、盗人の逃走を扱う。
 */
export function preMonsterTurn(state: GameState, monster: Entity, stepAway: () => GameState | null): { acted: boolean; state: GameState } {
  const behavior = behaviorOf(monster.contentId);
  if ((monster.dormant ?? 0) > 0) {
    monster.dormant! -= 1;
    if (monster.dormant === 0 && visible(state, monster.pos)) state.messages = pushMessage(state, `${getContentName(monster.contentId)}が再び起き上がった。`, "combat");
    return { acted: true, state };
  }
  if (behavior.regenerate && monster.stats && monster.stats.hp < monster.stats.maxHp && !hasCondition(monster, "venomed")) {
    monster.stats.hp = Math.min(monster.stats.maxHp, monster.stats.hp + behavior.regenerate);
  }
  if (behavior.healer && monster.alerted && state.turn % behavior.healer.every === 0) {
    const patient = state.entities
      .filter((entity) => entity !== monster && entity.kind === "monster" && entity.stats && entity.stats.hp < entity.stats.maxHp && chebyshev(entity.pos, monster.pos) <= behavior.healer!.range && hasLineOfSight(state, monster.pos, entity.pos))
      .sort((a, b) => a.stats!.hp / a.stats!.maxHp - b.stats!.hp / b.stats!.maxHp)[0];
    if (patient?.stats) {
      const healed = Math.min(patient.stats.maxHp - patient.stats.hp, Math.ceil(patient.stats.maxHp * behavior.healer.percent / 100));
      patient.stats.hp += healed;
      if (visible(state, monster.pos) || visible(state, patient.pos)) state.messages = pushMessage(state, `${getContentName(monster.contentId)}が${getContentName(patient.contentId)}の傷を塞いだ（+${healed}）。`, "combat");
      return { acted: true, state };
    }
  }
  if (monster.fleeing) {
    const escaped = stepAway();
    if (escaped) return { acted: true, state: escaped };
  }
  return { acted: false, state };
}
