# Black Candle Roguelike

TypeScript + Vite + PixiJS で作っている自律遠征ローグライクです。プレイヤーは探索者を直接動かさず、灰灯院の観測者「灯守」として候補者を選び、節目だけ方針へ介入します。

## 現状

- seedから名前・職業・気質を持つ候補者が生成され、選択後はAIが自動で遠征します。通常UIには移動、アイテム使用、AI開始の直接操作を出しません。
- 遠征開始時に「守り手の誓約」「遺物台帳の補完」「灯路の先駆け」から任務を選びます。任務はラン内の目標、達成報酬、得点、遠征録へ反映されます。
- 3階・6階の帰還判断、4〜6階・7〜9階の文脈判断、10階の黒燭核または結末を含め、1ランの選択は候補者選択を含む4〜6回です。
- 4〜9階の文脈判断は、HP、状態異常、遠隔敵、所持品、経過ターンに応じた危機介入です。回復、護り、浄化、地図化、敵の押し戻し、金や最大HPの代償がその場でゲーム状態へ反映されます。
- 「慎重・探究・剛胆」の気質と「生還・探究・征圧」の方針がAI判断へ反映されます。気質と異なる判断へ上書きできる「啓示」は1ラン2回です。
- 1倍速を基準に、0.5倍・1倍・2倍・3倍で観戦できます。選択中はAIとラン内時計が止まります。
- 1350ターンで観測限界を警告し、1600ターンで未帰還「灯路断絶」となります。
- 得点は進行、守護者、職業目的、発見、生還、持帰り、迅速、任務・介入の8項目で集計し、結果画面に内訳を表示します。啓示を残すこと自体には加点せず、任務達成と実際の危機介入を評価します。
- campaignは `black-candle-campaign-v1` としてローカル保存し、保存形式version 2で三職業の真相、結末、任務、危機介入、最大100件の遠征録を保持します。旧version 1の記録は読み込み時に移行します。能力値の恒久強化はありません。
- 遠征進捗には最高到達階、自己ベスト、踏破回数、達成任務、6段階の物語マイルストーンを表示します。結果画面では前回との深度・得点比較と、新記録や新しい真相・結末を表示します。
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
- 3F、6F、10Fには固定ボスが出現し、倒すまで下り階段が封じられます。6階から生還すると職業固有の真相を記録でき、三つ揃えた後の10階では「継燭・消燭・分灯」の結末を選べます。
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

- `rules`: マップサイズ、視界、最大階層、所持枠、経験値テーブル、レベルアップ、敵/アイテム/罠/遮蔽の出現数、罠回避率、状態異常ダメージ、観測ターン上限など
- `autonomous`: 啓示回数、任務・危機介入を含む得点係数、観戦速度の基準時間
- `roles`: 開始職の初期ステータス、初期インベントリ、職業特性、画面表示用の特徴説明
- `monsterStats`: 敵ごとの HP、攻撃、防御、階層補正
- `monsterSpawnRules`, `itemPools`, `guaranteedItems`, `eventPools`, `trapPools`, `bosses`: 階層・バイオームごとの出現設定
- `equipment`, `consumables`, `events`, `merchantOffers`, `trapEffects`: 武器/防具の値、遠隔防御、罠回避補正、消耗品効果、イベント報酬、小目的フラグ、商人価格、罠効果

`src/game/content/entities.ts` は表示名と、AI・戦闘・得点で使う最小限の分類値だけを持つコンテンツ辞書です。数値調整は基本的に JSON 側で行い、画像の切り出しは `src/game/content/assets.ts`、生成方針は `AGENTS.md` と `docs/` に集約します。

## AIシミュレーション

```sh
bun run simulate:ai 20260504 1600 role.oathbound --decision-policy temperament
bun run simulate:ai 20260504 1600 role.ash-scout --decision-policy always-continue
bun run simulate:ai 20260504 1600 role.lantern-priest --decision-policy return-6
```

`--decision-policy` は `temperament`、`always-continue`、`return-3`、`return-6` を指定できます。AIやcoreを触った場合は、拾得、アイテム使用、戦闘、階層移動、選択解決が発生することを確認します。

## バランス調整PDCA

複数seed、複数職業、複数configを同じ条件で回すには batch simulation を使います。集計には任務達成率と平均危機介入回数も含まれます。

```sh
bun run simulate:batch -- --preset smoke
bun run simulate:batch -- --preset standard --decision-policy temperament
bun run simulate:batch -- --preset standard --decision-policy always-continue --profile
bun run simulate:batch -- --preset compare --config baseline=public/config/game-balance.json --config scout-buff=tmp/balance/scout-buff.json --out tmp/sim-reports/scout-buff.json
bun run simulate:batch -- --preset deep --seeds 20260504 --roles role.ash-scout
```

出力は `tmp/sim-reports/*.json` と `tmp/sim-reports/*.md` に保存され、毎回 `tmp/sim-reports/latest.json` と `tmp/sim-reports/latest.md` も更新されます。`tmp/` はGit管理外です。職業別・気質別の勝敗、帰還・未帰還、得点中央値、発見、拾得、100ターン当たりの戦闘、方針選択分布、想定表示時間を比較できます。

preset は用途で使い分けます。`smoke` は機能追加直後の短時間確認、`standard` は完了前の標準確認、`compare` は baseline/candidate の同一seed比較、`deep` は問題seedの長ターン再現と `--trace` / `--profile` 付き深掘りです。通常batchは `--log-limit 40` で直近ログだけ保持し、集計値は保持します。完全な直近以上の run log が必要な時は `--log-limit none` を指定します。CPU負荷を下げたい時は `--jobs 4`、単純な再現確認では `--jobs 1` を指定します。

基本の流れ:

1. 変更前の baseline を保存する。
2. `public/config/game-balance.json` をコピーして候補configを作る。
3. 同じseed集合と職業集合で `simulate:batch -- --preset compare` を実行する。
4. Markdown summary の `PDCA Alerts` と `Top Run Regressions` から悪化seedを見る。
5. AIの判断ミスが目立つなら `src/game/ai/autoplay.ts`、数値の偏りなら `public/config/game-balance.json` を直す。

## 操作

- 候補者カードをクリックまたは `1`〜`3`: 探索者を選び、自律遠征を開始
- 選択カードをクリックまたは `1`〜`4`: 気質どおりに見守る、帰還させる、啓示で方針を上書きする
- `0.5×` / `1×` / `2×` / `3×`: 観測速度を変更
- `新しい遠征`: 次のseedで候補者選択へ戻る

移動、戦闘、拾得、装備、アイテム使用、商人利用、階層移動はすべてAIが人間と同じ `GameAction` で行います。直接操作は開発用のdebug bridgeだけに残しています。

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
