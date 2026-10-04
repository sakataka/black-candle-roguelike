# 実際の生成プロンプト

生成: dot内蔵 image_gen.imagegen。モデル識別子はツールから取得できない。計37回。
既存8枚を画像として開きalphaを確認後、分類に対応する画像を実ファイル参照として添付。最初の武器と防具の完成PNGも後続装備の作風参照に使用。

## 参照

- `public/assets/sprites/dungeon-entities-sheet.png` SHA-256 `959961bcecffd4b15b5157f77cd1e23275c922393cdd0271ff9a5996bd6a500d`
- `public/assets/sprites/dungeon-expansion-sheet.png` SHA-256 `936b2f655c6367a069e1fb65d54269619024ace8564dd6206352907d6848029b`
- `public/assets/sprites/dungeon-journey-guardians.png` SHA-256 `7c6e85ec74b42d9d395b4cb10f62a0462de6f09ceeec185b310ec1bf0ba8ebee`
- `public/assets/sprites/oathbound-directions.png` SHA-256 `c70a601bceb3d5376632ae7698d11d1033ce8fc778ca9878ebb787d19ed4813a`
- `public/assets/sprites/ash-scout-directions.png` SHA-256 `c76a7d5c7343c71dab138d45c73a7facd94c47067b946a8db46ad865a437625b`
- `public/assets/sprites/lantern-priest-directions.png` SHA-256 `c4005e4ee79817bb32ca922b58788e54e838034cfea1a12484e876282b4f9a1d`
- `public/assets/sprites/dungeon-journey-terrain.png` SHA-256 `492dabba750c35951159b32286a9344f293e6a9471ed04a3b107fcb07d1b1093`
- `public/assets/sprites/dungeon-cover-overlays.png` SHA-256 `db5407a129cdf64478abdab1c78ff1d3868be54de1c9bb2d2da5dc3d802c0290`

黒い表示背景は既存透過PNGの表示色であり、透過キーとして使用していない。新素材は初回武器のみネイティブ透過を試し、背景光が残ったため却下。以降は指定の単色マゼンタからalpha化。

## existing-weapons

- 初回実添付参照: `public/assets/sprites/dungeon-entities-sheet.png`, `public/assets/sprites/dungeon-expansion-sheet.png`
- 修正1実添付参照: `public/assets/sprites/dungeon-entities-sheet.png`

### 初回

```text
Use case: stylized-concept. Production PNG game sprite sheet for Black Candle original dark medieval fantasy roguelike. The two attached images are STYLE REFERENCES ONLY. Match their detailed painted pixel-art, crisp clustered pixels, dark outlined silhouettes, worn iron and leather, controlled material highlights. Create exactly SIX distinct weapon icons arranged in 3 columns x 2 rows of equal square cells, total target 1536x1024. Row-major order: TOP LEFT short rusty dagger with short rust-colored blade and leather grip (NOT a long sword); TOP CENTER slender steel oath knife, red cord, diamond pommel; TOP RIGHT long wooden hunting spear, leaf-shaped steel point, blue-grey tie, narrow unmistakable spear silhouette. BOTTOM LEFT broad SINGLE-edged iron battle axe with short sturdy leather-wrapped haft; BOTTOM CENTER silver faceted mace head on short handle, NO sword blade; BOTTOM RIGHT straight long sword with golden sun-shaped crossguard and faint amber blade marking. Each whole isolated object centered in its cell, long side 70–80% of cell, generous transparent clearance, similar visual weight and distinct silhouettes. Slightly elevated orthographic RPG item camera. True transparent background. No characters, hands, floor, shadows, scenery, text, labels, symbols outside objects, grid lines, cards, borders or extra objects. Only the six weapon icons, no existing reference sprites copied.
```

### 修正 1

```text
Use case: stylized-concept. Production PNG game sprite sheet for Black Candle original dark medieval fantasy roguelike. The two attached images are STYLE REFERENCES ONLY. Match their detailed painted pixel-art, crisp clustered pixels, dark outlined silhouettes, worn iron and leather, controlled material highlights. Create exactly SIX distinct weapon icons arranged in 3 columns x 2 rows of equal square cells, total target 1536x1024. Row-major order: TOP LEFT short rusty dagger with short rust-colored blade and leather grip (NOT a long sword); TOP CENTER slender steel oath knife, red cord, diamond pommel; TOP RIGHT long wooden hunting spear, leaf-shaped steel point, blue-grey tie, narrow unmistakable spear silhouette. BOTTOM LEFT asymmetric SINGLE-bladed iron axe: ONLY ONE broad cutting blade on ONE side of the head, opposite side a narrow flat hammer poll (NO second blade), short sturdy leather-wrapped haft; BOTTOM CENTER silver faceted mace head on short handle, NO sword blade; BOTTOM RIGHT straight long sword with golden sun-shaped crossguard and faint amber blade marking. Each whole isolated object centered in its cell, long side 70–80% of cell, generous transparent clearance, similar visual weight and distinct silhouettes. Slightly elevated orthographic RPG item camera. Uniform completely flat solid #FF00FF background everywhere outside objects for precise chroma-key extraction. ABSOLUTELY NO ambient glow, haze, lighting gradient or shadow around icons. No characters, hands, floor, shadows, scenery, text, labels, symbols outside objects, grid lines, cards, borders or extra objects. Only the six weapon icons, no existing reference sprites copied. Critical: each entire weapon must fit inside central 75% of its individual cell. Generate all six as small separate game icons, sharp pixel clusters instead of smooth illustration. Ignore double axes in reference.
```

後処理: 初稿の背景光と両刃斧を却下。単色背景・片刃斧として再生成。

## existing-armor

- 初回実添付参照: `public/assets/sprites/dungeon-entities-sheet.png`, `public/assets/sprites/expansion-v1/bc-existing-weapons-v1.png`

### 初回

```text
Use case: stylized-concept. Production sprite sheet for Black Candle, original dark medieval fantasy roguelike. Attached images are STYLE REFERENCES only, not objects to copy. Detailed painted pixel-art with crisp clustered edges, dark outlines, dense worn textures, restrained metal/bone/leather/stone highlights, recognizable silhouettes at 32px. Slightly elevated orthographic RPG camera. No labels, lettering, words, numbers, watermark, grids, gutters, borders, frames, extra objects, floor slabs, surrounding scenery or cast-shadow ovals. Precisely one listed design per cell, draw all of each subject wholly inside central 75% of its cell. Background must be perfectly flat uniform solid #FF00FF chroma key, NO gradients, haze or glow around items. Sheet cells square and equal. Row-major order left to right, top row then bottom row. Create exactly 3 columns and 2 rows, target 1536x1024. Cell 0: 茶の革の胴鎧、縫い目と二本の胸ベルト。人物や宝箱を描かない。
Cell 1: 鉄灰の鎖かたびら、半袖のT字形、輪の連なり。革鎧と素材を分ける。
Cell 2: 灰緑の三角外套、裾の交差縫いと留め金。人物や棚を含めない。
Cell 3: 青銀の鎖帷子、三日月の留め金、細い銀の縁。鎖かたびらとの差は材質と紋章。
Cell 4: 丸みのある小型盾、青銅の中央鋲、短い幅広の輪郭。
Cell 5: 縦長の凧形大盾、黒鉄と銀の縦筋、尖った下端。護りの盾と輪郭を分ける。 All armor and cloaks are empty unworn garments, NO bodies, mannequins, heads or limbs. Shields isolated, no holder.
```

後処理: 切り出し、共通基準の配置、縮小、alpha周縁除去。

## existing-vials

- 初回実添付参照: `public/assets/sprites/dungeon-entities-sheet.png`

### 初回

