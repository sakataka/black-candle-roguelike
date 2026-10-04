import { samePoint } from "../core/spatial";
import { contentEntities } from "../content/entities";
import { Application, Assets, Container, Graphics, Rectangle, Sprite, Text, Texture } from "pixi.js";
import { assetCatalog, assetIdForContent, publicAssetPath } from "../content/assets";
import { facingAfterStep } from "./characterFacing";
import { realtimeConfig } from "../content/realtime";
import type { VisualEvent } from "../core/visualEvents";
import type { BiomeTheme, Direction, Entity, GameState, Point, TileKind } from "../types";

const TILE_SIZE = 64;
const MEMORY_SHADE_ALPHA = 0.46;
const MEMORY_SHADE_SCALE = 8;
/** 視界の出入りで記憶の暗がりが入れ替わる時間。1歩ごとに明暗が切り替わってちらつかないよう、ゆっくり馴染ませる。 */
const MEMORY_SHADE_FADE_MS = 280;

type TextureKey = TileKind | string;

export type RenderIntent = {
  text: string;
  tone: "combat" | "survival" | "loot" | "explore" | "descend";
};

export type RenderOptions = {
  events?: VisualEvent[];
  intent?: RenderIntent | null;
  /** 次の描画までの見込み時間。移動補間の長さに使う。 */
  stepMs?: number;
  /** 灯の明るさ 0..1。灯が弱るほど視界の外側が暗く沈む。 */
  lightStrength?: number;
};

type EntityView = {
  id: string;
  kind: Entity["kind"];
  root: Container;
  sprite: Sprite;
  baseScale: { x: number; y: number };
  /** 呼吸や揺れの位相。個体ごとにずらして群れが同期しないようにする。 */
  phase: number;
  hpBar: Graphics | null;
  from: Point;
  to: Point;
  moveStart: number;
  moveDuration: number;
  flashUntil: number;
  lunge: { dx: number; dy: number; start: number } | null;
  dazed: boolean;
  /** 眠り・崩れた骨・看破。敵の状態を小さな印と色で示す。 */
  mood: "asleep" | "dormant" | "exposed" | null;
  badge: Text | null;
};

type Mote = {
  sprite: Sprite;
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  age: number;
  life: number;
};

/** 階層ごとの空気。灯の色は共通の蝋燭色、漂う粒の色と動きで領域の違いを出す。 */
const BIOME_ATMOSPHERE: Record<BiomeTheme, { mote: number; rise: number; drift: number; glow: number; brightness: number; size: number }> = {
  // 黒石: 灯に浮かぶ細かな埃。
  blackstone: { mote: 0xd9b27a, rise: 6, drift: 5, glow: 0xffb871, brightness: 0.85, size: 1 },
  // 墓所: ゆっくり漂う青白い胞子。
  crypt: { mote: 0x9fe0cf, rise: 3, drift: 8, glow: 0xffc98a, brightness: 1, size: 1.15 },
  // 炉心: 床から昇る火の粉。
  furnace: { mote: 0xff8a3d, rise: 24, drift: 7, glow: 0xffa45c, brightness: 1.25, size: 1.2 },
  // 黒燭中枢: 紫の灰。
  "black-candle": { mote: 0xb79bff, rise: 5, drift: 10, glow: 0xffc27e, brightness: 1.1, size: 1.15 },
};

const MOTE_COUNT = 54;

type Effect = {
  node: Container;
  age: number;
  life: number;
  update: (effect: Effect, progress: number) => void;
};

export class PixiRoguelikeRenderer {
  readonly app = new Application();
  private readonly world = new Container();
  private readonly terrainLayer = new Container();
  private readonly groundLayer = new Container();
  private readonly signalLayer = new Container();
  private readonly actorLayer = new Container();
  private readonly effectLayer = new Container();
  private readonly overlayLayer = new Container();
  private readonly textures = new Map<TextureKey, Texture>();
  private readonly characterFacing = new Map<string, Direction>();
  private readonly characterLastPos = new Map<string, Point>();
  private readonly characterLastContentId = new Map<string, string>();
  private readonly views = new Map<string, EntityView>();
  private readonly effects: Effect[] = [];
  private readonly moteLayer = new Container();
  private readonly motes: Mote[] = [];
  private lightSprite: Sprite | null = null;
  private glowSprite: Sprite | null = null;
  private dotTexture: Texture = Texture.EMPTY;
  private shadeTexture: Texture = Texture.EMPTY;
  /** 探索済み記憶の暗がり。1マス1画素の濃さを拡大してぼかし、視界の縁をなめらかに沈める。 */
  private readonly memoryCells = document.createElement("canvas");
  private readonly memoryCanvas = document.createElement("canvas");
  private memoryTexture: Texture | null = null;
  private memorySprite: Sprite | null = null;
  /** マスごとの暗がりの濃さ（0〜1）。現在値を目標値へ時間をかけて寄せる。 */
  private memoryShade = new Float32Array(0);
  private memoryShadeTarget = new Float32Array(0);
  private memoryShadeSettled = true;
  private fogTexture: Texture = Texture.EMPTY;
  private fogCornerTexture: Texture = Texture.EMPTY;
  private biome: BiomeTheme = "blackstone";
  private readonly reducedMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  private flashOverlay = new Graphics();
  private fadeOverlay = new Graphics();
  private bubble: Container | null = null;
  private bubbleText = "";
  private bubbleAge = 0;
  private lastScene: { seed: number; floor: number; runTurn: number } | null = null;
  private camera = { x: 0, y: 0 };
  private cameraTarget = { x: 0, y: 0 };
  private shake = { amount: 0, until: 0 };
  private flashUntil = 0;
  private fadeUntil = 0;
  private lightStrength = 1;
  private currentLight = 1;
  private playerId = "player";
  private clock = 0;
  private viewWidth = 16 * TILE_SIZE;
  private viewHeight = 10 * TILE_SIZE;
  private ready = false;

