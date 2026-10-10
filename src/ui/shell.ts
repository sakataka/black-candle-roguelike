/** 起動時の固定マークアップ。表示内容とDOMの並びはここで管理する。 */
export const observerShellMarkup = `
  <main class="observer-shell" tabindex="-1">
    <header class="topbar">
      <div class="topbar-brand">
        <span id="brand-mark" class="brand-mark" aria-hidden="true"></span>
        <div><h1>黒燭の迷宮</h1><p>灰灯院・遠征観測室</p></div>
      </div>
      <div class="topbar-run">
        <div class="depth-chip"><span id="biome-kicker">地下1階</span><strong id="biome-title">黒石迷宮</strong></div>
        <details class="observer-progress"><summary>遠征の進捗</summary><div class="observer-progress-body">
        <div class="route-track" id="route-track" aria-label="道のり">
          <div class="route-track-label"><span>道のり</span><strong id="route-next">-</strong></div>
          <ol id="route-nodes" class="route-nodes"></ol>
        </div>
        <div id="live-progress" class="live-progress" aria-label="今回の目標と鍛錬"></div>
        <div class="shard-forecast" id="shard-forecast" title="今帰還できた場合と、ここで倒れた場合に灰灯院へ持ち帰る灯片。">
          <span>持ち帰る灯片</span>
          <strong><b id="forecast-return">+0</b><small>帰還なら</small></strong>
          <strong class="is-loss"><b id="forecast-lost">+0</b><small>倒れれば</small></strong>
        </div>
        </div></details>
        <div class="turn-meter" id="turn-meter" title="灯芯が尽きると黒燭との接続が切れ、探索者は未帰還になる。">
          <div class="turn-meter-label"><span id="turn-meter-label">灯芯</span><strong id="run-turn">残り0手</strong></div>
          <div class="turn-meter-track"><i id="turn-meter-fill"></i></div>
        </div>
      </div>
      <div class="topbar-controls">
        <div class="speed-selector" role="group" aria-label="観測速度">
          <span class="live-indicator" title="遠征は選択中も進みます">進行中</span>
          <button type="button" data-speed="0.5" aria-pressed="false">0.5×</button>
          <button type="button" data-speed="1" class="is-active" aria-pressed="true">1×</button>
          <button type="button" data-speed="2" aria-pressed="false">2×</button>
          <button type="button" data-speed="3" aria-pressed="false">3×</button>
        </div>
        <button id="open-guide" class="secondary-button" type="button" title="遊び方と図鑑（遠征は止まりません）">遊び方</button>
        <button id="new-expedition" class="secondary-button" type="button" title="遠征を終えて灰灯院へ">灰灯院</button>
      </div>
    </header>

    <section class="stage" aria-label="黒燭越しの迷宮">
      <div class="map-vitals" aria-label="探索者の現在のHP"><strong id="map-vitals-name"></strong><span>HP <b id="map-vitals-hp"></b></span><div class="map-vitals-track" aria-hidden="true"><i id="map-vitals-fill"></i></div></div>
      <div class="map-stage" id="map-stage">
        <div id="pixi-root" class="pixi-root"></div>
        <div class="boss-health" id="boss-health" aria-label="視界内の守り手のHP" hidden></div>
        <div class="battle-forecast" id="battle-forecast" aria-label="見えている攻撃の予告"></div>
        <p class="delver-voice sr-only" id="delver-voice" aria-live="polite"></p>
        <button type="button" id="lantern-call" class="lantern-call" hidden></button>
        <p id="lantern-toast" class="lantern-toast" aria-live="polite" hidden></p>
        <div id="floor-card" class="floor-card" aria-hidden="true"><span class="floor-card-no"></span><strong class="floor-card-name"></strong><i></i></div>
      </div>
      <section class="lantern-dock" aria-label="灯守の介入">
        <div class="lantern-embers">
          <div class="lantern-embers-head"><span>灯火</span><strong id="lantern-count">0/0</strong></div>
          <div id="lantern-pips" class="lantern-pips" aria-live="polite"></div>
          <small id="lantern-hint">危機に灯を捧げると、探索者の手番を使わず介入できます。</small>
        </div>
        <div id="lantern-rites" class="lantern-rites"></div>
        <div class="extra-rites">
          <button type="button" id="place-lantern" class="secondary-button"><span class="extra-rite-icon" aria-hidden="true"></span><strong>置灯</strong><kbd>T</kbd><small>退路を照らし、敵を誘う</small></button>
          <button type="button" id="borrow-flame" class="secondary-button"><span class="extra-rite-icon" aria-hidden="true"></span><strong>借灯</strong><kbd>F</kbd><small>灯火が尽きた時、未来から借りる</small></button>
        </div>
        <p class="expedition-note" id="expedition-note"></p>
        <p class="expedition-note floor-law" id="floor-law"></p>
      </section>
    </section>

    <div class="sidebar">
      <section class="panel vitals-card" aria-label="探索者">
        <div class="vitals-heading">
          <span id="vitals-portrait" class="vitals-portrait" aria-hidden="true"></span>
          <div><strong id="vitals-name">-</strong><small id="hero-role">-</small></div>
          <em id="vitals-level">Lv1</em>
        </div>
        <div class="vitals-hp" id="vitals-hp">
          <div class="vitals-hp-label"><span>HP</span><strong id="vitals-hp-value">-</strong></div>
          <div class="vitals-hp-track"><b id="vitals-hp-trail" aria-hidden="true"></b><i id="vitals-hp-fill"></i></div>
        </div>
        <div id="hero-stats" class="stat-row"></div>
        <div class="vitals-tags"><div id="vitals-conditions" class="tag-row"></div><div id="vitals-tactics" class="tag-row"></div></div>
      </section>
      <section class="panel expedition-card" aria-label="今回の目標">
        <div class="mission-line">
          <span class="panel-label">今回の目標</span>
          <em id="run-mission-state">進行中</em>
        </div>
        <strong id="run-mission" class="mission-name">-</strong>
        <p id="run-mission-target" class="mission-target">-</p>
        <div class="mission-progress-row"><div class="mission-track"><i id="mission-fill"></i></div><em id="run-mission-progress">-</em></div>
        <p id="run-mission-reward" class="mission-reward-line">-</p>
        <div class="landmark">
          <span class="panel-label">次の節目</span>
          <strong id="landmark-title">-</strong>
          <p id="landmark-detail">-</p>
        </div>
        <div class="expedition-meta">
          <span>方針 <strong id="run-directive">-</strong></span>
          <span>啓示 <strong id="run-revelations">-</strong></span>
          <span>探索 <strong id="explored-ratio">0%</strong></span>
        </div>
        <div class="objective">
          <span class="panel-label">次の動き</span>
          <strong id="objective-title">未探索を調べる</strong>
          <p id="objective-detail">黒燭が映す道筋を追っています。</p>
        </div>
      </section>
      <section class="panel inventory-card" aria-label="装備と携行品">
        <div class="panel-heading"><h2>装備と携行品</h2><span id="inventory-count">0</span></div>
        <div id="equipment-list" class="equipment-list"></div>
        <ul id="inventory-list" class="inventory-grid"></ul>
        <p id="inventory-caption" class="inventory-caption"></p>
      </section>
      <section class="panel log-card" aria-label="道中記">
        <div class="panel-heading"><h2>道中記</h2><span>新しい順</span></div>
        <ol id="message-list" class="message-list"></ol>
      </section>
    </div>
  </main>

  <section id="candidate-dialog" class="modal-layer prepare-layer">
    <div class="prepare-screen" role="dialog" aria-modal="true" aria-labelledby="candidate-title">
      <header class="prepare-header">
        <div class="prepare-title">
          <p class="eyebrow">灰灯院 · 遠征の支度 · <span id="save-slot-name"></span></p>
          <h2 id="candidate-title">誰を黒燭の迷宮へ送るか</h2>
        </div>
        <div class="prepare-header-actions">
          <div class="shard-balance" title="遠征から持ち帰る。到達・守り手・任務・真相・生還で増え、施設の強化と療房に使う。"><i id="shard-icon" class="shard-icon" aria-hidden="true"></i><span>灯片</span><strong id="institute-shards">0</strong></div>
          <button id="resume-run" class="secondary-button" type="button" hidden>観戦に戻る <kbd>Esc</kbd></button>
          <button id="open-guide-prepare" class="secondary-button" type="button" title="遊び方と図鑑">遊び方</button>
          <button id="switch-save" class="secondary-button" type="button" title="タイトルへ戻り、別の記録を選ぶか新しい記録を始める">記録を切り替える</button>
        </div>
      </header>
      <details id="progress-drawer" class="progress-drawer">
        <summary id="progress-strip" class="progress-strip"></summary>
        <div id="next-goal" class="progress-overview"></div>
      </details>
      <div class="prepare-body">
        <nav class="prepare-nav" aria-label="遠征の支度">
          <button type="button" data-prepare-page="delver" aria-controls="prepare-delver"><small>01</small><strong>探索者</strong><span>誰を送り出すか</span></button>
          <button type="button" data-prepare-page="mission" aria-controls="prepare-mission"><small>02</small><strong>任務</strong><span>旅の目的を選ぶ</span></button>
          <button type="button" data-prepare-page="tactics" aria-controls="prepare-tactics"><small>03</small><strong>作戦</strong><span>判断の癖を決める</span></button>
          <button type="button" data-prepare-page="ability" aria-controls="prepare-ability"><small>04</small><strong>アビリティ</strong><span>心得を携える</span></button>
          <button type="button" data-prepare-page="institute" aria-controls="prepare-institute"><small>05</small><strong>灰灯院</strong><span>施設と遠征録</span></button>
        </nav>
        <div class="prepare-main">
          <section id="prepare-delver" data-prepare-section="delver" class="prepare-step prepare-step-delver" aria-labelledby="step-delver">
            <div class="step-heading"><span class="step-no" aria-hidden="true">I</span><h3 id="step-delver">探索者</h3><small>生還した古参は位階が上がって強くなる。瀕死で帰ると古傷を負い、倒れた者は戻らない。<span class="kbd-hint">番号キー 1〜4 でも選べる。</span></small></div>
            <div class="delver-layout">
              <div class="delver-roster">
                <div class="candidate-group"><strong>遠征団</strong><small id="veteran-capacity"></small></div>
                <div id="veteran-list" class="candidate-list"></div>
                <div class="candidate-group"><strong>新たな志願者</strong><small id="recruit-capacity"></small><small id="truth-legend" class="truth-legend"></small></div>
                <div id="candidate-list" class="candidate-list"></div>
              </div>
              <article id="delver-detail" class="delver-detail" aria-label="選んだ探索者"></article>
            </div>
          </section>
          <section id="prepare-mission" data-prepare-section="mission" class="prepare-step" aria-labelledby="step-mission">
            <div class="step-heading"><span class="step-no" aria-hidden="true">II</span><h3 id="step-mission">今回の目標</h3><small>探索者は任務に沿って帰還か続行かを決める。報酬は生きて帰った時に受け取る。</small></div>
            <div id="mission-list" class="mission-list"></div>
          </section>
          <section id="prepare-tactics" data-prepare-section="tactics" class="prepare-step" aria-labelledby="step-tactics">
            <div class="step-heading"><span class="step-no" aria-hidden="true">III</span><h3 id="step-tactics">作戦カード</h3><em id="tactic-count">0/2</em><small>探索者の判断の癖。3階・6階の節目でも組み替えられる。</small></div>
            <div id="tactic-list" class="tactic-list"></div>
          </section>
          <section id="prepare-ability" data-prepare-section="ability" class="prepare-step" aria-labelledby="step-ability">
            <div class="step-heading"><span class="step-no" aria-hidden="true">IV</span><h3 id="step-ability">アビリティ</h3><em id="ability-count">0/2</em><small>常に効く心得。職業の踏破や黒燭への道の節目で解放され、どの職業にも付けられる。枠は修練場で増える。</small></div>
            <div id="ability-list" class="tactic-list"></div>
            <details class="ability-locked">
              <summary>まだ解放していないアビリティ <span id="ability-unlocked"></span></summary>
              <ul id="ability-locked-list" class="ability-locked-list"></ul>
            </details>
          </section>
        </div>
        <aside class="prepare-brief" aria-label="選択中の任務">
          <p class="eyebrow">今回の任務</p>
          <h3 id="prepare-mission-name"></h3>
          <p id="prepare-mission-target"></p>
          <div class="prepare-brief-art" aria-hidden="true"></div>
          <p id="prepare-mission-reward"></p>
          <button id="prepare-edit-mission" class="secondary-button" type="button">任務を選び直す</button>
        </aside>
        <aside id="prepare-institute" data-prepare-section="institute" class="prepare-side" aria-label="灰灯院">
          <section class="side-section">
            <div class="side-heading"><h3>施設</h3><small>灯片で強化すると、以後の遠征すべてに効く。</small></div>
            <div id="institute-facilities" class="institute-facilities"></div>
            <div id="institute-infirmary" class="institute-infirmary"></div>
          </section>
          <section class="side-section">
            <div id="institute-cycle" class="institute-cycle"></div>
          </section>
          <section class="side-section">
            <div class="side-heading"><h3>遠征録</h3><span id="archive-count">0件</span></div>
            <div id="campaign-summary" class="campaign-summary"></div>
            <ol id="archive-list" class="archive-list"></ol>
          </section>
        </aside>
      </div>
      <footer class="prepare-footer">
        <div id="depart-summary" class="depart-summary"></div>
        <button id="depart-button" class="primary-button" type="button">出発する</button>
      </footer>
    </div>
  </section>

  <section id="decision-dialog" class="realtime-choice" hidden aria-live="polite">
    <div class="decision-panel" role="group" aria-labelledby="decision-title">
      <p class="eyebrow" id="decision-kicker">黒燭からの問い</p>
      <h2 id="decision-title">灯守の判断</h2>
      <p id="decision-body" class="modal-lead"></p>
      <div id="decision-stakes" class="decision-stakes" hidden></div>
      <div id="decision-options" class="decision-options"></div>
      <details class="decision-details" id="decision-details">
        <summary>作戦・装備・長期の先読み（遠征は進み続けます）</summary>
      <div id="decision-status" class="decision-status" aria-label="探索者の状態"></div>
      <section id="decision-tactics" class="decision-tactics" aria-label="作戦の組み替え" hidden>
        <div class="step-heading"><h3>作戦を組み替える</h3><em id="decision-tactic-count">0/2</em><small>組み替えると各案の先読みが更新される。</small></div>
        <div id="decision-tactic-list" class="tactic-list is-compact"></div>
      </section>
        <section id="decision-context" class="decision-context" aria-label="判断材料"></section>
      </details>
      <p id="decision-hint" class="modal-hint"></p>
    </div>
  </section>

  <section id="end-dialog" class="modal-layer" hidden>
    <div class="modal-panel result-panel" role="dialog" aria-modal="true" aria-labelledby="end-title">
      <header class="result-hero">
        <p id="end-kicker" class="eyebrow">遠征終了</p>
        <h2 id="end-title">遠征記録</h2>
        <p id="end-summary" class="modal-lead"></p>
      </header>
      <div id="end-milestone" class="end-milestone" hidden></div>
      <section class="result-section result-outcome" aria-label="今回の結果">
        <dl id="end-stats" class="ledger-cells end-stats"></dl>
        <div id="run-comparison" class="result-notes"></div>
      </section>
      <section class="result-section" aria-labelledby="shard-heading">
        <div class="result-section-heading"><h3 id="shard-heading">持ち帰った灯片</h3><small id="shard-note"></small></div>
        <dl id="shard-breakdown" class="ledger-cells score-breakdown"></dl>
      </section>
      <section id="end-roadmap" class="result-section" aria-label="黒燭への道"></section>
      <div id="run-insights" class="run-insights"></div>
      <section id="decision-history" class="result-section decision-history" aria-label="灯守の判断"></section>
      <div class="modal-footer">
        <button id="end-new-expedition" class="primary-button" type="button">灰灯院へ戻り、次の遠征の支度をする</button>
      </div>
    </div>
  </section>
`;
