import { createActionCounts } from "../core/actions";
import { chooseAutoplayAction, getAutoplayDebugState, resetAutoplayState } from "../ai/autoplay";
import { chooseWatcherAction, type WatcherPolicy } from "../ai/watcher";
import { realtimeConfig } from "../content/realtime";
import { isInstantIntervention } from "../core/realtime";
import { getGameConfig, loadBunGameConfig } from "../content/config";
import { applyAction, createInitialGame, observeGame } from "../core/game";
import { paceDelayMs, paceKindFor, type PaceKind } from "../core/pacing";
import { analyzeRun, createRunLog, recordTurn } from "../core/runLog";
import { calculateShards, campaignRunModifiers, campaignTacticSlots, chooseDecisionAction, createCampaignState, createRunIdentity, type DecisionPolicy } from "../core/autonomous";
import type { CampaignState, EndingId, ExpeditionDynamics, GameAction, GameState, RunReview } from "../types";

export type SimulationRunInput = {
  seed: number;
  turns: number;
  roleId: string;
  configPath: string;
  label: string;
  trace?: boolean;
  profile?: boolean;
  logLimit?: number | null;
  decisionPolicy?: DecisionPolicy;
  watcherPolicy?: WatcherPolicy;
  tactics?: string[];
  heat?: number;
  bossTrial?: number;
  foundationRank?: number;
  abilities?: string[];
  /** 施設の段階。灯火の祭壇・作戦室・修練場の効果を遠征へ反映する。 */
  facilities?: Partial<CampaignState["facilities"]>;
  aftermath?: EndingId;
};

export type SimulationProfile = {
  configLoadMs: number;
  initMs: number;
  turnLoopMs: number;
  finalObserveMs: number;
  analyzeMs: number;
  totalMeasuredMs: number;
  timers: Record<"observeGame" | "chooseAutoplayAction" | "getAutoplayDebugState" | "applyAction" | "recordTurn", ProfileTimer>;
};

type ProfileTimer = {
  calls: number;
  ms: number;
};

type CompactRunReview = {
  result: RunReview["result"];
  deathCause: RunReview["deathCause"];
  summaryText: string;
  keyFindings: string[];
  aiImprovementHints: string[];
  stats: RunReview["stats"];
  decisions: RunReview["decisions"];
  lastTurns: Array<{
    index: number;
    turn: number;
    floor: number;
    action: GameAction;
    actor: "player" | "ai";
    hpBefore?: number;
    hpAfter?: number;
    status: GameState["status"];
    visible: RunReview["lastTurns"][number]["visible"];
    eventKinds: string[];
    messages: string[];
    aiDebug?: RunReview["lastTurns"][number]["aiDebug"];
  }>;
};

/** 階ごとの滞在と危うさ。難しさの波を測るために使う。 */
export type FloorProfileEntry = { floor: number; turns: number; minHpRatio: number; damage: number; omen?: string; elites: number };

export type SimulationRunResult = {
  floorProfile: FloorProfileEntry[];
  weaponAtFloor7?: string;
  dynamics?: ExpeditionDynamics["stats"];
  unpaidFlameDebt?: number;
  overflowedEmbers?: number;
  ritesUsed?: number;
  seed: number;
  turns: number;
  floor: number;
  level: number;
  xp: number;
  gold: number;
  status: GameState["status"];
  actions: Record<GameAction["type"], number>;
  pickups: number;
  attacks: number;
  descents: number;
  knownTiles: number;
  knownEntities: number;
  stagnantWindows: number;
  maxTurnsWithoutKnownTileGrowth: number;
  elapsedMs: number;
  roleId: string;
  label: string;
  configPath: string;
  review: CompactRunReview;
  shards: ReturnType<typeof calculateShards>;
  temperament: GameState["runIdentity"]["temperament"];
  decisions: number;
  discoveries: number;
  projectedDisplayMs: number;
  missionId: GameState["story"]["missionId"];
  missionCompleted: boolean;
  interventions: number;
  profile?: SimulationProfile;
};

