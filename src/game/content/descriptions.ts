// 図鑑と所持品の説明文。数値は書かず、どういう相手・品として捉えるかを短く伝える。
// 新しい敵・品・仕掛けを足したら、ここにも説明を足す（descriptions.test.ts が欠けを検出する）。

export const contentDescriptions: Record<string, string> = {
  // 職業（詳しい遊び方は guide.ts の roleGuides）
  "role.oathbound": "剣と粘り強さで正面から戦う騎士。迷ったらまずこの職。",
  "role.ash-scout": "弓で距離を取り、地図と罠の扱いに長けた狩人。",
  "role.lantern-priest": "聖なる光で亡者を焼き、毒や出血から立て直す僧侶。",
  "role.relic-surveyor": "寄り道部屋を調べ尽くし、遺物を持ち帰る探検家。",
  "role.ash-apothecary": "薬を最大限に活かし、毒の瓶で敵をまとめて焼く薬師。",
  "role.iron-oath-vanguard": "盾を捨て、重い一撃と突進で道を切り開く戦士。",
  "role.keyshadow-rogue": "罠をかわし、鍵を開け、影から刺す身軽な盗賊。",

  // 浅い階の敵
  "monster.ash-rat": "灰にまみれた大きなネズミ。一匹なら弱いが、群れで現れて仲間がそばにいると強くなる。",
  "monster.ember-moth": "火の粉をまとう蛾。倒すと弾けて周りを焼くので、近くで倒すと巻き込まれる。",
  "monster.venom-bat": "素早く飛び回るコウモリ。一手に二度動き、噛まれると毒が回る。",
  "monster.blackshield-grub": "硬い殻を背負った虫。動きは鈍いが打たれ強く、宝物庫の番をしていることがある。",
  "monster.bone-thrall": "動く骸骨。倒しても少しすると立ち上がる。鈍器や聖なる力で砕けば戻らない。",
  "monster.hollow-archer": "弓を引く骸骨。狙いを定めてから矢を放つので、予告の線から外れるか遮蔽に隠れる。",
  "monster.cinder-cultist": "火を操る邪教の信徒。離れたところから術を撃ち、近づくと距離を取り直す。",
  "monster.ash-claw": "灰色のジャッカル。足が速く、一手に二度動いて間合いを詰めてくる。",
  "monster.rust-footman": "盾を構えた錆びた兵士。正面からの攻撃は盾に弾かれやすい。鈍器で攻めるか隙を突く。",

  // 中層の敵
  "monster.shadow-imp": "いたずら好きの小悪魔。持ち物や金貨をかすめ取って逃げる。倒せば取り返せる。",
  "monster.moss-brute": "苔むした大きなトロル。助走をつけて突進してくる。予告された直線から外れれば空振りする。",
  "monster.grave-leech": "墓所にすむ大きなヒル。噛まれると血が止まらなくなり、相手の血で自分を癒す。",
  "monster.bramble-packling": "背にトゲを生やした狼。群れで囲んでくるので、狭い通路で一匹ずつ相手にしたい。",
  "monster.ash-warlock": "灰の呪いを操る術者。呪印を予告してから放ち、灰の手下を呼び出す。早めに倒したい。",
  "monster.blackstone-hexer": "黒石の呪術師。離れた場所から仲間の傷を癒すので、先に狙わないと戦いが長引く。",
  "monster.vein-gnawer": "岩を食べる大きなワーム。噛まれると装備が錆びて弱くなる。",
  "monster.venom-swarm": "毒虫の群れ。一匹ずつは弱いが、群れでまとわりついて毒を残す。",
  "monster.acid-ooze": "酸のスライム。斬ると分裂して増え、酸で肌を焼かれると血が滲む。",
  "monster.grave-bloodling": "素早い吸血虫。一手に二度動き、血を吸って自分の傷を塞ぐ。",
  "monster.coffer-maw": "宝箱に化けたミミック。近づくまで動かず、不意に噛みついてくる。",

  // 深層の敵
  "monster.blackstone-sentinel": "黒石でできたゴーレム。分厚い体で攻撃を弾く。鈍器か、つるはしのようなゴーレムに強い武器が効く。",
  "monster.iron-reliquary-guard": "聖櫃を守る鉄のゴーレム。予告のあと一直線に突進してくる重い相手。",
  "monster.core-ant": "炉の熱を帯びた大きなアリ。群れで這い寄り、数で押してくる。",
  "monster.ember-hound": "火を吐く地獄の猟犬。群れで現れ、距離を取りながら炎を吐く。",
  "monster.threefold-gatehound": "三つ首の番犬。周りをまとめて噛み払う。深い階にしか現れない。",
  "monster.candle-root-knight": "根に覆われた騎士。周りを薙ぎ払い、時間がたつと傷が塞がる。一気に倒したい。",

  // 守り手（3・6・10階）
  "monster.crypt-priest": "3階の守り手の一体。骸骨を呼び起こし、傷つくと怒って攻撃が強くなる。",
  "monster.brood-mother": "3階の守り手の一体。殻で身を守りながら、甲殻虫を次々に産み落とす。",
  "monster.gnawer-maw": "3階の守り手の一体。装備を錆びさせる顎で噛み、弱ると怒って速く動き出す。",
  "monster.blackstone-colossus": "6階の守り手の一体。周りを薙ぎ払う巨像。予告を見たら離れ、振り終わりの隙を突く。",
  "monster.bone-paladin": "6階の守り手の一体。骸骨の騎士で、倒れても一度は立ち上がる。鈍器か聖なる力で砕く。",
  "monster.black-candle-warden": "10階の守り手の一体。黒燭を守る悪魔。呪印を放ち、インプを呼び、弱ると速くなる。",
  "monster.candle-eater": "10階の守り手の一体。灯を喰らう影の悪魔。速く動き、触れた相手の命を吸う。",
  "monster.fallen-keeper": "前の周期に黒燭へ残った探索者のなれの果て。結末で「継燭」を選ぶと10階に立ちはだかる。",

  // 武器
  "item.rusted-sword": "刃こぼれした短い剣。ないよりまし、という程度の武器。",
  "item.oath-knife": "扱いやすい短剣。身軽さを損なわず、不意打ちに向く。",
  "item.studded-club": "鋲を打ったこん棒。骸骨や盾持ちに強い鈍器の入門品。",
  "item.hatchet": "片手で振れる小さな斧。隣の敵をまとめて払える。",
  "item.ashwood-shortbow": "取り回しのよい短い弓。両手で扱うので盾とは併用できない。",
  "item.bone-javelin": "骨の穂先の短い槍。一歩離れた敵にも届く。",
  "item.hunter-spear": "長い柄の槍。間合いの外から突けて、矢も少し防げる。",
  "item.iron-axe": "重い戦斧。威力が高く、囲まれた時に頼りになる。",
  "item.silvered-mace": "銀をかぶせたメイス。亡者と悪魔によく効く。",
  "item.shadowstitch-dagger": "影のように黒い短剣。身軽さを保ち、不意打ちが深く刺さる。",
  "item.hunter-longbow": "遠くまで届く長弓。離れた敵を一方的に射られる。",
  "item.silver-banishing-saber": "魔を払う銀のサーベル。亡者と悪魔に特によく効く。",
  "item.sacred-pick": "祝福されたつるはし。石や鉄のゴーレムを砕くのが得意。",
  "item.sun-sigil-blade": "太陽の紋を刻んだ名剣。亡者・悪魔・邪教徒に強い。",
  "item.candle-glaive": "黒燭の炎を宿した長柄の刃。深い階で見つかる強力な槍。",
  "item.phosphor-greatbow": "大きな強弓。射程も威力も弓の中で最も高い。",
  "item.twinfang-daggers": "二本一組の短剣。もともと毒が塗られていて、刺した敵に毒を残す。",
  "item.ironbreaker-greataxe": "鉄をも割る両手斧。威力は随一だが、盾は持てず罠も避けにくくなる。",
  "item.blackiron-warhammer": "黒鉄の両手鎚。防御ごと打ち抜く重い一撃。",

  // 防具・盾・指輪
  "item.leather-armor": "軽い革鎧。守りは薄いが動きやすく、罠を避けやすい。",
  "item.trapweave-cloak": "罠の気配を感じ取れるマント。罠をとても避けやすくなる。",
  "item.chain-mail": "鎖を編んだ鎧。しっかり守れるが、重さで罠を避けにくくなる。",
  "item.witchward-cloak": "まじないを織り込んだマント。矢や術をそらす。",
  "item.venomguard-cloak": "毒を寄せつけないマント。毒を使う敵が多い場所で心強い。",
  "item.moonlit-mail": "月光を宿した鎧。守りが固く、着ているだけで少しずつ傷が癒える。",
  "item.ward-shield": "標準的な鉄の盾。矢を受け止めやすくなる。",
  "item.tower-kite-shield": "全身を隠せる大きな盾。矢にはとても強いが、重くて罠を避けにくい。",
  "item.reflecting-shield": "鏡のように磨いた盾。飛んできた攻撃の一部を撃ち返す。",
  "item.regrowth-ring": "命の宿る指輪。歩くうちに少しずつ傷が塞がる。",
  "item.searcher-ring": "探し物に向く指輪。周りの様子を読み取り、罠も避けやすくなる。",

  // 消耗品
  "item.ember-tonic": "基本の回復薬。少しだけHPが戻る。",
  "item.greater-tonic": "よく効く回復薬。ピンチの時に大きくHPが戻る。",
  "item.bloodmoss-salve": "傷によく効く軟膏。HPを戻し、毒と出血も治す。",
  "item.guardian-draught": "飲むとしばらく身を守る「護り」の状態になり、受ける傷が減る。",
  "item.unmarked-vial": "中身の分からない小瓶。傷が癒えたり護りを得たりすることもあれば、毒や出血の反動もある。",
  "item.sealed-prayer-strip": "封じられた祈りのお札。護り・地図・敵の押し戻しなどが起こるが、裏目に出ることもある。",
  "item.mapping-scroll": "読むとその階の地図がすべて明らかになる。",
  "item.glim-map": "周りの地形だけが描かれた小さな地図。",
  "item.scrying-crystal": "のぞき込むと、離れた場所の地形まで見通せる水晶。",
  "item.repulsion-scroll": "読むと突風が起こり、見えている敵をまとめて押し戻す。囲まれた時の切り札。",
  "item.void-prism": "虚空をのぞくプリズム。広く周りを照らし、敵を押し戻す。",
  "item.ember-dart": "投げて使う針。離れた敵に少しずつ傷を与えられる。",
  "item.light-throwing-blade": "軽い投げナイフ。投げ針より遠くまで届く。",
  "item.lockpick-bundle": "鍵付きの箱を開ける道具一式。使うとなくなる。",
  "item.coin-pouch": "金貨の入った袋。拾うと所持金になり、商人との取引に使える。",
  "item.grave-sun-charm": "清めの力が宿るお守り。HPを戻し、毒と出血を払い、しばらく護りを得る。",
  "item.colossus-heart": "巨像から取り出した核。長い間、強い護りを与える。",
  "item.black-candle-core": "黒燭の核そのもの。傷を癒し、周りを照らし、敵を押し戻す。",

  // イベント・部屋
  "event.blood-inscription": "血で記された古い碑文。読むと経験を得られる。",
  "event.mend-shrine": "小さな祭壇。祈ると傷が癒え、毒と出血も払われる。",
  "event.cursed-coffer": "呪われた宝箱。金貨が手に入るが、開けると出血する。",
  "event.warning-brazier": "見張りのかがり火。灯すと周りの地形が見える。",
  "event.dread-altar": "不吉な祭壇。血を捧げる代わりに、隠れた罠の場所を教えてくれる。",
  "event.furnace-control-stone": "炉を鎮める石。触れると深い階の敵が少し弱まる。",
  "event.seal-key": "封印を解く鍵。次に倒す守り手の報酬が増える。",
  "event.broken-armory": "崩れた武器棚。使える武具が残っていることがある。",
  "event.oath-echo": "誓いの言葉が残る場所。ナイトなら備えを受け取れる。ほかの職でも少し助けになる。",
  "event.scout-cache": "先人のレンジャーが残した印。道筋や投げ針が見つかる。レンジャーなら得るものが多い。",
  "event.lantern-font": "灯火の泉。傷を少し洗い流す。プリーストなら毒や出血も払い、護りを得る。",
  "event.wayfarer-merchant": "迷宮を旅する商人。金貨で回復・解毒・装備・地図を買える。",
  "event.sealed-room": "封印された小部屋。踏み込むと敵が現れ、倒すと報酬がある。",
  "event.dead-feast": "亡者たちの食堂。亡者が待ち構えているが、薬や金貨も転がっている。",
  "event.treasure-vault": "宝物庫。番人を倒せば良い薬や金貨が手に入る。",
  "event.candle-gallery": "燭台の並ぶ回廊。火が移ると部屋の様子が見え、待ち伏せていた敵が現れる。報酬もある。",
  "event.bone-heap": "骨が積み上がった部屋。骸骨が起き上がってくるが、骨の間に品が埋もれている。",
  "event.furnace-chamber": "炉の熱がこもる部屋。遮蔽と崩れる床の向こうに強敵と報酬が待つ。",
  "event.grave-marker": "倒れた探索者の墓標。弔うと遺品と灯火、最期の教訓を受け継げる。",

  // 寄り道部屋の仕掛け
  "prop.ore-mine.ore-cluster": "黒石鉱脈の鉱石の塊。掘ると金貨と少しの経験になる。",
  "prop.ore-mine.locked-cache": "鉄帯を巻いた鍵付きの小箱。解錠道具かシーフの腕があれば、武具や道具が出てくる。",
  "prop.sunken-archive.sealed-book": "蝋で封じられた古書。読むと経験を得て周りの地形が分かり、道具が挟まっていることもある。",
  "prop.sunken-archive.memory-vessel": "記憶を封じた壺。触れると傷が癒え、毒と出血が払われる。",
  "prop.thorn-chapel.thorn-altar": "茨を供えた皿。祈ると傷が癒え、毒と出血が払われる。",
  "prop.thorn-chapel.seed-reliquary": "種を納めた鍵付きの聖櫃。開けると珍しい装備が見つかる。",

  // 罠
  "trap.risk-panel": "踏むと何が起こるか分からない床。傷が癒えたり地図が見えたり、金貨が出たりすることもあれば、針が飛び出すこともある。",
  "trap.blood-needle": "床から針が飛び出す罠。踏むと出血する。",
  "trap.venom-mist": "毒の霧が吹き出す罠。踏むと毒が回る。",
  "trap.crumbling-floor": "足元が崩れる床。傷を負うが、崩れた穴から周りの様子が少し分かる。",
};

export function getContentDescription(contentId: string): string {
  return contentDescriptions[contentId] ?? "";
}
