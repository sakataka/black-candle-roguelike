import { getGameConfig } from "../content/config";
import { contentEntities } from "../content/entities";
import type { Direction, GameAction, GameObservation, Point } from "../types";

const directions: Array<{ action: GameAction; delta: Point }> = [
  { action: { type: "move", direction: "north" }, delta: { x: 0, y: -1 } },
  { action: { type: "move", direction: "south" }, delta: { x: 0, y: 1 } },
  { action: { type: "move", direction: "west" }, delta: { x: -1, y: 0 } },
  { action: { type: "move", direction: "east" }, delta: { x: 1, y: 0 } },
];

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

type PathOptions = {
  avoidTraps?: boolean;
  allowHostileBlockers?: boolean;
};

type KnownSurvivalPickupCandidate = {
  entity: GameObservation["knownEntities"][number];
  options: PathOptions;
  score: number;
};

type ObservationIndex = {
  knownTiles: Map<string, GameObservation["knownTiles"][number]>;
  knownTraps: Set<string>;
  visibleBlockers: Set<string>;
  visibleNonHostileBlockers: Set<string>;
};

const observationIndexes = new WeakMap<GameObservation, ObservationIndex>();

export function resetAutoplayState(): void {
  visitCounts.clear();
  recentPositions.clear();
  progressMemory.clear();
  frontierTargets.clear();
}

