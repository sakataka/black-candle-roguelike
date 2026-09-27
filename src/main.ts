import "./styles.css";
import { chooseAutoplayAction, describeAutoplayIntent, getAutoplayDebugState, type AutoplayIntent } from "./game/ai/autoplay";
import { getGameConfig, loadBrowserGameConfig } from "./game/content/config";
import { assetForContent } from "./game/content/assets";
import { getContentName } from "./game/content/entities";
import {
  calculateScore,
  campaignProgress,
  chooseDecisionAction,
  createCampaignState,
  createRunIdentity,
  defaultDirectiveForTemperament,
  directiveLabel,
  endingLabel,
  expeditionMissions,
  missionDefinition,
  missionProgress,
  normalizeCampaignState,
  recordCampaignResult,
  temperamentDescription,
  temperamentLabel,
} from "./game/core/autonomous";
import { chooseWatcherAction } from "./game/ai/watcher";
import { applyAction, biomeThemeName, canInvokeLantern, createInitialGame, lanternRiteLabel, observeGame, playableRoles } from "./game/core/game";
import { paceDelayMs, paceKindFor, type PaceKind } from "./game/core/pacing";
import { analyzeRun, createRunLog, recordTurn } from "./game/core/runLog";
import { deriveVisualEvents, type VisualEvent } from "./game/core/visualEvents";
import { PixiRoguelikeRenderer } from "./game/renderer/PixiRoguelikeRenderer";
import type {
  CampaignState,
  EquipmentConfig,
  GameAction,
  GameState,
  LanternRiteId,
  MissionId,
  RoleTruthId,
  RunLog,
  RunLogEntry,
  RunReview,
  StatusCondition,
} from "./game/types";

