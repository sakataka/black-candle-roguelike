import { isKnownWalkable, isVisibleBlockerAt, observationIndex, walkKnownPaths, type PathOptions } from "./navigation";
import { DIRECTION_DELTAS, chebyshev as distance, isWalkable, linePoints, pointKey, samePoint } from "../core/spatial";
import { getGameConfig, runRules } from "../content/config";
import { contentEntities } from "../content/entities";
import { realtimeConfig } from "../content/realtime";
import { visibleDangerTiles } from "../core/realtime";
import type { AutoplayPolicyValues, Direction, GameAction, GameObservation, Point, PolicyModifier } from "../types";

// 斜めも1手。同じ評価なら縦横を先に選ぶ。
const directions = Object.entries(DIRECTION_DELTAS).map(([direction, delta]) => ({
  action: { type: "move", direction: direction as Direction } as GameAction,
  delta,
}));
const cardinalDirections = directions.slice(0, 4);

const visitCounts = new Map<string, number>();
const recentPositions = new Map<string, string[]>();
const progressMemory = new Map<string, { knownTiles: number; playerKey: string; stagnantTurns: number }>();
const frontierTargets = new Map<string, Point>();
const VISIT_PENALTY = 80;
const RECENT_POSITION_PENALTY = 160;
const RECENT_POSITION_LIMIT = 12;
const STAGNANT_EXPLORATION_TURNS = 18;
const LOOP_ESCAPE_TURNS = 24;
const LOOP_ESCAPE_UNIQUE_LIMIT = 4;

export type AutoplayDebugState = {
  scope: string;
  recentPositions: string[];
  knownTiles: number;
  lastKnownTiles: number;
  stagnantTurns: number;
  visitsAtPlayer: number;
  objective: GameObservation["exploration"]["objective"];
  reachableFrontierCount: number;
};

type KnownSurvivalPickupCandidate = {
  entity: GameObservation["knownEntities"][number];
  options: PathOptions;
  score: number;
};

const tacticalIntents = new WeakMap<GameObservation, "dodge" | "lure" | "cover" | "opening">();
const terrainTurns = new Map<string, number>();

export function resetAutoplayState(): void {
  visitCounts.clear();
  recentPositions.clear();
  progressMemory.clear();
  frontierTargets.clear();
  terrainTurns.clear();
}