```text
Use case: stylized-concept. Production sprite sheet for Black Candle, original dark medieval fantasy roguelike. Attached images are STYLE REFERENCES only, not objects to copy. Detailed painted pixel-art with crisp clustered edges, dark outlines, dense worn textures, restrained metal/bone/leather/stone highlights, recognizable silhouettes at 32px. Slightly elevated orthographic RPG camera. No labels, lettering, words, numbers, watermark, grids, gutters, borders, frames, extra objects, floor slabs, surrounding scenery or cast-shadow ovals. Precisely one listed design per cell, draw all of each subject wholly inside central 75% of its cell. Background must be perfectly flat uniform solid #FF00FF chroma key, NO gradients, haze or glow around items. Sheet cells square and equal. Row-major order left to right, top row then bottom row. Create 2 columns x 2 rows, target 1024x1024. Cell 0: 小さな丸い瓶、琥珀の液、コルクと細い麻紐。
Cell 1: ふくらんだ大薬瓶、赤い液、金の首輪と幅広の栓。小薬瓶より容量感を出す。
Cell 2: 角張った青い瓶、盾形の金属タグ、銀栓。青であることと盾形が目印。
Cell 3: 細長い灰白の小瓶、くすんだ液、無地の蝋封。文字・紋章・派手な発光なし。
```

後処理: 切り出し、共通基準の配置、縮小、alpha周縁除去。

## existing-supplies

- 初回実添付参照: `public/assets/sprites/dungeon-entities-sheet.png`, `public/assets/sprites/dungeon-expansion-sheet.png`

### 初回

```text
Use case: stylized-concept. Production sprite sheet for Black Candle, original dark medieval fantasy roguelike. Attached images are STYLE REFERENCES only, not objects to copy. Detailed painted pixel-art with crisp clustered edges, dark outlines, dense worn textures, restrained metal/bone/leather/stone highlights, recognizable silhouettes at 32px. Slightly elevated orthographic RPG camera. No labels, lettering, words, numbers, watermark, grids, gutters, borders, frames, extra objects, floor slabs, surrounding scenery or cast-shadow ovals. Precisely one listed design per cell, draw all of each subject wholly inside central 75% of its cell. Background must be perfectly flat uniform solid #FF00FF chroma key, NO gradients, haze or glow around items. Sheet cells square and equal. Row-major order left to right, top row then bottom row. Create 4 columns x 2 rows, target 2048x1024. Cell 0: 半開きの羊皮紙巻物、分岐した地脈線。文字は使わない。
Cell 1: 巻いた羊皮紙、青い渦の印、風を表す曲線。地図線なし。
Cell 2: 折りたたんだ四角い黒紙地図、微光の点と交差線。巻物形にしない。
Cell 3: 縦長で細い祈祷札、白い蝋封、金の幾何学印。灯具や巻物にしない。
Cell 4: 三本の短い金属の投げ針、燠色の先端、斜めの束。巻物にしない。
Cell 5: 低い丸い軟膏缶、赤褐色の薬草、暗緑の葉、布蓋。
Cell 6: 茶の小さな巾着と数枚の古銭。宝箱や金貨の山にしない。
Cell 7 bottom right must be totally EMPTY solid magenta, no eighth object. Exactly seven designs only. Geometric marks are part of objects, no readable letters.
```

後処理: 切り出し、共通基準の配置、縮小、alpha周縁除去。

## existing-relics

- 初回実添付参照: `public/assets/sprites/dungeon-expansion-sheet.png`

### 初回

```text
Use case: stylized-concept. Production sprite sheet for Black Candle, original dark medieval fantasy roguelike. Attached images are STYLE REFERENCES only, not objects to copy. Detailed painted pixel-art with crisp clustered edges, dark outlines, dense worn textures, restrained metal/bone/leather/stone highlights, recognizable silhouettes at 32px. Slightly elevated orthographic RPG camera. No labels, lettering, words, numbers, watermark, grids, gutters, borders, frames, extra objects, floor slabs, surrounding scenery or cast-shadow ovals. Precisely one listed design per cell, draw all of each subject wholly inside central 75% of its cell. Background must be perfectly flat uniform solid #FF00FF chroma key, NO gradients, haze or glow around items. Sheet cells square and equal. Row-major order left to right, top row then bottom row. Create 2 columns x 2 rows, target 1024x1024. Cell 0: 紫黒の三角柱結晶、細い白紫の稜線。鍵・剣・祭壇と混同させない。
Cell 1: 骨白の太陽護符、青銅の輪、短い紐。
Cell 2: 割れた鉄球の炉心片、中央に小さな琥珀光、三本の金属爪。
Cell 3: 黒蝋の芯を囲む石の輪、白金の細い炎、下に蝋の滴。 Subjects and their immediate mechanism/base only. No surrounding floor. Keep internal black surfaces, dark interiors are part of objects. Restrained lights have crisp contained edges, no surrounding glow.
```

後処理: 切り出し、共通基準の配置、縮小、alpha周縁除去。

## existing-traps

- 初回実添付参照: `public/assets/sprites/dungeon-cover-overlays.png`, `public/assets/sprites/dungeon-expansion-sheet.png`
- 修正1実添付参照: `public/assets/sprites/dungeon-cover-overlays.png`

### 初回

```text
Use case: stylized-concept. Production sprite sheet for Black Candle, original dark medieval fantasy roguelike. Attached images are STYLE REFERENCES only, not objects to copy. Detailed painted pixel-art with crisp clustered edges, dark outlines, dense worn textures, restrained metal/bone/leather/stone highlights, recognizable silhouettes at 32px. Slightly elevated orthographic RPG camera. No labels, lettering, words, numbers, watermark, grids, gutters, borders, frames, extra objects, floor slabs, surrounding scenery or cast-shadow ovals. Precisely one listed design per cell, draw all of each subject wholly inside central 75% of its cell. Background must be perfectly flat uniform solid #FF00FF chroma key, NO gradients, haze or glow around items. Sheet cells square and equal. Row-major order left to right, top row then bottom row. Create 2 columns x 2 rows, target 1024x1024. Cell 0: 運命を示す細い青銅の円環と四方の印。通常床や全面四角パネルを含めない。
Cell 1: 小さな機構と血色の短針、三方向に尖る輪郭。床舗装なし。
Cell 2: 小さな割れた噴霧口と控えめな暗緑の霧。床を覆い隠さない。
Cell 3: 不規則な亀裂と崩れ縁、内部は局所的な暗い穴。周囲の床や四角いタイル背景なし。 Subjects and their immediate mechanism/base only. No surrounding floor. Keep internal black surfaces, dark interiors are part of objects. Restrained lights have crisp contained edges, no surrounding glow.
```

### 修正 1

```text
Use case: stylized-concept. Production sprite sheet for Black Candle, original dark medieval fantasy roguelike. Attached images are STYLE REFERENCES only, not objects to copy. Detailed painted pixel-art with crisp clustered edges, dark outlines, dense worn textures, restrained metal/bone/leather/stone highlights, recognizable silhouettes at 32px. Slightly elevated orthographic RPG camera. No labels, lettering, words, numbers, watermark, grids, gutters, borders, frames, extra objects, floor slabs, surrounding scenery or cast-shadow ovals. Precisely one listed design per cell, draw all of each subject wholly inside central 75% of its cell. Background must be perfectly flat uniform solid #FF00FF chroma key, NO gradients, haze or glow around items. Sheet cells square and equal. Row-major order left to right, top row then bottom row. Create 2 columns x 2 rows, target 1024x1024. Cell 0: 運命を示す細い青銅の円環と四方の印。通常床や全面四角パネルを含めない。
Cell 1: 小さな機構と血色の短針、三方向に尖る輪郭。床舗装なし。
Cell 2: 小さな割れた噴霧口と控えめな暗緑の霧。床を覆い隠さない。
Cell 3: 不規則な亀裂と崩れ縁、内部は局所的な暗い穴。周囲の床や四角いタイル背景なし。 Subjects and their immediate mechanism/base only. No surrounding floor. Keep internal black surfaces, dark interiors are part of objects. Restrained lights have crisp contained edges, no surrounding glow.
Critical corrections: all four are LOW flat floor-overlay traps, slightly overhead view. Cell 2 venom mist must be only a tiny broken LOW horizontal dark iron vent with a small subdued DARK GREEN puff, not a jug, kettle, vase, canister or machine. Green mist has crisp pixelated perimeter against pure magenta, no pink fog. Cell 3 crumbling floor must be a LOW flat irregular crack around a small dark hole, NOT a tall wall, pillar, well or stone enclosure. Only a thin jagged crumbled lip surrounding darkness, no piled stones or floor slab. All four same low ground-level scale.
```

後処理: 高い噴霧器と井戸状の穴を却下。低い噴霧口・薄い崩れ縁へ再生成。

