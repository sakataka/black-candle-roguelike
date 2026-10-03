import { getGameConfig } from "../content/config";
import { unlockedTacticIds } from "./autonomous";
import { getContentName } from "../content/entities";
import type { CampaignState, DeathCause, GameState, LanternRiteId, RunLog, RunLogEntry } from "../types";

export type TimelinePoint = { runTurn: number; hpRatio: number; floor: number };

export type TimelineMarker = {
  runTurn: number;
  kind: "decision" | "lantern" | "death" | "floor";
  label: string;
};

export type TurningPoint = {
  runTurn: number;
  floor: number;
  title: string;
  detail: string;
  tone: "danger" | "warning" | "info";
};

export type RunAdvice = {
  kind: "tactic" | "rite";
  id: string;
  label: string;
  reason: string;
};

export type RunInsights = {
  timeline: TimelinePoint[];
  markers: TimelineMarker[];
  turningPoints: TurningPoint[];
  advice: RunAdvice[];
  totalTurns: number;
};

const BURST_WINDOW = 8;

/** 遠征記録から、結果画面で振り返るための軌跡・転機・次回への示唆を組み立てる。 */
export function buildRunInsights(log: RunLog, finalState: GameState, deathCause: DeathCause | null, campaign: CampaignState): RunInsights {
  const entries = log.entries.filter((entry) => entry.runTurn !== undefined);
  const timeline = sampleTimeline(entries);
  const markers = collectMarkers(entries, finalState);
  const turningPoints = [
    burstTurningPoint(entries),
    lowHpTurningPoint(entries),
    stagnationTurningPoint(entries),
    finalTurningPoint(entries, finalState, deathCause),
  ].filter((point): point is TurningPoint => point !== null);
  return {
    timeline,
    markers,
    turningPoints,
    advice: adviceFor(finalState, deathCause, entries, campaign),
    totalTurns: Math.max(1, finalState.runTurn),
  };
}

function sampleTimeline(entries: RunLogEntry[]): TimelinePoint[] {
  const points: TimelinePoint[] = [];
  let lastTurn = -1;
  for (const entry of entries) {
    const hp = entry.after.hp ?? 0;
    const maxHp = entry.after.maxHp ?? 1;
    const runTurn = entry.runTurn ?? 0;
    if (runTurn === lastTurn && points.length > 0) {
      points[points.length - 1] = { runTurn, hpRatio: clampRatio(hp / maxHp), floor: entry.floor };
      continue;
    }
    points.push({ runTurn, hpRatio: clampRatio(hp / maxHp), floor: entry.floor });
    lastTurn = runTurn;
  }
  return points;
}

function collectMarkers(entries: RunLogEntry[], finalState: GameState): TimelineMarker[] {
  const markers: TimelineMarker[] = [];
  let floor = entries[0]?.floor ?? 1;
  for (const entry of entries) {
    const runTurn = entry.runTurn ?? 0;
    if (entry.floor !== floor) {
      floor = entry.floor;
      markers.push({ runTurn, kind: "floor", label: `F${floor}` });
    }
    if (entry.action.type === "invokeLantern") {
      markers.push({ runTurn, kind: "lantern", label: riteLabel(entry.action.rite) });
    }
    if (entry.action.type === "resolveDecision") {
      markers.push({ runTurn, kind: "decision", label: "判断" });
    }
  }
  if (finalState.status === "lost") {
    markers.push({ runTurn: finalState.runTurn, kind: "death", label: "倒れた" });
  }
  return markers;
}

function burstTurningPoint(entries: RunLogEntry[]): TurningPoint | null {
  let best: { start: number; end: number; damage: number } | null = null;
  for (let end = 0; end < entries.length; end += 1) {
    const start = Math.max(0, end - BURST_WINDOW + 1);
    if (entries[start].floor !== entries[end].floor) continue;
    let damage = 0;
    for (let index = start; index <= end; index += 1) damage += damageOf(entries[index]);
    if (!best || damage > best.damage) best = { start, end, damage };
  }
  if (!best || best.damage < 8) return null;
  const window = entries.slice(best.start, best.end + 1);
  const attackers = topAttackers(window);
  const maxHp = window[0].before.maxHp ?? 1;
  return {
    runTurn: window[0].runTurn ?? 0,
    floor: window[0].floor,
    title: `${window.length}手で${best.damage}ダメージ`,
    detail: `${attackers.length ? `${attackers.join("・")}に` : ""}最大HPの${Math.round(best.damage / maxHp * 100)}%を削られた、最も激しい場面。`,
    tone: best.damage / maxHp >= 0.4 ? "danger" : "warning",
  };
}

function lowHpTurningPoint(entries: RunLogEntry[]): TurningPoint | null {
  const entry = entries.find((candidate) => {
    const hp = candidate.after.hp ?? 0;
    const maxHp = candidate.after.maxHp ?? 1;
    return hp > 0 && hp / maxHp <= 0.3;
  });
  if (!entry) return null;
  const healing = (entry.after.inventory ?? []).filter((item) => {
    const consumable = getGameConfig().consumables[item.contentId];
    return !!consumable?.heal && !consumable.mysteryEffects;
  }).reduce((sum, item) => sum + item.quantity, 0);
  return {
    runTurn: entry.runTurn ?? 0,
    floor: entry.floor,
    title: "命火が3割を切った",
    detail: healing > 0 ? `この時点で回復薬を${healing}個持っていた。早めの手当てか癒灯で立て直せた可能性がある。` : "回復手段が尽きていた。灯火を癒灯に残しておくと持ちこたえやすい。",
    tone: "warning",
  };
}

