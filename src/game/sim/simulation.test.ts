import { expect, test } from "bun:test";
import { getGameConfig, loadBunGameConfig } from "../content/config";
import { stagePresets } from "./scenarios";
import { runSimulation, type SimulationRunResult } from "./simulation";

await loadBunGameConfig();
const roles = getGameConfig().roles.map((role) => role.id);
const resultWithoutTiming = ({ elapsedMs: _elapsed, profile: _profile, ...result }: SimulationRunResult) => result;

for (const roleId of roles) {
  for (const stage of ["fresh", "late"] as const) {
    test(`単独所有と通常更新の遠征・全評価項目が一致する: ${roleId} / ${stage}`, async () => {
      const input = {
        seed: 20260507, turns: 1600, roleId, configPath: "public/config/game-balance.json", label: "equivalence", logLimit: 40,
        ...stagePresets[stage], watcherPolicy: stage === "fresh" ? "none" as const : "lantern" as const,
        decisionPolicy: "always-continue" as const,
      };
      const copied = await runSimulation({ ...input, copyState: true });
      const owned = await runSimulation(input);
      expect(resultWithoutTiming(owned)).toEqual(resultWithoutTiming(copied));
      expect(owned.actions.move).toBeGreaterThan(0);
      expect(owned.attacks).toBeGreaterThan(0);
    });
  }
}
