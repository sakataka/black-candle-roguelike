import "./guide.css";
import { assetForContent } from "../game/content/assets";
import { getGameConfig } from "../game/content/config";
import { contentDescriptions } from "../game/content/descriptions";
import { contentEntities, getContentName } from "../game/content/entities";
import { familyLabels, guideChapters, roleGuides } from "../game/content/guide";
import type { Tier } from "../game/types";
import { escapeHtml } from "./dom";
import { weaponTypeLabels } from "./labels";
import { spriteStyle } from "./sprites";

// 遊び方と図鑑。ルールは content/guide.ts、各項目の説明は content/descriptions.ts から作る。
// 遠征中に開いても遠征は止めない（一時停止を作らない方針）。

type GuideTab = { id: string; label: string; render: () => string };

const tabs: GuideTab[] = [
  { id: "rules", label: "遊び方", render: renderRules },
  { id: "roles", label: "職業", render: renderRoles },
  { id: "equipment", label: "装備", render: renderEquipment },
  { id: "items", label: "道具", render: renderItems },
  { id: "monsters", label: "敵", render: renderMonsters },
  { id: "places", label: "部屋と罠", render: renderPlaces },
];

let dialog: HTMLDialogElement | null = null;

export function isGuideOpen(): boolean {
  return dialog?.open ?? false;
}

export function openGuide(options: { duringRun?: boolean } = {}): void {
  dialog ??= createDialog();
  dialog.querySelector<HTMLElement>(".guide-running")!.hidden = !options.duringRun;
  dialog.showModal();
  dialog.querySelector<HTMLButtonElement>(".guide-tab.is-active")?.focus();
}

