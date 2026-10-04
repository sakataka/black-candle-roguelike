import { bossTrialDefinition, journeyProgress } from "./game/core/journey";
import { candleRoadMarkup, growthMarkup } from "./ui/progress";
import "@fontsource/shippori-mincho-b1/500.css";
import "@fontsource/shippori-mincho-b1/600.css";
import "@fontsource/shippori-mincho-b1/800.css";
import "@fontsource/cormorant-garamond/500-italic.css";
import "@fontsource/cormorant-garamond/600.css";
import "./styles.css";
import { showTitle, type SaveSlotSummary, type TitleLedger } from "./ui/title";
import {
  activateSaveSlot,
  campaignStorageKey,
  consumeAutoEnter,
  createSaveSlot,
  deleteSaveSlot,
  loadSaveIndex,
  MAX_SAVE_SLOTS,
  readSlotCampaign,
  requestAutoEnter,
  tacticsStorageKey,
  touchSaveSlot,
} from "./ui/saves";
import { chooseAutoplayAction, describeAutoplayIntent, getAutoplayDebugState, resetAutoplayState, type AutoplayIntent } from "./game/ai/autoplay";
import { chooseDelverSpeech, createSpeechMemory } from "./game/ai/speech";
import { realtimeConfig, floorLawDescription } from "./game/content/realtime";
import { getGameConfig, loadBrowserGameConfig, runRules } from "./game/content/config";
import { assetForContent } from "./game/content/assets";
import { contentEntities, getContentName } from "./game/content/entities";
import {
  availableMissions,
  calculateShards,
  campaignRunModifiers,
  endingAvailable,
  missionShards,
  recommendedMission,
  ROLE_TRUTH_IDS,
  roleTruthFor,
  roleTruthLabel,
  shardForecast,
  truthRoleLabel,
  type MissionAvailability,
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
  directiveLabel,
  endingLabel,
  missionDefinition,
  missionProgress,
  normalizeCampaignState,
  recordCampaignResult,
  temperamentDescription,
  temperamentLabel,
} from "./game/core/autonomous";
import { suggestLanternAction, type WatcherSuggestion } from "./game/ai/watcher";
import { applyAction, biomeThemeName, canBorrowFlame, canPlaceLantern, canInvokeLantern, createInitialGame, lanternRiteLabel, normalizeTactics, observeGame, playableRoles } from "./game/core/game";
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

/** 墓標に刻む最期の一文。死因の分類から物語の言葉へ置き換える。 */
const FALL_EPITAPHS: Record<string, string> = {
  combat: "刃の下に倒れた。",
  rangedCombat: "闇から放たれた一矢に倒れた。",
  trap: "古い罠に命を奪われた。",
  bleeding: "流れる血を止められなかった。",
  venom: "毒が回りきった。",
  signalLoss: "灯芯が尽き、闇に呑まれた。",
};
/** 使用中の記録。記録ごとに遠征録と作戦の記憶を分けて保存する。 */
let saveIndex = loadSaveIndex();
const CAMPAIGN_STORAGE_KEY = campaignStorageKey(saveIndex.active);
const TACTICS_STORAGE_KEY = tacticsStorageKey(saveIndex.active);
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
      loadState: (snapshot: GameState) => void;
      resume: () => void;
    };
  }
}

const app = document.querySelector<HTMLDivElement>("#app");
document.documentElement.style.setProperty("--keyart", `url("${import.meta.env.BASE_URL}assets/art/title-keyart.jpg")`);
if (!app) throw new Error("Missing #app root");
app.inert = true;

// タイトルは設定やレンダラーの準備より先に出し、裏で支度の画面を組み立てる。
let deliverTitleLedger: (ledger: TitleLedger) => void = () => undefined;
let markGameReady: () => void = () => undefined;
const titleClosed = showTitle(
  new Promise<TitleLedger>((resolve) => { deliverTitleLedger = resolve; }),
  new Promise<void>((resolve) => { markGameReady = resolve; }),
  {
    select: (slotId) => {
      saveIndex = activateSaveSlot(saveIndex, slotId);
      requestAutoEnter();
      window.location.reload();
    },
    create: () => {
      saveIndex = createSaveSlot(saveIndex);
      requestAutoEnter();
      window.location.reload();
    },
    remove: (slotId) => {
      saveIndex = deleteSaveSlot(saveIndex, slotId);
      return saveSlotSummaries();
    },
  },
  consumeAutoEnter(),
);

