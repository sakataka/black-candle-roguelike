import { beforeAll, describe, expect, test } from "bun:test";
import { getGameConfig, loadBunGameConfig } from "../content/config";
import { abilityEffects, playerTraits } from "./abilities";
import { abilitySlots, normalizeAbilityLoadout, unlockedAbilityIds } from "./abilityUnlocks";
import { createCampaignState } from "./autonomous";
import { createInitialGame } from "./game";
import { getPlayer } from "./state";

beforeAll(async () => {
  await loadBunGameConfig();
});

describe("アビリティの効果", () => {
  test("同じ種類の効果は足し合わせ、未定義のIDは無視する", () => {
    const effects = abilityEffects(["ability.hawk-eye", "ability.soft-steps", "ability.unknown"]);
    expect(effects.trapAvoidPercent).toBe(18);
    expect(effects.rangedDefense).toBe(3);
    expect(effects.stealth).toBe(2);
  });

  test("職業特性にアビリティを重ねる。敵には重ねない", () => {
    const state = createInitialGame(20260504, "role.ash-scout", { modifiers: { abilities: ["ability.hawk-eye"] } });
    const scout = getGameConfig().roles.find((role) => role.id === "role.ash-scout")!.traits;
    const traits = playerTraits(state, getPlayer(state));
    expect(traits?.trapAvoidPercent).toBe((scout.trapAvoidPercent ?? 0) + 10);
    expect(traits?.rangedDefense).toBe((scout.rangedDefense ?? 0) + 3);
    expect(playerTraits(state, { kind: "monster", contentId: "monster.ash-rat" })).toBeUndefined();
  });

  test("最大HP・攻撃・防御・灯火が出発時から上がる", () => {
    const plain = createInitialGame(20260504, "role.oathbound");
    const equipped = createInitialGame(20260504, "role.oathbound", {
      modifiers: { abilities: ["ability.kindred-vigor", "ability.candle-heart", "ability.ending-echo"] },
    });
    expect(getPlayer(equipped).stats!.maxHp).toBe(getPlayer(plain).stats!.maxHp + 8);
    expect(getPlayer(equipped).stats!.attack).toBe(getPlayer(plain).stats!.attack + 2);
    expect(getPlayer(equipped).stats!.defense).toBe(getPlayer(plain).stats!.defense + 1);
    expect(equipped.lantern.embers).toBe(plain.lantern.embers + 1);
    expect(equipped.lantern.maxEmbers).toBe(plain.lantern.maxEmbers + 1);
  });

  test("未定義のアビリティは遠征に持ち込まない", () => {
    const state = createInitialGame(20260504, "role.oathbound", { modifiers: { abilities: ["ability.unknown", "ability.stone-heart"] } });
    expect(state.modifiers.abilities).toEqual(["ability.stone-heart"]);
  });
});

describe("アビリティの解放と枠", () => {
  test("最初は何も解放されておらず、枠は2つ", () => {
    const campaign = createCampaignState();
    expect(unlockedAbilityIds(campaign)).toEqual([]);
    expect(abilitySlots(campaign)).toBe(2);
  });

  test("職業の踏破・真相・覚醒の突破で解放される", () => {
    const campaign = {
      ...createCampaignState(),
      legacies: ["role.keyshadow-rogue"],
      roleTruths: ["furnace-map" as const],
      journey: { victories: 2, trialsCleared: 1, lifetimeShards: 0 },
    };
    const unlocked = unlockedAbilityIds(campaign);
    expect(unlocked).toContain("ability.soft-steps");
    expect(unlocked).toContain("ability.truth-flame");
    expect(unlocked).toContain("ability.stone-heart");
    expect(unlocked).not.toContain("ability.furnace-heart");
    expect(unlocked).not.toContain("ability.kindred-vigor");
  });

  test("付けられるのは解放済みで枠に収まる分だけ。修練場で枠が増える", () => {
    const campaign = {
      ...createCampaignState(),
      legacies: ["role.oathbound", "role.ash-scout", "role.lantern-priest"],
      abilityLoadout: ["ability.guardian-spoils", "ability.candle-heart", "ability.hawk-eye", "ability.purifying-grace"],
    };
    expect(normalizeAbilityLoadout(campaign)).toEqual(["ability.guardian-spoils", "ability.hawk-eye"]);
    const trained = { ...campaign, facilities: { ...campaign.facilities, "training-hall": 1 } };
    expect(abilitySlots(trained)).toBe(3);
    expect(normalizeAbilityLoadout(trained)).toEqual(["ability.guardian-spoils", "ability.hawk-eye", "ability.purifying-grace"]);
  });

  test("修練場の費用は段ごとに大きく上がり、最大6枠", () => {
    const hall = getGameConfig().campaign.facilities["training-hall"];
    expect(hall.costs.every((cost, index) => index === 0 || cost > hall.costs[index - 1] * 1.5)).toBe(true);
    expect(getGameConfig().abilities.baseSlots + hall.costs.length * (hall.abilitySlotsPerLevel ?? 0)).toBe(6);
  });
});

test("アビリティと修練場にはアイコンがある", async () => {
  const { assetForContent } = await import("../content/assets");
  const missing = [...Object.keys(getGameConfig().abilities.definitions), "facility.training-hall"].filter((id) => !assetForContent(id));
  expect(missing).toEqual([]);
});
