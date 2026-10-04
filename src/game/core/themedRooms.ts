import { floorRuleMatches, getGameConfig } from "../content/config";
import type { BiomeTheme, Point, Tile } from "../types";
import { Rng } from "./rng";
import { manhattan, samePoint } from "./spatial";

type RoomBounds = { left: number; right: number; top: number; bottom: number };
export type ThemedRoom = { definition: NonNullable<ReturnType<typeof getGameConfig>["expansion"]>["rooms"][number]; points: Point[] };

/** 部屋の接続や通路は変えず、スタート・階段以外の既存部屋にテーマを持たせる。 */
export function applyRoomTheme(seed: number, floor: number, biome: BiomeTheme, tiles: Tile[], width: number, rooms: RoomBounds[], start: Point, stairs: Point): ThemedRoom | null {
  const config = getGameConfig().expansion;
  if (!config?.enabled) return null;
  const rng = new Rng(seed + floor * 7907 + 37);
  if (rng.int(1, 100) > config.roomChancePercent) return null;
  const definitions = config.rooms.filter((room) => floorRuleMatches(room, floor, biome));
  if (!definitions.length) return null;
  const contains = (room: RoomBounds, point: Point) => point.x >= room.left - 1 && point.x <= room.right + 1 && point.y >= room.top - 1 && point.y <= room.bottom + 1;
  const candidates = rooms.filter((room) => !contains(room, start) && !contains(room, stairs));
  if (!candidates.length) return null;
  const room = rng.pick(candidates);
  const definition = rng.pick(definitions);
  const points: Point[] = [];
  for (let y = room.top - 1; y <= room.bottom + 1; y += 1) {
    for (let x = room.left - 1; x <= room.right + 1; x += 1) {
      const tile = tiles[y * width + x];
      if (!tile) continue;
      const interior = x >= room.left && x <= room.right && y >= room.top && y <= room.bottom;
      if (interior || tile.kind === "wall") tile.roomTheme = definition.theme;
      if (interior && tile.kind === "floor" && manhattan({ x, y }, start) > 7 && !samePoint({ x, y }, stairs)) points.push({ x, y });
    }
  }
  return points.length >= 6 ? { definition, points } : null;
}