## existing-events-a

- 初回実添付参照: `public/assets/sprites/dungeon-cover-overlays.png`, `public/assets/sprites/dungeon-expansion-sheet.png`

### 初回

```text
Use case: stylized-concept. Production sprite sheet for Black Candle, original dark medieval fantasy roguelike. Attached images are STYLE REFERENCES only, not objects to copy. Detailed painted pixel-art with crisp clustered edges, dark outlines, dense worn textures, restrained metal/bone/leather/stone highlights, recognizable silhouettes at 32px. Slightly elevated orthographic RPG camera. No labels, lettering, words, numbers, watermark, grids, gutters, borders, frames, extra objects, floor slabs, surrounding scenery or cast-shadow ovals. Precisely one listed design per cell, draw all of each subject wholly inside central 75% of its cell. Background must be perfectly flat uniform solid #FF00FF chroma key, NO gradients, haze or glow around items. Sheet cells square and equal. Row-major order left to right, top row then bottom row. Create 2 columns x 2 rows, target 1024x1024. Cell 0: 欠けた立石碑、赤褐色の幾何学的な線刻。読める文字なし。
Cell 1: 低い鉄の三脚火皿、小さな燠火、広がった皿。祈祷札ではない。
Cell 2: 結び紐の付いた小さな革包み、斥候の羽根印と短い矢。灯具ではない。
Cell 3: 浅い青銅の泉鉢、青白い小さな水面光、低い円形。祭壇とは別形。 Subjects and their immediate mechanism/base only. No surrounding floor. Keep internal black surfaces, dark interiors are part of objects. Restrained lights have crisp contained edges, no surrounding glow.
```

後処理: 切り出し、共通基準の配置、縮小、alpha周縁除去。

## existing-events-b

- 初回実添付参照: `public/assets/sprites/dungeon-cover-overlays.png`, `public/assets/sprites/dungeon-expansion-sheet.png`

### 初回

```text
Use case: stylized-concept. Production sprite sheet for Black Candle, original dark medieval fantasy roguelike. Attached images are STYLE REFERENCES only, not objects to copy. Detailed painted pixel-art with crisp clustered edges, dark outlines, dense worn textures, restrained metal/bone/leather/stone highlights, recognizable silhouettes at 32px. Slightly elevated orthographic RPG camera. No labels, lettering, words, numbers, watermark, grids, gutters, borders, frames, extra objects, floor slabs, surrounding scenery or cast-shadow ovals. Precisely one listed design per cell, draw all of each subject wholly inside central 75% of its cell. Background must be perfectly flat uniform solid #FF00FF chroma key, NO gradients, haze or glow around items. Sheet cells square and equal. Row-major order left to right, top row then bottom row. Create 2 columns x 2 rows, target 1024x1024. Cell 0: 黒い低祭壇、逆三角の紫石、小さな黒蝋燭。泉や修復祭壇と異なる暗い輪郭。
Cell 1: 直立する黒石碑、銅の歯車と橙の短い溝。武器ではない。
Cell 2: 独立した大型の封印鍵、骨白の環状頭、三つの黒鉄歯。碑や護符ではない。
Cell 3: 青白い折れた剣と誓紐の幽かな残響。人の顔・足場・祭壇なし。 Subjects and their immediate mechanism/base only. No surrounding floor. Keep internal black surfaces, dark interiors are part of objects. Restrained lights have crisp contained edges, no surrounding glow.
```

後処理: 切り出し、共通基準の配置、縮小、alpha周縁除去。

## monsters-blackstone

- 初回実添付参照: `public/assets/sprites/dungeon-entities-sheet.png`, `public/assets/sprites/dungeon-expansion-sheet.png`

### 初回

```text
Use case: stylized-concept. Production sprite sheet for Black Candle, original dark medieval fantasy roguelike. Attached images are STYLE REFERENCES only, not objects to copy. Detailed painted pixel-art with crisp clustered edges, dark outlines, dense worn textures, restrained metal/bone/leather/stone highlights, recognizable silhouettes at 32px. Slightly elevated orthographic RPG camera. No labels, lettering, words, numbers, watermark, grids, gutters, borders, frames, extra objects, floor slabs, surrounding scenery or cast-shadow ovals. Precisely one listed design per cell, draw all of each subject wholly inside central 75% of its cell. Background must be perfectly flat uniform solid #FF00FF chroma key, NO gradients, haze or glow around items. Sheet cells square and equal. Row-major order left to right, top row then bottom row. Create exactly 2 columns x 2 rows, target 1024x1024. Cell 0: 細身の灰色の狐に近い獣、長い耳、赤銅の爪。鼠ではなく立った三角耳が目印。
Cell 1: 小柄な鉄兜の兵、錆びた短槍、丸い小盾、黄土の布。
Cell 2: 短い石面具、灰青のローブ、鉱石の杖。灰燼の呪術師の角と橙炎を避ける。
Cell 3: 幅広の前爪、低い鉱石の背、灰褐色の穴掘り獣。 Full body idle monsters, front or front three-quarter view, slightly elevated camera. Feet or ground contact at 84% of each cell. Each creature 60–75% height, small creatures visibly smaller than guardians. NO detached magic, attack breath, floor, shadow. All limbs and equipment contained. Maintain anatomical leg and head counts.
```

後処理: 切り出し、共通基準の配置、縮小、alpha周縁除去。

## monsters-crypt

- 初回実添付参照: `public/assets/sprites/dungeon-entities-sheet.png`, `public/assets/sprites/dungeon-expansion-sheet.png`
- 修正1実添付参照: `public/assets/sprites/dungeon-expansion-sheet.png`
- 修正2実添付参照: `public/assets/sprites/dungeon-entities-sheet.png`

### 初回

```text
Use case: stylized-concept. Production sprite sheet for Black Candle, original dark medieval fantasy roguelike. Attached images are STYLE REFERENCES only, not objects to copy. Detailed painted pixel-art with crisp clustered edges, dark outlines, dense worn textures, restrained metal/bone/leather/stone highlights, recognizable silhouettes at 32px. Slightly elevated orthographic RPG camera. No labels, lettering, words, numbers, watermark, grids, gutters, borders, frames, extra objects, floor slabs, surrounding scenery or cast-shadow ovals. Precisely one listed design per cell, draw all of each subject wholly inside central 75% of its cell. Background must be perfectly flat uniform solid #FF00FF chroma key, NO gradients, haze or glow around items. Sheet cells square and equal. Row-major order left to right, top row then bottom row. Create exactly 2 columns x 2 rows, target 1024x1024. Cell 0: 一体の六脚の毒虫、翡翠の牙、細い胸。実際の群れを一セルに描かない。
Cell 1: 半透明の鈍い緑の低い塊、内側に白い小骨。地面は含めない。
Cell 2: 黒赤の八脚の墓蜘蛛、白い腹の斑と二本の牙。既存の蛭と別の蜘蛛形。
Cell 3: 開いた古木の小箱、蓋の内側だけに牙、濃い舌、短い脚。 Full body idle monsters, front or front three-quarter view, slightly elevated camera. Feet or ground contact at 84% of each cell. Each creature 60–75% height, small creatures visibly smaller than guardians. NO detached magic, attack breath, floor, shadow. All limbs and equipment contained. Maintain anatomical leg and head counts.
```

### 修正 1

```text
Use case: stylized-concept. Production sprite sheet for Black Candle, original dark medieval fantasy roguelike. Attached images are STYLE REFERENCES only, not objects to copy. Detailed painted pixel-art with crisp clustered edges, dark outlines, dense worn textures, restrained metal/bone/leather/stone highlights, recognizable silhouettes at 32px. Slightly elevated orthographic RPG camera. No labels, lettering, words, numbers, watermark, grids, gutters, borders, frames, extra objects, floor slabs, surrounding scenery or cast-shadow ovals. Precisely one listed design per cell, draw all of each subject wholly inside central 75% of its cell. Background must be perfectly flat uniform solid #FF00FF chroma key, NO gradients, haze or glow around items. Sheet cells square and equal. Row-major order left to right, top row then bottom row. Create ONE isolated opened antique wooden mimic chest monster, single square 1024x1024 image. Full body front three-quarter slightly elevated view. A wooden lid open upwards has a row of pointed teeth ONLY along the INSIDE of the UPPER LID. The lower chest rim is PLAIN WOOD WITH NO TEETH. A dark burgundy tongue drapes over that toothless plain wooden lower rim. Four short stubby claw feet, restrained iron bands. No eyes on the wood. The entire creature within middle 75%. Design must read as a small open wooden coffer. Exactly one character, no panel layout. No floor/shadow. Match reference creature style.
```