export async function runSimulation(input: SimulationRunInput): Promise<SimulationRunResult> {
  const startMs = performance.now();
  const profile = input.profile ? createSimulationProfile() : null;
  const actions = createActionCounts();

  const configStartMs = performance.now();
  await loadBunGameConfig(input.configPath);
  addProfileMs(profile, "configLoadMs", performance.now() - configStartMs);
  resetAutoplayState();

  const initStartMs = performance.now();
  const identity = createRunIdentity(input.seed, input.roleId);
  const base = createCampaignState();
  const campaign = { ...base, facilities: { ...base.facilities, ...input.facilities }, heat: { unlocked: input.heat ?? 0, selected: input.heat ?? 0 }, cycle: { number: input.aftermath ? 2 : 1, aftermath: input.aftermath } };
  const carried = campaignRunModifiers(campaign);
  let state = createInitialGame(input.seed, input.roleId, {
    identity,
    tactics: input.tactics,
    modifiers: { ...carried.modifiers, bossTrial: input.bossTrial ?? 0, foundationRank: input.foundationRank ?? 0, graves: [], abilities: input.abilities ?? [], tacticSlots: campaignTacticSlots(campaign) },
    bonusEmbers: carried.bonusEmbers,
    bonusMaxEmbers: carried.bonusMaxEmbers,
  });
  const runLog = createRunLog(input.seed, input.roleId, { maxEntries: input.logLimit ?? undefined }, identity);
  let executedTurns = 0;
  let projectedDisplayMs = 0;
  let scheduledPace: PaceKind = "exploration";
  let observation = timeProfile(profile, "observeGame", () => observeGame(state));
  let lastKnownTiles = observation.knownTiles.length;
  let turnsWithoutKnownTileGrowth = 0;
  let maxTurnsWithoutKnownTileGrowth = 0;
  let stagnantWindows = 0;
  const floorProfile: FloorProfileEntry[] = [];
  const openFloor = (current: GameState): FloorProfileEntry => ({ floor: current.floor, turns: current.runTurn, minHpRatio: 1, damage: 0, omen: current.floorOmen, elites: current.entities.filter((entity) => entity.elite).length });
  let floorEntry = openFloor(state);
  let weaponAtFloor7: string | undefined;
  addProfileMs(profile, "initMs", performance.now() - initStartMs);

  const loopStartMs = performance.now();
  const maximumSteps = input.turns + 16 + 64;
  for (let step = 0; step < maximumSteps && state.status === "playing"; step += 1) {
    if (!state.pendingDecision && state.runTurn >= input.turns) {
      break;
    }
    const beforeObservation = observation;
    const watcherAction = chooseWatcherAction(beforeObservation, input.watcherPolicy ?? "none");
    const realtimeDefault = realtimeConfig().enabled && (input.decisionPolicy ?? "temperament") === "temperament";
    const action = watcherAction ?? timeProfile(profile, "chooseAutoplayAction", () => beforeObservation.pendingDecision && !realtimeDefault
      ? chooseDecisionAction(beforeObservation, input.decisionPolicy ?? "temperament")
      : chooseAutoplayAction(beforeObservation));
    if (!isInstantIntervention(action)) projectedDisplayMs += paceDelayMs(scheduledPace);
    const debug = timeProfile(profile, "getAutoplayDebugState", () => getAutoplayDebugState(beforeObservation));
    actions[action.type] += 1;
    const before = state;
    state = timeProfile(profile, "applyAction", () => applyAction(state, action));
    const afterObservation = timeProfile(profile, "observeGame", () => observeGame(state));
    const logEntry = timeProfile(profile, "recordTurn", () => recordTurn({ log: runLog, before, action, after: state, actor: "ai", aiDebug: debug, beforeObservation, afterObservation }));
    const hpBefore = before.entities.find((entity) => entity.id === before.playerId)?.stats;
    const hpAfter = state.entities.find((entity) => entity.id === state.playerId)?.stats;
    if (state.floor !== before.floor) {
      floorProfile.push({ ...floorEntry, turns: before.runTurn - floorEntry.turns });
      floorEntry = openFloor(state);
      if (state.floor === 7 && !weaponAtFloor7) weaponAtFloor7 = state.entities.find((entity) => entity.id === state.playerId)?.inventory?.find((entry) => entry.equipped && getGameConfig().equipment[entry.contentId]?.slot === "weapon")?.contentId ?? "none";
    } else if (hpBefore && hpAfter) {
      floorEntry.damage += Math.max(0, hpBefore.hp - hpAfter.hp);
      floorEntry.minHpRatio = Math.min(floorEntry.minHpRatio, Math.max(0, hpAfter.hp) / hpAfter.maxHp);
    }

    const knownTiles = afterObservation.knownTiles.length;
    if (state.floor !== before.floor || knownTiles > lastKnownTiles) {
      lastKnownTiles = knownTiles;
      turnsWithoutKnownTileGrowth = 0;
    } else {
      turnsWithoutKnownTileGrowth += 1;
      if (turnsWithoutKnownTileGrowth > 0 && turnsWithoutKnownTileGrowth % 80 === 0) {
        stagnantWindows += 1;
        if (input.trace) {
          const nextObservation = observeGame(state);
          const nextDebug = getAutoplayDebugState(nextObservation);
          console.error(JSON.stringify({
            type: "stagnant",
            simTurn: state.runTurn,
            floor: state.floor,
            player: nextObservation.player.pos,
            hp: nextObservation.player.stats?.hp,
            maxHp: nextObservation.player.stats?.maxHp,
            knownTiles,
            knownEntities: nextObservation.knownEntities.map((entity) => ({ kind: entity.kind, contentId: entity.contentId, pos: entity.pos })),
            visibleEntities: nextObservation.visibleEntities.map((entity) => ({ kind: entity.kind, contentId: entity.contentId, pos: entity.pos })),
            action,
            debug: nextDebug,
          }));
        }
      }
    }
    maxTurnsWithoutKnownTileGrowth = Math.max(maxTurnsWithoutKnownTileGrowth, turnsWithoutKnownTileGrowth);
    if (!isInstantIntervention(action)) {
      executedTurns += 1;
    }
    scheduledPace = paceKindFor(action, state, logEntry.messageDelta);
    observation = afterObservation;
  }
  addProfileMs(profile, "turnLoopMs", performance.now() - loopStartMs);

  const finalObserveStartMs = performance.now();
  const finalObservation = observation.status === state.status && observation.turn === state.turn
    ? observation
    : timeProfile(profile, "observeGame", () => observeGame(state));
  addProfileMs(profile, "finalObserveMs", performance.now() - finalObserveStartMs);
  const analyzeStartMs = performance.now();
  const review = analyzeRun(runLog, state, finalObservation);
  addProfileMs(profile, "analyzeMs", performance.now() - analyzeStartMs);
  if (input.trace) {
    console.error(JSON.stringify({
      type: "final",
      status: state.status,
      floor: state.floor,
      turn: executedTurns,
      player: finalObservation.player.pos,
      hp: finalObservation.player.stats?.hp,
      maxHp: finalObservation.player.stats?.maxHp,
      knownTiles: finalObservation.knownTiles.length,
      recentMessages: state.messages.slice(-12),
      review,
      recentRunLog: runLog.entries.slice(-30),
    }));
  }

  if (profile) {
    profile.totalMeasuredMs = roundProfileMs(performance.now() - startMs);
  }

  floorProfile.push({ ...floorEntry, turns: state.runTurn - floorEntry.turns });
  const result: SimulationRunResult = {
    floorProfile,
    weaponAtFloor7,
    dynamics: state.expedition?.stats,
    unpaidFlameDebt: state.expedition?.debt ?? 0,
    overflowedEmbers: state.lantern.overflowed ?? 0,
    ritesUsed: state.lantern.ritesUsed,
    seed: input.seed,
    turns: state.runTurn,
    floor: state.floor,
    level: state.playerProgress.level,
    xp: state.playerProgress.xp,
    gold: state.playerProgress.gold,
    status: state.status,
    actions,
    pickups: actions.pickup,
    attacks: runLog.totals.damageEvents,
    descents: actions.descend,
    knownTiles: finalObservation.knownTiles.length,
    knownEntities: finalObservation.knownEntities.length,
    stagnantWindows,
    maxTurnsWithoutKnownTileGrowth,
    elapsedMs: Math.round(performance.now() - startMs),
    roleId: input.roleId,
    label: input.label,
    configPath: input.configPath,
    review: compactReview(review),
    shards: calculateShards(state),
    temperament: state.runIdentity.temperament,
    decisions: state.story.decisions.length,
    discoveries: state.story.discoveries.length,
    projectedDisplayMs,
    missionId: state.story.missionId,
    missionCompleted: state.story.missionCompleted,
    interventions: state.story.decisions.filter((entry) => entry.effectSummary && entry.usedRevelation).length,
  };
  if (profile) {
    result.profile = profile;
  }
  return result;
}