export function chooseAutoplayAction(observation: GameObservation): GameAction {
  recordPlayerPosition(observation);
  const progress = recordExplorationProgress(observation);
  const knownEntities = observation.knownEntities;

  const hp = observation.player.stats?.hp ?? 1;
  const maxHp = observation.player.stats?.maxHp ?? 1;
  const hpRatio = hp / maxHp;
  const policy = autoplayPolicy(observation);
  const allowRiskyTraversal = progress.stagnantTurns >= LOOP_ESCAPE_TURNS && hpRatio > policy.riskyTraversalHp;
  const visibleHostiles = observation.visibleEntities.filter((entity) => entity.kind === "monster" && entity.hostile);
  const visibleRangedThreats = visibleHostiles.filter((entity) => isRangedThreat(entity.contentId) && distance(entity.pos, observation.player.pos) <= 6);
  const visibleRangedThreat = nearest(visibleRangedThreats, observation.player.pos);
  const nearbyEnemies = visibleHostiles.filter((entity) => distance(entity.pos, observation.player.pos) <= 3);
  const combatPressure = nearbyEnemies.length > 0 || !!visibleRangedThreat;
  const urgentRangedPressure = visibleRangedThreats.length >= 2 || (visibleRangedThreats.length >= 1 && hpRatio <= 0.35);
  const hasDamageCondition = observation.player.conditions?.some((condition) => condition.kind === "bleeding" || condition.kind === "venomed") ?? false;
  const salve = observation.player.inventory?.find((entry) => entry.contentId === "item.bloodmoss-salve" && entry.quantity > 0);
  if (salve && (hasDamageCondition || hpRatio <= (combatPressure ? 0.35 : 0.25) + policy.healBonus)) {
    return { type: "useItem", contentId: "item.bloodmoss-salve" };
  }
  const graveSunCharm = observation.player.inventory?.find((entry) => entry.contentId === "item.grave-sun-charm" && entry.quantity > 0);
  if (graveSunCharm && (hasDamageCondition || hpRatio <= (combatPressure ? 0.7 : 0.55) + policy.healBonus)) {
    return { type: "useItem", contentId: "item.grave-sun-charm" };
  }

  const potion = bestHealingPotion(observation);
  if (potion && hpRatio <= (combatPressure ? 0.65 : 0.5) + policy.healBonus) {
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
  if (itemHere?.kind === "item") {
    if (!combatPressure || hpRatio > 0.35 || isSurvivalPickup(itemHere.contentId)) {
      return { type: "pickup" };
    }
  }

  const onStairs = observation.visibleTiles.find(
    (tile) => tile.kind === "stairsDown" && tile.x === observation.player.pos.x && tile.y === observation.player.pos.y,
  );
  if (onStairs && !observation.bossAlive) {
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
    return { type: "move", direction: directionFromDelta(adjacentEnemy.pos.x - observation.player.pos.x, adjacentEnemy.pos.y - observation.player.pos.y) };
  }

  const visibleBoss = nearest(
    observation.visibleEntities.filter((entity) => entity.kind === "monster" && entity.hostile && contentEntities[entity.contentId]?.tier === "boss"),
    observation.player.pos,
  );
  if (visibleBoss && hpRatio > (policy.conquest ? 0.38 : 0.5)) {
    const bossStep = stepTowardAdjacentTarget(observation, visibleBoss.pos);
    if (bossStep) {
      return bossStep;
    }
  }

  const dart = observation.player.inventory?.find((entry) => entry.contentId === "item.ember-dart" && entry.quantity > 0);
  const rangedTarget = nearest(
    observation.visibleEntities.filter((entity) => entity.kind === "monster" && entity.hostile && distance(entity.pos, observation.player.pos) <= 5),
    observation.player.pos,
  );
  if (dart && rangedTarget && hpRatio > 0.35) {
    return { type: "useItem", contentId: "item.ember-dart" };
  }


  if (observation.runTurn >= 1000 && !urgentRangedPressure) {
    const urgentObjectiveStep = stepTowardCurrentObjective(observation, allowRiskyTraversal, Math.max(progress.stagnantTurns, LOOP_ESCAPE_TURNS), hp);
    if (urgentObjectiveStep) {
      return urgentObjectiveStep;
    }
  }

  const weakEnemy = nearest(
    observation.visibleEntities.filter((entity) => entity.kind === "monster" && entity.hostile && (contentEntities[entity.contentId]?.danger ?? 99) <= 4),
    observation.player.pos,
  );
  if (weakEnemy && hpRatio > policy.combatHp && policy.conquest && progress.stagnantTurns < LOOP_ESCAPE_TURNS) {
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

  const riskPanelStep = stepOntoAdjacentRiskPanel(observation, hp, hpRatio, progress.stagnantTurns, combatPressure);
  if (riskPanelStep) {
    return riskPanelStep;
  }

  const survivalPickupStep = progress.stagnantTurns < 80
    ? stepTowardKnownSurvivalPickup(observation, hpRatio, progress.stagnantTurns, allowRiskyTraversal)
    : null;
  if (survivalPickupStep) {
    return survivalPickupStep;
  }

  if (policy.discovery && !combatPressure) {
    const discoveryTarget = nearest(
      observation.visibleEntities.filter((entity) => isAutoplayTargetEntity(entity)),
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

  if (visibleRangedThreat && hpRatio > 0.25) {
    const shouldChaseRangedThreat = progress.stagnantTurns < LOOP_ESCAPE_TURNS || hpRatio <= 0.5;
    if (shouldChaseRangedThreat) {
      const rangedStep = stepTowardAdjacentTarget(observation, visibleRangedThreat.pos);
      if (rangedStep) {
        return rangedStep;
      }
    }
  }

  const knownStairs = observation.exploration.reachableStairs;
  if (knownStairs && !observation.bossAlive) {
    const stairsStep = stepTowardKnownReachable(observation, knownStairs, { allowHostileBlockers: true }) ?? (allowRiskyTraversal ? stepTowardKnownReachable(observation, knownStairs, { avoidTraps: false, allowHostileBlockers: true }) : null);
    if (stairsStep) {
      return stairsStep;
    }
  }

  const visibleItem = nearest(
    observation.visibleEntities.filter((entity) => isAutoplayTargetEntity(entity)),
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

function autoplayPolicy(observation: GameObservation): {
  healBonus: number;
  riskyTraversalHp: number;
  combatHp: number;
  discovery: boolean;
  conquest: boolean;
} {
  const cautious = observation.runIdentity.temperament === "cautious";
  const seeker = observation.runIdentity.temperament === "seeker";
  const bold = observation.runIdentity.temperament === "bold";
  const survival = observation.directive === "survival";
  const discovery = observation.directive === "discovery";
  const conquest = observation.directive === "conquest";
  return {
    healBonus: (cautious ? 0.06 : bold ? -0.04 : 0) + (survival ? 0.08 : conquest ? -0.04 : 0),
    riskyTraversalHp: survival ? 0.58 : cautious ? 0.48 : conquest || bold ? 0.28 : 0.38,
    combatHp: survival ? 0.68 : conquest ? 0.42 : bold ? 0.48 : 0.56,
    discovery: discovery || seeker,
    conquest: conquest || bold,
  };
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
  const onMerchant = observation.knownEntities.some(
    (entity) => entity.kind === "event" && entity.contentId === "event.wayfarer-merchant" && samePoint(entity.pos, observation.player.pos),
  );
  if (!onMerchant) {
    return null;
  }

  const offers = getGameConfig().merchantOffers
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
  const start = observation.player.pos;
  const queue: Point[] = [start];
  const cameFrom = new Map<string, Point | null>([[pointKey(start), null]]);
  const targetKey = pointKey(target);

  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor];
    cursor += 1;
    if (pointKey(current) === targetKey) {
      break;
    }
    for (const { delta } of directions) {
      const next = { x: current.x + delta.x, y: current.y + delta.y };
      const key = pointKey(next);
      if (cameFrom.has(key) || !isKnownWalkable(observation, next, options)) {
        continue;
      }
      cameFrom.set(key, current);
      queue.push(next);
    }
  }

  if (!cameFrom.has(targetKey)) {
    return null;
  }

  let step = target;
  while (cameFrom.get(pointKey(step)) && pointKey(cameFrom.get(pointKey(step)) as Point) !== pointKey(start)) {
    step = cameFrom.get(pointKey(step)) as Point;
  }
  return actionFromStep(start, step);
}

function stepTowardAdjacentTarget(observation: GameObservation, target: Point): GameAction | null {
  const start = observation.player.pos;
  const queue: Point[] = [start];
  const cameFrom = new Map<string, Point | null>([[pointKey(start), null]]);
  const candidates: Point[] = [];

  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor];
    cursor += 1;
    if (distance(current, target) <= 1 && distance(current, start) > 0) {
      candidates.push(current);
    }
    for (const { delta } of directions) {
      const next = { x: current.x + delta.x, y: current.y + delta.y };
      const key = pointKey(next);
      if (cameFrom.has(key) || !isKnownWalkable(observation, next)) {
        continue;
      }
      cameFrom.set(key, current);
      queue.push(next);
    }
  }

  const targetNeighbor = nearest(candidates, start);
  if (!targetNeighbor) {
    return null;
  }

  let step = targetNeighbor;
  while (cameFrom.get(pointKey(step)) && pointKey(cameFrom.get(pointKey(step)) as Point) !== pointKey(start)) {
    step = cameFrom.get(pointKey(step)) as Point;
  }
  return actionFromStep(start, step);
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
    .filter((entity) => entity.kind === "item" && !samePoint(entity.pos, observation.player.pos) && isSurvivalPickup(entity.contentId))
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
  if (samePoint(from, target)) {
    return 0;
  }

  const queue: Array<Point & { distance: number }> = [{ ...from, distance: 0 }];
  const seen = new Set<string>([pointKey(from)]);
  const targetKey = pointKey(target);

  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor];
    cursor += 1;
    for (const { delta } of directions) {
      const next = { x: current.x + delta.x, y: current.y + delta.y };
      const key = pointKey(next);
      if (seen.has(key) || !isKnownWalkable(observation, next, options)) {
        continue;
      }
      if (key === targetKey) {
        return current.distance + 1;
      }
      seen.add(key);
      queue.push({ ...next, distance: current.distance + 1 });
    }
  }

  return null;
}

