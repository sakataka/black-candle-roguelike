# Black Candle Roguelike

TypeScript + Vite + PixiJS で作っている独自ローグライクです。目的は NetHack 互換ではなく、暗めの王道ファンタジーを土台にした新作として育てることです。

## 現状

- ゲーム状態とルールは `src/game/core/` にあります。
- AI は `src/game/ai/`、表示は `src/game/renderer/`、コンテンツ定義は `src/game/content/` に分けています。
- 階層は 1-3F の黒石迷宮、4-6F の墓所、7-9F の炉心遺跡、10F の黒燭中枢に分かれ、領域ごとに地形画像と出現傾向が変わります。
- マップ生成は単なるランダム配置ではなく、開始圏、寄り道/報酬圏、危険圏、出口圏を持つ配置プランで、敵・報酬・イベント・罠の置き場所に意図を持たせています。
- 生成AIで作った遮蔽地形が各バイオームに配置されます。遮蔽は歩行可能ですが視線と遠隔攻撃の射線を遮るため、遠隔敵への対策として使えます。
- 血針罠、毒霧床、崩れ床が配置され、発見済みの罠はAIが避けます。罠は敵にも発動します。
- 罠は必ず発動するわけではなく、基本回避率と装備・職業特性による補正で回避判定があります。回避率の下限/上限も JSON で調整できます。
- 遠隔敵や術師は近づかれると間合いを取り直し、灰燼の呪術師は灰の小型敵を呼びます。墓所の蛭は噛みつくと少し回復します。
- 封印部屋、亡者の食堂、宝物庫、燭台廊、骨塚部屋、炉心室は、踏むと周辺に敵・報酬・罠・遮蔽を展開する小部屋イベントです。部屋名ごとに「待ち伏せ」「亡者と物資」「遮蔽越しの守り手」など役割が違います。
- 忌み祭壇、炉心制御碑、封印鍵は階層をまたぐ小目的イベントです。祭壇は代償つきで隠れ罠を一部暴き、制御碑は7F以降の通常敵を弱め、封印鍵は次のボス報酬を増やします。
- 旅商人は自動購入ではなく、商人マス上で回復、解毒・止血、装備購入、地図購入からサービスを選びます。AIも同じ `merchantService` action で状況に応じて購入します。
- 無銘の小瓶と封じた祈祷札は、使うまで効果が読みにくい不安定アイテムです。回復や護りになることもあれば、毒・出血などの反動もあります。灯火の祈祷者は危うい祈祷札や小瓶を比較的安全に扱えます。
- 3F、6F、10Fには固定ボスが出現し、倒すまで下り階段が封じられます。ボスは専用遺物を落とします。
- 開始職は、誓約の探索者、灰弓の斥候、灯火の祈祷者から選べます。職業ごとに初期HP、攻撃、防御、初期装備、職業特性、10階run内で完結する小さな固有目的があります。画面右側の職業特性パネルで現在の職業の特徴を確認できます。
- 誓約の残響、灰弓の隠し印、灯火の泉は職業専用イベントです。該当職なら報酬や探索補助が強くなり、非該当職でも小さな効果だけ得られます。
- 装備は単純な攻撃/防御値だけでなく、遠隔防御、罠回避補正、罠回避ペナルティ、特定ファミリーへの追加ダメージを持てます。罠織りの外套は罠回避、塔凧の大盾は遠隔対策、銀打ちの戦槌は不死・悪魔対策に寄せています。
- チューニング用の主要パラメーターは `public/config/game-balance.json` にあります。dev server 起動中でも JSON を編集してブラウザをリロードすれば、再ビルドなしで反映できます。
- 新しい敵・アイテム・武器・イベントは、PNGスプライトシートを `public/assets/sprites/` に置き、`src/game/content/assets.ts` で切り出します。
- NetHack 由来の参照データは設計 seed としてのみ扱い、現行実装は TypeScript 製の独自ゲームとして進めます。
- 旧 Tauri / xterm / NetHack bridge 実装はリポジトリから削除済みです。

## 起動

```sh
bun install
bun run dev -- --host 127.0.0.1 --port 1420
```

確認先:

```text
http://127.0.0.1:1420/
```

## ビルド

```sh
bun run build
```

## 設定ファイル

ゲームバランスは `public/config/game-balance.json` で編集します。主な項目は以下です。

- `rules`: マップサイズ、視界、最大階層、所持枠、経験値テーブル、レベルアップ、敵/アイテム/罠/遮蔽の出現数、罠回避率、状態異常ダメージなど
- `roles`: 開始職の初期ステータス、初期インベントリ、職業特性、画面表示用の特徴説明
- `monsterStats`: 敵ごとの HP、攻撃、防御、階層補正
- `monsterSpawnRules`, `itemPools`, `guaranteedItems`, `eventPools`, `trapPools`, `bosses`: 階層・バイオームごとの出現設定
- `equipment`, `consumables`, `events`, `merchantOffers`, `trapEffects`: 武器/防具の値、遠隔防御、罠回避補正、消耗品効果、イベント報酬、小目的フラグ、商人価格、罠効果

