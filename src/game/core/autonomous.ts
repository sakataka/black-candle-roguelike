import { journeyProgress, journeyTotals } from "./journey";
import { getGameConfig, runRules } from "../content/config";
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
  FacilityId,
  FallenDelver,
  GraveMarker,
  RunModifiers,
  RunRuleKey,
  RoleTruthId,
  RunIdentity,
  RunStoryState,
  ShardBreakdown,
  TemperamentId,
  Veteran,
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
  /** 達成条件を一行で。報酬は生還して初めて灯片として受け取る。 */
  targetLabel: string;
};

export const expeditionMissions: MissionDefinition[] = [
  {
    id: "truth-return",
    label: "真相を持ち帰る",
    description: "第六階の守り手を倒すと、職業ごとの真相が現れる。抱えたまま灰灯院へ帰れば記録される。",
    targetLabel: "第六階の守り手を倒し、生きて帰る",
  },
  {
    id: "black-core",
    label: "黒燭核を討つ",
    description: "帰還路を振り切って第十層へ降り、黒燭の番人を倒す。倒せば遠征は踏破で終わる。",
    targetLabel: "第十層の番人を倒す",
  },
  {
    id: "memorial",
    label: "先人を弔う",
    description: "倒れた探索者の墓標を見つけて弔い、遺品と教訓を持ち帰る。",
    targetLabel: "墓標を弔い、生きて帰る",
  },
  {
    id: "relic-ledger",
    label: "遺物台帳の補完",
    description: "迷宮の出来事を六種記録し、灰灯院の欠けた台帳を埋める。",
    targetLabel: "発見を6種記録し、生きて帰る",
  },
  {
    id: "swift-route",
    label: "灯路の先駆け",
    description: "700手以内に第六階へ到達し、帰還路への早い到達を目指す。",
    targetLabel: "700手以内に第六階へ到達し、生きて帰る",
  },
];

export type MissionAvailability = { roleId: string; knownRoleTruths: RoleTruthId[]; graveCount: number };

/** 支度画面で選べる任務。墓標がない時は弔いを出さない。 */
export function availableMissions(context: MissionAvailability): MissionDefinition[] {
  return expeditionMissions.filter((mission) => mission.id !== "memorial" || context.graveCount > 0);
}

/** 灰灯院の現状から、この探索者に勧める任務。「黒燭への道」の次の章に沿う。 */
export function recommendedMission(context: MissionAvailability): MissionId {
  if (!context.knownRoleTruths.includes(roleTruthFor(context.roleId))) return "truth-return";
  if (context.graveCount > 0) return "memorial";
  return "black-core";
}

export function createRunIdentity(seed: number, roleId: string, avoidNames: string[] = []): RunIdentity {
  const value = stableHash(`${seed}:${roleId}`);
  const offset = Array.from({ length: names.length }, (_, step) => step).find((step) => !avoidNames.includes(names[(value + step) % names.length])) ?? 0;
  return {
    name: names[(value + offset) % names.length],
    roleId,
    temperament: temperaments[Math.floor(value / names.length) % temperaments.length],
  };
}

export function createRunStoryState(missionId: MissionId = "black-core"): RunStoryState {
  return {
    missionId,
    missionCompleted: false,
    maxFloorReached: 1,
    bossesDefeated: 0,
    discoveries: [],
    decisions: [],
    contextActs: [],
    crisisKinds: [],
    turnWarningShown: false,
  };
}

export function missionDefinition(missionId: MissionId): MissionDefinition {
  return expeditionMissions.find((mission) => mission.id === missionId) ?? expeditionMissions[0];
}

export function missionShards(missionId: MissionId): number {
  return getGameConfig().campaign.missionShards[missionId] ?? 0;
}

/** バッチや観戦の既定任務。気質ごとの性向を任務として表す。 */
export function defaultMissionForTemperament(temperament: TemperamentId): MissionId {
  if (temperament === "cautious") return "truth-return";
  if (temperament === "seeker") return "relic-ledger";
  return "black-core";
}

export type MissionProgress = {
  current: number;
  target: number;
  /** 遠征中の条件を満たした。報酬は生還で確定する。 */
  completed: boolean;
  missed: boolean;
  /** 進捗の短い説明（例: 守り手 1/2）。 */
  label: string;
};

