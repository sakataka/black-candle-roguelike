import { runSimulation } from "./simulation";

declare const Bun: { argv: string[] };

const seed = Number(Bun.argv[2] ?? 20260504);
const turns = Number(Bun.argv[3] ?? 600);
const roleId = Bun.argv[4] ?? "role.oathbound";
const trace = Bun.argv.includes("trace");
const profile = Bun.argv.includes("--profile");
const configPath = optionValue("--config") ?? "public/config/game-balance.json";
const label = optionValue("--label") ?? "single";

const result = await runSimulation({
  seed,
  turns,
  roleId,
  configPath,
  label,
  trace,
  profile,
});

console.log(JSON.stringify(result));

function optionValue(name: string): string | undefined {
  const index = Bun.argv.indexOf(name);
  return index >= 0 ? Bun.argv[index + 1] : undefined;
}
