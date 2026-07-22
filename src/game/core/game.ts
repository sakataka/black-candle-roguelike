import * as ROT from "rot-js";
import { floorRuleMatches, getGameConfig } from "../content/config";
import { contentEntities, getContentName } from "../content/entities";
import type {
  ConditionKind,
  BiomeTheme,
  Direction,
  Entity,
  GameAction,
  GameConfig,
  GameMessage,
  GameObservation,
  GameState,
  MerchantServiceId,
  MissionId,
  PlayerProgress,
  Point,
  RunObjectiveFlags,
  RunIdentity,
  RoleTruthId,
  Stats,
  Tile,
  TileKind,
  TrapKind,
} from "../types";
import { Rng } from "./rng";
import {
  createCheckpointDecision,
  createContextDecision,
  createFinalDecision,
  createRunIdentity,
  createRunStoryState,
  defaultMissionForTemperament,
  defaultDirectiveForTemperament,
  missionDefinition,
  missionProgress,
  roleTruthFor,
} from "./autonomous";

const DIRS: Record<Direction, Point> = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
  east: { x: 1, y: 0 },
  northwest: { x: -1, y: -1 },
  northeast: { x: 1, y: -1 },
  southwest: { x: -1, y: 1 },
  southeast: { x: 1, y: 1 },
};

type FloorPlan = {
  guaranteedLootPoints: Point[];
  lootPoints: Point[];
  eventPoints: Point[];
  trapPoints: Point[];
  monsterPoints: Point[];
};

type RunCarryState = Pick<GameState, "runTurn" | "runIdentity" | "directive" | "revelationsRemaining" | "knownRoleTruths" | "story">;

export function playableRoles() {
  return getGameConfig().roles;
}

function roleTraits(roleId: string) {
  return getGameConfig().roles.find((role) => role.id === roleId)?.traits;
}

export function createInitialGame(
  seed = 20260504,
  roleId = "role.oathbound",
  options: { identity?: RunIdentity; knownRoleTruths?: RoleTruthId[]; missionId?: MissionId } = {},
): GameState {
  const identity = options.identity ?? createRunIdentity(seed, roleId);
  return createFloorState(seed, 1, undefined, [], createInitialProgress(), roleId, createInitialRunObjectives(), {
    runTurn: 0,
    runIdentity: identity,
    directive: defaultDirectiveForTemperament(identity.temperament),
    revelationsRemaining: getGameConfig().autonomous.revelationsPerRun,
    knownRoleTruths: [...(options.knownRoleTruths ?? [])],
    story: createRunStoryState(options.missionId ?? defaultMissionForTemperament(identity.temperament)),
  });
}

function biomeThemeForFloor(floor: number): BiomeTheme {
  return [...getGameConfig().biomes].sort((a, b) => b.minFloor - a.minFloor).find((entry) => floor >= entry.minFloor)?.theme ?? "blackstone";
}

export function biomeThemeName(theme: BiomeTheme): string {
  return getGameConfig().biomes.find((entry) => entry.theme === theme)?.nameJa ?? theme;
}

function createFloorState(
  seed: number,
  floor: number,
  carriedPlayer?: Entity,
  carriedMessages: GameMessage[] = [],
  carriedProgress: PlayerProgress = createInitialProgress(),
  roleId = "role.oathbound",
  carriedRunObjectives: RunObjectiveFlags = createInitialRunObjectives(),
  carriedRun?: RunCarryState,
): GameState {
  const config = getGameConfig();
  const { rules } = config;
  const fallbackIdentity = createRunIdentity(seed, roleId);
  const run = carriedRun ?? {
    runTurn: 0,
    runIdentity: fallbackIdentity,
    directive: defaultDirectiveForTemperament(fallbackIdentity.temperament),
    revelationsRemaining: config.autonomous.revelationsPerRun,
    knownRoleTruths: [],
    story: createRunStoryState(defaultMissionForTemperament(fallbackIdentity.temperament)),
  };
  const biome = biomeThemeForFloor(floor);
  const tiles = Array.from({ length: rules.mapWidth * rules.mapHeight }, (): Tile => ({
    kind: "wall",
    explored: false,
    visible: false,
  }));

  ROT.RNG.setSeed(seed + floor * 4099);
  const dungeon = new ROT.Map.Uniform(rules.mapWidth, rules.mapHeight, {
    roomWidth: [5, 12],
    roomHeight: [4, 7],
    roomDugPercentage: 0.28,
    timeLimit: 1000,
  });
  const generatedDungeon = dungeon.create((x, y, value) => {
    if (value === 0) {
      setTileKind(tiles, rules.mapWidth, x, y, "floor");
    }
  });
  if (!generatedDungeon) {
    const digger = new ROT.Map.Digger(rules.mapWidth, rules.mapHeight, {
      roomWidth: [5, 12],
      roomHeight: [4, 7],
      corridorLength: [3, 9],
      dugPercentage: 0.34,
    });
    digger.create((x, y, value) => {
      if (value === 0) {
        setTileKind(tiles, rules.mapWidth, x, y, "floor");
      }
    });
  }

  const walkable = walkablePoints(tiles, rules.mapWidth);
  const roomCenters = generatedDungeon ? dungeon.getRooms().map((room) => {
    const [x, y] = room.getCenter();
    return { x: Math.round(x), y: Math.round(y) };
  }).filter((point) => walkable.some((walkablePoint) => samePoint(walkablePoint, point))) : [];
  const start = nearestPoint(roomCenters.length > 0 ? roomCenters : walkable, { x: Math.floor(rules.mapWidth / 2), y: Math.floor(rules.mapHeight / 2) }) ?? { x: 3, y: 3 };
  const connectedWalkable = connectedWalkablePoints(tiles, rules.mapWidth, rules.mapHeight, start);
  const floorWalkable = connectedWalkable.length > 0 ? connectedWalkable : walkable;
  const stairs =
    farthestPoint(roomCenters.filter((point) => floorWalkable.some((walkablePoint) => samePoint(walkablePoint, point)) && manhattan(point, start) >= Math.floor((rules.mapWidth + rules.mapHeight) * 0.28)), start) ??
    stairPoint(floorWalkable, start, rngForFloor(seed, floor)) ??
    farthestPoint(floorWalkable, start) ??
    { x: rules.mapWidth - 4, y: rules.mapHeight - 4 };
  setTileKind(tiles, rules.mapWidth, stairs.x, stairs.y, "stairsDown");

  const roles = playableRoles();
  const role = roles.find((candidate) => candidate.id === roleId) ?? roles[0];
  const player: Entity = carriedPlayer
    ? {
        ...carriedPlayer,
        pos: start,
        stats: carriedPlayer.stats ? { ...carriedPlayer.stats, hp: Math.min(carriedPlayer.stats.maxHp, carriedPlayer.stats.hp + rules.descentHeal) } : undefined,
        inventory: carriedPlayer.inventory?.map((entry) => ({ ...entry })),
        conditions: clearCondition(carriedPlayer.conditions, "guarded"),
      }
    : {
        id: "player",
        kind: "player",
        contentId: role.id,
        pos: start,
        blocksMovement: true,
        stats: { ...role.stats },
        inventory: role.inventory.map((entry) => ({ ...entry })),
      };

  const dangerBoost = floor - 1;
  const rng = rngForFloor(seed, floor);
  const coverPoints = chooseCoverPoints(floorWalkable, start, stairs, rng);
  for (const point of coverPoints) {
    setTileKind(tiles, rules.mapWidth, point.x, point.y, "cover");
  }

  const spawnPoints = floorWalkable.filter((point) => !samePoint(point, start) && !samePoint(point, stairs) && !coverPoints.some((coverPoint) => samePoint(coverPoint, point)) && manhattan(point, start) > 7);
  const floorPlan = buildFloorPlan(floorWalkable, roomCenters, start, stairs);
  const takePoint = createPointTaker(spawnPoints, rng, start);

  const monsterPool = monsterPoolForFloor(floor);
  const itemPool = itemPoolForFloor(floor);
  const spawnedMonsters = Array.from({ length: rules.monsterCountBase + Math.min(floor, rules.monsterCountFloorCap) }, (_, index) => {
    const contentId = rng.pick(monsterPool);
    return monster(`${contentId}.${floor}.${index}`, contentId, takePoint(floorPlan.monsterPoints), statsForMonster(contentId, dangerBoost, floor, carriedRunObjectives));
  });
  const guaranteedItems = guaranteedItemsForFloor(floor);
  const randomItems = Array.from({ length: rules.itemCountBase + Math.floor(Math.min(floor, rules.itemCountFloorCap) / rules.itemCountFloorDivisor) }, () => rng.pick(itemPool));
  const spawnedItems = [...guaranteedItems, ...randomItems].map((contentId, index) => item(`${contentId}.${floor}.${index}`, contentId, takePoint(index < guaranteedItems.length ? floorPlan.guaranteedLootPoints : floorPlan.lootPoints), floor, rng));
  const eventPool = eventPoolForFloor(floor);
  const spawnedEvents = Array.from({ length: rules.eventCountBase + (rng.int(1, 100) <= rules.eventExtraChancePercent ? 1 : 0) }, (_, index) => {
    const contentId = rng.pick(eventPool);
    return event(`${contentId}.${floor}.${index}`, contentId, takePoint(floorPlan.eventPoints));
  });
  const trapPool = trapPoolForFloor(floor);
  const spawnedTraps = Array.from({ length: Math.min(rules.trapCountBase + Math.floor(floor / rules.trapCountFloorDivisor), rules.trapCountMax) }, (_, index) => {
    const contentId = rng.pick(trapPool);
    return trap(`${contentId}.${floor}.${index}`, contentId, takePoint(floorPlan.trapPoints));
  });
  const bossId = bossForFloor(floor);
  const spawnedBoss = bossId ? [monster(`${bossId}.${floor}`, bossId, bossPointNearStairs(spawnPoints, stairs, rng) ?? takePoint(), statsForMonster(bossId, dangerBoost, floor, carriedRunObjectives))] : [];

  const entities: Entity[] = [player, ...spawnedMonsters, ...spawnedBoss, ...spawnedItems, ...spawnedEvents, ...spawnedTraps];

  let next = updateVisibility({
    seed,
    turn: 0,
    runTurn: run.runTurn,
    floor,
    biome,
    width: rules.mapWidth,
    height: rules.mapHeight,
    tiles,
    entities,
    playerId: player.id,
    playerProgress: normalizeProgress(carriedProgress),
    runObjectives: { ...carriedRunObjectives },
    runIdentity: { ...run.runIdentity },
    directive: run.directive,
    revelationsRemaining: run.revelationsRemaining,
    pendingDecision: null,
    knownRoleTruths: [...run.knownRoleTruths],
    story: {
      ...run.story,
      maxFloorReached: Math.max(run.story.maxFloorReached, floor),
      discoveries: [...run.story.discoveries],
      decisions: run.story.decisions.map((entry) => ({ ...entry })),
      contextActs: [...run.story.contextActs],
      crisisKinds: [...run.story.crisisKinds],
    },
    messages: [
      ...carriedMessages,
      message(0, floor === 1 ? `黒燭の迷宮、${biomeThemeName(biome)}に足を踏み入れた。` : `地下${floor}階、${biomeThemeName(biome)}へ降りた。`, "system"),
      message(0, "探索者は自らの判断で歩き始めた。灯守は黒燭越しに見守る。", "explore"),
    ].slice(-80),
    status: "playing",
  });
  const fallbackAct = floor === 5 ? 1 : floor === 8 ? 2 : null;
  if (fallbackAct && !next.story.contextActs.includes(fallbackAct)) {
    next.story.contextActs.push(fallbackAct);
    const decision = createContextDecision(next, fallbackAct, "fallback");
    next.story.crisisKinds.push(decision.id);
    next.pendingDecision = decision;
  }
  return next;
}

export function applyAction(state: GameState, action: GameAction): GameState {
  if (state.status !== "playing") {
    return state;
  }

  if (state.pendingDecision && action.type !== "resolveDecision") {
    return state;
  }

  let next = cloneState(state);
  if (action.type === "resolveDecision") {
    return updateVisibility(resolveDecision(next, action.optionId));
  }
  const player = getPlayer(next);

  switch (action.type) {
    case "move":
      next = moveActor(next, player.id, DIRS[action.direction]);
      break;
    case "wait":
      next.messages = pushMessage(next, "息を整えた。", "explore");
      break;
    case "pickup":
      next = pickupAtPlayer(next);
      break;
    case "useItem":
      next = useItem(next, action.contentId);
      break;
    case "merchantService":
      next = buyMerchantService(next, action.serviceId);
      break;
    case "equip":
      next = equipItem(next, action.contentId);
      break;
    case "dropItem":
      next = dropItemAtPlayer(next, action.contentId);
      break;
    case "descend":
      if (tileAt(next, player.pos).kind === "stairsDown") {
        if (bossAlive(next)) {
          next.messages = pushMessage(next, "この階層の守り手が階段を封じている。", "danger");
          break;
        }
        if (next.floor >= getGameConfig().rules.maxFloor) {
          next.pendingDecision = createFinalDecision(next);
          next.messages = pushMessage(next, "黒燭の番人が崩れ、中枢の火が灯守へ問いかけた。", "system");
        } else if (next.floor === 3 || next.floor === 6) {
          if (next.floor === 6) {
            next.story.carriedTruthId = roleTruthFor(next.runIdentity.roleId);
          }
          next.pendingDecision = createCheckpointDecision(next);
          next.messages = pushMessage(next, "帰還路と下層への階段が同時に開いた。灯守の判断を待っている。", "system");
        } else {
          const descentMessages = pushMessage(next, "下層へ降りる。", "system");
          next = descendToNextFloor(next, descentMessages);
        }
      } else {
        next.messages = pushMessage(next, "ここには下り階段がない。", "explore");
      }
      break;
  }

  next = resolveMissionCompletion(next);

  if (next.status === "playing" && !next.pendingDecision) {
    next = reevaluateEquipment(next);
    next = runMonsterTurn(next);
  }
  if (next.status === "playing" && !next.pendingDecision) {
    next = tickPlayerConditions(next);
  }
  next.turn += 1;
  next.runTurn += 1;
  if (next.status === "playing" && next.runTurn >= getGameConfig().rules.runTurnWarning && !next.story.turnWarningShown) {
    next.story.turnWarningShown = true;
    next.messages = pushMessage(next, "黒燭の像が揺らいだ。灯路断絶まで残された時間は少ない。", "danger");
  }
  if (next.status === "playing" && next.runTurn >= getGameConfig().rules.runTurnLimit) {
    next.status = "stranded";
    next.pendingDecision = null;
    next.messages = pushMessage(next, "黒燭の像が途切れた。探索者は未帰還となった。", "danger");
  }
  next = updateVisibility(next);
  return next;
}

