export type Locale = "ja" | "en";

export type Point = {
  x: number;
  y: number;
};

export type Direction = "north" | "south" | "west" | "east" | "northwest" | "northeast" | "southwest" | "southeast";

export type TileKind = "void" | "floor" | "wall" | "cover" | "stairsDown";

export type BiomeTheme = "blackstone" | "crypt" | "furnace" | "black-candle";

export type EntityKind = "player" | "monster" | "item" | "event" | "trap";

export type TrapKind = "blood-needle" | "venom-mist" | "crumbling-floor";

export type EnemyFamily = "beast" | "undead" | "cult" | "demon" | "construct";

export type CombatRole = "melee" | "ranged" | "caster" | "skirmisher" | "boss";

export type Tier = "early" | "mid" | "late" | "boss";

export type MerchantServiceId = "heal" | "cure" | "equipment" | "map";

export type ContentName = {
  ja: string;
  en?: string;
};

export type SourceRef = {
  game: "nethack";
  version: "5.0.0";
  file: string;
  line?: number;
};

export type ContentEntity = {
  id: string;
  kind: "monster" | "item" | "terrain" | "role" | "event" | "trap";
  sourceRef?: SourceRef;
  names: ContentName;
  description: ContentName;
  tags: string[];
  balance: {
    tier?: Tier;
    rarity?: "common" | "uncommon" | "rare" | "special";
    danger?: number;
    utility?: number;
    economyValue?: number;
    xpReward?: number;
  };
  simulation: {
    family?: EnemyFamily;
    roles?: CombatRole[];
    aiHints?: string[];
    biomes?: string[];
    hooks?: string[];
  };
  modernizedSkin: {
    visualTags: string[];
    palette: string[];
    promptSeed: string;
  };
};

export type AssetDefinition = {
  id: string;
  kind: "monster" | "item" | "terrain" | "character" | "ui" | "effect" | "event" | "trap";
  entityRefs: string[];
  styleTags: string[];
  size: 64 | 128;
  path?: string;
  sheet?: {
    columns: number;
    rows: number;
    index: number;
  };
  promptSeed: string;
  status: "procedural-fallback" | "prompt-ready" | "generated" | "final";
};

export type Tile = {
  kind: TileKind;
  explored: boolean;
  visible: boolean;
};

export type Stats = {
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
};

export type ConditionKind = "guarded" | "bleeding" | "venomed";

export type StatusCondition = {
  kind: ConditionKind;
  turns: number;
};

export type InventoryEntry = {
  contentId: string;
  quantity: number;
  equipped?: boolean;
};

export type RoleTraits = {
  focus: string;
  strengths: string[];
  traitLabels: string[];
  trapAvoidPercent?: number;
  rangedDefense?: number;
  scoutRevealRadius?: number;
  scoutBonusItem?: string;
  priestGuardedTurns?: number;
  bossReward?: string;
};

export type RoleDefinition = {
  id: string;
  stats: Stats;
  inventory: InventoryEntry[];
  traits: RoleTraits;
};

export type FloorRule = {
  floor?: number;
  minFloor?: number;
  maxFloor?: number;
  biomes?: BiomeTheme[];
};

export type MonsterSpawnRule = FloorRule & {
  contentId: string;
};

export type MonsterStatsConfig = {
  hp: number;
  attack: number;
  defense: number;
  hpPerDanger?: number;
};

export type EquipmentConfig = {
  slot: "weapon" | "shield" | "armor";
  power: number;
  rangedDefense?: number;
  trapAvoidPercent?: number;
  trapAvoidPenaltyPercent?: number;
  specialDamage?: {
    amount: number;
    families: EnemyFamily[];
  };
};

export type ConsumableConfig = {
  heal?: number;
  cureConditions?: ConditionKind[];
  guardedTurns?: number;
  revealRadius?: number;
  revealFloor?: boolean;
  pushVisibleMonsters?: boolean;
  rangedDamage?: number;
  mysteryEffects?: Array<"heal" | "guard" | "reveal" | "push" | "bleed" | "venom">;
};

