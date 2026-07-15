import type { BiomeTheme, FloorRule, GameConfig } from "../types";

let activeGameConfig: GameConfig | null = null;

function setGameConfig(config: GameConfig): void {
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
