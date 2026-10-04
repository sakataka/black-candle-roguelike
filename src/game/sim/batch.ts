import { parseCli } from "./batchCli";
import { createBatchReport, createBatchProfile, renderMarkdownReport, round, type BatchSimulationReport, type TaskExecutionProfile } from "./batchReport";
export type { BatchSimulationReport } from "./batchReport";
import { getGameConfig, loadBunGameConfig } from "../content/config";
import { runSimulation, type SimulationRunResult } from "./simulation";

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
        logLimit: options.logLimit,
        decisionPolicy: options.decisionPolicy,
        watcherPolicy: options.watcherPolicy,
        tactics: options.tactics,
        bossTrial: options.bossTrial,
        foundationRank: options.foundationRank,
        legacy: options.legacy,
        heat: options.heat,
        aftermath: options.aftermath as SimulationTask["aftermath"],
      });
    }
  }
}

const taskResults = await runSimulationTasks(tasks, options.jobs, options.profile);
const reportStartMs = performance.now();
const report = createBatchReport(options, taskResults.runs, taskResults.profiles, 0, 0, batchStartMs);
if (reportProfile) {
  reportProfile.reportBuildMs = round(performance.now() - reportStartMs);
  report.performance.profile = createBatchProfile(taskResults.profiles, taskResults.runs, reportProfile.reportBuildMs, 0);
}
let markdown = renderMarkdownReport(report);
const jsonPath = normalizedJsonPath(options.out);
const markdownPath = jsonPath.replace(/\.json$/i, ".md");
const writeStartMs = performance.now();
await writeReports(jsonPath, markdownPath, report, markdown);
if (reportProfile) {
  reportProfile.reportWriteMs = round(performance.now() - writeStartMs);
  report.performance.profile = createBatchProfile(taskResults.profiles, taskResults.runs, reportProfile.reportBuildMs, reportProfile.reportWriteMs);
  const updatedMarkdown = renderMarkdownReport(report);
  await writeReports(jsonPath, markdownPath, report, updatedMarkdown);
  markdown = updatedMarkdown;
}

console.log(markdown);
console.log(`\nJSON: ${jsonPath}`);
console.log(`Markdown: ${markdownPath}`);
console.log("Latest: tmp/sim-reports/latest.json, tmp/sim-reports/latest.md");

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
      "--log-limit",
      task.logLimit === null ? "none" : String(task.logLimit),
      "--decision-policy",
      task.decisionPolicy ?? "temperament",
      "--watcher",
      task.watcherPolicy ?? "none",
      ...(task.tactics?.length ? ["--tactics", task.tactics.join(",")] : []),
      "--boss-trial", String(task.bossTrial ?? 0),
      "--foundation-rank", String(task.foundationRank ?? 0),
      ...(task.legacy ? ["--legacy", task.legacy] : []),
      ...(task.heat ? ["--heat", String(task.heat)] : []),
      ...(task.aftermath ? ["--aftermath", task.aftermath] : []),
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

async function loadRoleIds(configPath: string): Promise<string[]> {
  await loadBunGameConfig(configPath);
  return getGameConfig().roles.map((role) => role.id);
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

function parentDirectory(path: string): string {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(0, index) : ".";
}


async function writeReports(jsonPath: string, markdownPath: string, report: BatchSimulationReport, markdown: string): Promise<void> {
  const json = `${JSON.stringify(report, null, 2)}\n`;
  await writeText(jsonPath, json);
  await writeText(markdownPath, `${markdown}\n`);
  await writeText("tmp/sim-reports/latest.json", json);
  await writeText("tmp/sim-reports/latest.md", `${markdown}\n`);
}
