import { createActionCounts } from "../core/actions";
import type { ExpeditionDynamics, GameAction, GameState } from "../types";
import type { SimulationProfile, SimulationRunResult } from "./simulation";
import type { BatchPreset, CliOptions, ConfigSpec } from "./batchCli";
import type { DecisionPolicy } from "../core/autonomous";
import type { WatcherPolicy } from "../ai/watcher";

type AggregateSummary = {
  averageDynamics: ExpeditionDynamics["stats"];
  averageUnpaidFlameDebt: number;
  averageOverflowedEmbers: number;
  averageRitesUsed: number;
  runs: number;
  totalElapsedMs: number;
  averageElapsedMs: number;
  runsPerSecond: number;
  statusCounts: Record<GameState["status"], number>;
  winRate: number;
  lostRate: number;
  returnedRate: number;
  strandedRate: number;
  playingRate: number;
  averageFloor: number;
  averageTurns: number;
  averageShards: number;
  medianShards: number;
  averageDecisions: number;
  missionCompletionRate: number;
  averageInterventions: number;
  averageProjectedDisplayMs: number;
  averageFinalHp: number;
  averageLowHpTurns: number;
  averageStagnantTurns: number;
  averageRiskyTrapSteps: number;
  averageDamageTaken: number;
  averageHealingReceived: number;
  averageActions: Record<GameAction["type"], number>;
  averagePickups: number;
  averageAttacks: number;
  averageDiscoveries: number;
  averageAttacksPer100Turns: number;
  averageDescents: number;
  deathCauses: Record<string, number>;
  decisionChoices: Record<string, number>;
  aiHints: Array<{ hint: string; count: number }>;
};

type ComparisonDelta = {
  averageFloorDelta: number;
  winRateDelta: number;
  lostRateDelta: number;
  averageLowHpTurnsDelta: number;
  averageStagnantTurnsDelta: number;
  averageRiskyTrapStepsDelta: number;
  averageDamageTakenDelta: number;
};

type RegressionCandidate = {
  scope: "label" | "role";
  label: string;
  roleId?: string;
  score: number;
  reasons: string[];
  delta: ComparisonDelta;
};

type RunRegression = {
  label: string;
  roleId: string;
  seed: number;
  baselineStatus: GameState["status"];
  candidateStatus: GameState["status"];
  floorDelta: number;
  turnsDelta: number;
  lowHpTurnsDelta: number;
  stagnantTurnsDelta: number;
  trapStepsDelta: number;
  damageTakenDelta: number;
  score: number;
  candidateSummary: string;
};

type AiHintSample = {
  hint: string;
  count: number;
  samples: Array<{
    label: string;
    roleId: string;
    seed: number;
    floor: number;
    status: GameState["status"];
    summary: string;
  }>;
};

export type BatchSimulationReport = {
  generatedAt: string;
  inputs: {
    preset: BatchPreset;
    seeds: number[];
    turns: number;
    roles: "all" | string[];
    configs: ConfigSpec[];
    jobs: number;
    trace: boolean;
    profile: boolean;
    logLimit: number | null;
    decisionPolicy: DecisionPolicy;
    watcherPolicy: WatcherPolicy;
    tactics: string[];
    bossTrial: number;
    foundationRank: number;
    heat: number;
    aftermath?: string;
  };
  performance: {
    jobs: number;
    batchElapsedMs: number;
    simulationElapsedMs: number;
    averageRunElapsedMs: number;
    runsPerSecond: number;
    profile?: BatchProfileSummary;
  };
  runs: SimulationRunResult[];
  byLabel: Record<string, AggregateSummary>;
  byRole: Record<string, AggregateSummary>;
  byTemperament: Record<string, AggregateSummary>;
  byLabelRole: Record<string, Record<string, AggregateSummary>>;
  comparison: {
    baselineLabel: string;
    byLabel: Record<string, ComparisonDelta>;
    byRole: Record<string, Record<string, ComparisonDelta>>;
  };
  analysis: {
    regressionCandidates: RegressionCandidate[];
    topRunRegressions: RunRegression[];
    aiHintSamples: AiHintSample[];
  };
};

type BatchProfileSummary = {
  taskCount: number;
  childProcessCount: number;
  childWallMs: number;
  jsonParseMs: number;
  averageChildWallMs: number;
  maxChildWallMs: number;
  queueWaitMs: number;
  reportBuildMs: number;
  reportWriteMs: number;
  runProfile: SimulationProfileSummary | null;
};

