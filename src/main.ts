import "./styles.css";
import { chooseAutoplayAction, getAutoplayDebugState } from "./game/ai/autoplay";
import { getGameConfig, loadBrowserGameConfig } from "./game/content/config";
import { assetForContent } from "./game/content/assets";
import { contentEntities, getContentName } from "./game/content/entities";
import { worldBible } from "./game/content/worldBible";
import { applyAction, availableMerchantServices, biomeThemeName, createInitialGame, observeGame, playableRoles } from "./game/core/game";
import { analyzeRun, createRunLog, recordTurn } from "./game/core/runLog";
import { PixiRoguelikeRenderer } from "./game/renderer/PixiRoguelikeRenderer";
import type { Direction, GameAction, GameState, InventoryEntry, MerchantServiceId, RunLog, RunReview, Tier } from "./game/types";

type Rarity = "common" | "uncommon" | "rare" | "special";

declare global {
  interface Window {
    __rogueDebug?: {
      dump: () => string;
      getState: () => GameState;
      getObservation: () => ReturnType<typeof observeGame>;
      getRunLog: () => RunLog;
      getRunReview: () => RunReview;
      stepAi: (steps?: number) => GameState;
    };
  }
}

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing #app root");
}

app.innerHTML = `
  <main class="rogue-shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">TypeScript Roguelike Baseline</p>
        <h1>${worldBible.title}</h1>
      </div>
      <div class="controls" aria-label="操作">
        <div id="role-controls" class="role-controls" aria-label="開始職"></div>
        <button id="restart" type="button">再生成</button>
        <button id="step-ai" type="button">AI 1手</button>
        <button id="toggle-ai" type="button" aria-pressed="false">AI開始</button>
        <button id="copy-debug" type="button">状態コピー</button>
        <label class="speed-control">AI間隔 <input id="ai-delay" type="range" min="40" max="240" step="20" value="100"><span id="ai-delay-label">100ms</span></label>
      </div>
    </header>

    <section class="game-layout">
      <section class="playfield-panel" aria-label="ダンジョン">
        <div id="pixi-root" class="pixi-root"></div>
      </section>

      <aside class="side-panel" aria-label="状況">
        <section class="panel-section">
          <div class="section-heading">
            <h2>ログ</h2>
            <span id="turn-counter">turn 0</span>
          </div>
          <ol id="message-list" class="message-list"></ol>
        </section>
        <section class="panel-section role-guide-section">
          <div class="section-heading">
            <h2>職業特性</h2>
            <span id="role-guide-focus">-</span>
          </div>
          <div id="role-guide" class="role-guide"></div>
        </section>
      </aside>
    </section>

    <footer class="status-bar">
      <section class="hero-card" aria-label="主人公ステータス">
        <h2 id="hero-name">主人公</h2>
        <div id="hero-stats" class="stat-grid"></div>
      </section>
      <section class="objective-card" aria-label="探索目標">
        <div class="section-heading">
          <h2>探索目標</h2>
          <span id="exploration-summary">-</span>
        </div>
        <div id="objective-body" class="objective-body"></div>
      </section>
      <section class="inventory-card" aria-label="インベントリ">
        <div class="section-heading">
          <h2>インベントリ</h2>
          <span id="inventory-hint">0</span>
        </div>
        <ul id="inventory-list" class="inventory-list"></ul>
        <div class="inventory-actions">
          <button id="selected-item-action" class="inventory-action" type="button" disabled>所持品を選択</button>
          <button id="selected-item-drop" class="inventory-action" type="button" disabled>捨てる</button>
        </div>
      </section>
    </footer>

    <section id="end-dialog" class="end-dialog" aria-live="assertive" hidden>
      <div class="end-dialog-panel" role="dialog" aria-modal="true" aria-labelledby="end-title">
        <p id="end-kicker" class="eyebrow">run ended</p>
        <h2 id="end-title">ゲームオーバー</h2>
        <p id="end-body"></p>
        <div id="end-review" class="end-review"></div>
        <button id="copy-review" type="button">分析JSONコピー</button>
        <button id="end-reset" type="button">新しい探索を始める</button>
      </div>
    </section>

    <section id="item-popover" class="item-popover" hidden>
      <div class="item-popover-panel" role="dialog" aria-modal="false" aria-labelledby="item-popover-title">
        <button id="item-popover-close" class="item-popover-close" type="button" aria-label="閉じる">×</button>
        <div class="item-popover-heading">
          <span id="item-popover-icon" class="item-popover-icon" aria-hidden="true"></span>
          <div>
            <h2 id="item-popover-title">アイテム</h2>
            <p id="item-popover-meta"></p>
          </div>
        </div>
        <p id="item-popover-description"></p>
        <dl id="item-popover-stats" class="item-popover-stats"></dl>
      </div>
    </section>
  </main>
`;

await loadBrowserGameConfig();

