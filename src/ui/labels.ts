import { getGameConfig } from "../game/content/config";
import type { EquipmentConfig, StatusCondition } from "../game/types";

export function equipmentSlotLabel(slot: EquipmentConfig["slot"]): string {
  if (slot === "weapon") return "武器";
  if (slot === "armor") return "防具";
  return "盾";
}

export function equipmentDetail(equipment: EquipmentConfig): string {
  const details = [`${equipment.slot === "weapon" ? "威力" : "防御"} +${equipment.power}`];
  if (equipment.rangedDefense) details.push(`遠隔防御 +${equipment.rangedDefense}`);
  const trapAvoid = (equipment.trapAvoidPercent ?? 0) - (equipment.trapAvoidPenaltyPercent ?? 0);
  if (trapAvoid !== 0) details.push(`罠回避 ${trapAvoid > 0 ? "+" : ""}${trapAvoid}%`);
  if (equipment.specialDamage) details.push(`特効 +${equipment.specialDamage.amount}`);
  return details.join(" / ");
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
