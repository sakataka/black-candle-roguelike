import type { AssetDefinition } from "../types";

// 納品台帳のセル順。制作台帳をランタイムへ読み込まず、画像IDとcontent IDを分離する。
export const expansionAssets: Record<string, AssetDefinition> = {};

function sheet(file: string, columns: number, rows: number, cells: Array<[string, string]>): void {
  cells.forEach(([id, contentId], index) => {
    expansionAssets[id] = { contentId, path: `/assets/sprites/expansion-v1/${file}`, sheet: { columns, rows, index } };
  });
}

sheet("bc-existing-weapons-v1.png", 3, 2, [
  ["icon.item.rusted-sword", "item.rusted-sword"],
  ["icon.item.oath-knife", "item.oath-knife"],
  ["icon.item.hunter-spear", "item.hunter-spear"],
  ["icon.item.iron-axe", "item.iron-axe"],
  ["icon.item.silvered-mace", "item.silvered-mace"],
  ["icon.item.sun-sigil-blade", "item.sun-sigil-blade"],
]);

sheet("bc-existing-armor-v1.png", 3, 2, [
  ["icon.item.leather-armor", "item.leather-armor"],
  ["icon.item.chain-mail", "item.chain-mail"],
  ["icon.item.trapweave-cloak", "item.trapweave-cloak"],
  ["icon.item.moonlit-mail", "item.moonlit-mail"],
  ["icon.item.ward-shield", "item.ward-shield"],
  ["icon.item.tower-kite-shield", "item.tower-kite-shield"],
]);

sheet("bc-existing-vials-v1.png", 2, 2, [
  ["icon.item.ember-tonic", "item.ember-tonic"],
  ["icon.item.greater-tonic", "item.greater-tonic"],
  ["icon.item.guardian-draught", "item.guardian-draught"],
  ["icon.item.unmarked-vial", "item.unmarked-vial"],
]);

sheet("bc-existing-supplies-v1.png", 4, 2, [
  ["icon.item.mapping-scroll", "item.mapping-scroll"],
  ["icon.item.repulsion-scroll", "item.repulsion-scroll"],
  ["icon.item.glim-map", "item.glim-map"],
  ["icon.item.sealed-prayer-strip", "item.sealed-prayer-strip"],
  ["icon.item.ember-dart", "item.ember-dart"],
  ["icon.item.bloodmoss-salve", "item.bloodmoss-salve"],
  ["icon.item.coin-pouch", "item.coin-pouch"],
]);

sheet("bc-existing-relics-v1.png", 2, 2, [
  ["icon.item.void-prism", "item.void-prism"],
  ["icon.item.grave-sun-charm", "item.grave-sun-charm"],
  ["icon.item.colossus-heart", "item.colossus-heart"],
  ["icon.item.black-candle-core", "item.black-candle-core"],
]);

sheet("bc-existing-traps-v1.png", 2, 2, [
  ["sprite.trap.risk-panel", "trap.risk-panel"],
  ["sprite.trap.blood-needle", "trap.blood-needle"],
  ["sprite.trap.venom-mist", "trap.venom-mist"],
  ["sprite.trap.crumbling-floor", "trap.crumbling-floor"],
]);

sheet("bc-existing-events-a-v1.png", 2, 2, [
  ["sprite.event.blood-inscription", "event.blood-inscription"],
  ["sprite.event.warning-brazier", "event.warning-brazier"],
  ["sprite.event.scout-cache", "event.scout-cache"],
  ["sprite.event.lantern-font", "event.lantern-font"],
]);

sheet("bc-existing-events-b-v1.png", 2, 2, [
  ["sprite.event.dread-altar", "event.dread-altar"],
  ["sprite.event.furnace-control-stone", "event.furnace-control-stone"],
  ["sprite.event.seal-key", "event.seal-key"],
  ["sprite.event.oath-echo", "event.oath-echo"],
]);

sheet("bc-monsters-blackstone-v1.png", 2, 2, [
  ["sprite.monster.ash-claw", "monster.ash-claw"],
  ["sprite.monster.rust-footman", "monster.rust-footman"],
  ["sprite.monster.blackstone-hexer", "monster.blackstone-hexer"],
  ["sprite.monster.vein-gnawer", "monster.vein-gnawer"],
]);

sheet("bc-monsters-crypt-v1.png", 2, 2, [
  ["sprite.monster.venom-swarm", "monster.venom-swarm"],
  ["sprite.monster.acid-ooze", "monster.acid-ooze"],
  ["sprite.monster.grave-bloodling", "monster.grave-bloodling"],
  ["sprite.monster.coffer-maw", "monster.coffer-maw"],
]);