const pixiRoot = requireElement<HTMLDivElement>("#pixi-root");
const restartButton = requireElement<HTMLButtonElement>("#restart");
const roleControls = requireElement<HTMLDivElement>("#role-controls");
const stepAiButton = requireElement<HTMLButtonElement>("#step-ai");
const toggleAiButton = requireElement<HTMLButtonElement>("#toggle-ai");
const copyDebugButton = requireElement<HTMLButtonElement>("#copy-debug");
const aiDelayInput = requireElement<HTMLInputElement>("#ai-delay");
const aiDelayLabel = requireElement<HTMLSpanElement>("#ai-delay-label");
const turnCounter = requireElement<HTMLSpanElement>("#turn-counter");
const messageList = requireElement<HTMLOListElement>("#message-list");
const roleGuideFocus = requireElement<HTMLSpanElement>("#role-guide-focus");
const roleGuide = requireElement<HTMLDivElement>("#role-guide");
const heroName = requireElement<HTMLHeadingElement>("#hero-name");
const heroStats = requireElement<HTMLDivElement>("#hero-stats");
const explorationSummary = requireElement<HTMLSpanElement>("#exploration-summary");
const objectiveBody = requireElement<HTMLDivElement>("#objective-body");
const inventoryList = requireElement<HTMLUListElement>("#inventory-list");
const inventoryHint = requireElement<HTMLSpanElement>("#inventory-hint");
const selectedItemActionButton = requireElement<HTMLButtonElement>("#selected-item-action");
const selectedItemDropButton = requireElement<HTMLButtonElement>("#selected-item-drop");
const endDialog = requireElement<HTMLElement>("#end-dialog");
const endTitle = requireElement<HTMLHeadingElement>("#end-title");
const endKicker = requireElement<HTMLParagraphElement>("#end-kicker");
const endBody = requireElement<HTMLParagraphElement>("#end-body");
const endReview = requireElement<HTMLDivElement>("#end-review");
const copyReviewButton = requireElement<HTMLButtonElement>("#copy-review");
const endResetButton = requireElement<HTMLButtonElement>("#end-reset");
const itemPopover = requireElement<HTMLElement>("#item-popover");
const itemPopoverClose = requireElement<HTMLButtonElement>("#item-popover-close");
const itemPopoverIcon = requireElement<HTMLElement>("#item-popover-icon");
const itemPopoverTitle = requireElement<HTMLHeadingElement>("#item-popover-title");
const itemPopoverMeta = requireElement<HTMLParagraphElement>("#item-popover-meta");
const itemPopoverDescription = requireElement<HTMLParagraphElement>("#item-popover-description");
const itemPopoverStats = requireElement<HTMLElement>("#item-popover-stats");

let selectedRoleId = playableRoles()[0].id;
let state: GameState = createInitialGame(undefined, selectedRoleId);
let runLog = createRunLog(state.seed, selectedRoleId);
let currentReview: RunReview | null = null;
let autoplayTimer: number | null = null;
let autoplayDelayMs = Number(aiDelayInput.value);
let selectedInventoryContentId: string | null = null;
const renderer = new PixiRoguelikeRenderer();

installDebugBridge();
render();
await renderer.mount(pixiRoot);
render();

restartButton.addEventListener("click", () => {
  resetGame();
});

roleControls.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const button = target.closest<HTMLButtonElement>("button[data-role-id]");
  if (!button) {
    return;
  }
  selectedRoleId = button.dataset.roleId ?? selectedRoleId;
  resetGame();
});

stepAiButton.addEventListener("click", () => {
  stepAutoplay();
});

toggleAiButton.addEventListener("click", () => {
  if (autoplayTimer) {
    stopAutoplay();
  } else {
    startAutoplay();
  }
});

copyDebugButton.addEventListener("click", () => {
  void copyDebugDump();
});

copyReviewButton.addEventListener("click", () => {
  void copyReviewJson();
});

endResetButton.addEventListener("click", resetGame);

inventoryList.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const button = target.closest<HTMLButtonElement>("button[data-content-id]");
  if (!button) {
    return;
  }
  selectedInventoryContentId = button.dataset.contentId ?? null;
  showItemPopover(selectedInventoryContentId);
  render();
});

itemPopoverClose.addEventListener("click", () => {
  itemPopover.hidden = true;
});

itemPopover.addEventListener("click", (event) => {
  if (event.target === itemPopover) {
    itemPopover.hidden = true;
  }
});

selectedItemActionButton.addEventListener("click", () => {
  if (!selectedInventoryContentId) {
    return;
  }
  stopAutoplay();
  applyLoggedAction({ type: "useItem", contentId: selectedInventoryContentId }, "player");
  itemPopover.hidden = true;
  render();
});

selectedItemDropButton.addEventListener("click", () => {
  if (!selectedInventoryContentId) {
    return;
  }
  stopAutoplay();
  applyLoggedAction({ type: "dropItem", contentId: selectedInventoryContentId }, "player");
  itemPopover.hidden = true;
  render();
});

objectiveBody.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const button = target.closest<HTMLButtonElement>("button[data-merchant-service]");
  if (!button) {
    return;
  }
  stopAutoplay();
  applyLoggedAction({ type: "merchantService", serviceId: button.dataset.merchantService as MerchantServiceId }, "player");
  render();
});