type SimulationProfileSummary = {
  configLoadMs: number;
  initMs: number;
  turnLoopMs: number;
  finalObserveMs: number;
  analyzeMs: number;
  totalMeasuredMs: number;
  timers: SimulationProfile["timers"];
};

export type TaskExecutionProfile = {
  index: number;
  childProcess: boolean;
  queueWaitMs: number;
  childWallMs: number;
  parseMs: number;
};

export function createBatchReport(
  options: CliOptions,
  runResults: SimulationRunResult[],
  taskProfiles: TaskExecutionProfile[],
  reportBuildMs: number,
  reportWriteMs: number,
  batchStartMs: number,
): BatchSimulationReport {
  const byLabel = groupAggregate(runResults, (run) => run.label);
  const byRole = groupAggregate(runResults, (run) => run.roleId);
  const byTemperament = groupAggregate(runResults, (run) => run.temperament);
  const byLabelRole: BatchSimulationReport["byLabelRole"] = {};
  const batchElapsedMs = Math.round(performance.now() - batchStartMs);
  const simulationElapsedMs = runResults.reduce((sum, run) => sum + run.elapsedMs, 0);
  for (const config of options.configs) {
    byLabelRole[config.label] = groupAggregate(runResults.filter((run) => run.label === config.label), (run) => run.roleId);
  }
  return {
    generatedAt: new Date().toISOString(),
    inputs: {
      preset: options.preset,
      seeds: options.seeds,
      turns: options.turns,
      roles: options.roles,
      configs: options.configs,
      jobs: options.jobs,
      trace: options.trace,
      profile: options.profile,
      logLimit: options.logLimit,
      decisionPolicy: options.decisionPolicy,
      watcherPolicy: options.watcherPolicy,
      tactics: options.tactics,
      bossTrial: options.bossTrial,
      foundationRank: options.foundationRank,
      heat: options.heat,
      aftermath: options.aftermath,
    },
    performance: {
      jobs: options.jobs,
      batchElapsedMs,
      simulationElapsedMs,
      averageRunElapsedMs: ratio(simulationElapsedMs, runResults.length),
      runsPerSecond: batchElapsedMs === 0 ? 0 : round(runResults.length / (batchElapsedMs / 1000)),
      profile: options.profile ? createBatchProfile(taskProfiles, runResults, reportBuildMs, reportWriteMs) : undefined,
    },
    runs: runResults,
    byLabel,
    byRole,
    byTemperament,
    byLabelRole,
    comparison: compareAgainstBaseline(options.configs[0]?.label ?? "baseline", byLabel, byLabelRole),
    analysis: createAnalysis(options.configs[0]?.label ?? "baseline", runResults, byLabel, byLabelRole),
  };
}

export function createBatchProfile(
  taskProfiles: TaskExecutionProfile[],
  runResults: SimulationRunResult[],
  reportBuildMs: number,
  reportWriteMs: number,
): BatchProfileSummary {
  const childProfiles = taskProfiles.filter((profile) => profile.childProcess);
  const childWallMs = taskProfiles.reduce((sum, profile) => sum + profile.childWallMs, 0);
  const parseMs = taskProfiles.reduce((sum, profile) => sum + profile.parseMs, 0);
  const maxChildWallMs = taskProfiles.reduce((max, profile) => Math.max(max, profile.childWallMs), 0);
  return {
    taskCount: taskProfiles.length,
    childProcessCount: childProfiles.length,
    childWallMs: round(childWallMs),
    jsonParseMs: round(parseMs),
    averageChildWallMs: ratio(childWallMs, taskProfiles.length),
    maxChildWallMs: round(maxChildWallMs),
    queueWaitMs: round(taskProfiles.reduce((sum, profile) => sum + profile.queueWaitMs, 0)),
    reportBuildMs,
    reportWriteMs,
    runProfile: summarizeSimulationProfiles(runResults),
  };
}

