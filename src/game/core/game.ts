import { clearCondition, clearConditions, hasCondition, upsertCondition } from "./conditions";
import { equippedEffects, equippedSeals, preferredEquipment, equipmentSlot, weaponBonus, defenseBonus, canReceiveInventory, addInventoryItem, pieceName, roleDefinition, upgradeGain } from "./inventory";
import { biomeThemeForFloor, biomeThemeName, bossForFloor, eventPoolForFloor, guaranteedItemsForFloor, itemPoolForFloor, monsterPoolForFloor, trapPoolForFloor } from "../content/floors";
export { biomeThemeName } from "../content/floors";
import { bossPointNearStairs, buildFloorPlan, chooseCoverPoints, createPointTaker, generateFloorMap, rngForFloor, setTileKind } from "./generation";
import { buildExplorationStatus } from "./exploration";
import { cloneModifiers, cloneState, cloneStory, getPlayer } from "./state";
import { DIRECTION_DELTAS, blocksSight, chebyshev, inBounds, isWalkable, linePoints, manhattan, samePoint, tileAt } from "./spatial";
import { bossTrialDefinition, foundationBonus } from "./journey";
import * as ROT from "rot-js";
import { floorRuleMatches, getGameConfig, runRules } from "../content/config";
import { contentEntities, getContentName } from "../content/entities";
import type {
  Entity,
  GameAction,
  GameConfig,
  GameMessage,
  GameObservation,
  GameState,
  LanternRiteId,
  MerchantServiceId,
  MissionId,
  PlayerProgress,
  Point,
  RunObjectiveFlags,
  RunIdentity,
  RunModifiers,
  RoleTruthId,
  Stats,
  TrapKind,
} from "../types";
import { Rng } from "./rng";
import { clampNumber, hasLineOfSight, message, pushMessage, recordStrike, roleTraits } from "./stateOps";
import { bowFor, canReach, counterAttack, playerBowShot, playerWeaponAttack, registerDefeatHandler, thornsAttack, tickMonsterAfflictions } from "./combat";
import { drawEquipment, isEquipmentToken, resolveEquipmentToken, rollEquipmentPiece } from "./loot";
import { useSkill } from "./skills";
import { afterMonsterHitsPlayer, behaviorOf, onMonsterDefeated, packBonus, preMonsterTurn, tryRevive } from "./monsterBehaviors";
import { realtimeConfig } from "../content/realtime";
import { armDecision, createDynamics, recordLastMoment, repayFlame, telegraphTiles } from "./realtime";
import {
  createCheckpointDecision,
  createContextDecision,
  createFinalDecision,
  createRunIdentity,
  createRunStoryState,
  defaultMissionForTemperament,
  defaultDirectiveForTemperament,
  endingAvailable,
  missionDefinition,
  missionProgress,
  missionShards,
  roleTruthFor,
} from "./autonomous";

registerDefeatHandler((state, defeated) => defeatMonster(state, defeated));

type RunCarryState = Pick<GameState, "runTurn" | "runIdentity" | "directive" | "revelationsRemaining" | "lantern" | "tactics" | "modifiers" | "knownRoleTruths" | "story" | "expedition">;

export function playableRoles() {
  return getGameConfig().roles;
}

export function createInitialGame(
  seed = 20260504,
  roleId = "role.oathbound",
  options: {
    identity?: RunIdentity;
    knownRoleTruths?: RoleTruthId[];
    missionId?: MissionId;
    tactics?: string[];
    modifiers?: Partial<RunModifiers>;
    bonusEmbers?: number;
    bonusMaxEmbers?: number;
  } = {},
): GameState {
  const identity = options.identity ?? createRunIdentity(seed, roleId);
  const modifiers: RunModifiers = {
    ...options.modifiers,
    tacticSlots: options.modifiers?.tacticSlots ?? getGameConfig().tactics.slots,
    scars: [...(options.modifiers?.scars ?? [])].filter((id) => !!getGameConfig().scars[id]),
    rank: Math.max(0, Math.min(getGameConfig().campaign.veteranMaxRank, options.modifiers?.rank ?? 0)),
    graves: options.modifiers?.graves?.map((grave) => ({ ...grave })),
    ruleDeltas: options.modifiers?.ruleDeltas ? { ...options.modifiers.ruleDeltas } : undefined,
  };
  const state = createFloorState(seed, 1, undefined, [], createInitialProgress(), roleId, createInitialRunObjectives(), {
    runTurn: 0,
    runIdentity: identity,
    directive: defaultDirectiveForTemperament(identity.temperament),
    revelationsRemaining: getGameConfig().autonomous.revelationsPerRun,
    lantern: createInitialLantern(options.bonusEmbers ?? 0, options.bonusMaxEmbers ?? 0),
    tactics: normalizeTactics(options.tactics ?? [], modifiers.tacticSlots),
    modifiers,
    knownRoleTruths: [...(options.knownRoleTruths ?? [])],
    story: createRunStoryState(options.missionId ?? defaultMissionForTemperament(identity.temperament)),
  });
  const player = getPlayer(state);
  if (state.expedition?.debt) state.lantern.embers = repayFlame(state, state.lantern.embers);
  if (player.stats && modifiers.rank > 0) {
    const bonus = getGameConfig().campaign.veteranRankBonus;
    player.stats.maxHp += bonus.maxHp * modifiers.rank;
    player.stats.hp = player.stats.maxHp;
  }
  if (player.stats) {
    const foundation = foundationBonus(modifiers.foundationRank);
    player.stats.maxHp += foundation.maxHp;
    player.stats.hp += foundation.maxHp;
  }
  for (const tacticId of state.tactics) {
    for (const grant of getGameConfig().tactics.definitions[tacticId]?.grantItems ?? []) {
      addInventoryItem(player, grant.contentId, grant.quantity);
    }
  }
  refreshPlayerStats(state);
  return state;
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
  const fallbackIdentity = createRunIdentity(seed, roleId);
  const run: RunCarryState = carriedRun ?? {
    runTurn: 0,
    runIdentity: fallbackIdentity,
    directive: defaultDirectiveForTemperament(fallbackIdentity.temperament),
    revelationsRemaining: config.autonomous.revelationsPerRun,
    lantern: createInitialLantern(),
    tactics: [],
    modifiers: { tacticSlots: config.tactics.slots, scars: [], rank: 0 },
    knownRoleTruths: [],
    story: createRunStoryState(defaultMissionForTemperament(fallbackIdentity.temperament)),
  };
  const rules = runRules(run.modifiers);
  const { biome, tiles, roomCenters, start, stairs, floorWalkable, themedRoom } = generateFloorMap(seed, floor, rules);

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
  const coverPoints = chooseCoverPoints(floorWalkable, start, stairs, rng, themedRoom?.points);
  for (const [index, point] of coverPoints.entries()) {
    setTileKind(tiles, rules.mapWidth, point.x, point.y, "cover");
    if (themedRoom && tiles[point.y * rules.mapWidth + point.x].roomTheme === themedRoom.definition.theme) {
      tiles[point.y * rules.mapWidth + point.x].coverAsset = themedRoom.definition.covers[index % themedRoom.definition.covers.length];
    }
  }

  const spawnPoints = floorWalkable.filter((point) => !samePoint(point, start) && !samePoint(point, stairs) && !coverPoints.some((coverPoint) => samePoint(coverPoint, point)) && manhattan(point, start) > 7);
  const floorPlan = buildFloorPlan(floorWalkable, roomCenters, start, stairs);
  const takePoint = createPointTaker(spawnPoints, rng, start);

  const bossId = run.modifiers.bossOverride?.floor === floor ? run.modifiers.bossOverride.contentId : bossForFloor(floor);
  const trial = bossTrialDefinition(run.modifiers.bossTrial);
  const bossStats = bossId ? statsForMonster(bossId, dangerBoost, floor, carriedRunObjectives, rules) : null;
  if (bossStats && trial && floor >= 6) {
    bossStats.hp = bossStats.maxHp = Math.round(bossStats.maxHp * trial.hpScale);
    bossStats.attack += trial.attack;
    bossStats.defense += trial.defense;
  }
  const spawnedBoss = bossId && bossStats ? [monster(`${bossId}.${floor}`, bossId, bossPointNearStairs(spawnPoints, stairs, rng) ?? takePoint(), bossStats)] : [];
  const monsterPool = monsterPoolForFloor(floor);
  const itemPool = itemPoolForFloor(floor);
  const spawnedMonsters = Array.from({ length: bossId ? Math.ceil((rules.monsterCountBase + Math.min(floor, rules.monsterCountFloorCap)) / 2) : rules.monsterCountBase + Math.min(floor, rules.monsterCountFloorCap) }, (_, index) => {
    const inRoom = themedRoom && index < (config.expansion?.roomMonsterCount ?? 0);
    const roomPool = inRoom ? themedRoom.definition.monsters.filter((id) => floor >= (config.expansion?.monsterTraits[id]?.minFloor ?? 1)) : [];
    const contentId = rng.pick(roomPool.length ? roomPool : monsterPool);
    const spawned = monster(`${contentId}.${floor}.${index}`, contentId, takePoint(inRoom ? themedRoom.points : floorPlan.monsterPoints), statsForMonster(contentId, dangerBoost, floor, carriedRunObjectives, rules));
    // 一部の敵は眠っている。忍び寄れば不意打ちでき、隣で騒げば目を覚ます。
    if (behaviorOf(contentId).ambush) {
      spawned.asleep = true;
      spawned.ambushReady = true;
    } else if (rng.int(1, 100) <= rules.sleepingMonsterPercent) spawned.asleep = true;
    return spawned;
  });
  const guaranteedItems = [
    ...guaranteedItemsForFloor(floor),
    ...config.guaranteedEquipment.filter((rule) => floorRuleMatches(rule, floor, biome)).map((rule) => drawEquipment(rng, { tier: rule.tier, slot: rule.slot, favoredRoleId: player.contentId, favoredChancePercent: rule.favoredChancePercent })),
  ];
  const randomItems = Array.from({ length: rules.itemCountBase + Math.floor(Math.min(floor, rules.itemCountFloorCap) / rules.itemCountFloorDivisor) }, () => rng.pick(itemPool));
  const spawnedItems = [...guaranteedItems, ...randomItems].map((contentId, index) => item(`${contentId}.${floor}.${index}`, contentId, takePoint(index < guaranteedItems.length ? floorPlan.guaranteedLootPoints : floorPlan.lootPoints), floor, rng));
  const eventPool = eventPoolForFloor(floor);
  const spawnedEvents = Array.from({ length: rules.eventCountBase + (rng.int(1, 100) <= rules.eventExtraChancePercent ? 1 : 0) }, (_, index) => {
    const contentId = rng.pick(eventPool);
    return event(`${contentId}.${floor}.${index}`, contentId, takePoint(floorPlan.eventPoints));
  });
  if (themedRoom) {
    for (const contentId of themedRoom.definition.events) {
      const point = themedRoom.points.find((p) => spawnPoints.some((available) => samePoint(p, available)));
      if (point) spawnedEvents.push(event(`${contentId}.${floor}`, contentId, takePoint([point])));
    }
  }
  // 過去の遠征で倒れた探索者の墓標。倒れた階と同じ階に1つだけ置く。
  const grave = run.modifiers.graves?.find((candidate) => candidate.floor === floor);
  if (grave) {
    spawnedEvents.push(event(`event.grave-marker.${grave.id}`, "event.grave-marker", takePoint(floorPlan.eventPoints)));
  }
  const trapPool = trapPoolForFloor(floor);
  const spawnedTraps = Array.from({ length: Math.min(rules.trapCountBase + Math.floor(floor / rules.trapCountFloorDivisor), rules.trapCountMax) }, (_, index) => {
    const contentId = rng.pick(trapPool);
    return trap(`${contentId}.${floor}.${index}`, contentId, takePoint(floorPlan.trapPoints));
  });

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
    lantern: { ...run.lantern },
    tactics: [...run.tactics],
    modifiers: cloneModifiers(run.modifiers),
    pendingDecision: null,
    knownRoleTruths: [...run.knownRoleTruths],
    story: {
      ...cloneStory(run.story),
      maxFloorReached: Math.max(run.story.maxFloorReached, floor),
    },
    messages: [
      ...carriedMessages,
      message(0, floor === 1 ? `黒燭の迷宮、${biomeThemeName(biome)}に足を踏み入れた。` : `地下${floor}階、${biomeThemeName(biome)}へ降りた。`, "system"),
      message(0, "探索者は自らの判断で歩き始めた。灯守は黒燭越しに見守る。", "explore"),
    ].slice(-80),
    status: "playing",
  });
  if (trial && floor >= 6 && bossId) next.messages = pushMessage(next, `${trial.label}。守り手が覚醒している。灰灯院の鍛錬を重ねて突破せよ。`, "danger");
  if (run.modifiers.bossOverride?.floor === floor && run.modifiers.keeperName) {
    next.messages = pushMessage(next, `黒燭を継いだ${run.modifiers.keeperName}が、堕ちた灯守となって中枢に立っている。`, "danger");
  }
  const fallbackAct = floor === 5 ? 1 : floor === 8 ? 2 : null;
  if (fallbackAct && !next.story.contextActs.includes(fallbackAct)) {
    next.story.contextActs.push(fallbackAct);
    const decision = createContextDecision(next, fallbackAct, "fallback");
    next.story.crisisKinds.push(decision.id);
    next.pendingDecision = decision;
  }
  if (realtimeConfig().enabled) {
    next.expedition = run.expedition ? structuredClone(run.expedition) : createDynamics(next);
    next.expedition.lights = [];
    next.expedition.floorKills = 0;
    next.expedition.floorAwakened = 0;
    next.expedition.lawPhase = 0;
    next.expedition.heat = biome === "furnace"
      ? tiles.flatMap((tile, i) => tile.kind === "cover" ? [{ pos: { x: i % rules.mapWidth, y: Math.floor(i / rules.mapWidth) }, remaining: realtimeConfig().laws.furnacePeriod, active: false }] : []).slice(0, realtimeConfig().laws.furnaceVentLimit)
      : [];
  }
  armDecision(next);
  return next;
}

