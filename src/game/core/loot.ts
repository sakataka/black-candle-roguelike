import { getGameConfig } from "../content/config";
import { roleDefinition, sealSlotsFor } from "./inventory";
import type { EquipmentSlot, InventoryEntry } from "../types";
import type { Rng } from "./rng";

type Tier = "early" | "mid" | "late";

/** 「equipment:mid」のような抽選札。出現表に具体的な装備を書かず、格だけを決める。 */
export function isEquipmentToken(contentId: string): boolean {
  return contentId.startsWith("equipment:");
}

export function resolveEquipmentToken(token: string, rng: Rng): string {
  const [, tier, slot] = token.split(":") as [string, Tier, EquipmentSlot | undefined];
  return drawEquipment(rng, { tier, slot });
}

/** 格と部位から装備を一つ選ぶ。favoredRoleId があれば、その職業の得意な型へ寄せる確率を持つ。 */
export function drawEquipment(rng: Rng, options: { tier: Tier; slot?: EquipmentSlot; favoredRoleId?: string; favoredChancePercent?: number }): string {
  const entries = Object.entries(getGameConfig().equipment)
    .filter(([, equipment]) => equipment.tier === options.tier && (!options.slot || equipment.slot === options.slot));
  const mastery = options.favoredRoleId ? roleDefinition(options.favoredRoleId)?.traits.weaponMastery : undefined;
  if (mastery && options.favoredChancePercent && rng.int(1, 100) <= options.favoredChancePercent) {
    const favored = entries.filter(([, equipment]) => equipment.weaponType && mastery.types.includes(equipment.weaponType));
    if (favored.length) return rng.pick(favored)[0];
  }
  return entries.length ? rng.pick(entries)[0] : "item.ember-tonic";
}

/** 床に置く装備の個体差。修正値は階が深いほど高く、印は確率で0〜2個付く。 */
export function rollEquipmentPiece(contentId: string, floor: number, rng: Rng, options: { minSeals?: number } = {}): Pick<InventoryEntry, "plus" | "seals"> {
  const config = getGameConfig();
  const equipment = config.equipment[contentId];
  if (!equipment) return {};
  const table = config.equipmentRolls.plus.find((entry) => floor <= entry.maxFloor) ?? config.equipmentRolls.plus.at(-1);
  const plus = table ? weightedPick(rng, Object.entries(table.weights).map(([value, weight]) => [Number(value), weight])) : 0;
  const slots = sealSlotsFor(contentId) - (equipment.innateSeals?.length ?? 0);
  const seals: string[] = [];
  const candidates = Object.entries(config.seals)
    .filter(([id, seal]) => seal.slots.includes(equipment.slot as "weapon" | "armor" | "shield") && floor >= (seal.minFloor ?? 1) && !equipment.innateSeals?.includes(id));
  const chance = config.equipmentRolls.sealChancePercent + floor * config.equipmentRolls.sealChancePerFloor;
  const wanted = (options.minSeals ?? 0) > 0 || rng.int(1, 100) <= chance
    ? 1 + (rng.int(1, 100) <= config.equipmentRolls.secondSealChancePercent ? 1 : 0)
    : 0;
  for (let index = 0; index < Math.min(slots, Math.max(wanted, options.minSeals ?? 0)); index += 1) {
    const pool = candidates.filter(([id]) => !seals.includes(id));
    if (!pool.length) break;
    seals.push(weightedPick(rng, pool.map(([id, seal]) => [id, seal.weight])));
  }
  return { plus, seals };
}

function weightedPick<T>(rng: Rng, entries: Array<[T, number]>): T {
  const total = entries.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0);
  let roll = rng.next() * total;
  for (const [value, weight] of entries) {
    roll -= Math.max(0, weight);
    if (roll < 0) return value;
  }
  return entries[entries.length - 1][0];
}
