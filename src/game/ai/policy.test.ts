import { beforeAll, describe, expect, test } from "bun:test";
import { loadBunGameConfig } from "../content/config";
import { applyAction, createInitialGame, normalizeTactics } from "../core/game";
import { createCheckpointDecision } from "../core/autonomous";
import { resolveAutoplayPolicy } from "./autoplay";

beforeAll(async () => {
  await loadBunGameConfig("public/config/game-balance.json");
});

describe("作戦と方針", () => {
  test("方針は気質の傾向を上書きし、作戦はさらにその上から効く", () => {
    const identity = { name: "テスト", roleId: "role.oathbound", temperament: "bold" as const };
    const bold = resolveAutoplayPolicy({ runIdentity: identity, directive: "conquest", tactics: [] });
    const survival = resolveAutoplayPolicy({ runIdentity: identity, directive: "survival", tactics: [] });
    expect(bold.huntWeakEnemies).toBe(true);
    expect(survival.huntWeakEnemies).toBe(false);
    expect(survival.combatHp).toBeGreaterThan(bold.combatHp);
    const withCare = resolveAutoplayPolicy({ runIdentity: identity, directive: "survival", tactics: ["tactic.early-care"] });
    expect(withCare.healBonus).toBeGreaterThan(survival.healBonus);
  });

  test("作戦は定義済みのものだけを枠数まで残し、開始時の携行品を付与する", () => {
    expect(normalizeTactics(["tactic.hoard", "tactic.hoard", "unknown", "tactic.duelist", "tactic.thorough"])).toEqual(["tactic.hoard", "tactic.duelist"]);
    const plain = createInitialGame(20260504, "role.ash-scout");
    const volley = createInitialGame(20260504, "role.ash-scout", { tactics: ["tactic.dart-volley"] });
    const darts = (state: typeof plain) => state.entities.find((entity) => entity.id === state.playerId)?.inventory?.find((entry) => entry.contentId === "item.ember-dart")?.quantity ?? 0;
    expect(darts(volley)).toBe(darts(plain) + 5);
  });

  test("節目の判断でだけ作戦を組み替えられる", () => {
    const state = createInitialGame(20260504, "role.oathbound", { tactics: ["tactic.hoard"] });
    state.floor = 3;
    state.pendingDecision = createCheckpointDecision(state);
    const next = applyAction(state, { type: "resolveDecision", optionId: "continue-survival", tactics: ["tactic.archer-hunt", "tactic.straight-path"] });
    expect(next.tactics).toEqual(["tactic.archer-hunt", "tactic.straight-path"]);
  });
});
