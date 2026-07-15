import { getGameConfig } from "../content/config";
import { contentEntities } from "../content/entities";
import type {
  CampaignState,
  DecisionOption,
  DirectiveId,
  EndingId,
  ExpeditionRecord,
  GameAction,
  GameObservation,
  GameState,
  PendingDecision,
  RoleTruthId,
  RunIdentity,
  RunStoryState,
  ScoreBreakdown,
  TemperamentId,
} from "../types";

export type DecisionPolicy = "temperament" | "always-continue" | "return-3" | "return-6";

const names = [
  "アデル", "イーラ", "ヴァルド", "エノラ", "カイム", "シグ", "セラ", "トルヴァ", "ネリ", "ハルド", "ミレア", "ルーク",
];

const temperaments: TemperamentId[] = ["cautious", "seeker", "bold"];

export function createRunIdentity(seed: number, roleId: string): RunIdentity {
  const value = stableHash(`${seed}:${roleId}`);
  return {
    name: names[value % names.length],
    roleId,
    temperament: temperaments[Math.floor(value / names.length) % temperaments.length],
  };
}

export function createRunStoryState(): RunStoryState {
  return {
    maxFloorReached: 1,
    bossesDefeated: 0,
    discoveries: [],
    decisions: [],
    contextActs: [],
    turnWarningShown: false,
  };
}

export function temperamentLabel(temperament: TemperamentId): string {
  if (temperament === "cautious") return "慎重";
  if (temperament === "seeker") return "探究";
  return "剛胆";
}

export function temperamentDescription(temperament: TemperamentId): string {
  if (temperament === "cautious") return "傷と罠を重く見て、生還を優先する。";
  if (temperament === "seeker") return "遺物と碑文を追い、危険な寄り道も選ぶ。";
  return "敵と守り手へ向かい、短い手数での突破を狙う。";
}

export function directiveLabel(directive: DirectiveId): string {
  if (directive === "survival") return "生還";
  if (directive === "discovery") return "探究";
  return "征圧";
}

export function defaultDirectiveForTemperament(temperament: TemperamentId): DirectiveId {
  if (temperament === "cautious") return "survival";
  if (temperament === "seeker") return "discovery";
  return "conquest";
}

export function roleTruthFor(roleId: string): RoleTruthId {
  if (roleId === "role.ash-scout") return "furnace-map";
  if (roleId === "role.lantern-priest") return "purified-flame";
  return "shared-oath";
}

export function roleTruthLabel(truthId: RoleTruthId): string {
  if (truthId === "shared-oath") return "分誓の碑文";
  if (truthId === "furnace-map") return "炉脈全図";
  return "浄火の祈り";
}

export function endingLabel(endingId: EndingId): string {
  if (endingId === "inherit-flame") return "継燭";
  if (endingId === "extinguish-flame") return "消燭";
  return "分灯";
}

export function createCheckpointDecision(state: GameState): PendingDecision {
  const defaultDirective = defaultDirectiveForTemperament(state.runIdentity.temperament);
  const cautiousReturn = state.floor === 6 && state.runIdentity.temperament === "cautious";
  const options: DecisionOption[] = [
    {
      id: "return",
      label: cautiousReturn ? "気質に任せる: 帰還" : "ここで帰還する",
      description: state.floor === 6 && state.story.carriedTruthId
        ? `${roleTruthLabel(state.story.carriedTruthId)}を持ち帰り、戦果と得点を確定する。`
        : "探索者を生還させ、ここまでの戦果と得点を確定する。",
      outcome: "return",
    },
    ...directiveOptions(defaultDirective, cautiousReturn),
  ];
  return {
    id: `checkpoint-${state.floor}`,
    kind: "checkpoint",
    floor: state.floor,
    title: state.floor === 3 ? "第一の灯路" : "墓所の帰還路",
    body: state.floor === 3
      ? "守り手が倒れ、灰灯院へ戻る灯路と、墓所へ続く階段が同時に開いた。"
      : "黒石巨像の炉心から職業固有の真相が現れた。持ち帰るか、さらに深部へ運ぶかを選ぶ。",
    defaultOptionId: cautiousReturn ? "return" : `continue-${defaultDirective}`,
    resume: "descend",
    options,
  };
}

