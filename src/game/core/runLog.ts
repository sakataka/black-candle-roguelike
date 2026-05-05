import { getGameConfig } from "../content/config";
import { getContentName } from "../content/entities";
import type {
  DeathCause,
  Entity,
  GameAction,
  GameMessage,
  GameState,
  InventoryEntry,
  GameObservation,
  RunLog,
  RunLogEntry,
  RunLogEntitySummary,
  RunLogPlayerSnapshot,
  RunReview,
  StatusCondition,
} from "../types";
import { observeGame } from "./game";

type AiDebugSnapshot = {
  stagnantTurns: number;
  visitsAtPlayer: number;
  recentPositions: string[];
};

type RecordTurnInput = {
  log: RunLog;
  before: GameState;
  action: GameAction;
  after: GameState;
  actor: "player" | "ai";
  aiDebug?: AiDebugSnapshot;
  beforeObservation?: GameObservation;
  afterObservation?: GameObservation;
};

export function createRunLog(seed: number, roleId: string): RunLog {
  return {
    seed,
    roleId,
    startedAt: new Date().toISOString(),
    entries: [],
    totals: {
      actions: {
        move: 0,
        wait: 0,
        pickup: 0,
        equip: 0,
        dropItem: 0,
        useItem: 0,
        merchantService: 0,
        descend: 0,
      },
      damageTaken: 0,
      healingReceived: 0,
      pickups: 0,
      descents: 0,
      lowHpTurns: 0,
      stagnantTurns: 0,
      riskyTrapSteps: 0,
    },
  };
}

export function recordTurn({ log, before, action, after, actor, aiDebug, beforeObservation, afterObservation }: RecordTurnInput): RunLogEntry {
  beforeObservation ??= observeGame(before);
  afterObservation ??= observeGame(after);
  const beforePlayer = beforeObservation.player;
  const afterPlayer = afterObservation.player;
  const beforeSnapshot = playerSnapshot(beforePlayer);
  const afterSnapshot = playerSnapshot(afterPlayer);
  const damageTaken = Math.max(0, (beforeSnapshot.hp ?? 0) - (afterSnapshot.hp ?? 0));
  const healingReceived = Math.max(0, (afterSnapshot.hp ?? 0) - (beforeSnapshot.hp ?? 0));
  const messageDelta = newMessages(before.messages, after.messages);
  const eventKinds = eventKindsFor(action, messageDelta);
  const entry: RunLogEntry = {
    index: log.entries.length,
    turn: after.turn,
    floor: after.floor,
    action: cloneAction(action),
    actor,
    before: beforeSnapshot,
    after: afterSnapshot,
    resultStatus: after.status,
    messageDelta,
    visible: entitySummary(afterObservation.visibleEntities, afterObservation.knownEntities, afterObservation.player.pos),
    knownTiles: afterObservation.knownTiles.length,
    visibleTiles: afterObservation.visibleTiles.length,
    aiDebug: aiDebug ? {
      stagnantTurns: aiDebug.stagnantTurns,
      visitsAtPlayer: aiDebug.visitsAtPlayer,
      recentPositions: [...aiDebug.recentPositions],
    } : undefined,
    eventKinds,
  };

  log.entries.push(entry);
  log.totals.actions[action.type] += 1;
  log.totals.damageTaken += damageTaken;
  log.totals.healingReceived += healingReceived;
  log.totals.pickups += action.type === "pickup" ? 1 : 0;
  log.totals.descents += action.type === "descend" ? 1 : 0;
  log.totals.lowHpTurns += isLowHp(afterSnapshot) ? 1 : 0;
  log.totals.stagnantTurns = Math.max(log.totals.stagnantTurns, aiDebug?.stagnantTurns ?? 0);
  log.totals.riskyTrapSteps += steppedOntoKnownTrap(beforeObservation, afterObservation, action) ? 1 : 0;
  return entry;
}

export function analyzeRun(log: RunLog, finalState: GameState, finalObservation = observeGame(finalState)): RunReview {
  const player = finalObservation.player;
  const stats = {
    turns: log.entries.length,
    floor: finalState.floor,
    level: finalState.playerProgress.level,
    xp: finalState.playerProgress.xp,
    gold: finalState.playerProgress.gold,
    finalHp: player.stats?.hp,
    maxHp: player.stats?.maxHp,
    damageTaken: log.totals.damageTaken,
    healingReceived: log.totals.healingReceived,
    pickups: log.totals.pickups,
    descents: log.totals.descents,
    lowHpTurns: log.totals.lowHpTurns,
    stagnantTurns: log.totals.stagnantTurns,
    riskyTrapSteps: log.totals.riskyTrapSteps,
  };
  const lastTurns = log.entries.slice(-30);
  const deathCause = finalState.status === "lost" ? classifyDeathCause(lastTurns, finalState.messages) : null;
  const keyFindings = buildKeyFindings(log, finalState, deathCause, finalObservation);
  const aiImprovementHints = buildAiImprovementHints(log, finalState, deathCause);
  const summaryText = summaryFor(finalState.status, deathCause, stats);

  const reviewBase: Omit<RunReview, "exportJson"> = {
    result: finalState.status,
    deathCause,
    summaryText,
    keyFindings,
    aiImprovementHints,
    lastTurns,
    stats,
  };
  return {
    ...reviewBase,
    exportJson: {
      version: 1,
      generatedAt: new Date().toISOString(),
      run: {
        seed: log.seed,
        roleId: log.roleId,
        startedAt: log.startedAt,
        totals: log.totals,
        recentEntries: lastTurns,
      },
      review: reviewBase,
    },
  };
}