export function chooseAutoplayAction(observation: GameObservation): GameAction {
  recordPlayerPosition(observation);
  const progress = recordExplorationProgress(observation);
  const knownEntities = observation.knownEntities;

  const hp = observation.player.stats?.hp ?? 1;
  const maxHp = observation.player.stats?.maxHp ?? 1;
  const hpRatio = hp / maxHp;
  const policy = resolveAutoplayPolicy(observation);
  const allowRiskyTraversal = progress.stagnantTurns >= Math.max(LOOP_ESCAPE_TURNS, policy.trapPatience) && hpRatio > policy.riskyTraversalHp;
  const visibleHostiles = observation.visibleEntities.filter((entity) => entity.kind === "monster" && entity.hostile);
  const visibleRangedThreats = visibleHostiles.filter((entity) => isRangedThreat(entity.contentId) && distance(entity.pos, observation.player.pos) <= 6);
  const visibleRangedThreat = nearest(visibleRangedThreats, observation.player.pos);
  const nearbyEnemies = visibleHostiles.filter((entity) => distance(entity.pos, observation.player.pos) <= 3);
  const combatPressure = nearbyEnemies.length > 0 || !!visibleRangedThreat;
  const urgentRangedPressure = visibleRangedThreats.length >= 2 || (visibleRangedThreats.length >= 1 && hpRatio <= 0.35);
  const hasDamageCondition = observation.player.conditions?.some((condition) => condition.kind === "bleeding" || condition.kind === "venomed") ?? false;
  const dodge = chooseTacticalStep(observation, hpRatio, true);
  if (dodge) return dodge;
  const salve = observation.player.inventory?.find((entry) => entry.contentId === "item.bloodmoss-salve" && entry.quantity > 0);
  if (salve && (hasDamageCondition || hpRatio <= (combatPressure ? policy.salveCombat : policy.salveCalm) + policy.healBonus)) {
    return { type: "useItem", contentId: "item.bloodmoss-salve" };
  }
  const graveSunCharm = observation.player.inventory?.find((entry) => entry.contentId === "item.grave-sun-charm" && entry.quantity > 0);
  if (graveSunCharm && (hasDamageCondition || hpRatio <= (combatPressure ? policy.charmCombat : policy.charmCalm) + policy.healBonus)) {
    return { type: "useItem", contentId: "item.grave-sun-charm" };
  }

  const potion = bestHealingPotion(observation);
  if (potion && hpRatio <= (combatPressure ? policy.potionCombat : policy.potionCalm) + policy.healBonus) {
    return { type: "useItem", contentId: potion.contentId };
  }

  const currentWeapon = observation.player.inventory?.find((entry) => entry.equipped && weaponValue(entry.contentId) > 0)?.contentId;
  const betterWeapon = [...(observation.player.inventory ?? [])]
    .filter((entry) => !entry.equipped && entry.quantity > 0 && weaponValue(entry.contentId) > weaponValue(currentWeapon))
    .sort((a, b) => weaponValue(b.contentId) - weaponValue(a.contentId))[0];
  if (betterWeapon) {
    return { type: "equip", contentId: betterWeapon.contentId };
  }

  const shield = observation.player.inventory?.find((entry) => entry.contentId === "item.ward-shield" && !entry.equipped && entry.quantity > 0);
  if (shield) {
    return { type: "equip", contentId: "item.ward-shield" };
  }

  const merchantChoice = chooseMerchantService(observation, hpRatio, hasDamageCondition);
  if (merchantChoice) {
    return merchantChoice;
  }

  const itemHere = knownEntities.find(
    (entity) => (entity.kind === "item" || entity.kind === "event") && entity.pos.x === observation.player.pos.x && entity.pos.y === observation.player.pos.y,
  );
  if (itemHere?.kind === "item" && canCarry(observation, itemHere.contentId)) {
    if (!combatPressure || hpRatio > 0.35 || isSurvivalPickup(itemHere.contentId)) {
      return { type: "pickup" };
    }
  }

  const onStairs = observation.visibleTiles.find(
    (tile) => tile.kind === "stairsDown" && tile.x === observation.player.pos.x && tile.y === observation.player.pos.y,
  );
  if (onStairs && !observation.bossAlive && !observation.pendingDecision) {
    return { type: "descend" };
  }

  const repulsionScroll = observation.player.inventory?.find((entry) => entry.contentId === "item.repulsion-scroll" && entry.quantity > 0);
  if (repulsionScroll && hpRatio <= 0.75 && (nearbyEnemies.length >= 2 || visibleRangedThreats.length >= 2)) {
    return { type: "useItem", contentId: "item.repulsion-scroll" };
  }

  const voidPrism = observation.player.inventory?.find((entry) => entry.contentId === "item.void-prism" && entry.quantity > 0);
  if (voidPrism && hpRatio <= 0.65 && (nearbyEnemies.length >= 2 || urgentRangedPressure)) {
    return { type: "useItem", contentId: "item.void-prism" };
  }
  const blackCandleCore = observation.player.inventory?.find((entry) => entry.contentId === "item.black-candle-core" && entry.quantity > 0);
  if (blackCandleCore && combatPressure && hpRatio <= 0.8) {
    return { type: "useItem", contentId: "item.black-candle-core" };
  }

  const guardianDraught = observation.player.inventory?.find((entry) => entry.contentId === "item.guardian-draught" && entry.quantity > 0);
  const guarded = observation.player.conditions?.some((condition) => condition.kind === "guarded") ?? false;
  if (guardianDraught && !guarded && combatPressure && hpRatio <= 0.85) {
    return { type: "useItem", contentId: "item.guardian-draught" };
  }
  const colossusHeart = observation.player.inventory?.find((entry) => entry.contentId === "item.colossus-heart" && entry.quantity > 0);
  if (colossusHeart && !guarded && combatPressure && hpRatio <= 0.85) {
    return { type: "useItem", contentId: "item.colossus-heart" };
  }

  const adjacentEnemy = observation.visibleEntities
    .filter((entity) => entity.kind === "monster" && entity.hostile)
    .find((entity) => distance(entity.pos, observation.player.pos) <= 1);
  if (adjacentEnemy) {
    if (adjacentEnemy.recoveryTurns) tacticalIntents.set(observation, "opening");
    return { type: "move", direction: directionFromDelta(adjacentEnemy.pos.x - observation.player.pos.x, adjacentEnemy.pos.y - observation.player.pos.y) };
  }
  const terrainStep = chooseTacticalStep(observation, hpRatio, false);
  if (terrainStep) return terrainStep;

  if (observation.story.missionId === "memorial" && !combatPressure && hpRatio >= realtimeConfig().missions.memorialHpRatio && !observation.story.missionCompleted) {
    const grave = nearest(observation.knownEntities.filter((e) => e.contentId === "event.grave-marker"), observation.player.pos);
    const towardGrave = grave ? stepTowardKnownReachable(observation, grave.pos) : null;
    if (towardGrave) return towardGrave;
  }

  const visibleBoss = nearest(
    observation.visibleEntities.filter((entity) => entity.kind === "monster" && entity.hostile && contentEntities[entity.contentId]?.tier === "boss"),
    observation.player.pos,
  );
  if (visibleBoss && hpRatio > policy.bossEngageHp) {
    const bossStep = stepTowardAdjacentTarget(observation, visibleBoss.pos);
    if (bossStep) {
      return bossStep;
    }
  }
  if (realtimeConfig().enabled && observation.bossAlive && !visibleBoss && observation.exploration.reachableFrontierCount === 0) {
    const gateSearch = stepTowardCurrentObjective(observation, allowRiskyTraversal, progress.stagnantTurns, hp);
    if (gateSearch) return gateSearch;
  }

  const dart = observation.player.inventory?.find((entry) => entry.contentId === "item.ember-dart" && entry.quantity > 0);
  const dartCandidates = visibleHostiles.filter((entity) => distance(entity.pos, observation.player.pos) <= policy.dartRange);
  const rangedTarget = policy.rangedPriority
    ? nearest(dartCandidates.filter((entity) => isRangedThreat(entity.contentId)), observation.player.pos)
    : nearest(dartCandidates, observation.player.pos);
  if (dart && rangedTarget && hpRatio > policy.dartMinHp) {
    return { type: "useItem", contentId: "item.ember-dart", ...(policy.rangedPriority ? { targetId: rangedTarget.id } : {}) };
  }

  if (visibleRangedThreat && policy.rangedPriority && hpRatio > 0.25) {
    const huntStep = policy.coverApproach
      ? stepTowardRangedThreatCovered(observation, visibleRangedThreat.pos, visibleRangedThreats)
      : stepTowardAdjacentTarget(observation, visibleRangedThreat.pos);
    if (huntStep) {
      return huntStep;
    }
  }


  if (observation.runTurn >= runRules(observation.modifiers).runTurnLimit - policy.urgencyTurnsLeft && !urgentRangedPressure) {
    const urgentObjectiveStep = stepTowardCurrentObjective(observation, allowRiskyTraversal, Math.max(progress.stagnantTurns, LOOP_ESCAPE_TURNS), hp);
    if (urgentObjectiveStep) {
      return urgentObjectiveStep;
    }
  }

  const weakEnemy = nearest(
    observation.visibleEntities.filter((entity) => entity.kind === "monster" && entity.hostile && (contentEntities[entity.contentId]?.danger ?? 99) <= 4),
    observation.player.pos,
  );
  if (weakEnemy && hpRatio > policy.combatHp && policy.huntWeakEnemies && progress.stagnantTurns < LOOP_ESCAPE_TURNS) {
    const attackStep = stepTowardAdjacentTarget(observation, weakEnemy.pos);
    if (attackStep) {
      return attackStep;
    }
  }

  const scroll = observation.player.inventory?.find((entry) => entry.contentId === "item.mapping-scroll" && entry.quantity > 0);
  const safeToUseUtility = !combatPressure || hpRatio > 0.45;
  if (scroll && safeToUseUtility && observation.knownTiles.length < observation.width * observation.height * 0.35) {
    return { type: "useItem", contentId: "item.mapping-scroll" };
  }

  const glimMap = observation.player.inventory?.find((entry) => entry.contentId === "item.glim-map" && entry.quantity > 0);
  if (glimMap && safeToUseUtility && observation.knownTiles.length < observation.width * observation.height * 0.22) {
    return { type: "useItem", contentId: "item.glim-map" };
  }

  if (safeToUseUtility && progress.stagnantTurns >= STAGNANT_EXPLORATION_TURNS) {
    if (scroll) {
      return { type: "useItem", contentId: "item.mapping-scroll" };
    }
    if (glimMap) {
      return { type: "useItem", contentId: "item.glim-map" };
    }
    const voidPrismForLight = observation.player.inventory?.find((entry) => entry.contentId === "item.void-prism" && entry.quantity > 0);
    if (voidPrismForLight) {
      return { type: "useItem", contentId: "item.void-prism" };
    }
  }

  const riskPanelStep = policy.avoidRiskPanels ? null : stepOntoAdjacentRiskPanel(observation, hp, hpRatio, progress.stagnantTurns, combatPressure);
  if (riskPanelStep) {
    return riskPanelStep;
  }

  const survivalPickupStep = progress.stagnantTurns < 80
    ? stepTowardKnownSurvivalPickup(observation, hpRatio, progress.stagnantTurns, allowRiskyTraversal)
    : null;
  if (survivalPickupStep) {
    return survivalPickupStep;
  }

  if (policy.discoveryDetour && !combatPressure) {
    const discoveryTarget = nearest(
      observation.visibleEntities.filter((entity) => isAutoplayTargetEntity(entity, observation)),
      observation.player.pos,
    );
    if (discoveryTarget) {
      const discoveryStep = stepTowardKnownReachable(observation, discoveryTarget.pos)
        ?? (allowRiskyTraversal ? stepTowardKnownReachable(observation, discoveryTarget.pos, { avoidTraps: false }) : null);
      if (discoveryStep) return discoveryStep;
    }
  }

  if (progress.stagnantTurns >= LOOP_ESCAPE_TURNS && !adjacentEnemy && !urgentRangedPressure) {
    const objectiveStep = stepTowardCurrentObjective(observation, allowRiskyTraversal, progress.stagnantTurns, hp);
    if (objectiveStep) {
      return avoidImmediateOscillation(observation, objectiveStep, progress.stagnantTurns);
    }
  }

  const oscillationEscape = escapeOscillationStep(observation, progress.stagnantTurns);
  if (oscillationEscape) {
    return oscillationEscape;
  }

  if (allowRiskyTraversal) {
    const adjacentTrapStep = stepOntoAdjacentKnownTrap(observation);
    if (adjacentTrapStep) {
      return adjacentTrapStep;
    }
    const riskyUnseenStep = stepTowardNearestUnseen(observation, { avoidTraps: false, allowHostileBlockers: true });
    if (riskyUnseenStep) {
      return avoidImmediateOscillation(observation, riskyUnseenStep, progress.stagnantTurns);
    }
    const relocationStep = stepTowardDistantKnownArea(observation, { avoidTraps: false, allowHostileBlockers: true });
    if (relocationStep) {
      return avoidImmediateOscillation(observation, relocationStep, progress.stagnantTurns);
    }
  }

  if (visibleRangedThreat && policy.chaseRanged && hpRatio > 0.25) {
    const shouldChaseRangedThreat = progress.stagnantTurns < LOOP_ESCAPE_TURNS || hpRatio <= 0.5;
    if (shouldChaseRangedThreat) {
      const rangedStep = policy.coverApproach
        ? stepTowardRangedThreatCovered(observation, visibleRangedThreat.pos, visibleRangedThreats)
        : stepTowardAdjacentTarget(observation, visibleRangedThreat.pos);
      if (rangedStep) {
        return rangedStep;
      }
    }
  }

  const knownStairs = observation.exploration.reachableStairs;
  const exploredEnough = observation.exploration.exploredTileRatio >= policy.exploreBeforeStairs
    || progress.stagnantTurns >= STAGNANT_EXPLORATION_TURNS
    || observation.runTurn >= runRules(observation.modifiers).runTurnLimit - policy.urgencyTurnsLeft
    || observation.exploration.reachableFrontierCount === 0;
  if (knownStairs && !observation.bossAlive && exploredEnough) {
    const stairsStep = stepTowardKnownReachable(observation, knownStairs, { allowHostileBlockers: true }) ?? (allowRiskyTraversal ? stepTowardKnownReachable(observation, knownStairs, { avoidTraps: false, allowHostileBlockers: true }) : null);
    if (stairsStep) {
      return stairsStep;
    }
  }

  const visibleItem = nearest(
    observation.visibleEntities.filter((entity) => isAutoplayTargetEntity(entity, observation)),
    observation.player.pos,
  );
  if (visibleItem) {
    const itemStep = stepTowardKnownReachable(observation, visibleItem.pos) ?? (allowRiskyTraversal ? stepTowardKnownReachable(observation, visibleItem.pos, { avoidTraps: false }) : null);
    if (itemStep) {
      return itemStep;
    }
  }

  if (weakEnemy && hpRatio > policy.combatHp && progress.stagnantTurns < LOOP_ESCAPE_TURNS) {
    const attackStep = stepTowardAdjacentTarget(observation, weakEnemy.pos);
    if (attackStep) {
      return attackStep;
    }
  }

  const unseenStep = stepTowardNearestUnseen(observation, { allowHostileBlockers: true }) ?? (allowRiskyTraversal ? stepTowardNearestUnseen(observation, { avoidTraps: false, allowHostileBlockers: true }) : null);
  if (unseenStep) {
    return avoidImmediateOscillation(observation, unseenStep, progress.stagnantTurns);
  }

  const localExplore = bestAdjacentExplore(observation, { allowHostileBlockers: true }) ?? (allowRiskyTraversal ? bestAdjacentExplore(observation, { avoidTraps: false, allowHostileBlockers: true }) : null);
  if (localExplore) {
    return avoidImmediateOscillation(observation, localExplore, progress.stagnantTurns);
  }

  return bestAdjacentExplore(observation, { allowHostileBlockers: true }) ?? directions[observation.turn % directions.length].action;
}

