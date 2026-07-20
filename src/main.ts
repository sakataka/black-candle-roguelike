import "./styles.css";
import { chooseAutoplayAction, getAutoplayDebugState } from "./game/ai/autoplay";
import { getGameConfig, loadBrowserGameConfig } from "./game/content/config";
import { assetForContent } from "./game/content/assets";
import { getContentName } from "./game/content/entities";
import {
  calculateScore,
  chooseDecisionAction,
  createCampaignState,
  createRunIdentity,
  directiveLabel,
  endingLabel,
  normalizeCampaignState,
  recordCampaignResult,
  temperamentDescription,
  temperamentLabel,
} from "./game/core/autonomous";
import { applyAction, biomeThemeName, createInitialGame, observeGame, playableRoles } from "./game/core/game";
import { analyzeRun, createRunLog, recordTurn } from "./game/core/runLog";
import { PixiRoguelikeRenderer } from "./game/renderer/PixiRoguelikeRenderer";
import type {
  CampaignState,
  EquipmentConfig,
  GameAction,
  GameState,
  RoleTruthId,
  RunLog,
  RunLogEntry,
  RunReview,
  StatusCondition,
} from "./game/types";

const CAMPAIGN_STORAGE_KEY = "black-candle-campaign-v1";

declare global {
  interface Window {
    __rogueDebug?: {
      dump: () => string;
      getState: () => GameState;
      getObservation: () => ReturnType<typeof observeGame>;
      getRunLog: () => RunLog;
      getRunReview: () => RunReview;
      stepAi: (steps?: number) => GameState;
      stepUntilDecision: (steps?: number) => GameState;
    };
  }
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app root");

app.innerHTML = `
  <main class="observer-shell" tabindex="-1">
    <header class="observer-header">
      <div class="brand-block">
        <p class="eyebrow">灰灯院・遠征観測室</p>
        <h1>黒燭の迷宮</h1>
        <p class="brand-copy">探索者は自ら歩く。灯守は、運命の節目だけを選ぶ。</p>
      </div>
      <div class="header-actions">
        <div class="speed-selector" aria-label="観測速度">
          <span>観測速度</span>
          <button type="button" data-speed="0.5" aria-pressed="false">0.5×</button>
          <button type="button" data-speed="1" class="is-active" aria-pressed="true">1×</button>
          <button type="button" data-speed="2" aria-pressed="false">2×</button>
          <button type="button" data-speed="3" aria-pressed="false">3×</button>
        </div>
        <button id="new-expedition" class="secondary-button" type="button">新しい遠征</button>
      </div>
    </header>

    <section class="run-ribbon" aria-label="遠征状況">
      <div><span>探索者</span><strong id="run-delver">-</strong></div>
      <div><span>気質</span><strong id="run-temperament">-</strong></div>
      <div><span>方針</span><strong id="run-directive">-</strong></div>
      <div><span>啓示</span><strong id="run-revelations">-</strong></div>
      <div><span>深度</span><strong id="run-floor">-</strong></div>
      <div><span>観測手</span><strong id="run-turn">-</strong></div>
      <div class="turn-meter" aria-label="灯路の残り">
        <span id="turn-meter-label">灯路</span>
        <div><i id="turn-meter-fill"></i></div>
      </div>
    </section>

    <section class="observer-layout">
      <section class="map-panel" aria-label="黒燭越しの迷宮">
        <div class="map-heading">
          <div>
            <p class="eyebrow" id="biome-kicker">観測中</p>
            <h2 id="biome-title">黒石迷宮</h2>
          </div>
          <div class="live-score"><span>暫定得点</span><strong id="live-score">0</strong></div>
        </div>
        <div id="pixi-root" class="pixi-root"></div>
      </section>

      <aside class="observer-sidebar">
        <section class="side-card objective-card">
          <div class="section-heading"><h2>次の動き</h2><span id="explored-ratio">0%</span></div>
          <strong id="objective-title">未探索を広げる</strong>
          <p id="objective-detail">黒燭が映す道筋を追っています。</p>
        </section>
        <section class="side-card log-card">
          <div class="section-heading"><h2>遠征記録</h2><span>直近</span></div>
          <ol id="message-list" class="message-list"></ol>
        </section>
        <section class="side-card truth-card">
          <div class="section-heading"><h2>三つの真相</h2><span id="truth-count">0/3</span></div>
          <div id="truth-list" class="truth-list"></div>
        </section>
      </aside>
    </section>

    <section class="lower-grid">
      <section class="lower-card hero-card">
        <div class="section-heading"><h2>探索者</h2><span id="hero-role">-</span></div>
        <div id="hero-stats" class="stat-grid"></div>
      </section>
      <section class="lower-card inventory-card">
        <div class="section-heading"><h2>携行品</h2><span id="inventory-count">0</span></div>
        <ul id="inventory-list" class="inventory-list"></ul>
      </section>
      <section class="lower-card archive-card">
        <div class="section-heading"><h2>最近の遠征</h2><span id="archive-count">0</span></div>
        <ol id="archive-list" class="archive-list"></ol>
      </section>
    </section>
  </main>

  <section id="candidate-dialog" class="modal-layer" aria-live="polite">
    <div class="modal-panel candidate-panel" role="dialog" aria-modal="true" aria-labelledby="candidate-title">
      <p class="eyebrow">遠征者選定</p>
      <h2 id="candidate-title">誰を黒燭の迷宮へ送るか</h2>
      <p>職業だけでなく、探索者自身の気質もAIの判断へ影響します。</p>
      <div id="candidate-list" class="candidate-list"></div>
    </div>
  </section>

  <section id="decision-dialog" class="modal-layer" hidden aria-live="assertive">
    <div class="modal-panel decision-panel" role="dialog" aria-modal="true" aria-labelledby="decision-title">
      <p class="eyebrow">黒燭からの問い</p>
      <h2 id="decision-title">灯守の判断</h2>
      <p id="decision-body"></p>
      <section id="decision-context" class="decision-context" aria-label="判断材料"></section>
      <div id="decision-options" class="decision-options"></div>
      <p id="decision-hint" class="modal-hint"></p>
    </div>
  </section>

  <section id="end-dialog" class="modal-layer" hidden aria-live="assertive">
    <div class="modal-panel result-panel" role="dialog" aria-modal="true" aria-labelledby="end-title">
      <p id="end-kicker" class="eyebrow">遠征終了</p>
      <h2 id="end-title">遠征記録</h2>
      <p id="end-summary"></p>
      <div id="score-breakdown" class="score-breakdown"></div>
      <div id="decision-history" class="decision-history"></div>
      <button id="end-new-expedition" class="primary-button" type="button">次の探索者を選ぶ</button>
    </div>
  </section>
`;

await loadBrowserGameConfig();

const renderer = new PixiRoguelikeRenderer();
const observerShell = requireElement<HTMLElement>(".observer-shell");
const pixiRoot = requireElement<HTMLDivElement>("#pixi-root");
const candidateDialog = requireElement<HTMLElement>("#candidate-dialog");
const candidateList = requireElement<HTMLDivElement>("#candidate-list");
const decisionDialog = requireElement<HTMLElement>("#decision-dialog");
const decisionTitle = requireElement<HTMLHeadingElement>("#decision-title");
const decisionBody = requireElement<HTMLParagraphElement>("#decision-body");
const decisionContext = requireElement<HTMLElement>("#decision-context");
const decisionOptions = requireElement<HTMLDivElement>("#decision-options");
const decisionHint = requireElement<HTMLParagraphElement>("#decision-hint");
const endDialog = requireElement<HTMLElement>("#end-dialog");
const endKicker = requireElement<HTMLParagraphElement>("#end-kicker");
const endTitle = requireElement<HTMLHeadingElement>("#end-title");
const endSummary = requireElement<HTMLParagraphElement>("#end-summary");
const scoreBreakdown = requireElement<HTMLDivElement>("#score-breakdown");
const decisionHistory = requireElement<HTMLDivElement>("#decision-history");

let campaign = loadCampaign();
let candidateSeed = nextSeed();
let selectedRoleId = playableRoles()[0].id;
let selectedIdentity = createRunIdentity(candidateSeed, selectedRoleId);
let state = createInitialGame(candidateSeed, selectedRoleId, { identity: selectedIdentity, knownRoleTruths: campaign.roleTruths });
let runLog = createRunLog(state.seed, selectedRoleId, {}, selectedIdentity);
let currentReview: RunReview | null = null;
let autoplayTimer: number | null = null;
let speed = 1;
let archivedRunId: string | null = null;
let scheduledAction: GameAction = { type: "wait" };
let scheduledDanger = false;
let focusedModal: HTMLElement | null = null;

installEvents();
installDebugBridge();
renderCandidateSelection();
render();
await renderer.mount(pixiRoot);
render();

function installEvents(): void {
  document.querySelector(".speed-selector")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-speed]");
    if (!button) return;
    speed = Number(button.dataset.speed ?? 1);
    document.querySelectorAll<HTMLButtonElement>("button[data-speed]").forEach((candidate) => {
      const active = candidate === button;
      candidate.classList.toggle("is-active", active);
      candidate.setAttribute("aria-pressed", String(active));
    });
    if (autoplayTimer !== null) scheduleAutoplay(scheduledAction, scheduledDanger);
  });
  requireElement<HTMLButtonElement>("#new-expedition").addEventListener("click", openNewExpedition);
  requireElement<HTMLButtonElement>("#end-new-expedition").addEventListener("click", openNewExpedition);
  candidateList.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-role-id]");
    if (!button) return;
    startExpedition(button.dataset.roleId ?? playableRoles()[0].id);
  });
  decisionOptions.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-option-id]");
    if (!button || button.disabled) return;
    applyLoggedAction({ type: "resolveDecision", optionId: button.dataset.optionId ?? "" }, "player");
    render();
    if (state.status === "playing" && !state.pendingDecision) scheduleAutoplay({ type: "resolveDecision", optionId: button.dataset.optionId ?? "" });
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Tab" && focusedModal) {
      const focusable = [...focusedModal.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (!["1", "2", "3", "4"].includes(event.key)) return;
    const index = Number(event.key) - 1;
    const visibleButtons = !candidateDialog.hidden
      ? candidateList.querySelectorAll<HTMLButtonElement>("button[data-role-id]")
      : !decisionDialog.hidden
        ? decisionOptions.querySelectorAll<HTMLButtonElement>("button[data-option-id]:not(:disabled)")
        : [];
    visibleButtons[index]?.click();
  });
}

