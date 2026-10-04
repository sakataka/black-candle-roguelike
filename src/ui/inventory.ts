import { getGameConfig } from "../game/content/config";
import { assetForContent } from "../game/content/assets";
import { getContentName } from "../game/content/entities";
import type { Entity } from "../game/types";
import { escapeHtml, requireElement, setText } from "./dom";
import { equipmentSlotLabel } from "./labels";
import { applySprite } from "./sprites";

export function renderInventory(inventory: NonNullable<Entity["inventory"]>, observerShell: HTMLElement): void {
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
  const active = document.activeElement;
  const focusedItem = active instanceof HTMLElement && list.contains(active) ? active.dataset.itemId : null;
  list.dataset.signature = signature;
  if (carried.length === 0) {
    list.innerHTML = '<li class="empty-state">携行品なし</li>';
    if (focusedItem) {
      setText("#inventory-caption", "");
      observerShell.focus({ preventScroll: true });
    }
    return;
  }
  list.replaceChildren(...carried.map((entry) => {
    const item = document.createElement("li");
    const label = `${getContentName(entry.contentId)} ×${entry.quantity}`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "inventory-slot";
    button.dataset.itemId = entry.contentId;
    button.dataset.itemLabel = label;
    button.title = label;
    button.setAttribute("aria-label", label);
    const icon = document.createElement("span");
    icon.className = "inventory-icon";
    icon.setAttribute("aria-hidden", "true");
    applySprite(icon, assetForContent(entry.contentId), 36);
    button.append(icon);
    if (entry.quantity > 1) {
      const quantity = document.createElement("b");
      quantity.textContent = String(entry.quantity);
      button.append(quantity);
    }
    item.append(button);
    return item;
  }));
  // 遠征が進んで携行品が増減しても、読んでいた品からフォーカスを失わない。
  if (focusedItem) {
    const next = list.querySelector<HTMLButtonElement>(`[data-item-id="${CSS.escape(focusedItem)}"]`) ?? list.querySelector<HTMLButtonElement>("button");
    next?.focus({ preventScroll: true });
  }
}

/** 「黒燭への道」。大目標を章で並べ、次の章だけ詳しく書く。 */
