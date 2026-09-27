import type { BiomeTheme, FloorRule, GameConfig, RunModifiers } from "../types";

let activeGameConfig: GameConfig | null = null;

export function setGameConfig(config: GameConfig): void {
  activeGameConfig = config;
}

export function getGameConfig(): GameConfig {
  if (!activeGameConfig) {
    throw new Error("Game config is not loaded. Call loadBrowserGameConfig() or loadBunGameConfig() before creating a game.");
  }
  return activeGameConfig;
}

export async function loadBrowserGameConfig(path = `${import.meta.env.BASE_URL}config/game-balance.json`): Promise<GameConfig> {
  const response = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load game config: ${response.status} ${response.statusText}`);
  }
  const config = await response.json() as GameConfig;
  setGameConfig(config);
  return config;
}

export async function loadBunGameConfig(path = "public/config/game-balance.json"): Promise<GameConfig> {
  const bun = (globalThis as typeof globalThis & {
    Bun?: { file: (path: string) => { json: () => Promise<unknown> } };
  }).Bun;
  if (!bun) {
    throw new Error("Bun runtime is required to load local game config files.");
  }
  const config = await bun.file(path).json() as GameConfig;
  setGameConfig(config);
  return config;
}

/** 燭階・周期の余波による加算を反映した、その遠征でのルール値。 */
export function runRules(modifiers?: Pick<RunModifiers, "ruleDeltas">): GameConfig["rules"] {
  const rules = getGameConfig().rules;
  const deltas = modifiers?.ruleDeltas;
  if (!deltas) return rules;
  const next = { ...rules };
  for (const [key, delta] of Object.entries(deltas)) {
    const ruleKey = key as keyof GameConfig["rules"];
    if (typeof next[ruleKey] === "number" && typeof delta === "number") {
      (next as Record<string, unknown>)[ruleKey] = (next[ruleKey] as number) + delta;
    }
  }
  next.fovRadius = Math.max(3, next.fovRadius);
  next.runTurnWarning = Math.min(next.runTurnWarning, next.runTurnLimit - 50);
  return next;
}

export function floorRuleMatches(rule: FloorRule, floor: number, biome: BiomeTheme): boolean {
  if (rule.floor !== undefined && rule.floor !== floor) {
    return false;
  }
  if (rule.minFloor !== undefined && floor < rule.minFloor) {
    return false;
  }
  if (rule.maxFloor !== undefined && floor > rule.maxFloor) {
    return false;
  }
  if (rule.biomes !== undefined && !rule.biomes.includes(biome)) {
    return false;
  }
  return true;
}
