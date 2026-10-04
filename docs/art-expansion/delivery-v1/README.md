# Black Candle 拡張素材 v1 納品記録

## ゲーム統合後の追検品（2026-10-04）

29シート・137セルをゲームへ登録し、追加の職業・敵・装備・寄り道部屋・FXへ接続した。FX 6種はローカルのChromeで実再生し、80msのフレーム進行、共通倍率、impactの消失を確認。制作時点に残っていた再生検品待ちは解消した。ゲーム画面もdesktopと420×912で無音確認した。実装範囲・バランス比較・検証資料は [拡張v1の実装記録](../implementation-plan.md) を参照。

以下と納品台帳は制作時点の記録として残す。元PNG・プロンプト・加工記録は変更していない。

## 制作時点の結果

全29シート・91デザイン・137有効セルを生成し、指定先へ保存。既存アイテム・罠・イベントのP0から順に制作した。
- 検品済み: 23シート（P0 8、敵3、人物4、地形3、小物3、新装備2）
- 生成・静止検品済み／実再生検品待ち: FX 6シート
- 未生成: 0シート
- ゲームコード、バランス、出現設定、元の台帳、既存PNGは変更していない。ゲーム内登録・表示・AI・バランス検証は行っていない。

## 制作時点の未確認事項（追検品で解消）

FXの確認用HTMLをクラウドブラウザーで開いたところ、ローカルURLが `net::ERR_BLOCKED_BY_CLIENT` で拒否された。アクセス制限は回避していない。6種とも静止フレーム、中心の位置合わせ、共通倍率、4フレームの符号化と80ms設定は確認したが、実際に再生して滑らかさを目視したとは報告しない。このためFXは台帳の `needs-fix`（再生検品待ち）とする。確認用HTMLとGIFを同梱し、再生を行える環境で最終確認できる。

## 制作・加工

- 使用機能: dot内蔵 `image_gen.imagegen`。モデル名は未公開。外部の有料画像API、外部コーディングエージェントは不使用
- 実際に使ったプロンプトは [prompts.md](prompts.md)、元参照のSHA-256も同ファイルに記録
- PNGはsRGB ICC付き。全セル128×128、row-major順。地形はRGB不透明、その他RGBA。suppliesのindex7は完全透過
- 原稿は各シート単位で生成。一部セルだけの修正原稿は指定セルへ再合成。人物は各職共通倍率で足元y=107に整列
- 小獣・虫は重い敵より小さくした。アイテムは長辺約78%、透明周縁8px以上
- クロマキー透過、周縁の不要画素除去、切り出し、位置合わせ、縮小、合成のみスクリプトを使用。プログラムで素材の代替図形は描いていない
- 地形は生成画像の対辺12px帯を重み付き平均で修正し、四辺連続性を確保
- FXは全フレーム共通倍率、原点だけを整列。消失するフレームを別々に最大化していない。impactはalpha減衰。結界は生成された同一形状をalphaのみ変化させ、サイズが跳ねないようにした

## 検品

- 指定名、寸法、全137セルの切り出し、空セル、8px周縁、sRGBを計測
- アイテム32/24px、人物・敵64/48pxを実画像として表示し目視
- 既存4領域の実際の床セルへ合成。床付き四角・切れ・隣セル混入を確認
- 地形各セル4×4反復、床と壁の明度差・継ぎ目を目視。全6セルの対辺RGB差は0
- 4職の方向順、正面／背面、装備の持ち手、体格・足元を目視。横向きで隠れる手や道具は遮蔽として記録
- FXの実再生は上記の理由で未確認

## 検品資料

- [items](contact-items.png) / [monsters](contact-monsters.png) / [heroes](contact-heroes.png) / [props](contact-props.png)
- [地形4×4反復](terrain-repeat.png)
- [既存4領域への合成](background-composites.png)
- [FX静止フレーム一覧](fx-contact.png) / [GIF符号化検査](fx-encoding-checks.json)
- GIF: [魔弾](fx-ember-bolt.gif) / [癒し](fx-mending-light.gif) / [風](fx-repulsion-gust.gif) / [結界](fx-ward-aura.gif) / [毒](fx-venom-impact.gif) / [氷](fx-frost-bind.gif)
- [FX確認用HTML](fx-preview.html)（リポジトリルートをローカルHTTP配信して開く。無音）
- [実測一覧](qc-measurements.json)
- [納品台帳](asset-manifest-delivered.json)

