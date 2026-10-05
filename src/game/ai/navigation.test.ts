import { expect, test } from "bun:test";
import { loadBunGameConfig } from "../content/config";
import { createInitialGame, observeGame } from "../core/game";
import { Rng } from "../core/rng";
import { knownPathDistance, walkKnownPaths, type PathOptions } from "./navigation";
import type { Point } from "../types";

await loadBunGameConfig();

test("逆向きの距離表は未知・罠・敵・塞がれた始点を含め、前向き探索と一致する", () => {
  const rng = new Rng(789);
  const options: PathOptions[] = [{}, {avoidTraps:false}, {allowHostileBlockers:true}, {avoidTraps:false,allowHostileBlockers:true}];
  for (let sample=0; sample<25; sample++) {
    const state = createInitialGame(20260504 + sample);
    state.width = 13; state.height = 11;
    state.tiles = Array.from({length:143}, () => ({kind:rng.int(0,4)===0 ? "wall" : "floor",visible:true,explored:true}));
    const player = state.entities.find(entity=>entity.id===state.playerId)!;
    player.pos = {x:6,y:5};
    state.entities = [player];
    for (let i=0;i<16;i++) state.entities.push({id:`blocker-${i}`,kind:i%3===0 ? "trap" : "monster",contentId:i%3===0 ? "trap.black-needle" : "monster.ash-rat",pos:{x:rng.int(0,12),y:rng.int(0,10)},hostile:i%2===0,blocksMovement:i%3!==0});
    for (let i=0;i<12;i++) { const tile=state.tiles[rng.int(0,142)]; tile.visible=false; tile.explored=false; }
    const observation = observeGame(state);
    const starts: Point[] = [player.pos,{x:-1,y:5},{x:12,y:10},...state.entities.slice(1,4).map(entity=>entity.pos)];
    const targets: Point[] = [player.pos,{x:-1,y:5},{x:99,y:99},...state.entities.slice(1,4).map(entity=>entity.pos),...Array.from({length:15},()=>({x:rng.int(0,12),y:rng.int(0,10)}))];
    for (const option of options) for (const from of starts) {
      const paths = [...walkKnownPaths(observation,from,option)];
      for (const target of targets) {
        const expected = paths.find(path=>path.point.x===target.x&&path.point.y===target.y)?.distance ?? null;
        expect(knownPathDistance(observation,from,target,option)).toBe(expected);
      }
    }
  }
});