function createDialog(): HTMLDialogElement {
  const element = document.createElement("dialog");
  element.className = "guide-dialog";
  element.setAttribute("aria-labelledby", "guide-title");
  element.innerHTML = `
    <div class="guide-panel">
      <header class="guide-header">
        <div>
          <p class="eyebrow">灰灯院の手引き</p>
          <h2 id="guide-title">遊び方と図鑑</h2>
          <p class="guide-running" hidden>遠征は進み続けています。</p>
        </div>
        <button type="button" class="secondary-button guide-close" aria-label="閉じる">閉じる <kbd>Esc</kbd></button>
      </header>
      <nav class="guide-tabs" role="tablist" aria-label="手引きの項目">
        ${tabs.map((tab, index) => `<button type="button" role="tab" class="guide-tab${index === 0 ? " is-active" : ""}" id="guide-tab-${tab.id}" aria-controls="guide-panel-${tab.id}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}" data-tab="${tab.id}">${tab.label}</button>`).join("")}
      </nav>
      <div class="guide-body">
        ${tabs.map((tab, index) => `<section class="guide-tabpanel" role="tabpanel" id="guide-panel-${tab.id}" aria-labelledby="guide-tab-${tab.id}"${index === 0 ? "" : " hidden"}>${tab.render()}</section>`).join("")}
      </div>
    </div>`;
  element.querySelector(".guide-close")!.addEventListener("click", () => element.close());
  // 枠の外（背景）を押したら閉じる。
  element.addEventListener("click", (event) => {
    if (event.target === element) element.close();
  });
  const tabButtons = [...element.querySelectorAll<HTMLButtonElement>(".guide-tab")];
  const select = (button: HTMLButtonElement) => {
    for (const candidate of tabButtons) {
      const active = candidate === button;
      candidate.classList.toggle("is-active", active);
      candidate.setAttribute("aria-selected", String(active));
      candidate.tabIndex = active ? 0 : -1;
      element.querySelector<HTMLElement>(`#guide-panel-${candidate.dataset.tab}`)!.hidden = !active;
    }
    element.querySelector(".guide-body")!.scrollTop = 0;
    button.focus();
  };
  for (const button of tabButtons) button.addEventListener("click", () => select(button));
  element.querySelector(".guide-tabs")!.addEventListener("keydown", (event) => {
    const key = (event as KeyboardEvent).key;
    if (key !== "ArrowRight" && key !== "ArrowLeft") return;
    const index = tabButtons.findIndex((button) => button.classList.contains("is-active"));
    const next = tabButtons[(index + (key === "ArrowRight" ? 1 : tabButtons.length - 1)) % tabButtons.length];
    event.preventDefault();
    select(next);
  });
  element.querySelector(".guide-body")!.addEventListener("click", (event) => {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[data-chapter]");
    if (!link) return;
    event.preventDefault();
    element.querySelector(`#guide-chapter-${link.dataset.chapter}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  });
  document.body.append(element);
  return element;
}

function renderRules(): string {
  const index = `<ol class="guide-index">${guideChapters.map((chapter) => `<li><a href="#guide-chapter-${chapter.id}" data-chapter="${chapter.id}">${escapeHtml(chapter.title)}</a></li>`).join("")}</ol>`;
  const chapters = guideChapters.map((chapter) => `
    <section class="guide-chapter" id="guide-chapter-${chapter.id}">
      <h3>${escapeHtml(chapter.title)}</h3>
      <p class="guide-lead">${escapeHtml(chapter.lead)}</p>
      ${chapter.topics.map((topic) => `<div class="guide-topic"><h4>${escapeHtml(topic.title)}</h4>${topic.body.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</div>`).join("")}
    </section>`).join("");
  return index + chapters;
}

function renderRoles(): string {
  const config = getGameConfig();
  return `<p class="guide-intro">職業によって得意な戦い方が違う。迷ったらナイトから始めるとよい。</p>
    <div class="guide-roles">${config.roles.map((role) => {
      const guide = roleGuides[role.id];
      const skill = role.traits.skill ? config.skills[role.traits.skill] : undefined;
      const starting = role.inventory.map((entry) => `${getContentName(entry.contentId)}${entry.quantity > 1 ? `×${entry.quantity}` : ""}`).join("、");
      return `<article class="guide-role">
        <header>${portrait(role.id, 64)}<div><h3>${escapeHtml(getContentName(role.id))}</h3><p>${escapeHtml(contentDescriptions[role.id] ?? "")}</p></div></header>
        ${guide ? `<p class="guide-role-style">${escapeHtml(guide.style)}</p>
        <div class="guide-role-traits">
          <div><h4>得意</h4><ul>${guide.strengths.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul></div>
          <div><h4>苦手</h4><ul>${guide.weaknesses.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul></div>
        </div>` : ""}
        <dl class="guide-facts">
          ${role.traits.weaponMastery ? `<dt>得意な武器</dt><dd>${escapeHtml(weaponTypeLabels(role.traits.weaponMastery.types))}</dd>` : ""}
          ${skill ? `<dt>固有技</dt><dd><b>${escapeHtml(skill.label)}</b>　${escapeHtml(skill.description)}</dd>` : ""}
          <dt>初期装備</dt><dd>${escapeHtml(starting)}</dd>
        </dl>
      </article>`;
    }).join("")}</div>`;
}

function renderEquipment(): string {
  const config = getGameConfig();
  const typeEntries = Object.entries(config.weaponTypes) as [string, { label: string; description: string }][];
  const weapons = typeEntries.map(([type, definition]) => {
    const ids = Object.keys(contentDescriptions).filter((id) => config.equipment[id]?.weaponType === type);
    return `<section class="guide-group"><h3>${escapeHtml(definition.label)}<small>${escapeHtml(definition.description)}</small></h3>${entries(ids, (id) => config.equipment[id]?.twoHanded ? ["両手"] : [])}</section>`;
  }).join("");
  const slotGroups: [string, string][] = [["armor", "防具"], ["shield", "盾"], ["ring", "指輪"]];
  const gear = slotGroups.map(([slot, label]) => {
    const ids = Object.keys(contentDescriptions).filter((id) => config.equipment[id]?.slot === slot);
    return `<section class="guide-group"><h3>${label}</h3>${entries(ids)}</section>`;
  }).join("");
  const seals = Object.values(config.seals).map((seal) => `<li><span class="guide-seal">${escapeHtml(seal.glyph)}</span><b>${escapeHtml(seal.label)}</b>${escapeHtml(seal.description)}</li>`).join("");
  return `<p class="guide-intro">武器は型ごとに戦い方が変わる。探索者は自分で装備を比べて持ち替える。</p>
    ${weapons}${gear}
    <section class="guide-group"><h3>印<small>装備に付く特別な効果。深い階ほど付きやすい。</small></h3><ul class="guide-seals">${seals}</ul></section>`;
}

function renderItems(): string {
  const config = getGameConfig();
  const ids = Object.keys(contentDescriptions).filter((id) => id.startsWith("item.") && !config.equipment[id]);
  return `<p class="guide-intro">道具は探索者が状況を見て自分で使う。持てる数には限りがある。</p>${entries(ids)}`;
}

const tierGroups: { tier: Tier; label: string; note: string }[] = [
  { tier: "early", label: "浅い階", note: "1階から現れる敵。" },
  { tier: "mid", label: "中ほどの階", note: "墓所のあたりから増える敵。" },
  { tier: "late", label: "深い階", note: "炉心遺跡より先で出会う敵。" },
  { tier: "boss", label: "守り手", note: "3・6・10階で道をふさぐ。遠征ごとに候補から一体が選ばれる。" },
];

function renderMonsters(): string {
  const ids = Object.keys(contentDescriptions).filter((id) => id.startsWith("monster."));
  return `<p class="guide-intro">敵は種類（獣・亡者・邪教・悪魔・ゴーレム）ごとに効く武器や印が違う。</p>
    ${tierGroups.map((group) => `<section class="guide-group"><h3>${group.label}<small>${group.note}</small></h3>${entries(ids.filter((id) => contentEntities[id]?.tier === group.tier), (id) => {
      const family = contentEntities[id]?.family;
      return family ? [familyLabels[family]] : [];
    })}</section>`).join("")}`;
}

function renderPlaces(): string {
  const ids = Object.keys(contentDescriptions);
  return `<section class="guide-group"><h3>部屋と仕掛け<small>探索者が近づくと調べる。</small></h3>${entries(ids.filter((id) => id.startsWith("event.") || id.startsWith("prop.")))}</section>
    <section class="guide-group"><h3>罠<small>見つけた罠は地図に残り、探索者が避ける。</small></h3>${entries(ids.filter((id) => id.startsWith("trap.")))}</section>`;
}

function entries(ids: string[], tags: (id: string) => string[] = () => []): string {
  return `<ul class="guide-entries">${ids.map((id) => `<li class="guide-entry">${portrait(id, 44)}<div><b>${escapeHtml(getContentName(id))}</b>${tags(id).map((tag) => `<span class="guide-tag">${escapeHtml(tag)}</span>`).join("")}<p>${escapeHtml(contentDescriptions[id] ?? "")}</p></div></li>`).join("")}</ul>`;
}

function portrait(contentId: string, size: number): string {
  const asset = assetForContent(contentId);
  return `<span class="guide-portrait" aria-hidden="true" style="width:${size}px;height:${size}px;${asset ? spriteStyle(asset, size) : ""}"></span>`;
}
