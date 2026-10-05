import { parseCli } from "./batchCli";
import { createBatchReport, createBatchProfile, renderMarkdownReport, round, type BatchSimulationReport, type TaskExecutionProfile } from "./batchReport";
export type { BatchSimulationReport } from "./batchReport";
import { getGameConfig, loadBunGameConfig } from "../content/config";
import { runSimulation, type SimulationRunResult } from "./simulation";
import { RESULT_PREFIX } from "./workerProtocol";

declare const Bun: {
  argv: string[];
  write: (path: string, data: string) => Promise<number>;
  spawnSync: (cmd: string[]) => { exitCode: number; stderr: Uint8Array };
  spawn: (options: {
    cmd: string[];
    stdin?: "pipe";
    stdout: "pipe";
    stderr: "pipe" | "inherit";
  }) => {
    stdin: { write: (data: string) => void; flush: () => void; end: () => void };
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
    exited: Promise<number>;
  };
};

const options = parseCli(Bun.argv.slice(2));
const batchStartMs = performance.now();
const tasks: SimulationTask[] = [];
const reportProfile = options.profile ? { reportBuildMs: 0, reportWriteMs: 0 } : null;

if (options.abilitySweep) {
  // 列ごとに、全体の条件へアビリティを一つだけ足す。最初の列は足さない基準。
  const base = options.configs[0];
  const ids = await loadAbilityIds(base.path);
  options.configs = [
    { ...base, label: "no-ability", settings: { ...base.settings, abilities: [...options.abilities] } },
    ...ids.map((id) => ({ ...base, label: id.replace(/^ability\./, ""), settings: { ...base.settings, abilities: [...options.abilities, id] } })),
  ];
}
const labels = options.configs.map((config) => config.label);
if (new Set(labels).size !== labels.length) throw new Error(`Duplicate label: ${labels.join(", ")}`);

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
        abilities: options.abilities,
        facilities: options.facilities,
        heat: options.heat,
        aftermath: options.aftermath as SimulationTask["aftermath"],
        ...config.settings,
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
  // 常駐ワーカーを jobs 本だけ起こし、空いたワーカーへ次のタスクを渡す。
  await Promise.all(Array.from({ length: workerCount }, async () => {
    const worker = startWorker();
    try {
      while (nextIndex < tasks.length) {
        const index = nextIndex;
        nextIndex += 1;
        const taskStartMs = performance.now();
        const run = await worker.run({ ...tasks[index], profile });
        results[index] = run;
        profiles[index] = {
          index,
          childProcess: true,
          queueWaitMs: round(taskStartMs - queuedAtMs),
          childWallMs: round(performance.now() - taskStartMs),
          parseMs: 0,
        };
      }
    } finally {
      worker.close();
    }
  }));
  return { runs: results, profiles };
}

type SimulationWorker = { run: (task: SimulationTask) => Promise<SimulationRunResult>; close: () => void };

function startWorker(): SimulationWorker {
  const proc = Bun.spawn({ cmd: [Bun.argv[0], "run", "src/game/sim/worker.ts"], stdin: "pipe", stdout: "pipe", stderr: "inherit" });
  const lines = readLines(proc.stdout);
  return {
    async run(task) {
      proc.stdin.write(`${JSON.stringify(task)}\n`);
      proc.stdin.flush();
      for (;;) {
        const next = await lines.next();
        if (next.done) throw new Error(`Simulation worker exited during ${task.label}/${task.roleId}/${task.seed}`);
        if (!next.value.startsWith(RESULT_PREFIX)) continue;
        const message = JSON.parse(next.value.slice(RESULT_PREFIX.length)) as { ok: true; result: SimulationRunResult } | { ok: false; error: string };
        if (!message.ok) throw new Error(`Simulation failed for ${task.label}/${task.roleId}/${task.seed}: ${message.error}`);
        return message.result;
      }
    },
    close() {
      proc.stdin.end();
    },
  };
}

async function* readLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      yield buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  if (buffer) yield buffer;
}

async function loadAbilityIds(configPath: string): Promise<string[]> {
  await loadBunGameConfig(configPath);
  return Object.keys(getGameConfig().abilities?.definitions ?? {});
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
