# 新作向け敵候補メモ

このメモは旧 NetHack 抽出データを、新作で追加しやすい敵候補へ翻訳したものです。NetHack の敵を復元するのではなく、`family + role + tier` で使える行動パターンと配置時期を抜き出します。

## このメモの使い方

- 敵名は新作用に作り直す。元 seed は役割、危険度、対策の参照として残す。
- 1回の追加では family を増やしすぎず、既存 biome と出現テーブルに合う候補だけを入れる。
- `dangerScore`, `spawnTier`, `combatProfile`, `simulationRoles` は、HP/攻撃値ではなく「プレイヤーに要求する対応」の目安として扱う。
- 新しい状態異常や特殊移動を入れた場合は、AI と `simulate:batch` で確認する。

## 採用しない情報

- NetHack の固有名、シンボル、色、正確な AC/MR/速度値は採用しない。
- 石化、変身、装備破壊、テレポート、脳吸収など、今の core に存在しない高コスト効果は `parked` にする。
- 死体効果や耐性獲得は、今のゲームに食料/死体システムがないため直接採用しない。

## 元にした情報

- 旧 `monsters.enriched.json` の `spawnTier`, `dangerScore`, `combatProfile`, `simulationRoles`。
- 旧 `design-summary.json` の強敵/高脅威候補。
- 旧 derived knowledge doc の「互換ではなく設計素材として使う」方針。

## 候補一覧

| 候補名 | 元 seed | 新作での役割 | 実装に必要な仕組み | 優先度 | 参考元 |
| --- | --- | --- | --- | --- | --- |
| 灰爪の小獣 | Jackal / Fox | 序盤の低脅威 skirmisher。既存 `ash-rat` の亜種ではなく群れ圧を担当。 | pack 風の出現重み、低HP高速移動。 | now | `PM_JACKAL`, `PM_FOX` |
| 鉄錆びの小兵 | Goblin / Kobold | 武器持ち humanoid。序盤にアイテム/金貨を守る雑魚。 | weapon-user 風の攻撃値、報酬付き配置。 | now | `PM_GOBLIN`, `PM_KOBOLD` |
| 毒牙の群虫 | Killer Bee / Centipede | 毒や bleed に近い状態異常を持つ低HP敵。 | venom/bleed 付与、AI の状態異常評価。 | next | `PM_KILLER_BEE`, `PM_CENTIPEDE` |
| 酸だまりの塊 | Acid Blob / Spotted Jelly | 動かない、または遅い hazard。近接すると反撃や床ギミックになる。 | 接触時反撃、倒した時の床効果は optional。 | next | `PM_ACID_BLOB`, `PM_SPOTTED_JELLY` |
| 凍光の眼 | Floating Eye | 攻撃しにくい視線 hazard。近接で足止めや短い stun を与える。 | 既知敵への回避、短時間行動不能または移動阻害。 | later | `PM_FLOATING_EYE` |
| 影跳びの盗人 | Leprechaun / Nymph | 直接火力ではなく金貨/アイテムを乱す敵。 | steal-gold または拾得妨害。AI が追跡しすぎない制御。 | later | `PM_LEPRECHAUN`, `PM_WOOD_NYMPH` |
| 地潜り鉱喰い | Rock Mole / Dwarf | 壁や鉱物 theme の敵。鉱山/黒石 biome に合う。 | 掘削は重いので、まずは宝石/金貨周辺に出る敵として扱う。 | later | `PM_ROCK_MOLE`, `PM_DWARF` |
| 天井落とし | Rock Piercer / Trapper | 部屋進入時の伏兵。探索済みでも油断できない hazard。 | 隠れ状態、隣接/進入 trigger、警告表示。 | parked | `PM_ROCK_PIERCER`, `PM_TRAPPER` |
| 黒石の術者 | Kobold Shaman / Orc Shaman | 低中層 caster。距離を取り、弱い魔法や summon を使う。 | ranged/caster AI、低威力 spell、召喚は optional。 | now | `PM_KOBOLD_SHAMAN`, `PM_ORC_SHAMAN` |
| 炎吐きの猟犬 | Winter Wolf / Hell Hound | 中後半の ranged beast。直線ブレスで位置取りを要求する。 | 直線範囲攻撃、射線判定、AI の避け方。 | later | `PM_WINTER_WOLF`, `PM_HELL_HOUND` |
| 墓所の吸血虫 | Rabid Rat / Giant Spider / Scorpion | crypt 向けの毒/持続ダメージ敵。既存 `grave-leech` と相性がよい。 | venom/bleed の強度差、crypt 出現テーブル。 | next | `PM_RABID_RAT`, `PM_GIANT_SPIDER`, `PM_SCORPION` |
| 擬態する宝箱 | Small Mimic / Giant Mimic | 宝箱/アイテム部屋の surprise。報酬と危険を結びつける。 | entity の disguise、発見時 reveal、宝物庫 event との連携。 | later | `PM_SMALL_MIMIC`, `PM_GIANT_MIMIC` |
| 炉心の火蟻 | Fire Ant | furnace の群れ敵。火傷や追加ダメージで後半の圧を作る。 | fire/ember 条件、furnace 出現テーブル。 | next | `PM_FIRE_ANT` |
| 盲光の球 | Yellow Light / Black Light | 近づくと爆ぜる光 hazard。見えているうちに距離を取る敵。 | 接近 trigger、blind の代替として reveal 低下や命中低下。 | parked | `PM_YELLOW_LIGHT`, `PM_BLACK_LIGHT` |
| 三首の門番 | Cerberus | 終盤 boss seed。高耐久の単純強敵として使いやすい。 | boss HP、複数攻撃または周囲威圧、専用報酬。 | later | `PM_CERBERUS` |
| 黒竜の残響 | Dragon Scale family | 属性耐性/属性攻撃の boss family。装備報酬と接続できる。 | 属性攻撃、属性防具、boss reward のセット設計。 | parked | `PM_*_DRAGON` |

## 実装時の優先候補

最初に追加するなら `黒石の術者`, `毒牙の群虫`, `酸だまりの塊`, `炉心の火蟻` の順がよい。既存の ranged/caster、状態異常、biome、trap/event と接続しやすい。

## 保留する方向

- 石化、変身、テレポート、装備窃盗、脳吸収はゲーム性への影響が大きい。
- ペット/友好 NPC 系は AI と UI の前提が変わるため別設計にする。
- ドラゴンや終盤 unique は、属性装備と boss reward が揃ってから扱う。
