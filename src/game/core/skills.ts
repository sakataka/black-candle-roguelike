import { getGameConfig } from "../content/config";
import { contentEntities, getContentName } from "../content/entities";
import { applyFixedDamage, playerStrike } from "./combat";
import { upsertCondition } from "./conditions";
import { roleDefinition } from "./inventory";
import { chebyshev, inBounds, isWalkable, samePoint, tileAt } from "./spatial";
import { getPlayer } from "./state";
import { hasLineOfSight, pushMessage } from "./stateOps";
import type { Entity, GameObservation, GameState, Point, SkillConfig, SkillId } from "../types";

// 職業の固有技。核とAIが同じ判定を使えるよう、見えている情報（SkillView）から可否と移動先を決める。

type ViewEntity = Pick<Entity, "id" | "pos" | "contentId" | "stats" | "conditions">;

export type SkillView = {
  player: Pick<Entity, "pos" | "contentId" | "skillCooldown">;
  hostiles: ViewEntity[];
  walkable: (point: Point) => boolean;
  occupied: (point: Point) => boolean;
  clearLine: (from: Point, to: Point) => boolean;
};

export type SkillPlan = { skillId: SkillId; target?: ViewEntity; destination?: Point };

export function roleSkill(roleId: string): { id: SkillId; config: SkillConfig } | null {
  const id = roleDefinition(roleId)?.traits.skill;
  const config = id ? getGameConfig().skills?.[id] : undefined;
  return id && config ? { id, config } : null;
}

function free(view: SkillView, point: Point): boolean {
  return view.walkable(point) && !view.occupied(point);
}

function inLane(from: Point, to: Point): boolean {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  return dx === 0 || dy === 0 || dx === dy;
}

function neighbors(center: Point): Point[] {
  const points: Point[] = [];
  for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if (dx || dy) points.push({ x: center.x + dx, y: center.y + dy });
  return points;
}

/** 技が使えるなら対象と移動先を返す。targetId を省けば、技ごとの既定の対象を選ぶ。 */
export function planSkill(view: SkillView, targetId?: string): SkillPlan | null {
  const skill = roleSkill(view.player.contentId);
  if (!skill || (view.player.skillCooldown ?? 0) > 0) return null;
  const { id, config } = skill;
  const me = view.player.pos;
  const pick = (candidates: ViewEntity[]) => targetId ? candidates.find((entity) => entity.id === targetId) : candidates.sort((a, b) => chebyshev(a.pos, me) - chebyshev(b.pos, me))[0];
  if (id === "oath-strike") {
    const target = pick(view.hostiles.filter((entity) => chebyshev(entity.pos, me) <= 1));
    return target ? { skillId: id, target } : null;
  }
  if (id === "sanctify") {
    return view.hostiles.some((entity) => chebyshev(entity.pos, me) <= (config.range ?? 3)) ? { skillId: id } : null;
  }
  if (id === "appraise" || id === "ash-flask" || id === "pin-shot") {
    const target = pick(view.hostiles.filter((entity) => chebyshev(entity.pos, me) <= (config.range ?? 4) && view.clearLine(me, entity.pos)
      && (id !== "appraise" || !entity.conditions?.some((condition) => condition.kind === "exposed"))));
    return target ? { skillId: id, target } : null;
  }
  if (id === "charge") {
    const target = pick(view.hostiles.filter((entity) => {
      const gap = chebyshev(entity.pos, me);
      return gap >= 2 && gap <= (config.range ?? 4) && inLane(me, entity.pos);
    }));
    if (!target) return null;
    const step = { x: Math.sign(target.pos.x - me.x), y: Math.sign(target.pos.y - me.y) };
    const lane: Point[] = [];
    for (let point = { x: me.x + step.x, y: me.y + step.y }; !samePoint(point, target.pos); point = { x: point.x + step.x, y: point.y + step.y }) lane.push(point);
    return lane.length && lane.every((point) => free(view, point)) ? { skillId: id, target, destination: lane[lane.length - 1] } : null;
  }
  const target = pick(view.hostiles.filter((entity) => chebyshev(entity.pos, me) <= (config.range ?? 5) && view.clearLine(me, entity.pos)));
  if (!target) return null;
  const away = neighbors(target.pos).filter((point) => free(view, point)).sort((a, b) => chebyshev(b, me) - chebyshev(a, me))[0];
  return away ? { skillId: id, target, destination: away } : null;
}

export function skillViewFromState(state: GameState): SkillView {
  const player = getPlayer(state);
  return {
    player,
    hostiles: state.entities.filter((entity) => entity.kind === "monster" && entity.hostile && entity.stats && tileAt(state, entity.pos).visible),
    walkable: (point) => inBounds(state, point) && isWalkable(tileAt(state, point).kind),
    occupied: (point) => state.entities.some((entity) => entity.blocksMovement && samePoint(entity.pos, point)),
    clearLine: (from, to) => hasLineOfSight(state, from, to),
  };
}

