import type { GameAction } from "../types";

export function createActionCounts(): Record<GameAction["type"], number> {
  return {
    move: 0,
    wait: 0,
    pickup: 0,
    equip: 0,
    dropItem: 0,
    useItem: 0,
    merchantService: 0,
    descend: 0,
    resolveDecision: 0,
    invokeLantern: 0,
    placeLantern: 0,
    borrowFlame: 0,
  };
}
