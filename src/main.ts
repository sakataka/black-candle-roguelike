import "@fontsource/shippori-mincho-b1/500.css";
import "@fontsource/shippori-mincho-b1/600.css";
import "@fontsource/shippori-mincho-b1/800.css";
import "@fontsource/cormorant-garamond/500-italic.css";
import "@fontsource/cormorant-garamond/600.css";
import "./styles.css";
import { showTitle } from "./ui/title";
import { chooseAutoplayAction, describeAutoplayIntent, getAutoplayDebugState, type AutoplayIntent } from "./game/ai/autoplay";
import { getGameConfig, loadBrowserGameConfig, runRules } from "./game/content/config";
import { assetForContent } from "./game/content/assets";
import { getContentName } from "./game/content/entities";
import {
  calculateScore,
  campaignRunModifiers,
  pendingGraves,
  runShardBonusPercent,
  campaignProgress,
  campaignTacticSlots,
  facilityUpgradeCost,
  treatScar,
  unlockedTacticIds,
  upgradeFacility,
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
import { applyAction, biomeThemeName, canInvokeLantern, createInitialGame, lanternRiteLabel, normalizeTactics, observeGame, playableRoles } from "./game/core/game";
import { paceDelayMs, paceKindFor, type PaceKind } from "./game/core/pacing";
import { analyzeRun, createRunLog, recordTurn } from "./game/core/runLog";
import { buildRunInsights, type RunInsights } from "./game/core/runInsights";
import { deriveVisualEvents, type VisualEvent } from "./game/core/visualEvents";
import type { LookaheadProgress, LookaheadRequest } from "./game/sim/lookahead.worker";
import type { LookaheadSummary } from "./game/sim/rollout";
import { PixiRoguelikeRenderer } from "./game/renderer/PixiRoguelikeRenderer";
import type {
  CampaignState,
  EquipmentConfig,
  FacilityId,
  GameAction,
  GameState,
  LanternRiteId,
  MissionId,
  RoleTruthId,
  RunLog,
  RunLogEntry,
  RunReview,
  StatusCondition,
  Veteran,
} from "./game/types";

const ROLE_TRUTHS: Array<{ id: RoleTruthId; name: string; hint: string }> = [
  { id: "shared-oath", name: "分誓の碑文", hint: "誓約の探索者で6階から生還" },
  { id: "furnace-map", name: "炉脈全図", hint: "灰弓の斥候で6階から生還" },
  { id: "purified-flame", name: "浄火の祈り", hint: "灯火の祈祷者で6階から生還" },
];
/** 墓標に刻む最期の一文。死因の分類から物語の言葉へ置き換える。 */
const FALL_EPITAPHS: Record<string, string> = {
  combat: "刃の下に倒れた。",
  rangedCombat: "闇から放たれた一矢に倒れた。",
  trap: "古い罠に命を奪われた。",
  bleeding: "流れる血を止められなかった。",
  venom: "毒が回りきった。",
  signalLoss: "灯路が途絶え、闇に呑まれた。",
};
const CAMPAIGN_STORAGE_KEY = "black-candle-campaign-v1";
const TACTICS_STORAGE_KEY = "black-candle-tactics";
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
document.documentElement.style.setProperty("--keyart", `url("${import.meta.env.BASE_URL}assets/art/title-keyart.jpg")`);
if (!app) throw new Error("Missing #app root");
app.inert = true;

app.innerHTML = `
  <main class="observer-shell" tabindex="-1">
    <header class="topbar">
      <div class="topbar-brand">
        <span id="brand-mark" class="brand-mark" aria-hidden="true"></span>
        <div><h1>黒燭の迷宮</h1><p>灰灯院・遠征観測室</p></div>
      </div>
      <div class="topbar-run">
        <div class="depth-chip"><span id="biome-kicker">地下1階</span><strong id="biome-title">黒石迷宮</strong></div>
        <div class="turn-meter" id="turn-meter">
          <div class="turn-meter-label"><span id="turn-meter-label">灯路</span><strong id="run-turn">0 / 0手</strong></div>
          <div class="turn-meter-track"><i id="turn-meter-fill"></i></div>
        </div>
        <div class="live-score"><span>暫定得点</span><strong id="live-score">0</strong></div>
      </div>
      <div class="topbar-controls">
        <div class="speed-selector" role="group" aria-label="観測速度">
          <button type="button" id="pause-toggle" class="pause-toggle" aria-pressed="false" aria-label="一時停止" title="一時停止 (Space)"></button>
          <button type="button" data-speed="0.5" aria-pressed="false">0.5×</button>
          <button type="button" data-speed="1" class="is-active" aria-pressed="true">1×</button>
          <button type="button" data-speed="2" aria-pressed="false">2×</button>
          <button type="button" data-speed="3" aria-pressed="false">3×</button>
        </div>
        <button id="new-expedition" class="secondary-button" type="button" title="灰灯院を開く（観戦は一時停止）">灰灯院</button>
      </div>
    </header>

    <section class="stage" aria-label="黒燭越しの迷宮">
      <div class="map-stage" id="map-stage">
        <div id="pixi-root" class="pixi-root"></div>
        <p id="pause-banner" class="pause-banner" hidden>一時停止中 — Space で再開</p>
        <div id="floor-card" class="floor-card" aria-hidden="true"><span class="floor-card-no"></span><strong class="floor-card-name"></strong><i></i></div>
      </div>
      <section class="lantern-dock" aria-label="灯守の介入">
        <div class="lantern-embers">
          <div class="lantern-embers-head"><span>灯火</span><strong id="lantern-count">0/0</strong></div>
          <div id="lantern-pips" class="lantern-pips" aria-live="polite"></div>
          <small id="lantern-hint">危機に灯を捧げると、探索者の手番を使わず介入できます。</small>
        </div>
        <div id="lantern-rites" class="lantern-rites"></div>
      </section>
    </section>

    <div class="sidebar">
      <section class="panel vitals-card" aria-label="探索者">
        <div class="vitals-heading">
          <span id="vitals-portrait" class="vitals-portrait" aria-hidden="true"></span>
          <div><strong id="vitals-name">-</strong><small id="hero-role">-</small></div>
          <em id="vitals-level">Lv1</em>
        </div>
        <div class="vitals-hp" id="vitals-hp">
          <div class="vitals-hp-label"><span>HP</span><strong id="vitals-hp-value">-</strong></div>
          <div class="vitals-hp-track"><b id="vitals-hp-trail" aria-hidden="true"></b><i id="vitals-hp-fill"></i></div>
        </div>
        <div id="hero-stats" class="stat-row"></div>
        <div class="vitals-tags"><div id="vitals-conditions" class="tag-row"></div><div id="vitals-tactics" class="tag-row"></div></div>
      </section>
      <section class="panel expedition-card" aria-label="遠征の目的">
        <div class="mission-line">
          <span class="panel-label">任務</span>
          <strong id="run-mission">-</strong>
          <em id="run-mission-progress">0/0</em>
        </div>
        <div class="mission-track"><i id="mission-fill"></i></div>
        <div class="expedition-meta">
          <span>方針 <strong id="run-directive">-</strong></span>
          <span>啓示 <strong id="run-revelations">-</strong></span>
          <span>探索 <strong id="explored-ratio">0%</strong></span>
        </div>
        <div class="objective">
          <span class="panel-label">次の動き</span>
          <strong id="objective-title">未探索を広げる</strong>
          <p id="objective-detail">黒燭が映す道筋を追っています。</p>
        </div>
      </section>
      <section class="panel inventory-card" aria-label="装備と携行品">
        <div class="panel-heading"><h2>装備と携行品</h2><span id="inventory-count">0</span></div>
        <div id="equipment-list" class="equipment-list"></div>
        <ul id="inventory-list" class="inventory-grid"></ul>
        <p id="inventory-caption" class="inventory-caption" aria-live="polite"></p>
      </section>
      <section class="panel log-card" aria-label="遠征記録">
        <div class="panel-heading"><h2>遠征記録</h2><span>新しい順</span></div>
        <ol id="message-list" class="message-list"></ol>
      </section>
    </div>
  </main>

  <section id="candidate-dialog" class="modal-layer prepare-layer" aria-live="polite">
    <div class="prepare-screen" role="dialog" aria-modal="true" aria-labelledby="candidate-title">
      <header class="prepare-header">
        <div>
          <p class="eyebrow">灰灯院 · 遠征の支度</p>
          <h2 id="candidate-title">誰を黒燭の迷宮へ送るか</h2>
        </div>
        <div class="prepare-header-actions">
          <div class="shard-balance" title="遠征の得点・任務・真相・生還で得られる。施設の強化と療房に使う。"><i id="shard-icon" class="shard-icon" aria-hidden="true"></i><span>灯片</span><strong id="institute-shards">0</strong></div>
          <button id="resume-run" class="secondary-button" type="button" hidden>観戦に戻る <kbd>Esc</kbd></button>
        </div>
      </header>
      <div class="prepare-body">
        <div class="prepare-main">
          <section class="prepare-step prepare-step-delver" aria-labelledby="step-delver">
            <div class="step-heading"><span class="step-no" aria-hidden="true">I</span><h3 id="step-delver">探索者</h3><small>生還した古参は位階が上がって強くなる。瀕死で帰ると古傷を負い、倒れた者は戻らない。番号キー 1〜4 でも選べる。</small></div>
            <div class="candidate-group"><strong>遠征団</strong></div>
            <div id="veteran-list" class="candidate-list"></div>
            <div class="candidate-group"><strong>新たな志願者</strong><small id="recruit-capacity"></small></div>
            <div id="candidate-list" class="candidate-list"></div>
          </section>
          <section class="prepare-step" aria-labelledby="step-mission">
            <div class="step-heading"><span class="step-no" aria-hidden="true">II</span><h3 id="step-mission">遠征任務</h3><small>任務もAIが目指す一周の目的になる。</small></div>
            <div id="mission-list" class="mission-list"></div>
          </section>
          <section class="prepare-step" aria-labelledby="step-tactics">
            <div class="step-heading"><span class="step-no" aria-hidden="true">III</span><h3 id="step-tactics">作戦カード</h3><em id="tactic-count">0/2</em><small>探索者の判断の癖。3階・6階の節目でも組み替えられる。</small></div>
            <div id="tactic-list" class="tactic-list"></div>
          </section>
        </div>
        <aside class="prepare-side" aria-label="灰灯院">
          <section class="side-section">
            <div class="side-heading"><h3>施設</h3><small>灯片で強化すると、以後の遠征すべてに効く。</small></div>
            <div id="institute-facilities" class="institute-facilities"></div>
            <div id="institute-infirmary" class="institute-infirmary"></div>
          </section>
          <section class="side-section">
            <div id="institute-cycle" class="institute-cycle"></div>
          </section>
          <section class="side-section">
            <div class="side-heading"><h3>物語進捗</h3><span id="story-progress-count">0/6</span></div>
            <div class="story-progress"><i id="story-progress-fill"></i></div>
            <div id="story-milestones" class="story-milestones"></div>
            <div class="side-subheading"><strong>三つの真相</strong><span id="truth-count">0/3</span></div>
            <div id="truth-list" class="truth-list"></div>
          </section>
          <section class="side-section">
            <div class="side-heading"><h3>遠征録</h3><span id="archive-count">0件</span></div>
            <div id="campaign-summary" class="campaign-summary"></div>
            <ol id="archive-list" class="archive-list"></ol>
          </section>
        </aside>
      </div>
      <footer class="prepare-footer">
        <div id="depart-summary" class="depart-summary"></div>
        <button id="depart-button" class="primary-button" type="button">出発する</button>
      </footer>
    </div>
  </section>

  <section id="decision-dialog" class="modal-layer" hidden aria-live="assertive">
    <div class="modal-panel decision-panel" role="dialog" aria-modal="true" aria-labelledby="decision-title">
      <p class="eyebrow" id="decision-kicker">黒燭からの問い</p>
      <h2 id="decision-title">灯守の判断</h2>
      <p id="decision-body" class="modal-lead"></p>
      <div id="decision-status" class="decision-status" aria-label="探索者の状態"></div>
      <div id="decision-options" class="decision-options"></div>
      <section id="decision-tactics" class="decision-tactics" aria-label="作戦の組み替え" hidden>
        <div class="step-heading"><h3>作戦を組み替える</h3><em id="decision-tactic-count">0/2</em><small>組み替えると各案の先読みが更新される。</small></div>
        <div id="decision-tactic-list" class="tactic-list is-compact"></div>
      </section>
      <details class="decision-details">
        <summary>装備と遠征の詳細</summary>
        <section id="decision-context" class="decision-context" aria-label="判断材料"></section>
      </details>
      <p id="decision-hint" class="modal-hint"></p>
    </div>
  </section>

  <section id="end-dialog" class="modal-layer" hidden aria-live="assertive">
    <div class="modal-panel result-panel" role="dialog" aria-modal="true" aria-labelledby="end-title">
      <p id="end-kicker" class="eyebrow">遠征終了</p>
      <h2 id="end-title">遠征記録</h2>
      <p id="end-summary" class="modal-lead"></p>
      <div id="end-milestone" class="end-milestone" hidden></div>
      <div id="end-stats" class="end-stats"></div>
      <div id="run-comparison" class="run-comparison"></div>
      <section id="run-insights" class="run-insights" aria-label="遠征の軌跡"></section>
      <div class="result-section-heading"><h3>得点の内訳</h3></div>
      <div id="score-breakdown" class="score-breakdown"></div>
      <div id="decision-history" class="decision-history"></div>
      <div class="modal-footer">
        <button id="end-new-expedition" class="primary-button" type="button">灰灯院へ戻り、次の遠征を支度する</button>
      </div>
    </div>
  </section>
`;

await loadBrowserGameConfig();

const renderer = new PixiRoguelikeRenderer();
const observerShell = requireElement<HTMLElement>(".observer-shell");
const pixiRoot = requireElement<HTMLDivElement>("#pixi-root");
const mapStage = requireElement<HTMLDivElement>("#map-stage");
const candidateDialog = requireElement<HTMLElement>("#candidate-dialog");
const missionList = requireElement<HTMLDivElement>("#mission-list");
const candidateList = requireElement<HTMLDivElement>("#candidate-list");
const veteranList = requireElement<HTMLDivElement>("#veteran-list");
const instituteFacilities = requireElement<HTMLDivElement>("#institute-facilities");
const instituteInfirmary = requireElement<HTMLDivElement>("#institute-infirmary");
const instituteCycle = requireElement<HTMLDivElement>("#institute-cycle");
const tacticList = requireElement<HTMLDivElement>("#tactic-list");
const decisionTactics = requireElement<HTMLElement>("#decision-tactics");
const decisionTacticList = requireElement<HTMLDivElement>("#decision-tactic-list");
const decisionDialog = requireElement<HTMLElement>("#decision-dialog");
const decisionTitle = requireElement<HTMLHeadingElement>("#decision-title");
const decisionBody = requireElement<HTMLParagraphElement>("#decision-body");
const decisionContext = requireElement<HTMLElement>("#decision-context");
const decisionStatus = requireElement<HTMLDivElement>("#decision-status");
const decisionOptions = requireElement<HTMLDivElement>("#decision-options");
const decisionHint = requireElement<HTMLParagraphElement>("#decision-hint");
const endDialog = requireElement<HTMLElement>("#end-dialog");
const endKicker = requireElement<HTMLParagraphElement>("#end-kicker");
const endTitle = requireElement<HTMLHeadingElement>("#end-title");
const endSummary = requireElement<HTMLParagraphElement>("#end-summary");
const runComparison = requireElement<HTMLDivElement>("#run-comparison");
const endStats = requireElement<HTMLDivElement>("#end-stats");
const departButton = requireElement<HTMLButtonElement>("#depart-button");
const resumeButton = requireElement<HTMLButtonElement>("#resume-run");
const scoreBreakdown = requireElement<HTMLDivElement>("#score-breakdown");
const decisionHistory = requireElement<HTMLDivElement>("#decision-history");
const runInsightsPanel = requireElement<HTMLElement>("#run-insights");
const endMilestone = requireElement<HTMLElement>("#end-milestone");

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
let lookahead: { decisionKey: string; workers: Worker[]; results: Map<string, LookaheadSummary>; failedOptions: Set<string> } | null = null;
let paused = false;
let selectedTactics: string[] = loadSelectedTactics();
let draftTactics: string[] | null = null;
let draftDecisionId: string | null = null;
let focusedModal: HTMLElement | null = null;
/** 灰灯院で選んでいる探索者。古参は id、志願者は職業で指す。 */
let selectedDelver: { kind: "veteran"; id: string } | { kind: "recruit"; roleId: string } | null = null;
/** 実際に送り出した遠征があるか。起動直後の仮の盤面と区別する。 */
let runActive = false;
/** 階層タイトルを最後に出した遠征と階。同じ階で二度出さない。 */
let announcedFloor: string | null = null;
let floorCardTimer: number | null = null;
let shownScore = 0;
let scoreFrame = 0;

installEvents();
installDebugBridge();
renderCandidateSelection();
render();
await renderer.mount(pixiRoot);
syncViewport();
new ResizeObserver(syncViewport).observe(mapStage);
requireElement<HTMLButtonElement>("#pause-toggle").innerHTML = PAUSE_ICON;
applySprite(requireElement<HTMLElement>("#brand-mark"), assetForContent("ui.heat"), 30);
render();
void showTitle({
  cycle: campaign.cycle.number,
  expeditions: campaign.expeditions.length,
  highestFloor: campaignProgress(campaign).highestFloor,
  shards: campaign.shards,
}).then(() => {
  app.inert = false;
  // 灯が画面を満たしている間に、支度の部屋を奥から立ち上げる。
  candidateDialog.classList.add("is-entering");
  window.setTimeout(() => candidateDialog.classList.remove("is-entering"), 2600);
  departButton.focus({ preventScroll: true });
});

/** マップ枠の大きさに合わせて表示タイル数を決め、枠いっぱいに1タイルを大きく見せる。 */
function syncViewport(): void {
  const width = mapStage.clientWidth;
  const height = mapStage.clientHeight;
  if (width <= 0 || height <= 0) return;
  const narrow = width < 560;
  const targetTile = narrow ? 46 : 64;
  const columns = Math.max(narrow ? 7 : 10, Math.min(22, Math.round(width / targetTile)));
  let tile = width / columns;
  let rows = Math.max(6, Math.min(14, Math.floor(height / tile)));
  // 縦が足りない時は、縦に合わせてタイルを縮める。
  if (rows * tile > height) {
    tile = height / rows;
  }
  rows = Math.max(6, rows);
  renderer.setViewport(columns, rows);
  const canvas = pixiRoot.querySelector("canvas");
  if (canvas) {
    canvas.style.width = `${Math.floor(columns * tile)}px`;
    canvas.style.height = `${Math.floor(rows * tile)}px`;
  }
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
  runInsightsPanel.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-adopt-tactic]");
    if (!button || button.disabled) return;
    const tacticId = button.dataset.adoptTactic ?? "";
    const slots = campaignTacticSlots(campaign);
    selectedTactics = normalizeTactics([tacticId, ...selectedTactics.filter((id) => id !== tacticId)].slice(0, slots), slots);
    saveSelectedTactics(selectedTactics);
    button.disabled = true;
    button.textContent = "採用済み";
  });
  candidateList.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-role-id]");
    if (!button) return;
    selectDelver({ kind: "recruit", roleId: button.dataset.roleId ?? playableRoles()[0].id });
  });
  veteranList.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-veteran-id]");
    if (!button?.dataset.veteranId) return;
    selectDelver({ kind: "veteran", id: button.dataset.veteranId });
  });
  departButton.addEventListener("click", departSelected);
  resumeButton.addEventListener("click", resumeObserving);
  const inventoryList = requireElement<HTMLUListElement>("#inventory-list");
  const showInventoryName = (event: Event) => {
    const slot = (event.target as HTMLElement).closest<HTMLElement>("[data-item-label]");
    if (slot) setText("#inventory-caption", slot.dataset.itemLabel ?? "");
  };
  inventoryList.addEventListener("pointerover", showInventoryName);
  inventoryList.addEventListener("click", showInventoryName);
  inventoryList.addEventListener("pointerleave", () => setText("#inventory-caption", ""));
  instituteFacilities.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-facility-id]");
    if (!button || button.disabled) return;
    campaign = upgradeFacility(campaign, button.dataset.facilityId as FacilityId);
    saveCampaign(campaign);
    renderCandidateSelection();
  });
  instituteCycle.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-heat]");
    if (!button || button.disabled) return;
    campaign = { ...campaign, heat: { ...campaign.heat, selected: Number(button.dataset.heat ?? 0) } };
    saveCampaign(campaign);
    renderCandidateSelection();
  });
  instituteInfirmary.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-treat-veteran]");
    if (!button || button.disabled) return;
    campaign = treatScar(campaign, button.dataset.treatVeteran ?? "", button.dataset.treatScar ?? "");
    saveCampaign(campaign);
    renderCandidateSelection();
  });
  tacticList.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-tactic-id]");
    if (!button || button.disabled) return;
    selectedTactics = toggleTactic(selectedTactics, button.dataset.tacticId ?? "", campaignTacticSlots(campaign));
    saveSelectedTactics(selectedTactics);
    renderCandidateSelection();
  });
  decisionTacticList.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-tactic-id]");
    if (!button || button.disabled || !draftTactics) return;
    draftTactics = toggleTactic(draftTactics, button.dataset.tacticId ?? "", state.modifiers.tacticSlots);
    render();
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
    const tacticsChanged = draftTactics && state.pendingDecision?.kind === "checkpoint" && draftTactics.join(",") !== state.tactics.join(",");
    applyLoggedAction({ type: "resolveDecision", optionId: button.dataset.optionId ?? "", ...(tacticsChanged && draftTactics ? { tactics: draftTactics } : {}) }, "player");
    draftTactics = null;
    draftDecisionId = null;
    render();
    if (state.status === "playing" && !state.pendingDecision) scheduleAutoplay("exploration");
  });
  window.addEventListener("keydown", (event) => {
    if (app?.inert) return;
    // タイトルを開いたEnterの長押しで、続けて探索者を送り出さない。
    if (event.key === "Enter" && event.repeat) {
      event.preventDefault();
      return;
    }
    if (event.key === "Tab" && focusedModal) {
      const focusable = [...focusedModal.querySelectorAll<HTMLElement>("button:not(:disabled), summary")]
        .filter((element) => element.getClientRects().length > 0);
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
    if (!candidateDialog.hidden) {
      if (event.key === "Escape" && !resumeButton.hidden) {
        event.preventDefault();
        resumeObserving();
        return;
      }
      // 選択済みの探索者カードか、ボタン以外にフォーカスがある時の Enter は出発にする。
      const active = document.activeElement;
      if (event.key === "Enter" && (!(active instanceof HTMLButtonElement) || active.matches(".candidate-card.is-selected"))) {
        event.preventDefault();
        departButton.click();
        return;
      }
    }
    if (!["1", "2", "3", "4"].includes(event.key)) return;
    const index = Number(event.key) - 1;
    const visibleButtons = !candidateDialog.hidden
      ? candidateDialog.querySelectorAll<HTMLButtonElement>("button[data-veteran-id], button[data-role-id]")
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
  // 同じ迷宮を二度引かないよう、今の遠征と同じseedなら候補を引き直す。観戦途中で開閉しても志願者は変わらない。
  if (candidateSeed === state.seed) {
    candidateSeed = nextSeed();
    selectedDelver = null;
  }
  renderCandidateSelection();
  candidateDialog.hidden = false;
  candidateDialog.scrollTop = 0;
  syncModalAccessibility();
}

/** 観戦途中に灰灯院を開いた時、遠征を捨てずに観戦へ戻る。 */
function resumeObserving(): void {
  if (!runActive || state.status !== "playing") return;
  candidateDialog.hidden = true;
  render();
  if (!paused && !state.pendingDecision) scheduleAutoplay(scheduledPace);
}

function selectDelver(next: NonNullable<typeof selectedDelver>): void {
  selectedDelver = next;
  renderCandidateSelection();
}

function departSelected(): void {
  const delver = resolveSelectedDelver();
  if (!delver) return;
  startExpedition(delver.roleId, delver.veteran);
}

/** 選択中の探索者を解決する。古参が倒れて消えた時などは先頭の候補に戻す。 */
function resolveSelectedDelver(): { roleId: string; veteran?: Veteran; name: string; roleName: string; temperament: string } | null {
  if (selectedDelver?.kind === "veteran") {
    const veteranId = selectedDelver.id;
    const veteran = campaign.roster.find((entry) => entry.id === veteranId);
    if (veteran) return { roleId: veteran.identity.roleId, veteran, name: veteran.identity.name, roleName: getContentName(veteran.identity.roleId), temperament: temperamentLabel(veteran.identity.temperament) };
  }
  if (selectedDelver?.kind === "recruit") {
    const roleId = selectedDelver.roleId;
    const identity = recruitIdentities().find((entry) => entry.roleId === roleId);
    if (identity) return { roleId, name: identity.name, roleName: getContentName(roleId), temperament: temperamentLabel(identity.temperament) };
  }
  const veteran = campaign.roster[0];
  if (veteran) {
    selectedDelver = { kind: "veteran", id: veteran.id };
    return resolveSelectedDelver();
  }
  const roleId = playableRoles()[0]?.id;
  if (!roleId) return null;
  selectedDelver = { kind: "recruit", roleId };
  return resolveSelectedDelver();
}

function startExpedition(roleId: string, veteran?: Veteran): void {
  stopAutoplay();
  selectedRoleId = roleId;
  selectedIdentity = veteran ? { ...veteran.identity } : recruitIdentities().find((identity) => identity.roleId === roleId) ?? createRunIdentity(candidateSeed, roleId);
  const tacticSlots = campaignTacticSlots(campaign);
  const unlocked = new Set(unlockedTacticIds(campaign));
  const carried = campaignRunModifiers(campaign);
  state = createInitialGame(candidateSeed, roleId, {
    identity: selectedIdentity,
    knownRoleTruths: campaign.roleTruths,
    missionId: selectedMissionId,
    tactics: selectedTactics.filter((id) => unlocked.has(id)),
    modifiers: { ...carried.modifiers, tacticSlots, rank: veteran?.rank ?? 0, scars: veteran?.scars ?? [] },
    bonusEmbers: carried.bonusEmbers,
    bonusMaxEmbers: carried.bonusMaxEmbers,
  });
  runLog = createRunLog(state.seed, roleId, {}, selectedIdentity);
  currentReview = null;
  archivedRunId = null;
  runActive = true;
  candidateDialog.hidden = true;
  decisionDialog.hidden = true;
  endDialog.hidden = true;
  paused = false;
  render();
  setPaused(false);
}

function renderCandidateSelection(): void {
  // 再描画でボタンが作り直されてもキーボード操作の位置を失わないよう、フォーカス先を覚えて戻す。
  const focusKey = focusedDataKey();
  missionList.replaceChildren(...expeditionMissions.map((mission) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.missionId = mission.id;
    button.className = mission.id === selectedMissionId ? "mission-option is-selected" : "mission-option";
    button.setAttribute("aria-pressed", String(mission.id === selectedMissionId));
    button.innerHTML = `<strong>${escapeHtml(mission.label)}</strong><small>${escapeHtml(mission.description)}</small><em>${escapeHtml(mission.targetLabel)}</em><span class="mission-reward">報酬 ${escapeHtml(mission.rewardLabel)}</span>`;
    return button;
  }));
  const slots = campaignTacticSlots(campaign);
  const unlocked = new Set(unlockedTacticIds(campaign));
  selectedTactics = normalizeTactics(selectedTactics.filter((id) => unlocked.has(id)), slots);
  renderTacticPicker(tacticList, selectedTactics, slots);
  setText("#tactic-count", `${selectedTactics.length}/${slots}`);
  renderInstitute();
  renderCycle();
  const delver = resolveSelectedDelver();
  renderVeterans();
  setText("#recruit-capacity", campaign.roster.length >= getGameConfig().campaign.rosterLimit
    ? "遠征団は満員。志願者は遠征できるが、生還しても加入しない（古参は全員残る）。"
    : `生還すると遠征団に加わる（${campaign.roster.length}/${getGameConfig().campaign.rosterLimit}人）。`);
  const indexOffset = campaign.roster.length;
  const recruits = recruitIdentities();
  candidateList.replaceChildren(...playableRoles().map((role, index) => {
    const identity = recruits[index];
    const selected = selectedDelver?.kind === "recruit" && selectedDelver.roleId === role.id;
    return candidateCard({
      dataKey: ["roleId", role.id],
      selected,
      shortcut: index + indexOffset + 1,
      roleId: role.id,
      name: escapeHtml(identity.name),
      meta: getContentName(role.id),
      temperament: identity.temperament,
      extra: `<small>${temperamentDescription(identity.temperament)}</small>`,
      stats: { hp: role.stats.maxHp, attack: role.stats.attack, defense: role.stats.defense },
    });
  }));
  renderDepartSummary(delver);
  renderTruths();
  renderArchive();
  restoreFocus(candidateDialog, focusKey);
}

function candidateCard(options: {
  dataKey: ["roleId" | "veteranId", string];
  selected: boolean;
  veteran?: boolean;
  shortcut: number;
  roleId: string;
  name: string;
  meta: string;
  temperament: Veteran["identity"]["temperament"];
  extra: string;
  stats: { hp: number; attack: number; defense: number };
}): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset[options.dataKey[0]] = options.dataKey[1];
  button.className = `candidate-card${options.veteran ? " is-veteran" : ""}${options.selected ? " is-selected" : ""}`;
  button.setAttribute("aria-pressed", String(options.selected));
  // 肖像はアーチ形の龕に立たせ、選ぶと足元の灯がともる。
  const portrait = document.createElement("span");
  portrait.className = "candidate-portrait";
  const figure = document.createElement("i");
  figure.className = "candidate-figure";
  applySprite(figure, assetForContent(options.roleId), 112);
  portrait.append(figure);
  const body = document.createElement("span");
  body.className = "candidate-body";
  body.innerHTML = `
    ${options.shortcut <= 4 ? `<kbd class="candidate-index">${options.shortcut}</kbd>` : ""}
    <strong>${options.name}</strong>
    <em>${escapeHtml(options.meta)}</em>
    <span class="temperament-tag temperament-${options.temperament}">${temperamentLabel(options.temperament)}</span>
    ${options.extra}
    <span class="mini-stats"><span>HP <b>${options.stats.hp}</b></span><span>攻撃 <b>${options.stats.attack}</b></span><span>防御 <b>${options.stats.defense}</b></span></span>
  `;
  button.append(portrait, body);
  return button;
}