function createSimulationProfile(): SimulationProfile {
  return {
    configLoadMs: 0,
    initMs: 0,
    turnLoopMs: 0,
    finalObserveMs: 0,
    analyzeMs: 0,
    totalMeasuredMs: 0,
    timers: {
      observeGame: { calls: 0, ms: 0 },
      chooseAutoplayAction: { calls: 0, ms: 0 },
      getAutoplayDebugState: { calls: 0, ms: 0 },
      applyAction: { calls: 0, ms: 0 },
      recordTurn: { calls: 0, ms: 0 },
    },
  };
}

function addProfileMs(profile: SimulationProfile | null, key: keyof Pick<SimulationProfile, "configLoadMs" | "initMs" | "turnLoopMs" | "finalObserveMs" | "analyzeMs">, ms: number): void {
  if (!profile) {
    return;
  }
  profile[key] = roundProfileMs(profile[key] + ms);
}

function timeProfile<T>(profile: SimulationProfile | null, key: keyof SimulationProfile["timers"], operation: () => T): T {
  if (!profile) {
    return operation();
  }
  const startMs = performance.now();
  try {
    return operation();
  } finally {
    const timer = profile.timers[key];
    timer.calls += 1;
    timer.ms = roundProfileMs(timer.ms + performance.now() - startMs);
  }
}

function roundProfileMs(value: number): number {
  return Math.round(value * 100) / 100;
}

function compactReview(review: RunReview): CompactRunReview {
  return {
    result: review.result,
    deathCause: review.deathCause,
    summaryText: review.summaryText,
    keyFindings: review.keyFindings,
    aiImprovementHints: review.aiImprovementHints,
    stats: review.stats,
    decisions: review.decisions,
    lastTurns: review.lastTurns.slice(-8).map((entry) => ({
      index: entry.index,
      turn: entry.turn,
      floor: entry.floor,
      action: entry.action,
      actor: entry.actor,
      hpBefore: entry.before.hp,
      hpAfter: entry.after.hp,
      status: entry.resultStatus,
      visible: entry.visible,
      eventKinds: entry.eventKinds,
      messages: entry.messageDelta.map((message) => message.text),
      aiDebug: entry.aiDebug,
    })),
  };
}