aiDelayInput.addEventListener("input", () => {
  autoplayDelayMs = Number(aiDelayInput.value);
  aiDelayLabel.textContent = `${autoplayDelayMs}ms`;
  if (autoplayTimer) {
    stopAutoplay();
    startAutoplay();
  }
});

window.addEventListener("keydown", (event) => {
  const action = actionForKey(event.key);
  if (!action) {
    return;
  }
  event.preventDefault();
  stopAutoplay();
  applyLoggedAction(action, "player");
  render();
});

function startAutoplay(): void {
  if (autoplayTimer || state.status !== "playing") {
    return;
  }
  toggleAiButton.textContent = "AI停止";
  toggleAiButton.setAttribute("aria-pressed", "true");
  autoplayTimer = window.setInterval(stepAutoplay, autoplayDelayMs);
}

function stopAutoplay(): void {
  if (!autoplayTimer) {
    return;
  }
  window.clearInterval(autoplayTimer);
  autoplayTimer = null;
  toggleAiButton.textContent = "AI開始";
  toggleAiButton.setAttribute("aria-pressed", "false");
}

function stepAutoplay(): void {
  if (state.status !== "playing") {
    stopAutoplay();
    return;
  }
  const observation = observeGame(state);
  const action = chooseAutoplayAction(observation);
  applyLoggedAction(action, "ai", getAutoplayDebugState(observation));
  render();
}

function applyLoggedAction(action: GameAction, actor: "player" | "ai", aiDebug?: Parameters<typeof recordTurn>[0]["aiDebug"]): void {
  const before = state;
  state = applyAction(state, action);
  if (actor === "ai" && shouldLogAutoplayAction(action)) {
    state.messages = [
      ...state.messages.slice(0, -1),
      ...state.messages.slice(-1),
      { turn: state.turn, text: `AI: ${describeAction(action)}`, tone: "ai" as const },
    ].slice(-80);
  }
  recordTurn({ log: runLog, before, action, after: state, actor, aiDebug });
  currentReview = state.status === "playing" ? null : analyzeRun(runLog, state);
}

function render(): void {
  renderer.render(state);
  const observation = observeGame(state);
  const player = observation.player;
  const progress = observation.playerProgress;

  renderRoleControls();
  renderRoleGuide(player.contentId);
  turnCounter.textContent = `turn ${state.turn} / floor ${state.floor}`;
  heroName.textContent = getContentName(player.contentId);
  const hp = player.stats ? `${player.stats.hp}/${player.stats.maxHp}` : "-";
  heroStats.innerHTML = `
    <div><span>Lv</span><strong>${progress.level}</strong></div>
    <div><span>XP</span><strong>${progress.xp}${progress.xpToNext > 0 ? ` / +${progress.xpToNext}` : ""}</strong></div>
    <div><span>Gold</span><strong>${progress.gold}</strong></div>
    <div><span>HP</span><strong>${hp}</strong></div>
    <div><span>攻撃</span><strong>${player.stats?.attack ?? "-"}</strong></div>
    <div><span>防御</span><strong>${player.stats?.defense ?? "-"}</strong></div>
    <div><span>階層</span><strong>${state.floor}/${getGameConfig().rules.maxFloor}</strong></div>
    <div><span>領域</span><strong>${biomeThemeName(state.biome)}</strong></div>
    <div><span>状態</span><strong>${statusLabel(state.status)}</strong></div>
    <div><span>効果</span><strong>${conditionLabel(player.conditions)}</strong></div>
    <div><span>固有</span><strong>${roleGoalLabel(player.contentId, state.runObjectives.roleGoalProgress)}</strong></div>
  `;
  renderExplorationObjective(observation);

  messageList.replaceChildren(
    ...[...state.messages.slice(-10)]
      .reverse()
      .map((entry) => {
        const li = document.createElement("li");
        li.className = `tone-${entry.tone}`;
        li.textContent = `[${entry.turn}] ${entry.text}`;
        return li;
      }),
  );

  const inventory = player.inventory ?? [];
  syncSelectedInventory(inventory);
  inventoryHint.textContent = `${inventory.length}/${getGameConfig().rules.inventorySlotLimit}`;
  inventoryList.replaceChildren(
    ...inventory.map((entry) => {
      const li = document.createElement("li");
      const content = contentEntities[entry.contentId];
      const selected = entry.contentId === selectedInventoryContentId;
      li.className = selected ? "is-selected" : "";
      const selectButton = document.createElement("button");
      selectButton.type = "button";
      selectButton.dataset.contentId = entry.contentId;
      selectButton.className = "inventory-select";
      const icon = document.createElement("span");
      icon.className = "inventory-icon";
      applyInventoryIcon(icon, entry.contentId);
      const label = document.createElement("span");
      label.className = "inventory-label";
      label.innerHTML = `<strong>${content?.names.ja ?? entry.contentId}</strong><span>x${entry.quantity}${entry.equipped ? " / 装備中" : ""}</span>`;
      selectButton.append(icon, label);
      li.append(selectButton);
      return li;
    }),
  );

  renderEndDialog();
}

