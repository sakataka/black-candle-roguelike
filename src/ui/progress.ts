import { escapeHtmlAttribute } from "./dom";
import { campaignProgress, ROLE_TRUTH_IDS, roleTruthLabel, truthRoleLabel } from "../game/core/autonomous";
import { getGameConfig } from "../game/content/config";
import { journeyProgress } from "../game/core/journey";
import { assetForContent } from "../game/content/assets";
import type { CampaignState, RoleTruthId } from "../game/types";

const chapterNames = ["帰還路", "最初の真相", "三つの真相", "黒燭核", "結末"];
const truthMarks = ["剣", "弓", "祈"];
function bossPortrait(): string {
  const asset = assetForContent("monster.black-candle-warden");
  if (!asset) return "";
  const { columns, rows, index } = asset.sheet!;
  const x = columns === 1 ? 0 : (index % columns) / (columns - 1) * 100;
  const y = rows === 1 ? 0 : Math.floor(index / columns) / (rows - 1) * 100;
  return `<i style="background-image:url('${import.meta.env.BASE_URL}${asset.path.replace(/^\//, "")}');background-size:${columns * 100}% ${rows * 100}%;background-position:${x}% ${y}%"></i>`;
}

/** 黒燭は章、三つのくぼみは持ち帰った真相を表す。途中の収集も独立して見える。 */
export function candleRoadMarkup(campaign: CampaignState, fresh = new Set<string>(), freshTruths: RoleTruthId[] = []): string {
  const progress = campaignProgress(campaign);
  const done = progress.roadmap.filter((chapter) => chapter.done).length;
  const next = progress.nextChapter;
  return `<section class="candle-road" aria-label="黒燭への道">
    <div class="black-candle${done === progress.roadmap.length ? " is-complete" : ""}" role="img" aria-label="黒燭への道 ${done}/${progress.roadmap.length}章・真相 ${campaign.roleTruths.length}/${ROLE_TRUTH_IDS.length}">
      <i class="candle-flame"></i><div class="candle-wax"><i class="candle-fill" style="height:${done / progress.roadmap.length * 100}%"></i><div class="candle-seals">${progress.roadmap.slice().reverse().map((chapter) => `<i class="${chapter.done ? "is-lit" : ""}${fresh.has(chapter.id) ? " is-fresh" : ""}">${chapter.done ? "◆" : "◇"}</i>`).join("")}</div></div><i class="candle-foot"></i>
    </div>
    <div class="candle-road-content">
      <div class="progress-kicker">黒燭への道 <b>${done}/${progress.roadmap.length}</b></div>
      <ol class="candle-chapters">${progress.roadmap.map((chapter, i) => `<li class="${chapter.done ? "is-done" : chapter.id === next?.id ? "is-next" : ""}${fresh.has(chapter.id) ? " is-fresh" : ""}"${chapter.id === next?.id ? ' aria-current="step"' : ""}><span>${chapter.done ? "◆" : i + 1}</span><strong>${chapterNames[i]}</strong></li>`).join("")}</ol>
      <div class="truth-sockets" aria-label="持ち帰った三つの真相">${ROLE_TRUTH_IDS.map((truth, i) => {
        const found = campaign.roleTruths.includes(truth);
        return `<span class="truth-socket${found ? " is-filled" : ""}${freshTruths.includes(truth) ? " is-fresh" : ""}" title="${escapeHtmlAttribute(roleTruthLabel(truth))} · ${escapeHtmlAttribute(truthRoleLabel(truth))} · ${found ? "回収済み" : "未回収"}"><i aria-hidden="true">${truthMarks[i]}</i><span>${escapeHtmlAttribute(roleTruthLabel(truth))}<small>${found ? "◆ 回収済み" : `${escapeHtmlAttribute(truthRoleLabel(truth))}で帰還`}</small></span></span>`;
      }).join("")}</div>
      <p class="progress-next">${next ? `<span>次へ</span><strong>${escapeHtmlAttribute(next.label)}</strong>` : `<span>第${campaign.cycle.number}周期</span><strong>結末を記録した</strong>`}</p>
    </div>
  </section>`;
}