function playerSnapshot(player: Entity): RunLogPlayerSnapshot {
  return {
    pos: { ...player.pos },
    hp: player.stats?.hp,
    maxHp: player.stats?.maxHp,
    attack: player.stats?.attack,
    defense: player.stats?.defense,
    conditions: player.conditions?.map((condition) => ({ ...condition })) ?? [],
    inventory: player.inventory?.map((entry) => ({ ...entry })) ?? [],
  };
}

function entitySummary(
  visibleEntities: ReturnType<typeof observeGame>["visibleEntities"],
  knownEntities: ReturnType<typeof observeGame>["knownEntities"],
  playerPos: { x: number; y: number },
): RunLogEntitySummary {
  return {
    adjacentHostiles: visibleEntities.filter((entity) => entity.kind === "monster" && entity.hostile && entity.stats && entityDistance(entity.pos, playerPos) <= 1).length,
    visibleHostiles: visibleEntities.filter((entity) => entity.kind === "monster" && entity.hostile).length,
    visibleRangedHostiles: visibleEntities.filter((entity) => entity.kind === "monster" && entity.hostile && getGameConfig().rangedMonsters.includes(entity.contentId)).length,
    visibleItems: visibleEntities.filter((entity) => entity.kind === "item" || entity.kind === "event").length,
    knownTraps: knownEntities.filter((entity) => entity.kind === "trap").length,
  };
}

function newMessages(before: GameMessage[], after: GameMessage[]): GameMessage[] {
  const seen = new Set(before.map((entry) => messageKey(entry)));
  return after.filter((entry) => !seen.has(messageKey(entry))).map((entry) => ({ ...entry }));
}

function messageKey(entry: GameMessage): string {
  return `${entry.turn}:${entry.tone}:${entry.text}`;
}

function eventKindsFor(action: GameAction, messages: GameMessage[]): string[] {
  const kinds = new Set<string>([action.type]);
  for (const message of messages) {
    if (message.text.includes("ダメージ")) {
      kinds.add("damage");
    }
    if (message.text.includes("回復")) {
      kinds.add("healing");
    }
    if (message.text.includes("罠") || message.text.includes("毒霧") || message.text.includes("崩れ床")) {
      kinds.add("trap");
    }
    if (message.text.includes("出血")) {
      kinds.add("bleeding");
    }
    if (message.text.includes("毒")) {
      kinds.add("venom");
    }
    if (message.text.includes("倒れ")) {
      kinds.add("death");
    }
  }
  return [...kinds];
}

function classifyDeathCause(entries: RunLogEntry[], finalMessages: GameMessage[]): DeathCause {
  const texts = [...entries.flatMap((entry) => entry.messageDelta), ...finalMessages.slice(-8)].map((entry) => entry.text).reverse();
  const deathContext = texts.join("\n");
  if (deathContext.includes("離れた位置")) {
    return "rangedCombat";
  }
  if (deathContext.includes("罠") || deathContext.includes("毒霧") || deathContext.includes("崩れ床") || deathContext.includes("血針")) {
    return "trap";
  }
  if (deathContext.includes("出血")) {
    return "bleeding";
  }
  if (deathContext.includes("毒")) {
    return "venom";
  }
  if (deathContext.includes("ダメージ") || deathContext.includes("攻撃")) {
    return "combat";
  }
  return "unknown";
}

