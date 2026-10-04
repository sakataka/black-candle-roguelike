import { getGameConfig } from "../content/config";
import { contentEntities, getContentName } from "../content/entities";
import { biomeThemeForFloor } from "../content/floors";
import type { Entity, GameConfig, MonsterBehavior, RunObjectiveFlags, Stats } from "../types";

// 敵の能力値と振る舞いの参照。精鋭の銘や怒りは個体ごとに重ねる。

export function statsForMonster(contentId: string, dangerBoost: number, floor: number, runObjectives: Pick<RunObjectiveFlags, "lateEnemiesWeakened">, rules: GameConfig["rules"]): Stats {
  const config = getGameConfig();
  const base = config.monsterStats[contentId] ?? { hp: 5, attack: 1, defense: 0 };
  // 領域ごとの締め付け。墓所・炉心・中枢で敵の質を段階的に変える。
  const biome = config.biomes.find((entry) => entry.theme === biomeThemeForFloor(floor));
  let hp = Math.round((base.hp + dangerBoost * (base.hpPerDanger ?? 1) * rules.monsterHpScale) * (biome?.monsterHpPercent ?? 100) / 100);
  let attack = base.attack + Math.floor(dangerBoost * rules.monsterAttackPerFloor) + (biome?.monsterAttackBonus ?? 0);
  if (runObjectives.lateEnemiesWeakened && floor >= 7 && contentEntities[contentId]?.tier !== "boss") {
    hp = Math.max(1, Math.floor(hp * 0.85));
    attack = Math.max(1, attack - 1);
  }
  return { hp, maxHp: hp, attack, defense: base.defense };
}

/** 種の振る舞いに、精鋭の銘と怒りの状態を重ねた個体の振る舞い。 */
export function behaviorFor(entity: Pick<Entity, "contentId" | "elite" | "enraged">): MonsterBehavior {
  const base = getGameConfig().monsterBehaviors?.[entity.contentId] ?? {};
  const affix = entity.elite ? getGameConfig().elites?.affixes[entity.elite]?.behavior : undefined;
  const merged: MonsterBehavior = affix ? { ...base, ...affix } : base;
  return entity.enraged && base.enrage?.fast ? { ...merged, fast: true } : merged;
}

export function applyElite(entity: Entity, affixId: string): void {
  const affix = getGameConfig().elites.affixes[affixId];
  if (!affix || !entity.stats) return;
  entity.elite = affixId;
  entity.stats.maxHp = Math.round(entity.stats.maxHp * affix.hpScale);
  entity.stats.hp = entity.stats.maxHp;
  entity.stats.attack += affix.attackBonus;
  entity.stats.defense += affix.defenseBonus;
  entity.asleep = false;
}

/** 精鋭なら銘を冠した名前。 */
export function entityName(entity: Pick<Entity, "contentId" | "elite">): string {
  const prefix = entity.elite ? getGameConfig().elites?.affixes[entity.elite]?.prefix ?? "" : "";
  return `${prefix}${getContentName(entity.contentId)}`;
}