function summarizeSimulationProfiles(runResults: SimulationRunResult[]): SimulationProfileSummary | null {
  const profiles = runResults.map((run) => run.profile).filter((profile): profile is SimulationProfile => !!profile);
  if (profiles.length === 0) {
    return null;
  }
  const timers: SimulationProfileSummary["timers"] = {
    observeGame: { calls: 0, ms: 0 },
    chooseAutoplayAction: { calls: 0, ms: 0 },
    getAutoplayDebugState: { calls: 0, ms: 0 },
    applyAction: { calls: 0, ms: 0 },
    recordTurn: { calls: 0, ms: 0 },
  };
  for (const profile of profiles) {
    for (const key of Object.keys(timers) as Array<keyof SimulationProfileSummary["timers"]>) {
      timers[key].calls += profile.timers[key].calls;
      timers[key].ms = round(timers[key].ms + profile.timers[key].ms);
    }
  }
  return {
    configLoadMs: round(profiles.reduce((sum, profile) => sum + profile.configLoadMs, 0)),
    initMs: round(profiles.reduce((sum, profile) => sum + profile.initMs, 0)),
    turnLoopMs: round(profiles.reduce((sum, profile) => sum + profile.turnLoopMs, 0)),
    finalObserveMs: round(profiles.reduce((sum, profile) => sum + profile.finalObserveMs, 0)),
    analyzeMs: round(profiles.reduce((sum, profile) => sum + profile.analyzeMs, 0)),
    totalMeasuredMs: round(profiles.reduce((sum, profile) => sum + profile.totalMeasuredMs, 0)),
    timers,
  };
}