/**
 * 基準値 → 気質 → 方針 → 作戦カード → 古傷 → 継承した教訓の順に調整値を重ねる。
 * 方針は気質の傾向を上書きし、作戦カードはさらにその上から癖を足す。
 */
export function resolveAutoplayPolicy(observation: Pick<GameObservation, "runIdentity" | "directive" | "tactics"> & { modifiers?: GameObservation["modifiers"] }): AutoplayPolicyValues {
  const { aiPolicy, tactics, scars } = getGameConfig();
  let policy: AutoplayPolicyValues = { ...aiPolicy.base };
  policy = applyPolicyModifier(policy, aiPolicy.temperaments[observation.runIdentity.temperament]);
  policy = applyPolicyModifier(policy, aiPolicy.directives[observation.directive]);
  for (const tacticId of observation.tactics ?? []) {
    policy = applyPolicyModifier(policy, tactics.definitions[tacticId]);
  }
  for (const scarId of observation.modifiers?.scars ?? []) {
    policy = applyPolicyModifier(policy, scars[scarId]);
  }
  if (realtimeConfig().enabled) {
    for (const lesson of observation.modifiers?.lessons ?? []) {
      if (lesson === "ranged") { policy.coverApproach = true; policy.rangedPriority = true; }
      if (lesson === "care") policy.healBonus += realtimeConfig().ai.lessonHealBonus;
      if (lesson === "traps") { policy.avoidRiskPanels = true; policy.trapPatience += realtimeConfig().ai.lessonTrapPatience; }
    }
  }
  return policy;
}

/** 可視の予告と既知の地形だけで回避・誘導する。隠れた敵や罠は参照しない。 */
function chooseTacticalStep(observation: GameObservation, hpRatio: number, dodgeOnly: boolean): GameAction | null {
  const config = realtimeConfig();
  if (!config.enabled) return null;
  const danger = visibleDangerTiles(observation);
  const threatened = danger.some((p) => samePoint(p, observation.player.pos));
  if (dodgeOnly && (!threatened || hpRatio > config.ai.dodgeHpRatio)) return null;
  if (!dodgeOnly && (hpRatio > config.ai.terrainHpRatio || observation.runTurn - (terrainTurns.get(runScope(observation)) ?? -999) < config.ai.terrainCooldown)) return null;
  const enemies = observation.visibleEntities.filter((e) => e.kind === "monster" && e.hostile);
  if (!threatened && enemies.length < 2) return null;
  const traps = observation.knownEntities.filter((e) => e.kind === "trap");
  const tiles = observation.knownTiles;
  const candidates = directions.flatMap(({ action, delta }) => {
    const p = { x: observation.player.pos.x + delta.x, y: observation.player.pos.y + delta.y };
    if (!isKnownWalkable(observation, p) || danger.some((d) => samePoint(d, p)) || traps.some((t) => samePoint(t.pos, p)) || enemies.some((e) => samePoint(e.pos, p))) return [];
    const adjacent = enemies.filter((e) => distance(e.pos, p) <= 1).length;
    const rangedExposure = enemies.filter((e) => isRangedThreat(e.contentId) && hasKnownLineOfSight(observation, e.pos, p)).length;
    const cover = tiles.filter((t) => distance(t, p) <= 1 && (t.kind === "wall" || t.kind === "cover")).length;
    const lure = traps.some((t) => distance(t.pos, p) === 1 && enemies.some((e) => distance(e.pos, t.pos) === 1 && distance(e.pos, p) >= 2));
    const currentAdjacent = enemies.filter((e) => distance(e.pos, observation.player.pos) <= 1).length;
    if (!dodgeOnly && !lure && !(adjacent < currentAdjacent && cover > 0)) return [];
    return [{ action, lure, cover, score: cover * config.ai.coverWeight + (lure ? config.ai.trapLureWeight : 0) - (adjacent * 2 + rangedExposure) * config.ai.hostileWeight }];
  }).sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) return null;
  tacticalIntents.set(observation, dodgeOnly ? "dodge" : best.lure ? "lure" : "cover");
  if (!dodgeOnly) terrainTurns.set(runScope(observation), observation.runTurn);
  return best.action;
}

