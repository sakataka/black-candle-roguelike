import { expect, test } from "bun:test";
import { loadBunGameConfig } from "../game/content/config";
import { unlockedAbilityIds } from "../game/core/abilityUnlocks";
import { createCampaignState, recordCampaignResult } from "../game/core/autonomous";
import { createInitialGame } from "../game/core/game";
import { milestoneFor, runComparisonMarkup } from "./resultSummary";

await loadBunGameConfig();

function resultFixture() {
  const state = createInitialGame(20260504, "role.oathbound");
  state.status = "returned";
  state.floor = state.story.maxFloorReached = 3;
  const campaign = recordCampaignResult(createCampaignState(), state, null);
  const record = campaign.expeditions[0];
  const abilities = new Set(unlockedAbilityIds(campaign));
  return { campaign, record, abilities };
}

test("結果の碑は継燭、結末、アビリティ解放、古参の結果の順を保つ", () => {
  const { campaign, record, abilities } = resultFixture();
  campaign.legacies = ["role.oathbound"];
  record.veteranOutcome = "fallen";
  expect(milestoneFor(record, campaign, abilities)?.kind).toBe("ability");
  record.endingId = "divide-flame";
  expect(milestoneFor(record, campaign, abilities)?.kind).toBe("ending");
  record.veteranOutcome = "keeper";
  expect(milestoneFor(record, campaign, abilities)?.kind).toBe("keeper");
});

test("墓標は名前をエスケープし、旧記録の未知の死因でも表示を保つ", () => {
  const { campaign, record, abilities } = resultFixture();
  record.identity.name = '<灯守 & "一">';
  record.veteranOutcome = "fallen";
  record.deathCause = "legacy-cause";
  expect(milestoneFor(record, campaign, abilities)).toEqual({
    kind: "fallen", kicker: "墓標", title: "&lt;灯守 &amp; &quot;一&quot;&gt;、地下三階に眠る",
    detail: "後の遠征でこの墓標を弔えば、遺品と灯火を受け継げる。",
  });
  record.deathCause = "combat";
  expect(milestoneFor(record, campaign, abilities)?.detail).toStartWith("刃の下に倒れた。");
});

test("古参が記録に残っていない場合、昇格の碑は出さず、古傷は表示する", () => {
  const { campaign, record, abilities } = resultFixture();
  campaign.roster = [];
  record.veteranOutcome = "promoted";
  expect(milestoneFor(record, campaign, abilities)).toBeNull();
  record.veteranOutcome = "scarred";
  expect(milestoneFor(record, campaign, abilities)?.detail).toBe("灰灯院の療房で癒やせる。");
});

test("同じ記録を再表示しても結果を変えず、前回の最高値を超えた札だけを添える", () => {
  const { campaign, record, abilities } = resultFixture();
  expect(runComparisonMarkup(record, campaign)).toContain("最初の遠征記録です。");
  expect(runComparisonMarkup(record, campaign)).not.toContain("最多灯片を更新");
  campaign.expeditions.push({ ...structuredClone(record), floor: record.floor + 1 });
  record.veteranOutcome = "roster-full";
  const original = structuredClone(campaign);
  const first = runComparisonMarkup(record, campaign);
  expect(first).not.toContain("最高到達階を更新");
  expect(first).not.toContain("最多灯片を更新");
  expect(first).toContain("古参は全員残っています");
  milestoneFor(record, campaign, abilities);
  expect(runComparisonMarkup(record, campaign)).toBe(first);
  expect(campaign).toEqual(original);
});