function resolveDecision(state: GameState, optionId: string): GameState {
  const decision = state.pendingDecision;
  const option = decision?.options.find((candidate) => candidate.id === optionId);
  if (!decision || !option) return state;
  if (option.requiresRevelation && state.revelationsRemaining <= 0) {
    state.messages = pushMessage(state, "啓示の火はもう残っていない。", "danger");
    return state;
  }
  if (option.requiresRevelation) state.revelationsRemaining -= 1;
  if (option.directive) state.directive = option.directive;
  const effectSummary = applyDecisionEffect(state, option.effect);
  if (decision.kind === "context" && option.requiresRevelation && option.effect) {
    state.story.interventionScore += getGameConfig().autonomous.scoring.intervention;
  }
  state.story.decisions.push({
    id: decision.id,
    floor: state.floor,
    optionId: option.id,
    optionLabel: option.label,
    usedRevelation: !!option.requiresRevelation,
    effectSummary,
  });
  state.pendingDecision = null;
  state.messages = pushMessage(state, `${state.runIdentity.name}へ「${option.label}」を伝えた。`, "system");
  if (option.outcome === "return") {
    state.status = "returned";
    state.messages = pushMessage(state, `${state.runIdentity.name}は灯路をたどり、灰灯院へ帰還した。`, "system");
    return state;
  }
  if (option.outcome === "research") {
    state.story.coreDisposition = "research";
    state.status = "won";
    state.messages = pushMessage(state, "黒燭核は灰灯院の記録庫へ封じられ、新しい真相の研究が始まった。", "system");
    return state;
  }
  if (option.outcome === "relic") {
    state.story.coreDisposition = "relic";
    addInventoryItem(getPlayer(state), "item.black-candle-core", 1);
    state.status = "won";
    state.messages = pushMessage(state, "黒燭核を戦果として回収し、第十層から帰還した。", "system");
    return state;
  }
  if (option.outcome === "ending" && option.endingId) {
    state.story.endingId = option.endingId;
    state.status = "won";
    const endingMessage = option.endingId === "divide-flame"
      ? "三つの真相が重なり、黒燭は無数の灯へ分かれた。一人の犠牲に頼らない封印が始まった。"
      : option.endingId === "inherit-flame"
        ? `${state.runIdentity.name}は黒燭を継ぎ、次の番人として中枢に残った。`
        : "黒燭は消え、無明の王との戦いが地上で始まった。";
    state.messages = pushMessage(state, endingMessage, "system");
    return state;
  }
  if (decision.resume === "descend") {
    const descentMessages = pushMessage(state, "灯守の方針を胸に、下層へ降りる。", "system");
    return descendToNextFloor(state, descentMessages);
  }
  return state;
}

function applyDecisionEffect(state: GameState, effect: NonNullable<NonNullable<GameState["pendingDecision"]>["options"][number]["effect"]> | undefined): string | undefined {
  if (!effect) return undefined;
  const player = getPlayer(state);
  const applied: string[] = [];
  if (effect.goldCost) {
    const spent = Math.min(state.playerProgress.gold, effect.goldCost);
    state.playerProgress.gold -= spent;
    applied.push(`${spent}G消費`);
  }
  if (effect.maxHpCost && player.stats) {
    player.stats.maxHp = Math.max(1, player.stats.maxHp - effect.maxHpCost);
    player.stats.hp = Math.min(player.stats.hp, player.stats.maxHp);
    applied.push(`最大HP-${effect.maxHpCost}`);
  }
  if (effect.heal && player.stats) {
    const healed = Math.min(effect.heal, player.stats.maxHp - player.stats.hp);
    player.stats.hp += healed;
    applied.push(`HP+${healed}`);
  }
  if (effect.cureConditions) {
    const before = player.conditions?.length ?? 0;
    player.conditions = player.conditions?.filter((condition) => condition.kind === "guarded") ?? [];
    if (before !== player.conditions.length) applied.push("出血・毒を除去");
  }
  if (effect.guardedTurns) {
    player.conditions = upsertCondition(player.conditions, "guarded", effect.guardedTurns);
    if (player.stats) player.stats.defense = baseDefense(state.playerProgress) + defenseBonus(player);
    applied.push(`護り${effect.guardedTurns}T`);
  }
  if (effect.revealRadius) {
    revealAround(state, player.pos, effect.revealRadius);
    applied.push(`周囲${effect.revealRadius}マス記録`);
  }
  if (effect.pushVisibleMonsters) {
    const pushed = pushVisibleMonstersAway(state, player.pos);
    applied.push(`敵${pushed}体を押し戻す`);
  }
  if (applied.length > 0) state.messages = pushMessage(state, `灯守の介入: ${applied.join("、")}。`, "explore");
  return applied.join(" / ") || undefined;
}

function resolveMissionCompletion(state: GameState): GameState {
  if (state.story.missionCompleted || !missionProgress(state).completed) return state;
  state.story.missionCompleted = true;
  const mission = missionDefinition(state.story.missionId);
  if (state.story.missionId === "guardian-vow") {
    addInventoryItem(getPlayer(state), "item.greater-tonic", 1);
  } else if (state.story.missionId === "relic-ledger") {
    state.revelationsRemaining += 1;
  } else {
    addInventoryItem(getPlayer(state), "item.repulsion-scroll", 1);
  }
  state.messages = pushMessage(state, `遠征任務「${mission.label}」を達成した。報酬: ${mission.rewardLabel}。`, "loot");
  return state;
}

function descendToNextFloor(state: GameState, messages: GameMessage[]): GameState {
  return createFloorState(
    state.seed + 101 * state.floor,
    state.floor + 1,
    getPlayer(state),
    messages,
    state.playerProgress,
    getPlayer(state).contentId,
    state.runObjectives,
    carryRun(state),
  );
}

function carryRun(state: GameState): RunCarryState {
  return {
    runTurn: state.runTurn,
    runIdentity: { ...state.runIdentity },
    directive: state.directive,
    revelationsRemaining: state.revelationsRemaining,
    knownRoleTruths: [...state.knownRoleTruths],
    story: {
      ...state.story,
      discoveries: [...state.story.discoveries],
      decisions: state.story.decisions.map((entry) => ({ ...entry })),
      contextActs: [...state.story.contextActs],
      crisisKinds: [...state.story.crisisKinds],
    },
  };
}

export function observeGame(state: GameState): GameObservation {
  const player = getPlayer(state);
  const observedEntity = ({ id, kind, contentId, pos, stats, hostile, blocksMovement, goldAmount }: Entity) => ({
    id,
    kind,
    contentId: kind === "trap" ? "trap.risk-panel" : contentId,
    pos,
    stats,
    hostile,
    blocksMovement,
    goldAmount,
  });
  const visibleEntities = state.entities.filter((entity) => tileAt(state, entity.pos).visible).map(observedEntity);
  const knownEntities = state.entities
    .filter((entity) => isEntityRemembered(state, entity))
    .map(observedEntity);
  const visibleTiles = state.tiles.flatMap((tile, index) => {
    if (!tile.visible) {
      return [];
    }
    return [{ ...tile, x: index % state.width, y: Math.floor(index / state.width) }];
  });
  const knownTiles = state.tiles.flatMap((tile, index) => {
    if (!tile.explored && !tile.visible) {
      return [];
    }
    return [{ ...tile, x: index % state.width, y: Math.floor(index / state.width) }];
  });
  const aliveBoss = bossAlive(state);

  return {
    seed: state.seed,
    turn: state.turn,
    runTurn: state.runTurn,
    floor: state.floor,
    biome: state.biome,
    width: state.width,
    height: state.height,
    player,
    playerProgress: { ...state.playerProgress },
    visibleEntities,
    knownEntities,
    visibleTiles,
    knownTiles,
    exploration: buildExplorationStatus(state, knownTiles, knownEntities, visibleEntities, aliveBoss),
    runIdentity: { ...state.runIdentity },
    directive: state.directive,
    revelationsRemaining: state.revelationsRemaining,
    pendingDecision: state.pendingDecision ? structuredClone(state.pendingDecision) : null,
    story: structuredClone(state.story),
    messages: state.messages.slice(-8),
    status: state.status,
    bossAlive: aliveBoss,
  };
}

function buildExplorationStatus(
  state: GameState,
  knownTiles: Array<Tile & Point>,
  knownEntities: Array<Pick<Entity, "id" | "kind" | "contentId" | "pos" | "stats" | "hostile" | "blocksMovement" | "goldAmount">>,
  visibleEntities: Array<Pick<Entity, "id" | "kind" | "contentId" | "pos" | "stats" | "hostile" | "blocksMovement" | "goldAmount">>,
  aliveBoss: boolean,
): GameObservation["exploration"] {
  const knownTileMap = new Map(knownTiles.map((tile) => [pointKey(tile), tile]));
  const knownStairsTile = knownTiles.find((tile) => tile.kind === "stairsDown") ?? null;
  const knownStairs = knownStairsTile ? { x: knownStairsTile.x, y: knownStairsTile.y } : null;
  const reachableStairs = knownStairs && isKnownPointReachable(state, knownTileMap, knownEntities, visibleEntities, knownStairs) ? knownStairs : null;
  const blockedStairs = knownStairs && !reachableStairs ? knownStairs : null;
  const reachableFrontiers = reachableExplorationFrontiers(state, knownTileMap, knownEntities, visibleEntities);
  const nearestFrontier = reachableFrontiers[0] ?? null;
  const knownWalkableTiles = knownTiles.filter((tile) => isWalkable(tile.kind)).length;
  const stalledHint = reachableFrontiers.length === 0 && !reachableStairs && state.status === "playing";
  return {
    objective: explorationObjective(aliveBoss, reachableStairs, blockedStairs, nearestFrontier, stalledHint),
    knownStairs,
    reachableStairs,
    blockedStairs,
    nearestFrontier,
    reachableFrontiers,
    reachableFrontierCount: reachableFrontiers.length,
    knownWalkableTiles,
    exploredTileRatio: knownTiles.length / Math.max(1, state.width * state.height),
    stalledHint,
  };
}

function reachableExplorationFrontiers(
  state: GameState,
  knownTileMap: Map<string, Tile & Point>,
  knownEntities: Array<Pick<Entity, "id" | "kind" | "contentId" | "pos" | "stats" | "hostile" | "blocksMovement" | "goldAmount">>,
  visibleEntities: Array<Pick<Entity, "id" | "kind" | "contentId" | "pos" | "stats" | "hostile" | "blocksMovement" | "goldAmount">>,
): GameObservation["exploration"]["reachableFrontiers"] {
  const player = getPlayer(state);
  const start = player.pos;
  const queue: Array<Point & { distance: number }> = [{ ...start, distance: 0 }];
  const visited = new Set<string>([pointKey(start)]);
  const frontiers: GameObservation["exploration"]["reachableFrontiers"] = [];

  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor];
    cursor += 1;

    const unseenNeighbors = countUnseenNeighbors(state, knownTileMap, current);
    if (current.distance > 0 && unseenNeighbors > 0) {
      frontiers.push({ x: current.x, y: current.y, distance: current.distance, unseenNeighbors });
    }

    for (const delta of cardinalDeltas()) {
      const next = { x: current.x + delta.x, y: current.y + delta.y };
      const key = pointKey(next);
      if (visited.has(key) || !isKnownExplorationStep(knownTileMap, knownEntities, visibleEntities, next)) {
        continue;
      }
      visited.add(key);
      queue.push({ ...next, distance: current.distance + 1 });
    }
  }

  return frontiers.sort((a, b) => a.distance - b.distance || b.unseenNeighbors - a.unseenNeighbors || manhattan(a, start) - manhattan(b, start));
}

function isKnownPointReachable(
  state: GameState,
  knownTileMap: Map<string, Tile & Point>,
  knownEntities: Array<Pick<Entity, "id" | "kind" | "contentId" | "pos" | "stats" | "hostile" | "blocksMovement" | "goldAmount">>,
  visibleEntities: Array<Pick<Entity, "id" | "kind" | "contentId" | "pos" | "stats" | "hostile" | "blocksMovement" | "goldAmount">>,
  target: Point,
): boolean {
  const player = getPlayer(state);
  const targetKey = pointKey(target);
  if (pointKey(player.pos) === targetKey) {
    return true;
  }

  const queue: Point[] = [player.pos];
  const visited = new Set<string>([pointKey(player.pos)]);
  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor];
    cursor += 1;
    for (const delta of cardinalDeltas()) {
      const next = { x: current.x + delta.x, y: current.y + delta.y };
      const key = pointKey(next);
      if (visited.has(key) || !isKnownExplorationStep(knownTileMap, knownEntities, visibleEntities, next)) {
        continue;
      }
      if (key === targetKey) {
        return true;
      }
      visited.add(key);
      queue.push(next);
    }
  }
  return false;
}

function isKnownExplorationStep(
  knownTileMap: Map<string, Tile & Point>,
  knownEntities: Array<Pick<Entity, "id" | "kind" | "contentId" | "pos" | "stats" | "hostile" | "blocksMovement" | "goldAmount">>,
  visibleEntities: Array<Pick<Entity, "id" | "kind" | "contentId" | "pos" | "stats" | "hostile" | "blocksMovement" | "goldAmount">>,
  point: Point,
): boolean {
  const tile = knownTileMap.get(pointKey(point));
  if (!tile || !isWalkable(tile.kind)) {
    return false;
  }
  if (knownEntities.some((entity) => entity.kind === "trap" && samePoint(entity.pos, point))) {
    return false;
  }
  return !visibleEntities.some((entity) => entity.blocksMovement && entity.kind !== "player" && !(entity.kind === "monster" && entity.hostile) && samePoint(entity.pos, point));
}

function countUnseenNeighbors(state: GameState, knownTileMap: Map<string, Tile & Point>, point: Point): number {
  return cardinalDeltas().filter((delta) => {
    const neighbor = { x: point.x + delta.x, y: point.y + delta.y };
    return inBounds(state, neighbor) && !knownTileMap.has(pointKey(neighbor));
  }).length;
}

function explorationObjective(
  aliveBoss: boolean,
  reachableStairs: Point | null,
  blockedStairs: Point | null,
  nearestFrontier: Point | null,
  stalledHint: boolean,
): GameObservation["exploration"]["objective"] {
  if (aliveBoss) {
    return "defeatBoss";
  }
  if (reachableStairs) {
    return "descend";
  }
  if (blockedStairs) {
    return "findStairs";
  }
  if (nearestFrontier) {
    return "explore";
  }
  return stalledHint ? "resolveStall" : "findStairs";
}

function monster(id: string, contentId: string, pos: Point, stats: Stats): Entity {
  return { id, kind: "monster", contentId, pos, blocksMovement: true, stats, hostile: true };
}

function item(id: string, contentId: string, pos: Point, floor: number, rng: Rng): Entity {
  const { gold } = getGameConfig();
  const goldAmount = contentId === "item.coin-pouch" ? gold.coinPouchBase + floor * gold.coinPouchPerFloor + rng.int(0, gold.coinPouchRandomMax) : undefined;
  return { id, kind: "item", contentId, pos, blocksMovement: false, goldAmount };
}