function applyPolicyModifier(policy: AutoplayPolicyValues, modifier: PolicyModifier | undefined): AutoplayPolicyValues {
  if (!modifier) return policy;
  const next = { ...policy, ...(modifier.set ?? {}) } as AutoplayPolicyValues;
  for (const [key, value] of Object.entries(modifier.add ?? {})) {
    const numericKey = key as keyof AutoplayPolicyValues;
    if (typeof next[numericKey] === "number" && typeof value === "number") {
      (next as Record<string, number | boolean>)[numericKey] = (next[numericKey] as number) + value;
    }
  }
  return next;
}

/**
 * 射手の隣を目指しつつ、射線に晒されるマスを重く見積もった経路の最初の一歩を返す。
 * 壁や遮蔽の陰を伝って詰め寄るための経路選択。
 */
function stepTowardRangedThreatCovered(observation: GameObservation, target: Point, threats: GameObservation["visibleEntities"]): GameAction | null {
  const start = observation.player.pos;
  const range = getGameConfig().rules.rangedMonsterRange;
  const exposureCost = (point: Point) => threats.some((threat) => distance(threat.pos, point) <= range + 1 && hasKnownLineOfSight(observation, threat.pos, point)) ? 5 : 1;
  const best = new Map<string, number>([[pointKey(start), 0]]);
  const cameFrom = new Map<string, Point | null>([[pointKey(start), null]]);
  const frontier: Array<{ point: Point; cost: number }> = [{ point: start, cost: 0 }];
  while (frontier.length > 0) {
    frontier.sort((a, b) => a.cost - b.cost);
    const current = frontier.shift() as { point: Point; cost: number };
    if (current.cost > (best.get(pointKey(current.point)) ?? Infinity)) continue;
    if (distance(current.point, target) <= 1 && !samePoint(current.point, start)) {
      return actionFromStep(start, firstStepFromPath(cameFrom, start, current.point));
    }
    if (current.cost > 60) continue;
    for (const { delta } of directions) {
      const next = { x: current.point.x + delta.x, y: current.point.y + delta.y };
      if (!isKnownWalkable(observation, next)) continue;
      const cost = current.cost + exposureCost(next);
      const key = pointKey(next);
      if (cost >= (best.get(key) ?? Infinity)) continue;
      best.set(key, cost);
      cameFrom.set(key, current.point);
      frontier.push({ point: next, cost });
    }
  }
  return stepTowardAdjacentTarget(observation, target);
}

function hasKnownLineOfSight(observation: GameObservation, from: Point, to: Point): boolean {
  const index = observationIndex(observation);
  return linePoints(from, to).every((point) => {
    const tile = index.knownTiles.get(pointKey(point));
    return tile && tile.kind !== "wall" && tile.kind !== "cover";
  });
}

function recordPlayerPosition(observation: GameObservation): void {
  const scope = runScope(observation);
  const key = pointKey(observation.player.pos);
  const visitKey = `${scope}:${key}`;
  visitCounts.set(visitKey, (visitCounts.get(visitKey) ?? 0) + 1);
  const recent = recentPositions.get(scope) ?? [];
  recent.push(key);
  recentPositions.set(scope, recent.slice(-RECENT_POSITION_LIMIT));
}

function recordExplorationProgress(observation: GameObservation): { stagnantTurns: number } {
  const scope = runScope(observation);
  const playerKey = pointKey(observation.player.pos);
  const previous = progressMemory.get(scope);
  const knownTiles = observation.knownTiles.length;
  if (!previous || knownTiles > previous.knownTiles) {
    frontierTargets.delete(scope);
  }
  const stagnantTurns = previous && previous.knownTiles >= knownTiles && previous.playerKey === playerKey
    ? previous.stagnantTurns + 1
    : previous && previous.knownTiles >= knownTiles
      ? Math.max(0, previous.stagnantTurns + 1)
      : 0;
  const next = { knownTiles, playerKey, stagnantTurns };
  progressMemory.set(scope, next);
  return next;
}

export function getAutoplayDebugState(observation: GameObservation): AutoplayDebugState {
  const scope = runScope(observation);
  const playerKey = pointKey(observation.player.pos);
  const progress = progressMemory.get(scope);
  return {
    scope,
    recentPositions: [...(recentPositions.get(scope) ?? [])],
    knownTiles: observation.knownTiles.length,
    lastKnownTiles: progress?.knownTiles ?? observation.knownTiles.length,
    stagnantTurns: progress?.stagnantTurns ?? 0,
    visitsAtPlayer: visitCounts.get(`${scope}:${playerKey}`) ?? 0,
    objective: observation.exploration.objective,
    reachableFrontierCount: observation.exploration.reachableFrontierCount,
  };
}

function weaponValue(contentId?: string): number {
  if (!contentId) {
    return 0;
  }
  const equipment = getGameConfig().equipment[contentId];
  return equipment?.slot === "weapon" ? equipment.power : 0;
}

function bestHealingPotion(observation: GameObservation) {
  return [...(observation.player.inventory ?? [])]
    .filter((entry) => healingValue(entry.contentId) > 0 && entry.quantity > 0)
    .sort((a, b) => healingValue(b.contentId) - healingValue(a.contentId))[0];
}

function chooseMerchantService(observation: GameObservation, hpRatio: number, hasDamageCondition: boolean): GameAction | null {
  if (observation.merchantServices.length === 0) {
    return null;
  }

  // 断られる取引を選び続けないよう、商人が今引き受ける取引だけから選ぶ。
  const offers = getGameConfig().merchantOffers
    .filter((offer) => observation.merchantServices.includes(offer.serviceId))
    .filter((offer) => offer.cost <= observation.playerProgress.gold)
    .filter((offer) => {
      if (offer.minFloor !== undefined && observation.floor < offer.minFloor) {
        return false;
      }
      if (offer.maxFloor !== undefined && observation.floor > offer.maxFloor) {
        return false;
      }
      if (offer.floor !== undefined && observation.floor !== offer.floor) {
        return false;
      }
      if (offer.biomes !== undefined && !offer.biomes.includes(observation.biome)) {
        return false;
      }
      return true;
    });

  if (hasDamageCondition && offers.some((offer) => offer.serviceId === "cure")) {
    return { type: "merchantService", serviceId: "cure" };
  }
  if (hpRatio <= 0.72 && offers.some((offer) => offer.serviceId === "heal")) {
    return { type: "merchantService", serviceId: "heal" };
  }
  const currentWeapon = observation.player.inventory?.find((entry) => entry.equipped && weaponValue(entry.contentId) > 0)?.contentId;
  const betterEquipment = offers
    .filter((offer) => offer.serviceId === "equipment" && offer.contentId)
    .some((offer) => weaponValue(offer.contentId) > weaponValue(currentWeapon) || defensiveValue(offer.contentId) > equippedDefensiveValue(observation, offer.contentId));
  if (betterEquipment) {
    return { type: "merchantService", serviceId: "equipment" };
  }
  if (observation.knownTiles.length < observation.width * observation.height * 0.5 && offers.some((offer) => offer.serviceId === "map")) {
    return { type: "merchantService", serviceId: "map" };
  }
  return null;
}