  async mount(container: HTMLElement): Promise<void> {
    await this.app.init({
      width: this.viewWidth,
      height: this.viewHeight,
      background: "#050404",
      antialias: false,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });
    this.world.addChild(this.terrainLayer, this.groundLayer, this.signalLayer, this.actorLayer, this.moteLayer, this.effectLayer);
    this.app.stage.addChild(this.world, this.overlayLayer);
    container.replaceChildren(this.app.canvas);
    await this.buildTextures();
    this.dotTexture = makeCanvasTexture(32, (context, size) => {
      const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      gradient.addColorStop(0, "rgba(255,255,255,1)");
      gradient.addColorStop(0.35, "rgba(255,255,255,0.45)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, size, size);
    });
    // 壁際の床に落ちる影。上辺から下へ薄れる帯を、向きに合わせて回して使う。
    this.shadeTexture = makeCanvasTexture(TILE_SIZE, (context, size) => {
      const gradient = context.createLinearGradient(0, 0, 0, size);
      gradient.addColorStop(0, "rgba(0,0,0,0.7)");
      gradient.addColorStop(0.18, "rgba(0,0,0,0.38)");
      gradient.addColorStop(0.5, "rgba(0,0,0,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, size, size);
    });
    // 未探索との境目。黒い霧が既知の側へ滲むように薄れる。
    this.fogTexture = makeCanvasTexture(TILE_SIZE, (context, size) => {
      const gradient = context.createLinearGradient(0, 0, 0, size);
      gradient.addColorStop(0, "rgba(1,1,1,0.96)");
      gradient.addColorStop(0.32, "rgba(1,1,1,0.55)");
      gradient.addColorStop(0.72, "rgba(1,1,1,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, size, size);
    });
    this.fogCornerTexture = makeCanvasTexture(TILE_SIZE, (context, size) => {
      const gradient = context.createRadialGradient(0, 0, 0, 0, 0, size * 0.72);
      gradient.addColorStop(0, "rgba(1,1,1,0.9)");
      gradient.addColorStop(0.45, "rgba(1,1,1,0.45)");
      gradient.addColorStop(1, "rgba(1,1,1,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, size, size);
    });
    this.lightSprite = new Sprite(this.makeLightTexture());
    this.lightSprite.anchor.set(0.5);
    this.glowSprite = new Sprite(this.makeGlowTexture());
    this.glowSprite.anchor.set(0.5);
    this.glowSprite.blendMode = "add";
    this.overlayLayer.addChild(this.lightSprite, this.glowSprite, this.flashOverlay, this.fadeOverlay);
    this.app.ticker.add((ticker) => this.update(ticker.deltaMS));
    this.ready = true;
  }

  render(state: GameState, options: RenderOptions = {}): void {
    if (!this.ready) {
      return;
    }
    const events = options.events ?? [];
    const sceneChanged = !this.lastScene
      || this.lastScene.seed !== state.seed
      || this.lastScene.floor !== state.floor
      || state.runTurn < this.lastScene.runTurn;
    if (sceneChanged) {
      this.resetScene();
      this.fadeUntil = this.clock + 520;
    }
    this.lastScene = { seed: state.seed, floor: state.floor, runTurn: state.runTurn };
    this.playerId = state.playerId;
    this.biome = state.biome;
    this.lightStrength = clamp(options.lightStrength ?? 1, 0, 1);

    const player = state.entities.find((entity) => entity.id === state.playerId);
    this.cameraTarget = cameraTargetFor(state, player?.pos ?? { x: 0, y: 0 }, this.viewWidth, this.viewHeight);
    if (sceneChanged) {
      this.camera = { ...this.cameraTarget };
    }

    this.drawTerrain(state, sceneChanged);
    this.drawSignals(state);
    this.syncEntities(state, options.stepMs ?? 200, sceneChanged, events);
    this.playEvents(state, events);
    if (options.intent) this.showIntent(options.intent);
    if (state.status === "lost" && player) {
      const view = this.views.get(player.id);
      if (view) view.sprite.tint = 0x6f6660;
    }
  }

  /** 表示タイル数を変える。狭い画面では正方形寄りにして1タイルを大きく見せる。 */
  setViewport(columns: number, rows: number): void {
    const width = columns * TILE_SIZE;
    const height = rows * TILE_SIZE;
    if (width === this.viewWidth && height === this.viewHeight) return;
    this.viewWidth = width;
    this.viewHeight = height;
    if (this.ready) {
      this.app.renderer.resize(width, height);
      this.camera = { ...this.cameraTarget };
    }
  }

  destroy(): void {
    this.app.destroy();
  }

  private resetScene(): void {
    this.characterFacing.clear();
    this.characterLastPos.clear();
    this.characterLastContentId.clear();
    for (const view of this.views.values()) view.root.destroy({ children: true });
    this.views.clear();
    for (const effect of this.effects.splice(0)) effect.node.destroy({ children: true });
    for (const mote of this.motes.splice(0)) mote.sprite.destroy();
    if (this.bubble) {
      this.bubble.destroy({ children: true });
      this.bubble = null;
      this.bubbleText = "";
    }
  }

  private drawTerrain(state: GameState, sceneChanged: boolean): void {
    for (const child of this.terrainLayer.removeChildren()) {
      // 記憶の暗がりは同じスプライトを使い回す。
      if (child !== this.memorySprite) child.destroy();
    }
    const minX = Math.max(0, Math.floor(Math.min(this.camera.x, this.cameraTarget.x) / TILE_SIZE) - 1);
    const minY = Math.max(0, Math.floor(Math.min(this.camera.y, this.cameraTarget.y) / TILE_SIZE) - 1);
    const maxX = Math.min(state.width - 1, Math.ceil((Math.max(this.camera.x, this.cameraTarget.x) + this.viewWidth) / TILE_SIZE) + 1);
    const maxY = Math.min(state.height - 1, Math.ceil((Math.max(this.camera.y, this.cameraTarget.y) + this.viewHeight) / TILE_SIZE) + 1);
    const known = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= state.width || y >= state.height) return false;
      const tile = state.tiles[y * state.width + x];
      return tile.explored || tile.visible;
    };
    const knownWall = (x: number, y: number): boolean => known(x, y) && state.tiles[y * state.width + x].kind === "wall";
    const edges = new Graphics();
    const voids = new Graphics();
    const depth = new Container();
    const fog = new Container();
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const tile = state.tiles[y * state.width + x];
        if (!tile.explored && !tile.visible) {
          voids.rect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
          continue;
        }
        if (tile.kind === "cover" || tile.kind === "stairsDown") {
          this.addTileSprite(assetIdForContent(`terrain.floor.${tile.roomTheme ?? state.biome}`), x, y);
        }
        const theme = tile.roomTheme ?? state.biome;
        const texture = tile.kind === "cover" && tile.coverAsset ? tile.coverAsset : tile.roomTheme && (tile.kind === "floor" || tile.kind === "wall") ? assetIdForContent(`terrain.${tile.kind}.${theme}`) : tileTextureKey(tile.kind, state.biome);
        this.addTileSprite(texture, x, y);
        if (tile.kind === "wall") {
          this.drawWallEdges(edges, state, x, y);
        } else {
          // 壁の高さを感じさせるため、既知の壁に接する床へ影を落とす。北の壁ほど影が深い。
          if (knownWall(x, y - 1)) depth.addChild(this.edgeSprite(this.shadeTexture, x, y, 0, 0.95));
          if (knownWall(x - 1, y)) depth.addChild(this.edgeSprite(this.shadeTexture, x, y, -Math.PI / 2, 0.6));
          if (knownWall(x + 1, y)) depth.addChild(this.edgeSprite(this.shadeTexture, x, y, Math.PI / 2, 0.6));
          if (knownWall(x, y + 1)) depth.addChild(this.edgeSprite(this.shadeTexture, x, y, Math.PI, 0.35));
        }
        // 未探索との境は黒い霧で滲ませる。既知かどうかだけで決めるので、地形の情報は漏れない。
        const up = known(x, y - 1);
        const down = known(x, y + 1);
        const left = known(x - 1, y);
        const right = known(x + 1, y);
        if (!up) fog.addChild(this.edgeSprite(this.fogTexture, x, y, 0, 1));
        if (!down) fog.addChild(this.edgeSprite(this.fogTexture, x, y, Math.PI, 1));
        if (!left) fog.addChild(this.edgeSprite(this.fogTexture, x, y, -Math.PI / 2, 1));
        if (!right) fog.addChild(this.edgeSprite(this.fogTexture, x, y, Math.PI / 2, 1));
        if (up && left && !known(x - 1, y - 1)) fog.addChild(this.edgeSprite(this.fogCornerTexture, x, y, 0, 1));
        if (up && right && !known(x + 1, y - 1)) fog.addChild(this.edgeSprite(this.fogCornerTexture, x, y, Math.PI / 2, 1));
        if (down && right && !known(x + 1, y + 1)) fog.addChild(this.edgeSprite(this.fogCornerTexture, x, y, Math.PI, 1));
        if (down && left && !known(x - 1, y + 1)) fog.addChild(this.edgeSprite(this.fogCornerTexture, x, y, -Math.PI / 2, 1));
      }
    }
    voids.fill("#010101");
    this.terrainLayer.addChild(depth, voids, edges, this.updateMemoryShade(state, sceneChanged), fog);
  }