function openNewExpedition(): void {
  stopAutoplay();
  endDialog.hidden = true;
  decisionDialog.hidden = true;
  candidateSeed = nextSeed();
  renderCandidateSelection();
  candidateDialog.hidden = false;
  syncModalAccessibility();
}

function startExpedition(roleId: string): void {
  stopAutoplay();
  selectedRoleId = roleId;
  selectedIdentity = createRunIdentity(candidateSeed, roleId);
  state = createInitialGame(candidateSeed, roleId, { identity: selectedIdentity, knownRoleTruths: campaign.roleTruths });
  runLog = createRunLog(state.seed, roleId, {}, selectedIdentity);
  currentReview = null;
  archivedRunId = null;
  candidateDialog.hidden = true;
  decisionDialog.hidden = true;
  endDialog.hidden = true;
  render();
  scheduleAutoplay({ type: "wait" });
}

function renderCandidateSelection(): void {
  candidateList.replaceChildren(...playableRoles().map((role, index) => {
    const identity = createRunIdentity(candidateSeed, role.id);
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.roleId = role.id;
    button.className = "candidate-card";
    const asset = assetForContent(role.id);
    const portrait = document.createElement("span");
    portrait.className = "candidate-portrait";
    applySprite(portrait, asset, 72);
    const body = document.createElement("span");
    body.className = "candidate-body";
    body.innerHTML = `
      <span class="candidate-index">${index + 1}</span>
      <strong>${identity.name}</strong>
      <em>${getContentName(role.id)}</em>
      <span class="temperament-tag temperament-${identity.temperament}">${temperamentLabel(identity.temperament)}</span>
      <small>${temperamentDescription(identity.temperament)}</small>
      <small>HP ${role.stats.maxHp} / 攻撃 ${role.stats.attack} / 防御 ${role.stats.defense}</small>
    `;
    button.append(portrait, body);
    return button;
  }));
}