export function applyAction(state: GameState, action: GameAction): GameState {
  if (state.status !== "playing") {
    return state;
  }

  if (state.pendingDecision && action.type !== "resolveDecision" && !realtimeConfig().enabled) {
    return state;
  }

  if (action.type === "invokeLantern" && !canInvokeLantern(state, action.rite)) {
    return state;
  }
  if (action.type === "placeLantern" && !canPlaceLantern(state, action.pos)) return state;
  if (action.type === "borrowFlame" && !canBorrowFlame(state)) return state;
  // 対象指定の投擲は人間・AIとも視界内の敵に限る。不正な指定で道具や手番を失わせない。
  if (action.type === "useItem" && action.targetId !== undefined && getGameConfig().consumables[action.contentId]?.rangedDamage
    && !state.entities.some((entity) => entity.id === action.targetId && entity.kind === "monster" && entity.hostile && tileAt(state, entity.pos).visible)) {
    return state;
  }

  if (action.type === "shoot" && !canShoot(state, action.targetId)) return state;
  if (action.type === "useItem" && action.targetId && getGameConfig().consumables[action.contentId]?.rangedDamage) {
    const target = state.entities.find((entity) => entity.id === action.targetId);
    const range = getGameConfig().consumables[action.contentId].range ?? Infinity;
    if (!target || target.kind !== "monster" || !target.hostile || !tileAt(state, target.pos).visible || chebyshev(getPlayer(state).pos, target.pos) > range || !hasLineOfSight(state, getPlayer(state).pos, target.pos)) return state;
  }
  let next = cloneState(state);
  if (action.type === "resolveDecision") {
    if (action.tactics && next.pendingDecision?.kind === "checkpoint") {
      next.tactics = normalizeTactics(action.tactics, next.modifiers.tacticSlots);
    }
    next = resolveMissionCompletion(resolveDecision(next, action.optionId));
    return updateVisibility(next);
  }
  if (action.type === "invokeLantern") {
    return updateVisibility(invokeLantern(next, action.rite));
  }
  if (action.type === "placeLantern") return updateVisibility(placeLantern(next, action.pos));
  if (action.type === "borrowFlame") return updateVisibility(borrowFlame(next));
  const previousDecisionId = next.pendingDecision?.id;
  // 選択窓の期限も遠征の手数で進む。敵・探索・状態異常は通常どおり動く。
  const player = getPlayer(next);
  if (player.skillCooldown) player.skillCooldown -= 1;

  switch (action.type) {
    case "move":
      next = moveActor(next, player.id, DIRECTION_DELTAS[action.direction]);
      break;
    case "wait":
      next.messages = pushMessage(next, "息を整えた。", "explore");
      break;
    case "pickup":
      next = pickupAtPlayer(next);
      break;
    case "useItem":
      next = useItem(next, action.contentId, action.targetId);
      break;
    case "shoot":
      next = shootWeapon(next, action.targetId);
      break;
    case "skill":
      next = useSkill(next, action.targetId);
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
      if (next.pendingDecision) break;
      if (tileAt(next, player.pos).kind === "stairsDown") {
        if (bossAlive(next)) {
          next.messages = pushMessage(next, "この階層の守り手が階段を封じている。", "danger");
          break;
        }
        if (next.floor >= getGameConfig().rules.maxFloor) {
          next = reachBlackCore(next);
        } else if ((next.floor === 3 || next.floor === 6) && !next.story.decisions.some((d) => d.id === `checkpoint-${next.floor}`)) {
          if (next.floor === 6) {
            next.story.carriedTruthId = roleTruthFor(next.runIdentity.roleId);
          }
          next.pendingDecision = createCheckpointDecision(next);
          next.messages = pushMessage(next, "帰還路が開いた。伝言がなければ、探索者は本人の方針で進む。", "system");
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

  if (next.status === "playing" && (!next.pendingDecision || realtimeConfig().enabled)) {
    // 装備の選び直しは拾得・捨てた時だけ。戦闘中の持ち替えは探索者の判断（equip）に任せる。
    refreshPlayerStats(next);
    next = runMonsterTurn(next);
  }
  if (next.status === "playing" && (!next.pendingDecision || realtimeConfig().enabled)) {
    next = tickPlayerConditions(next);
  }
  if (next.status === "playing") next = tickExpedition(next);
  next.turn += 1;
  next.runTurn += 1;
  armDecision(next);
  if (realtimeConfig().enabled && next.status === "playing" && next.pendingDecision?.id === previousDecisionId && next.pendingDecision) {
    next.pendingDecision.remainingTurns = Math.max(0, (next.pendingDecision.remainingTurns ?? 1) - 1);
    if (next.pendingDecision.remainingTurns === 0) next = resolveDecision(next, next.pendingDecision.defaultOptionId);
  }
  next = resolveMissionCompletion(next);
  recordLastMoment(next, action);
  if (next.status === "playing" && next.runTurn >= runRules(next.modifiers).runTurnWarning && !next.story.turnWarningShown) {
    next.story.turnWarningShown = true;
    next.messages = pushMessage(next, "黒燭の像が揺らいだ。灯芯が尽きるまで残された時間は少ない。", "danger");
  }
  if (next.status === "playing" && next.runTurn >= runRules(next.modifiers).runTurnLimit) {
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
    if (player.stats) player.stats.defense = baseDefense(state) + defenseBonus(player);
    applied.push(`護り${effect.guardedTurns}手`);
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

/** 定義済みの作戦だけを、枠数の範囲で重複なく残す。 */
export function normalizeTactics(tactics: string[], slots = getGameConfig().tactics.slots): string[] {
  const definitions = getGameConfig().tactics.definitions;
  return [...new Set(tactics)].filter((id) => !!definitions[id]).slice(0, Math.max(0, slots));
}

function createInitialLantern(bonusEmbers = 0, bonusMaxEmbers = 0): GameState["lantern"] {
  const lantern = getGameConfig().lantern;
  const maxEmbers = Math.max(1, lantern.maxEmbers + bonusMaxEmbers);
  return { embers: Math.max(0, Math.min(lantern.startEmbers + bonusEmbers, maxEmbers)), maxEmbers, ritesUsed: 0 };
}

export function canInvokeLantern(state: GameState, rite: LanternRiteId): boolean {
  const config = getGameConfig().lantern.rites[rite];
  if (!config || state.status !== "playing" || (state.pendingDecision && !realtimeConfig().enabled) || state.lantern.embers < config.cost) return false;
  return lanternRiteHasEffect(state, config);
}

/** 効果が空振りする介入は受け付けず、灯火を無駄にさせない。 */
function lanternRiteHasEffect(state: GameState, config: GameConfig["lantern"]["rites"][LanternRiteId]): boolean {
  const player = getPlayer(state);
  const visibleHostile = state.entities.some((entity) => entity.kind === "monster" && entity.hostile && tileAt(state, entity.pos).visible);
  if (config.dazeTurns && !visibleHostile) return false;
  if (config.healPercent && !config.guardedTurns && player.stats) {
    const afflicted = player.conditions?.some((condition) => condition.kind === "bleeding" || condition.kind === "venomed") ?? false;
    if (player.stats.hp >= player.stats.maxHp && !afflicted) return false;
  }
  return true;
}

/**
 * 灯火を得る。借灯の返済を先に引き、上限を超えた分は溢れとして数える。
 * 戻り値はログに添える短い文（何も起きなければ空）。
 */
function gainEmbers(state: GameState, amount: number): string {
  const earned = repayFlame(state, amount);
  if (earned <= 0) return "";
  const room = Math.max(0, state.lantern.maxEmbers - state.lantern.embers);
  const kept = Math.min(room, earned);
  const spilled = earned - kept;
  state.lantern = { ...state.lantern, embers: state.lantern.embers + kept, overflowed: (state.lantern.overflowed ?? 0) + spilled };
  if (spilled === 0) return `灯火+${kept}。`;
  return kept > 0 ? `灯火+${kept}（${spilled}つは上限を超えて溢れた）。` : `灯火は満ちていて、${spilled}つが溢れて消えた。`;
}

/** 灯守の介入。探索者の手番・ターン経過・敵の手番を発生させない。 */
function invokeLantern(state: GameState, rite: LanternRiteId): GameState {
  const config = getGameConfig().lantern.rites[rite];
  const player = getPlayer(state);
  state.lantern = { ...state.lantern, embers: state.lantern.embers - config.cost, ritesUsed: state.lantern.ritesUsed + 1 };
  const applied: string[] = [];
  if (config.dazeTurns) {
    let dazed = 0;
    for (const entity of state.entities) {
      if (entity.kind !== "monster" || !entity.hostile || !tileAt(state, entity.pos).visible) continue;
      entity.conditions = upsertCondition(entity.conditions, "dazed", config.dazeTurns);
      dazed += 1;
    }
    applied.push(dazed > 0 ? `敵${dazed}体が${config.dazeTurns}手のあいだ怯んだ` : "照らす敵はいなかった");
  }
  if (config.cureConditions) {
    const before = player.conditions?.length ?? 0;
    player.conditions = clearConditions(player.conditions, ["bleeding", "venomed"]);
    if (before !== (player.conditions?.length ?? 0)) applied.push("出血と毒が消えた");
  }
  if (config.healPercent && player.stats) {
    const amount = Math.max(1, Math.round(player.stats.maxHp * config.healPercent / 100));
    const healed = Math.min(amount, player.stats.maxHp - player.stats.hp);
    player.stats.hp += healed;
    applied.push(`HP+${healed}`);
  }
  if (config.guardedTurns) {
    player.conditions = upsertCondition(player.conditions, "guarded", config.guardedTurns);
    if (player.stats) player.stats.defense = baseDefense(state) + defenseBonus(player);
    applied.push(`護り${config.guardedTurns}手`);
  }
  if (config.pushVisibleMonsters) {
    applied.push(`敵${pushVisibleMonstersAway(state, player.pos)}体を押し戻した`);
  }
  if (config.revealRadius) {
    revealAround(state, player.pos, config.revealRadius);
    applied.push(`周囲${config.revealRadius}マスを照らした`);
  }
  if (config.revealTraps) {
    const revealed = revealKnownTrapTiles(state, config.revealTraps, player.pos);
    if (revealed > 0) applied.push(`罠${revealed}つを暴いた`);
  }
  state.messages = pushMessage(state, `灯守が「${lanternRiteLabel(rite)}」を捧げた: ${applied.join("、") || "灯が揺れた"}。`, "system");
  reactToLight(state, lanternRiteLabel(rite));
  return state;
}

export function lanternRiteLabel(rite: LanternRiteId): string {
  if (rite === "flare") return "閃灯";
  if (rite === "mend") return "癒灯";
  if (rite === "guide") return "導灯";
  return "護灯";
}

export function canPlaceLantern(state: GameState, pos?: Point): boolean {
  const config = realtimeConfig();
  const point = pos ?? getPlayer(state).pos;
  return config.enabled && state.status === "playing" && !!state.expedition
    && state.lantern.embers >= config.light.cost && state.expedition.lights.length < config.light.maxActive
    && inBounds(state, point) && tileAt(state, point).visible && isWalkable(tileAt(state, point).kind)
    && chebyshev(point, getPlayer(state).pos) <= config.light.radius
    && !state.expedition.lights.some((l) => samePoint(l.pos, point));
}

function placeLantern(state: GameState, pos?: Point): GameState {
  const config = realtimeConfig().light;
  const dynamics = state.expedition!;
  const player = getPlayer(state);
  // 一押しで退路に置く。明示座標も人間と灯守AIで同じ可視範囲に限定する。
  const behind = [...dynamics.trail].reverse().find((entry) => !samePoint(entry.pos, player.pos) && canPlaceLantern(state, entry.pos))?.pos;
  const point = { ...(pos ?? behind ?? player.pos) };
  dynamics.lights.push({ pos: point, turns: config.duration });
  dynamics.stats.lightsPlaced += 1;
  state.lantern.embers -= config.cost;
  state.lantern.ritesUsed += 1;
  state.messages = pushMessage(state, `退路に置灯を残した。${config.duration}手照らし、近くの獣と亡者を引き寄せる。`, "system");
  reactToLight(state, "置灯");
  return state;
}

export function canBorrowFlame(state: GameState): boolean {
  return realtimeConfig().enabled && state.status === "playing" && !!state.expedition
    && !state.expedition.borrowed && state.expedition.debt === 0 && state.lantern.embers === 0
    && (getPlayer(state).stats?.hp ?? 1) < (getPlayer(state).stats?.maxHp ?? 1);
}

function borrowFlame(state: GameState): GameState {
  const config = realtimeConfig().loan;
  const player = getPlayer(state);
  const dynamics = state.expedition!;
  dynamics.borrowed = true;
  dynamics.debt = config.debt;
  dynamics.loanShieldTurns = config.guardedTurns;
  dynamics.stats.borrowed += 1;
  if (player.stats) player.stats.hp = Math.min(player.stats.maxHp, player.stats.hp + Math.ceil(player.stats.maxHp * config.healPercent / 100));
  player.conditions = upsertCondition(player.conditions, "guarded", config.guardedTurns);
  if (player.stats) player.stats.defense = baseDefense(state) + defenseBonus(player);
  state.lantern.embers = Math.min(state.lantern.maxEmbers, config.embers);
  state.lantern.ritesUsed += 1;
  state.messages = pushMessage(state, `未来の灯を借りた。回復・護り・灯火+${config.embers}。次に得る灯火${config.debt}つは返済へ回る。未返済分は次の遠征に残る。`, "system");
  reactToLight(state, "借灯");
  return state;
}

function reactToLight(state: GameState, rite: string): void {
  const dynamics = state.expedition;
  if (!dynamics) return;
  dynamics.lastRite = { rite, runTurn: state.runTurn };
  if (state.biome !== "black-candle") return;
  dynamics.lawPhase += 1;
  for (const enemy of state.entities) {
    if (!enemy.telegraph || !tileAt(state, enemy.pos).visible) continue;
    enemy.telegraph.tiles = telegraphTiles(enemy.telegraph.kind, enemy.pos, getPlayer(state).pos, dynamics.lawPhase)
      .filter((p) => inBounds(state, p) && isWalkable(tileAt(state, p).kind));
    enemy.telegraph.remaining = Math.max(enemy.telegraph.remaining, realtimeConfig().telegraphs[enemy.contentId]?.windup ?? 2);
  }
  state.messages = pushMessage(state, "中枢の火が応えた。守り手の構えが変わり、予告が更新された。", "system");
}

function tickExpedition(state: GameState): GameState {
  const dynamics = state.expedition;
  if (!dynamics) return state;
  dynamics.lights = dynamics.lights.map((l) => ({ ...l, turns: l.turns - 1 })).filter((l) => l.turns > 0);
  dynamics.loanShieldTurns = Math.max(0, dynamics.loanShieldTurns - 1);
  const config = realtimeConfig().laws;
  for (const vent of dynamics.heat) {
    vent.remaining -= 1;
    if (vent.remaining <= 0) {
      vent.active = !vent.active;
      vent.remaining = vent.active ? config.furnaceDuration : config.furnacePeriod;
    }
    if (!vent.active) continue;
    for (const entity of [...state.entities]) {
      if (!entity.stats || !samePoint(entity.pos, vent.pos)) continue;
      entity.stats.hp -= config.furnaceDamage;
      if (entity.kind === "player") dynamics.stats.heatHits += 1;
      if (tileAt(state, vent.pos).visible) state.messages = pushMessage(state, `${entity.kind === "player" ? state.runIdentity.name : getContentName(entity.contentId)}が炉の熱を受けた。`, "combat");
      if (entity.stats.hp > 0) continue;
      if (entity.kind === "player") {
        state.status = "lost";
        state.story.killedBy = { cause: "trap", contentId: "terrain.furnace-vent" };
      } else state = defeatMonster(state, entity);
    }
  }
  return state;
}

/**
 * 任務の条件を満たした瞬間に一度だけ知らせ、灯火を返す。
 * 灯片の報酬は生還して初めて受け取る（calculateShards）。
 */
function resolveMissionCompletion(state: GameState): GameState {
  if (state.story.missionCompleted || !missionProgress(state).completed) return state;
  state.story.missionCompleted = true;
  const mission = missionDefinition(state.story.missionId);
  const embers = state.status === "playing" ? gainEmbers(state, realtimeConfig().missions.rewardEmbers) : "";
  const tail = state.status === "playing" ? `生きて帰れば灯片+${missionShards(mission.id)}。` : `灯片+${missionShards(mission.id)}を持ち帰る。`;
  state.messages = pushMessage(state, `任務「${mission.label}」の条件を果たした。${embers}${tail}`, "loot");
  return state;
}

/** 第十層の番人を越えた。三つの真相が揃っていれば結末を問い、なければ踏破で終える。 */
function reachBlackCore(state: GameState): GameState {
  if (endingAvailable(state)) {
    state.pendingDecision = createFinalDecision(state);
    state.messages = pushMessage(state, "黒燭の番人が崩れ、三つの真相が中枢の火を照らした。灯守へ結末が問われる。", "system");
    return state;
  }
  addInventoryItem(getPlayer(state), "item.black-candle-core", 1);
  state.status = "won";
  state.messages = pushMessage(state, "黒燭の番人が崩れた。核片を抱えて灰灯院へ戻る。真相が三つ揃えば、黒燭の行方を決められる。", "system");
  return state;
}

function descendToNextFloor(state: GameState, messages: GameMessage[]): GameState {
  state.messages = messages;
  const perFloor = gainEmbers(state, getGameConfig().lantern.embersPerFloor);
  messages = state.messages;
  if (perFloor) messages = [...messages, message(state.turn, `新しい階層の闇が黒燭に灯火を宿した。${perFloor}`, "loot")].slice(-80);
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
    expedition: state.expedition ? structuredClone(state.expedition) : undefined,
    runTurn: state.runTurn,
    runIdentity: { ...state.runIdentity },
    directive: state.directive,
    revelationsRemaining: state.revelationsRemaining,
    lantern: { ...state.lantern },
    tactics: [...state.tactics],
    modifiers: cloneModifiers(state.modifiers),
    knownRoleTruths: [...state.knownRoleTruths],
    story: {
      ...cloneStory(state.story),
      recoveredGraves: [...(state.story.recoveredGraves ?? [])],
    },
  };
}

export function observeGame(state: GameState): GameObservation {
  const player = getPlayer(state);
  const observedEntity = ({ id, kind, contentId, pos, stats, hostile, blocksMovement, goldAmount, conditions, telegraph, recoveryTurns, awakened, plus, seals, alerted, asleep }: Entity) => ({
    id,
    kind,
    contentId,
    pos,
    stats,
    hostile,
    blocksMovement,
    goldAmount,
    conditions: kind === "monster" && conditions?.length ? conditions.map((condition) => ({ ...condition })) : undefined,
    telegraph: telegraph ? { ...telegraph, origin: { ...telegraph.origin }, tiles: telegraph.tiles.filter((p) => inBounds(state, p) && tileAt(state, p).visible).map((p) => ({ ...p })) } : undefined,
    recoveryTurns,
    awakened,
    plus,
    seals: seals ? [...seals] : undefined,
    alerted,
    asleep,
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
    expedition: state.expedition ? { ...structuredClone(state.expedition),
      heat: state.expedition.heat.filter((h) => tileAt(state, h.pos).explored).map((h) => structuredClone(h)),
      trail: state.expedition.trail.map((e) => ({ ...e, pos: { ...e.pos } })),
    } : undefined,
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
    lantern: { ...state.lantern },
    tactics: [...state.tactics],
    modifiers: cloneModifiers(state.modifiers),
    pendingDecision: state.pendingDecision ? structuredClone(state.pendingDecision) : null,
    story: structuredClone(state.story),
    messages: state.messages.slice(-8),
    status: state.status,
    bossAlive: aliveBoss,
    merchantServices: availableMerchantServices(state),
  };
}

function monster(id: string, contentId: string, pos: Point, stats: Stats): Entity {
  return { id, kind: "monster", contentId, pos, blocksMovement: true, stats, hostile: true };
}

/** 床に置く品。装備の抽選札は格から中身を引き、装備には修正値と印の個体差を付ける。 */
function item(id: string, contentId: string, pos: Point, floor: number, rng: Rng, options: { minSeals?: number } = {}): Entity {
  const { gold } = getGameConfig();
  const resolved = isEquipmentToken(contentId) ? resolveEquipmentToken(contentId, rng) : contentId;
  const goldAmount = resolved === "item.coin-pouch" ? gold.coinPouchBase + floor * gold.coinPouchPerFloor + rng.int(0, gold.coinPouchRandomMax) : undefined;
  const piece = equipmentSlot(resolved) ? rollEquipmentPiece(resolved, floor, rng, options) : {};
  return { id, kind: "item", contentId: resolved, pos, blocksMovement: false, goldAmount, ...piece };
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

function bossAlive(state: GameState): boolean {
  const bossId = state.modifiers.bossOverride?.floor === state.floor ? state.modifiers.bossOverride.contentId : bossForFloor(state.floor);
  return !!bossId && state.entities.some((entity) => entity.kind === "monster" && entity.contentId === bossId);
}

function statsForMonster(contentId: string, dangerBoost: number, floor = 1, runObjectives: RunObjectiveFlags = createInitialRunObjectives(), rules = getGameConfig().rules): Stats {
  const config = getGameConfig();
  const base = config.monsterStats[contentId] ?? { hp: 5, attack: 1, defense: 0 };
  let hp = base.hp + Math.round(dangerBoost * (base.hpPerDanger ?? 1) * rules.monsterHpScale);
  let attack = base.attack + Math.floor(dangerBoost * rules.monsterAttackPerFloor);
  if (runObjectives.lateEnemiesWeakened && floor >= 7 && contentEntities[contentId]?.tier !== "boss") {
    hp = Math.max(1, Math.floor(hp * 0.85));
    attack = Math.max(1, attack - 1);
  }
  return { hp, maxHp: hp, attack, defense: base.defense };
}

function rangedDefenseBonus(state: GameState, actor: Entity): number {
  const equipmentBonus = (actor.inventory?.filter((entry) => entry.equipped).reduce((sum, entry) => sum + (getGameConfig().equipment[entry.contentId]?.rangedDefense ?? 0), 0) ?? 0)
    + equippedSeals(actor).reduce((sum, seal) => sum + (seal.rangedDefense ?? 0), 0);
  const tacticBonus = actor.kind === "player" ? tacticPerk(state, "rangedDefense") : 0;
  return equipmentBonus + (roleTraits(actor.contentId)?.rangedDefense ?? 0) + tacticBonus;
}

function tacticPerk(state: GameState, perk: "rangedDefense" | "trapAvoidPercent" | "healPercent"): number {
  const { tactics, scars } = getGameConfig();
  const fromTactics = state.tactics.reduce((sum, tacticId) => sum + (tactics.definitions[tacticId]?.perks?.[perk] ?? 0), 0);
  const fromScars = state.modifiers.scars.reduce((sum, scarId) => sum + (scars[scarId]?.perks?.[perk] ?? 0), 0);
  return fromTactics + fromScars;
}

function trapAvoidChance(state: GameState, actor: Entity): number {
  const { rules } = getGameConfig();
  const equipmentModifier = actor.inventory?.filter((entry) => entry.equipped).reduce((sum, entry) => {
    const equipment = getGameConfig().equipment[entry.contentId];
    return sum + (equipment?.trapAvoidPercent ?? 0) - (equipment?.trapAvoidPenaltyPercent ?? 0);
  }, 0) ?? 0;
  const roleModifier = (roleTraits(actor.contentId)?.trapAvoidPercent ?? 0) + equippedSeals(actor).reduce((sum, seal) => sum + (seal.trapAvoidPercent ?? 0), 0);
  const tacticModifier = actor.kind === "player" ? tacticPerk(state, "trapAvoidPercent") : 0;
  return clampNumber(rules.trapAvoidBasePercent + roleModifier + equipmentModifier + tacticModifier, rules.trapAvoidMinPercent, rules.trapAvoidMaxPercent);
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
    const roomTheme = tileAt(state, target).roomTheme;
    const roomKey = roomTheme ? `room.${roomTheme}.${state.floor}` : null;
    if (roomKey && !state.story.discoveries.includes(roomKey)) {
      state.story.discoveries.push(roomKey);
      const roomName = getGameConfig().expansion?.rooms.find((room) => room.theme === roomTheme)?.nameJa ?? roomTheme;
      state.messages = pushMessage(state, `${roomName}の寄り道部屋を見つけた。`, "explore");
      const radius = roleTraits(actor.contentId)?.roomRevealRadius;
      if (radius) {
        revealAround(state, target, radius);
        state.runObjectives.roleGoalProgress += 1;
        state.messages = pushMessage(state, "遺物調査員が周囲の構造を読み、道筋を記録した。", "explore");
      }
    }
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
  if (actor.kind === "monster" && state.expedition && tileAt(state, trapEntity.pos).visible) state.expedition.stats.terrainLures += 1;
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
      state.story.killedBy = { cause: "trap", contentId: trapEntity.contentId };
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
  const chance = trapAvoidChance(state, actor);
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
    actor.stats.defense = baseDefense(state) + defenseBonus(actor);
    state.messages = pushMessage(state, "運命の標が盾の紋に変わり、短い護りを得た。", "loot");
  } else {
    actor.stats.hp -= 4 + Math.floor(state.floor / 2);
    state.messages = pushMessage(state, `${actorName}が運命の標の反動を受けた。`, "combat");
  }

  if (actor.stats.hp <= 0) {
    if (actor.kind === "player") {
      state.status = "lost";
      state.story.killedBy = { cause: "trap", contentId: trapEntity.contentId };
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
    resolved.messages = pushMessage(resolved, "黒燭が出来事の意味を映し返した。伝言がなければ探索者の判断で進む。", "system");
  }
  return resolved;
}

function resolveEvent(state: GameState, eventEntity: Entity): GameState {
  const eventConfig = getGameConfig().events[eventEntity.contentId];
  if (eventEntity.contentId.startsWith("prop.") && eventConfig) return resolveRoomReward(state, eventEntity, eventConfig);
  if (eventEntity.contentId === "event.grave-marker") {
    return mournAtGrave(state, eventEntity);
  }
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
    state.messages = pushMessage(state, "警告の火皿が燃え上がり、周囲の通路が頭に刻まれた。", "explore");
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
    state.messages = pushMessage(state, "炉心制御碑を砕いた。終盤階層の通常敵の火勢が弱まった。", "danger");
    return state;
  }
  if (eventEntity.contentId === "event.seal-key") {
    state.runObjectives = { ...state.runObjectives, bossRewardBonus: state.runObjectives.bossRewardBonus + (eventConfig?.bossRewardBonus ?? 1) };
    state.entities = state.entities.filter((entity) => entity.id !== eventEntity.id);
    state.messages = pushMessage(state, "封印鍵を拾い上げた。次の守り手が抱える遺物の封が少し緩む。", "loot");
    return state;
  }
  if (eventEntity.contentId === "event.broken-armory") {
    // 崩れた武器棚。格の札から一つ引き、床へ置く。持ち物が満杯でも失わない。
    const rng = new Rng(state.seed + state.floor * 211 + state.turn * 17);
    const token = rng.pick(eventConfig?.loot?.length ? eventConfig.loot : ["equipment:early"]);
    const found = item(`${eventEntity.id}.armory`, token, { ...eventEntity.pos }, state.floor, rng);
    state.entities = state.entities.filter((entity) => entity.id !== eventEntity.id);
    state.entities.push(found);
    state.messages = pushMessage(state, `崩れた武器棚から${pieceName(found)}を見つけた。`, "loot");
    return state;
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
    state.messages = pushMessage(state, "旅商人が灯を掲げた。探索者は必要なサービスを選ぶ。", "explore");
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

/** 過去に倒れた探索者の墓標を弔い、遺品と残り火を受け取る。 */
function mournAtGrave(state: GameState, eventEntity: Entity): GameState {
  const graveId = eventEntity.id.replace("event.grave-marker.", "");
  const grave = state.modifiers.graves?.find((candidate) => candidate.id === graveId);
  state.entities = state.entities.filter((entity) => entity.id !== eventEntity.id);
  if (!grave) return state;
  const player = getPlayer(state);
  const recovered: string[] = [];
  if (grave.gear && addInventoryItem(player, grave.gear, 1)) recovered.push(`遺品「${getContentName(grave.gear)}」`);
  const remainingEmber = gainEmbers(state, 1);
  if (remainingEmber) recovered.push(`残り火（${remainingEmber.replace(/。$/, "")}）`);
  state.story.recoveredGraves = [...(state.story.recoveredGraves ?? []), grave.id];
  if (state.expedition && grave.lesson) {
    state.modifiers.lessons = [...new Set([...(state.modifiers.lessons ?? []), grave.lesson])];
    state.expedition.memories = [...state.expedition.memories, { name: grave.name, echoes: structuredClone(grave.echoes ?? []), lesson: grave.lesson }].slice(-3);
    for (const echo of grave.echoes ?? []) state.messages = pushMessage(state, `${grave.name}の残響: ${echo.action}（命火${echo.hp}）。`, "system");
    state.messages = pushMessage(state, `${grave.name}の経験を受け継いだ。${grave.lesson === "ranged" ? "射線と遮蔽を重く見る" : grave.lesson === "traps" ? "罠の危険を重く見る" : "早めの回復を心がける"}。`, "system");
  }
  state.messages = pushMessage(state, `${grave.name}の墓標に祈りを捧げた。${recovered.length ? `${recovered.join("と")}を受け継いだ。` : "静かな灯が揺れた。"}`, "loot");
  return reevaluateEquipment(state);
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
      player.stats.defense = baseDefense(state) + defenseBonus(player);
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
      state.entities.push(monster(`${contentId}.sealed.${state.turn}.${index}`, contentId, point, statsForMonster(contentId, dangerBoost, state.floor, state.runObjectives, runRules(state.modifiers))));
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
      state.entities.push(monster(`${contentId}.feast.${state.turn}.${index}`, contentId, point, statsForMonster(contentId, dangerBoost, state.floor, state.runObjectives, runRules(state.modifiers))));
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
    state.entities.push(monster(`${guard}.vault.${state.turn}`, guard, guardPoint, statsForMonster(guard, state.floor, state.floor, state.runObjectives, runRules(state.modifiers))));
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
    state.entities.push(monster(`${guard}.gallery.${state.turn}`, guard, guardPoint, statsForMonster(guard, state.floor, state.floor, state.runObjectives, runRules(state.modifiers))));
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
      state.entities.push(monster(`${contentId}.bone-heap.${state.turn}.${index}`, contentId, point, statsForMonster(contentId, state.floor, state.floor, state.runObjectives, runRules(state.modifiers))));
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
    state.entities.push(monster(`${guard}.furnace-room.${state.turn}`, guard, guardPoint, statsForMonster(guard, state.floor, state.floor, state.runObjectives, runRules(state.modifiers))));
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
  if (attacker.kind === "player") {
    return defender.kind === "monster" ? playerWeaponAttack(state, defender) : state;
  }

  const rng = new Rng(state.seed + state.turn * 97 + attacker.id.length * 13);
  const ambush = attacker.ambushReady ? 2 : 1;
  attacker.ambushReady = false;
  const rawDamage = (attacker.stats.attack + packBonus(state, attacker, defender)) * ambush + rng.int(0, getGameConfig().rules.attackRandomBonusMax) - defender.stats.defense;
  const damage = Math.max(1, rawDamage);
  defender.stats.hp -= damage;
  recordStrike(state, attacker, defender, false);
  const defenderName = defender.kind === "player" ? "あなた" : getContentName(defender.contentId);
  state.messages = pushMessage(state, `${getContentName(attacker.contentId)}は${defenderName}に${damage}ダメージを与えた。`, "combat");
  state = applyAttackSideEffect(state, attacker, defender);

  if (defender.stats.hp <= 0) {
    if (defender.kind === "player") {
      state.status = "lost";
      state.story.killedBy = { cause: "combat", contentId: attacker.contentId };
      state.messages = pushMessage(state, "迷宮の暗闇に倒れた。", "danger");
    } else {
      state = defeatMonster(state, defender);
    }
    return state;
  }
  if (defender.kind === "player" && state.status === "playing") {
    afterMonsterHitsPlayer(state, attacker);
    refreshPlayerStats(state);
    state = thornsAttack(state, attacker);
    if (state.entities.includes(attacker)) state = counterAttack(state, attacker);
  }
  return state;
}

function defeatMonster(state: GameState, defeated: Entity): GameState {
  if (tryRevive(state, defeated)) return state;
  onMonsterDefeated(state, defeated);
  const reward = bossRewardFor(defeated.contentId);
  const defeatedPos = { ...defeated.pos };
  state = awardXp(state, defeated.contentId);
  state.entities = state.entities.filter((entity) => entity.id !== defeated.id);
  if (state.expedition) {
    state.expedition.floorKills += 1;
    const law = realtimeConfig().laws;
    if (state.biome === "crypt" && state.expedition.floorKills % law.cryptWakeEveryKills === 0) {
      const awakenedHere = state.expedition.floorAwakened;
      const sleeper = state.entities.find((e) => e.kind === "monster" && e.stats && !e.awakened && contentEntities[e.contentId]?.family === "undead" && chebyshev(e.pos, defeatedPos) <= law.cryptWakeRadius);
      if (sleeper && awakenedHere < law.cryptWakeLimit) {
        sleeper.awakened = true;
        sleeper.stats!.attack += law.cryptAttackBonus;
        state.expedition.stats.awakened += 1;
        state.expedition.floorAwakened += 1;
        if (tileAt(state, sleeper.pos).visible) state.messages = pushMessage(state, "倒れた者の響きで、近くの亡者が目覚めた。", "combat");
      }
    }
  }
  state.messages = pushMessage(state, `${getContentName(defeated.contentId)}を倒した。`, "combat");
  if (reward) {
    state.entities.push(item(`${reward}.boss.${state.floor}.${state.turn}`, reward, defeatedPos, state.floor, rngForFloor(state.seed + state.turn, state.floor)));
    state.messages = pushMessage(state, `${getContentName(reward)}が残された。`, "loot");
    const tier = getGameConfig().bosses.find((boss) => boss.contentId === defeated.contentId)?.equipmentTier;
    const point = openPointsAround(state, defeatedPos, 1)[0];
    if (tier && point) {
      // 守り手の遺品。印が必ず一つ付き、次の戦い方を変えうる。
      const relic = item(`equipment.boss.${state.floor}.${state.turn}`, `equipment:${tier}`, point, state.floor + 2, rngForFloor(state.seed + state.turn + 5, state.floor), { minSeals: 1 });
      state.entities.push(relic);
      state.messages = pushMessage(state, `守り手の遺品、${pieceName(relic)}が転がった。`, "loot");
    }
    state = dropBonusBossRewards(state, defeatedPos);
  }
  if (contentEntities[defeated.contentId]?.tier === "boss") {
    state.story.bossesDefeated += 1;
    if (realtimeConfig().enabled && !state.pendingDecision) {
      if (state.floor === 3 || state.floor === 6) {
        if (state.floor === 6) state.story.carriedTruthId = roleTruthFor(state.runIdentity.roleId);
        state.pendingDecision = createCheckpointDecision(state);
        state.pendingDecision.resume = "none";
      } else if (state.floor === getGameConfig().rules.maxFloor) state = reachBlackCore(state);
      armDecision(state);
    }
    const lantern = getGameConfig().lantern;
    if (lantern.embersPerGuardian > 0) {
      const earned = gainEmbers(state, lantern.embersPerGuardian);
      if (earned) state.messages = pushMessage(state, `守り手の残り火が黒燭へ還った。${earned}`, "loot");
    }
  }
  return applyRoleBossGoal(state, defeated.contentId, defeatedPos);
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
  if (!roleTraits(player.contentId)?.bossReward || contentEntities[defeatedContentId]?.tier !== "boss") {
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
  if (roleTraits(player.contentId)?.cleansingHeal && player.stats) {
    const healed = Math.min(roleTraits(player.contentId)!.cleansingHeal!, player.stats.maxHp - player.stats.hp);
    player.stats.hp += healed;
    state.runObjectives.roleGoalProgress += 1;
    state.messages = pushMessage(state, `灰薬師は薬の残り香を整え、HPが${healed}回復した。`, "loot");
    return state;
  }
  if (player.contentId !== "role.lantern-priest" || !player.stats) {
    return state;
  }
  player.conditions = clearConditions(player.conditions, ["bleeding", "venomed"]);
  player.conditions = upsertCondition(player.conditions, "guarded", roleTraits(player.contentId)?.priestGuardedTurns ?? 6);
  player.stats.defense = baseDefense(state) + defenseBonus(player);
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

  const existing = player.inventory?.find((entry) => entry.contentId === itemEntity.contentId);
  const piece = { plus: itemEntity.plus, seals: itemEntity.seals };
  if (!addInventoryItem(player, itemEntity.contentId, 1, piece)) {
    state.messages = pushMessage(state, `所持品がいっぱいで${getContentName(itemEntity.contentId)}を拾えない。所持枠に空きが必要だ。`, "danger");
    return state;
  }
  state.entities = state.entities.filter((entity) => entity.id !== itemEntity.id);
  if (existing && equipmentSlot(itemEntity.contentId)) {
    state.messages = pushMessage(state, `同じ${getContentName(itemEntity.contentId)}を重ねて鍛え直し、${pieceName(existing)}になった。`, "loot");
  } else {
    state.messages = pushMessage(state, `${pieceName({ contentId: itemEntity.contentId, ...piece })}を拾った。`, "loot");
  }
  return reevaluateEquipment(state);
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
  const dropped = item(`${contentId}.dropped.${state.turn}`, contentId, { ...player.pos }, state.floor, rngForFloor(state.seed + state.turn, state.floor));
  if (equipmentSlot(contentId)) {
    dropped.plus = entry.plus;
    dropped.seals = entry.seals ? [...entry.seals] : undefined;
  }
  state.entities.push(dropped);
  state.messages = pushMessage(state, `${getContentName(contentId)}を足元に置いた。`, "loot");
  if (entry.equipped && player.stats) {
    player.stats.attack = baseAttack(state) + weaponBonus(player);
    player.stats.defense = baseDefense(state) + defenseBonus(player);
  }
  return reevaluateEquipment(state);
}

function useItem(state: GameState, contentId: string, targetId?: string): GameState {
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
    const healAmount = Math.round(consumable.heal * (100 + tacticPerk(state, "healPercent") + (roleTraits(player.contentId)?.healPercent ?? 0)) / 100);
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
    player.stats.defense = baseDefense(state) + defenseBonus(player);
    consumeInventoryEntry(player, entry);
    state.messages = pushMessage(state, "護りの薬液が青く巡り、しばらく防御が上がった。", "loot");
    return state;
  }

  if (contentId === "item.bloodmoss-salve") {
    const healed = Math.min(Math.round((consumable?.heal ?? 22) * (100 + (roleTraits(player.contentId)?.healPercent ?? 0)) / 100), player.stats.maxHp - player.stats.hp);
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

  if (contentId === "item.glim-map" || (consumable?.revealRadius && !consumable.heal && !consumable.pushVisibleMonsters && !consumable.guardedTurns)) {
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
      player.stats.defense = baseDefense(state) + defenseBonus(player);
    }
    consumeInventoryEntry(player, entry);
    state.messages = pushMessage(state, `墓陽の護符でHPが${healed}回復し、毒と出血を払い、短い護りを得た。`, "loot");
    state = applyPriestCleansingGoal(state);
    return state;
  }

  if (contentId === "item.colossus-heart") {
    player.conditions = upsertCondition(player.conditions, "guarded", consumable?.guardedTurns ?? 24);
    player.stats.defense = baseDefense(state) + defenseBonus(player);
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

  if (consumable?.unlockCache) {
    const cache = state.entities.find((entity) => entity.kind === "event" && getGameConfig().events[entity.contentId]?.locked && tileAt(state, entity.pos).visible && chebyshev(entity.pos, player.pos) <= 1);
    if (cache) return triggerEvent(state, cache);
    state.messages = pushMessage(state, "解錠できる箱が近くに見当たらない。", "explore");
    return state;
  }
  if (consumable?.rangedDamage) {
    const target = targetId === undefined ? nearestVisibleMonster(state, consumable.range) : state.entities.find((entity) => entity.id === targetId);
    if (!target?.stats) {
      state.messages = pushMessage(state, "投げ針を投げる相手が見えない。", "explore");
      return state;
    }

    const damage = consumable.rangedDamage + Math.floor(state.floor / 2);
    target.stats.hp -= damage;
    recordStrike(state, player, target, true);
    entry.quantity -= 1;
    if (entry.quantity <= 0) {
      player.inventory = player.inventory?.filter((itemEntry) => itemEntry.quantity > 0);
    }
    state.messages = pushMessage(state, `${getContentName(contentId)}を投げ、${getContentName(target.contentId)}に${damage}ダメージを与えた。`, "combat");
    if (target.stats.hp <= 0) {
      state = defeatMonster(state, target);
    }
    return state;
  }

  state.messages = pushMessage(state, "まだ効果が定義されていない。", "explore");
  return state;
}

function canShoot(state: GameState, targetId: string): boolean {
  const player = getPlayer(state);
  const bow = bowFor(player);
  const target = state.entities.find((entity) => entity.id === targetId);
  if (!target?.stats || target.kind !== "monster" || !target.hostile || !tileAt(state, target.pos).visible) return false;
  if (!bow) return canReach(state, player, target);
  return chebyshev(player.pos, target.pos) > 1 && chebyshev(player.pos, target.pos) <= bow.range && hasLineOfSight(state, player.pos, target.pos);
}

/** 弓は射撃、槍は2マス先への突き。どちらも同じ shoot action で受ける。 */
function shootWeapon(state: GameState, targetId: string): GameState {
  const target = state.entities.find((entity) => entity.id === targetId)!;
  return bowFor(getPlayer(state)) ? playerBowShot(state, target) : playerWeaponAttack(state, target);
}

function resolveRoomReward(state: GameState, source: Entity, config: GameConfig["events"][string]): GameState {
  const player = getPlayer(state);
  const traits = roleTraits(player.contentId);
  const tool = player.inventory?.find((entry) => getGameConfig().consumables[entry.contentId]?.unlockCache && entry.quantity > 0);
  const unlocked = !config.locked || !!traits?.lockpickBonusGold || !!tool;
  // 解錠具がなくても遠征を止めない。こじ開けると少し傷つく。
  if (config.locked && !unlocked && player.stats) {
    const damage = getGameConfig().expansion?.forcedLockDamage ?? 3;
    player.stats.hp -= damage;
    state.messages = pushMessage(state, `封をこじ開け、HPを${damage}失った。`, "danger");
    if (player.stats.hp <= 0) {
      state.status = "lost";
      state.story.killedBy = { cause: "item", contentId: source.contentId };
      return state;
    }
  }
  if (config.locked && tool && !traits?.lockpickBonusGold) consumeInventoryEntry(player, tool);
  const gold = (config.goldBase ?? 0) + state.floor * (config.goldPerFloor ?? 0) + (config.locked ? traits?.lockpickBonusGold ?? 0 : 0);
  if (gold > 0) state.playerProgress.gold += gold;
  if (config.locked && traits?.lockpickBonusGold) state.runObjectives.roleGoalProgress += 1;
  if (config.xp) state.playerProgress.xp += config.xp;
  if (config.heal && player.stats) player.stats.hp = Math.min(player.stats.maxHp, player.stats.hp + config.heal);
  if (config.cureConditions) {
    player.conditions = clearConditions(player.conditions, config.cureConditions);
    state = applyPriestCleansingGoal(state);
  }
  if (config.revealRadius) revealAround(state, source.pos, config.revealRadius);
  if (config.loot?.length) {
    const rng = new Rng(state.seed + state.floor * 101 + state.turn * 31);
    const loot = rng.pick(config.loot);
    // 床へ置くので、持ち物が満杯でも報酬を失わない。
    state.entities.push(item(`${source.id}.reward`, loot, { ...source.pos }, state.floor, rng));
  }
  state.entities = state.entities.filter((entity) => entity.id !== source.id);
  state.messages = pushMessage(state, `${getContentName(source.contentId)}を調べ、残された遺物を回収した。${gold ? `古銭+${gold}。` : ""}`, "loot");
  return applyLevelUps(state);
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
    player.stats.defense = baseDefense(state) + defenseBonus(player);
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
    state.story.killedBy = { cause: "item", contentId };
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
  for (const other of player.inventory ?? []) {
    const equipment = getGameConfig().equipment[other.contentId];
    if (slot === "weapon" && getGameConfig().equipment[contentId].twoHanded && equipment?.slot === "shield") other.equipped = false;
    if (slot === "shield" && equipment?.twoHanded) other.equipped = false;
  }
  if (player.stats) {
    player.stats.attack = baseAttack(state) + weaponBonus(player);
    player.stats.defense = baseDefense(state) + defenseBonus(player);
  }
  state.messages = pushMessage(state, `${getContentName(contentId)}を装備した。`, "loot");
  return state;
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

function availableMerchantServices(state: GameState): MerchantServiceId[] {
  if (!isPlayerOnMerchant(state)) {
    return [];
  }
  const player = getPlayer(state);
  const offers = merchantOffersForState(state)
    .filter((offer) => state.playerProgress.gold >= offer.cost && isMerchantOfferUseful(state, player, offer));
  return [...new Set(offers.map((offer) => offer.serviceId))];
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
    return upgradeGain(player, offer.contentId) > 0;
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
    return upgradeGain(player, offer.contentId);
  }
  if (offer.serviceId === "map") {
    return state.tiles.length - state.tiles.filter((tile) => tile.explored).length;
  }
  return 0;
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

function reevaluateEquipment(state: GameState): GameState {
  const player = getPlayer(state);
  if (!player.inventory || !player.stats) {
    return state;
  }
  const selected = preferredEquipment(player);
  for (const entry of player.inventory) {
    if (!equipmentSlot(entry.contentId)) continue;
    const equip = selected.has(entry.contentId);
    if (equip && !entry.equipped) state.messages = pushMessage(state, `${getContentName(entry.contentId)}の方が有用だと判断して装備した。`, "loot");
    entry.equipped = equip;
  }
  player.stats.attack = baseAttack(state) + weaponBonus(player);
  player.stats.defense = baseDefense(state) + defenseBonus(player);
  return state;
}

function applyLevelUps(state: GameState): GameState {
  const player = getPlayer(state);
  if (!player.stats) {
    return state;
  }

  const { rules } = getGameConfig();
  const growth = roleDefinition(player.contentId)?.growth ?? { maxHp: 5, attack: 1, defense: 0.5 };
  while (state.playerProgress.level + 1 < rules.xpThresholds.length && state.playerProgress.xp >= rules.xpThresholds[state.playerProgress.level + 1]) {
    state.playerProgress = { ...state.playerProgress, level: state.playerProgress.level + 1 };
    player.stats.maxHp += growth.maxHp;
    player.stats.hp = Math.min(player.stats.maxHp, player.stats.hp + rules.levelUpHeal);
    refreshPlayerStats(state);
    state.messages = pushMessage(state, `Lv${state.playerProgress.level}に上がった。最大HPと戦闘力が伸びた。`, "system");
  }
  state.playerProgress = normalizeProgress(state.playerProgress);
  return state;
}

/** 職業の素の値・レベルの伸び・古参の位階・鍛錬を合わせた攻撃。装備は含まない。 */
function baseAttack(state: GameState): number {
  const { campaign } = getGameConfig();
  const role = roleDefinition(getPlayer(state).contentId);
  const levelGain = Math.floor(Math.max(0, state.playerProgress.level - 1) * (role?.growth.attack ?? 1));
  return (role?.stats.attack ?? 6) + levelGain + state.modifiers.rank * campaign.veteranRankBonus.attack + foundationBonus(state.modifiers.foundationRank).attack;
}

function baseDefense(state: GameState): number {
  const role = roleDefinition(getPlayer(state).contentId);
  return (role?.stats.defense ?? 0) + Math.floor(Math.max(0, state.playerProgress.level - 1) * (role?.growth.defense ?? 0.5));
}

function refreshPlayerStats(state: GameState): void {
  const player = getPlayer(state);
  if (!player.stats) return;
  player.stats.attack = baseAttack(state) + weaponBonus(player);
  player.stats.defense = baseDefense(state) + defenseBonus(player);
}

function nearestVisibleMonster(state: GameState, range = Infinity): Entity | null {
  const player = getPlayer(state);
  const visibleMonsters = state.entities.filter((entity) => entity.kind === "monster" && entity.hostile && tileAt(state, entity.pos).visible && chebyshev(entity.pos, player.pos) <= range && hasLineOfSight(state, player.pos, entity.pos));
  return visibleMonsters.sort((a, b) => chebyshev(a.pos, player.pos) - chebyshev(b.pos, player.pos))[0] ?? null;
}

function applyAttackSideEffect(state: GameState, attacker: Entity, defender: Entity): GameState {
  if (defender.kind !== "player" || defender.stats?.hp === undefined || defender.stats.hp <= 0) {
    return state;
  }
  const drain = getGameConfig().expansion?.monsterTraits[attacker.contentId]?.lifeDrain ?? (attacker.contentId === "monster.grave-leech" ? 2 : 0);
  if (drain && attacker.stats) {
    const healed = Math.min(drain, attacker.stats.maxHp - attacker.stats.hp);
    if (healed > 0) {
      attacker.stats.hp += healed;
      state.messages = pushMessage(state, `${getContentName(attacker.contentId)}が傷口から命を吸い、少し回復した。`, "combat");
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
  const damage = Math.max(1, attacker.stats.attack - defender.stats.defense - rangedDefenseBonus(state, defender) + 1);
  defender.stats.hp -= damage;
  recordStrike(state, attacker, defender, true);
  state.messages = pushMessage(state, `${getContentName(attacker.contentId)}は離れた位置からあなたに${damage}ダメージを与えた。`, "combat");
  const effect = getGameConfig().monsterAttackEffects[attacker.contentId];
  if (effect && !hasCondition(defender, effect.condition)) {
    defender.conditions = upsertCondition(defender.conditions, effect.condition, effect.turns);
    state.messages = pushMessage(state, effect.message, "danger");
  }
  if (defender.stats.hp <= 0) {
    state.status = "lost";
    state.story.killedBy = { cause: "rangedCombat", contentId: attacker.contentId };
    state.messages = pushMessage(state, "迷宮の暗闇に倒れた。", "danger");
  }
  return reflectRangedStrike(state, attacker, defender);
}

function reflectRangedStrike(state: GameState, attacker: Entity, defender: Entity): GameState {
  if (attacker.stats && (defender.stats?.hp ?? 0) > 0 && tileAt(state, attacker.pos).visible) {
    const reflected = equippedEffects(defender).reduce((sum, equipment) => sum + (equipment.reflectDamage ?? 0), 0);
    if (reflected > 0) {
      attacker.stats.hp -= reflected;
      recordStrike(state, defender, attacker, true);
      state.messages = pushMessage(state, `反射の盾が光を返し、${getContentName(attacker.contentId)}へ${reflected}ダメージを与えた。`, "combat");
      if (attacker.stats.hp <= 0) state = defeatMonster(state, attacker);
    }
  }
  return state;
}

function isRangedMonster(contentId: string): boolean {
  return getGameConfig().rangedMonsters.includes(contentId);
}

function runMonsterTurn(state: GameState): GameState {
  state = tickMonsterAfflictions(state);
  const player = getPlayer(state);
  // 倍速の敵は1手に2回動く。ただし噛みつくのは1手に1回まで。
  const monsters = state.entities.filter((entity) => entity.kind === "monster" && entity.stats).flatMap((entity) => behaviorOf(entity.contentId).fast ? [entity, entity] : [entity]);
  const struck = new Set<Entity>();
  for (const monsterEntity of monsters) {
    if (state.status !== "playing") {
      break;
    }
    if (!state.entities.includes(monsterEntity)) continue;
    if (struck.has(monsterEntity)) continue;
    const pre = preMonsterTurn(state, monsterEntity, () => stepMonsterAwayFromPlayer(state, monsterEntity, player.pos));
    state = pre.state;
    if (pre.acted) continue;
    if (monsterEntity.conditions?.some((condition) => condition.kind === "dazed")) {
      monsterEntity.telegraph = undefined;
      monsterEntity.conditions = monsterEntity.conditions
        .map((condition) => condition.kind === "dazed" ? { ...condition, turns: condition.turns - 1 } : condition)
        .filter((condition) => condition.turns > 0);
      continue;
    }
    const distance = chebyshev(monsterEntity.pos, player.pos);
    const special = realtimeConfig().enabled ? realtimeConfig().telegraphs[monsterEntity.contentId] : undefined;
    if (monsterEntity.telegraph && special) {
      monsterEntity.telegraph.remaining -= 1;
      if (monsterEntity.telegraph.remaining <= 0 && monsterEntity.telegraph.kind === "charge") {
        state = resolveCharge(state, monsterEntity, player, special);
        continue;
      }
      if (monsterEntity.telegraph.remaining <= 0) {
        const hits = monsterEntity.telegraph.tiles.some((p) => samePoint(p, player.pos));
        const originClear = hasLineOfSight(state, monsterEntity.pos, player.pos);
        if (hits && originClear) {
          const damage = Math.max(1, Math.ceil((monsterEntity.stats!.attack - (player.stats?.defense ?? 0) - (special.kind === "shot" ? rangedDefenseBonus(state, player) : 0)) * special.damageScale));
          if (player.stats) player.stats.hp -= damage;
          recordStrike(state, monsterEntity, player, special.kind !== "sweep");
          state.messages = pushMessage(state, `${getContentName(monsterEntity.contentId)}が予告の一撃を放ち、${damage}ダメージを受けた。`, "combat");
          if ((player.stats?.hp ?? 1) <= 0) {
            state.status = "lost";
            state.story.killedBy = { cause: special.kind === "sweep" ? "combat" : "rangedCombat", contentId: monsterEntity.contentId };
          }
          if (special.kind === "shot") state = reflectRangedStrike(state, monsterEntity, player);
        } else {
          if (state.expedition) state.expedition.stats.dodges += 1;
          if (tileAt(state, monsterEntity.pos).visible) state.messages = pushMessage(state, "予告された一撃が外れた。敵の構えに隙が生まれた。", "combat");
        }
        monsterEntity.telegraph = undefined;
        monsterEntity.recoveryTurns = special.recovery;
        monsterEntity.attackCooldown = special.cooldown;
      }
      continue;
    }
    if ((monsterEntity.recoveryTurns ?? 0) > 0) {
      monsterEntity.recoveryTurns! -= 1;
      continue;
    }
    if (!updateAwareness(state, monsterEntity, player, distance)) continue;
    const specialReady = (monsterEntity.attackCooldown ?? 0) <= 0;
    monsterEntity.attackCooldown = Math.max(0, (monsterEntity.attackCooldown ?? 0) - 1);
    if (special && specialReady && distance <= special.range && (special.kind === "sweep" || distance > 1) && hasLineOfSight(state, monsterEntity.pos, player.pos)
      && (special.kind !== "charge" || isChargeLane(monsterEntity.pos, player.pos))) {
      monsterEntity.telegraph = { kind: special.kind, origin: { ...monsterEntity.pos }, remaining: special.windup,
        tiles: telegraphTiles(special.kind, monsterEntity.pos, player.pos, state.expedition?.lawPhase ?? 0).filter((p) => inBounds(state, p) && isWalkable(tileAt(state, p).kind)) };
      if (state.expedition) state.expedition.stats.telegraphs += 1;
      if (tileAt(state, monsterEntity.pos).visible) state.messages = pushMessage(state, `${getContentName(monsterEntity.contentId)}が${special.windup}手後の一撃を構えた。`, "combat");
      continue;
    }
    const family = contentEntities[monsterEntity.contentId]?.family;
    const lure = state.expedition?.lights.find((l) => chebyshev(l.pos, monsterEntity.pos) <= realtimeConfig().light.lureRange && hasLineOfSight(state, monsterEntity.pos, l.pos));
    if (lure && distance > 1 && (family === "beast" || family === "undead") && contentEntities[monsterEntity.contentId]?.tier !== "boss") {
      if (samePoint(lure.pos, monsterEntity.pos)) {
        state.expedition!.lights = state.expedition!.lights.filter((l) => l !== lure);
      } else {
        const step = nextStepToward(state, monsterEntity.pos, lure.pos);
        if (step && !samePoint(step, player.pos)) state = moveActor(state, monsterEntity.id, { x: step.x - monsterEntity.pos.x, y: step.y - monsterEntity.pos.y });
      }
      continue;
    }
    const retreatReady = (monsterEntity.retreatCooldown ?? 0) <= 0;
    if (!retreatReady) monsterEntity.retreatCooldown = (monsterEntity.retreatCooldown ?? 0) - 1;
    if (retreatReady && shouldKeepDistance(monsterEntity.contentId) && distance <= 2 && hasLineOfSight(state, monsterEntity.pos, player.pos)) {
      const escaped = stepMonsterAwayFromPlayer(state, monsterEntity, player.pos);
      if (escaped) {
        // 退いた直後は再び退けない。追い詰めれば近接で捕まえられる余地を残す。
        monsterEntity.retreatCooldown = getGameConfig().rules.rangedRetreatCooldown;
        state = escaped;
        continue;
      }
    }
    if (distance <= 1) {
      struck.add(monsterEntity);
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

/** 突進は縦・横・斜めの一直線にいる時だけ構える。 */
function isChargeLane(from: Point, to: Point): boolean {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  return dx === 0 || dy === 0 || dx === dy;
}

/** 突進の解決。線上に残っていれば探索者の手前まで詰めて当て、外れれば走り抜けて隙を見せる。 */
function resolveCharge(state: GameState, monsterEntity: Entity, player: Entity, special: { damageScale: number; recovery: number; cooldown: number }): GameState {
  const path = monsterEntity.telegraph!.tiles;
  const blocked = (p: Point) => !inBounds(state, p) || !isWalkable(tileAt(state, p).kind) || state.entities.some((entity) => entity !== monsterEntity && entity.blocksMovement && samePoint(entity.pos, p));
  const hitIndex = path.findIndex((p) => samePoint(p, player.pos));
  monsterEntity.telegraph = undefined;
  monsterEntity.recoveryTurns = special.recovery;
  monsterEntity.attackCooldown = special.cooldown;
  if (hitIndex >= 0) {
    const lane = path.slice(0, hitIndex);
    if (lane.some(blocked)) return state;
    const stop = lane.at(-1);
    if (stop) monsterEntity.pos = { ...stop };
    const damage = Math.max(1, Math.ceil((monsterEntity.stats!.attack - (player.stats?.defense ?? 0)) * special.damageScale));
    if (player.stats) player.stats.hp -= damage;
    recordStrike(state, monsterEntity, player, false);
    state.messages = pushMessage(state, `${getContentName(monsterEntity.contentId)}が突進し、${damage}ダメージを受けた。`, "combat");
    if ((player.stats?.hp ?? 1) <= 0) {
      state.status = "lost";
      state.story.killedBy = { cause: "combat", contentId: monsterEntity.contentId };
    }
    return state;
  }
  for (const p of path) {
    if (blocked(p) || samePoint(p, player.pos)) break;
    monsterEntity.pos = { ...p };
  }
  if (state.expedition) state.expedition.stats.dodges += 1;
  if (tileAt(state, monsterEntity.pos).visible) state.messages = pushMessage(state, `${getContentName(monsterEntity.contentId)}の突進が空を切り、勢いのまま体勢を崩した。`, "combat");
  return state;
}

/**
 * 敵が探索者に気づいているか。眠った敵は隣で騒がれるか傷つけられるまで動かず、
 * 起きている敵も視界に入るまでは動かない。忍びの職業は気づかれる距離が縮む。
 */
function updateAwareness(state: GameState, monsterEntity: Entity, player: Entity, distance: number): boolean {
  if (monsterEntity.alerted && !monsterEntity.asleep) return true;
  if (monsterEntity.stats && monsterEntity.stats.hp < monsterEntity.stats.maxHp) {
    monsterEntity.asleep = false;
    monsterEntity.alerted = true;
    return true;
  }
  const stealth = roleTraits(player.contentId)?.stealth ?? 0;
  if (monsterEntity.asleep) {
    const rng = new Rng(state.seed + state.turn * 53 + monsterEntity.pos.x * 7 + monsterEntity.pos.y * 11);
    const wakes = distance <= 1 ? rng.int(1, 100) > stealth * 20 : distance <= 3 && rng.int(1, 100) <= Math.max(0, 12 - stealth * 4);
    if (wakes) {
      monsterEntity.asleep = false;
      monsterEntity.alerted = true;
      if (tileAt(state, monsterEntity.pos).visible) state.messages = pushMessage(state, `${getContentName(monsterEntity.contentId)}が目を覚ました。`, "combat");
    }
    return false;
  }
  const notice = Math.max(2, getGameConfig().rules.monsterChaseRange - stealth);
  if (distance <= notice && hasLineOfSight(state, monsterEntity.pos, player.pos)) monsterEntity.alerted = true;
  return !!monsterEntity.alerted;
}

function shouldKeepDistance(contentId: string): boolean {
  if (getGameConfig().expansion?.monsterTraits[contentId]?.keepDistance) return true;
  // 影小鬼は盗人になったので距離を取らず、盗んでから逃げる。
  return contentId === "monster.hollow-archer" || contentId === "monster.cinder-cultist" || contentId === "monster.ash-warlock";
}

function stepMonsterAwayFromPlayer(state: GameState, monsterEntity: Entity, playerPos: Point): GameState | null {
  const candidates = Object.values(DIRECTION_DELTAS)
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
  state.entities.push(monster(`${contentId}.summoned.${state.floor}.${state.turn}`, contentId, point, statsForMonster(contentId, state.floor - 1, state.floor, state.runObjectives, runRules(state.modifiers))));
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
  for (const equipment of equippedEffects(player)) {
    if (equipment.conditionResistance) player.conditions = clearConditions(player.conditions, equipment.conditionResistance);
    if (equipment.regen && state.runTurn > 0 && state.runTurn % equipment.regen.everyTurns === 0) player.stats.hp = Math.min(player.stats.maxHp, player.stats.hp + equipment.regen.amount);
    if (equipment.revealRadius) revealAround(state, player.pos, equipment.revealRadius);
  }
  for (const seal of equippedSeals(player)) {
    if (seal.resist) player.conditions = clearConditions(player.conditions, seal.resist);
    if (seal.regen && state.runTurn > 0 && state.runTurn % seal.regen.everyTurns === 0) player.stats.hp = Math.min(player.stats.maxHp, player.stats.hp + seal.regen.amount);
  }
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
    player.stats.defense = baseDefense(state) + defenseBonus(player);
    state.messages = pushMessage(state, "護りの薬効が薄れた。", "explore");
  }
  if (player.stats.hp <= 0) {
    state.status = "lost";
    state.story.killedBy = { cause: activeConditions.some((condition) => condition.kind === "bleeding") ? "bleeding" : "venom" };
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
    if (monsterEntity.telegraph) {
      monsterEntity.telegraph = undefined;
      monsterEntity.recoveryTurns = realtimeConfig().telegraphs[monsterEntity.contentId]?.recovery ?? 1;
    }
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
  for (const tile of state.tiles) tile.visible = false;
  revealVisibleArea(state, getPlayer(state).pos, runRules(state.modifiers).fovRadius);
  for (const light of state.expedition?.lights ?? []) {
    revealVisibleArea(state, light.pos, realtimeConfig().light.radius);
  }
  return state;
}

function revealVisibleArea(state: GameState, origin: Point, radius: number): void {
  const lightPasses = (x: number, y: number) => {
    const point = { x, y };
    return inBounds(state, point) && (samePoint(point, origin) || !blocksSight(tileAt(state, point).kind));
  };
  const fov = new ROT.FOV.PreciseShadowcasting(lightPasses, { topology: 8 });
  fov.compute(origin.x, origin.y, radius, (x, y) => {
    const point = { x, y };
    if (!inBounds(state, point)) return;
    const tile = tileAt(state, point);
    tile.visible = true;
    tile.explored = true;
  });
}