### 修正 2

```text
Use case: stylized-concept. Production sprite sheet for Black Candle, original dark medieval fantasy roguelike. Attached images are STYLE REFERENCES only, not objects to copy. Detailed painted pixel-art with crisp clustered edges, dark outlines, dense worn textures, restrained metal/bone/leather/stone highlights, recognizable silhouettes at 32px. Slightly elevated orthographic RPG camera. No labels, lettering, words, numbers, watermark, grids, gutters, borders, frames, extra objects, floor slabs, surrounding scenery or cast-shadow ovals. Precisely one listed design per cell, draw all of each subject wholly inside central 75% of its cell. Background must be perfectly flat uniform solid #FF00FF chroma key, NO gradients, haze or glow around items. Sheet cells square and equal. Row-major order left to right, top row then bottom row. Create ONE isolated acid ooze monster, single square 1024x1024 image. A very LOW broad irregular mound of smoky translucent DULL SAGE GREEN gel, desaturated muted cool green-gray, NOT yellow or gold, no neon. Three small bone-white bone fragments suspended INSIDE its translucent body, NOT a whole skeleton. Slightly elevated orthographic view. Distinct organic slime silhouette, no face. Restrained matte watery material with few subtle pale highlights, NOT metallic, shiny gold or jeweled. Entire mound fits central 70%, close to bottom but no contact shadow or ground. Background flat #FF00FF without gradients. Match detailed dark fantasy painted pixel-art reference. Only ONE low ooze.
```

後処理: 箱の牙を上蓋だけに修正生成。酸塊を鈍い緑へ修正生成し、緑のゲル部分のalphaを210にして半透過化。

## monsters-furnace

- 初回実添付参照: `public/assets/sprites/dungeon-entities-sheet.png`, `public/assets/sprites/dungeon-journey-guardians.png`

### 初回

```text
Use case: stylized-concept. Production sprite sheet for Black Candle, original dark medieval fantasy roguelike. Attached images are STYLE REFERENCES only, not objects to copy. Detailed painted pixel-art with crisp clustered edges, dark outlines, dense worn textures, restrained metal/bone/leather/stone highlights, recognizable silhouettes at 32px. Slightly elevated orthographic RPG camera. No labels, lettering, words, numbers, watermark, grids, gutters, borders, frames, extra objects, floor slabs, surrounding scenery or cast-shadow ovals. Precisely one listed design per cell, draw all of each subject wholly inside central 75% of its cell. Background must be perfectly flat uniform solid #FF00FF chroma key, NO gradients, haze or glow around items. Sheet cells square and equal. Row-major order left to right, top row then bottom row. Create exactly 2 columns x 2 rows, target 1024x1024. Cell 0: 一体の赤銅の蟻、分節した三つの胴、琥珀の腹。蛾や甲虫と別形。
Cell 1: 黒い猟犬、細い胴、燠色の喉と口、立った背毛。ブレス自体は別FX。
Cell 2: 三つの犬頭を持つ重い番犬、黒鉄の首輪、金白の眼。全頭と四肢を一セル内へ。
Cell 3: 苔緑の根に縛られた空洞の黒鉄鎧、細い燭剣、白蝋の胸印。 Full body idle monsters, front or front three-quarter view, slightly elevated camera. Feet or ground contact at 84% of each cell. Each creature 60–75% height, small creatures visibly smaller than guardians. NO detached magic, attack breath, floor, shadow. All limbs and equipment contained. Maintain anatomical leg and head counts.
```

後処理: 猟犬の足下と騎士の脇の分離した不要画素を除去し、実際の足元を再整列。

## new-weapons-tools

- 初回実添付参照: `public/assets/sprites/expansion-v1/bc-existing-weapons-v1.png`, `public/assets/sprites/dungeon-entities-sheet.png`

### 初回

```text
Use case: stylized-concept. Production sprite sheet for Black Candle, original dark medieval fantasy roguelike. Attached images are STYLE REFERENCES only, not objects to copy. Detailed painted pixel-art with crisp clustered edges, dark outlines, dense worn textures, restrained metal/bone/leather/stone highlights, recognizable silhouettes at 32px. Slightly elevated orthographic RPG camera. No labels, lettering, words, numbers, watermark, grids, gutters, borders, frames, extra objects, floor slabs, surrounding scenery or cast-shadow ovals. Precisely one listed design per cell, draw all of each subject wholly inside central 75% of its cell. Background must be perfectly flat uniform solid #FF00FF chroma key, NO gradients, haze or glow around items. Sheet cells square and equal. Row-major order left to right, top row then bottom row. Create exactly 3 columns x 2 rows, target 1536x1024. Cell 0: 二枚の小さな三角投げ刃、革輪と銀の縁。
Cell 1: 細い木の長弓、象牙の端、短い革の握り。矢束は付けない。
Cell 2: 巨大な幅広の片刃大斧、長い両手柄、白い刃欠け。
Cell 3: 銀の細い曲刀、骨白の鍔、小さな護符。戦槌とは別の曲刀形。
Cell 4: 短い儀礼つるはし、左右非対称の鉄頭、金の結び紐。
Cell 5: 青白い水晶球と小さな三脚金具、内部の微細な地図線。 One compact isolated object per cell, no character wearing/holding equipment, no object stand except specified parts, no surrounding floor.
```

後処理: 切り出し、共通基準の配置、縮小、alpha周縁除去。

## new-armor-utility

- 初回実添付参照: `public/assets/sprites/expansion-v1/bc-existing-armor-v1.png`, `public/assets/sprites/dungeon-entities-sheet.png`

### 初回

```text
Use case: stylized-concept. Production sprite sheet for Black Candle, original dark medieval fantasy roguelike. Attached images are STYLE REFERENCES only, not objects to copy. Detailed painted pixel-art with crisp clustered edges, dark outlines, dense worn textures, restrained metal/bone/leather/stone highlights, recognizable silhouettes at 32px. Slightly elevated orthographic RPG camera. No labels, lettering, words, numbers, watermark, grids, gutters, borders, frames, extra objects, floor slabs, surrounding scenery or cast-shadow ovals. Precisely one listed design per cell, draw all of each subject wholly inside central 75% of its cell. Background must be perfectly flat uniform solid #FF00FF chroma key, NO gradients, haze or glow around items. Sheet cells square and equal. Row-major order left to right, top row then bottom row. Create exactly 3 columns x 2 rows, target 1536x1024. Cell 0: 深い青の外套、銀の封印輪、二重の肩襟。
Cell 1: 白灰の薬師外套、濃緑の襟と密閉金具。
Cell 2: 磨いた銀の六角盾、青の中央石、鋭い対称の輪郭。
Cell 3: 芽を抱く細い青銅指輪、緑石と短い二葉。
Cell 4: 小さな眼形の銀指輪、琥珀の一石、二重の輪。
Cell 5: 二本の解錠具と黒鉄の鍵束、革の結び。 One compact isolated object per cell, no character wearing/holding equipment, no object stand except specified parts, no surrounding floor.
```

後処理: 切り出し、共通基準の配置、縮小、alpha周縁除去。

## hero-relic-surveyor

- 初回実添付参照: `public/assets/sprites/ash-scout-directions.png`, `public/assets/sprites/oathbound-directions.png`
- 修正1実添付参照: `GENERATED: hero-relic-surveyor initial`
- 修正2実添付参照: `GENERATED: hero-relic-surveyor revision1`

### 初回

