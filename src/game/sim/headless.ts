import { runSimulation } from "./simulation";

declare const Bun: { argv: string[] };

const seed = Number(Bun.argv[2] ?? 20260504);
const turns = Number(Bun.argv[3] ?? 600);
const roleId = Bun.argv[4] ?? "role.oathbound";
const trace = Bun.argv.includes("trace");
const profile = Bun.argv.includes("--profile");
const configPath = optionValue("--config") ?? "public/config/game-balance.json";
const label = optionValue("--label") ?? "single";
const logLimit = parseLogLimit(optionValue("--log-limit"));

const result = await runSimulation({
  seed,
  turns,
  roleId,
  configPath,
  label,
  trace,
  profile,
  logLimit,
});

console.log(JSON.stringify(result));

function optionValue(name: string): string | undefined {
  const index = Bun.argv.indexOf(name);
  return index >= 0 ? Bun.argv[index + 1] : undefined;
}

function parseLogLimit(value: string | undefined): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "none" || value === "full") {
    return null;
  }
  const limit = Math.floor(Number(value));
  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error("--log-limit must be a positive integer, none, or full");
  }
  return limit;
}