function renderDepartSummary(delver: ReturnType<typeof resolveSelectedDelver>): void {
  const summary = requireElement<HTMLDivElement>("#depart-summary");
  departButton.disabled = !delver;
  if (!delver) {
    summary.innerHTML = '<span class="depart-note">送り出す探索者を選んでください。</span>';
    return;
  }
  const tactics = tacticLabels(selectedTactics);
  const heat = campaign.heat.selected;
  const abandoning = runActive && state.status === "playing";
  summary.innerHTML = `
    <span class="depart-portrait" aria-hidden="true"></span>
    <span class="depart-who"><strong>${escapeHtml(delver.name)}${delver.veteran ? ` <span class="rank-stars">${"★".repeat(delver.veteran.rank)}</span>` : ""}</strong><small>${escapeHtml(delver.roleName)} · ${escapeHtml(delver.temperament)}</small></span>
    <span class="depart-plan">
      <span>任務 <b>${escapeHtml(missionDefinition(selectedMissionId).label)}</b></span>
      <span>作戦 <b>${tactics.length ? escapeHtml(tactics.join("・")) : "なし"}</b></span>
      ${heat > 0 ? `<span>燭階 <b>${heat}</b></span>` : ""}
    </span>
    ${abandoning ? `<span class="depart-note is-warning">観戦中の遠征（${escapeHtml(state.runIdentity.name)}・地下${state.floor}階）は記録されずに終わる。</span>` : ""}
  `;
  applySprite(summary.querySelector<HTMLElement>(".depart-portrait") as HTMLElement, assetForContent(delver.roleId), 44);
  departButton.textContent = abandoning ? "遠征を切り替えて出発" : `${delver.name}を送り出す`;
  resumeButton.hidden = !abandoning;
}

