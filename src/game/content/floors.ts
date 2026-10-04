import { floorRuleMatches, getGameConfig } from "./config";
import type { BiomeTheme } from "../types";

export function biomeThemeForFloor(floor: number): BiomeTheme {
  return [...getGameConfig().biomes].sort((a, b) => b.minFloor - a.minFloor).find((entry) => floor >= entry.minFloor)?.theme ?? "blackstone";
}

export function biomeThemeName(theme: BiomeTheme): string {
  return getGameConfig().biomes.find((entry) => entry.theme === theme)?.nameJa ?? theme;
}

export function monsterPoolForFloor(floor: number): string[] {
  const biome = biomeThemeForFloor(floor);
  const pool = getGameConfig().monsterSpawnRules
    .filter((rule) => floorRuleMatches(rule, floor, biome))
    .map((rule) => rule.contentId);
  return pool.length > 0 ? pool : ["monster.ash-rat"];
}

export function itemPoolForFloor(floor: number): string[] {
  const biome = biomeThemeForFloor(floor);
  const pool = getGameConfig().itemPools.flatMap((rule) => floorRuleMatches(rule, floor, biome) ? rule.items : []);
  return pool.length > 0 ? pool : ["item.ember-tonic"];
}

export function guaranteedItemsForFloor(floor: number): string[] {
  const biome = biomeThemeForFloor(floor);
  return getGameConfig().guaranteedItems.find((rule) => floorRuleMatches(rule, floor, biome))?.items ?? [];
}

export function eventPoolForFloor(floor: number): string[] {
  const biome = biomeThemeForFloor(floor);
  const pool = getGameConfig().eventPools.flatMap((rule) => floorRuleMatches(rule, floor, biome) ? rule.events : []);
  return pool.length > 0 ? pool : ["event.blood-inscription"];
}

export function trapPoolForFloor(floor: number): string[] {
  const biome = biomeThemeForFloor(floor);
  return getGameConfig().trapPools.find((rule) => floorRuleMatches(rule, floor, biome))?.traps ?? ["trap.blood-needle"];
}

export function bossForFloor(floor: number): string | null {
  return getGameConfig().bosses.find((boss) => boss.floor === floor)?.contentId ?? null;
}