function groupAggregate<T extends string>(items: SimulationRunResult[], keyFor: (run: SimulationRunResult) => T): Record<T, AggregateSummary> {
  const grouped = new Map<T, SimulationRunResult[]>();
  for (const item of items) {
    const key = keyFor(item);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  const result = {} as Record<T, AggregateSummary>;
  for (const [key, group] of grouped) {
    result[key] = summarizeRuns(group);
  }
  return result;
}

function summarizeRuns(runResults: SimulationRunResult[]): AggregateSummary {
  const statusCounts: AggregateSummary["statusCounts"] = { playing: 0, won: 0, lost: 0, returned: 0, stranded: 0 };
  const deathCauses: Record<string, number> = {};
  const decisionChoices: Record<string, number> = {};
  const hintCounts = new Map<string, number>();
  const actionTotals = createActionCounts();

  for (const run of runResults) {
    statusCounts[run.status] += 1;
    for (const action of Object.keys(actionTotals) as Array<GameAction["type"]>) {
      actionTotals[action] += run.actions[action];
    }
    if (run.review.deathCause) {
      deathCauses[run.review.deathCause] = (deathCauses[run.review.deathCause] ?? 0) + 1;
    }
    for (const decision of run.review.decisions) {
      decisionChoices[decision.optionId] = (decisionChoices[decision.optionId] ?? 0) + 1;
    }
    for (const hint of run.review.aiImprovementHints) {
      hintCounts.set(hint, (hintCounts.get(hint) ?? 0) + 1);
    }
  }

  const count = runResults.length;
  const totalElapsedMs = runResults.reduce((sum, run) => sum + run.elapsedMs, 0);
  return {
    averageDynamics: Object.fromEntries(["dodges", "telegraphs", "terrainLures", "awakened", "heatHits", "lightsPlaced", "borrowed"].map((key) => [key, average(runResults, (run) => run.dynamics?.[key as keyof ExpeditionDynamics["stats"]] ?? 0)])) as ExpeditionDynamics["stats"],
    averageUnpaidFlameDebt: average(runResults, (run) => run.unpaidFlameDebt ?? 0),
    averageOverflowedEmbers: average(runResults, (run) => run.overflowedEmbers ?? 0),
    averageRitesUsed: average(runResults, (run) => run.ritesUsed ?? 0),
    runs: count,
    totalElapsedMs,
    averageElapsedMs: ratio(totalElapsedMs, count),
    runsPerSecond: totalElapsedMs === 0 ? 0 : round(count / (totalElapsedMs / 1000)),
    statusCounts,
    winRate: ratio(statusCounts.won, count),
    lostRate: ratio(statusCounts.lost, count),
    returnedRate: ratio(statusCounts.returned, count),
    strandedRate: ratio(statusCounts.stranded, count),
    playingRate: ratio(statusCounts.playing, count),
    averageFloor: average(runResults, (run) => run.floor),
    averageTurns: average(runResults, (run) => run.turns),
    averageShards: average(runResults, (run) => run.shards.total),
    medianShards: median(runResults.map((run) => run.shards.total)),
    averageDecisions: average(runResults, (run) => run.decisions),
    missionCompletionRate: ratio(runResults.filter((run) => run.missionCompleted).length, count),
    averageInterventions: average(runResults, (run) => run.interventions),
    averageProjectedDisplayMs: average(runResults, (run) => run.projectedDisplayMs),
    averageFinalHp: average(runResults, (run) => run.review.stats.finalHp ?? 0),
    averageLowHpTurns: average(runResults, (run) => run.review.stats.lowHpTurns),
    averageStagnantTurns: average(runResults, (run) => run.review.stats.stagnantTurns),
    averageRiskyTrapSteps: average(runResults, (run) => run.review.stats.riskyTrapSteps),
    averageDamageTaken: average(runResults, (run) => run.review.stats.damageTaken),
    averageHealingReceived: average(runResults, (run) => run.review.stats.healingReceived),
    averageActions: {
      move: ratio(actionTotals.move, count),
      wait: ratio(actionTotals.wait, count),
      pickup: ratio(actionTotals.pickup, count),
      equip: ratio(actionTotals.equip, count),
      dropItem: ratio(actionTotals.dropItem, count),
      useItem: ratio(actionTotals.useItem, count),
      shoot: ratio(actionTotals.shoot, count),
      merchantService: ratio(actionTotals.merchantService, count),
      descend: ratio(actionTotals.descend, count),
      resolveDecision: ratio(actionTotals.resolveDecision, count),
      invokeLantern: ratio(actionTotals.invokeLantern, count),
      placeLantern: ratio(actionTotals.placeLantern, count),
      borrowFlame: ratio(actionTotals.borrowFlame, count),
    },
    averagePickups: average(runResults, (run) => run.pickups),
    averageAttacks: average(runResults, (run) => run.attacks),
    averageDiscoveries: average(runResults, (run) => run.discoveries),
    averageAttacksPer100Turns: average(runResults, (run) => run.turns === 0 ? 0 : run.attacks / run.turns * 100),
    averageDescents: average(runResults, (run) => run.descents),
    deathCauses,
    decisionChoices,
    aiHints: [...hintCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([hint, countValue]) => ({ hint, count: countValue })),
  };
}

function compareAgainstBaseline(
  baselineLabel: string,
  byLabel: Record<string, AggregateSummary>,
  byLabelRole: Record<string, Record<string, AggregateSummary>>,
): BatchSimulationReport["comparison"] {
  const baseline = byLabel[baselineLabel];
  const labelComparison: Record<string, ComparisonDelta> = {};
  if (baseline) {
    for (const [label, summary] of Object.entries(byLabel)) {
      if (label !== baselineLabel) {
        labelComparison[label] = deltaFrom(baseline, summary);
      }
    }
  }

  const roleComparison: Record<string, Record<string, ComparisonDelta>> = {};
  const baselineRoles = byLabelRole[baselineLabel] ?? {};
  for (const [roleId, baselineSummary] of Object.entries(baselineRoles)) {
    roleComparison[roleId] = {};
    for (const [label, roleSummaries] of Object.entries(byLabelRole)) {
      const candidate = roleSummaries[roleId];
      if (label !== baselineLabel && candidate) {
        roleComparison[roleId][label] = deltaFrom(baselineSummary, candidate);
      }
    }
  }
  return { baselineLabel, byLabel: labelComparison, byRole: roleComparison };
}

function deltaFrom(baseline: AggregateSummary, candidate: AggregateSummary): ComparisonDelta {
  return {
    averageFloorDelta: round(candidate.averageFloor - baseline.averageFloor),
    winRateDelta: round(candidate.winRate - baseline.winRate),
    lostRateDelta: round(candidate.lostRate - baseline.lostRate),
    averageLowHpTurnsDelta: round(candidate.averageLowHpTurns - baseline.averageLowHpTurns),
    averageStagnantTurnsDelta: round(candidate.averageStagnantTurns - baseline.averageStagnantTurns),
    averageRiskyTrapStepsDelta: round(candidate.averageRiskyTrapSteps - baseline.averageRiskyTrapSteps),
    averageDamageTakenDelta: round(candidate.averageDamageTaken - baseline.averageDamageTaken),
  };
}

function createAnalysis(
  baselineLabel: string,
  runResults: SimulationRunResult[],
  byLabel: Record<string, AggregateSummary>,
  byLabelRole: Record<string, Record<string, AggregateSummary>>,
): BatchSimulationReport["analysis"] {
  return {
    regressionCandidates: findRegressionCandidates(baselineLabel, byLabel, byLabelRole),
    topRunRegressions: findTopRunRegressions(baselineLabel, runResults),
    aiHintSamples: collectAiHintSamples(runResults),
  };
}

function findRegressionCandidates(
  baselineLabel: string,
  byLabel: Record<string, AggregateSummary>,
  byLabelRole: Record<string, Record<string, AggregateSummary>>,
): RegressionCandidate[] {
  const candidates: RegressionCandidate[] = [];
  const baseline = byLabel[baselineLabel];
  if (baseline) {
    for (const [label, summary] of Object.entries(byLabel)) {
      if (label === baselineLabel) {
        continue;
      }
      const delta = deltaFrom(baseline, summary);
      const reasons = regressionReasons(delta);
      if (reasons.length > 0) {
        candidates.push({ scope: "label", label, score: regressionScore(delta), reasons, delta });
      }
    }
  }

  const baselineRoles = byLabelRole[baselineLabel] ?? {};
  for (const [roleId, baselineSummary] of Object.entries(baselineRoles)) {
    for (const [label, roleSummaries] of Object.entries(byLabelRole)) {
      const summary = roleSummaries[roleId];
      if (label === baselineLabel || !summary) {
        continue;
      }
      const delta = deltaFrom(baselineSummary, summary);
      const reasons = regressionReasons(delta);
      if (reasons.length > 0) {
        candidates.push({ scope: "role", label, roleId, score: regressionScore(delta), reasons, delta });
      }
    }
  }

  return candidates.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, 12);
}

