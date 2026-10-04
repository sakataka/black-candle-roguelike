import { getGameConfig } from "../game/content/config";
import { assetForContent } from "../game/content/assets";
import { getContentName } from "../game/content/entities";
import { directiveLabel, missionDefinition, shardForecast, temperamentLabel } from "../game/core/autonomous";
import { pieceName } from "../game/core/inventory";
import type { GameObservation, GameState } from "../game/types";
import { escapeHtml } from "./dom";
import { applySprite } from "./sprites";
import { conditionLabel, conditionTone, equipmentDetail, equipmentSlotLabel, tacticLabels } from "./labels";

export function renderDecisionContext(observation: GameObservation, state: GameState, decisionStatus: HTMLElement, decisionContext: HTMLElement): void {
  const player = observation.player;
  const stats = player.stats;
  if (!stats) {
    decisionStatus.innerHTML = '<p class="empty-state">探索者の状態を取得できません。</p>';
    decisionContext.innerHTML = "";
    return;
  }

  const config = getGameConfig();
  const hpPercent = Math.max(0, Math.min(100, Math.round(stats.hp / stats.maxHp * 100)));
  const health = hpPercent <= 35
    ? { label: "危険", tone: "danger" }
    : hpPercent <= 70
      ? { label: "消耗", tone: "warning" }
      : { label: "安定", tone: "safe" };
  const conditions = player.conditions?.length
    ? player.conditions.map((condition) => `<span class="tag tag-${conditionTone(condition)}">${conditionLabel(condition)} ${condition.turns}手</span>`).join("")
    : '<span class="tag tag-quiet">異常なし</span>';
  decisionStatus.innerHTML = `
    <span class="decision-portrait" aria-hidden="true"></span>
    <div class="decision-who"><strong>${escapeHtml(state.runIdentity.name)}</strong><small>${escapeHtml(getContentName(player.contentId))} · Lv${observation.playerProgress.level}</small></div>
    <div class="decision-hp" data-tone="${health.tone}">
      <span>HP <b>${stats.hp} / ${stats.maxHp}</b><em>${health.label}</em></span>
      <div role="progressbar" aria-label="HP残量" aria-valuemin="0" aria-valuemax="${stats.maxHp}" aria-valuenow="${Math.max(0, stats.hp)}"><i style="width: ${hpPercent}%"></i></div>
    </div>
    <div class="decision-quick"><span>攻撃 <b>${stats.attack}</b></span><span>防御 <b>${stats.defense}</b></span><span>啓示 <b>${state.revelationsRemaining}/${config.autonomous.revelationsPerRun}</b></span></div>
    <div class="tag-row">${conditions}</div>
  `;
  applySprite(decisionStatus.querySelector<HTMLElement>(".decision-portrait") as HTMLElement, assetForContent(player.contentId), 44);

  const equipment = (["weapon", "armor", "shield"] as const).map((slot) => {
    const entry = player.inventory?.find((item) => item.equipped && config.equipment[item.contentId]?.slot === slot);
    return `<div class="decision-equipment-item">
      <span>${equipmentSlotLabel(slot)}</span>
      <strong>${entry ? escapeHtml(pieceName(entry)) : "未装備"}</strong>
      <small>${entry ? escapeHtml(equipmentDetail(entry.contentId, entry)) : "補正なし"}</small>
    </div>`;
  }).join("");
  const forecast = shardForecast(state);
  decisionContext.innerHTML = `
    <div class="decision-equipment-grid">${equipment}</div>
    <div class="decision-meta-grid">
      <span>気質 <strong>${temperamentLabel(state.runIdentity.temperament)}</strong></span>
      <span>現在方針 <strong>${directiveLabel(state.directive)}</strong></span>
      <span>任務 <strong>${missionDefinition(state.story.missionId).label}</strong></span>
      <span>作戦 <strong>${state.tactics.length ? escapeHtml(tacticLabels(state.tactics).join("・")) : "なし"}</strong></span>
      <span>所持金 <strong>${observation.playerProgress.gold}</strong></span>
      <span>灯片の見込み <strong>帰還+${forecast.ifReturned} / 倒れれば+${forecast.ifLost}</strong></span>
    </div>
  `;
}
