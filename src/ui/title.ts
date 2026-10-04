import "./title.css";

export type TitleLedger = {
  cycle: number;
  expeditions: number;
  highestFloor: number;
  shards: number;
  /** 使用中の記録の名前。 */
  slotName: string;
  slots: SaveSlotSummary[];
  maxSlots: number;
};

/** タイトルの「記録を選ぶ」に並べる、各記録の現状。 */
export type SaveSlotSummary = {
  id: string;
  name: string;
  active: boolean;
  cycle: number;
  expeditions: number;
  highestFloor: number;
  shards: number;
  roster: number;
  roadmapDone: number;
  roadmapTotal: number;
  /** 次に目指す章。全章を終えていれば null。 */
  nextGoal: string | null;
  playedAt?: string;
};

export type TitleSaveActions = {
  /** 別の記録に切り替える（読み直す）。 */
  select: (slotId: string) => void;
  /** 新しい記録を作って始める（読み直す）。 */
  create: () => void;
  /** 使用中でない記録を消し、残った記録の現状を返す。 */
  remove: (slotId: string) => SaveSlotSummary[];
};

const KEYART_PATH = "assets/art/title-keyart.jpg";
/** キーアート上の炎の位置（画像に対する比率）。火の粉と光の中心に使う。 */
const FLAME = { x: 0.544, y: 0.385 };
const KANJI_DIGITS = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

/**
 * 起動時のタイトル。キーアートの蝋燭に火の粉と揺らぎを重ね、灯を掲げると支度の画面へ溶ける。
 * 設定やレンダラーの準備より先に出し、遠征録は届いた時点で書き込む。
 * 灯を掲げても `ready` が済むまでは退場せず、準備途中の下の画面を見せない。
 * 解決するのは退場演出が始まった時点で、下の画面はその間に入場演出を始められる。
 */
