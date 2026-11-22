import { COMMON_CLIENT_JS, PWA_HEAD_TAGS, SAAS_STYLES } from './styles.js';

export function renderViewsHubHTML(): string {
  return `<!DOCTYPE html>
<html lang="so">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>CARDOSO Views Hub — 0% Ban WhatsApp Status Views &amp; .vcf Contact Pool</title>
  ${PWA_HEAD_TAGS}
  <style>
    ${SAAS_STYLES}

    .views-hero {
      position: relative;
      overflow: hidden;
      border-radius: 22px;
      padding: 2.1rem 1.6rem;
      margin-bottom: 1.5rem;
      background:
        radial-gradient(circle at 15% 15%, rgba(6, 182, 212, 0.24), transparent 45%),
        radial-gradient(circle at 88% 20%, rgba(245, 158, 11, 0.2), transparent 45%),
        linear-gradient(155deg, rgba(15, 23, 42, 0.94), rgba(7, 11, 20, 0.96));
      border: 1px solid rgba(56, 189, 248, 0.26);
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.42);
    }
    .views-hero h2 {
      font-size: clamp(1.55rem, 3.4vw, 2.35rem);
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.18;
      margin: 0.7rem 0 0.65rem;
    }
    .views-hero h2 span {
      background: linear-gradient(90deg, #22d3ee, #34d399, #fbbf24);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .views-hero p {
      color: #cbd5e1;
      font-size: 0.94rem;
      max-width: 680px;
      margin-bottom: 1.25rem;
    }

    .batch-meter {
      background: rgba(8, 13, 25, 0.78);
      border: 1px solid rgba(148, 163, 184, 0.18);
      border-radius: 16px;
      padding: 1rem 1.15rem;
      margin-bottom: 1.15rem;
    }
    .batch-meter-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
      font-size: 0.86rem;
      font-weight: 700;
    }
    .meter-track {
      height: 12px;
      border-radius: 999px;
      background: rgba(148, 163, 184, 0.14);
      overflow: hidden;
    }
    .meter-fill {
      height: 100%;
      width: 0%;
      border-radius: 999px;
      background: linear-gradient(90deg, #06b6d4, #10b981, #f59e0b);
      box-shadow: 0 0 18px rgba(6, 182, 212, 0.45);
      transition: width 0.55s ease;
    }

    .vip-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 1rem;
    }
    @media (max-width: 960px) { .vip-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 620px) { .vip-grid { grid-template-columns: 1fr; } }

    .vip-card {
      position: relative;
      background: linear-gradient(160deg, rgba(30, 27, 18, 0.78), rgba(15, 23, 42, 0.92));
      border: 1px solid rgba(245, 158, 11, 0.42);
      border-radius: 18px;
      padding: 1.15rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35);
      transition: transform 0.18s ease, border-color 0.18s ease;
    }
    .vip-card:hover { transform: translateY(-2px); border-color: rgba(251, 191, 36, 0.75); }
    .vip-head { display: flex; align-items: center; gap: 0.8rem; }
    .vip-avatar {
      width: 54px; height: 54px; border-radius: 15px; flex-shrink: 0;
      object-fit: cover;
      background: linear-gradient(135deg, #f59e0b, #ea580c);
      display: flex; align-items: center; justify-content: center;
      font-size: 1.35rem; font-weight: 800; color: #fff;
      border: 2px solid rgba(251, 191, 36, 0.55);
    }
    .vip-name { font-size: 1rem; font-weight: 800; color: #fff; }
    .vip-meta { font-size: 0.77rem; color: #fcd34d; display: flex; gap: 0.45rem; align-items: center; flex-wrap: wrap; margin-top: 0.15rem; }
    .vip-tagline { font-size: 0.83rem; color: #cbd5e1; line-height: 1.48; flex: 1; }
    .vip-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }

    .vip-cta-card {
      background: linear-gradient(155deg, rgba(245, 158, 11, 0.16), rgba(139, 92, 246, 0.15));
      border: 1px dashed rgba(251, 191, 36, 0.55);
      border-radius: 18px;
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 0.8rem;
    }

    .unlock-box {
      background: linear-gradient(160deg, rgba(16, 185, 129, 0.14), rgba(6, 182, 212, 0.12));
      border: 1px solid rgba(16, 185, 129, 0.45);
      border-radius: 16px;
      padding: 1.25rem;
    }
    .lock-notice {
      background: rgba(245, 158, 11, 0.12);
      border: 1px solid rgba(245, 158, 11, 0.45);
      border-radius: 13px;
      padding: 0.95rem 1rem;
      margin-bottom: 0.85rem;
      font-size: 0.84rem;
      line-height: 1.5;
    }
    .verify-box {
      margin-top: 0.85rem;
      padding: 0.9rem 1rem;
      border-radius: 13px;
      background: rgba(6, 182, 212, 0.1);
      border: 1px solid rgba(6, 182, 212, 0.35);
    }

    .phone-row {
      display: flex;
      gap: 0.45rem;
    }
    .phone-row select {
      width: 145px;
      flex-shrink: 0;
    }

    .mode-switch {
      display: flex;
      gap: 0.4rem;
      margin-bottom: 1rem;
      padding: 0.3rem;
      border-radius: 12px;
      background: rgba(8, 13, 25, 0.78);
      border: 1px solid var(--card-border);
    }
    .mode-switch button {
      flex: 1;
      border: none;
      background: transparent;
      color: var(--text-muted);
      padding: 0.5rem 0.65rem;
      border-radius: 9px;
      font-size: 0.8rem;
      font-weight: 700;
      cursor: pointer;
    }
    .mode-switch button.active {
      background: linear-gradient(135deg, #06b6d4, #2563eb);
      color: #fff;
    }

    .step-item {
      display: flex;
      gap: 0.8rem;
      align-items: flex-start;
      padding: 0.85rem;
      border-radius: 13px;
      background: rgba(8, 13, 25, 0.75);
      border: 1px solid var(--card-border);
      margin-bottom: 0.65rem;
    }
    .step-num {
      width: 30px; height: 30px; border-radius: 10px; flex-shrink: 0;
      background: linear-gradient(135deg, #06b6d4, #2563eb);
      color: #fff; font-weight: 800; font-size: 0.86rem;
      display: flex; align-items: center; justify-content: center;
    }

    .city-chips {
      display: flex; flex-wrap: wrap; gap: 0.45rem; margin-bottom: 1rem;
    }
    .city-chip {
      border: 1px solid var(--card-border);
      background: rgba(15, 23, 42, 0.82);
      color: #cbd5e1;
      border-radius: 999px;
      padding: 0.36rem 0.82rem;
      font-size: 0.78rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.16s;
    }
    .city-chip.active, .city-chip:hover {
      background: rgba(6, 182, 212, 0.2);
      border-color: var(--primary);
      color: #fff;
    }

    .members-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.7rem;
    }
    @media (max-width: 900px) { .members-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 560px) { .members-grid { grid-template-columns: 1fr; } }

    .member-tile {
      background: rgba(10, 16, 30, 0.85);
      border: 1px solid var(--card-border);
      border-radius: 13px;
      padding: 0.8rem 0.9rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.65rem;
    }
    .member-tile.is-vip {
      border-color: rgba(245, 158, 11, 0.42);
      background: rgba(30, 27, 18, 0.55);
    }

    .announce-strip {
      display: none;
      margin-bottom: 1.15rem;
      padding: 0.8rem 1rem;
      border-radius: 14px;
      background: linear-gradient(90deg, rgba(139, 92, 246, 0.18), rgba(6, 182, 212, 0.18));
      border: 1px solid rgba(139, 92, 246, 0.38);
      font-size: 0.86rem;
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
        <p>0% Ban WhatsApp Status Views &amp; 1-Click .vcf Contact Exchange</p>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;">
      <a href="/app" class="btn btn-primary btn-sm">🤖 Fur CARDOSO AI App</a>
      <button type="button" class="btn btn-ghost btn-sm" data-pwa-install-btn onclick="triggerCardosoInstall()">📲 Install App</button>
      <a id="topVipBtn" href="#vipSection" class="btn btn-sm" style="background:linear-gradient(135deg,#f59e0b,#ea580c);color:#fff;">👑 Noqo VIP Pinned</a>
    </div>
  </header>

  <main class="container">
    <!-- Optional Admin Announcement -->
    <div id="announceStrip" class="announce-strip"></div>

    <!-- Hero & Live Progress -->
    <section class="views-hero">
      <div style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;">
        <span class="pill pill-green">🛡️ 0% WhatsApp Ban — 100% Phonebook .vcf</span>
        <span class="pill pill-cyan" id="heroBatchBadge">📦 Batch #1 Furmay</span>
        <span class="pill pill-violet" id="heroLockBadge">🔓 Instant Download</span>
        <span class="pill pill-amber" id="heroPricePill">👑 VIP: $5 / Bil</span>
      </div>

      <h2>Hel <span>200 – 2,000+ WhatsApp Status Views</span> Dhab ah — Hal Gujis (.vcf)</h2>
      <p>
        Iska daa Cold DM iyo 24h spam ban! Waxaa la taageerayaa <strong>🇸🇴 +252</strong>, <strong>🇪🇹 +251</strong>, <strong>🇰🇪 +254</strong> iyo caalamka oo dhan. Hal lambar laba jeer lama geli karo, faylka <strong>.vcf</strong>-kuna laba jeer isuma save gareeyo!
      </p>

      <div class="batch-meter">
        <div class="batch-meter-top">
          <span id="batchMeterLabel">🔥 Batch #1 Progress: 0 / 100 Qof</span>
          <span style="color:#22d3ee;" id="batchMeterPct">0%</span>
        </div>
        <div class="meter-track">
          <div class="meter-fill" id="batchMeterFill"></div>
        </div>
      </div>

      <div class="grid-4">
        <div class="kpi-box">
          <div class="kpi-label">Wadarta Dadka Pool-ka</div>
          <div class="kpi-val" id="kpiTotalMembers">0</div>
          <div class="kpi-foot" id="kpiVerifiedFoot">0 Verified Savers</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">Batch-ka Hadda</div>
          <div class="kpi-val" id="kpiCurrentBatch" style="color:#22d3ee;">#1</div>
          <div class="kpi-foot" id="kpiCurrentBatchCount">0 contacts diyaar ah</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">VIP Pinned Sponsors</div>
          <div class="kpi-val" id="kpiVipCount" style="color:#fbbf24;">0</div>
          <div class="kpi-foot">Korka ku xiran .vcf kasta</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">Wadarta .vcf Downloads</div>
          <div class="kpi-val" id="kpiTotalDownloads" style="color:#34d399;">0</div>
          <div class="kpi-foot">Is-kaydin guuleystay</div>
        </div>
      </div>
    </section>

    <!-- Featured VIP Sponsors -->
    <section id="vipSection" class="glass-card" style="margin-bottom:1.5rem;border-color:rgba(245,158,11,0.32);">
      <div class="card-title">
        <span>👑 VIP Pinned Sponsors (Korka Ku Xiran Batch Kasta)</span>
        <button class="btn btn-ghost btn-sm" onclick="downloadVcf('vip')">📥 Save Dhammaan VIP (.vcf)</button>
      </div>
      <div class="card-sub">
        Ganacsatada, dukaamada, iyo dadka VIP-ga ah — lambarradoodu waxay si toos ah korka uga soo baxaan fayl kasta oo .vcf ah oo la soo dejiyo!
      </div>
      <div class="vip-grid" id="vipGrid">
        <div style="color:var(--text-muted);font-size:0.86rem;">Waa la soo rarayaa...</div>
      </div>
    </section>

    <!-- Core 2-Column: Join / Returning Lookup / Unlocked Download + 3-Step Guide -->
    <div class="grid-2" style="margin-bottom:1.5rem;align-items:start;">
      <section class="glass-card" id="joinDownloadCard">
        <div id="joinFormWrap">
          <div class="mode-switch">
            <button type="button" id="tabJoinNew" class="active" onclick="switchEntryMode('new')">⚡ Isdiiwaangeli (Cusub)</button>
            <button type="button" id="tabJoinReturn" onclick="switchEntryMode('return')">🔑 Horay Ma Isku Diiwaangelisay?</button>
          </div>

          <!-- NEW SIGNUP FORM -->
          <form id="newSignupForm" onsubmit="submitViewsJoin(event)">
            <div class="form-group">
              <label class="field-label">Magacaaga (Sida uu Contacts-ka uga muuqanayo)</label>
              <input class="field" id="joinName" required placeholder="Tusaale: Mohamed Dahir / Jigjiga Tech" maxlength="60" />
            </div>
            <div class="form-group">
              <label class="field-label">Lambarkaaga WhatsApp (Hal mar kaliya ayaa la diiwaangelin karaa)</label>
              <div class="phone-row">
                <select class="field" id="joinCountryCode" onchange="onCountryCodeChanged()">
                  <option value="252">🇸🇴 +252</option>
                  <option value="251">🇪🇹 +251</option>
                  <option value="254">🇰🇪 +254</option>
                  <option value="253">🇩🇯 +253</option>
                  <option value="">🌍 Kale</option>
                </select>
                <input class="field" id="joinPhone" required placeholder="634xxxxxx ama 915xxxxxx" maxlength="20" />
              </div>
            </div>
            <div class="grid-2">
              <div class="form-group">
                <label class="field-label">Magaalada</label>
                <select class="field" id="joinCity">
                  <option value="Hargeysa">Hargeysa</option>
                  <option value="Muqdisho">Muqdisho</option>
                  <option value="Jigjiga">Jigjiga (DDS +251)</option>
                  <option value="Diridhaba">Diridhaba (+251)</option>
                  <option value="Addis Ababa">Addis Ababa (+251)</option>
                  <option value="Garowe">Garowe</option>
                  <option value="Burco">Burco</option>
                  <option value="Boosaaso">Boosaaso</option>
                  <option value="Kismaayo">Kismaayo</option>
                  <option value="Boorama">Boorama</option>
                  <option value="Nairobi">Nairobi (+254)</option>
                  <option value="Qurbaha">Qurbaha / Diaspora</option>
                </select>
              </div>
              <div class="form-group">
                <label class="field-label">Nooca Akoonka</label>
                <select class="field" id="joinCategory">
                  <option value="personal">👤 Qof Caadi ah (Status Views)</option>
                  <option value="business">🛍️ Ganacsi / Dukaan</option>
                  <option value="creator">🎬 Content Creator</option>
                  <option value="student">🎓 Arday / Jaamacad</option>
                </select>
              </div>
            </div>
            <div class="form-group">
              <label class="field-label">Hal sadar oo kaa warramaya (Ikhtiyaari)</label>
              <input class="field" id="joinTagline" placeholder="Tusaale: Status maalinle &amp; ganacsi" maxlength="100" />
            </div>
            <button type="submit" id="joinSubmitBtn" class="btn btn-primary" style="width:100%;padding:0.9rem;font-size:0.96rem;">
              🚀 Ku Biir &amp; Fur Faylka .vcf Hadda
            </button>
          </form>

          <!-- RETURNING MEMBER LOOKUP -->
          <form id="returningLookupForm" style="display:none;" onsubmit="submitViewsLookup(event)">
            <p style="font-size:0.84rem;color:var(--text-muted);margin-bottom:0.85rem;">
              Haddii aad horay lambarkaaga u diiwaangelisay, geli halkan si aad isla markiiba u furto badhanka <strong>Soo Deji .vcf</strong> adigoon mar labaad isdiiwaangelin.
            </p>
            <div class="form-group">
              <label class="field-label">Lambarkaagii Hore</label>
              <div class="phone-row">
                <select class="field" id="lookupCountryCode">
                  <option value="252">🇸🇴 +252</option>
                  <option value="251">🇪🇹 +251</option>
                  <option value="254">🇰🇪 +254</option>
                  <option value="253">🇩🇯 +253</option>
                  <option value="">🌍 Kale</option>
                </select>
                <input class="field" id="lookupPhone" required placeholder="Geli lambarkaaga..." maxlength="20" />
              </div>
            </div>
            <button type="submit" id="lookupSubmitBtn" class="btn btn-emerald" style="width:100%;padding:0.88rem;">
              🔓 Fur Akoonkayga &amp; .vcf
            </button>
          </form>
        </div>

        <!-- UNLOCKED DOWNLOAD CENTER -->
        <div id="unlockedWrap" style="display:none;">
          <div class="unlock-box">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.6rem;">
              <span class="pill pill-green" id="unlockedStatusPill">✅ Waad Ku Jirtaa Pool-ka!</span>
              <button class="btn btn-ghost btn-sm" onclick="switchAccountForm()">✏️ Beddel Lambar</button>
            </div>
            <h3 style="font-size:1.18rem;font-weight:800;margin-bottom:0.25rem;" id="unlockedWelcome">Ku soo dhawoow!</h3>
            <p style="font-size:0.84rem;color:#cbd5e1;margin-bottom:0.9rem;" id="unlockedSub">
              Hadda hal gujis ku soo deji faylka .vcf si telefoonkaagu si toos ah ugu kaydiyo dhammaan dadka ku jira Batch-ka!
            </p>

            <!-- Shown when Batch Lock mode is active and user's batch is not yet full -->
            <div id="batchLockedNotice" class="lock-notice" style="display:none;">
              <strong>🔒 Batch-kaagu Weli Wuu Xiran Yahay (Sugaya Buuxsamid)</strong>
              <div id="batchLockedText" style="margin-top:0.25rem;color:#fde68a;"></div>
              <div style="margin-top:0.6rem;display:flex;gap:0.5rem;flex-wrap:wrap;">
                <button class="btn btn-primary btn-sm" onclick="shareViewsViral()">📤 U Dir Asxaabta (Fur Degdeg)</button>
                <button class="btn btn-ghost btn-sm" onclick="downloadVcf('vip')">👑 Save VIP (.vcf) Hadda</button>
              </div>
            </div>

            <div id="downloadControlsWrap">
              <div class="grid-2" style="margin-bottom:0.85rem;">
                <div>
                  <label class="field-label">Dooro Batch / Nooca .vcf</label>
                  <select class="field" id="vcfScopeSelect">
                    <option value="current">📦 Batch-kayga + VIP oo dhan</option>
                    <option value="all">🌍 Dhammaan Pool-ka oo dhan</option>
                    <option value="vip">👑 VIP Sponsors oo kaliya</option>
                  </select>
                </div>
                <div>
                  <label class="field-label">Sifee Magaalo (Ikhtiyaari)</label>
                  <select class="field" id="vcfCitySelect">
                    <option value="">🌍 Dhammaan Magaalooyinka</option>
                  </select>
                </div>
              </div>

              <button id="downloadVcfBtn" class="btn btn-emerald" style="width:100%;padding:0.92rem;font-size:0.98rem;margin-bottom:0.65rem;" onclick="downloadSelectedVcf()">
                📥 Soo Deji Contacts (.vcf) — 1-Click Import
              </button>
            </div>

            <!-- 1-Tap Save & Verify WhatsApp Box -->
            <div class="verify-box" id="verifySaverBox">
              <div style="font-size:0.82rem;font-weight:700;margin-bottom:0.45rem;" id="verifySaverTitle">
                ✅ Markaad .vcf-ka Import Gareyso, Guji Xaqiijinta:
              </div>
              <button class="btn btn-primary btn-sm" id="verifySaverBtn" style="width:100%;" onclick="confirmSaveAndVerify()">
                ✅ Waan Save Gareeyay — Xaqiiji WhatsApp
              </button>
            </div>

            <div style="display:flex;gap:0.55rem;flex-wrap:wrap;margin-top:0.75rem;">
              <button class="btn btn-ghost btn-sm" style="flex:1;" onclick="shareViewsViral()">📤 U Dir Asxaabta WhatsApp</button>
              <a id="upgradeVipBtn" href="#" target="_blank" class="btn btn-sm" style="flex:1;background:linear-gradient(135deg,#f59e0b,#ea580c);color:#fff;">👑 Noqo VIP Pinned</a>
            </div>
          </div>
        </div>
      </section>

      <!-- RIGHT: How to Import in 2 Seconds -->
      <section class="glass-card">
        <div class="card-title">📖 Sida 2 Ilbiriqsi Loogu Kaydiyo (.vcf Guide)</div>
        <div class="card-sub">Ma jiro wax spam ah, mana dhaco duplicate — fayl kasta UID gaar ah ayuu leeyahay!</div>

        <div class="step-item">
          <div class="step-num">1</div>
          <div>
            <strong style="font-size:0.9rem;">Soo Deji Faylka .vcf</strong>
            <div style="font-size:0.82rem;color:var(--text-muted);">Markaad lambarkaaga geliso (+252 / +251 / +254), guji <b>Soo Deji Contacts (.vcf)</b>. Fayl yar (<code>.vcf</code>) ayaa telefoonkaaga ku soo degaya.</div>
          </div>
        </div>

        <div class="step-item">
          <div class="step-num">2</div>
          <div>
            <strong style="font-size:0.9rem;">Guji Faylka ➔ Import All Contacts</strong>
            <div style="font-size:0.82rem;color:var(--text-muted);">
              <b>Android:</b> Guji faylka ➔ dooro <b>Contacts</b> ➔ <b>Import</b>.<br/>
              <b>iPhone:</b> Guji faylka ➔ dooro <b>Add All Contacts</b>.
            </div>
          </div>
        </div>

        <div class="step-item" style="margin-bottom:0;">
          <div class="step-num">3</div>
          <div>
            <strong style="font-size:0.9rem;">Guji "Waan Save Gareeyay" ➔ Views Toos ah!</strong>
            <div style="font-size:0.82rem;color:var(--text-muted);">
              Magacyadu waxay wataan calaamad nadiif ah (<code id="prefixPreviewCode">CV - </code>), lambarna laba jeer isuma save gareeyo. Markaad WhatsApp furto Status Views-ku toos ayay u kacayaan!
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- Live Community Members Directory -->
    <section class="glass-card">
      <div class="card-title">
        <span>🌍 Xubnaha Dhowaan Ku Soo Biiray (Live Feed)</span>
        <button class="btn btn-ghost btn-sm" onclick="loadViewsHub()">🔄 Refresh</button>
      </div>
      <div class="card-sub">Amni ahaan, lambarada waxaa lagu qariyay shaashadda — lambarada saxda ah waxaa lagu helaa faylka .vcf markaad ku biirto.</div>

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

    function switchEntryMode(mode) {
      const newForm = document.getElementById('newSignupForm');
      const retForm = document.getElementById('returningLookupForm');
      const tNew = document.getElementById('tabJoinNew');
      const tRet = document.getElementById('tabJoinReturn');
      if (mode === 'return') {
        newForm.style.display = 'none';
        retForm.style.display = 'block';
        tNew.classList.remove('active');
        tRet.classList.add('active');
      } else {
        newForm.style.display = 'block';
        retForm.style.display = 'none';
        tNew.classList.add('active');
        tRet.classList.remove('active');
      }
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
        throw new Error('Weli contacts diyaar u ah soo dejinta ma jiraan');
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
          'Lambarkaaga (+' + hubState.myProfile.phone + ') wuxuu ku jiraa Batch #' + myBatch + '.';

        const lockNotice = document.getElementById('batchLockedNotice');
        const dlWrap = document.getElementById('downloadControlsWrap');
        if (isLocked) {
          lockNotice.style.display = 'block';
          dlWrap.style.display = 'none';
          document.getElementById('batchLockedText').textContent =
            'Batch #' + myBatch + ': ' + (batchMeta.freeCount || 0) + ' / ' + hubState.batchTarget + ' Qof ayaa buuxsamay. Isla marka uu ' + hubState.batchTarget + ' gaaro si toos ah ayuu u furmayaa si qof walba dhammaan contacts-ka u wada helo!';
        } else {
          lockNotice.style.display = 'none';
          dlWrap.style.display = 'block';
        }

        const pill = document.getElementById('unlockedStatusPill');
        if (hubState.myProfile.verifiedSaver) {
          pill.textContent = '✅ Verified Saver';
          document.getElementById('verifySaverTitle').textContent = '✅ Waad Xaqiijisay Kaydinta Contacts-ka! Mahadsanid!';
          document.getElementById('verifySaverBtn').textContent = '💬 Mar Kale La Hadal Maamulka';
        } else {
          pill.textContent = hubState.myProfile.hasDownloaded ? '📥 .vcf La Soo Dejiyay' : '✅ Waad Ku Jirtaa Pool-ka!';
          document.getElementById('verifySaverTitle').textContent = '✅ Markaad .vcf-ka Import Gareyso, Guji Xaqiijinta:';
          document.getElementById('verifySaverBtn').textContent = '✅ Waan Save Gareeyay — Xaqiiji WhatsApp';
        }

        const upg = document.getElementById('upgradeVipBtn');
        if (upg) upg.href = buildVipWhatsAppUrl('Asc! Magacaygu waa ' + (hubState.myProfile.displayName || '') + ' (+' + hubState.myProfile.phone + '). Waxaan rabaa inaan VIP Pinned ku noqdo CARDOSO Views Hub.');
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
        document.getElementById('heroBatchBadge').textContent = '📦 Batch #' + hubState.currentBatch + ' Furmay';
        document.getElementById('heroLockBadge').textContent =
          hubState.downloadMode === 'locked'
            ? (stats.currentBatchUnlocked ? '🔓 Batch Furmay' : '🔒 Furmaya Marka ' + hubState.batchTarget + ' Buuxsamo')
            : '🔓 Instant Download';
        document.getElementById('heroPricePill').textContent = '👑 VIP: ' + hubState.vipPriceLabel;
        document.getElementById('prefixPreviewCode').textContent = cfg.contactPrefix || 'CV - ';

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

        document.getElementById('kpiTotalMembers').textContent = String(stats.totalContacts || 0);
        document.getElementById('kpiVerifiedFoot').textContent = (stats.verifiedSaversCount || 0) + ' Verified Savers';
        document.getElementById('kpiCurrentBatch').textContent = '#' + hubState.currentBatch;
        document.getElementById('kpiCurrentBatchCount').textContent = (stats.currentBatchTotalCount || 0) + ' contacts diyaar ah';
        document.getElementById('kpiVipCount').textContent = String(stats.activeVipCount || 0);
        document.getElementById('kpiTotalDownloads').textContent = String(stats.totalDownloads || 0);

        // Render VIP Cards
        const vipGrid = document.getElementById('vipGrid');
        const vips = data.vips || [];
        const vipCardsHtml = vips.map(function(v) {
          const initials = String(v.displayName || 'V').slice(0, 1).toUpperCase();
          const avatarHtml = v.avatarUrl
            ? '<img class="vip-avatar" src="' + escapeHtml(v.avatarUrl) + '" alt="' + escapeHtml(v.displayName) + '" />'
            : '<div class="vip-avatar">' + escapeHtml(initials) + '</div>';
          const waLink = 'https://wa.me/' + encodeURIComponent(v.phone) + '?text=' + encodeURIComponent('Asc ' + v.displayName + '! Waxaan kaa helay CARDOSO Views Hub, iska kaydi lambarkayga.');
          return '<div class="vip-card">' +
            '<div class="vip-head">' +
              avatarHtml +
              '<div>' +
                '<div class="vip-name">' + escapeHtml(v.displayName) + '</div>' +
                '<div class="vip-meta"><span>👑 VIP Pinned</span><span>•</span><span>📍 ' + escapeHtml(v.city) + '</span></div>' +
              '</div>' +
            '</div>' +
            '<div class="vip-tagline">' + escapeHtml(v.tagline || 'VIP Member — Ku dar Contacts-kaaga si aad Status-kayga u aragto!') + '</div>' +
            '<div class="vip-actions">' +
              '<a href="' + waLink + '" target="_blank" class="btn btn-emerald btn-sm" style="flex:1;">💬 WhatsApp</a>' +
              '<button class="btn btn-ghost btn-sm" onclick="downloadSingleVip(' + v.id + ')">➕ Save .vcf</button>' +
            '</div>' +
          '</div>';
        }).join('');

        const ctaCardHtml =
          '<div class="vip-cta-card">' +
            '<div>' +
              '<span class="pill pill-amber" style="margin-bottom:0.5rem;">💎 Booska VIP Waa Banaan Yahay</span>' +
              '<h3 style="font-size:1rem;font-weight:800;margin-bottom:0.3rem;">Ku Xir Ganacsigaaga Halkan!</h3>' +
              '<p style="font-size:0.82rem;color:#cbd5e1;">Lambarkaagu korka ayuu uga soo baxayaa <b>fayl kasta oo .vcf ah</b> — 1,000+ qof ayaa si toos ah kuu kaydsanaya (' + escapeHtml(hubState.vipPriceLabel) + ').</p>' +
            '</div>' +
            '<a href="' + buildVipWhatsAppUrl() + '" target="_blank" class="btn btn-sm" style="background:linear-gradient(135deg,#f59e0b,#ea580c);color:#fff;width:100%;">👑 Dalbo Boos VIP Hadda</a>' +
          '</div>';

        vipGrid.innerHTML = vipCardsHtml + ctaCardHtml;

        // City filter chips + select
        const cities = stats.cities || [];
        const chipsBox = document.getElementById('cityChips');
        chipsBox.innerHTML =
          '<button class="city-chip ' + (!hubState.selectedCity ? 'active' : '') + '" onclick="selectCityFilter()">🌍 Dhammaan (' + (stats.totalContacts || 0) + ')</button>' +
          cities.map(function(c) {
            const active = hubState.selectedCity.toLowerCase() === c.city.toLowerCase() ? 'active' : '';
            return '<button class="city-chip ' + active + '" onclick="selectCityFilter(' + JSON.stringify(c.city).replace(/"/g, '&quot;') + ')">📍 ' + escapeHtml(c.city) + ' (' + c.count + ')</button>';
          }).join('');

        const citySelect = document.getElementById('vcfCitySelect');
        if (citySelect) {
          const prevVal = citySelect.value;
          citySelect.innerHTML = '<option value="">🌍 Dhammaan Magaalooyinka</option>' +
            cities.map(function(c) { return '<option value="' + escapeHtml(c.city) + '">📍 ' + escapeHtml(c.city) + ' (' + c.count + ')</option>'; }).join('');
          citySelect.value = prevVal;
        }

        // Members feed
        const mGrid = document.getElementById('membersGrid');
        const members = data.recentMembers || [];
        if (!members.length) {
          mGrid.innerHTML = '<div style="color:var(--text-muted);font-size:0.86rem;">Noqo qofkii ugu horreeyay ee ku biira Batch-kan! 🚀</div>';
        } else {
          mGrid.innerHTML = members.map(function(m) {
            const badge = m.isVip
              ? '<span class="pill pill-amber" style="font-size:0.68rem;">VIP</span>'
              : (m.verifiedSaver
                ? '<span class="pill pill-green" style="font-size:0.68rem;">✅ #' + m.batchNumber + '</span>'
                : '<span class="pill pill-cyan" style="font-size:0.68rem;">#' + m.batchNumber + '</span>');
            return '<div class="member-tile ' + (m.isVip ? 'is-vip' : '') + '">' +
              '<div style="min-width:0;">' +
                '<div style="font-weight:800;font-size:0.88rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (m.isVip ? '👑 ' : '') + escapeHtml(m.displayName) + '</div>' +
                '<div style="font-size:0.76rem;color:var(--text-muted);">' + escapeHtml(m.maskedPhone) + ' · 📍 ' + escapeHtml(m.city) + '</div>' +
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

    async function submitViewsJoin(e) {
      e.preventDefault();
      const btn = document.getElementById('joinSubmitBtn');
      btn.disabled = true;
      btn.textContent = '⏳ Waa la diiwaangelinayaa...';
      try {
        const res = await fetch('/api/views/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: document.getElementById('joinName').value.trim(),
            countryCode: document.getElementById('joinCountryCode').value,
            phone: document.getElementById('joinPhone').value.trim(),
            city: document.getElementById('joinCity').value,
            category: document.getElementById('joinCategory').value,
            tagline: document.getElementById('joinTagline').value.trim(),
            referredBy: hubState.refPhone || ''
          })
        });
        const data = await res.json();
        if (!res.ok || data.status !== 'ok') {
          if (data.code === 'DUPLICATE_PHONE') {
            showToast(data.message, true);
            document.getElementById('lookupPhone').value = document.getElementById('joinPhone').value.trim();
            document.getElementById('lookupCountryCode').value = document.getElementById('joinCountryCode').value;
            switchEntryMode('return');
            return;
          }
          throw new Error(data.message || 'Isdiiwaangelintu ma shaqayn');
        }
        hubState.myProfile = data.contact;
        try { localStorage.setItem('cardoso_views_member', JSON.stringify(data.contact)); } catch {}
        if (data.batchCompleted) {
          showToast('🔥 Hambalyo! Adiga ayaa buuxiyay Batch #' + data.contact.batchNumber + ' — Batch #' + data.nextBatchOpened + ' si toos ah ayuu u furmay!');
        } else {
          showToast('🎉 Hambalyo! Waad ku biirtay Batch #' + data.contact.batchNumber + '!');
        }
        await loadViewsHub();
      } catch (err) {
        showToast('❌ ' + (err.message || 'Khalad ayaa dhacay'), true);
      } finally {
        btn.disabled = false;
        btn.textContent = '🚀 Ku Biir & Fur Faylka .vcf Hadda';
      }
    }

    async function submitViewsLookup(e) {
      e.preventDefault();
      const btn = document.getElementById('lookupSubmitBtn');
      btn.disabled = true;
      btn.textContent = '⏳ Waa la raadinayaa...';
      try {
        const res = await fetch('/api/views/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            countryCode: document.getElementById('lookupCountryCode').value,
            phone: document.getElementById('lookupPhone').value.trim()
          })
        });
        const data = await res.json();
        if (!res.ok || data.status !== 'ok') {
          throw new Error(data.message || 'Lambarka lama helin');
        }
        hubState.myProfile = data.contact;
        try { localStorage.setItem('cardoso_views_member', JSON.stringify(data.contact)); } catch {}
        showToast('✅ Ku soo dhawoow mar kale, ' + data.contact.displayName + '!');
        await loadViewsHub();
      } catch (err) {
        showToast('❌ ' + (err.message || 'Khalad'), true);
      } finally {
        btn.disabled = false;
        btn.textContent = '🔓 Fur Akoonkayga & .vcf';
      }
    }

    async function downloadVcf(scope, city) {
      const q = new URLSearchParams({ scope: scope || 'current' });
      if (city) q.set('city', city);
      if (hubState.myProfile && hubState.myProfile.phone) {
        q.set('myPhone', hubState.myProfile.phone);
        if ((scope || 'current') === 'current' && hubState.myProfile.batchNumber) {
          q.set('batch', String(hubState.myProfile.batchNumber));
        }
      }
      const btn = document.getElementById('downloadVcfBtn');
      const prevTxt = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Faylka .vcf waa la diyaarinayaa...'; }
      try {
        const info = await triggerVcfBlobDownload('/api/views/download.vcf?' + q.toString(), 'CARDOSO_Views.vcf');
        if (hubState.myProfile) {
          hubState.myProfile.hasDownloaded = true;
          try { localStorage.setItem('cardoso_views_member', JSON.stringify(hubState.myProfile)); } catch {}
        }
        showToast('✅ ' + (info.count || '') + ' Contacts (.vcf) waa soo degeen — guji faylka si aad u Import gareyso!');
        await loadViewsHub();
      } catch (err) {
        showToast('❌ ' + (err.message || 'Faylka lama soo dejin karin'), true);
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = prevTxt || '📥 Soo Deji Contacts (.vcf) — 1-Click Import'; }
      }
    }

    function downloadSelectedVcf() {
      const scope = (document.getElementById('vcfScopeSelect') || {}).value || 'current';
      const city = (document.getElementById('vcfCitySelect') || {}).value || '';
      downloadVcf(scope, city);
    }

    async function downloadSingleVip(id) {
      try {
        await triggerVcfBlobDownload('/api/views/download.vcf?scope=single&id=' + encodeURIComponent(String(id)), 'CARDOSO_VIP.vcf');
        showToast('✅ Contact-ka VIP (.vcf) waa soo degay!');
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
          showToast('✅ Waad ku mahadsan tahay! Calaamadda Verified Saver waa lagu siiyay.');
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
      const msg = '📈 Ma rabtaa 200+ WhatsApp Status Views dhab ah maanta (0% Ban)? Ku biir CARDOSO Views Hub (+252 / +251), geli lambarkaaga oo hal gujis ku soo deji .vcf:\\n' + shareUrl;
      window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
    }

    loadViewsHub();
  </script>
</body>
</html>`;
}
