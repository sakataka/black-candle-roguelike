export type Point = {
  x: number;
  y: number;
};

export type Direction = "north" | "south" | "west" | "east" | "northwest" | "northeast" | "southwest" | "southeast";

export type TileKind = "void" | "floor" | "wall" | "cover" | "stairsDown";

export type BiomeTheme = "blackstone" | "crypt" | "furnace" | "black-candle";
export type RoomTheme = "ore-mine" | "sunken-archive" | "thorn-chapel";
export type TerrainTheme = BiomeTheme | RoomTheme;

type EntityKind = "player" | "monster" | "item" | "event" | "trap";

export type TrapKind = "blood-needle" | "venom-mist" | "crumbling-floor";

type EnemyFamily = "beast" | "undead" | "cult" | "demon" | "construct";

type Tier = "early" | "mid" | "late" | "boss";

export type MerchantServiceId = "heal" | "cure" | "equipment" | "map";

export type TemperamentId = "cautious" | "seeker" | "bold";

export type DirectiveId = "survival" | "discovery" | "conquest";

export type RoleTruthId = "shared-oath" | "furnace-map" | "purified-flame";

export type EndingId = "inherit-flame" | "extinguish-flame" | "divide-flame";

export type MissionId = "truth-return" | "black-core" | "memorial" | "relic-ledger" | "swift-route";

export type LanternRiteId = "flare" | "mend" | "guide" | "ward";

/** 探索者AIの判断を決める調整値。設定ファイルと作戦カードから合成する。 */
export type AutoplayPolicyValues = {
  healBonus: number;
  potionCalm: number;
  potionCombat: number;
  salveCalm: number;
  salveCombat: number;
  charmCalm: number;
  charmCombat: number;
  combatHp: number;
  bossEngageHp: number;
  riskyTraversalHp: number;
  dartMinHp: number;
  dartRange: number;
  discoveryDetour: boolean;
  huntWeakEnemies: boolean;
  exploreBeforeStairs: number;
  chaseRanged: boolean;
  /** 射手へ詰め寄るとき、射線に晒されるマスを避けた経路を選ぶ。 */
  coverApproach: boolean;
  rangedPriority: boolean;
  avoidRiskPanels: boolean;
  /** 既知の罠を踏んででも進むまでに待つ停滞手数。 */
  trapPatience: number;
  /** 灯芯が尽きるまで残りこの手数になったら、寄り道をやめて階段を急ぐ。 */
  urgencyTurnsLeft: number;
};

type NumericPolicyKey = { [K in keyof AutoplayPolicyValues]: AutoplayPolicyValues[K] extends number ? K : never }[keyof AutoplayPolicyValues];

export type PolicyModifier = {
  set?: Partial<AutoplayPolicyValues>;
  add?: Partial<Record<NumericPolicyKey, number>>;
};

export type TacticDefinition = PolicyModifier & {
  label: string;
  description: string;
  /** 遠征開始時に持たせる品。 */
  grantItems?: Array<{ contentId: string; quantity: number }>;
  /** 作戦に伴う小さな能力補正。 */
  perks?: { rangedDefense?: number; trapAvoidPercent?: number; healPercent?: number };
  /** 灰灯院の書庫で解放されるまで選べない作戦。 */
  locked?: boolean;
};

export type LanternState = {
  embers: number;
  maxEmbers: number;
  ritesUsed: number;
  /** 上限に達していて受け取れずに消えた灯火の数。 */
  overflowed?: number;
};

export type LanternRiteConfig = {
  cost: number;
  dazeTurns?: number;
  healPercent?: number;
  cureConditions?: boolean;
  revealRadius?: number;
  revealTraps?: number;
  guardedTurns?: number;
  pushVisibleMonsters?: boolean;
};

type DecisionKind = "checkpoint" | "context" | "final";

export type RunIdentity = {
  name: string;
  roleId: string;
  temperament: TemperamentId;
  /** 遠征団の古参として送り出した場合の識別子。 */
  veteranId?: string;
};

export type FacilityId = "war-room" | "archive" | "altar";

export type Veteran = {
  id: string;
  identity: RunIdentity;
  rank: number;
  expeditions: number;
  scars: string[];
};

export type FallenDelver = {
  id?: string;
  identity: RunIdentity;
  rank: number;
  floor: number;
  cause: string | null;
  gear?: string;
  recovered?: boolean;
  echoes?: LastMoment[];
  lesson?: LessonId;
};