app.innerHTML = `
  <main class="observer-shell" tabindex="-1">
    <header class="topbar">
      <div class="topbar-brand">
        <span id="brand-mark" class="brand-mark" aria-hidden="true"></span>
        <div><h1>黒燭の迷宮</h1><p>灰灯院・遠征観測室</p></div>
      </div>
      <div class="topbar-run">
        <div class="depth-chip"><span id="biome-kicker">地下1階</span><strong id="biome-title">黒石迷宮</strong></div>
        <div class="route-track" id="route-track" aria-label="道のり">
          <div class="route-track-label"><span>道のり</span><strong id="route-next">-</strong></div>
          <ol id="route-nodes" class="route-nodes"></ol>
        </div>
        <div id="live-progress" class="live-progress" aria-label="今回の目標と鍛錬"></div>
        <div class="shard-forecast" id="shard-forecast" title="今帰還できた場合と、ここで倒れた場合に灰灯院へ持ち帰る灯片。">
          <span>持ち帰る灯片</span>
          <strong><b id="forecast-return">+0</b><small>帰還なら</small></strong>
          <strong class="is-loss"><b id="forecast-lost">+0</b><small>倒れれば</small></strong>
        </div>
        <div class="turn-meter" id="turn-meter" title="灯芯が尽きると黒燭との接続が切れ、探索者は未帰還になる。">
          <div class="turn-meter-label"><span id="turn-meter-label">灯芯</span><strong id="run-turn">残り0手</strong></div>
          <div class="turn-meter-track"><i id="turn-meter-fill"></i></div>
        </div>
      </div>
      <div class="topbar-controls">
        <div class="speed-selector" role="group" aria-label="観測速度">
          <span class="live-indicator" title="遠征は選択中も進みます">進行中</span>
          <button type="button" data-speed="0.5" aria-pressed="false">0.5×</button>
          <button type="button" data-speed="1" class="is-active" aria-pressed="true">1×</button>
          <button type="button" data-speed="2" aria-pressed="false">2×</button>
          <button type="button" data-speed="3" aria-pressed="false">3×</button>
        </div>
        <button id="new-expedition" class="secondary-button" type="button" title="遠征を終えて灰灯院へ">灰灯院</button>
      </div>
    </header>

    <section class="stage" aria-label="黒燭越しの迷宮">
      <div class="map-stage" id="map-stage">
        <div id="pixi-root" class="pixi-root"></div>
        <div class="boss-health" id="boss-health" aria-label="視界内の守り手の命火" hidden></div>
        <div class="battle-forecast" id="battle-forecast" aria-label="見えている攻撃の予告"></div>
        <p class="delver-voice sr-only" id="delver-voice" aria-live="polite"></p>
        <button type="button" id="lantern-call" class="lantern-call" hidden></button>
        <p id="lantern-toast" class="lantern-toast" aria-live="polite" hidden></p>
        <div id="floor-card" class="floor-card" aria-hidden="true"><span class="floor-card-no"></span><strong class="floor-card-name"></strong><i></i></div>
      </div>
      <section class="lantern-dock" aria-label="灯守の介入">
        <div class="lantern-embers">
          <div class="lantern-embers-head"><span>灯火</span><strong id="lantern-count">0/0</strong></div>
          <div id="lantern-pips" class="lantern-pips" aria-live="polite"></div>
          <small id="lantern-hint">危機に灯を捧げると、探索者の手番を使わず介入できます。</small>
        </div>
        <div id="lantern-rites" class="lantern-rites"></div>
        <div class="extra-rites">
          <button type="button" id="place-lantern" class="secondary-button"><span class="extra-rite-icon" aria-hidden="true"></span><strong>置灯</strong><kbd>T</kbd><small>退路を照らし、敵を誘う</small></button>
          <button type="button" id="borrow-flame" class="secondary-button"><span class="extra-rite-icon" aria-hidden="true"></span><strong>借灯</strong><kbd>F</kbd><small>灯火が尽きた時、未来から借りる</small></button>
        </div>
        <p class="expedition-note" id="expedition-note"></p>
        <p class="expedition-note floor-law" id="floor-law"></p>
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
      <section class="panel expedition-card" aria-label="今回の目標">
        <div class="mission-line">
          <span class="panel-label">今回の目標</span>
          <em id="run-mission-state">進行中</em>
        </div>
        <strong id="run-mission" class="mission-name">-</strong>
        <p id="run-mission-target" class="mission-target">-</p>
        <div class="mission-progress-row"><div class="mission-track"><i id="mission-fill"></i></div><em id="run-mission-progress">-</em></div>
        <p id="run-mission-reward" class="mission-reward-line">-</p>
        <div class="landmark">
          <span class="panel-label">次の節目</span>
          <strong id="landmark-title">-</strong>
          <p id="landmark-detail">-</p>
        </div>
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
      <section class="panel log-card" aria-label="道中記">
        <div class="panel-heading"><h2>道中記</h2><span>新しい順</span></div>
        <ol id="message-list" class="message-list"></ol>
      </section>
    </div>
  </main>

  <section id="candidate-dialog" class="modal-layer prepare-layer" aria-live="polite">
    <div class="prepare-screen" role="dialog" aria-modal="true" aria-labelledby="candidate-title">
      <header class="prepare-header">
        <div>
          <p class="eyebrow">灰灯院 · 遠征の支度 · <span id="save-slot-name"></span></p>
          <h2 id="candidate-title">誰を黒燭の迷宮へ送るか</h2>
        </div>
        <div class="prepare-header-actions">
          <div class="shard-balance" title="遠征から持ち帰る。到達・守り手・任務・真相・生還で増え、施設の強化と療房に使う。"><i id="shard-icon" class="shard-icon" aria-hidden="true"></i><span>灯片</span><strong id="institute-shards">0</strong></div>
          <button id="resume-run" class="secondary-button" type="button" hidden>観戦に戻る <kbd>Esc</kbd></button>
          <button id="switch-save" class="secondary-button" type="button" title="タイトルへ戻り、別の記録を選ぶか新しい記録を始める">記録を切り替える</button>
        </div>
      </header>
      <section id="next-goal" class="progress-overview" aria-label="探索全体の進捗"></section>
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
            <div class="step-heading"><span class="step-no" aria-hidden="true">II</span><h3 id="step-mission">今回の目標</h3><small>探索者は任務に沿って帰還か続行かを決める。報酬は生きて帰った時に受け取る。</small></div>
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
          <details class="side-section progress-conditions">
            <summary>章の達成条件 <span id="roadmap-count">0/5</span></summary>
            <ol id="roadmap-list" class="roadmap-list"></ol>
          </details>
          <section class="side-section">
            <div class="side-heading"><h3>遠征録</h3><span id="archive-count">0件</span></div>
            <div id="campaign-summary" class="campaign-summary"></div>
            <ol id="archive-list" class="archive-list"></ol>
          </section>
          <section class="side-section">
            <div id="institute-cycle" class="institute-cycle"></div>
          </section>
        </aside>
      </div>
      <footer class="prepare-footer">
        <div id="depart-summary" class="depart-summary"></div>
        <button id="depart-button" class="primary-button" type="button">出発する</button>
      </footer>
    </div>
  </section>

  <section id="decision-dialog" class="realtime-choice" hidden aria-live="polite">
    <div class="decision-panel" role="group" aria-labelledby="decision-title">
      <p class="eyebrow" id="decision-kicker">黒燭からの問い</p>
      <h2 id="decision-title">灯守の判断</h2>
      <p id="decision-body" class="modal-lead"></p>
      <div id="decision-stakes" class="decision-stakes" hidden></div>
      <div id="decision-options" class="decision-options"></div>
      <details class="decision-details" id="decision-details">
        <summary>作戦・装備・長期の先読み（遠征は進み続けます）</summary>
      <div id="decision-status" class="decision-status" aria-label="探索者の状態"></div>
      <section id="decision-tactics" class="decision-tactics" aria-label="作戦の組み替え" hidden>
        <div class="step-heading"><h3>作戦を組み替える</h3><em id="decision-tactic-count">0/2</em><small>組み替えると各案の先読みが更新される。</small></div>
        <div id="decision-tactic-list" class="tactic-list is-compact"></div>
      </section>
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
      <div class="result-section-heading"><h3>持ち帰った灯片</h3><small id="shard-note"></small></div>
      <div id="shard-breakdown" class="score-breakdown"></div>
      <section id="end-roadmap" class="end-roadmap" aria-label="黒燭への道"></section>
      <section id="run-insights" class="run-insights" aria-label="遠征の軌跡"></section>
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
const lanternDock = requireElement<HTMLElement>(".lantern-dock");
new ResizeObserver(() => document.documentElement.style.setProperty("--lantern-dock-height", `${lanternDock.getBoundingClientRect().height}px`)).observe(lanternDock);
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
const shardBreakdown = requireElement<HTMLDivElement>("#shard-breakdown");
const endRoadmap = requireElement<HTMLElement>("#end-roadmap");
const decisionHistory = requireElement<HTMLDivElement>("#decision-history");
const runInsightsPanel = requireElement<HTMLElement>("#run-insights");
const endMilestone = requireElement<HTMLElement>("#end-milestone");

let campaign = loadCampaign();
deliverTitleLedger({
  cycle: campaign.cycle.number,
  expeditions: campaign.expeditions.length,
  highestFloor: campaignProgress(campaign).highestFloor,
  shards: campaign.shards,
  slotName: activeSlotName(),
  slots: saveSlotSummaries(),
  maxSlots: MAX_SAVE_SLOTS,
});
let candidateSeed = nextSeed();
let selectedRoleId = playableRoles()[0].id;
let selectedIdentity = createRunIdentity(candidateSeed, selectedRoleId);
let selectedMissionId: MissionId = "truth-return";
let state = createInitialGame(candidateSeed, selectedRoleId, { identity: selectedIdentity, knownRoleTruths: campaign.roleTruths, missionId: selectedMissionId });
let runLog = createRunLog(state.seed, selectedRoleId, {}, selectedIdentity);
let currentReview: RunReview | null = null;
let autoplayTimer: number | null = null;
let speed = 1;
let archivedRunId: string | null = null;
let scheduledPace: PaceKind = "exploration";
let pendingVisualEvents: VisualEvent[] = [];
let pendingIntent: AutoplayIntent | null = null;
let speechMemory = createSpeechMemory();
let decisionRenderKey = "";
let lookahead: { decisionKey: string; workers: Worker[]; results: Map<string, LookaheadSummary>; failedOptions: Set<string> } | null = null;
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
/** 結果画面で「黒燭への道」の進みを比べるため、記録直前の灰灯院を覚えておく。 */
let campaignBeforeRun: CampaignState | null = null;
/** 支度中に任務を自分で選んだか。選んでいなければ探索者に合わせて推奨へ戻す。 */
let missionPinned = false;
let lanternToastTimer: number | null = null;
let heldSuggestion: { suggestion: WatcherSuggestion; until: number } | null = null;

installEvents();
installDebugBridge();
renderCandidateSelection();
render();
await renderer.mount(pixiRoot);
syncViewport();
new ResizeObserver(syncViewport).observe(mapStage);
document.querySelector(".stage")!.append(decisionDialog);
applySprite(requireElement<HTMLElement>("#place-lantern .extra-rite-icon"), assetForContent("rite.place"), 28);
applySprite(requireElement<HTMLElement>("#borrow-flame .extra-rite-icon"), assetForContent("rite.borrow"), 28);
applySprite(requireElement<HTMLElement>("#brand-mark"), assetForContent("ui.heat"), 30);
render();
markGameReady();
void titleClosed.then(() => {
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
  requireElement<HTMLButtonElement>("#place-lantern").addEventListener("click", () => invokeExtraRite("placeLantern"));
  requireElement<HTMLButtonElement>("#borrow-flame").addEventListener("click", () => invokeExtraRite("borrowFlame"));
  requireElement<HTMLButtonElement>("#lantern-call").addEventListener("click", (event) => {
    const action = (event.currentTarget as HTMLElement).dataset.action;
    if (action === "placeLantern" || action === "borrowFlame") invokeExtraRite(action);
    else if (action && lanternRiteOrder.includes(action as LanternRiteId)) invokeLanternRite(action as LanternRiteId);
  });
  requireElement<HTMLDetailsElement>("#decision-details").addEventListener("toggle", () => render());
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
  requireElement<HTMLButtonElement>("#switch-save").addEventListener("click", () => {
    // 遠征の途中では切り替えない。タイトルへ戻り、そこで記録を選ぶ。
    if (runActive && state.status === "playing") return;
    window.location.reload();
  });
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
    missionPinned = true;
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
    if (state.status === "playing" && autoplayTimer === null) scheduleAutoplay("exploration");
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
        if (!(event.target instanceof HTMLElement) || !event.target.closest("button, summary, input, select, textarea")) event.preventDefault();
        return;
      }
      if (event.repeat) return;
      if (event.key.toLowerCase() === "t") { invokeExtraRite("placeLantern"); return; }
      if (event.key.toLowerCase() === "f") { invokeExtraRite("borrowFlame"); return; }
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
  if (runActive && state.status === "playing") return;
  stopAutoplay();
  endDialog.hidden = true;
  decisionDialog.hidden = true;
  // 同じ迷宮を二度引かないよう、今の遠征と同じseedなら候補を引き直す。観戦途中で開閉しても志願者は変わらない。
  if (candidateSeed === state.seed) {
    candidateSeed = nextSeed();
    selectedDelver = null;
    missionPinned = false;
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
  scheduleAutoplay(scheduledPace);
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
  resetAutoplayState();
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
  speechMemory = createSpeechMemory();
  decisionRenderKey = "";
  render();
  scheduleAutoplay("exploration");
}

function renderCandidateSelection(): void {
  // 再描画でボタンが作り直されてもキーボード操作の位置を失わないよう、フォーカス先を覚えて戻す。
  const focusKey = focusedDataKey();
  const delver = resolveSelectedDelver();
  renderMissionOptions(delver?.roleId ?? playableRoles()[0].id);
  const slots = campaignTacticSlots(campaign);
  const unlocked = new Set(unlockedTacticIds(campaign));
  selectedTactics = normalizeTactics(selectedTactics.filter((id) => unlocked.has(id)), slots);
  renderTacticPicker(tacticList, selectedTactics, slots);
  setText("#tactic-count", `${selectedTactics.length}/${slots}`);
  renderInstitute();
  renderCycle();
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
  renderRoadmap();
  renderArchive();
  restoreFocus(candidateDialog, focusKey);
}

function missionContext(roleId: string): MissionAvailability {
  return { roleId, knownRoleTruths: campaign.roleTruths, graveCount: pendingGraves(campaign).length };
}

/** 任務の候補。探索者と「黒燭への道」に合わせて推奨を示し、報酬の灯片を明記する。 */
function renderMissionOptions(roleId: string): void {
  const context = missionContext(roleId);
  const missions = availableMissions(context);
  const recommended = recommendedMission(context);
  if (!missionPinned || !missions.some((mission) => mission.id === selectedMissionId)) selectedMissionId = recommended;
  const truth = roleTruthFor(roleId);
  const embers = realtimeConfig().missions.rewardEmbers;
  missionList.replaceChildren(...missions.map((mission) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.missionId = mission.id;
    const selected = mission.id === selectedMissionId;
    button.className = `mission-option${selected ? " is-selected" : ""}${mission.id === recommended ? " is-recommended" : ""}`;
    button.setAttribute("aria-pressed", String(selected));
    const note = mission.id === "truth-return"
      ? campaign.roleTruths.includes(truth) ? `この職業の真相「${roleTruthLabel(truth)}」は記録済み` : `この職業なら真相「${roleTruthLabel(truth)}」を記録できる（+灯片${getGameConfig().campaign.shards.newTruth}）`
      : mission.id === "memorial" ? `墓標: ${pendingGraves(campaign).map((grave) => `${grave.name}（第${grave.floor}階）`).join("・")}`
        : mission.id === "black-core" ? "第六階の帰還路を越えると、番人を倒すまで帰れない" : "";
    button.innerHTML = `${mission.id === recommended ? '<span class="mission-badge">推奨</span>' : ""}<strong>${escapeHtml(mission.label)}</strong><small>${escapeHtml(mission.description)}</small><em>${escapeHtml(mission.targetLabel)}</em>${note ? `<small class="mission-note">${escapeHtml(note)}</small>` : ""}<span class="mission-reward">生還で灯片+${missionShards(mission.id)} · 達成時 灯火+${embers}</span>`;
    return button;
  }));
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
  const foundation = journeyProgress(campaign);
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
    ${campaign.roleTruths.includes(roleTruthFor(options.roleId)) ? "" : `<span class="truth-tag" title="第六階の守り手を倒して生きて帰れば、真相「${escapeHtml(roleTruthLabel(roleTruthFor(options.roleId)))}」を記録できる">◇ 真相を持ち帰れる</span>`}
    ${options.extra}
    <span class="mini-stats"><span>HP <b>${options.stats.hp + foundation.maxHp}</b></span><span>攻撃 <b>${options.stats.attack + foundation.attack}</b></span><span>防御 <b>${options.stats.defense}</b></span></span>
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
  const journey = journeyProgress(campaign);
  const abandoning = runActive && state.status === "playing";
  summary.innerHTML = `
    <span class="depart-portrait" aria-hidden="true"></span>
    <span class="depart-who"><strong>${escapeHtml(delver.name)}${delver.veteran ? ` <span class="rank-stars">${"★".repeat(delver.veteran.rank)}</span>` : ""}</strong><small>${escapeHtml(delver.roleName)} · ${escapeHtml(delver.temperament)}</small></span>
    <span class="depart-plan">
      <span>目標 <b>${escapeHtml(missionDefinition(selectedMissionId).label)}</b><small>生還で灯片+${missionShards(selectedMissionId)}</small></span>
      <span>鍛錬 <b>${journey.rank} · 命火+${journey.maxHp} / 攻撃+${journey.attack}</b></span>
      ${journey.trial ? `<span class="trial-plan">決戦 <b>${escapeHtml(journey.nextTrial!.label)}</b><small>第六階・第十層の守り手が覚醒</small></span>` : ""}
      <span>作戦 <b>${tactics.length ? escapeHtml(tactics.join("・")) : "なし"}</b></span>
      ${campaign.lessons?.length ? `<span>継承 <b>${campaign.lessons.map((l) => l === "ranged" ? "射線と遮蔽" : l === "care" ? "早めの回復" : "罠への警戒").join("・")}</b></span>` : ""}
      ${campaign.flameDebt ? `<span>借灯の返済 <b>灯火${campaign.flameDebt}</b></span>` : ""}
      ${heat > 0 ? `<span>燭階 <b>${heat}</b></span>` : ""}
    </span>
    ${abandoning ? `<span class="depart-note is-warning">観戦中の遠征（${escapeHtml(state.runIdentity.name)}・地下${state.floor}階）は記録されずに終わる。</span>` : ""}
  `;
  applySprite(summary.querySelector<HTMLElement>(".depart-portrait") as HTMLElement, assetForContent(delver.roleId), 44);
  departButton.textContent = abandoning ? "遠征を切り替えて出発" : `${delver.name}を送り出す`;
  resumeButton.hidden = !abandoning;
  requireElement<HTMLButtonElement>("#switch-save").hidden = abandoning;
  setText("#save-slot-name", activeSlotName());
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
  const observation = observeGame(state);
  const action = chooseAutoplayAction(observation);
  pendingIntent = chooseDelverSpeech(observation, action, describeAutoplayIntent(observation, action), speechMemory, performance.now());
  if (pendingIntent) setText("#delver-voice", `${state.runIdentity.name}「${pendingIntent.text}」`);
  const logEntry = applyLoggedAction(action, "ai", getAutoplayDebugState(observation));
  const pace = paceKindFor(action, state, logEntry?.messageDelta ?? []);
  scheduledPace = pace;
  render();
  if (state.status === "playing") scheduleAutoplay(pace);
}

function scheduleAutoplay(pace: PaceKind): void {
  stopAutoplay();
  scheduledPace = pace;
  if (state.status !== "playing" || !candidateDialog.hidden) return;
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
  campaignBeforeRun = campaign;
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
  setText("#run-directive", directiveLabel(state.directive));
  renderRunGoal(observation);
  setText("#run-revelations", `${state.revelationsRemaining}/${config.autonomous.revelationsPerRun}`);
  const rules = runRules(state.modifiers);
  setText("#run-turn", `残り${Math.max(0, rules.runTurnLimit - state.runTurn)}手`);
  setText("#biome-kicker", `地下${state.floor}階 / ${config.rules.maxFloor}${state.status === "playing" ? "" : ` · ${statusLabel(state.status)}`}`);
  const trial = bossTrialDefinition(state.modifiers.bossTrial);
  setText("#biome-title", `${biomeThemeName(state.biome)}${trial && state.floor >= 6 && [6, 10].includes(state.floor) ? ` · ${trial.label}` : ""}`);
  document.documentElement.dataset.biome = state.biome;
  renderShardForecast();
  const routeWarning = state.runTurn >= rules.runTurnWarning;
  setText("#turn-meter-label", routeWarning ? "灯芯が細い" : "灯芯");
  requireElement<HTMLElement>("#turn-meter").classList.toggle("is-warning", routeWarning);
  const meter = requireElement<HTMLElement>("#turn-meter-fill");
  meter.style.width = `${Math.max(0, 100 - state.runTurn / rules.runTurnLimit * 100)}%`;

  setText("#explored-ratio", `${Math.round(observation.exploration.exploredTileRatio * 100)}%`);
  setText("#objective-title", objectiveLabel(observation.exploration.objective));
  setText("#objective-detail", objectiveDetail(observation));
  renderVitals(observation);
  renderLantern(observation);
  renderExpeditionDynamics(observation);
  requireElement<HTMLButtonElement>("#new-expedition").disabled = runActive && state.status === "playing";

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

/** 今帰還した場合と、ここで倒れた場合の灯片。終わった遠征では実際に持ち帰った量を出す。 */
function renderShardForecast(): void {
  const box = requireElement<HTMLElement>("#shard-forecast");
  const ended = state.status !== "playing";
  box.classList.toggle("is-ended", ended);
  if (ended) {
    setText("#forecast-return", `+${calculateShards(state).total}`);
    box.querySelector("strong small")!.textContent = state.status === "won" || state.status === "returned" ? "持ち帰った" : "残った";
    return;
  }
  const forecast = shardForecast(state);
  box.querySelector("strong small")!.textContent = "帰還なら";
  bumpNumber(requireElement<HTMLElement>("#forecast-return"), forecast.ifReturned);
  bumpNumber(requireElement<HTMLElement>("#forecast-lost"), forecast.ifLost);
}

/** 増えた時だけ数字を一瞬光らせる。 */
function bumpNumber(element: HTMLElement, value: number): void {
  const text = `+${value}`;
  if (element.textContent === text) return;
  const rising = Number(element.textContent?.replace("+", "") ?? 0) < value;
  element.textContent = text;
  if (!rising || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  element.classList.remove("is-rising");
  void element.offsetWidth;
  element.classList.add("is-rising");
}

/** 今回の目標（任務）、上部の道のり、次の節目をまとめて描く。 */
function renderRunGoal(observation: ReturnType<typeof observeGame>): void {
  const mission = missionDefinition(state.story.missionId);
  const progress = missionProgress(state);
  const survived = state.status === "won" || state.status === "returned";
  const playing = state.status === "playing";
  const missionState = progress.completed
    ? playing ? "条件達成" : survived ? "達成" : "未達（倒れた）"
    : progress.missed ? "期限切れ" : playing ? "進行中" : "未達";
  setText("#run-mission", mission.label);
  setText("#run-mission-target", mission.targetLabel);
  setText("#run-mission-progress", progress.label);
  const stateLabel = requireElement<HTMLElement>("#run-mission-state");
  stateLabel.textContent = missionState;
  stateLabel.dataset.tone = progress.completed && (playing || survived) ? "done" : progress.missed || !playing ? "missed" : "active";
  const missionFill = requireElement<HTMLElement>("#mission-fill");
  missionFill.style.width = `${progress.completed ? 100 : Math.min(100, progress.current / Math.max(1, progress.target) * 100)}%`;
  missionFill.dataset.tone = progress.completed ? "done" : progress.missed ? "missed" : "active";
  const journey = journeyProgress(campaign);
  const live = requireElement<HTMLElement>("#live-progress");
  const signature = `${mission.id}:${progress.label}:${progress.current}:${progress.completed}:${missionState}:${journey.rank}:${journey.shardsToNextRank}`;
  if (live.dataset.state !== signature) {
    live.dataset.state = signature;
    // 第十階へ到達しても番人を倒すまでは、最後の印を灯さない。
    const marks = progress.completed ? progress.target : mission.id === "black-core" ? Math.min(progress.current, progress.target - 1) : progress.current;
    live.innerHTML = `<div class="live-mission"><span>今回 <strong>${escapeHtml(mission.label)}</strong></span><div class="mission-beads" role="img" aria-label="${escapeHtml(progress.label)} · ${escapeHtml(missionState)}">${Array.from({ length: progress.target }, (_, i) => `<i class="${i < marks ? "is-filled" : ""}"></i>`).join("")}<b class="${progress.completed && survived ? "is-filled" : ""}" title="${survived && progress.completed ? "任務達成・生還済み" : "生還して確定"}">${progress.completed && survived ? "◆" : "◇"}</b></div><small>${progress.completed && playing ? "条件達成 → 生還で確定" : missionState}</small></div><div class="live-power"><span>鍛錬 <b>Lv${journey.rank}</b></span><small>${journey.shardsToNextRank ? `次まで ${journey.shardsToNextRank} 灯片` : "最大"}</small></div>`;
  }
  const embers = realtimeConfig().missions.rewardEmbers;
  setText("#run-mission-reward", progress.completed && playing
    ? `生きて帰れば灯片+${missionShards(mission.id)}（灯火+${embers}は受け取り済み）`
    : `報酬: 生還で灯片+${missionShards(mission.id)} · 条件を満たした時に灯火+${embers}`);
  const landmark = landmarkFor(observation);
  setText("#landmark-title", landmark.title);
  setText("#landmark-detail", landmark.detail);
  setText("#route-next", landmark.short);
  renderRouteNodes();
}

function missionTargetFloors(): number[] {
  const missionId = state.story.missionId;
  if (missionId === "truth-return" || missionId === "swift-route") return [6];
  if (missionId === "black-core") return [getGameConfig().rules.maxFloor];
  if (missionId === "memorial") return state.modifiers.graves?.map((grave) => grave.floor) ?? [];
  return [];
}

/** 上部の十階の道のり。帰還路の階・第十層・任務の目標階に印をつける。 */
function renderRouteNodes(): void {
  const maxFloor = getGameConfig().rules.maxFloor;
  const targets = new Set(missionTargetFloors());
  const list = requireElement<HTMLOListElement>("#route-nodes");
  const signature = `${state.floor}:${state.story.maxFloorReached}:${[...targets].join(",")}:${state.status}`;
  if (list.dataset.signature === signature) return;
  list.dataset.signature = signature;
  list.replaceChildren(...Array.from({ length: maxFloor }, (_, index) => {
    const floor = index + 1;
    const item = document.createElement("li");
    const kind = floor === maxFloor ? "core" : floor === 3 || floor === 6 ? "gate" : "floor";
    item.className = [
      `is-${kind}`,
      floor <= state.story.maxFloorReached ? "is-reached" : "",
      floor === state.floor ? "is-current" : "",
      targets.has(floor) ? "is-target" : "",
    ].filter(Boolean).join(" ");
    const note = kind === "core" ? "黒燭の番人" : kind === "gate" ? "守り手・帰還路" : "";
    item.title = `第${floor}階${note ? ` · ${note}` : ""}${targets.has(floor) ? " · 任務の目標" : ""}`;
    item.innerHTML = kind === "floor" ? "<i></i>" : `<i></i><span>${floor}</span>`;
    return item;
  }));
}

/** 次に何が起きるか。帰還路の有無と、その先で失うものを先に見せる。 */
function landmarkFor(observation: ReturnType<typeof observeGame>): { title: string; detail: string; short: string } {
  const maxFloor = getGameConfig().rules.maxFloor;
  if (state.status !== "playing") {
    return { title: statusLabel(state.status), detail: "遠征は終わった。結果は灰灯院の遠征録へ残る。", short: statusLabel(state.status) };
  }
  if (state.pendingDecision?.kind === "checkpoint") {
    return { title: "帰還路が開いている", detail: `伝言で帰還か続行かを選べる。あと${state.pendingDecision.remainingTurns ?? 0}手で本人が任務に沿って決める。`, short: "帰還路が開いている" };
  }
  const decided = (floor: number) => state.story.decisions.some((decision) => decision.id === `checkpoint-${floor}`);
  if (!decided(3) && state.floor <= 3) {
    return {
      title: "第三階の守り手",
      detail: state.floor === 3 && observation.bossAlive ? "この階の守り手を倒すと、最初の帰還路が開く。" : "倒すと最初の帰還路が開き、ここまでの戦果を確定して帰れる。",
      short: "第三階 · 最初の帰還路",
    };
  }
  if (!decided(6) && state.floor <= 6) {
    return {
      title: bossTrialDefinition(state.modifiers.bossTrial) ? "第六階 · 覚醒した中ボス" : "第六階の守り手",
      detail: "倒すと職業の真相が現れ、最後の帰還路が開く。その先は第十層まで帰れない。",
      short: "第六階 · 真相と最後の帰還路",
    };
  }
  const ending = endingAvailable(state);
  return {
    title: bossTrialDefinition(state.modifiers.bossTrial) ? `第${maxFloor}層 · 覚醒した大ボス` : `第${maxFloor}層の番人`,
    detail: `もう帰還路はない。番人を倒して踏破するまで帰れない。${ending ? "真相が三つ揃っている。倒せば黒燭の行方を決められる。" : ""}`,
    short: `第${maxFloor}層 · 帰還路なし`,
  };
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
  const suggestion = steadySuggestion(suggestLanternAction(observation));
  const suggested = suggestion?.action.type === "invokeLantern" ? suggestion.action.rite : null;
  const full = lantern.embers >= lantern.maxEmbers;
  pips.classList.toggle("is-full", full && state.status === "playing");
  const overflowed = lantern.overflowed ?? 0;
  setText("#lantern-hint", state.status !== "playing"
    ? "遠征は終わった。灯は静かに燃えている。"
    : suggestion?.urgency === "crisis" ? `${suggestion.reason}。今こそ灯を。`
      : full ? `灯火が満ちている。これ以上は溢れて消える${overflowed ? `（溢れた灯火 ${overflowed}）` : ""}。`
        : "危機に灯を捧げると、探索者の手番を使わず介入できます。");
  renderLanternCall(suggestion);
  requireElement<HTMLButtonElement>("#place-lantern").classList.toggle("is-suggested", suggestion?.action.type === "placeLantern");
  requireElement<HTMLButtonElement>("#borrow-flame").classList.toggle("is-suggested", suggestion?.action.type === "borrowFlame");
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

/**
 * 呼びかけは敵が一歩動くたびに出たり消えたりしないよう、少しの間だけ保つ。
 * 保っている間も、その介入がもう効かなくなったら消す。
 */
function steadySuggestion(fresh: WatcherSuggestion | null): WatcherSuggestion | null {
  const now = performance.now();
  if (fresh) {
    heldSuggestion = { suggestion: fresh, until: now + 1600 };
    return fresh;
  }
  const held = heldSuggestion;
  if (held && now < held.until && state.status === "playing" && actionStillPossible(held.suggestion.action)) return held.suggestion;
  heldSuggestion = null;
  return null;
}

function actionStillPossible(action: WatcherSuggestion["action"]): boolean {
  if (action.type === "invokeLantern") return canInvokeLantern(state, action.rite);
  if (action.type === "placeLantern") return canPlaceLantern(state);
  if (action.type === "borrowFlame") return canBorrowFlame(state);
  return false;
}

/** 地図の上の呼びかけ。押すとそのまま灯を捧げる。 */
function renderLanternCall(suggestion: WatcherSuggestion | null): void {
  const call = requireElement<HTMLButtonElement>("#lantern-call");
  if (!suggestion || state.status !== "playing" || !runActive) {
    call.hidden = true;
    delete call.dataset.key;
    return;
  }
  const action = suggestion.action;
  const label = action.type === "invokeLantern" ? lanternRiteLabel(action.rite) : action.type === "placeLantern" ? "置灯" : "借灯";
  const key = action.type === "invokeLantern" ? lanternRiteKeys[action.rite] : action.type === "placeLantern" ? "T" : "F";
  const cost = action.type === "invokeLantern" ? getGameConfig().lantern.rites[action.rite].cost : action.type === "placeLantern" ? realtimeConfig().light.cost : 0;
  const signature = `${suggestion.urgency}:${label}:${suggestion.reason}`;
  call.hidden = false;
  call.dataset.urgency = suggestion.urgency;
  if (call.dataset.key === signature) return;
  call.dataset.key = signature;
  call.dataset.action = action.type === "invokeLantern" ? action.rite : action.type;
  const lead = suggestion.urgency === "crisis" ? `${escapeHtml(state.runIdentity.name)}が灯を求めている` : "灯の使いどき";
  call.innerHTML = `<span class="lantern-call-lead">${lead}</span><span class="lantern-call-reason">${escapeHtml(suggestion.reason)}</span><span class="lantern-call-act"><kbd>${key}</kbd>${label}${cost ? `<em>灯${cost}</em>` : ""}</span>`;
}

/** 灯を捧げた直後、効いたことを地図の上に短く残す。 */
function showLanternToast(): void {
  // 介入は手番を進めないので、直後の最新ログがそのまま介入の結果になる。
  const entry = state.messages.at(-1);
  if (!entry) return;
  const toast = requireElement<HTMLElement>("#lantern-toast");
  toast.textContent = entry.text;
  toast.hidden = false;
  toast.classList.remove("is-shown");
  void toast.offsetWidth;
  toast.classList.add("is-shown");
  if (lanternToastTimer !== null) window.clearTimeout(lanternToastTimer);
  lanternToastTimer = window.setTimeout(() => { toast.hidden = true; }, 2600);
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
  heldSuggestion = null;
  render();
  showLanternToast();
}

function invokeExtraRite(type: "placeLantern" | "borrowFlame"): void {
  if (type === "placeLantern" ? !canPlaceLantern(state) : !canBorrowFlame(state)) return;
  applyLoggedAction({ type }, "player");
  heldSuggestion = null;
  render();
  showLanternToast();
}

function renderExpeditionDynamics(observation: ReturnType<typeof observeGame>): void {
  const dynamics = observation.expedition;
  const visibleBoss = observation.visibleEntities.find((e) => e.kind === "monster" && contentEntities[e.contentId]?.tier === "boss");
  const bossHealth = requireElement<HTMLElement>("#boss-health");
  bossHealth.hidden = !visibleBoss?.stats;
  if (visibleBoss?.stats) {
    const ratio = Math.max(0, visibleBoss.stats.hp / visibleBoss.stats.maxHp);
    const trial = bossTrialDefinition(state.modifiers.bossTrial);
    bossHealth.innerHTML = `<span>${trial && state.floor >= 6 ? `覚醒 · ${escapeHtml(trial.label)}` : "守り手"}</span><strong>${escapeHtml(getContentName(visibleBoss.contentId))}</strong><b>${visibleBoss.stats.hp} / ${visibleBoss.stats.maxHp}</b><div><i style="width:${ratio * 100}%"></i></div>`;
  }
  const threats = observation.visibleEntities.filter((e) => e.telegraph);
  const openings = observation.visibleEntities.filter((e) => (e.recoveryTurns ?? 0) > 0);
  const forecast = requireElement<HTMLElement>("#battle-forecast");
  forecast.textContent = threats.length
    ? threats.slice(0, 2).map((e) => `${getContentName(e.contentId)} · ${e.telegraph!.remaining}手後に${e.telegraph!.kind === "shot" ? "斉射" : e.telegraph!.kind === "sweep" ? "薙ぎ払い" : "呪印"}`).join(" ／ ")
    : openings.length ? `${getContentName(openings[0].contentId)}に隙 · あと${openings[0].recoveryTurns}手` : "";
  forecast.hidden = !forecast.textContent;
  const place = requireElement<HTMLButtonElement>("#place-lantern");
  place.disabled = !canPlaceLantern(state);
  place.title = `灯火${realtimeConfig().light.cost}。退路を${realtimeConfig().light.duration}手照らし、獣と亡者を引き寄せる。`;
  const borrow = requireElement<HTMLButtonElement>("#borrow-flame");
  borrow.disabled = !canBorrowFlame(state);
  borrow.title = `一遠征一回。命火${realtimeConfig().loan.healPercent}%回復・護り${realtimeConfig().loan.guardedTurns}手・灯火+${realtimeConfig().loan.embers}。次に得る灯火${realtimeConfig().loan.debt}つを返す。未返済分は次の遠征へ。`;
  setText("#expedition-note", dynamics?.debt ? `借灯の返済：次に得る灯火${dynamics.debt}つ` : "");
  setText("#floor-law", floorLawDescription(state.biome));
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

/** 「黒燭への道」。大目標を章で並べ、次の章だけ詳しく書く。 */
function renderRoadmap(): void {
  const progress = campaignProgress(campaign);
  const done = progress.roadmap.filter((chapter) => chapter.done).length;
  setText("#roadmap-count", `${done}/${progress.roadmap.length}`);
  requireElement<HTMLOListElement>("#roadmap-list").innerHTML = roadmapMarkup(progress.roadmap, progress.nextChapter?.id ?? null, new Set());
  const banner = requireElement<HTMLElement>("#next-goal");
  banner.innerHTML = `${candleRoadMarkup(campaign)}${growthMarkup(campaign)}
    <details class="progress-help"><summary>進め方</summary><p>${escapeHtml(progress.nextChapter?.hint ?? "結末を選ぶと新しい周期へ。真相と鍛錬は引き継がれる。")}</p><p>帰還・敗北で得た灯片も鍛錬に積み重なる。第十層を踏破すると覚醒への印が灯る。</p></details>`;
}

function roadmapMarkup(chapters: ReturnType<typeof campaignProgress>["roadmap"], nextId: string | null, fresh: Set<string>, freshTruths: RoleTruthId[] = []): string {
  return chapters.map((chapter, index) => {
    const truths = chapter.id === "three-truths"
      ? `<span class="roadmap-truths">${ROLE_TRUTH_IDS.map((truth) => {
        const done = campaign.roleTruths.includes(truth);
        return `<i class="${done ? "is-done" : ""}${freshTruths.includes(truth) ? " is-fresh" : ""}" title="${escapeHtml(truthRoleLabel(truth))}">${done ? "◆" : "◇"} ${escapeHtml(roleTruthLabel(truth))}</i>`;
      }).join("")}</span>`
      : "";
    const state = chapter.done ? "is-done" : chapter.id === nextId ? "is-next" : "";
    return `<li class="${state}${fresh.has(chapter.id) ? " is-fresh" : ""}"><span class="roadmap-no">${chapter.done ? "◆" : toKanjiNumber(index + 1)}</span><span><strong>${escapeHtml(chapter.label)}${chapter.id === "three-truths" ? ` ${campaign.roleTruths.length}/${ROLE_TRUTH_IDS.length}` : ""}</strong>${chapter.id === nextId ? `<small>${escapeHtml(chapter.hint)}</small>` : ""}${truths}</span></li>`;
  }).join("");
}

function renderArchive(): void {
  setText("#archive-count", `${campaign.expeditions.length}件`);
  const progress = campaignProgress(campaign);
  requireElement<HTMLDivElement>("#campaign-summary").innerHTML = [
    ["最高到達", progress.highestFloor > 0 ? `F${progress.highestFloor}` : "-"],
    ["最多灯片", progress.bestShards > 0 ? `+${progress.bestShards}` : "-"],
    ["踏破", `${progress.completedRuns}回`],
    ["達成任務", `${progress.completedMissionIds.length}種`],
  ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");
  const list = requireElement<HTMLOListElement>("#archive-list");
  if (campaign.expeditions.length === 0) {
    list.innerHTML = '<li class="empty-state">まだ帰還記録はありません。</li>';
    return;
  }
  list.replaceChildren(...campaign.expeditions.slice(0, 6).map((record) => {
    const item = document.createElement("li");
    const mission = missionDefinition(record.missionId);
    item.innerHTML = `<span class="archive-status status-${record.status}">${statusLabel(record.status)}</span><span><strong>${escapeHtml(record.identity.name)}${record.missionCompleted ? " · 任務達成" : ""}${record.bossTrial ? ` · ${escapeHtml(bossTrialDefinition(record.bossTrial)?.label ?? "覚醒")}${record.status === "won" ? "突破" : "挑戦"}` : ""}</strong><small>${getContentName(record.identity.roleId)} / ${escapeHtml(mission.label)} / F${record.floor} / 灯片+${record.shards.total}</small></span>`;
    return item;
  }));
}

function renderDecision(observation: ReturnType<typeof observeGame>): void {
  const decision = state.pendingDecision;
  if (!candidateDialog.hidden || !decision || state.status !== "playing") {
    decisionDialog.hidden = true;
    stopLookahead();
    decisionRenderKey = "";
    return;
  }
  const focusKey = focusedDataKey(decisionDialog);
  setText("#decision-kicker", `伝言の猶予 · あと${decision.remainingTurns ?? 0}手 · 操作しなければ本人の判断`);
  const key = `${state.seed}:${decision.id}:${draftTactics?.join(",") ?? state.tactics.join(",")}`;
  const unchanged = key === decisionRenderKey;
  if (unchanged) {
    if (requireElement<HTMLDetailsElement>("#decision-details").open && lookahead?.decisionKey !== key) startLookahead(key, draftTactics ?? state.tactics);
    renderForecasts();
    return;
  }
  decisionRenderKey = key;
  decisionTitle.textContent = decision.title;
  decisionBody.textContent = decision.body;
  renderDecisionContext(observation);
  renderDecisionStakes();
  decisionHint.textContent = decision.kind === "context"
    ? "各案はこの場で効果を発揮します。番号キーでも選べます。"
    : decision.kind === "checkpoint"
      ? "伝言がなければ、探索者は任務に沿って選ぶ。本人の意思に反する指示には啓示を使う。番号キーでも選べます。"
      : "番号キーでも選べます。";
  decisionOptions.replaceChildren(...decision.options.map((option, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.optionId = option.id;
    button.disabled = !!option.requiresRevelation && state.revelationsRemaining <= 0;
    button.className = option.id === decision.defaultOptionId ? "decision-option is-default" : "decision-option";
    const costLabel = option.requiresRevelation
      ? "啓示を1消費"
      : option.id === decision.defaultOptionId && decision.kind === "checkpoint"
        ? "本人の判断（任務に沿う）"
        : option.id === decision.defaultOptionId && decision.kind === "context"
          ? "探索者の判断・消費なし"
          : "消費なし";
    button.innerHTML = `<strong>${index + 1}. ${escapeHtml(option.label)}</strong><small>${escapeHtml(option.description)}</small><em>${costLabel}</em>${decision.kind === "final" ? "" : `<div class="option-forecast" data-forecast-for="${escapeHtml(option.id)}"></div>`}`;
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
  const decisionKey = `${state.seed}:${decision.id}:${lookaheadTactics.join(",")}`;
  if (requireElement<HTMLDetailsElement>("#decision-details").open && lookahead?.decisionKey !== decisionKey) startLookahead(decisionKey, lookaheadTactics);
  renderForecasts();
  decisionDialog.hidden = false;
  if (focusKey) restoreFocus(decisionDialog, focusKey);
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

/** 帰還路の判断で、帰ると確定するものと、進んで倒れた時に失うものを並べる。 */
function renderDecisionStakes(): void {
  const box = requireElement<HTMLElement>("#decision-stakes");
  const decision = state.pendingDecision;
  if (!decision || decision.kind !== "checkpoint") {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  const forecast = shardForecast(state);
  const truth = state.story.carriedTruthId;
  const newTruth = !!truth && !state.knownRoleTruths.includes(truth);
  const progress = missionProgress(state);
  const mission = missionDefinition(state.story.missionId);
  const name = escapeHtml(state.runIdentity.name);
  const veteran = state.runIdentity.veteranId ? campaign.roster.find((entry) => entry.id === state.runIdentity.veteranId) : undefined;
  const config = getGameConfig().campaign;
  const player = state.entities.find((entity) => entity.id === state.playerId);
  const hpRatio = player?.stats ? player.stats.hp / player.stats.maxHp : 1;
  const keep = [
    `灯片 <b>+${forecast.ifReturned}</b>`,
    veteran
      ? `${name}の位階が上がる（★${Math.min(config.veteranMaxRank, veteran.rank + 1)}）`
      : campaign.roster.length < config.rosterLimit ? `${name}が遠征団に加わる` : "遠征団は満員（加入しない）",
    ...(truth ? [newTruth ? `真相「${escapeHtml(roleTruthLabel(truth))}」を記録` : `真相「${escapeHtml(roleTruthLabel(truth))}」（記録済み）`] : []),
    progress.completed ? `任務「${escapeHtml(mission.label)}」達成` : `任務「${escapeHtml(mission.label)}」は未達で終わる`,
    ...(hpRatio <= config.scarHpRatio ? ["瀕死のため古傷を負う"] : []),
  ];
  const nextGate = state.floor < 6 ? "次の帰還路は第六階" : "この先に帰還路はない。第十層の番人を倒すまで帰れない";
  const aim = state.story.missionId === "black-core" || state.floor >= 6
    ? "第十層の番人を倒して踏破"
    : progress.completed ? "さらに深い階の灯片" : `任務「${escapeHtml(mission.label)}」`;
  const lose = [
    `灯片は <b>+${forecast.ifLost}</b> だけ残る`,
    `${name}は戻らず、墓標が残る`,
    ...(truth ? ["抱えた真相も失う"] : []),
  ];
  box.hidden = false;
  box.innerHTML = `
    <div class="stake stake-return"><span>帰還すれば</span><p>${keep.join(" · ")}</p></div>
    <div class="stake stake-continue"><span>進めば</span><p>狙える: ${aim} · ${nextGate}</p><p class="stake-loss">倒れると: ${lose.join(" · ")}</p></div>
  `;
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
      slot.innerHTML = forecastMarkup({ survived: 1, lost: 0, stranded: 0 }, `生還確定・灯片+${shardForecast(state).ifReturned}を持ち帰る`);
      continue;
    }
    if (lookahead?.failedOptions.has(option.id)) {
      slot.innerHTML = '<span class="forecast-label">先読みを取得できませんでした。現在の状態で判断してください。</span>';
      continue;
    }
    const summary = lookahead?.results.get(option.id);
    if (!summary) {
      slot.innerHTML = `<span class="forecast-pending">${lookahead ? "先読み中（待たずに進みます）" : "長期の先読みは詳細から"}</span>`;
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
  const shards = review.shards;
  const survived = state.status === "won" || state.status === "returned";
  endSummary.textContent = state.story.endingId
    ? `${endingLabel(state.story.endingId)}の結末を遠征録へ刻みました。灯片+${shards.total}を持ち帰りました。`
    : `${review.summaryText} ${survived ? `灯片+${shards.total}を持ち帰りました。` : `灯片は+${shards.total}だけが残りました。`}`;
  const record = campaign.expeditions[0]?.id === archivedRunId ? campaign.expeditions[0] : null;
  const endTone = survived ? "safe" : "danger";
  panel.dataset.tone = endTone;
  const progress = missionProgress(state);
  const missionDone = progress.completed && survived;
  endStats.innerHTML = [
    ["今回の目標", missionDone ? "達成" : "未達"],
    ["到達", `地下${state.story.maxFloorReached}階`],
    ["観測", `${state.runTurn}手`],
    ["灯片", `+${shards.total}`],
  ].map(([label, value]) => `<div${label === "今回の目標" ? ` class="is-${missionDone ? "done" : "missed"}"` : ""}><span>${label}</span><strong>${value}</strong></div>`).join("");
  renderRunInsights(buildRunInsights(runLog, state, review.deathCause, campaign));
  const rows: Array<[string, number]> = [
    ["到達", shards.depth], ["守り手", shards.guardians], ["発見", shards.discoveries], ["弔い", shards.graves],
    ["生還", shards.survival], ["持ち帰り", shards.carried], ["任務", shards.mission], ["真相", shards.truth],
  ];
  const maxRow = Math.max(1, ...rows.map(([, value]) => value));
  shardBreakdown.innerHTML = rows.map(([label, value]) => `<div class="${value === 0 ? "is-zero" : ""}"><span>${label}</span><strong>+${value}</strong><i style="width:${Math.round(value / maxRow * 100)}%"></i></div>`).join("");
  const keepPercent = getGameConfig().campaign.shards.keepPercentOnLoss;
  setText("#shard-note", [
    `鍛錬の累計に灯片+${shards.total}。${journeyProgress(campaign).shardsToNextRank ? `次の鍛錬まで${journeyProgress(campaign).shardsToNextRank}。` : "鍛錬は最大。"}`,
    state.modifiers.bossTrial ? (state.status === "won" ? (journeyProgress(campaign).trial ? "覚醒を突破。次の覚醒が待っている。" : "覚醒を突破。次は通常の遠征へ。") : "覚醒は次の遠征にも残る。帰還や敗北で得た力を持って再挑戦できる。") : "",
    survived ? "" : `倒れたため、到達・守り手・発見・弔いは${keepPercent}%だけが残り、生還・持ち帰り・任務・真相は失われた。`,
    shards.bonusPercent > 0 ? `燭階・周期の上乗せ +${shards.bonusPercent}% 込み。` : "",
  ].filter(Boolean).join(" "));
  renderEndRoadmap();
  renderRunComparison();
  renderMilestone(record);
  const lanternStats = state.expedition?.stats;
  const lanternSummary = [
    `灯の介入 ${state.lantern.ritesUsed}回`,
    lanternStats?.lightsPlaced ? `置灯 ${lanternStats.lightsPlaced}回` : "",
    lanternStats?.borrowed ? "借灯 1回" : "",
    `溢れた灯火 ${state.lantern.overflowed ?? 0}`,
    `残った灯火 ${state.lantern.embers}`,
  ].filter(Boolean).join(" · ");
  decisionHistory.innerHTML = `<h3>灯守の判断</h3><p class="lantern-summary${(state.lantern.overflowed ?? 0) >= 2 ? " is-wasteful" : ""}">${escapeHtml(lanternSummary)}</p>${review.decisions.length === 0 ? "<p>介入記録なし</p>" : `<ol>${review.decisions.map((entry) => `<li><span>F${entry.floor}</span><strong>${escapeHtml(entry.optionLabel)}${entry.effectSummary ? `<small>${escapeHtml(entry.effectSummary)}</small>` : ""}</strong>${entry.usedRevelation ? "<em>啓示</em>" : ""}</li>`).join("")}</ol>`}`;
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
    if (target === 0) return;
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

/** 結果画面の「黒燭への道」。今回の遠征で進んだ章を光らせ、次の目標を示す。 */
function renderEndRoadmap(): void {
  const current = campaign.expeditions[0];
  if (!current || current.id !== archivedRunId) {
    endRoadmap.innerHTML = "";
    return;
  }
  const after = campaignProgress(campaign);
  const before = campaignBeforeRun ? campaignProgress(campaignBeforeRun) : null;
  const fresh = new Set(after.roadmap.filter((chapter) => chapter.done && !before?.roadmap.find((entry) => entry.id === chapter.id)?.done).map((chapter) => chapter.id));
  const freshTruths = campaign.roleTruths.filter((truth) => !campaignBeforeRun?.roleTruths.includes(truth));
  const done = after.roadmap.filter((chapter) => chapter.done).length;
  const next = after.nextChapter;
  const note = fresh.size ? "この遠征で進んだ章が光っている。"
    : freshTruths.length ? `真相「${roleTruthLabel(freshTruths[0])}」を記録した。三つの真相まで、あと${ROLE_TRUTH_IDS.length - campaign.roleTruths.length}つ。`
      : "この遠征では道は進まなかった。";
  endRoadmap.innerHTML = `
    <div class="result-section-heading"><h3>黒燭への道 ${done}/${after.roadmap.length}</h3><small>${escapeHtml(note)}</small></div>
    ${candleRoadMarkup(campaign, fresh, freshTruths)}
    ${growthMarkup(campaign, campaignBeforeRun)}
    ${next ? `<p class="end-next-goal">次の目標: <strong>${escapeHtml(next.label)}</strong> — ${escapeHtml(next.hint)}</p>` : ""}
  `;
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
  const newShardRecord = current.shards.total > older.reduce((best, record) => Math.max(best, record.shards.total), 0);
  const badges = [
    newDepthRecord ? "最高到達階を更新" : "",
    newShardRecord && older.length > 0 ? "最多灯片を更新" : "",
    current.truthRecovered && current.shards.truth > 0 ? "新たな真相を持ち帰った" : "",
    current.gravesRecovered ? `墓標${current.gravesRecovered}つを弔った` : "",
    current.status === "won" && (current.heat ?? 0) + 1 === campaign.heat.unlocked ? `燭階${campaign.heat.unlocked}が開いた` : "",
    // 墓標・昇格・結末などは上の碑に刻むので、ここでは碑にならない結果だけを添える。
    current.veteranOutcome === "roster-full" ? veteranOutcomeLabel(current) : "",
  ].filter(Boolean);
  const comparison = previous
    ? `前回比: 深度 ${signed(current.floor - previous.floor)}階 / 灯片 ${signed(current.shards.total - previous.shards.total)}`
    : "最初の遠征記録です。ここから灯守の記録が始まります。";
  const mission = missionDefinition(current.missionId);
  const survived = current.status === "won" || current.status === "returned";
  const progress = missionProgress(state);
  const verdict = current.missionCompleted && survived
    ? `達成 · 灯片+${current.shards.mission}`
    : progress.completed ? "条件は満たしたが、生きて帰れなかった" : `未達 · ${progress.label}`;
  runComparison.innerHTML = `<strong>今回の目標「${escapeHtml(mission.label)}」 ${escapeHtml(verdict)}</strong><p>${escapeHtml(comparison)}</p>${badges.length ? `<div>${badges.map((badge) => `<span>${escapeHtml(badge)}</span>`).join("")}</div>` : ""}`;
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
  const truth = record?.truthRecovered && record.shards.truth > 0 ? { name: roleTruthLabel(record.truthRecovered) } : null;
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
  const nextModal = [candidateDialog, endDialog].find((dialog) => !dialog.hidden) ?? null;
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
  if (!import.meta.env.DEV) return;
  window.__rogueDebug = {
    loadState: (snapshot) => {
      stopAutoplay();
      resetAutoplayState();
      state = structuredClone(snapshot);
      speechMemory = createSpeechMemory();
      decisionRenderKey = "";
      runLog = createRunLog(state.seed, state.runIdentity.roleId, {}, state.runIdentity);
      runActive = true;
      candidateDialog.hidden = true;
      endDialog.hidden = true;
      render();
      scheduleAutoplay("danger");
    },
    resume: () => scheduleAutoplay("danger"),
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
  if (observation.pendingDecision) return "伝言がなければ探索者の方針で進みます。遠征は止まりません。";
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
    saveIndex = touchSaveSlot(saveIndex, saveIndex.active);
  } catch (error) {
    console.warn("遠征録を保存できませんでした。", error);
  }
}

function activeSlotName(): string {
  return saveIndex.slots.find((slot) => slot.id === saveIndex.active)?.name ?? "記録";
}

/** タイトルの「記録を選ぶ」に並べる、各記録の現状。 */
function saveSlotSummaries(): SaveSlotSummary[] {
  return saveIndex.slots.map((slot) => {
    const stored = slot.id === saveIndex.active ? campaign : normalizeCampaignState(readSlotCampaign(slot.id));
    const progress = campaignProgress(stored);
    return {
      id: slot.id,
      name: slot.name,
      active: slot.id === saveIndex.active,
      cycle: stored.cycle.number,
      expeditions: stored.expeditions.length,
      highestFloor: progress.highestFloor,
      shards: stored.shards,
      roster: stored.roster.length,
      roadmapDone: progress.roadmap.filter((chapter) => chapter.done).length,
      roadmapTotal: progress.roadmap.length,
      nextGoal: progress.nextChapter?.label ?? null,
      playedAt: slot.playedAt ?? stored.expeditions[0]?.completedAt,
    };
  });
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