const CAMPAIGN_STORAGE_KEY = "black-candle-campaign-v1";
const PAUSE_ICON = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><rect x="3" y="2" width="3.5" height="12" rx="1" fill="currentColor"/><rect x="9.5" y="2" width="3.5" height="12" rx="1" fill="currentColor"/></svg>';
const PLAY_ICON = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 2.2v11.6c0 .6.7 1 1.2.6l8.3-5.8c.4-.3.4-.9 0-1.2L5.2 1.6C4.7 1.2 4 1.6 4 2.2z" fill="currentColor"/></svg>';
const lanternRiteOrder: LanternRiteId[] = ["flare", "mend", "guide", "ward"];
const lanternRiteKeys: Record<LanternRiteId, string> = { flare: "Q", mend: "W", guide: "E", ward: "R" };

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
          <button type="button" id="pause-toggle" class="pause-toggle" aria-pressed="false" aria-label="一時停止" title="一時停止 (Space)"></button>
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
      <div><span>任務</span><strong id="run-mission">-</strong></div>
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
        <div class="map-stage">
          <div id="pixi-root" class="pixi-root"></div>
          <p id="pause-banner" class="pause-banner" hidden>一時停止中 — Space で再開</p>
        </div>
        <section class="lantern-bar" aria-label="灯守の介入">
          <div class="lantern-embers">
            <span>灯火</span>
            <div id="lantern-pips" class="lantern-pips" aria-live="polite"></div>
            <small id="lantern-hint">危機に灯を捧げると、探索者の手番を使わず介入できます。</small>
          </div>
          <div id="lantern-rites" class="lantern-rites"></div>
        </section>
      </section>

      <aside class="observer-sidebar">
        <section class="side-card vitals-card">
          <div class="vitals-heading">
            <span id="vitals-portrait" class="vitals-portrait" aria-hidden="true"></span>
            <div><strong id="vitals-name">-</strong><small id="hero-role">-</small></div>
            <em id="vitals-level">Lv1</em>
          </div>
          <div class="vitals-hp" id="vitals-hp">
            <div class="vitals-hp-label"><span>HP</span><strong id="vitals-hp-value">-</strong></div>
            <div class="vitals-hp-track"><i id="vitals-hp-fill"></i></div>
          </div>
          <div id="vitals-conditions" class="vitals-conditions"></div>
          <div id="hero-stats" class="stat-grid"></div>
        </section>
        <section class="side-card objective-card">
          <div class="section-heading"><h2>次の動き</h2><span id="explored-ratio">0%</span></div>
          <strong id="objective-title">未探索を広げる</strong>
          <p id="objective-detail">黒燭が映す道筋を追っています。</p>
        </section>
        <section class="side-card log-card">
          <div class="section-heading"><h2>遠征記録</h2><span>直近</span></div>
          <ol id="message-list" class="message-list"></ol>
        </section>
      </aside>
    </section>

    <section class="lower-grid">
      <section class="lower-card truth-card">
        <div class="section-heading"><h2>物語進捗</h2><span id="story-progress-count">0/6</span></div>
        <div class="story-progress"><i id="story-progress-fill"></i></div>
        <div id="story-milestones" class="story-milestones"></div>
        <div class="subsection-heading"><strong>三つの真相</strong><span id="truth-count">0/3</span></div>
        <div id="truth-list" class="truth-list"></div>
      </section>
      <section class="lower-card inventory-card">
        <div class="section-heading"><h2>携行品</h2><span id="inventory-count">0</span></div>
        <ul id="inventory-list" class="inventory-list"></ul>
      </section>
      <section class="lower-card archive-card">
        <div class="section-heading"><h2>遠征進捗</h2><span id="archive-count">0</span></div>
        <div id="campaign-summary" class="campaign-summary"></div>
        <ol id="archive-list" class="archive-list"></ol>
      </section>
    </section>
  </main>

  <section id="candidate-dialog" class="modal-layer" aria-live="polite">
    <div class="modal-panel candidate-panel" role="dialog" aria-modal="true" aria-labelledby="candidate-title">
      <p class="eyebrow">遠征者選定</p>
      <h2 id="candidate-title">誰を黒燭の迷宮へ送るか</h2>
      <p>先に遠征任務を定めます。職業と気質だけでなく、任務もAIが目指す一周の目的になります。</p>
      <div id="mission-list" class="mission-list" aria-label="遠征任務"></div>
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
      <div id="run-comparison" class="run-comparison"></div>
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
const missionList = requireElement<HTMLDivElement>("#mission-list");
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
const runComparison = requireElement<HTMLDivElement>("#run-comparison");
const scoreBreakdown = requireElement<HTMLDivElement>("#score-breakdown");
const decisionHistory = requireElement<HTMLDivElement>("#decision-history");

let campaign = loadCampaign();
let candidateSeed = nextSeed();
let selectedRoleId = playableRoles()[0].id;
let selectedIdentity = createRunIdentity(candidateSeed, selectedRoleId);
let selectedMissionId: MissionId = expeditionMissions[0].id;
let state = createInitialGame(candidateSeed, selectedRoleId, { identity: selectedIdentity, knownRoleTruths: campaign.roleTruths, missionId: selectedMissionId });
let runLog = createRunLog(state.seed, selectedRoleId, {}, selectedIdentity);
let currentReview: RunReview | null = null;
let autoplayTimer: number | null = null;
let speed = 1;
let archivedRunId: string | null = null;
let scheduledPace: PaceKind = "exploration";
let pendingVisualEvents: VisualEvent[] = [];
let pendingIntent: AutoplayIntent | null = null;
let paused = false;
let focusedModal: HTMLElement | null = null;

installEvents();
installDebugBridge();
renderCandidateSelection();
render();
await renderer.mount(pixiRoot);
syncViewport();
window.addEventListener("resize", syncViewport);
requireElement<HTMLButtonElement>("#pause-toggle").innerHTML = PAUSE_ICON;
render();

