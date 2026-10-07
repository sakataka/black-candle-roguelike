import { getGameConfig } from "../game/content/config";
import { unlockedAbilityIds } from "../game/core/abilityUnlocks";
import { endingLabel } from "../game/core/autonomous";
import type { CampaignState, ExpeditionRecord } from "../game/types";
import { escapeHtml } from "./dom";
import { toKanjiNumber } from "./labels";

type ResultMilestone = {
  kind: "keeper" | "ending" | "ability" | "fallen" | "scarred" | "promoted" | "recruited";
  kicker: string;
  title: string;
  detail: string;
};

/** 墓標に刻む最期の一文。死因の分類から物語の言葉へ置き換える。 */
const FALL_EPITAPHS: Record<string, string> = {
  combat: "刃の下に倒れた。",
  rangedCombat: "闇から放たれた一矢に倒れた。",
  trap: "古い罠に命を奪われた。",
  bleeding: "流れる血を止められなかった。",
  venom: "毒が回りきった。",
  signalLoss: "灯芯が尽き、闇に呑まれた。",
};
/** 今回の結果に添える記録の更新。前回比は数値の欄に置き、ここには節目の札だけを並べる。 */
export function runComparisonMarkup(current: ExpeditionRecord, campaign: CampaignState): string {
  const older = campaign.expeditions.slice(1);
  const newDepthRecord = current.floor > older.reduce((best, record) => Math.max(best, record.floor), 0);
  const newShardRecord = current.shards.total > older.reduce((best, record) => Math.max(best, record.shards.total), 0);
  const badges = [
    newDepthRecord ? "最高到達階を更新" : "",
    newShardRecord && older.length > 0 ? "最多灯片を更新" : "",
    current.truthRecovered && current.shards.truth > 0 ? "新たな真相を持ち帰った" : "",
    current.gravesRecovered ? `墓標${current.gravesRecovered}つを弔った` : "",
    current.status === "won" && (current.heat ?? 0) + 1 === campaign.heat.unlocked ? `燭階${campaign.heat.unlocked}が開いた` : "",
    // 墓標・昇格・結末などは上の碑に刻むので、ここでは碑にならない結果だけを添える。
    current.veteranOutcome === "roster-full" ? "遠征団が満員のため加入しなかった（古参は全員残っています）" : "",
  ].filter(Boolean);
  const lead = older.length === 0 ? "最初の遠征記録です。ここから灯守の記録が始まります。" : "";
  return `${lead ? `<p>${escapeHtml(lead)}</p>` : ""}${badges.length ? `<div class="tag-row">${badges.map((badge) => `<span class="tag tag-gold">◆ ${escapeHtml(badge)}</span>`).join("")}</div>` : ""}`;
}

export function milestoneFor(record: ExpeditionRecord, campaign: CampaignState, abilitiesAtDeparture: ReadonlySet<string>): ResultMilestone | null {
  const name = escapeHtml(record.identity.name);
  const floor = `地下${toKanjiNumber(record.floor)}階`;
  const veteran = campaign.roster.find((entry) => entry.id === (record.identity.veteranId ?? `veteran-${record.seed}-${record.identity.roleId}`));
  const maxRank = getGameConfig().campaign.veteranMaxRank;
  const stars = (rank: number) => `<span class="milestone-ranks" aria-label="位階${rank}">${Array.from({ length: maxRank }, (_, index) => `<i class="${index < rank ? "is-lit" : ""}" style="--n:${index}">★</i>`).join("")}</span>`;
  if (record.veteranOutcome === "keeper") {
    return { kind: "keeper", kicker: "継燭", title: `${name}、黒燭を継ぐ`, detail: `灰灯院へは帰らない。第${toKanjiNumber(campaign.cycle.number)}周期の第十層で、堕ちた灯守として待っている。` };
  }
  if (record.endingId) {
    const previousCycle = Math.max(1, campaign.cycle.number - 1);
    return {
      kind: "ending",
      kicker: `結末 · ${endingLabel(record.endingId)}`,
      title: `<span class="milestone-cycle"><s>第${toKanjiNumber(previousCycle)}周期</s><b>第${toKanjiNumber(campaign.cycle.number)}周期</b></span>`,
      detail: "選んだ結末の余波が、次の迷宮を変える。",
    };
  }
  const newAbilities = unlockedAbilityIds(campaign).filter((id) => !abilitiesAtDeparture.has(id)).map((id) => getGameConfig().abilities.definitions[id]);
  if (newAbilities.length) {
    return {
      kind: "ability",
      kicker: "アビリティの解放",
      title: `${newAbilities.map((ability) => `「${escapeHtml(ability.label)}」`).join("")}を会得した`,
      detail: `${newAbilities.map((ability) => escapeHtml(ability.description)).join(" ")}次の遠征から、灰灯院の支度で付けられる。`,
    };
  }
  if (record.veteranOutcome === "fallen") {
    const cause = record.deathCause ? FALL_EPITAPHS[record.deathCause] ?? "" : "";
    return { kind: "fallen", kicker: "墓標", title: `${name}、${floor}に眠る`, detail: `${cause}後の遠征でこの墓標を弔えば、遺品と灯火を受け継げる。` };
  }
  if (record.veteranOutcome === "scarred") {
    const scar = veteran?.scars.at(-1);
    const label = scar ? getGameConfig().scars[scar]?.label ?? scar : "古傷";
    return { kind: "scarred", kicker: "古傷", title: `${name}、「${escapeHtml(label)}」を負って帰る`, detail: `${veteran ? stars(veteran.rank) : ""}灰灯院の療房で癒やせる。` };
  }
  if (record.veteranOutcome === "promoted" && veteran) {
    return { kind: "promoted", kicker: "昇格", title: `${name}、位階${toKanjiNumber(veteran.rank)}へ`, detail: stars(veteran.rank) };
  }
  if (record.veteranOutcome === "recruited") {
    return { kind: "recruited", kicker: "遠征団", title: `${name}、遠征団に名を連ねる`, detail: "次の遠征から古参として送り出せる。" };
  }
  return null;
}
