import type { WatcherPolicy } from "../ai/watcher";
import type { DecisionPolicy } from "../core/autonomous";
import type { CampaignState } from "../types";

// 灰灯院の育ち具合と比べたい条件。batch の --stage / --variant / --ability-sweep から使う。

export type RunSettings = {
  foundationRank: number;
  bossTrial: number;
  abilities: string[];
  facilities: Partial<CampaignState["facilities"]>;
  tactics: string[];
  watcherPolicy: WatcherPolicy;
  decisionPolicy: DecisionPolicy;
  heat: number;
};

export type StageId = "fresh" | "early" | "mid" | "late";

/**
 * 遊び始め・数回帰った頃・中盤・長く遊んだ後の灰灯院。
 * アビリティは解放されやすい順に付ける。覚醒はかけない（--boss-trial で別に指定する）。
 */
export const stagePresets: Record<StageId, Partial<RunSettings>> = {
  fresh: { foundationRank: 0, abilities: [], facilities: {} },
  early: {
    foundationRank: 2,
    abilities: ["ability.homeward-wisdom", "ability.truth-flame"],
    facilities: { altar: 1 },
  },
  mid: {
    foundationRank: 5,
    abilities: ["ability.homeward-wisdom", "ability.truth-flame", "ability.guardian-spoils", "ability.herbal-lore"],
    facilities: { altar: 1, "war-room": 1, archive: 1, "training-hall": 2 },
  },
  late: {
    foundationRank: 10,
    abilities: ["ability.kindred-vigor", "ability.stone-heart", "ability.iron-hide", "ability.truth-flame", "ability.herbal-lore", "ability.core-breaker"],
    facilities: { altar: 2, "war-room": 2, archive: 3, "training-hall": 4 },
  },
};

export function parseStageId(value: string): StageId {
  if (value === "fresh" || value === "early" || value === "mid" || value === "late") return value;
  throw new Error("--stage must be fresh, early, mid, or late");
}

/** `key:value,key:value` を条件に変換する。config は列の設定ファイル、それ以外は遠征の条件。 */
export function parseVariantSettings(spec: string): { config?: string; settings: Partial<RunSettings> } {
  let config: string | undefined;
  let settings: Partial<RunSettings> = {};
  for (const part of spec.split(",").filter(Boolean)) {
    const separator = part.indexOf(":");
    if (separator < 0) throw new Error(`Invalid variant setting: ${part}`);
    const key = part.slice(0, separator);
    const value = part.slice(separator + 1);
    if (key === "config") config = value;
    else if (key === "stage") settings = { ...settings, ...stagePresets[parseStageId(value)] };
    else if (key === "abilities") settings.abilities = value === "none" ? [] : value.split("+").filter(Boolean);
    else if (key === "tactics") settings.tactics = value === "none" ? [] : value.split("+").filter(Boolean);
    else if (key === "rank") settings.foundationRank = integer(value, key);
    else if (key === "trial") settings.bossTrial = integer(value, key);
    else if (key === "heat") settings.heat = integer(value, key);
    else if (key === "watcher") settings.watcherPolicy = value === "lantern" ? "lantern" : "none";
    else if (key === "decision") settings.decisionPolicy = value as DecisionPolicy;
    else throw new Error(`Unknown variant key: ${key}`);
  }
  return { config, settings };
}

function integer(value: string, key: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${key} must be a non-negative integer`);
  return number;
}