function syncViewport(): void {
  const narrow = window.matchMedia("(max-width: 700px)").matches;
  renderer.setViewport(narrow ? 9 : 16, narrow ? 9 : 10);
  render();
}

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
    if (autoplayTimer !== null) scheduleAutoplay(scheduledPace);
  });
  requireElement<HTMLButtonElement>("#pause-toggle").addEventListener("click", () => setPaused(!paused));
  requireElement<HTMLDivElement>("#lantern-rites").addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-rite]");
    if (!button || button.disabled) return;
    invokeLanternRite(button.dataset.rite as LanternRiteId);
  });
  requireElement<HTMLButtonElement>("#new-expedition").addEventListener("click", openNewExpedition);
  requireElement<HTMLButtonElement>("#end-new-expedition").addEventListener("click", openNewExpedition);
  candidateList.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-role-id]");
    if (!button) return;
    startExpedition(button.dataset.roleId ?? playableRoles()[0].id);
  });
  missionList.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-mission-id]");
    if (!button) return;
    selectedMissionId = button.dataset.missionId as MissionId;
    renderCandidateSelection();
  });
  decisionOptions.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-option-id]");
    if (!button || button.disabled) return;
    applyLoggedAction({ type: "resolveDecision", optionId: button.dataset.optionId ?? "" }, "player");
    render();
    if (state.status === "playing" && !state.pendingDecision) scheduleAutoplay("exploration");
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
    if (!focusedModal && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (event.key === " ") {
        event.preventDefault();
        if (state.status === "playing") setPaused(!paused);
        return;
      }
      const rite = lanternRiteOrder.find((candidate) => lanternRiteKeys[candidate].toLowerCase() === event.key.toLowerCase());
      if (rite) {
        invokeLanternRite(rite);
        return;
      }
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
  state = createInitialGame(candidateSeed, roleId, { identity: selectedIdentity, knownRoleTruths: campaign.roleTruths, missionId: selectedMissionId });
  runLog = createRunLog(state.seed, roleId, {}, selectedIdentity);
  currentReview = null;
  archivedRunId = null;
  candidateDialog.hidden = true;
  decisionDialog.hidden = true;
  endDialog.hidden = true;
  paused = false;
  render();
  setPaused(false);
}

function renderCandidateSelection(): void {
  missionList.replaceChildren(...expeditionMissions.map((mission) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.missionId = mission.id;
    button.className = mission.id === selectedMissionId ? "mission-option is-selected" : "mission-option";
    button.setAttribute("aria-pressed", String(mission.id === selectedMissionId));
    button.innerHTML = `<strong>${escapeHtml(mission.label)}</strong><small>${escapeHtml(mission.description)}</small><em>${escapeHtml(mission.targetLabel)} · 報酬 ${escapeHtml(mission.rewardLabel)}</em>`;
    return button;
  }));
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
  pendingIntent = describeAutoplayIntent(observation, action);
  const logEntry = applyLoggedAction(action, "ai", getAutoplayDebugState(observation));
  const pace = paceKindFor(action, state, logEntry?.messageDelta ?? []);
  scheduledPace = pace;
  render();
  if (state.status === "playing" && !state.pendingDecision) scheduleAutoplay(pace);
}

function scheduleAutoplay(pace: PaceKind): void {
  stopAutoplay();
  scheduledPace = pace;
  if (paused || state.status !== "playing" || state.pendingDecision || !candidateDialog.hidden) return;
  autoplayTimer = window.setTimeout(stepAutoplay, currentStepMs(pace));
}