export type GraveMarker = {
  id: string;
  name: string;
  roleId: string;
  floor: number;
  gear?: string;
  echoes?: LastMoment[];
  lesson?: LessonId;
};

/** 燭階や周期の余波が遠征へ与える補正。ルール値は加算で重ねる。 */
export type RunRuleModifier = {
  label: string;
  description: string;
  ruleDeltas?: Partial<Record<RunRuleKey, number>>;
  lanternStartDelta?: number;
  lanternMaxDelta?: number;
  bossOverride?: { floor: number; contentId: string };
  shardBonusPercent?: number;
};

export type RunRuleKey = "fovRadius" | "monsterCountBase" | "trapCountBase" | "runTurnLimit" | "runTurnWarning" | "monsterHpScale" | "monsterAttackPerFloor" | "descentHeal";

/** 遠征開始時に灰灯院と遠征団から持ち込む条件。 */
export type RunModifiers = {
  foundationRank?: number;
  bossTrial?: number;
  flameDebt?: number;
  tacticSlots: number;
  scars: string[];
  rank: number;
  heat?: number;
  aftermath?: EndingId;
  keeperName?: string;
  ruleDeltas?: Partial<Record<RunRuleKey, number>>;
  bossOverride?: { floor: number; contentId: string };
  graves?: GraveMarker[];
  lessons?: LessonId[];
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
  /** 自動選択までの探索者の手数。UIの操作・先読みは時計を止めない。 */
  remainingTurns?: number;
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
  carriedTruthId?: RoleTruthId;
  endingId?: EndingId;
  turnWarningShown: boolean;
  recoveredGraves?: string[];
  killedBy?: { cause: "combat" | "rangedCombat" | "trap" | "bleeding" | "venom" | "item"; contentId?: string };
};

/** 遠征で灰灯院へ持ち帰る灯片の内訳。倒れた場合は到達・守り手・発見・弔いの一部だけが残る。 */
export type ShardBreakdown = {
  depth: number;
  guardians: number;
  discoveries: number;
  survival: number;
  carried: number;
  mission: number;
  truth: number;
  graves: number;
  /** 燭階・周期の余波による上乗せ率（%）。 */
  bonusPercent: number;
  total: number;
};

export type ExpeditionRecord = {
  bossTrial?: number;
  id: string;
  completedAt: string;
  seed: number;
  identity: RunIdentity;
  status: "won" | "lost" | "returned" | "stranded";
  floor: number;
  runTurn: number;
  shards: ShardBreakdown;
  decisions: RunDecisionRecord[];
  deathCause: string | null;
  missionId: MissionId;
  missionCompleted: boolean;
  discoveryCount: number;
  interventionCount: number;
  truthRecovered?: RoleTruthId;
  endingId?: EndingId;
  veteranOutcome?: "promoted" | "scarred" | "fallen" | "recruited" | "keeper" | "roster-full";
  heat?: number;
  cycle?: number;
  gravesRecovered?: number;
};

export type CampaignState = {
  journey?: { victories: number; trialsCleared: number; lifetimeShards: number };
  flameDebt?: number;
  version: 4;
  roleTruths: RoleTruthId[];
  expeditions: ExpeditionRecord[];
  shards: number;
  facilities: Record<FacilityId, number>;
  roster: Veteran[];
  fallen: FallenDelver[];
  lessons?: LessonId[];
  /** 燭階。勝利した最高段の次まで解放され、選んだ段の制約が重なる。 */
  heat: { unlocked: number; selected: number };
  /** 結末を迎えるたびに進む周期と、次の迷宮に残る余波。 */
  cycle: { number: number; aftermath?: EndingId; keeperName?: string };
};

export type ContentEntity = {
  name: string;
  tier?: Tier;
  danger?: number;
  economyValue?: number;
  xpReward?: number;
  family?: EnemyFamily;
  encounterRole?: string;
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
  roomTheme?: RoomTheme;
  coverAsset?: string;
};

export type Stats = {
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
};

export type ConditionKind = "guarded" | "bleeding" | "venomed" | "dazed";

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
  truthId?: RoleTruthId;
  healPercent?: number;
  cleansingHeal?: number;
  roomRevealRadius?: number;
  lockpickBonusGold?: number;
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
  slot: "weapon" | "shield" | "armor" | "ring";
  power: number;
  rangedDefense?: number;
  trapAvoidPercent?: number;
  trapAvoidPenaltyPercent?: number;
  twoHanded?: boolean;
  rangedAttack?: { damage: number; range: number };
  conditionResistance?: ConditionKind[];
  regen?: { everyTurns: number; amount: number };
  revealRadius?: number;
  reflectDamage?: number;
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
  range?: number;
  unlockCache?: boolean;
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
  locked?: boolean;
};

