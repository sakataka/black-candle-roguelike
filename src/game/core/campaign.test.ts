import { beforeAll, describe, expect, test } from "bun:test";
import { loadBunGameConfig } from "../content/config";
import {
  campaignBonusEmbers,
  campaignTacticSlots,
  createCampaignState,
  createRunIdentity,
  recordCampaignResult,
  treatScar,
  unlockedTacticIds,
  upgradeFacility,
} from "./autonomous";
import { createInitialGame } from "./game";

beforeAll(async () => {
  await loadBunGameConfig("public/config/game-balance.json");
});

describe("遠征団と灰灯院", () => {
  test("生還した探索者は古参として残り、倒れた探索者は殉職者に記録される", () => {
    const identity = createRunIdentity(20260504, "role.oathbound");
    const returned = createInitialGame(20260504, "role.oathbound", { identity });
    returned.status = "returned";
    let campaign = recordCampaignResult(createCampaignState(), returned, null);
    expect(campaign.roster).toHaveLength(1);
    expect(campaign.roster[0].rank).toBe(1);
    expect(campaign.shards).toBeGreaterThan(0);

    const veteran = campaign.roster[0];
    const again = createInitialGame(20260505, "role.oathbound", { identity: veteran.identity, modifiers: { rank: veteran.rank } });
    const fresh = createInitialGame(20260505, "role.oathbound", { identity });
    const hp = (state: typeof again) => state.entities.find((entity) => entity.id === state.playerId)?.stats?.maxHp ?? 0;
    expect(hp(again)).toBeGreaterThan(hp(fresh));

    again.status = "lost";
    campaign = recordCampaignResult(campaign, again, "combat");
    expect(campaign.roster).toHaveLength(0);
    expect(campaign.fallen[0].identity.name).toBe(identity.name);
  });

  test("瀕死で帰ると古傷を負い、療房で癒やせる", () => {
    const state = createInitialGame(20260504, "role.ash-scout");
    const player = state.entities.find((entity) => entity.id === state.playerId);
    if (player?.stats) player.stats.hp = 1;
    state.status = "returned";
    let campaign = recordCampaignResult(createCampaignState(), state, null);
    const veteran = campaign.roster[0];
    expect(veteran.scars).toHaveLength(1);
    campaign = { ...campaign, shards: 100 };
    campaign = treatScar(campaign, veteran.id, veteran.scars[0]);
    expect(campaign.roster[0].scars).toHaveLength(0);
  });

  test("施設の強化で作戦枠・開始灯火・作戦カードが増える", () => {
    let campaign = { ...createCampaignState(), shards: 1000 };
    const baseSlots = campaignTacticSlots(campaign);
    const baseTactics = unlockedTacticIds(campaign).length;
    campaign = upgradeFacility(campaign, "war-room");
    campaign = upgradeFacility(campaign, "altar");
    campaign = upgradeFacility(campaign, "archive");
    expect(campaignTacticSlots(campaign)).toBe(baseSlots + 1);
    expect(campaignBonusEmbers(campaign)).toBe(1);
    expect(unlockedTacticIds(campaign).length).toBeGreaterThan(baseTactics);
    const broke = upgradeFacility({ ...createCampaignState(), shards: 0 }, "war-room");
    expect(broke.facilities["war-room"]).toBe(0);
  });
});
