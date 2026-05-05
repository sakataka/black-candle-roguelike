import { Application, Assets, Container, Graphics, Rectangle, Sprite, Text, Texture } from "pixi.js";
import { assetCatalog, assetIdForContent } from "../content/assets";
import { getContentName } from "../content/entities";
import type { BiomeTheme, Entity, GameState, TileKind } from "../types";

const TILE_SIZE = 64;
const VIEWPORT_WIDTH = 16;
const VIEWPORT_HEIGHT = 10;

type TextureKey = TileKind | string;
type CharacterFacing = "south" | "north" | "east" | "west";

export class PixiRoguelikeRenderer {
  readonly app = new Application();
  private readonly stageLayer = new Container();
  private readonly textures = new Map<TextureKey, Texture>();
  private readonly characterFacing = new Map<string, CharacterFacing>();
  private readonly characterLastPos = new Map<string, { x: number; y: number }>();
  private readonly characterLastContentId = new Map<string, string>();
  private ready = false;

  async mount(container: HTMLElement): Promise<void> {
    await this.app.init({
      width: VIEWPORT_WIDTH * TILE_SIZE,
      height: VIEWPORT_HEIGHT * TILE_SIZE,
      background: "#080806",
      antialias: false,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });
    this.app.stage.addChild(this.stageLayer);
    container.replaceChildren(this.app.canvas);
    await this.buildTextures();
    this.ready = true;
  }

  render(state: GameState): void {
    if (!this.ready) {
      return;
    }
    this.stageLayer.removeChildren();

    const camera = cameraForState(state);
    for (let vy = 0; vy < VIEWPORT_HEIGHT; vy += 1) {
      for (let vx = 0; vx < VIEWPORT_WIDTH; vx += 1) {
        const x = camera.x + vx;
        const y = camera.y + vy;
        const tile = state.tiles[y * state.width + x];
        if (!tile.explored && !tile.visible) {
          this.drawUnexploredTile(vx, vy);
          continue;
        }
        this.drawSprite(tileTextureKey(tile.kind, state.biome), vx, vy, 1);
      }
    }

    for (const entity of state.entities) {
      const tile = state.tiles[entity.pos.y * state.width + entity.pos.x];
      const shouldDraw = entity.kind === "item" || entity.kind === "trap" || entity.kind === "event" ? tile.explored || tile.visible : tile.visible;
      if (!shouldDraw || !inViewport(entity.pos.x, entity.pos.y, camera)) {
        continue;
      }
      const key = entity.kind === "player" ? this.playerTextureKey(entity) : entity.kind === "trap" ? "trap.risk-panel" : assetIdForContent(entity.contentId);
      this.drawSprite(key, entity.pos.x - camera.x, entity.pos.y - camera.y, 1);
      if (entity.kind === "monster" && entity.stats) {
        this.drawHealthPip(entity, camera);
      }
    }
  }

  destroy(): void {
    this.app.destroy();
  }

