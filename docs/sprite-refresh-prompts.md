# 8方向スプライトと地形素材（2026-09-06）

内蔵 image_gen で既存画像を参照して制作。生成後に透過、コマの切り出し・整列、向き順の補正、地形の端の連続化を行った。キャラクターは1コマ128px、4列2行。上段は南・南西・西・北西、下段は北・北東・東・南東。歩行アニメーションは含まない。

参照素材: dungeon-roles-sheet.png、dungeon-biomes-sheet.png、dungeon-cover-sheet.png、dungeon-terrain-sheet.png。

## 納品素材と検証

- `public/assets/sprites/oathbound-directions.png`：誓約の探索者、512×256。
- `public/assets/sprites/ash-scout-directions.png`：灰弓の斥候、512×256。
- `public/assets/sprites/lantern-priest-directions.png`：灯火の祈祷者、512×256。
- `public/assets/sprites/dungeon-connected-terrain.png`：床4種・壁4種、512×256。左から黒石・納骨堂・炉底・黒燭。
- `public/assets/sprites/dungeon-cover-overlays.png`：遮蔽物4種、256×256。左上から上記の階層順。
- `public/assets/sprites/dungeon-stairs-overlay.png`：床へ重ねる階段、128×128。

キャラクターは generate2dsprite の processor でマゼンタ除去、共通倍率（fit-scale 0.9）、足元整列を行い、全コマで切れ・端接触なしを確認。騎士の東西、司祭の左右の並びを視覚確認後に補正。司祭の南東は単独の修正生成を最終コマへ合成した。背景は生成画像を128pxのセルへ縮小し、床と壁の明度を調整、端12pxの対向帯を混合して上下・左右の端のピクセルを一致させた。素材をコードで描き起こしてはいない。

実ブラウザで3職業の選択と24ターンの進行、24方向コマの切り出し・待機時保持・階層移動時リセット、4テーマの床・壁・遮蔽物・階段の合成を確認。未探索タイルの種類だけを変更しても表示画像が変わらないことも確認した。1440px幅と420×912pxで表示を確認し、後者の横はみ出しは0px。bun test（16件）とbun run buildが通過。ゲームルール・AI・バランス設定は変更していない。

## knightPrompt

Use case: identity-preserve. Create production 8-direction idle sprite sheet for the KNIGHT IN THE TOP ROW of reference only. Preserve exact character identity: fully enclosed dark steel helmet with gold vertical crest and narrow visor, heavy charcoal plate armor with gold trim, navy blue tabard and cape with gold cross emblem, straight silver sword in anatomical right hand and black gold-trimmed kite shield in anatomical left hand. Same grounded detailed pixel-art style as reference, readable at 64px. Exactly 4 columns by 2 rows, eight equal square cells, 1536x768 image. One full body character per cell. Row 1 left to right: SOUTH front facing viewer, SOUTHWEST facing lower-left 45 degrees, WEST strict left profile, NORTHWEST rear three-quarter facing upper-left. Row 2: NORTH full back no face, NORTHEAST rear three-quarter facing upper-right, EAST strict right profile, SOUTHEAST front three-quarter facing lower-right. This is rotating one identical stationary character, not walking poses. Preserve anatomical hand assignment as the body rotates, do not mirror shield and sword hands. Orthographic RPG slightly elevated camera identical across all frames. Uniform body height 68% of cell, feet on 84% cell height, centered, all weapon/cape parts within middle 80%, generous margins, no clipping, no floor, no shadow oval, no particles, no text, no borders. Completely solid flat #FF00FF magenta background for later keying. Output only the sheet.

## knightFixPrompt

Precise correction to existing 4-column 2-row knight sheet. Keep character identity, grid, pixel-art style, flat #FF00FF background, size and all eight existing facing angles. Change ONLY the BOTTOM RIGHT character: it is front-right three-quarter, but holds the weapons in wrong hands. The silver sword must be in anatomical RIGHT hand, which appears at the LEFT side of that character in this front three-quarter view. The black gold-trimmed kite shield must be on anatomical LEFT arm, which is at the RIGHT side of that character in this view. Keep its helmet/nose facing screen right, do NOT flip/mirror character. Correct sword and shield placement to consistently match top-left frontal character. Keep the other seven cells unchanged. All weapons contained within cell, no text.

## scoutPrompt