```text
Use case: stylized-concept. Production sprite sheet for Black Candle, original dark medieval fantasy roguelike. Attached images are STYLE REFERENCES only, not objects to copy. Detailed painted pixel-art with crisp clustered edges, dark outlines, dense worn textures, restrained metal/bone/leather/stone highlights, recognizable silhouettes at 32px. Slightly elevated orthographic RPG camera. No labels, lettering, words, numbers, watermark, grids, gutters, borders, frames, extra objects, floor slabs, surrounding scenery or cast-shadow ovals. Precisely one listed design per cell, draw all of each subject wholly inside central 75% of its cell. Background must be perfectly flat uniform solid #FF00FF chroma key, NO gradients, haze or glow around items. Sheet cells square and equal. Row-major order left to right, top row then bottom row. Create the SAME character in EIGHT STATIC idle directions. Exactly 4 columns x 2 rows, target 2048x1024. Identity: くすんだ黄土の短外套、革の帽子、片眼の拡大鏡、腰に小地図筒。右手に短いつるはし、左手に小さな角形灯。姿勢はまっすぐ。. Top row LEFT TO RIGHT: SOUTH front; SOUTHWEST front-left three-quarter; WEST strict left profile; NORTHWEST back-left three-quarter. Bottom row LEFT TO RIGHT: NORTH full back; NORTHEAST back-right three-quarter; EAST strict right profile; SOUTHEAST front-right three-quarter. Face and nose point to specified SCREEN direction. NO face in back views. Preserve ANATOMICAL hand assignments; never mirror to change hands. Same costume, equipment, proportions and scale in all eight cells. Body height 68% of square cell, boots at 84% cell height, accessories inside central 80%. Upright neutral stance. No walking or attacks. Attached hero reference defines rendering style and directional ordering; create the NEW outfit described, not existing hero.
```

### 修正 1

```text
Edit the attached eight-direction pixel-art relic surveyor sprite sheet. Keep the canvas, all other seven cells and their character designs unchanged. Correct ONLY bottom-right eighth cell (SOUTHEAST front-right three-quarter): character's chest and nose point diagonally toward SCREEN RIGHT and viewer, not straight ahead. The short pick MUST be held in the character's ANATOMICAL RIGHT hand, which is on the VIEWER LEFT side of his body in this front-facing three-quarter view. The square lantern MUST be in anatomical LEFT hand, on VIEWER RIGHT side of the body. Same assignment as top-left FRONT view. Exactly ONE small round magnifying eyepiece over his anatomical LEFT eye, the other eye naked, NO two-lens goggles. Preserve muted ochre coat, leather hat, map tube, proportions, scale and pixel style. Flat pure #FF00FF background, no shadows or text.
```

### 修正 2

```text
Edit this exact eight-direction sprite sheet, preserving all pose, costume, weapon and lantern hand assignments and layout. Change ONLY the character's eyepiece in BOTTOM ROW third and fourth cells (EAST and SOUTHEAST): REMOVE the large round glasses/lens covering his visible anatomical RIGHT eye. His anatomical right eye must be a small plain natural eye with NO circular rim. He wears one monocle over anatomical LEFT eye only. In EAST strict right profile the left eye is hidden, so show NO circular eyepiece at all. In SOUTHEAST front-right three-quarter show just ONE small round eyepiece on far side of his face, leave near-side eye bare. Never depict two-lens goggles. Other six cells unchanged. Pure flat magenta background and same pixel art.
```

後処理: 南東の持ち手を修正。東の近側眼鏡と南東の両眼鏡を修正し、片眼鏡を維持。

## hero-ash-apothecary

- 初回実添付参照: `public/assets/sprites/ash-scout-directions.png`, `public/assets/sprites/lantern-priest-directions.png`

### 初回

```text
Use case: stylized-concept. Production sprite sheet for Black Candle, original dark medieval fantasy roguelike. Attached images are STYLE REFERENCES only, not objects to copy. Detailed painted pixel-art with crisp clustered edges, dark outlines, dense worn textures, restrained metal/bone/leather/stone highlights, recognizable silhouettes at 32px. Slightly elevated orthographic RPG camera. No labels, lettering, words, numbers, watermark, grids, gutters, borders, frames, extra objects, floor slabs, surrounding scenery or cast-shadow ovals. Precisely one listed design per cell, draw all of each subject wholly inside central 75% of its cell. Background must be perfectly flat uniform solid #FF00FF chroma key, NO gradients, haze or glow around items. Sheet cells square and equal. Row-major order left to right, top row then bottom row. Create the SAME character in EIGHT STATIC idle directions. Exactly 4 columns x 2 rows, target 2048x1024. Identity: 灰白の短い作業衣、深緑の肩布、胸に二本の薬瓶、布マスク。右手に薬瓶、左手に短い杖。長い司祭ローブや金の太陽冠なし。. Top row LEFT TO RIGHT: SOUTH front; SOUTHWEST front-left three-quarter; WEST strict left profile; NORTHWEST back-left three-quarter. Bottom row LEFT TO RIGHT: NORTH full back; NORTHEAST back-right three-quarter; EAST strict right profile; SOUTHEAST front-right three-quarter. Face and nose point to specified SCREEN direction. NO face in back views. Preserve ANATOMICAL hand assignments; never mirror to change hands. Same costume, equipment, proportions and scale in all eight cells. Body height 68% of square cell, boots at 84% cell height, accessories inside central 80%. Upright neutral stance. No walking or attacks. Attached hero reference defines rendering style and directional ordering; create the NEW outfit described, not existing hero. Hand guidance: FRONT and SOUTHEAST, bottle is on VIEWER LEFT and staff on VIEWER RIGHT. BACK, bottle on VIEWER RIGHT and staff on VIEWER LEFT. All eight cells show the same two chest bottles.
```

後処理: 切り出し、共通基準の配置、縮小、alpha周縁除去。

## hero-iron-oath-vanguard

- 初回実添付参照: `public/assets/sprites/oathbound-directions.png`

### 初回

```text
Use case: stylized-concept. Production sprite sheet for Black Candle, original dark medieval fantasy roguelike. Attached images are STYLE REFERENCES only, not objects to copy. Detailed painted pixel-art with crisp clustered edges, dark outlines, dense worn textures, restrained metal/bone/leather/stone highlights, recognizable silhouettes at 32px. Slightly elevated orthographic RPG camera. No labels, lettering, words, numbers, watermark, grids, gutters, borders, frames, extra objects, floor slabs, surrounding scenery or cast-shadow ovals. Precisely one listed design per cell, draw all of each subject wholly inside central 75% of its cell. Background must be perfectly flat uniform solid #FF00FF chroma key, NO gradients, haze or glow around items. Sheet cells square and equal. Row-major order left to right, top row then bottom row. Create the SAME character in EIGHT STATIC idle directions. Exactly 4 columns x 2 rows, target 2048x1024. Identity: 幅広の黒鉄鎧、赤褐色の短い腰布、角のない低い兜。両手で一つの大斧を保持。盾と青の長いマントなし。. Top row LEFT TO RIGHT: SOUTH front; SOUTHWEST front-left three-quarter; WEST strict left profile; NORTHWEST back-left three-quarter. Bottom row LEFT TO RIGHT: NORTH full back; NORTHEAST back-right three-quarter; EAST strict right profile; SOUTHEAST front-right three-quarter. Face and nose point to specified SCREEN direction. NO face in back views. Preserve ANATOMICAL hand assignments; never mirror to change hands. Same costume, equipment, proportions and scale in all eight cells. Body height 68% of square cell, boots at 84% cell height, accessories inside central 80%. Upright neutral stance. No walking or attacks. Attached hero reference defines rendering style and directional ordering; create the NEW outfit described, not existing hero.
```

後処理: 切り出し、共通基準の配置、縮小、alpha周縁除去。

## hero-keyshadow-rogue

- 初回実添付参照: `public/assets/sprites/ash-scout-directions.png`

### 初回