function focusedDataKey(container: HTMLElement = candidateDialog): string | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !container.contains(active)) return null;
  for (const key of ["missionId", "tacticId", "heat", "roleId", "veteranId", "facilityId", "treatScar", "optionId"]) {
    const value = active.dataset[key];
    if (value !== undefined) return `[data-${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}="${CSS.escape(value)}"]`;
  }
  return null;
}

function restoreFocus(container: HTMLElement, selector: string | null): void {
  if (!selector) return;
  const target = container.querySelector<HTMLElement>(selector);
  if (target && document.activeElement !== target) target.focus({ preventScroll: true });
}

/** 古参や他の志願者と名前が重ならない志願者を職業ごとに用意する。 */
function recruitIdentities(): ReturnType<typeof createRunIdentity>[] {
  const used = [...campaign.roster.map((veteran) => veteran.identity.name), ...pendingGraves(campaign).map((grave) => grave.name), ...(campaign.cycle.keeperName ? [campaign.cycle.keeperName] : [])];
  return playableRoles().map((role) => {
    const identity = createRunIdentity(candidateSeed, role.id, used);
    used.push(identity.name);
    return identity;
  });
}

function renderInstitute(): void {
  const config = getGameConfig().campaign;
  applySprite(requireElement<HTMLElement>("#shard-icon"), assetForContent("ui.shard"), 18);
  setText("#institute-shards", campaign.shards.toLocaleString("ja-JP"));
  instituteFacilities.replaceChildren(...(Object.keys(config.facilities) as FacilityId[]).map((facilityId) => {
    const facility = config.facilities[facilityId];
    const level = campaign.facilities[facilityId];
    const cost = facilityUpgradeCost(campaign, facilityId);
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.facilityId = facilityId;
    button.className = "facility-card";
    button.disabled = cost === null || campaign.shards < cost;
    button.innerHTML = `<span class="facility-icon" aria-hidden="true"></span><strong>${escapeHtml(facility.label)} <em>Lv${level}/${facility.costs.length}</em></strong><small>${escapeHtml(facility.description)}</small><span>${cost === null ? "最大" : `強化 · 灯片${cost}`}</span>`;
    applySprite(button.querySelector<HTMLElement>(".facility-icon") as HTMLElement, assetForContent(`facility.${facilityId}`), 44);
    return button;
  }));
  const scarred = campaign.roster.flatMap((veteran) => veteran.scars.map((scarId) => ({ veteran, scarId })));
  const treatmentCost = config.scarTreatmentCost;
  instituteInfirmary.innerHTML = scarred.length
    ? `<span class="infirmary-label">療房</span>${scarred.map(({ veteran, scarId }) => `<button type="button" class="scar-treat" data-treat-veteran="${escapeHtml(veteran.id)}" data-treat-scar="${escapeHtml(scarId)}"${campaign.shards < treatmentCost ? " disabled" : ""}>${escapeHtml(veteran.identity.name)}の${escapeHtml(getGameConfig().scars[scarId]?.label ?? scarId)}を癒やす · 灯片${treatmentCost}</button>`).join("")}`
    : "";
}

