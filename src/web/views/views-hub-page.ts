import { COMMON_CLIENT_JS, PWA_HEAD_TAGS, SAAS_STYLES } from './styles.js';

export function renderViewsHubHTML(): string {
  return `<!DOCTYPE html>
<html lang="so">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>CARDOSO Views Hub — 5-Second WhatsApp Status Views (.vcf)</title>
  ${PWA_HEAD_TAGS}
  <style>
    ${SAAS_STYLES}

    .quick-hero {
      max-width: 780px;
      margin: 0 auto 1.4rem;
      border-radius: 22px;
      padding: 1.55rem 1.35rem;
      background:
        radial-gradient(circle at 12% 10%, rgba(6, 182, 212, 0.24), transparent 50%),
        radial-gradient(circle at 90% 18%, rgba(16, 185, 129, 0.18), transparent 45%),
        linear-gradient(155deg, rgba(15, 23, 42, 0.96), rgba(7, 11, 20, 0.98));
      border: 1px solid rgba(56, 189, 248, 0.32);
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
    }
    .quick-hero h2 {
      font-size: clamp(1.4rem, 3.6vw, 2.05rem);
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.18;
      margin: 0.55rem 0 0.45rem;
    }
    .quick-hero h2 span {
      background: linear-gradient(90deg, #22d3ee, #34d399, #fbbf24);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .quick-sub {
      color: #cbd5e1;
      font-size: 0.9rem;
      margin-bottom: 1.05rem;
    }

    .batch-meter {
      background: rgba(8, 13, 25, 0.8);
      border: 1px solid rgba(148, 163, 184, 0.18);
      border-radius: 14px;
      padding: 0.78rem 0.95rem;
      margin-bottom: 1.05rem;
    }
    .batch-meter-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.4rem;
      margin-bottom: 0.42rem;
      font-size: 0.83rem;
      font-weight: 700;
    }
    .meter-track {
      height: 11px;
      border-radius: 999px;
      background: rgba(148, 163, 184, 0.14);
      overflow: hidden;
    }
    .meter-fill {
      height: 100%;
      width: 0%;
      border-radius: 999px;
      background: linear-gradient(90deg, #06b6d4, #10b981, #f59e0b);
      box-shadow: 0 0 16px rgba(6, 182, 212, 0.45);
      transition: width 0.5s ease;
    }

    .phone-row { display: flex; gap: 0.45rem; }
    .phone-row select { width: 132px; flex-shrink: 0; }

    .big-cta {
      width: 100%;
      padding: 1rem 1.2rem;
      font-size: 1.02rem;
      font-weight: 800;
      border-radius: 14px;
      box-shadow: 0 10px 28px rgba(6, 182, 212, 0.32);
    }

    .opt-toggle {
      background: transparent;
      border: none;
      color: #94a3b8;
      font-size: 0.79rem;
      font-weight: 600;
      cursor: pointer;
      padding: 0.25rem 0;
      margin-bottom: 0.55rem;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }
    .opt-toggle:hover { color: #e2e8f0; }

    .unlock-box {
      background: linear-gradient(160deg, rgba(16, 185, 129, 0.14), rgba(6, 182, 212, 0.12));
      border: 1px solid rgba(16, 185, 129, 0.45);
      border-radius: 16px;
      padding: 1.15rem;
    }
    .lock-notice {
      background: rgba(245, 158, 11, 0.12);
      border: 1px solid rgba(245, 158, 11, 0.45);
      border-radius: 13px;
      padding: 0.9rem 1rem;
      margin-bottom: 0.85rem;
      font-size: 0.84rem;
      line-height: 1.5;
    }
    .quick-steps-strip {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.55rem;
      margin-top: 0.9rem;
    }
    @media (max-width: 620px) { .quick-steps-strip { grid-template-columns: 1fr; } }
    .qs-box {
      background: rgba(8, 13, 25, 0.72);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 0.65rem 0.75rem;
      font-size: 0.79rem;
      color: #cbd5e1;
    }
    .qs-box strong { color: #67e8f9; display: block; margin-bottom: 0.15rem; }

    .wa-shortcut-strip {
      margin-top: 0.85rem;
      padding: 0.72rem 0.9rem;
      border-radius: 12px;
      background: rgba(16, 185, 129, 0.1);
      border: 1px dashed rgba(16, 185, 129, 0.4);
      font-size: 0.81rem;
      color: #d1fae5;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.65rem;
      flex-wrap: wrap;
    }

    .vip-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 1rem;
    }
    @media (max-width: 960px) { .vip-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 620px) { .vip-grid { grid-template-columns: 1fr; } }

    .vip-card {
      background: linear-gradient(160deg, rgba(30, 27, 18, 0.78), rgba(15, 23, 42, 0.92));
      border: 1px solid rgba(245, 158, 11, 0.42);
      border-radius: 18px;
      padding: 1.1rem;
      display: flex;
      flex-direction: column;
      gap: 0.7rem;
    }
    .vip-head { display: flex; align-items: center; gap: 0.75rem; }
    .vip-avatar {
      width: 50px; height: 50px; border-radius: 14px; flex-shrink: 0;
      object-fit: cover;
      background: linear-gradient(135deg, #f59e0b, #ea580c);
      display: flex; align-items: center; justify-content: center;
      font-size: 1.25rem; font-weight: 800; color: #fff;
      border: 2px solid rgba(251, 191, 36, 0.55);
    }
    .vip-name { font-size: 0.98rem; font-weight: 800; color: #fff; }
    .vip-meta { font-size: 0.76rem; color: #fcd34d; display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; }
    .vip-tagline { font-size: 0.82rem; color: #cbd5e1; line-height: 1.45; flex: 1; }
    .vip-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    .vip-cta-card {
      background: linear-gradient(155deg, rgba(245, 158, 11, 0.16), rgba(139, 92, 246, 0.15));
      border: 1px dashed rgba(251, 191, 36, 0.55);
      border-radius: 18px;
      padding: 1.15rem;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 0.75rem;
    }

    .city-chips { display: flex; flex-wrap: wrap; gap: 0.45rem; margin-bottom: 1rem; }
    .city-chip {
      border: 1px solid var(--card-border);
      background: rgba(15, 23, 42, 0.82);
      color: #cbd5e1;
      border-radius: 999px;
      padding: 0.35rem 0.78rem;
      font-size: 0.77rem;
      font-weight: 700;
      cursor: pointer;
    }
    .city-chip.active, .city-chip:hover {
      background: rgba(6, 182, 212, 0.2);
      border-color: var(--primary);
      color: #fff;
    }

    .members-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.65rem;
    }
    @media (max-width: 900px) { .members-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 560px) { .members-grid { grid-template-columns: 1fr; } }

    .member-tile {
      background: rgba(10, 16, 30, 0.85);
      border: 1px solid var(--card-border);
      border-radius: 13px;
      padding: 0.75rem 0.85rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.6rem;
    }
    .member-tile.is-vip {
      border-color: rgba(245, 158, 11, 0.42);
      background: rgba(30, 27, 18, 0.55);
    }

    .announce-strip {
      display: none;
      max-width: 780px;
      margin: 0 auto 1rem;
      padding: 0.78rem 1rem;
      border-radius: 14px;
      background: linear-gradient(90deg, rgba(139, 92, 246, 0.18), rgba(6, 182, 212, 0.18));
      border: 1px solid rgba(139, 92, 246, 0.38);
      font-size: 0.85rem;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand">
      <div class="brand-mark" style="background:linear-gradient(135deg,#06b6d4,#10b981);">📈</div>
      <div>
        <h1 id="hubHeaderTitle">CARDOSO <span>Views Hub</span></h1>
        <p>5 Ilbiriqsi · 0% Ban · .vcf Status Views</p>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:0.55rem;flex-wrap:wrap;">
      <a href="/app" class="btn btn-primary btn-sm">🤖 AI App</a>
      <button type="button" class="btn btn-ghost btn-sm" data-pwa-install-btn onclick="triggerCardosoInstall()">📲 Install</button>
      <a href="#vipSection" class="btn btn-sm" style="background:linear-gradient(135deg,#f59e0b,#ea580c);color:#fff;">👑 VIP</a>
    </div>
  </header>

  <main class="container">
    <div id="announceStrip" class="announce-strip"></div>

    <!-- ULTRA-SIMPLE 2-BOX + 1-BUTTON HERO CARD (ABOVE THE FOLD!) -->
    <section class="quick-hero">
      <div style="display:flex;flex-wrap:wrap;gap:0.45rem;align-items:center;">
        <span class="pill pill-green">🛡️ 0% Ban</span>
        <span class="pill pill-cyan" id="heroBatchBadge">📦 Batch #1</span>
        <span class="pill pill-violet" id="heroLockBadge">🔓 Instant .vcf</span>
        <span class="pill pill-amber" id="heroStatsMini">👥 0 Qof · 📥 0 DL</span>
      </div>

      <h2>Hel <span>200+ Status Views</span> — 5 Ilbiriqsi Kaliya!</h2>
      <p class="quick-sub">
        Geli <strong>Magacaaga</strong> iyo <strong>Lambarkaaga</strong> (🇸🇴 +252 / 🇪🇹 +251 / 🇰🇪 +254) ➔ faylka <strong>.vcf</strong> isla markiiba wuu kuu soo degayaa!
      </p>

      <div class="batch-meter">
        <div class="batch-meter-top">
          <span id="batchMeterLabel">🔥 Batch #1: 0 / 100 Qof</span>
          <span style="color:#22d3ee;" id="batchMeterPct">0%</span>
        </div>
        <div class="meter-track">
          <div class="meter-fill" id="batchMeterFill"></div>
        </div>
      </div>

      <!-- STEP 1: SUPER SIMPLE 2-BOX FORM -->
      <div id="joinFormWrap">
        <form onsubmit="submitQuickJoinAndDownload(event)">
          <div class="form-group" style="margin-bottom:0.7rem;">
            <label class="field-label">1️⃣ Magacaaga</label>
            <input class="field" id="joinName" required placeholder="Tusaale: Axmed / Hodan" maxlength="60" />
          </div>

          <div class="form-group" style="margin-bottom:0.65rem;">
            <label class="field-label">2️⃣ Lambarkaaga WhatsApp</label>
            <div class="phone-row">
              <select class="field" id="joinCountryCode" onchange="onCountryCodeChanged()">
                <option value="252">🇸🇴 +252</option>
                <option value="251">🇪🇹 +251</option>
                <option value="254">🇰🇪 +254</option>
                <option value="253">🇩🇯 +253</option>
                <option value="">🌍 Kale</option>
              </select>
              <input class="field" id="joinPhone" required inputmode="tel" placeholder="634xxxxxx ama 915xxxxxx" maxlength="20" />
            </div>
          </div>

          <button type="button" class="opt-toggle" onclick="toggleOptionalFields()">
            <span id="optToggleArrow">▸</span> Ikhtiyaari: Dooro Magaalo ama Xayeysiis Kooban
          </button>

          <div id="optionalFieldsBox" style="display:none;margin-bottom:0.75rem;">
            <div class="grid-2">
              <div class="form-group" style="margin-bottom:0.55rem;">
                <label class="field-label">Magaalada</label>
                <select class="field" id="joinCity">
                  <option value="Hargeysa">Hargeysa</option>
                  <option value="Muqdisho">Muqdisho</option>
                  <option value="Jigjiga">Jigjiga (+251)</option>
                  <option value="Diridhaba">Diridhaba (+251)</option>
                  <option value="Addis Ababa">Addis Ababa (+251)</option>
                  <option value="Garowe">Garowe</option>
                  <option value="Burco">Burco</option>
                  <option value="Boosaaso">Boosaaso</option>
                  <option value="Kismaayo">Kismaayo</option>
                  <option value="Boorama">Boorama</option>
                  <option value="Nairobi">Nairobi (+254)</option>
                  <option value="Qurbaha">Qurbaha</option>
                </select>
              </div>
              <div class="form-group" style="margin-bottom:0.55rem;">
                <label class="field-label">Faahfaahin kooban</label>
                <input class="field" id="joinTagline" placeholder="Tusaale: Status maalinle" maxlength="100" />
              </div>
            </div>
          </div>

          <button type="submit" id="joinSubmitBtn" class="btn btn-primary big-cta">
            🚀 Ku Biir &amp; Soo Deji Contacts (.vcf)
          </button>
        </form>

        <div class="wa-shortcut-strip">
          <span>💬 <strong>Ka sii fudud:</strong> WhatsApp-ka noogu soo qor kelmadda <b>views</b> (ama kooxaha <b>!views</b>) si faylka .vcf toos Chat-ka looguugu diro!</span>
          <a id="waDirectViewsBtn" href="#" target="_blank" class="btn btn-emerald btn-sm" style="display:none;">💬 Qor "views"</a>
        </div>
      </div>

      <!-- STEP 2: UNLOCKED & INSTANT DOWNLOAD SCREEN -->
      <div id="unlockedWrap" style="display:none;">
        <div class="unlock-box">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.55rem;">
            <span class="pill pill-green" id="unlockedStatusPill">✅ Diyaar!</span>
            <button class="btn btn-ghost btn-sm" onclick="switchAccountForm()">✏️ Beddel Lambar</button>
          </div>

          <h3 style="font-size:1.12rem;font-weight:800;margin-bottom:0.25rem;" id="unlockedWelcome">Ku soo dhawoow!</h3>
          <p style="font-size:0.84rem;color:#cbd5e1;margin-bottom:0.85rem;" id="unlockedSub"></p>

          <!-- Locked batch notice -->
          <div id="batchLockedNotice" class="lock-notice" style="display:none;">
            <strong>🔒 Batch-kaagu Weli Wuu Xiran Yahay (Sugaya Buuxsamid)</strong>
            <div id="batchLockedText" style="margin-top:0.25rem;color:#fde68a;"></div>
            <div style="margin-top:0.6rem;display:flex;gap:0.5rem;flex-wrap:wrap;">
              <button class="btn btn-primary btn-sm" onclick="shareViewsViral()">📤 U Dir Asxaabta (Fur Degdeg)</button>
              <button class="btn btn-ghost btn-sm" onclick="downloadVcf('vip')">👑 Save VIP (.vcf)</button>
            </div>
          </div>

          <!-- Active download buttons -->
          <div id="downloadControlsWrap">
            <button id="downloadVcfBtn" class="btn btn-emerald big-cta" style="margin-bottom:0.6rem;" onclick="downloadVcf('current')">
              📥 Soo Deji Contacts (.vcf) — 1-Click Import
            </button>

            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.65rem;">
              <button class="btn btn-primary btn-sm" id="verifySaverBtn" style="flex:1;" onclick="confirmSaveAndVerify()">✅ Waan Save Gareeyay (Xaqiiji)</button>
              <button class="btn btn-ghost btn-sm" style="flex:1;" onclick="shareViewsViral()">📤 U Dir 3 Saaxiib</button>
            </div>

            <div style="display:flex;gap:0.45rem;flex-wrap:wrap;align-items:center;">
              <button class="btn btn-ghost btn-sm" onclick="downloadVcf('all')">🌍 Soo Deji Dhammaan Pool-ka (.vcf)</button>
              <a id="upgradeVipBtn" href="#" target="_blank" class="btn btn-sm" style="background:linear-gradient(135deg,#f59e0b,#ea580c);color:#fff;">👑 Noqo VIP Pinned</a>
            </div>
          </div>
        </div>
      </div>

      <!-- 3-step micro guide right below -->
      <div class="quick-steps-strip">
        <div class="qs-box"><strong>1. Geli Lambarka</strong>Hal mar kaliya — laba jeer lama save gareeyo.</div>
        <div class="qs-box"><strong>2. Fur Faylka .vcf</strong>Guji faylka soo degay ➔ <b>Import All Contacts</b>.</div>
        <div class="qs-box"><strong>3. Fur WhatsApp</strong>Isla saacaddaas Status Views-kaagu kor ayay u kacayaan!</div>
      </div>
    </section>

    <!-- Featured VIP Sponsors -->
    <section id="vipSection" class="glass-card" style="margin-bottom:1.4rem;border-color:rgba(245,158,11,0.32);">
      <div class="card-title">
        <span>👑 VIP Pinned Sponsors (Korka Ku Xiran .vcf Kasta)</span>
        <button class="btn btn-ghost btn-sm" onclick="downloadVcf('vip')">📥 Save VIP (.vcf)</button>
      </div>
      <div class="card-sub">Macaamiisha VIP-ga ah — lambarradoodu si toos ah ayay korka uga soo baxaan fayl kasta oo .vcf ah.</div>
      <div class="vip-grid" id="vipGrid">
        <div style="color:var(--text-muted);font-size:0.86rem;">Waa la soo rarayaa...</div>
      </div>
    </section>

    <!-- Live Community Members Directory -->
    <section class="glass-card">
      <div class="card-title">
        <span>🌍 Xubnaha Ku Jira Pool-ka (Live)</span>
        <button class="btn btn-ghost btn-sm" onclick="loadViewsHub()">🔄 Refresh</button>
      </div>
      <div class="card-sub">Lambarada saxda ah waxaa lagu helaa faylka .vcf oo keliya.</div>
      <div class="city-chips" id="cityChips"></div>
      <div class="members-grid" id="membersGrid">
        <div style="color:var(--text-muted);font-size:0.86rem;">Waa la soo rarayaa...</div>
      </div>
    </section>
  </main>

  <div id="toastBanner" class="toast-banner"></div>

  <script>
    ${COMMON_CLIENT_JS}

    const hubState = {
      selectedCity: '',
      ownerVipPhone: '',
      vipPriceLabel: '$5 / Bil',
      currentBatch: 1,
      batchTarget: 100,
      downloadMode: 'instant',
      batches: [],
      myProfile: null,
      refPhone: ''
    };

    try {
      const qs = new URLSearchParams(location.search);
      hubState.refPhone = (qs.get('ref') || '').replace(/\\D/g, '');
      const saved = localStorage.getItem('cardoso_views_member');
      if (saved) hubState.myProfile = JSON.parse(saved);
    } catch {}

    function toggleOptionalFields() {
      const box = document.getElementById('optionalFieldsBox');
      const arrow = document.getElementById('optToggleArrow');
      if (!box) return;
      const open = box.style.display === 'block';
      box.style.display = open ? 'none' : 'block';
      if (arrow) arrow.textContent = open ? '▸' : '▾';
    }

    function onCountryCodeChanged() {
      const cc = (document.getElementById('joinCountryCode') || {}).value || '';
      const cityEl = document.getElementById('joinCity');
      const phoneEl = document.getElementById('joinPhone');
      if (cc === '251') {
        if (cityEl) cityEl.value = 'Jigjiga';
        if (phoneEl) phoneEl.placeholder = '915xxxxxx ama 0915xxxxxx';
      } else if (cc === '254') {
        if (cityEl) cityEl.value = 'Nairobi';
        if (phoneEl) phoneEl.placeholder = '712xxxxxx ama 0712xxxxxx';
      } else if (cc === '252') {
        if (cityEl) cityEl.value = 'Hargeysa';
        if (phoneEl) phoneEl.placeholder = '634xxxxxx ama 615xxxxxx';
      }
    }

    function buildVipWhatsAppUrl(customMsg) {
      const phone = (hubState.ownerVipPhone || '').replace(/\\D/g, '');
      const text = customMsg || ('Asc! Waxaan rabaa inaan VIP Pinned Sponsor ku noqdo CARDOSO Views Hub (' + hubState.vipPriceLabel + ').');
      if (!phone) return '/join';
      return 'https://wa.me/' + phone + '?text=' + encodeURIComponent(text);
    }

    async function triggerVcfBlobDownload(url, fallbackFilename) {
      const res = await fetch(url, { cache: 'no-store' });
      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (!res.ok || contentType.includes('application/json')) {
        const errData = await res.json().catch(function() { return {}; });
        throw new Error(errData.message || 'Faylka .vcf lama soo dejin karin hadda');
      }
      const text = await res.text();
      if (!text || !text.includes('BEGIN:VCARD')) {
        throw new Error('Weli contacts diyaar ah ma jiraan');
      }
      const disp = res.headers.get('content-disposition') || '';
      const m = disp.match(/filename="([^"]+)"/i);
      const filename = (m && m[1]) ? m[1] : (fallbackFilename || 'CARDOSO_Views.vcf');
      const blob = new Blob([text], { type: 'text/vcard;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function() { URL.revokeObjectURL(blobUrl); }, 15000);
      return { filename: filename, count: Number(res.headers.get('x-contacts-count') || 0) };
    }

    function getBatchInfo(batchNum) {
      return (hubState.batches || []).find(function(b) { return b.batchNumber === batchNum; }) || null;
    }

    function renderUnlockedState() {
      const formWrap = document.getElementById('joinFormWrap');
      const unlWrap = document.getElementById('unlockedWrap');
      if (hubState.myProfile && hubState.myProfile.phone) {
        formWrap.style.display = 'none';
        unlWrap.style.display = 'block';
        const myBatch = hubState.myProfile.batchNumber || hubState.currentBatch;
        const batchMeta = getBatchInfo(myBatch);
        const isLocked = hubState.downloadMode === 'locked' && batchMeta && !batchMeta.isUnlocked;

        document.getElementById('unlockedWelcome').textContent = '🎉 Ku soo dhawoow, ' + (hubState.myProfile.displayName || 'Saaxiib') + '!';
        document.getElementById('unlockedSub').textContent =
          'Lambarkaaga (+' + hubState.myProfile.phone + ') wuxuu ku jiraa Batch #' + myBatch + '. Markaad faylka .vcf furto guji "Import All Contacts".';

        const lockNotice = document.getElementById('batchLockedNotice');
        const dlWrap = document.getElementById('downloadControlsWrap');
        if (isLocked) {
          lockNotice.style.display = 'block';
          dlWrap.style.display = 'none';
          document.getElementById('batchLockedText').textContent =
            'Batch #' + myBatch + ': ' + (batchMeta.freeCount || 0) + ' / ' + hubState.batchTarget + ' Qof ayaa buuxsamay. Markuu ' + hubState.batchTarget + ' gaaro si toos ah ayuu u furmayaa!';
        } else {
          lockNotice.style.display = 'none';
          dlWrap.style.display = 'block';
        }

        const pill = document.getElementById('unlockedStatusPill');
        const verBtn = document.getElementById('verifySaverBtn');
        if (hubState.myProfile.verifiedSaver) {
          pill.textContent = '✅ Verified Saver';
          if (verBtn) verBtn.textContent = '✅ Waad Xaqiijisay';
        } else {
          pill.textContent = hubState.myProfile.hasDownloaded ? '📥 .vcf Waa Soo Degay' : '✅ Batch #' + myBatch;
          if (verBtn) verBtn.textContent = '✅ Waan Save Gareeyay (Xaqiiji)';
        }

        const upg = document.getElementById('upgradeVipBtn');
        if (upg) upg.href = buildVipWhatsAppUrl('Asc! Magacaygu waa ' + (hubState.myProfile.displayName || '') + ' (+' + hubState.myProfile.phone + '). Waxaan rabaa VIP Pinned CARDOSO Views Hub.');
      } else {
        formWrap.style.display = 'block';
        unlWrap.style.display = 'none';
      }
    }

    function switchAccountForm() {
      hubState.myProfile = null;
      try { localStorage.removeItem('cardoso_views_member'); } catch {}
      renderUnlockedState();
    }

    async function loadViewsHub() {
      try {
        const q = hubState.selectedCity ? ('?city=' + encodeURIComponent(hubState.selectedCity)) : '';
        const res = await fetch('/api/views/summary' + q);
        const data = await res.json();
        if (!data || data.status !== 'ok') return;

        const cfg = data.config || {};
        const stats = data.stats || {};
        hubState.ownerVipPhone = cfg.ownerVipPhone || '';
        hubState.vipPriceLabel = cfg.vipPriceLabel || '$5 / Bil';
        hubState.currentBatch = stats.currentBatch || 1;
        hubState.batchTarget = stats.batchTarget || 100;
        hubState.downloadMode = stats.downloadMode || 'instant';
        hubState.batches = stats.batches || [];

        document.getElementById('hubHeaderTitle').innerHTML = escapeHtml(cfg.hubTitle || 'CARDOSO Views Hub');
        document.getElementById('heroBatchBadge').textContent = '📦 Batch #' + hubState.currentBatch;
        document.getElementById('heroLockBadge').textContent =
          hubState.downloadMode === 'locked'
            ? (stats.currentBatchUnlocked ? '🔓 Furmay' : '🔒 Sugaya ' + hubState.batchTarget)
            : '🔓 Instant .vcf';
        document.getElementById('heroStatsMini').textContent = '👥 ' + (stats.totalContacts || 0) + ' Qof · 📥 ' + (stats.totalDownloads || 0) + ' DL';

        const waDirect = document.getElementById('waDirectViewsBtn');
        if (waDirect && hubState.ownerVipPhone) {
          waDirect.href = 'https://wa.me/' + encodeURIComponent(hubState.ownerVipPhone) + '?text=' + encodeURIComponent('views');
          waDirect.style.display = 'inline-flex';
        }

        const ann = document.getElementById('announceStrip');
        if (cfg.announcement) {
          ann.style.display = 'block';
          ann.textContent = '📢 ' + cfg.announcement;
        } else {
          ann.style.display = 'none';
        }

        document.getElementById('batchMeterLabel').textContent =
          '🔥 Batch #' + hubState.currentBatch + ': ' + (stats.currentBatchFreeCount || 0) + ' / ' + hubState.batchTarget + ' Qof (+ ' + (stats.activeVipCount || 0) + ' VIP)';
        document.getElementById('batchMeterPct').textContent = (stats.progressPct || 0) + '%';
        document.getElementById('batchMeterFill').style.width = (stats.progressPct || 0) + '%';

        // Render VIP Cards
        const vipGrid = document.getElementById('vipGrid');
        const vips = data.vips || [];
        const vipCardsHtml = vips.map(function(v) {
          const initials = String(v.displayName || 'V').slice(0, 1).toUpperCase();
          const avatarHtml = v.avatarUrl
            ? '<img class="vip-avatar" src="' + escapeHtml(v.avatarUrl) + '" alt="' + escapeHtml(v.displayName) + '" />'
            : '<div class="vip-avatar">' + escapeHtml(initials) + '</div>';
          const waLink = 'https://wa.me/' + encodeURIComponent(v.phone) + '?text=' + encodeURIComponent('Asc ' + v.displayName + '! Waxaan kaa helay CARDOSO Views Hub.');
          return '<div class="vip-card">' +
            '<div class="vip-head">' +
              avatarHtml +
              '<div>' +
                '<div class="vip-name">' + escapeHtml(v.displayName) + '</div>' +
                '<div class="vip-meta"><span>👑 VIP</span><span>•</span><span>📍 ' + escapeHtml(v.city) + '</span></div>' +
              '</div>' +
            '</div>' +
            '<div class="vip-tagline">' + escapeHtml(v.tagline || 'VIP Member — Ku dar Contacts-kaaga!') + '</div>' +
            '<div class="vip-actions">' +
              '<a href="' + waLink + '" target="_blank" class="btn btn-emerald btn-sm" style="flex:1;">💬 WhatsApp</a>' +
              '<button class="btn btn-ghost btn-sm" onclick="downloadSingleVip(' + v.id + ')">➕ .vcf</button>' +
            '</div>' +
          '</div>';
        }).join('');

        const ctaCardHtml =
          '<div class="vip-cta-card">' +
            '<div>' +
              '<span class="pill pill-amber" style="margin-bottom:0.45rem;">💎 VIP Pinned (' + escapeHtml(hubState.vipPriceLabel) + ')</span>' +
              '<h3 style="font-size:0.98rem;font-weight:800;margin-bottom:0.25rem;">Ku Xir Ganacsigaaga Halkan!</h3>' +
              '<p style="font-size:0.81rem;color:#cbd5e1;">Lambarkaagu korka ayuu uga soo baxayaa <b>fayl kasta oo .vcf ah</b>.</p>' +
            '</div>' +
            '<a href="' + buildVipWhatsAppUrl() + '" target="_blank" class="btn btn-sm" style="background:linear-gradient(135deg,#f59e0b,#ea580c);color:#fff;width:100%;">👑 Dalbo VIP Hadda</a>' +
          '</div>';

        vipGrid.innerHTML = vipCardsHtml + ctaCardHtml;

        const cities = stats.cities || [];
        const chipsBox = document.getElementById('cityChips');
        chipsBox.innerHTML =
          '<button class="city-chip ' + (!hubState.selectedCity ? 'active' : '') + '" onclick="selectCityFilter()">🌍 Dhammaan (' + (stats.totalContacts || 0) + ')</button>' +
          cities.map(function(c) {
            const active = hubState.selectedCity.toLowerCase() === c.city.toLowerCase() ? 'active' : '';
            return '<button class="city-chip ' + active + '" onclick="selectCityFilter(' + JSON.stringify(c.city).replace(/"/g, '&quot;') + ')">📍 ' + escapeHtml(c.city) + ' (' + c.count + ')</button>';
          }).join('');

        const mGrid = document.getElementById('membersGrid');
        const members = data.recentMembers || [];
        if (!members.length) {
          mGrid.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;">Noqo qofkii ugu horreeyay ee ku biira Batch-kan! 🚀</div>';
        } else {
          mGrid.innerHTML = members.map(function(m) {
            const badge = m.isVip
              ? '<span class="pill pill-amber" style="font-size:0.68rem;">VIP</span>'
              : (m.verifiedSaver
                ? '<span class="pill pill-green" style="font-size:0.68rem;">✅ #' + m.batchNumber + '</span>'
                : '<span class="pill pill-cyan" style="font-size:0.68rem;">#' + m.batchNumber + '</span>');
            return '<div class="member-tile ' + (m.isVip ? 'is-vip' : '') + '">' +
              '<div style="min-width:0;">' +
                '<div style="font-weight:800;font-size:0.86rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (m.isVip ? '👑 ' : '') + escapeHtml(m.displayName) + '</div>' +
                '<div style="font-size:0.75rem;color:var(--text-muted);">' + escapeHtml(m.maskedPhone) + ' · 📍 ' + escapeHtml(m.city) + '</div>' +
              '</div>' +
              badge +
            '</div>';
          }).join('');
        }

        renderUnlockedState();
      } catch (err) {
        console.error(err);
      }
    }

    function selectCityFilter(city) {
      hubState.selectedCity = city || '';
      loadViewsHub();
    }

    /**
     * 1-Click Magic Flow:
     * 1. Registers new phone (or silently unlocks existing phone if already registered — zero duplicates!)
     * 2. Immediately auto-downloads the .vcf if batch is unlocked (zero second click!)
     */
    async function submitQuickJoinAndDownload(e) {
      e.preventDefault();
      const btn = document.getElementById('joinSubmitBtn');
      btn.disabled = true;
      btn.textContent = '⏳ Waa la diyaarinayaa .vcf-kaaga...';

      const name = document.getElementById('joinName').value.trim();
      const countryCode = document.getElementById('joinCountryCode').value;
      const phone = document.getElementById('joinPhone').value.trim();
      const city = document.getElementById('joinCity').value;
      const tagline = document.getElementById('joinTagline').value.trim();

      try {
        let res = await fetch('/api/views/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name,
            countryCode: countryCode,
            phone: phone,
            city: city,
            tagline: tagline,
            referredBy: hubState.refPhone || ''
          })
        });
        let data = await res.json();

        // If already registered, seamlessly unlock their existing profile without duplicating!
        if (!res.ok && data.code === 'DUPLICATE_PHONE') {
          const lookRes = await fetch('/api/views/lookup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ countryCode: countryCode, phone: phone })
          });
          const lookData = await lookRes.json();
          if (!lookRes.ok || lookData.status !== 'ok') {
            throw new Error(data.message || 'Lambarkan horay ayaa loo diiwaangeliyay');
          }
          hubState.myProfile = lookData.contact;
          try { localStorage.setItem('cardoso_views_member', JSON.stringify(lookData.contact)); } catch {}
          showToast('✅ Horay ayaad u diiwaangashanayd — .vcf-kaagu wuu soo degayaa!');
        } else if (!res.ok || data.status !== 'ok') {
          throw new Error(data.message || 'Isdiiwaangelintu ma shaqayn');
        } else {
          hubState.myProfile = data.contact;
          try { localStorage.setItem('cardoso_views_member', JSON.stringify(data.contact)); } catch {}
          if (data.batchCompleted) {
            showToast('🔥 Hambalyo! Batch #' + data.contact.batchNumber + ' adiga ayaa buuxiyay!');
          } else {
            showToast('🎉 Waad ku biirtay Batch #' + data.contact.batchNumber + '!');
          }
        }

        await loadViewsHub();

        // Auto-trigger .vcf download immediately if this batch is unlocked!
        const myBatch = hubState.myProfile && hubState.myProfile.batchNumber ? hubState.myProfile.batchNumber : hubState.currentBatch;
        const batchMeta = getBatchInfo(myBatch);
        const isLocked = hubState.downloadMode === 'locked' && batchMeta && !batchMeta.isUnlocked;
        if (!isLocked) {
          await downloadVcf('current');
        }
      } catch (err) {
        showToast('❌ ' + (err.message || 'Khalad ayaa dhacay'), true);
      } finally {
        btn.disabled = false;
        btn.textContent = '🚀 Ku Biir & Soo Deji Contacts (.vcf)';
      }
    }

    async function downloadVcf(scope) {
      const q = new URLSearchParams({ scope: scope || 'current' });
      if (hubState.myProfile && hubState.myProfile.phone) {
        q.set('myPhone', hubState.myProfile.phone);
        if ((scope || 'current') === 'current' && hubState.myProfile.batchNumber) {
          q.set('batch', String(hubState.myProfile.batchNumber));
        }
      }
      const btn = document.getElementById('downloadVcfBtn');
      const prevTxt = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Faylka .vcf waa soo degayaa...'; }
      try {
        const info = await triggerVcfBlobDownload('/api/views/download.vcf?' + q.toString(), 'CARDOSO_Views.vcf');
        if (hubState.myProfile) {
          hubState.myProfile.hasDownloaded = true;
          try { localStorage.setItem('cardoso_views_member', JSON.stringify(hubState.myProfile)); } catch {}
        }
        showToast('✅ ' + (info.count || '') + ' Contacts (.vcf) waa soo degeen — guji faylka ➔ Import All!');
        await loadViewsHub();
      } catch (err) {
        showToast('❌ ' + (err.message || 'Lama soo dejin karin'), true);
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = prevTxt || '📥 Soo Deji Contacts (.vcf) — 1-Click Import'; }
      }
    }

    async function downloadSingleVip(id) {
      try {
        await triggerVcfBlobDownload('/api/views/download.vcf?scope=single&id=' + encodeURIComponent(String(id)), 'CARDOSO_VIP.vcf');
        showToast('✅ Contact-ka VIP waa soo degay!');
      } catch (err) {
        showToast('❌ ' + (err.message || 'Lama soo dejin karin'), true);
      }
    }

    async function confirmSaveAndVerify() {
      if (!hubState.myProfile || !hubState.myProfile.phone) return;
      try {
        const res = await fetch('/api/views/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: hubState.myProfile.phone })
        });
        const data = await res.json();
        if (res.ok && data.status === 'ok') {
          hubState.myProfile.verifiedSaver = true;
          try { localStorage.setItem('cardoso_views_member', JSON.stringify(hubState.myProfile)); } catch {}
          renderUnlockedState();
          showToast('✅ Waad ku mahadsan tahay! Calaamadda Verified waa lagu siiyay.');
        }
      } catch {}

      const ownerPhone = (hubState.ownerVipPhone || '').replace(/\\D/g, '');
      if (ownerPhone) {
        const msg = 'Asc! Waan save gareeyay contacts-ka CARDOSO Views Hub (Batch #' + (hubState.myProfile.batchNumber || 1) + ') ✅ Magacaygu waa ' + (hubState.myProfile.displayName || '') + '.';
        window.open('https://wa.me/' + ownerPhone + '?text=' + encodeURIComponent(msg), '_blank');
      }
    }

    function shareViewsViral() {
      const myPhone = hubState.myProfile && hubState.myProfile.phone ? hubState.myProfile.phone : '';
      const shareUrl = location.origin + '/views' + (myPhone ? ('?ref=' + encodeURIComponent(myPhone)) : '');
      const msg = '📈 Ma rabtaa 200+ WhatsApp Status Views dhab ah maanta (0% Ban)? 5 ilbiriqsi geli lambarkaaga (+252 / +251) oo hal gujis ku soo deji .vcf:\\n' + shareUrl;
      window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
    }

    loadViewsHub();
  </script>
</body>
</html>`;
}