export function missionProgress(state: GameState): MissionProgress {
  const missionId = state.story.missionId;
  if (missionId === "truth-return") {
    const current = state.story.carriedTruthId ? 2 : Math.min(1, state.story.bossesDefeated);
    return { current, target: 2, completed: current >= 2, missed: false, label: current >= 2 ? "真相を抱えている" : `守り手 ${current}/2` };
  }
  if (missionId === "black-core") {
    const current = Math.min(10, state.story.maxFloorReached);
    const completed = state.status === "won";
    return { current: completed ? 10 : current, target: 10, completed, missed: false, label: completed ? "番人を倒した" : `第${current}階 / 10` };
  }
  if (missionId === "memorial") {
    const current = Math.min(1, state.story.recoveredGraves?.length ?? 0);
    const floors = state.modifiers.graves?.map((grave) => grave.floor).sort((a, b) => a - b) ?? [];
    return { current, target: 1, completed: current >= 1, missed: false, label: current >= 1 ? "弔いを終えた" : floors.length ? `墓標は第${floors.join("・")}階` : "墓標なし" };
  }
  if (missionId === "relic-ledger") {
    const current = Math.min(6, state.story.discoveries.length);
    return { current, target: 6, completed: current >= 6, missed: false, label: `発見 ${current}/6` };
  }
  const reached = state.story.missionCompleted || (state.story.maxFloorReached >= 6 && state.runTurn <= 700);
  const missed = !reached && state.runTurn > 700;
  return {
    current: reached ? 6 : Math.min(6, state.story.maxFloorReached),
    target: 6,
    completed: reached,
    missed,
    label: reached ? "第六階へ到達した" : missed ? "期限切れ" : `第${Math.min(6, state.story.maxFloorReached)}階 · 残り${Math.max(0, 700 - state.runTurn)}手`,
  };
}

/** 帰還路で探索者が自分で選ぶ既定。任務を果たしたら帰り、果たせていなければ進む。 */
export function missionWantsReturn(state: GameState): boolean {
  const progress = missionProgress(state);
  if (state.story.missionId === "black-core") return false;
  return progress.completed || progress.missed;
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

export const ROLE_TRUTH_IDS: RoleTruthId[] = ["shared-oath", "furnace-map", "purified-flame"];

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
  const wantsReturn = missionWantsReturn(state);
  const truth = state.floor === 6 && state.story.carriedTruthId ? roleTruthLabel(state.story.carriedTruthId) : null;
  const options: DecisionOption[] = [
    {
      id: "return",
      label: wantsReturn ? "任務を果たして帰還" : "ここで帰還する",
      description: truth
        ? `真相「${truth}」を記録し、灯片と古参の位階を確定する。`
        : "探索者を生還させ、ここまでの灯片と古参の位階を確定する。",
      outcome: "return",
    },
    ...directiveOptions(defaultDirective, wantsReturn),
  ];
  return {
    id: `checkpoint-${state.floor}`,
    kind: "checkpoint",
    floor: state.floor,
    title: state.floor === 3 ? "第一の帰還路" : "第二の帰還路",
    body: state.floor === 3
      ? "第三階の守り手が倒れ、灰灯院へ戻る灯路が開いた。帰れば戦果を確定できる。進めば墓所へ降りる。"
      : `第六階の守り手が倒れ、真相「${truth ?? roleTruthLabel(roleTruthFor(state.runIdentity.roleId))}」が現れた。持ち帰れば記録され、先へ運んで倒れれば失われる。`,
    defaultOptionId: wantsReturn ? "return" : `continue-${defaultDirective}`,
    resume: "descend",
    options,
  };
}

/** 三つの真相が揃っていれば、第十層の番人を倒した後に結末を選べる。 */
export function endingAvailable(state: Pick<GameState, "knownRoleTruths" | "story">): boolean {
  const truths = state.story.carriedTruthId ? [...state.knownRoleTruths, state.story.carriedTruthId] : state.knownRoleTruths;
  return ROLE_TRUTH_IDS.every((truth) => truths.includes(truth));
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
  if (act === 2 && state.runTurn >= runRules(state.modifiers).runTurnLimit - 550) return fadingRouteCrisis(state);
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
    { id: "wounded-revelation", label: "啓示で傷を封じる", description: "啓示を使い、18HP回復と12手の護りを得る。", outcome: "continue", directive: act === 1 ? "discovery" : "conquest", requiresRevelation: true, effect: { heal: 18, guardedTurns: 12 } },
  ]);
}