function renderCycle(): void {
  const config = getGameConfig();
  const aftermath = campaign.cycle.aftermath ? config.aftermath[campaign.cycle.aftermath] : null;
  const graves = pendingGraves(campaign);
  const tiers = config.ascension.tiers;
  const heatButtons = Array.from({ length: campaign.heat.unlocked + 1 }, (_, heat) => {
    const tier = heat > 0 ? tiers[heat - 1] : null;
    const active = campaign.heat.selected === heat;
    return `<button type="button" class="heat-option${active ? " is-selected" : ""}" data-heat="${heat}" aria-pressed="${active}" title="${escapeHtml(tier ? tier.description : "制約なし")}">${heat === 0 ? "燭階0" : `燭階${heat}`}<small>${escapeHtml(tier ? tier.label : "素の迷宮")}</small></button>`;
  }).join("");
  const emblemAsset = assetForContent("ui.heat");
  const layers = tiers.slice(0, campaign.heat.selected).map((tier) => `<li>${escapeHtml(tier.label)}：${escapeHtml(tier.description)}</li>`).join("");
  const bonus = runShardBonusPercent(campaign.heat.selected, campaign.cycle.aftermath);
  const locked = campaign.heat.unlocked < tiers.length ? `<small class="heat-next">燭階${campaign.heat.unlocked}で第十層を踏破すると燭階${campaign.heat.unlocked + 1}「${escapeHtml(tiers[campaign.heat.unlocked].label)}」が開く。</small>` : "";
  instituteCycle.innerHTML = `
    <div class="cycle-head"><span class="cycle-emblem" aria-hidden="true"${emblemAsset ? ` style="${spriteStyle(emblemAsset, 26)}"` : ""}></span><strong>第${campaign.cycle.number}周期</strong>${aftermath ? `<em>${escapeHtml(aftermath.label)}</em>` : "<em>始まりの周期</em>"}${bonus > 0 ? `<span class="cycle-bonus">灯片 +${bonus}%</span>` : ""}</div>
    ${aftermath ? `<p class="cycle-text">${escapeHtml(campaign.cycle.aftermath === "inherit-flame" && campaign.cycle.keeperName ? `${campaign.cycle.keeperName}が堕ちた灯守として第十層に立ちはだかる。` : aftermath.description)}</p>` : `<p class="cycle-text">結末を選ぶと周期が進み、選んだ結末が次の迷宮を変える。</p>`}
    ${graves.length ? `<p class="cycle-text">墓標 ${graves.map((grave) => `${escapeHtml(grave.name)}（F${grave.floor}）`).join("・")} が迷宮に残っている。弔えば遺品と灯火を受け継げる。</p>` : ""}
    <div class="heat-options" role="group" aria-label="燭階">${heatButtons}</div>
    ${layers ? `<ul class="heat-layers">${layers}</ul>` : ""}
    ${locked}
  `;
}

