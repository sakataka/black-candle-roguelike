# Dots向け: Black Candle拡張素材の制作依頼

## 最初に渡す指示

以下の段落を依頼文として使ってください。台帳と参照画像にもアクセスできる状態で渡してください。

> このリポジトリの `docs/art-expansion/dots-request.md` と `docs/art-expansion/asset-manifest.json` を読み、Black Candle Roguelikeの拡張用PNG素材を制作してください。暗めの王道ファンタジーで、既存のピクセル調画像と一致させます。既存装備・道具の見分けやすさを改善し、今後の敵・職業・部屋・魔法拡張に使う画像を先に揃えることが目的です。P0から順に、台帳の91デザイン・137セル・29シートを制作し、指定ファイル名・セル順・透過・寸法で納品してください。PNG生成と後処理・検品・制作記録までを担当し、ゲームコード・ゲームバランス・出現テーブル・既存PNGは変更しないでください。新規候補は未実装です。プロンプト例、検品基準、納品仕様は依頼書にあります。生成機能や参照画像にアクセスできない場合は完成したと報告せず、制作可能な範囲と不足条件を記録してください。

## 目的と世界観

Black CandleはTypeScript + PixiJSの自律遠征ローグライクです。探索者は暗い迷宮を自ら進み、観測者の灯守は灰灯院から見守り、灯火で任意に介入します。迷宮は黒石、墓所、炉心遺跡、黒燭中枢へ続きます。命火、燠火、古い誓い、骨、鉄、擦れた革、灰、蝋、失われた祈りを主なモチーフにしてください。

現行は3職業・18種の敵・27種のアイテム。槍と斧など別の品が同じ画像を共有しています。今回はまずその不足を埋め、さらに新しい敵12種、装備/道具12種、職業4種、部屋テーマ3組、効果6種の素材を準備します。魔法や装備枠の新機構はまだ決まっていません。画像の内容から勝手にゲームシステムを実装しないでください。

暗い世界でも、画像全体を黒く潰さないでください。黒鉄には明るい稜線、骨にはくすんだ白、革には茶、燠火には橙、祈りには金白、記憶には青白を少量使い、64pxの人物・敵、32pxのアイコンでも形と用途が分かるようにします。色違いだけに頼らず、輪郭・道具・材質を変えてください。可愛いデフォルメ、現代品、SF、写実3D、既存作品の固有キャラクターは避けます。

## 読む資料と参照PNG

制作対象・ファイル名・セル位置の正本は **[asset-manifest.json](asset-manifest.json)** です。`contentStatus: existing` は現行コンテンツ、`proposed` は未採用候補。`assetId` は後日登録する予定の画像IDで、ゲームの `contentId` とは別です。台帳は現行ランタイムでは読み込まれません。

各セルの `briefJa` が描く内容、`index` が配置位置です。`family` / `encounterRole` / `tier` は敵の見た目の差を考えるための設計メモで、能力値の指示ではありません。`integrationNoteJa` は後日必要な実装を表します。

最初に下のPNGを画像として開いて見てください。ファイル名だけをプロンプトへ書いて参照したことにしないでください。生成機能が参照画像を扱える場合は、該当画像を実際に添付して作風を合わせます。

| ファイル | 参照するもの |
| --- | --- |
| `public/assets/sprites/dungeon-entities-sheet.png` | 敵・金属・薬瓶・道具の輪郭、陰影、密度 |
| `public/assets/sprites/dungeon-expansion-sheet.png` | 虫、術師、重い鎧、祭壇などの材質と作風 |
| `public/assets/sprites/dungeon-journey-guardians.png` | 守り手の存在感。巨大でもセル内へ収める |
| `public/assets/sprites/oathbound-directions.png` | 主人公の8方向順、足元と体形の基準 |
| `public/assets/sprites/ash-scout-directions.png` | 軽装人物の基準 |
| `public/assets/sprites/lantern-priest-directions.png` | ローブ・灯の基準 |
| `public/assets/sprites/dungeon-journey-terrain.png` | 現行4領域の床/壁の描き分け。繰り返し方は改善してよい |
| `public/assets/sprites/dungeon-cover-overlays.png` | 床を含まない遮蔽物の基準 |