  /**
   * 探索済みの記憶は地形を残したまま沈め、現在視界と見分けられるようにする。
   * マス単位の矩形だと視界の縁が階段状になるので、濃さの地図を拡大・ぼかしして境目を約1マスの階調にする。
   */
  private updateMemoryShade(state: GameState, sceneChanged: boolean): Sprite {
    const scale = MEMORY_SHADE_SCALE;
    const resized = this.memoryCells.width !== state.width || this.memoryCells.height !== state.height;
    if (resized) {
      this.memoryCells.width = state.width;
      this.memoryCells.height = state.height;
      this.memoryCanvas.width = state.width * scale;
      this.memoryCanvas.height = state.height * scale;
      this.memoryTexture?.destroy(true);
      this.memoryTexture = null;
    }
    if (this.memoryShadeTarget.length !== state.tiles.length) {
      this.memoryShade = new Float32Array(state.tiles.length);
      this.memoryShadeTarget = new Float32Array(state.tiles.length);
    }
    for (let index = 0; index < state.tiles.length; index += 1) {
      // 未探索も同じ濃さにしておき、視界の縁だけが明るく抜けるようにする。
      this.memoryShadeTarget[index] = state.tiles[index].visible ? 0 : 1;
    }
    // 階の切り替えは暗転で隠れるので、馴染ませずにそのまま置く。
    if (sceneChanged || resized) this.memoryShade.set(this.memoryShadeTarget);
    this.memoryShadeSettled = false;
    this.paintMemoryShade(0);
    if (!this.memoryTexture) {
      this.memoryTexture = Texture.from(this.memoryCanvas);
      this.memoryTexture.source.scaleMode = "linear";
      this.memorySprite = new Sprite(this.memoryTexture);
    }
    const sprite = this.memorySprite as Sprite;
    sprite.scale.set(TILE_SIZE / scale);
    return sprite;
  }

  /** 暗がりの濃さを目標へ寄せ、拡大・ぼかした濃さの地図として描き直す。 */
  private paintMemoryShade(deltaMs: number): void {
    if (this.memoryShadeSettled) return;
    const step = deltaMs / MEMORY_SHADE_FADE_MS;
    let settled = true;
    for (let index = 0; index < this.memoryShade.length; index += 1) {
      const current = this.memoryShade[index];
      const target = this.memoryShadeTarget[index];
      if (current === target) continue;
      const next = current < target ? Math.min(target, current + step) : Math.max(target, current - step);
      this.memoryShade[index] = next;
      if (next !== target) settled = false;
    }
    this.memoryShadeSettled = settled;
    const cells = this.memoryCells.getContext("2d");
    const canvas = this.memoryCanvas.getContext("2d");
    if (!cells || !canvas || this.memoryCells.width * this.memoryCells.height !== this.memoryShade.length) return;
    const image = cells.createImageData(this.memoryCells.width, this.memoryCells.height);
    const alpha = MEMORY_SHADE_ALPHA * 255;
    for (let index = 0; index < this.memoryShade.length; index += 1) {
      const offset = index * 4;
      image.data[offset] = 7;
      image.data[offset + 1] = 6;
      image.data[offset + 2] = 10;
      // 明るく抜ける側から沈む側へ、なめらかに寄せる。
      const shade = this.memoryShade[index];
      image.data[offset + 3] = Math.round(alpha * shade * shade * (3 - 2 * shade));
    }
    cells.putImageData(image, 0, 0);
    canvas.clearRect(0, 0, this.memoryCanvas.width, this.memoryCanvas.height);
    canvas.imageSmoothingEnabled = true;
    canvas.imageSmoothingQuality = "high";
    canvas.filter = `blur(${MEMORY_SHADE_SCALE * 0.45}px)`;
    canvas.drawImage(this.memoryCells, 0, 0, this.memoryCanvas.width, this.memoryCanvas.height);
    canvas.filter = "none";
    this.memoryTexture?.source.update();
  }

  /** 1マス分の帯を回転させて置く。回転0で上辺、π/2で右辺、πで下辺、-π/2で左辺に効く。 */
  private edgeSprite(texture: Texture, x: number, y: number, rotation: number, alpha: number): Sprite {
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.x = x * TILE_SIZE + TILE_SIZE / 2;
    sprite.y = y * TILE_SIZE + TILE_SIZE / 2;
    sprite.width = TILE_SIZE;
    sprite.height = TILE_SIZE;
    sprite.rotation = rotation;
    sprite.alpha = alpha;
    return sprite;
  }

  private syncEntities(state: GameState, stepMs: number, snap: boolean, events: VisualEvent[]): void {
    const seen = new Set<string>();
    const moveDuration = clamp(stepMs * 0.85, 60, 220);
    for (const entity of state.entities) {
      const tile = state.tiles[entity.pos.y * state.width + entity.pos.x];
      const remembered = entity.kind === "item" || entity.kind === "trap" || entity.kind === "event";
      const shouldDraw = remembered ? tile.explored || tile.visible : tile.visible;
      if (!shouldDraw) continue;
      seen.add(entity.id);
      const key = entity.kind === "player" ? this.playerTextureKey(entity) : assetIdForContent(entity.contentId);
      let view = this.views.get(entity.id);
      if (!view) {
        view = this.createView(entity, key);
        this.views.set(entity.id, view);
        (entity.kind === "player" || entity.kind === "monster" ? this.actorLayer : this.groundLayer).addChild(view.root);
      } else {
        const texture = this.textures.get(key);
        if (texture && view.sprite.texture !== texture) view.sprite.texture = texture;
        if (!samePoint(view.to, entity.pos)) {
          const jump = Math.max(Math.abs(view.to.x - entity.pos.x), Math.abs(view.to.y - entity.pos.y));
          view.from = snap || jump > 1 ? { ...entity.pos } : this.currentTilePos(view);
          view.to = { ...entity.pos };
          view.moveStart = this.clock;
          view.moveDuration = snap || jump > 1 ? 0 : moveDuration;
        }
      }
      if (entity.kind === "monster" && entity.stats && view.hpBar) {
        drawHpBar(view.hpBar, entity.stats.hp / entity.stats.maxHp, "#c75644");
      }
      view.dazed = entity.conditions?.some((condition) => condition.kind === "dazed") ?? false;
      if (entity.kind === "monster") this.syncMood(view, entity);
    }
    const dying = new Set(events.flatMap((event) => event.kind === "death" ? [event.entityId] : []));
    for (const [id, view] of this.views) {
      if (seen.has(id)) continue;
      this.views.delete(id);
      if (dying.has(id)) {
        this.spawnDeathGhost(view);
      } else {
        view.root.destroy({ children: true });
      }
    }
    this.actorLayer.children.sort((a, b) => a.y - b.y);
  }

