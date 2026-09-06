import type { Direction } from "../types";

// Position changes are presentation state; they do not alter AI or game rules.
export function facingAfterStep(dx: number, dy: number, previous: Direction): Direction {
  if (dx === 0 && dy === 0) return previous;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return "south";
  if (dy < 0) return dx < 0 ? "northwest" : dx > 0 ? "northeast" : "north";
  if (dy > 0) return dx < 0 ? "southwest" : dx > 0 ? "southeast" : "south";
  return dx < 0 ? "west" : "east";
}
