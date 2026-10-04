import { assetForContent } from "../game/content/assets";
import type { RunInsights } from "../game/core/runInsights";
import { escapeHtml } from "./dom";
import { spriteStyle } from "./sprites";

export function renderRunInsights(runInsightsPanel: HTMLElement, insights: RunInsights, selectedTactics: string[]): void {
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