function event(id: string, contentId: string, pos: Point): Entity {
  return { id, kind: "event", contentId, pos, blocksMovement: false };
}

function trap(id: string, contentId: string, pos: Point): Entity {
  return { id, kind: "trap", contentId, pos, blocksMovement: false };
}

function isEntityRemembered(state: GameState, entity: Entity): boolean {
  const tile = tileAt(state, entity.pos);
  if (entity.kind === "item" || entity.kind === "trap" || entity.kind === "event") {
    return tile.explored || tile.visible;
  }
  return tile.visible;
}

function createInitialProgress(): PlayerProgress {
  return normalizeProgress({ level: 1, xp: 0, xpToNext: getGameConfig().rules.xpThresholds[2], gold: 0 });
}

function normalizeProgress(progress: PlayerProgress): PlayerProgress {
  const nextThreshold = getGameConfig().rules.xpThresholds[progress.level + 1];
  return {
    ...progress,
    xpToNext: nextThreshold === undefined ? 0 : Math.max(0, nextThreshold - progress.xp),
  };
}

function createInitialRunObjectives(): RunObjectiveFlags {
  return {
    trapReveals: 0,
    lateEnemiesWeakened: false,
    bossRewardBonus: 0,
    roleGoalProgress: 0,
  };
}

function rngForFloor(seed: number, floor: number): Rng {
  return new Rng(seed + floor * 113);
}

function monsterPoolForFloor(floor: number): string[] {
  const biome = biomeThemeForFloor(floor);
  const pool = getGameConfig().monsterSpawnRules
    .filter((rule) => floorRuleMatches(rule, floor, biome))
    .map((rule) => rule.contentId);
  return pool.length > 0 ? pool : ["monster.ash-rat"];
}

function itemPoolForFloor(floor: number): string[] {
  const biome = biomeThemeForFloor(floor);
  const pool = getGameConfig().itemPools.flatMap((rule) => floorRuleMatches(rule, floor, biome) ? rule.items : []);
  return pool.length > 0 ? pool : ["item.ember-tonic"];
}

function guaranteedItemsForFloor(floor: number): string[] {
  const biome = biomeThemeForFloor(floor);
  return getGameConfig().guaranteedItems.find((rule) => floorRuleMatches(rule, floor, biome))?.items ?? [];
}

function eventPoolForFloor(floor: number): string[] {
  const biome = biomeThemeForFloor(floor);
  const pool = getGameConfig().eventPools.flatMap((rule) => floorRuleMatches(rule, floor, biome) ? rule.events : []);
  return pool.length > 0 ? pool : ["event.blood-inscription"];
}

function trapPoolForFloor(floor: number): string[] {
  const biome = biomeThemeForFloor(floor);
  return getGameConfig().trapPools.find((rule) => floorRuleMatches(rule, floor, biome))?.traps ?? ["trap.blood-needle"];
}

function bossForFloor(floor: number): string | null {
  return getGameConfig().bosses.find((boss) => boss.floor === floor)?.contentId ?? null;
}

function bossAlive(state: GameState): boolean {
  const bossId = bossForFloor(state.floor);
  return !!bossId && state.entities.some((entity) => entity.kind === "monster" && entity.contentId === bossId);
}

function bossPointNearStairs(points: Point[], stairs: Point, rng: Rng): Point | null {
  const candidates = points.filter((point) => manhattan(point, stairs) <= 6 && manhattan(point, stairs) >= 2);
  if (candidates.length === 0) {
    return null;
  }
  const point = rng.pick(candidates);
  points.splice(points.findIndex((candidate) => samePoint(candidate, point)), 1);
  return point;
}

function chooseCoverPoints(walkable: Point[], start: Point, stairs: Point, rng: Rng): Point[] {
  const { rules } = getGameConfig();
  const count = Math.min(rules.coverCountBase + Math.floor(rng.int(0, Math.max(1, rules.coverCountFloorDivisor * 4)) / rules.coverCountFloorDivisor), rules.coverCountMax);
  const candidates = walkable.filter((point) => {
    if (samePoint(point, start) || samePoint(point, stairs)) {
      return false;
    }
    return manhattan(point, start) > 3 && manhattan(point, stairs) > 2 && openNeighborCount(walkable, point) >= 3;
  });
  const cover: Point[] = [];
  while (cover.length < count && candidates.length > 0) {
    const index = rng.int(0, candidates.length - 1);
    const [point] = candidates.splice(index, 1);
    if (!point || cover.some((coverPoint) => manhattan(coverPoint, point) < 3)) {
      continue;
    }
    cover.push(point);
  }
  return cover;
}

function openNeighborCount(walkable: Point[], point: Point): number {
  return cardinalDeltas().filter((delta) => walkable.some((candidate) => samePoint(candidate, { x: point.x + delta.x, y: point.y + delta.y }))).length;
}

function buildFloorPlan(walkable: Point[], roomCenters: Point[], start: Point, stairs: Point): FloorPlan {
  const sideRoomCenters = roomCenters
    .filter((point) => !samePoint(point, start) && !samePoint(point, stairs))
    .sort((a, b) => manhattan(a, start) - manhattan(b, start));
  const firstSideRoom = sideRoomCenters[0] ?? start;
  const farSideRooms = sideRoomCenters.slice(Math.max(0, Math.floor(sideRoomCenters.length / 2)));
  const exitRoom = nearestPoint(roomCenters, stairs) ?? stairs;
  const nearStart = walkable.filter((point) => manhattan(point, start) >= 5 && manhattan(point, start) <= 14);
  const sideRoomPoints = pointsNearAny(walkable, sideRoomCenters, 5);
  const farRoomPoints = pointsNearAny(walkable, farSideRooms.length > 0 ? farSideRooms : [exitRoom], 5);
  const exitRoomPoints = pointsNearAny(walkable, [exitRoom, stairs], 6);
  const widePoints = walkable.filter((point) => openNeighborCount(walkable, point) >= 3);

  return {
    guaranteedLootPoints: uniquePoints([...nearStart, ...pointsNearAny(walkable, [firstSideRoom], 4), ...sideRoomPoints]),
    lootPoints: uniquePoints([...sideRoomPoints, ...nearStart, ...widePoints]),
    eventPoints: uniquePoints([...sideRoomPoints, ...farRoomPoints, ...widePoints]),
    trapPoints: uniquePoints([...farRoomPoints, ...exitRoomPoints, ...sideRoomPoints]),
    monsterPoints: uniquePoints([...exitRoomPoints, ...farRoomPoints, ...sideRoomPoints, ...walkable]),
  };
}

function createPointTaker(points: Point[], rng: Rng, fallback: Point): (preferred?: Point[]) => Point {
  return (preferred = []) => {
    const preferredIndexes = preferred
      .map((point) => points.findIndex((candidate) => samePoint(candidate, point)))
      .filter((index) => index >= 0);
    const index = preferredIndexes.length > 0 ? rng.pick(preferredIndexes) : rng.int(0, Math.max(0, points.length - 1));
    const [point] = points.splice(index, 1);
    return point ?? fallback;
  };
}

function pointsNearAny(points: Point[], centers: Point[], radius: number): Point[] {
  if (centers.length === 0) {
    return [];
  }
  return points.filter((point) => centers.some((center) => manhattan(point, center) <= radius));
}

function uniquePoints(points: Point[]): Point[] {
  const seen = new Set<string>();
  const unique: Point[] = [];
  for (const point of points) {
    const key = pointKey(point);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(point);
  }
  return unique;
}

function statsForMonster(contentId: string, dangerBoost: number, floor = 1, runObjectives: RunObjectiveFlags = createInitialRunObjectives()): Stats {
  const config = getGameConfig();
  const halfBoost = Math.floor(dangerBoost / 2);
  const base = config.monsterStats[contentId] ?? { hp: 5, attack: 1, defense: 0 };
  let hp = base.hp + dangerBoost * (base.hpPerDanger ?? 1);
  let attack = base.attack + halfBoost;
  if (runObjectives.lateEnemiesWeakened && floor >= 7 && contentEntities[contentId]?.tier !== "boss") {
    hp = Math.max(1, Math.floor(hp * 0.85));
    attack = Math.max(1, attack - 1);
  }
  return { hp, maxHp: hp, attack, defense: base.defense };
}

function equipmentSlot(contentId: string): "weapon" | "shield" | "armor" | null {
  return getGameConfig().equipment[contentId]?.slot ?? null;
}

function weaponBonus(player: Entity): number {
  const equippedWeapon = player.inventory?.find((entry) => entry.equipped && equipmentSlot(entry.contentId) === "weapon")?.contentId;
  return equippedWeapon ? weaponPower(equippedWeapon) : 0;
}

function defenseBonus(player: Entity): number {
  const armor = player.inventory?.find((entry) => entry.equipped && equipmentSlot(entry.contentId) === "armor")?.contentId;
  const armorBonus = armor ? armorPower(armor) : 0;
  const shieldBonus = player.inventory?.filter((entry) => entry.equipped && equipmentSlot(entry.contentId) === "shield").reduce((sum, entry) => sum + shieldPower(entry.contentId), 0) ?? 0;
  const guardedBonus = hasCondition(player, "guarded") ? getGameConfig().rules.guardedDefenseBonus : 0;
  return armorBonus + shieldBonus + guardedBonus;
}

function rangedDefenseBonus(actor: Entity): number {
  const equipmentBonus = actor.inventory?.filter((entry) => entry.equipped).reduce((sum, entry) => sum + (getGameConfig().equipment[entry.contentId]?.rangedDefense ?? 0), 0) ?? 0;
  return equipmentBonus + (roleTraits(actor.contentId)?.rangedDefense ?? 0);
}

function trapAvoidChance(actor: Entity): number {
  const { rules } = getGameConfig();
  const equipmentModifier = actor.inventory?.filter((entry) => entry.equipped).reduce((sum, entry) => {
    const equipment = getGameConfig().equipment[entry.contentId];
    return sum + (equipment?.trapAvoidPercent ?? 0) - (equipment?.trapAvoidPenaltyPercent ?? 0);
  }, 0) ?? 0;
  const roleModifier = roleTraits(actor.contentId)?.trapAvoidPercent ?? 0;
  return clampNumber(rules.trapAvoidBasePercent + roleModifier + equipmentModifier, rules.trapAvoidMinPercent, rules.trapAvoidMaxPercent);
}

function moveActor(state: GameState, actorId: string, delta: Point): GameState {
  const actor = state.entities.find((entity) => entity.id === actorId);
  if (!actor) {
    return state;
  }

  const target = { x: actor.pos.x + delta.x, y: actor.pos.y + delta.y };
  if (!inBounds(state, target) || !isWalkable(tileAt(state, target).kind)) {
    if (actor.kind === "player") {
      if (inBounds(state, target)) {
        const tile = tileAt(state, target);
        tile.visible = true;
        tile.explored = true;
      }
      state.messages = pushMessage(state, "黒石の壁に行く手を阻まれた。", "explore");
    }
    return state;
  }

  const targetEntity = state.entities.find((entity) => entity.blocksMovement && samePoint(entity.pos, target));
  if (targetEntity) {
    return attack(state, actor, targetEntity);
  }

  actor.pos = target;
  const floorTrap = state.entities.find((entity) => entity.kind === "trap" && samePoint(entity.pos, target));
  if (floorTrap) {
    state = triggerTrap(state, actor, floorTrap);
    if (state.status !== "playing" || !state.entities.some((entity) => entity.id === actor.id)) {
      return state;
    }
  }
  if (actor.kind === "player") {
    const floorEvent = state.entities.find((entity) => entity.kind === "event" && samePoint(entity.pos, target));
    if (floorEvent) {
      state = triggerEvent(state, floorEvent);
    }
    const floorItem = state.entities.find((entity) => entity.kind === "item" && samePoint(entity.pos, target));
    const tile = tileAt(state, target);
    if (floorItem) {
      state.messages = pushMessage(state, `${getContentName(floorItem.contentId)}を携行候補として認識した。`, "loot");
    } else if (tile.kind === "stairsDown") {
      state.messages = pushMessage(state, "下り階段を見つけた。探索方針へ組み込む。", "explore");
    }
  }
  return state;
}

function trapKindFromContent(contentId: string): TrapKind {
  if (contentId === "trap.venom-mist") {
    return "venom-mist";
  }
  if (contentId === "trap.crumbling-floor") {
    return "crumbling-floor";
  }
  return "blood-needle";
}

function triggerTrap(state: GameState, actor: Entity, trapEntity: Entity): GameState {
  if (!actor.stats) {
    return state;
  }
  if (evadeTrap(state, actor, trapEntity)) {
    return state;
  }
  if (trapEntity.contentId === "trap.risk-panel") {
    return triggerRiskPanel(state, actor, trapEntity);
  }
  const trapKind = trapKindFromContent(trapEntity.contentId);
  const trapEffect = getGameConfig().trapEffects[trapEntity.contentId] ?? { damage: 4 };
  const damage = trapEffect.damage + (trapEffect.damagePerFloorDivisor ? Math.floor(state.floor / trapEffect.damagePerFloorDivisor) : 0);
  const actorName = actor.kind === "player" ? "あなた" : getContentName(actor.contentId);
  if (trapKind === "blood-needle") {
    actor.stats.hp -= damage;
    actor.conditions = actor.kind === "player" && trapEffect.condition && trapEffect.turns ? upsertCondition(actor.conditions, trapEffect.condition, trapEffect.turns) : actor.conditions;
    state.messages = pushMessage(state, `${actorName}が血針罠を踏み、黒い針に裂かれた。`, actor.kind === "player" ? "danger" : "combat");
  } else if (trapKind === "venom-mist") {
    actor.stats.hp -= damage;
    actor.conditions = actor.kind === "player" && trapEffect.condition && trapEffect.turns ? upsertCondition(actor.conditions, trapEffect.condition, trapEffect.turns) : actor.conditions;
    state.messages = pushMessage(state, `${actorName}の足元から毒霧が吹き上がった。`, actor.kind === "player" ? "danger" : "combat");
  } else {
    actor.stats.hp -= damage;
    revealAround(state, trapEntity.pos, trapEffect.revealRadius ?? 3);
    state.messages = pushMessage(state, `${actorName}の足元で崩れ床が割れ、落石が降った。`, actor.kind === "player" ? "danger" : "combat");
  }
  state.entities = state.entities.filter((entity) => entity.id !== trapEntity.id);
  if (actor.stats.hp <= 0) {
    if (actor.kind === "player") {
      state.status = "lost";
      state.messages = pushMessage(state, "罠に倒れ、迷宮の暗闇に沈んだ。", "danger");
    } else {
      state.entities = state.entities.filter((entity) => entity.id !== actor.id);
      state.messages = pushMessage(state, `${getContentName(actor.contentId)}は罠に倒れた。`, "combat");
    }
  }
  return state;
}

