import * as ROT from "rot-js";
import { getGameConfig } from "../content/config";
import { biomeThemeForFloor, bossForFloor } from "../content/floors";
import type { GameConfig, Point, Tile, TileKind } from "../types";
import { cardinalDeltas, isWalkable, manhattan, pointKey, samePoint, tileAt } from "./spatial";
import { Rng } from "./rng";

type FloorPlan = {
  guaranteedLootPoints: Point[];
  lootPoints: Point[];
  eventPoints: Point[];
  trapPoints: Point[];
  monsterPoints: Point[];
};

export function generateFloorMap(seed: number, floor: number, rules: GameConfig["rules"]) {
  const config = getGameConfig();
  const biome = biomeThemeForFloor(floor);
  const tiles = Array.from({ length: rules.mapWidth * rules.mapHeight }, (): Tile => ({
    kind: "wall",
    explored: false,
    visible: false,
  }));

  ROT.RNG.setSeed(seed + floor * 4099);
  const biomeConfig = config.biomes.find((entry) => entry.theme === biome);
  const dungeon = new ROT.Map.Uniform(rules.mapWidth, rules.mapHeight, {
    roomWidth: biomeConfig?.roomWidth ?? [5, 12],
    roomHeight: biomeConfig?.roomHeight ?? [4, 7],
    roomDugPercentage: biomeConfig?.density ?? 0.28,
    timeLimit: 1000,
  });
  const generatedDungeon = dungeon.create((x, y, value) => {
    if (value === 0) {
      setTileKind(tiles, rules.mapWidth, x, y, "floor");
    }
  });
  if (!generatedDungeon) {
    const digger = new ROT.Map.Digger(rules.mapWidth, rules.mapHeight, {
      roomWidth: [5, 12],
      roomHeight: [4, 7],
      corridorLength: [3, 9],
      dugPercentage: 0.34,
    });
    digger.create((x, y, value) => {
      if (value === 0) {
        setTileKind(tiles, rules.mapWidth, x, y, "floor");
      }
    });
  }

  const walkable = walkablePoints(tiles, rules.mapWidth);
  const roomCenters = generatedDungeon ? dungeon.getRooms().map((room) => {
    const [x, y] = room.getCenter();
    return { x: Math.round(x), y: Math.round(y) };
  }).filter((point) => walkable.some((walkablePoint) => samePoint(walkablePoint, point))) : [];
  const start = nearestPoint(roomCenters.length > 0 ? roomCenters : walkable, { x: Math.floor(rules.mapWidth / 2), y: Math.floor(rules.mapHeight / 2) }) ?? { x: 3, y: 3 };
  const connectedWalkable = connectedWalkablePoints(tiles, rules.mapWidth, rules.mapHeight, start);
  const floorWalkable = connectedWalkable.length > 0 ? connectedWalkable : walkable;
  const stairs =
    farthestPoint(roomCenters.filter((point) => floorWalkable.some((walkablePoint) => samePoint(walkablePoint, point)) && manhattan(point, start) >= Math.floor((rules.mapWidth + rules.mapHeight) * 0.28)), start) ??
    stairPoint(floorWalkable, start, rngForFloor(seed, floor)) ??
    farthestPoint(floorWalkable, start) ??
    { x: rules.mapWidth - 4, y: rules.mapHeight - 4 };
  setTileKind(tiles, rules.mapWidth, stairs.x, stairs.y, "stairsDown");

  // 守り手の階は出口を決戦の間にする。壁を開くだけなので通路の接続は失わない。
  if (bossForFloor(floor)) {
    for (let y = Math.max(1, stairs.y - 3); y <= Math.min(rules.mapHeight - 2, stairs.y + 3); y += 1) {
      for (let x = Math.max(1, stairs.x - 4); x <= Math.min(rules.mapWidth - 2, stairs.x + 4); x += 1) {
        if (x !== stairs.x || y !== stairs.y) setTileKind(tiles, rules.mapWidth, x, y, "floor");
      }
    }
    floorWalkable.splice(0, floorWalkable.length, ...connectedWalkablePoints(tiles, rules.mapWidth, rules.mapHeight, start));
  }

  return { biome, tiles, roomCenters, start, stairs, floorWalkable };
}

export function rngForFloor(seed: number, floor: number): Rng {
  return new Rng(seed + floor * 113);
}

export function bossPointNearStairs(points: Point[], stairs: Point, rng: Rng): Point | null {
  const candidates = points.filter((point) => manhattan(point, stairs) <= 6 && manhattan(point, stairs) >= 2);
  if (candidates.length === 0) {
    return null;
  }
  const point = rng.pick(candidates);
  points.splice(points.findIndex((candidate) => samePoint(candidate, point)), 1);
  return point;
}

export function chooseCoverPoints(walkable: Point[], start: Point, stairs: Point, rng: Rng): Point[] {
  const { rules } = getGameConfig();
  const count = Math.min(rules.coverCountBase + Math.floor(rng.int(0, Math.max(1, rules.coverCountFloorDivisor * 4)) / rules.coverCountFloorDivisor), rules.coverCountMax);
  const candidates = walkable.filter((point) => {
    if (samePoint(point, start) || samePoint(point, stairs)) {
      return false;
    }
    return manhattan(point, start) > 3 && manhattan(point, stairs) > 2 && openNeighborCount(walkable, point) >= 3;
  });
  const cover: Point[] = [];
  while (cover.length < count && candidates.length > 0) {
    const index = rng.int(0, candidates.length - 1);
    const [point] = candidates.splice(index, 1);
    if (!point || cover.some((coverPoint) => manhattan(coverPoint, point) < 3)) {
      continue;
    }
    cover.push(point);
  }
  return cover;
}

