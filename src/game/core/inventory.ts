import { getGameConfig } from "../content/config";
import { contentEntities, getContentName } from "../content/entities";
import { hasCondition } from "./conditions";
import type { Entity, EquipmentConfig, EquipmentSlot, InventoryEntry, SealConfig, WeaponType, WeaponTypeConfig } from "../types";

type EquipmentPiece = Pick<InventoryEntry, "contentId" | "plus" | "seals">;

export function equipmentSlot(contentId: string): EquipmentConfig["slot"] | null {
  return getGameConfig().equipment[contentId]?.slot ?? null;
}

export function roleDefinition(roleId: string) {
  return getGameConfig().roles.find((role) => role.id === roleId);
}

export function weaponTypeOf(contentId: string | undefined): WeaponType | null {
  return contentId ? getGameConfig().equipment[contentId]?.weaponType ?? null : null;
}

export function equippedEntry(player: Pick<Entity, "inventory">, slot: EquipmentSlot): InventoryEntry | undefined {
  return player.inventory?.find((entry) => entry.equipped && equipmentSlot(entry.contentId) === slot);
}

/** 装備中の武器の型の設定。素手は剣と同じ扱いにせず、型の効果を持たない。 */
export function equippedWeaponType(player: Pick<Entity, "inventory">): { type: WeaponType; config: WeaponTypeConfig } | null {
  const type = weaponTypeOf(equippedEntry(player, "weapon")?.contentId);
  return type ? { type, config: getGameConfig().weaponTypes[type] } : null;
}

/** 固有の印と個体の印を合わせ、重複を除いた印の一覧。 */
export function pieceSeals(piece: EquipmentPiece): SealConfig[] {
  const config = getGameConfig();
  const innate = config.equipment[piece.contentId]?.innateSeals ?? [];
  const carried = piece.seals ?? [];
  if (!innate.length && !carried.length) return [];
  const ids = [...innate, ...carried];
  const seals: SealConfig[] = [];
  // 印は数個だけ。毎手の装備評価で Set と flatMap 用の配列を作らない。
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index];
    if (ids.indexOf(id) === index && config.seals[id]) seals.push(config.seals[id]);
  }
  return seals;
}

export function equippedSeals(player: Pick<Entity, "inventory">): SealConfig[] {
  return (player.inventory ?? []).filter((entry) => entry.equipped).flatMap((entry) => pieceSeals(entry));
}

/** 修正値と印を含めた装備の強さ。武器なら威力、防具・盾なら防御。 */
export function piecePower(piece: EquipmentPiece): number {
  const equipment = getGameConfig().equipment[piece.contentId];
  if (!equipment) return 0;
  return equipment.power + (piece.plus ?? 0) + pieceSeals(piece).reduce((sum, seal) => sum + (seal.powerDelta ?? 0), 0);
}

export function masteryBonus(player: Pick<Entity, "inventory" | "contentId">): number {
  const mastery = roleDefinition(player.contentId)?.traits.weaponMastery;
  const type = weaponTypeOf(equippedEntry(player, "weapon")?.contentId);
  return mastery && type && mastery.types.includes(type) ? mastery.attack : 0;
}

export function weaponBonus(player: Pick<Entity, "inventory" | "contentId">): number {
  const weapon = equippedEntry(player, "weapon");
  return (weapon ? piecePower(weapon) : 0) + masteryBonus(player);
}

export function defenseBonus(player: Entity): number {
  const armor = equippedEntry(player, "armor");
  const shields = player.inventory?.filter((entry) => entry.equipped && equipmentSlot(entry.contentId) === "shield") ?? [];
  const guardedBonus = hasCondition(player, "guarded") ? getGameConfig().rules.guardedDefenseBonus : 0;
  return (armor ? piecePower(armor) : 0) + shields.reduce((sum, entry) => sum + piecePower(entry), 0) + guardedBonus;
}

export function canReceiveInventory(player: Entity, contentId: string): boolean {
  const inventory = player.inventory ?? [];
  return inventory.some((entry) => entry.contentId === contentId) || inventory.length < getGameConfig().rules.inventorySlotLimit;
}

