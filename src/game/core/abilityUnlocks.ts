import { getGameConfig } from "../content/config";
import { getContentName } from "../content/entities";
import type { AbilityUnlock, CampaignState } from "../types";
import { campaignProgress } from "./autonomous";
import { journeyTotals } from "./journey";

// 灰灯院の記録から、解放済みのアビリティと枠の数を決める。

export function abilityIds(): string[] {
  return Object.keys(getGameConfig().abilities?.definitions ?? {});
}

export function isAbilityUnlocked(campaign: CampaignState, unlock: AbilityUnlock, chapters = campaignProgress(campaign).roadmap): boolean {
  if (unlock.kind === "role") return (campaign.legacies ?? []).includes(unlock.roleId);
  if (unlock.kind === "chapter") return chapters.some((chapter) => chapter.id === unlock.chapterId && chapter.done);
  return journeyTotals(campaign).trialsCleared >= unlock.stage;
}

export function unlockedAbilityIds(campaign: CampaignState): string[] {
  const definitions = getGameConfig().abilities?.definitions ?? {};
  const chapters = campaignProgress(campaign).roadmap;
  return Object.entries(definitions).filter(([, definition]) => isAbilityUnlocked(campaign, definition.unlock, chapters)).map(([id]) => id);
}

export function abilitySlots(campaign: CampaignState): number {
  const config = getGameConfig();
  const perLevel = config.campaign.facilities["training-hall"]?.abilitySlotsPerLevel ?? 0;
  return (config.abilities?.baseSlots ?? 0) + (campaign.facilities["training-hall"] ?? 0) * perLevel;
}

/** 解放済みで枠に収まる分だけを残す。順番は付けた順を保つ。 */
export function normalizeAbilityLoadout(campaign: CampaignState, ids: readonly string[] = campaign.abilityLoadout ?? []): string[] {
  const unlocked = new Set(unlockedAbilityIds(campaign));
  return [...new Set(ids)].filter((id) => unlocked.has(id)).slice(0, abilitySlots(campaign));
}

export function abilityUnlockLabel(unlock: AbilityUnlock): string {
  if (unlock.kind === "role") return `${getContentName(unlock.roleId)}で第十層を踏破`;
  if (unlock.kind === "trial") return `${getGameConfig().campaign.journey?.trials[unlock.stage - 1]?.label ?? "覚醒"}を突破`;
  const chapter: Record<typeof unlock.chapterId, string> = {
    "first-route": "第一の帰還路を開く",
    "first-truth": "真相を一つ持ち帰る",
    "three-truths": "三つの真相を揃える",
    "black-core": "黒燭核を討つ",
    ending: "結末を迎える",
  };
  return chapter[unlock.chapterId];
}

/** 未解放のカードに出す「〜すると解放」。 */
export function abilityUnlockHint(unlock: AbilityUnlock): string {
  if (unlock.kind === "role") return `${getContentName(unlock.roleId)}で第十層を踏破すると解放`;
  if (unlock.kind === "trial") return `${getGameConfig().campaign.journey?.trials[unlock.stage - 1]?.label ?? "覚醒"}を突破すると解放`;
  const chapter: Record<typeof unlock.chapterId, string> = {
    "first-route": "第一の帰還路を開くと解放",
    "first-truth": "真相を一つ持ち帰ると解放",
    "three-truths": "三つの真相を揃えると解放",
    "black-core": "黒燭核を討つと解放",
    ending: "結末を迎えると解放",
  };
  return chapter[unlock.chapterId];
}