function stepOntoAdjacentKnownTrap(observation: GameObservation): GameAction | null {
  for (const { action, delta } of directions) {
    const point = { x: observation.player.pos.x + delta.x, y: observation.player.pos.y + delta.y };
    const tile = observation.knownTiles.find((candidate) => candidate.x === point.x && candidate.y === point.y);
    if (!tile || !isWalkableTileKind(tile.kind)) {
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
  const queue: Array<Point & { pathDistance: number }> = [{ ...start, pathDistance: 0 }];
  const cameFrom = new Map<string, Point | null>([[pointKey(start), null]]);
  const reachableFrontiers: Array<{ target: Point; firstStep: Point; action: GameAction; pathDistance: number }> = [];

  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor];
    cursor += 1;
    if (distance(current, start) > 0 && hasUnseenNeighbor(observation, current) && !isStaleFrontier(observation, current)) {
      const firstStep = firstStepFromPath(cameFrom, start, current);
      const action = actionFromStep(start, firstStep);
      if (action) {
        reachableFrontiers.push({ target: current, firstStep, action, pathDistance: current.pathDistance });
      }
    }
    for (const { delta } of directions) {
      const next = { x: current.x + delta.x, y: current.y + delta.y };
      const key = pointKey(next);
      if (cameFrom.has(key) || !isKnownWalkable(observation, next, options)) {
        continue;
      }
      cameFrom.set(key, current);
      queue.push({ ...next, pathDistance: current.pathDistance + 1 });
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
  const start = observation.player.pos;
  const queue: Point[] = [start];
  const cameFrom = new Map<string, Point | null>([[pointKey(start), null]]);
  let target: Point | null = null;

  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor];
    cursor += 1;
    if (distance(current, start) > 0 && hasUnseenNeighbor(observation, current) && !isStaleFrontier(observation, current)) {
      target = current;
      break;
    }
    for (const { delta } of directions) {
      const next = { x: current.x + delta.x, y: current.y + delta.y };
      const key = pointKey(next);
      if (cameFrom.has(key) || !isKnownWalkable(observation, next, options)) {
        continue;
      }
      cameFrom.set(key, current);
      queue.push(next);
    }
  }

  if (!target) {
    return null;
  }

  let step = target;
  while (cameFrom.get(pointKey(step)) && pointKey(cameFrom.get(pointKey(step)) as Point) !== pointKey(start)) {
    step = cameFrom.get(pointKey(step)) as Point;
  }
  return actionFromStep(start, step);
}

