import type { Entity, GameState, RunModifiers, RunStoryState } from "../types";

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
    expedition: state.expedition ? structuredClone(state.expedition) : undefined,
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
    tiles: state.tiles.map((tile) => ({ ...tile })),
    entities: state.entities.map((entity) => ({
      ...entity,
      pos: { ...entity.pos },
      stats: entity.stats ? { ...entity.stats } : undefined,
      inventory: entity.inventory?.map((entry) => ({ ...entry })),
      conditions: entity.conditions?.map((condition) => ({ ...condition })),
      telegraph: entity.telegraph ? structuredClone(entity.telegraph) : undefined,
    })),
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
  };
}