function regressionReasons(delta: ComparisonDelta): string[] {
  const reasons: string[] = [];
  if (delta.winRateDelta <= -0.05) {
    reasons.push(`勝率 ${formatSigned(delta.winRateDelta)}`);
  }
  if (delta.averageFloorDelta <= -0.3) {
    reasons.push(`平均階 ${formatSigned(delta.averageFloorDelta)}`);
  }
  if (delta.lostRateDelta >= 0.05) {
    reasons.push(`敗北率 ${formatSigned(delta.lostRateDelta)}`);
  }
  if (delta.averageLowHpTurnsDelta >= 5) {
    reasons.push(`低HP ${formatSigned(delta.averageLowHpTurnsDelta)}`);
  }
  if (delta.averageStagnantTurnsDelta >= 8) {
    reasons.push(`停滞 ${formatSigned(delta.averageStagnantTurnsDelta)}`);
  }
  if (delta.averageRiskyTrapStepsDelta >= 1) {
    reasons.push(`罠踏み ${formatSigned(delta.averageRiskyTrapStepsDelta)}`);
  }
  if (delta.averageDamageTakenDelta >= 20) {
    reasons.push(`被ダメ ${formatSigned(delta.averageDamageTakenDelta)}`);
  }
  return reasons;
}

function regressionScore(delta: ComparisonDelta): number {
  return round(
    Math.max(0, -delta.winRateDelta * 100)
      + Math.max(0, -delta.averageFloorDelta * 10)
      + Math.max(0, delta.lostRateDelta * 80)
      + Math.max(0, delta.averageLowHpTurnsDelta)
      + Math.max(0, delta.averageStagnantTurnsDelta / 2)
      + Math.max(0, delta.averageRiskyTrapStepsDelta * 8)
      + Math.max(0, delta.averageDamageTakenDelta / 10),
  );
}

function findTopRunRegressions(baselineLabel: string, runResults: SimulationRunResult[]): RunRegression[] {
  const baselineRuns = new Map<string, SimulationRunResult>();
  for (const run of runResults) {
    if (run.label === baselineLabel) {
      baselineRuns.set(runKey(run), run);
    }
  }
  const regressions: RunRegression[] = [];
  for (const run of runResults) {
    if (run.label === baselineLabel) {
      continue;
    }
    const baseline = baselineRuns.get(runKey(run));
    if (!baseline) {
      continue;
    }
    const regression = runRegressionFrom(baseline, run);
    if (regression.score > 0) {
      regressions.push(regression);
    }
  }
  return regressions.sort((a, b) => b.score - a.score || a.roleId.localeCompare(b.roleId) || a.seed - b.seed).slice(0, 12);
}

