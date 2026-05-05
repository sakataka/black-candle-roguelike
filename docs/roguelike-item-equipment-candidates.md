# 新作向けアイテム・装備候補メモ

このメモは旧 NetHack 抽出データを、新作で実装しやすいアイテム/装備案へ圧縮したものです。NetHack の品目を増やすのではなく、今のゲームに不足している選択肢、報酬、AI が扱える効果を優先します。

## このメモの使い方

- 1回の追加では、武器、防具、消耗品、探索道具のどれか1系統に絞る。
- `utilityScore`, `damageScore`, `rarity`, `effectHints`, `aiUseHints` は、効果の強さではなく実装候補の分類に使う。
- AI が使えない消耗品は、まず人間用ではなく event reward や装備 passive として実装する。
- アイテム名、見た目、ログ文言は暗めの王道ファンタジーへ置き換える。

## 採用しない情報

- 祝福/呪い、識別、複雑な杖/巻物/魔法書の正確な効果は採用しない。
- 重量、価格、確率はそのまま使わない。inventory pressure や shop 価格の seed としてだけ見る。
- 矢弾の材質差分や種族別装備差分は、今の装備枠では細かすぎるため統合する。

## 元にした情報

- 旧 `objects.enriched.json` の `utilityScore`, `damageScore`, `rarity`, `effectHints`, `aiUseHints`。
- 旧 `design-summary.json` の高 utility アイテム候補。
- 旧 reference usage doc の「名前、数値、効果は新作側で作り直す」方針。

## 候補一覧

| 候補名 | 元 seed | 新作での役割 | 実装に必要な仕組み | 優先度 | 参考元 |
| --- | --- | --- | --- | --- | --- |
| 軽投げ刃 | Dart / Shuriken | scout/rogue 向けの使い切り遠隔火力。 | 既存 `item.ember-dart` の亜種、AI の遠隔使用重み。 | now | `DART`, `SHURIKEN` |
| 狩人の長弓 | Bow / Arrow | 遠隔職追加時の基本武器。 | launcher/ammo を単純化するか、弓を耐久なし装備に翻訳。 | later | `BOW`, `ARROW` |
| 鉄割りの大斧 | Battle Axe / Two-handed Sword | 重戦士向けの高火力・低防御武器。 | attack+大、shield 不可または trap/回避 penalty。 | next | `BATTLE_AXE`, `TWO_HANDED_SWORD` |
| 銀祓いの刃 | Silver Saber / Silver Mace | undead/demon counter の中盤報酬。 | family 特効、crypt/black-candle の報酬配置。 | next | `SILVER_SABER`, `SILVER_MACE` |
| つるはしの聖具 | Pick-axe / Dwarvish Mattock | 探索職向け。掘削を直接入れず、隠し部屋/宝物庫発見に使う。 | reveal bonus、宝箱/壁イベントへの補正。 | now | `PICK_AXE`, `DWARVISH_MATTOCK` |
| 鎖帷子の改良型 | Chain Mail / Splint Mail | 既存 `chain-mail` の上位/横展開。防御は高いが罠に弱い。 | defense と trapAvoidPenalty の tradeoff。 | now | `CHAIN_MAIL`, `SPLINT_MAIL` |
| 魔除けの外套 | Cloak of Magic Resistance | caster/boss 対策の防具。 | spell/ranged damage 軽減または condition 抵抗。 | later | `CLOAK_OF_MAGIC_RESISTANCE` |
| 隠れ歩きの外套 | Elven Cloak / Stealth Ring | 敵に見つかりにくいのではなく、初回被発見や罠回避へ翻訳。 | encounter 初期距離補正、trap avoid、AI 評価。 | next | `ELVEN_CLOAK`, `RIN_STEALTH` |
| 反射の盾 | Shield of Reflection | 遠隔/魔法対策の明確な防具報酬。 | rangedDefense 強化、直線攻撃軽減。 | later | `SHIELD_OF_REFLECTION` |
| 速足の靴 | Speed Boots | 行動速度ではなく探索テンポと逃走力へ翻訳。 | step bonus は重いので、低HP時の逃走補正や探索停滞軽減。 | parked | `SPEED_BOOTS` |
| 水渡りの靴 | Water Walking Boots | 水場 encounter を入れる時の対策装備。 | water/liquid terrain が必要。 | parked | `WATER_WALKING_BOOTS` |
| 再生の指輪 | Ring of Regeneration | 回復職以外にも sustain を与える late 装備。 | turn-based regen、AI の装備評価。 | next | `RIN_REGENERATION` |
| 探索の指輪 | Ring of Searching | 罠/隠しイベントの発見率を上げる。 | trap reveal、secret room/event reveal。 | now | `RIN_SEARCHING` |
| 予兆の兜 | Helm of Caution / Telepathy | 見えない危険の警告。敵表示ではなく危険方向 hint にする。 | warning UI、GameObservation への危険ヒント。 | later | `HELM_OF_CAUTION`, `HELM_OF_TELEPATHY` |
| 抗毒の外套 | Alchemy Smock / Green Dragon Scale | crypt や毒敵への対策装備。 | venom/poison 軽減、状態異常耐性。 | next | `ALCHEMY_SMOCK`, `GREEN_DRAGON_SCALE_MAIL` |
| 火除けの鱗鎧 | Red Dragon Scale Mail | furnace 対策の late armor。 | fire/ember 軽減、重装備 tradeoff。 | later | `RED_DRAGON_SCALE_MAIL` |
| 透視の水晶 | Crystal Ball / Mapping Scroll | 地図読み、敵/罠 reveal の希少道具。 | 既存 mapping 系を強化、使用回数または cooldown。 | next | `CRYSTAL_BALL`, `SCR_MAGIC_MAPPING` |
| 鍵束と解錠具 | Lock Pick / Skeleton Key | 宝箱/封印部屋を安全に扱う utility。 | event interaction の成功率補正。 | next | `LOCK_PICK`, `SKELETON_KEY` |
| 宝石の核 | Diamond / Ruby / Dilithium Crystal | 換金、score、boss reward、craft 素材。 | gold 以外の高価値 loot、merchant 価格。 | later | `DIAMOND`, `RUBY`, `DILITHIUM_CRYSTAL` |
| 食糧/保存食 | Food Ration / Cram Ration | 空腹システムなしなら回復/休息補助に翻訳。 | 今は不要。休息や探索疲労を入れる時まで保留。 | parked | `FOOD_RATION`, `CRAM_RATION` |

## 実装時の優先候補

最初に追加するなら `探索の指輪`, `つるはしの聖具`, `抗毒の外套`, `銀祓いの刃` がよい。既存の探索、罠、状態異常、敵 family に直接つながる。

## 保留する方向

- launcher/ammo の本格実装は、弓職を入れるまで保留する。
- boots 系は移動ルールや水地形が増えてから扱う。
- dragon scale 系は属性攻撃と boss reward が揃うまで、高価値装備 seed として残す。