export type RunObjectiveFlags = {
  trapReveals: number;
  lateEnemiesWeakened: boolean;
  bossRewardBonus: number;
  roleGoalProgress: number;
};

export type GameConfig = {
  expansion?: {
    enabled: boolean;
    roomChancePercent: number;
    roomMonsterCount: number;
    forcedLockDamage: number;
    rooms: Array<FloorRule & { theme: RoomTheme; nameJa: string; monsters: string[]; events: string[]; covers: string[] }>;
    monsterTraits: Record<string, { lifeDrain?: number; keepDistance?: boolean; minFloor?: number }>;
  };
  realtime?: RealtimeConfig;
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
    /** 階層ごとの敵HP増加（hpPerDanger）に掛ける倍率。 */
    monsterHpScale: number;
    /** 階層ごとの敵攻撃力の増加量（端数切り捨て）。 */
    monsterAttackPerFloor: number;
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
    rangedRetreatCooldown: number;
    monsterChaseRange: number;
    guardedDefenseBonus: number;
    moonlitMailRegenEveryTurns: number;
    moonlitMailRegenAmount: number;
    bleedingDamage: number;
    venomedDamage: number;
    runTurnWarning: number;
    runTurnLimit: number;
  };
  aiPolicy: {
    base: AutoplayPolicyValues;
    temperaments: Record<TemperamentId, PolicyModifier>;
    directives: Record<DirectiveId, PolicyModifier>;
  };
  tactics: {
    slots: number;
    definitions: Record<string, TacticDefinition>;
  };
  ascension: { tiers: RunRuleModifier[] };
  aftermath: Record<EndingId, RunRuleModifier>;
  /** 瀕死で帰還した古参に残る古傷。作戦と同じ形で判断と能力に影響する。 */
  scars: Record<string, TacticDefinition>;
  campaign: {
    journey?: {
      shardsPerRank: number;
      maxRank: number;
      maxHpPerRank: number;
      attackPerRank: number;
      trials: Array<{ label: string; victories: number; hpScale: number; attack: number; defense: number }>;
    };
    /** 遠征の灯片。到達・守り手・発見・弔いは倒れても keepPercentOnLoss の割合だけ残り、それ以外は生還時のみ。 */
    shards: {
      perFloor: number;
      perGuardian: number;
      discoveriesPerShard: number;
      returned: number;
      won: number;
      carriedValuePerShard: number;
      carriedCap: number;
      newTruth: number;
      keepPercentOnLoss: number;
    };
    missionShards: Record<MissionId, number>;
    veteranMaxRank: number;
    veteranRankBonus: { maxHp: number; attack: number };
    scarHpRatio: number;
    rosterLimit: number;
    scarTreatmentCost: number;
    graveShards: number;
    facilities: Record<FacilityId, {
      label: string;
      description: string;
      costs: number[];
      tacticSlotsPerLevel?: number;
      startEmbersPerLevel?: number;
      unlocksPerLevel?: string[][];
    }>;
  };
  lantern: {
    startEmbers: number;
    maxEmbers: number;
    embersPerFloor: number;
    embersPerGuardian: number;
    rites: Record<LanternRiteId, LanternRiteConfig>;
    /** batch simulation 用の灯守AIの介入閾値。 */
    watcher: {
      mendHpRatio: number;
      mendAfflictedHpRatio: number;
      flareAdjacentHostiles: number;
      flareBossHpRatio: number;
      wardRangedThreats: number;
      wardHpRatio: number;
      guideMinEmbers: number;
      guideFloorTurns: number;
    };
  };
  autonomous: {
    revelationsPerRun: number;
    /** 判断画面で各選択肢ごとに走らせる先読みの本数。0で無効。 */
    lookaheadRollouts: number;
    pacingMs: {
      calm: number;
      traversal: number;
      exploration: number;
      danger: number;
    };
  };
  biomes: Array<{ theme: BiomeTheme; minFloor: number; nameJa: string; roomWidth?: [number, number]; roomHeight?: [number, number]; density?: number }>;
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
  /** 間合いを取り直せるようになるまでの残り手番（遠隔敵）。 */
  retreatCooldown?: number;
  telegraph?: AttackTelegraph;
  attackCooldown?: number;
  recoveryTurns?: number;
  awakened?: boolean;
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
  lantern: LanternState;
  tactics: string[];
  modifiers: RunModifiers;
  pendingDecision: PendingDecision | null;
  knownRoleTruths: RoleTruthId[];
  story: RunStoryState;
  messages: GameMessage[];
  status: "playing" | "won" | "lost" | "returned" | "stranded";
  /** 直前の1アクションで起きた攻撃。描画演出専用で、ルール判定には使わない。 */
  strikes?: StrikeRecord[];
  expedition?: ExpeditionDynamics;
};

