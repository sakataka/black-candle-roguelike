import { expect, test } from "bun:test";
import { applyAction, applyOwnedAction, createInitialGame, observeGame } from "./game";
import { cloneExpedition, cloneStory, cloneTile } from "./state";
import { getGameConfig, loadBunGameConfig } from "../content/config";
import { createRunLog, recordTurn } from "./runLog";
import { createPointTaker } from "./generation";
import { Rng } from "./rng";
import type { ExpeditionDynamics, GameMessage, Point } from "../types";

await loadBunGameConfig();

test("専用コピーは入れ子の遠征情報と任意プロパティを保ち、元のデータを変更しない", () => {
  const expedition: ExpeditionDynamics = {
    lights: [{pos:{x:2,y:3},turns:4}], borrowed:true, debt:2, loanShieldTurns:1, lawPhase:3, floorKills:2, floorAwakened:1,
    heat:[{pos:{x:4,y:5},remaining:6,active:true}], trail:[{action:"move",hp:20,pos:{x:3,y:3}}],
    memories:[{name:"test",echoes:[{action:"wait",hp:10,pos:{x:1,y:1}}],lesson:"traps"}],lastRite:{rite:"test",runTurn:7},
    stats:{dodges:1,telegraphs:2,terrainLures:3,awakened:4,heatHits:5,lightsPlaced:6,borrowed:7},
  };
  const expected = structuredClone(expedition);
  const copy = cloneExpedition(expedition);
  expect(copy).toEqual(expected);
  copy.lights[0].pos.x++; copy.heat[0].pos.x++; copy.trail[0].pos.x++; copy.memories[0].echoes[0].pos.x++; copy.lastRite!.runTurn++; copy.stats.dodges++;
  expect(expedition).toEqual(expected);
  const story = {...createInitialGame(20260504).story,recoveredGraves:["test"],killedBy:{cause:"combat" as const}};
  const storyCopy = cloneStory(story);
  expect(storyCopy).toEqual(structuredClone(story));
  storyCopy.recoveredGraves!.push("other"); storyCopy.killedBy!.cause = "trap";
  expect(story.recoveredGraves).toEqual(["test"]); expect(story.killedBy.cause).toBe("combat");
  for (const tile of [{kind:"floor" as const,explored:false,visible:true}, {kind:"cover" as const,explored:true,visible:false,roomTheme:undefined,coverAsset:"test"}]) {
    expect(cloneTile(tile)).toEqual(structuredClone(tile));
    expect(Object.keys(cloneTile(tile))).toEqual(Object.keys(tile));
  }
});

test("単独所有の視界キャッシュは遮蔽変更・探索済み状態・置灯の変化を反映する", () => {
  let state = createInitialGame(20260504);
  state.width = state.height = 15;
  state.tiles = Array.from({length:225}, () => ({kind:"floor" as const,explored:false,visible:false}));
  const player = state.entities.find(entity => entity.id === state.playerId)!;
  player.pos = {x:4,y:7}; player.inventory = []; player.stats = {hp:100,maxHp:100,attack:10,defense:10};
  state.entities = [player];
  state.expedition!.heat = []; state.expedition!.lights = [{pos:{x:11,y:7},turns:12}];
  for (let step=0; step<5; step++) {
    if (step === 2) for (let y=0;y<15;y++) state.tiles[y*15+7].kind = "wall";
    if (step === 3) { state.tiles[7*15+7].kind = "floor"; state.expedition!.lights = []; }
    const immutable = applyAction(state, {type:"wait"});
    state = applyOwnedAction(state, {type:"wait"});
    expect(state).toEqual(immutable);
    expect(observeGame(state)).toEqual(observeGame(immutable));
  }
});

test("配置候補の索引は重複と外部の配列変更があっても旧手順と同じ乱数・配置を保つ", () => {
  const initial: Point[] = Array.from({length:50},(_,i)=>({x:i%10,y:Math.floor(i/10)}));
  initial.push({...initial[4]});
  const points = initial.map(p=>({...p})), reference = initial.map(p=>({...p}));
  const rng = new Rng(1234), referenceRng = new Rng(1234), fallback = {x:0,y:0};
  const take = createPointTaker(points,rng,fallback);
  for (let step=0;step<54;step++) {
    if (step===2) { points.splice(3,1); reference.splice(3,1); }
    const preferred = step%2 ? [initial[4],initial[4],initial[20],{x:99,y:99}] : initial;
    const indexes = preferred.map(p=>reference.findIndex(q=>p.x===q.x&&p.y===q.y)).filter(i=>i>=0);
    const index = indexes.length ? referenceRng.pick(indexes) : referenceRng.int(0,Math.max(0,reference.length-1));
    const expected = reference.splice(index,1)[0] ?? fallback;
    expect(take(preferred)).toEqual(expected); expect(points).toEqual(reference);
  }
  expect(rng.int(0,999999)).toBe(referenceRng.int(0,999999));
});

test("ログの差分は重複・先頭削除・ターン番号の巻戻り・並べ替えでも従来の値比較と一致する", () => {
  const state = createInitialGame(20260504);
  const observation = observeGame(state);
  const message = (i:number): GameMessage => ({turn:i%3,text:`text-${i%7}`,tone:i%2 ? "combat" : "explore"});
  const before = Array.from({length:80},(_,i)=>message(i));
  const cases = [[],before,[...before,message(100)], [...before.slice(5),message(100),message(101)], [...before.slice(50),before[79]], [message(100),...before], [...before].reverse(), Array.from({length:80},(_,i)=>message(i+100))];
  for (const after of cases) {
    const key = (entry:GameMessage)=>`${entry.turn}:${entry.tone}:${entry.text}`;
    const seen = new Set(before.map(key));
    const entry = recordTurn({log:createRunLog(state.seed,state.runIdentity.roleId),before:{...state,messages:before},after:{...state,messages:after},action:{type:"wait"},actor:"ai",beforeObservation:observation,afterObservation:observation});
    expect(entry.messageDelta).toEqual(after.filter(item=>!seen.has(key(item))));
  }
});

test("単独所有の更新も通常経路と毎手の全状態・公開観測の値が一致する", async () => {
  const { chooseAutoplayAction, resetAutoplayState } = await import("../ai/autoplay");
  const { chooseWatcherAction } = await import("../ai/watcher");
  for (const role of getGameConfig().roles) for (const watcher of ["none", "lantern"] as const) {
    resetAutoplayState();
    let state = createInitialGame(20260507, role.id);
    for (let step = 0; step < 1680 && state.status === "playing"; step++) {
      if (!state.pendingDecision && state.runTurn >= 1600) break;
      const observation = observeGame(state);
      const action = chooseWatcherAction(observation, watcher) ?? chooseAutoplayAction(observation);
      const expected = applyAction(state, action);
      state = applyOwnedAction(state, action);
      // 所有経路は任意プロパティの挿入順が違う。値と配列順を毎手照合する。
      expect(state).toEqual(expected);
      expect(observeGame(state)).toEqual(observeGame(expected));
    }
  }
}, 30_000);
