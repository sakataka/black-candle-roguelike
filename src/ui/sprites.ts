import type { AssetDefinition } from "../game/types";
import { publicAssetPath } from "../game/content/assets";

export function spriteStyle(asset: AssetDefinition, size: number): string {
  const col = asset.sheet.index % asset.sheet.columns;
  const row = Math.floor(asset.sheet.index / asset.sheet.columns);
  return `background-image:url(${publicAssetPath(asset.path)});background-size:${asset.sheet.columns * size}px ${asset.sheet.rows * size}px;background-position:-${col * size}px -${row * size}px`;
}

export function applySprite(element: HTMLElement, asset: AssetDefinition | null, size: number): void {
  if (!asset) return;
  const col = asset.sheet.index % asset.sheet.columns;
  const row = Math.floor(asset.sheet.index / asset.sheet.columns);
  element.style.backgroundImage = `url(${publicAssetPath(asset.path)})`;
  element.style.backgroundSize = `${asset.sheet.columns * size}px ${asset.sheet.rows * size}px`;
  element.style.backgroundPosition = `-${col * size}px -${row * size}px`;
}