function buildKeyFindings(log: RunLog, finalState: GameState, deathCause: DeathCause | null, finalObservation: GameObservation): string[] {
  const player = finalObservation.player;
  const findings: string[] = [];
  if (finalState.status === "lost") {
    findings.push(`敗因分類: ${deathCauseLabel(deathCause)}。`);
  } else if (finalState.status === "won") {
    findings.push("第十層を踏破して run は成功しました。");
  } else {
    findings.push("run は終了ターン上限まで継続中です。");
  }
  findings.push(`累計被ダメージ ${log.totals.damageTaken}、累計回復 ${log.totals.healingReceived}、低HPターン ${log.totals.lowHpTurns}。`);
  const usableHealing = player.inventory?.filter((entry) => (getGameConfig().consumables[entry.contentId]?.heal ?? 0) > 0 && entry.quantity > 0) ?? [];
  const defensiveItems = player.inventory?.filter((entry) => getGameConfig().consumables[entry.contentId]?.guardedTurns && entry.quantity > 0) ?? [];
  if (finalState.status === "lost" && usableHealing.length > 0) {
    findings.push(`死亡時に回復手段が残っていました: ${usableHealing.map((entry) => `${getContentName(entry.contentId)} x${entry.quantity}`).join(", ")}。`);
  }
  if (finalState.status === "lost" && defensiveItems.length > 0) {
    findings.push(`死亡時に防御系アイテムが残っていました: ${defensiveItems.map((entry) => `${getContentName(entry.contentId)} x${entry.quantity}`).join(", ")}。`);
  }
  const last = log.entries.slice(-10);
  const recentPressure = last.filter((entry) => entry.visible.adjacentHostiles > 0 || entry.visible.visibleRangedHostiles > 0).length;
  if (recentPressure > 0) {
    findings.push(`直近10手のうち ${recentPressure} 手で隣接敵または遠隔脅威が見えていました。`);
  }
  if (log.totals.riskyTrapSteps > 0) {
    findings.push(`既知の罠へ踏み込んだ記録が ${log.totals.riskyTrapSteps} 回あります。`);
  }
  return findings;
}

function buildAiImprovementHints(log: RunLog, finalState: GameState, deathCause: DeathCause | null): string[] {
  const hints: string[] = [];
  const aiEntries = log.entries.filter((entry) => entry.actor === "ai");
  if (aiEntries.length === 0) {
    return ["手動プレイのため、AI固有の改善ヒントはありません。"];
  }
  if (deathCause === "rangedCombat") {
    hints.push("遠隔敵が見えた時の接近/遮蔽優先度を上げる余地があります。");
  }
  if (deathCause === "trap" || log.totals.riskyTrapSteps > 0) {
    hints.push("探索停滞時でも既知罠を踏む条件をさらに厳しくすると死亡率を下げられます。");
  }
  if (finalState.status === "lost" && log.totals.lowHpTurns > 0) {
    hints.push("低HPが続いた run なので、回復・防御アイテム使用の閾値を早める候補です。");
  }
  if (log.totals.stagnantTurns >= 24) {
    hints.push(`最大停滞 ${log.totals.stagnantTurns} ターン。探索ループ脱出の候補地点選びを見直す価値があります。`);
  }
  const recentLoops = aiEntries.slice(-20).filter((entry) => (entry.aiDebug?.visitsAtPlayer ?? 0) >= 4).length;
  if (recentLoops > 0) {
    hints.push(`直近に同じ地点への再訪が多い手が ${recentLoops} 回あります。移動評価の訪問ペナルティ調整候補です。`);
  }
  return hints.length > 0 ? hints : ["この run ではAI固有の明確な問題は検出されませんでした。"];
}

function summaryFor(status: GameState["status"], deathCause: DeathCause | null, stats: RunReview["stats"]): string {
  if (status === "won") {
    return `${stats.turns}ターンで第${stats.floor}階まで踏破しました。`;
  }
  if (status === "playing") {
    return `${stats.turns}ターン時点で探索継続中です。第${stats.floor}階、HP ${stats.finalHp ?? "-"}/${stats.maxHp ?? "-"}。`;
  }
  return `${stats.turns}ターン、第${stats.floor}階で敗北しました。主因は${deathCauseLabel(deathCause)}と推定されます。`;
}

function deathCauseLabel(cause: DeathCause | null): string {
  switch (cause) {
    case "combat":
      return "近接戦闘";
    case "rangedCombat":
      return "遠隔攻撃";
    case "trap":
      return "罠";
    case "bleeding":
      return "出血";
    case "venom":
      return "毒";
    default:
      return "不明";
  }
}

function steppedOntoKnownTrap(beforeObservation: GameObservation, afterObservation: GameObservation, action: GameAction): boolean {
  if (action.type !== "move") {
    return false;
  }
  const afterPlayer = afterObservation.player;
  return beforeObservation.knownEntities.some((entity) => entity.kind === "trap" && entity.pos.x === afterPlayer.pos.x && entity.pos.y === afterPlayer.pos.y);
}

function isLowHp(snapshot: RunLogPlayerSnapshot): boolean {
  return snapshot.hp !== undefined && snapshot.maxHp !== undefined && snapshot.hp / snapshot.maxHp <= 0.35;
}

function cloneAction(action: GameAction): GameAction {
  return { ...action };
}

function entityDistance(a: { x: number; y: number }, b?: { x: number; y: number }): number {
  if (!b) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}
