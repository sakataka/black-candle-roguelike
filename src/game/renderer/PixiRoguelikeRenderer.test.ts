import { expect, test } from "bun:test";
import { PixiRoguelikeRenderer } from "./PixiRoguelikeRenderer";

test("動きを減らしても、蘇った敵は元の縦横比に戻る", () => {
  // GPUやDOMを作らず、実際の更新処理を最小の描画状態で確かめる。
  const scale = {
    x: 2,
    y: 3,
    set(x: number, y: number) { this.x = x; this.y = y; },
  };
  const view = {
    kind: "monster",
    moveDuration: 0,
    from: { x: 0, y: 0 },
    to: { x: 0, y: 0 },
    lunge: null,
    root: { x: 0, y: 0 },
    sprite: { scale, tint: 0xffffff, alpha: 1 },
    baseScale: { x: 2, y: 3 },
    mood: "dormant" as "dormant" | null,
    flashUntil: 0,
    dazed: false,
    badge: null,
  };
  const renderer = Object.assign(Object.create(PixiRoguelikeRenderer.prototype), {
    clock: 0,
    reducedMotion: true,
    views: new Map([["skeleton", view]]),
    paintMemoryShade() {},
    camera: { x: 0, y: 0 },
    cameraTarget: { x: 0, y: 0 },
    shake: { until: 0 },
    world: {},
    effects: [],
    bubble: null,
    currentLight: 0,
    lightStrength: 0,
    updateMotes() {},
    flashOverlay: { clear() {} },
    fadeOverlay: { clear() {} },
  });

  renderer.update(16);
  expect(scale.x).toBeCloseTo(2 * 1.05);
  expect(scale.y).toBeCloseTo(3 * 0.62);
  view.mood = null;
  renderer.update(16);
  expect(scale.x).toBe(2);
  expect(scale.y).toBe(3);
  renderer.update(16);
  expect(scale.x).toBe(2);
  expect(scale.y).toBe(3);
});