function afflictionCrisis(state: GameState, act: 1 | 2): PendingDecision {
  return crisisBase(state, "affliction", "血と毒の残響", "出血か毒が黒燭の像を濁らせている。痛みを道標に進むか、清めの灯を届けるか。伝言がなければ本人の判断で進む。", [
    { id: "affliction-cure", label: "傷を清める", description: "状態異常を除き、8HPを回復する。", outcome: "continue", directive: "survival", effect: { cureConditions: true, heal: 8 } },
    { id: "affliction-map", label: "痛みを道標にする", description: "周囲12マスを記録し、探究を続ける。", outcome: "continue", directive: "discovery", effect: { revealRadius: 12 } },
    { id: "affliction-revelation", label: "啓示で穢れを焼く", description: "啓示を使い、状態異常を除いて16手護る。", outcome: "continue", directive: act === 1 ? "discovery" : "conquest", requiresRevelation: true, effect: { cureConditions: true, guardedTurns: 16 } },
  ]);
}

function rangedCrisis(state: GameState, act: 1 | 2): PendingDecision {
  return crisisBase(state, "ranged", "射線の向こうの火", "複数の遠隔攻撃者が通路の先を押さえている。黒燭には、遮蔽へ潜る道と敵陣を崩す瞬間が同時に映った。", [
    { id: "ranged-cover", label: "遮蔽を渡らせる", description: "12手の護りを得て、安全な進路を優先する。", outcome: "continue", directive: "survival", effect: { guardedTurns: 12 } },
    { id: "ranged-survey", label: "射手の位置を記す", description: "周囲10マスを記録し、探索経路を組み直す。", outcome: "continue", directive: "discovery", effect: { revealRadius: 10 } },
    { id: "ranged-revelation", label: "啓示で射線を砕く", description: "啓示を使って見えている敵を押し戻し、征圧へ転じる。", outcome: "continue", directive: act === 1 ? "conquest" : defaultDirectiveForTemperament(state.runIdentity.temperament), requiresRevelation: true, effect: { pushVisibleMonsters: true, guardedTurns: 8 } },
  ]);
}

function burdenCrisis(state: GameState, act: 1 | 2): PendingDecision {
  const offering = Math.min(40, state.playerProgress.gold);
  return crisisBase(state, "burden", "持ち帰るものの重さ", "遺物と古銭が足取りを鈍らせる。戦果を守るか、一部を灯路へ捧げて先を急ぐか。", [
    { id: "burden-guard", label: "戦果を抱えて進む", description: "生還を優先し、10手の護りを得る。", outcome: "continue", directive: "survival", effect: { guardedTurns: 10 } },
    { id: "burden-offer", label: `${offering}Gを灯路へ捧げる`, description: "古銭を失う代わりに周囲14マスを記録する。", outcome: "continue", directive: "discovery", effect: { goldCost: offering, revealRadius: 14 } },
    { id: "burden-revelation", label: "啓示で荷を軽くする", description: "啓示を使って敵を退け、征圧の速度を保つ。", outcome: "continue", directive: act === 1 ? "conquest" : defaultDirectiveForTemperament(state.runIdentity.temperament), requiresRevelation: true, effect: { pushVisibleMonsters: true, guardedTurns: 8 } },
  ]);
}

function fadingRouteCrisis(state: GameState): PendingDecision {
  return crisisBase(state, "fading-route", "途切れかけた灯路", "長い遠征で地上との像が揺らいでいる。このままでは黒燭との接続そのものが切れる。", [
    { id: "route-stabilize", label: "灯路を安定させる", description: "16手の護りを得て、生還を優先する。", outcome: "continue", directive: "survival", effect: { guardedTurns: 16 } },
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
    { id: "furnace-ward", label: "火を鎧へ移す", description: "14手の護りを得て、生還を優先する。", outcome: "continue", directive: "survival", effect: { guardedTurns: 14 } },
    { id: "furnace-map", label: "炉脈を地図へ焼く", description: "周囲14マスを記録し、深部の発見を優先する。", outcome: "continue", directive: "discovery", effect: { revealRadius: 14 } },
    { id: "furnace-revelation", label: "啓示で黒火を放つ", description: "啓示を使い、敵を退けて10HP回復する。", outcome: "continue", directive: "conquest", requiresRevelation: true, effect: { pushVisibleMonsters: true, heal: 10 } },
  ]);
}