背景の黒が実際の不透明な黒か、透過PNGの表示上の黒かはalphaチャンネルで確認してください。既存画像の黒背景、不要なマゼンタ縁、継ぎ目などの不具合まで模倣しないでください。

## 納品仕様

### 全シート共通

- 最終形式はsRGBのPNG。JPEG・SVG・スクリーンショットによる代替は不可。
- セルは**128×128px**。最終シートの幅・高さ・列・行は台帳の指定どおり。生成時は1セル512pxを目標とし、検品後に縮小・整列して最終寸法へ加工する。生成機能が希望寸法を出せない場合も、最終PNGは指定どおりにする。
- `index` は0始まり、左から右、その次の行。余白のセルは台帳の `emptyIndices` で指定する。余白へ別の素材を追加しない。
- セル間の溝、罫線、余白帯は0px。被写体の余白はセルの内側に取る。名札、数字、文字、カード枠、透かし、背景用の四角を入れない。
- 同系統を一つのシートにまとめる。生成がセル境界や内容数を守れない場合は、該当する小さな群で生成・修正し、後処理で指定シートへ正確に組み立てる。
- 画像そのものは生成AIで制作する。プログラムで素材を描き起こした仮図形を完成画像にしない。スクリプトは切り出し、透過処理、位置合わせ、縮小、結合、検品に使ってよい。
- 台帳の `file` はリポジトリ内の保存先。PNGは `public/assets/sprites/expansion-v1/bc-{key}-v1.png`。既存PNGを上書きしない。

### 透過と配置

人物、敵、アイテム、罠、イベント、部屋小物、FXの最終PNGはRGBAの背景透過。背景透過が生成機能で保証できない場合、素材部分に使わない**単色 `#FF00FF`**背景で生成し、後処理でalphaへ変換してください。黒色の被写体があるので黒を透過キーにしないでください。市松模様を描いた画像は透過ではありません。マゼンタの縁も除去してください。

床・壁だけは不透明でセル全体を埋める。床を小物や罠の下へ描き込まない。物体そのものの台座は可、周囲の地面や外側へ広がる影は不可。

| 分類 | 視点・配置 | 安全余白・用途 |
| --- | --- | --- |
| 人物 | 既存と同じ少し見下ろす正投影、足元アンカー | 身体の高さ約68%、足元はセル高さの84%。全装備は中央80%以内 |
| 敵 | 人物と同じ視点、原則正面〜前斜め、接地位置84% | 全体中央80%以内。小獣は小さく、守り手は大きく。飛行敵は別途位置を記録 |
| アイテム | 既存に合う少し見下ろす視点、中央アンカー | 長辺約70〜80%。小さな指輪もUIで分かる大きさに構図を調整 |
| 罠・小物 | 既存床へ重ねる視点、中央アンカー | 物体や局所的な亀裂だけ。全体中央80%以内 |
| FX | 中心固定、正投影 | 中央80%以内。各フレームで同じ倍率、床や身体なし |
| 床・壁 | 真上から、影の方向が偏らない均一な光 | 四辺まで埋め、同一セルを上下左右に継ぎ目なく反復 |

通常の透過素材はalphaのある画素を最終セルの境界から8px以上離す。人物の足元を揃え、セルごとの自動拡大で同じ人物の体格が変わらないようにする。消えかけたFXの小ささは動きの一部なので、各フレームを別々に最大化しない。

### 主人公と装備

今回は新職業の静止8方向だけ。上段は **S / SW / W / NW**、下段は **N / NE / E / SE**。画面左・右と解剖学的な右手・左手を区別してください。左右画像の単純反転で装備の持ち手を変えないでください。背面に正面の顔を残さないでください。

