import { getGameConfig } from "../game/content/config";
import { pieceSeals } from "../game/core/inventory";
import type { EquipmentConfig, InventoryEntry, StatusCondition } from "../game/types";

export function equipmentSlotLabel(slot: EquipmentConfig["slot"]): string {
  if (slot === "weapon") return "武器";
  if (slot === "armor") return "防具";
  if (slot === "ring") return "指輪";
  return "盾";
}

/** 装備の説明。個体の修正値と印があれば合わせて示す。 */
export function equipmentDetail(contentId: string, piece: Pick<InventoryEntry, "plus" | "seals"> = {}): string {
  const equipment = getGameConfig().equipment[contentId];
  if (!equipment) return "";
  const plus = piece.plus ?? 0;
  const type = equipment.weaponType ? getGameConfig().weaponTypes[equipment.weaponType] : undefined;
  const details = [`${type ? `${type.label}・` : ""}${equipment.slot === "weapon" ? "威力" : "防御"} +${equipment.power + plus}`];
  if (type) details.push(type.description);
  for (const seal of pieceSeals({ contentId, ...piece })) details.push(`［${seal.glyph}］${seal.description}`);
  details.push(...baseEquipmentDetail(equipment));
  return details.join(" / ");
}

function baseEquipmentDetail(equipment: EquipmentConfig): string[] {
  const details: string[] = [];
  if (equipment.rangedDefense) details.push(`遠隔防御 +${equipment.rangedDefense}`);
  const trapAvoid = (equipment.trapAvoidPercent ?? 0) - (equipment.trapAvoidPenaltyPercent ?? 0);
  if (trapAvoid !== 0) details.push(`罠回避 ${trapAvoid > 0 ? "+" : ""}${trapAvoid}%`);
  if (equipment.specialDamage) details.push(`特効 +${equipment.specialDamage.amount}`);
  if (equipment.twoHanded) details.push("両手・盾併用不可");
  if (equipment.rangedAttack) details.push(`射撃 ${equipment.rangedAttack.damage} / 射程${equipment.rangedAttack.range}`);
  if (equipment.conditionResistance?.includes("venomed")) details.push("毒を防ぐ");
  if (equipment.regen) details.push(`${equipment.regen.everyTurns}手ごとHP+${equipment.regen.amount}`);
  if (equipment.revealRadius) details.push(`周囲${equipment.revealRadius}マスを調査`);
  if (equipment.reflectDamage) details.push(`遠隔反撃 ${equipment.reflectDamage}`);
  return details;
}

export function weaponTypeLabels(types: string[] = []): string {
  const config = getGameConfig().weaponTypes as Record<string, { label: string }>;
  return types.map((type) => config[type]?.label ?? type).join("・");
}

export function conditionLabel(condition: StatusCondition): string {
  if (condition.kind === "guarded") return "護り";
  if (condition.kind === "dazed") return "怯み";
  if (condition.kind === "bleeding") return "出血";
  return "毒";
}

export function conditionTone(condition: StatusCondition): "safe" | "danger" {
  return condition.kind === "guarded" ? "safe" : "danger";
}


export function tacticLabels(tactics: string[]): string[] {
  const definitions = getGameConfig().tactics.definitions;
  return tactics.map((id) => definitions[id]?.label ?? id);
}
