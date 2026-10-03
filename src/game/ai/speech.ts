import { getGameConfig } from "../content/config";
import { realtimeConfig } from "../content/realtime";
import { delverSpeech, missionOpeners, roleSpeech } from "../content/speech";
import { visibleDangerTiles } from "../core/realtime";
import type { GameAction, GameObservation } from "../types";
import type { AutoplayIntent } from "./autoplay";


export type SpeechMemory = { lastTurn: number; lastMs: number; topics: Record<string, number>; events: Set<string> };
export const createSpeechMemory = (): SpeechMemory => ({ lastTurn: -999, lastMs: -Infinity, topics: {}, events: new Set() });

/** 台詞用の選択は戦闘乱数を消費しない。文字数・表示時間はルールの時計に影響させない。 */
export function chooseDelverSpeech(observation: GameObservation, action: GameAction, intent: AutoplayIntent | null, memory: SpeechMemory, nowMs: number): AutoplayIntent | null {
  const config = realtimeConfig().dialogue;
  if (nowMs - memory.lastMs < config.minMs) return null;
  const dynamics = observation.expedition;
  const hpRatio = (observation.player.stats?.hp ?? 1) / (observation.player.stats?.maxHp ?? 1);
  const enemies = observation.visibleEntities.filter((e) => e.kind === "monster" && e.hostile);
  const request = (hpRatio < 0.35 && enemies.length > 0) || (visibleDangerTiles(observation).some((p) => p.x === observation.player.pos.x && p.y === observation.player.pos.y) && enemies.filter((e) => Math.max(Math.abs(e.pos.x - observation.player.pos.x), Math.abs(e.pos.y - observation.player.pos.y)) <= 1).length >= 2);
  let topic = intent?.topic ?? (action.type === "useItem" && getGameConfig().consumables[action.contentId]?.heal ? "heal" : action.type === "pickup" || action.type === "equip" ? "loot" : action.type === "descend" ? "descend" : intent?.tone === "combat" ? (intent.text.includes("守り手") ? "boss" : "attack") : "explore");
  let text: string | undefined;
  let eventKey: string | undefined;
  const memoryEvent = dynamics?.memories.at(-1);
  const riteKey = dynamics?.lastRite ? `rite:${dynamics.lastRite.runTurn}:${dynamics.lastRite.rite}` : null;
  if (memoryEvent && !memory.events.has(`memory:${memoryEvent.name}`)) {
    topic = "memory";
    text = `${memoryEvent.name}の経験を、無駄にしない`;
    eventKey = `memory:${memoryEvent.name}`;
  } else if (riteKey && !memory.events.has(riteKey) && observation.runTurn - dynamics!.lastRite!.runTurn <= 12) {
    topic = "thanks";
    eventKey = riteKey;
  } else if (request && observation.runTurn - (memory.topics.request ?? -999) >= config.repeatTurns) topic = "request";
  else if (observation.story.missionCompleted && !memory.events.has("vow-done")) {
    topic = "vow"; text = observation.status === "playing" ? "任務は果たした。生きて持ち帰ろう" : "任務は果たした"; eventKey = "vow-done";
  } else if (dynamics && !memory.events.has("vow-start")) {
    topic = "vow"; text = missionOpeners[observation.story.missionId]; eventKey = "vow-start";
  } else if (!request && observation.runTurn - memory.lastTurn < config.minTurns) return null;
  else if (topic === "explore") {
    if (observation.lantern.embers === 0) topic = "scarce";
    else if (observation.modifiers.scars.length && hpRatio < 0.65) topic = "scar";
    else if (observation.modifiers.rank > 0 && observation.runTurn % 3 === 0) topic = "veteran";
    else if (observation.runTurn % 5 === 0) topic = "role";
  }
  if (!eventKey && observation.runTurn - (memory.topics[topic] ?? -999) < config.repeatTurns) return null;
  const lines = topic === "role" ? roleSpeech[observation.runIdentity.roleId] : delverSpeech[topic]?.[observation.runIdentity.temperament];
  if (!text && lines?.length) text = lines[hash(`${observation.seed}:${observation.runTurn}:${observation.runIdentity.name}:${topic}`) % lines.length];
  if (!text) return null;
  memory.lastMs = nowMs;
  memory.lastTurn = observation.runTurn;
  memory.topics[topic] = observation.runTurn;
  if (eventKey) memory.events.add(eventKey);
  return { text, topic, tone: topic === "request" || topic === "heal" || topic === "dodge" ? "survival" : topic === "loot" ? "loot" : intent?.tone ?? "explore" };
}

function hash(text: string): number {
  let value = 2166136261;
  for (const ch of text) value = Math.imul(value ^ ch.charCodeAt(0), 16777619);
  return value >>> 0;
}