export function createFinalDecision(_state: GameState): PendingDecision {
  return {
    id: "final-ending",
    kind: "final",
    floor: _state.floor,
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

type ShardOutcome = "returned" | "won" | "lost";

/**
 * 遠征で持ち帰る灯片。到達・守り手・発見・弔いは倒れても一部が残る。
 * 生還・持ち帰り・任務・新しい真相は生きて帰った時だけ受け取る。
 */
export function calculateShards(state: GameState, outcome: ShardOutcome = shardOutcome(state)): ShardBreakdown {
  const config = getGameConfig().campaign;
  const rates = config.shards;
  const player = state.entities.find((entity) => entity.id === state.playerId);
  const survived = outcome !== "lost";
  const carriedValue = state.playerProgress.gold + (player?.inventory ?? []).reduce((sum, entry) => sum + (contentEntities[entry.contentId]?.economyValue ?? 0) * entry.quantity, 0);
  const keep = survived ? 1 : rates.keepPercentOnLoss / 100;
  const depth = Math.floor(state.story.maxFloorReached * rates.perFloor * keep);
  const guardians = Math.floor(state.story.bossesDefeated * rates.perGuardian * keep);
  const discoveries = Math.floor(Math.floor(state.story.discoveries.length / rates.discoveriesPerShard) * keep);
  const graves = Math.floor((state.story.recoveredGraves?.length ?? 0) * config.graveShards * keep);
  const survival = outcome === "won" ? rates.won : outcome === "returned" ? rates.returned : 0;
  const carried = survived ? Math.min(rates.carriedCap, Math.floor(carriedValue / rates.carriedValuePerShard)) : 0;
  const missionDone = state.story.missionCompleted || (state.story.missionId === "black-core" && outcome === "won");
  const mission = survived && missionDone ? missionShards(state.story.missionId) : 0;
  const truth = survived && state.story.carriedTruthId && !state.knownRoleTruths.includes(state.story.carriedTruthId) ? rates.newTruth : 0;
  const bonusPercent = runShardBonusPercent(state.modifiers.heat ?? 0, state.modifiers.aftermath);
  const base = depth + guardians + discoveries + graves + survival + carried + mission + truth;
  return { depth, guardians, discoveries, survival, carried, mission, truth, graves, bonusPercent, total: Math.floor(base * (100 + bonusPercent) / 100) };
}

function shardOutcome(state: GameState): ShardOutcome {
  return state.status === "won" ? "won" : state.status === "returned" ? "returned" : "lost";
}

/** 遠征中の見込み。今帰還できた場合と、ここで倒れた場合の灯片。 */
export function shardForecast(state: GameState): { ifReturned: number; ifLost: number } {
  return { ifReturned: calculateShards(state, "returned").total, ifLost: calculateShards(state, "lost").total };
}

export function createCampaignState(): CampaignState {
  return {
    version: 4,
    journey: { victories: 0, trialsCleared: 0, lifetimeShards: 0 },
    roleTruths: [],
    expeditions: [],
    shards: 0,
    facilities: { "war-room": 0, archive: 0, altar: 0 },
    roster: [],
    fallen: [],
    heat: { unlocked: 0, selected: 0 },
    cycle: { number: 1 },
  };
}

export function normalizeCampaignState(value: unknown): CampaignState {
  if (!value || typeof value !== "object") return createCampaignState();
  const version = (value as { version?: unknown }).version;
  if (version !== 1 && version !== 2 && version !== 3 && version !== 4) return createCampaignState();
  const input = value as { roleTruths?: unknown; expeditions?: unknown; shards?: unknown; facilities?: unknown; roster?: unknown; fallen?: unknown; heat?: unknown; cycle?: unknown; lessons?: unknown; flameDebt?: unknown; journey?: unknown };
  const roleTruths = Array.isArray(input.roleTruths) ? input.roleTruths.filter(isRoleTruthId) : [];
  const expeditions = Array.isArray(input.expeditions)
    ? input.expeditions.flatMap((entry) => normalizeExpeditionRecord(entry)).slice(0, 100)
    : [];
  const facilities = (input.facilities && typeof input.facilities === "object" ? input.facilities : {}) as Partial<Record<FacilityId, unknown>>;
  return {
    version: 4,
    journey: normalizeJourney(input.journey, expeditions),
    roleTruths: unique(roleTruths),
    expeditions,
    shards: typeof input.shards === "number" && Number.isFinite(input.shards) ? Math.max(0, Math.floor(input.shards)) : 0,
    facilities: {
      "war-room": facilityLevel(facilities["war-room"]),
      archive: facilityLevel(facilities.archive),
      altar: facilityLevel(facilities.altar),
    },
    roster: Array.isArray(input.roster) ? input.roster.flatMap(normalizeVeteran) : [],
    fallen: Array.isArray(input.fallen) ? (input.fallen as FallenDelver[]).filter((entry) => !!entry?.identity).slice(0, 30) : [],
    lessons: Array.isArray(input.lessons) ? input.lessons.filter((id): id is "ranged" | "care" | "traps" => id === "ranged" || id === "care" || id === "traps") : [],
    flameDebt: facilityLevel(input.flameDebt),
    heat: normalizeHeat(input.heat),
    cycle: normalizeCycle(input.cycle),
  };
}

function normalizeJourney(value: unknown, expeditions: ExpeditionRecord[]): NonNullable<CampaignState["journey"]> {
  const input = (value && typeof value === "object" ? value : {}) as Partial<NonNullable<CampaignState["journey"]>>;
  return {
    victories: input.victories === undefined ? expeditions.filter((run) => run.status === "won").length : facilityLevel(input.victories),
    trialsCleared: Math.min(getGameConfig().campaign.journey?.trials.length ?? 0, facilityLevel(input.trialsCleared)),
    lifetimeShards: input.lifetimeShards === undefined ? expeditions.reduce((sum, run) => sum + run.shards.total, 0) : facilityLevel(input.lifetimeShards),
  };
}

function normalizeHeat(value: unknown): CampaignState["heat"] {
  const max = getGameConfig().ascension.tiers.length;
  const input = (value && typeof value === "object" ? value : {}) as { unlocked?: unknown; selected?: unknown };
  const unlocked = Math.max(0, Math.min(max, facilityLevel(input.unlocked)));
  return { unlocked, selected: Math.min(unlocked, facilityLevel(input.selected)) };
}

function normalizeCycle(value: unknown): CampaignState["cycle"] {
  const input = (value && typeof value === "object" ? value : {}) as { number?: unknown; aftermath?: unknown; keeperName?: unknown };
  const aftermath = input.aftermath === "inherit-flame" || input.aftermath === "extinguish-flame" || input.aftermath === "divide-flame" ? input.aftermath : undefined;
  return {
    number: Math.max(1, facilityLevel(input.number) || 1),
    aftermath,
    keeperName: aftermath === "inherit-flame" && typeof input.keeperName === "string" ? input.keeperName : undefined,
  };
}

function facilityLevel(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizeVeteran(value: unknown): Veteran[] {
  if (!value || typeof value !== "object") return [];
  const veteran = value as Partial<Veteran>;
  if (!veteran.id || !veteran.identity?.name || !veteran.identity.roleId) return [];
  return [{
    id: veteran.id,
    identity: { ...veteran.identity, veteranId: veteran.id },
    rank: typeof veteran.rank === "number" ? veteran.rank : 1,
    expeditions: typeof veteran.expeditions === "number" ? veteran.expeditions : 1,
    scars: Array.isArray(veteran.scars) ? veteran.scars.filter((id): id is string => typeof id === "string") : [],
  }];
}

export function recordCampaignResult(campaign: CampaignState, state: GameState, deathCause: string | null): CampaignState {
  if (state.status === "playing") return campaign;
  const shards = calculateShards(state);
  const journey = journeyTotals(campaign);
  const trial = journeyProgress(campaign).trial;
  const clearedTrial = state.status === "won" && trial > 0 && state.modifiers.bossTrial === trial;
  const truthRecovered = (state.status === "won" || state.status === "returned") ? state.story.carriedTruthId : undefined;
  const recoveredGraves = new Set(state.story.recoveredGraves ?? []);
  const rosterUpdate = updateRoster(campaign, state, deathCause);
  const heatUnlocked = state.status === "won" && (state.modifiers.heat ?? 0) >= campaign.heat.unlocked
    ? Math.min(getGameConfig().ascension.tiers.length, (state.modifiers.heat ?? 0) + 1)
    : campaign.heat.unlocked;
  const cycle: CampaignState["cycle"] = state.story.endingId
    ? { number: campaign.cycle.number + 1, aftermath: state.story.endingId, keeperName: state.story.endingId === "inherit-flame" ? state.runIdentity.name : undefined }
    : { ...campaign.cycle };
  const record: ExpeditionRecord = {
    bossTrial: state.modifiers.bossTrial ?? 0,
    id: `${state.seed}-${state.runIdentity.roleId}-${state.runTurn}-${state.status}`,
    completedAt: new Date().toISOString(),
    seed: state.seed,
    identity: { ...state.runIdentity },
    status: state.status,
    floor: state.story.maxFloorReached,
    runTurn: state.runTurn,
    shards,
    decisions: state.story.decisions.map((entry) => ({ ...entry })),
    deathCause,
    missionId: state.story.missionId,
    missionCompleted: state.story.missionCompleted,
    discoveryCount: state.story.discoveries.length,
    interventionCount: state.story.decisions.filter((entry) => entry.effectSummary && entry.usedRevelation).length,
    truthRecovered,
    endingId: state.story.endingId,
    veteranOutcome: rosterUpdate.outcome,
    heat: state.modifiers.heat ?? 0,
    cycle: campaign.cycle.number,
    gravesRecovered: recoveredGraves.size,
  };
  return {
    version: 4,
    roleTruths: truthRecovered ? unique([...campaign.roleTruths, truthRecovered]) : [...campaign.roleTruths],
    expeditions: [record, ...campaign.expeditions].slice(0, 100),
    shards: campaign.shards + shards.total,
    journey: { victories: journey.victories + (state.status === "won" ? 1 : 0), trialsCleared: journey.trialsCleared + (clearedTrial ? 1 : 0), lifetimeShards: journey.lifetimeShards + shards.total },
    facilities: { ...campaign.facilities },
    roster: rosterUpdate.roster,
    fallen: rosterUpdate.fallen.map((entry) => entry.id && recoveredGraves.has(entry.id) ? { ...entry, recovered: true } : entry),
    lessons: [...new Set([...(campaign.lessons ?? []), ...(state.modifiers.lessons ?? [])])],
    flameDebt: state.expedition?.debt ?? campaign.flameDebt ?? 0,
    heat: { unlocked: heatUnlocked, selected: Math.min(campaign.heat.selected, heatUnlocked) },
    cycle,
  };
}

/** 燭階と周期の余波による灯片の上乗せ率（%）。 */
export function runShardBonusPercent(heat: number, aftermath?: EndingId): number {
  const { ascension, aftermath: aftermaths } = getGameConfig();
  const fromHeat = ascension.tiers.slice(0, heat).reduce((sum, tier) => sum + (tier.shardBonusPercent ?? 0), 0);
  return fromHeat + (aftermath ? aftermaths[aftermath]?.shardBonusPercent ?? 0 : 0);
}

/** 灰灯院の現状（燭階・周期の余波・墓標）から、次の遠征に持ち込む補正を組み立てる。 */
export function campaignRunModifiers(campaign: CampaignState): { modifiers: Partial<RunModifiers>; bonusEmbers: number; bonusMaxEmbers: number } {
  const config = getGameConfig();
  const heat = campaign.heat.selected;
  const layers = [...config.ascension.tiers.slice(0, heat), ...(campaign.cycle.aftermath ? [config.aftermath[campaign.cycle.aftermath]] : [])].filter(Boolean);
  const ruleDeltas: Partial<Record<RunRuleKey, number>> = {};
  let bonusEmbers = campaignBonusEmbers(campaign);
  let bonusMaxEmbers = 0;
  let bossOverride: RunModifiers["bossOverride"];
  for (const layer of layers) {
    for (const [key, delta] of Object.entries(layer.ruleDeltas ?? {})) {
      const ruleKey = key as RunRuleKey;
      ruleDeltas[ruleKey] = (ruleDeltas[ruleKey] ?? 0) + (delta ?? 0);
    }
    bonusEmbers += layer.lanternStartDelta ?? 0;
    bonusMaxEmbers += layer.lanternMaxDelta ?? 0;
    if (layer.bossOverride) bossOverride = { ...layer.bossOverride };
  }
  return {
    modifiers: {
      foundationRank: journeyProgress(campaign).rank,
      bossTrial: journeyProgress(campaign).trial,
      lessons: [...(campaign.lessons ?? [])],
      flameDebt: campaign.flameDebt ?? 0,
      heat,
      aftermath: campaign.cycle.aftermath,
      keeperName: campaign.cycle.keeperName,
      ruleDeltas,
      bossOverride,
      graves: pendingGraves(campaign),
    },
    bonusEmbers,
    bonusMaxEmbers,
  };
}

/** まだ弔われていない墓標を、階ごとに最も新しいものだけ選ぶ。 */
export function pendingGraves(campaign: CampaignState): GraveMarker[] {
  const byFloor = new Map<number, GraveMarker>();
  for (const fallen of campaign.fallen) {
    if (!fallen.id || fallen.recovered || fallen.floor < 1 || byFloor.has(fallen.floor)) continue;
    byFloor.set(fallen.floor, { id: fallen.id, name: fallen.identity.name, roleId: fallen.identity.roleId, floor: fallen.floor, gear: fallen.gear, echoes: fallen.echoes, lesson: fallen.lesson });
  }
  return [...byFloor.values()];
}

function updateRoster(campaign: CampaignState, state: GameState, deathCause: string | null): { roster: Veteran[]; fallen: FallenDelver[]; outcome: ExpeditionRecord["veteranOutcome"] } {
  const config = getGameConfig().campaign;
  const veteranId = state.runIdentity.veteranId;
  const existing = veteranId ? campaign.roster.find((veteran) => veteran.id === veteranId) : undefined;
  const others = campaign.roster.filter((veteran) => veteran.id !== veteranId);
  const survived = state.status === "returned" || state.status === "won";
  const player = state.entities.find((entity) => entity.id === state.playerId);
  if (state.story.endingId === "inherit-flame") {
    // 黒燭を継いだ者は帰らない。次の周期で堕ちた灯守として現れる。
    return { roster: others, fallen: [...campaign.fallen], outcome: "keeper" };
  }
  if (!survived) {
    const gear = player?.inventory?.find((entry) => entry.equipped && getGameConfig().equipment[entry.contentId]?.slot === "weapon")?.contentId
      ?? player?.inventory?.find((entry) => entry.equipped)?.contentId;
    const fallenEntry: FallenDelver = {
      id: `grave-${state.seed}-${state.runIdentity.roleId}-${state.runTurn}`,
      identity: { ...state.runIdentity },
      rank: existing?.rank ?? 0,
      floor: state.floor,
      cause: deathCause,
      gear,
      echoes: state.expedition?.trail.map((entry) => ({ ...entry, pos: { ...entry.pos } })),
      lesson: state.story.killedBy?.cause === "rangedCombat" ? "ranged" : state.story.killedBy?.cause === "trap" ? "traps" : "care",
    };
    return { roster: others, fallen: [fallenEntry, ...campaign.fallen].slice(0, 30), outcome: "fallen" };
  }
  if (!existing && campaign.roster.length >= config.rosterLimit) {
    return { roster: [...campaign.roster], fallen: [...campaign.fallen], outcome: "roster-full" };
  }
  const hpRatio = player?.stats ? player.stats.hp / player.stats.maxHp : 1;
  const scars = [...(existing?.scars ?? [])];
  let outcome: ExpeditionRecord["veteranOutcome"] = existing ? "promoted" : "recruited";
  if (hpRatio <= config.scarHpRatio) {
    const candidates = Object.keys(getGameConfig().scars).filter((id) => !scars.includes(id));
    if (candidates.length > 0) {
      scars.push(candidates[stableHash(`${state.seed}:${state.runTurn}:scar`) % candidates.length]);
      outcome = "scarred";
    }
  }
  const id = existing?.id ?? `veteran-${state.seed}-${state.runIdentity.roleId}`;
  const veteran: Veteran = {
    id,
    identity: { ...state.runIdentity, veteranId: id },
    rank: Math.min(config.veteranMaxRank, (existing?.rank ?? 0) + 1),
    expeditions: (existing?.expeditions ?? 0) + 1,
    scars,
  };
  return { roster: [veteran, ...others], fallen: [...campaign.fallen], outcome };
}

export function facilityUpgradeCost(campaign: CampaignState, facilityId: FacilityId): number | null {
  const costs = getGameConfig().campaign.facilities[facilityId].costs;
  return costs[campaign.facilities[facilityId]] ?? null;
}

export function upgradeFacility(campaign: CampaignState, facilityId: FacilityId): CampaignState {
  const cost = facilityUpgradeCost(campaign, facilityId);
  if (cost === null || campaign.shards < cost) return campaign;
  return { ...campaign, shards: campaign.shards - cost, facilities: { ...campaign.facilities, [facilityId]: campaign.facilities[facilityId] + 1 } };
}

export function treatScar(campaign: CampaignState, veteranId: string, scarId: string): CampaignState {
  const cost = getGameConfig().campaign.scarTreatmentCost;
  const veteran = campaign.roster.find((entry) => entry.id === veteranId);
  if (!veteran || !veteran.scars.includes(scarId) || campaign.shards < cost) return campaign;
  return {
    ...campaign,
    shards: campaign.shards - cost,
    roster: campaign.roster.map((entry) => entry.id === veteranId ? { ...entry, scars: entry.scars.filter((id) => id !== scarId) } : entry),
  };
}

export function campaignTacticSlots(campaign: CampaignState): number {
  const config = getGameConfig();
  return config.tactics.slots + campaign.facilities["war-room"] * (config.campaign.facilities["war-room"].tacticSlotsPerLevel ?? 0);
}

export function campaignBonusEmbers(campaign: CampaignState): number {
  return campaign.facilities.altar * (getGameConfig().campaign.facilities.altar.startEmbersPerLevel ?? 0);
}

export function unlockedTacticIds(campaign: CampaignState): string[] {
  const config = getGameConfig();
  const unlockedByArchive = new Set((config.campaign.facilities.archive.unlocksPerLevel ?? []).slice(0, campaign.facilities.archive).flat());
  return Object.entries(config.tactics.definitions)
    .filter(([id, tactic]) => !tactic.locked || unlockedByArchive.has(id))
    .map(([id]) => id);
}

export type RoadmapChapter = {
  id: "first-route" | "first-truth" | "three-truths" | "black-core" | "ending";
  label: string;
  /** 次に何をすればよいかを一行で。 */
  hint: string;
  done: boolean;
};

export type CampaignProgress = {
  highestFloor: number;
  bestShards: number;
  completedRuns: number;
  completedMissionIds: MissionId[];
  endingIds: EndingId[];
  /** 「黒燭への道」。上から順に進む大目標。 */
  roadmap: RoadmapChapter[];
  /** 最初の未達の章。全章を終えた後は null。 */
  nextChapter: RoadmapChapter | null;
};

const ROLE_FOR_TRUTH: Record<RoleTruthId, string> = { "shared-oath": "誓約の探索者", "furnace-map": "灰弓の斥候", "purified-flame": "灯火の祈祷者" };

export function truthRoleLabel(truthId: RoleTruthId): string {
  return ROLE_FOR_TRUTH[truthId];
}

export function campaignProgress(campaign: CampaignState): CampaignProgress {
  const highestFloor = campaign.expeditions.reduce((best, record) => Math.max(best, record.floor), 0);
  const bestShards = campaign.expeditions.reduce((best, record) => Math.max(best, record.shards.total), 0);
  const completedRuns = campaign.expeditions.filter((record) => record.status === "won").length;
  const completedMissionIds = unique(campaign.expeditions.filter((record) => record.missionCompleted).map((record) => record.missionId));
  const endingIds = unique(campaign.expeditions.flatMap((record) => record.endingId ? [record.endingId] : []));
  const missingTruths = ROLE_TRUTH_IDS.filter((truth) => !campaign.roleTruths.includes(truth));
  const firstRoute = highestFloor >= 4 || campaign.expeditions.some((record) => record.decisions.some((decision) => decision.id === "checkpoint-3"));
  const roadmap: RoadmapChapter[] = [
    { id: "first-route", label: "第一の帰還路を開く", hint: "第三階の守り手を倒すと、灰灯院へ戻る灯路が開く。", done: firstRoute },
    { id: "first-truth", label: "真相を一つ持ち帰る", hint: "第六階の守り手を倒して現れる真相を抱え、生きて帰る。任務「真相を持ち帰る」が近道。", done: campaign.roleTruths.length > 0 },
    {
      id: "three-truths",
      label: "三つの真相を揃える",
      hint: missingTruths.length
        ? `真相は職業ごとに一つ。残り: ${missingTruths.map((truth) => `${roleTruthLabel(truth)}（${ROLE_FOR_TRUTH[truth]}）`).join("、")}`
        : "三つの真相が揃った。",
      done: missingTruths.length === 0,
    },
    { id: "black-core", label: "黒燭核を討つ", hint: "第十層の番人を倒す。帰還路では帰らず進み続ける必要がある。", done: completedRuns > 0 },
    { id: "ending", label: "黒燭の行方を決める", hint: "三つの真相を揃えた上で第十層の番人を倒すと、結末を選べる。結末は次の周期の迷宮を変える。", done: endingIds.length > 0 },
  ];
  return {
    highestFloor,
    bestShards,
    completedRuns,
    completedMissionIds,
    endingIds,
    roadmap,
    nextChapter: roadmap.find((chapter) => !chapter.done) ?? null,
  };
}

function normalizeExpeditionRecord(value: unknown): ExpeditionRecord[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Partial<ExpeditionRecord>;
  if (!record.id || !record.identity || !record.status || typeof record.floor !== "number") return [];
  const missionId = isMissionId(record.missionId) ? record.missionId : defaultMissionForTemperament(record.identity.temperament);
  // version 3 以前は得点だけを記録していた。灯片の合計だけを引き継ぎ、内訳は空にする。
  const { score: _legacyScore, shardsEarned, ...rest } = record as Partial<ExpeditionRecord> & { score?: unknown; shardsEarned?: number };
  const shards: ShardBreakdown = record.shards ?? { depth: 0, guardians: 0, discoveries: 0, survival: 0, carried: 0, mission: 0, truth: 0, graves: 0, bonusPercent: 0, total: shardsEarned ?? 0 };
  const decisions = Array.isArray(record.decisions) ? record.decisions.map((entry) => ({ ...entry })) : [];
  return [{
    ...rest,
    completedAt: record.completedAt ?? new Date(0).toISOString(),
    seed: record.seed ?? 0,
    runTurn: record.runTurn ?? 0,
    decisions,
    deathCause: record.deathCause ?? null,
    missionId,
    shards,
    missionCompleted: isMissionId(record.missionId) ? record.missionCompleted ?? false : false,
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
  return expeditionMissions.some((mission) => mission.id === value);
}