function defensiveValue(contentId?: string): number {
  if (!contentId) {
    return 0;
  }
  const equipment = getGameConfig().equipment[contentId];
  return equipment?.slot === "armor" || equipment?.slot === "shield" ? equipment.power : 0;
}

function equippedDefensiveValue(observation: GameObservation, contentId?: string): number {
  if (!contentId) {
    return 0;
  }
  const slot = getGameConfig().equipment[contentId]?.slot;
  if (slot !== "armor" && slot !== "shield") {
    return 0;
  }
  return observation.player.inventory
    ?.filter((entry) => entry.equipped && getGameConfig().equipment[entry.contentId]?.slot === slot)
    .reduce((sum, entry) => sum + defensiveValue(entry.contentId), 0) ?? 0;
}

function healingValue(contentId: string): number {
  const effect = getGameConfig().consumables[contentId];
  return effect?.heal && !effect.cureConditions ? effect.heal : 0;
}

function isRangedThreat(contentId: string): boolean {
  return getGameConfig().rangedMonsters.includes(contentId);
}

function stepTowardKnownReachable(observation: GameObservation, target: Point, options: PathOptions = {}): GameAction | null {
  for (const path of walkKnownPaths(observation, observation.player.pos, options)) {
    if (samePoint(path.point, target)) return actionFromStep(observation.player.pos, path.firstStep);
  }
  return null;
}

function stepTowardAdjacentTarget(observation: GameObservation, target: Point): GameAction | null {
  const candidates = [...walkKnownPaths(observation)]
    .filter(({ point, distance: pathDistance }) => distance(point, target) <= 1 && pathDistance > 0);
  const neighbor = nearest(candidates.map((path) => ({ ...path, pos: path.point })), observation.player.pos);
  return neighbor ? actionFromStep(observation.player.pos, neighbor.firstStep) : null;
}

function actionFromStep(from: Point, to: Point): GameAction | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const match = directions.find(({ delta }) => delta.x === dx && delta.y === dy);
  return match?.action ?? null;
}

function nearest<T extends { pos?: Point; x?: number; y?: number }>(items: T[], from: Point): T | null {
  let best: T | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const itemDistance = distance(pointOf(item), from);
    if (itemDistance < bestDistance) {
      best = item;
      bestDistance = itemDistance;
    }
  }
  return best;
}

function bestAdjacentExplore(observation: GameObservation, options: PathOptions = {}): GameAction | null {
  const frontierStep = stepTowardReachableFrontier(observation, options);
  if (frontierStep) {
    return frontierStep;
  }

  const candidates = directions
    .map(({ action, delta }) => ({
      action,
      point: { x: observation.player.pos.x + delta.x, y: observation.player.pos.y + delta.y },
    }))
    .filter(({ point }) => isKnownWalkable(observation, point, options));

  return candidates.sort((a, b) => localMoveScore(observation, a.point) - localMoveScore(observation, b.point))[0]?.action ?? null;
}

function escapeOscillationStep(observation: GameObservation, stagnantTurns: number): GameAction | null {
  const recent = recentPositions.get(runScope(observation)) ?? [];
  const tail = recent.slice(-RECENT_POSITION_LIMIT);
  if (tail.length < 8 || !isLoopingTail(tail, stagnantTurns)) {
    return null;
  }

  const repeatedKeys = repeatedPositionKeys(tail);
  const candidates = directions
    .map(({ action, delta }) => ({
      action,
      point: { x: observation.player.pos.x + delta.x, y: observation.player.pos.y + delta.y },
    }))
    .filter(({ point }) => isKnownWalkable(observation, point));

  const unvisitedCandidate = candidates
    .filter(({ point }) => !repeatedKeys.has(pointKey(point)))
    .sort((a, b) => escapeMoveScore(observation, a.point) - escapeMoveScore(observation, b.point))[0];
  if (unvisitedCandidate) {
    return unvisitedCandidate.action;
  }

  return candidates.sort((a, b) => escapeMoveScore(observation, a.point) - escapeMoveScore(observation, b.point))[0]?.action ?? null;
}

function avoidImmediateOscillation(observation: GameObservation, action: GameAction, stagnantTurns: number): GameAction {
  if (action.type !== "move" || stagnantTurns < LOOP_ESCAPE_TURNS) {
    return action;
  }

  const recent = recentPositions.get(runScope(observation)) ?? [];
  const tail = recent.slice(-RECENT_POSITION_LIMIT);
  if (tail.length < 8 || !isLoopingTail(tail, stagnantTurns)) {
    return action;
  }

  const direction = directions.find((candidate) => candidate.action.type === "move" && candidate.action.direction === action.direction);
  if (!direction) {
    return action;
  }

  const destination = {
    x: observation.player.pos.x + direction.delta.x,
    y: observation.player.pos.y + direction.delta.y,
  };
  const lockedTarget = frontierTargets.get(runScope(observation));
  if (lockedTarget) {
    const currentDistance = pathDistanceFrom(observation, observation.player.pos, lockedTarget, { allowHostileBlockers: true });
    const nextDistance = pathDistanceFrom(observation, destination, lockedTarget, { allowHostileBlockers: true });
    if (currentDistance !== null && nextDistance !== null && nextDistance < currentDistance) {
      return action;
    }
  }

  const repeatedKeys = repeatedPositionKeys(tail);
  if (!repeatedKeys.has(pointKey(destination))) {
    return action;
  }

  const alternative = directions
    .map(({ action, delta }) => ({
      action,
      point: { x: observation.player.pos.x + delta.x, y: observation.player.pos.y + delta.y },
    }))
    .filter(({ point }) => isKnownWalkable(observation, point) && !repeatedKeys.has(pointKey(point)))
    .sort((a, b) => escapeMoveScore(observation, a.point) - escapeMoveScore(observation, b.point))[0];

  return alternative?.action ?? action;
}

