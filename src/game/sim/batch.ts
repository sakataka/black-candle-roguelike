import { getGameConfig, loadBunGameConfig } from "../content/config";
import type { GameAction, GameState } from "../types";
import { runSimulation, type SimulationProfile, type SimulationRunResult } from "./simulation";

declare const Bun: {
  argv: string[];
  write: (path: string, data: string) => Promise<number>;
  spawnSync: (cmd: string[]) => { exitCode: number; stderr: Uint8Array };
  spawn: (options: {
    cmd: string[];
    stdout: "pipe";
    stderr: "pipe";
  }) => {
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
    exited: Promise<number>;
  };
};

type ConfigSpec = {
  label: string;
  path: string;
};

type CliOptions = {
  seeds: number[];
  turns: number;
  roles: "all" | string[];
  configs: ConfigSpec[];
  out: string;
  jobs: number;
  trace: boolean;
  profile: boolean;
};

type AggregateSummary = {
  runs: number;
  totalElapsedMs: number;
  averageElapsedMs: number;
  runsPerSecond: number;
  statusCounts: Record<GameState["status"], number>;
  winRate: number;
  lostRate: number;
  playingRate: number;
  averageFloor: number;
  averageTurns: number;
  averageFinalHp: number;
  averageLowHpTurns: number;
  averageStagnantTurns: number;
  averageRiskyTrapSteps: number;
  averageDamageTaken: number;
  averageHealingReceived: number;
  averageActions: Record<GameAction["type"], number>;
  averagePickups: number;
  averageAttacks: number;
  averageDescents: number;
  deathCauses: Record<string, number>;
  aiHints: Array<{ hint: string; count: number }>;
};

type ComparisonDelta = {
  averageFloorDelta: number;
  winRateDelta: number;
  lostRateDelta: number;
  averageLowHpTurnsDelta: number;
  averageStagnantTurnsDelta: number;
  averageDamageTakenDelta: number;
};