  private async buildTextures(): Promise<void> {
    this.textures.set("void", this.makeTile("#050504", "#050504", ""));
    this.textures.set("floor:memory", await this.loadSheetFrame("/assets/sprites/dungeon-terrain-sheet.png", 4, 2, 1));
    this.textures.set("wall:memory", await this.loadSheetFrame("/assets/sprites/dungeon-terrain-sheet.png", 4, 2, 3));
    this.textures.set("floor:visible", await this.loadSheetFrame("/assets/sprites/dungeon-terrain-sheet.png", 4, 2, 0));
    this.textures.set("wall:visible", await this.loadSheetFrame("/assets/sprites/dungeon-terrain-sheet.png", 4, 2, 2));
    this.textures.set("stairsDown:visible", await this.loadSheetFrame("/assets/sprites/dungeon-terrain-sheet.png", 4, 2, 4));
    this.textures.set("stairsDown:memory", await this.loadSheetFrame("/assets/sprites/dungeon-terrain-sheet.png", 4, 2, 4));
    this.textures.set("trap.risk-panel", await this.loadTexture("/assets/sprites/fate-sigil-tile.png"));
    this.textures.set("floor:blackstone", await this.loadSheetFrame("/assets/sprites/dungeon-biomes-sheet.png", 4, 2, 0));
    this.textures.set("wall:blackstone", await this.loadSheetFrame("/assets/sprites/dungeon-biomes-sheet.png", 4, 2, 4));
    this.textures.set("floor:crypt", await this.loadSheetFrame("/assets/sprites/dungeon-biomes-sheet.png", 4, 2, 1));
    this.textures.set("wall:crypt", await this.loadSheetFrame("/assets/sprites/dungeon-biomes-sheet.png", 4, 2, 5));
    this.textures.set("floor:furnace", await this.loadSheetFrame("/assets/sprites/dungeon-biomes-sheet.png", 4, 2, 2));
    this.textures.set("wall:furnace", await this.loadSheetFrame("/assets/sprites/dungeon-biomes-sheet.png", 4, 2, 6));
    this.textures.set("floor:black-candle", await this.loadSheetFrame("/assets/sprites/dungeon-biomes-sheet.png", 4, 2, 3));
    this.textures.set("wall:black-candle", await this.loadSheetFrame("/assets/sprites/dungeon-biomes-sheet.png", 4, 2, 7));
    this.textures.set("cover:blackstone", await this.loadSheetFrame("/assets/sprites/dungeon-cover-sheet.png", 4, 1, 0));
    this.textures.set("cover:crypt", await this.loadSheetFrame("/assets/sprites/dungeon-cover-sheet.png", 4, 1, 1));
    this.textures.set("cover:furnace", await this.loadSheetFrame("/assets/sprites/dungeon-cover-sheet.png", 4, 1, 2));
    this.textures.set("cover:black-candle", await this.loadSheetFrame("/assets/sprites/dungeon-cover-sheet.png", 4, 1, 3));
    for (const asset of Object.values(assetCatalog)) {
      if (!asset.path || !asset.sheet) {
        continue;
      }
      this.textures.set(asset.id, await this.loadSheetFrame(asset.path, asset.sheet.columns, asset.sheet.rows, asset.sheet.index));
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

  private drawSprite(key: TextureKey, x: number, y: number, alpha: number): void {
    const texture = this.textures.get(key) ?? this.textures.get("floor");
    if (!texture) {
      return;
    }
    const sprite = new Sprite(texture);
    sprite.x = x * TILE_SIZE;
    sprite.y = y * TILE_SIZE;
    sprite.width = TILE_SIZE;
    sprite.height = TILE_SIZE;
    sprite.alpha = alpha;
    this.stageLayer.addChild(sprite);
  }

  private playerTextureKey(entity: Entity): TextureKey {
    const facing = this.updateCharacterFacing(entity);
    const defaultKey = assetIdForContent(entity.contentId);
    const directionalKey = defaultKey.replace(/\.(south|north|east|west)$/, `.${facing}`);
    return this.textures.has(directionalKey) ? directionalKey : defaultKey;
  }

  private updateCharacterFacing(entity: Entity): CharacterFacing {
    const lastPos = this.characterLastPos.get(entity.id);
    const lastContentId = this.characterLastContentId.get(entity.id);
    let facing = this.characterFacing.get(entity.id) ?? "south";
    if (lastContentId && lastContentId !== entity.contentId) {
      facing = "south";
    } else if (lastPos) {
      const dx = entity.pos.x - lastPos.x;
      const dy = entity.pos.y - lastPos.y;
      if (Math.abs(dx) + Math.abs(dy) > 1) {
        facing = "south";
      } else if (dx > 0) {
        facing = "east";
      } else if (dx < 0) {
        facing = "west";
      } else if (dy < 0) {
        facing = "north";
      } else if (dy > 0) {
        facing = "south";
      }
    }
    this.characterFacing.set(entity.id, facing);
    this.characterLastPos.set(entity.id, { ...entity.pos });
    this.characterLastContentId.set(entity.id, entity.contentId);
    return facing;
  }

  private drawHealthPip(entity: Entity, camera: { x: number; y: number }): void {
    if (!entity.stats) {
      return;
    }
    const width = Math.max(8, Math.floor((entity.stats.hp / entity.stats.maxHp) * 46));
    const screenX = entity.pos.x - camera.x;
    const screenY = entity.pos.y - camera.y;
    const bar = new Graphics();
    bar.rect(screenX * TILE_SIZE + 9, screenY * TILE_SIZE + 54, 46, 4).fill("#251412");
    bar.rect(screenX * TILE_SIZE + 9, screenY * TILE_SIZE + 54, width, 4).fill("#c75644");
    this.stageLayer.addChild(bar);
  }

  private drawUnexploredTile(x: number, y: number): void {
    const tile = new Graphics();
    tile.rect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE).fill("#010101");
    this.stageLayer.addChild(tile);
  }

  private makeTile(fill: string, stroke: string, label: string): Texture {
    const graphic = new Graphics();
    graphic.rect(0, 0, TILE_SIZE, TILE_SIZE).fill(fill);
    graphic.rect(2, 2, TILE_SIZE - 4, TILE_SIZE - 4).stroke({ color: stroke, width: 2, alpha: 0.6 });
    if (label) {
      graphic.addChild(this.makeText(label, "#f2df9f", 24));
    }
    return this.app.renderer.generateTexture(graphic);
  }

  private makeText(label: string, color: string, size: number): Text {
    const text = new Text({
      text: label,
      style: {
        fill: color,
        fontFamily: "Hiragino Sans, Yu Gothic, system-ui, sans-serif",
        fontSize: size,
        fontWeight: "700",
      },
    });
    text.anchor.set(0.5);
    text.x = TILE_SIZE / 2;
    text.y = TILE_SIZE / 2;
    return text;
  }
}

function cameraForState(state: GameState): { x: number; y: number } {
  const player = state.entities.find((entity) => entity.id === state.playerId);
  const centerX = player?.pos.x ?? 0;
  const centerY = player?.pos.y ?? 0;
  return {
    x: clamp(centerX - Math.floor(VIEWPORT_WIDTH / 2), 0, Math.max(0, state.width - VIEWPORT_WIDTH)),
    y: clamp(centerY - Math.floor(VIEWPORT_HEIGHT / 2), 0, Math.max(0, state.height - VIEWPORT_HEIGHT)),
  };
}

function inViewport(x: number, y: number, camera: { x: number; y: number }): boolean {
  return x >= camera.x && y >= camera.y && x < camera.x + VIEWPORT_WIDTH && y < camera.y + VIEWPORT_HEIGHT;
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

export function describeEntity(entity: Entity): string {
  if (entity.kind === "trap") {
    return getContentName("trap.risk-panel");
  }
  const hp = entity.stats ? ` HP ${entity.stats.hp}/${entity.stats.maxHp}` : "";
  const gold = entity.contentId === "item.coin-pouch" && entity.goldAmount ? ` ${entity.goldAmount} Gold` : "";
  return `${getContentName(entity.contentId)}${hp}${gold}`;
}