function stepAutoplay(): void {
  autoplayTimer = null;
  if (state.status !== "playing") {
    render();
    return;
  }
  if (state.pendingDecision) {
    render();
    return;
  }
  const observation = observeGame(state);
  const action = chooseAutoplayAction(observation);
  const logEntry = applyLoggedAction(action, "ai", getAutoplayDebugState(observation));
  render();
  if (state.status === "playing" && !state.pendingDecision) scheduleAutoplay(action, isDangerEntry(logEntry));
}

function scheduleAutoplay(lastAction: GameAction, danger = false): void {
  stopAutoplay();
  if (state.status !== "playing" || state.pendingDecision || !candidateDialog.hidden) return;
  scheduledAction = lastAction;
  scheduledDanger = danger;
  const pacing = getGameConfig().autonomous.pacingMs;
  const delay = danger ? pacing.danger : lastAction.type === "move" ? pacing.traversal : pacing.exploration;
  autoplayTimer = window.setTimeout(stepAutoplay, Math.max(40, Math.round(delay / speed)));
}

function stopAutoplay(): void {
  if (autoplayTimer === null) return;
  window.clearTimeout(autoplayTimer);
  autoplayTimer = null;
}

function applyLoggedAction(action: GameAction, actor: "player" | "ai", aiDebug?: Parameters<typeof recordTurn>[0]["aiDebug"]): RunLogEntry | null {
  const before = state;
  state = applyAction(state, action);
  if (state === before) return null;
  const entry = recordTurn({ log: runLog, before, action, after: state, actor, aiDebug });
  currentReview = state.status === "playing" ? null : analyzeRun(runLog, state);
  if (state.status !== "playing") archiveCompletedRun();
  return entry;
}