export type BatchSimulationReport = {
  generatedAt: string;
  inputs: {
    seeds: number[];
    turns: number;
    roles: "all" | string[];
    configs: ConfigSpec[];
    jobs: number;
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
  byLabelRole: Record<string, Record<string, AggregateSummary>>;
  comparison: {
    baselineLabel: string;
    byLabel: Record<string, ComparisonDelta>;
    byRole: Record<string, Record<string, ComparisonDelta>>;
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

type TaskExecutionProfile = {
  index: number;
  childProcess: boolean;
  queueWaitMs: number;
  childWallMs: number;
  parseMs: number;
};

const options = parseCli(Bun.argv.slice(2));
const batchStartMs = performance.now();
const tasks: SimulationTask[] = [];
const reportProfile = options.profile ? { reportBuildMs: 0, reportWriteMs: 0 } : null;

for (const config of options.configs) {
  const roleIds = options.roles === "all" ? await loadRoleIds(config.path) : options.roles;
  for (const roleId of roleIds) {
    for (const seed of options.seeds) {
      tasks.push({
        seed,
        turns: options.turns,
        roleId,
        configPath: config.path,
        label: config.label,
        trace: options.trace,
      });
    }
  }
}

const taskResults = await runSimulationTasks(tasks, options.jobs, options.profile);
const reportStartMs = performance.now();
const report = createBatchReport(options, taskResults.runs, taskResults.profiles, 0, 0);
if (reportProfile) {
  reportProfile.reportBuildMs = round(performance.now() - reportStartMs);
  report.performance.profile = createBatchProfile(taskResults.profiles, taskResults.runs, reportProfile.reportBuildMs, 0);
}
let markdown = renderMarkdownReport(report);
const jsonPath = normalizedJsonPath(options.out);
const markdownPath = jsonPath.replace(/\.json$/i, ".md");
const writeStartMs = performance.now();
await writeText(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
await writeText(markdownPath, `${markdown}\n`);
if (reportProfile) {
  reportProfile.reportWriteMs = round(performance.now() - writeStartMs);
  report.performance.profile = createBatchProfile(taskResults.profiles, taskResults.runs, reportProfile.reportBuildMs, reportProfile.reportWriteMs);
  const updatedMarkdown = renderMarkdownReport(report);
  await writeText(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeText(markdownPath, `${updatedMarkdown}\n`);
  markdown = updatedMarkdown;
}

console.log(markdown);
console.log(`\nJSON: ${jsonPath}`);
console.log(`Markdown: ${markdownPath}`);

function parseCli(args: string[]): CliOptions {
  const values = new Map<string, string[]>();
  let trace = false;
  let profile = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--trace") {
      trace = true;
      continue;
    }
    if (arg === "--profile") {
      profile = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      continue;
    }
    const equalsIndex = arg.indexOf("=");
    const key = equalsIndex >= 0 ? arg.slice(0, equalsIndex) : arg;
    const value = equalsIndex >= 0 ? arg.slice(equalsIndex + 1) : args[index + 1];
    if (equalsIndex < 0) {
      index += 1;
    }
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${key}`);
    }
    const existing = values.get(key) ?? [];
    existing.push(value);
    values.set(key, existing);
  }

  const label = last(values, "--label") ?? "baseline";
  const configs = parseConfigs(values.get("--config") ?? [], label);
  return {
    seeds: parseSeeds(last(values, "--seeds") ?? "20260504:20260533"),
    turns: Number(last(values, "--turns") ?? 800),
    roles: parseRoles(last(values, "--roles") ?? "all"),
    configs,
    out: last(values, "--out") ?? defaultOutputPath(configs),
    jobs: parseJobs(last(values, "--jobs") ?? "8"),
    trace,
    profile,
  };
}

type SimulationTask = Parameters<typeof runSimulation>[0];

async function runSimulationTasks(tasks: SimulationTask[], jobs: number, profile: boolean): Promise<{ runs: SimulationRunResult[]; profiles: TaskExecutionProfile[] }> {
  const profiles = new Array<TaskExecutionProfile>(tasks.length);
  const queuedAtMs = performance.now();
  if (jobs <= 1) {
    const results: SimulationRunResult[] = [];
    for (let index = 0; index < tasks.length; index += 1) {
      const taskStartMs = performance.now();
      results.push(await runSimulation({ ...tasks[index], profile }));
      profiles[index] = {
        index,
        childProcess: false,
        queueWaitMs: round(taskStartMs - queuedAtMs),
        childWallMs: round(performance.now() - taskStartMs),
        parseMs: 0,
      };
    }
    return { runs: results, profiles };
  }

  const results = new Array<SimulationRunResult>(tasks.length);
  let nextIndex = 0;
  const workerCount = Math.min(jobs, tasks.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < tasks.length) {
      const index = nextIndex;
      nextIndex += 1;
      const taskStartMs = performance.now();
      const result = await runSimulationInChild({ ...tasks[index], profile });
      results[index] = result.run;
      profiles[index] = {
        index,
        childProcess: true,
        queueWaitMs: round(taskStartMs - queuedAtMs),
        childWallMs: result.childWallMs,
        parseMs: result.parseMs,
      };
    }
  }));
  return { runs: results, profiles };
}

async function runSimulationInChild(task: SimulationTask): Promise<{ run: SimulationRunResult; childWallMs: number; parseMs: number }> {
  const childStartMs = performance.now();
  const proc = Bun.spawn({
    cmd: [
      Bun.argv[0],
      "run",
      "src/game/sim/headless.ts",
      String(task.seed),
      String(task.turns),
      task.roleId,
      "--config",
      task.configPath,
      "--label",
      task.label,
      ...(task.trace ? ["trace"] : []),
      ...(task.profile ? ["--profile"] : []),
    ],
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`Simulation failed for ${task.label}/${task.roleId}/${task.seed}: ${stderr || stdout}`);
  }
  const lines = stdout.trim().split("\n").filter(Boolean);
  const jsonLine = lines[lines.length - 1];
  if (!jsonLine) {
    throw new Error(`Simulation produced no output for ${task.label}/${task.roleId}/${task.seed}`);
  }
  const parseStartMs = performance.now();
  const run = JSON.parse(jsonLine) as SimulationRunResult;
  return { run, childWallMs: round(performance.now() - childStartMs), parseMs: round(performance.now() - parseStartMs) };
}

function parseConfigs(values: string[], fallbackLabel: string): ConfigSpec[] {
  const configValues = values.length > 0 ? values : ["public/config/game-balance.json"];
  const configs = configValues.map((value, index) => {
    const equalsIndex = value.indexOf("=");
    if (equalsIndex >= 0) {
      return { label: value.slice(0, equalsIndex), path: value.slice(equalsIndex + 1) };
    }
    return {
      label: configValues.length === 1 ? fallbackLabel : labelFromPath(value, index),
      path: value,
    };
  });
  const labels = new Set<string>();
  for (const config of configs) {
    if (!config.label || !config.path) {
      throw new Error(`Invalid --config value: ${config.label}=${config.path}`);
    }
    if (labels.has(config.label)) {
      throw new Error(`Duplicate config label: ${config.label}`);
    }
    labels.add(config.label);
  }
  return configs;
}

function parseSeeds(value: string): number[] {
  const seeds: number[] = [];
  for (const part of value.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const [startText, endText] = trimmed.split(":");
    const start = Number(startText);
    const end = endText === undefined ? start : Number(endText);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      throw new Error(`Invalid --seeds value: ${value}`);
    }
    const step = start <= end ? 1 : -1;
    for (let seed = start; step > 0 ? seed <= end : seed >= end; seed += step) {
      seeds.push(seed);
    }
  }
  if (seeds.length === 0) {
    throw new Error("--seeds must include at least one seed");
  }
  return seeds;
}

function parseRoles(value: string): CliOptions["roles"] {
  if (value === "all") {
    return "all";
  }
  const roles = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (roles.length === 0) {
    throw new Error("--roles must be all or a comma-separated role list");
  }
  return roles;
}

function parseJobs(value: string): number {
  const jobs = Math.floor(Number(value));
  if (!Number.isFinite(jobs) || jobs < 1) {
    throw new Error("--jobs must be a positive integer");
  }
  return jobs;
}

async function loadRoleIds(configPath: string): Promise<string[]> {
  await loadBunGameConfig(configPath);
  return getGameConfig().roles.map((role) => role.id);
}

function createBatchReport(
  options: CliOptions,
  runResults: SimulationRunResult[],
  taskProfiles: TaskExecutionProfile[],
  reportBuildMs: number,
  reportWriteMs: number,
): BatchSimulationReport {
  const byLabel = groupAggregate(runResults, (run) => run.label);
  const byRole = groupAggregate(runResults, (run) => run.roleId);
  const byLabelRole: BatchSimulationReport["byLabelRole"] = {};
  const batchElapsedMs = Math.round(performance.now() - batchStartMs);
  const simulationElapsedMs = runResults.reduce((sum, run) => sum + run.elapsedMs, 0);
  for (const config of options.configs) {
    byLabelRole[config.label] = groupAggregate(runResults.filter((run) => run.label === config.label), (run) => run.roleId);
  }
  return {
    generatedAt: new Date().toISOString(),
    inputs: {
      seeds: options.seeds,
      turns: options.turns,
      roles: options.roles,
      configs: options.configs,
      jobs: options.jobs,
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
    byLabelRole,
    comparison: compareAgainstBaseline(options.configs[0]?.label ?? "baseline", byLabel, byLabelRole),
  };
}

function createBatchProfile(
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
  const statusCounts: AggregateSummary["statusCounts"] = { playing: 0, won: 0, lost: 0 };
  const deathCauses: Record<string, number> = {};
  const hintCounts = new Map<string, number>();
  const actionTotals: Record<GameAction["type"], number> = {
    move: 0,
    wait: 0,
    pickup: 0,
    equip: 0,
    dropItem: 0,
    useItem: 0,
    merchantService: 0,
    descend: 0,
  };

  for (const run of runResults) {
    statusCounts[run.status] += 1;
    for (const action of Object.keys(actionTotals) as Array<GameAction["type"]>) {
      actionTotals[action] += run.actions[action];
    }
    if (run.review.deathCause) {
      deathCauses[run.review.deathCause] = (deathCauses[run.review.deathCause] ?? 0) + 1;
    }
    for (const hint of run.review.aiImprovementHints) {
      hintCounts.set(hint, (hintCounts.get(hint) ?? 0) + 1);
    }
  }

  const count = runResults.length;
  const totalElapsedMs = runResults.reduce((sum, run) => sum + run.elapsedMs, 0);
  return {
    runs: count,
    totalElapsedMs,
    averageElapsedMs: ratio(totalElapsedMs, count),
    runsPerSecond: totalElapsedMs === 0 ? 0 : round(count / (totalElapsedMs / 1000)),
    statusCounts,
    winRate: ratio(statusCounts.won, count),
    lostRate: ratio(statusCounts.lost, count),
    playingRate: ratio(statusCounts.playing, count),
    averageFloor: average(runResults, (run) => run.floor),
    averageTurns: average(runResults, (run) => run.turns),
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
      merchantService: ratio(actionTotals.merchantService, count),
      descend: ratio(actionTotals.descend, count),
    },
    averagePickups: average(runResults, (run) => run.pickups),
    averageAttacks: average(runResults, (run) => run.attacks),
    averageDescents: average(runResults, (run) => run.descents),
    deathCauses,
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
    averageDamageTakenDelta: round(candidate.averageDamageTaken - baseline.averageDamageTaken),
  };
}

function renderMarkdownReport(report: BatchSimulationReport): string {
  const lines = [
    "# Balance Simulation Batch",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Seeds: ${rangeLabel(report.inputs.seeds)}`,
    `- Turns: ${report.inputs.turns}`,
    `- Jobs: ${report.inputs.jobs}`,
    `- Configs: ${report.inputs.configs.map((config) => `${config.label}=${config.path}`).join(", ")}`,
    `- Batch elapsed: ${report.performance.batchElapsedMs}ms (${formatNumber(report.performance.runsPerSecond)} runs/sec)`,
    "",
    "## Label x Role",
    "",
    "| Label | Role | Runs | Won | Lost | Playing | Avg Floor | Avg Turns | Avg HP | Low HP | Stagnant | Trap Steps | Pickups | Attacks | Descents | UseItem | Merchant | Avg ms/run | Runs/sec | Death Causes |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ];

  for (const config of report.inputs.configs) {
    const roleSummaries = report.byLabelRole[config.label] ?? {};
    for (const [roleId, summary] of Object.entries(roleSummaries)) {
      lines.push([
        config.label,
        roleId,
        String(summary.runs),
        String(summary.statusCounts.won),
        String(summary.statusCounts.lost),
        String(summary.statusCounts.playing),
        formatNumber(summary.averageFloor),
        formatNumber(summary.averageTurns),
        formatNumber(summary.averageFinalHp),
        formatNumber(summary.averageLowHpTurns),
        formatNumber(summary.averageStagnantTurns),
        formatNumber(summary.averageRiskyTrapSteps),
        formatNumber(summary.averagePickups),
        formatNumber(summary.averageAttacks),
        formatNumber(summary.averageDescents),
        formatNumber(summary.averageActions.useItem),
        formatNumber(summary.averageActions.merchantService),
        formatNumber(summary.averageElapsedMs),
        formatNumber(summary.runsPerSecond),
        formatCounts(summary.deathCauses),
      ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
    }
  }

  lines.push("", `## Comparison vs ${report.comparison.baselineLabel}`, "");
  if (Object.keys(report.comparison.byLabel).length === 0) {
    lines.push("- 比較対象の追加configはありません。");
  } else {
    lines.push("| Label | Avg Floor Δ | Win Rate Δ | Lost Rate Δ | Low HP Δ | Stagnant Δ | Damage Δ |");
    lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const [label, delta] of Object.entries(report.comparison.byLabel)) {
      lines.push(`| ${label} | ${formatSigned(delta.averageFloorDelta)} | ${formatSigned(delta.winRateDelta)} | ${formatSigned(delta.lostRateDelta)} | ${formatSigned(delta.averageLowHpTurnsDelta)} | ${formatSigned(delta.averageStagnantTurnsDelta)} | ${formatSigned(delta.averageDamageTakenDelta)} |`);
    }
  }

  lines.push("", "## Top AI Hints", "");
  for (const config of report.inputs.configs) {
    const summary = report.byLabel[config.label];
    const hints = summary?.aiHints.slice(0, 5) ?? [];
    lines.push(`### ${config.label}`);
    if (hints.length === 0) {
      lines.push("- なし");
    } else {
      for (const hint of hints) {
        lines.push(`- ${hint.count}x ${hint.hint}`);
      }
    }
    lines.push("");
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

async function writeText(path: string, text: string): Promise<void> {
  const parent = parentDirectory(path);
  if (parent !== ".") {
    const mkdir = Bun.spawnSync(["mkdir", "-p", parent]);
    if (mkdir.exitCode !== 0) {
      throw new Error(`Failed to create ${parent}: ${new TextDecoder().decode(mkdir.stderr)}`);
    }
  }
  await Bun.write(path, text);
}

function normalizedJsonPath(path: string): string {
  return path.endsWith(".json") ? path : `${path}.json`;
}

function defaultOutputPath(configs: ConfigSpec[]): string {
  const label = configs.map((config) => config.label).join("-vs-") || "batch";
  return `tmp/sim-reports/${label}-${timestampForPath(new Date())}.json`;
}

function timestampForPath(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

function labelFromPath(path: string, index: number): string {
  const file = path.split("/").pop() ?? `config-${index + 1}`;
  return file.replace(/\.json$/i, "") || `config-${index + 1}`;
}

function parentDirectory(path: string): string {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(0, index) : ".";
}

function last(values: Map<string, string[]>, key: string): string | undefined {
  const entries = values.get(key);
  return entries?.[entries.length - 1];
}

function average(items: SimulationRunResult[], valueFor: (run: SimulationRunResult) => number): number {
  return ratio(items.reduce((sum, item) => sum + valueFor(item), 0), items.length);
}

function ratio(value: number, total: number): number {
  return total === 0 ? 0 : round(value / total);
}

function round(value: number): number {
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