function renderVeterans(): void {
  const scars = getGameConfig().scars;
  if (campaign.roster.length === 0) {
    veteranList.innerHTML = '<p class="empty-state">まだ帰還した古参はいない。生還した探索者はここに残る。</p>';
    return;
  }
  const bonus = getGameConfig().campaign.veteranRankBonus;
  veteranList.replaceChildren(...campaign.roster.map((veteran, index) => {
    const role = playableRoles().find((candidate) => candidate.id === veteran.identity.roleId);
    const selected = selectedDelver?.kind === "veteran" && selectedDelver.id === veteran.id;
    return candidateCard({
      dataKey: ["veteranId", veteran.id],
      selected,
      veteran: true,
      shortcut: index + 1,
      roleId: veteran.identity.roleId,
      name: `${escapeHtml(veteran.identity.name)} <span class="rank-stars" aria-label="位階${veteran.rank}">${"★".repeat(veteran.rank)}</span>`,
      meta: `${getContentName(veteran.identity.roleId)} · 遠征${veteran.expeditions}回`,
      temperament: veteran.identity.temperament,
      extra: veteran.scars.length ? `<span class="scar-tags">${veteran.scars.map((id) => `<i title="${escapeHtml(scars[id]?.description ?? "")}">${escapeHtml(scars[id]?.label ?? id)}</i>`).join("")}</span>` : "",
      stats: { hp: (role?.stats.maxHp ?? 0) + bonus.maxHp * veteran.rank, attack: (role?.stats.attack ?? 0) + bonus.attack * veteran.rank, defense: role?.stats.defense ?? 0 },
    });
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
  // デバッグで一気に進めた時などに大量の演出が重ならないよう、直近分だけ描く。
  const recentEvents = pendingVisualEvents.slice(-24);
  renderer.render(state, { events: recentEvents, intent: pendingIntent, stepMs: currentStepMs(), lightStrength: lightStrengthFor(state) });
  pendingVisualEvents = [];
  pendingIntent = null;
  announceFloor();
  const observation = observeGame(state);
  const player = observation.player;
  const config = getGameConfig();
  const score = calculateScore(state);
  setText("#run-directive", directiveLabel(state.directive));
  const runMission = missionDefinition(state.story.missionId);
  const runMissionProgress = missionProgress(state);
  setText("#run-mission", runMission.label);
  setText("#run-mission-progress", state.story.missionCompleted ? "達成" : runMissionProgress.missed ? "期限切れ" : `${runMissionProgress.current}/${runMissionProgress.target}`);
  const missionFill = requireElement<HTMLElement>("#mission-fill");
  missionFill.style.width = `${state.story.missionCompleted ? 100 : Math.min(100, runMissionProgress.current / Math.max(1, runMissionProgress.target) * 100)}%`;
  missionFill.dataset.tone = state.story.missionCompleted ? "done" : runMissionProgress.missed ? "missed" : "active";
  setText("#run-revelations", `${state.revelationsRemaining}/${config.autonomous.revelationsPerRun}`);
  const rules = runRules(state.modifiers);
  setText("#run-turn", `${state.runTurn} / ${rules.runTurnLimit}手`);
  setText("#biome-kicker", `地下${state.floor}階 / ${config.rules.maxFloor}${state.status === "playing" ? "" : ` · ${statusLabel(state.status)}`}`);
  setText("#biome-title", biomeThemeName(state.biome));
  tweenScore(score.total);
  const routeWarning = state.runTurn >= rules.runTurnWarning;
  setText("#turn-meter-label", routeWarning ? "灯路が揺らいでいる" : "灯路");
  requireElement<HTMLElement>("#turn-meter").classList.toggle("is-warning", routeWarning);
  const meter = requireElement<HTMLElement>("#turn-meter-fill");
  meter.style.width = `${Math.min(100, state.runTurn / rules.runTurnLimit * 100)}%`;

  setText("#explored-ratio", `${Math.round(observation.exploration.exploredTileRatio * 100)}%`);
  setText("#objective-title", objectiveLabel(observation.exploration.objective));
  setText("#objective-detail", objectiveDetail(observation));
  renderVitals(observation);
  renderLantern(observation);

  requireElement<HTMLOListElement>("#message-list").replaceChildren(...[...state.messages.slice(-30)].reverse().map((entry) => {
    const item = document.createElement("li");
    item.className = `tone-${entry.tone}`;
    item.innerHTML = `<span>${entry.turn}</span><p>${escapeHtml(entry.text)}</p>`;
    return item;
  }));
  renderInventory(player.inventory ?? []);
  renderDecision(observation);
  renderEnd();
  syncModalAccessibility();
}

/** 暫定得点は一気に書き換えず、数字が転がるように追いつかせる。 */
function tweenScore(target: number): void {
  const element = requireElement<HTMLElement>("#live-score");
  cancelAnimationFrame(scoreFrame);
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || Math.abs(target - shownScore) < 1) {
    shownScore = target;
    element.textContent = target.toLocaleString("ja-JP");
    return;
  }
  const from = shownScore;
  const start = performance.now();
  const duration = 520;
  element.classList.toggle("is-rising", target > from);
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    shownScore = Math.round(from + (target - from) * (1 - (1 - t) ** 3));
    element.textContent = shownScore.toLocaleString("ja-JP");
    if (t < 1) scoreFrame = requestAnimationFrame(step);
    else element.classList.remove("is-rising");
  };
  scoreFrame = requestAnimationFrame(step);
}

/** 階を降りた時、マップの上に階の名を一度だけ浮かべる。 */
function announceFloor(): void {
  if (!runActive || state.status !== "playing") return;
  const key = `${state.seed}:${state.floor}`;
  if (announcedFloor === key) return;
  announcedFloor = key;
  const card = requireElement<HTMLElement>("#floor-card");
  card.querySelector(".floor-card-no")!.textContent = `地下 ${toKanjiNumber(state.floor)} 階`;
  card.querySelector(".floor-card-name")!.textContent = biomeThemeName(state.biome);
  card.dataset.biome = state.biome;
  card.classList.remove("is-shown");
  void card.offsetWidth;
  card.classList.add("is-shown");
  if (floorCardTimer !== null) window.clearTimeout(floorCardTimer);
  floorCardTimer = window.setTimeout(() => card.classList.remove("is-shown"), 3200);
}

function toKanjiNumber(value: number): string {
  const digits = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (value < 10) return digits[value];
  if (value === 10) return "十";
  if (value < 20) return `十${digits[value - 10]}`;
  return String(value);
}

/** 灯火の残りと灯路の残り時間で、探索者を照らす光の強さを決める。 */
function lightStrengthFor(current: GameState): number {
  const rules = runRules(current.modifiers);
  const emberRatio = current.lantern.maxEmbers > 0 ? current.lantern.embers / current.lantern.maxEmbers : 1;
  const routeLeft = Math.max(0, rules.runTurnLimit - current.runTurn) / Math.max(1, rules.runTurnLimit - rules.runTurnWarning);
  return Math.min(0.55 + emberRatio * 0.45, 0.35 + Math.min(1, routeLeft) * 0.65);
}

function renderVitals(observation: ReturnType<typeof observeGame>): void {
  const player = observation.player;
  const progress = observation.playerProgress;
  setText("#vitals-name", state.runIdentity.name);
  setText("#hero-role", `${getContentName(player.contentId)} · ${temperamentLabel(state.runIdentity.temperament)}`);
  setText("#vitals-level", `${state.modifiers.rank > 0 ? `${"★".repeat(state.modifiers.rank)} ` : ""}Lv${progress.level}`);
  const portrait = requireElement<HTMLElement>("#vitals-portrait");
  if (portrait.dataset.roleId !== player.contentId) {
    portrait.dataset.roleId = player.contentId;
    applySprite(portrait, assetForContent(player.contentId), 56);
  }
  const hp = player.stats?.hp ?? 0;
  const maxHp = player.stats?.maxHp ?? 1;
  const ratio = Math.max(0, Math.min(1, hp / maxHp));
  setText("#vitals-hp-value", `${Math.max(0, hp)} / ${maxHp}`);
  const fill = requireElement<HTMLElement>("#vitals-hp-fill");
  fill.style.width = `${ratio * 100}%`;
  requireElement<HTMLElement>("#vitals-hp-trail").style.width = `${ratio * 100}%`;
  const hpTone = ratio <= 0.3 ? "danger" : ratio <= 0.6 ? "warning" : "safe";
  requireElement<HTMLElement>("#vitals-hp").dataset.tone = hpTone;
  const conditions = player.conditions ?? [];
  requireElement<HTMLElement>("#vitals-conditions").innerHTML = conditions.length
    ? conditions.map((condition) => `<span class="tag tag-${conditionTone(condition)}">${conditionLabel(condition)} ${condition.turns}手</span>`).join("")
    : "";
  const scarLabels = state.modifiers.scars.map((id) => getGameConfig().scars[id]?.label ?? id);
  requireElement<HTMLElement>("#vitals-tactics").innerHTML = tacticLabels(state.tactics).map((label) => `<span class="tag tag-tactic">${escapeHtml(label)}</span>`).join("")
    + scarLabels.map((label) => `<span class="tag tag-danger" title="古傷">${escapeHtml(label)}</span>`).join("");
  requireElement<HTMLDivElement>("#hero-stats").innerHTML = [
    ["攻撃", String(player.stats?.attack ?? "-")],
    ["防御", String(player.stats?.defense ?? "-")],
    ["所持金", String(progress.gold)],
  ].map(([label, value]) => `<span>${label}<strong>${value}</strong></span>`).join("");
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
  setText("#lantern-count", `${lantern.embers}/${lantern.maxEmbers}`);
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
      button.innerHTML = `<span class="rite-icon" aria-hidden="true"></span><kbd>${lanternRiteKeys[rite]}</kbd><strong>${lanternRiteLabel(rite)}<em></em></strong><small>${escapeHtml(lanternRiteDescription(rite))}</small>`;
      applySprite(button.querySelector<HTMLElement>(".rite-icon") as HTMLElement, assetForContent(`rite.${rite}`), 40);
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
    if (costLabel) costLabel.textContent = `灯${cost}`;
    button.title = `${lanternRiteLabel(rite)}（${lanternRiteKeys[rite]}）: ${lanternRiteDescription(rite)}`;
  }
}