export function createContextDecision(state: GameState, act: 1 | 2, sourceId = "black-candle-echo"): PendingDecision {
  const defaultDirective = defaultDirectiveForTemperament(state.runIdentity.temperament);
  const title = act === 1 ? "墓所から届く残響" : "炉脈を走る黒い火";
  const body = act === 1
    ? "死者の記憶が黒燭越しに流れ込む。探索者は足を止め、どの声を追うか迷っている。"
    : "地上へ伸びる炉脈と、封印を守る敵影が同時に見えた。次に重く見るものを決める時だ。";
  return {
    id: `context-${act}-${sourceId}`,
    kind: "context",
    floor: state.floor,
    title,
    body,
    defaultOptionId: `continue-${defaultDirective}`,
    resume: "none",
    options: directiveOptions(defaultDirective),
  };
}

export function createFinalDecision(state: GameState): PendingDecision {
  const availableTruths = state.story.carriedTruthId ? [...state.knownRoleTruths, state.story.carriedTruthId] : state.knownRoleTruths;
  const hasAllTruths = ["shared-oath", "furnace-map", "purified-flame"].every((truth) => availableTruths.includes(truth as RoleTruthId));
  if (hasAllTruths) {
    return {
      id: "final-ending",
      kind: "final",
      floor: state.floor,
      title: "黒燭の行方",
      body: "三つの真相が黒燭中枢で重なった。灯守は封印の未来を決められる。",
      defaultOptionId: "ending-divide-flame",
      resume: "none",
      options: [
        finalEndingOption("inherit-flame", "探索者一人を次の番人として黒燭へ残す。"),
        finalEndingOption("extinguish-flame", "封印を壊し、無明の王との戦いを地上へ移す。"),
        finalEndingOption("divide-flame", "三つの真相を用い、封印を地上の灯火へ分ける。"),
      ],
    };
  }
  return {
    id: "final-core",
    kind: "final",
    floor: state.floor,
    title: "黒燭核をどう扱うか",
    body: "番人は倒れたが、黒燭の本体は再び形を取り始めている。核片だけは地上へ持ち帰れる。",
    defaultOptionId: "core-research",
    resume: "none",
    options: [
      { id: "core-research", label: "研究へ封じる", description: "得点より真相を優先し、灰灯院の新しい啓示を開く。", outcome: "research" },
      { id: "core-relic", label: "戦果として持ち帰る", description: "黒燭核を遺物として回収し、持帰り得点へ加える。", outcome: "relic" },
    ],
  };
}

function finalEndingOption(endingId: EndingId, description: string): DecisionOption {
  return { id: `ending-${endingId}`, label: endingLabel(endingId), description, outcome: "ending", endingId };
}

function directiveOptions(defaultDirective: DirectiveId, forceRevelation = false): DecisionOption[] {
  return (["survival", "discovery", "conquest"] as DirectiveId[]).map((directive) => ({
    id: `continue-${directive}`,
    label: directive === defaultDirective && !forceRevelation ? `見守る: ${directiveLabel(directive)}` : `啓示: ${directiveLabel(directive)}`,
    description: directiveDescription(directive),
    outcome: "continue" as const,
    directive,
    requiresRevelation: forceRevelation || directive !== defaultDirective,
  }));
}

function directiveDescription(directive: DirectiveId): string {
  if (directive === "survival") return "回復と危険回避を早め、戦果より生還を優先する。";
  if (directive === "discovery") return "遺物、地図、碑文を優先し、制御できる危険を受け入れる。";
  return "敵、守り手、階段を優先し、少ない手数で深部を目指す。";
}

export function chooseDecisionAction(observation: GameObservation, policy: DecisionPolicy): GameAction {
  const decision = observation.pendingDecision;
  if (!decision) return { type: "wait" };
  if (policy === "return-3" && decision.id === "checkpoint-3") return { type: "resolveDecision", optionId: "return" };
  if (policy === "return-6" && decision.id === "checkpoint-6") return { type: "resolveDecision", optionId: "return" };
  if (policy === "always-continue" && decision.kind !== "final") {
    const preferred = decision.options.find((option) => option.outcome === "continue" && !option.requiresRevelation)
      ?? decision.options.find((option) => option.outcome === "continue" && observation.revelationsRemaining > 0);
    return { type: "resolveDecision", optionId: preferred?.id ?? decision.defaultOptionId };
  }
  return { type: "resolveDecision", optionId: decision.defaultOptionId };
}

