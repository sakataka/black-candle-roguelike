import { getGameConfig } from "../content/config";
import type { CampaignState } from "../types";

/** 記録一覧が100件を超えても成長と突破は失われない。旧記録は残存する遠征から復元。 */
export function journeyTotals(campaign: CampaignState): NonNullable<CampaignState["journey"]> {
  return campaign.journey ?? {
    victories: campaign.expeditions.filter((run) => run.status === "won").length,
    trialsCleared: 0,
    lifetimeShards: campaign.expeditions.reduce((sum, run) => sum + run.shards.total, 0),
  };
}

export function journeyProgress(campaign: CampaignState) {
  const totals = journeyTotals(campaign);
  const config = getGameConfig().campaign.journey;
  const rank = config ? Math.min(config.maxRank, Math.floor(totals.lifetimeShards / config.shardsPerRank)) : 0;
  const next = config?.trials[totals.trialsCleared];
  const active = !!next && totals.victories >= next.victories;
  return {
    ...totals, rank,
    maxHp: rank * (config?.maxHpPerRank ?? 0),
    attack: rank * (config?.attackPerRank ?? 0),
    shardsToNextRank: config && rank < config.maxRank ? (rank + 1) * config.shardsPerRank - totals.lifetimeShards : 0,
    trial: active ? totals.trialsCleared + 1 : 0,
    nextTrial: next,
    victoriesToTrial: next ? Math.max(0, next.victories - totals.victories) : 0,
  };
}

export function bossTrialDefinition(trial = 0) {
  return getGameConfig().campaign.journey?.trials[trial - 1];
}

export function foundationBonus(rank = 0) {
  const config = getGameConfig().campaign.journey;
  const safeRank = Math.max(0, Math.min(config?.maxRank ?? 0, Math.floor(rank)));
  return { maxHp: safeRank * (config?.maxHpPerRank ?? 0), attack: safeRank * (config?.attackPerRank ?? 0) };
}