function toggleTactic(current: string[], tacticId: string, slots: number): string[] {
  if (current.includes(tacticId)) return current.filter((id) => id !== tacticId);
  if (current.length >= slots) return current;
  return [...current, tacticId];
}

function renderTacticPicker(container: HTMLElement, selected: string[], slots: number): void {
  const definitions = getGameConfig().tactics.definitions;
  const full = selected.length >= slots;
  container.replaceChildren(...unlockedTacticIds(campaign).map((tacticId) => {
    const tactic = definitions[tacticId];
    const active = selected.includes(tacticId);
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.tacticId = tacticId;
    button.className = active ? "tactic-card is-selected" : "tactic-card";
    button.disabled = !active && full;
    button.setAttribute("aria-pressed", String(active));
    button.innerHTML = `<span class="tactic-icon" aria-hidden="true"></span><strong>${escapeHtml(tactic.label)}</strong><small>${escapeHtml(tactic.description)}</small>`;
    applySprite(button.querySelector<HTMLElement>(".tactic-icon") as HTMLElement, assetForContent(tacticId), container.classList.contains("is-compact") ? 30 : 40);
    return button;
  }));
}

function tacticLabels(tactics: string[]): string[] {
  const definitions = getGameConfig().tactics.definitions;
  return tactics.map((id) => definitions[id]?.label ?? id);
}