人物に持たせる小物は台帳の固定外見です。ゲーム内の初期装備や装備変更を確定する指示ではありません。武器・防具アイコンは装備欄と床上表示用です。全装備を身体へ着せ替えるレイヤーや組み合わせ別人物画像は今回不要です。

### 地形とFX

各テーマで「床1・壁1」の不透明2列1行シートと、「遮蔽2・部屋小物2」の透過2列2行シートを作る。床は壁より明るく低コントラスト。中央だけの模様、セルを囲む縁、斜めの3Dブロック、四辺が暗くなる陰影は避ける。

未探索の黒はrendererが作るため、黒い未探索タイルを制作しない。探索済み記憶の減光もrenderer側で行う。床/壁の種類や発光小物だけで視界状態を代替しない。

FXは一効果ずつ2×2の4フレーム、左上→右上→左下→右下。プレビューは80ms/フレームを目安とするが、ゲームでの速度は未決定。`action: loop` は最終から先頭へ自然につながるようにし、それ以外のimpactは発生→最大→減衰→消失とする。魔弾は球の中心を固定した脈動ループで、進む距離はrendererが扱う。身体、武器を振る人物、巨大な画面エフェクトと混ぜない。

## 制作順と全ファイル

最初の `existing-weapons` を作って参照画像・縮小表示と照らし合わせ、作風を決めてください。その後P0を完成し、P1の敵→人物→地形→装備→FXへ進めます。人物・地形・FXはそれぞれ最初の1シートを検品してから同分類を展開します。この確認は制作担当自身で進め、全29枚を一括生成してから不整合に気づく進め方を避けてください。

下表のファイル名はすべて `public/assets/sprites/expansion-v1/` 内。詳細なセル順と内容は台帳を使います。

| 段階 | ファイル名 | 列×行 | 最終寸法 |
| --- | --- | --- | --- |
| P0 | `bc-existing-weapons-v1.png` | 3×2 | 384×256 |
| P0 | `bc-existing-armor-v1.png` | 3×2 | 384×256 |
| P0 | `bc-existing-vials-v1.png` | 2×2 | 256×256 |
| P0 | `bc-existing-supplies-v1.png` | 4×2 | 512×256 |
| P0 | `bc-existing-relics-v1.png` | 2×2 | 256×256 |
| P0 | `bc-existing-traps-v1.png` | 2×2 | 256×256 |
| P0 | `bc-existing-events-a-v1.png` | 2×2 | 256×256 |
| P0 | `bc-existing-events-b-v1.png` | 2×2 | 256×256 |
| P1 | `bc-monsters-blackstone-v1.png` | 2×2 | 256×256 |
| P1 | `bc-monsters-crypt-v1.png` | 2×2 | 256×256 |
| P1 | `bc-monsters-furnace-v1.png` | 2×2 | 256×256 |
| P1 | `bc-new-weapons-tools-v1.png` | 3×2 | 384×256 |
| P1 | `bc-new-armor-utility-v1.png` | 3×2 | 384×256 |
| P1 | `bc-hero-relic-surveyor-v1.png` | 4×2 | 512×256 |
| P1 | `bc-hero-ash-apothecary-v1.png` | 4×2 | 512×256 |
| P1 | `bc-hero-iron-oath-vanguard-v1.png` | 4×2 | 512×256 |
| P1 | `bc-hero-keyshadow-rogue-v1.png` | 4×2 | 512×256 |
| P1 | `bc-terrain-ore-mine-v1.png` | 2×1 | 256×128 |
| P1 | `bc-props-ore-mine-v1.png` | 2×2 | 256×256 |
| P1 | `bc-terrain-sunken-archive-v1.png` | 2×1 | 256×128 |
| P1 | `bc-props-sunken-archive-v1.png` | 2×2 | 256×256 |
| P1 | `bc-terrain-thorn-chapel-v1.png` | 2×1 | 256×128 |
| P1 | `bc-props-thorn-chapel-v1.png` | 2×2 | 256×256 |
| P1 | `bc-fx-ember-bolt-v1.png` | 2×2 | 256×256 |
| P1 | `bc-fx-mending-light-v1.png` | 2×2 | 256×256 |
| P1 | `bc-fx-repulsion-gust-v1.png` | 2×2 | 256×256 |
| P1 | `bc-fx-ward-aura-v1.png` | 2×2 | 256×256 |
| P1 | `bc-fx-venom-impact-v1.png` | 2×2 | 256×256 |
| P1 | `bc-fx-frost-bind-v1.png` | 2×2 | 256×256 |