function stepTowardCurrentObjective(observation: GameObservation, allowRiskyTraversal: boolean, stagnantTurns: number, hp: number): GameAction | null {
  const reachableStairs = observation.exploration.reachableStairs;
  // 地図を埋めたあと守り手が視界外にいる場合も、既知の階段へ戻って探す。
  // 敵の実座標は使わず、探索者が発見した出口だけを手掛かりにする。
  if (realtimeConfig().enabled && observation.bossAlive && reachableStairs && observation.exploration.reachableFrontierCount === 0 && !samePoint(observation.player.pos, reachableStairs)) {
    const towardGate = stepTowardKnownReachable(observation, reachableStairs, { allowHostileBlockers: true })
      ?? (allowRiskyTraversal ? stepTowardKnownReachable(observation, reachableStairs, { avoidTraps: false, allowHostileBlockers: true }) : null);
    if (towardGate) return towardGate;
  }
  if (reachableStairs && !observation.bossAlive) {
    return stepTowardKnownReachableWeighted(observation, reachableStairs, { allowHostileBlockers: true }) ?? (allowRiskyTraversal ? stepTowardKnownReachableWeighted(observation, reachableStairs, { avoidTraps: false, allowHostileBlockers: true }) : null);
  }

  if (observation.exploration.knownStairs && !observation.bossAlive && allowRiskyTraversal) {
    const riskyStairsStep = stepTowardKnownReachableWeighted(observation, observation.exploration.knownStairs, { avoidTraps: false, allowHostileBlockers: true });
    if (riskyStairsStep) {
      return riskyStairsStep;
    }
  }

  if (stagnantTurns >= 80) {
    const lockedFrontierStep = stepTowardLockedFrontier(observation, { allowHostileBlockers: true });
    if (lockedFrontierStep) {
      return lockedFrontierStep;
    }

    if (stagnantTurns >= 120 && hasRecentLoop(observation, stagnantTurns)) {
      frontierTargets.delete(runScope(observation));
      const relocationStep = stepTowardDistantKnownArea(observation, { allowHostileBlockers: true }) ?? (allowRiskyTraversal ? stepTowardDistantKnownArea(observation, { avoidTraps: false, allowHostileBlockers: true }) : null);
      if (relocationStep) {
        return relocationStep;
      }
    }

    const riskPanelStep = stepTowardKnownRiskPanel(observation, hp);
    if (riskPanelStep) {
      return riskPanelStep;
    }

    const unseenStep = stepTowardNearestUnseen(observation, { allowHostileBlockers: true }) ?? (allowRiskyTraversal ? stepTowardNearestUnseen(observation, { avoidTraps: false, allowHostileBlockers: true }) : null);
    if (unseenStep) {
      return unseenStep;
    }
  }

  const frontierStep = stepTowardReachableFrontier(observation, { allowHostileBlockers: true }) ?? (allowRiskyTraversal ? stepTowardReachableFrontier(observation, { avoidTraps: false, allowHostileBlockers: true }) : null);
  if (frontierStep) {
    return frontierStep;
  }

  if (observation.exploration.objective !== "findStairs") {
    const knownEvent = nearest(
      observation.knownEntities.filter((entity) => entity.kind === "event" && entity.contentId !== "event.wayfarer-merchant" && !samePoint(entity.pos, observation.player.pos)),
      observation.player.pos,
    );
    if (knownEvent) {
      const eventStep = stepTowardKnownReachableWeighted(observation, knownEvent.pos) ?? (allowRiskyTraversal ? stepTowardKnownReachableWeighted(observation, knownEvent.pos, { avoidTraps: false }) : null);
      if (eventStep) {
        return eventStep;
      }
    }
  }

  return stepTowardDistantKnownArea(observation, { allowHostileBlockers: true }) ?? (allowRiskyTraversal ? stepTowardDistantKnownArea(observation, { avoidTraps: false, allowHostileBlockers: true }) : null);
}

function stepTowardLockedFrontier(observation: GameObservation, options: PathOptions = {}): GameAction | null {
  const scope = runScope(observation);
  const locked = frontierTargets.get(scope);
  if (
    locked &&
    hasUnseenNeighbor(observation, locked) &&
    !isStaleFrontier(observation, locked) &&
    pathDistanceFrom(observation, observation.player.pos, locked, options) !== null
  ) {
    return stepTowardKnownReachableWeighted(observation, locked, options);
  }
  frontierTargets.delete(scope);

  const candidates = observation.exploration.reachableFrontiers
    .map((frontier) => ({
      point: { x: frontier.x, y: frontier.y },
      pathDistance: pathDistanceFrom(observation, observation.player.pos, frontier, options),
    }))
    .filter((candidate): candidate is { point: Point; pathDistance: number } => candidate.pathDistance !== null && hasUnseenNeighbor(observation, candidate.point));

  const nonStale = candidates.filter(({ point }) => !isStaleFrontier(observation, point));
  const target = nonStale.sort((a, b) => lockedFrontierScore(observation, a) - lockedFrontierScore(observation, b))[0]?.point;
  if (!target) {
    frontierTargets.delete(scope);
    return null;
  }

  frontierTargets.set(scope, target);
  return stepTowardKnownReachableWeighted(observation, target, options);
}

function lockedFrontierScore(observation: GameObservation, candidate: { point: Point; pathDistance: number }): number {
  return visitScore(observation, candidate.point) * 5000 + recentVisitScore(observation, candidate.point) * 1000 + candidate.pathDistance;
}

function stepTowardKnownRiskPanel(observation: GameObservation, hp: number): GameAction | null {
  const estimatedWorstHit = 6 + Math.floor(observation.floor / 2);
  if (hp <= estimatedWorstHit + 1) {
    return null;
  }
  const panel = nearest(
    observation.knownEntities.filter((entity) => entity.kind === "trap" && entity.contentId === "trap.risk-panel"),
    observation.player.pos,
  );
  if (!panel) {
    return null;
  }
  if (distance(panel.pos, observation.player.pos) === 1) {
    return actionFromStep(observation.player.pos, panel.pos);
  }
  return stepTowardKnownReachableWeighted(observation, panel.pos, { avoidTraps: false });
}

function stepTowardKnownSurvivalPickup(observation: GameObservation, hpRatio: number, stagnantTurns: number, allowRiskyTraversal: boolean): GameAction | null {
  const needsRecovery = hpRatio <= 0.45;
  if (!needsRecovery && stagnantTurns < STAGNANT_EXPLORATION_TURNS) {
    return null;
  }

  const candidates = observation.knownEntities
    .filter((entity) => entity.kind === "item" && !samePoint(entity.pos, observation.player.pos) && isSurvivalPickup(entity.contentId) && canCarry(observation, entity.contentId))
    .map((entity): KnownSurvivalPickupCandidate | null => {
      const safeDistance = pathDistanceFrom(observation, observation.player.pos, entity.pos, { allowHostileBlockers: true });
      const riskyDistance = safeDistance === null && allowRiskyTraversal
        ? pathDistanceFrom(observation, observation.player.pos, entity.pos, { avoidTraps: false, allowHostileBlockers: true })
        : null;
      const pathDistance = safeDistance ?? riskyDistance;
      if (pathDistance === null) {
        return null;
      }
      return {
        entity,
        options: safeDistance === null ? { avoidTraps: false, allowHostileBlockers: true } : { allowHostileBlockers: true },
        score: pathDistance * 1000 - survivalPickupValue(entity.contentId, needsRecovery) * 80,
      };
    })
    .filter((candidate): candidate is KnownSurvivalPickupCandidate => candidate !== null)
    .sort((a, b) => a.score - b.score);

  const target = candidates[0];
  if (!target) {
    return null;
  }
  return stepTowardKnownReachableWeighted(observation, target.entity.pos, target.options);
}

function stepTowardKnownReachableWeighted(observation: GameObservation, target: Point, options: PathOptions = {}): GameAction | null {
  const candidates = directions
    .map(({ action, delta }) => ({
      action,
      point: { x: observation.player.pos.x + delta.x, y: observation.player.pos.y + delta.y },
    }))
    .filter(({ point }) => isKnownWalkable(observation, point, options))
    .map((candidate) => ({
      ...candidate,
      pathDistance: pathDistanceFrom(observation, candidate.point, target, options),
    }))
    .filter((candidate) => candidate.pathDistance !== null);

  const minimumDistance = Math.min(...candidates.map((candidate) => candidate.pathDistance ?? Number.POSITIVE_INFINITY));
  return candidates
    .filter((candidate) => candidate.pathDistance === minimumDistance)
    .sort((a, b) => localMoveScore(observation, a.point) - localMoveScore(observation, b.point))[0]?.action ?? null;
}

