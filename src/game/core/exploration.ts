import type { GameObservation, GameState, Point, Tile } from "../types";
import { DIRECTION_DELTAS, cardinalDeltas, inBounds, isWalkable, manhattan, pointKey, samePoint } from "./spatial";
import { getPlayer } from "./state";

export function buildExplorationStatus(
  state: GameState,
  knownTiles: Array<Tile & Point>,
  knownEntities: GameObservation["knownEntities"],
  visibleEntities: GameObservation["knownEntities"],
  aliveBoss: boolean,
): GameObservation["exploration"] {
  const knownTileMap = new Map(knownTiles.map((tile) => [pointKey(tile), tile]));
  const knownStairsTile = knownTiles.find((tile) => tile.kind === "stairsDown") ?? null;
  const knownStairs = knownStairsTile ? { x: knownStairsTile.x, y: knownStairsTile.y } : null;
  const { frontiers: reachableFrontiers, reachableKeys } = exploreKnownTiles(state, knownTileMap, knownEntities, visibleEntities);
  const reachableStairs = knownStairs && reachableKeys.has(pointKey(knownStairs)) ? knownStairs : null;
  const blockedStairs = knownStairs && !reachableStairs ? knownStairs : null;
  const nearestFrontier = reachableFrontiers[0] ?? null;
  const knownWalkableTiles = knownTiles.filter((tile) => isWalkable(tile.kind)).length;
  const stalledHint = reachableFrontiers.length === 0 && !reachableStairs && state.status === "playing";
  return {
    objective: explorationObjective(aliveBoss, reachableStairs, blockedStairs, nearestFrontier, stalledHint),
    knownStairs,
    reachableStairs,
    blockedStairs,
    nearestFrontier,
    reachableFrontiers,
    reachableFrontierCount: reachableFrontiers.length,
    knownWalkableTiles,
    exploredTileRatio: knownTiles.length / Math.max(1, state.width * state.height),
    stalledHint,
  };
}

function exploreKnownTiles(
  state: GameState,
  knownTileMap: Map<string, Tile & Point>,
  knownEntities: GameObservation["knownEntities"],
  visibleEntities: GameObservation["knownEntities"],
): { frontiers: GameObservation["exploration"]["reachableFrontiers"]; reachableKeys: Set<string> } {
  const player = getPlayer(state);
  const start = player.pos;
  const queue: Array<Point & { distance: number }> = [{ ...start, distance: 0 }];
  const visited = new Set<string>([pointKey(start)]);
  const frontiers: GameObservation["exploration"]["reachableFrontiers"] = [];

  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor];
    cursor += 1;

    const unseenNeighbors = countUnseenNeighbors(state, knownTileMap, current);
    if (current.distance > 0 && unseenNeighbors > 0) {
      frontiers.push({ x: current.x, y: current.y, distance: current.distance, unseenNeighbors });
    }

    for (const delta of Object.values(DIRECTION_DELTAS)) {
      const next = { x: current.x + delta.x, y: current.y + delta.y };
      const key = pointKey(next);
      if (visited.has(key) || !isKnownExplorationStep(knownTileMap, knownEntities, visibleEntities, next)) {
        continue;
      }
      visited.add(key);
      queue.push({ ...next, distance: current.distance + 1 });
    }
  }

  frontiers.sort((a, b) => a.distance - b.distance || b.unseenNeighbors - a.unseenNeighbors || manhattan(a, start) - manhattan(b, start));
  return { frontiers, reachableKeys: visited };
}

function isKnownExplorationStep(
  knownTileMap: Map<string, Tile & Point>,
  knownEntities: GameObservation["knownEntities"],
  visibleEntities: GameObservation["knownEntities"],
  point: Point,
): boolean {
  const tile = knownTileMap.get(pointKey(point));
  if (!tile || !isWalkable(tile.kind)) {
    return false;
  }
  if (knownEntities.some((entity) => entity.kind === "trap" && samePoint(entity.pos, point))) {
    return false;
  }
  return !visibleEntities.some((entity) => entity.blocksMovement && entity.kind !== "player" && !(entity.kind === "monster" && entity.hostile) && samePoint(entity.pos, point));
}

function countUnseenNeighbors(state: GameState, knownTileMap: Map<string, Tile & Point>, point: Point): number {
  return cardinalDeltas().filter((delta) => {
    const neighbor = { x: point.x + delta.x, y: point.y + delta.y };
    return inBounds(state, neighbor) && !knownTileMap.has(pointKey(neighbor));
  }).length;
}

function explorationObjective(
  aliveBoss: boolean,
  reachableStairs: Point | null,
  blockedStairs: Point | null,
  nearestFrontier: Point | null,
  stalledHint: boolean,
): GameObservation["exploration"]["objective"] {
  if (aliveBoss) {
    return "defeatBoss";
  }
  if (reachableStairs) {
    return "descend";
  }
  if (blockedStairs) {
    return "findStairs";
  }
  if (nearestFrontier) {
    return "explore";
  }
  return stalledHint ? "resolveStall" : "findStairs";
}