sheet("bc-monsters-furnace-v1.png", 2, 2, [
  ["sprite.monster.core-ant", "monster.core-ant"],
  ["sprite.monster.ember-hound", "monster.ember-hound"],
  ["sprite.monster.threefold-gatehound", "monster.threefold-gatehound"],
  ["sprite.monster.candle-root-knight", "monster.candle-root-knight"],
]);

sheet("bc-new-weapons-tools-v1.png", 3, 2, [
  ["icon.item.light-throwing-blade", "item.light-throwing-blade"],
  ["icon.item.hunter-longbow", "item.hunter-longbow"],
  ["icon.item.ironbreaker-greataxe", "item.ironbreaker-greataxe"],
  ["icon.item.silver-banishing-saber", "item.silver-banishing-saber"],
  ["icon.item.sacred-pick", "item.sacred-pick"],
  ["icon.item.scrying-crystal", "item.scrying-crystal"],
]);

sheet("bc-new-armor-utility-v1.png", 3, 2, [
  ["icon.item.witchward-cloak", "item.witchward-cloak"],
  ["icon.item.venomguard-cloak", "item.venomguard-cloak"],
  ["icon.item.reflecting-shield", "item.reflecting-shield"],
  ["icon.item.regrowth-ring", "item.regrowth-ring"],
  ["icon.item.searcher-ring", "item.searcher-ring"],
  ["icon.item.lockpick-bundle", "item.lockpick-bundle"],
]);

sheet("bc-hero-relic-surveyor-v1.png", 4, 2, [
  ["character.relic-surveyor.south", "role.relic-surveyor"],
  ["character.relic-surveyor.southwest", "role.relic-surveyor"],
  ["character.relic-surveyor.west", "role.relic-surveyor"],
  ["character.relic-surveyor.northwest", "role.relic-surveyor"],
  ["character.relic-surveyor.north", "role.relic-surveyor"],
  ["character.relic-surveyor.northeast", "role.relic-surveyor"],
  ["character.relic-surveyor.east", "role.relic-surveyor"],
  ["character.relic-surveyor.southeast", "role.relic-surveyor"],
]);

sheet("bc-hero-ash-apothecary-v1.png", 4, 2, [
  ["character.ash-apothecary.south", "role.ash-apothecary"],
  ["character.ash-apothecary.southwest", "role.ash-apothecary"],
  ["character.ash-apothecary.west", "role.ash-apothecary"],
  ["character.ash-apothecary.northwest", "role.ash-apothecary"],
  ["character.ash-apothecary.north", "role.ash-apothecary"],
  ["character.ash-apothecary.northeast", "role.ash-apothecary"],
  ["character.ash-apothecary.east", "role.ash-apothecary"],
  ["character.ash-apothecary.southeast", "role.ash-apothecary"],
]);

sheet("bc-hero-iron-oath-vanguard-v1.png", 4, 2, [
  ["character.iron-oath-vanguard.south", "role.iron-oath-vanguard"],
  ["character.iron-oath-vanguard.southwest", "role.iron-oath-vanguard"],
  ["character.iron-oath-vanguard.west", "role.iron-oath-vanguard"],
  ["character.iron-oath-vanguard.northwest", "role.iron-oath-vanguard"],
  ["character.iron-oath-vanguard.north", "role.iron-oath-vanguard"],
  ["character.iron-oath-vanguard.northeast", "role.iron-oath-vanguard"],
  ["character.iron-oath-vanguard.east", "role.iron-oath-vanguard"],
  ["character.iron-oath-vanguard.southeast", "role.iron-oath-vanguard"],
]);

sheet("bc-hero-keyshadow-rogue-v1.png", 4, 2, [
  ["character.keyshadow-rogue.south", "role.keyshadow-rogue"],
  ["character.keyshadow-rogue.southwest", "role.keyshadow-rogue"],
  ["character.keyshadow-rogue.west", "role.keyshadow-rogue"],
  ["character.keyshadow-rogue.northwest", "role.keyshadow-rogue"],
  ["character.keyshadow-rogue.north", "role.keyshadow-rogue"],
  ["character.keyshadow-rogue.northeast", "role.keyshadow-rogue"],
  ["character.keyshadow-rogue.east", "role.keyshadow-rogue"],
  ["character.keyshadow-rogue.southeast", "role.keyshadow-rogue"],
]);