function resetGame(): void {
  stopAutoplay();
  state = createInitialGame(Date.now() % 100000, selectedRoleId);
  runLog = createRunLog(state.seed, selectedRoleId);
  currentReview = null;
  selectedInventoryContentId = null;
  itemPopover.hidden = true;
  render();
}

function renderRoleControls(): void {
  roleControls.replaceChildren(
    ...playableRoles().map((role) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.roleId = role.id;
      button.textContent = getContentName(role.id);
      button.className = role.id === selectedRoleId ? "is-selected" : "";
      button.setAttribute("aria-pressed", role.id === selectedRoleId ? "true" : "false");
      return button;
    }),
  );
}

function renderRoleGuide(roleId: string): void {
  const role = playableRoles().find((candidate) => candidate.id === roleId) ?? playableRoles()[0];
  roleGuideFocus.textContent = role.traits.focus;
  const startingItems = role.inventory.map((entry) => `${getContentName(entry.contentId)}${entry.quantity > 1 ? ` x${entry.quantity}` : ""}`).join(" / ");
  roleGuide.replaceChildren(
    roleGuideLine("基本", `HP ${role.stats.maxHp} / 攻撃 ${role.stats.attack} / 防御 ${role.stats.defense}`),
    roleGuideLine("初期装備", startingItems),
    roleGuideLine("特徴", role.traits.traitLabels.join(" / ")),
    roleGuideList(role.traits.strengths),
  );
}

function roleGuideLine(label: string, value: string): HTMLElement {
  const row = document.createElement("div");
  const labelElement = document.createElement("span");
  labelElement.textContent = label;
  const valueElement = document.createElement("strong");
  valueElement.textContent = value;
  row.append(labelElement, valueElement);
  return row;
}

function roleGuideList(items: string[]): HTMLElement {
  const list = document.createElement("ul");
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    list.append(li);
  }
  return list;
}

function renderExplorationObjective(observation: ReturnType<typeof observeGame>): void {
  const exploration = observation.exploration;
  const objective = explorationObjectiveLabel(exploration.objective);
  explorationSummary.textContent = `${Math.round(exploration.exploredTileRatio * 100)}%`;
  const target = exploration.reachableStairs
    ? `到達可能な階段 ${pointLabel(exploration.reachableStairs)}`
    : exploration.blockedStairs
      ? `階段への経路探索 ${pointLabel(exploration.blockedStairs)}`
      : exploration.nearestFrontier
        ? `未探索境界 ${pointLabel(exploration.nearestFrontier)}`
        : "候補なし";
  const rows = [
    objectiveLine("目標", objective),
    objectiveLine("次の手がかり", target),
    objectiveLine("探索候補", `${exploration.reachableFrontierCount} 箇所`),
  ];
  const merchantServices = availableMerchantServices(state);
  if (merchantServices.length > 0) {
    rows.push(merchantServicePanel(merchantServices));
  }
  objectiveBody.replaceChildren(...rows);
}

function objectiveLine(label: string, value: string): HTMLElement {
  const row = document.createElement("div");
  const labelElement = document.createElement("span");
  labelElement.textContent = label;
  const valueElement = document.createElement("strong");
  valueElement.textContent = value;
  row.append(labelElement, valueElement);
  return row;
}

function merchantServicePanel(services: ReturnType<typeof availableMerchantServices>): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "merchant-services";
  const labelElement = document.createElement("span");
  labelElement.textContent = "旅商人";
  const list = document.createElement("div");
  list.className = "merchant-service-list";
  for (const service of services) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.merchantService = service.serviceId;
    button.disabled = !service.affordable || !service.useful;
    button.textContent = `${service.label} / ${service.cost}G`;
    list.append(button);
  }
  panel.append(labelElement, list);
  return panel;
}

function explorationObjectiveLabel(objective: ReturnType<typeof observeGame>["exploration"]["objective"]): string {
  switch (objective) {
    case "defeatBoss":
      return "守り手を倒す";
    case "descend":
      return "階段へ向かう";
    case "findStairs":
      return "階段を探す";
    case "resolveStall":
      return "探索経路を見直す";
    case "explore":
      return "未探索を広げる";
  }
}

function pointLabel(point: { x: number; y: number }): string {
  return `(${point.x}, ${point.y})`;
}

function installDebugBridge(): void {
  window.__rogueDebug = {
    dump: () => createDebugDump(),
    getState: () => structuredClone(state),
    getObservation: () => structuredClone(observeGame(state)),
    getRunLog: () => structuredClone(runLog),
    getRunReview: () => structuredClone(currentReview ?? analyzeRun(runLog, state)),
    stepAi: (steps = 1) => {
      stopAutoplay();
      for (let index = 0; index < steps && state.status === "playing"; index += 1) {
        const observation = observeGame(state);
        const action = chooseAutoplayAction(observation);
        applyLoggedAction(action, "ai", getAutoplayDebugState(observation));
      }
      render();
      return structuredClone(state);
    },
  };
}

