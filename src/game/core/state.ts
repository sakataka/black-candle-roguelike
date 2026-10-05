import type { AttackTelegraph, Entity, ExpeditionDynamics, GameState, RunModifiers, RunStoryState, Tile } from "../types";

/** 大量に並ぶ固定構造のタイルは、汎用のオブジェクト複製を避ける。 */
export function cloneTile(tile: Tile): Tile {
  const copy: Tile = { kind: tile.kind, explored: tile.explored, visible: tile.visible };
  if ("roomTheme" in tile) copy.roomTheme = tile.roomTheme;
  if ("coverAsset" in tile) copy.coverAsset = tile.coverAsset;
  return copy;
}

export function cloneTelegraph(telegraph: AttackTelegraph): AttackTelegraph {
  return { ...telegraph, origin: { ...telegraph.origin }, tiles: telegraph.tiles.map((point) => ({ ...point })) };
}

export function cloneEntity(entity: Entity): Entity {
  return {
    ...entity,
    pos: { ...entity.pos },
    stats: entity.stats ? { ...entity.stats } : undefined,
    inventory: entity.inventory?.map((entry) => ({ ...entry })),
    conditions: entity.conditions?.map((condition) => ({ ...condition })),
    telegraph: entity.telegraph ? cloneTelegraph(entity.telegraph) : undefined,
  };
}

/** 独立した写しを保ちつつ、毎手の structuredClone の走査・直列化を避ける。 */
export function cloneExpedition(expedition: ExpeditionDynamics, heat = expedition.heat): ExpeditionDynamics {
  return {
    ...expedition,
    lights: expedition.lights.map((light) => ({ ...light, pos: { ...light.pos } })),
    heat: heat.map((vent) => ({ ...vent, pos: { ...vent.pos } })),
    trail: expedition.trail.map((moment) => ({ ...moment, pos: { ...moment.pos } })),
    memories: expedition.memories.map((memory) => ({ ...memory, echoes: memory.echoes.map((moment) => ({ ...moment, pos: { ...moment.pos } })) })),
    ...(expedition.lastRite ? { lastRite: { ...expedition.lastRite } } : {}),
    stats: { ...expedition.stats },
  };
}

export function getPlayer(state: GameState): Entity {
  const player = state.entities.find((entity) => entity.id === state.playerId);
  if (!player) {
    throw new Error("Missing player entity");
  }
  return player;
}

export function cloneModifiers(modifiers: RunModifiers): RunModifiers {
  return {
    ...modifiers,
    scars: [...modifiers.scars],
    graves: modifiers.graves?.map((grave) => ({ ...grave })),
    lessons: modifiers.lessons ? [...modifiers.lessons] : undefined,
    ruleDeltas: modifiers.ruleDeltas ? { ...modifiers.ruleDeltas } : undefined,
    bossOverride: modifiers.bossOverride ? { ...modifiers.bossOverride } : undefined,
  };
}

export function cloneState(state: GameState): GameState {
  return {
    ...state,
    expedition: state.expedition ? cloneExpedition(state.expedition) : undefined,
    playerProgress: { ...state.playerProgress },
    runObjectives: { ...state.runObjectives },
    runIdentity: { ...state.runIdentity },
    lantern: { ...state.lantern },
    tactics: [...state.tactics],
    modifiers: cloneModifiers(state.modifiers),
    knownRoleTruths: [...state.knownRoleTruths],
    pendingDecision: state.pendingDecision ? {
      ...state.pendingDecision,
      options: state.pendingDecision.options.map((option) => ({ ...option })),
    } : null,
    story: cloneStory(state.story),
    tiles: state.tiles.map(cloneTile),
    entities: state.entities.map(cloneEntity),
    messages: state.messages.map((entry) => ({ ...entry })),
    strikes: [],
  };
}


export function cloneStory(story: RunStoryState): RunStoryState {
  return {
    ...story,
    discoveries: [...story.discoveries],
    decisions: story.decisions.map((entry) => ({ ...entry })),
    contextActs: [...story.contextActs],
    crisisKinds: [...story.crisisKinds],
    ...(story.recoveredGraves ? { recoveredGraves: [...story.recoveredGraves] } : {}),
    ...(story.killedBy ? { killedBy: { ...story.killedBy } } : {}),
  };
}
