import { Application, Assets, Container, Graphics, Rectangle, Sprite, Text, Texture } from "pixi.js";
import { assetCatalog, assetIdForContent } from "../content/assets";
import { facingAfterStep } from "./characterFacing";
import type { VisualEvent } from "../core/visualEvents";
import type { BiomeTheme, Direction, Entity, GameState, Point, TileKind } from "../types";

const TILE_SIZE = 64;
const MEMORY_SHADE_ALPHA = 0.46;

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
  hpBar: Graphics | null;
  from: Point;
  to: Point;
  moveStart: number;
  moveDuration: number;
  flashUntil: number;
  lunge: { dx: number; dy: number; start: number } | null;
  dazed: boolean;
};

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
  private readonly actorLayer = new Container();
  private readonly effectLayer = new Container();
  private readonly overlayLayer = new Container();
  private readonly textures = new Map<TextureKey, Texture>();
  private readonly characterFacing = new Map<string, Direction>();
  private readonly characterLastPos = new Map<string, Point>();
  private readonly characterLastContentId = new Map<string, string>();
  private readonly views = new Map<string, EntityView>();
  private readonly effects: Effect[] = [];
  private lightSprite: Sprite | null = null;
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
    this.world.addChild(this.terrainLayer, this.groundLayer, this.actorLayer, this.effectLayer);
    this.app.stage.addChild(this.world, this.overlayLayer);
    container.replaceChildren(this.app.canvas);
    await this.buildTextures();
    this.lightSprite = new Sprite(this.makeLightTexture());
    this.lightSprite.anchor.set(0.5);
    this.overlayLayer.addChild(this.lightSprite, this.flashOverlay, this.fadeOverlay);
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
    this.lightStrength = clamp(options.lightStrength ?? 1, 0, 1);

    const player = state.entities.find((entity) => entity.id === state.playerId);
    this.cameraTarget = cameraTargetFor(state, player?.pos ?? { x: 0, y: 0 }, this.viewWidth, this.viewHeight);
    if (sceneChanged) {
      this.camera = { ...this.cameraTarget };
    }

    this.drawTerrain(state);
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
    if (this.bubble) {
      this.bubble.destroy({ children: true });
      this.bubble = null;
      this.bubbleText = "";
    }
  }

  private drawTerrain(state: GameState): void {
    for (const child of this.terrainLayer.removeChildren()) child.destroy();
    const minX = Math.max(0, Math.floor(Math.min(this.camera.x, this.cameraTarget.x) / TILE_SIZE) - 1);
    const minY = Math.max(0, Math.floor(Math.min(this.camera.y, this.cameraTarget.y) / TILE_SIZE) - 1);
    const maxX = Math.min(state.width - 1, Math.ceil((Math.max(this.camera.x, this.cameraTarget.x) + this.viewWidth) / TILE_SIZE) + 1);
    const maxY = Math.min(state.height - 1, Math.ceil((Math.max(this.camera.y, this.cameraTarget.y) + this.viewHeight) / TILE_SIZE) + 1);
    const shade = new Graphics();
    const edges = new Graphics();
    const voids = new Graphics();
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const tile = state.tiles[y * state.width + x];
        if (!tile.explored && !tile.visible) {
          voids.rect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
          continue;
        }
        if (tile.kind === "cover" || tile.kind === "stairsDown") {
          this.addTileSprite(`floor:${state.biome}`, x, y);
        }
        this.addTileSprite(tileTextureKey(tile.kind, state.biome), x, y);
        if (tile.kind === "wall") this.drawWallEdges(edges, state, x, y);
        if (!tile.visible) {
          // 探索済みの記憶は地形を残したまま沈め、現在視界と見分けられるようにする。
          shade.rect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }
      }
    }
    voids.fill("#010101");
    shade.fill({ color: "#07060a", alpha: MEMORY_SHADE_ALPHA });
    this.terrainLayer.addChild(voids, edges, shade);
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
      const key = entity.kind === "player" ? this.playerTextureKey(entity) : entity.kind === "trap" ? "trap.risk-panel" : assetIdForContent(entity.contentId);
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

  private createView(entity: Entity, key: TextureKey): EntityView {
    const root = new Container();
    const sprite = new Sprite(this.textures.get(key) ?? Texture.EMPTY);
    sprite.width = TILE_SIZE;
    sprite.height = TILE_SIZE;
    root.addChild(sprite);
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
      hpBar,
      from: { ...entity.pos },
      to: { ...entity.pos },
      moveStart: this.clock,
      moveDuration: 0,
      flashUntil: 0,
      lunge: null,
      dazed: false,
    };
  }

  private currentTilePos(view: EntityView): Point {
    return { x: view.root.x / TILE_SIZE, y: view.root.y / TILE_SIZE };
  }

  private playEvents(state: GameState, events: VisualEvent[]): void {
    for (const event of events) {
      if (event.kind === "strike") {
        const attacker = this.views.get(event.attackerId);
        const dx = Math.sign(event.to.x - event.from.x);
        const dy = Math.sign(event.to.y - event.from.y);
        if (event.ranged) {
          this.spawnProjectile(event.from, event.to, event.attackerId === state.playerId);
        } else if (attacker) {
          attacker.lunge = { dx, dy, start: this.clock };
        }
      } else if (event.kind === "damage") {
        const view = this.views.get(event.entityId);
        if (view) view.flashUntil = this.clock + 170;
        this.spawnFloatingText(`-${event.amount}`, event.pos, event.isPlayer ? "#ff7b6b" : "#f4d9a6", event.isPlayer ? 30 : 24);
        if (event.isPlayer) {
          this.flashUntil = this.clock + 200;
          this.shake = { amount: Math.min(9, 3 + event.amount), until: this.clock + 220 };
        }
      } else if (event.kind === "heal") {
        this.spawnFloatingText(`+${event.amount}`, event.pos, "#8fd6a0", event.isPlayer ? 26 : 20);
      } else if (event.kind === "levelUp") {
        this.spawnFloatingText(`Lv ${event.level}`, event.pos, "#f0cc7b", 30, 1200);
        this.spawnRing(event.pos, "#f0cc7b");
      } else if (event.kind === "pickup") {
        this.spawnRing(event.pos, "#d4ad62");
      }
    }
  }

  private showIntent(intent: RenderIntent): void {
    if (this.bubble && this.bubbleText === intent.text && this.bubbleAge < 1400) {
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
        fontFamily: "Hiragino Sans, Yu Gothic, system-ui, sans-serif",
        fontSize: 17,
        fontWeight: "700",
      },
    });
    label.anchor.set(0.5);
    const width = label.width + 22;
    const background = new Graphics();
    background.roundRect(-width / 2, -16, width, 32, 9).fill({ color: "#120f0c", alpha: 0.88 }).stroke({ color: palette[intent.tone], width: 1.5, alpha: 0.7 });
    background.moveTo(-6, 16).lineTo(0, 24).lineTo(6, 16).fill({ color: "#120f0c", alpha: 0.88 });
    bubble.addChild(background, label);
    this.effectLayer.addChild(bubble);
    this.bubble = bubble;
    this.bubbleText = intent.text;
    this.bubbleAge = 0;
  }

  private update(deltaMs: number): void {
    this.clock += deltaMs;
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
      if (view.sprite.tint !== 0x6f6660) {
        view.sprite.tint = this.clock < view.flashUntil ? 0xff8a78 : view.dazed ? 0x9fb4ff : 0xffffff;
        view.sprite.alpha = view.dazed ? 0.72 + Math.sin(this.clock / 120) * 0.12 : 1;
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
        this.bubble.y = playerView.root.y - 16;
      }
      this.bubble.alpha = this.bubbleAge < 1500 ? Math.min(1, this.bubbleAge / 120) : Math.max(0, 1 - (this.bubbleAge - 1500) / 400);
      if (this.bubbleAge > 1900) {
        this.bubble.destroy({ children: true });
        this.bubble = null;
        this.bubbleText = "";
      }
    }

    this.currentLight += (this.lightStrength - this.currentLight) * (1 - Math.exp(-deltaMs / 400));
    if (this.lightSprite && playerView) {
      this.lightSprite.x = playerView.root.x + TILE_SIZE / 2 + this.world.x;
      this.lightSprite.y = playerView.root.y + TILE_SIZE / 2 + this.world.y;
      const flicker = 1 + Math.sin(this.clock / 170) * 0.012 + Math.sin(this.clock / 53) * 0.006;
      this.lightSprite.scale.set((0.72 + this.currentLight * 0.4) * flicker);
    }

    this.flashOverlay.clear();
    if (this.clock < this.flashUntil) {
      this.flashOverlay.rect(0, 0, this.viewWidth, this.viewHeight).fill({ color: "#8a1a10", alpha: 0.2 * ((this.flashUntil - this.clock) / 200) });
    }
    this.fadeOverlay.clear();
    if (this.clock < this.fadeUntil) {
      this.fadeOverlay.rect(0, 0, this.viewWidth, this.viewHeight).fill({ color: "#000000", alpha: (this.fadeUntil - this.clock) / 520 });
    }
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
    const baseY = pos.y * TILE_SIZE + 12;
    label.x = baseX;
    label.y = baseY;
    this.effectLayer.addChild(label);
    this.effects.push({
      node: label,
      age: 0,
      life,
      update: (effect, progress) => {
        effect.node.y = baseY - 34 * (1 - (1 - progress) ** 2);
        effect.node.alpha = progress < 0.7 ? 1 : 1 - (progress - 0.7) / 0.3;
        effect.node.scale.set(progress < 0.12 ? 0.7 + progress * 2.5 : 1);
      },
    });
  }

  private spawnProjectile(from: Point, to: Point, byPlayer: boolean): void {
    const color = byPlayer ? "#f3b35c" : "#ff6a3d";
    const node = new Graphics();
    this.effectLayer.addChild(node);
    const fromPx = { x: from.x * TILE_SIZE + TILE_SIZE / 2, y: from.y * TILE_SIZE + TILE_SIZE / 2 };
    const toPx = { x: to.x * TILE_SIZE + TILE_SIZE / 2, y: to.y * TILE_SIZE + TILE_SIZE / 2 };
    this.effects.push({
      node,
      age: 0,
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
    this.effectLayer.addChild(node);
    this.effects.push({
      node,
      age: 0,
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
    this.effectLayer.addChild(view.root);
    const baseY = view.root.y;
    this.effects.push({
      node: view.root,
      age: 0,
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

function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
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

function publicAssetPath(path: string): string {
  if (!path.startsWith("/")) {
    return path;
  }
  return `${import.meta.env.BASE_URL}${path.slice(1)}`;
}
