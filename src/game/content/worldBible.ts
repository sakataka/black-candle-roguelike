export const worldBible = {
  title: "黒燭の迷宮",
  tone: "暗め王道ファンタジー",
  premise:
    "古代王国の地下に広がる黒い燭火の迷宮を探索する。失われた魔法文明、呪具、獣、亡者、異端の術師が主な題材。",
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