137の有効セルに加え、`existing-supplies` のindex 7は完全透過の空セルで、総容量は138セル。セル数を増減させたり、未使用セルにボーナス素材を描いたりしないでください。

## プロンプトの共通条件と具体例

英語の例は画像生成へ渡すためのものです。説明・制作記録は日本語で構いません。台帳の `briefJa` を各セルへ具体的に反映し、名前だけの注文にしないでください。下の例を他シートに使う時も、題材・セル順・寸法を台帳に合わせて書き直します。

共通の作風指定:

```text
Production game assets for Black Candle, an original dark medieval fantasy
roguelike. Match the attached existing sprite references: detailed painted
pixel-art, crisp clustered edges, restrained material highlights, readable
silhouettes at small size. Worn iron, bone, leather, ash and candlelight.
Slightly elevated orthographic RPG camera, consistent across the sheet.
No text, numbers, labels, watermark, UI frames, modern objects, scenery,
floor slabs, cast-shadow ovals or cell borders. Do not copy a reference
character as a new creature. Draw only the explicitly listed subjects.
```

透過素材の生成背景は、標準では単色マゼンタを指定して後処理します。ネイティブ透過が利用できて正しく出せる環境では背景条件を「true transparent background」に変更してよいですが、最終alphaの検品を省略しないでください。地形にはこの背景条件を付けません。

### items: 既存武器6種の例

```text
Create one coherent weapon icon pack, exactly 3 columns by 2 rows of equal
square cells, target 1536x1024, no gutters. One weapon in each cell.
Top row left to right: a short rusty dagger with leather grip; a slender
oath knife with a red cord and diamond pommel; a long wooden hunting spear
with a leaf-shaped steel point and blue-grey tie.
Bottom row: a broad single-bladed iron axe with a short sturdy haft; a
silver faceted mace with no blade; a straight long sword with a golden
sun-shaped crossguard and a faint amber blade marking.
Match the attached existing item sprite style. Distinguish all six by shape
and material, not only color. Each entire weapon is centered inside the
central 80% of its own cell, equal visual weight, no clipping or overlap.
Solid flat #FF00FF background for alpha extraction. No hands, characters,
floor, UI card frame, text or grid lines. Output only the asset sheet.
```

防具は無人の胴鎧・外套・盾として描く。瓶は容器の形と液の色を両方変える。巻物、地図、札、投げ針、護符も輪郭で分ける。アイコン用の点・文字・UI枠は画像へ足さない。

### monsters: 黒石の敵4種の例

```text
Create a 2-column by 2-row creature pack, target 1024x1024, equal square cells.
Top-left: a small ash-grey fox-like beast with upright triangular ears,
slender body and copper-red claws; not a rat.
Top-right: a short rust-armored footman with an iron helmet, a short spear,
a small round shield and ochre cloth.
Bottom-left: a blackstone hexer with a short stone mask, grey-blue robes
and a mineral staff; no antler crown or orange flame robes.
Bottom-right: a low, broad digging beast with strong front claws and a
rough mineral back, grey-brown and stone-like, not a humanoid miner.
Match the attached existing monster sprites. Slightly elevated orthographic
RPG view, front or front three-quarter views. Full creature and equipment
contained in the central 80% of each cell, ground contact at 84% cell height.
Keep the small fox smaller than the armored footman and heavy digging beast.
No attacks, detached magic, floor, environment or cast-shadow ovals.
Solid flat #FF00FF background, no labels or borders. Output only the sheet.
```