export function skillViewFromObservation(observation: GameObservation, clearLine: (from: Point, to: Point) => boolean, walkable: (point: Point) => boolean, occupied: (point: Point) => boolean): SkillView {
  return {
    player: observation.player,
    hostiles: observation.visibleEntities.filter((entity) => entity.kind === "monster" && entity.hostile && entity.stats),
    walkable,
    occupied,
    clearLine,
  };
}

/** 技の解決。見えていなかった障害で使えなかった時は、構えを解いて手番を終える。 */
export function useSkill(state: GameState, targetId?: string): GameState {
  const player = getPlayer(state);
  const skill = roleSkill(player.contentId);
  const plan = planSkill(skillViewFromState(state), targetId);
  if (!skill || !plan) {
    state.messages = pushMessage(state, "技を構えたが、機を逃した。", "explore");
    return state;
  }
  const { config } = skill;
  player.skillCooldown = config.cooldown;
  const level = state.playerProgress.level;
  const target = plan.target ? state.entities.find((entity) => entity.id === plan.target!.id) : undefined;
  state.messages = pushMessage(state, `${config.label}！`, "combat");
  if (plan.skillId === "oath-strike" && target) {
    const boss = contentEntities[target.contentId]?.tier === "boss";
    state = playerStrike(state, target, { scale: boss ? config.bossScale ?? config.scale : config.scale, verb: "へ誓いの一撃を振り下ろし、" });
    if (!state.entities.includes(target) && player.stats) {
      const healed = Math.min(player.stats.maxHp - player.stats.hp, config.healOnKill ?? 0);
      player.stats.hp += healed;
      if (healed > 0) state.messages = pushMessage(state, `誓いが果たされ、HPが${healed}回復した。`, "loot");
    }
    return state;
  }
  if (plan.skillId === "pin-shot" && target) {
    state = playerStrike(state, target, { scale: config.scale, verb: "を縫い止め、", ranged: true });
    if (state.entities.includes(target)) daze(target, config.turns ?? 2);
    return state;
  }
  if (plan.skillId === "sanctify") {
    // プリーストは灯で周りを焼きながら、自分の傷を塞いで穢れを払う。亡者と悪魔には深く効く。
    const inRange = state.entities.filter((entity) => entity.kind === "monster" && entity.hostile && entity.stats && chebyshev(entity.pos, player.pos) <= (config.range ?? 3) && hasLineOfSight(state, player.pos, entity.pos));
    const unholy = inRange.filter((entity) => config.families?.includes(contentEntities[entity.contentId]?.family ?? "beast"));
    const damage = Math.floor((config.damage ?? 6) + level * (config.damagePerLevel ?? 1));
    for (const enemy of inRange) daze(enemy, config.turns ?? 1);
    if (player.stats) {
      const healed = Math.min(player.stats.maxHp - player.stats.hp, Math.floor((config.heal ?? 4) + level / 2));
      player.stats.hp += healed;
      player.conditions = player.conditions?.filter((condition) => condition.kind !== "venomed" && condition.kind !== "bleeding");
      if (healed > 0) state.messages = pushMessage(state, `灯の温もりで傷が塞がった（+${healed}）。`, "loot");
    }
    state = applyFixedDamage(state, unholy, damage * 2, "を聖なる光が焼き、");
    return applyFixedDamage(state, inRange.filter((entity) => !unholy.includes(entity) && state.entities.includes(entity)), damage, "を灯が照らし、");
  }
  if (plan.skillId === "appraise" && target) {
    const marked = state.entities.filter((entity) => entity.kind === "monster" && entity.hostile && chebyshev(entity.pos, target.pos) <= (config.radius ?? 2));
    for (const enemy of marked) enemy.conditions = upsertCondition(enemy.conditions, "exposed", config.turns ?? 6);
    state.messages = pushMessage(state, `${getContentName(target.contentId)}${marked.length > 1 ? `たち${marked.length}体` : ""}の継ぎ目を見抜いた。しばらく守りが効かない。`, "combat");
    return state;
  }
  if (plan.skillId === "ash-flask" && target) {
    const splash = state.entities.filter((entity) => entity.kind === "monster" && entity.hostile && entity.stats && chebyshev(entity.pos, target.pos) <= 1);
    for (const enemy of splash) enemy.conditions = upsertCondition(enemy.conditions, "venomed", config.turns ?? 4);
    return applyFixedDamage(state, splash, Math.floor((config.damage ?? 4) + level * (config.damagePerLevel ?? 0.5)), "に毒が降りかかり、");
  }
  if (plan.skillId === "charge" && target && plan.destination) {
    player.pos = { ...plan.destination };
    state = playerStrike(state, target, { scale: config.scale, verb: "へ突進し、" });
    if (state.entities.includes(target)) daze(target, config.turns ?? 1);
    return state;
  }
  if (plan.skillId === "shadowstep" && target && plan.destination) {
    player.pos = { ...plan.destination };
    return playerStrike(state, target, { forceBackstab: true, verb: "の陰から刃を入れ、" });
  }
  return state;
}

function daze(enemy: Entity, turns: number): void {
  enemy.conditions = upsertCondition(enemy.conditions, "dazed", turns);
  enemy.telegraph = undefined;
  enemy.alerted = true;
  enemy.asleep = false;
}
