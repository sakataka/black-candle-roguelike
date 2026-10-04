import type { Direction, GameState, Point, Tile, TileKind } from "../types";

export const DIRECTION_DELTAS: Record<Direction, Point> = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
  east: { x: 1, y: 0 },
  northwest: { x: -1, y: -1 },
  northeast: { x: 1, y: -1 },
  southwest: { x: -1, y: 1 },
  southeast: { x: 1, y: 1 },
};

export function linePoints(from: Point, to: Point): Point[] {
  const points: Point[] = [];
  let x0 = from.x;
  let y0 = from.y;
  const x1 = to.x;
  const y1 = to.y;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let error = dx - dy;

  while (!(x0 === x1 && y0 === y1)) {
    const doubleError = error * 2;
    if (doubleError > -dy) {
      error -= dy;
      x0 += sx;
    }
    if (doubleError < dx) {
      error += dx;
      y0 += sy;
    }
    if (!(x0 === x1 && y0 === y1)) {
      points.push({ x: x0, y: y0 });
    }
  }
  return points;
}

export function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

export function pointKey(point: Point): string {
  return `${point.x},${point.y}`;
}

export function cardinalDeltas(): Point[] {
  return [DIRECTION_DELTAS.north, DIRECTION_DELTAS.south, DIRECTION_DELTAS.west, DIRECTION_DELTAS.east];
}

export function chebyshev(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function manhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function tileAt(state: GameState, pos: Point): Tile;
export function tileAt(tiles: Tile[], width: number, pos: Point): Tile;
export function tileAt(stateOrTiles: GameState | Tile[], posOrWidth: Point | number, maybePos?: Point): Tile {
  if (Array.isArray(stateOrTiles)) {
    const width = posOrWidth as number;
    const pos = maybePos as Point;
    return stateOrTiles[pos.y * width + pos.x];
  }
  const state = stateOrTiles;
  const pos = posOrWidth as Point;
  return state.tiles[pos.y * state.width + pos.x];
}

export function inBounds(state: GameState, pos: Point): boolean {
  return pos.x >= 0 && pos.y >= 0 && pos.x < state.width && pos.y < state.height;
}

export function isWalkable(kind: TileKind): boolean {
  return kind === "floor" || kind === "cover" || kind === "stairsDown";
}

export function blocksSight(kind: TileKind): boolean {
  return kind === "wall" || kind === "cover";
}