  private syncMood(view: EntityView, entity: Entity): void {
    const mood = (entity.dormant ?? 0) > 0 ? "dormant" : entity.asleep ? "asleep" : entity.conditions?.some((condition) => condition.kind === "exposed") ? "exposed" : null;
    if (mood === view.mood) return;
    view.mood = mood;
    if (!mood) {
      view.badge?.destroy();
      view.badge = null;
      return;
    }
    const label = mood === "asleep" ? "Zz" : mood === "dormant" ? "骨" : "破";
    const fill = mood === "asleep" ? 0xb9c8ff : mood === "dormant" ? 0xd8cbb0 : 0xffa070;
    if (!view.badge) {
      view.badge = new Text({ text: label, style: { fontFamily: "sans-serif", fontSize: 13, fontWeight: "bold", fill, stroke: { color: 0x120d0a, width: 3 } } });
      view.badge.anchor.set(0.5, 1);
      view.badge.x = TILE_SIZE * 0.78;
      view.badge.y = 14;
      view.root.addChild(view.badge);
    } else {
      view.badge.text = label;
      view.badge.style.fill = fill;
    }
  }

  private createView(entity: Entity, key: TextureKey): EntityView {
    const root = new Container();
    const sprite = new Sprite(this.textures.get(key) ?? Texture.EMPTY);
    sprite.anchor.set(0.5, 1);
    sprite.x = TILE_SIZE / 2;
    sprite.y = TILE_SIZE;
    const isBoss = contentEntities[entity.contentId]?.tier === "boss";
    sprite.width = TILE_SIZE * (isBoss ? 1.2 : 1);
    sprite.height = TILE_SIZE * (isBoss ? 1.2 : 1);
    if (entity.kind === "player" || entity.kind === "monster" || entity.kind === "item") {
      // 足元の影で、床から浮かずに立っている感じを出す。
      const shadow = new Graphics();
      const width = entity.kind === "item" ? 15 : 21;
      shadow.ellipse(TILE_SIZE / 2, TILE_SIZE - 7, width, width * 0.3).fill({ color: "#000000", alpha: entity.kind === "item" ? 0.32 : 0.5 });
      root.addChild(shadow);
    }
    root.addChild(sprite);
    if (entity.kind === "monster" && entity.elite) {
      // 精鋭は足元に金の輪を敷き、通常の敵と見分ける。
      const aura = new Graphics();
      aura.ellipse(TILE_SIZE / 2, TILE_SIZE - 7, 25, 8).stroke({ color: 0xe0b45a, width: 2, alpha: 0.85 });
      aura.ellipse(TILE_SIZE / 2, TILE_SIZE - 7, 19, 5.5).fill({ color: 0xe0b45a, alpha: 0.16 });
      root.addChild(aura);
    }
    let hpBar: Graphics | null = null;
    if (entity.kind === "monster") {
      hpBar = new Graphics();
      root.addChild(hpBar);
    }
    root.x = entity.pos.x * TILE_SIZE;
    root.y = entity.pos.y * TILE_SIZE;
    return {
      id: entity.id,
      kind: entity.kind,
      root,
      sprite,
      baseScale: { x: sprite.scale.x, y: sprite.scale.y },
      phase: hashPhase(entity.id),
      hpBar,
      from: { ...entity.pos },
      to: { ...entity.pos },
      moveStart: this.clock,
      moveDuration: 0,
      flashUntil: 0,
      lunge: null,
      dazed: false,
      mood: null,
      badge: null,
    };
  }

  private currentTilePos(view: EntityView): Point {
    return { x: view.root.x / TILE_SIZE, y: view.root.y / TILE_SIZE };
  }

  private playEvents(state: GameState, events: VisualEvent[]): void {
    for (const event of events) {
      if (event.kind === "statusFx") {
        if (state.tiles[event.pos.y * state.width + event.pos.x]?.visible) this.spawnSheetEffect(event.effect, event.pos);
        continue;
      }
      if (event.kind === "strike") {
        const attacker = this.views.get(event.attackerId);
        const dx = Math.sign(event.to.x - event.from.x);
        const dy = Math.sign(event.to.y - event.from.y);
        if (event.ranged) {
          const content = state.entities.find((entity) => entity.id === event.attackerId)?.contentId;
          const fire = content && ["monster.blackstone-hexer", "monster.ember-hound", "monster.cinder-cultist", "monster.ash-warlock"].includes(content);
          const from = state.tiles[event.from.y * state.width + event.from.x]?.visible ? event.from : event.to;
          if (state.tiles[event.to.y * state.width + event.to.x]?.visible) {
            if (fire) this.spawnSheetEffect("ember-bolt", from, event.to);
            else this.spawnProjectile(from, event.to, event.attackerId === state.playerId);
          }
        } else if (attacker) {
          attacker.lunge = { dx, dy, start: this.clock };
          this.spawnSlash(event.from, event.to, event.attackerId === state.playerId);
        }
      } else if (event.kind === "damage") {
        const view = this.views.get(event.entityId);
        if (view) view.flashUntil = this.clock + 170;
        this.spawnSparks(event.pos, event.isPlayer ? 0xff6a50 : 0xffd08a, event.isPlayer ? 10 : 8);
        this.spawnFloatingText(`-${event.amount}`, event.pos, event.isPlayer ? "#ff7b6b" : "#f4d9a6", event.isPlayer ? 30 : 24);
        if (event.isPlayer) {
          this.flashUntil = this.clock + 200;
          this.shake = { amount: Math.min(9, 3 + event.amount), until: this.clock + 220 };
        }
      } else if (event.kind === "heal") {
        this.spawnFloatingText(`+${event.amount}`, event.pos, "#8fd6a0", event.isPlayer ? 26 : 20);
        this.spawnRisingLight(event.pos, 0x8fe0a8);
        if (state.tiles[event.pos.y * state.width + event.pos.x]?.visible) this.spawnSheetEffect("mending-light", event.pos);
      } else if (event.kind === "levelUp") {
        this.spawnFloatingText(`Lv ${event.level}`, event.pos, "#f0cc7b", 30, 1200);
        this.spawnRing(event.pos, "#f0cc7b");
      } else if (event.kind === "pickup") {
        this.spawnRing(event.pos, "#d4ad62");
        this.spawnSparks(event.pos, 0xf0cc7b, 6, 0.45);
      } else if (event.kind === "death") {
        this.spawnAsh(event.pos);
      }
    }
  }

  /** 全フレーム共通の倍率、80ms/フレーム。描画時計だけを使いゲームの手番を待たせない。 */
  private spawnSheetEffect(effect: string, from: Point, to = from): void {
    const frames = Array.from({ length: 4 }, (_, frame) => this.textures.get(`effect.${effect}.frame-${frame}`));
    if (frames.some((texture) => !texture)) return;
    const sprite = new Sprite(frames[0]!);
    sprite.anchor.set(0.5);
    sprite.width = sprite.height = TILE_SIZE * 0.9;
    sprite.position.set((from.x + 0.5) * TILE_SIZE, (from.y + 0.5) * TILE_SIZE);
    if (effect === "ember-bolt") sprite.rotation = Math.atan2(to.y - from.y, to.x - from.x);
    this.effectLayer.addChild(sprite);
    this.effects.push({ node: sprite, age: 0, life: 320, update: (_effect, progress) => {
      sprite.texture = frames[this.reducedMotion ? 2 : Math.min(3, Math.floor(progress * 4))]!;
      const travel = this.reducedMotion ? 1 : progress;
      sprite.position.set((from.x + 0.5 + (to.x - from.x) * travel) * TILE_SIZE, (from.y + 0.5 + (to.y - from.y) * travel) * TILE_SIZE);
      if (this.reducedMotion) sprite.alpha = 1 - progress;
    } });
  }