function evadeTrap(state: GameState, actor: Entity, trapEntity: Entity): boolean {
  if (actor.kind !== "player") {
    return false;
  }
  const chance = trapAvoidChance(actor);
  if (chance <= 0) {
    return false;
  }
  const rng = new Rng(state.seed + state.floor * 307 + state.turn * 53 + trapEntity.id.length * 19);
  if (rng.int(1, 100) > chance) {
    return false;
  }
  state.entities = state.entities.filter((entity) => entity.id !== trapEntity.id);
  state.messages = pushMessage(state, `身につけた装備が助けとなり、${getContentName(trapEntity.contentId)}をかわした。`, "loot");
  return true;
}

function triggerRiskPanel(state: GameState, actor: Entity, trapEntity: Entity): GameState {
  if (!actor.stats) {
    return state;
  }
  const rng = new Rng(state.seed + state.floor * 211 + state.turn * 37 + trapEntity.id.length * 17);
  const roll = rng.int(1, 100);
  const actorName = actor.kind === "player" ? "あなた" : getContentName(actor.contentId);
  const tone = actor.kind === "player" ? "danger" : "combat";

  state.entities = state.entities.filter((entity) => entity.id !== trapEntity.id);

  if (roll <= 20) {
    actor.stats.hp -= 4 + Math.floor(state.floor / 2);
    actor.conditions = actor.kind === "player" ? upsertCondition(actor.conditions, "bleeding", 5) : actor.conditions;
    state.messages = pushMessage(state, `${actorName}が運命の標を踏み、血針が跳ね上がった。`, tone);
  } else if (roll <= 38) {
    actor.stats.hp -= 2 + Math.floor(state.floor / 3);
    actor.conditions = actor.kind === "player" ? upsertCondition(actor.conditions, "venomed", 5) : actor.conditions;
    state.messages = pushMessage(state, `${actorName}の足元から毒霧が吹き上がった。`, tone);
  } else if (roll <= 53) {
    actor.stats.hp -= 6 + Math.floor(state.floor / 2);
    revealAround(state, trapEntity.pos, 3);
    state.messages = pushMessage(state, `${actorName}の足元で標が砕け、落石が降った。`, tone);
  } else if (actor.kind === "player" && roll <= 68) {
    const healed = Math.min(10 + Math.floor(state.floor / 2), actor.stats.maxHp - actor.stats.hp);
    actor.stats.hp += healed;
    state.messages = pushMessage(state, `運命の標が白く灯り、HPが${healed}回復した。`, "loot");
  } else if (actor.kind === "player" && roll <= 82) {
    revealAround(state, trapEntity.pos, 8);
    state.messages = pushMessage(state, "運命の標が割れ、周囲の部屋と通路が浮かび上がった。", "explore");
  } else if (actor.kind === "player" && roll <= 93) {
    const amount = 18 + state.floor * 5 + rng.int(0, 12);
    state.playerProgress = normalizeProgress({ ...state.playerProgress, gold: state.playerProgress.gold + amount });
    state.messages = pushMessage(state, `運命の標から古銭がこぼれ、${amount} Goldを得た。`, "loot");
  } else if (actor.kind === "player") {
    actor.conditions = upsertCondition(actor.conditions, "guarded", 8);
    actor.stats.defense = baseDefense(state.playerProgress) + defenseBonus(actor);
    state.messages = pushMessage(state, "運命の標が盾の紋に変わり、短い護りを得た。", "loot");
  } else {
    actor.stats.hp -= 4 + Math.floor(state.floor / 2);
    state.messages = pushMessage(state, `${actorName}が運命の標の反動を受けた。`, "combat");
  }

  if (actor.stats.hp <= 0) {
    if (actor.kind === "player") {
      state.status = "lost";
      state.messages = pushMessage(state, "運命の標に命を奪われ、迷宮の暗闇に沈んだ。", "danger");
    } else {
      state.entities = state.entities.filter((entity) => entity.id !== actor.id);
      state.messages = pushMessage(state, `${getContentName(actor.contentId)}は運命の標に倒れた。`, "combat");
    }
  }
  return state;
}

function triggerEvent(state: GameState, eventEntity: Entity): GameState {
  if (!state.story.discoveries.includes(eventEntity.contentId)) {
    state.story.discoveries.push(eventEntity.contentId);
  }
  const resolved = resolveEvent(state, eventEntity);
  if (resolved.status !== "playing" || resolved.pendingDecision) return resolved;
  const act = resolved.floor >= 4 && resolved.floor <= 6 ? 1 : resolved.floor >= 7 && resolved.floor <= 9 ? 2 : null;
  if (act && !resolved.story.contextActs.includes(act) && eventEntity.contentId !== "event.wayfarer-merchant") {
    resolved.story.contextActs.push(act);
    const decision = createContextDecision(resolved, act, eventEntity.contentId);
    resolved.story.crisisKinds.push(decision.id);
    resolved.pendingDecision = decision;
    resolved.messages = pushMessage(resolved, "黒燭が出来事の意味を映し返した。灯守の判断を待っている。", "system");
  }
  return resolved;
}

function resolveEvent(state: GameState, eventEntity: Entity): GameState {
  const eventConfig = getGameConfig().events[eventEntity.contentId];
  if (eventEntity.contentId === "event.blood-inscription") {
    const xp = eventConfig?.xp ?? 6;
    state.playerProgress = normalizeProgress({ ...state.playerProgress, xp: state.playerProgress.xp + xp });
    state.entities = state.entities.filter((entity) => entity.id !== eventEntity.id);
    state.messages = pushMessage(state, `血文字の碑文がほどけ、失われた探索者の記憶を得た。${xp} XPを得た。`, "explore");
    return applyLevelUps(state);
  }
  if (eventEntity.contentId === "event.mend-shrine") {
    const player = getPlayer(state);
    if (player.stats) {
      const healed = Math.min(eventConfig?.heal ?? 14, player.stats.maxHp - player.stats.hp);
      player.stats.hp += healed;
      player.conditions = clearConditions(player.conditions, eventConfig?.cureConditions ?? ["bleeding", "venomed"]);
      state.messages = pushMessage(state, `ひび割れた祭壇の灯でHPが${healed}回復し、毒と出血が静まった。`, "loot");
      state = applyPriestCleansingGoal(state);
    }
    state.entities = state.entities.filter((entity) => entity.id !== eventEntity.id);
    return state;
  }
  if (eventEntity.contentId === "event.cursed-coffer") {
    const player = getPlayer(state);
    const amount = (eventConfig?.goldBase ?? 24) + state.floor * (eventConfig?.goldPerFloor ?? 6);
    state.playerProgress = normalizeProgress({ ...state.playerProgress, gold: state.playerProgress.gold + amount });
    if (eventConfig?.condition) {
      player.conditions = upsertCondition(player.conditions, eventConfig.condition.kind, eventConfig.condition.turns);
    }
    state.entities = state.entities.filter((entity) => entity.id !== eventEntity.id);
    state.messages = pushMessage(state, `呪われた小箱から${amount} Goldを得たが、黒い刃で出血した。`, "danger");
    return state;
  }
  if (eventEntity.contentId === "event.warning-brazier") {
    revealAround(state, eventEntity.pos, eventConfig?.revealRadius ?? 7);
    state.entities = state.entities.filter((entity) => entity.id !== eventEntity.id);
    state.messages = pushMessage(state, "警告灯が燃え上がり、周囲の通路と敵影が頭に刻まれた。", "explore");
    return state;
  }
  if (eventEntity.contentId === "event.dread-altar") {
    const revealed = revealKnownTrapTiles(state, eventConfig?.revealTraps ?? 3, eventEntity.pos);
    state.runObjectives = { ...state.runObjectives, trapReveals: state.runObjectives.trapReveals + revealed };
    if (eventConfig?.condition) {
      const player = getPlayer(state);
      player.conditions = upsertCondition(player.conditions, eventConfig.condition.kind, eventConfig.condition.turns);
    }
    state = applyPriestCleansingGoal(state);
    state.entities = state.entities.filter((entity) => entity.id !== eventEntity.id);
    state.messages = pushMessage(state, `忌み祭壇が低く鳴り、${revealed}個の罠の気配が床に残った。`, revealed > 0 ? "explore" : "danger");
    return state;
  }
  if (eventEntity.contentId === "event.furnace-control-stone") {
    state.runObjectives = { ...state.runObjectives, lateEnemiesWeakened: true };
    weakenLateEnemies(state);
    state.entities = state.entities.filter((entity) => entity.id !== eventEntity.id);
    state.messages = pushMessage(state, "炉心制御碑を砕いた。終盤階層の守り手たちの火勢が弱まった。", "danger");
    return state;
  }
  if (eventEntity.contentId === "event.seal-key") {
    state.runObjectives = { ...state.runObjectives, bossRewardBonus: state.runObjectives.bossRewardBonus + (eventConfig?.bossRewardBonus ?? 1) };
    state.entities = state.entities.filter((entity) => entity.id !== eventEntity.id);
    state.messages = pushMessage(state, "封印鍵を拾い上げた。次の守り手が抱える遺物の封が少し緩む。", "loot");
    return state;
  }
  if (eventEntity.contentId === "event.broken-armory") {
    const player = getPlayer(state);
    player.inventory ??= [];
    const primary = eventConfig?.loot?.[0] ?? "item.oath-knife";
    const fallback = eventConfig?.reward ?? "item.ember-dart";
    const contentId = player.inventory.some((entry) => entry.contentId === primary) ? fallback : primary;
    const existing = player.inventory.find((entry) => entry.contentId === contentId);
    if (existing) {
      existing.quantity += 1;
    } else {
      player.inventory.push({ contentId, quantity: 1 });
    }
    state.entities = state.entities.filter((entity) => entity.id !== eventEntity.id);
    state.messages = pushMessage(state, `崩れた武器棚から${getContentName(contentId)}を見つけた。`, "loot");
    if (shouldAutoEquip(player, contentId)) {
      return equipItem(state, contentId);
    }
  }
  if (eventEntity.contentId === "event.oath-echo") {
    return triggerOathEcho(state, eventEntity);
  }
  if (eventEntity.contentId === "event.scout-cache") {
    return triggerScoutCache(state, eventEntity);
  }
  if (eventEntity.contentId === "event.lantern-font") {
    return triggerLanternFont(state, eventEntity);
  }
  if (eventEntity.contentId === "event.wayfarer-merchant") {
    state.messages = pushMessage(state, "旅商人が灯を掲げた。必要なサービスを選べる。", "explore");
    return state;
  }
  if (eventEntity.contentId === "event.sealed-room") {
    return openSealedRoom(state, eventEntity);
  }
  if (eventEntity.contentId === "event.dead-feast") {
    return openDeadFeast(state, eventEntity);
  }
  if (eventEntity.contentId === "event.treasure-vault") {
    return openTreasureVault(state, eventEntity);
  }
  if (eventEntity.contentId === "event.candle-gallery") {
    return openCandleGallery(state, eventEntity);
  }
  if (eventEntity.contentId === "event.bone-heap") {
    return openBoneHeap(state, eventEntity);
  }
  if (eventEntity.contentId === "event.furnace-chamber") {
    return openFurnaceChamber(state, eventEntity);
  }
  return state;
}

function triggerOathEcho(state: GameState, eventEntity: Entity): GameState {
  const player = getPlayer(state);
  const points = openPointsAround(state, eventEntity.pos, 1);
  const reward = player.contentId === "role.oathbound"
    ? (state.floor >= 5 ? "item.guardian-draught" : "item.greater-tonic")
    : "item.ember-tonic";
  state.entities.push(item(`${reward}.oath-echo.${state.turn}`, reward, points[0] ?? eventEntity.pos, state.floor, rngForFloor(state.seed + state.turn + 31, state.floor)));
  if (player.contentId === "role.oathbound") {
    state.runObjectives = { ...state.runObjectives, roleGoalProgress: state.runObjectives.roleGoalProgress + 1 };
    state.messages = pushMessage(state, "誓約の残響が応え、守り手へ挑むための備えを残した。", "loot");
  } else {
    state.messages = pushMessage(state, "誓約の残響は遠く、かすかな薬だけが残った。", "explore");
  }
  state.entities = state.entities.filter((entity) => entity.id !== eventEntity.id);
  return state;
}

function triggerScoutCache(state: GameState, eventEntity: Entity): GameState {
  const player = getPlayer(state);
  revealAround(state, eventEntity.pos, player.contentId === "role.ash-scout" ? 9 : 5);
  if (player.contentId === "role.ash-scout") {
    player.inventory ??= [];
    addInventoryItem(player, "item.ember-dart", 2);
    addInventoryItem(player, "item.glim-map", 1);
    state.runObjectives = { ...state.runObjectives, roleGoalProgress: state.runObjectives.roleGoalProgress + 1 };
    state.messages = pushMessage(state, "灰弓の隠し印を読み、予備の投げ針と小地図を回収した。", "loot");
  } else {
    state.messages = pushMessage(state, "古い斥候の印から、近くの道筋だけを読み取った。", "explore");
  }
  state.entities = state.entities.filter((entity) => entity.id !== eventEntity.id);
  return state;
}

function triggerLanternFont(state: GameState, eventEntity: Entity): GameState {
  const player = getPlayer(state);
  if (player.stats) {
    const healed = Math.min(player.contentId === "role.lantern-priest" ? 18 : 8, player.stats.maxHp - player.stats.hp);
    player.stats.hp += healed;
  }
  if (player.contentId === "role.lantern-priest") {
    player.conditions = clearConditions(player.conditions, ["bleeding", "venomed"]);
    player.conditions = upsertCondition(player.conditions, "guarded", roleTraits(player.contentId)?.priestGuardedTurns ?? 8);
    if (player.stats) {
      player.stats.defense = baseDefense(state.playerProgress) + defenseBonus(player);
    }
    state.runObjectives = { ...state.runObjectives, roleGoalProgress: state.runObjectives.roleGoalProgress + 1 };
    state.messages = pushMessage(state, "灯火の泉が穢れを払い、祈祷者の灯を強めた。", "loot");
  } else {
    state.messages = pushMessage(state, "灯火の泉で傷を少し洗い流した。", "loot");
  }
  state.entities = state.entities.filter((entity) => entity.id !== eventEntity.id);
  return state;
}