function loadSelectedTactics(): string[] {
  try {
    const raw = window.localStorage.getItem(TACTICS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function saveSelectedTactics(value: string[]): void {
  try {
    window.localStorage.setItem(TACTICS_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // 作戦の記憶は利便のためだけなので、保存できなくても遊べる。
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
  const config = getGameConfig();
  setText("#inventory-count", `${inventory.length}/${config.rules.inventorySlotLimit}`);
  requireElement<HTMLDivElement>("#equipment-list").innerHTML = (["weapon", "armor", "shield"] as const).map((slot) => {
    const entry = inventory.find((item) => item.equipped && config.equipment[item.contentId]?.slot === slot);
    return `<div class="equipment-slot${entry ? "" : " is-empty"}"><span>${equipmentSlotLabel(slot)}</span><strong>${entry ? escapeHtml(getContentName(entry.contentId)) : "なし"}</strong></div>`;
  }).join("");
  const list = requireElement<HTMLUListElement>("#inventory-list");
  const carried = inventory.filter((entry) => !entry.equipped);
  const signature = carried.map((entry) => `${entry.contentId}:${entry.quantity}`).join("|");
  if (list.dataset.signature === signature) return;
  list.dataset.signature = signature;
  if (carried.length === 0) {
    list.innerHTML = '<li class="empty-state">携行品なし</li>';
    return;
  }
  list.replaceChildren(...carried.map((entry) => {
    const item = document.createElement("li");
    const label = `${getContentName(entry.contentId)} ×${entry.quantity}`;
    item.className = "inventory-slot";
    item.dataset.itemLabel = label;
    item.title = label;
    item.setAttribute("aria-label", label);
    const icon = document.createElement("span");
    icon.className = "inventory-icon";
    icon.setAttribute("aria-hidden", "true");
    applySprite(icon, assetForContent(entry.contentId), 36);
    item.append(icon);
    if (entry.quantity > 1) {
      const quantity = document.createElement("b");
      quantity.textContent = String(entry.quantity);
      item.append(quantity);
    }
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
  const truths = ROLE_TRUTHS;
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
  if (!candidateDialog.hidden || !decision || state.status !== "playing") {
    decisionDialog.hidden = true;
    stopLookahead();
    return;
  }
  const focusKey = focusedDataKey(decisionDialog);
  stopAutoplay();
  setText("#decision-kicker", `黒燭からの問い · 地下${state.floor}階 · ${state.runTurn}手`);
  decisionTitle.textContent = decision.title;
  decisionBody.textContent = decision.body;
  renderDecisionContext(observation);
  decisionHint.textContent = decision.kind === "context"
    ? "各案はこの場で効果を発揮し、啓示による危機介入は遠征評価へ記録されます。番号キーでも選べます。"
    : "啓示を使わない選択は探索者の気質に沿います。番号キーでも選べます。";
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
    button.innerHTML = `<span>${index + 1}</span><strong>${escapeHtml(option.label)}</strong><small>${escapeHtml(option.description)}</small><em>${costLabel}</em>${decision.kind === "final" ? "" : `<div class="option-forecast" data-forecast-for="${escapeHtml(option.id)}"></div>`}`;
    return button;
  }));
  if (draftDecisionId !== decision.id) {
    draftDecisionId = decision.id;
    draftTactics = [...state.tactics];
  }
  const editableTactics = decision.kind === "checkpoint";
  decisionTactics.hidden = !editableTactics;
  if (editableTactics && draftTactics) {
    renderTacticPicker(decisionTacticList, draftTactics, state.modifiers.tacticSlots);
    setText("#decision-tactic-count", `${draftTactics.length}/${state.modifiers.tacticSlots}`);
  }
  const lookaheadTactics = editableTactics && draftTactics ? draftTactics : state.tactics;
  const decisionKey = `${state.seed}:${state.runTurn}:${decision.id}:${lookaheadTactics.join(",")}`;
  if (lookahead?.decisionKey !== decisionKey) startLookahead(decisionKey, lookaheadTactics);
  renderForecasts();
  decisionDialog.hidden = false;
  restoreFocus(decisionDialog, focusKey);
}

function startLookahead(decisionKey: string, tactics: string[]): void {
  stopLookahead();
  const decision = state.pendingDecision;
  if (!decision || decision.kind === "final") return;
  const rollouts = getGameConfig().autonomous.lookaheadRollouts;
  if (rollouts <= 0) return;
  const results = new Map<string, LookaheadSummary>();
  const failedOptions = new Set<string>();
  const snapshot = structuredClone(state);
  const config = getGameConfig();
  const workers = decision.options.filter((option) => option.outcome === "continue").flatMap((option) => {
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL("./game/sim/lookahead.worker.ts", import.meta.url), { type: "module" });
      const activeWorker = worker;
      const fail = () => {
        activeWorker.terminate();
        if (!lookahead || lookahead.decisionKey !== decisionKey) return;
        failedOptions.add(option.id);
        renderForecasts();
      };
      worker.onerror = (event) => { event.preventDefault(); fail(); };
      worker.onmessageerror = fail;
      worker.onmessage = (event: MessageEvent<LookaheadProgress>) => {
        if (!lookahead || lookahead.decisionKey !== decisionKey) return;
        results.set(event.data.summary.optionId, event.data.summary);
        renderForecasts();
        if (event.data.done) activeWorker.terminate();
      };
      worker.postMessage({ requestId: decisionKey, config, state: snapshot, optionId: option.id, rollouts, tactics } satisfies LookaheadRequest);
      return [worker];
    } catch {
      worker?.terminate();
      failedOptions.add(option.id);
      return [];
    }
  });
  lookahead = { decisionKey, workers, results, failedOptions };
}

function stopLookahead(): void {
  if (!lookahead) return;
  for (const worker of lookahead.workers) worker.terminate();
  lookahead = null;
}

function renderForecasts(): void {
  const decision = state.pendingDecision;
  if (!decision) return;
  const rollouts = getGameConfig().autonomous.lookaheadRollouts;
  const summaries = decision.options.filter((option) => !lookahead?.failedOptions.has(option.id)).map((option) => lookahead?.results.get(option.id)).filter((summary): summary is LookaheadSummary => !!summary && summary.rollouts === rollouts);
  const survivalRates = summaries.map((summary) => summary.survived / summary.rollouts);
  const bestSurvival = summaries.length > 1 && new Set(survivalRates).size > 1 ? Math.max(...survivalRates) : null;
  for (const option of decision.options) {
    const slot = decisionOptions.querySelector<HTMLElement>(`[data-forecast-for="${CSS.escape(option.id)}"]`);
    if (!slot) continue;
    slot.classList.remove("is-best");
    if (option.outcome === "return") {
      slot.innerHTML = forecastMarkup({ survived: 1, lost: 0, stranded: 0 }, "生還確定・ここまでの戦果で得点を確定");
      continue;
    }
    if (lookahead?.failedOptions.has(option.id)) {
      slot.innerHTML = '<span class="forecast-label">先読みを取得できませんでした。現在の状態で判断してください。</span>';
      continue;
    }
    const summary = lookahead?.results.get(option.id);
    if (!summary) {
      slot.innerHTML = `<span class="forecast-pending">未来を先読み中…</span>`;
      continue;
    }
    const survived = summary.survived / summary.rollouts;
    const lost = summary.lost / summary.rollouts;
    const stranded = summary.stranded / summary.rollouts;
    const complete = summary.rollouts >= rollouts;
    const label = `生還 ${percent(survived)}・死亡 ${percent(lost)}${stranded > 0 ? `・未帰還 ${percent(stranded)}` : ""}・平均到達 F${summary.averageMaxFloor.toFixed(1)}${summary.reachedCore > 0 ? `・中枢到達 ${percent(summary.reachedCore / summary.rollouts)}` : ""}`;
    slot.innerHTML = forecastMarkup({ survived, lost, stranded }, complete ? label : `${label}（${summary.rollouts}/${rollouts}本）`);
    slot.classList.toggle("is-best", complete && bestSurvival !== null && survived === bestSurvival);
  }
}

function forecastMarkup(ratio: { survived: number; lost: number; stranded: number }, label: string): string {
  return `<span class="forecast-bar" aria-hidden="true"><i class="is-survived" style="width:${ratio.survived * 100}%"></i><i class="is-lost" style="width:${ratio.lost * 100}%"></i><i class="is-stranded" style="width:${ratio.stranded * 100}%"></i></span><span class="forecast-label">${escapeHtml(label)}</span>`;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function renderDecisionContext(observation: ReturnType<typeof observeGame>): void {
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
    const itemConfig = entry ? config.equipment[entry.contentId] : undefined;
    return `<div class="decision-equipment-item">
      <span>${equipmentSlotLabel(slot)}</span>
      <strong>${entry ? escapeHtml(getContentName(entry.contentId)) : "未装備"}</strong>
      <small>${itemConfig ? equipmentDetail(itemConfig) : "補正なし"}</small>
    </div>`;
  }).join("");
  const score = calculateScore(state);
  decisionContext.innerHTML = `
    <div class="decision-equipment-grid">${equipment}</div>
    <div class="decision-meta-grid">
      <span>気質 <strong>${temperamentLabel(state.runIdentity.temperament)}</strong></span>
      <span>現在方針 <strong>${directiveLabel(state.directive)}</strong></span>
      <span>任務 <strong>${missionDefinition(state.story.missionId).label}</strong></span>
      <span>作戦 <strong>${state.tactics.length ? escapeHtml(tacticLabels(state.tactics).join("・")) : "なし"}</strong></span>
      <span>所持金 <strong>${observation.playerProgress.gold}</strong></span>
      <span>暫定得点 <strong>${score.total.toLocaleString("ja-JP")}</strong></span>
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
  if (!candidateDialog.hidden || state.status === "playing") {
    endDialog.hidden = true;
    return;
  }
  stopAutoplay();
  const review = currentReview ?? analyzeRun(runLog, state);
  const firstReveal = endDialog.hidden;
  const panel = requireElement<HTMLElement>(".result-panel");
  // リサイズや作戦採用で作り直す子要素に、登場演出を再適用しない。
  if (!firstReveal) panel.classList.remove("is-revealing");
  const status = statusLabel(state.status);
  endKicker.textContent = state.status === "won" ? "遠征達成" : state.status === "returned" ? "生還" : "遠征終了";
  endTitle.innerHTML = `<span class="end-status">${escapeHtml(status)}</span><span class="end-name">${escapeHtml(state.runIdentity.name)}</span>`;
  endSummary.textContent = state.story.endingId
    ? `${endingLabel(state.story.endingId)}の結末を遠征録へ刻みました。`
    : `${review.summaryText} 得点は${review.score.total.toLocaleString("ja-JP")}点です。`;
  const record = campaign.expeditions[0]?.id === archivedRunId ? campaign.expeditions[0] : null;
  const endTone = state.status === "won" || state.status === "returned" ? "safe" : "danger";
  panel.dataset.tone = endTone;
  endStats.innerHTML = [
    ["到達", `地下${state.story.maxFloorReached}階`],
    ["観測", `${state.runTurn}手`],
    ["得点", review.score.total.toLocaleString("ja-JP")],
    ["灯片", record?.shardsEarned ? `+${record.shardsEarned}` : "±0"],
  ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");
  renderRunInsights(buildRunInsights(runLog, state, review.deathCause, campaign));
  const rows: Array<[string, number]> = [
    ["進行", review.score.depth], ["守護者", review.score.guardians], ["職業目的", review.score.roleObjective],
    ["発見", review.score.discoveries], ["生還", review.score.survival], ["持帰り", review.score.recoveredValue],
    ["迅速", review.score.tempo], ["任務・介入", review.score.autonomy],
  ];
  const maxRow = Math.max(1, ...rows.map(([, value]) => value));
  scoreBreakdown.innerHTML = rows.map(([label, value]) => `<div><span>${label}</span><strong>${value.toLocaleString("ja-JP")}</strong><i style="width:${Math.round(value / maxRow * 100)}%"></i></div>`).join("");
  renderRunComparison();
  renderMilestone(record);
  decisionHistory.innerHTML = `<h3>灯守の判断</h3>${review.decisions.length === 0 ? "<p>介入記録なし</p>" : `<ol>${review.decisions.map((entry) => `<li><span>F${entry.floor}</span><strong>${escapeHtml(entry.optionLabel)}${entry.effectSummary ? `<small>${escapeHtml(entry.effectSummary)}</small>` : ""}</strong>${entry.usedRevelation ? "<em>啓示</em>" : ""}</li>`).join("")}</ol>`}`;
  endDialog.hidden = false;
  if (firstReveal) revealResult();
}

/** 結果を初めて開いた時だけ、見出しを浮かべ、軌跡を描き、数字を数え上げる。 */
function revealResult(): void {
  const panel = requireElement<HTMLElement>(".result-panel");
  panel.classList.remove("is-revealing");
  void panel.offsetWidth;
  panel.classList.add("is-revealing");
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const targets = [...panel.querySelectorAll<HTMLElement>(".end-stats strong, .score-breakdown strong")];
  targets.forEach((element, index) => {
    const text = element.textContent ?? "";
    const match = text.match(/^([^\d]*)([\d,]+)(.*)$/);
    if (!match) return;
    const target = Number(match[2].replaceAll(",", ""));
    const start = performance.now() + 500 + index * 70;
    const duration = 900;
    const tick = (now: number) => {
      const t = Math.max(0, Math.min(1, (now - start) / duration));
      element.textContent = `${match[1]}${Math.round(target * (1 - (1 - t) ** 4)).toLocaleString("ja-JP")}${match[3]}`;
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function renderRunInsights(insights: RunInsights): void {
  const width = 600;
  const height = 132;
  const top = 18;
  const plotHeight = 92;
  const x = (turn: number) => (turn / insights.totalTurns) * width;
  const y = (ratio: number) => top + (1 - ratio) * plotHeight;
  const points = insights.timeline;
  const floorBands: string[] = [];
  let bandStart = 0;
  let bandFloor = points[0]?.floor ?? 1;
  const flushBand = (end: number) => {
    const bandWidth = Math.max(0, x(end) - x(bandStart));
    floorBands.push(`<rect class="floor-band ${bandFloor % 2 === 0 ? "is-even" : ""}" x="${x(bandStart).toFixed(1)}" y="${top}" width="${bandWidth.toFixed(1)}" height="${plotHeight}"/>${bandWidth > 22 ? `<text class="floor-label" x="${(x(bandStart) + 4).toFixed(1)}" y="${top + plotHeight - 5}">F${bandFloor}</text>` : ""}`);
  };
  for (const point of points) {
    if (point.floor !== bandFloor) {
      flushBand(point.runTurn);
      bandStart = point.runTurn;
      bandFloor = point.floor;
    }
  }
  flushBand(insights.totalTurns);
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(point.runTurn).toFixed(1)},${y(point.hpRatio).toFixed(1)}`).join(" ");
  const markerShapes = insights.markers.filter((marker) => marker.kind !== "floor").map((marker) => {
    const mx = x(marker.runTurn).toFixed(1);
    if (marker.kind === "death") return `<g class="marker marker-death"><line x1="${mx}" y1="${top}" x2="${mx}" y2="${top + plotHeight}"/><text x="${mx}" y="12">✕</text></g>`;
    if (marker.kind === "lantern") return `<circle class="marker marker-lantern" cx="${mx}" cy="9" r="4"><title>${escapeHtml(marker.label)}</title></circle>`;
    return `<rect class="marker marker-decision" x="${(Number(mx) - 4).toFixed(1)}" y="5" width="8" height="8" transform="rotate(45 ${mx} 9)"><title>${escapeHtml(marker.label)}</title></rect>`;
  }).join("");
  const chart = points.length > 1
    ? `<figure class="insight-chart">
        <figcaption><strong>遠征の軌跡</strong><span>HP の推移 · <i class="key key-decision"></i>判断 <i class="key key-lantern"></i>灯介入</span></figcaption>
        <div class="insight-plot">
          <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="遠征中のHP推移">
            ${floorBands.join("")}
            <line class="hp-guide" x1="0" x2="${width}" y1="${y(0.3)}" y2="${y(0.3)}"/>
            <path class="hp-line" pathLength="1" d="${path}"/>
            ${markerShapes}
            <line class="hover-line" x1="0" x2="0" y1="${top}" y2="${top + plotHeight}" visibility="hidden"/>
          </svg>
          <div class="insight-tooltip" hidden></div>
        </div>
      </figure>`
    : "";
  const turning = insights.turningPoints.length
    ? `<ol class="turning-points">${insights.turningPoints.map((point) => `<li class="tone-${point.tone}"><span>F${point.floor} · ${point.runTurn}手</span><strong>${escapeHtml(point.title)}</strong><small>${escapeHtml(point.detail)}</small></li>`).join("")}</ol>`
    : "";
  const advice = insights.advice.length
    ? `<div class="run-advice"><h3>次の遠征への示唆</h3><ul>${insights.advice.map((item) => `<li><span class="advice-icon" style="${adviceIconStyle(item)}">${item.kind === "tactic" ? "作戦" : "灯"}</span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.reason)}</small>${item.kind === "tactic" ? `<button type="button" class="advice-adopt" data-adopt-tactic="${escapeHtml(item.id)}"${selectedTactics.includes(item.id) ? " disabled" : ""}>${selectedTactics.includes(item.id) ? "採用済み" : "次の遠征で使う"}</button>` : ""}</li>`).join("")}</ul></div>`
    : "";
  runInsightsPanel.innerHTML = chart + turning + advice;
  const plot = runInsightsPanel.querySelector<HTMLElement>(".insight-plot");
  if (plot) installInsightHover(plot, points, insights.totalTurns, width);
}