function stepTowardDistantKnownArea(observation: GameObservation, options: PathOptions = {}): GameAction | null {
  const start = observation.player.pos;
  const queue: Point[] = [start];
  const cameFrom = new Map<string, Point | null>([[pointKey(start), null]]);
  const candidates: Point[] = [];

  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor];
    cursor += 1;
    if (distance(current, start) >= 6) {
      candidates.push(current);
    }
    for (const { delta } of directions) {
      const next = { x: current.x + delta.x, y: current.y + delta.y };
      const key = pointKey(next);
      if (cameFrom.has(key) || !isKnownWalkable(observation, next, options)) {
        continue;
      }
      cameFrom.set(key, current);
      queue.push(next);
    }
  }

  const target = candidates.sort((a, b) => distantAreaScore(observation, a) - distantAreaScore(observation, b))[0];
  if (!target) {
    return null;
  }
  const firstStep = firstStepFromPath(cameFrom, start, target);
  return actionFromStep(start, firstStep);
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

function isKnownWalkable(observation: GameObservation, pos: Point, options: PathOptions = {}): boolean {
  const index = observationIndex(observation);
  const tile = index.knownTiles.get(pointKey(pos));
  if (!tile || !isWalkableTileKind(tile.kind)) {
    return false;
  }
  return !isVisibleBlockerAt(observation, pos, options) && (options.avoidTraps === false || !isKnownTrapAt(observation, pos));
}

function isWalkableTileKind(kind: GameObservation["knownTiles"][number]["kind"]): boolean {
  return kind === "floor" || kind === "cover" || kind === "stairsDown";
}

function isVisibleBlockerAt(observation: GameObservation, pos: Point, options: PathOptions = {}): boolean {
  const index = observationIndex(observation);
  const key = pointKey(pos);
  return options.allowHostileBlockers ? index.visibleNonHostileBlockers.has(key) : index.visibleBlockers.has(key);
}

function isKnownTrapAt(observation: GameObservation, pos: Point): boolean {
  return observationIndex(observation).knownTraps.has(pointKey(pos));
}

function isSurvivalPickup(contentId: string): boolean {
  const consumable = getGameConfig().consumables[contentId];
  return !!consumable && (!!consumable.heal || !!consumable.cureConditions || !!consumable.guardedTurns || !!consumable.pushVisibleMonsters);
}

function isAutoplayTargetEntity(entity: GameObservation["knownEntities"][number]): boolean {
  return entity.kind === "item" || (entity.kind === "event" && entity.contentId !== "event.wayfarer-merchant");
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
  return directions.some(({ delta }) => {
    const neighbor = { x: pos.x + delta.x, y: pos.y + delta.y };
    if (neighbor.x < 0 || neighbor.y < 0 || neighbor.x >= observation.width || neighbor.y >= observation.height) {
      return false;
    }
    return !index.knownTiles.has(pointKey(neighbor));
  });
}

function distance(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function localMoveScore(observation: GameObservation, point: Point): number {
  return visitScore(observation, point) * VISIT_PENALTY + recentVisitScore(observation, point) * RECENT_POSITION_PENALTY + distance(point, observation.player.pos);
}

function observationIndex(observation: GameObservation): ObservationIndex {
  const existing = observationIndexes.get(observation);
  if (existing) {
    return existing;
  }
  const knownTiles = new Map<string, GameObservation["knownTiles"][number]>();
  for (const tile of observation.knownTiles) {
    knownTiles.set(pointKey(tile), tile);
  }
  const knownTraps = new Set<string>();
  for (const entity of observation.knownEntities) {
    if (entity.kind === "trap") {
      knownTraps.add(pointKey(entity.pos));
    }
  }
  const visibleBlockers = new Set<string>();
  const visibleNonHostileBlockers = new Set<string>();
  for (const entity of observation.visibleEntities) {
    if (!entity.blocksMovement) {
      continue;
    }
    const key = pointKey(entity.pos);
    visibleBlockers.add(key);
    if (!(entity.kind === "monster" && entity.hostile)) {
      visibleNonHostileBlockers.add(key);
    }
  }
  const index = { knownTiles, knownTraps, visibleBlockers, visibleNonHostileBlockers };
  observationIndexes.set(observation, index);
  return index;
}

function pointKey(point: Point): string {
  return `${point.x},${point.y}`;
}

function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
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