export type StrikeRecord = {
  attackerId: string;
  defenderId: string;
  from: Point;
  to: Point;
  ranged: boolean;
};

export type GameAction =
  | { type: "move"; direction: Direction }
  | { type: "wait" }
  | { type: "pickup" }
  | { type: "equip"; contentId: string }
  | { type: "dropItem"; contentId: string }
  | { type: "useItem"; contentId: string; targetId?: string }
  | { type: "shoot"; targetId: string }
  | { type: "merchantService"; serviceId: MerchantServiceId }
  | { type: "descend" }
  | { type: "resolveDecision"; optionId: string; tactics?: string[] }
  /** 灯守（観戦者）の介入。探索者の手番を消費しない。 */
  | { type: "invokeLantern"; rite: LanternRiteId }
  | { type: "placeLantern"; pos?: Point }
  | { type: "borrowFlame" };

type VisibleEntity = Pick<Entity, "id" | "kind" | "contentId" | "pos" | "stats" | "hostile" | "blocksMovement" | "goldAmount" | "conditions" | "telegraph" | "recoveryTurns" | "awakened">;

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
  expedition?: ExpeditionDynamics;
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
  lantern: LanternState;
  tactics: string[];
  modifiers: RunModifiers;
  pendingDecision: PendingDecision | null;
  story: RunStoryState;
  messages: GameMessage[];
  status: GameState["status"];
  bossAlive: boolean;
  /** 足元の旅商人が今引き受けてくれる取引。商人の上にいない時は空。 */
  merchantServices: MerchantServiceId[];
};

export type DeathCause = "combat" | "rangedCombat" | "trap" | "bleeding" | "venom" | "signalLoss" | "unknown";

export type LessonId = "ranged" | "care" | "traps";
export type LastMoment = { action: string; hp: number; pos: Point };
export type AttackTelegraph = { kind: "shot" | "sweep" | "hex"; tiles: Point[]; remaining: number; origin: Point };
export type ExpeditionDynamics = {
  lights: Array<{ pos: Point; turns: number }>;
  borrowed: boolean;
  debt: number;
  loanShieldTurns: number;
  lawPhase: number;
  floorKills: number;
  floorAwakened: number;
  heat: Array<{ pos: Point; remaining: number; active: boolean }>;
  trail: LastMoment[];
  memories: Array<{ name: string; echoes: LastMoment[]; lesson: LessonId }>;
  lastRite?: { rite: string; runTurn: number };
  stats: { dodges: number; telegraphs: number; terrainLures: number; awakened: number; heatHits: number; lightsPlaced: number; borrowed: number };
};

export type RealtimeConfig = {
  enabled: boolean;
  decisionTurns: { checkpoint: number; context: number; final: number };
  telegraphs: Record<string, { kind: AttackTelegraph["kind"]; windup: number; cooldown: number; recovery: number; range: number; damageScale: number }>;
  ai: { dodgeHpRatio: number; terrainHpRatio: number; terrainCooldown: number; coverWeight: number; hostileWeight: number; trapLureWeight: number; recoveryDamageBonus: number; lessonHealBonus: number; lessonTrapPatience: number };
  light: { cost: number; duration: number; radius: number; lureRange: number; maxActive: number; watcherReserve: number; watcherHostiles: number };
  loan: { healPercent: number; guardedTurns: number; debt: number; embers: number; watcherHpRatio: number };
  laws: { cryptWakeEveryKills: number; cryptWakeLimit: number; cryptWakeRadius: number; cryptAttackBonus: number; furnacePeriod: number; furnaceWindup: number; furnaceDuration: number; furnaceDamage: number; furnaceVentLimit: number };
  missions: { memorialHpRatio: number; rewardEmbers: number };
  dialogue: { minTurns: number; repeatTurns: number; minMs: number; holdMs: number };
};

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
  runTurn?: number;
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
  shards: ShardBreakdown;
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
