# 新作向け罠・部屋・遭遇候補メモ

このメモは旧 NetHack 抽出データを、新作で使いやすい room/event/encounter 候補へ翻訳したものです。罠を単体で増やすより、「地形 + 敵 + 報酬 + リスク」のまとまりとして扱います。

## このメモの使い方

- まず event として追加し、必要になったら map generator の room template へ昇格する。
- 罠は発見、予兆、回避、報酬との位置関係をセットで設計する。
- ショップは独立システムではなく、まずは商人イベントや補給部屋として扱う。
- 追加後は `simulate:batch` で探索停滞、既知罠踏み、拾得、死亡原因を見る。

## 採用しない情報

- Lua level の座標、固定マップ形状、NetHack 固有 NPC 名は採用しない。
- Sokoban のような本格パズル branch は、押せる岩や undo 前提がないため保留する。
- 店内窃盗、未払い、価格交渉、借金は今の core には重いので採用しない。

## 元にした情報

- 旧 `systems.enriched.json` の trap、room type、terrain、challenge seed。
- 旧 `encounter-templates.json` の monster/object/trap counts、biome hints、room role。
- 旧 `shops.enriched.json` の shop type と stock 方向性。
- 旧 reference usage doc の「罠 + 報酬 + 敵 + 地形」の組み合わせとして見る方針。

## 候補一覧

| 候補名 | 元 seed | 新作での役割 | 実装に必要な仕組み | 優先度 | 参考元 |
| --- | --- | --- | --- | --- | --- |
| 墓所の供物室 | Arc / Pri quest rooms, morgue | crypt 向け。undead、罠、回復/浄化報酬をまとめる。 | crypt event、undead pool、altar/shrine 報酬。 | now | `encounter.Arc-loca`, `encounter.Pri-goal`, `systems.roomTypes:MORGUE` |
| 炉心の火罠回廊 | Val / fire branch | furnace 向け。火罠、火系敵、火耐性装備 seed を置く。 | fire trap、furnace enemy、火軽減装備。 | next | `encounter.Val-goal`, `encounter.fire` |
| 水没した宝物庫 | Medusa / castle / water rooms | 水場、遠隔敵、石像/宝箱を持つ high-risk loot room。 | water terrain が必要。水場なしなら「浸水床」演出に留める。 | parked | `encounter.medusa-*`, `encounter.castle` |
| 黒石の鉱脈部屋 | Mines / mine end | 鉱石・宝石・小型 humanoid の報酬部屋。 | coin/gem loot、dwarf/construct 系敵、罠少量。 | next | `encounter.minefill`, `encounter.minend-*` |
| 封印扉の小部屋 | Sokoban / sealed rooms | 鍵や探索道具があると得をする optional room。 | key/lockpick event、報酬 table、罠 warning。 | now | `encounter.soko*`, existing `event.sealed-room` |
| 擬態宝箱の巣 | Rogue / mimic rooms | 宝箱やアイテムに化けた敵を置く surprise room。 | mimic enemy、発見/reveal、宝箱報酬。 | later | `encounter.Rog-strt`, `PM_SMALL_MIMIC` |
| 群れの巣穴 | Beehive / ant family | 弱敵が多い room。範囲攻撃や撤退判断を試す。 | group spawn、低HP敵、過密時の逃走 AI。 | next | `systems.roomTypes:BEEHIVE`, ant family |
| 兵舎跡 | Barracks / soldier rooms | humanoid weapon-user がまとまる部屋。装備報酬と相性がよい。 | weapon-user enemy、武器/防具 loot。 | later | `systems.roomTypes:BARRACKS`, `encounter.Tou-*` |
| 金庫室 | Vault / Fort Knox | 金貨や宝石が多いが、罠と番人がいる部屋。 | gold/gem loot、guard enemy、landmine/spiked trap の翻訳。 | next | `systems.roomTypes:VAULT`, `encounter.knox` |
| 祭壇の選択部屋 | Temple / religion rooms | 回復、浄化、呪い、代償付き報酬を選ぶ部屋。 | existing altar/shrine event の拡張、risk-reward 選択。 | now | `systems.roomTypes:TEMPLE`, `encounter.Pri-*` |
| 転落床の通路 | Pit / hole / rolling boulder | 罠を避けるだけでなく、位置取りを要求する通路。 | crumbling floor、impact damage、警告タイル。 | next | `systems.traps:PIT`, `ROLLING_BOULDER_TRAP` |
| 眠り霧の床 | Sleep gas / magic trap | 毒霧とは別の制御罠。短時間足止めや敵接近を誘う。 | condition 追加、AI の known trap 回避。 | later | `systems.traps:SLP_GAS_TRAP`, `encounter.Wiz-loca` |
| 反魔の印床 | Anti magic / magic trap | caster や魔法アイテムを制限する特殊床。今は重い。 | MP/cooldown/魔法システムが必要。 | parked | `encounter.Kni-loca`, `encounter.Wiz-loca` |
| 旅商人の野営 | Shop stock tables | 店システムではなく、階層ごとの補給イベントにする。 | merchant services、stock table、gold spending AI。 | now | `shops.enriched.json`, existing `event.wayfarer-merchant` |
| 専門店の残骸 | Armor/weapon/scroll/potion shops | 店タイプを補給 room の品揃え theme として使う。 | merchant stock variation、価格 table。 | later | `shops.enriched.json` |
| 最終門の儀式場 | Sanctum / Astral / boss finale | 終盤 boss 前の set-piece。罠、祭壇、強敵をまとめる。 | boss key、multi-wave、専用報酬。 | parked | `encounter.sanctum`, `encounter.astral` |

## 実装時の優先候補

最初に追加するなら `墓所の供物室`, `封印扉の小部屋`, `祭壇の選択部屋`, `旅商人の野営` がよい。既存の `event.dead-feast`, `event.sealed-room`, `event.dread-altar`, `event.wayfarer-merchant` を拡張できるため、map generator の大変更なしで入れられる。

## ショップ情報の扱い

`shops.enriched.json` は店タイプそのものより、「何を補給すべきか」の seed として使う。

- general store: ランダム補給。詰まり防止。
- armor/weapon shop: 装備更新の救済。
- potion/scroll shop: 回復、地図、状態対策。
- tool shop: 鍵、灯り、探索道具。
- book/wand shop: 魔法職を入れるまで保留。

## 保留する方向

- 完全固定マップ、押し岩パズル、未払い/盗み、複数階 branch はまだ扱わない。
- 水地形や属性床は、renderer と AI が同じ前提で判断できるようになってから入れる。
- 部屋候補を実装する時は、必ず「報酬だけ増える部屋」ではなく、敵/罠/地形/報酬の関係を持たせる。