function openSealedRoom(state: GameState, eventEntity: Entity): GameState {
  const eventConfig = getGameConfig().events[eventEntity.contentId];
  const points = openPointsAround(state, eventEntity.pos, 2);
  const dangerBoost = state.floor;
  const secondGuard = eventConfig?.highFloorGuard && state.floor >= eventConfig.highFloorGuard.minFloor ? eventConfig.highFloorGuard.contentId : eventConfig?.encounters?.[1];
  const encounters = [eventConfig?.encounters?.[0], secondGuard].filter((contentId): contentId is string => !!contentId);
  for (const [index, contentId] of encounters.entries()) {
    const point = points.shift();
    if (point) {
      state.entities.push(monster(`${contentId}.sealed.${state.turn}.${index}`, contentId, point, statsForMonster(contentId, dangerBoost, state.floor, state.runObjectives)));
    }
  }
  const rewardPoint = points.shift();
  if (rewardPoint) {
    const reward = eventConfig?.highFloorReward && state.floor >= eventConfig.highFloorReward.minFloor ? eventConfig.highFloorReward.contentId : (eventConfig?.reward ?? "item.guardian-draught");
    state.entities.push(item(`${reward}.sealed.${state.turn}`, reward, rewardPoint, state.floor, rngForFloor(state.seed + state.turn, state.floor)));
  }
  revealAround(state, eventEntity.pos, eventConfig?.revealRadius ?? 4);
  state.entities = state.entities.filter((entity) => entity.id !== eventEntity.id);
  state.messages = pushMessage(state, "封印が割れ、守り手と備蓄が部屋に現れた。", "danger");
  return state;
}

function openDeadFeast(state: GameState, eventEntity: Entity): GameState {
  const eventConfig = getGameConfig().events[eventEntity.contentId];
  const points = openPointsAround(state, eventEntity.pos, 2);
  const dangerBoost = state.floor;
  for (const [index, contentId] of (eventConfig?.encounters ?? ["monster.bone-thrall", "monster.grave-leech", "monster.hollow-archer"]).entries()) {
    const point = points.shift();
    if (point) {
      state.entities.push(monster(`${contentId}.feast.${state.turn}.${index}`, contentId, point, statsForMonster(contentId, dangerBoost, state.floor, state.runObjectives)));
    }
  }
  for (const contentId of eventConfig?.loot ?? ["item.bloodmoss-salve", "item.coin-pouch"]) {
    const point = points.shift();
    if (point) {
      state.entities.push(item(`${contentId}.feast.${state.turn}`, contentId, point, state.floor, rngForFloor(state.seed + state.turn + points.length, state.floor)));
    }
  }
  revealAround(state, eventEntity.pos, eventConfig?.revealRadius ?? 4);
  state.entities = state.entities.filter((entity) => entity.id !== eventEntity.id);
  state.messages = pushMessage(state, "朽ちた食卓の周囲で亡者が目覚め、残された物資が見えた。", "danger");
  return state;
}

function openTreasureVault(state: GameState, eventEntity: Entity): GameState {
  const eventConfig = getGameConfig().events[eventEntity.contentId];
  const points = openPointsAround(state, eventEntity.pos, 2);
  const guardPoint = points.shift();
  if (guardPoint) {
    const guard = eventConfig?.highFloorGuard && state.floor >= eventConfig.highFloorGuard.minFloor ? eventConfig.highFloorGuard.contentId : (eventConfig?.guard ?? "monster.blackshield-grub");
    state.entities.push(monster(`${guard}.vault.${state.turn}`, guard, guardPoint, statsForMonster(guard, state.floor, state.floor, state.runObjectives)));
  }
  const reward = eventConfig?.highFloorReward && state.floor >= eventConfig.highFloorReward.minFloor ? eventConfig.highFloorReward.contentId : (eventConfig?.reward ?? "item.greater-tonic");
  for (const contentId of [...(eventConfig?.loot ?? ["item.coin-pouch"]), reward]) {
    const point = points.shift();
    if (point) {
      state.entities.push(item(`${contentId}.vault.${state.turn}`, contentId, point, state.floor, rngForFloor(state.seed + state.turn + points.length, state.floor)));
    }
  }
  const trapPoint = points.shift();
  if (trapPoint) {
    const trapId = eventConfig?.highFloorTrap && state.floor >= eventConfig.highFloorTrap.minFloor ? eventConfig.highFloorTrap.contentId : (eventConfig?.trap ?? "trap.blood-needle");
    state.entities.push(trap(`${trapId}.vault.${state.turn}`, trapId, trapPoint));
  }
  revealAround(state, eventEntity.pos, eventConfig?.revealRadius ?? 4);
  state.entities = state.entities.filter((entity) => entity.id !== eventEntity.id);
  state.messages = pushMessage(state, "宝物庫の扉が開き、財宝と守りの罠が露わになった。", "loot");
  return state;
}

function openCandleGallery(state: GameState, eventEntity: Entity): GameState {
  const points = openPointsAround(state, eventEntity.pos, 3);
  revealAround(state, eventEntity.pos, 7);
  const guard = state.floor >= 4 ? "monster.cinder-cultist" : "monster.hollow-archer";
  const guardPoint = points.shift();
  if (guardPoint) {
    state.entities.push(monster(`${guard}.gallery.${state.turn}`, guard, guardPoint, statsForMonster(guard, state.floor, state.floor, state.runObjectives)));
  }
  const rewardPoint = points.shift();
  if (rewardPoint) {
    const reward = state.floor >= 5 ? "item.sealed-prayer-strip" : "item.glim-map";
    state.entities.push(item(`${reward}.gallery.${state.turn}`, reward, rewardPoint, state.floor, rngForFloor(state.seed + state.turn + 41, state.floor)));
  }
  state.entities = state.entities.filter((entity) => entity.id !== eventEntity.id);
  state.messages = pushMessage(state, "燭台廊に火が移り、部屋の輪郭と待ち伏せが浮かび上がった。", "danger");
  return state;
}

function openBoneHeap(state: GameState, eventEntity: Entity): GameState {
  const points = openPointsAround(state, eventEntity.pos, 3);
  const encounters = state.floor >= 4 ? ["monster.grave-leech", "monster.bone-thrall", "monster.hollow-archer"] : ["monster.bone-thrall", "monster.grave-leech"];
  for (const [index, contentId] of encounters.entries()) {
    const point = points.shift();
    if (point) {
      state.entities.push(monster(`${contentId}.bone-heap.${state.turn}.${index}`, contentId, point, statsForMonster(contentId, state.floor, state.floor, state.runObjectives)));
    }
  }
  for (const contentId of ["item.coin-pouch", state.floor >= 4 ? "item.bloodmoss-salve" : "item.ember-tonic"]) {
    const point = points.shift();
    if (point) {
      state.entities.push(item(`${contentId}.bone-heap.${state.turn}`, contentId, point, state.floor, rngForFloor(state.seed + state.turn + points.length, state.floor)));
    }
  }
  revealAround(state, eventEntity.pos, 5);
  state.entities = state.entities.filter((entity) => entity.id !== eventEntity.id);
  state.messages = pushMessage(state, "骨塚が崩れ、亡者と残された物資が散らばった。", "danger");
  return state;
}

function openFurnaceChamber(state: GameState, eventEntity: Entity): GameState {
  const points = openPointsAround(state, eventEntity.pos, 3);
  for (const point of points.slice(0, 2)) {
    if (tileAt(state, point).kind === "floor") {
      setTileKind(state.tiles, state.width, point.x, point.y, "cover");
    }
  }
  const guardPoint = points[2];
  if (guardPoint) {
    const guard = state.floor >= 7 ? "monster.blackstone-sentinel" : "monster.bramble-packling";
    state.entities.push(monster(`${guard}.furnace-room.${state.turn}`, guard, guardPoint, statsForMonster(guard, state.floor, state.floor, state.runObjectives)));
  }
  const trapPoint = points[3];
  if (trapPoint) {
    state.entities.push(trap(`trap.crumbling-floor.furnace-room.${state.turn}`, "trap.crumbling-floor", trapPoint));
  }
  const rewardPoint = points[4];
  if (rewardPoint) {
    const reward = state.floor >= 7 ? "item.void-prism" : "item.guardian-draught";
    state.entities.push(item(`${reward}.furnace-room.${state.turn}`, reward, rewardPoint, state.floor, rngForFloor(state.seed + state.turn + 59, state.floor)));
  }
  revealAround(state, eventEntity.pos, 5);
  state.entities = state.entities.filter((entity) => entity.id !== eventEntity.id);
  state.messages = pushMessage(state, "炉心室が唸り、遮蔽と崩れ床の向こうに守り手の影が立った。", "danger");
  return state;
}

function attack(state: GameState, attacker: Entity, defender: Entity): GameState {
  if (!attacker.stats || !defender.stats) {
    return state;
  }

  const rng = new Rng(state.seed + state.turn * 97 + attacker.id.length * 13);
  const specialDamage = attacker.kind === "player" ? equippedWeaponSpecialDamage(attacker, defender.contentId) : 0;
  const rawDamage = attacker.stats.attack + rng.int(0, getGameConfig().rules.attackRandomBonusMax) + specialDamage - defender.stats.defense;
  const damage = Math.max(1, rawDamage);
  defender.stats.hp -= damage;
  const attackerName = attacker.kind === "player" ? "あなた" : getContentName(attacker.contentId);
  const defenderName = defender.kind === "player" ? "あなた" : getContentName(defender.contentId);
  state.messages = pushMessage(state, `${attackerName}は${defenderName}に${damage}ダメージを与えた。`, "combat");
  if (specialDamage > 0) {
    state.messages = pushMessage(state, "太陽印が敵の穢れを焼いた。", "combat");
  }
  state = applyAttackSideEffect(state, attacker, defender);

  if (defender.stats.hp <= 0) {
    if (defender.kind === "player") {
      state.status = "lost";
      state.messages = pushMessage(state, "迷宮の暗闇に倒れた。", "danger");
    } else {
      const reward = bossRewardFor(defender.contentId);
      const defeatedPos = { ...defender.pos };
      state = awardXp(state, defender.contentId);
      state.entities = state.entities.filter((entity) => entity.id !== defender.id);
      state.messages = pushMessage(state, `${getContentName(defender.contentId)}を倒した。`, "combat");
      if (reward) {
        state.entities.push(item(`${reward}.boss.${state.floor}.${state.turn}`, reward, defeatedPos, state.floor, rngForFloor(state.seed + state.turn, state.floor)));
        state.messages = pushMessage(state, `${getContentName(reward)}が残された。`, "loot");
        state = dropBonusBossRewards(state, defeatedPos);
      }
      if (contentEntities[defender.contentId]?.tier === "boss") {
        state.story.bossesDefeated += 1;
      }
      state = applyRoleBossGoal(state, defender.contentId, defeatedPos);
    }
  }
  return state;
}

function bossRewardFor(contentId: string): string | null {
  return getGameConfig().bosses.find((boss) => boss.contentId === contentId)?.reward ?? null;
}

function dropBonusBossRewards(state: GameState, defeatedPos: Point): GameState {
  const bonus = state.runObjectives.bossRewardBonus;
  if (bonus <= 0) {
    return state;
  }
  const points = [{ ...defeatedPos }, ...openPointsAround(state, defeatedPos, 1)];
  const rewards = ["item.coin-pouch", state.floor >= 7 ? "item.void-prism" : "item.greater-tonic"].slice(0, Math.min(2, bonus));
  const rng = rngForFloor(state.seed + state.turn + bonus, state.floor);
  for (const [index, contentId] of rewards.entries()) {
    const point = points[index] ?? defeatedPos;
    state.entities.push(item(`${contentId}.boss-bonus.${state.floor}.${state.turn}.${index}`, contentId, point, state.floor, rng));
  }
  state.runObjectives = { ...state.runObjectives, bossRewardBonus: Math.max(0, bonus - rewards.length) };
  state.messages = pushMessage(state, "封印鍵の力で、守り手の遺物から追加の報酬がこぼれた。", "loot");
  return state;
}

function applyRoleBossGoal(state: GameState, defeatedContentId: string, defeatedPos: Point): GameState {
  const player = getPlayer(state);
  if (player.contentId !== "role.oathbound" || contentEntities[defeatedContentId]?.tier !== "boss") {
    return state;
  }
  const reward = state.floor >= 6 ? (roleTraits(player.contentId)?.bossReward ?? "item.guardian-draught") : "item.greater-tonic";
  const point = openPointsAround(state, defeatedPos, 1)[0] ?? defeatedPos;
  state.entities.push(item(`${reward}.oath-goal.${state.floor}.${state.turn}`, reward, point, state.floor, rngForFloor(state.seed + state.turn + 17, state.floor)));
  state.runObjectives = { ...state.runObjectives, roleGoalProgress: state.runObjectives.roleGoalProgress + 1 };
  state.messages = pushMessage(state, "誓約が応え、守り手撃破の報酬が増えた。", "loot");
  return state;
}

function applyScoutMappingGoal(state: GameState): GameState {
  const player = getPlayer(state);
  if (player.contentId !== "role.ash-scout") {
    return state;
  }
  const traits = roleTraits(player.contentId);
  revealAround(state, player.pos, traits?.scoutRevealRadius ?? 3);
  player.inventory ??= [];
  const bonusItem = traits?.scoutBonusItem ?? "item.ember-dart";
  const existing = player.inventory.find((entry) => entry.contentId === bonusItem);
  if (existing) {
    existing.quantity += 1;
  } else if (canReceiveInventory(player, bonusItem)) {
    player.inventory.push({ contentId: bonusItem, quantity: 1 });
  }
  state.runObjectives = { ...state.runObjectives, roleGoalProgress: state.runObjectives.roleGoalProgress + 1 };
  state.messages = pushMessage(state, "灰弓の斥候は地図の余白を読み、追加の道筋と投げ針を確保した。", "loot");
  return state;
}

function applyPriestCleansingGoal(state: GameState): GameState {
  const player = getPlayer(state);
  if (player.contentId !== "role.lantern-priest" || !player.stats) {
    return state;
  }
  player.conditions = clearConditions(player.conditions, ["bleeding", "venomed"]);
  player.conditions = upsertCondition(player.conditions, "guarded", roleTraits(player.contentId)?.priestGuardedTurns ?? 6);
  player.stats.defense = baseDefense(state.playerProgress) + defenseBonus(player);
  state.runObjectives = { ...state.runObjectives, roleGoalProgress: state.runObjectives.roleGoalProgress + 1 };
  state.messages = pushMessage(state, "灯火の祈祷者は浄化の余熱を護りに変えた。", "loot");
  return state;
}