  private drawSignals(state: GameState): void {
    for (const child of this.signalLayer.removeChildren()) child.destroy();
    const graphics = new Graphics();
    const visible = (p: Point) => !!state.tiles[p.y * state.width + p.x]?.visible;
    const explored = (p: Point) => !!state.tiles[p.y * state.width + p.x]?.explored;
    const drawSprite = (key: string, p: Point, alpha = 1) => {
      const texture = this.textures.get(key);
      if (!texture) return;
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5);
      sprite.position.set((p.x + 0.5) * TILE_SIZE, (p.y + 0.5) * TILE_SIZE);
      sprite.width = TILE_SIZE * 0.75;
      sprite.height = TILE_SIZE * 0.75;
      sprite.alpha = alpha;
      this.signalLayer.addChild(sprite);
    };
    for (const lamp of state.expedition?.lights ?? []) if (explored(lamp.pos)) drawSprite("rite.place", lamp.pos);
    for (const vent of state.expedition?.heat ?? []) {
      if (!explored(vent.pos)) continue;
      drawSprite("terrain.furnace-vent", vent.pos, vent.active ? 1 : 0.55);
      if (visible(vent.pos) && (vent.active || vent.remaining <= realtimeConfig().laws.furnaceWindup)) {
        graphics.rect(vent.pos.x * TILE_SIZE + 3, vent.pos.y * TILE_SIZE + 3, TILE_SIZE - 6, TILE_SIZE - 6).fill({ color: 0xd46635, alpha: 0.18 }).stroke({ color: 0xe89b58, width: 2, alpha: 0.8 });
      }
    }
    for (const enemy of state.entities) {
      if (enemy.kind !== "monster" || !visible(enemy.pos)) continue;
      for (const p of enemy.telegraph?.tiles ?? []) {
        if (!visible(p)) continue;
        graphics.rect(p.x * TILE_SIZE + 4, p.y * TILE_SIZE + 4, TILE_SIZE - 8, TILE_SIZE - 8).fill({ color: 0xaf493e, alpha: 0.17 }).stroke({ color: 0xe2a084, width: 2, alpha: 0.8 });
        const count = new Text({ text: String(enemy.telegraph!.remaining), style: { fontFamily: "sans-serif", fontSize: 14, fontWeight: "bold", fill: 0xffd5b6 } });
        count.position.set(p.x * TILE_SIZE + 8, p.y * TILE_SIZE + 5);
        this.signalLayer.addChild(count);
      }
      if ((enemy.recoveryTurns ?? 0) > 0) graphics.circle((enemy.pos.x + 0.5) * TILE_SIZE, (enemy.pos.y + 0.5) * TILE_SIZE, TILE_SIZE * 0.42).stroke({ color: 0x9bc6ab, width: 2, alpha: 0.8 });
    }
    for (const grave of state.entities.filter((e) => e.contentId === "event.grave-marker" && visible(e.pos))) {
      if (state.modifiers.graves?.some((g) => grave.id.endsWith(g.id) && g.echoes?.length)) drawSprite("effect.echo", grave.pos, 0.42);
    }
    this.signalLayer.addChildAt(graphics, 0);
  }

  private showIntent(intent: RenderIntent): void {
    if (this.bubble && this.bubbleText === intent.text && this.bubbleAge < realtimeConfig().dialogue.holdMs) {
      return;
    }
    if (this.bubble) this.bubble.destroy({ children: true });
    const palette: Record<RenderIntent["tone"], string> = {
      combat: "#e08a6a",
      survival: "#9fd0a8",
      loot: "#f0cc7b",
      explore: "#d8cfbd",
      descend: "#a9c2e8",
    };
    const bubble = new Container();
    const label = new Text({
      text: intent.text,
      style: {
        fill: palette[intent.tone],
        fontFamily: "Shippori Mincho B1, Hiragino Mincho ProN, serif",
        fontSize: 16,
        fontWeight: "700",
        letterSpacing: 1.5,
      },
    });
    label.anchor.set(0.5);
    const width = label.width + 28;
    const background = new Graphics();
    // 細い金の罫と小さな菱形で、吹き出しを札のように見せる。
    background.rect(-width / 2, -15, width, 30).fill({ color: "#0d0a08", alpha: 0.84 });
    background.moveTo(-width / 2, -15).lineTo(width / 2, -15).stroke({ color: palette[intent.tone], width: 1, alpha: 0.55 });
    background.moveTo(-width / 2, 15).lineTo(width / 2, 15).stroke({ color: palette[intent.tone], width: 1, alpha: 0.55 });
    background.poly([-width / 2 - 5, 0, -width / 2, -5, -width / 2 + 5, 0, -width / 2, 5]).fill({ color: palette[intent.tone], alpha: 0.8 });
    background.poly([width / 2 - 5, 0, width / 2, -5, width / 2 + 5, 0, width / 2, 5]).fill({ color: palette[intent.tone], alpha: 0.8 });
    bubble.addChild(background, label);
    this.effectLayer.addChild(bubble);
    this.bubble = bubble;
    this.bubbleText = intent.text;
    this.bubbleAge = 0;
  }

  private update(deltaMs: number): void {
    this.clock += deltaMs;
    this.paintMemoryShade(this.reducedMotion ? MEMORY_SHADE_FADE_MS : deltaMs);
    for (const view of this.views.values()) {
      const progress = view.moveDuration <= 0 ? 1 : clamp((this.clock - view.moveStart) / view.moveDuration, 0, 1);
      const eased = 1 - (1 - progress) ** 3;
      let x = view.from.x + (view.to.x - view.from.x) * eased;
      let y = view.from.y + (view.to.y - view.from.y) * eased;
      if (view.lunge) {
        const lungeProgress = (this.clock - view.lunge.start) / 180;
        if (lungeProgress >= 1) {
          view.lunge = null;
        } else {
          const push = Math.sin(Math.PI * lungeProgress) * 0.28;
          x += view.lunge.dx * push;
          y += view.lunge.dy * push;
        }
      }
      view.root.x = x * TILE_SIZE;
      view.root.y = y * TILE_SIZE;
      if (!this.reducedMotion) {
        // 歩く時は小さく弾み、止まっている時はわずかに呼吸する。品物は床の上でゆっくり浮き沈みする。
        const hop = progress < 1 ? Math.sin(Math.PI * progress) * 4 : 0;
        if (view.kind === "item") {
          view.sprite.y = TILE_SIZE - 2 - (Math.sin(this.clock / 640 + view.phase) + 1) * 1.6;
        } else if (view.kind === "player" || view.kind === "monster") {
          const breath = Math.sin(this.clock / 520 + view.phase) * 0.018;
          view.sprite.y = TILE_SIZE - hop;
          view.sprite.scale.set(view.baseScale.x * (1 - breath * 0.5), view.baseScale.y * (1 + breath));
        }
      }
      if (view.sprite.tint !== 0x6f6660) {
        const moodTint = view.mood === "dormant" ? 0x8c8272 : view.mood === "asleep" ? 0xc4cadb : view.mood === "exposed" ? 0xffc2a0 : 0xffffff;
        view.sprite.tint = this.clock < view.flashUntil ? 0xff8a78 : view.dazed ? 0x9fb4ff : moodTint;
        view.sprite.alpha = view.dazed ? 0.72 + Math.sin(this.clock / 120) * 0.12 : view.mood === "dormant" ? 0.78 : 1;
        if (view.mood === "dormant") view.sprite.scale.set(view.baseScale.x * 1.05, view.baseScale.y * 0.62);
        if (view.badge && !this.reducedMotion && view.mood === "asleep") view.badge.y = 14 - (Math.sin(this.clock / 700 + view.phase) + 1) * 2;
      }
    }

    const follow = 1 - Math.exp(-deltaMs / 110);
    this.camera.x += (this.cameraTarget.x - this.camera.x) * follow;
    this.camera.y += (this.cameraTarget.y - this.camera.y) * follow;
    let shakeX = 0;
    let shakeY = 0;
    if (this.clock < this.shake.until) {
      const strength = this.shake.amount * ((this.shake.until - this.clock) / 220);
      shakeX = (Math.random() - 0.5) * strength;
      shakeY = (Math.random() - 0.5) * strength;
    }
    this.world.x = Math.round(-this.camera.x + shakeX);
    this.world.y = Math.round(-this.camera.y + shakeY);

    for (let index = this.effects.length - 1; index >= 0; index -= 1) {
      const effect = this.effects[index];
      effect.age += deltaMs;
      const progress = effect.age / effect.life;
      if (progress >= 1) {
        effect.node.destroy({ children: true });
        this.effects.splice(index, 1);
        continue;
      }
      effect.update(effect, progress);
    }

    const playerView = this.views.get(this.playerId);
    if (this.bubble) {
      this.bubbleAge += deltaMs;
      if (playerView) {
        this.bubble.x = playerView.root.x + TILE_SIZE / 2;
        this.bubble.y = playerView.root.y - 34;
      }
      const hold = realtimeConfig().dialogue.holdMs;
      this.bubble.alpha = this.bubbleAge < hold ? Math.min(1, this.bubbleAge / 120) : Math.max(0, 1 - (this.bubbleAge - hold) / 400);
      if (this.bubbleAge > hold + 400) {
        this.bubble.destroy({ children: true });
        this.bubble = null;
        this.bubbleText = "";
      }
    }

    this.currentLight += (this.lightStrength - this.currentLight) * (1 - Math.exp(-deltaMs / 400));
    // 炎の揺らぎ。周期の違うゆっくりした揺れを重ね、規則的にもちらつきにも見えないようにする。
    const flame = this.reducedMotion ? 0 : Math.sin(this.clock / 610) * 0.5 + Math.sin(this.clock / 1370 + 1.3) * 0.3 + Math.sin(this.clock / 337 + 0.4) * 0.2;
    if (this.lightSprite && playerView) {
      this.lightSprite.x = playerView.root.x + TILE_SIZE / 2 + this.world.x;
      this.lightSprite.y = playerView.root.y + TILE_SIZE / 2 + this.world.y;
      this.lightSprite.scale.set((0.72 + this.currentLight * 0.4) * (1 + flame * 0.008));
    }
    if (this.glowSprite && playerView) {
      const atmosphere = BIOME_ATMOSPHERE[this.biome];
      this.glowSprite.tint = atmosphere.glow;
      this.glowSprite.x = playerView.root.x + TILE_SIZE / 2 + this.world.x;
      this.glowSprite.y = playerView.root.y + TILE_SIZE * 0.42 + this.world.y;
      this.glowSprite.scale.set((0.95 + this.currentLight * 0.55) * (1 + flame * 0.012));
      // 加算光は床を白く飛ばしやすいので控えめにし、揺らぎも明るさの数%に留める。
      this.glowSprite.alpha = (0.11 + this.currentLight * 0.13) * (1 + flame * 0.04);
    }
    this.updateMotes(deltaMs, playerView);

    this.flashOverlay.clear();
    if (this.clock < this.flashUntil) {
      // 被弾の赤み。画面全体が点滅して見えないよう、薄く短くする。
      this.flashOverlay.rect(0, 0, this.viewWidth, this.viewHeight).fill({ color: "#8a1a10", alpha: 0.11 * ((this.flashUntil - this.clock) / 200) });
    }
    this.fadeOverlay.clear();
    if (this.clock < this.fadeUntil) {
      this.fadeOverlay.rect(0, 0, this.viewWidth, this.viewHeight).fill({ color: "#000000", alpha: (this.fadeUntil - this.clock) / 520 });
    }
  }

  /** 灯の届く範囲を漂う灰や火の粉。灯から遠い粒ほど闇に沈む。 */
  private updateMotes(deltaMs: number, playerView: EntityView | undefined): void {
    if (this.reducedMotion || !playerView) return;
    const atmosphere = BIOME_ATMOSPHERE[this.biome];
    const cx = playerView.root.x + TILE_SIZE / 2;
    const cy = playerView.root.y + TILE_SIZE / 2;
    const radius = TILE_SIZE * 6;
    while (this.motes.length < MOTE_COUNT) {
      const sprite = new Sprite(this.dotTexture);
      sprite.anchor.set(0.5);
      sprite.blendMode = "add";
      this.moteLayer.addChild(sprite);
      const mote: Mote = { sprite, x: 0, y: 0, vx: 0, vy: 0, phase: 0, age: 0, life: 0 };
      this.respawnMote(mote, cx, cy, radius, true);
      this.motes.push(mote);
    }
    const seconds = deltaMs / 1000;
    for (const mote of this.motes) {
      mote.age += deltaMs;
      if (mote.age >= mote.life) this.respawnMote(mote, cx, cy, radius, false);
      mote.x += (mote.vx + Math.sin(this.clock / 900 + mote.phase) * atmosphere.drift) * seconds;
      mote.y += mote.vy * seconds;
      const distance = Math.hypot(mote.x - cx, mote.y - cy) / radius;
      const lit = clamp(1 - distance, 0, 1);
      const lifeFade = Math.min(1, mote.age / 600, (mote.life - mote.age) / 900);
      const twinkle = 0.8 + Math.sin(this.clock / 640 + mote.phase * 7) * 0.2;
      mote.sprite.tint = atmosphere.mote;
      mote.sprite.x = mote.x;
      mote.sprite.y = mote.y;
      mote.sprite.alpha = clamp(lit * lifeFade * twinkle * (0.55 + this.currentLight * 0.45) * atmosphere.brightness, 0, 0.6);
    }
  }

  private respawnMote(mote: Mote, cx: number, cy: number, radius: number, anywhere: boolean): void {
    const atmosphere = BIOME_ATMOSPHERE[this.biome];
    const angle = Math.random() * Math.PI * 2;
    // 灯の近くに寄せて湧かせ、見える粒を増やす。
    const distance = Math.random() ** 0.8 * radius * 0.9;
    mote.x = cx + Math.cos(angle) * distance;
    mote.y = cy + Math.sin(angle) * distance + (anywhere ? 0 : radius * 0.25);
    mote.vx = (Math.random() - 0.5) * 6;
    mote.vy = -(atmosphere.rise * (0.5 + Math.random()));
    mote.phase = Math.random() * Math.PI * 2;
    mote.age = anywhere ? Math.random() * 3000 : 0;
    mote.life = 4200 + Math.random() * 5200;
    const size = (0.1 + Math.random() * 0.17) * atmosphere.size;
    mote.sprite.scale.set(size);
  }

  private addEffect(effect: Omit<Effect, "age">): void {
    this.effectLayer.addChild(effect.node);
    this.effects.push({ ...effect, age: 0 });
  }

  /** 打撃の火花。重力で落ちながら消える小さな光の粒。 */
  private spawnSparks(pos: Point, color: number, count: number, spread = 1): void {
    const cx = pos.x * TILE_SIZE + TILE_SIZE / 2;
    const cy = pos.y * TILE_SIZE + TILE_SIZE * 0.45;
    const amount = this.reducedMotion ? Math.ceil(count / 3) : count;
    for (let index = 0; index < amount; index += 1) {
      const sprite = new Sprite(this.dotTexture);
      sprite.anchor.set(0.5);
      sprite.blendMode = "add";
      sprite.tint = color;
      const angle = Math.random() * Math.PI * 2;
      const speed = (90 + Math.random() * 170) * spread;
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed - 60;
      const size = 0.12 + Math.random() * 0.18;
      this.addEffect({
        node: sprite,
        life: 320 + Math.random() * 260,
        update: (effect, progress) => {
          const t = effect.age / 1000;
          effect.node.x = cx + vx * t;
          effect.node.y = cy + vy * t + 420 * t * t;
          effect.node.alpha = 1 - progress;
          effect.node.scale.set(size * (1 - progress * 0.6));
        },
      });
    }
  }

  /** 倒れた敵が灰になって昇っていく。 */
  private spawnAsh(pos: Point): void {
    const cx = pos.x * TILE_SIZE + TILE_SIZE / 2;
    const cy = pos.y * TILE_SIZE + TILE_SIZE * 0.6;
    const amount = this.reducedMotion ? 4 : 18;
    for (let index = 0; index < amount; index += 1) {
      const sprite = new Sprite(this.dotTexture);
      sprite.anchor.set(0.5);
      const ember = index % 4 === 0;
      sprite.blendMode = ember ? "add" : "normal";
      sprite.tint = ember ? 0xff9a4a : 0x3a332d;
      const ox = (Math.random() - 0.5) * TILE_SIZE * 0.6;
      const oy = (Math.random() - 0.5) * TILE_SIZE * 0.5;
      const rise = 26 + Math.random() * 46;
      const sway = (Math.random() - 0.5) * 30;
      const size = 0.16 + Math.random() * 0.22;
      this.addEffect({
        node: sprite,
        life: 700 + Math.random() * 600,
        update: (effect, progress) => {
          effect.node.x = cx + ox + sway * progress;
          effect.node.y = cy + oy - rise * (1 - (1 - progress) ** 2);
          effect.node.alpha = (1 - progress) * (ember ? 1 : 0.85);
          effect.node.scale.set(size * (1 + progress * 0.5));
        },
      });
    }
  }

  /** 回復の光。足元から細かな光が立ち昇る。 */
  private spawnRisingLight(pos: Point, color: number): void {
    const amount = this.reducedMotion ? 3 : 12;
    for (let index = 0; index < amount; index += 1) {
      const sprite = new Sprite(this.dotTexture);
      sprite.anchor.set(0.5);
      sprite.blendMode = "add";
      sprite.tint = color;
      const x = pos.x * TILE_SIZE + TILE_SIZE / 2 + (Math.random() - 0.5) * TILE_SIZE * 0.7;
      const y = pos.y * TILE_SIZE + TILE_SIZE * 0.85;
      const rise = 34 + Math.random() * 30;
      const delay = Math.random() * 0.35;
      const size = 0.12 + Math.random() * 0.14;
      sprite.alpha = 0;
      this.addEffect({
        node: sprite,
        life: 900,
        update: (effect, progress) => {
          const local = clamp((progress - delay) / (1 - delay), 0, 1);
          effect.node.x = x;
          effect.node.y = y - rise * local;
          effect.node.alpha = local <= 0 ? 0 : Math.sin(Math.PI * local);
          effect.node.scale.set(size);
        },
      });
    }
  }

  /** 近接攻撃の斬撃の弧。攻撃の向きに合わせて一瞬だけ描く。 */
  private spawnSlash(from: Point, to: Point, byPlayer: boolean): void {
    const node = new Graphics();
    const cx = to.x * TILE_SIZE + TILE_SIZE / 2;
    const cy = to.y * TILE_SIZE + TILE_SIZE / 2;
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const color = byPlayer ? 0xfff0c8 : 0xff7a5c;
    node.blendMode = "add";
    this.addEffect({
      node,
      life: 200,
      update: (effect, progress) => {
        const graphic = effect.node as Graphics;
        const sweep = Math.min(1, progress * 1.8);
        const start = angle - Math.PI * 0.75 + Math.PI * 0.2 * sweep;
        const end = start + Math.PI * 0.9 * sweep;
        graphic.clear();
        graphic.arc(cx - Math.cos(angle) * 14, cy - Math.sin(angle) * 14, 26, start, end).stroke({ color, width: 4 * (1 - progress) + 1, alpha: 0.9 * (1 - progress) });
      },
    });
  }

  private spawnFloatingText(value: string, pos: Point, color: string, size: number, life = 850): void {
    const label = new Text({
      text: value,
      style: {
        fill: color,
        fontFamily: "Hiragino Sans, Yu Gothic, system-ui, sans-serif",
        fontSize: size,
        fontWeight: "800",
        stroke: { color: "#0a0706", width: 5 },
      },
    });
    label.anchor.set(0.5);
    const baseX = pos.x * TILE_SIZE + TILE_SIZE / 2 + (Math.random() - 0.5) * 14;
    const baseY = pos.y * TILE_SIZE + 20;
    label.x = baseX;
    label.y = baseY;
    this.addEffect({
      node: label,
      life,
      update: (effect, progress) => {
        effect.node.y = baseY - 26 * (1 - (1 - progress) ** 2);
        effect.node.alpha = progress < 0.7 ? 1 : 1 - (progress - 0.7) / 0.3;
        effect.node.scale.set(progress < 0.12 ? 0.7 + progress * 2.5 : 1);
      },
    });
  }

  private spawnProjectile(from: Point, to: Point, byPlayer: boolean): void {
    const color = byPlayer ? "#f3b35c" : "#ff6a3d";
    const node = new Graphics();
    const fromPx = { x: from.x * TILE_SIZE + TILE_SIZE / 2, y: from.y * TILE_SIZE + TILE_SIZE / 2 };
    const toPx = { x: to.x * TILE_SIZE + TILE_SIZE / 2, y: to.y * TILE_SIZE + TILE_SIZE / 2 };
    this.addEffect({
      node,
      life: 240,
      update: (effect, progress) => {
        const graphic = effect.node as Graphics;
        const head = Math.min(1, progress * 1.35);
        const tail = Math.max(0, head - 0.35);
        const hx = fromPx.x + (toPx.x - fromPx.x) * head;
        const hy = fromPx.y + (toPx.y - fromPx.y) * head;
        const tx = fromPx.x + (toPx.x - fromPx.x) * tail;
        const ty = fromPx.y + (toPx.y - fromPx.y) * tail;
        graphic.clear();
        graphic.moveTo(tx, ty).lineTo(hx, hy).stroke({ color, width: 3, alpha: 0.85 });
        graphic.circle(hx, hy, 4.5).fill({ color: "#fff1c4", alpha: head >= 1 ? 1 - progress : 1 });
      },
    });
  }

  private spawnRing(pos: Point, color: string): void {
    const node = new Graphics();
    const cx = pos.x * TILE_SIZE + TILE_SIZE / 2;
    const cy = pos.y * TILE_SIZE + TILE_SIZE / 2;
    this.addEffect({
      node,
      life: 520,
      update: (effect, progress) => {
        const graphic = effect.node as Graphics;
        graphic.clear();
        graphic.circle(cx, cy, 10 + progress * 28).stroke({ color, width: 3, alpha: 1 - progress });
      },
    });
  }

  private spawnDeathGhost(view: EntityView): void {
    view.lunge = null;
    view.sprite.tint = 0xff5a44;
    if (view.hpBar) view.hpBar.visible = false;
    const baseY = view.root.y;
    this.addEffect({
      node: view.root,
      life: 420,
      update: (effect, progress) => {
        effect.node.alpha = 1 - progress;
        effect.node.y = baseY + progress * 10;
      },
    });
  }

  private async buildTextures(): Promise<void> {
    this.textures.set("void", this.makeTile("#050504"));
    this.textures.set("trap.risk-panel", await this.loadTexture("/assets/sprites/fate-sigil-tile.png"));
    for (const [id, asset] of Object.entries(assetCatalog)) {
      this.textures.set(id, await this.loadSheetFrame(asset.path, asset.sheet.columns, asset.sheet.rows, asset.sheet.index));
    }
  }

  private async loadSheetFrame(path: string, columns: number, rows: number, index: number): Promise<Texture> {
    const sheet = await Assets.load<Texture>(publicAssetPath(path));
    const cellWidth = Math.floor(sheet.width / columns);
    const cellHeight = Math.floor(sheet.height / rows);
    const x = (index % columns) * cellWidth;
    const y = Math.floor(index / columns) * cellHeight;
    return new Texture({
      source: sheet.source,
      frame: new Rectangle(x, y, cellWidth, cellHeight),
    });
  }

  private async loadTexture(path: string): Promise<Texture> {
    return await Assets.load<Texture>(publicAssetPath(path));
  }

  private addTileSprite(key: TextureKey, x: number, y: number): void {
    const texture = this.textures.get(key) ?? this.textures.get("void");
    if (!texture) {
      return;
    }
    const sprite = new Sprite(texture);
    sprite.x = x * TILE_SIZE;
    sprite.y = y * TILE_SIZE;
    sprite.width = TILE_SIZE;
    sprite.height = TILE_SIZE;
    this.terrainLayer.addChild(sprite);
  }

  private playerTextureKey(entity: Entity): TextureKey {
    const facing = this.updateCharacterFacing(entity);
    const defaultKey = assetIdForContent(entity.contentId);
    const directionalKey = defaultKey.replace(/\.(southwest|southeast|northwest|northeast|south|north|east|west)$/, `.${facing}`);
    return this.textures.has(directionalKey) ? directionalKey : defaultKey;
  }

  private updateCharacterFacing(entity: Entity): Direction {
    const lastPos = this.characterLastPos.get(entity.id);
    const lastContentId = this.characterLastContentId.get(entity.id);
    let facing = this.characterFacing.get(entity.id) ?? "south";
    if (lastContentId && lastContentId !== entity.contentId) {
      facing = "south";
    } else if (lastPos) {
      const dx = entity.pos.x - lastPos.x;
      const dy = entity.pos.y - lastPos.y;
      facing = facingAfterStep(dx, dy, facing);
    }
    this.characterFacing.set(entity.id, facing);
    this.characterLastPos.set(entity.id, { ...entity.pos });
    this.characterLastContentId.set(entity.id, entity.contentId);
    return facing;
  }

  private drawWallEdges(edge: Graphics, state: GameState, x: number, y: number): void {
    const sides = [
      { dx: 0, dy: -1, sx: 0, sy: 0, w: TILE_SIZE, h: 2 },
      { dx: 0, dy: 1, sx: 0, sy: TILE_SIZE - 3, w: TILE_SIZE, h: 3 },
      { dx: -1, dy: 0, sx: 0, sy: 0, w: 2, h: TILE_SIZE },
      { dx: 1, dy: 0, sx: TILE_SIZE - 2, sy: 0, w: 2, h: TILE_SIZE },
    ];
    for (const side of sides) {
      const nx = x + side.dx;
      const ny = y + side.dy;
      if (nx < 0 || ny < 0 || nx >= state.width || ny >= state.height) continue;
      const neighbor = state.tiles[ny * state.width + nx];
      // Outline only known walkable ground: hidden neighbors must not leak map information.
      if (!(neighbor.explored || neighbor.visible) || neighbor.kind === "wall" || neighbor.kind === "void") continue;
      edge.rect(x * TILE_SIZE + side.sx, y * TILE_SIZE + side.sy, side.w, side.h);
    }
    edge.fill({ color: "#8b8271", alpha: 0.48 });
  }

  /** 蝋燭の暖かい照り返し。加算合成で、探索者の周りの石だけをわずかに温める。 */
  private makeGlowTexture(): Texture {
    return makeCanvasTexture(512, (context, size) => {
      const center = size / 2;
      const gradient = context.createRadialGradient(center, center, 0, center, center, center);
      gradient.addColorStop(0, "rgba(255,255,255,0.62)");
      gradient.addColorStop(0.18, "rgba(255,255,255,0.32)");
      gradient.addColorStop(0.45, "rgba(255,255,255,0.1)");
      gradient.addColorStop(0.75, "rgba(255,255,255,0.025)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, size, size);
    });
  }

  private makeTile(fill: string): Texture {
    const graphic = new Graphics();
    graphic.rect(0, 0, TILE_SIZE, TILE_SIZE).fill(fill);
    return this.app.renderer.generateTexture(graphic);
  }

  /** 探索者を中心に、灯の届く範囲だけを温かく残す光の覆い。 */
  private makeLightTexture(): Texture {
    const size = 2048;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) return Texture.EMPTY;
    const center = size / 2;
    const gradient = context.createRadialGradient(center, center, 0, center, center, center);
    // 視界半径（約9マス）の内側はほぼ素通しにし、外側だけを沈める。
    gradient.addColorStop(0, "rgba(255, 190, 110, 0.08)");
    gradient.addColorStop(0.2, "rgba(255, 170, 90, 0.03)");
    gradient.addColorStop(0.34, "rgba(10, 7, 5, 0.04)");
    gradient.addColorStop(0.52, "rgba(6, 4, 3, 0.22)");
    gradient.addColorStop(0.72, "rgba(3, 2, 2, 0.5)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0.72)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    return Texture.from(canvas);
  }
}