他の敵も同じルール。擬態宝箱は牙が見える開いた敵形だけ。閉じた箱の偽装フレームは今回は作らない。炎吐きの猟犬は身体だけ、ブレスは描き込まない。三首の門番は三頭が全部見える状態でセル内に収める。

### heroes: 遺物調査員の8方向の例

```text
Create the SAME new relic surveyor in eight STATIC idle directions, matching
the attached existing hero sheets in art style, body scale and camera.
Identity: muted ochre short coat, leather cap, one small magnifying eyepiece,
a map tube at the belt, a short pick in the anatomical RIGHT hand and a
small square lantern in the anatomical LEFT hand. Upright neutral stance.
Exactly 4 columns by 2 rows, target 2048x1024, eight equal square cells.
Top row: SOUTH front; SOUTHWEST front-left three-quarter; WEST strict left
profile; NORTHWEST back-left three-quarter.
Bottom row: NORTH full back; NORTHEAST back-right three-quarter; EAST strict
right profile; SOUTHEAST front-right three-quarter.
The face and nose point to the specified screen direction. No front face
in back views. Preserve anatomical hand assignment; do not mirror hands.
Same costume, proportions and scale in all cells. Body height about 68%
of each cell; feet at 84% cell height; all accessories inside central 80%.
No walking, attack poses, detached effects, floor, shadows or cell borders.
Solid flat #FF00FF background. Output only the directional sheet.
```

灰薬師・鍵影の盗賊は台帳の右手/左手を維持。重戦士は両手で一つの大斧を持つ。各職の色と輪郭は現行3職とも区別する。単列の8コマや、複数アクションを混ぜた人物シートにしない。

### terrain: 黒石鉱脈の床・壁の例

```text
Create a seamless repeating terrain texture pair for a dark fantasy mine,
exactly 2 columns by 1 row, target 1024x512, square cells, opaque edge to edge.
Left cell: walkable grey-brown small stone floor with very sparse subdued
copper mineral flecks; smooth low-contrast walking surface.
Right cell: dense darker blue-black rock wall-top texture with faint pyrite
grains, visibly solid and darker than the floor.
Straight overhead orthographic textures. EACH cell independently tiles
seamlessly left-right and top-bottom, uniform diffuse lighting. Match the
attached existing dungeon material language. No center emblems, bright gems,
individual framed blocks, bevels, black gutters, vignette, perspective,
cast shadows, stairs, objects, creatures, text or labels.
No transparent or magenta background. Output only the texture sheet.
```

生成結果は必ず同じセルを4×4に反復して検品する。端の連続性が崩れていれば、再生成か画像の後処理で直す。浸水書庫は薄い湿り石床であり、深い水に見える床を作らない。

### props / traps: 床への重ね合わせの例

```text
Create a 2x2 pack of compact dungeon props for the ore mine, target 1024x1024.
Top-left: a low broken black rock mining pillar.
Top-right: a compact empty ore cart with iron frame and small wheels, no rails.
Bottom-left: a small copper ore cluster with restrained metallic edges.
Bottom-right: a squat stone coffer bound in thick iron bands with a dark lock.
Match the attached existing cover overlay sprites and camera. One entire
compact prop per cell, centered in central 80%. Object and immediate base
only; no ground, paving, surrounding rocks, environment, cast shadows,
text, labels or UI frames. Solid flat #FF00FF background. Output only sheet.
```

罠も局所的な機構・霧・亀裂だけを描く。落とし穴の内部の暗い画素は残し、周囲の床を透過にする。長い壁、橋、門などを無理にこの小物シートへ追加しない。

### effects: 退き風の衝撃の例

```text
Create one 4-frame repulsion gust IMPACT effect, 2 columns by 2 rows,
target 1024x1024. Frame order: top-left onset, top-right strongest expansion,
bottom-left fading expansion, bottom-right almost vanished residual arc.
Blue-white short curved wind arcs radiate from a fixed central origin.
Same camera, center and pixel scale throughout. Full effect inside central
80% of every cell, small restrained glow, no huge screen-wide wave.
No character, body, weapon, ground, shadow, text, borders or other effects.
Match the attached pixel-art sprite language. Solid flat #FF00FF background
for alpha extraction. Do not individually enlarge the fading frames.
Output only the effect sheet.
```