`src/game/content/entities.ts` は名前、説明、タグ、アセット生成用メモなどのコンテンツ辞書です。数値調整は基本的に JSON 側で行い、ゲームロジックへ直接埋め込まない方針です。

## AIシミュレーション

```sh
bun run simulate:ai 20262625 700
bun run simulate:ai 20260504 600
bun run simulate:ai 20260505 600
bun run simulate:ai 20260506 600
bun run simulate:ai 20260504 700 role.ash-scout
bun run simulate:ai 20260504 700 role.lantern-priest
```

AIやcoreを触った場合は、拾得、アイテム使用、戦闘、階層移動が発生することを確認します。階層テーマや罠を触った場合は、複数seedで墓所や炉心遺跡まで到達し、罠でクラッシュしないことも確認します。

## バランス調整PDCA

複数seed、複数職業、複数configを同じ条件で回すには batch simulation を使います。

```sh
bun run simulate:batch -- --seeds 20260504:20260533 --turns 800 --roles all --label baseline
bun run simulate:batch -- --seeds 20260504:20260533 --turns 800 --roles all --config baseline=public/config/game-balance.json --config scout-buff=tmp/balance/scout-buff.json --out tmp/sim-reports/scout-buff.json
bun run simulate:batch -- --seeds 20260504:20260533 --turns 1600 --roles all --jobs 4 --label baseline-1600
```

出力は `tmp/sim-reports/*.json` と `tmp/sim-reports/*.md` に保存されます。`tmp/` はGit管理外です。Markdown summary では、職業ごとの到達階、勝敗、死亡原因、低HPターン、探索停滞、既知罠踏み、拾得、戦闘、階層移動、アイテム使用、AI改善ヒントを見ます。各runと集計には `elapsedMs`、平均ms/run、runs/sec も含めているため、パラメータ探索が重くなった時に TypeScript のまま最適化するか、Rust/C などの別実装を検討する材料にできます。batch はデフォルトで `--jobs 8` の並列実行を使います。CPU負荷を下げたい時は `--jobs 4`、単純な再現確認では `--jobs 1` を指定します。

基本の流れ:

1. 変更前の baseline を保存する。
2. `public/config/game-balance.json` をコピーして候補configを作る。
3. 同じseed集合と職業集合で `simulate:batch` を実行する。
4. Markdown summary の差分を見る。
5. AIの判断ミスが目立つなら `src/game/ai/autoplay.ts`、数値の偏りなら `public/config/game-balance.json` を直す。

## 操作

- 方向キー / WASD / QEZC: 移動
- 画面上部の職業ボタン: 開始職を選んで再生成
- `G`: 足元のアイテム取得
- `X`: 選択中の所持品を捨てる
- `Enter`: 階段を降りる
- Space / `.`: 待機
- インベントリ内のアイテムクリック: 詳細ポップアップ表示
- 右側の職業特性パネル: 現在の職業の基本値、初期装備、特徴、強みを確認
- 旅商人マス上のサービスボタン: Goldを支払って回復、解毒・止血、装備、地図を購入
- `1`: 回復薬
- `2`: 地図
- `3`: 燠火の投げ針
- `4`: 護りの青薬
- `5`: 退き風の巻物
- `6`: 微光の小地図
- `7`: 血苔の軟膏
- ボス遺物はインベントリで選択して「使う」を押すと発動します。

## 職業別の小目的

- 誓約の探索者: HPと攻撃が高い標準職です。ボス/守り手を倒すたび、足元付近に追加報酬が落ちます。
- 灰弓の斥候: 地図利用と遠隔圧への対応が得意です。地図系アイテムや地図購入を使うたび、追加探索と燠火の投げ針補充が起きます。職業特性として罠回避と遠隔防御も少し高めです。
- 灯火の祈祷者: 状態異常対策と防御的な粘りが特徴です。祭壇や浄化系の回復を使うたび、毒・出血を払い、短い護りを得ます。
- 職業専用イベント: 誓約の残響は誓約の探索者へ備蓄を残し、灰弓の隠し印は斥候へ投げ針と小地図を補充し、灯火の泉は祈祷者の状態異常を護りへ変えます。

## 地形と戦術

- 遮蔽地形は `cover` タイルとして扱われます。歩いて進入できますが、FOV と遠隔攻撃の射線を遮ります。
- 遮蔽数は `rules.coverCountBase`, `coverCountFloorDivisor`, `coverCountMax` で調整します。
- 遮蔽画像は `public/assets/sprites/dungeon-cover-sheet.png` にあり、黒石迷宮、墓所、炉心遺跡、黒燭中枢の4種類を `src/game/renderer/PixiRoguelikeRenderer.ts` で切り出します。
- 敵・報酬・イベント・罠は `src/game/core/game.ts` の floor plan によって、開始圏、寄り道/報酬圏、危険圏、出口圏へ寄せて配置されます。

## 参照資料

現時点で残している参照資料は、新作ローグライクの設計素材として使うものだけです。

- `docs/roguelike-role-candidates.md`
- `docs/roguelike-enemy-candidates.md`
- `docs/roguelike-item-equipment-candidates.md`
- `docs/roguelike-encounter-room-candidates.md`

旧NetHackビルド、Tauriアプリ、xterm表示、JSON bridge の復旧は現在の方針外です。