export function calculateScore(state: GameState): ScoreBreakdown {
  const config = getGameConfig().autonomous.scoring;
  const player = state.entities.find((entity) => entity.id === state.playerId);
  const survived = state.status === "returned" || state.status === "won";
  const recoveredRaw = survived
    ? state.playerProgress.gold + (player?.inventory ?? []).reduce((sum, entry) => sum + (contentEntities[entry.contentId]?.balance.economyValue ?? 0) * entry.quantity, 0)
    : 0;
  const depth = state.story.maxFloorReached * config.depthPerFloor;
  const guardians = state.story.bossesDefeated * config.guardian;
  const roleObjective = Math.min(state.runObjectives.roleGoalProgress, config.roleObjectiveCap) * config.roleObjective;
  const discoveries = Math.min(state.story.discoveries.length, config.discoveryCap) * config.discovery;
  const survival = state.status === "won" ? config.won : state.status === "returned" ? config.returned : 0;
  const recoveredValue = Math.min(config.recoveredValueCap, recoveredRaw);
  const tempo = Math.min(config.tempoCap, Math.max(0, state.story.maxFloorReached * config.tempoParPerFloor - state.runTurn) * config.tempoPerTurn);
  const autonomy = state.revelationsRemaining * config.unusedRevelation;
  const total = depth + guardians + roleObjective + discoveries + survival + recoveredValue + tempo + autonomy;
  return { depth, guardians, roleObjective, discoveries, survival, recoveredValue, tempo, autonomy, total };
}

export function createCampaignState(): CampaignState {
  return {
    version: 1,
    roleTruths: [],
    loreDiscoveries: [],
    unlockedDirectives: ["survival", "discovery", "conquest"],
    endingsSeen: [],
    expeditions: [],
    bestScoresByRole: {},
  };
}

export function normalizeCampaignState(value: unknown): CampaignState {
  if (!value || typeof value !== "object" || (value as { version?: unknown }).version !== 1) return createCampaignState();
  const input = value as Partial<CampaignState>;
  return {
    version: 1,
    roleTruths: unique((input.roleTruths ?? []).filter(isRoleTruthId)),
    loreDiscoveries: unique((input.loreDiscoveries ?? []).filter((entry): entry is string => typeof entry === "string")),
    unlockedDirectives: unique((input.unlockedDirectives ?? ["survival", "discovery", "conquest"]).filter(isDirectiveId)),
    endingsSeen: unique((input.endingsSeen ?? []).filter(isEndingId)),
    expeditions: Array.isArray(input.expeditions) ? input.expeditions.slice(0, 100) as ExpeditionRecord[] : [],
    bestScoresByRole: input.bestScoresByRole && typeof input.bestScoresByRole === "object" ? input.bestScoresByRole : {},
  };
}

export function recordCampaignResult(campaign: CampaignState, state: GameState, deathCause: string | null): CampaignState {
  if (state.status === "playing") return campaign;
  const score = calculateScore(state);
  const truthRecovered = (state.status === "won" || state.status === "returned") ? state.story.carriedTruthId : undefined;
  const record: ExpeditionRecord = {
    id: `${state.seed}-${state.runIdentity.roleId}-${state.runTurn}-${state.status}`,
    completedAt: new Date().toISOString(),
    seed: state.seed,
    identity: { ...state.runIdentity },
    status: state.status,
    floor: state.story.maxFloorReached,
    runTurn: state.runTurn,
    score,
    decisions: state.story.decisions.map((entry) => ({ ...entry })),
    deathCause,
    truthRecovered,
    endingId: state.story.endingId,
  };
  return {
    version: 1,
    roleTruths: truthRecovered ? unique([...campaign.roleTruths, truthRecovered]) : [...campaign.roleTruths],
    loreDiscoveries: unique([...campaign.loreDiscoveries, ...state.story.discoveries]),
    unlockedDirectives: [...campaign.unlockedDirectives],
    endingsSeen: state.story.endingId ? unique([...campaign.endingsSeen, state.story.endingId]) : [...campaign.endingsSeen],
    expeditions: [record, ...campaign.expeditions].slice(0, 100),
    bestScoresByRole: {
      ...campaign.bestScoresByRole,
      [state.runIdentity.roleId]: Math.max(campaign.bestScoresByRole[state.runIdentity.roleId] ?? 0, score.total),
    },
  };
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function isRoleTruthId(value: unknown): value is RoleTruthId {
  return value === "shared-oath" || value === "furnace-map" || value === "purified-flame";
}

function isDirectiveId(value: unknown): value is DirectiveId {
  return value === "survival" || value === "discovery" || value === "conquest";
}

function isEndingId(value: unknown): value is EndingId {
  return value === "inherit-flame" || value === "extinguish-flame" || value === "divide-flame";
}