export type EventConfig = {
  xp?: number;
  heal?: number;
  cureConditions?: ConditionKind[];
  goldBase?: number;
  goldPerFloor?: number;
  condition?: { kind: ConditionKind; turns: number };
  revealRadius?: number;
  loot?: string[];
  encounters?: string[];
  reward?: string;
  highFloorReward?: { minFloor: number; contentId: string };
  guard?: string;
  highFloorGuard?: { minFloor: number; contentId: string };
  trap?: string;
  highFloorTrap?: { minFloor: number; contentId: string };
  revealTraps?: number;
  weakenLateEnemies?: boolean;
  bossRewardBonus?: number;
};

export type RunObjectiveFlags = {
  trapReveals: number;
  lateEnemiesWeakened: boolean;
  bossRewardBonus: number;
  roleGoalProgress: number;
};

export type GameConfig = {
  rules: {
    mapWidth: number;
    mapHeight: number;
    fovRadius: number;
    maxFloor: number;
    inventorySlotLimit: number;
    xpThresholds: number[];
    descentHeal: number;
    baseAttack: number;
    attackPerLevel: number;
    baseDefense: number;
    defenseLevelsPerPoint: number;
    levelUpMaxHp: number;
    levelUpHeal: number;
    monsterCountBase: number;
    monsterCountFloorCap: number;
    itemCountBase: number;
    itemCountFloorDivisor: number;
    itemCountFloorCap: number;
    trapCountBase: number;
    trapCountFloorDivisor: number;
    trapCountMax: number;
    trapAvoidBasePercent: number;
    trapAvoidMinPercent: number;
    trapAvoidMaxPercent: number;
    coverCountBase: number;
    coverCountFloorDivisor: number;
    coverCountMax: number;
    eventCountBase: number;
    eventExtraChancePercent: number;
    attackRandomBonusMax: number;
    rangedMonsterRange: number;
    monsterChaseRange: number;
    guardedDefenseBonus: number;
    moonlitMailRegenEveryTurns: number;
    moonlitMailRegenAmount: number;
    bleedingDamage: number;
    venomedDamage: number;
  };
  biomes: Array<{ theme: BiomeTheme; minFloor: number; nameJa: string }>;
  roles: RoleDefinition[];
  monsterSpawnRules: MonsterSpawnRule[];
  monsterStats: Record<string, MonsterStatsConfig>;
  itemPools: Array<FloorRule & { items: string[] }>;
  guaranteedItems: Array<FloorRule & { items: string[] }>;
  eventPools: Array<FloorRule & { events: string[] }>;
  trapPools: Array<FloorRule & { traps: string[] }>;
  bosses: Array<{ floor: number; contentId: string; reward?: string }>;
  equipment: Record<string, EquipmentConfig>;
  consumables: Record<string, ConsumableConfig>;
  events: Record<string, EventConfig>;
  merchantOffers: Array<FloorRule & {
    serviceId: MerchantServiceId;
    cost: number;
    contentId?: string;
    heal?: number;
    cureConditions?: ConditionKind[];
    requireHpRatioAtMost?: number;
    requireCondition?: boolean;
  }>;
  rangedMonsters: string[];
  monsterAttackEffects: Record<string, { condition: ConditionKind; turns: number; message: string }>;
  trapEffects: Record<string, { damage: number; damagePerFloorDivisor?: number; condition?: ConditionKind; turns?: number; revealRadius?: number }>;
  gold: {
    coinPouchBase: number;
    coinPouchPerFloor: number;
    coinPouchRandomMax: number;
  };
};

export type Entity = {
  id: string;
  kind: EntityKind;
  contentId: string;
  pos: Point;
  blocksMovement: boolean;
  stats?: Stats;
  hostile?: boolean;
  inventory?: InventoryEntry[];
  conditions?: StatusCondition[];
  goldAmount?: number;
};

export type PlayerProgress = {
  level: number;
  xp: number;
  xpToNext: number;
  gold: number;
};

export type GameMessage = {
  turn: number;
  text: string;
  tone: "system" | "explore" | "combat" | "loot" | "danger" | "ai";
};

export type GameState = {
  seed: number;
  turn: number;
  floor: number;
  biome: BiomeTheme;
  width: number;
  height: number;
  tiles: Tile[];
  entities: Entity[];
  playerId: string;
  playerProgress: PlayerProgress;
  runObjectives: RunObjectiveFlags;
  messages: GameMessage[];
  status: "playing" | "won" | "lost";
};