async function copyDebugDump(): Promise<void> {
  const dump = createDebugDump();
  try {
    await navigator.clipboard.writeText(dump);
    copyDebugButton.textContent = "状態コピー済み";
    window.setTimeout(() => {
      copyDebugButton.textContent = "状態コピー";
    }, 1200);
  } catch {
    console.log(dump);
    copyDebugButton.textContent = "console出力済み";
    window.setTimeout(() => {
      copyDebugButton.textContent = "状態コピー";
    }, 1200);
  }
}

async function copyReviewJson(): Promise<void> {
  const review = currentReview ?? analyzeRun(runLog, state);
  const json = JSON.stringify(review.exportJson, null, 2);
  try {
    await navigator.clipboard.writeText(json);
    copyReviewButton.textContent = "分析JSONコピー済み";
    window.setTimeout(() => {
      copyReviewButton.textContent = "分析JSONコピー";
    }, 1200);
  } catch {
    console.log(json);
    copyReviewButton.textContent = "console出力済み";
    window.setTimeout(() => {
      copyReviewButton.textContent = "分析JSONコピー";
    }, 1200);
  }
}

function createDebugDump(): string {
  const observation = observeGame(state);
  const player = observation.player;
  const recentMessages = state.messages.slice(-20);
  const walkableKnownTiles = observation.knownTiles.filter((tile) => tile.kind === "floor" || tile.kind === "stairsDown").length;
  const review = currentReview ?? analyzeRun(runLog, state);
  return JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      state,
      observation: {
        seed: observation.seed,
        turn: observation.turn,
        floor: observation.floor,
        biome: observation.biome,
        status: observation.status,
        bossAlive: observation.bossAlive,
        size: { width: observation.width, height: observation.height },
        player: {
          pos: player.pos,
          stats: player.stats,
          inventory: player.inventory,
          conditions: player.conditions,
        },
        progress: observation.playerProgress,
        visibleEntities: observation.visibleEntities,
        knownEntities: observation.knownEntities,
        knownTiles: observation.knownTiles.length,
        visibleTiles: observation.visibleTiles.length,
        walkableKnownTiles,
      },
      ai: getAutoplayDebugState(observation),
      runReview: review,
      runLog: {
        ...runLog,
        entries: runLog.entries.slice(-30),
      },
      recentMessages,
    },
    null,
    2,
  );
}

function renderEndDialog(): void {
  if (state.status === "playing") {
    endDialog.hidden = true;
    return;
  }
  stopAutoplay();
  const lost = state.status === "lost";
  const player = state.entities.find((entity) => entity.id === state.playerId);
  const review = currentReview ?? analyzeRun(runLog, state);
  const progress = state.playerProgress;
  const hp = player?.stats ? `${player.stats.hp}/${player.stats.maxHp}` : "-";
  const finalStats = `ターン: ${review.stats.turns} / 階層: ${state.floor}/${getGameConfig().rules.maxFloor} / Lv: ${progress.level} / XP: ${progress.xp} / Gold: ${progress.gold} / HP: ${hp} / 攻撃: ${player?.stats?.attack ?? "-"} / 防御: ${player?.stats?.defense ?? "-"}`;
  endKicker.textContent = lost ? "game over" : "run clear";
  endTitle.textContent = lost ? "ゲームオーバー" : "踏破成功";
  endBody.textContent = lost
    ? `HPが0以下になりました。${finalStats}`
    : "黒燭の迷宮、第十層を踏破しました。";
  if (lost) {
    renderRunReview(review);
  } else {
    renderRunClearSummary(review, player);
  }
  endDialog.hidden = false;
}

function renderRunClearSummary(review: RunReview, player?: GameState["entities"][number]): void {
  const progress = state.playerProgress;
  const stats = player?.stats;
  const inventory = player?.inventory ?? [];
  endReview.replaceChildren(
    clearStatsBlock([
      ["総ターン数", `${review.stats.turns}ターン`],
      ["階層", `${state.floor}/${getGameConfig().rules.maxFloor}`],
      ["現在の状態", state.status === "won" ? "踏破成功" : statusLabel(state.status)],
      ["HP", stats ? `${stats.hp}/${stats.maxHp}` : "-"],
      ["Lv", String(progress.level)],
      ["XP", String(progress.xp)],
      ["Gold", String(progress.gold)],
      ["攻撃", String(stats?.attack ?? "-")],
      ["防御", String(stats?.defense ?? "-")],
      ["効果", conditionLabel(player?.conditions)],
    ]),
    inventoryBlock(inventory),
  );
}

function clearStatsBlock(items: Array<[string, string]>): HTMLElement {
  const section = document.createElement("section");
  section.className = "end-summary-section";
  const heading = document.createElement("h3");
  heading.textContent = "現在のステータス";
  const grid = document.createElement("dl");
  grid.className = "end-stat-grid";
  for (const [label, value] of items) {
    const item = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = value;
    item.append(dt, dd);
    grid.append(item);
  }
  section.append(heading, grid);
  return section;
}

