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
  MissionId,
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

export type MissionDefinition = {
  id: MissionId;
  label: string;
  description: string;
  targetLabel: string;
  rewardLabel: string;
};

export const expeditionMissions: MissionDefinition[] = [
  {
    id: "guardian-vow",
    label: "守り手の誓約",
    description: "二体の階層守護者を倒し、黒燭中枢へ封鎖突破の証を運ぶ。",
    targetLabel: "守護者2体撃破後、F10到達",
    rewardLabel: "紅蓮の大薬瓶",
  },
  {
    id: "relic-ledger",
    label: "遺物台帳の補完",
    description: "六種の出来事を記録し、灰灯院の欠落した台帳を埋める。",
    targetLabel: "発見 6種",
    rewardLabel: "啓示 +1",
  },
  {
    id: "swift-route",
    label: "灯路の先駆け",
    description: "700手以内に第六階へ到達し、短い帰還路を確立する。",
    targetLabel: "700手以内に第6階",
    rewardLabel: "退き風の巻物",
  },
];

export function createRunIdentity(seed: number, roleId: string): RunIdentity {
  const value = stableHash(`${seed}:${roleId}`);
  return {
    name: names[value % names.length],
    roleId,
    temperament: temperaments[Math.floor(value / names.length) % temperaments.length],
  };
}

export function createRunStoryState(missionId: MissionId = "guardian-vow"): RunStoryState {
  return {
    missionId,
    missionCompleted: false,
    maxFloorReached: 1,
    bossesDefeated: 0,
    discoveries: [],
    decisions: [],
    contextActs: [],
    crisisKinds: [],
    interventionScore: 0,
    turnWarningShown: false,
  };
}

export function missionDefinition(missionId: MissionId): MissionDefinition {
  return expeditionMissions.find((mission) => mission.id === missionId) ?? expeditionMissions[0];
}

export function defaultMissionForTemperament(temperament: TemperamentId): MissionId {
  if (temperament === "cautious") return "swift-route";
  if (temperament === "seeker") return "relic-ledger";
  return "guardian-vow";
}