/** 小さなcanvasに描いた質感をテクスチャにする。光・影・霧などの柔らかい階調に使う。 */
function makeCanvasTexture(size: number, paint: (context: CanvasRenderingContext2D, size: number) => void): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return Texture.EMPTY;
  paint(context, size);
  return Texture.from(canvas);
}

function drawHpBar(bar: Graphics, ratio: number, color: string): void {
  const width = Math.max(4, Math.floor(clamp(ratio, 0, 1) * 46));
  bar.clear();
  bar.rect(9, 55, 46, 5).fill("#1a0d0b");
  bar.rect(9, 55, width, 5).fill(color);
}

function cameraTargetFor(state: GameState, center: Point, viewWidth: number, viewHeight: number): Point {
  return {
    x: clamp((center.x + 0.5) * TILE_SIZE - viewWidth / 2, 0, Math.max(0, state.width * TILE_SIZE - viewWidth)),
    y: clamp((center.y + 0.5) * TILE_SIZE - viewHeight / 2, 0, Math.max(0, state.height * TILE_SIZE - viewHeight)),
  };
}

function hashPhase(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) | 0;
  return (Math.abs(hash) % 1000) / 1000 * Math.PI * 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function tileTextureKey(kind: TileKind, biome: BiomeTheme): string {
  if (kind === "void") {
    return "void";
  }
  if (kind === "floor" || kind === "wall" || kind === "cover") {
    return `${kind}:${biome}`;
  }
  return `${kind}:visible`;
}