function pathDistanceFrom(observation: GameObservation, from: Point, target: Point, options: PathOptions = {}): number | null {
  for (const path of walkKnownPaths(observation, from, options)) {
    if (samePoint(path.point, target)) return path.distance;
  }
  return null;
}

function stepOntoAdjacentKnownTrap(observation: GameObservation): GameAction | null {
  for (const { action, delta } of directions) {
    const point = { x: observation.player.pos.x + delta.x, y: observation.player.pos.y + delta.y };
    const tile = observation.knownTiles.find((candidate) => candidate.x === point.x && candidate.y === point.y);
    if (!tile || !isWalkable(tile.kind)) {
      continue;
    }
    const trap = observation.knownEntities.find((entity) => entity.kind === "trap" && entity.pos.x === point.x && entity.pos.y === point.y);
    if (trap && !isVisibleBlockerAt(observation, point)) {
      return action;
    }
  }
  return null;
}

function stepTowardReachableFrontier(observation: GameObservation, options: PathOptions = {}): GameAction | null {
  const start = observation.player.pos;
  const reachableFrontiers: Array<{ target: Point; firstStep: Point; action: GameAction; pathDistance: number }> = [];
  for (const path of walkKnownPaths(observation, start, options)) {
    if (path.distance > 0 && hasUnseenNeighbor(observation, path.point) && !isStaleFrontier(observation, path.point)) {
      const action = actionFromStep(start, path.firstStep);
      if (action) reachableFrontiers.push({ target: path.point, firstStep: path.firstStep, action, pathDistance: path.distance });
    }
  }

  const bestRoute = reachableFrontiers.sort((a, b) => routeScore(observation, a) - routeScore(observation, b))[0];
  if (bestRoute) {
    return bestRoute.action;
  }

  for (const frontier of observation.exploration.reachableFrontiers.filter((point) => !isStaleFrontier(observation, point))) {
    const action = stepTowardKnownReachableWeighted(observation, frontier, options);
    if (action) {
      return action;
    }
  }
  return null;
}

function stepTowardNearestUnseen(observation: GameObservation, options: PathOptions = {}): GameAction | null {
  for (const path of walkKnownPaths(observation, observation.player.pos, options)) {
    if (path.distance > 0 && hasUnseenNeighbor(observation, path.point) && !isStaleFrontier(observation, path.point)) {
      return actionFromStep(observation.player.pos, path.firstStep);
    }
  }
  return null;
}

function stepTowardDistantKnownArea(observation: GameObservation, options: PathOptions = {}): GameAction | null {
  const paths = [...walkKnownPaths(observation, observation.player.pos, options)]
    .filter(({ point }) => distance(point, observation.player.pos) >= 6)
    .sort((a, b) => distantAreaScore(observation, a.point) - distantAreaScore(observation, b.point));
  return paths[0] ? actionFromStep(observation.player.pos, paths[0].firstStep) : null;
}

function frontierScore(observation: GameObservation, point: Point): number {
  return distance(point, observation.player.pos) + visitScore(observation, point) * VISIT_PENALTY + recentVisitScore(observation, point) * RECENT_POSITION_PENALTY;
}

function routeScore(observation: GameObservation, route: { target: Point; firstStep: Point; pathDistance: number }): number {
  const progress = progressMemory.get(runScope(observation));
  const localWeight = progress && progress.stagnantTurns >= LOOP_ESCAPE_TURNS ? 0.25 : 1;
  return route.pathDistance * 1000 + frontierScore(observation, route.target) + localMoveScore(observation, route.firstStep) * localWeight;
}

function isStaleFrontier(observation: GameObservation, point: Point): boolean {
  const progress = progressMemory.get(runScope(observation));
  if (!progress || progress.stagnantTurns < LOOP_ESCAPE_TURNS) {
    return false;
  }
  return visitScore(observation, point) >= 3;
}

function firstStepFromPath(cameFrom: Map<string, Point | null>, start: Point, target: Point): Point {
  let step = target;
  while (cameFrom.get(pointKey(step)) && pointKey(cameFrom.get(pointKey(step)) as Point) !== pointKey(start)) {
    step = cameFrom.get(pointKey(step)) as Point;
  }
  return step;
}

function isLoopingTail(tail: string[], stagnantTurns: number): boolean {
  const unique = new Set(tail);
  if (unique.size <= 2) {
    return true;
  }
  if (stagnantTurns < LOOP_ESCAPE_TURNS || unique.size > LOOP_ESCAPE_UNIQUE_LIMIT) {
    return false;
  }
  const counts = [...countPositions(tail).values()].sort((a, b) => b - a);
  return (counts[0] ?? 0) + (counts[1] ?? 0) >= tail.length - 2;
}

function hasRecentLoop(observation: GameObservation, stagnantTurns: number): boolean {
  const recent = recentPositions.get(runScope(observation)) ?? [];
  const tail = recent.slice(-RECENT_POSITION_LIMIT);
  return tail.length >= 8 && isLoopingTail(tail, stagnantTurns);
}

function repeatedPositionKeys(tail: string[]): Set<string> {
  const counts = countPositions(tail);
  return new Set([...counts].filter(([, count]) => count >= 2).map(([key]) => key));
}