function adviceIconStyle(item: RunInsights["advice"][number]): string {
  const asset = assetForContent(item.kind === "tactic" ? item.id : `rite.${item.id}`);
  return asset ? spriteStyle(asset, 34) : "";
}

function installInsightHover(plot: HTMLElement, points: RunInsights["timeline"], totalTurns: number, width: number): void {
  const tooltip = plot.querySelector<HTMLElement>(".insight-tooltip");
  const hoverLine = plot.querySelector<SVGLineElement>(".hover-line");
  if (!tooltip || !hoverLine) return;
  const hide = () => {
    tooltip.hidden = true;
    hoverLine.setAttribute("visibility", "hidden");
  };
  plot.addEventListener("pointerleave", hide);
  const showPoint = (event: PointerEvent) => {
    const rect = plot.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const turn = ratio * totalTurns;
    let nearestPoint = points[0];
    for (const point of points) {
      if (Math.abs(point.runTurn - turn) < Math.abs(nearestPoint.runTurn - turn)) nearestPoint = point;
    }
    const lineX = (nearestPoint.runTurn / totalTurns) * width;
    hoverLine.setAttribute("x1", String(lineX));
    hoverLine.setAttribute("x2", String(lineX));
    hoverLine.setAttribute("visibility", "visible");
    tooltip.hidden = false;
    tooltip.innerHTML = `<strong>${nearestPoint.runTurn}手 · F${nearestPoint.floor}</strong><span>HP ${Math.round(nearestPoint.hpRatio * 100)}%</span>`;
    const left = (nearestPoint.runTurn / totalTurns) * rect.width;
    tooltip.style.left = `${Math.min(rect.width - 90, Math.max(0, left - 45))}px`;
  };
  plot.addEventListener("pointermove", showPoint);
  plot.addEventListener("pointerdown", showPoint);
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
    current.shardsEarned ? `灯片 +${current.shardsEarned}` : "",
    current.gravesRecovered ? `墓標${current.gravesRecovered}つを弔った` : "",
    current.status === "won" && (current.heat ?? 0) + 1 === campaign.heat.unlocked ? `燭階${campaign.heat.unlocked}が開いた` : "",
    // 墓標・昇格・結末などは上の碑に刻むので、ここでは碑にならない結果だけを添える。
    current.veteranOutcome === "roster-full" ? veteranOutcomeLabel(current) : "",
  ].filter(Boolean);
  const comparison = previous
    ? `前回比: 深度 ${signed(current.floor - previous.floor)}階 / 得点 ${signed(current.score.total - previous.score.total)}点`
    : "最初の遠征記録です。ここから灯守の記録が始まります。";
  runComparison.innerHTML = `<strong>${escapeHtml(missionDefinition(current.missionId).label)} ${current.missionCompleted ? "達成" : "未達"}</strong><p>${escapeHtml(comparison)}</p>${badges.length ? `<div>${badges.map((badge) => `<span>${escapeHtml(badge)}</span>`).join("")}</div>` : ""}`;
}

/**
 * 物語の節目（墓標・継燭・結末・昇格・古傷・加入）を、結果の見出しの下に一枚の碑として刻む。
 * 節目のない遠征では出さない。
 */
function renderMilestone(record: CampaignState["expeditions"][number] | null): void {
  const milestone = record ? milestoneFor(record) : null;
  endMilestone.hidden = !milestone;
  if (!milestone) {
    endMilestone.innerHTML = "";
    return;
  }
  endMilestone.dataset.kind = milestone.kind;
  const truth = record?.truthRecovered ? ROLE_TRUTHS.find((entry) => entry.id === record.truthRecovered) : null;
  endMilestone.innerHTML = `
    <span class="milestone-seal" aria-hidden="true"><i class="milestone-wick"></i><i class="milestone-flame"></i><i class="milestone-smoke"></i></span>
    <p class="milestone-kicker">${escapeHtml(milestone.kicker)}</p>
    <strong class="milestone-title">${milestone.title}</strong>
    ${milestone.detail ? `<p class="milestone-detail">${milestone.detail}</p>` : ""}
    ${truth ? `<p class="milestone-truth"><i aria-hidden="true">◆</i>真相「${escapeHtml(truth.name)}」を持ち帰った</p>` : ""}
  `;
}

function milestoneFor(record: CampaignState["expeditions"][number]): { kind: string; kicker: string; title: string; detail: string } | null {
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

function veteranOutcomeLabel(record: CampaignState["expeditions"][number]): string {
  const veteranId = record.identity.veteranId ?? `veteran-${record.seed}-${record.identity.roleId}`;
  const veteran = campaign.roster.find((entry) => entry.id === veteranId);
  if (record.veteranOutcome === "keeper") return `${record.identity.name}は黒燭を継ぎ、次の周期の番人となる`;
  if (record.veteranOutcome === "fallen") return `${record.identity.name}は倒れ、F${record.floor}に墓標が残った`;
  if (record.veteranOutcome === "scarred") return `古傷を負って帰還${veteran ? `（位階${veteran.rank}）` : ""}`;
  if (record.veteranOutcome === "promoted") return `位階${veteran?.rank ?? ""}へ昇格`;
  if (record.veteranOutcome === "roster-full") return "遠征団が満員のため加入しなかった（古参は全員残っています）";
  if (record.veteranOutcome === "recruited") return "遠征団に加わった";
  return "";
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
  // 観戦途中に開いた灰灯院では、Enter で遠征を捨てないよう「観戦に戻る」を既定にする。
  const preferred = nextModal === candidateDialog
    ? (resumeButton.hidden ? departButton : resumeButton)
    : nextModal.querySelector<HTMLButtonElement>(".is-default:not(:disabled)")
      ?? nextModal.querySelector<HTMLButtonElement>(".primary-button:not(:disabled)")
      ?? nextModal.querySelector<HTMLButtonElement>("button:not(:disabled)");
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

function spriteStyle(asset: NonNullable<ReturnType<typeof assetForContent>>, size: number): string {
  const col = asset.sheet.index % asset.sheet.columns;
  const row = Math.floor(asset.sheet.index / asset.sheet.columns);
  return `background-image:url(${publicAssetPath(asset.path)});background-size:${asset.sheet.columns * size}px ${asset.sheet.rows * size}px;background-position:-${col * size}px -${row * size}px`;
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
