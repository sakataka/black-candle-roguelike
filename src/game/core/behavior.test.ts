import { expect, test } from "bun:test";
import { chooseAutoplayAction, describeAutoplayIntent, getAutoplayDebugState, resetAutoplayState } from "../ai/autoplay";
import { chooseWatcherAction, type WatcherPolicy } from "../ai/watcher";
import { loadBunGameConfig } from "../content/config";
import { applyAction, createInitialGame, observeGame } from "./game";
import { analyzeRun, createRunLog, recordTurn } from "./runLog";

await loadBunGameConfig();

// 9bde721（リファクタリング前）に採取した行動・公開観測・全状態・表示意図・遠征録の指紋。
// 勝率だけでは見逃す判断順、乱数消費、FOV、メッセージの変化を検出する。
for (const watcher of ["none", "lantern"] as WatcherPolicy[]) {
  for (const roleId of ["role.oathbound", "role.ash-scout", "role.lantern-priest"]) {
    test(`遠征の既存挙動を維持する: ${roleId} / ${watcher}`, () => {
      resetAutoplayState();
      let state = createInitialGame(20260507, roleId);
      const log = createRunLog(state.seed, roleId, { maxEntries: 40 }, state.runIdentity);
      const fingerprint = new Bun.CryptoHasher("sha256");
      fingerprint.update(JSON.stringify(state));
      for (let step = 0; step < 1680 && state.status === "playing"; step += 1) {
        if (!state.pendingDecision && state.runTurn >= 1600) break;
        const observation = observeGame(state);
        const action = chooseWatcherAction(observation, watcher) ?? chooseAutoplayAction(observation);
        const aiDebug = getAutoplayDebugState(observation);
        fingerprint.update(JSON.stringify({ observation, action, aiDebug, intent: describeAutoplayIntent(observation, action) }));
        const before = state;
        state = applyAction(state, action);
        recordTurn({ log, before, action, after: state, actor: "ai", aiDebug, beforeObservation: observation, afterObservation: observeGame(state) });
        fingerprint.update(JSON.stringify(state));
      }
      fingerprint.update(JSON.stringify({ log, review: analyzeRun(log, state) }, (key, value) => key === "startedAt" || key === "generatedAt" ? "baseline" : value));
      expect({ status: state.status, floor: state.floor, turn: state.runTurn, fingerprint: fingerprint.digest("hex") }).toMatchSnapshot();
    }, 30_000);
  }
}
