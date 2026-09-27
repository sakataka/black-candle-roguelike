import { beforeAll, describe, expect, test } from "bun:test";
import { loadBunGameConfig, runRules } from "../content/config";
import { campaignRunModifiers, createCampaignState, createRunIdentity, pendingGraves, recordCampaignResult, runShardBonusPercent } from "./autonomous";
import { applyAction, createInitialGame, observeGame } from "./game";

beforeAll(async () => {
  await loadBunGameConfig("public/config/game-balance.json");
});

function startFrom(campaign: ReturnType<typeof createCampaignState>, seed = 20260504) {
  const carried = campaignRunModifiers(campaign);
  return createInitialGame(seed, "role.oathbound", {
    identity: createRunIdentity(seed, "role.oathbound"),
    modifiers: { ...carried.modifiers, tacticSlots: 2, rank: 0, scars: [] },
    bonusEmbers: carried.bonusEmbers,
    bonusMaxEmbers: carried.bonusMaxEmbers,
  });
}

describe("クリア後の周期", () => {
  test("燭階は勝利で次の段が開き、選んだ段の制約と灯片の上乗せが重なる", () => {
    const won = createInitialGame(20260504, "role.oathbound");
    won.status = "won";
    let campaign = recordCampaignResult(createCampaignState(), won, null);
    expect(campaign.heat.unlocked).toBe(1);
    campaign = { ...campaign, heat: { unlocked: 3, selected: 2 } };
    const state = startFrom(campaign);
    expect(state.modifiers.heat).toBe(2);
    expect(state.lantern.embers).toBe(2);
    expect(runRules(state.modifiers).monsterHpScale).toBeGreaterThan(runRules().monsterHpScale);
    expect(runShardBonusPercent(2)).toBe(30);
  });

  test("結末を選ぶと周期が進み、余波が次の遠征を変える", () => {
    const ending = createInitialGame(20260504, "role.oathbound");
    ending.status = "won";
    ending.story.endingId = "extinguish-flame";
    let campaign = recordCampaignResult(createCampaignState(), ending, null);
    expect(campaign.cycle).toEqual({ number: 2, aftermath: "extinguish-flame", keeperName: undefined });
    expect(runRules(startFrom(campaign).modifiers).fovRadius).toBe(runRules().fovRadius - 2);

    const inherit = createInitialGame(20260505, "role.oathbound");
    inherit.status = "won";
    inherit.story.endingId = "inherit-flame";
    campaign = recordCampaignResult(campaign, inherit, null);
    expect(campaign.cycle.keeperName).toBe(inherit.runIdentity.name);
    expect(campaign.roster.some((veteran) => veteran.id === `veteran-20260505-role.oathbound`)).toBe(false);
    const next = startFrom(campaign);
    expect(next.modifiers.bossOverride?.contentId).toBe("monster.fallen-keeper");
  });

  test("倒れた探索者は倒れた階に墓標を残し、弔うと遺品を受け継いで記録される", () => {
    const fallen = createInitialGame(20260504, "role.oathbound");
    fallen.status = "lost";
    let campaign = recordCampaignResult(createCampaignState(), fallen, "combat");
    const graves = pendingGraves(campaign);
    expect(graves).toHaveLength(1);
    expect(graves[0].floor).toBe(1);

    let state = startFrom(campaign, 20260509);
    const marker = state.entities.find((entity) => entity.contentId === "event.grave-marker");
    expect(marker).toBeDefined();
    const player = state.entities.find((entity) => entity.id === state.playerId);
    if (!marker || !player) throw new Error("missing entities");
    // 墓標の隣へ移し、踏ませて弔う
    const neighbor = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]
      .map((delta) => ({ x: marker.pos.x + delta.x, y: marker.pos.y + delta.y, delta }))
      .find((point) => state.tiles[point.y * state.width + point.x].kind === "floor" && !state.entities.some((entity) => entity.blocksMovement && entity.pos.x === point.x && entity.pos.y === point.y));
    if (!neighbor) throw new Error("no neighbor");
    player.pos = { x: neighbor.x, y: neighbor.y };
    const direction = neighbor.delta.x === 1 ? "west" : neighbor.delta.x === -1 ? "east" : neighbor.delta.y === 1 ? "north" : "south";
    state = applyAction(state, { type: "move", direction });
    expect(state.story.recoveredGraves).toEqual([graves[0].id]);
    expect(observeGame(state).status).toBe("playing");
    state.status = "returned";
    campaign = recordCampaignResult(campaign, state, null);
    expect(pendingGraves(campaign)).toHaveLength(0);
    expect(campaign.expeditions[0].gravesRecovered).toBe(1);
  });
});