function runRegressionFrom(baseline: SimulationRunResult, candidate: SimulationRunResult): RunRegression {
  const floorDelta = candidate.floor - baseline.floor;
  const turnsDelta = candidate.turns - baseline.turns;
  const lowHpTurnsDelta = candidate.review.stats.lowHpTurns - baseline.review.stats.lowHpTurns;
  const stagnantTurnsDelta = candidate.review.stats.stagnantTurns - baseline.review.stats.stagnantTurns;
  const trapStepsDelta = candidate.review.stats.riskyTrapSteps - baseline.review.stats.riskyTrapSteps;
  const damageTakenDelta = candidate.review.stats.damageTaken - baseline.review.stats.damageTaken;
  const statusScore = statusRegressionScore(baseline.status, candidate.status);
  const score = round(
    statusScore
      + Math.max(0, -floorDelta * 12)
      + Math.max(0, lowHpTurnsDelta / 2)
      + Math.max(0, stagnantTurnsDelta / 3)
      + Math.max(0, trapStepsDelta * 10)
      + Math.max(0, damageTakenDelta / 12),
  );
  return {
    label: candidate.label,
    roleId: candidate.roleId,
    seed: candidate.seed,
    baselineStatus: baseline.status,
    candidateStatus: candidate.status,
    floorDelta,
    turnsDelta,
    lowHpTurnsDelta,
    stagnantTurnsDelta,
    trapStepsDelta,
    damageTakenDelta,
    score,
    candidateSummary: candidate.review.summaryText,
  };
}

function statusRegressionScore(baseline: GameState["status"], candidate: GameState["status"]): number {
  if (baseline === candidate) {
    return 0;
  }
  if (baseline === "won") {
    return candidate === "lost" ? 80 : 40;
  }
  if (baseline === "playing" && candidate === "lost") {
    return 35;
  }
  return 0;
}

function collectAiHintSamples(runResults: SimulationRunResult[]): AiHintSample[] {
  const hints = new Map<string, AiHintSample>();
  for (const run of runResults) {
    for (const hint of run.review.aiImprovementHints) {
      const entry = hints.get(hint) ?? { hint, count: 0, samples: [] };
      entry.count += 1;
      if (entry.samples.length < 5) {
        entry.samples.push({
          label: run.label,
          roleId: run.roleId,
          seed: run.seed,
          floor: run.floor,
          status: run.status,
          summary: run.review.summaryText,
        });
      }
      hints.set(hint, entry);
    }
  }
  return [...hints.values()].sort((a, b) => b.count - a.count || a.hint.localeCompare(b.hint)).slice(0, 8);
}

function runKey(run: SimulationRunResult): string {
  return `${run.roleId}:${run.seed}`;
}

