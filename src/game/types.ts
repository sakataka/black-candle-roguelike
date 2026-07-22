export type Point = {
  x: number;
  y: number;
};

export type Direction = "north" | "south" | "west" | "east" | "northwest" | "northeast" | "southwest" | "southeast";

export type TileKind = "void" | "floor" | "wall" | "cover" | "stairsDown";

export type BiomeTheme = "blackstone" | "crypt" | "furnace" | "black-candle";

type EntityKind = "player" | "monster" | "item" | "event" | "trap";

export type TrapKind = "blood-needle" | "venom-mist" | "crumbling-floor";

type EnemyFamily = "beast" | "undead" | "cult" | "demon" | "construct";

type Tier = "early" | "mid" | "late" | "boss";

export type MerchantServiceId = "heal" | "cure" | "equipment" | "map";

export type TemperamentId = "cautious" | "seeker" | "bold";

export type DirectiveId = "survival" | "discovery" | "conquest";

export type RoleTruthId = "shared-oath" | "furnace-map" | "purified-flame";

export type EndingId = "inherit-flame" | "extinguish-flame" | "divide-flame";

export type MissionId = "guardian-vow" | "relic-ledger" | "swift-route";

type DecisionKind = "checkpoint" | "context" | "final";

export type RunIdentity = {
  name: string;
  roleId: string;
  temperament: TemperamentId;
};

export type DecisionOption = {
  id: string;
  label: string;
  description: string;
  outcome: "continue" | "return" | "research" | "relic" | "ending";
  directive?: DirectiveId;
  endingId?: EndingId;
  requiresRevelation?: boolean;
  effect?: {
    heal?: number;
    maxHpCost?: number;
    guardedTurns?: number;
    cureConditions?: boolean;
    revealRadius?: number;
    pushVisibleMonsters?: boolean;
    goldCost?: number;
  };
};

export type PendingDecision = {
  id: string;
  kind: DecisionKind;
  floor: number;
  title: string;
  body: string;
  defaultOptionId: string;
  resume: "none" | "descend";
  options: DecisionOption[];
};

export type RunDecisionRecord = {
  id: string;
  floor: number;
  optionId: string;
  optionLabel: string;
  usedRevelation: boolean;
  effectSummary?: string;
};

export type RunStoryState = {
  missionId: MissionId;
  missionCompleted: boolean;
  maxFloorReached: number;
  bossesDefeated: number;
  discoveries: string[];
  decisions: RunDecisionRecord[];
  contextActs: number[];
  crisisKinds: string[];
  interventionScore: number;
  carriedTruthId?: RoleTruthId;
  coreDisposition?: "research" | "relic";
  endingId?: EndingId;
  turnWarningShown: boolean;
};

export type ScoreBreakdown = {
  depth: number;
  guardians: number;
  roleObjective: number;
  discoveries: number;
  survival: number;
  recoveredValue: number;
  tempo: number;
  autonomy: number;
  total: number;
};

export type ExpeditionRecord = {
  id: string;
  completedAt: string;
  seed: number;
  identity: RunIdentity;
  status: "won" | "lost" | "returned" | "stranded";
  floor: number;
  runTurn: number;
  score: ScoreBreakdown;
  decisions: RunDecisionRecord[];
  deathCause: string | null;
  missionId: MissionId;
  missionCompleted: boolean;
  discoveryCount: number;
  interventionCount: number;
  truthRecovered?: RoleTruthId;
  endingId?: EndingId;
};

export type CampaignState = {
  version: 2;
  roleTruths: RoleTruthId[];
  expeditions: ExpeditionRecord[];
};

export type ContentEntity = {
  name: string;
  tier?: Tier;
  danger?: number;
  economyValue?: number;
  xpReward?: number;
  family?: EnemyFamily;
};

export type AssetDefinition = {
  contentId: string;
  path: string;
  sheet: {
    columns: number;
    rows: number;
    index: number;
  };
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

type InventoryEntry = {
  contentId: string;
  quantity: number;
  equipped?: boolean;
};

type RoleTraits = {
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

type RoleDefinition = {
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

type MonsterSpawnRule = FloorRule & {
  contentId: string;
};

type MonsterStatsConfig = {
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

type ConsumableConfig = {
  heal?: number;
  cureConditions?: ConditionKind[];
  guardedTurns?: number;
  revealRadius?: number;
  revealFloor?: boolean;
  pushVisibleMonsters?: boolean;
  rangedDamage?: number;
  mysteryEffects?: Array<"heal" | "guard" | "reveal" | "push" | "bleed" | "venom">;
};

type EventConfig = {
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
    runTurnWarning: number;
    runTurnLimit: number;
  };
  autonomous: {
    revelationsPerRun: number;
    scoring: {
      depthPerFloor: number;
      guardian: number;
      roleObjective: number;
      roleObjectiveCap: number;
      discovery: number;
      discoveryCap: number;
      returned: number;
      won: number;
      recoveredValueCap: number;
      tempoParPerFloor: number;
      tempoPerTurn: number;
      tempoCap: number;
      missionCompleted: number;
      intervention: number;
    };
    pacingMs: {
      traversal: number;
      exploration: number;
      danger: number;
    };
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
  runTurn: number;
  floor: number;
  biome: BiomeTheme;
  width: number;
  height: number;
  tiles: Tile[];
  entities: Entity[];
  playerId: string;
  playerProgress: PlayerProgress;
  runObjectives: RunObjectiveFlags;
  runIdentity: RunIdentity;
  directive: DirectiveId;
  revelationsRemaining: number;
  pendingDecision: PendingDecision | null;
  knownRoleTruths: RoleTruthId[];
  story: RunStoryState;
  messages: GameMessage[];
  status: "playing" | "won" | "lost" | "returned" | "stranded";
};

export type GameAction =
  | { type: "move"; direction: Direction }
  | { type: "wait" }
  | { type: "pickup" }
  | { type: "equip"; contentId: string }
  | { type: "dropItem"; contentId: string }
  | { type: "useItem"; contentId: string }
  | { type: "merchantService"; serviceId: MerchantServiceId }
  | { type: "descend" }
  | { type: "resolveDecision"; optionId: string };

type VisibleEntity = Pick<Entity, "id" | "kind" | "contentId" | "pos" | "stats" | "hostile" | "blocksMovement" | "goldAmount">;

type ExplorationObjective = "explore" | "findStairs" | "defeatBoss" | "descend" | "resolveStall";

type ExplorationFrontier = Point & {
  distance: number;
  unseenNeighbors: number;
};

type ExplorationStatus = {
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
  runTurn: number;
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
  runIdentity: RunIdentity;
  directive: DirectiveId;
  revelationsRemaining: number;
  pendingDecision: PendingDecision | null;
  story: RunStoryState;
  messages: GameMessage[];
  status: GameState["status"];
  bossAlive: boolean;
};

export type DeathCause = "combat" | "rangedCombat" | "trap" | "bleeding" | "venom" | "signalLoss" | "unknown";

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
  identity: RunIdentity;
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
  score: ScoreBreakdown;
  identity: RunIdentity;
  decisions: RunDecisionRecord[];
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
