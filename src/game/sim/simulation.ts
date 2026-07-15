import { chooseAutoplayAction, getAutoplayDebugState, resetAutoplayState } from "../ai/autoplay";
import { getGameConfig, loadBunGameConfig } from "../content/config";
import { applyAction, createInitialGame, observeGame } from "../core/game";
import { analyzeRun, createRunLog, recordTurn } from "../core/runLog";
import { calculateScore, chooseDecisionAction, createRunIdentity, type DecisionPolicy } from "../core/autonomous";
import type { GameAction, GameState, RunReview } from "../types";

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

export type ProfileTimer = {
  calls: number;
  ms: number;
};

export type CompactRunReview = {
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

export type SimulationRunResult = {
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
  score: ReturnType<typeof calculateScore>;
  temperament: GameState["runIdentity"]["temperament"];
  decisions: number;
  discoveries: number;
  projectedDisplayMs: number;
  profile?: SimulationProfile;
};

export async function runSimulation(input: SimulationRunInput): Promise<SimulationRunResult> {
  const startMs = performance.now();
  const profile = input.profile ? createSimulationProfile() : null;
  const actions: SimulationRunResult["actions"] = {
    move: 0,
    wait: 0,
    pickup: 0,
    equip: 0,
    dropItem: 0,
    useItem: 0,
    merchantService: 0,
    descend: 0,
    resolveDecision: 0,
  };

  const configStartMs = performance.now();
  await loadBunGameConfig(input.configPath);
  addProfileMs(profile, "configLoadMs", performance.now() - configStartMs);
  resetAutoplayState();

  const initStartMs = performance.now();
  const identity = createRunIdentity(input.seed, input.roleId);
  let state = createInitialGame(input.seed, input.roleId, { identity });
  const runLog = createRunLog(input.seed, input.roleId, { maxEntries: input.logLimit ?? undefined }, identity);
  let executedTurns = 0;
  let observation = timeProfile(profile, "observeGame", () => observeGame(state));
  let lastKnownTiles = observation.knownTiles.length;
  let turnsWithoutKnownTileGrowth = 0;
  let maxTurnsWithoutKnownTileGrowth = 0;
  let stagnantWindows = 0;
  addProfileMs(profile, "initMs", performance.now() - initStartMs);

  const loopStartMs = performance.now();
  const maximumSteps = input.turns + 16;
  for (let step = 0; step < maximumSteps && state.status === "playing"; step += 1) {
    if (!state.pendingDecision && state.runTurn >= input.turns) {
      break;
    }
    const beforeObservation = observation;
    const action = timeProfile(profile, "chooseAutoplayAction", () => beforeObservation.pendingDecision
      ? chooseDecisionAction(beforeObservation, input.decisionPolicy ?? "temperament")
      : chooseAutoplayAction(beforeObservation));
    const debug = timeProfile(profile, "getAutoplayDebugState", () => getAutoplayDebugState(beforeObservation));
    actions[action.type] += 1;
    const before = state;
    state = timeProfile(profile, "applyAction", () => applyAction(state, action));
    const afterObservation = timeProfile(profile, "observeGame", () => observeGame(state));
    timeProfile(profile, "recordTurn", () => recordTurn({ log: runLog, before, action, after: state, actor: "ai", aiDebug: debug, beforeObservation, afterObservation }));

    const knownTiles = afterObservation.knownTiles.length;
    if (knownTiles > lastKnownTiles) {
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
    if (action.type !== "resolveDecision") {
      executedTurns += 1;
    }
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

  const pacing = getGameConfig().autonomous.pacingMs;
  const projectedDisplayMs = actions.move * pacing.traversal
    + Math.max(0, executedTurns - actions.move) * pacing.exploration
    + runLog.totals.damageEvents * Math.max(0, pacing.danger - pacing.exploration);
  const result: SimulationRunResult = {
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
    score: calculateScore(state),
    temperament: state.runIdentity.temperament,
    decisions: state.story.decisions.length,
    discoveries: state.story.discoveries.length,
    projectedDisplayMs,
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

export function compactReview(review: RunReview): CompactRunReview {
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