function openNeighborCount(walkable: Point[], point: Point): number {
  return cardinalDeltas().filter((delta) => walkable.some((candidate) => samePoint(candidate, { x: point.x + delta.x, y: point.y + delta.y }))).length;
}

export function buildFloorPlan(walkable: Point[], roomCenters: Point[], start: Point, stairs: Point): FloorPlan {
  const sideRoomCenters = roomCenters
    .filter((point) => !samePoint(point, start) && !samePoint(point, stairs))
    .sort((a, b) => manhattan(a, start) - manhattan(b, start));
  const firstSideRoom = sideRoomCenters[0] ?? start;
  const farSideRooms = sideRoomCenters.slice(Math.max(0, Math.floor(sideRoomCenters.length / 2)));
  const exitRoom = nearestPoint(roomCenters, stairs) ?? stairs;
  const nearStart = walkable.filter((point) => manhattan(point, start) >= 5 && manhattan(point, start) <= 14);
  const sideRoomPoints = pointsNearAny(walkable, sideRoomCenters, 5);
  const farRoomPoints = pointsNearAny(walkable, farSideRooms.length > 0 ? farSideRooms : [exitRoom], 5);
  const exitRoomPoints = pointsNearAny(walkable, [exitRoom, stairs], 6);
  const widePoints = walkable.filter((point) => openNeighborCount(walkable, point) >= 3);

  return {
    guaranteedLootPoints: uniquePoints([...nearStart, ...pointsNearAny(walkable, [firstSideRoom], 4), ...sideRoomPoints]),
    lootPoints: uniquePoints([...sideRoomPoints, ...nearStart, ...widePoints]),
    eventPoints: uniquePoints([...sideRoomPoints, ...farRoomPoints, ...widePoints]),
    trapPoints: uniquePoints([...farRoomPoints, ...exitRoomPoints, ...sideRoomPoints]),
    monsterPoints: uniquePoints([...exitRoomPoints, ...farRoomPoints, ...sideRoomPoints, ...walkable]),
  };
}

export function createPointTaker(points: Point[], rng: Rng, fallback: Point): (preferred?: Point[]) => Point {
  return (preferred = []) => {
    const preferredIndexes = preferred
      .map((point) => points.findIndex((candidate) => samePoint(candidate, point)))
      .filter((index) => index >= 0);
    const index = preferredIndexes.length > 0 ? rng.pick(preferredIndexes) : rng.int(0, Math.max(0, points.length - 1));
    const [point] = points.splice(index, 1);
    return point ?? fallback;
  };
}

function pointsNearAny(points: Point[], centers: Point[], radius: number): Point[] {
  if (centers.length === 0) {
    return [];
  }
  return points.filter((point) => centers.some((center) => manhattan(point, center) <= radius));
}

function uniquePoints(points: Point[]): Point[] {
  const seen = new Set<string>();
  const unique: Point[] = [];
  for (const point of points) {
    const key = pointKey(point);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(point);
  }
  return unique;
}

export function setTileKind(tiles: Tile[], width: number, x: number, y: number, kind: TileKind): void {
  tiles[y * width + x].kind = kind;
}

function walkablePoints(tiles: Tile[], width: number): Point[] {
  return tiles.flatMap((tile, index) => {
    if (!isWalkable(tile.kind)) {
      return [];
    }
    return [{ x: index % width, y: Math.floor(index / width) }];
  });
}

function connectedWalkablePoints(tiles: Tile[], width: number, height: number, start: Point): Point[] {
  if (!isWalkable(tileAt(tiles, width, start).kind)) {
    return [];
  }

  const queue: Point[] = [start];
  const visited = new Set<string>([pointKey(start)]);
  const points: Point[] = [];
  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor];
    cursor += 1;
    points.push(current);
    for (const delta of cardinalDeltas()) {
      const next = { x: current.x + delta.x, y: current.y + delta.y };
      const key = pointKey(next);
      if (visited.has(key) || next.x < 0 || next.y < 0 || next.x >= width || next.y >= height || !isWalkable(tileAt(tiles, width, next).kind)) {
        continue;
      }
      visited.add(key);
      queue.push(next);
    }
  }
  return points;
}

export function nearestPoint(points: Point[], target: Point): Point | null {
  let best: Point | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const distance = manhattan(point, target);
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return best;
}

function farthestPoint(points: Point[], target: Point): Point | null {
  let best: Point | null = null;
  let bestDistance = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const distance = manhattan(point, target);
    if (distance > bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return best;
}

function stairPoint(points: Point[], start: Point, rng: Rng): Point | null {
  const { rules } = getGameConfig();
  const minDistance = Math.floor((rules.mapWidth + rules.mapHeight) * 0.28);
  const maxDistance = Math.floor((rules.mapWidth + rules.mapHeight) * 0.5);
  const candidates = points.filter((point) => {
    const distance = manhattan(point, start);
    return distance >= minDistance && distance <= maxDistance;
  });
  if (candidates.length === 0) {
    return null;
  }
  return rng.pick(candidates);
}
