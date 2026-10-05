import type { GameObservation, GameState, Point, Tile } from "../types";
import { DIRECTION_DELTAS, cardinalDeltas, inBounds, isWalkable, manhattan } from "./spatial";
import { getPlayer } from "./state";

export function buildExplorationStatus(
  state: GameState,
  knownTiles: Array<Tile & Point>,
  knownEntities: GameObservation["knownEntities"],
  visibleEntities: GameObservation["knownEntities"],
  aliveBoss: boolean,
): GameObservation["exploration"] {
  const grid = explorationGrid(state, knownTiles, knownEntities, visibleEntities);
  const knownStairsTile = knownTiles.find((tile) => tile.kind === "stairsDown") ?? null;
  const knownStairs = knownStairsTile ? { x: knownStairsTile.x, y: knownStairsTile.y } : null;
  const { frontiers: reachableFrontiers, reached } = exploreKnownTiles(state, grid);
  const reachableStairs = knownStairs && reached[knownStairs.y * state.width + knownStairs.x] ? knownStairs : null;
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

// 毎手の探索判定は数が多いので、座標を y*width+x の番号にして格子で引く。
type ExplorationGrid = { known: Uint8Array; passable: Uint8Array };

const movementDeltas = Object.values(DIRECTION_DELTAS);
const cardinals = cardinalDeltas();

function explorationGrid(
  state: GameState,
  knownTiles: Array<Tile & Point>,
  knownEntities: GameObservation["knownEntities"],
  visibleEntities: GameObservation["knownEntities"],
): ExplorationGrid {
  const size = state.width * state.height;
  const known = new Uint8Array(size);
  const passable = new Uint8Array(size);
  for (const tile of knownTiles) {
    const index = tile.y * state.width + tile.x;
    known[index] = 1;
    if (isWalkable(tile.kind)) passable[index] = 1;
  }
  // 既知の罠と、敵以外で道をふさぐものは通れない。
  for (const entity of knownEntities) {
    if (entity.kind === "trap" && inBounds(state, entity.pos)) passable[entity.pos.y * state.width + entity.pos.x] = 0;
  }
  for (const entity of visibleEntities) {
    if (entity.blocksMovement && entity.kind !== "player" && !(entity.kind === "monster" && entity.hostile) && inBounds(state, entity.pos)) {
      passable[entity.pos.y * state.width + entity.pos.x] = 0;
    }
  }
  return { known, passable };
}

function exploreKnownTiles(
  state: GameState,
  grid: ExplorationGrid,
): { frontiers: GameObservation["exploration"]["reachableFrontiers"]; reached: Uint8Array } {
  const { width, height } = state;
  const player = getPlayer(state);
  const start = player.pos;
  const size = width * height;
  const queue = new Int32Array(size);
  const distances = new Int32Array(size);
  queue[0] = start.y * width + start.x;
  let length = 1;
  const reached = new Uint8Array(size);
  if (inBounds(state, start)) reached[start.y * width + start.x] = 1;
  const frontiers: GameObservation["exploration"]["reachableFrontiers"] = [];

  let cursor = 0;
  while (cursor < length) {
    const cell = queue[cursor];
    const currentX = cell % width;
    const currentY = Math.floor(cell / width);
    const currentDistance = distances[cell];
    cursor += 1;

    let unseenNeighbors = 0;
    for (const delta of cardinals) {
      const x = currentX + delta.x;
      const y = currentY + delta.y;
      if (x >= 0 && y >= 0 && x < width && y < height && !grid.known[y * width + x]) unseenNeighbors += 1;
    }
    if (currentDistance > 0 && unseenNeighbors > 0) {
      frontiers.push({ x: currentX, y: currentY, distance: currentDistance, unseenNeighbors });
    }

    for (const delta of movementDeltas) {
      const x = currentX + delta.x;
      const y = currentY + delta.y;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const index = y * width + x;
      if (reached[index] || !grid.passable[index]) continue;
      reached[index] = 1;
      distances[index] = currentDistance + 1;
      queue[length++] = index;
    }
  }

  frontiers.sort((a, b) => a.distance - b.distance || b.unseenNeighbors - a.unseenNeighbors || manhattan(a, start) - manhattan(b, start));
  return { frontiers, reached };
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