function inventoryBlock(inventory: InventoryEntry[]): HTMLElement {
  const section = document.createElement("section");
  section.className = "end-summary-section";
  const heading = document.createElement("h3");
  heading.textContent = "アイテム";
  const list = document.createElement("ul");
  list.className = "end-inventory-list";
  if (inventory.length === 0) {
    const item = document.createElement("li");
    item.className = "is-empty";
    item.textContent = "所持品はありません。";
    list.append(item);
  } else {
    for (const entry of inventory) {
      list.append(inventorySummaryItem(entry));
    }
  }
  section.append(heading, list);
  return section;
}

function inventorySummaryItem(entry: InventoryEntry): HTMLElement {
  const item = document.createElement("li");
  const icon = document.createElement("span");
  icon.className = "inventory-icon";
  applyInventoryIcon(icon, entry.contentId);
  const body = document.createElement("span");
  body.className = "end-inventory-body";
  const title = document.createElement("strong");
  title.textContent = `${getContentName(entry.contentId)} x${entry.quantity}${entry.equipped ? " / 装備中" : ""}`;
  const details = document.createElement("span");
  details.textContent = itemSummaryText(entry.contentId);
  body.append(title, details);
  item.append(icon, body);
  return item;
}

function itemSummaryText(contentId: string): string {
  const content = contentEntities[contentId];
  const rows = itemDetailTextRows(contentId);
  const parts = [
    content?.description.ja,
    ...rows.map(([label, value]) => `${label}: ${value}`),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "詳細情報なし";
}

function renderRunReview(review: RunReview): void {
  const findings = review.keyFindings.slice(0, 5);
  const hints = review.aiImprovementHints.slice(0, 5);
  const turns = review.lastTurns.slice(-6).map((entry) => {
    const messages = entry.messageDelta.map((message) => message.text).join(" / ");
    return `#${entry.index + 1} F${entry.floor} T${entry.turn}: ${describeAction(entry.action)}${messages ? ` - ${messages}` : ""}`;
  });
  endReview.replaceChildren(
    sectionBlock("敗因", [review.summaryText, ...findings]),
    sectionBlock("直前の流れ", turns.length > 0 ? turns : ["記録された直前行動はありません。"]),
    sectionBlock("改善ヒント", hints),
  );
}

function sectionBlock(title: string, lines: string[]): HTMLElement {
  const section = document.createElement("section");
  const heading = document.createElement("h3");
  heading.textContent = title;
  const list = document.createElement("ul");
  for (const line of lines) {
    const item = document.createElement("li");
    item.textContent = line;
    list.append(item);
  }
  section.append(heading, list);
  return section;
}

function actionForKey(key: string): GameAction | null {
  const moveKeys: Record<string, Direction> = {
    ArrowUp: "north",
    ArrowDown: "south",
    ArrowLeft: "west",
    ArrowRight: "east",
    w: "north",
    s: "south",
    a: "west",
    d: "east",
    q: "northwest",
    e: "northeast",
    z: "southwest",
    c: "southeast",
  };
  const direction = moveKeys[key];
  if (direction) {
    return { type: "move", direction };
  }
  if (key === "g" || key === "G") {
    return { type: "pickup" };
  }
  if ((key === "x" || key === "X") && selectedInventoryContentId) {
    return { type: "dropItem", contentId: selectedInventoryContentId };
  }
  if (key === " " || key === ".") {
    return { type: "wait" };
  }
  if (key === "Enter") {
    return { type: "descend" };
  }
  if (key === "1") {
    const player = state.entities.find((entity) => entity.id === state.playerId);
    const potion = [...(player?.inventory ?? [])]
      .filter((entry) => (getGameConfig().consumables[entry.contentId]?.heal ?? 0) > 0 && !getGameConfig().consumables[entry.contentId]?.cureConditions && entry.quantity > 0)
      .sort((a, b) => (getGameConfig().consumables[b.contentId]?.heal ?? 0) - (getGameConfig().consumables[a.contentId]?.heal ?? 0))[0];
    return { type: "useItem", contentId: potion?.contentId ?? "item.ember-tonic" };
  }
  if (key === "2") {
    return { type: "useItem", contentId: "item.mapping-scroll" };
  }
  if (key === "3") {
    return { type: "useItem", contentId: "item.ember-dart" };
  }
  if (key === "4") {
    return { type: "useItem", contentId: "item.guardian-draught" };
  }
  if (key === "5") {
    return { type: "useItem", contentId: "item.repulsion-scroll" };
  }
  if (key === "6") {
    return { type: "useItem", contentId: "item.glim-map" };
  }
  if (key === "7") {
    return { type: "useItem", contentId: "item.bloodmoss-salve" };
  }
  if (key === "r" || key === "R") {
    resetGame();
    return null;
  }
  return null;
}

function syncSelectedInventory(inventory: NonNullable<GameState["entities"][number]["inventory"]>): void {
  if (!inventory.some((entry) => entry.contentId === selectedInventoryContentId)) {
    selectedInventoryContentId = inventory[0]?.contentId ?? null;
  }

  if (!selectedInventoryContentId) {
    selectedItemActionButton.disabled = true;
    selectedItemDropButton.disabled = true;
    selectedItemActionButton.textContent = "所持品を選択";
    selectedItemDropButton.textContent = "捨てる";
    return;
  }

  selectedItemActionButton.disabled = false;
  selectedItemDropButton.disabled = false;
  selectedItemActionButton.textContent = `${getInventoryActionLabel(selectedInventoryContentId)}: ${getContentName(selectedInventoryContentId)}`;
  selectedItemDropButton.textContent = `捨てる: ${getContentName(selectedInventoryContentId)}`;
}

function getInventoryActionLabel(contentId: string): string {
  const tags = contentEntities[contentId]?.tags ?? [];
  if (tags.includes("weapon") || tags.includes("armor") || tags.includes("shield")) {
    return "装備";
  }
  return "使う";
}

function showItemPopover(contentId: string | null): void {
  if (!contentId) {
    itemPopover.hidden = true;
    return;
  }

  const content = contentEntities[contentId];
  const player = state.entities.find((entity) => entity.id === state.playerId);
  const entry = player?.inventory?.find((inventoryEntry) => inventoryEntry.contentId === contentId);
  if (!content || !entry) {
    itemPopover.hidden = true;
    return;
  }

  applyInventoryIcon(itemPopoverIcon, contentId, 48);
  itemPopoverTitle.textContent = content.names.ja;
  itemPopoverMeta.textContent = itemMetaLabel(contentId, entry.equipped);
  itemPopoverDescription.textContent = content.description.ja;
  itemPopoverStats.replaceChildren(...itemDetailRows(contentId));
  itemPopover.hidden = false;
}

function itemMetaLabel(contentId: string, equipped?: boolean): string {
  const content = contentEntities[contentId];
  const labels = [
    content?.balance.tier ? tierLabel(content.balance.tier) : null,
    content?.balance.rarity ? rarityLabel(content.balance.rarity) : null,
    equipped ? "装備中" : null,
  ].filter(Boolean);
  return labels.join(" / ");
}

function itemDetailRows(contentId: string): HTMLElement[] {
  return itemDetailTextRows(contentId).flatMap(([label, value]) => {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    return [dt, dd];
  });
}

function itemDetailTextRows(contentId: string): Array<[string, string]> {
  const content = contentEntities[contentId];
  if (!content) {
    return [];
  }
  const rows: Array<[string, string]> = [];
  const equipment = getGameConfig().equipment[contentId];
  if (equipment) {
    rows.push(["装備", equipmentDetailLabel(equipment)]);
  }
  const hooks = content.simulation.hooks ?? [];
  if (hooks.length > 0) {
    rows.push(["効果", hooks.map(itemHookLabel).join(" / ")]);
  }
  if (content.balance.utility !== undefined) {
    rows.push(["有用度", String(content.balance.utility)]);
  }
  if (content.balance.economyValue !== undefined) {
    rows.push(["価値", `${content.balance.economyValue} Gold相当`]);
  }
  if (content.tags.length > 0) {
    rows.push(["分類", content.tags.join(" / ")]);
  }
  return rows;
}

function equipmentDetailLabel(equipment: ReturnType<typeof getGameConfig>["equipment"][string]): string {
  const details = [`${equipment.slot} +${equipment.power}`];
  if (equipment.rangedDefense) {
    details.push(`遠隔防御 +${equipment.rangedDefense}`);
  }
  if (equipment.trapAvoidPercent) {
    details.push(`罠回避 +${equipment.trapAvoidPercent}%`);
  }
  if (equipment.trapAvoidPenaltyPercent) {
    details.push(`罠回避 -${equipment.trapAvoidPenaltyPercent}%`);
  }
  if (equipment.specialDamage) {
    details.push(`${equipment.specialDamage.families.join("/")}へ追加 ${equipment.specialDamage.amount}`);
  }
  return details.join(" / ");
}

function itemHookLabel(hook: string): string {
  if (hook.startsWith("attack+")) {
    return `攻撃 +${hook.slice("attack+".length)}`;
  }
  if (hook.startsWith("defense+")) {
    return `防御 +${hook.slice("defense+".length)}`;
  }
  if (hook.startsWith("heal+")) {
    return `HP ${hook.slice("heal+".length)}回復`;
  }
  if (hook.startsWith("ranged-damage+")) {
    return `遠隔 ${hook.slice("ranged-damage+".length)}ダメージ`;
  }
  if (hook.startsWith("ranged-defense+")) {
    return `遠隔防御 +${hook.slice("ranged-defense+".length)}`;
  }
  if (hook.startsWith("trap-avoid+")) {
    return `罠回避 +${hook.slice("trap-avoid+".length)}%`;
  }
  if (hook.startsWith("trap-avoid-")) {
    return `罠回避 -${hook.slice("trap-avoid-".length)}%`;
  }
  if (hook.startsWith("temporary-defense+")) {
    return `一時防御 +${hook.slice("temporary-defense+".length)}`;
  }

  const labels: Record<string, string> = {
    "bonus-vs-undead-demon-cult": "不死・悪魔・異端者に有利",
    "bonus-vs-undead-demon": "不死・悪魔に有利",
    bleed: "出血の危険",
    "cure-bleed-poison": "出血・毒を治療",
    "cure-conditions": "状態異常を治療",
    gold: "Goldを得る",
    "map-floor": "階層全体を探索済みにする",
    "map-nearby": "周辺を探索済みにする",
    "map-wide": "広範囲を探索済みにする",
    "push-visible-enemies": "見えている敵を押し戻す",
    "regen-every-10-turns": "10ターンごとにHP回復",
    score: "Goldを得る",
    shop: "商人との取引",
    "guard-or-reveal-or-curse": "護り・探索・呪いのいずれか",
    "heal-or-harm": "回復または害",
    "unknown-effect": "使うまで効果不明",
    "adds-cover": "遮蔽を追加",
    "adds-trap": "罠を追加",
    loot: "物資を出す",
    "map-reward": "地図報酬",
    "monster-guard": "守り手が出現",
    "room-reveal": "部屋周辺を探索済みにする",
    "room-undead": "亡者が出現",
    "weapon-loot": "武器を入手する可能性",
    "xp+6": "経験値 +6",
  };
  return labels[hook] ?? hook;
}

function tierLabel(tier: Tier): string {
  switch (tier) {
    case "early":
      return "序盤";
    case "mid":
      return "中盤";
    case "late":
      return "終盤";
    case "boss":
      return "特別";
  }
}

function rarityLabel(rarity: Rarity): string {
  switch (rarity) {
    case "common":
      return "一般";
    case "uncommon":
      return "良品";
    case "rare":
      return "希少";
    case "special":
      return "特殊";
  }
}

function describeAction(action: GameAction): string {
  switch (action.type) {
    case "move":
      return `${action.direction}へ移動`;
    case "pickup":
      return "足元のアイテムを拾う";
    case "useItem":
      return `${getContentName(action.contentId)}を使う`;
    case "merchantService":
      return `商人サービス: ${merchantServiceActionLabel(action.serviceId)}`;
    case "equip":
      return `${getContentName(action.contentId)}を装備`;
    case "dropItem":
      return `${getContentName(action.contentId)}を捨てる`;
    case "descend":
      return "階段を降りる";
    case "wait":
      return "待機";
  }
}

function shouldLogAutoplayAction(action: GameAction): boolean {
  return action.type !== "move";
}

function merchantServiceActionLabel(serviceId: MerchantServiceId): string {
  if (serviceId === "heal") {
    return "回復";
  }
  if (serviceId === "cure") {
    return "解毒・止血";
  }
  if (serviceId === "equipment") {
    return "装備購入";
  }
  return "地図購入";
}

function statusLabel(status: GameState["status"]): string {
  if (status === "won") {
    return "踏破";
  }
  if (status === "lost") {
    return "敗北";
  }
  return "探索中";
}

function conditionLabel(conditions: GameState["entities"][number]["conditions"]): string {
  const active = conditions?.filter((condition) => condition.turns > 0) ?? [];
  if (active.length === 0) {
    return "なし";
  }
  return active
    .map((condition) => {
      if (condition.kind === "guarded") {
        return `護り${condition.turns}`;
      }
      if (condition.kind === "bleeding") {
        return `出血${condition.turns}`;
      }
      return `毒${condition.turns}`;
    })
    .join(" / ");
}

function roleGoalLabel(roleId: string, progress: number): string {
  if (roleId === "role.oathbound") {
    return `誓約報酬 ${progress}`;
  }
  if (roleId === "role.ash-scout") {
    return `斥候術 ${progress}`;
  }
  if (roleId === "role.lantern-priest") {
    return `浄化護り ${progress}`;
  }
  return String(progress);
}

function applyInventoryIcon(element: HTMLElement, contentId: string, iconSize = 24): void {
  const asset = assetForContent(contentId);
  if (!asset?.path || !asset.sheet) {
    element.style.backgroundImage = "";
    element.style.backgroundSize = "";
    element.style.backgroundPosition = "";
    return;
  }

  const col = asset.sheet.index % asset.sheet.columns;
  const row = Math.floor(asset.sheet.index / asset.sheet.columns);
  element.style.backgroundImage = `url(${publicAssetPath(asset.path)})`;
  element.style.backgroundSize = `${asset.sheet.columns * iconSize}px ${asset.sheet.rows * iconSize}px`;
  element.style.backgroundPosition = `-${col * iconSize}px -${row * iconSize}px`;
}

function publicAssetPath(path: string): string {
  if (!path.startsWith("/")) {
    return path;
  }
  return `${import.meta.env.BASE_URL}${path.slice(1)}`;
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }
  return element;
}
