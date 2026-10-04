import { getGameConfig } from "../content/config";
import { contentEntities } from "../content/entities";
import { hasCondition } from "./conditions";
import type { Entity, EquipmentConfig } from "../types";

export function equipmentSlot(contentId: string): EquipmentConfig["slot"] | null {
  return getGameConfig().equipment[contentId]?.slot ?? null;
}

export function weaponBonus(player: Entity): number {
  const equippedWeapon = player.inventory?.find((entry) => entry.equipped && equipmentSlot(entry.contentId) === "weapon")?.contentId;
  return equippedWeapon ? equipmentPower(equippedWeapon, "weapon") : 0;
}

export function defenseBonus(player: Entity): number {
  const armor = player.inventory?.find((entry) => entry.equipped && equipmentSlot(entry.contentId) === "armor")?.contentId;
  const armorBonus = armor ? equipmentPower(armor, "armor") : 0;
  const shieldBonus = player.inventory?.filter((entry) => entry.equipped && equipmentSlot(entry.contentId) === "shield").reduce((sum, entry) => sum + equipmentPower(entry.contentId, "shield"), 0) ?? 0;
  const guardedBonus = hasCondition(player, "guarded") ? getGameConfig().rules.guardedDefenseBonus : 0;
  return armorBonus + shieldBonus + guardedBonus;
}

export function shouldAutoEquip(player: Entity, contentId: string): boolean {
  const slot = equipmentSlot(contentId);
  if (!slot) {
    return false;
  }

  const current = player.inventory?.find((entry) => entry.equipped && equipmentSlot(entry.contentId) === slot)?.contentId;
  if (!current) {
    return true;
  }
  return equipmentPower(contentId, slot) > equipmentPower(current, slot);
}

function equipmentPower(contentId: string, slot: EquipmentConfig["slot"]): number {
  const equipment = getGameConfig().equipment[contentId];
  return equipment?.slot === slot ? equipment.power : 0;
}

export function equippedSlotScore(player: Entity, contentId: string): number {
  const slot = equipmentSlot(contentId);
  const current = player.inventory?.find((entry) => entry.equipped && equipmentSlot(entry.contentId) === slot)?.contentId;
  return current ? equipmentScore(current) : 0;
}

export function canReceiveInventory(player: Entity, contentId: string): boolean {
  const inventory = player.inventory ?? [];
  return inventory.some((entry) => entry.contentId === contentId) || inventory.length < getGameConfig().rules.inventorySlotLimit;
}

export function addInventoryItem(player: Entity, contentId: string, quantity = 1): boolean {
  player.inventory ??= [];
  const existing = player.inventory.find((entry) => entry.contentId === contentId);
  if (existing) {
    existing.quantity += quantity;
    return true;
  }
  if (!canReceiveInventory(player, contentId)) {
    return false;
  }
  player.inventory.push({ contentId, quantity });
  return true;
}

export function equipmentScore(contentId: string): number {
  const equipment = getGameConfig().equipment[contentId];
  const slot = equipmentSlot(contentId);
  const tacticalValue = ((equipment?.rangedDefense ?? 0) * 0.8) + (((equipment?.trapAvoidPercent ?? 0) - (equipment?.trapAvoidPenaltyPercent ?? 0)) / 12);
  const utility = (equipment?.regen ? 1.5 : 0) + (equipment?.revealRadius ? 0.5 : 0) + (equipment?.conditionResistance?.length ?? 0) + (equipment?.reflectDamage ?? 0) * 0.5 + (equipment?.rangedAttack ? 2 : 0);
  return slot ? equipmentPower(contentId, slot) + tacticalValue + utility : 0;
}

export function equippedEffects(player: Entity): EquipmentConfig[] {
  return (player.inventory ?? []).filter((entry) => entry.equipped).flatMap((entry) => {
    const equipment = getGameConfig().equipment[entry.contentId];
    return equipment ? [equipment] : [];
  });
}

/** 盾の価値も含め、両手武器との排他を満たす装備の組合せを選ぶ。 */
export function preferredEquipment(player: Entity): Set<string> {
  const inventory = player.inventory ?? [];
  const best = (slot: EquipmentConfig["slot"]) => inventory.filter((entry) => entry.quantity > 0 && equipmentSlot(entry.contentId) === slot).sort((a, b) => equipmentScore(b.contentId) - equipmentScore(a.contentId))[0];
  const shield = best("shield");
  const weapons = inventory.filter((entry) => equipmentSlot(entry.contentId) === "weapon" && entry.quantity > 0);
  const score = (id: string) => equipmentScore(id) + (getGameConfig().equipment[id].twoHanded ? 0 : shield ? equipmentScore(shield.contentId) : 0);
  const weapon = weapons.sort((a, b) => score(b.contentId) - score(a.contentId))[0];
  const selected = [weapon, best("armor"), best("ring")];
  if (!weapon || !getGameConfig().equipment[weapon.contentId].twoHanded) selected.push(shield);
  return new Set(selected.flatMap((entry) => entry ? [entry.contentId] : []));
}

export function equippedWeaponSpecialDamage(player: Entity, defenderContentId: string): number {
  const weapon = player.inventory?.find((entry) => entry.equipped && equipmentSlot(entry.contentId) === "weapon")?.contentId;
  const special = weapon ? getGameConfig().equipment[weapon]?.specialDamage : undefined;
  if (!special) {
    return 0;
  }
  const family = contentEntities[defenderContentId]?.family;
  return family && special.families.includes(family) ? special.amount : 0;
}