function pickupAtPlayer(state: GameState): GameState {
  const player = getPlayer(state);
  const itemEntity = state.entities.find((entity) => entity.kind === "item" && samePoint(entity.pos, player.pos));
  if (!itemEntity) {
    state.messages = pushMessage(state, "拾えるものはない。", "explore");
    return state;
  }

  if (itemEntity.contentId === "item.coin-pouch") {
    const amount = itemEntity.goldAmount ?? 0;
    state.playerProgress = normalizeProgress({ ...state.playerProgress, gold: state.playerProgress.gold + amount });
    state.entities = state.entities.filter((entity) => entity.id !== itemEntity.id);
    state.messages = pushMessage(state, `${amount} Goldを拾った。`, "loot");
    return state;
  }

  if (isInstantMappingItem(itemEntity.contentId)) {
    state.entities = state.entities.filter((entity) => entity.id !== itemEntity.id);
    return activateMappingPickup(state, itemEntity.contentId);
  }

  player.inventory ??= [];
  const existing = player.inventory.find((entry) => entry.contentId === itemEntity.contentId);
  if (!existing && player.inventory.length >= getGameConfig().rules.inventorySlotLimit) {
    state.messages = pushMessage(state, `所持品がいっぱいで${getContentName(itemEntity.contentId)}を拾えない。不要なものを選んで捨てられる。`, "danger");
    return state;
  }
  let pickedEntry = existing;
  if (existing) {
    existing.quantity += 1;
  } else {
    pickedEntry = { contentId: itemEntity.contentId, quantity: 1 };
    player.inventory.push(pickedEntry);
  }
  state.entities = state.entities.filter((entity) => entity.id !== itemEntity.id);
  state.messages = pushMessage(state, `${getContentName(itemEntity.contentId)}を拾った。`, "loot");
  if (pickedEntry && shouldAutoEquip(player, itemEntity.contentId)) {
    state = equipItem(state, itemEntity.contentId);
  }
  return state;
}

function isInstantMappingItem(contentId: string): boolean {
  const consumable = getGameConfig().consumables[contentId];
  return !!consumable && (contentId === "item.mapping-scroll" || contentId === "item.glim-map") && (!!consumable.revealFloor || !!consumable.revealRadius);
}

function activateMappingPickup(state: GameState, contentId: string): GameState {
  const player = getPlayer(state);
  const consumable = getGameConfig().consumables[contentId];
  if (consumable?.revealFloor) {
    for (const tile of state.tiles) {
      if (tile.kind !== "wall") {
        tile.explored = true;
      }
    }
    state.messages = pushMessage(state, `${getContentName(contentId)}を拾った瞬間に燃え、現在階の通路が頭に刻まれた。`, "loot");
    state = applyScoutMappingGoal(state);
    return state;
  }
  revealAround(state, player.pos, consumable?.revealRadius ?? 8);
  state.messages = pushMessage(state, `${getContentName(contentId)}を拾った瞬間に開き、近くの部屋と通路が浮かび上がった。`, "loot");
  state = applyScoutMappingGoal(state);
  return state;
}

function dropItemAtPlayer(state: GameState, contentId: string): GameState {
  const player = getPlayer(state);
  const entry = player.inventory?.find((itemEntry) => itemEntry.contentId === contentId);
  if (!entry) {
    state.messages = pushMessage(state, "捨てられる所持品ではない。", "explore");
    return state;
  }

  entry.quantity -= 1;
  if (entry.quantity <= 0) {
    player.inventory = player.inventory?.filter((itemEntry) => itemEntry.quantity > 0);
  }
  state.entities.push(item(`${contentId}.dropped.${state.turn}`, contentId, { ...player.pos }, state.floor, rngForFloor(state.seed + state.turn, state.floor)));
  state.messages = pushMessage(state, `${getContentName(contentId)}を足元に置いた。`, "loot");
  if (entry.equipped && player.stats) {
    player.stats.attack = baseAttack(state.playerProgress) + weaponBonus(player);
    player.stats.defense = baseDefense(state.playerProgress) + defenseBonus(player);
  }
  return reevaluateEquipment(state);
}

function useItem(state: GameState, contentId: string): GameState {
  const player = getPlayer(state);
  const entry = player.inventory?.find((itemEntry) => itemEntry.contentId === contentId);
  if (!entry || entry.quantity <= 0 || !player.stats) {
    state.messages = pushMessage(state, "そのアイテムは使えない。", "explore");
    return state;
  }

  if (equipmentSlot(contentId)) {
    return equipItem(state, contentId);
  }

  const consumable = getGameConfig().consumables[contentId];

  if (consumable?.mysteryEffects?.length) {
    return useMysteryConsumable(state, player, entry, contentId, consumable.mysteryEffects);
  }

  if (consumable?.heal && !consumable.cureConditions && !consumable.revealRadius && !consumable.pushVisibleMonsters && !consumable.guardedTurns && !consumable.rangedDamage) {
    const healAmount = consumable.heal;
    const healed = Math.min(healAmount, player.stats.maxHp - player.stats.hp);
    player.stats.hp += healed;
    entry.quantity -= 1;
    if (entry.quantity <= 0) {
      player.inventory = player.inventory?.filter((itemEntry) => itemEntry.quantity > 0);
    }
    state.messages = pushMessage(state, `${getContentName(contentId)}でHPが${healed}回復した。`, "loot");
    return state;
  }

  if (consumable?.guardedTurns && !consumable.revealRadius && !consumable.pushVisibleMonsters && !consumable.heal) {
    player.conditions = upsertCondition(player.conditions, "guarded", consumable.guardedTurns);
    player.stats.defense = baseDefense(state.playerProgress) + defenseBonus(player);
    consumeInventoryEntry(player, entry);
    state.messages = pushMessage(state, "護りの薬液が青く巡り、しばらく防御が上がった。", "loot");
    return state;
  }

  if (contentId === "item.bloodmoss-salve") {
    const healed = Math.min(consumable?.heal ?? 22, player.stats.maxHp - player.stats.hp);
    player.stats.hp += healed;
    player.conditions = clearConditions(player.conditions, consumable?.cureConditions ?? ["bleeding", "venomed"]);
    consumeInventoryEntry(player, entry);
    state.messages = pushMessage(state, `血苔の軟膏でHPが${healed}回復し、毒と出血を抑えた。`, "loot");
    state = applyPriestCleansingGoal(state);
    return state;
  }

  if (consumable?.revealFloor) {
    for (const tile of state.tiles) {
      if (tile.kind !== "wall") {
        tile.explored = true;
      }
    }
    entry.quantity -= 1;
    if (entry.quantity <= 0) {
      player.inventory = player.inventory?.filter((itemEntry) => itemEntry.quantity > 0);
    }
    state.messages = pushMessage(state, "地脈図が燃え、現在階の通路が頭に刻まれた。", "loot");
    state = applyScoutMappingGoal(state);
    return state;
  }

  if (contentId === "item.glim-map") {
    revealAround(state, player.pos, consumable?.revealRadius ?? 8);
    consumeInventoryEntry(player, entry);
    state.messages = pushMessage(state, "微光の小地図が開き、近くの部屋と通路が浮かび上がった。", "loot");
    state = applyScoutMappingGoal(state);
    return state;
  }

  if (contentId === "item.repulsion-scroll") {
    const pushed = pushVisibleMonstersAway(state, player.pos);
    consumeInventoryEntry(player, entry);
    state.messages = pushMessage(state, pushed > 0 ? `${getContentName(contentId)}の風で${pushed}体の敵を押し戻した。` : "巻物の風は虚しく消えた。", "combat");
    return state;
  }

  if (contentId === "item.void-prism") {
    revealAround(state, player.pos, consumable?.revealRadius ?? 12);
    const pushed = pushVisibleMonstersAway(state, player.pos);
    consumeInventoryEntry(player, entry);
    state.messages = pushMessage(state, `虚空の角晶が割れ、広い範囲を照らして${pushed}体の敵を遠ざけた。`, "loot");
    state = applyScoutMappingGoal(state);
    return state;
  }

  if (contentId === "item.grave-sun-charm") {
    const healed = Math.min(consumable?.heal ?? 24, player.stats.maxHp - player.stats.hp);
    player.stats.hp += healed;
    player.conditions = clearConditions(player.conditions, consumable?.cureConditions ?? ["bleeding", "venomed"]);
    if (consumable?.guardedTurns) {
      player.conditions = upsertCondition(player.conditions, "guarded", consumable.guardedTurns);
      player.stats.defense = baseDefense(state.playerProgress) + defenseBonus(player);
    }
    consumeInventoryEntry(player, entry);
    state.messages = pushMessage(state, `墓陽の護符でHPが${healed}回復し、毒と出血を払い、短い護りを得た。`, "loot");
    state = applyPriestCleansingGoal(state);
    return state;
  }

  if (contentId === "item.colossus-heart") {
    player.conditions = upsertCondition(player.conditions, "guarded", consumable?.guardedTurns ?? 24);
    player.stats.defense = baseDefense(state.playerProgress) + defenseBonus(player);
    consumeInventoryEntry(player, entry);
    state.messages = pushMessage(state, "巨像の炉心片が脈打ち、長めの護りを得た。", "loot");
    return state;
  }

  if (contentId === "item.black-candle-core") {
    revealAround(state, player.pos, consumable?.revealRadius ?? 14);
    const pushed = pushVisibleMonstersAway(state, player.pos);
    const healed = Math.min(consumable?.heal ?? 20, player.stats.maxHp - player.stats.hp);
    player.stats.hp += healed;
    consumeInventoryEntry(player, entry);
    state.messages = pushMessage(state, `黒燭核が闇を吸い、HPが${healed}回復して${pushed}体の敵を遠ざけた。`, "loot");
    return state;
  }

  if (consumable?.rangedDamage) {
    const target = nearestVisibleMonster(state);
    if (!target?.stats) {
      state.messages = pushMessage(state, "投げ針を投げる相手が見えない。", "explore");
      return state;
    }

    const damage = consumable.rangedDamage + Math.floor(state.floor / 2);
    target.stats.hp -= damage;
    entry.quantity -= 1;
    if (entry.quantity <= 0) {
      player.inventory = player.inventory?.filter((itemEntry) => itemEntry.quantity > 0);
    }
    state.messages = pushMessage(state, `${getContentName(contentId)}を投げ、${getContentName(target.contentId)}に${damage}ダメージを与えた。`, "combat");
    if (target.stats.hp <= 0) {
      const reward = bossRewardFor(target.contentId);
      const defeatedPos = { ...target.pos };
      state = awardXp(state, target.contentId);
      state.entities = state.entities.filter((entity) => entity.id !== target.id);
      state.messages = pushMessage(state, `${getContentName(target.contentId)}を倒した。`, "combat");
      if (reward) {
        state.entities.push(item(`${reward}.boss.${state.floor}.${state.turn}`, reward, defeatedPos, state.floor, rngForFloor(state.seed + state.turn, state.floor)));
        state.messages = pushMessage(state, `${getContentName(reward)}が残された。`, "loot");
        state = dropBonusBossRewards(state, defeatedPos);
      }
      state = applyRoleBossGoal(state, target.contentId, defeatedPos);
    }
    return state;
  }

  state.messages = pushMessage(state, "まだ効果が定義されていない。", "explore");
  return state;
}

function useMysteryConsumable(
  state: GameState,
  player: Entity,
  entry: NonNullable<Entity["inventory"]>[number],
  contentId: string,
  effects: NonNullable<GameConfig["consumables"][string]["mysteryEffects"]>,
): GameState {
  if (!player.stats || effects.length === 0) {
    return state;
  }
  const rng = new Rng(state.seed + state.floor * 389 + state.turn * 47 + contentId.length * 23);
  let effect = rng.pick(effects);
  if (player.contentId === "role.lantern-priest" && (effect === "bleed" || effect === "venom")) {
    const saferEffects = effects.filter((candidate) => candidate !== "bleed" && candidate !== "venom");
    effect = saferEffects.length > 0 ? rng.pick(saferEffects) : "guard";
  }
  consumeInventoryEntry(player, entry);

  if (effect === "heal") {
    const healed = Math.min(12 + Math.floor(state.floor / 2), player.stats.maxHp - player.stats.hp);
    player.stats.hp += healed;
    state.messages = pushMessage(state, `${getContentName(contentId)}の正体は温かな薬液だった。HPが${healed}回復した。`, "loot");
    return state;
  }
  if (effect === "guard") {
    player.conditions = upsertCondition(player.conditions, "guarded", 10);
    player.stats.defense = baseDefense(state.playerProgress) + defenseBonus(player);
    state.messages = pushMessage(state, `${getContentName(contentId)}から護りの紋が立ち上がった。`, "loot");
    return state;
  }
  if (effect === "reveal") {
    revealAround(state, player.pos, 7);
    state.messages = pushMessage(state, `${getContentName(contentId)}が淡く燃え、近くの道筋を暴いた。`, "explore");
    return applyScoutMappingGoal(state);
  }
  if (effect === "push") {
    const pushed = pushVisibleMonstersAway(state, player.pos);
    state.messages = pushMessage(state, `${getContentName(contentId)}が破裂し、${pushed}体の敵を押し戻した。`, "combat");
    return state;
  }
  if (effect === "bleed") {
    player.stats.hp -= 3 + Math.floor(state.floor / 3);
    player.conditions = upsertCondition(player.conditions, "bleeding", 4);
    state.messages = pushMessage(state, `${getContentName(contentId)}の封が裂け、黒い血針が腕を走った。`, "danger");
  } else {
    player.stats.hp -= 2 + Math.floor(state.floor / 4);
    player.conditions = upsertCondition(player.conditions, "venomed", 4);
    state.messages = pushMessage(state, `${getContentName(contentId)}から苦い毒気が漏れた。`, "danger");
  }
  if (player.stats.hp <= 0) {
    state.status = "lost";
    state.messages = pushMessage(state, "不安定な遺物に命を奪われ、迷宮の暗闇に沈んだ。", "danger");
  }
  return state;
}

function equipItem(state: GameState, contentId: string): GameState {
  const player = getPlayer(state);
  const entry = player.inventory?.find((itemEntry) => itemEntry.contentId === contentId);
  if (!entry) {
    state.messages = pushMessage(state, "装備できる所持品ではない。", "explore");
    return state;
  }

  const slot = equipmentSlot(contentId);
  if (!slot) {
    state.messages = pushMessage(state, "装備品ではない。", "explore");
    return state;
  }

  for (const itemEntry of player.inventory ?? []) {
    if (equipmentSlot(itemEntry.contentId) === slot) {
      itemEntry.equipped = false;
    }
  }
  entry.equipped = true;
  if (player.stats) {
    player.stats.attack = baseAttack(state.playerProgress) + weaponBonus(player);
    player.stats.defense = baseDefense(state.playerProgress) + defenseBonus(player);
  }
  state.messages = pushMessage(state, `${getContentName(contentId)}を装備した。`, "loot");
  return state;
}

function shouldAutoEquip(player: Entity, contentId: string): boolean {
  const slot = equipmentSlot(contentId);
  if (!slot) {
    return false;
  }

  const current = player.inventory?.find((entry) => entry.equipped && equipmentSlot(entry.contentId) === slot)?.contentId;
  if (!current) {
    return true;
  }
  if (slot === "weapon") {
    return weaponPower(contentId) > weaponPower(current);
  }
  if (slot === "armor") {
    return armorPower(contentId) > armorPower(current);
  }
  if (slot === "shield") {
    return shieldPower(contentId) > shieldPower(current);
  }
  return false;
}

function weaponPower(contentId: string): number {
  const equipment = getGameConfig().equipment[contentId];
  return equipment?.slot === "weapon" ? equipment.power : 0;
}

function armorPower(contentId: string): number {
  const equipment = getGameConfig().equipment[contentId];
  return equipment?.slot === "armor" ? equipment.power : 0;
}