export function showTitle(ledger: Promise<TitleLedger>, ready: Promise<unknown>, actions: TitleSaveActions, autoEnter = false): Promise<void> {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const root = document.createElement("section");
  root.className = "title-screen";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "title-logo");
  root.innerHTML = `
    <div class="title-art" aria-hidden="true">
      <div class="title-art-frame">
        <img src="${import.meta.env.BASE_URL}${KEYART_PATH}" alt="" decoding="async" fetchpriority="high" />
        <span class="title-flame-halo"></span>
        <span class="title-flame-glow"></span>
      </div>
    </div>
    <canvas class="title-embers" aria-hidden="true"></canvas>
    <div class="title-veil" aria-hidden="true"></div>
    <div class="title-pointer-light" aria-hidden="true"></div>
    <div class="title-content">
      <p class="title-eyebrow"><span>灰灯院遠征記</span><i aria-hidden="true"></i><span data-cycle></span></p>
      <h1 id="title-logo" class="title-logo" aria-label="黒燭の迷宮">
        ${[..."黒燭の迷宮"].map((char, index) => `<span class="${char === "の" ? "is-particle" : ""}" style="--i:${index}" aria-hidden="true">${char}</span>`).join("")}
      </h1>
      <p class="title-latin" aria-hidden="true">The Labyrinth of the Black Candle</p>
      <span class="title-rule" aria-hidden="true"></span>
      <p class="title-lead">灯守よ。黒い蝋燭ひとつを頼りに、<br />探索者を地の底へ送り出せ。</p>
      <button type="button" class="title-cta">
        <span class="title-cta-wick" aria-hidden="true"><i></i></span>
        <span class="title-cta-label">灯を掲げる</span>
        <kbd>Enter</kbd>
      </button>
      <div data-ledger hidden></div>
      <button type="button" class="title-saves-toggle" data-saves-toggle aria-controls="title-saves" aria-expanded="false" hidden></button>
    </div>
    <section id="title-saves" class="title-saves" data-saves hidden aria-label="記録を選ぶ"></section>
    <p class="title-foot" aria-hidden="true"><span>Press any key</span><span data-cycle-foot></span></p>
  `;
  document.body.append(root);
  const button = root.querySelector<HTMLButtonElement>(".title-cta");
  const stopEmbers = reducedMotion ? () => undefined : runEmbers(root);
  const stopPointer = reducedMotion ? () => undefined : trackPointer(root);
  const image = root.querySelector("img");
  const imageLoaded = new Promise<void>((resolve) => {
    if (image && !image.complete) {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => resolve(), { once: true });
    } else {
      resolve();
    }
  });
  const ledgerWritten = ledger.then((value) => {
    const cycle = `第${toKanji(value.cycle)}周期`;
    root.querySelector("[data-cycle]")!.textContent = cycle;
    root.querySelector("[data-cycle-foot]")!.textContent = `灰と蝋の記録 · ${cycle}`;
    root.querySelector("[data-ledger]")!.outerHTML = ledgerMarkup(value);
    savedLedger = value;
    const toggle = root.querySelector<HTMLButtonElement>("[data-saves-toggle]")!;
    toggle.hidden = false;
    toggle.innerHTML = `<span>${escapeHtml(value.slotName)}</span>記録を選ぶ・新しく始める`;
  }, () => undefined);
  let savedLedger: TitleLedger | null = null;
  const savesPanel = root.querySelector<HTMLElement>("[data-saves]")!;
  const savesToggle = root.querySelector<HTMLButtonElement>("[data-saves-toggle]")!;
  const titleContent = root.querySelector<HTMLElement>(".title-content")!;
  let confirmingDelete: string | null = null;
  const renderSaves = () => {
    if (!savedLedger) return;
    savesPanel.innerHTML = savesMarkup(savedLedger, confirmingDelete);
  };
  const openSaves = (open: boolean) => {
    confirmingDelete = null;
    renderSaves();
    savesPanel.hidden = !open;
    titleContent.inert = open;
    savesToggle.setAttribute("aria-expanded", String(open));
    root.classList.toggle("is-choosing", open);
    if (open) savesPanel.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    else savesToggle.focus({ preventScroll: true });
  };
  savesPanel.addEventListener("click", (event) => {
    event.stopPropagation();
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!target || !savedLedger) return;
    const slotId = target.dataset.slot ?? "";
    if (target.dataset.act === "close") openSaves(false);
    else if (target.dataset.act === "continue") { openSaves(false); leave(); }
    else if (target.dataset.act === "select") actions.select(slotId);
    else if (target.dataset.act === "create") actions.create();
    else if (target.dataset.act === "delete") {
      if (confirmingDelete === slotId) {
        savedLedger = { ...savedLedger, slots: actions.remove(slotId) };
        confirmingDelete = null;
      } else confirmingDelete = slotId;
      renderSaves();
      savesPanel.querySelector<HTMLButtonElement>(`[data-act="delete"][data-slot="${CSS.escape(slotId)}"], [data-act="create"]`)?.focus({ preventScroll: true });
    }
  });
  root.querySelector("[data-saves-toggle]")!.addEventListener("click", (event) => {
    event.stopPropagation();
    openSaves(Boolean(savesPanel.hidden));
  });
  // 遠征録を書き込んでから順に現す。途中で文字が差し替わって見えないようにする。
  void Promise.all([imageLoaded, ledgerWritten]).then(() => requestAnimationFrame(() => root.classList.add("is-ready")));
  requestAnimationFrame(() => button?.focus({ preventScroll: true }));

  let prepared = false;
  let requested = false;
  let leave: () => void = () => undefined;
  return new Promise((resolve) => {
    let leaving = false;
    leave = () => {
      if (leaving) return;
      if (!prepared) {
        requested = true;
        button?.setAttribute("aria-busy", "true");
        return;
      }
      leaving = true;
      root.inert = true;
      window.removeEventListener("keydown", onKey, true);
      root.classList.add("is-leaving");
      resolve();
      window.setTimeout(() => {
        stopEmbers();
        stopPointer();
        root.remove();
      }, reducedMotion ? 200 : 1500);
    };
    // タイトルの間は下の画面のキー操作（番号キーやEnterでの出発）に届かせない。
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      event.stopImmediatePropagation();
      // タイトルと記録一覧のそれぞれで、表示中の操作だけを巡回する。
      if (event.key === "Tab") {
        const scope = savesPanel.hidden ? titleContent : savesPanel;
        const buttons = [...scope.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")]
          .filter((element) => element.getClientRects().length > 0);
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        event.preventDefault();
        buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
        return;
      }
      // 記録の一覧を開いている間は、通常のボタン操作に任せる。Escで閉じる。
      if (!savesPanel.hidden) {
        if (event.key === "Escape") {
          event.preventDefault();
          openSaves(false);
        }
        return;
      }
      // Enter/Space はフォーカス中のボタンを作動させる。記録選択もキーボードで開ける。
      if (event.target instanceof HTMLButtonElement && (event.key === "Enter" || event.key === " ")) {
        if (event.repeat) event.preventDefault();
        return;
      }
      event.preventDefault();
      if (["Escape", "Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
      leave();
    };
    window.addEventListener("keydown", onKey, true);
    root.addEventListener("click", () => {
      if (!savesPanel.hidden) openSaves(false);
      else leave();
    });
    const onPrepared = () => {
      prepared = true;
      if (requested) leave();
    };
    if (autoEnter) leave();
    ready.then(onPrepared, onPrepared);
  });
}

function ledgerMarkup(ledger: TitleLedger): string {
  if (ledger.expeditions === 0) {
    return `<p class="title-ledger is-first">まだ誰も、この灯を掲げていない。</p>`;
  }
  const entries: [string, string][] = [
    ["遠征", `${ledger.expeditions}`],
    ["最深", ledger.highestFloor > 0 ? `${ledger.highestFloor}F` : "—"],
    ["灯片", `${ledger.shards}`],
  ];
  return `<dl class="title-ledger">${entries.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("")}</dl>`;
}

function savesMarkup(ledger: TitleLedger, confirmingDelete: string | null): string {
  const items = ledger.slots.map((slot) => {
    const played = slot.playedAt ? new Date(slot.playedAt) : null;
    const playedLabel = played && !Number.isNaN(played.getTime()) ? `${played.getMonth() + 1}月${played.getDate()}日` : "未出発";
    const stats = slot.expeditions === 0
      ? "<span>まだ遠征していない</span>"
      : `<span>遠征 <b>${slot.expeditions}</b></span><span>最深 <b>${slot.highestFloor}F</b></span><span>灯片 <b>${slot.shards}</b></span><span>遠征団 <b>${slot.roster}</b>人</span>`;
    const confirming = confirmingDelete === slot.id;
    return `<li class="title-save${slot.active ? " is-active" : ""}">
      <div class="title-save-head"><strong>${escapeHtml(slot.name)}</strong><em>第${toKanji(slot.cycle)}周期</em>${slot.active ? '<span class="title-save-badge">使用中</span>' : ""}<small>${playedLabel}</small></div>
      <div class="title-save-road" aria-label="黒燭への道 ${slot.roadmapDone}/${slot.roadmapTotal}"><span class="title-save-steps">${Array.from({ length: slot.roadmapTotal }, (_, index) => `<i class="${index < slot.roadmapDone ? "is-done" : ""}"></i>`).join("")}</span><span>${slot.nextGoal ? `次: ${escapeHtml(slot.nextGoal)}` : "結末を迎えた"}</span></div>
      <div class="title-save-stats">${stats}</div>
      <div class="title-save-actions">
        ${slot.active
          ? `<button type="button" class="title-save-main" data-act="continue" data-slot="${escapeHtml(slot.id)}">この記録で続ける</button>`
          : `<button type="button" class="title-save-main" data-act="select" data-slot="${escapeHtml(slot.id)}">この記録に切り替える</button><button type="button" class="title-save-delete${confirming ? " is-confirming" : ""}" data-act="delete" data-slot="${escapeHtml(slot.id)}">${confirming ? "本当に消す" : "消す"}</button>`}
      </div>
    </li>`;
  }).join("");
  const full = ledger.slots.length >= ledger.maxSlots;
  return `
    <header class="title-saves-head"><h2>記録を選ぶ</h2><small>記録ごとに灰灯院（灯片・遠征団・真相・周期）が別になる。</small><button type="button" class="title-saves-close" data-act="close" aria-label="閉じる">×</button></header>
    <ol class="title-save-list">${items}</ol>
    <button type="button" class="title-save-new" data-act="create"${full ? " disabled" : ""}>${full ? `記録は${ledger.maxSlots}つまで。不要な記録を消すと新しく始められる` : "＋ 新しい記録を始める（第一周期・灯片0から）"}</button>
  `;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

function toKanji(value: number): string {
  if (value <= 10) return KANJI_DIGITS[Math.max(0, value)];
  if (value < 20) return `十${KANJI_DIGITS[value - 10]}`;
  if (value < 100) return `${KANJI_DIGITS[Math.floor(value / 10)]}十${value % 10 ? KANJI_DIGITS[value % 10] : ""}`;
  return String(value);
}

/** カーソルの位置を第二の灯として扱い、絵をわずかに奥へずらす。 */
function trackPointer(root: HTMLElement): () => void {
  let frame = 0;
  let target = { x: 0.5, y: 0.5 };
  const current = { x: 0.5, y: 0.5 };
  const onMove = (event: PointerEvent) => {
    target = { x: event.clientX / window.innerWidth, y: event.clientY / window.innerHeight };
    root.classList.add("has-pointer");
  };
  const tick = () => {
    current.x += (target.x - current.x) * 0.06;
    current.y += (target.y - current.y) * 0.06;
    root.style.setProperty("--px", `${(current.x * 100).toFixed(2)}%`);
    root.style.setProperty("--py", `${(current.y * 100).toFixed(2)}%`);
    root.style.setProperty("--tilt-x", (current.x - 0.5).toFixed(4));
    root.style.setProperty("--tilt-y", (current.y - 0.5).toFixed(4));
    frame = requestAnimationFrame(tick);
  };
  window.addEventListener("pointermove", onMove);
  frame = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("pointermove", onMove);
  };
}

type Ember = { x: number; y: number; vx: number; vy: number; life: number; age: number; size: number; heat: number; seed: number };

/** 炎から昇る火の粉と、画面の下から漂う灰。 */
function runEmbers(root: HTMLElement): () => void {
  const canvas = root.querySelector<HTMLCanvasElement>(".title-embers");
  const frameBox = root.querySelector<HTMLElement>(".title-art-frame");
  const context = canvas?.getContext("2d");
  if (!canvas || !context || !frameBox) return () => undefined;
  const embers: Ember[] = [];
  let width = 0;
  let height = 0;
  let ratio = 1;
  let flame = { x: 0, y: 0, scale: 1 };
  let frame = 0;
  let last = performance.now();
  const resize = () => {
    ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  };
  const spawn = (fromFlame: boolean): Ember => fromFlame
    ? { x: flame.x + (Math.random() - 0.5) * 18 * flame.scale, y: flame.y + 6 * flame.scale, vx: (Math.random() - 0.5) * 34, vy: -(18 + Math.random() * 40), life: 2200 + Math.random() * 2600, age: 0, size: 0.6 + Math.random() * 1.5, heat: 1, seed: Math.random() * 100 }
    : { x: Math.random() * width, y: height + 10, vx: (Math.random() - 0.5) * 10, vy: -(8 + Math.random() * 18), life: 7000 + Math.random() * 7000, age: 0, size: 0.5 + Math.random() * 1.6, heat: Math.random() * 0.5, seed: Math.random() * 100 };
  const tick = (now: number) => {
    const delta = Math.min(50, now - last);
    last = now;
    const seconds = delta / 1000;
    // 視差と緩いズームで絵が動くので、炎の位置は毎フレーム取り直す。
    const box = frameBox.getBoundingClientRect();
    flame = { x: box.left + box.width * FLAME.x, y: box.top + box.height * FLAME.y, scale: box.width / 1536 };
    if (embers.length < 70 && Math.random() < 0.16) embers.push(spawn(true));
    if (embers.length < 140 && Math.random() < 0.12) embers.push(spawn(false));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.globalCompositeOperation = "lighter";
    for (let index = embers.length - 1; index >= 0; index -= 1) {
      const ember = embers[index];
      ember.age += delta;
      if (ember.age >= ember.life || ember.y < -20) {
        embers.splice(index, 1);
        continue;
      }
      const t = ember.age / ember.life;
      ember.vx += Math.sin(now / 700 + ember.seed) * 22 * seconds;
      ember.vx *= 1 - 0.4 * seconds;
      ember.x += ember.vx * seconds;
      ember.y += ember.vy * seconds;
      const heat = ember.heat * (1 - t);
      const alpha = Math.min(1, ember.age / 400) * (1 - t) * (0.35 + Math.sin(now / 90 + ember.seed) * 0.15 + 0.5);
      const radius = ember.size * (1 + heat * 0.6);
      const red = 255;
      const green = Math.round(120 + heat * 110);
      const blue = Math.round(60 + heat * 60);
      const gradient = context.createRadialGradient(ember.x, ember.y, 0, ember.x, ember.y, radius * 4);
      gradient.addColorStop(0, `rgba(${red},${green},${blue},${alpha})`);
      gradient.addColorStop(0.3, `rgba(${red},${green - 30},${blue - 30},${alpha * 0.35})`);
      gradient.addColorStop(1, "rgba(255,120,40,0)");
      context.fillStyle = gradient;
      context.fillRect(ember.x - radius * 4, ember.y - radius * 4, radius * 8, radius * 8);
    }
    frame = requestAnimationFrame(tick);
  };
  resize();
  window.addEventListener("resize", resize);
  frame = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", resize);
  };
}