```text
Use case: stylized-concept. Production sprite sheet for Black Candle, original dark medieval fantasy roguelike. Attached images are STYLE REFERENCES only, not objects to copy. Detailed painted pixel-art with crisp clustered edges, dark outlines, dense worn textures, restrained metal/bone/leather/stone highlights, recognizable silhouettes at 32px. Slightly elevated orthographic RPG camera. No labels, lettering, words, numbers, watermark, grids, gutters, borders, frames, extra objects, floor slabs, surrounding scenery or cast-shadow ovals. Precisely one listed design per cell, draw all of each subject wholly inside central 75% of its cell. Background must be perfectly flat uniform solid #FF00FF chroma key, NO gradients, haze or glow around items. Sheet cells square and equal. Row-major order left to right, top row then bottom row. Create the SAME character in EIGHT STATIC idle directions. Exactly 4 columns x 2 rows, target 2048x1024. Identity: 墨紫の短いフード、細い革衣、腰の鍵輪、右手に小刀、左手に短い解錠具。弓・槍・長いマントなし。. Top row LEFT TO RIGHT: SOUTH front; SOUTHWEST front-left three-quarter; WEST strict left profile; NORTHWEST back-left three-quarter. Bottom row LEFT TO RIGHT: NORTH full back; NORTHEAST back-right three-quarter; EAST strict right profile; SOUTHEAST front-right three-quarter. Face and nose point to specified SCREEN direction. NO face in back views. Preserve ANATOMICAL hand assignments; never mirror to change hands. Same costume, equipment, proportions and scale in all eight cells. Body height 68% of square cell, boots at 84% cell height, accessories inside central 80%. Upright neutral stance. No walking or attacks. Attached hero reference defines rendering style and directional ordering; create the NEW outfit described, not existing hero. Hand guidance: in FRONT and SOUTHEAST, knife in anatomical RIGHT hand on VIEWER LEFT side and lockpick in anatomical LEFT hand on VIEWER RIGHT. In BACK knife is VIEWER RIGHT, lockpick VIEWER LEFT. Keep knife and short thin lockpick visibly distinct; do not exchange them.
```

後処理: 切り出し、共通基準の配置、縮小、alpha周縁除去。

## terrain-ore-mine

- 初回実添付参照: `public/assets/sprites/dungeon-journey-terrain.png`

### 初回

```text
Use case: stylized-concept. Production seamless top-down terrain textures for Black Candle, original dark medieval fantasy roguelike. Match attached existing terrain's painted pixel-art stone/material style, but improve seamless repetition. Exactly TWO SQUARE CELLS side-by-side 2 columns by 1 row, target 1024x512. LEFT cell: 灰褐色の小さな石床、わずかな鈍い銅鉱の点。床は控えめで壁より明るい。 RIGHT cell: 黒青の密な岩肌、薄い黄鉄鉱の粒。中心に宝石や目立つ光を置かない。 Each cell independently tiles seamlessly on all four sides, uniform diffuse light. Opaque textures fill ALL pixels to edges. Floor lighter and lower contrast than wall, walkable floor versus solid dense wall-top. NO perspective or 3D blocks, framing, bevel, vignette, central emblems, bright gems, stairs, holes, characters, props, writing, text, watermarks, labels, gutters, dividing lines, borders, magenta, transparency. Wall top dense organic texture. No broad grout grid.
```

後処理: 各セルの対辺12px帯を重み付き平均で連続化。端のRGB差は上下・左右とも0。4×4反復を目視。

## props-ore-mine

- 初回実添付参照: `public/assets/sprites/dungeon-cover-overlays.png`, `public/assets/sprites/dungeon-expansion-sheet.png`

### 初回

```text
Use case: stylized-concept. Production sprite sheet for Black Candle, original dark medieval fantasy roguelike. Attached images are STYLE REFERENCES only, not objects to copy. Detailed painted pixel-art with crisp clustered edges, dark outlines, dense worn textures, restrained metal/bone/leather/stone highlights, recognizable silhouettes at 32px. Slightly elevated orthographic RPG camera. No labels, lettering, words, numbers, watermark, grids, gutters, borders, frames, extra objects, floor slabs, surrounding scenery or cast-shadow ovals. Precisely one listed design per cell, draw all of each subject wholly inside central 75% of its cell. Background must be perfectly flat uniform solid #FF00FF chroma key, NO gradients, haze or glow around items. Sheet cells square and equal. Row-major order left to right, top row then bottom row. Create exactly 2 columns x 2 rows, target 1024x1024. Cell 0: 遮蔽用の折れた鉱山石柱、太く短い黒岩。
Cell 1: 遮蔽用の低い空の鉱石車、鉄枠と車輪。線路・床なし。
Cell 2: 小さな銅鉱の塊、控えめな金属の稜線。床なし。
Cell 3: 厚い鉄帯を巻いた石の小箱、暗い錠。床なし。 One compact isolated object per cell, no character wearing/holding equipment, no object stand except specified parts, no surrounding floor.
```

後処理: 切り出し、共通基準の配置、縮小、alpha周縁除去。

## terrain-sunken-archive

- 初回実添付参照: `public/assets/sprites/dungeon-journey-terrain.png`

### 初回

```text
Use case: stylized-concept. Production seamless top-down terrain textures for Black Candle, original dark medieval fantasy roguelike. Match attached existing terrain's painted pixel-art stone/material style, but improve seamless repetition. Exactly TWO SQUARE CELLS side-by-side 2 columns by 1 row, target 1024x512. LEFT cell: 青灰の湿った石床、控えめな水染み。深い水・大きな波・穴を描かない。 RIGHT cell: 暗青灰の密な石積み、薄い塩の線、床より暗い。 Each cell independently tiles seamlessly on all four sides, uniform diffuse light. Opaque textures fill ALL pixels to edges. Floor lighter and lower contrast than wall, walkable floor versus solid dense wall-top. NO perspective or 3D blocks, framing, bevel, vignette, central emblems, bright gems, stairs, holes, characters, props, writing, text, watermarks, labels, gutters, dividing lines, borders, magenta, transparency. Wall top dense organic texture. No broad grout grid.
```

後処理: 各セルの対辺12px帯を重み付き平均で連続化。端のRGB差は上下・左右とも0。4×4反復を目視。

## props-sunken-archive

- 初回実添付参照: `public/assets/sprites/dungeon-cover-overlays.png`, `public/assets/sprites/dungeon-expansion-sheet.png`

### 初回

```text
Use case: stylized-concept. Production sprite sheet for Black Candle, original dark medieval fantasy roguelike. Attached images are STYLE REFERENCES only, not objects to copy. Detailed painted pixel-art with crisp clustered edges, dark outlines, dense worn textures, restrained metal/bone/leather/stone highlights, recognizable silhouettes at 32px. Slightly elevated orthographic RPG camera. No labels, lettering, words, numbers, watermark, grids, gutters, borders, frames, extra objects, floor slabs, surrounding scenery or cast-shadow ovals. Precisely one listed design per cell, draw all of each subject wholly inside central 75% of its cell. Background must be perfectly flat uniform solid #FF00FF chroma key, NO gradients, haze or glow around items. Sheet cells square and equal. Row-major order left to right, top row then bottom row. Create exactly 2 columns x 2 rows, target 1024x1024. Cell 0: 遮蔽用の低い崩れた本棚、濡れた背表紙と短い木枠。床なし。
Cell 1: 遮蔽用の頭の欠けた石の記録官像、短い台座。床なし。
Cell 2: 青銅留めの一冊の閉じた古書、白い蝋封。床なし。
Cell 3: 小さな青白の記憶壺、灰銀の蓋、細い灯。床なし。 One compact isolated object per cell, no character wearing/holding equipment, no object stand except specified parts, no surrounding floor.
```

後処理: 切り出し、共通基準の配置、縮小、alpha周縁除去。

## terrain-thorn-chapel

- 初回実添付参照: `public/assets/sprites/dungeon-journey-terrain.png`

### 初回

```text
Use case: stylized-concept. Production seamless top-down terrain textures for Black Candle, original dark medieval fantasy roguelike. Match attached existing terrain's painted pixel-art stone/material style, but improve seamless repetition. Exactly TWO SQUARE CELLS side-by-side 2 columns by 1 row, target 1024x512. LEFT cell: 苔緑の灰石床、少量の細い根が目地に沿う。密な茨で歩行面を埋めない。 RIGHT cell: 黒緑の石壁、密な細根と朽ちた蔓。床より暗く厚い。 Each cell independently tiles seamlessly on all four sides, uniform diffuse light. Opaque textures fill ALL pixels to edges. Floor lighter and lower contrast than wall, walkable floor versus solid dense wall-top. NO perspective or 3D blocks, framing, bevel, vignette, central emblems, bright gems, stairs, holes, characters, props, writing, text, watermarks, labels, gutters, dividing lines, borders, magenta, transparency. Wall top dense organic texture. No broad grout grid.
```