## シート別状態

| key | 状態 | 修正・注意 |
|---|---|---|
| existing-weapons | ready | 初稿の背景光と両刃斧を却下。単色背景・片刃斧として再生成。 |
| existing-armor | ready | 切り出し、共通基準の配置、縮小、alpha周縁除去。 |
| existing-vials | ready | 切り出し、共通基準の配置、縮小、alpha周縁除去。 |
| existing-supplies | ready | 切り出し、共通基準の配置、縮小、alpha周縁除去。 |
| existing-relics | ready | 切り出し、共通基準の配置、縮小、alpha周縁除去。 |
| existing-traps | ready | 高い噴霧器と井戸状の穴を却下。低い噴霧口・薄い崩れ縁へ再生成。 |
| existing-events-a | ready | 切り出し、共通基準の配置、縮小、alpha周縁除去。 |
| existing-events-b | ready | 切り出し、共通基準の配置、縮小、alpha周縁除去。 |
| monsters-blackstone | ready | 切り出し、共通基準の配置、縮小、alpha周縁除去。 |
| monsters-crypt | ready | 箱の牙を上蓋だけに修正生成。酸塊を鈍い緑へ修正生成し、緑のゲル部分のalphaを210にして半透過化。 |
| monsters-furnace | ready | 猟犬の足下と騎士の脇の分離した不要画素を除去し、実際の足元を再整列。 |
| new-weapons-tools | ready | 切り出し、共通基準の配置、縮小、alpha周縁除去。 |
| new-armor-utility | ready | 切り出し、共通基準の配置、縮小、alpha周縁除去。 |
| hero-relic-surveyor | ready | 南東の持ち手を修正。東の近側眼鏡と南東の両眼鏡を修正し、片眼鏡を維持。 |
| hero-ash-apothecary | ready | 切り出し、共通基準の配置、縮小、alpha周縁除去。 |
| hero-iron-oath-vanguard | ready | 切り出し、共通基準の配置、縮小、alpha周縁除去。 |
| hero-keyshadow-rogue | ready | 切り出し、共通基準の配置、縮小、alpha周縁除去。 |
| terrain-ore-mine | ready | 各セルの対辺12px帯を重み付き平均で連続化。端のRGB差は上下・左右とも0。4×4反復を目視。 |
| props-ore-mine | ready | 切り出し、共通基準の配置、縮小、alpha周縁除去。 |
| terrain-sunken-archive | ready | 各セルの対辺12px帯を重み付き平均で連続化。端のRGB差は上下・左右とも0。4×4反復を目視。 |
| props-sunken-archive | ready | 切り出し、共通基準の配置、縮小、alpha周縁除去。 |
| terrain-thorn-chapel | ready | 各セルの対辺12px帯を重み付き平均で連続化。端のRGB差は上下・左右とも0。4×4反復を目視。 |
| props-thorn-chapel | ready | 切り出し、共通基準の配置、縮小、alpha周縁除去。 |
| fx-ember-bolt | 生成・静止検品済み、実再生未確認 | 切り出し、共通基準の配置、縮小、alpha周縁除去。 |
| fx-mending-light | 生成・静止検品済み、実再生未確認 | 切り出し、共通基準の配置、縮小、alpha周縁除去。 |
| fx-repulsion-gust | 生成・静止検品済み、実再生未確認 | 雷状の初稿を却下。短い曲線の風弧へ修正生成。 |
| fx-ward-aura | 生成・静止検品済み、実再生未確認 | 再生成後も輪の大きさの差が残ったため、生成された第0フレームの形状を共通使用し、alphaだけを0.55/0.78/1/0.78倍にして脈動。プログラムで図形は描いていない。 |
| fx-venom-impact | 生成・静止検品済み、実再生未確認 | 切り出し、共通基準の配置、縮小、alpha周縁除去。 |
| fx-frost-bind | 生成・静止検品済み、実再生未確認 | 切り出し、共通基準の配置、縮小、alpha周縁除去。 |

## 保管と再確認

最終PNG・台帳・プロンプト・検品画像だけで内容を確認可能。大きな生成原稿はGit管理外の作業領域に保存し、最終納品の動作はそれに依存しない。元の計画台帳は変更せず残した。
