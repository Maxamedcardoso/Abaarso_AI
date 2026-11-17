import { BotCategory } from '../../tenants/plan-catalog.js';
import { COMMON_CLIENT_JS, SAAS_STYLES } from './styles.js';

export function renderClientPortalHTML(tenantId: string, token: string, category: BotCategory = 'business'): string {
  const safeId = JSON.stringify(tenantId);
  const safeToken = JSON.stringify(token);
  const isPersonalInitial = category === 'personal';

  return `<!DOCTYPE html>
<html lang="so">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CARDOSO AI — Portal-ka Macmiilka</title>
  <style>${SAAS_STYLES}</style>
</head>
<body>
  <header class="topbar">
    <div class="brand">
      <div class="brand-mark">🤖</div>
      <div>
        <h1 id="headerBrand">CARDOSO <span>AI</span></h1>
        <p id="headerSub">Dashboard-ka Gaarka ah ee WhatsApp Bot-kaaga</p>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;" id="headerBadges">
      <span class="pill pill-muted" id="subStatusPill">⏳ Waa la hubinayaa...</span>
      <span class="pill pill-cyan" id="daysLeftPill">--</span>
      <span class="pill pill-muted" id="waConnPill">WhatsApp: --</span>
    </div>
  </header>

  <main class="container">
    <!-- State Banners (Pending / Expired / Suspended / Security Lock) -->
    <section id="pendingBanner" class="glass-card" style="display:none;border-color:rgba(245,158,11,0.45);margin-bottom:1.5rem;text-align:center;padding:2.2rem;">
      <div style="font-size:2.5rem;margin-bottom:0.6rem;">⏳</div>
      <h2 style="font-size:1.35rem;font-weight:800;margin-bottom:0.5rem;">Codsigaagu Wuxuu Sugayaa Ogolaansho (Pending)</h2>
      <p style="color:var(--text-muted);max-width:600px;margin:0 auto 1rem;">
        Maamulka CARDOSO AI ayaa helay codsigaaga. Markii lacag-bixinta ama bisha bilaashka ah la xaqiijiyo, boggani toos ayuu kuugu furi doonaa 8-da lambar ee xidhiidhka WhatsApp!
      </p>
      <div class="pill pill-amber">🔄 Boggani si toos ah ayuu isku cusboonaysiinayaa 4 ilbiriqsi kasta</div>
    </section>

    <section id="inactiveBanner" class="glass-card" style="display:none;border-color:rgba(239,68,68,0.45);margin-bottom:1.5rem;padding:1.75rem;">
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:1rem;">
        <div>
          <h2 style="font-size:1.25rem;font-weight:800;color:#fca5a5;margin-bottom:0.35rem;" id="inactiveTitle">⏰ Rukhsaddaada Way Dhammaatay</h2>
          <p style="color:var(--text-muted);font-size:0.9rem;max-width:650px;">
            Ha werwerin — dhammaan contacts-kaagii (<strong id="inactiveContactsCount">0</strong> qof), fariimahaagii kaydsanaa, iyo xogtaadii oo dhan waa badqab! La xidhiidh maamulka si aad bishaada dib ugu shiddo (+1 Bil).
          </p>
        </div>
        <span class="pill pill-red" id="inactiveStateLabel">EXPIRED</span>
      </div>
    </section>

    <!-- Active Client Workspace -->
    <div id="activeWorkspace" style="display:none;">
      <!-- Row 1: Connect Card + Live Summary -->
      <div class="grid-2" style="margin-bottom:1.5rem;">
        <section class="glass-card">
          <div class="card-title">
            <span>📱 Ku Xidh WhatsApp-kaaga (1-Phone Connect)</span>
            <span class="pill pill-cyan" id="lockedPhoneBadge">🔒 Locked</span>
          </div>
          <div class="card-sub">
            Amni ahaan, akoonkan wuxuu u xidhan yahay lambarkii aad isku diiwaangelisay oo keliya. Isticmaal 8-da lambar (hal taleefan) ama QR code.
          </div>

          <div id="connectedBox" style="display:none;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.35);border-radius:12px;padding:1rem;">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.75rem;">
              <div>
                <div style="font-weight:800;color:#34d399;">✅ WhatsApp-kaagu Waa Xidhan Yahay!</div>
                <div style="font-size:0.84rem;color:var(--text-muted);margin-top:0.2rem;">
                  Lambarka: <strong id="connectedPhoneText">--</strong> | Contacts: <strong id="contactsTotalText">0</strong>
                </div>
              </div>
              <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
                <button class="btn btn-ghost btn-sm" onclick="syncContactsNow()">🔄 Sync Contacts</button>
                <button class="btn btn-danger btn-sm" onclick="unlinkWhatsApp()">🔌 Unlink / Ka Xidh</button>
              </div>
            </div>
          </div>

          <div id="connectControls">
            <div style="display:flex;gap:0.6rem;flex-wrap:wrap;">
              <button class="btn btn-primary" id="pairBtn" onclick="requestPairing()">🔑 Soo Saar 8-Lambar (Hal Taleefan)</button>
              <button class="btn btn-ghost" onclick="toggleQRBox()">📷 QR Code (Screen Labaad)</button>
            </div>

            <div id="pairingResultBox" class="pairing-code-box" style="display:none;">
              <div style="font-size:0.82rem;color:var(--text-muted);line-height:1.45;">
                Ku fur <strong>WhatsApp</strong> taleefanka <strong id="pairingPhoneNote" style="color:#22d3ee;">+252...</strong>:<br>
                <strong>Linked Devices ➔ Link a Device ➔ Link with phone number instead</strong>
              </div>
              <div class="pairing-digits" id="pairingDigitsDisplay">---- ----</div>
              <div style="font-size:0.75rem;color:#fbbf24;margin-bottom:0.5rem;">⏳ Geli 8-da xaraf sida ay u qoran yihiin (ha gelin xariiqda "-") 45 ilbiriqsi gudahood.</div>
              <button class="btn btn-ghost btn-sm" onclick="copyText(window.latestPairingRaw || '', 'Koodka waa la koobiyey')">📋 Copy Code</button>
            </div>

            <div id="qrBox" style="display:none;margin-top:1rem;text-align:center;">
              <div id="qrImgWrap" style="display:none;background:#fff;padding:10px;border-radius:12px;display:inline-block;">
                <img id="qrImage" alt="QR Code" width="210" height="210" />
              </div>
              <div id="qrWaiting" style="font-size:0.85rem;color:var(--text-muted);">⏳ QR-ka waa la soo diyaarinayaa... (Marka hore guji Soo Saar ama sug 3 ilbiriqsi)</div>
            </div>

            <div id="securityAlertBox" style="display:none;margin-top:0.9rem;padding:0.75rem;border-radius:10px;background:rgba(239,68,68,0.16);border:1px solid rgba(239,68,68,0.4);color:#fca5a5;font-size:0.84rem;"></div>
          </div>
        </section>

        <!-- Quick Status & Role Card -->
        <section class="glass-card">
          <div class="card-title">
            <span>🎭 Hab-Dhaqanka Bot-ka &amp; Xaaladda (Mode)</span>
            <span id="rolePillHeader"></span>
          </div>
          <div class="card-sub">U sheeg bot-ka sida uu dadka ula hadlayo iyo haddii aad maqan tahay.</div>

          <div class="${isPersonalInitial ? '' : 'grid-2'}" id="clientKpiGrid" style="margin-bottom:0.9rem;">
            <div class="kpi-box">
              <div class="kpi-label">Xidhiidhada (Contacts)</div>
              <div class="kpi-val" id="kpiContacts">0</div>
              <div class="kpi-foot" id="kpiNamedContacts">0 magac leh</div>
            </div>
            ${isPersonalInitial ? '' : `<div class="kpi-box" id="kpiLeadsCard">
              <div class="kpi-label">Fariimo &amp; Dalabaad (Leads)</div>
              <div class="kpi-val" id="kpiLeads">0</div>
              <div class="kpi-foot">Waxa bot-ku kuu qabtay</div>
            </div>`}
          </div>

          <div style="display:flex;justify-content:space-between;align-items:center;padding:0.85rem 1rem;border-radius:12px;background:rgba(12,18,33,0.9);border:1px solid var(--card-border);">
            <div>
              <div style="font-weight:700;font-size:0.92rem;">🌙 Away Mode (Mashquul / Maqan)</div>
              <div style="font-size:0.78rem;color:var(--text-muted);">Markuu shidan yahay, bot-ku wuxuu u jawaabaa sidii qofkii oo maqan una qabtaa fariin muhiim ah.</div>
            </div>
            <button id="awayToggleBtn" class="btn btn-ghost btn-sm" onclick="toggleAwayMode()">--</button>
          </div>
        </section>
      </div>

      <!-- Tabs Navigation -->
      <nav class="tabs-bar">
        <button class="tab-btn active" onclick="switchTab('brain', this)">🧠 Maskaxda &amp; Tijaabada</button>
        ${isPersonalInitial ? '' : `<button class="tab-btn" id="tabBtnLeads" onclick="switchTab('leads', this)">📥 Fariimaha &amp; Dalabaadka (<span id="leadsCountTab">0</span>)</button>`}
        <button class="tab-btn" onclick="switchTab('tools', this)">⚡ Auto-Reply, Status &amp; Fariin</button>
        ${isPersonalInitial ? '' : `<button class="tab-btn" id="tabBtnPlan" onclick="switchTab('plan', this)">🔑 Free API Key, Admins &amp; Usage</button>`}
      </nav>

      <!-- TAB 1: BRAIN & TEST CHAT -->
      <div id="tab-brain" class="tab-pane active">
        <div class="grid-2">
          <section class="glass-card">
            <div class="card-title">🧠 Tababarka &amp; Role-ka Bot-ka</div>
            <div class="card-sub">Dooro nooca shaqada bot-ka ama buuxi xogta meheraddaada.</div>

            <div class="grid-2">
              <div class="form-group">
                <label class="field-label">Qaybta (Category / Role)</label>
                <select class="field" id="cfgCategory">
                  <option value="personal">👤 Qof Caadi ah (Personal Assistant)</option>
                  <option value="business">🛍️ Ganacsato (Business &amp; Sales)</option>
                  <option value="education">🎓 Waxbarasho (Education &amp; Academy)</option>
                </select>
              </div>
              <div class="form-group">
                <label class="field-label">Magaca Bot-ka / Kaaliyaha</label>
                <input class="field" id="cfgBotName" placeholder="Tusaale: Kaaliyaha Axmed / Cardoso Shop Bot" />
              </div>
            </div>

            <div class="form-group">
              <label class="field-label">Magaca Meheradda / Mulkiilaha</label>
              <input class="field" id="cfgBusinessName" placeholder="Tusaale: Hargeysa Electronics / Cabdi Maxamed" />
            </div>

            <div class="form-group">
              <label class="field-label">Doorka &amp; Dabeecadda (System Role)</label>
              <textarea class="field" id="cfgSystemRole" style="min-height:85px;" placeholder="Sidee u hadlayaa bot-ku?"></textarea>
            </div>

            <div class="form-group">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.35rem;">
                <label class="field-label" style="margin:0;">Xogta Ganacsiga / Shakhsi / Koorsooyinka (Knowledge Base)</label>
                <button type="button" class="btn btn-ghost btn-sm" onclick="loadStarterTemplate()">💡 Soo Geli Tusaale Diyaarsan</button>
              </div>
              <textarea class="field" id="cfgKnowledgeBase" style="min-height:190px;" placeholder="Geli qiimaha alaabta, Zaad/eDahab, goobta, ama xogta lagugu heli karo..."></textarea>
            </div>

            <button class="btn btn-primary" onclick="saveClientBrain()" style="width:100%;">💾 Keydi Maskaxda &amp; Role-ka</button>

            <div style="margin-top:1.1rem;padding-top:1rem;border-top:1px solid var(--card-border);">
              <label class="field-label">🔑 Beddel / Sameyso PIN-ka Galitaanka (/portal)</label>
              <div style="display:flex;gap:0.5rem;">
                <input class="field" id="clientPinInput" name="client_portal_pin_new" type="password" autocomplete="new-password" data-lpignore="true" readonly onfocus="this.removeAttribute('readonly');" value="" placeholder="PIN cusub (4+ xaraf/lambar)" />
                <button type="button" class="btn btn-ghost btn-sm" onclick="saveClientPin()">🔒 Keydi PIN</button>
              </div>
            </div>
          </section>

          <section class="glass-card">
            <div class="card-title">💬 Tijaabi Bot-kaaga (Live Simulator)</div>
            <div class="card-sub">Eeg sida bot-ku ugu jawaabayo macmiilka ama saaxiibka intaadan dadka u furin.</div>

            <div id="chatLog" style="height:370px;overflow-y:auto;background:rgba(8,13,25,0.8);border:1px solid var(--card-border);border-radius:12px;padding:1rem;margin-bottom:0.85rem;display:flex;flex-direction:column;gap:0.7rem;">
              <div style="color:var(--text-muted);font-size:0.85rem;text-align:center;margin-top:2rem;">
                Soo qor fariin tijaabo ah (tusaale: "Asc", "Alaabta qiimaheedu waa imisa?", ama "Waan ku soo wacay ma i qabanaysaa?").
              </div>
            </div>

            <form onsubmit="sendTestChat(event)" style="display:flex;gap:0.6rem;">
              <input class="field" id="testChatInput" placeholder="Qor fariinta tijaabada..." />
              <button class="btn btn-emerald" type="submit">Dir ➔</button>
            </form>
          </section>
        </div>
      </div>

      ${isPersonalInitial ? '' : `<!-- TAB 2: LEADS / MISSED MESSAGES INBOX -->
      <div id="tab-leads" class="tab-pane">
        <section class="glass-card">
          <div class="card-title">
            <span>📥 Dalabaadka, Ardayda &amp; Fariimaha Lagaa Qabtay</span>
            <button class="btn btn-ghost btn-sm" onclick="loadLeads()">🔄 Refresh</button>
          </div>
          <div class="card-sub">Mar kasta oo qof dalab sameeyo, isdiiwaangelin rabo, ama fariin degdeg ah reebo, bot-ku halkan ayuu kuugu kaydiyaa.</div>

          <div class="table-wrap">
            <table class="saas-table">
              <thead>
                <tr>
                  <th>Magaca &amp; Lambarka</th>
                  <th>Nooca</th>
                  <th>Faahfaahinta</th>
                  <th>Xaaladda</th>
                  <th>Waqtiga</th>
                  <th>Tallaabo</th>
                </tr>
              </thead>
              <tbody id="leadsTableBody">
                <tr><td colspan="6" style="text-align:center;color:var(--text-muted);">Wali wax dalab ama fariin kaydsan lama hayo.</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>`}

      <!-- TAB 3: AUTO-REPLIES, STATUS & BROADCAST -->
      <div id="tab-tools" class="tab-pane">
        <div class="grid-2" style="margin-bottom:1.25rem;">
          <section class="glass-card">
            <div class="card-title">⚡ Auto-Replies (Jawaabo Degdeg ah oo Erey ku Xidhan)</div>
            <div class="card-sub">Haddii qofku soo qoro erey gaar ah (tusaale: "zaad" ama "goobta"), bot-ku wuxuu ku celinayaa jawaabtaada toos ah AI la'aan.</div>

            <div class="grid-2" style="margin-bottom:0.75rem;">
              <input class="field" id="arKeyword" placeholder="Ereyga (tusaale: zaad)" />
              <input class="field" id="arReply" placeholder="Jawaabta (tusaale: Zaad 063xxxxxxx)" />
            </div>
            <button class="btn btn-primary btn-sm" onclick="addAutoReply()">➕ Ku Dar Auto-Reply</button>

            <div id="autoRepliesList" style="margin-top:1rem;display:flex;flex-direction:column;gap:0.5rem;"></div>
          </section>

          <section class="glass-card">
            <div class="card-title">👁️ WhatsApp Status Reactor &amp; Posting</div>
            <div class="card-sub">Maamul daawashada, falcelinta &amp; dirista Status-yada WhatsApp.</div>

            <div style="display:flex;justify-content:space-between;align-items:center;padding:0.85rem;border-radius:12px;background:rgba(12,18,33,0.9);border:1px solid var(--card-border);margin-bottom:0.9rem;">
              <div>
                <div style="font-weight:700;font-size:0.9rem;">All-in-One Status Suite (Seen + React + Comment)</div>
                <div style="font-size:0.78rem;color:var(--text-muted);" id="srStateText">--</div>
              </div>
              <div style="display:flex;gap:0.4rem;">
                <button class="btn btn-emerald btn-sm" onclick="toggleMasterStatus(true)">Shid (ON)</button>
                <button class="btn btn-danger btn-sm" onclick="toggleMasterStatus(false)">Dami (OFF)</button>
              </div>
            </div>

            <div class="form-group">
              <label class="field-label">Soo Dhig Status Qoraal ah</label>
              <div style="display:flex;gap:0.5rem;">
                <input class="field" id="statusPostText" placeholder="Qoraalka aad status-ka soo dhigayso..." />
                <button class="btn btn-primary btn-sm" onclick="postClientStatus()">📤 Post</button>
              </div>
            </div>
          </section>
        </div>

        <section class="glass-card">
          <div class="card-title">📢 Smart Broadcast (U Dir Fariin Shakhsiyeed Dadkaaga)</div>
          <div class="card-sub">Bot-ku qof kasta magaciisa ayuu fariinta ku bilaabayaa ({name}), isagoo ilaalinaya badqabka lambarka.</div>
          <div class="form-group">
            <textarea class="field" id="broadcastText" style="min-height:85px;" placeholder="Tusaale: Salaan {name}, waxaan haynaa qiimo dhimis cusub usbuucan..."></textarea>
          </div>
          <div style="display:flex;gap:0.65rem;flex-wrap:wrap;">
            <button class="btn btn-primary" onclick="sendBroadcast()">🚀 Bilow Dirista (Ilaa 50 Qof)</button>
            <button class="btn btn-danger" onclick="abortBroadcast()">🛑 Jooji</button>
          </div>
        </section>
      </div>

      ${isPersonalInitial ? '' : `<!-- TAB 4: BYOK GEMINI KEY, EXTRA ADMINS & USAGE -->
      <div id="tab-plan" class="tab-pane">
        <div class="grid-2">
          <section class="glass-card">
            <div class="card-title">📊 Isticmaalka Maanta &amp; Xadka Qorshaha</div>
            <div class="card-sub">Tirada adeegyada maanta iyo xadka qorshahaaga (<strong id="planTierLabel">--</strong>).</div>

            <div style="display:flex;flex-direction:column;gap:0.9rem;" id="usageMetersBox"></div>
          </section>

          <section class="glass-card">
            <div class="card-title">🔑 Gemini Key Gaar ah (BYOK) &amp; 👥 Staff Admins</div>
            <div class="card-sub">Haddii aad ku darto Google Gemini API Key bilaash ah (aistudio.google.com), xadka AI-gaagu si weyn ayuu u kordhayaa!</div>

            <div class="form-group">
              <label class="field-label">Google Gemini API Key (Ikhtiyaari — Bilaash)</label>
              <input class="field" id="customGeminiKey" name="client_gemini_api_key" type="password" autocomplete="new-password" data-lpignore="true" readonly onfocus="this.removeAttribute('readonly');" value="" placeholder="AIzaSy... (ka tag banaan si aad pool-ka guud u isticmaasho)" />
            </div>

            <div class="form-group">
              <label class="field-label">Lambarada Maamulka Kale (Staff WhatsApp Admins — kala saar comma)</label>
              <input class="field" id="extraAdminsInput" placeholder="252634xxxxxx, 252634yyyyyy" />
            </div>

            <button class="btn btn-primary" onclick="savePlanSettings()">💾 Keydi Settings-ka</button>
          </section>
        </div>
      </div>`}
    </div>
  </main>

  <div id="toastBanner" class="toast-banner"></div>

  <script>
    ${COMMON_CLIENT_JS}
    const TENANT_ID = ${safeId};
    const CLIENT_TOKEN = ${safeToken};
    let latestState = null;
    window.latestPairingRaw = '';

    function apiUrl(path) {
      const sep = path.includes('?') ? '&' : '?';
      return '/api/client/' + encodeURIComponent(TENANT_ID) + path + sep + 'token=' + encodeURIComponent(CLIENT_TOKEN);
    }

    function switchTab(name, btn) {
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      const pane = document.getElementById('tab-' + name);
      if (pane) pane.classList.add('active');
      if (btn) btn.classList.add('active');
      if (name === 'leads') loadLeads();
      if (name === 'tools') { loadAutoReplies(); loadStatusReactor(); }
    }

    async function refreshStatus() {
      try {
        const res = await fetch(apiUrl('/status'));
        const data = await res.json();
        if (!res.ok || data.status !== 'ok') {
          showToast('❌ ' + (data.message || 'Access denied'), true);
          return;
        }
        latestState = data;
        renderState(data);
      } catch {}
    }

    function renderState(data) {
      const t = data.tenant;
      document.getElementById('headerBrand').innerHTML = escapeHtml(t.name) + ' <span>Portal</span>';
      document.getElementById('headerSub').textContent = 'ID: ' + t.id + ' • Lambar: +' + t.allowedPhone;
      document.getElementById('subStatusPill').outerHTML = statusBadge(t.status).replace('<span ', '<span id="subStatusPill" ');
      document.getElementById('daysLeftPill').textContent = '⏳ ' + formatDaysLeft(t.expiresAt);
      document.getElementById('lockedPhoneBadge').textContent = '🔒 +' + t.allowedPhone;
      document.getElementById('rolePillHeader').innerHTML = categoryBadge(t.category);

      const connPill = document.getElementById('waConnPill');
      if (data.whatsapp.connected) {
        connPill.className = 'pill pill-green';
        connPill.textContent = '● WhatsApp: Connected';
      } else {
        connPill.className = 'pill pill-amber';
        connPill.textContent = '○ WhatsApp: Offline';
      }

      if (t.status === 'pending') {
        document.getElementById('pendingBanner').style.display = 'block';
        document.getElementById('inactiveBanner').style.display = 'none';
        document.getElementById('activeWorkspace').style.display = 'none';
        return;
      }

      if (!data.isActive) {
        document.getElementById('pendingBanner').style.display = 'none';
        document.getElementById('inactiveBanner').style.display = 'block';
        document.getElementById('activeWorkspace').style.display = 'none';
        document.getElementById('inactiveContactsCount').textContent = String(data.contacts.total || 0);
        document.getElementById('inactiveStateLabel').textContent = t.status.toUpperCase();
        document.getElementById('inactiveTitle').textContent =
          t.status === 'suspended' ? '⛔ Akoonkaaga Hadda Waa La Hakiyay' : '⏰ Rukhsaddaada Bisha Way Dhammaatay';
        return;
      }

      document.getElementById('pendingBanner').style.display = 'none';
      document.getElementById('inactiveBanner').style.display = 'none';
      document.getElementById('activeWorkspace').style.display = 'block';

      // Connect widget
      if (data.whatsapp.connected) {
        document.getElementById('connectedBox').style.display = 'block';
        document.getElementById('connectControls').style.display = 'none';
        document.getElementById('connectedPhoneText').textContent = '+' + (data.whatsapp.botNumber || t.allowedPhone);
        document.getElementById('contactsTotalText').textContent = String(data.contacts.total || 0);
      } else {
        document.getElementById('connectedBox').style.display = 'none';
        document.getElementById('connectControls').style.display = 'block';
        document.getElementById('pairingPhoneNote').textContent = '+' + t.allowedPhone;
        if (data.whatsapp.currentPairingCode) {
          window.latestPairingRaw = String(data.whatsapp.currentPairingCode).replace(/[^A-Z0-9]/gi, '');
          document.getElementById('pairingResultBox').style.display = 'block';
          document.getElementById('pairingDigitsDisplay').textContent = data.whatsapp.currentPairingCode;
        } else {
          document.getElementById('pairingResultBox').style.display = 'none';
        }
        if (data.whatsapp.currentQR) {
          document.getElementById('qrImage').src = 'https://api.qrserver.com/v1/create-qr-code/?size=210x210&data=' + encodeURIComponent(data.whatsapp.currentQR);
          document.getElementById('qrImgWrap').style.display = 'inline-block';
          document.getElementById('qrWaiting').style.display = 'none';
        }
        if (data.whatsapp.securityBlockReason) {
          const al = document.getElementById('securityAlertBox');
          al.style.display = 'block';
          al.textContent = '⛔ ' + data.whatsapp.securityBlockReason;
        }
      }

      // KPIs & Away mode
      document.getElementById('kpiContacts').textContent = String(data.contacts.total || 0);
      document.getElementById('kpiNamedContacts').textContent = (data.contacts.withNames || 0) + ' magac leh';
      const kpiLeadsEl = document.getElementById('kpiLeads');
      if (kpiLeadsEl) kpiLeadsEl.textContent = String(data.leadsCount || 0);
      const leadsCountTabEl = document.getElementById('leadsCountTab');
      if (leadsCountTabEl) leadsCountTabEl.textContent = String(data.leadsCount || 0);

      const isPers = t.category === 'personal';
      const btnLeads = document.getElementById('tabBtnLeads');
      const btnPlan = document.getElementById('tabBtnPlan');
      const kpiLeadsCard = document.getElementById('kpiLeadsCard');
      const kpiGrid = document.getElementById('clientKpiGrid');
      if (btnLeads) btnLeads.style.display = isPers ? 'none' : '';
      if (btnPlan) btnPlan.style.display = isPers ? 'none' : '';
      if (kpiLeadsCard) kpiLeadsCard.style.display = isPers ? 'none' : '';
      if (kpiGrid) kpiGrid.className = isPers ? '' : 'grid-2';

      const awayBtn = document.getElementById('awayToggleBtn');
      if (t.awayMode) {
        awayBtn.className = 'btn btn-emerald btn-sm';
        awayBtn.textContent = '🌙 ON (Maqan)';
      } else {
        awayBtn.className = 'btn btn-ghost btn-sm';
        awayBtn.textContent = '☀️ OFF (Jooga)';
      }

      renderUsageMeters(t, data.usage);
    }

    function renderUsageMeters(tenant, usage) {
      const tierEl = document.getElementById('planTierLabel');
      const meterBox = document.getElementById('usageMetersBox');
      if (!tierEl || !meterBox) return;
      tierEl.textContent = tenant.planTier.toUpperCase();
      const f = tenant.effectiveFeatures;
      const items = [
        { label: '🤖 Jawaabaha AI (Maanta)', used: usage.aiCalls || 0, max: f.maxDailyAiCalls },
        { label: '🎙️ Codka (Voice Notes)', used: usage.voiceCalls || 0, max: f.maxDailyVoice },
        { label: '🖼️ Sawir-Samaynta AI', used: usage.imageCalls || 0, max: f.maxDailyImages },
        { label: '📢 Fariin-Wadareed (Broadcast)', used: usage.broadcastCalls || 0, max: f.maxDailyBroadcast },
      ];
      meterBox.innerHTML = items.map(it => {
        const pct = Math.min(100, Math.round((it.used / Math.max(1, it.max)) * 100));
        return '<div>' +
          '<div style="display:flex;justify-content:space-between;font-size:0.84rem;font-weight:600;">' +
            '<span>' + it.label + '</span>' +
            '<span>' + it.used + ' / ' + it.max + '</span>' +
          '</div>' +
          '<div class="progress-track"><div class="progress-fill" style="width:' + pct + '%;"></div></div>' +
        '</div>';
      }).join('');
    }

    async function loadInitialConfig() {
      const res = await fetch(apiUrl('/config'));
      const data = await res.json();
      if (data.status === 'ok') {
        document.getElementById('cfgBotName').value = data.config.botName || '';
        document.getElementById('cfgBusinessName').value = data.config.businessName || '';
        document.getElementById('cfgSystemRole').value = data.config.systemRole || '';
        document.getElementById('cfgKnowledgeBase').value = data.config.knowledgeBase || '';
        if (data.tenant) {
          document.getElementById('cfgCategory').value = data.tenant.category || 'personal';
          const keyEl = document.getElementById('customGeminiKey');
          if (keyEl) {
            keyEl.placeholder = data.tenant.hasCustomGeminiKey
              ? '•••••••••• (Key waa kaydsan yahay — geli mid cusub haddii aad beddelayso)'
              : 'AIzaSy... (ka tag banaan si aad pool-ka guud u isticmaasho)';
          }
          const extraEl = document.getElementById('extraAdminsInput');
          if (extraEl) extraEl.value = (data.tenant.extraAdmins || []).join(', ');
        }
      }
    }

    async function requestPairing() {
      const btn = document.getElementById('pairBtn');
      btn.disabled = true;
      btn.textContent = '⏳ Koodka waa la soo saarayaa...';
      try {
        const res = await fetch(apiUrl('/pair'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const data = await res.json();
        if (data.status === 'ok' && data.formattedCode) {
          window.latestPairingRaw = data.code || String(data.formattedCode).replace(/[^A-Z0-9]/gi, '');
          document.getElementById('pairingResultBox').style.display = 'block';
          document.getElementById('pairingDigitsDisplay').textContent = data.formattedCode;
          if (data.phone) document.getElementById('pairingPhoneNote').textContent = '+' + data.phone;
          showToast('🔑 Pairing code waa diyaar!');
        } else {
          showToast('❌ ' + (data.message || 'Lama soo saari karin'), true);
        }
      } finally {
        btn.disabled = false;
        btn.textContent = '🔑 Soo Saar 8-Lambar (Hal Taleefan)';
      }
    }

    function toggleQRBox() {
      const box = document.getElementById('qrBox');
      box.style.display = box.style.display === 'none' ? 'block' : 'none';
    }

    async function syncContactsNow() {
      const res = await fetch(apiUrl('/sync-contacts'), { method: 'POST' });
      const data = await res.json();
      showToast(data.synced ? '✅ Contacts-ka waa la sync gareeyay (' + data.total + ')' : 'ℹ️ Sync wuxuu sugayaa WhatsApp');
      refreshStatus();
    }

    async function unlinkWhatsApp() {
      if (!confirm('Ma hubtaa inaad WhatsApp-ka ka furto akoonkan?')) return;
      await fetch(apiUrl('/unlink'), { method: 'POST' });
      showToast('🔌 Session-ka waa la furay');
      refreshStatus();
    }

    async function toggleAwayMode() {
      const next = !(latestState?.tenant?.awayMode);
      const res = await fetch(apiUrl('/settings'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ awayMode: next }),
      });
      if (res.ok) {
        showToast(next ? '🌙 Away Mode waa la SHIDAY' : '☀️ Away Mode waa la DAMIYAY');
        refreshStatus();
      }
    }

    async function loadStarterTemplate() {
      const cat = document.getElementById('cfgCategory').value;
      const biz = document.getElementById('cfgBusinessName').value.trim();
      const res = await fetch('/api/public/template?category=' + encodeURIComponent(cat) + '&name=' + encodeURIComponent(biz));
      const data = await res.json();
      if (data.status === 'ok') {
        document.getElementById('cfgBotName').value = data.template.botName;
        document.getElementById('cfgSystemRole').value = data.template.systemRole;
        document.getElementById('cfgKnowledgeBase').value = data.template.knowledgeBase;
        showToast('💡 Tusaale diyaarsan waa la soo geliyay — wax ka beddel kadibna Keydi!');
      }
    }

    async function saveClientBrain() {
      const nextCat = document.getElementById('cfgCategory').value;
      const prevWasPersonal = latestState?.tenant?.category === 'personal';
      const nextIsPersonal = nextCat === 'personal';
      const res = await fetch(apiUrl('/config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: nextCat,
          botName: document.getElementById('cfgBotName').value,
          businessName: document.getElementById('cfgBusinessName').value,
          systemRole: document.getElementById('cfgSystemRole').value,
          knowledgeBase: document.getElementById('cfgKnowledgeBase').value,
        }),
      });
      const data = await res.json();
      showToast(res.ok ? '✅ ' + data.message : '❌ ' + data.message, !res.ok);
      if (res.ok && prevWasPersonal !== nextIsPersonal) {
        setTimeout(() => window.location.reload(), 650);
      } else {
        refreshStatus();
      }
    }

    async function saveClientPin() {
      const inp = document.getElementById('clientPinInput');
      const pin = inp ? inp.value.trim() : '';
      if (pin.length < 4) { showToast('❌ PIN-ku waa inuu noqdaa 4+ xaraf ama lambar', true); return; }
      const res = await fetch(apiUrl('/settings'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      if (res.ok) {
        inp.value = '';
        showToast('🔑 PIN-ka Dashboard-kaaga waa la keydiyay!');
      } else {
        showToast('❌ ' + (data.message || 'Khalad'), true);
      }
    }

    async function sendTestChat(e) {
      e.preventDefault();
      const input = document.getElementById('testChatInput');
      const msg = input.value.trim();
      if (!msg) return;
      input.value = '';
      const log = document.getElementById('chatLog');
      log.innerHTML += '<div style="align-self:flex-end;background:rgba(6,182,212,0.2);padding:0.6rem 0.9rem;border-radius:12px;max-width:80%;font-size:0.88rem;">' + escapeHtml(msg) + '</div>';
      log.scrollTop = log.scrollHeight;

      const res = await fetch(apiUrl('/test-chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();
      const reply = data.reply || data.message || 'Cilad ayaa dhacday';
      log.innerHTML += '<div style="align-self:flex-start;background:rgba(30,41,59,0.9);border:1px solid var(--card-border);padding:0.65rem 0.95rem;border-radius:12px;max-width:85%;font-size:0.88rem;white-space:pre-wrap;">' + escapeHtml(reply) + '</div>';
      log.scrollTop = log.scrollHeight;
    }

    async function loadLeads() {
      const res = await fetch(apiUrl('/leads'));
      const data = await res.json();
      const tbody = document.getElementById('leadsTableBody');
      const leads = data.leads || [];
      if (leads.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);">Wali wax dalab ama fariin kaydsan lama hayo.</td></tr>';
        return;
      }
      tbody.innerHTML = leads.map(l => {
        const dt = new Date(l.createdAt).toLocaleString();
        const badge = (l.status === 'closed' || l.status === 'resolved') ? '<span class="pill pill-green">Resolved</span>'
          : l.status === 'contacted' ? '<span class="pill pill-cyan">Contacted</span>'
          : '<span class="pill pill-amber">New</span>';
        return '<tr>' +
          '<td><strong>' + escapeHtml(l.senderName || 'Macmiil') + '</strong><br><span style="color:var(--text-muted);font-size:0.78rem;">' + escapeHtml(l.senderPhone) + '</span></td>' +
          '<td><span class="pill pill-violet">' + escapeHtml(l.category) + '</span></td>' +
          '<td style="max-width:340px;">' + escapeHtml(l.summary) + '</td>' +
          '<td>' + badge + '</td>' +
          '<td style="font-size:0.78rem;color:var(--text-muted);">' + escapeHtml(dt) + '</td>' +
          '<td>' +
            '<select class="field" style="padding:0.3rem 0.5rem;font-size:0.78rem;" onchange="updateLeadStatus(' + l.id + ', this.value)">' +
              '<option value="new" ' + (l.status === 'new' ? 'selected' : '') + '>New</option>' +
              '<option value="contacted" ' + (l.status === 'contacted' ? 'selected' : '') + '>Contacted</option>' +
              '<option value="closed" ' + (l.status === 'closed' ? 'selected' : '') + '>Closed</option>' +
            '</select>' +
          '</td>' +
        '</tr>';
      }).join('');
    }

    async function updateLeadStatus(leadId, status) {
      const res = await fetch(apiUrl('/leads/' + leadId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) showToast('✅ Xaaladda waa la cusboonaysiiyay');
    }

    async function loadAutoReplies() {
      const res = await fetch(apiUrl('/auto-replies'));
      const data = await res.json();
      const box = document.getElementById('autoRepliesList');
      const list = data.autoReplies || [];
      if (list.length === 0) {
        box.innerHTML = '<div style="font-size:0.82rem;color:var(--text-muted);">Wali ma jiro auto-reply kaydsan.</div>';
        return;
      }
      box.innerHTML = list.map(r =>
        '<div style="display:flex;justify-content:space-between;align-items:center;padding:0.6rem 0.85rem;border-radius:10px;background:rgba(10,16,30,0.85);border:1px solid var(--card-border);">' +
          '<div><strong>' + escapeHtml(r.keyword) + '</strong> ➔ <span style="color:var(--text-muted);">' + escapeHtml(r.replyText) + '</span></div>' +
          '<button class="btn btn-danger btn-sm" onclick="deleteAutoReply(\\'' + encodeURIComponent(r.keyword) + '\\')">✕</button>' +
        '</div>'
      ).join('');
    }

    async function addAutoReply() {
      const keyword = document.getElementById('arKeyword').value.trim();
      const replyText = document.getElementById('arReply').value.trim();
      if (!keyword || !replyText) return;
      const res = await fetch(apiUrl('/auto-replies'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword, replyText }),
      });
      if (res.ok) {
        document.getElementById('arKeyword').value = '';
        document.getElementById('arReply').value = '';
        showToast('✅ Auto-reply waa la keydiyay');
        loadAutoReplies();
      }
    }

    async function deleteAutoReply(encodedKeyword) {
      await fetch(apiUrl('/auto-replies/' + encodedKeyword), { method: 'DELETE' });
      loadAutoReplies();
    }

    async function loadStatusReactor() {
      const res = await fetch(apiUrl('/status/reactor'));
      const data = await res.json();
      if (data.status === 'ok') {
        const cfg = data.config;
        document.getElementById('srStateText').textContent =
          'Auto-View: ' + (data.autoView ? 'ON' : 'OFF') + ' | React: ' + (cfg.autoReact ? 'ON' : 'OFF') + ' | Comment: ' + (cfg.autoComment ? 'ON' : 'OFF');
      }
    }

    async function toggleMasterStatus(enabled) {
      const res = await fetch(apiUrl('/status/master-view'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = await res.json();
      showToast(res.ok ? '✅ ' + data.message : '❌ ' + data.message, !res.ok);
      loadStatusReactor();
    }

    async function postClientStatus() {
      const text = document.getElementById('statusPostText').value.trim();
      if (!text) return;
      const res = await fetch(apiUrl('/status/post'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      showToast(data.success ? '✅ Status waa la soo dhigay!' : '❌ ' + (data.message || 'Lama diri karin'), !data.success);
      if (data.success) document.getElementById('statusPostText').value = '';
    }

    async function sendBroadcast() {
      const text = document.getElementById('broadcastText').value.trim();
      if (!text) return;
      const res = await fetch(apiUrl('/broadcast'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      showToast(res.ok ? '📢 ' + data.message : '❌ ' + data.message, !res.ok);
    }

    async function abortBroadcast() {
      const res = await fetch(apiUrl('/broadcast/abort'), { method: 'POST' });
      const data = await res.json();
      showToast(data.message || 'Stopped');
    }

    async function savePlanSettings() {
      const payload = {
        extraAdmins: document.getElementById('extraAdminsInput').value.split(',').map(s => s.trim()).filter(Boolean),
      };
      const keyVal = document.getElementById('customGeminiKey').value.trim();
      if (keyVal) payload.customGeminiKey = keyVal;

      const res = await fetch(apiUrl('/settings'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      showToast(res.ok ? '✅ Settings waa la keydiyay!' : '❌ ' + data.message, !res.ok);
      if (res.ok) {
        document.getElementById('customGeminiKey').value = '';
        refreshStatus();
      }
    }

    loadInitialConfig();
    refreshStatus();
    setInterval(refreshStatus, 4000);
  </script>
</body>
</html>`;
}