後処理: 各セルの対辺12px帯を重み付き平均で連続化。端のRGB差は上下・左右とも0。4×4反復を目視。

## props-thorn-chapel

- 初回実添付参照: `public/assets/sprites/dungeon-cover-overlays.png`, `public/assets/sprites/dungeon-expansion-sheet.png`

### 初回

```text
Use case: stylized-concept. Production sprite sheet for Black Candle, original dark medieval fantasy roguelike. Attached images are STYLE REFERENCES only, not objects to copy. Detailed painted pixel-art with crisp clustered edges, dark outlines, dense worn textures, restrained metal/bone/leather/stone highlights, recognizable silhouettes at 32px. Slightly elevated orthographic RPG camera. No labels, lettering, words, numbers, watermark, grids, gutters, borders, frames, extra objects, floor slabs, surrounding scenery or cast-shadow ovals. Precisely one listed design per cell, draw all of each subject wholly inside central 75% of its cell. Background must be perfectly flat uniform solid #FF00FF chroma key, NO gradients, haze or glow around items. Sheet cells square and equal. Row-major order left to right, top row then bottom row. Create exactly 2 columns x 2 rows, target 1024x1024. Cell 0: 遮蔽用の短く太い根の束、黒緑、くすんだ白い樹皮。床なし。
Cell 1: 遮蔽用の低い割れた礼拝柱、蔓を巻いた石。床なし。
Cell 2: 小さな骨白の供物皿、二本の黒い茨、琥珀の蝋。床なし。
Cell 3: 青銅の小さな種子聖櫃、丸い穴と暗緑の種。床なし。 One compact isolated object per cell, no character wearing/holding equipment, no object stand except specified parts, no surrounding floor.
```

後処理: 切り出し、共通基準の配置、縮小、alpha周縁除去。

## fx-ember-bolt

- 初回実添付参照: `public/assets/sprites/dungeon-expansion-sheet.png`

### 初回

```text
Use case: stylized-concept. Production sprite sheet for Black Candle, original dark medieval fantasy roguelike. Attached images are STYLE REFERENCES only, not objects to copy. Detailed painted pixel-art with crisp clustered edges, dark outlines, dense worn textures, restrained metal/bone/leather/stone highlights, controlled fantasy magical effects, recognizable at 48px. Slightly elevated orthographic RPG camera. No labels, lettering, words, numbers, watermark, grids, gutters, borders, frames, extra objects, floor slabs, surrounding scenery or cast-shadow ovals. Precisely one listed design per cell, draw all of each subject wholly inside central 75% of its cell. Background must be perfectly flat uniform solid #FF00FF chroma key, NO gradients, haze or glow around items. Sheet cells square and equal. Row-major order left to right, top row then bottom row. Create ONE FOUR-FRAME animation sprite sheet, exactly 2 columns by 2 rows, target 1024x1024. Effect: 小さな橙の火球、短い燠の尾。右方向へ進む一発、球の中心を固定。 LOOP: frame0 weak, frame1 medium-bright, frame2 strongest, frame3 medium-bright approaching frame0, maintain identical silhouette size, fixed origin at exact center of every square cell. Frame order TOP LEFT 0, TOP RIGHT 1, BOTTOM LEFT 2, BOTTOM RIGHT 3. Exact fixed origin at 50% x and 50% y of each square cell, same camera and pixel scale across all four frames. DO NOT independently enlarge faint/small frames. Entire peak effect within central 70%. No characters, weapons, bodies, text, floor, shadows or environmental scenery. Pure uniform MAGENTA background, pixel cluster edges, NO pink-purple contaminating glow. The animation must be visually sequential, not four unrelated icons. Small orange sphere whose CENTER STAYS FIXED and a SHORT LEFTWARD tail indicates RIGHTWARD travel. Pulse brightness without moving the ball or changing size.
```

後処理: 切り出し、共通基準の配置、縮小、alpha周縁除去。

## fx-mending-light

- 初回実添付参照: `public/assets/sprites/dungeon-expansion-sheet.png`

### 初回

```text
Use case: stylized-concept. Production sprite sheet for Black Candle, original dark medieval fantasy roguelike. Attached images are STYLE REFERENCES only, not objects to copy. Detailed painted pixel-art with crisp clustered edges, dark outlines, dense worn textures, restrained metal/bone/leather/stone highlights, controlled fantasy magical effects, recognizable at 48px. Slightly elevated orthographic RPG camera. No labels, lettering, words, numbers, watermark, grids, gutters, borders, frames, extra objects, floor slabs, surrounding scenery or cast-shadow ovals. Precisely one listed design per cell, draw all of each subject wholly inside central 75% of its cell. Background must be perfectly flat uniform solid #FF00FF chroma key, NO gradients, haze or glow around items. Sheet cells square and equal. Row-major order left to right, top row then bottom row. Create ONE FOUR-FRAME animation sprite sheet, exactly 2 columns by 2 rows, target 1024x1024. Effect: 細い金白の灯輪が弱く開き、明るくなり、落ち着いて消える。 One-shot IMPACT: frame0 small onset, frame1 maximum, frame2 expanding fade, frame3 nearly vanished residual. Frame order TOP LEFT 0, TOP RIGHT 1, BOTTOM LEFT 2, BOTTOM RIGHT 3. Exact fixed origin at 50% x and 50% y of each square cell, same camera and pixel scale across all four frames. DO NOT independently enlarge faint/small frames. Entire peak effect within central 70%. No characters, weapons, bodies, text, floor, shadows or environmental scenery. Pure uniform MAGENTA background, pixel cluster edges, NO pink-purple contaminating glow. The animation must be visually sequential, not four unrelated icons. 
```

後処理: 切り出し、共通基準の配置、縮小、alpha周縁除去。

## fx-repulsion-gust

- 初回実添付参照: `public/assets/sprites/dungeon-expansion-sheet.png`
- 修正1実添付参照: `public/assets/sprites/dungeon-expansion-sheet.png`

### 初回

```text
Use case: stylized-concept. Production sprite sheet for Black Candle, original dark medieval fantasy roguelike. Attached images are STYLE REFERENCES only, not objects to copy. Detailed painted pixel-art with crisp clustered edges, dark outlines, dense worn textures, restrained metal/bone/leather/stone highlights, controlled fantasy magical effects, recognizable at 48px. Slightly elevated orthographic RPG camera. No labels, lettering, words, numbers, watermark, grids, gutters, borders, frames, extra objects, floor slabs, surrounding scenery or cast-shadow ovals. Precisely one listed design per cell, draw all of each subject wholly inside central 75% of its cell. Background must be perfectly flat uniform solid #FF00FF chroma key, NO gradients, haze or glow around items. Sheet cells square and equal. Row-major order left to right, top row then bottom row. Create ONE FOUR-FRAME animation sprite sheet, exactly 2 columns by 2 rows, target 1024x1024. Effect: 青白の短い弧が中心から広がって薄く消える。大きな全画面波にしない。 One-shot IMPACT: frame0 small onset, frame1 maximum, frame2 expanding fade, frame3 nearly vanished residual. Frame order TOP LEFT 0, TOP RIGHT 1, BOTTOM LEFT 2, BOTTOM RIGHT 3. Exact fixed origin at 50% x and 50% y of each square cell, same camera and pixel scale across all four frames. DO NOT independently enlarge faint/small frames. Entire peak effect within central 70%. No characters, weapons, bodies, text, floor, shadows or environmental scenery. Pure uniform MAGENTA background, pixel cluster edges, NO pink-purple contaminating glow. The animation must be visually sequential, not four unrelated icons. 
```

### 修正 1

