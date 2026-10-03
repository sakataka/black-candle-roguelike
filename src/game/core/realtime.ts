import { realtimeConfig } from "../content/realtime";
import type { AttackTelegraph, ExpeditionDynamics, GameAction, GameObservation, GameState, PersonalVow, Point } from "../types";

export const samePosition = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
export const gridDistance = (a: Point, b: Point) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export function createDynamics(state: Pick<GameState, "runIdentity" | "modifiers">): ExpeditionDynamics {
  const memorial = !!state.modifiers.graves?.length;
  const cautious = state.runIdentity.temperament === "cautious";
  const vow: PersonalVow = memorial
    ? { id: "memorial", label: "先に逝った者の灯を受け継ぐ", completed: false, progress: 0, target: 1 }
    : cautious
      ? { id: "return-six", label: "第六階の真相を持ち帰る", completed: false, progress: 0, target: 6 }
      : { id: "resolve", label: `${realtimeConfig().vows.resolveBossTarget}体の守り手を越えて進む`, completed: false, progress: 0, target: realtimeConfig().vows.resolveBossTarget };
  return { vow, lights: [], borrowed: false, debt: state.modifiers.flameDebt ?? 0, loanShieldTurns: 0, lawPhase: 0, floorKills: 0, floorAwakened: 0, heat: [], trail: [], memories: [],
    stats: { dodges: 0, telegraphs: 0, terrainLures: 0, awakened: 0, heatHits: 0, lightsPlaced: 0, borrowed: 0 } };
}

export function armDecision(state: GameState): void {
  if (!realtimeConfig().enabled || !state.pendingDecision) return;
  state.pendingDecision.remainingTurns ??= realtimeConfig().decisionTurns[state.pendingDecision.kind];
  if (state.pendingDecision.kind === "checkpoint" && state.floor === 6 && state.expedition?.vow.id === "return-six") {
    state.pendingDecision.defaultOptionId = "return";
  }
}

export function telegraphTiles(kind: AttackTelegraph["kind"], from: Point, target: Point, phase = 0): Point[] {
  if (kind === "sweep") {
    return Array.from({ length: 25 }, (_, i) => ({ x: from.x + i % 5 - 2, y: from.y + Math.floor(i / 5) - 2 }))
      .filter((p) => !samePosition(p, from) && (phase % 2 === 0 ? p.x === target.x || p.y === target.y : Math.abs(p.x - from.x) === Math.abs(p.y - from.y)));
  }
  if (kind === "hex") {
    const diagonal = phase % 2 !== 0;
    return [target, ...[-1, 1].flatMap((d) => diagonal
      ? [{ x: target.x + d, y: target.y + d }, { x: target.x + d, y: target.y - d }]
      : [{ x: target.x + d, y: target.y }, { x: target.x, y: target.y + d }])];
  }
  const points: Point[] = [];
  let x = from.x, y = from.y;
  const dx = Math.abs(target.x - x), dy = Math.abs(target.y - y), sx = Math.sign(target.x - x), sy = Math.sign(target.y - y);
  let error = dx - dy;
  while (x !== target.x || y !== target.y) {
    const twice = error * 2;
    if (twice > -dy) { error -= dy; x += sx; }
    if (twice < dx) { error += dx; y += sy; }
    points.push({ x, y });
  }
  return points;
}

export function visibleDangerTiles(observation: GameObservation): Point[] {
  if (!realtimeConfig().enabled) return [];
  return [
    ...observation.visibleEntities.flatMap((e) => e.telegraph?.tiles ?? []),
    ...(observation.expedition?.heat.filter((h) => h.active || h.remaining <= realtimeConfig().laws.furnaceWindup).map((h) => h.pos) ?? []),
  ];
}

export function isInstantIntervention(action: GameAction): boolean {
  return action.type === "invokeLantern" || action.type === "placeLantern" || action.type === "borrowFlame" || action.type === "resolveDecision";
}

export function recordLastMoment(state: GameState, action: GameAction): void {
  if (!state.expedition || isInstantIntervention(action)) return;
  const player = state.entities.find((e) => e.id === state.playerId);
  if (!player) return;
  const labels: Partial<Record<GameAction["type"], string>> = { move: state.strikes?.some((s) => s.attackerId === state.playerId) ? "敵へ踏み込んだ" : "進路を選んだ", useItem: "道具を使った", wait: "踏みとどまった", pickup: "遺品を拾った", descend: "次の階へ向かった", equip: "装備を持ち替えた" };
  state.expedition.trail = [...state.expedition.trail, { action: labels[action.type] ?? "遠征を続けた", hp: Math.max(0, player.stats?.hp ?? 0), pos: { ...player.pos } }].slice(-3);
}

export function updateVow(state: GameState): void {
  const vow = state.expedition?.vow;
  if (!vow || vow.completed) return;
  vow.progress = vow.id === "memorial" ? state.story.recoveredGraves?.length ?? 0 : vow.id === "resolve" ? state.story.bossesDefeated : Math.min(6, state.floor);
  if (vow.progress < vow.target || (vow.id === "return-six" && state.status !== "returned")) return;
  vow.completed = true;
  state.lantern.embers = Math.min(state.lantern.maxEmbers, state.lantern.embers + repayFlame(state, realtimeConfig().vows.rewardEmbers));
  state.messages = [...state.messages, { turn: state.turn, text: `誓い「${vow.label}」を果たした。本人の決意が灯火へ還る。`, tone: "loot" as const }].slice(-80);
}

/** 灯火の獲得源に共通。即時介入で借入・返済の時計を進めない。 */
export function repayFlame(state: GameState, earned: number): number {
  if (!state.expedition?.debt || earned <= 0) return earned;
  const paid = Math.min(earned, state.expedition.debt);
  state.expedition.debt -= paid;
  state.messages = [...state.messages, { turn: state.turn, text: `得た灯火${paid}つを未来へ返した。残りの返済${state.expedition.debt}。`, tone: "system" as const }].slice(-80);
  return earned - paid;
}