function shieldPower(contentId: string): number {
  const equipment = getGameConfig().equipment[contentId];
  return equipment?.slot === "shield" ? equipment.power : 0;
}

function awardXp(state: GameState, defeatedContentId: string): GameState {
  const reward = contentEntities[defeatedContentId]?.xpReward ?? 5;
  state.playerProgress = normalizeProgress({ ...state.playerProgress, xp: state.playerProgress.xp + reward });
  state.messages = pushMessage(state, `${reward} XPを得た。`, "loot");
  return applyLevelUps(state);
}

function buyMerchantService(state: GameState, serviceId: MerchantServiceId): GameState {
  const player = getPlayer(state);
  if (!isPlayerOnMerchant(state)) {
    state.messages = pushMessage(state, "近くに取引できる商人はいない。", "explore");
    return state;
  }

  const offer = merchantOffersForState(state)
    .filter((candidate) => candidate.serviceId === serviceId)
    .filter((candidate) => state.playerProgress.gold >= candidate.cost)
    .filter((candidate) => isMerchantOfferUseful(state, player, candidate))
    .sort((a, b) => merchantOfferScore(state, player, b) - merchantOfferScore(state, player, a))[0];
  if (!offer) {
    state.messages = pushMessage(state, "旅商人は首を振った。今はそのサービスを受けられない。", "explore");
    return state;
  }

  state.playerProgress = normalizeProgress({ ...state.playerProgress, gold: state.playerProgress.gold - offer.cost });
  state = applyMerchantOffer(state, player, offer);
  state.messages = pushMessage(state, `旅商人に${merchantServiceLabel(offer.serviceId, offer.contentId)}を頼み、${offer.cost} Goldを支払った。`, "loot");
  return reevaluateEquipment(state);
}

function applyMerchantOffer(state: GameState, player: Entity, offer: ReturnType<typeof merchantOffersForState>[number]): GameState {
  player.inventory ??= [];
  if (offer.serviceId === "heal" && player.stats) {
    player.stats.hp = Math.min(player.stats.maxHp, player.stats.hp + (offer.heal ?? 24));
    return state;
  }
  if (offer.serviceId === "cure") {
    player.conditions = clearConditions(player.conditions, offer.cureConditions ?? ["bleeding", "venomed"]);
    if (offer.heal && player.stats) {
      player.stats.hp = Math.min(player.stats.maxHp, player.stats.hp + offer.heal);
    }
    state = applyPriestCleansingGoal(state);
    return state;
  }
  if (!offer.contentId) {
    return state;
  }
  const existing = player.inventory.find((entry) => entry.contentId === offer.contentId);
  if (existing) {
    existing.quantity += 1;
  } else {
    player.inventory.push({ contentId: offer.contentId, quantity: 1 });
  }
  if (offer.serviceId === "map") {
    state = applyScoutMappingGoal(state);
  }
  return state;
}

function merchantOffersForState(state: GameState): GameConfig["merchantOffers"] {
  const player = getPlayer(state);
  const hpRatio = player.stats ? player.stats.hp / player.stats.maxHp : 1;
  const biome = biomeThemeForFloor(state.floor);
  return getGameConfig().merchantOffers.filter((offer) => {
    if (!floorRuleMatches(offer, state.floor, biome)) {
      return false;
    }
    if (offer.requireHpRatioAtMost !== undefined && hpRatio > offer.requireHpRatioAtMost) {
      return false;
    }
    if (offer.requireCondition && !player.conditions?.length) {
      return false;
    }
    if (offer.contentId && !canReceiveInventory(player, offer.contentId)) {
      return false;
    }
    return true;
  });
}

function isPlayerOnMerchant(state: GameState): boolean {
  const player = getPlayer(state);
  return state.entities.some((entity) => entity.kind === "event" && entity.contentId === "event.wayfarer-merchant" && samePoint(entity.pos, player.pos));
}

function isMerchantOfferUseful(state: GameState, player: Entity, offer: GameConfig["merchantOffers"][number]): boolean {
  if (offer.serviceId === "heal") {
    return !!player.stats && player.stats.hp < player.stats.maxHp;
  }
  if (offer.serviceId === "cure") {
    return player.conditions?.some((condition) => (offer.cureConditions ?? ["bleeding", "venomed"]).includes(condition.kind)) ?? false;
  }
  if (offer.serviceId === "equipment" && offer.contentId) {
    return equipmentScore(offer.contentId) > equippedSlotScore(player, offer.contentId);
  }
  if (offer.serviceId === "map" && offer.contentId) {
    return state.tiles.filter((tile) => tile.explored).length < state.tiles.length * 0.85;
  }
  return !!offer.contentId;
}

function merchantOfferScore(state: GameState, player: Entity, offer: GameConfig["merchantOffers"][number]): number {
  if (offer.serviceId === "heal" && player.stats) {
    return player.stats.maxHp - player.stats.hp;
  }
  if (offer.serviceId === "cure") {
    return 100 + (player.conditions?.length ?? 0) * 10;
  }
  if (offer.serviceId === "equipment" && offer.contentId) {
    return equipmentScore(offer.contentId) - equippedSlotScore(player, offer.contentId);
  }
  if (offer.serviceId === "map") {
    return state.tiles.length - state.tiles.filter((tile) => tile.explored).length;
  }
  return 0;
}

function equippedSlotScore(player: Entity, contentId: string): number {
  const slot = equipmentSlot(contentId);
  const current = player.inventory?.find((entry) => entry.equipped && equipmentSlot(entry.contentId) === slot)?.contentId;
  return current ? equipmentScore(current) : 0;
}

function merchantServiceLabel(serviceId: MerchantServiceId, contentId?: string): string {
  if (serviceId === "heal") {
    return "回復";
  }
  if (serviceId === "cure") {
    return "解毒・止血";
  }
  if (serviceId === "equipment") {
    return contentId ? `装備購入: ${getContentName(contentId)}` : "装備購入";
  }
  return contentId ? `地図購入: ${getContentName(contentId)}` : "地図購入";
}

function canReceiveInventory(player: Entity, contentId: string): boolean {
  const inventory = player.inventory ?? [];
  return inventory.some((entry) => entry.contentId === contentId) || inventory.length < getGameConfig().rules.inventorySlotLimit;
}

function addInventoryItem(player: Entity, contentId: string, quantity = 1): boolean {
  player.inventory ??= [];
  const existing = player.inventory.find((entry) => entry.contentId === contentId);
  if (existing) {
    existing.quantity += quantity;
    return true;
  }
  if (!canReceiveInventory(player, contentId)) {
    return false;
  }
  player.inventory.push({ contentId, quantity });
  return true;
}

function reevaluateEquipment(state: GameState): GameState {
  const player = getPlayer(state);
  if (!player.inventory || !player.stats) {
    return state;
  }
  for (const slot of ["weapon", "armor", "shield"] as const) {
    const best = [...player.inventory]
      .filter((entry) => equipmentSlot(entry.contentId) === slot)
      .sort((a, b) => equipmentScore(b.contentId) - equipmentScore(a.contentId))[0];
    if (!best || best.equipped) {
      continue;
    }
    for (const entry of player.inventory) {
      if (equipmentSlot(entry.contentId) === slot) {
        entry.equipped = false;
      }
    }
    best.equipped = true;
    state.messages = pushMessage(state, `${getContentName(best.contentId)}の方が有用だと判断して装備した。`, "loot");
  }
  player.stats.attack = baseAttack(state.playerProgress) + weaponBonus(player);
  player.stats.defense = baseDefense(state.playerProgress) + defenseBonus(player);
  return state;
}

function equipmentScore(contentId: string): number {
  const equipment = getGameConfig().equipment[contentId];
  const slot = equipmentSlot(contentId);
  const tacticalValue = ((equipment?.rangedDefense ?? 0) * 0.8) + (((equipment?.trapAvoidPercent ?? 0) - (equipment?.trapAvoidPenaltyPercent ?? 0)) / 12);
  if (slot === "weapon") {
    return weaponPower(contentId) + tacticalValue;
  }
  if (slot === "armor") {
    return armorPower(contentId) + tacticalValue;
  }
  if (slot === "shield") {
    return shieldPower(contentId) + tacticalValue;
  }
  return 0;
}

function equippedWeaponSpecialDamage(player: Entity, defenderContentId: string): number {
  const weapon = player.inventory?.find((entry) => entry.equipped && equipmentSlot(entry.contentId) === "weapon")?.contentId;
  const special = weapon ? getGameConfig().equipment[weapon]?.specialDamage : undefined;
  if (!special) {
    return 0;
  }
  const family = contentEntities[defenderContentId]?.family;
  return family && special.families.includes(family) ? special.amount : 0;
}

function applyLevelUps(state: GameState): GameState {
  const player = getPlayer(state);
  if (!player.stats) {
    return state;
  }

  let progress = state.playerProgress;
  const { rules } = getGameConfig();
  while (progress.level + 1 < rules.xpThresholds.length && progress.xp >= rules.xpThresholds[progress.level + 1]) {
    progress = { ...progress, level: progress.level + 1 };
    player.stats.maxHp += rules.levelUpMaxHp;
    player.stats.hp = Math.min(player.stats.maxHp, player.stats.hp + rules.levelUpHeal);
    player.stats.attack = baseAttack(progress) + weaponBonus(player);
    player.stats.defense = baseDefense(progress) + defenseBonus(player);
    state.messages = pushMessage(state, `Lv${progress.level}に上がった。最大HPと戦闘力が伸びた。`, "system");
  }
  state.playerProgress = normalizeProgress(progress);
  return state;
}

function baseAttack(progress: PlayerProgress): number {
  const { rules } = getGameConfig();
  return rules.baseAttack + Math.max(0, progress.level - 1) * rules.attackPerLevel;
}

function baseDefense(progress: PlayerProgress): number {
  const { rules } = getGameConfig();
  return rules.baseDefense + Math.floor(Math.max(0, progress.level - 1) / rules.defenseLevelsPerPoint);
}

function nearestVisibleMonster(state: GameState): Entity | null {
  const player = getPlayer(state);
  const visibleMonsters = state.entities.filter((entity) => entity.kind === "monster" && entity.hostile && tileAt(state, entity.pos).visible);
  return nearestPoint(visibleMonsters.map((entity) => entity.pos), player.pos)
    ? [...visibleMonsters].sort((a, b) => chebyshev(a.pos, player.pos) - chebyshev(b.pos, player.pos))[0] ?? null
    : null;
}

function applyAttackSideEffect(state: GameState, attacker: Entity, defender: Entity): GameState {
  if (defender.kind !== "player" || defender.stats?.hp === undefined || defender.stats.hp <= 0) {
    return state;
  }
  if (attacker.contentId === "monster.grave-leech" && attacker.stats) {
    const healed = Math.min(2, attacker.stats.maxHp - attacker.stats.hp);
    if (healed > 0) {
      attacker.stats.hp += healed;
      state.messages = pushMessage(state, "墓蛭が傷口に吸いつき、体を少し膨らませた。", "combat");
    }
  }
  const effect = getGameConfig().monsterAttackEffects[attacker.contentId];
  if (effect && attacker.contentId !== "monster.ash-warlock") {
    defender.conditions = upsertCondition(defender.conditions, effect.condition, effect.turns);
    state.messages = pushMessage(state, effect.message, "danger");
  }
  return state;
}

function rangedAttack(state: GameState, attacker: Entity, defender: Entity): GameState {
  if (!attacker.stats || !defender.stats) {
    return state;
  }
  const damage = Math.max(1, attacker.stats.attack - defender.stats.defense - rangedDefenseBonus(defender) + 1);
  defender.stats.hp -= damage;
  state.messages = pushMessage(state, `${getContentName(attacker.contentId)}は離れた位置からあなたに${damage}ダメージを与えた。`, "combat");
  const effect = getGameConfig().monsterAttackEffects[attacker.contentId];
  if (effect && !hasCondition(defender, effect.condition)) {
    defender.conditions = upsertCondition(defender.conditions, effect.condition, effect.turns);
    state.messages = pushMessage(state, effect.message, "danger");
  }
  if (defender.stats.hp <= 0) {
    state.status = "lost";
    state.messages = pushMessage(state, "迷宮の暗闇に倒れた。", "danger");
  }
  return state;
}

function isRangedMonster(contentId: string): boolean {
  return getGameConfig().rangedMonsters.includes(contentId);
}

function runMonsterTurn(state: GameState): GameState {
  const player = getPlayer(state);
  const monsters = state.entities.filter((entity) => entity.kind === "monster" && entity.stats);
  for (const monsterEntity of monsters) {
    if (state.status !== "playing") {
      break;
    }
    const distance = chebyshev(monsterEntity.pos, player.pos);
    if (shouldKeepDistance(monsterEntity.contentId) && distance <= 2 && hasLineOfSight(state, monsterEntity.pos, player.pos)) {
      const escaped = stepMonsterAwayFromPlayer(state, monsterEntity, player.pos);
      if (escaped) {
        state = escaped;
        continue;
      }
    }
    if (distance <= 1) {
      state = attack(state, monsterEntity, player);
      continue;
    }
    if (monsterEntity.contentId === "monster.ash-warlock" && distance <= getGameConfig().rules.rangedMonsterRange + 1 && hasLineOfSight(state, monsterEntity.pos, player.pos)) {
      const summoned = summonAshWarlockMinion(state, monsterEntity);
      if (summoned) {
        state = summoned;
        continue;
      }
    }
    if (isRangedMonster(monsterEntity.contentId) && distance <= getGameConfig().rules.rangedMonsterRange && hasLineOfSight(state, monsterEntity.pos, player.pos)) {
      state = rangedAttack(state, monsterEntity, player);
      continue;
    }
    if (distance <= getGameConfig().rules.monsterChaseRange && hasLineOfSight(state, monsterEntity.pos, player.pos)) {
      const nextStep = nextStepToward(state, monsterEntity.pos, player.pos);
      if (nextStep) {
        state = moveActor(state, monsterEntity.id, { x: nextStep.x - monsterEntity.pos.x, y: nextStep.y - monsterEntity.pos.y });
      }
    }
  }
  return state;
}

function shouldKeepDistance(contentId: string): boolean {
  return contentId === "monster.hollow-archer" || contentId === "monster.cinder-cultist" || contentId === "monster.ash-warlock" || contentId === "monster.shadow-imp";
}

function stepMonsterAwayFromPlayer(state: GameState, monsterEntity: Entity, playerPos: Point): GameState | null {
  const candidates = cardinalDeltas()
    .map((delta) => ({ x: monsterEntity.pos.x + delta.x, y: monsterEntity.pos.y + delta.y }))
    .filter((point) => inBounds(state, point) && isWalkable(tileAt(state, point).kind))
    .filter((point) => !state.entities.some((entity) => entity.blocksMovement && samePoint(entity.pos, point)))
    .sort((a, b) => chebyshev(b, playerPos) - chebyshev(a, playerPos));
  const target = candidates.find((point) => chebyshev(point, playerPos) > chebyshev(monsterEntity.pos, playerPos));
  if (!target) {
    return null;
  }
  monsterEntity.pos = target;
  if (tileAt(state, target).visible) {
    state.messages = pushMessage(state, `${getContentName(monsterEntity.contentId)}は間合いを取り直した。`, "combat");
  }
  return state;
}