```text
Use case: stylized-concept. Production sprite sheet for Black Candle, original dark medieval fantasy roguelike. Attached images are STYLE REFERENCES only, not objects to copy. Detailed painted pixel-art with crisp clustered edges, dark outlines, dense worn textures, restrained metal/bone/leather/stone highlights, controlled fantasy magical effects, recognizable at 48px. Slightly elevated orthographic RPG camera. No labels, lettering, words, numbers, watermark, grids, gutters, borders, frames, extra objects, floor slabs, surrounding scenery or cast-shadow ovals. Precisely one listed design per cell, draw all of each subject wholly inside central 75% of its cell. Background must be perfectly flat uniform solid #FF00FF chroma key, NO gradients, haze or glow around items. Sheet cells square and equal. Row-major order left to right, top row then bottom row. Create ONE FOUR-FRAME animation sprite sheet, exactly 2 columns by 2 rows, target 1024x1024. Effect: 青白の短い弧が中心から広がって薄く消える。大きな全画面波にしない。 One-shot IMPACT: frame0 small onset, frame1 maximum, frame2 expanding fade, frame3 nearly vanished residual. Frame order TOP LEFT 0, TOP RIGHT 1, BOTTOM LEFT 2, BOTTOM RIGHT 3. Exact fixed origin at 50% x and 50% y of each square cell, same camera and pixel scale across all four frames. DO NOT independently enlarge faint/small frames. Entire peak effect within central 70%. No characters, weapons, bodies, text, floor, shadows or environmental scenery. Pure uniform MAGENTA background, pixel cluster edges, NO pink-purple contaminating glow. The animation must be visually sequential, not four unrelated icons.  CRITICAL: WIND, not electricity. Draw three SHORT SMOOTH CURVED CRESCENT WIND ARCS (thin blue-white brushlike pixel arcs) in a circular expanding wave, NO jagged bolts, lightning forks, central spark explosion or starburst. Empty transparent/magenta center. Top-left three small curved arcs emerging, top-right three larger smooth arcs, bottom-left three fading expanded arcs, bottom-right only one nearly vanished thin curved residual. Restrained low brightness, each full arc comfortably within central70%.
```

後処理: 雷状の初稿を却下。短い曲線の風弧へ修正生成。

## fx-ward-aura

- 初回実添付参照: `public/assets/sprites/dungeon-expansion-sheet.png`
- 修正1実添付参照: `GENERATED: fx-ward-aura initial`

### 初回

```text
Use case: stylized-concept. Production sprite sheet for Black Candle, original dark medieval fantasy roguelike. Attached images are STYLE REFERENCES only, not objects to copy. Detailed painted pixel-art with crisp clustered edges, dark outlines, dense worn textures, restrained metal/bone/leather/stone highlights, controlled fantasy magical effects, recognizable at 48px. Slightly elevated orthographic RPG camera. No labels, lettering, words, numbers, watermark, grids, gutters, borders, frames, extra objects, floor slabs, surrounding scenery or cast-shadow ovals. Precisely one listed design per cell, draw all of each subject wholly inside central 75% of its cell. Background must be perfectly flat uniform solid #FF00FF chroma key, NO gradients, haze or glow around items. Sheet cells square and equal. Row-major order left to right, top row then bottom row. Create ONE FOUR-FRAME animation sprite sheet, exactly 2 columns by 2 rows, target 1024x1024. Effect: 青銀の細い輪と四つの小さな盾の切片、同じ大きさで弱く脈動。 LOOP: frame0 weak, frame1 medium-bright, frame2 strongest, frame3 medium-bright approaching frame0, maintain identical silhouette size, fixed origin at exact center of every square cell. Frame order TOP LEFT 0, TOP RIGHT 1, BOTTOM LEFT 2, BOTTOM RIGHT 3. Exact fixed origin at 50% x and 50% y of each square cell, same camera and pixel scale across all four frames. DO NOT independently enlarge faint/small frames. Entire peak effect within central 70%. No characters, weapons, bodies, text, floor, shadows or environmental scenery. Pure uniform MAGENTA background, pixel cluster edges, NO pink-purple contaminating glow. The animation must be visually sequential, not four unrelated icons. 
```

### 修正 1

```text
Create a corrected version of this exact 2x2 four-frame blue-silver ward aura animation. All FOUR frames must have EXACTLY THE SAME circular ring diameter and the same size and location of four tiny shield fragments at north/east/south/west. This is a subtle BRIGHTNESS pulse ONLY, NOT expansion. Keep first frame's geometry for all frames. Frame0 dim; frame1 medium; frame2 brightest; frame3 medium, smoothly returning to dim. Each identical ring centered in its own square cell, target1024x1024. Thin blue silver ring, restrained tiny shield fragments, not large physical full shields. Detailed crisp dark fantasy painted pixel art. Entire effect central65%, exact flat #FF00FF background. NO lettering, frames, character, floor or shadows.
```

後処理: 再生成後も輪の大きさの差が残ったため、生成された第0フレームの形状を共通使用し、alphaだけを0.55/0.78/1/0.78倍にして脈動。プログラムで図形は描いていない。

## fx-venom-impact

- 初回実添付参照: `public/assets/sprites/dungeon-expansion-sheet.png`

### 初回

```text
Use case: stylized-concept. Production sprite sheet for Black Candle, original dark medieval fantasy roguelike. Attached images are STYLE REFERENCES only, not objects to copy. Detailed painted pixel-art with crisp clustered edges, dark outlines, dense worn textures, restrained metal/bone/leather/stone highlights, controlled fantasy magical effects, recognizable at 48px. Slightly elevated orthographic RPG camera. No labels, lettering, words, numbers, watermark, grids, gutters, borders, frames, extra objects, floor slabs, surrounding scenery or cast-shadow ovals. Precisely one listed design per cell, draw all of each subject wholly inside central 75% of its cell. Background must be perfectly flat uniform solid #FF00FF chroma key, NO gradients, haze or glow around items. Sheet cells square and equal. Row-major order left to right, top row then bottom row. Create ONE FOUR-FRAME animation sprite sheet, exactly 2 columns by 2 rows, target 1024x1024. Effect: 暗緑の小さな飛沫が集まり、割れ、薄まり、消える。文字やドクロなし。 One-shot IMPACT: frame0 small onset, frame1 maximum, frame2 expanding fade, frame3 nearly vanished residual. Frame order TOP LEFT 0, TOP RIGHT 1, BOTTOM LEFT 2, BOTTOM RIGHT 3. Exact fixed origin at 50% x and 50% y of each square cell, same camera and pixel scale across all four frames. DO NOT independently enlarge faint/small frames. Entire peak effect within central 70%. No characters, weapons, bodies, text, floor, shadows or environmental scenery. Pure uniform MAGENTA background, pixel cluster edges, NO pink-purple contaminating glow. The animation must be visually sequential, not four unrelated icons. 
```

後処理: 切り出し、共通基準の配置、縮小、alpha周縁除去。

## fx-frost-bind

- 初回実添付参照: `public/assets/sprites/dungeon-expansion-sheet.png`

### 初回

```text
Use case: stylized-concept. Production sprite sheet for Black Candle, original dark medieval fantasy roguelike. Attached images are STYLE REFERENCES only, not objects to copy. Detailed painted pixel-art with crisp clustered edges, dark outlines, dense worn textures, restrained metal/bone/leather/stone highlights, controlled fantasy magical effects, recognizable at 48px. Slightly elevated orthographic RPG camera. No labels, lettering, words, numbers, watermark, grids, gutters, borders, frames, extra objects, floor slabs, surrounding scenery or cast-shadow ovals. Precisely one listed design per cell, draw all of each subject wholly inside central 75% of its cell. Background must be perfectly flat uniform solid #FF00FF chroma key, NO gradients, haze or glow around items. Sheet cells square and equal. Row-major order left to right, top row then bottom row. Create ONE FOUR-FRAME animation sprite sheet, exactly 2 columns by 2 rows, target 1024x1024. Effect: 青白い三本の短い氷晶が足元で伸び、光り、割れ、消える。 One-shot IMPACT: frame0 small onset, frame1 maximum, frame2 expanding fade, frame3 nearly vanished residual. Frame order TOP LEFT 0, TOP RIGHT 1, BOTTOM LEFT 2, BOTTOM RIGHT 3. Exact fixed origin at 50% x and 50% y of each square cell, same camera and pixel scale across all four frames. DO NOT independently enlarge faint/small frames. Entire peak effect within central 70%. No characters, weapons, bodies, text, floor, shadows or environmental scenery. Pure uniform MAGENTA background, pixel cluster edges, NO pink-purple contaminating glow. The animation must be visually sequential, not four unrelated icons. 
```

後処理: 切り出し、共通基準の配置、縮小、alpha周縁除去。
