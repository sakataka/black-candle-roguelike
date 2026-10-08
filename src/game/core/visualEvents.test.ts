import { beforeAll, expect, test } from "bun:test";
import { loadBunGameConfig } from "../content/config";
import { applyAction, createInitialGame } from "./game";
import { getPlayer } from "./state";
import { deriveVisualEvents } from "./visualEvents";

beforeAll(() => loadBunGameConfig());

for (const [role, motion] of [["role.iron-oath-vanguard", "dash"], ["role.keyshadow-rogue", "blink"]] as const) {
  test(`${role}の固有技から${motion}の移動演出を導く`, () => {
    const before = createInitialGame(123, role);
    before.tiles = before.tiles.map(() => ({ kind: "floor", visible: true, explored: true }));
    const player = getPlayer(before);
    player.pos = { x: 8, y: 10 };
    before.entities = [player, { id: "target", kind: "monster", contentId: "monster.ash-rat", pos: { x: 12, y: 10 }, hostile: true, blocksMovement: true, stats: { hp: 100, maxHp: 100, attack: 1, defense: 0 } }];
    const after = applyAction(before, { type: "skill", targetId: "target" });
    expect(deriveVisualEvents(before, after)).toContainEqual({ kind: "relocate", entityId: before.playerId, motion });
    expect(getPlayer(before).pos).toEqual({ x: 8, y: 10 });
  });
}

test("一歩の歩行や階の切り替えを突進として描かない", () => {
  const before = createInitialGame(123, "role.iron-oath-vanguard");
  before.tiles = before.tiles.map(() => ({ kind: "floor", visible: true, explored: true }));
  before.entities = [getPlayer(before)];
  const after = applyAction(before, { type: "move", direction: "east" });
  expect(deriveVisualEvents(before, after).some(event => event.kind === "relocate")).toBe(false);
  after.floor++;
  expect(deriveVisualEvents(before, after)).toEqual([{ kind: "floorChanged", floor: after.floor }]);
});
