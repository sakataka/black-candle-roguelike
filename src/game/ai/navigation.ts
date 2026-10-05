import { DIRECTION_DELTAS, isWalkable } from "../core/spatial";
import type { GameObservation, Point } from "../types";

export type PathOptions = {
  avoidTraps?: boolean;
  allowHostileBlockers?: boolean;
};

// 経路探索は毎手何百回も引くので、座標を y*width+x の番号にして格子で持つ。
type ObservationIndex = {
  width: number;
  height: number;
  known: Uint8Array;
  /** 既知で、壁でも遮蔽でもない（視線が通る）マス。 */
  clear: Uint8Array;
  walkable: Uint8Array;
  traps: Uint8Array;
  blockers: Uint8Array;
  nonHostileBlockers: Uint8Array;
};

const observationIndexes = new WeakMap<GameObservation, ObservationIndex>();
const movementDeltas = Object.values(DIRECTION_DELTAS);

function cellIndex(index: ObservationIndex, pos: Point): number {
  return pos.x < 0 || pos.y < 0 || pos.x >= index.width || pos.y >= index.height ? -1 : pos.y * index.width + pos.x;
}

export function isKnownWalkable(observation: GameObservation, pos: Point, options: PathOptions = {}): boolean {
  const index = observationIndex(observation);
  const cell = cellIndex(index, pos);
  if (cell < 0 || !index.walkable[cell]) {
    return false;
  }
  const blocked = options.allowHostileBlockers ? index.nonHostileBlockers[cell] : index.blockers[cell];
  return !blocked && (options.avoidTraps === false || !index.traps[cell]);
}

export function isVisibleBlockerAt(observation: GameObservation, pos: Point, options: PathOptions = {}): boolean {
  const index = observationIndex(observation);
  const cell = cellIndex(index, pos);
  if (cell < 0) return false;
  return !!(options.allowHostileBlockers ? index.nonHostileBlockers[cell] : index.blockers[cell]);
}

export function isKnownTile(observation: GameObservation, pos: Point): boolean {
  const index = observationIndex(observation);
  const cell = cellIndex(index, pos);
  return cell >= 0 && !!index.known[cell];
}

export function isKnownClear(observation: GameObservation, pos: Point): boolean {
  const index = observationIndex(observation);
  const cell = cellIndex(index, pos);
  return cell >= 0 && !!index.clear[cell];
}

export function isKnownTrapAt(observation: GameObservation, pos: Point): boolean {
  const index = observationIndex(observation);
  const cell = cellIndex(index, pos);
  return cell >= 0 && !!index.traps[cell];
}

export function observationIndex(observation: GameObservation): ObservationIndex {
  const existing = observationIndexes.get(observation);
  if (existing) {
    return existing;
  }
  const { width, height } = observation;
  const size = width * height;
  const index: ObservationIndex = { width, height, known: new Uint8Array(size), clear: new Uint8Array(size), walkable: new Uint8Array(size), traps: new Uint8Array(size), blockers: new Uint8Array(size), nonHostileBlockers: new Uint8Array(size) };
  for (const tile of observation.knownTiles) {
    const cell = cellIndex(index, tile);
    if (cell < 0) continue;
    index.known[cell] = 1;
    if (tile.kind !== "wall" && tile.kind !== "cover") index.clear[cell] = 1;
    if (isWalkable(tile.kind)) index.walkable[cell] = 1;
  }
  for (const entity of observation.knownEntities) {
    const cell = cellIndex(index, entity.pos);
    if (entity.kind === "trap" && cell >= 0) index.traps[cell] = 1;
  }
  for (const entity of observation.visibleEntities) {
    const cell = cellIndex(index, entity.pos);
    if (!entity.blocksMovement || cell < 0) continue;
    index.blockers[cell] = 1;
    if (!(entity.kind === "monster" && entity.hostile)) index.nonHostileBlockers[cell] = 1;
  }
  observationIndexes.set(observation, index);
  return index;
}

type KnownPath = { point: Point; firstStep: Point; distance: number };

/** 同点時の選択を保つため、縦横→斜めの順で既知の歩行可能マスをたどる。 */
export function* walkKnownPaths(observation: GameObservation, from = observation.player.pos, options: PathOptions = {}): Generator<KnownPath> {
  const index = observationIndex(observation);
  const queue: KnownPath[] = [{ point: from, firstStep: from, distance: 0 }];
  const seen = new Uint8Array(index.width * index.height);
  const fromCell = cellIndex(index, from);
  if (fromCell >= 0) seen[fromCell] = 1;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    yield current;
    for (const delta of movementDeltas) {
      const point = { x: current.point.x + delta.x, y: current.point.y + delta.y };
      const cell = cellIndex(index, point);
      if (cell < 0 || seen[cell] || !isKnownWalkable(observation, point, options)) continue;
      seen[cell] = 1;
      queue.push({ point, firstStep: current.distance === 0 ? point : current.firstStep, distance: current.distance + 1 });
    }
  }
}
