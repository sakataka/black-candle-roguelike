import type { ConditionKind, Entity } from "../types";

export function upsertCondition(conditions: Entity["conditions"] = [], kind: ConditionKind, turns: number): Entity["conditions"] {
  const next = conditions.filter((condition) => condition.kind !== kind);
  next.push({ kind, turns });
  return next;
}

export function clearCondition(conditions: Entity["conditions"] = [], kind: ConditionKind): Entity["conditions"] {
  return conditions.filter((condition) => condition.kind !== kind);
}

export function clearConditions(conditions: Entity["conditions"] = [], kinds: ConditionKind[]): Entity["conditions"] {
  return kinds.reduce<NonNullable<Entity["conditions"]>>((next, kind) => clearCondition(next, kind) ?? [], conditions);
}

export function hasCondition(entity: Entity, kind: ConditionKind): boolean {
  return entity.conditions?.some((condition) => condition.kind === kind && condition.turns > 0) ?? false;
}
