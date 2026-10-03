/**
 * 遠征録を複数の「記録」に分けて保存する。各記録は独立した灰灯院（灯片・遠征団・真相・周期）を持つ。
 * 最初の記録は従来の保存キーをそのまま使い、以前の遊びをそのまま「記録一」として引き継ぐ。
 */

const INDEX_KEY = "black-candle-saves";
const LEGACY_CAMPAIGN_KEY = "black-candle-campaign-v1";
const LEGACY_TACTICS_KEY = "black-candle-tactics";
const FIRST_SLOT_ID = "slot-1";
/** 記録の上限。タイトルの一覧が一画面に収まる数にする。 */
export const MAX_SAVE_SLOTS = 5;
/** 記録を選んで読み直した直後は、タイトルを待たずに灰灯院へ入る。 */
const AUTO_ENTER_KEY = "black-candle-auto-enter";

export type SaveSlot = { id: string; name: string; createdAt: string; playedAt?: string };
export type SaveIndex = { active: string; slots: SaveSlot[] };

const NUMERALS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

export function loadSaveIndex(): SaveIndex {
  const stored = readJson(INDEX_KEY) as Partial<SaveIndex> | null;
  const slots = Array.isArray(stored?.slots)
    ? stored.slots.filter((slot): slot is SaveSlot => !!slot && typeof slot.id === "string" && typeof slot.name === "string")
    : [];
  if (slots.length === 0) slots.push({ id: FIRST_SLOT_ID, name: "記録一", createdAt: new Date().toISOString() });
  const active = slots.some((slot) => slot.id === stored?.active) ? stored!.active! : slots[0].id;
  return { active, slots };
}

export function saveSaveIndex(index: SaveIndex): void {
  writeJson(INDEX_KEY, index);
}

export function campaignStorageKey(slotId: string): string {
  return slotId === FIRST_SLOT_ID ? LEGACY_CAMPAIGN_KEY : `black-candle-campaign:${slotId}`;
}

export function tacticsStorageKey(slotId: string): string {
  return slotId === FIRST_SLOT_ID ? LEGACY_TACTICS_KEY : `black-candle-tactics:${slotId}`;
}

export function readSlotCampaign(slotId: string): unknown {
  return readJson(campaignStorageKey(slotId));
}

/** 新しい記録を作って使用中にする。上限に達していれば何もしない。 */
export function createSaveSlot(index: SaveIndex): SaveIndex {
  if (index.slots.length >= MAX_SAVE_SLOTS) return index;
  const used = new Set(index.slots.map((slot) => slot.name));
  const name = NUMERALS.map((numeral) => `記録${numeral}`).find((candidate) => !used.has(candidate)) ?? `記録${index.slots.length + 1}`;
  const id = `slot-${Date.now().toString(36)}`;
  const next = { active: id, slots: [...index.slots, { id, name, createdAt: new Date().toISOString() }] };
  saveSaveIndex(next);
  return next;
}

/** 使用中でない記録を消す。保存した遠征録と作戦の記憶も消える。 */
export function deleteSaveSlot(index: SaveIndex, slotId: string): SaveIndex {
  if (slotId === index.active || !index.slots.some((slot) => slot.id === slotId)) return index;
  removeKey(campaignStorageKey(slotId));
  removeKey(tacticsStorageKey(slotId));
  const next = { ...index, slots: index.slots.filter((slot) => slot.id !== slotId) };
  saveSaveIndex(next);
  return next;
}

export function activateSaveSlot(index: SaveIndex, slotId: string): SaveIndex {
  if (!index.slots.some((slot) => slot.id === slotId)) return index;
  const next = { ...index, active: slotId };
  saveSaveIndex(next);
  return next;
}

/** 遠征を記録した時刻。一覧で「最後に遊んだ日」を出す。 */
export function touchSaveSlot(index: SaveIndex, slotId: string): SaveIndex {
  const next = { ...index, slots: index.slots.map((slot) => slot.id === slotId ? { ...slot, playedAt: new Date().toISOString() } : slot) };
  saveSaveIndex(next);
  return next;
}

export function requestAutoEnter(): void {
  try {
    window.sessionStorage.setItem(AUTO_ENTER_KEY, "1");
  } catch {
    // 自動で入れなくても、タイトルから入れば遊べる。
  }
}

export function consumeAutoEnter(): boolean {
  try {
    const value = window.sessionStorage.getItem(AUTO_ENTER_KEY);
    window.sessionStorage.removeItem(AUTO_ENTER_KEY);
    return value === "1";
  } catch {
    return false;
  }
}

function readJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn("記録の一覧を保存できませんでした。", error);
  }
}

function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // 消せなかった記録は一覧から外れるだけで、遊びには影響しない。
  }
}