function summonAshWarlockMinion(state: GameState, warlock: Entity): GameState | null {
  if (state.turn % 5 !== 0) {
    return null;
  }
  const nearbyMinions = state.entities.filter(
    (entity) => entity.kind === "monster" && (entity.contentId === "monster.ember-moth" || entity.contentId === "monster.ash-rat") && chebyshev(entity.pos, warlock.pos) <= 4,
  ).length;
  if (nearbyMinions >= 2) {
    return null;
  }
  const point = openPointsAround(state, warlock.pos, 2)[0];
  if (!point) {
    return null;
  }
  const contentId = state.floor >= 7 ? "monster.ember-moth" : "monster.ash-rat";
  state.entities.push(monster(`${contentId}.summoned.${state.floor}.${state.turn}`, contentId, point, statsForMonster(contentId, state.floor - 1, state.floor, state.runObjectives)));
  if (tileAt(state, warlock.pos).visible || tileAt(state, point).visible) {
    state.messages = pushMessage(state, `${getContentName(warlock.contentId)}が灰の中から${getContentName(contentId)}を呼び出した。`, "combat");
  }
  return state;
}

function tickPlayerConditions(state: GameState): GameState {
  const player = getPlayer(state);
  if (!player.stats) {
    return state;
  }
  const { rules } = getGameConfig();
  if (player.inventory?.some((entry) => entry.equipped && entry.contentId === "item.moonlit-mail") && state.turn > 0 && state.turn % rules.moonlitMailRegenEveryTurns === 0) {
    const healed = Math.min(rules.moonlitMailRegenAmount, player.stats.maxHp - player.stats.hp);
    if (healed > 0) {
      player.stats.hp += healed;
      state.messages = pushMessage(state, "月光鎖帷子が淡く脈打ち、HPが1回復した。", "loot");
    }
  }
  if (!player.conditions?.length) {
    return state;
  }

  const beforeGuarded = hasCondition(player, "guarded");
  const activeConditions = player.conditions;
  if (hasCondition(player, "bleeding")) {
    player.stats.hp -= rules.bleedingDamage;
    state.messages = pushMessage(state, `出血で${rules.bleedingDamage}ダメージを受けた。`, "danger");
  }
  if (hasCondition(player, "venomed")) {
    player.stats.hp -= rules.venomedDamage;
    state.messages = pushMessage(state, `毒で${rules.venomedDamage}ダメージを受けた。`, "danger");
  }
  player.conditions = activeConditions.map((condition) => ({ ...condition, turns: condition.turns - 1 })).filter((condition) => condition.turns > 0);
  const afterGuarded = hasCondition(player, "guarded");
  if (beforeGuarded && !afterGuarded) {
    player.stats.defense = baseDefense(state.playerProgress) + defenseBonus(player);
    state.messages = pushMessage(state, "護りの薬効が薄れた。", "explore");
  }
  if (player.stats.hp <= 0) {
    state.status = "lost";
    state.messages = pushMessage(state, "迷宮の暗闇に倒れた。", "danger");
  }
  return state;
}

function consumeInventoryEntry(player: Entity, entry: NonNullable<Entity["inventory"]>[number]): void {
  entry.quantity -= 1;
  if (entry.quantity <= 0) {
    player.inventory = player.inventory?.filter((itemEntry) => itemEntry.quantity > 0);
  }
}

function revealAround(state: GameState, center: Point, radius: number): void {
  for (let y = Math.max(0, center.y - radius); y <= Math.min(state.height - 1, center.y + radius); y += 1) {
    for (let x = Math.max(0, center.x - radius); x <= Math.min(state.width - 1, center.x + radius); x += 1) {
      if (manhattan({ x, y }, center) <= radius && tileAt(state, { x, y }).kind !== "wall") {
        tileAt(state, { x, y }).explored = true;
      }
    }
  }
}

function revealKnownTrapTiles(state: GameState, limit: number, origin: Point): number {
  const hiddenTraps = state.entities
    .filter((entity) => entity.kind === "trap" && !tileAt(state, entity.pos).explored)
    .sort((a, b) => manhattan(a.pos, origin) - manhattan(b.pos, origin))
    .slice(0, Math.max(0, limit));
  for (const trapEntity of hiddenTraps) {
    tileAt(state, trapEntity.pos).explored = true;
  }
  return hiddenTraps.length;
}

function weakenLateEnemies(state: GameState): void {
  if (state.floor < 7) {
    return;
  }
  for (const entity of state.entities) {
    if (entity.kind !== "monster" || !entity.stats || contentEntities[entity.contentId]?.tier === "boss") {
      continue;
    }
    const nextMaxHp = Math.max(1, Math.floor(entity.stats.maxHp * 0.85));
    entity.stats.maxHp = nextMaxHp;
    entity.stats.hp = Math.min(entity.stats.hp, nextMaxHp);
    entity.stats.attack = Math.max(1, entity.stats.attack - 1);
  }
}

function pushVisibleMonstersAway(state: GameState, origin: Point): number {
  let pushed = 0;
  const monsters = state.entities.filter((entity) => entity.kind === "monster" && entity.hostile && tileAt(state, entity.pos).visible);
  for (const monsterEntity of monsters) {
    const dx = Math.sign(monsterEntity.pos.x - origin.x);
    const dy = Math.sign(monsterEntity.pos.y - origin.y);
    const target = { x: monsterEntity.pos.x + dx * 2, y: monsterEntity.pos.y + dy * 2 };
    const midpoint = { x: monsterEntity.pos.x + dx, y: monsterEntity.pos.y + dy };
    const destination = canPushInto(state, target) ? target : canPushInto(state, midpoint) ? midpoint : null;
    if (!destination) {
      continue;
    }
    monsterEntity.pos = destination;
    pushed += 1;
  }
  return pushed;
}

function canPushInto(state: GameState, point: Point): boolean {
  return inBounds(state, point) && isWalkable(tileAt(state, point).kind) && !state.entities.some((entity) => entity.blocksMovement && samePoint(entity.pos, point));
}

function openPointsAround(state: GameState, center: Point, radius: number): Point[] {
  const points: Point[] = [];
  for (let y = center.y - radius; y <= center.y + radius; y += 1) {
    for (let x = center.x - radius; x <= center.x + radius; x += 1) {
      const point = { x, y };
      if (!inBounds(state, point) || samePoint(point, center) || !isWalkable(tileAt(state, point).kind)) {
        continue;
      }
      if (state.entities.some((entity) => samePoint(entity.pos, point))) {
        continue;
      }
      points.push(point);
    }
  }
  return points.sort((a, b) => manhattan(a, center) - manhattan(b, center));
}

function upsertCondition(conditions: Entity["conditions"] = [], kind: ConditionKind, turns: number): Entity["conditions"] {
  const next = conditions.filter((condition) => condition.kind !== kind);
  next.push({ kind, turns });
  return next;
}

function clearCondition(conditions: Entity["conditions"] = [], kind: ConditionKind): Entity["conditions"] {
  return conditions.filter((condition) => condition.kind !== kind);
}

function clearConditions(conditions: Entity["conditions"] = [], kinds: ConditionKind[]): Entity["conditions"] {
  return kinds.reduce<NonNullable<Entity["conditions"]>>((next, kind) => clearCondition(next, kind) ?? [], conditions);
}

function hasCondition(entity: Entity, kind: ConditionKind): boolean {
  return entity.conditions?.some((condition) => condition.kind === kind && condition.turns > 0) ?? false;
}

function nextStepToward(state: GameState, from: Point, to: Point): Point | null {
  const passable = (x: number, y: number) => inBounds(state, { x, y }) && isWalkable(tileAt(state, { x, y }).kind);
  const astar = new ROT.Path.AStar(to.x, to.y, passable, { topology: 8 });
  const path: Point[] = [];
  astar.compute(from.x, from.y, (x, y) => path.push({ x, y }));
  const candidate = path[1];
  if (!candidate) {
    return null;
  }
  const blockedByMonster = state.entities.some(
    (entity) => entity.kind === "monster" && entity.blocksMovement && entity.pos.x === candidate.x && entity.pos.y === candidate.y,
  );
  return blockedByMonster ? null : candidate;
}

function updateVisibility(state: GameState): GameState {
  for (const tile of state.tiles) {
    tile.visible = false;
  }

  const player = getPlayer(state);
  const lightPasses = (x: number, y: number) => {
    const point = { x, y };
    return inBounds(state, point) && (samePoint(point, player.pos) || !blocksSight(tileAt(state, point).kind));
  };
  const fov = new ROT.FOV.PreciseShadowcasting(lightPasses, { topology: 8 });
  fov.compute(player.pos.x, player.pos.y, getGameConfig().rules.fovRadius, (x, y) => {
    if (!inBounds(state, { x, y })) {
      return;
    }
    const tile = tileAt(state, { x, y });
    tile.visible = true;
    tile.explored = true;
  });
  return state;
}

function hasLineOfSight(state: GameState, from: Point, to: Point): boolean {
  if (chebyshev(from, to) > getGameConfig().rules.fovRadius) {
    return false;
  }
  for (const point of linePoints(from, to)) {
    if (!inBounds(state, point) || blocksSight(tileAt(state, point).kind)) {
      return false;
    }
  }
  return true;
}

function getPlayer(state: GameState): Entity {
  const player = state.entities.find((entity) => entity.id === state.playerId);
  if (!player) {
    throw new Error("Missing player entity");
  }
  return player;
}

function pushMessage(state: GameState, text: string, tone: GameMessage["tone"]): GameMessage[] {
  return [...state.messages, message(state.turn, text, tone)].slice(-80);
}

function message(turn: number, text: string, tone: GameMessage["tone"]): GameMessage {
  return { turn, text, tone };
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    playerProgress: { ...state.playerProgress },
    runObjectives: { ...state.runObjectives },
    runIdentity: { ...state.runIdentity },
    knownRoleTruths: [...state.knownRoleTruths],
    pendingDecision: state.pendingDecision ? {
      ...state.pendingDecision,
      options: state.pendingDecision.options.map((option) => ({ ...option })),
    } : null,
    story: {
      ...state.story,
      discoveries: [...state.story.discoveries],
      decisions: state.story.decisions.map((entry) => ({ ...entry })),
      contextActs: [...state.story.contextActs],
      crisisKinds: [...state.story.crisisKinds],
    },
    tiles: state.tiles.map((tile) => ({ ...tile })),
    entities: state.entities.map((entity) => ({
      ...entity,
      pos: { ...entity.pos },
      stats: entity.stats ? { ...entity.stats } : undefined,
      inventory: entity.inventory?.map((entry) => ({ ...entry })),
      conditions: entity.conditions?.map((condition) => ({ ...condition })),
    })),
    messages: state.messages.map((entry) => ({ ...entry })),
  };
}

function setTileKind(tiles: Tile[], width: number, x: number, y: number, kind: TileKind): void {
  tiles[y * width + x].kind = kind;
}

function walkablePoints(tiles: Tile[], width: number): Point[] {
  return tiles.flatMap((tile, index) => {
    if (!isWalkable(tile.kind)) {
      return [];
    }
    return [{ x: index % width, y: Math.floor(index / width) }];
  });
}

function connectedWalkablePoints(tiles: Tile[], width: number, height: number, start: Point): Point[] {
  if (!isWalkable(tileAt(tiles, width, start).kind)) {
    return [];
  }

  const queue: Point[] = [start];
  const visited = new Set<string>([pointKey(start)]);
  const points: Point[] = [];
  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor];
    cursor += 1;
    points.push(current);
    for (const delta of cardinalDeltas()) {
      const next = { x: current.x + delta.x, y: current.y + delta.y };
      const key = pointKey(next);
      if (visited.has(key) || next.x < 0 || next.y < 0 || next.x >= width || next.y >= height || !isWalkable(tileAt(tiles, width, next).kind)) {
        continue;
      }
      visited.add(key);
      queue.push(next);
    }
  }
  return points;
}

function nearestPoint(points: Point[], target: Point): Point | null {
  let best: Point | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const distance = manhattan(point, target);
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return best;
}

function farthestPoint(points: Point[], target: Point): Point | null {
  let best: Point | null = null;
  let bestDistance = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const distance = manhattan(point, target);
    if (distance > bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return best;
}

function stairPoint(points: Point[], start: Point, rng: Rng): Point | null {
  const { rules } = getGameConfig();
  const minDistance = Math.floor((rules.mapWidth + rules.mapHeight) * 0.28);
  const maxDistance = Math.floor((rules.mapWidth + rules.mapHeight) * 0.5);
  const candidates = points.filter((point) => {
    const distance = manhattan(point, start);
    return distance >= minDistance && distance <= maxDistance;
  });
  if (candidates.length === 0) {
    return null;
  }
  return rng.pick(candidates);
}

function tileAt(state: GameState, pos: Point): Tile;
function tileAt(tiles: Tile[], width: number, pos: Point): Tile;
function tileAt(stateOrTiles: GameState | Tile[], posOrWidth: Point | number, maybePos?: Point): Tile {
  if (Array.isArray(stateOrTiles)) {
    const width = posOrWidth as number;
    const pos = maybePos as Point;
    return stateOrTiles[pos.y * width + pos.x];
  }
  const state = stateOrTiles;
  const pos = posOrWidth as Point;
  return state.tiles[pos.y * state.width + pos.x];
}

function inBounds(state: GameState, pos: Point): boolean {
  return pos.x >= 0 && pos.y >= 0 && pos.x < state.width && pos.y < state.height;
}

function isWalkable(kind: TileKind): boolean {
  return kind === "floor" || kind === "cover" || kind === "stairsDown";
}

function blocksSight(kind: TileKind): boolean {
  return kind === "wall" || kind === "cover";
}

function linePoints(from: Point, to: Point): Point[] {
  const points: Point[] = [];
  let x0 = from.x;
  let y0 = from.y;
  const x1 = to.x;
  const y1 = to.y;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let error = dx - dy;

  while (!(x0 === x1 && y0 === y1)) {
    const doubleError = error * 2;
    if (doubleError > -dy) {
      error -= dy;
      x0 += sx;
    }
    if (doubleError < dx) {
      error += dx;
      y0 += sy;
    }
    if (!(x0 === x1 && y0 === y1)) {
      points.push({ x: x0, y: y0 });
    }
  }
  return points;
}

function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

function pointKey(point: Point): string {
  return `${point.x},${point.y}`;
}

function cardinalDeltas(): Point[] {
  return [DIRS.north, DIRS.south, DIRS.west, DIRS.east];
}

function chebyshev(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function manhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
