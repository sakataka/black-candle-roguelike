import type { DecisionPolicy } from "../core/autonomous";
import type { WatcherPolicy } from "../ai/watcher";

export type ConfigSpec = {
  label: string;
  path: string;
};

export type BatchPreset = "custom" | "smoke" | "standard" | "compare" | "deep";

export type CliOptions = {
  preset: BatchPreset;
  seeds: number[];
  turns: number;
  roles: "all" | string[];
  configs: ConfigSpec[];
  out: string;
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

export function parseCli(args: string[]): CliOptions {
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

  const preset = parsePreset(last(values, "--preset") ?? "custom");
  const defaults = presetDefaults(preset);
  const label = last(values, "--label") ?? defaults.label;
  const configs = parseConfigs(values.get("--config") ?? defaults.configs, label);
  return {
    preset,
    seeds: parseSeeds(last(values, "--seeds") ?? defaults.seeds),
    turns: parseTurns(last(values, "--turns") ?? defaults.turns),
    roles: parseRoles(last(values, "--roles") ?? defaults.roles),
    configs,
    out: last(values, "--out") ?? defaultOutputPath(configs, preset),
    jobs: parseJobs(last(values, "--jobs") ?? defaults.jobs),
    trace: trace || defaults.trace,
    profile: profile || defaults.profile,
    logLimit: parseLogLimit(last(values, "--log-limit") ?? defaults.logLimit),
    decisionPolicy: parseDecisionPolicy(last(values, "--decision-policy") ?? "temperament"),
    watcherPolicy: parseWatcherPolicy(last(values, "--watcher") ?? "none"),
    tactics: (last(values, "--tactics") ?? "").split(",").filter(Boolean),
    bossTrial: parseStage(last(values, "--boss-trial") ?? "0", 3),
    foundationRank: parseStage(last(values, "--foundation-rank") ?? "0", 99),
    heat: Number(last(values, "--heat") ?? 0),
    aftermath: last(values, "--aftermath"),
  };
}

function parseStage(value: string, max: number): number {
  const stage = Number(value);
  if (!Number.isInteger(stage) || stage < 0 || stage > max) throw new Error(`Stage must be an integer from 0 to ${max}`);
  return stage;
}

function parsePreset(value: string): BatchPreset {
  if (value === "custom" || value === "smoke" || value === "standard" || value === "compare" || value === "deep") {
    return value;
  }
  throw new Error("--preset must be custom, smoke, standard, compare, or deep");
}

function parseWatcherPolicy(value: string): WatcherPolicy {
  if (value === "none" || value === "lantern") return value;
  throw new Error("--watcher must be none or lantern");
}

function parseDecisionPolicy(value: string): DecisionPolicy {
  if (value === "temperament" || value === "always-continue" || value === "return-3" || value === "return-6") return value;
  throw new Error("--decision-policy must be temperament, always-continue, return-3, or return-6");
}

function presetDefaults(preset: BatchPreset): {
  label: string;
  seeds: string;
  turns: string;
  roles: string;
  configs: string[];
  jobs: string;
  trace: boolean;
  profile: boolean;
  logLimit: string;
} {
  switch (preset) {
    case "smoke":
      return {
        label: "smoke",
        seeds: "20260504:20260508",
        turns: "300",
        roles: "all",
        configs: ["public/config/game-balance.json"],
        jobs: "4",
        trace: false,
        profile: false,
        logLimit: "40",
      };
    case "standard":
      return {
        label: "standard",
        seeds: "20260504:20260533",
        turns: "1600",
        roles: "all",
        configs: ["public/config/game-balance.json"],
        jobs: "8",
        trace: false,
        profile: false,
        logLimit: "40",
      };
    case "compare":
      return {
        label: "baseline",
        seeds: "20260504:20260533",
        turns: "1600",
        roles: "all",
        configs: ["baseline=public/config/game-balance.json"],
        jobs: "8",
        trace: false,
        profile: false,
        logLimit: "40",
      };
    case "deep":
      return {
        label: "deep",
        seeds: "20260504",
        turns: "3200",
        roles: "all",
        configs: ["public/config/game-balance.json"],
        jobs: "1",
        trace: true,
        profile: true,
        logLimit: "none",
      };
    default:
      return {
        label: "baseline",
        seeds: "20260504:20260533",
        turns: "800",
        roles: "all",
        configs: ["public/config/game-balance.json"],
        jobs: "8",
        trace: false,
        profile: false,
        logLimit: "40",
      };
  }
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

function parseTurns(value: string): number {
  const turns = Math.floor(Number(value));
  if (!Number.isFinite(turns) || turns < 1) {
    throw new Error("--turns must be a positive integer");
  }
  return turns;
}

function parseJobs(value: string): number {
  const jobs = Math.floor(Number(value));
  if (!Number.isFinite(jobs) || jobs < 1) {
    throw new Error("--jobs must be a positive integer");
  }
  return jobs;
}

function parseLogLimit(value: string): number | null {
  if (value === "none" || value === "full") {
    return null;
  }
  const limit = Math.floor(Number(value));
  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error("--log-limit must be a positive integer, none, or full");
  }
  return limit;
}

function defaultOutputPath(configs: ConfigSpec[], preset: BatchPreset): string {
  const label = configs.map((config) => config.label).join("-vs-") || "batch";
  const prefix = preset === "custom" ? label : `${preset}-${label}`;
  return `tmp/sim-reports/${prefix}-${timestampForPath(new Date())}.json`;
}

function timestampForPath(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

function labelFromPath(path: string, index: number): string {
  const file = path.split("/").pop() ?? `config-${index + 1}`;
  return file.replace(/\.json$/i, "") || `config-${index + 1}`;
}

function last(values: Map<string, string[]>, key: string): string | undefined {
  const entries = values.get(key);
  return entries?.[entries.length - 1];
}
