import { describe, expect, test } from "bun:test";
import { assetCatalog } from "../content/assets";
import { facingAfterStep } from "./characterFacing";
import type { Direction } from "../types";

describe("主人公の8方向表示", () => {
  const steps: Array<[number, number, Direction]> = [
    [0, 1, "south"], [-1, 1, "southwest"], [-1, 0, "west"], [-1, -1, "northwest"],
    [0, -1, "north"], [1, -1, "northeast"], [1, 0, "east"], [1, 1, "southeast"],
  ];

  test("斜めを含む1歩の移動が3職業の正しいコマを選ぶ", () => {
    for (const [index, [dx, dy, expected]] of steps.entries()) {
      const facing = facingAfterStep(dx, dy, "south");
      expect(facing).toBe(expected);
      for (const role of ["oathbound", "ash-scout", "lantern-priest"]) {
        expect(assetCatalog[`character.${role}.${facing}`].sheet).toEqual({ columns: 4, rows: 2, index });
      }
    }
  });

  test("待機・攻撃中は向きを保ち、長距離の再配置は正面へ戻す", () => {
    for (const [, , facing] of steps) expect(facingAfterStep(0, 0, facing)).toBe(facing);
    expect(facingAfterStep(2, 0, "west")).toBe("south");
    expect(facingAfterStep(-1, -3, "east")).toBe("south");
  });
});