function stagnationTurningPoint(entries: RunLogEntry[]): TurningPoint | null {
  let best: RunLogEntry | null = null;
  for (const entry of entries) {
    if (!best || (entry.aiDebug?.stagnantTurns ?? 0) > (best.aiDebug?.stagnantTurns ?? 0)) best = entry;
  }
  const stagnant = best?.aiDebug?.stagnantTurns ?? 0;
  if (!best || stagnant < 40) return null;
  return {
    runTurn: Math.max(0, (best.runTurn ?? 0) - stagnant),
    floor: best.floor,
    title: `${stagnant}手の足踏み`,
    detail: "新しい道が見つからず探索が停滞した。導灯で周囲を照らすか、最短路の作戦で時間を節約できる。",
    tone: "info",
  };
}

function finalTurningPoint(entries: RunLogEntry[], finalState: GameState, deathCause: DeathCause | null): TurningPoint | null {
  const last = entries[entries.length - 1];
  if (!last) return null;
  if (finalState.status === "lost") {
    const killer = finalState.story.killedBy?.contentId ? getContentName(finalState.story.killedBy.contentId) : null;
    return {
      runTurn: finalState.runTurn,
      floor: finalState.floor,
      title: "最期",
      detail: `${deathCauseText(deathCause)}${killer ? `（${killer}）` : ""}で倒れた。`,
      tone: "danger",
    };
  }
  if (finalState.status === "stranded") {
    return { runTurn: finalState.runTurn, floor: finalState.floor, title: "灯芯が尽きた", detail: "灯芯が燃え尽き、黒燭との接続が切れた。", tone: "danger" };
  }
  return null;
}

function adviceFor(finalState: GameState, deathCause: DeathCause | null, entries: RunLogEntry[], campaign: CampaignState): RunAdvice[] {
  const tactics = getGameConfig().tactics.definitions;
  const advice: RunAdvice[] = [];
  const unlocked = new Set(unlockedTacticIds(campaign));
  const addTactic = (id: string, reason: string) => {
    if (tactics[id] && unlocked.has(id) && !finalState.tactics.includes(id)) advice.push({ kind: "tactic", id, label: tactics[id].label, reason });
  };
  const addRite = (id: LanternRiteId, reason: string) => advice.push({ kind: "rite", id, label: riteLabel(id), reason });
  const lanternUses = entries.filter((entry) => entry.action.type === "invokeLantern").length;
  if (deathCause === "rangedCombat") {
    addTactic("tactic.archer-hunt", "射手を先に倒せば遠隔の削りを止められる。");
    addTactic("tactic.cover-dance", "遮蔽を伝えば射線に立つ時間を減らせる。");
    addRite("ward", "護灯で射手を押し戻し、護りを得る。");
  } else if (deathCause === "venom" || deathCause === "bleeding") {
    addTactic("tactic.early-care", "毒や出血で削られる前に回復する。");
    addRite("mend", "癒灯は毒と出血もまとめて払う。");
  } else if (deathCause === "trap") {
    addTactic("tactic.trap-reader", "罠と運命の標を避け、罠回避も上がる。");
    addRite("guide", "導灯で隠れた罠を暴ける。");
  } else if (deathCause === "combat") {
    addTactic("tactic.hoard", "薬を深層まで残し、強敵に備える。");
    addRite("flare", "閃灯で敵を怯ませ、囲まれた手番を凌ぐ。");
  } else if (finalState.status === "stranded") {
    addTactic("tactic.straight-path", "寄り道を減らし、灯路が尽きる前に進む。");
    addRite("guide", "導灯で道を照らし、足踏みを減らす。");
  }
  if (finalState.status === "lost" && lanternUses === 0 && finalState.lantern.embers > 0) {
    advice.push({ kind: "rite", id: "unused", label: `灯火${finalState.lantern.embers}つが残っていた`, reason: "危機の瞬間に灯を捧げれば、結末が変わったかもしれない。" });
  }
  return advice.slice(0, 3);
}

function damageOf(entry: RunLogEntry): number {
  return Math.max(0, (entry.before.hp ?? 0) - (entry.after.hp ?? 0));
}

function topAttackers(entries: RunLogEntry[]): string[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const message of entry.messageDelta) {
      const match = message.text.match(/^(.+?)は(?:離れた位置から)?あなたに\d+ダメージ/);
      if (match) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([name]) => name);
}

function deathCauseText(cause: DeathCause | null): string {
  if (cause === "rangedCombat") return "遠隔攻撃";
  if (cause === "combat") return "近接戦闘";
  if (cause === "trap") return "罠";
  if (cause === "bleeding") return "出血";
  if (cause === "venom") return "毒";
  return "不明な原因";
}

function riteLabel(rite: LanternRiteId): string {
  if (rite === "flare") return "閃灯";
  if (rite === "mend") return "癒灯";
  if (rite === "guide") return "導灯";
  return "護灯";
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, value));
}