Use case: identity-preserve. Production 8-direction static idle sprite sheet of ONLY THE GREY HOODED SCOUT IN THE MIDDLE ROW of reference. Preserve same young scout, grey charcoal hood and tattered grey cloak, brown leather armor and belts, boots, small quiver and arrows, short upright spear. Detailed pixel art exactly matching reference, readable at 64px. Exactly 4 columns x 2 rows, equal square cells, eight views of ONE IDENTICAL CHARACTER, 1536x768. Row 1 from left: front (S), front three-quarter looking screen LEFT (SW), strict profile looking screen LEFT (W), rear three-quarter looking screen LEFT (NW). Row 2: full back (N), rear three-quarter looking screen RIGHT (NE), strict profile looking screen RIGHT (E), front three-quarter looking screen RIGHT (SE). Face and nose must point the specified screen direction; backs show no face. Do not accidentally reverse profiles. Same idle stance in all views, no walking. Spear stays in anatomical RIGHT hand through every rotation, quiver stays on same body side. Match body scale across frames and reference proportions. Slightly elevated orthographic RPG camera. Center each subject at cell center, body height 68% cell, feet at 84% cell height. Entire spear/hood/cape within central 80%, no overlapping cells. Flat uniform #FF00FF magenta background. No floor, shadow oval, particles, labels, text, grid lines or borders. Output only sheet.

## scoutFixPrompt

Edit this sprite sheet precisely, keeping resolution and 4-column 2-row layout unchanged. Preserve all pixel art, character identity, size, positioning and flat magenta background. Change ONLY TWO cells: TOP ROW THIRD CELL currently incorrectly looks screen-right; replace it with same scout in strict LEFT PROFILE, nose and eyes facing the left edge of the image, spear still in character's anatomical right hand. TOP ROW FOURTH CELL currently shows almost a full back; replace with distinct BACK-LEFT THREE-QUARTER pose, back of hood prominent, body and feet turned diagonally toward upper left of image, spear on far/occluded side, quiver on near side. Keep the other SIX cells completely unchanged. Eight genuinely distinct angles of same character, consistent costume/accessories, no text/borders/shadows, full containment.

## priestPrompt

Use case: identity-preserve. Generate ONLY the WHITE AND GOLD HOODED LANTERN PRIEST from bottom row of reference as exactly eight standing still directional sprites. Preserve ivory robe, ivory hood, gold embroidery, dark blue stole, young face, golden sun lantern staff held in anatomical right hand. SAME character, same costume and staff in all views. Detailed refined pixel art compatible with reference at 64px. New layout differs from reference! 4 columns by 2 rows of equal square cells. 1536x768. Upper row: FRONT; FRONT-LEFT three-quarter; LEFT PROFILE (nose points to image LEFT); BACK-LEFT three-quarter. Lower row: BACK; BACK-RIGHT three-quarter; RIGHT PROFILE (nose points to image RIGHT); FRONT-RIGHT three-quarter. LEFT PROFILE must show nose left and hood back right. BACK-LEFT must show back of hood and leftward shoulder, no full face. Every angle truly different at successive 45 degrees. Do not copy the ordering of reference sheet. Full body and staff contained in cell with central 70% safe area, same scale/height, centered body, feet anchored at 85% cell height, neutral static stance. Orthographic slightly elevated RPG viewpoint. Solid flat #FF00FF background everywhere outside character. No floor or cast shadow, no labels, grid or text. No detached sparkles.

## priestFixPrompt

Precise limited edit of this 4 columns x 2 rows priest sprite sheet. Keep layout, size, same eight angles and character art. Fix ONLY TOP LEFT FRONT FACING character and TOP ROW SECOND front-right character so golden sun lantern staff is held in character's anatomical RIGHT hand (on viewer LEFT of body in these front views), matching original hero. Move the staff and gripping hand to viewer-left side of these two front poses, leaving ivory gold robes and face and direction intact. In the other six views keep staff and pose unchanged. Keep all eight distinct angles and consistent size. Flat magenta #FF00FF background, no additions, no text.

## priestSePrompt

Create ONE sprite only, not a sheet. Same white-and-gold lantern priest as reference. Full-body stationary FRONT-RIGHT THREE-QUARTER view: she faces diagonally DOWN AND RIGHT on the game screen. Nose clearly points toward the RIGHT edge of image, BOTH EYES still visible, chest and front embroidered dark stole visible, NOT profile or back. White hood, ivory gold-trimmed robes, dark navy stole, golden sun-lantern staff gripped in her anatomical RIGHT hand. In this front-facing view staff is positioned on viewer LEFT of her body; do not rotate her face toward staff. Preserve exact face, costume, proportions and detailed pixel style from reference. Slightly elevated orthographic RPG view, centered full body 70% of square canvas, weapon fully inside, same neutral stance. Flat solid #FF00FF background, no floor shadow text borders. Output single character.