sheet("bc-terrain-ore-mine-v1.png", 2, 1, [
  ["floor:ore-mine", "terrain.floor.ore-mine"],
  ["wall:ore-mine", "terrain.wall.ore-mine"],
]);

sheet("bc-props-ore-mine-v1.png", 2, 2, [
  ["prop.ore-mine.cover-pillar", "prop.ore-mine.cover-pillar"],
  ["prop.ore-mine.cover-cart", "prop.ore-mine.cover-cart"],
  ["prop.ore-mine.ore-cluster", "prop.ore-mine.ore-cluster"],
  ["prop.ore-mine.locked-cache", "prop.ore-mine.locked-cache"],
]);

sheet("bc-terrain-sunken-archive-v1.png", 2, 1, [
  ["floor:sunken-archive", "terrain.floor.sunken-archive"],
  ["wall:sunken-archive", "terrain.wall.sunken-archive"],
]);

sheet("bc-props-sunken-archive-v1.png", 2, 2, [
  ["prop.sunken-archive.cover-books", "prop.sunken-archive.cover-books"],
  ["prop.sunken-archive.cover-statue", "prop.sunken-archive.cover-statue"],
  ["prop.sunken-archive.sealed-book", "prop.sunken-archive.sealed-book"],
  ["prop.sunken-archive.memory-vessel", "prop.sunken-archive.memory-vessel"],
]);

sheet("bc-terrain-thorn-chapel-v1.png", 2, 1, [
  ["floor:thorn-chapel", "terrain.floor.thorn-chapel"],
  ["wall:thorn-chapel", "terrain.wall.thorn-chapel"],
]);

sheet("bc-props-thorn-chapel-v1.png", 2, 2, [
  ["prop.thorn-chapel.cover-root", "prop.thorn-chapel.cover-root"],
  ["prop.thorn-chapel.cover-pillar", "prop.thorn-chapel.cover-pillar"],
  ["prop.thorn-chapel.thorn-altar", "prop.thorn-chapel.thorn-altar"],
  ["prop.thorn-chapel.seed-reliquary", "prop.thorn-chapel.seed-reliquary"],
]);

sheet("bc-fx-ember-bolt-v1.png", 2, 2, [
  ["effect.ember-bolt.frame-0", "effect.ember-bolt"],
  ["effect.ember-bolt.frame-1", "effect.ember-bolt"],
  ["effect.ember-bolt.frame-2", "effect.ember-bolt"],
  ["effect.ember-bolt.frame-3", "effect.ember-bolt"],
]);

sheet("bc-fx-mending-light-v1.png", 2, 2, [
  ["effect.mending-light.frame-0", "effect.mending-light"],
  ["effect.mending-light.frame-1", "effect.mending-light"],
  ["effect.mending-light.frame-2", "effect.mending-light"],
  ["effect.mending-light.frame-3", "effect.mending-light"],
]);

sheet("bc-fx-repulsion-gust-v1.png", 2, 2, [
  ["effect.repulsion-gust.frame-0", "effect.repulsion-gust"],
  ["effect.repulsion-gust.frame-1", "effect.repulsion-gust"],
  ["effect.repulsion-gust.frame-2", "effect.repulsion-gust"],
  ["effect.repulsion-gust.frame-3", "effect.repulsion-gust"],
]);

sheet("bc-fx-ward-aura-v1.png", 2, 2, [
  ["effect.ward-aura.frame-0", "effect.ward-aura"],
  ["effect.ward-aura.frame-1", "effect.ward-aura"],
  ["effect.ward-aura.frame-2", "effect.ward-aura"],
  ["effect.ward-aura.frame-3", "effect.ward-aura"],
]);

sheet("bc-fx-venom-impact-v1.png", 2, 2, [
  ["effect.venom-impact.frame-0", "effect.venom-impact"],
  ["effect.venom-impact.frame-1", "effect.venom-impact"],
  ["effect.venom-impact.frame-2", "effect.venom-impact"],
  ["effect.venom-impact.frame-3", "effect.venom-impact"],
]);

sheet("bc-fx-frost-bind-v1.png", 2, 2, [
  ["effect.frost-bind.frame-0", "effect.frost-bind"],
  ["effect.frost-bind.frame-1", "effect.frost-bind"],
  ["effect.frost-bind.frame-2", "effect.frost-bind"],
  ["effect.frost-bind.frame-3", "effect.frost-bind"],
]);