function currentStepMs(pace: PaceKind = scheduledPace): number {
  return Math.max(40, Math.round(paceDelayMs(pace) / speed));
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
  pendingVisualEvents.push(...deriveVisualEvents(before, state));
  const entry = recordTurn({ log: runLog, before, action, after: state, actor, aiDebug });
  currentReview = state.status === "playing" ? null : analyzeRun(runLog, state);
  if (state.status !== "playing") archiveCompletedRun();
  return entry;
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
  renderer.render(state, { events: pendingVisualEvents, intent: pendingIntent, stepMs: currentStepMs() });
  pendingVisualEvents = [];
  pendingIntent = null;
  const observation = observeGame(state);
  const player = observation.player;
  const config = getGameConfig();
  const score = calculateScore(state);
  setText("#run-delver", `${state.runIdentity.name} / ${getContentName(state.runIdentity.roleId)}`);
  setText("#run-temperament", temperamentLabel(state.runIdentity.temperament));
  setText("#run-directive", directiveLabel(state.directive));
  const runMission = missionDefinition(state.story.missionId);
  const runMissionProgress = missionProgress(state);
  setText("#run-mission", state.story.missionCompleted ? `${runMission.label} ✓` : `${runMission.label} ${runMissionProgress.current}/${runMissionProgress.target}`);
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
  renderVitals(observation);
  renderLantern(observation);

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

function renderVitals(observation: ReturnType<typeof observeGame>): void {
  const player = observation.player;
  const progress = observation.playerProgress;
  setText("#vitals-name", state.runIdentity.name);
  setText("#hero-role", `${getContentName(player.contentId)} · ${temperamentLabel(state.runIdentity.temperament)}`);
  setText("#vitals-level", `Lv${progress.level}`);
  const portrait = requireElement<HTMLElement>("#vitals-portrait");
  if (portrait.dataset.roleId !== player.contentId) {
    portrait.dataset.roleId = player.contentId;
    applySprite(portrait, assetForContent(player.contentId), 44);
  }
  const hp = player.stats?.hp ?? 0;
  const maxHp = player.stats?.maxHp ?? 1;
  const ratio = Math.max(0, Math.min(1, hp / maxHp));
  setText("#vitals-hp-value", `${Math.max(0, hp)} / ${maxHp}`);
  const fill = requireElement<HTMLElement>("#vitals-hp-fill");
  fill.style.width = `${ratio * 100}%`;
  const hpTone = ratio <= 0.3 ? "danger" : ratio <= 0.6 ? "warning" : "safe";
  requireElement<HTMLElement>("#vitals-hp").dataset.tone = hpTone;
  const conditions = player.conditions ?? [];
  requireElement<HTMLElement>("#vitals-conditions").innerHTML = conditions.length
    ? conditions.map((condition) => `<span class="condition-tag condition-${conditionTone(condition)}">${conditionLabel(condition)} ${condition.turns}手</span>`).join("")
    : '<span class="condition-tag condition-normal">異常なし</span>';
  requireElement<HTMLDivElement>("#hero-stats").innerHTML = [
    ["攻撃", String(player.stats?.attack ?? "-")],
    ["防御", String(player.stats?.defense ?? "-")],
    ["Gold", String(progress.gold)],
  ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");
}

function lanternRiteDescription(rite: LanternRiteId): string {
  const config = getGameConfig().lantern.rites[rite];
  const parts: string[] = [];
  if (config.dazeTurns) parts.push(`見える敵を${config.dazeTurns}手怯ませる`);
  if (config.healPercent) parts.push(`HPを${config.healPercent}%回復`);
  if (config.cureConditions) parts.push("出血・毒を払う");
  if (config.revealRadius) parts.push(`周囲${config.revealRadius}マスを照らす`);
  if (config.revealTraps) parts.push("隠れた罠を暴く");
  if (config.guardedTurns) parts.push(`護り${config.guardedTurns}手`);
  if (config.pushVisibleMonsters) parts.push("敵を押し戻す");
  return parts.join("・");
}

function renderLantern(observation: ReturnType<typeof observeGame>): void {
  const lantern = state.lantern;
  const pips = requireElement<HTMLDivElement>("#lantern-pips");
  pips.setAttribute("aria-label", `灯火 ${lantern.embers} / ${lantern.maxEmbers}`);
  pips.innerHTML = Array.from({ length: lantern.maxEmbers }, (_, index) => `<i class="${index < lantern.embers ? "is-lit" : ""}"></i>`).join("");
  const suggestion = chooseWatcherAction(observation, "lantern");
  const suggested = suggestion?.type === "invokeLantern" ? suggestion.rite : null;
  setText("#lantern-hint", suggested
    ? `黒燭が揺れている — 「${lanternRiteLabel(suggested)}」が効きそうだ。`
    : state.status === "playing" ? "危機に灯を捧げると、探索者の手番を使わず介入できます。" : "遠征は終わった。灯は静かに燃えている。");
  const container = requireElement<HTMLDivElement>("#lantern-rites");
  if (container.childElementCount !== lanternRiteOrder.length) {
    container.replaceChildren(...lanternRiteOrder.map((rite) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.rite = rite;
      button.className = `lantern-rite rite-${rite}`;
      button.innerHTML = `<kbd>${lanternRiteKeys[rite]}</kbd><strong>${lanternRiteLabel(rite)}</strong><small>${escapeHtml(lanternRiteDescription(rite))}</small><em></em>`;
      return button;
    }));
  }
  for (const button of container.querySelectorAll<HTMLButtonElement>("button[data-rite]")) {
    const rite = button.dataset.rite as LanternRiteId;
    const cost = getGameConfig().lantern.rites[rite].cost;
    button.disabled = !canInvokeLantern(state, rite);
    button.classList.toggle("is-suggested", rite === suggested && !button.disabled);
    button.setAttribute("aria-label", `${lanternRiteLabel(rite)}（灯火${cost}）: ${lanternRiteDescription(rite)}`);
    const costLabel = button.querySelector("em");
    if (costLabel) costLabel.textContent = `灯火 ${cost}`;
  }
}

function invokeLanternRite(rite: LanternRiteId): void {
  if (!canInvokeLantern(state, rite)) return;
  applyLoggedAction({ type: "invokeLantern", rite }, "player");
  render();
}

function setPaused(value: boolean): void {
  paused = value;
  const toggle = requireElement<HTMLButtonElement>("#pause-toggle");
  toggle.setAttribute("aria-pressed", String(paused));
  toggle.innerHTML = paused ? PLAY_ICON : PAUSE_ICON;
  toggle.setAttribute("aria-label", paused ? "再開" : "一時停止");
  toggle.classList.toggle("is-active", paused);
  requireElement<HTMLElement>("#pause-banner").hidden = !paused || state.status !== "playing";
  if (paused) {
    stopAutoplay();
  } else {
    scheduleAutoplay(scheduledPace);
  }
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
  const progress = campaignProgress(campaign);
  const unlockedMilestones = progress.milestones.filter((milestone) => milestone.unlocked).length;
  setText("#story-progress-count", `${unlockedMilestones}/${progress.milestones.length}`);
  requireElement<HTMLElement>("#story-progress-fill").style.width = `${unlockedMilestones / progress.milestones.length * 100}%`;
  requireElement<HTMLDivElement>("#story-milestones").replaceChildren(...progress.milestones.map((milestone) => {
    const item = document.createElement("span");
    item.className = milestone.unlocked ? "is-unlocked" : "";
    item.textContent = `${milestone.unlocked ? "◆" : "◇"} ${milestone.label}`;
    return item;
  }));
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
  const progress = campaignProgress(campaign);
  requireElement<HTMLDivElement>("#campaign-summary").innerHTML = [
    ["最高到達", progress.highestFloor > 0 ? `F${progress.highestFloor}` : "-"],
    ["自己ベスト", progress.bestScore > 0 ? `${progress.bestScore.toLocaleString("ja-JP")}点` : "-"],
    ["踏破", `${progress.completedRuns}回`],
    ["達成任務", `${progress.completedMissionIds.length}/${expeditionMissions.length}`],
  ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");
  const list = requireElement<HTMLOListElement>("#archive-list");
  if (campaign.expeditions.length === 0) {
    list.innerHTML = '<li class="empty-state">まだ帰還記録はありません。</li>';
    return;
  }
  list.replaceChildren(...campaign.expeditions.slice(0, 6).map((record) => {
    const item = document.createElement("li");
    const mission = missionDefinition(record.missionId);
    item.innerHTML = `<span class="archive-status status-${record.status}">${statusLabel(record.status)}</span><span><strong>${escapeHtml(record.identity.name)}${record.missionCompleted ? " · 任務達成" : ""}</strong><small>${getContentName(record.identity.roleId)} / ${escapeHtml(mission.label)} / F${record.floor} / ${record.score.total.toLocaleString("ja-JP")}点</small></span>`;
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
  decisionHint.textContent = decision.kind === "context"
    ? `現在の啓示: ${state.revelationsRemaining}。各案はこの場で効果を発揮し、啓示による危機介入は遠征評価へ記録されます。`
    : `現在の啓示: ${state.revelationsRemaining}。啓示を使わない選択は探索者の気質に沿います。`;
  decisionOptions.replaceChildren(...decision.options.map((option, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.optionId = option.id;
    button.disabled = !!option.requiresRevelation && state.revelationsRemaining <= 0;
    button.className = option.id === decision.defaultOptionId ? "decision-option is-default" : "decision-option";
    const costLabel = option.requiresRevelation
      ? "啓示を1消費"
      : option.id === decision.defaultOptionId && option.directive === defaultDirectiveForTemperament(state.runIdentity.temperament) && decision.kind !== "final"
        ? "気質どおり・消費なし"
        : option.id === decision.defaultOptionId && decision.kind === "context"
          ? "探索者の判断・消費なし"
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
        <span>任務 <strong>${missionDefinition(state.story.missionId).label}</strong></span>
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
  if (condition.kind === "dazed") return "怯み";
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
  renderRunComparison();
  const rows: Array<[string, number]> = [
    ["進行", review.score.depth], ["守護者", review.score.guardians], ["職業目的", review.score.roleObjective],
    ["発見", review.score.discoveries], ["生還", review.score.survival], ["持帰り", review.score.recoveredValue],
    ["迅速", review.score.tempo], ["任務・介入", review.score.autonomy],
  ];
  scoreBreakdown.innerHTML = `${rows.map(([label, value]) => `<div><span>${label}</span><strong>${value.toLocaleString("ja-JP")}</strong></div>`).join("")}<div class="score-total"><span>総合</span><strong>${review.score.total.toLocaleString("ja-JP")}</strong></div>`;
  decisionHistory.innerHTML = `<h3>灯守の判断</h3>${review.decisions.length === 0 ? "<p>介入記録なし</p>" : `<ol>${review.decisions.map((entry) => `<li><span>F${entry.floor}</span><strong>${escapeHtml(entry.optionLabel)}${entry.effectSummary ? `<small>${escapeHtml(entry.effectSummary)}</small>` : ""}</strong>${entry.usedRevelation ? "<em>啓示</em>" : ""}</li>`).join("")}</ol>`}`;
  endDialog.hidden = false;
}

function renderRunComparison(): void {
  const current = campaign.expeditions[0];
  if (!current || current.id !== archivedRunId) {
    runComparison.innerHTML = "";
    return;
  }
  const previous = campaign.expeditions[1];
  const older = campaign.expeditions.slice(1);
  const newDepthRecord = current.floor > older.reduce((best, record) => Math.max(best, record.floor), 0);
  const newScoreRecord = current.score.total > older.reduce((best, record) => Math.max(best, record.score.total), 0);
  const badges = [
    newDepthRecord ? "最高到達階を更新" : "",
    newScoreRecord ? "自己ベスト更新" : "",
    current.missionCompleted ? `任務「${missionDefinition(current.missionId).label}」達成` : "",
    current.truthRecovered ? "新たな真相を持帰り" : "",
    current.endingId ? `結末「${endingLabel(current.endingId)}」を記録` : "",
  ].filter(Boolean);
  const comparison = previous
    ? `前回比: 深度 ${signed(current.floor - previous.floor)}階 / 得点 ${signed(current.score.total - previous.score.total)}点`
    : "最初の遠征記録です。ここから灯守の記録が始まります。";
  runComparison.innerHTML = `<strong>${escapeHtml(missionDefinition(current.missionId).label)} ${current.missionCompleted ? "達成" : "未達"}</strong><p>${escapeHtml(comparison)}</p>${badges.length ? `<div>${badges.map((badge) => `<span>${escapeHtml(badge)}</span>`).join("")}</div>` : ""}`;
}

function signed(value: number): string {
  return value > 0 ? `+${value.toLocaleString("ja-JP")}` : value.toLocaleString("ja-JP");
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