/**
 * 所持品へ加える。装備は同じ品を重ねると鍛え直し、修正値と印を一つの個体へまとめる。
 * 戻り値は加えられたかどうか。
 */
export function addInventoryItem(player: Entity, contentId: string, quantity = 1, piece: Pick<InventoryEntry, "plus" | "seals"> = {}): boolean {
  player.inventory ??= [];
  const existing = player.inventory.find((entry) => entry.contentId === contentId);
  if (existing && equipmentSlot(contentId)) {
    forgeInto(existing, piece);
    return true;
  }
  if (existing) {
    existing.quantity += quantity;
    return true;
  }
  if (!canReceiveInventory(player, contentId)) {
    return false;
  }
  player.inventory.push(equipmentSlot(contentId) ? { contentId, quantity: 1, plus: piece.plus ?? 0, seals: [...(piece.seals ?? [])] } : { contentId, quantity });
  return true;
}

/** 同じ装備を重ねた鍛え直し。修正値は高い方に+1、印は空き枠の分だけ引き継ぐ。 */
export function forgeInto(target: InventoryEntry, incoming: Pick<InventoryEntry, "plus" | "seals">): void {
  const config = getGameConfig();
  target.plus = Math.min(config.equipmentRolls.forgeMaxPlus, Math.max(target.plus ?? 0, incoming.plus ?? 0) + 1);
  const innate = config.equipment[target.contentId]?.innateSeals ?? [];
  const slots = sealSlotsFor(target.contentId);
  const merged = [...new Set([...(target.seals ?? []), ...(incoming.seals ?? [])])].filter((id) => !innate.includes(id));
  target.seals = merged.slice(0, slots);
}

export function sealSlotsFor(contentId: string): number {
  const equipment = getGameConfig().equipment[contentId];
  if (!equipment) return 0;
  return equipment.sealSlots ?? (equipment.slot === "weapon" || equipment.slot === "armor" ? 2 : equipment.slot === "shield" ? 1 : 0);
}

function sealValue(seal: SealConfig): number {
  return (seal.drainPercent ? 1.5 : 0)
    + (seal.critPercent ? 1.5 : 0)
    + (seal.bonusVsFamilies ? 1 : 0)
    + (seal.inflict ? 1 : 0)
    + (seal.dazeChancePercent ? 0.8 : 0)
    + (seal.thorns ? 1 : 0)
    + (seal.regen ? 1.5 : 0)
    + (seal.resist?.length ?? 0)
    + (seal.rangedDefense ?? 0) * 0.8
    + (seal.rustproof ? 0.5 : 0)
    + (seal.trapAvoidPercent ?? 0) / 12;
}

/**
 * 装備の評価。核とAIで共有する。修正値・印・型の性質を数え、職業の得意な型には実際の攻撃補正の分だけ寄せる。
 * 数字の大きさだけで決めないので、同じ職業でも拾った品で選ぶ武器が変わる。
 */
export function equipmentScore(piece: EquipmentPiece, roleId?: string): number {
  const equipment = getGameConfig().equipment[piece.contentId];
  if (!equipment) return 0;
  const tacticalValue = ((equipment.rangedDefense ?? 0) * 0.8) + (((equipment.trapAvoidPercent ?? 0) - (equipment.trapAvoidPenaltyPercent ?? 0)) / 12);
  const utility = (equipment.regen ? 1.5 : 0) + (equipment.revealRadius ? 0.5 : 0) + (equipment.conditionResistance?.length ?? 0) + (equipment.reflectDamage ?? 0) * 0.5;
  const seals = pieceSeals(piece).reduce((sum, seal) => sum + sealValue(seal), 0);
  let typeValue = 0;
  if (equipment.slot === "weapon") {
    const mastery = roleId ? roleDefinition(roleId)?.traits.weaponMastery : undefined;
    if (equipment.weaponType && mastery?.types.includes(equipment.weaponType)) typeValue += mastery.attack;
    if (equipment.specialDamage) typeValue += 1;
    if (equipment.rangedAttack) typeValue += Math.max(0, equipment.rangedAttack.damage * 0.5 + equipment.rangedAttack.range * 0.2 - 1);
    if (equipment.weaponType === "dagger" || equipment.weaponType === "spear" || equipment.weaponType === "mace") typeValue += 1;
    if (equipment.weaponType === "axe") typeValue += 0.5;
  }
  return piecePower(piece) + tacticalValue + utility + seals + typeValue;
}