## terrainPrompt

Production terrain texture atlas for a dark fantasy top-down roguelike. Reference shows old materials and palette only. Replace tiles with more naturally CONNECTING textures. Exactly 4 columns x 2 rows, each equal square cell, edge-to-edge 1536x768 image, no padding gutters borders or labels. Top row four WALKABLE FLOOR materials: dark cool charcoal flagstone, warm grey ancient crypt flagstone, brown volcanic furnace basalt with tiny subdued copper flecks, violet charcoal black-candle stone. Bottom row matching four SOLID WALL TOP materials: dense darker rough blue-black masonry, dense dark grey crypt masonry, dense dark warm brown furnace masonry, dense dark violet-black masonry. Every cell is a seamless repeating FLAT ORTHOGRAPHIC texture viewed directly from above, not an isometric block or object. Floor average brightness approximately 30% and wall approximately 15%; floor smooth low contrast, walls thick rough dense stone. No individual tile edges, NO bevels around cells, NO raised rectangular blocks surrounded by black gutters, NO exterior drop shadows, NO perspective. Each material runs right through all four sides of its square cell so multiple copies create one continuous surface. Seamless left-right/top-bottom within EACH cell independently. Small restrained mortar lines and chipped stone details, no center motifs or diagonally cut chunks, no dramatic cracks or large contrast features. Match reference detailed pixel-art material language and game sprites. Neutral even diffuse light across full sheet, no vignette. Opaque textures fill entire canvas. No stairs, objects, plants, runes, lava streams or decorations.

## coverPrompt

Game asset edit/reference recreation: preserve these four dark-fantasy cover obstacles as individual isolated transparent-ready sprites, remove ALL floor/background stones. Reorganize into exactly 2 columns by 2 rows with equal square cells, one compact obstacle per cell: top-left broken hollow blackstone column stump; top-right grey crypt upright skull-carved sarcophagus slab; bottom-left short curved dark furnace barricade with small restrained orange glow; bottom-right compact black-candle cluster on round low base. Match detailed pixel-art style and slightly elevated top-down RPG camera of reference. Keep the recognizable designs, full silhouettes inside central 75% of each cell with generous margins. Objects only including their immediate structural base, NO surrounding ground paving or cast shadows, NO background tile or floor slab. Uniform solid flat #FF00FF background for clean alpha extraction, no labels borders text particles. 1024x1024.

## stairsPrompt

Recreate ONLY the descending stairwell from bottom-left cell of reference as a standalone dungeon map overlay. Single compact square inset stairwell, four worn grey stone steps descending into black darkness, narrow chipped stone lip around opening. Viewed directly from above with same modest depth cue as reference, clearly stairs DOWN not raised steps or upright door. Preserve detailed dark-fantasy pixel-art style. No surrounding floor paving whatsoever, no rectangular background tile: only the opening, black interior, steps and thin grey stone rim, isolated on 100% flat #FF00FF magenta background for alpha extraction. Centered with 15% padding around all sides, no shadow outside lip, no text labels borders. Grey neutral stone compatible with different floor biomes.

## リアルタイム遠征の素材（2026-10-03）

内蔵image_genで `public/assets/sprites/realtime-rites-sheet.png` を新規生成した。背景透過、1235×1274px、2列2行。左上に青銅の携行灯、右上に紫の未来火を抱く割れた砂時計、左下に青白い足跡と失われた剣の残響、右下に火が漏れる鉄の通気口。`assetCatalog` で同じシートから切り出し、ボタンと床への重ね合わせを実ブラウザで確認した。

生成指示の要点: dark medieval fantasy roguelike sprite sheet, exactly 2 columns × 2 rows, four separate centered objects, transparent background, warm bronze lantern / broken hourglass with violet borrowed flame / spectral cyan footsteps and a fallen sword / iron furnace vent with a restrained ember glow. Detailed painted pixel-art compatible with the existing sprites, legible at small size, generous spacing, no labels, borders, floor tile or background.

輪郭と色で4用途を見分ける。灯と通気口は暖色、借灯は紫、残響は青白色。新素材の詳細は [リアルタイム遠征の設計](realtime-expedition-design.md) を参照。