export function renderMarkdownReport(report: BatchSimulationReport): string {
  const lines = [
    "# Balance Simulation Batch",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Preset: ${report.inputs.preset}`,
    `- Seeds: ${rangeLabel(report.inputs.seeds)}`,
    `- Turns: ${report.inputs.turns}`,
    `- Jobs: ${report.inputs.jobs}`,
    `- Trace/Profile: ${report.inputs.trace ? "on" : "off"} / ${report.inputs.profile ? "on" : "off"}`,
    `- Log limit: ${report.inputs.logLimit ?? "full"}`,
    `- Decision policy: ${report.inputs.decisionPolicy}`,
    `- Watcher policy: ${report.inputs.watcherPolicy}`,
    `- Boss trial / foundation rank: ${report.inputs.bossTrial} / ${report.inputs.foundationRank}`,
    `- Tactics: ${report.inputs.tactics.join(", ") || "none"}`,
    `- Heat / aftermath: ${report.inputs.heat} / ${report.inputs.aftermath ?? "none"}`,
    `- Configs: ${report.inputs.configs.map((config) => `${config.label}=${config.path}`).join(", ")}`,
    `- Batch elapsed: ${report.performance.batchElapsedMs}ms (${formatNumber(report.performance.runsPerSecond)} runs/sec)`,
    "",
  ];

  lines.push("## PDCA Alerts", "");
  if (report.analysis.regressionCandidates.length === 0) {
    lines.push("- 明確な悪化候補はありません。");
  } else {
    lines.push("| Scope | Label | Role | Score | Reasons |");
    lines.push("| --- | --- | --- | ---: | --- |");
    for (const candidate of report.analysis.regressionCandidates) {
      lines.push(`| ${candidate.scope} | ${candidate.label} | ${candidate.roleId ?? "-"} | ${formatNumber(candidate.score)} | ${candidate.reasons.join(", ")} |`);
    }
  }

  lines.push("", `## Comparison vs ${report.comparison.baselineLabel}`, "");
  if (Object.keys(report.comparison.byLabel).length === 0) {
    lines.push("- 比較対象の追加configはありません。");
  } else {
    lines.push("| Label | Avg Floor Δ | Win Rate Δ | Lost Rate Δ | Low HP Δ | Stagnant Δ | Trap Steps Δ | Damage Δ |");
    lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const [label, delta] of Object.entries(report.comparison.byLabel)) {
      lines.push(`| ${label} | ${formatSigned(delta.averageFloorDelta)} | ${formatSigned(delta.winRateDelta)} | ${formatSigned(delta.lostRateDelta)} | ${formatSigned(delta.averageLowHpTurnsDelta)} | ${formatSigned(delta.averageStagnantTurnsDelta)} | ${formatSigned(delta.averageRiskyTrapStepsDelta)} | ${formatSigned(delta.averageDamageTakenDelta)} |`);
    }
  }

  lines.push("", "## Top Run Regressions", "");
  if (report.analysis.topRunRegressions.length === 0) {
    lines.push("- seed単位の悪化候補はありません。");
  } else {
    lines.push("| Label | Role | Seed | Score | Status | Floor Δ | Low HP Δ | Stagnant Δ | Trap Δ | Damage Δ | Summary |");
    lines.push("| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |");
    for (const regression of report.analysis.topRunRegressions) {
      lines.push(`| ${regression.label} | ${regression.roleId} | ${regression.seed} | ${formatNumber(regression.score)} | ${regression.baselineStatus}->${regression.candidateStatus} | ${formatSigned(regression.floorDelta)} | ${formatSigned(regression.lowHpTurnsDelta)} | ${formatSigned(regression.stagnantTurnsDelta)} | ${formatSigned(regression.trapStepsDelta)} | ${formatSigned(regression.damageTakenDelta)} | ${regression.candidateSummary} |`);
    }
  }

  lines.push(
    "",
    "## Label x Role",
    "",
    "| Label | Role | Runs | Won | Returned | Lost | Stranded | Playing | Avg Floor | Avg Turns | Avg Shards | Median Shards | Mission % | Interventions | Display min | Avg HP | Low HP | Stagnant | Trap Steps | Discoveries | Pickups | Attacks | Attacks/100T | Descents | Decisions | UseItem | Merchant | Avg ms/run | Runs/sec | Death Causes | Choices |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |",
  );

  for (const config of report.inputs.configs) {
    const roleSummaries = report.byLabelRole[config.label] ?? {};
    for (const [roleId, summary] of Object.entries(roleSummaries)) {
      lines.push([
        config.label,
        roleId,
        String(summary.runs),
        String(summary.statusCounts.won),
        String(summary.statusCounts.returned),
        String(summary.statusCounts.lost),
        String(summary.statusCounts.stranded),
        String(summary.statusCounts.playing),
        formatNumber(summary.averageFloor),
        formatNumber(summary.averageTurns),
        formatNumber(summary.averageShards),
        formatNumber(summary.medianShards),
        formatNumber(summary.missionCompletionRate * 100),
        formatNumber(summary.averageInterventions),
        formatNumber(summary.averageProjectedDisplayMs / 60_000),
        formatNumber(summary.averageFinalHp),
        formatNumber(summary.averageLowHpTurns),
        formatNumber(summary.averageStagnantTurns),
        formatNumber(summary.averageRiskyTrapSteps),
        formatNumber(summary.averageDiscoveries),
        formatNumber(summary.averagePickups),
        formatNumber(summary.averageAttacks),
        formatNumber(summary.averageAttacksPer100Turns),
        formatNumber(summary.averageDescents),
        formatNumber(summary.averageDecisions),
        formatNumber(summary.averageActions.useItem),
        formatNumber(summary.averageActions.merchantService),
        formatNumber(summary.averageElapsedMs),
        formatNumber(summary.runsPerSecond),
        formatCounts(summary.deathCauses),
        formatCounts(summary.decisionChoices),
      ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
    }
  }

  lines.push("", "## Realtime Dynamics", "", "| Label | Telegraphs | Dodges | Trap Lures | Awakened | Heat Hits | Placed Lights | Borrowed Flame | Unpaid Debt | Rites | Overflowed Embers |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const [label, summary] of Object.entries(report.byLabel)) {
    const d = summary.averageDynamics;
    lines.push(`| ${label} | ${formatNumber(d.telegraphs)} | ${formatNumber(d.dodges)} | ${formatNumber(d.terrainLures)} | ${formatNumber(d.awakened)} | ${formatNumber(d.heatHits)} | ${formatNumber(d.lightsPlaced)} | ${formatNumber(d.borrowed)} | ${formatNumber(summary.averageUnpaidFlameDebt)} | ${formatNumber(summary.averageRitesUsed)} | ${formatNumber(summary.averageOverflowedEmbers)} |`);
  }
  lines.push("", "## Top AI Hints", "");
  if (report.analysis.aiHintSamples.length === 0) {
    lines.push("- なし");
  } else {
    for (const hint of report.analysis.aiHintSamples) {
      lines.push(`### ${hint.count}x ${hint.hint}`);
      for (const sample of hint.samples) {
        lines.push(`- ${sample.label} / ${sample.roleId} / seed ${sample.seed} / floor ${sample.floor} / ${sample.status}: ${sample.summary}`);
      }
      lines.push("");
    }
  }
  if (report.performance.profile) {
    const profile = report.performance.profile;
    lines.push("## Performance Profile", "");
    lines.push(`- Tasks: ${profile.taskCount}`);
    lines.push(`- Child processes: ${profile.childProcessCount}`);
    lines.push(`- Child wall total: ${formatNumber(profile.childWallMs)}ms`);
    lines.push(`- JSON parse total: ${formatNumber(profile.jsonParseMs)}ms`);
    lines.push(`- Avg child wall: ${formatNumber(profile.averageChildWallMs)}ms`);
    lines.push(`- Max child wall: ${formatNumber(profile.maxChildWallMs)}ms`);
    lines.push(`- Queue wait total: ${formatNumber(profile.queueWaitMs)}ms`);
    lines.push(`- Report build/write: ${formatNumber(profile.reportBuildMs)}ms / ${formatNumber(profile.reportWriteMs)}ms`);
    if (profile.runProfile) {
      lines.push("", "### Simulation Timers", "");
      lines.push("| Timer | Calls | Total ms | Avg ms/call |");
      lines.push("| --- | ---: | ---: | ---: |");
      for (const [key, timer] of Object.entries(profile.runProfile.timers)) {
        lines.push(`| ${key} | ${timer.calls} | ${formatNumber(timer.ms)} | ${formatNumber(ratio(timer.ms, timer.calls))} |`);
      }
      lines.push("", "### Simulation Phases", "");
      lines.push("| Phase | Total ms |");
      lines.push("| --- | ---: |");
      lines.push(`| configLoad | ${formatNumber(profile.runProfile.configLoadMs)} |`);
      lines.push(`| init | ${formatNumber(profile.runProfile.initMs)} |`);
      lines.push(`| turnLoop | ${formatNumber(profile.runProfile.turnLoopMs)} |`);
      lines.push(`| finalObserve | ${formatNumber(profile.runProfile.finalObserveMs)} |`);
      lines.push(`| analyze | ${formatNumber(profile.runProfile.analyzeMs)} |`);
      lines.push(`| totalMeasured | ${formatNumber(profile.runProfile.totalMeasuredMs)} |`);
    }
  }
  return lines.join("\n").trimEnd();
}

function average(items: SimulationRunResult[], valueFor: (run: SimulationRunResult) => number): number {
  return ratio(items.reduce((sum, item) => sum + valueFor(item), 0), items.length);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return round(sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]);
}

function ratio(value: number, total: number): number {
  return total === 0 ? 0 : round(value / total);
}

export function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatNumber(value: number): string {
  return value.toFixed(2);
}

function formatSigned(value: number): string {
  return `${value >= 0 ? "+" : ""}${formatNumber(value)}`;
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts);
  return entries.length > 0 ? entries.map(([key, value]) => `${key}:${value}`).join(", ") : "-";
}

function rangeLabel(values: number[]): string {
  if (values.length <= 6) {
    return values.join(", ");
  }
  return `${values[0]}..${values[values.length - 1]} (${values.length})`;
}
