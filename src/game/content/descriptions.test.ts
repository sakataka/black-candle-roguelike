import { expect, test } from "bun:test";
import { contentDescriptions } from "./descriptions";
import { contentEntities } from "./entities";
import { roleGuides } from "./guide";

// 図鑑と所持品の説明。新しい敵・品・仕掛けを足した時に説明を書き忘れない。
test("職業・敵・品・仕掛け・罠のすべてに説明がある", () => {
  const described = Object.keys(contentEntities).filter((id) => !id.includes(".cover-"));
  expect(described.filter((id) => !contentDescriptions[id])).toEqual([]);
  expect(Object.keys(contentDescriptions).filter((id) => !contentEntities[id])).toEqual([]);
});

test("職業にはガイドの遊び方がある", () => {
  const roles = Object.keys(contentEntities).filter((id) => id.startsWith("role."));
  expect(roles.filter((id) => !roleGuides[id])).toEqual([]);
});
