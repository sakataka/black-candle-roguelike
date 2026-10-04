import { DIRECTION_DELTAS, isWalkable, pointKey } from "../core/spatial";
import type { GameObservation, Point } from "../types";

export type PathOptions = {
  avoidTraps?: boolean;
  allowHostileBlockers?: boolean;
};

type ObservationIndex = {
  knownTiles: Map<string, GameObservation["knownTiles"][number]>;
  knownTraps: Set<string>;
  visibleBlockers: Set<string>;
  visibleNonHostileBlockers: Set<string>;
};

const observationIndexes = new WeakMap<GameObservation, ObservationIndex>();
const movementDeltas = Object.values(DIRECTION_DELTAS);

export function isKnownWalkable(observation: GameObservation, pos: Point, options: PathOptions = {}): boolean {
  const index = observationIndex(observation);
  const tile = index.knownTiles.get(pointKey(pos));
  if (!tile || !isWalkable(tile.kind)) {
    return false;
  }
  return !isVisibleBlockerAt(observation, pos, options) && (options.avoidTraps === false || !isKnownTrapAt(observation, pos));
}

export function isVisibleBlockerAt(observation: GameObservation, pos: Point, options: PathOptions = {}): boolean {
  const index = observationIndex(observation);
  const key = pointKey(pos);
  return options.allowHostileBlockers ? index.visibleNonHostileBlockers.has(key) : index.visibleBlockers.has(key);
}

export function isKnownTrapAt(observation: GameObservation, pos: Point): boolean {
  return observationIndex(observation).knownTraps.has(pointKey(pos));
}

export function observationIndex(observation: GameObservation): ObservationIndex {
  const existing = observationIndexes.get(observation);
  if (existing) {
    return existing;
  }
  const knownTiles = new Map<string, GameObservation["knownTiles"][number]>();
  for (const tile of observation.knownTiles) {
    knownTiles.set(pointKey(tile), tile);
  }
  const knownTraps = new Set<string>();
  for (const entity of observation.knownEntities) {
    if (entity.kind === "trap") {
      knownTraps.add(pointKey(entity.pos));
    }
  }
  const visibleBlockers = new Set<string>();
  const visibleNonHostileBlockers = new Set<string>();
  for (const entity of observation.visibleEntities) {
    if (!entity.blocksMovement) {
      continue;
    }
    const key = pointKey(entity.pos);
    visibleBlockers.add(key);
    if (!(entity.kind === "monster" && entity.hostile)) {
      visibleNonHostileBlockers.add(key);
    }
  }
  const index = { knownTiles, knownTraps, visibleBlockers, visibleNonHostileBlockers };
  observationIndexes.set(observation, index);
  return index;
}

type KnownPath = { point: Point; firstStep: Point; distance: number };

/** 同点時の選択を保つため、縦横→斜めの順で既知の歩行可能マスをたどる。 */
export function* walkKnownPaths(observation: GameObservation, from = observation.player.pos, options: PathOptions = {}): Generator<KnownPath> {
  const queue: KnownPath[] = [{ point: from, firstStep: from, distance: 0 }];
  const seen = new Set<string>([pointKey(from)]);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    yield current;
    for (const delta of movementDeltas) {
      const point = { x: current.point.x + delta.x, y: current.point.y + delta.y };
      const key = pointKey(point);
      if (seen.has(key) || !isKnownWalkable(observation, point, options)) continue;
      seen.add(key);
      queue.push({ point, firstStep: current.distance === 0 ? point : current.firstStep, distance: current.distance + 1 });
    }
  }
}
