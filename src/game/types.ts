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

export type EnemyFamily = "beast" | "undead" | "cult" | "demon" | "construct";

export type Tier = "early" | "mid" | "late" | "boss";

/** 武器の型。威力の大小ではなく、攻撃の振る舞いを変える。 */
export type WeaponType = "blade" | "spear" | "axe" | "dagger" | "mace" | "bow";

export type EquipmentSlot = "weapon" | "shield" | "armor" | "ring";

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
  /** 持ち込んだ継承品（解放した職業のID）。 */
  legacy?: string;
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

/** 職業で初めて踏破すると解放され、以後どの職業でも一つ持ち込める品。 */
export type LegacyConfig = {
  label: string;
  description: string;
  items: Array<{ contentId: string; quantity: number; plus?: number; seals?: string[] }>;
};

export type CampaignState = {
  /** 第十層を踏破した職業。継承品の解放に使う。 */
  legacies?: string[];
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

export type ConditionKind = "guarded" | "bleeding" | "venomed" | "dazed" | "exposed";

export type StatusCondition = {
  kind: ConditionKind;
  turns: number;
};

export type InventoryEntry = {
  contentId: string;
  quantity: number;
  equipped?: boolean;
  /** 装備の修正値。同じ装備を重ねると鍛え直して上がる。 */
  plus?: number;
  /** 装備に刻まれた印。固有の印（innateSeals）とは別に、拾った個体ごとに付く。 */
  seals?: string[];
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
  /** 得意な武器の型。装備中は攻撃に小さな補正が付く。 */
  weaponMastery?: { types: WeaponType[]; attack: number };
  /** 不意打ちの倍率（武器の型の倍率を上書きする）。 */
  backstabMultiplier?: number;
  /** 敵に気づかれにくくなる距離。 */
  stealth?: number;
  /** 職業の固有技。 */
  skill?: SkillId;
};

export type SkillId = "oath-strike" | "pin-shot" | "sanctify" | "appraise" | "ash-flask" | "charge" | "shadowstep";

export type SkillConfig = {
  label: string;
  description: string;
  cooldown: number;
  range?: number;
  scale?: number;
  bossScale?: number;
  healOnKill?: number;
  heal?: number;
  radius?: number;
  damage?: number;
  damagePerLevel?: number;
  turns?: number;
  families?: EnemyFamily[];
};

/** 敵の振る舞い。数値の強さとは別に、戦い方そのものを変える。 */
export type MonsterBehavior = {
  /** 1手に2回動く。 */
  fast?: boolean;
  /** 同じ敵が探索者の隣にいる数だけ攻撃が上がる。 */
  pack?: number;
  /** 鈍器以外の正面からの攻撃を軽減する割合。隙や不意打ちには効かない。 */
  shielded?: number;
  /** 一度倒れても、鈍器か浄化の武器でなければ数手後に起き上がる。 */
  revive?: { turns: number };
  /** 殴った時に携行品を盗んで逃げる。 */
  thief?: boolean;
  /** 傷ついた仲間を癒やす。 */
  healer?: { every: number; percent: number; range: number };
  /** 殴った時に装備の修正値を下げる確率。 */
  corrode?: number;
  /** 傷を受けると分かれる。 */
  split?: { minHp: number; max: number };
  /** 倒れる時に周囲を焼く。 */
  explode?: { damage: number; perFloor: number };
  /** 毎手の再生。毒を受けている間は止まる。 */
  regenerate?: number;
  /** 必ず眠った状態で置かれ、起きた直後の一撃が重い。 */
  ambush?: boolean;
  /** 殴った傷から命を吸う量。 */
  drain?: number;
  /** 一定の手ごとに手下を呼ぶ。 */
  summon?: { contentId: string; every: number; max: number };
  /** 命が減ると怒り、攻撃が上がる。fast なら倍速にもなる。 */
  enrage?: { hpPercent: number; attackBonus: number; fast?: boolean };
};

/** 階の兆し。入った時に一つ引かれ、その階の性格を変える。 */
export type OmenConfig = {
  label: string;
  description: string;
  weight: number;
  minFloor?: number;
  maxFloor?: number;
  /** 守り手の階には出さない。 */
  notBossFloor?: boolean;
  fovDelta?: number;
  monsterCountDelta?: number;
  trapCountDelta?: number;
  itemCountDelta?: number;
  noHealingItems?: boolean;
  extraEvents?: string[];
  eliteBonus?: number;
  monsterAttackBonus?: number;
  xpPercent?: number;
  sleepPercentDelta?: number;
  /** 拾える品のうち装備に置き換わる割合。 */
  equipmentSharePercent?: number;
};

/** 精鋭の銘。既存の敵に一つの性質を足し、良い品を抱えさせる。 */
export type EliteAffixConfig = {
  prefix: string;
  hpScale: number;
  attackBonus: number;
  defenseBonus: number;
  xpScale: number;
  behavior: MonsterBehavior;
};

/** 職業の基礎能力。stats は装備を含まない素の値で、growth はレベルごとの伸び。 */
type RoleDefinition = {
  id: string;
  stats: Stats;
  growth: { maxHp: number; attack: number; defense: number };
  inventory: InventoryEntry[];
  traits: RoleTraits;
};

export type WeaponTypeConfig = {
  label: string;
  description: string;
  /** 構えの隙（recovery）を突いた時の追加ダメージ倍率。 */
  openingMultiplier?: number;
  /** 近接で殴られた時に返す確率と威力。 */
  counterChancePercent?: number;
  counterScale?: number;
  /** 間合い攻撃（shoot）が届く距離。槍は2。 */
  reach?: number;
  /** 槍が後ろの敵へ通す威力。 */
  pierceScale?: number;
  /** 斧が隣の敵をなぎ払う威力。 */
  cleaveScale?: number;
  /** 1回の攻撃での打撃数と、1打あたりの威力。 */
  strikes?: number;
  strikeScale?: number;
  /** 気づいていない・構え中・隙のある敵への倍率。 */
  backstabMultiplier?: number;
  /** 敵の防御を無視する割合。 */
  defenseIgnorePercent?: number;
  /** 打撃で敵を怯ませる確率。 */
  dazeChancePercent?: number;
};

/** 装備の印。武器・防具・盾のいずれかに刻まれ、組み合わせで戦い方が変わる。 */
export type SealConfig = {
  glyph: string;
  label: string;
  description: string;
  slots: Array<"weapon" | "armor" | "shield">;
  weight: number;
  minFloor?: number;
  powerDelta?: number;
  bonusVsFamilies?: { amount: number; families: EnemyFamily[] };
  drainPercent?: number;
  critPercent?: number;
  critMultiplier?: number;
  inflict?: { kind: ConditionKind; turns: number; chancePercent: number };
  dazeChancePercent?: number;
  trapAvoidPercent?: number;
  thorns?: number;
  regen?: { everyTurns: number; amount: number };
  resist?: ConditionKind[];
  rangedDefense?: number;
  rustproof?: boolean;
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
  slot: EquipmentSlot;
  power: number;
  tier?: "early" | "mid" | "late";
  weaponType?: WeaponType;
  sealSlots?: number;
  innateSeals?: string[];
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
    /** 生成時に眠っている敵の割合。 */
    sleepingMonsterPercent: number;
    guardedDefenseBonus: number;
    moonlitMailRegenEveryTurns: number;
    moonlitMailRegenAmount: number;
    bleedingDamage: number;
    venomedDamage: number;
    /** 看破された敵が受ける傷の倍率（%）。 */
    exposedDamagePercent: number;
    /** 矢の威力 = 攻撃 + 弓の張り - この値。 */
    bowDamageOffset: number;
    /** この階数ごとに出血・毒のダメージが1増える。 */
    conditionDamageFloors?: number;
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
  biomes: Array<{ theme: BiomeTheme; minFloor: number; nameJa: string; roomWidth?: [number, number]; roomHeight?: [number, number]; density?: number; monsterHpPercent?: number; monsterAttackBonus?: number }>;
  roles: RoleDefinition[];
  monsterSpawnRules: MonsterSpawnRule[];
  monsterStats: Record<string, MonsterStatsConfig>;
  itemPools: Array<FloorRule & { items: string[] }>;
  guaranteedItems: Array<FloorRule & { items: string[] }>;
  /** 階ごとに必ず置く装備の枠。中身は格と部位から抽選し、探索者の得意な型へ寄せる確率を持つ。 */
  guaranteedEquipment: Array<FloorRule & { slot: EquipmentSlot; tier: "early" | "mid" | "late"; favoredChancePercent?: number }>;
  weaponTypes: Record<WeaponType, WeaponTypeConfig>;
  skills: Record<SkillId, SkillConfig>;
  legacies: Record<string, LegacyConfig>;
  monsterBehaviors: Record<string, MonsterBehavior>;
  omens: { chanceByFloor: Array<{ maxFloor: number; percent: number }>; definitions: Record<string, OmenConfig> };
  elites: { chanceByFloor: Array<{ maxFloor: number; percent: number }>; affixes: Record<string, EliteAffixConfig> };
  seals: Record<string, SealConfig>;
  equipmentRolls: {
    plus: Array<{ maxFloor: number; weights: Record<string, number> }>;
    sealChancePercent: number;
    sealChancePerFloor: number;
    secondSealChancePercent: number;
    forgeMaxPlus: number;
  };
  eventPools: Array<FloorRule & { events: string[] }>;
  trapPools: Array<FloorRule & { traps: string[] }>;
  /** 守り手の候補。同じ階の候補から遠征ごとに一体を選ぶ。overrideOnly は周期の余波でだけ現れる。 */
  bosses: Array<{ floor: number; contentId: string; reward?: string; equipmentTier?: "early" | "mid" | "late"; overrideOnly?: boolean }>;
  /** 守り手の階ごとの締め付け。候補の違いに関わらず、その階の山場の高さをそろえる。 */
  bossFloorScaling?: Record<string, { hpPercent: number; attackBonus: number }>;
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
  /** 床の装備の修正値と印。拾うと所持品へ移る。 */
  plus?: number;
  seals?: string[];
  /** 探索者に気づいた敵。気づく前は動かず、不意打ちを受ける。 */
  alerted?: boolean;
  /** 眠っている敵。隣で騒ぐか攻撃されるまで動かない。 */
  asleep?: boolean;
  /** 崩れて蠢いている亡者。残り手数で起き上がる。 */
  dormant?: number;
  revived?: boolean;
  splitGeneration?: number;
  /** 盗みを働いて逃げている敵。 */
  fleeing?: boolean;
  /** 待ち伏せの敵が起きた直後の重い一撃。 */
  ambushReady?: boolean;
  /** 精鋭の銘。 */
  elite?: string;
  enraged?: boolean;
  /** 呼び出された手下。 */
  summonedBy?: string;
  /** 探索者の固有技が再び使えるまでの手数。 */
  skillCooldown?: number;
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
  /** この階の兆し。 */
  floorOmen?: string;
  /** この階の守り手。 */
  floorBossId?: string;
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
  /** 職業の固有技。対象が要らない技では targetId を省く。 */
  | { type: "skill"; targetId?: string }
  | { type: "merchantService"; serviceId: MerchantServiceId }
  | { type: "descend" }
  | { type: "resolveDecision"; optionId: string; tactics?: string[] }
  /** 灯守（観戦者）の介入。探索者の手番を消費しない。 */
  | { type: "invokeLantern"; rite: LanternRiteId }
  | { type: "placeLantern"; pos?: Point }
  | { type: "borrowFlame" };

type VisibleEntity = Pick<Entity, "id" | "kind" | "contentId" | "pos" | "stats" | "hostile" | "blocksMovement" | "goldAmount" | "conditions" | "telegraph" | "recoveryTurns" | "awakened" | "plus" | "seals" | "alerted" | "asleep" | "dormant" | "fleeing" | "elite" | "enraged">;

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
  floorOmen?: string;
};

export type DeathCause = "combat" | "rangedCombat" | "trap" | "bleeding" | "venom" | "signalLoss" | "unknown";

export type LessonId = "ranged" | "care" | "traps";
export type LastMoment = { action: string; hp: number; pos: Point };
export type AttackTelegraph = { kind: "shot" | "sweep" | "hex" | "charge"; tiles: Point[]; remaining: number; origin: Point };
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
