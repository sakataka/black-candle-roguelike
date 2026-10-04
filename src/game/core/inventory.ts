import { getGameConfig } from "../content/config";
import { contentEntities } from "../content/entities";
import { hasCondition } from "./conditions";
import type { Entity, EquipmentConfig } from "../types";

export function equipmentSlot(contentId: string): "weapon" | "shield" | "armor" | null {
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
  return slot ? equipmentPower(contentId, slot) + tacticalValue : 0;
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
