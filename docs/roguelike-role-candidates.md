# 新作向け職業候補メモ

このメモは旧 NetHack 抽出データを、新作ローグライクで使いやすい職業候補へ圧縮したものです。NetHack の職業名や数値を再現するためではなく、操作感、初期導線、成長軸、職業固有イベントの seed として使います。

## このメモの使い方

- 既存の `role.oathbound`, `role.ash-scout`, `role.lantern-priest` と被らない操作感を優先する。
- まずは `now` または `next` の候補だけを、1職ずつ実装して `simulate:batch` で比較する。
- 初期装備は NetHack 名を直接使わず、同じ役割の新作アイテムへ置き換える。
- AI/autoplay が扱えない職業 mechanic は、実装前に `GameAction` と `GameObservation` の追加要否を確認する。

## 採用しない情報

- 旧来の属性、神名、ランク名、性別差分、クエスト固有名は採用しない。
- HP/energy の配列値や spell penalty はそのまま使わず、「丈夫」「脆い」「魔法寄り」程度の方向性に翻訳する。
- `UNDEF_TYP` や blessing など NetHack の識別/祝福システムに強く依存する初期装備情報は捨てる。

## 元にした情報

- 旧 `roles.enriched.json` の職業 archetype、初期装備、成長傾向、クエスト seed。
- 旧 reference usage doc の「NetHack 由来データは seed として扱う」方針。

## 候補一覧

| 候補名 | 元 seed | 新作での役割 | 実装に必要な仕組み | 優先度 | 参考元 |
| --- | --- | --- | --- | --- | --- |
| 遺物調査員 | Archeologist | 探索道具職。地形記憶、隠し部屋、罠発見を伸ばす。 | 罠/イベント検知補正、探索済み範囲の追加 reveal、軽い道具報酬。 | now | `roles.enriched.json: role.archeologist` |
| 鉄誓の重戦士 | Barbarian / Knight | 高HP・重装備の前衛。単純に強いが探索や罠が苦手。 | 重装備ペナルティ、被弾許容型 AI、強武器初期装備。 | next | `role.barbarian`, `role.knight` |
| 灰薬師 | Healer | 回復支援職。低攻撃だが状態異常と低HPから復帰しやすい。 | 回復アイテムの初期所持、状態異常回復、AI の緊急使用優先度。 | now | `role.healer` |
| 鍵影の盗賊 | Rogue | 罠と宝箱に強い短剣職。戦闘は脆いが報酬期待値が高い。 | 罠回避/解除、宝箱イベント改善、短剣/投擲の軽量武器軸。 | next | `role.rogue` |
| 荒野の追跡者 | Ranger | 遠隔・探索職。見えている敵への対応と地図読みが得意。 | 弓/投擲系の補強、遠隔攻撃 AI、足跡/敵位置ヒント。 | later | `role.ranger` |
| 燭火の秘術師 | Wizard | 脆い制御職。攻撃より reveal、押し返し、状態付与で生きる。 | MPまたは cooldown、制御アイテム、AI の距離維持。 | later | `role.wizard` |
| 無手の修行者 | Monk | 低装備・高回避の職。装備を拾うほど方向性が揺れる。 | 素手攻撃、軽装ボーナス、重装備ペナルティの明示。 | parked | `role.monk` |
| 巡礼司祭 | Priest | 対不死・祭壇・浄化に寄せた支援職。既存 priest と被るので慎重に扱う。 | 祭壇イベント、undead counter、状態異常をリソースに変換。 | parked | `role.priest` |

## 実装時の優先候補

最初に追加するなら `遺物調査員` か `灰薬師` がよい。どちらも既存の探索、罠、回復、状態異常に接続でき、ゲーム core の大改造なしで差別化できる。

`鉄誓の重戦士` は数値だけでも成立するが、既存の `role.oathbound` と近い。追加する場合は「重装備で罠や探索が鈍る」「強敵との正面戦に強い」という tradeoff を明確にする。

## 保留する方向

- 騎乗、ペット、祝福/呪い、細かいスキル熟練度は今の core には重い。
- 職業別クエストは、まず room/event 候補として設計し、職業実装とは分ける。
- 種族や属性は職業候補には混ぜず、将来の origin/background 設計に回す。
