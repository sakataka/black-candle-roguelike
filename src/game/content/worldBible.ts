export const worldBible = {
  title: "黒燭の迷宮",
  tone: "暗め王道ファンタジー",
  premise:
    "古代王国は、人の記憶と命を燃やす黒燭で災厄『無明の王』を封じた。灰灯院の灯守は、自律して迷宮へ潜る探索者を黒燭越しに観測し、限られた啓示で導く。",
  playerRole: "探索組織『灰灯院』の観測者『灯守』",
  centralTruth: "黒燭は呪いの元凶であると同時に、無明の王を閉じ込める残酷な必要悪でもある。",
  chapters: [
    { floors: "1-3", name: "黒石迷宮", revelation: "守護者は中枢から何かが出るのを防いでいた。" },
    { floors: "4-6", name: "墓所", revelation: "封印は王国民の記憶と命を燃料にしていた。" },
    { floors: "7-9", name: "炉心遺跡", revelation: "黒燭は地上の祭壇群へつながる封印機構だった。" },
    { floors: "10", name: "黒燭中枢", revelation: "黒燭の番人は元凶ではなく最後の管理者だった。" },
  ],
  roleTruths: {
    "role.oathbound": { id: "shared-oath", name: "分誓の碑文", meaning: "封印の負担は複数人へ分けられる。" },
    "role.ash-scout": { id: "furnace-map", name: "炉脈全図", meaning: "黒燭と地上の灯火を結ぶ経路が存在する。" },
    "role.lantern-priest": { id: "purified-flame", name: "浄火の祈り", meaning: "黒い火は消すだけでなく浄化できる。" },
  },
  endings: {
    "inherit-flame": { name: "継燭", summary: "探索者一人を次の番人にする。" },
    "extinguish-flame": { name: "消燭", summary: "封印を壊し、無明の王との戦いを地上へ持ち出す。" },
    "divide-flame": { name: "分灯", summary: "封印を多数の灯火へ分散する真結末。" },
  },
  visualStyle: {
    tileSize: 64,
    camera: "top-down orthographic",
    rendering: "readable fantasy sprite, high contrast silhouette, no tiny details",
    lighting: "cool dungeon shadows with warm amber item highlights",
    outline: "clean dark outline for every interactive object",
    avoid: ["photorealistic", "modern clothing", "sci-fi props", "busy background", "text inside sprites"],
  },
  palettes: {
    dungeon: ["#191712", "#2f2d26", "#615b4a", "#9c8d61"],
    hero: ["#d8c28a", "#5e6f78", "#202126", "#a64b3c"],
    monster: ["#33261f", "#7b2f2f", "#a8794a", "#d8c7a0"],
    magic: ["#2b234a", "#6c56b4", "#b6a5ff", "#e4d9ff"],
    loot: ["#3c2e16", "#9c6b2f", "#e0bd64", "#fff0a8"],
  },
  assetRules: [
    "entity ID と asset ID は分離し、差し替え時にゲームデータを変更しない。",
    "monster は family + role + tier を必ず持つ。",
    "新しい画像を追加する時は promptSeed と styleTags を先に登録する。",
    "UI表示名は日本語を必須にし、英語は後から追加できる形にする。",
  ],
} as const;