function isDangerEntry(entry: RunLogEntry | null): boolean {
  return entry?.messageDelta.some((message) => message.tone === "combat" || message.tone === "danger") ?? false;
}

function archiveCompletedRun(): void {
  const recordId = `${state.seed}-${state.runIdentity.roleId}-${state.runTurn}-${state.status}`;
  if (archivedRunId === recordId) return;
  const review = currentReview ?? analyzeRun(runLog, state);
  campaign = recordCampaignResult(campaign, state, review.deathCause);
  saveCampaign(campaign);
  archivedRunId = recordId;
}

function render(): void {
  renderer.render(state);
  const observation = observeGame(state);
  const player = observation.player;
  const config = getGameConfig();
  const score = calculateScore(state);
  setText("#run-delver", `${state.runIdentity.name} / ${getContentName(state.runIdentity.roleId)}`);
  setText("#run-temperament", temperamentLabel(state.runIdentity.temperament));
  setText("#run-directive", directiveLabel(state.directive));
  setText("#run-revelations", `${state.revelationsRemaining}/${config.autonomous.revelationsPerRun}`);
  setText("#run-floor", `${state.floor}/${config.rules.maxFloor}`);
  setText("#run-turn", `${state.runTurn}/${config.rules.runTurnLimit}`);
  setText("#biome-kicker", `地下${state.floor}階 / ${state.status === "playing" ? "観測中" : statusLabel(state.status)}`);
  setText("#biome-title", biomeThemeName(state.biome));
  setText("#live-score", score.total.toLocaleString("ja-JP"));
  setText("#turn-meter-label", state.runTurn >= config.rules.runTurnWarning ? "灯路が揺らいでいる" : "灯路は安定");
  const meter = requireElement<HTMLElement>("#turn-meter-fill");
  meter.style.width = `${Math.min(100, state.runTurn / config.rules.runTurnLimit * 100)}%`;
  meter.classList.toggle("is-warning", state.runTurn >= config.rules.runTurnWarning);

  setText("#explored-ratio", `${Math.round(observation.exploration.exploredTileRatio * 100)}%`);
  setText("#objective-title", objectiveLabel(observation.exploration.objective));
  setText("#objective-detail", objectiveDetail(observation));
  setText("#hero-role", getContentName(player.contentId));
  const progress = observation.playerProgress;
  requireElement<HTMLDivElement>("#hero-stats").innerHTML = [
    ["HP", player.stats ? `${player.stats.hp}/${player.stats.maxHp}` : "-"],
    ["Lv", String(progress.level)],
    ["攻撃", String(player.stats?.attack ?? "-")],
    ["防御", String(player.stats?.defense ?? "-")],
    ["Gold", String(progress.gold)],
    ["固有", String(state.runObjectives.roleGoalProgress)],
  ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");

  requireElement<HTMLOListElement>("#message-list").replaceChildren(...[...state.messages.slice(-8)].reverse().map((entry) => {
    const item = document.createElement("li");
    item.className = `tone-${entry.tone}`;
    item.innerHTML = `<span>${entry.turn}</span><p>${escapeHtml(entry.text)}</p>`;
    return item;
  }));
  renderInventory(player.inventory ?? []);
  renderTruths();
  renderArchive();
  renderDecision(observation);
  renderEnd();
  syncModalAccessibility();
}

function renderInventory(inventory: NonNullable<GameState["entities"][number]["inventory"]>): void {
  setText("#inventory-count", `${inventory.length}/${getGameConfig().rules.inventorySlotLimit}`);
  const list = requireElement<HTMLUListElement>("#inventory-list");
  if (inventory.length === 0) {
    list.innerHTML = '<li class="empty-state">携行品なし</li>';
    return;
  }
  list.replaceChildren(...inventory.map((entry) => {
    const item = document.createElement("li");
    const icon = document.createElement("span");
    icon.className = "inventory-icon";
    applySprite(icon, assetForContent(entry.contentId), 32);
    const text = document.createElement("span");
    text.innerHTML = `<strong>${escapeHtml(getContentName(entry.contentId))}</strong><small>x${entry.quantity}${entry.equipped ? " / 装備中" : ""}</small>`;
    item.append(icon, text);
    return item;
  }));
}

function renderTruths(): void {
  const truths: Array<{ id: RoleTruthId; name: string; hint: string }> = [
    { id: "shared-oath", name: "分誓の碑文", hint: "誓約の探索者で6階から生還" },
    { id: "furnace-map", name: "炉脈全図", hint: "灰弓の斥候で6階から生還" },
    { id: "purified-flame", name: "浄火の祈り", hint: "灯火の祈祷者で6階から生還" },
  ];
  setText("#truth-count", `${campaign.roleTruths.length}/3`);
  requireElement<HTMLDivElement>("#truth-list").replaceChildren(...truths.map((truth) => {
    const unlocked = campaign.roleTruths.includes(truth.id);
    const item = document.createElement("div");
    item.className = unlocked ? "truth-item is-unlocked" : "truth-item";
    item.innerHTML = `<i>${unlocked ? "◆" : "◇"}</i><span><strong>${truth.name}</strong><small>${unlocked ? "記録済み" : truth.hint}</small></span>`;
    return item;
  }));
}

function renderArchive(): void {
  setText("#archive-count", `${campaign.expeditions.length}件`);
  const list = requireElement<HTMLOListElement>("#archive-list");
  if (campaign.expeditions.length === 0) {
    list.innerHTML = '<li class="empty-state">まだ帰還記録はありません。</li>';
    return;
  }
  list.replaceChildren(...campaign.expeditions.slice(0, 6).map((record) => {
    const item = document.createElement("li");
    item.innerHTML = `<span class="archive-status status-${record.status}">${statusLabel(record.status)}</span><span><strong>${escapeHtml(record.identity.name)}</strong><small>${getContentName(record.identity.roleId)} / F${record.floor} / ${record.score.total.toLocaleString("ja-JP")}点</small></span>`;
    return item;
  }));
}

function renderDecision(observation: ReturnType<typeof observeGame>): void {
  const decision = state.pendingDecision;
  if (!decision || state.status !== "playing") {
    decisionDialog.hidden = true;
    return;
  }
  stopAutoplay();
  decisionTitle.textContent = decision.title;
  decisionBody.textContent = decision.body;
  renderDecisionContext(observation);
  decisionHint.textContent = `現在の啓示: ${state.revelationsRemaining}。啓示を使わない選択は探索者の気質に沿います。`;
  decisionOptions.replaceChildren(...decision.options.map((option, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.optionId = option.id;
    button.disabled = !!option.requiresRevelation && state.revelationsRemaining <= 0;
    button.className = option.id === decision.defaultOptionId ? "decision-option is-default" : "decision-option";
    const costLabel = option.requiresRevelation
      ? "啓示を1消費"
      : option.id === decision.defaultOptionId && decision.kind !== "final"
        ? "気質どおり・消費なし"
        : "消費なし";
    button.innerHTML = `<span>${index + 1}</span><strong>${escapeHtml(option.label)}</strong><small>${escapeHtml(option.description)}</small><em>${costLabel}</em>`;
    return button;
  }));
  decisionDialog.hidden = false;
}

function renderDecisionContext(observation: ReturnType<typeof observeGame>): void {
  const player = observation.player;
  const stats = player.stats;
  if (!stats) {
    decisionContext.innerHTML = '<p class="empty-state">探索者の状態を取得できません。</p>';
    return;
  }

  const config = getGameConfig();
  const hpPercent = Math.max(0, Math.min(100, Math.round(stats.hp / stats.maxHp * 100)));
  const health = hpPercent <= 35
    ? { label: "危険", tone: "danger" }
    : hpPercent <= 70
      ? { label: "消耗", tone: "warning" }
      : { label: "安定", tone: "safe" };
  const equipment = (["weapon", "armor", "shield"] as const).map((slot) => {
    const entry = player.inventory?.find((item) => item.equipped && config.equipment[item.contentId]?.slot === slot);
    const itemConfig = entry ? config.equipment[entry.contentId] : undefined;
    return `<div class="decision-equipment-item">
      <span>${equipmentSlotLabel(slot)}</span>
      <strong>${entry ? escapeHtml(getContentName(entry.contentId)) : "未装備"}</strong>
      <small>${itemConfig ? equipmentDetail(itemConfig) : "補正なし"}</small>
    </div>`;
  }).join("");
  const conditions = player.conditions?.length
    ? player.conditions.map((condition) => `<span class="condition-tag condition-${conditionTone(condition)}">${conditionLabel(condition)} ${condition.turns}T</span>`).join("")
    : '<span class="condition-tag condition-normal">異常なし</span>';
  const score = calculateScore(state);

  decisionContext.innerHTML = `
    <div class="decision-context-heading">
      <span>判断材料</span>
      <strong>${escapeHtml(state.runIdentity.name)} · ${escapeHtml(getContentName(player.contentId))}</strong>
      <em>地下${state.floor}階 / ${state.runTurn}手</em>
    </div>
    <div class="decision-stat-grid">
      <div class="decision-hp decision-hp-${health.tone}">
        <span>HP <em>${health.label}・${hpPercent}%</em></span>
        <strong>${stats.hp} / ${stats.maxHp}</strong>
        <div role="progressbar" aria-label="HP残量" aria-valuemin="0" aria-valuemax="${stats.maxHp}" aria-valuenow="${Math.max(0, stats.hp)}"><i style="width: ${hpPercent}%"></i></div>
      </div>
      <div><span>攻撃</span><strong>${stats.attack}</strong></div>
      <div><span>防御</span><strong>${stats.defense}</strong></div>
      <div><span>Lv</span><strong>${observation.playerProgress.level}</strong></div>
    </div>
    <div class="decision-equipment-grid">${equipment}</div>
    <div class="decision-context-footer">
      <div class="decision-conditions"><span>状態</span>${conditions}</div>
      <div class="decision-meta-grid">
        <span>気質 <strong>${temperamentLabel(state.runIdentity.temperament)}</strong></span>
        <span>現在方針 <strong>${directiveLabel(state.directive)}</strong></span>
        <span>所持金 <strong>${observation.playerProgress.gold}</strong></span>
        <span>暫定得点 <strong>${score.total.toLocaleString("ja-JP")}</strong></span>
      </div>
    </div>
  `;
}

function equipmentSlotLabel(slot: EquipmentConfig["slot"]): string {
  if (slot === "weapon") return "武器";
  if (slot === "armor") return "防具";
  return "盾";
}

function equipmentDetail(equipment: EquipmentConfig): string {
  const details = [`${equipment.slot === "weapon" ? "威力" : "防御"} +${equipment.power}`];
  if (equipment.rangedDefense) details.push(`遠隔防御 +${equipment.rangedDefense}`);
  const trapAvoid = (equipment.trapAvoidPercent ?? 0) - (equipment.trapAvoidPenaltyPercent ?? 0);
  if (trapAvoid !== 0) details.push(`罠回避 ${trapAvoid > 0 ? "+" : ""}${trapAvoid}%`);
  if (equipment.specialDamage) details.push(`特効 +${equipment.specialDamage.amount}`);
  return details.join(" / ");
}

function conditionLabel(condition: StatusCondition): string {
  if (condition.kind === "guarded") return "護り";
  if (condition.kind === "bleeding") return "出血";
  return "毒";
}

function conditionTone(condition: StatusCondition): "safe" | "danger" {
  return condition.kind === "guarded" ? "safe" : "danger";
}

function renderEnd(): void {
  if (state.status === "playing") {
    endDialog.hidden = true;
    return;
  }
  stopAutoplay();
  const review = currentReview ?? analyzeRun(runLog, state);
  const status = statusLabel(state.status);
  endKicker.textContent = state.status === "won" ? "遠征達成" : state.status === "returned" ? "生還" : "遠征終了";
  endTitle.textContent = `${state.runIdentity.name} — ${status}`;
  endSummary.textContent = state.story.endingId
    ? `${endingLabel(state.story.endingId)}の結末を遠征録へ刻みました。`
    : `${review.summaryText} 得点は${review.score.total.toLocaleString("ja-JP")}点です。`;
  const rows: Array<[string, number]> = [
    ["進行", review.score.depth], ["守護者", review.score.guardians], ["職業目的", review.score.roleObjective],
    ["発見", review.score.discoveries], ["生還", review.score.survival], ["持帰り", review.score.recoveredValue],
    ["迅速", review.score.tempo], ["自律", review.score.autonomy],
  ];
  scoreBreakdown.innerHTML = `${rows.map(([label, value]) => `<div><span>${label}</span><strong>${value.toLocaleString("ja-JP")}</strong></div>`).join("")}<div class="score-total"><span>総合</span><strong>${review.score.total.toLocaleString("ja-JP")}</strong></div>`;
  decisionHistory.innerHTML = `<h3>灯守の判断</h3>${review.decisions.length === 0 ? "<p>介入記録なし</p>" : `<ol>${review.decisions.map((entry) => `<li><span>F${entry.floor}</span><strong>${escapeHtml(entry.optionLabel)}</strong>${entry.usedRevelation ? "<em>啓示</em>" : ""}</li>`).join("")}</ol>`}`;
  endDialog.hidden = false;
}

function syncModalAccessibility(): void {
  const nextModal = [candidateDialog, decisionDialog, endDialog].find((dialog) => !dialog.hidden) ?? null;
  observerShell.inert = nextModal !== null;
  if (nextModal === focusedModal) return;
  focusedModal = nextModal;
  if (!nextModal) {
    observerShell.focus({ preventScroll: true });
    return;
  }
  const preferred = nextModal.querySelector<HTMLButtonElement>(".is-default:not(:disabled), button:not(:disabled)");
  requestAnimationFrame(() => preferred?.focus({ preventScroll: true }));
}

function installDebugBridge(): void {
  window.__rogueDebug = {
    dump: () => JSON.stringify({ state, observation: observeGame(state), review: currentReview ?? analyzeRun(runLog, state), campaign }, null, 2),
    getState: () => structuredClone(state),
    getObservation: () => structuredClone(observeGame(state)),
    getRunLog: () => structuredClone(runLog),
    getRunReview: () => structuredClone(currentReview ?? analyzeRun(runLog, state)),
    stepAi: (steps = 1) => {
      stopAutoplay();
      for (let index = 0; index < steps && state.status === "playing"; index += 1) {
        const observation = observeGame(state);
        const action = observation.pendingDecision ? chooseDecisionAction(observation, "temperament") : chooseAutoplayAction(observation);
        applyLoggedAction(action, "ai", observation.pendingDecision ? undefined : getAutoplayDebugState(observation));
      }
      render();
      return structuredClone(state);
    },
    stepUntilDecision: (steps = 1600) => {
      stopAutoplay();
      for (let index = 0; index < steps && state.status === "playing" && !state.pendingDecision; index += 1) {
        const observation = observeGame(state);
        applyLoggedAction(chooseAutoplayAction(observation), "ai", getAutoplayDebugState(observation));
      }
      render();
      return structuredClone(state);
    },
  };
}

function objectiveLabel(objective: ReturnType<typeof observeGame>["exploration"]["objective"]): string {
  if (objective === "defeatBoss") return "守り手を倒す";
  if (objective === "descend") return "下層へ進む";
  if (objective === "findStairs") return "階段を探す";
  if (objective === "resolveStall") return "探索経路を見直す";
  return "未探索を広げる";
}

function objectiveDetail(observation: ReturnType<typeof observeGame>): string {
  if (observation.pendingDecision) return "黒燭は灯守の判断を待っています。";
  if (observation.exploration.reachableStairs) return "到達可能な階段へ向かっています。";
  if (observation.bossAlive) return "この階層の守り手が帰還路を封じています。";
  return `${observation.exploration.reachableFrontierCount}箇所の探索候補を比較しています。`;
}

function statusLabel(status: GameState["status"] | CampaignState["expeditions"][number]["status"]): string {
  if (status === "won") return "踏破";
  if (status === "returned") return "帰還";
  if (status === "stranded") return "未帰還";
  if (status === "lost") return "死亡";
  return "観測中";
}

function loadCampaign(): CampaignState {
  try {
    const raw = window.localStorage.getItem(CAMPAIGN_STORAGE_KEY);
    return raw ? normalizeCampaignState(JSON.parse(raw)) : createCampaignState();
  } catch (error) {
    console.warn("遠征録を読み込めなかったため、新しい記録を開始します。", error);
    return createCampaignState();
  }
}

function saveCampaign(value: CampaignState): void {
  try {
    window.localStorage.setItem(CAMPAIGN_STORAGE_KEY, JSON.stringify(value));
  } catch (error) {
    console.warn("遠征録を保存できませんでした。", error);
  }
}

function nextSeed(): number {
  return Math.floor(Date.now() % 100_000_000);
}

function applySprite(element: HTMLElement, asset: ReturnType<typeof assetForContent>, size: number): void {
  if (!asset) return;
  const col = asset.sheet.index % asset.sheet.columns;
  const row = Math.floor(asset.sheet.index / asset.sheet.columns);
  element.style.backgroundImage = `url(${publicAssetPath(asset.path)})`;
  element.style.backgroundSize = `${asset.sheet.columns * size}px ${asset.sheet.rows * size}px`;
  element.style.backgroundPosition = `-${col * size}px -${row * size}px`;
}

function publicAssetPath(path: string): string {
  return path.startsWith("/") ? `${import.meta.env.BASE_URL}${path.slice(1)}` : path;
}

function setText(selector: string, value: string): void {
  requireElement<HTMLElement>(selector).textContent = value;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}