function countPositions(keys: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function escapeMoveScore(observation: GameObservation, point: Point): number {
  const frontierBonus = hasUnseenNeighbor(observation, point) ? -240 : 0;
  return localMoveScore(observation, point) + frontierBonus;
}

function distantAreaScore(observation: GameObservation, point: Point): number {
  const frontierBonus = hasUnseenNeighbor(observation, point) ? -180 : 0;
  const distanceBonus = -distance(point, observation.player.pos) * 8;
  return visitScore(observation, point) * VISIT_PENALTY + recentVisitScore(observation, point) * RECENT_POSITION_PENALTY + frontierBonus + distanceBonus;
}

function visitScore(observation: GameObservation, point: Point): number {
  const key = `${runScope(observation)}:${pointKey(point)}`;
  return visitCounts.get(key) ?? 0;
}

function recentVisitScore(observation: GameObservation, point: Point): number {
  const recent = recentPositions.get(runScope(observation)) ?? [];
  const key = pointKey(point);
  return recent.reduce((score, visitedKey, index) => {
    if (visitedKey !== key) {
      return score;
    }
    return score + index + 1;
  }, 0);
}

function pointOf(item: { pos?: Point; x?: number; y?: number }): Point {
  return item.pos ?? { x: item.x ?? 0, y: item.y ?? 0 };
}

function isSurvivalPickup(contentId: string): boolean {
  const consumable = getGameConfig().consumables[contentId];
  return !!consumable && (!!consumable.heal || !!consumable.cureConditions || !!consumable.guardedTurns || !!consumable.pushVisibleMonsters);
}

function isAutoplayTargetEntity(entity: GameObservation["knownEntities"][number], observation: GameObservation): boolean {
  if (entity.kind === "item") return canCarry(observation, entity.contentId);
  return entity.kind === "event" && entity.contentId !== "event.wayfarer-merchant";
}

/** 所持枠が埋まっていて拾えない品へは向かわない（拾得失敗の無限ループ防止）。 */
function canCarry(observation: GameObservation, contentId: string): boolean {
  if (contentId === "item.coin-pouch" || contentId === "item.mapping-scroll" || contentId === "item.glim-map") return true;
  const inventory = observation.player.inventory ?? [];
  return inventory.some((entry) => entry.contentId === contentId) || inventory.length < getGameConfig().rules.inventorySlotLimit;
}

function survivalPickupValue(contentId: string, needsRecovery: boolean): number {
  const consumable = getGameConfig().consumables[contentId];
  if (!consumable) {
    return 0;
  }
  const heal = consumable.heal ?? 0;
  const cure = consumable.cureConditions ? 10 : 0;
  const guard = consumable.guardedTurns ? Math.min(18, consumable.guardedTurns) : 0;
  const push = consumable.pushVisibleMonsters ? 6 : 0;
  return heal * (needsRecovery ? 2 : 1) + cure + guard + push;
}

function stepOntoAdjacentRiskPanel(observation: GameObservation, hp: number, hpRatio: number, stagnantTurns: number, combatPressure: boolean): GameAction | null {
  if (combatPressure) {
    return null;
  }
  const needsSwing = hpRatio <= 0.45 || stagnantTurns >= STAGNANT_EXPLORATION_TURNS;
  if (!needsSwing) {
    return null;
  }
  const estimatedWorstHit = 6 + Math.floor(observation.floor / 2);
  if (hp <= estimatedWorstHit + 1) {
    return null;
  }
  const panel = observation.knownEntities.find((entity) => entity.kind === "trap" && distance(entity.pos, observation.player.pos) === 1);
  if (!panel) {
    return null;
  }
  return actionFromStep(observation.player.pos, panel.pos);
}

function hasUnseenNeighbor(observation: GameObservation, pos: Point): boolean {
  const index = observationIndex(observation);
  // 未探索の境目は縦横で判定する（core の countUnseenNeighbors と揃える）。
  return cardinalDirections.some(({ delta }) => {
    const neighbor = { x: pos.x + delta.x, y: pos.y + delta.y };
    if (neighbor.x < 0 || neighbor.y < 0 || neighbor.x >= observation.width || neighbor.y >= observation.height) {
      return false;
    }
    return !index.knownTiles.has(pointKey(neighbor));
  });
}

/** 8方向移動での歩数。 */
function localMoveScore(observation: GameObservation, point: Point): number {
  return visitScore(observation, point) * VISIT_PENALTY + recentVisitScore(observation, point) * RECENT_POSITION_PENALTY + distance(point, observation.player.pos);
}

function runScope(observation: GameObservation): string {
  return `${observation.seed}:${observation.floor}`;
}

function directionFromDelta(dx: number, dy: number): Direction {
  if (dx < 0 && dy < 0) {
    return "northwest";
  }
  if (dx > 0 && dy < 0) {
    return "northeast";
  }
  if (dx < 0 && dy > 0) {
    return "southwest";
  }
  if (dx > 0 && dy > 0) {
    return "southeast";
  }
  if (dx < 0) {
    return "west";
  }
  if (dx > 0) {
    return "east";
  }
  return dy < 0 ? "north" : "south";
}

export type AutoplayIntent = {
  text: string;
  tone: "combat" | "survival" | "loot" | "explore" | "descend";
  topic?: string;
};

/**
 * 観戦者向けに、選んだ行動を短い意図として言語化する。
 * 判断そのものには使わず、吹き出しやログ表示に使う。
 */
export function describeAutoplayIntent(observation: GameObservation, action: GameAction): AutoplayIntent | null {
  const tactical = tacticalIntents.get(observation);
  if (tactical === "dodge") return { text: "構えの外へ抜ける", tone: "survival", topic: "dodge" };
  if (tactical === "lure") return { text: "罠の向こうへ誘い込む", tone: "combat", topic: "lure" };
  if (tactical === "cover") return { text: "狭い道へ引きつける", tone: "survival", topic: "cover" };
  if (tactical === "opening") return { text: "今なら踏み込める", tone: "combat", topic: "opening" };
  const player = observation.player;
  const hpRatio = (player.stats?.hp ?? 1) / (player.stats?.maxHp ?? 1);
  if (action.type === "useItem") {
    const consumable = getGameConfig().consumables[action.contentId];
    const name = contentEntities[action.contentId]?.name ?? "道具";
    if (consumable?.heal || consumable?.cureConditions) return { text: `${name}で立て直す`, tone: "survival" };
    if (consumable?.rangedDamage) return { text: `${name}を投げる`, tone: "combat" };
    return { text: `${name}を使う`, tone: consumable?.guardedTurns || consumable?.pushVisibleMonsters ? "survival" : "explore" };
  }
  if (action.type === "pickup") return { text: "拾っておこう", tone: "loot" };
  if (action.type === "equip") return { text: `${contentEntities[action.contentId]?.name ?? "装備"}に持ち替える`, tone: "loot" };
  if (action.type === "merchantService") return { text: "商人と取引する", tone: "loot" };
  if (action.type === "descend") return { text: "下へ降りる", tone: "descend" };
  if (action.type !== "move") return null;

  const delta = directionDelta(action.direction);
  const destination = { x: player.pos.x + delta.x, y: player.pos.y + delta.y };
  const hostiles = observation.visibleEntities.filter((entity) => entity.kind === "monster" && entity.hostile);
  const target = hostiles.find((entity) => samePoint(entity.pos, destination));
  if (target) {
    const boss = contentEntities[target.contentId]?.tier === "boss";
    return { text: boss ? "守り手に挑む" : hpRatio <= 0.35 ? "押し切るしかない" : "斬りかかる", tone: "combat" };
  }
  const rangedThreat = hostiles.find((entity) => isRangedThreat(entity.contentId) && distance(entity.pos, player.pos) <= 6);
  if (rangedThreat) {
    const closing = distance(destination, rangedThreat.pos) < distance(player.pos, rangedThreat.pos);
    return closing ? { text: "射手へ詰め寄る", tone: "combat" } : { text: "射線から外れる", tone: "survival" };
  }
  const boss = hostiles.find((entity) => contentEntities[entity.contentId]?.tier === "boss");
  if (boss) return { text: "守り手へ向かう", tone: "combat" };
  if (hostiles.some((entity) => distance(entity.pos, player.pos) <= 4)) return { text: "敵へ向き直る", tone: "combat" };
  const itemAhead = observation.visibleEntities.find((entity) => entity.kind === "item" && canCarry(observation, entity.contentId) && distance(entity.pos, destination) < distance(entity.pos, player.pos));
  if (itemAhead) return { text: "何か落ちている", tone: "loot" };
  if (observation.exploration.reachableStairs && !observation.bossAlive) return { text: "階段へ急ぐ", tone: "descend" };
  return null;
}

function directionDelta(direction: Direction): Point {
  const match = directions.find((entry) => entry.action.type === "move" && entry.action.direction === direction);
  if (match) return match.delta;
  return {
    x: direction.includes("west") ? -1 : direction.includes("east") ? 1 : 0,
    y: direction.includes("north") ? -1 : direction.includes("south") ? 1 : 0,
  };
}