export type GameAction =
  | { type: "move"; direction: Direction }
  | { type: "wait" }
  | { type: "pickup" }
  | { type: "equip"; contentId: string }
  | { type: "dropItem"; contentId: string }
  | { type: "useItem"; contentId: string }
  | { type: "merchantService"; serviceId: MerchantServiceId }
  | { type: "descend" };

export type VisibleEntity = Pick<Entity, "id" | "kind" | "contentId" | "pos" | "stats" | "hostile" | "blocksMovement" | "goldAmount">;

export type ExplorationObjective = "explore" | "findStairs" | "defeatBoss" | "descend" | "resolveStall";

export type ExplorationFrontier = Point & {
  distance: number;
  unseenNeighbors: number;
};

export type ExplorationStatus = {
  objective: ExplorationObjective;
  knownStairs: Point | null;
  reachableStairs: Point | null;
  blockedStairs: Point | null;
  nearestFrontier: ExplorationFrontier | null;
  reachableFrontiers: ExplorationFrontier[];
  reachableFrontierCount: number;
  knownWalkableTiles: number;
  exploredTileRatio: number;
  stalledHint: boolean;
};

export type GameObservation = {
  seed: number;
  turn: number;
  floor: number;
  biome: BiomeTheme;
  width: number;
  height: number;
  player: Entity;
  playerProgress: PlayerProgress;
  visibleEntities: VisibleEntity[];
  knownEntities: VisibleEntity[];
  visibleTiles: Array<Tile & Point>;
  knownTiles: Array<Tile & Point>;
  exploration: ExplorationStatus;
  messages: GameMessage[];
  status: GameState["status"];
  bossAlive: boolean;
};

export type DeathCause = "combat" | "rangedCombat" | "trap" | "bleeding" | "venom" | "unknown";

export type RunLogPlayerSnapshot = {
  pos: Point;
  hp?: number;
  maxHp?: number;
  attack?: number;
  defense?: number;
  conditions?: StatusCondition[];
  inventory: InventoryEntry[];
};

export type RunLogEntitySummary = {
  adjacentHostiles: number;
  visibleHostiles: number;
  visibleRangedHostiles: number;
  visibleItems: number;
  knownTraps: number;
};

export type RunLogEntry = {
  index: number;
  turn: number;
  floor: number;
  action: GameAction;
  actor: "player" | "ai";
  before: RunLogPlayerSnapshot;
  after: RunLogPlayerSnapshot;
  resultStatus: GameState["status"];
  messageDelta: GameMessage[];
  visible: RunLogEntitySummary;
  knownTiles: number;
  visibleTiles: number;
  aiDebug?: {
    stagnantTurns: number;
    visitsAtPlayer: number;
    recentPositions: string[];
  };
  eventKinds: string[];
};

export type RunLog = {
  seed: number;
  roleId: string;
  startedAt: string;
  entries: RunLogEntry[];
  totalEntries: number;
  maxEntries?: number;
  totals: {
    actions: Record<GameAction["type"], number>;
    damageEvents: number;
    damageTaken: number;
    healingReceived: number;
    pickups: number;
    descents: number;
    lowHpTurns: number;
    stagnantTurns: number;
    riskyTrapSteps: number;
  };
};

export type RunReview = {
  result: GameState["status"];
  deathCause: DeathCause | null;
  summaryText: string;
  keyFindings: string[];
  aiImprovementHints: string[];
  lastTurns: RunLogEntry[];
  stats: {
    turns: number;
    floor: number;
    level: number;
    xp: number;
    gold: number;
    finalHp?: number;
    maxHp?: number;
    damageTaken: number;
    healingReceived: number;
    pickups: number;
    descents: number;
    lowHpTurns: number;
    stagnantTurns: number;
    riskyTrapSteps: number;
  };
  exportJson: {
    version: 1;
    generatedAt: string;
    run: Omit<RunLog, "entries"> & { recentEntries: RunLogEntry[] };
    review: Omit<RunReview, "exportJson">;
  };
};