export function equippedEffects(player: Pick<Entity, "inventory">): EquipmentConfig[] {
  return (player.inventory ?? []).filter((entry) => entry.equipped).flatMap((entry) => {
    const equipment = getGameConfig().equipment[entry.contentId];
    return equipment ? [equipment] : [];
  });
}

/** 新品（修正値0・印なし）を買った時の評価の伸び。同じ品を持っていれば鍛え直しの+1になる。 */
export function upgradeGain(player: Pick<Entity, "inventory" | "contentId">, contentId: string): number {
  const slot = equipmentSlot(contentId);
  if (!slot) return 0;
  if (player.inventory?.some((entry) => entry.contentId === contentId)) return 1;
  const current = equippedEntry(player, slot);
  return equipmentScore({ contentId }, player.contentId) - (current ? equipmentScore(current, player.contentId) : 0);
}

/** 盾の価値も含め、両手武器との排他を満たす装備の組合せを選ぶ。 */
export function preferredEquipment(player: Pick<Entity, "inventory" | "contentId">, mode: "auto" | "melee" = "auto"): Set<string> {
  const inventory = player.inventory ?? [];
  const score = (entry: InventoryEntry) => equipmentScore(entry, player.contentId);
  const best = (slot: EquipmentConfig["slot"]) => inventory.filter((entry) => entry.quantity > 0 && equipmentSlot(entry.contentId) === slot).sort((a, b) => score(b) - score(a))[0];
  const shield = best("shield");
  const allWeapons = inventory.filter((entry) => equipmentSlot(entry.contentId) === "weapon" && entry.quantity > 0);
  // 接近戦では弓を外し、近接武器があればそちらを選ぶ。
  const meleeWeapons = allWeapons.filter((entry) => !getGameConfig().equipment[entry.contentId].rangedAttack);
  const weapons = mode === "melee" && meleeWeapons.length ? meleeWeapons : allWeapons;
  const withShield = (entry: InventoryEntry) => score(entry) + (getGameConfig().equipment[entry.contentId].twoHanded ? 0 : shield ? score(shield) : 0);
  const weapon = weapons.sort((a, b) => withShield(b) - withShield(a))[0];
  const selected = [weapon, best("armor"), best("ring")];
  if (!weapon || !getGameConfig().equipment[weapon.contentId].twoHanded) selected.push(shield);
  return new Set(selected.flatMap((entry) => entry ? [entry.contentId] : []));
}

/** 種族への特効。武器の固有値と印を合算する。 */
export function equippedWeaponSpecialDamage(player: Pick<Entity, "inventory">, defenderContentId: string): number {
  const weapon = equippedEntry(player, "weapon");
  if (!weapon) return 0;
  const family = contentEntities[defenderContentId]?.family;
  if (!family) return 0;
  const special = getGameConfig().equipment[weapon.contentId]?.specialDamage;
  const base = special?.families.includes(family) ? special.amount : 0;
  return base + pieceSeals(weapon).reduce((sum, seal) => sum + (seal.bonusVsFamilies?.families.includes(family) ? seal.bonusVsFamilies.amount : 0), 0);
}

/** 「バトルアックス+2［吸会］」のような表示名。 */
export function pieceName(piece: EquipmentPiece): string {
  const name = getContentName(piece.contentId);
  if (!equipmentSlot(piece.contentId)) return name;
  const plus = piece.plus ?? 0;
  const glyphs = pieceSeals(piece).map((seal) => seal.glyph).join("");
  return `${name}${plus > 0 ? `+${plus}` : plus < 0 ? `${plus}` : ""}${glyphs ? `［${glyphs}］` : ""}`;
}