/** 消費しても減らない累計の鍛錬と、踏破数で開く覚醒を別の器で表す。 */
export function growthMarkup(campaign: CampaignState, before?: CampaignState | null): string {
  const journey = journeyProgress(campaign);
  const config = getGameConfig().campaign.journey;
  const perRank = config?.shardsPerRank ?? 60;
  const filled = journey.shardsToNextRank ? perRank - journey.shardsToNextRank : perRank;
  const previous = before ? journeyProgress(before) : null;
  const gain = previous ? journey.lifetimeShards - previous.lifetimeShards : 0;
  return `<section class="growth-board" aria-label="繰り返しで育つ力">
    <div class="growth-power${previous && previous.rank < journey.rank ? " is-fresh" : ""}">
      <div class="progress-kicker">灰灯院の鍛錬${gain > 0 ? `<b>今回 +${gain}灯片</b>` : ""}</div>
      <div class="power-line"><strong><small>Lv</small>${journey.rank}</strong><div><span>HP <b>+${journey.maxHp}</b></span><span>攻撃 <b>+${journey.attack}</b></span></div></div>
      <div class="power-vessel" role="progressbar" aria-label="次の鍛錬までの灯片" aria-valuemin="0" aria-valuemax="${perRank}" aria-valuenow="${filled}" aria-valuetext="${journey.shardsToNextRank ? `次の鍛錬まで${journey.shardsToNextRank}灯片` : "鍛錬は最大"}"><i style="width:${filled / perRank * 100}%"></i></div>
      <p class="growth-caption">${journey.shardsToNextRank ? `次のLvまで <b>${journey.shardsToNextRank}</b> 灯片` : "鍛錬は最大"}<small>全探索者に継承 · 消費しても減らない</small></p>
    </div>
    <div class="growth-trials${journey.trial ? " is-challenge" : ""}">
      <div class="progress-kicker">${journey.trial ? "覚醒ボスに挑戦中" : "次の強敵へ"}<b>踏破 ${journey.victories}回</b></div>
      <ol class="trial-path">${(config?.trials ?? []).map((trial, i) => {
        const cleared = i < journey.trialsCleared;
        const active = i === journey.trialsCleared;
        const previousThreshold = i > 0 ? config!.trials[i - 1].victories : 0;
        const span = Math.max(1, trial.victories - previousThreshold);
        const current = Math.min(span, Math.max(0, journey.victories - previousThreshold));
        return `<li class="${cleared ? "is-cleared" : active ? "is-next" : ""}${active && journey.trial ? " is-challenge" : ""}"><span class="trial-sigil" aria-hidden="true">${bossPortrait()}<b>${cleared ? "◆" : i + 1}</b></span><strong>${escapeHtmlAttribute(trial.label)}</strong><div class="trial-pips" role="img" aria-label="${escapeHtmlAttribute(trial.label)}: ${cleared ? "突破済み" : active && journey.trial ? "挑戦中" : `踏破 ${current}/${span}`}">${Array.from({ length: span }, (_, n) => `<i class="${cleared || n < current ? "is-filled" : ""}"></i>`).join("")}</div><small>${cleared ? "突破" : active && journey.trial ? "挑戦中" : `踏破 ${trial.victories}回で覚醒`}</small></li>`;
      }).join("")}</ol>
      <p class="growth-caption">${journey.trial ? "第6階・第10層の守り手が覚醒。第10層の踏破で突破。" : journey.nextTrial ? `あと <b>${journey.victoriesToTrial}</b> 回の踏破で${escapeHtmlAttribute(journey.nextTrial.label)}` : "すべての覚醒を突破した"}</p>
    </div>
  </section>`;
}