護りの結界は弱い→強い→弱い→先頭へ戻る脈動。魔弾は右方向の短い尾を持つ一球の中心固定ループ。癒しの灯輪・毒牙の残滴・凍光の縛りは台帳の題材を用い、発生から消失までの一連の効果にする。

## 検品と納品記録

生成に成功しただけでは完成扱いにしません。次の条件をシートごとに確認し、失敗したものは修正してください。同じシートの修正再生成は原則2回までとし、なお満たせない場合は未完として理由を記録します。成功した他のシートまで巻き戻さないでください。

1. **構造**: PNG寸法、列/行、セル数、row-major順、指定ファイル名が一致。画像に文字や罫線がない。台帳外の素材がない。
2. **alpha**: 透過素材のセル周縁は透明、マゼンタや黒の背景を残していない。黒鉄・骨・瓶など被写体を誤って削っていない。FX以外の輪郭に不要な半透明の霧がない。
3. **切り出し**: 全セルを実際に切り出し、頭・武器・翼・足が切れない。隣のセルの画素が混ざらない。人物は足元と体格が安定し、持ち手と8方向が正しい。
4. **小サイズ**: 人物・敵は64pxと48px、アイテムは32pxと24pxで表示し、別品の見分けを確認する。細部が縮小で消えても輪郭と材質の差は残す。
5. **背景への合成**: 既存4領域の床へ透過素材を重ね、暗い床で埋もれないか、地面付き四角が出ないかを確認する。床・壁は各セルを4×4に反復し、継ぎ目、単調な中心模様、明度差を確認する。
6. **FX**: 4フレームを実際に再生して確認。中心が跳ねない、倍率が変わらない、セル外にはみ出さない。loopと一度きりのimpactを区別する。

以下を **制作時に** `docs/art-expansion/delivery-v1/` へ追加してください。このフォルダやPNGは現時点では未作成です。

- `README.md`: 完成/未完のシート一覧と理由、制作機能/モデル（分かる範囲）、参照画像、検品結果、修正内容。生成の成功とゲームへの組み込みは別に記載。
- `prompts.md`: シートkeyごとの実際に使ったプロンプト、参照先、修正生成の指示。秘密情報は書かない。
- `asset-manifest-delivered.json`: 元の台帳を複製し、各シートへ `deliveryStatus`（`ready` / `needs-fix` / `blocked`）、`sha256`、実測寸法、alpha方式、検品の結果を追記。`planned-not-generated` の元台帳は計画として残す。
- `contact-items.png`、`contact-monsters.png`、`contact-heroes.png`、`contact-props.png`: 切り出した各素材の縮小一覧。ラベルはこの検品画像にのみ付けてよい。
- `terrain-repeat.png`: 各床/壁セルの4×4反復プレビュー。
- `background-composites.png`: 既存床へ重ねた小サイズ確認画像。
- `fx-preview.html` と必要ならGIF: 納品PNGを使った4フレームの確認用。音なしで、ゲームコードとは分離したローカルプレビューにする。

原画像や大きな中間ファイルは `tmp/art-expansion-v1/raw/` に保存してよいが、`tmp/` はGit管理外なので最終納品に依存させない。最終PNG・台帳・プロンプト・検品画像だけで内容を確認できるようにする。元画像の保管が必要なら別アーカイブとして納品し、通常の公開素材ディレクトリへ大量に入れない。

参照PNGや画像生成機能へアクセスできない、alphaや寸法を満たせない、といった場合は、未生成/未加工/未検品を区別して報告してください。仮画像で埋めて完成と報告しないでください。素材が完成しても、ゲーム内の表示・AI・バランスの検証は後日組み込み時に行います。
