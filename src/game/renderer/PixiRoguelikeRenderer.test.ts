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

function movementFixture() {
  const view = {
    id: "player", kind: "player", from: { x: 0, y: 0 }, to: { x: 0, y: 0 },
    moveStart: 0, moveDuration: 0, motion: "walk", lunge: null,
    root: { x: 0, y: 0, alpha: 1 },
    sprite: { texture: null, scale: { set() {} }, tint: 0xffffff, alpha: 1 },
    baseScale: { x: 1, y: 1 }, phase: 0, flashUntil: 0, dazed: false, badge: null, mood: null,
  };
  const renderer = Object.assign(Object.create(PixiRoguelikeRenderer.prototype), {
    clock: 0, reducedMotion: false, views: new Map([["player", view]]),
    textures: new Map(), playerTextureKey() { return "player"; }, actorLayer: { children: [] },
    paintMemoryShade() {}, camera: { x: 0, y: 0 }, cameraTarget: { x: 0, y: 0 },
    shake: { until: 0 }, world: {}, effects: [], bubble: null, currentLight: 0, lightStrength: 0,
    updateMotes() {}, flashOverlay: { clear() {} }, fadeOverlay: { clear() {} },
  });
  const state = {
    width: 10, tiles: Array.from({ length: 10 }, () => ({ visible: true, explored: true })),
    entities: [{ id: "player", kind: "player", contentId: "role.iron-oath-vanguard", pos: { x: 4, y: 0 } }],
  };
  return { renderer, view, state };
}

test("突進は数マスを瞬間移動せず、途中の位置を描く", () => {
  const { renderer, view, state } = movementFixture();
  renderer.syncEntities(state, 200, false, [{ kind: "relocate", entityId: "player", motion: "dash" }]);
  renderer.update(85);
  expect(view.root.x).toBeCloseTo(2 * 64);
  expect(view.root.alpha).toBe(1);
  renderer.update(85);
  expect(view.root.x).toBe(4 * 64);
});

test("影渡りは途中の壁を横切らず、消えてから到着点へ現れる", () => {
  const { renderer, view, state } = movementFixture();
  renderer.syncEntities(state, 200, false, [{ kind: "relocate", entityId: "player", motion: "blink" }]);
  renderer.update(42.5);
  expect(view.root.x).toBe(0);
  expect(view.root.alpha).toBeCloseTo(0.5);
  renderer.update(85);
  expect(view.root.x).toBe(4 * 64);
  expect(view.root.alpha).toBeCloseTo(0.5);
  renderer.update(42.5);
  expect(view.root.alpha).toBe(1);
});

test("デバッグの複数手ジャンプは経路を捏造せず、動きを減らす設定でも補間しない", () => {
  const { renderer, view, state } = movementFixture();
  renderer.syncEntities(state, 200, false, []);
  renderer.update(1);
  expect(view.root.x).toBe(4 * 64);
  const reduced = movementFixture();
  reduced.renderer.reducedMotion = true;
  reduced.renderer.syncEntities(reduced.state, 200, false, [{ kind: "relocate", entityId: "player", motion: "dash" }]);
  reduced.renderer.update(1);
  expect(reduced.view.root.x).toBe(4 * 64);
});