export function missionProgress(state: GameState): { current: number; target: number; completed: boolean; missed: boolean } {
  if (state.story.missionId === "guardian-vow") {
    const current = Math.min(2, state.story.bossesDefeated) + (state.story.maxFloorReached >= 10 ? 1 : 0);
    return { current, target: 3, completed: state.story.bossesDefeated >= 2 && state.story.maxFloorReached >= 10, missed: false };
  }
  if (state.story.missionId === "relic-ledger") {
    return { current: Math.min(6, state.story.discoveries.length), target: 6, completed: state.story.discoveries.length >= 6, missed: false };
  }
  const reached = state.story.maxFloorReached >= 6 && state.runTurn <= 700;
  return { current: reached ? 6 : Math.min(6, state.story.maxFloorReached), target: 6, completed: reached, missed: state.runTurn > 700 && !reached };
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

function roleTruthLabel(truthId: RoleTruthId): string {
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
  const crisis = crisisDecisionFor(state, act);
  return { ...crisis, id: `context-${act}-${crisis.id}-${sourceId}` };
}

function crisisDecisionFor(state: GameState, act: 1 | 2): PendingDecision {
  const player = state.entities.find((entity) => entity.id === state.playerId);
  const hpRatio = player?.stats ? player.stats.hp / player.stats.maxHp : 1;
  const hasAffliction = player?.conditions?.some((condition) => condition.kind === "bleeding" || condition.kind === "venomed") ?? false;
  const rangedThreats = state.entities.filter((entity) => entity.kind === "monster" && getGameConfig().rangedMonsters.includes(entity.contentId)).length;
  const inventoryCount = player?.inventory?.reduce((sum, entry) => sum + entry.quantity, 0) ?? 0;

  if (hpRatio <= 0.52) return woundedCrisis(state, act);
  if (hasAffliction) return afflictionCrisis(state, act);
  if (rangedThreats >= 2) return rangedCrisis(state, act);
  if (inventoryCount >= 12 || state.playerProgress.gold >= 90) return burdenCrisis(state, act);
  if (act === 2 && state.runTurn >= 1050) return fadingRouteCrisis(state);
  return act === 1 ? memoryCrisis(state) : furnaceCrisis(state);
}

function crisisBase(state: GameState, id: string, title: string, body: string, options: DecisionOption[]): PendingDecision {
  const defaultDirective = defaultDirectiveForTemperament(state.runIdentity.temperament);
  const defaultOption = options.find((option) => option.directive === defaultDirective && !option.requiresRevelation) ?? options[0];
  return { id, kind: "context", floor: state.floor, title, body, defaultOptionId: defaultOption.id, resume: "none", options };
}

function woundedCrisis(state: GameState, act: 1 | 2): PendingDecision {
  return crisisBase(state, "wounded", "薄れる命火", "黒燭に映る探索者の命火が細い。先を急げば真相へ近づくが、次の戦闘に耐えられる保証はない。", [
    { id: "wounded-rest", label: "安全な陰で休ませる", description: "12HPを回復し、生還を優先する。", outcome: "continue", directive: "survival", effect: { heal: 12 } },
    { id: "wounded-bargain", label: "血を灯へ変える", description: "最大HPを4失う代わりに20HPを回復し、探索を続ける。", outcome: "continue", directive: "discovery", effect: { maxHpCost: 4, heal: 20 } },
    { id: "wounded-revelation", label: "啓示で傷を封じる", description: "啓示を使い、18HP回復と12ターンの護りを得る。", outcome: "continue", directive: act === 1 ? "discovery" : "conquest", requiresRevelation: true, effect: { heal: 18, guardedTurns: 12 } },
  ]);
}

function afflictionCrisis(state: GameState, act: 1 | 2): PendingDecision {
  return crisisBase(state, "affliction", "血と毒の残響", "出血か毒が黒燭の像を濁らせている。痛みを受け入れるか、足を止めて処置するかを決めなければならない。", [
    { id: "affliction-cure", label: "傷を清める", description: "状態異常を除き、8HPを回復する。", outcome: "continue", directive: "survival", effect: { cureConditions: true, heal: 8 } },
    { id: "affliction-map", label: "痛みを道標にする", description: "周囲12マスを記録し、探究を続ける。", outcome: "continue", directive: "discovery", effect: { revealRadius: 12 } },
    { id: "affliction-revelation", label: "啓示で穢れを焼く", description: "啓示を使い、状態異常を除いて16ターン護る。", outcome: "continue", directive: act === 1 ? "discovery" : "conquest", requiresRevelation: true, effect: { cureConditions: true, guardedTurns: 16 } },
  ]);
}

function rangedCrisis(state: GameState, act: 1 | 2): PendingDecision {
  return crisisBase(state, "ranged", "射線の向こうの火", "複数の遠隔攻撃者が通路の先を押さえている。黒燭には、遮蔽へ潜る道と敵陣を崩す瞬間が同時に映った。", [
    { id: "ranged-cover", label: "遮蔽を渡らせる", description: "12ターンの護りを得て、安全な進路を優先する。", outcome: "continue", directive: "survival", effect: { guardedTurns: 12 } },
    { id: "ranged-survey", label: "射手の位置を記す", description: "周囲10マスを記録し、探索経路を組み直す。", outcome: "continue", directive: "discovery", effect: { revealRadius: 10 } },
    { id: "ranged-revelation", label: "啓示で射線を砕く", description: "啓示を使って見えている敵を押し戻し、征圧へ転じる。", outcome: "continue", directive: act === 1 ? "conquest" : defaultDirectiveForTemperament(state.runIdentity.temperament), requiresRevelation: true, effect: { pushVisibleMonsters: true, guardedTurns: 8 } },
  ]);
}

function burdenCrisis(state: GameState, act: 1 | 2): PendingDecision {
  const offering = Math.min(40, state.playerProgress.gold);
  return crisisBase(state, "burden", "持ち帰るものの重さ", "遺物と古銭が足取りを鈍らせる。戦果を守るか、一部を灯路へ捧げて先を急ぐか。", [
    { id: "burden-guard", label: "戦果を抱えて進む", description: "生還を優先し、10ターンの護りを得る。", outcome: "continue", directive: "survival", effect: { guardedTurns: 10 } },
    { id: "burden-offer", label: `${offering}Gを灯路へ捧げる`, description: "古銭を失う代わりに周囲14マスを記録する。", outcome: "continue", directive: "discovery", effect: { goldCost: offering, revealRadius: 14 } },
    { id: "burden-revelation", label: "啓示で荷を軽くする", description: "啓示を使って敵を退け、征圧の速度を保つ。", outcome: "continue", directive: act === 1 ? "conquest" : defaultDirectiveForTemperament(state.runIdentity.temperament), requiresRevelation: true, effect: { pushVisibleMonsters: true, guardedTurns: 8 } },
  ]);
}

function fadingRouteCrisis(state: GameState): PendingDecision {
  return crisisBase(state, "fading-route", "途切れかけた灯路", "長い遠征で地上との像が揺らいでいる。このままでは黒燭との接続そのものが切れる。", [
    { id: "route-stabilize", label: "灯路を安定させる", description: "16ターンの護りを得て、生還可能性を優先する。", outcome: "continue", directive: "survival", effect: { guardedTurns: 16 } },
    { id: "route-chart", label: "残像を地図へ焼く", description: "周囲16マスを記録し、階段への道を探す。", outcome: "continue", directive: "discovery", effect: { revealRadius: 16 } },
    { id: "route-revelation", label: "啓示で像を引き寄せる", description: "啓示を使い、敵を退けて18HP回復する。", outcome: "continue", directive: "conquest", requiresRevelation: true, effect: { heal: 18, pushVisibleMonsters: true } },
  ]);
}

function memoryCrisis(state: GameState): PendingDecision {
  return crisisBase(state, "memory", "墓所から届く残響", "死者の記憶が三つの道を映した。安全な巡礼路、碑文の眠る脇道、守り手へ続く近道だ。", [
    { id: "memory-safe", label: "巡礼路をたどる", description: "12HPを回復し、生還を優先する。", outcome: "continue", directive: "survival", effect: { heal: 12 } },
    { id: "memory-inscription", label: "碑文の脇道を記す", description: "周囲12マスを記録し、発見を優先する。", outcome: "continue", directive: "discovery", effect: { revealRadius: 12 } },
    { id: "memory-revelation", label: "啓示で近道を開く", description: "啓示を使い、見える敵を押し戻して征圧へ向かう。", outcome: "continue", directive: "conquest", requiresRevelation: true, effect: { pushVisibleMonsters: true, guardedTurns: 8 } },
  ]);
}

function furnaceCrisis(state: GameState): PendingDecision {
  return crisisBase(state, "furnace", "炉脈を走る黒い火", "炉脈が探索者の装備と傷を照らした。火を守りへ回すか、地図へ焼くか、敵陣へ放つか。", [
    { id: "furnace-ward", label: "火を鎧へ移す", description: "14ターンの護りを得て、生還を優先する。", outcome: "continue", directive: "survival", effect: { guardedTurns: 14 } },
    { id: "furnace-map", label: "炉脈を地図へ焼く", description: "周囲14マスを記録し、深部の発見を優先する。", outcome: "continue", directive: "discovery", effect: { revealRadius: 14 } },
    { id: "furnace-revelation", label: "啓示で黒火を放つ", description: "啓示を使い、敵を退けて10HP回復する。", outcome: "continue", directive: "conquest", requiresRevelation: true, effect: { pushVisibleMonsters: true, heal: 10 } },
  ]);
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
    ? state.playerProgress.gold + (player?.inventory ?? []).reduce((sum, entry) => sum + (contentEntities[entry.contentId]?.economyValue ?? 0) * entry.quantity, 0)
    : 0;
  const depth = state.story.maxFloorReached * config.depthPerFloor;
  const guardians = state.story.bossesDefeated * config.guardian;
  const roleObjective = Math.min(state.runObjectives.roleGoalProgress, config.roleObjectiveCap) * config.roleObjective;
  const discoveries = Math.min(state.story.discoveries.length, config.discoveryCap) * config.discovery;
  const survival = state.status === "won" ? config.won : state.status === "returned" ? config.returned : 0;
  const recoveredValue = Math.min(config.recoveredValueCap, recoveredRaw);
  const tempo = Math.min(config.tempoCap, Math.max(0, state.story.maxFloorReached * config.tempoParPerFloor - state.runTurn) * config.tempoPerTurn);
  const autonomy = (state.story.missionCompleted ? config.missionCompleted : 0) + state.story.interventionScore;
  const total = depth + guardians + roleObjective + discoveries + survival + recoveredValue + tempo + autonomy;
  return { depth, guardians, roleObjective, discoveries, survival, recoveredValue, tempo, autonomy, total };
}

export function createCampaignState(): CampaignState {
  return {
    version: 2,
    roleTruths: [],
    expeditions: [],
  };
}

export function normalizeCampaignState(value: unknown): CampaignState {
  if (!value || typeof value !== "object") return createCampaignState();
  const version = (value as { version?: unknown }).version;
  if (version !== 1 && version !== 2) return createCampaignState();
  const input = value as { roleTruths?: unknown; expeditions?: unknown };
  const roleTruths = Array.isArray(input.roleTruths) ? input.roleTruths.filter(isRoleTruthId) : [];
  const expeditions = Array.isArray(input.expeditions)
    ? input.expeditions.flatMap((entry) => normalizeExpeditionRecord(entry)).slice(0, 100)
    : [];
  return {
    version: 2,
    roleTruths: unique(roleTruths),
    expeditions,
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
    missionId: state.story.missionId,
    missionCompleted: state.story.missionCompleted,
    discoveryCount: state.story.discoveries.length,
    interventionCount: state.story.decisions.filter((entry) => entry.effectSummary && entry.usedRevelation).length,
    truthRecovered,
    endingId: state.story.endingId,
  };
  return {
    version: 2,
    roleTruths: truthRecovered ? unique([...campaign.roleTruths, truthRecovered]) : [...campaign.roleTruths],
    expeditions: [record, ...campaign.expeditions].slice(0, 100),
  };
}

export type CampaignProgress = {
  highestFloor: number;
  bestScore: number;
  completedRuns: number;
  completedMissionIds: MissionId[];
  endingIds: EndingId[];
  milestones: Array<{ label: string; unlocked: boolean }>;
};

export function campaignProgress(campaign: CampaignState): CampaignProgress {
  const highestFloor = campaign.expeditions.reduce((best, record) => Math.max(best, record.floor), 0);
  const bestScore = campaign.expeditions.reduce((best, record) => Math.max(best, record.score.total), 0);
  const completedRuns = campaign.expeditions.filter((record) => record.status === "won").length;
  const completedMissionIds = unique(campaign.expeditions.filter((record) => record.missionCompleted).map((record) => record.missionId));
  const endingIds = unique(campaign.expeditions.flatMap((record) => record.endingId ? [record.endingId] : []));
  return {
    highestFloor,
    bestScore,
    completedRuns,
    completedMissionIds,
    endingIds,
    milestones: [
      { label: "初遠征", unlocked: campaign.expeditions.length > 0 },
      { label: "第一灯路", unlocked: highestFloor >= 4 },
      { label: "真相回収", unlocked: campaign.roleTruths.length > 0 },
      { label: "黒燭中枢", unlocked: highestFloor >= 10 },
      { label: "三つの真相", unlocked: campaign.roleTruths.length >= 3 },
      { label: "結末", unlocked: endingIds.length > 0 },
    ],
  };
}

function normalizeExpeditionRecord(value: unknown): ExpeditionRecord[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Partial<ExpeditionRecord>;
  if (!record.id || !record.identity || !record.score || !record.status || typeof record.floor !== "number") return [];
  const missionId = isMissionId(record.missionId) ? record.missionId : defaultMissionForTemperament(record.identity.temperament);
  const decisions = Array.isArray(record.decisions) ? record.decisions.map((entry) => ({ ...entry })) : [];
  return [{
    ...record,
    completedAt: record.completedAt ?? new Date(0).toISOString(),
    seed: record.seed ?? 0,
    runTurn: record.runTurn ?? 0,
    decisions,
    deathCause: record.deathCause ?? null,
    missionId,
    missionCompleted: record.missionCompleted ?? false,
    discoveryCount: record.discoveryCount ?? 0,
    interventionCount: record.interventionCount ?? decisions.filter((entry) => entry.usedRevelation && entry.id.startsWith("context-")).length,
  } as ExpeditionRecord];
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

function isMissionId(value: unknown): value is MissionId {
  return value === "guardian-vow" || value === "relic-ledger" || value === "swift-route";
}
