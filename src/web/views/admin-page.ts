import { COMMON_CLIENT_JS, PWA_HEAD_TAGS, SAAS_STYLES } from './styles.js';

export function renderAdminDashboardHTML(adminLabel: string = 'Owner Admin'): string {
  return `<!DOCTYPE html>
<html lang="so">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CARDOSO AI — Super Admin SaaS Control Center</title>
  ${PWA_HEAD_TAGS}
  <style>${SAAS_STYLES}</style>
</head>
<body>
  <header class="topbar">
    <div class="brand">
      <div class="brand-mark">🚀</div>
      <div>
        <h1>CARDOSO <span>AI</span> Admin Studio</h1>
        <p>Maamulka Guud ee Macmiisha, Rukhsadaha, Admins-ka &amp; Bot-kaaga</p>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:0.65rem;flex-wrap:wrap;">
      <span class="pill pill-violet">👑 ${escapeAdminHtml(adminLabel)}</span>
      <a href="/app" class="btn btn-primary btn-sm">📱 Fur App-ka (/app)</a>
      <a href="/views" target="_blank" class="btn btn-emerald btn-sm">📈 Views Hub (/views)</a>
      <button type="button" class="btn btn-ghost btn-sm" data-pwa-install-btn onclick="triggerCardosoInstall()">📲 Install App</button>
      <a href="/join" target="_blank" class="btn btn-ghost btn-sm">🔗 Bogga Isdiiwaangelinta (/join)</a>
      <span class="pill pill-amber" id="ownerWaBadge">Owner WhatsApp: --</span>
      <button onclick="logoutAdmin()" class="btn btn-ghost btn-sm" style="color:#f87171;">🚪 Ka Bax</button>
    </div>
  </header>

  <main class="container">
    <!-- Top KPI Metrics -->
    <section class="grid-4" style="margin-bottom:1.4rem;">
      <div class="kpi-box">
        <div class="kpi-label">Macmiisha Firfircoon</div>
        <div class="kpi-val" id="kpiActiveCount">0</div>
        <div class="kpi-foot" id="kpiTotalCount">0 wadarta diiwaangashan</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Codsiyada Sugaya (Pending)</div>
        <div class="kpi-val" id="kpiPendingCount" style="color:#fbbf24;">0</div>
        <div class="kpi-foot">Ka yimid bogga /join</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Dhammaadka Dhow (&le; 3 maalmood)</div>
        <div class="kpi-val" id="kpiExpiringCount" style="color:#f87171;">0</div>
        <div class="kpi-foot" id="kpiExpiredCount">0 bishoodii dhammaatay</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Owner Contacts &amp; Admin Staff</div>
        <div class="kpi-val" id="kpiOwnerContacts">0</div>
        <div class="kpi-foot" id="kpiAdminUsersCount">0 Admin oo dheeri ah</div>
      </div>
    </section>

    <!-- Main Navigation Tabs -->
    <nav class="tabs-bar">
      <button class="tab-btn active" onclick="switchAdminTab('subscribers', this)">📋 Macmiisha &amp; Codsiyada (<span id="tabPendingBadge">0</span>)</button>
      <button class="tab-btn" onclick="switchAdminTab('create', this)">➕ Diiwaangeli Macmiil Cusub</button>
      <button class="tab-btn" onclick="switchAdminTab('admins', this)">👥 Admins &amp; 🎟️ Promo Codes</button>
      <button class="tab-btn" onclick="switchAdminTab('owner', this)">🤖 Bot-kaaga (Owner Studio)</button>
      <button class="tab-btn" onclick="switchAdminTab('views', this)">📈 Views &amp; .vcf Hub</button>
      <button class="tab-btn" onclick="switchAdminTab('voice', this)">🎙️ Voice Note to Groups</button>
    </nav>

    <!-- TAB 1: SUBSCRIBERS & PENDING REQUESTS -->
    <div id="admin-tab-subscribers" class="tab-pane active">
      <!-- Pending Requests Box -->
      <section id="pendingRequestsCard" class="glass-card" style="display:none;border-color:rgba(245,158,11,0.5);margin-bottom:1.25rem;">
        <div class="card-title">
          <span>🔔 Codsiyo Cusub oo Sugaya Ogolaansho</span>
          <span class="pill pill-amber">Fadlan Hubi Lacagta / Trial-ka</span>
        </div>
        <div class="card-sub">Markaad gujiso "Approve &amp; Start", macmiilku isla markiiba wuu furmi karaa boggiisa si uu WhatsApp-ka ugu xidho.</div>
        <div id="pendingListBox" style="display:flex;flex-direction:column;gap:0.75rem;"></div>
      </section>

      <!-- All Subscribers Directory -->
      <section class="glass-card">
        <div class="card-title">
          <span>👥 Liiska Dhammaan Macmiisha (Subscribers)</span>
          <button class="btn btn-ghost btn-sm" onclick="loadAdminOverview()">🔄 Refresh</button>
        </div>
        <div class="card-sub">Maamul rukhsadda, koobi link-ga macmiilka, kordhi bisha (+1 Bil), ama beddel xadka adeegyada.</div>

        <div class="table-wrap">
          <table class="saas-table">
            <thead>
              <tr>
                <th>Macmiilka &amp; Lambarka</th>
                <th>Nooca</th>
                <th>Qorshaha &amp; Key</th>
                <th>Xaaladda</th>
                <th>Muddada Hadhay</th>
                <th>WhatsApp &amp; Contacts</th>
                <th>Tallaabooyinka</th>
              </tr>
            </thead>
            <tbody id="subscribersTableBody">
              <tr><td colspan="7" style="text-align:center;color:var(--text-muted);">Waa la soo rarayaa...</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <!-- TAB 2: DIRECT ADMIN CLIENT CREATION -->
    <div id="admin-tab-create" class="tab-pane">
      <section class="glass-card" style="max-width:780px;">
        <div class="card-title">➕ Diiwaangeli Macmiil Cusub (Toos u Furan)</div>
        <div class="card-sub">Abuur akoon diyaar u ah inuu isla markiiba WhatsApp ku xidhmo — kadibna u dir link-giisa gaarka ah.</div>

        <form onsubmit="createSubscriberDirect(event)">
          <div class="grid-2">
            <div class="form-group">
              <label class="field-label">Magaca Macmiilka / Ganacsiga</label>
              <input class="field" id="newSubName" required placeholder="Tusaale: Hargeysa Fashion / Cali" />
            </div>
            <div class="form-group">
              <label class="field-label">Lambarka WhatsApp (uu ku xidhayo bot-ka)</label>
              <input class="field" id="newSubPhone" required placeholder="252634xxxxxx" />
            </div>
          </div>

          <div class="grid-3">
            <div class="form-group">
              <label class="field-label">Qaybta (Category / Role)</label>
              <select class="field" id="newSubCategory">
                <option value="personal">👤 Qof Caadi ah (Personal)</option>
                <option value="business">🛍️ Ganacsato (Business)</option>
                <option value="education">🎓 Waxbarasho (Education)</option>
              </select>
            </div>
            <div class="form-group">
              <label class="field-label">Qorshaha (Plan Tier)</label>
              <select class="field" id="newSubPlan">
                <option value="trial_free">🎁 Bisha 1aad Bilaash (Trial 30d)</option>
                <option value="starter">👤 Starter Monthly</option>
                <option value="business">🛍️ Business Pro Monthly</option>
                <option value="education">🎓 Education Pro Monthly</option>
              </select>
            </div>
            <div class="form-group">
              <label class="field-label">Muddada (Bilood)</label>
              <input class="field" id="newSubMonths" type="number" min="1" max="24" value="1" />
            </div>
          </div>

          <div class="form-group">
            <label class="field-label">Custom Gemini Key (Ikhtiyaari)</label>
            <input class="field" id="newSubKey" placeholder="Ka tag banaan haddii aad pool-ka guud siinayso" />
          </div>

          <button class="btn btn-primary" type="submit">🚀 Abuur Akoonka &amp; Soo Saar Link-ga</button>
        </form>

        <div id="directCreateResult" style="display:none;margin-top:1.25rem;padding:1rem;border-radius:12px;background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.4);">
          <div style="font-weight:700;color:#34d399;margin-bottom:0.35rem;">✅ Macmiilka Cusub Waa La Diyaariyay!</div>
          <div style="font-size:0.86rem;color:var(--text-muted);margin-bottom:0.4rem;">
            🔒 <strong>Kalsoonida &amp; Qarsoodiga Macmiilka:</strong> Xogta wada-hadallada qofkan waa mid u gaar ah oo la dhowray. Macmiilku wuxuu si madaxbannaan uga geli karaa <code>/portal</code> lambarkiisa WhatsApp iyo PIN-kiisa.
          </div>
        </div>
      </section>
    </div>

    <!-- TAB 3: MULTI-ADMIN & PROMO CODES -->
    <div id="admin-tab-admins" class="tab-pane">
      <div class="grid-2">
        <section class="glass-card">
          <div class="card-title">👥 Ku Dar Admin Kale (Staff / Partner Admins)</div>
          <div class="card-sub">Admins-ka aad ku darto halkan way soo gali karaan Dashboard-kan iyagoo adeegsanaya username/password-kooda, waxayna heli karaan ogeysiisyada codsiyada cusub!</div>

          <form onsubmit="createAdminUser(event)" style="margin-bottom:1.25rem;">
            <div class="grid-2">
              <div class="form-group">
                <label class="field-label">Username</label>
                <input class="field" id="admUsername" required placeholder="tusaale: axmed_admin" />
              </div>
              <div class="form-group">
                <label class="field-label">Password</label>
                <input class="field" id="admPassword" type="password" required placeholder="Ugu yaraan 4 xaraf" />
              </div>
            </div>
            <div class="grid-2">
              <div class="form-group">
                <label class="field-label">Magaca Muuqda (Display Name)</label>
                <input class="field" id="admDisplay" required placeholder="Axmed Faarax" />
              </div>
              <div class="form-group">
                <label class="field-label">Lambarka WhatsApp (Ogeysiisyada / Admin)</label>
                <input class="field" id="admPhone" placeholder="252634xxxxxx" />
              </div>
            </div>
            <div class="form-group">
              <label class="field-label">Doorka (Role)</label>
              <select class="field" id="admRole">
                <option value="staff_admin">🛡️ Staff Admin</option>
                <option value="super_admin">👑 Super Admin</option>
              </select>
            </div>
            <button class="btn btn-primary btn-sm" type="submit">➕ Ku Dar Admin Cusub</button>
          </form>

          <div id="adminUsersList" style="display:flex;flex-direction:column;gap:0.55rem;"></div>
        </section>

        <section class="glass-card">
          <div class="card-title">🎟️ Promo Codes (Ikhtiyaari — Furid Degdeg ah)</div>
          <div class="card-sub">Samee Promo Code marka aad rabto in dad kooban ay si toos ah ugu furmaan bil bilaash ah iyadoon sugayn Approve.</div>

          <form onsubmit="createPromoCode(event)" style="margin-bottom:1.25rem;">
            <div class="grid-2">
              <div class="form-group">
                <label class="field-label">Code-ka</label>
                <input class="field" id="promoCodeInput" required placeholder="Tusaale: RAMADAN30" />
              </div>
              <div class="form-group">
                <label class="field-label">Qorshaha</label>
                <select class="field" id="promoPlanTier">
                  <option value="trial_free">Free Trial</option>
                  <option value="starter">Starter</option>
                  <option value="business">Business</option>
                  <option value="education">Education</option>
                </select>
              </div>
            </div>
            <div class="grid-2">
              <div class="form-group">
                <label class="field-label">Maalmaha (Days)</label>
                <input class="field" id="promoDays" type="number" min="1" value="30" />
              </div>
              <div class="form-group">
                <label class="field-label">Tirada Ugu Badan (Max Uses)</label>
                <input class="field" id="promoMaxUses" type="number" min="1" value="10" />
              </div>
            </div>
            <button class="btn btn-emerald btn-sm" type="submit">🎟️ Samee Promo Code</button>
          </form>

          <div id="promoCodesList" style="display:flex;flex-direction:column;gap:0.55rem;"></div>
        </section>
      </div>
    </div>

    <!-- TAB 4: OWNER BOT STUDIO (ALL ORIGINAL TOOLS PRESERVED) -->
    <div id="admin-tab-owner" class="tab-pane">
      <div class="grid-2" style="margin-bottom:1.25rem;">
        <section class="glass-card">
          <div class="card-title">
            <span>📱 Owner WhatsApp Connection</span>
            <span class="pill pill-muted" id="ownerConnPill">Hubin...</span>
          </div>
          <div class="card-sub">Maamul lambarkaaga weyn ee bot-ka (Owner Session).</div>

          <div id="ownerConnectedPanel" style="display:none;">
            <p style="font-size:0.88rem;color:#34d399;margin-bottom:0.75rem;">
              ✅ WhatsApp-kaaga wuu xidhan yahay (<strong id="ownerNumText">--</strong>) • Contacts: <strong id="ownerContactsSpan">0</strong>
            </p>
            <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
              <button class="btn btn-ghost btn-sm" onclick="syncOwnerContacts()">🔄 Sync Contacts</button>
              <button class="btn btn-danger btn-sm" onclick="unlinkOwner()">🔌 Unlink Session</button>
            </div>
          </div>

          <div id="ownerConnectPanel">
            <div class="form-group">
              <label class="field-label">Lambarkaaga WhatsApp ee Pairing Code (Hal Taleefan)</label>
              <div style="display:flex;gap:0.5rem;">
                <input class="field" id="ownerPairPhone" placeholder="252634xxxxxx" />
                <button class="btn btn-primary btn-sm" onclick="requestOwnerPairing(this)">🔑 Pairing Code</button>
              </div>
            </div>
            <div id="ownerPairBox" class="pairing-code-box" style="display:none;">
              <div style="font-size:0.8rem;color:var(--text-muted);">
                Ku fur WhatsApp (<strong id="ownerPairPhoneNote" style="color:#22d3ee;">+252...</strong>): <strong>Linked Devices ➔ Link with phone number instead</strong>
              </div>
              <div class="pairing-digits" id="ownerPairDigits">---- ----</div>
              <button class="btn btn-ghost btn-sm" onclick="copyText(window.ownerPairingRaw || '', 'Koodka waa la koobiyey')">📋 Copy Code</button>
            </div>
            <div id="ownerQrBox" style="display:none;text-align:center;margin-top:0.85rem;">
              <div style="background:#fff;padding:8px;border-radius:10px;display:inline-block;">
                <img id="ownerQrImage" width="180" height="180" alt="Owner QR" />
              </div>
            </div>
          </div>
        </section>

        <section class="glass-card">
          <div class="card-title">👁️ Owner Status Reactor &amp; Broadcast</div>
          <div class="card-sub">Shid ama dami Status AI Reactor, soo dhig Status, ama dir fariin-wadareed.</div>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.9rem;">
            <button class="btn btn-emerald btn-sm" onclick="ownerMasterStatus(true)">✅ View/React/Comment ON</button>
            <button class="btn btn-danger btn-sm" onclick="ownerMasterStatus(false)">🛑 ALL OFF</button>
          </div>
          <div style="display:flex;gap:0.5rem;margin-bottom:0.75rem;">
            <input class="field" id="ownerStatusText" placeholder="Soo dhig Status cusub..." />
            <button class="btn btn-primary btn-sm" onclick="ownerPostStatus()">📤 Status</button>
          </div>
          <div style="display:flex;gap:0.5rem;margin-bottom:0.75rem;flex-wrap:wrap;">
            <input class="field" id="ownerPodcastStatusTopic" style="flex:1;min-width:170px;" placeholder="🎙️ Voice Podcast Status (faaruq = Promo Safa & Mohamed)..." />
            <button class="btn btn-emerald btn-sm" id="btnOwnerVoiceStatus" onclick="ownerPostPodcastStatus('voice')">🎙️ Voice Status</button>
            <button class="btn btn-ghost btn-sm" id="btnOwnerVideoStatus" onclick="ownerPostPodcastStatus('video')">🎬 Video Status</button>
          </div>
          <div style="display:flex;gap:0.5rem;">
            <input class="field" id="ownerBroadcastText" placeholder="Fariin-wadareed (50 qof oo cusub)..." />
            <button class="btn btn-ghost btn-sm" onclick="ownerBroadcast()">📢 Dir</button>
          </div>
        </section>
      </div>

      <div class="grid-2">
        <section class="glass-card">
          <div class="card-title">🧠 Tababarka Owner Bot-ka</div>
          <div class="grid-2">
            <div class="form-group">
              <label class="field-label">Magaca Bot-ka</label>
              <input class="field" id="ownBotName" />
            </div>
            <div class="form-group">
              <label class="field-label">Magaca / Meheradda</label>
              <input class="field" id="ownBizName" />
            </div>
          </div>
          <div class="form-group">
            <label class="field-label">Doorka (System Role)</label>
            <textarea class="field" id="ownRole" style="min-height:80px;"></textarea>
          </div>
          <div class="form-group">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:0.4rem;flex-wrap:wrap;margin-bottom:0.35rem;">
              <label class="field-label" style="margin:0;">Knowledge Base</label>
              <div>
                <input type="file" id="ownerKbFile" accept=".csv,.tsv,.txt,.json,.md,text/csv,text/plain,application/json" style="display:none;" onchange="importCatalogFile(this, 'ownKB', true)" />
                <button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('ownerKbFile').click()">📥 Import Xog (CSV/TXT/JSON)</button>
              </div>
            </div>
            <textarea class="field" id="ownKB" style="min-height:150px;"></textarea>
          </div>
          <button class="btn btn-primary" onclick="saveOwnerConfig()">💾 Keydi Owner Config</button>
        </section>

        <section class="glass-card">
          <div class="card-title">💬 Tijaabi Owner Bot-ka &amp; 📥 Leads</div>
          <div id="ownChatLog" style="height:240px;overflow-y:auto;background:rgba(8,13,25,0.8);border:1px solid var(--card-border);border-radius:10px;padding:0.85rem;margin-bottom:0.75rem;display:flex;flex-direction:column;gap:0.55rem;"></div>
          <form onsubmit="sendOwnerTestChat(event)" style="display:flex;gap:0.5rem;margin-bottom:1rem;">
            <input class="field" id="ownTestInput" placeholder="Tijaabi Owner Bot..." />
            <button class="btn btn-emerald btn-sm" type="submit">Dir</button>
          </form>
          <div style="font-size:0.82rem;font-weight:700;margin-bottom:0.4rem;">📥 Leads-kii Ugu Dambeeyay (Owner):</div>
          <div id="ownerLeadsBox" style="max-height:130px;overflow-y:auto;font-size:0.8rem;color:var(--text-muted);">--</div>
        </section>
      </div>
    </div>

    <!-- TAB 5: VOICE NOTE TO GROUPS -->
    <div id="admin-tab-voice" class="tab-pane">
      <div class="grid-2">
        <!-- Section 1: Choose Groups -->
        <section class="glass-card">
          <div class="card-title">
            <span>👥 Dooro Kooxaha (Dhammaan Groups-ka)</span>
            <button type="button" class="btn btn-ghost btn-sm" onclick="loadGroupsForVoice(true)">🔄 Refresh</button>
          </div>
          <div class="card-sub" id="voiceGroupsStatusSub">Dooro kooxaha aad rabto (waxaa ku jira kooxaha aad Admin-ka ka tahay iyo kuwa aad Member ka tahayba):</div>

          <div style="margin-bottom:0.75rem;display:flex;align-items:center;gap:0.5rem;padding:0.4rem 0.6rem;background:rgba(6,182,212,0.1);border-radius:8px;flex-wrap:wrap;justify-content:space-between;">
            <div style="display:flex;align-items:center;gap:0.5rem;">
              <input type="checkbox" id="selectAllVoiceGroups" onchange="toggleSelectAllGroups(this)" style="cursor:pointer;width:18px;height:18px;" />
              <label for="selectAllVoiceGroups" style="font-size:0.85rem;font-weight:700;cursor:pointer;margin:0;">Dhammaan (Select All)</label>
            </div>
            <div style="display:flex;gap:0.35rem;flex-wrap:wrap;">
              <button type="button" class="btn btn-primary btn-sm" id="btnFilterAll" onclick="filterGroupsList('all')" style="padding:0.2rem 0.55rem;font-size:0.75rem;">Dhammaan</button>
              <button type="button" class="btn btn-ghost btn-sm" id="btnFilterAdmin" onclick="filterGroupsList('admin')" style="padding:0.2rem 0.55rem;font-size:0.75rem;">👑 Admin Kaliya</button>
              <button type="button" class="btn btn-ghost btn-sm" id="btnFilterManaged" onclick="filterGroupsList('managed')" style="padding:0.2rem 0.55rem;font-size:0.75rem;">🤖 Managed</button>
            </div>
          </div>

          <input class="field" id="searchGroupInput" placeholder="🔍 Raadi koox magac ama lambar..." oninput="filterGroupsSearch(this.value)" style="margin-bottom:0.6rem;padding:0.45rem 0.65rem;font-size:0.82rem;" />

          <div id="voiceGroupsListBox" style="max-height:360px;overflow-y:auto;background:rgba(8,13,25,0.7);border:1px solid var(--card-border);border-radius:10px;padding:0.75rem;display:flex;flex-direction:column;gap:0.5rem;">
            <div style="color:var(--text-muted);font-size:0.85rem;">Waa la soo rarayaa kooxaha...</div>
          </div>
        </section>

        <!-- Section 2: Audio File / Text & Title -->
        <section class="glass-card">
          <div class="card-title">🎙️ Codka &amp; Ciwaanka Voice Note-ka</div>
          <div class="card-sub">Codku wuxuu ugu dhacayaa kooxda qaab Voice Note (PTT) ah oo mowjad dabiici ah leh:</div>

          <div class="form-group">
            <label class="field-label">Ciwaanka / Qoraalka Codka La Socda (Title Caption)</label>
            <input class="field" id="voiceTitleInput" placeholder="Tusaale: XUSUUSIN MUHIIM AH AMA WACDI & WAANO" />
          </div>

          <div style="margin-bottom:1rem;">
            <label class="field-label">Habka Codka (Dooro midkood):</label>
            <div style="display:flex;gap:0.5rem;margin-bottom:0.75rem;flex-wrap:wrap;">
              <button type="button" class="btn btn-primary btn-sm" id="btnAudioModeFile" onclick="setAudioSourceMode('file')">📁 Soo Geli Fayl (MP3/OGG)</button>
              <button type="button" class="btn btn-ghost btn-sm" id="btnAudioModeUrl" onclick="setAudioSourceMode('url')">🌐 Link Video/Cod (TikTok, YouTube, MP3, MP4)</button>
              <button type="button" class="btn btn-ghost btn-sm" id="btnAudioModeTTS" onclick="setAudioSourceMode('tts')">🗣️ Qor Qoraal AI Cod ka Dhigto</button>
            </div>

            <!-- Option A: File Upload -->
            <div id="voiceBoxFile">
              <input type="file" id="voiceFileInput" accept="audio/*,.mp3,.ogg,.wav,.m4a" onchange="handleVoiceFileSelected(this)" style="display:none;" />
              <button type="button" class="btn btn-ghost" onclick="document.getElementById('voiceFileInput').click()" style="width:100%;padding:1.1rem;border:2px dashed var(--card-border);text-align:center;">
                🎵 Riix Halkan si aad u soo doorato Faylka Codka (MP3 / OGG / WAV)
              </button>
              <div id="voiceFileSelectedName" style="margin-top:0.5rem;font-size:0.85rem;color:var(--primary);font-weight:700;"></div>
              <audio id="voiceAudioPreview" controls style="display:none;width:100%;margin-top:0.6rem;"></audio>
            </div>

            <!-- Option C: Audio Link / URL -->
            <div id="voiceBoxUrl" style="display:none;">
              <div class="form-group" style="margin-bottom:0.5rem;">
                <label class="field-label">Geli Link-ga Video / Codka (TikTok, YouTube, MP3, MP4 URL)</label>
                <div style="display:flex;gap:0.5rem;">
                  <input class="field" id="voiceUrlInput" placeholder="Geli link-ga TikTok, YouTube (ama Shorts), ama MP3/MP4 toos ah..." oninput="handleVoiceUrlInput(this.value)" />
                  <button type="button" class="btn btn-ghost btn-sm" onclick="previewVoiceUrl()">▶️ Tijaabi</button>
                </div>
              </div>
              <div style="font-size:0.8rem;color:var(--text-muted);margin-top:0.25rem;">
                ✨ Link kasta (TikTok, YouTube, Shorts, ama link toos ah oo MP3/MP4 ah) waxaa toos looga soo saarayaa codka waxaana loo beddelayaa WhatsApp Voice Note (PTT) mowjad dabiici ah leh oo toos loo dhagaysan karo.
              </div>
              <audio id="voiceUrlAudioPreview" controls style="display:none;width:100%;margin-top:0.6rem;"></audio>
            </div>

            <!-- Option B: TTS Text -->
            <div id="voiceBoxTTS" style="display:none;">
              <textarea class="field" id="voiceTextInput" placeholder="Qor qoraalka Soomaaliga ah ee aad rabto in AI cod macaan oo dabiici ah ku akhriyo..." style="min-height:110px;"></textarea>
              <div style="font-size:0.8rem;color:var(--text-muted);margin-top:0.25rem;">
                Codka: Microsoft Edge Neural Voice (Soomaali Muuse / Dabiici ah)
              </div>
            </div>
          </div>

          <button class="btn btn-primary" id="sendVoiceToGroupBtn" onclick="dispatchVoiceNoteToGroups()" style="width:100%;padding:0.9rem;font-weight:700;font-size:1rem;background:linear-gradient(135deg,#06b6d4,#10b981);">
            🚀 U Dir Kooxaha La Doortay (Send Voice Note PTT)
          </button>
        </section>
      </div>

      <!-- Section 3: Daily Auto-Add Members to Group -->
      <section class="glass-card" style="margin-top:1.25rem;">
        <div class="card-title">
          <span>👥 Ku-Darista Tooska ah ee Xubnaha Maalin Walba (Daily Auto-Add Members)</span>
          <span class="pill pill-green" id="autoAddActiveBadge">Auto-Growth 24/7</span>
        </div>
        <div class="card-sub">
          Bot-ku wuxuu maalin walba si toos ah oo nabad ah (safe anti-ban throttling) kooxaha ugu darayaa xubno cusub oo ka tirsan contacts-ka ku kaydsan bot-ka.
        </div>

        <div class="grid-2" style="margin-top:0.85rem;align-items:center;">
          <div style="background:rgba(8,13,25,0.7);border:1px solid var(--card-border);border-radius:10px;padding:0.85rem;">
            <div class="form-group" style="margin-bottom:0.6rem;">
              <label class="field-label">Dooro Kooxda aad rabto inaad xubnaha ku kordhiso:</label>
              <select class="field" id="autoAddGroupSelect" onchange="onAutoAddGroupChanged(this.value)">
                <option value="">Waa la soo rarayaa kooxaha...</option>
              </select>
            </div>
            <div style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap;">
              <button type="button" class="btn btn-emerald btn-sm" id="btnToggleAutoAdd" onclick="toggleAutoAddForSelectedGroup()">
                🟢 Shid Ku-darista Maalinlaha ah (Daily ON)
              </button>
              <button type="button" class="btn btn-primary btn-sm" id="btnRunAutoAddNow" onclick="runAutoAddNowForSelectedGroup()">
                🚀 Ku Dar 5 Xubnood Hadda (Run Now)
              </button>
            </div>
          </div>

          <div style="background:rgba(8,13,25,0.7);border:1px solid var(--card-border);border-radius:10px;padding:0.85rem;font-size:0.85rem;">
            <div style="font-weight:700;margin-bottom:0.4rem;color:#38bdf8;">📊 Tirakoobka Contacts-ka Kooxda:</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;">
              <div>Wadarta Contacts-ka: <strong id="statTotalContacts">--</strong></div>
              <div>U Diyaar ah Ku-darista: <strong id="statEligibleContacts" style="color:#34d399;">--</strong></div>
              <div>Durba Kooxda ku jira: <strong id="statAlreadyInGroup">--</strong></div>
              <div>Wadarta Lagu Daray: <strong id="statTotalAdded" style="color:#22d3ee;">--</strong></div>
            </div>
            <div style="margin-top:0.5rem;font-size:0.78rem;color:var(--text-muted);" id="statAutoAddLastRun">
              Maalintii u dambaysay: --
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- TAB 6: VIEWS & .VCF CONTACT EXCHANGE HUB (0% BAN VIP MANAGER) -->
    <div id="admin-tab-views" class="tab-pane">
      <section class="grid-4" style="margin-bottom:1.25rem;">
        <div class="kpi-box">
          <div class="kpi-label">Wadarta Contacts Pool-ka</div>
          <div class="kpi-val" id="adminViewsTotal">0</div>
          <div class="kpi-foot">Active contacts</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">VIP Pinned Clients</div>
          <div class="kpi-val" id="adminViewsVipCount" style="color:#fbbf24;">0</div>
          <div class="kpi-foot">Korka ku xiran .vcf kasta</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">Batch-ka Hadda</div>
          <div class="kpi-val" id="adminViewsBatch" style="color:#22d3ee;">#1</div>
          <div class="kpi-foot" id="adminViewsBatchFill">0 / 100</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">Wadarta .vcf Downloads</div>
          <div class="kpi-val" id="adminViewsDownloads" style="color:#34d399;">0</div>
          <div class="kpi-foot">1-click imports</div>
        </div>
      </section>

      <div style="display:flex;gap:0.65rem;flex-wrap:wrap;margin-bottom:1.25rem;align-items:center;">
        <a href="/views" target="_blank" class="btn btn-primary btn-sm">🔗 Fur Bogga /views</a>
        <button class="btn btn-ghost btn-sm" onclick="copyText(location.origin + '/views', '✅ Link-ga /views waa la koobiyeeyay!')">📋 Koobi Link-ga /views</button>
        <button class="btn btn-emerald btn-sm" onclick="downloadAdminVcf('all')">📥 Soo Deji Master .vcf (All)</button>
        <button class="btn btn-ghost btn-sm" onclick="downloadAdminVcf('vip')">👑 Soo Deji VIP .vcf</button>
        <button class="btn btn-ghost btn-sm" id="btnUnlockBatchAdmin" onclick="unlockCurrentViewsBatch()">🔓 Fur Download Batch-ka</button>
        <button class="btn btn-ghost btn-sm" id="btnNextBatchAdmin" onclick="startNextViewsBatch()">📦 Batch Xiga (Markuu Buuxsamo)</button>
        <button class="btn btn-ghost btn-sm" onclick="loadAdminViewsHub()">🔄 Refresh</button>
        <span class="pill pill-green" id="adminViewsVerifiedPill">✅ 0 Verified · 📥 0 Downloaded</span>
      </div>

      <div class="grid-2" style="margin-bottom:1.25rem;">
        <!-- Add / Promote VIP Pinned Sponsor -->
        <section class="glass-card" style="border-color:rgba(245,158,11,0.4);">
          <div class="card-title">👑 Ku Dar / Dalacsii Macmiil VIP Pinned</div>
          <div class="card-sub">Macmiilka aad halkan geliso wuxuu korka kaga soo baxayaa fayl kasta oo .vcf ah iyo kaararka VIP-ga ee /views &amp; /app.</div>
          <form onsubmit="submitAdminVip(event)">
            <div class="grid-2">
              <div class="form-group">
                <label class="field-label">Magaca VIP / Ganacsiga</label>
                <input class="field" id="vipAddName" required placeholder="Tusaale: Hargeysa Fashion" />
              </div>
              <div class="form-group">
                <label class="field-label">Lambarka WhatsApp (+252 / +251)</label>
                <div style="display:flex;gap:0.4rem;">
                  <select class="field" id="vipAddCountry" style="width:112px;flex-shrink:0;">
                    <option value="252">🇸🇴 +252</option>
                    <option value="251">🇪🇹 +251</option>
                    <option value="254">🇰🇪 +254</option>
                    <option value="253">🇩🇯 +253</option>
                    <option value="">🌍 Kale</option>
                  </select>
                  <input class="field" id="vipAddPhone" required placeholder="634... ama 915..." />
                </div>
              </div>
            </div>
            <div class="grid-3">
              <div class="form-group">
                <label class="field-label">Magaalada</label>
                <input class="field" id="vipAddCity" value="Hargeysa" placeholder="Hargeysa / Jigjiga" />
              </div>
              <div class="form-group">
                <label class="field-label">Muddada VIP</label>
                <select class="field" id="vipAddDays">
                  <option value="7">7 Maalmood (1 Todobaad)</option>
                  <option value="30" selected>30 Maalmood (1 Bil)</option>
                  <option value="90">90 Maalmood (3 Bilood)</option>
                  <option value="0">Joogto (Unlimited)</option>
                </select>
              </div>
              <div class="form-group">
                <label class="field-label">Darajada (1 = Ugu Sare)</label>
                <input class="field" id="vipAddPriority" type="number" value="1" min="1" max="999" />
              </div>
            </div>
            <div class="form-group">
              <label class="field-label">Xayeysiis Kooban (Tagline)</label>
              <input class="field" id="vipAddTagline" placeholder="Tusaale: Dhar casri ah &amp; delivery degdeg ah!" />
            </div>
            <div class="form-group">
              <label class="field-label">Sawirka VIP / Logo (Ikhtiyaari — si toos ah loo yaraynayo)</label>
              <input type="file" id="vipAddPhotoFile" accept="image/*" class="field" onchange="handleVipPhotoPicked(event)" />
              <input type="hidden" id="vipAddAvatarData" />
            </div>
            <button type="submit" id="vipAddSubmitBtn" class="btn btn-primary" style="width:100%;background:linear-gradient(135deg,#f59e0b,#ea580c);">
              👑 Xir Booska VIP Pinned
            </button>
          </form>
        </section>

        <!-- Hub Settings -->
        <section class="glass-card">
          <div class="card-title">⚙️ Dejinta CARDOSO Views Hub</div>
          <div class="card-sub">Maamul Batch Lock Mode, tirada Batch-ka (si toos ah u furma markuu buuxsamo), qiimaha VIP-ga, iyo lambarkaaga.</div>
          <form onsubmit="saveAdminViewsConfig(event)">
            <div class="grid-3">
              <div class="form-group">
                <label class="field-label">Prefix-ka (.vcf)</label>
                <input class="field" id="cfgViewsPrefix" value="CV - " placeholder="CV - " />
              </div>
              <div class="form-group">
                <label class="field-label">Xadka Batch (Auto-Next)</label>
                <input class="field" id="cfgViewsTarget" type="number" value="100" min="2" max="2000" />
              </div>
              <div class="form-group">
                <label class="field-label">Qaabka Download-ka</label>
                <select class="field" id="cfgViewsDownloadMode">
                  <option value="instant">🔓 Instant (Isla markiiba)</option>
                  <option value="locked">🔒 Batch Lock (Sug ilaa Buuxsamo)</option>
                </select>
              </div>
            </div>
            <div class="grid-2">
              <div class="form-group">
                <label class="field-label">Lambarka Dalabka VIP (+252 / +251)</label>
                <input class="field" id="cfgViewsVipPhone" placeholder="252634xxxxxx ama 251915xxxxxx" />
              </div>
              <div class="form-group">
                <label class="field-label">Qiimaha VIP (Label)</label>
                <input class="field" id="cfgViewsVipPrice" value="$5 / Bil" placeholder="$5 / Bil" />
              </div>
            </div>
            <div class="form-group">
              <label class="field-label">Ogeysiis Sare (Announcement Banner — Ikhtiyaari)</label>
              <input class="field" id="cfgViewsAnnouncement" placeholder="Tusaale: Batch #1 caawa 8:00 PM ayuu xirmayaa!" />
            </div>
            <button type="submit" class="btn btn-emerald" style="width:100%;">💾 Keydi Dejinta Views Hub</button>
          </form>
        </section>
      </div>

      <!-- Contacts Table -->
      <section class="glass-card">
        <div class="card-title">
          <span>👥 Dhammaan Dadka Ku Jira Views Pool-ka</span>
          <input class="field" id="adminViewsSearch" style="max-width:240px;padding:0.45rem 0.7rem;font-size:0.82rem;" placeholder="🔍 Raadi magac ama lambar..." oninput="renderAdminViewsTable()" />
        </div>
        <div class="card-sub">La soco cidda <code>.vcf</code>-ka soo dejisay (<b>✅ Downloaded</b>), cidda xaqiijisay (<b>✅ Verified</b>), VIP ka dhig, ama tirtir.</div>
        <div class="table-wrap">
          <table class="saas-table">
            <thead>
              <tr>
                <th>Magaca &amp; Lambarka</th>
                <th>Magaalada</th>
                <th>Batch</th>
                <th>Xaaladda VIP</th>
                <th>Download &amp; Verified</th>
                <th>Tallaabooyinka</th>
              </tr>
            </thead>
            <tbody id="adminViewsTableBody">
              <tr><td colspan="6" style="text-align:center;color:var(--text-muted);">Waa la soo rarayaa...</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </main>

  <!-- Edit Subscriber Limits / Tier Modal -->
  <div id="editModalBackdrop" class="modal-backdrop">
    <div class="glass-card modal-box">
      <div class="card-title">
        <span>⚙️ Wax Ka Beddel Macmiilka (<span id="editSubTitle"></span>)</span>
        <button class="btn btn-ghost btn-sm" onclick="closeEditModal()">✕</button>
      </div>
      <input type="hidden" id="editSubId" />
      <div class="grid-2" style="margin-top:0.75rem;">
        <div class="form-group">
          <label class="field-label">Qaybta (Category)</label>
          <select class="field" id="editSubCategory">
            <option value="personal">👤 Personal</option>
            <option value="business">🛍️ Business</option>
            <option value="education">🎓 Education</option>
          </select>
        </div>
        <div class="form-group">
          <label class="field-label">Qorshaha (Plan Tier)</label>
          <select class="field" id="editSubPlan">
            <option value="trial_free">Free Trial</option>
            <option value="starter">Starter</option>
            <option value="business">Business Pro</option>
            <option value="education">Education Pro</option>
          </select>
        </div>
      </div>
      <div class="grid-2">
        <div class="form-group">
          <label class="field-label">Max Daily AI Calls</label>
          <input class="field" id="editMaxAi" type="number" />
        </div>
        <div class="form-group">
          <label class="field-label">Max Daily Voice</label>
          <input class="field" id="editMaxVoice" type="number" />
        </div>
        <div class="form-group">
          <label class="field-label">Max Daily Images</label>
          <input class="field" id="editMaxImages" type="number" />
        </div>
        <div class="form-group">
          <label class="field-label">Max Daily Broadcast</label>
          <input class="field" id="editMaxBroadcast" type="number" />
        </div>
      </div>
      <div style="display:flex;gap:1.25rem;flex-wrap:wrap;margin-bottom:1rem;font-size:0.86rem;">
        <label><input type="checkbox" id="editAllowReactor" /> Status Reactor</label>
        <label><input type="checkbox" id="editAllowStatusPost" /> Status Post</label>
        <label><input type="checkbox" id="editAllowLeads" /> Leads Capture</label>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:0.65rem;">
        <button class="btn btn-ghost" onclick="closeEditModal()">Ka Noqo</button>
        <button class="btn btn-primary" onclick="saveTenantEdits()">💾 Keydi Isbeddelada</button>
      </div>
    </div>
  </div>

  <div id="toastBanner" class="toast-banner"></div>

  <script>
    ${COMMON_CLIENT_JS}
    window.lastCreatedSubUrl = '';
    window._tenantsCache = [];

    function escapeAdminHtml(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function switchAdminTab(name, btn) {
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      const pane = document.getElementById('admin-tab-' + name);
      if (pane) pane.classList.add('active');
      if (btn) btn.classList.add('active');
      if (name === 'owner') { loadOwnerConfig(); loadOwnerStatus(); loadOwnerLeads(); }
      if (name === 'admins') { loadAdminUsers(); loadPromos(); }
      if (name === 'views') { loadAdminViewsHub(); }
      if (name === 'voice') { loadGroupsForVoice(); }
    }

    async function loadAdminOverview() {
      try {
        const [tRes, oRes] = await Promise.all([
          fetch('/api/admin/tenants'),
          fetch('/api/status'),
        ]);
        const tData = await tRes.json();
        const oData = await oRes.json();
        if (tData.status !== 'ok') return;

        window._tenantsCache = tData.tenants || [];
        const stats = tData.summary || {};
        document.getElementById('kpiActiveCount').textContent = String(stats.active || 0);
        document.getElementById('kpiTotalCount').textContent = (stats.total || 0) + ' wadarta diiwaangashan';
        document.getElementById('kpiPendingCount').textContent = String(stats.pending || 0);
        document.getElementById('tabPendingBadge').textContent = String(stats.pending || 0);
        document.getElementById('kpiExpiringCount').textContent = String(stats.expiringSoon || 0);
        document.getElementById('kpiExpiredCount').textContent = (stats.expired || 0) + ' bishoodii dhammaatay';
        document.getElementById('kpiAdminUsersCount').textContent = (stats.adminUsers || 0) + ' Admin oo dheeri ah';

        if (oData.status === 'ok') {
          document.getElementById('kpiOwnerContacts').textContent = String(oData.contacts?.total || 0);
          const badge = document.getElementById('ownerWaBadge');
          if (oData.isConnected) {
            badge.className = 'pill pill-green';
            badge.textContent = '● Owner WA: +' + (oData.botNumber || 'Connected');
          } else {
            badge.className = 'pill pill-amber';
            badge.textContent = '○ Owner WA: Offline';
          }
        }

        renderPendingList(window._tenantsCache.filter(t => t.status === 'pending'));
        renderSubscribersTable(window._tenantsCache);
      } catch (err) {
        console.error(err);
      }
    }

    function renderPendingList(pending) {
      const card = document.getElementById('pendingRequestsCard');
      const box = document.getElementById('pendingListBox');
      if (!pending.length) {
        card.style.display = 'none';
        return;
      }
      card.style.display = 'block';
      box.innerHTML = pending.map(t => {
        const defaultTier = t.category === 'business' ? 'business' : t.category === 'education' ? 'education' : 'trial_free';
        return '<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:0.85rem;padding:0.9rem 1rem;border-radius:12px;background:rgba(12,18,33,0.9);border:1px solid var(--card-border);">' +
          '<div>' +
            '<div style="font-weight:800;">' + escapeHtml(t.name) + ' ' + categoryBadge(t.category) + '</div>' +
            '<div style="font-size:0.82rem;color:var(--text-muted);">Lambar: <strong>+' + escapeHtml(t.allowedPhone) + '</strong>' + (t.signupNotes ? ' • "' + escapeHtml(t.signupNotes) + '"' : '') + '</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">' +
            '<select class="field" id="appTier_' + t.id + '" style="width:auto;padding:0.4rem 0.6rem;font-size:0.8rem;">' +
              '<option value="trial_free" ' + (defaultTier === 'trial_free' ? 'selected' : '') + '>Bisha 1aad Bilaash (30d)</option>' +
              '<option value="starter">Starter (1 Bil)</option>' +
              '<option value="business" ' + (defaultTier === 'business' ? 'selected' : '') + '>Business Pro (1 Bil)</option>' +
              '<option value="education" ' + (defaultTier === 'education' ? 'selected' : '') + '>Education Pro (1 Bil)</option>' +
            '</select>' +
            '<button class="btn btn-emerald btn-sm" onclick="approveTenant(\\'' + t.id + '\\')">✅ Approve &amp; Start</button>' +
            '<button class="btn btn-danger btn-sm" onclick="rejectTenant(\\'' + t.id + '\\')">✕ Diid</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    function renderSubscribersTable(list) {
      const tbody = document.getElementById('subscribersTableBody');
      if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);">Wali wax macmiil ah ma diiwaangashana.</td></tr>';
        return;
      }
      tbody.innerHTML = list.map(t => {
        const waStatus = t.runtime?.connected
          ? '<span class="pill pill-green">Online</span>'
          : '<span class="pill pill-muted">Offline</span>';
        const keyBadge = t.hasCustomGeminiKey ? ' <span class="pill pill-violet">BYOK</span>' : '';

        return '<tr>' +
          '<td><strong>' + escapeHtml(t.name) + '</strong><br><span style="font-size:0.78rem;color:var(--text-muted);">+' + escapeHtml(t.allowedPhone) + '</span></td>' +
          '<td>' + categoryBadge(t.category) + '</td>' +
          '<td><strong>' + escapeHtml(t.planTier) + '</strong>' + keyBadge + '</td>' +
          '<td>' + statusBadge(t.status) + '</td>' +
          '<td style="font-size:0.82rem;">' + formatDaysLeft(t.expiresAt) + '</td>' +
          '<td>' + waStatus + '<div style="font-size:0.76rem;color:var(--text-muted);margin-top:0.2rem;">' + (t.runtime?.contactsCount || 0) + ' contacts</div></td>' +
          '<td><div style="display:flex;gap:0.35rem;flex-wrap:wrap;align-items:center;">' +
            '<span class="pill pill-cyan" title="Xogta wada-hadallada macmiilkan waa mid u gaar ah oo la dhowray">🔒 Qarsoodi</span>' +
            '<button class="btn btn-emerald btn-sm" onclick="renewTenant(\\'' + t.id + '\\')">+1 Bil</button>' +
            (t.status === 'active'
              ? '<button class="btn btn-danger btn-sm" onclick="suspendTenant(\\'' + t.id + '\\')">Suspend</button>'
              : '<button class="btn btn-primary btn-sm" onclick="activateTenant(\\'' + t.id + '\\')">Shid</button>') +
            '<button class="btn btn-ghost btn-sm" onclick="openEditModal(\\'' + t.id + '\\')">⚙️</button>' +
            '<button class="btn btn-danger btn-sm" onclick="deleteTenant(\\'' + t.id + '\\')">🗑️</button>' +
          '</div></td>' +
        '</tr>';
      }).join('');
    }

    async function approveTenant(id) {
      const sel = document.getElementById('appTier_' + id);
      const planTier = sel ? sel.value : 'trial_free';
      const res = await fetch('/api/admin/tenants/' + id + '/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planTier, months: 1 }),
      });
      const data = await res.json();
      const extraMsg = data.pairingCode ? (' Koodhka: ' + data.pairingCode + ' & PDF-kii waa la diray!') : '';
      showToast(res.ok ? ('✅ Waa la oggolaaday!' + extraMsg) : ('❌ ' + data.message), !res.ok);
      loadAdminOverview();
    }

    async function rejectTenant(id) {
      if (!confirm('Ma hubtaa inaad diido codsigan?')) return;
      await fetch('/api/admin/tenants/' + id + '/reject', { method: 'POST' });
      showToast('❌ Codsiga waa la diiday');
      loadAdminOverview();
    }

    async function renewTenant(id) {
      const res = await fetch('/api/admin/tenants/' + id + '/renew', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ months: 1 }),
      });
      if (res.ok) { showToast('✅ +1 Bil waa loo kordhiyay!'); loadAdminOverview(); }
    }

    async function suspendTenant(id) {
      await fetch('/api/admin/tenants/' + id + '/suspend', { method: 'POST' });
      showToast('⛔ Akoonka waa la hakiyay (xogtii waa kaydsan tahay)');
      loadAdminOverview();
    }

    async function activateTenant(id) {
      await fetch('/api/admin/tenants/' + id + '/activate', { method: 'POST' });
      showToast('🚀 Akoonka waa la shiday');
      loadAdminOverview();
    }

    async function deleteTenant(id) {
      if (!confirm('Ma hubtaa inaad tirtirto macmiilkan?')) return;
      await fetch('/api/admin/tenants/' + id, { method: 'DELETE' });
      showToast('🗑️ Macmiilka waa la tirtiray');
      loadAdminOverview();
    }

    async function createSubscriberDirect(e) {
      e.preventDefault();
      const res = await fetch('/api/admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: document.getElementById('newSubName').value.trim(),
          phone: document.getElementById('newSubPhone').value.trim(),
          category: document.getElementById('newSubCategory').value,
          planTier: document.getElementById('newSubPlan').value,
          months: Number(document.getElementById('newSubMonths').value || 1),
          customGeminiKey: document.getElementById('newSubKey').value.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) { showToast('❌ ' + (data.message || 'Error'), true); return; }
      document.getElementById('directCreateResult').style.display = 'block';
      showToast('✅ Macmiil cusub waa la abuuray!');
      loadAdminOverview();
    }

    async function logoutAdmin() {
      try {
        await fetch('/api/admin/logout', { method: 'POST' });
      } catch {}
      document.cookie = 'cardoso_admin_session=; Path=/; Max-Age=0; SameSite=Lax';
      window.location.href = '/portal';
    }

    function openEditModal(id) {
      const t = window._tenantsCache.find(x => x.id === id);
      if (!t) return;
      document.getElementById('editSubId').value = t.id;
      document.getElementById('editSubTitle').textContent = t.name;
      document.getElementById('editSubCategory').value = t.category;
      document.getElementById('editSubPlan').value = t.planTier;
      const f = t.effectiveFeatures;
      document.getElementById('editMaxAi').value = f.maxDailyAiCalls;
      document.getElementById('editMaxVoice').value = f.maxDailyVoice;
      document.getElementById('editMaxImages').value = f.maxDailyImages;
      document.getElementById('editMaxBroadcast').value = f.maxDailyBroadcast;
      document.getElementById('editAllowReactor').checked = Boolean(f.allowStatusReactor);
      document.getElementById('editAllowStatusPost').checked = Boolean(f.allowStatusPosting);
      document.getElementById('editAllowLeads').checked = Boolean(f.allowLeadsCapture);
      document.getElementById('editModalBackdrop').classList.add('open');
    }

    function closeEditModal() {
      document.getElementById('editModalBackdrop').classList.remove('open');
    }

    async function saveTenantEdits() {
      const id = document.getElementById('editSubId').value;
      const res = await fetch('/api/admin/tenants/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: document.getElementById('editSubCategory').value,
          planTier: document.getElementById('editSubPlan').value,
          features: {
            maxDailyAiCalls: Number(document.getElementById('editMaxAi').value),
            maxDailyVoice: Number(document.getElementById('editMaxVoice').value),
            maxDailyImages: Number(document.getElementById('editMaxImages').value),
            maxDailyBroadcast: Number(document.getElementById('editMaxBroadcast').value),
            allowStatusReactor: document.getElementById('editAllowReactor').checked,
            allowStatusPosting: document.getElementById('editAllowStatusPost').checked,
            allowLeadsCapture: document.getElementById('editAllowLeads').checked,
          },
        }),
      });
      if (res.ok) {
        closeEditModal();
        showToast('✅ Xadka iyo qorshaha waa la cusboonaysiiyay');
        loadAdminOverview();
      }
    }

    async function loadAdminUsers() {
      const res = await fetch('/api/admin/admins');
      const data = await res.json();
      const box = document.getElementById('adminUsersList');
      const list = data.admins || [];
      if (!list.length) {
        box.innerHTML = '<div style="font-size:0.82rem;color:var(--text-muted);">Wali admin dheeri ah lama darin.</div>';
        return;
      }
      box.innerHTML = list.map(a =>
        '<div style="display:flex;justify-content:space-between;align-items:center;padding:0.65rem 0.85rem;border-radius:10px;background:rgba(10,16,30,0.85);border:1px solid var(--card-border);">' +
          '<div><strong>' + escapeHtml(a.displayName) + '</strong> (<code>' + escapeHtml(a.username) + '</code>) • ' +
            '<span class="pill ' + (a.active ? 'pill-green' : 'pill-red') + '">' + (a.active ? 'Active' : 'Disabled') + '</span>' +
            (a.phoneNumber ? '<br><span style="font-size:0.76rem;color:var(--text-muted);">WA: +' + escapeHtml(a.phoneNumber) + '</span>' : '') +
          '</div>' +
          '<div style="display:flex;gap:0.4rem;">' +
            '<button class="btn btn-ghost btn-sm" onclick="toggleAdminActive(\\'' + a.id + '\\', ' + (!a.active) + ')">' + (a.active ? 'Disable' : 'Enable') + '</button>' +
            '<button class="btn btn-danger btn-sm" onclick="deleteAdminUser(\\'' + a.id + '\\')">✕</button>' +
          '</div>' +
        '</div>'
      ).join('');
    }

    async function createAdminUser(e) {
      e.preventDefault();
      const res = await fetch('/api/admin/admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: document.getElementById('admUsername').value.trim(),
          password: document.getElementById('admPassword').value,
          displayName: document.getElementById('admDisplay').value.trim(),
          phoneNumber: document.getElementById('admPhone').value.trim(),
          role: document.getElementById('admRole').value,
        }),
      });
      const data = await res.json();
      showToast(res.ok ? '✅ Admin cusub waa la daray!' : '❌ ' + (data.message || 'Error'), !res.ok);
      if (res.ok) {
        e.target.reset();
        loadAdminUsers();
        loadAdminOverview();
      }
    }

    async function toggleAdminActive(id, active) {
      await fetch('/api/admin/admins/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      });
      loadAdminUsers();
    }

    async function deleteAdminUser(id) {
      await fetch('/api/admin/admins/' + id, { method: 'DELETE' });
      loadAdminUsers();
      loadAdminOverview();
    }

    async function loadPromos() {
      const res = await fetch('/api/admin/promos');
      const data = await res.json();
      const box = document.getElementById('promoCodesList');
      const list = data.promos || [];
      if (!list.length) {
        box.innerHTML = '<div style="font-size:0.82rem;color:var(--text-muted);">Wali ma jiro Promo Code firfircoon.</div>';
        return;
      }
      box.innerHTML = list.map(p =>
        '<div style="display:flex;justify-content:space-between;align-items:center;padding:0.65rem 0.85rem;border-radius:10px;background:rgba(10,16,30,0.85);border:1px solid var(--card-border);">' +
          '<div><code>' + escapeHtml(p.code) + '</code> • ' + escapeHtml(p.planTier) + ' (' + p.durationDays + 'd) • Uses: ' + p.usedCount + '/' + p.maxUses + '</div>' +
          '<button class="btn btn-ghost btn-sm" onclick="togglePromo(\\'' + encodeURIComponent(p.code) + '\\', ' + (!p.active) + ')">' + (p.active ? 'Disable' : 'Enable') + '</button>' +
        '</div>'
      ).join('');
    }

    async function createPromoCode(e) {
      e.preventDefault();
      const res = await fetch('/api/admin/promos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: document.getElementById('promoCodeInput').value.trim(),
          planTier: document.getElementById('promoPlanTier').value,
          durationDays: Number(document.getElementById('promoDays').value || 30),
          maxUses: Number(document.getElementById('promoMaxUses').value || 10),
        }),
      });
      if (res.ok) { e.target.reset(); showToast('🎟️ Promo code waa la sameeyay'); loadPromos(); }
    }

    async function togglePromo(code, active) {
      await fetch('/api/admin/promos/' + code, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      });
      loadPromos();
    }

    // Owner Studio helpers
    async function loadOwnerStatus() {
      const res = await fetch('/api/status');
      const data = await res.json();
      if (data.status !== 'ok') return;
      const pill = document.getElementById('ownerConnPill');
      if (data.isConnected) {
        pill.className = 'pill pill-green';
        pill.textContent = 'Connected';
        document.getElementById('ownerConnectedPanel').style.display = 'block';
        document.getElementById('ownerConnectPanel').style.display = 'none';
        document.getElementById('ownerNumText').textContent = data.botNumber || '--';
        document.getElementById('ownerContactsSpan').textContent = String(data.contacts?.total || 0);
      } else {
        pill.className = 'pill pill-amber';
        pill.textContent = 'Disconnected';
        document.getElementById('ownerConnectedPanel').style.display = 'none';
        document.getElementById('ownerConnectPanel').style.display = 'block';
        if (data.currentQR) {
          document.getElementById('ownerQrBox').style.display = 'block';
          document.getElementById('ownerQrImage').src = 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=' + encodeURIComponent(data.currentQR);
        }
      }
    }

    async function requestOwnerPairing(btnEl) {
      const phone = document.getElementById('ownerPairPhone').value.trim();
      const btn = btnEl || null;
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Waa la diyaarinayaa...'; }
      try {
        const res = await fetch('/api/owner/pair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone }),
        });
        const data = await res.json();
        if (data.status === 'ok' && data.formattedCode) {
          window.ownerPairingRaw = data.code || String(data.formattedCode).replace(/[^A-Z0-9]/gi, '');
          document.getElementById('ownerPairBox').style.display = 'block';
          document.getElementById('ownerPairDigits').textContent = data.formattedCode;
          if (data.phone) document.getElementById('ownerPairPhoneNote').textContent = '+' + data.phone;
          showToast('🔑 Pairing Code: ' + data.formattedCode);
        } else {
          showToast('❌ ' + (data.message || 'Lama helin'), true);
        }
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🔑 Pairing Code'; }
      }
    }

    async function syncOwnerContacts() {
      const res = await fetch('/api/owner/sync-contacts', { method: 'POST' });
      const data = await res.json();
      showToast(data.synced ? '✅ Synced (' + data.total + ')' : 'ℹ️ Sync queued');
      loadOwnerStatus();
    }

    async function unlinkOwner() {
      if (!confirm('Ma hubtaa inaad Unlink garayso Owner WhatsApp?')) return;
      await fetch('/api/unlink', { method: 'POST' });
      loadOwnerStatus();
    }

    async function loadOwnerConfig() {
      const res = await fetch('/api/config');
      const data = await res.json();
      if (data.status === 'ok') {
        document.getElementById('ownBotName').value = data.config.botName || '';
        document.getElementById('ownBizName').value = data.config.businessName || '';
        document.getElementById('ownRole').value = data.config.systemRole || '';
        document.getElementById('ownKB').value = data.config.knowledgeBase || '';
      }
    }

    async function saveOwnerConfig() {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botName: document.getElementById('ownBotName').value,
          businessName: document.getElementById('ownBizName').value,
          systemRole: document.getElementById('ownRole').value,
          knowledgeBase: document.getElementById('ownKB').value,
        }),
      });
      const data = await res.json();
      showToast(res.ok ? '✅ ' + data.message : '❌ Error');
    }

    async function sendOwnerTestChat(e) {
      e.preventDefault();
      const inp = document.getElementById('ownTestInput');
      const msg = inp.value.trim();
      if (!msg) return;
      inp.value = '';
      const log = document.getElementById('ownChatLog');
      log.innerHTML += '<div style="align-self:flex-end;background:rgba(6,182,212,0.2);padding:0.5rem 0.75rem;border-radius:10px;font-size:0.84rem;">' + escapeHtml(msg) + '</div>';
      const res = await fetch('/api/test-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();
      log.innerHTML += '<div style="align-self:flex-start;background:rgba(30,41,59,0.9);padding:0.5rem 0.75rem;border-radius:10px;font-size:0.84rem;white-space:pre-wrap;">' + escapeHtml(data.reply || '') + '</div>';
      log.scrollTop = log.scrollHeight;
    }

    async function loadOwnerLeads() {
      const res = await fetch('/api/owner/leads');
      const data = await res.json();
      const box = document.getElementById('ownerLeadsBox');
      const leads = data.leads || [];
      if (!leads.length) { box.textContent = 'Wali wax fariin/dalab kaydsan ma jiro.'; return; }
      box.innerHTML = leads.slice(0, 15).map(l =>
        '<div style="padding:0.35rem 0;border-bottom:1px solid var(--card-border);"><strong>' + escapeHtml(l.senderName || l.senderPhone) + '</strong>: ' + escapeHtml(l.summary) + '</div>'
      ).join('');
    }

    async function ownerMasterStatus(enabled) {
      const res = await fetch('/api/status/master-view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = await res.json();
      showToast(data.message || 'Updated');
    }

    async function ownerPostStatus() {
      const text = document.getElementById('ownerStatusText').value.trim();
      if (!text) return;
      const res = await fetch('/api/status/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      showToast(data.success ? '✅ Status waa la dhigay' : '❌ ' + data.message, !data.success);
    }

    async function ownerPostPodcastStatus(mode) {
      const inp = document.getElementById('ownerPodcastStatusTopic');
      const topic = inp ? inp.value.trim() : '';
      const vBtn = document.getElementById('btnOwnerVoiceStatus');
      const mBtn = document.getElementById('btnOwnerVideoStatus');
      if (vBtn) vBtn.disabled = true;
      if (mBtn) mBtn.disabled = true;
      showToast(mode === 'video' ? '🎬 Video Podcast Status waa la diyaarinayaa...' : '🎙️ Voice Podcast Status waa la diyaarinayaa...');
      try {
        const res = await fetch('/api/status/post-podcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic: topic, mode: mode || 'voice', durationMinutes: 0.85 }),
        });
        const data = await res.json();
        showToast(data.success ? '✅ ' + data.message : '❌ ' + (data.message || 'Lama dhigi karin'), !data.success);
      } catch (err) {
        showToast('❌ ' + err.message, true);
      } finally {
        if (vBtn) vBtn.disabled = false;
        if (mBtn) mBtn.disabled = false;
      }
    }

    async function ownerBroadcast() {
      const text = document.getElementById('ownerBroadcastText').value.trim();
      if (!text) return;
      const res = await fetch('/api/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      showToast(data.message || 'Done');
    }

    // Voice Note to Groups Tab Functions
    var _voiceFileBase64 = null;
    var _voiceAudioMode = 'file'; // 'file', 'url', or 'tts'

    function setAudioSourceMode(mode) {
      _voiceAudioMode = mode;
      var fileBox = document.getElementById('voiceBoxFile');
      var urlBox = document.getElementById('voiceBoxUrl');
      var ttsBox = document.getElementById('voiceBoxTTS');
      var btnFile = document.getElementById('btnAudioModeFile');
      var btnUrl = document.getElementById('btnAudioModeUrl');
      var btnTts = document.getElementById('btnAudioModeTTS');
      if (fileBox) fileBox.style.display = mode === 'file' ? 'block' : 'none';
      if (urlBox) urlBox.style.display = mode === 'url' ? 'block' : 'none';
      if (ttsBox) ttsBox.style.display = mode === 'tts' ? 'block' : 'none';
      if (btnFile) btnFile.className = mode === 'file' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
      if (btnUrl) btnUrl.className = mode === 'url' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
      if (btnTts) btnTts.className = mode === 'tts' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
    }

    function handleVoiceUrlInput(val) {
      const audio = document.getElementById('voiceUrlAudioPreview');
      const cleanPath = (val || '').trim().split('?')[0].toLowerCase();
      const isDirectAudio = cleanPath.endsWith('.mp3') || cleanPath.endsWith('.ogg') || cleanPath.endsWith('.opus') || cleanPath.endsWith('.wav') || cleanPath.endsWith('.m4a');
      if (audio && isDirectAudio) {
        audio.src = val.trim();
        audio.style.display = 'block';
      }
    }

    async function previewVoiceUrl() {
      const input = document.getElementById('voiceUrlInput');
      const val = (input ? input.value : '').trim();
      if (!val) { showToast('❌ Fadlan qor link-ga codka/videoga marka hore', true); return; }
      const audio = document.getElementById('voiceUrlAudioPreview');
      showToast('⏳ Codka ayaa laga soo saarayaa link-ga si loo dhagaysto...', false);
      try {
        const res = await fetch('/api/owner/preview-voice-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audioUrl: val })
        });
        if (!res.ok) {
          const errData = await res.json().catch(function() { return {}; });
          showToast(errData.message || '❌ Codka lama soo dejin karin', true);
          return;
        }
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        if (audio) {
          audio.src = blobUrl;
          audio.style.display = 'block';
          audio.play().catch(function() {});
        }
        showToast('✅ Codkii waa diyaar (OGG Opus Voice Note)! Waad dhagaysan kartaa hadda.', false);
      } catch (err) {
        showToast('❌ Cilad tijaabinta: ' + err.message, true);
      }
    }

    function handleVoiceFileSelected(input) {
      if (!input.files || !input.files[0]) return;
      const file = input.files[0];
      const nameEl = document.getElementById('voiceFileSelectedName');
      if (nameEl) nameEl.textContent = '✅ Faylka la doortay: ' + file.name;
      const url = URL.createObjectURL(file);
      const audio = document.getElementById('voiceAudioPreview');
      if (audio) {
        audio.src = url;
        audio.style.display = 'block';
      }
      const reader = new FileReader();
      reader.onload = function(e) {
        _voiceFileBase64 = e.target.result;
      };
      reader.readAsDataURL(file);
    }

    var _allGroupsCache = [];
    var _currentGroupFilter = 'all'; // 'all', 'admin', 'managed'
    var _searchGroupQuery = '';
    var _checkedGroupJids = new Set();

    function toggleSelectAllGroups(cb) {
      document.querySelectorAll('.voice-group-cb').forEach(function(el) {
        el.checked = cb.checked;
        if (cb.checked) {
          _checkedGroupJids.add(el.value);
        } else {
          _checkedGroupJids.delete(el.value);
        }
      });
    }

    function onGroupCheckboxChanged(cb) {
      if (cb.checked) {
        _checkedGroupJids.add(cb.value);
      } else {
        _checkedGroupJids.delete(cb.value);
      }
    }

    function filterGroupsList(filter) {
      _currentGroupFilter = filter;
      const btnAll = document.getElementById('btnFilterAll');
      const btnAdmin = document.getElementById('btnFilterAdmin');
      const btnManaged = document.getElementById('btnFilterManaged');
      if (btnAll) btnAll.className = filter === 'all' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
      if (btnAdmin) btnAdmin.className = filter === 'admin' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
      if (btnManaged) btnManaged.className = filter === 'managed' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
      renderGroupsList();
    }

    function filterGroupsSearch(query) {
      _searchGroupQuery = (query || '').toLowerCase().trim();
      renderGroupsList();
    }

    function renderGroupsList() {
      const box = document.getElementById('voiceGroupsListBox');
      if (!box) return;

      let filtered = _allGroupsCache.slice();
      if (_currentGroupFilter === 'admin') {
        filtered = filtered.filter(function(g) { return g.isAdmin; });
      } else if (_currentGroupFilter === 'managed') {
        filtered = filtered.filter(function(g) { return g.isManaged; });
      }

      if (_searchGroupQuery) {
        filtered = filtered.filter(function(g) {
          const name = (g.name || '').toLowerCase();
          const id = (g.id || '').toLowerCase();
          return name.includes(_searchGroupQuery) || id.includes(_searchGroupQuery);
        });
      }

      if (filtered.length === 0) {
        box.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;padding:0.5rem;">Lama helin koox waafaqsan raadinta/filter-ka.</div>';
        return;
      }

      box.innerHTML = filtered.map(function(g) {
        const isChecked = _checkedGroupJids.has(g.id);
        const adminBadge = g.isAdmin
          ? '<span class="pill pill-green" style="font-size:0.7rem;padding:0.1rem 0.45rem;background:#10b981;color:#fff;">👑 Admin</span>'
          : '<span class="pill pill-muted" style="font-size:0.7rem;padding:0.1rem 0.45rem;">👤 Member</span>';
        const managedBadge = g.isManaged
          ? '<span class="pill pill-primary" style="font-size:0.7rem;padding:0.1rem 0.45rem;background:#06b6d4;color:#fff;">🤖 Managed</span>'
          : '';

        return '<label style="display:flex;align-items:center;gap:0.6rem;padding:0.55rem;border-radius:8px;cursor:pointer;border:1px solid var(--card-border);background:rgba(255,255,255,0.03);">' +
          '<input type="checkbox" class="voice-group-cb" value="' + escapeAdminHtml(g.id) + '" onchange="onGroupCheckboxChanged(this)" style="cursor:pointer;width:17px;height:17px;" ' + (isChecked ? 'checked' : '') + ' />' +
          '<span style="flex:1;"><strong>' + escapeAdminHtml(g.name || g.id) + '</strong> ' + adminBadge + ' ' + managedBadge +
          '<br/><span style="font-size:0.75rem;color:var(--text-muted);">' + escapeAdminHtml(g.id) + ' · ' + (g.participantsCount || '?') + ' xubnood</span></span>' +
          '</label>';
      }).join('');
    }

    async function loadGroupsForVoice(forceRefresh) {
      const box = document.getElementById('voiceGroupsListBox');
      const sub = document.getElementById('voiceGroupsStatusSub');
      if (!box) return;
      box.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;">⏳ Waa la soo rarayaa dhammaan kooxaha WhatsApp...</div>';
      try {
        const url = '/api/owner/groups' + (forceRefresh ? '?refresh=1' : '');
        const res = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
        if (res.status === 401) {
          box.innerHTML = '<div style="color:#fbbf24;font-size:0.85rem;padding:0.5rem;">🔒 Session-kii maamulka wuu dhacay — fadlan <a href="/admin-login" style="color:#22d3ee;text-decoration:underline;">dib u gal Admin Login</a>.</div>';
          return;
        }
        const text = await res.text();
        let data = {};
        try {
          data = JSON.parse(text);
        } catch (parseErr) {
          throw new Error('Jawaab aan JSON ahayn (HTTP ' + res.status + ')');
        }
        if (!res.ok) {
          throw new Error(data.message || ('HTTP ' + res.status));
        }

        const groups = Array.isArray(data.groups) ? data.groups : [];
        if (sub) {
          const modeLabel = data.source === 'live' ? '🟢 Live' : (data.source === 'live+cache' ? '🟢 Live + Cache' : '⚡ Cache');
          const warnHtml = data.warning ? (' <span style="color:#fbbf24;">· ' + escapeAdminHtml(data.warning) + '</span>') : '';
          sub.innerHTML = 'Wadarta: <strong>' + groups.length + ' kooxood</strong> (' + modeLabel + ')' + warnHtml;
        }

        if (groups.length === 0) {
          const reason = data.warning
            ? escapeAdminHtml(data.warning)
            : (data.connected === false
                ? 'WhatsApp-ka mulkiiluhu hadda waa Offline. Fadlan ka hubi tab-ka "Bot-kaaga (Owner Studio)".'
                : 'Koox la heli waayay. Hubi in lambarka bot-ku kooxo ku jiro kadibna guji Refresh.');
          box.innerHTML = '<div style="color:#fbbf24;font-size:0.85rem;padding:0.5rem;">⚠️ ' + reason +
            '<div style="margin-top:0.55rem;"><button type="button" class="btn btn-primary btn-sm" onclick="loadGroupsForVoice(true)">🔄 Dib u Raadi Kooxaha</button></div></div>';
          return;
        }

        _allGroupsCache = groups;
        _allGroupsCache.forEach(function(g) {
          if (g.isManaged) _checkedGroupJids.add(g.id);
        });

        renderGroupsList();

        const select = document.getElementById('autoAddGroupSelect');
        if (select) {
          select.innerHTML = groups.map(function(g) {
            const role = g.isAdmin ? ' [👑 Admin]' : ' [👤 Member]';
            const mg = g.isManaged ? ' [🤖 Managed]' : '';
            return '<option value="' + escapeAdminHtml(g.id) + '">' + escapeAdminHtml(g.name || g.id) + role + mg + '</option>';
          }).join('');
          if (select.value) {
            loadAutoAddStatusForGroup(select.value);
          }
        }
      } catch (err) {
        box.innerHTML = '<div style="color:#f87171;font-size:0.85rem;padding:0.5rem;">❌ Cilad ayaa dhacday: ' + escapeAdminHtml(err.message) +
          '<div style="margin-top:0.55rem;"><button type="button" class="btn btn-primary btn-sm" onclick="loadGroupsForVoice(true)">🔄 Dib u Isku Day</button></div></div>';
      }
    }

    async function dispatchVoiceNoteToGroups() {
      const btn = document.getElementById('sendVoiceToGroupBtn');
      const selected = Array.from(document.querySelectorAll('.voice-group-cb:checked')).map(function(el) {
        return el.value;
      });
      if (selected.length === 0) {
        showToast('❌ Fadlan dooro ugu yaraan hal koox oo codka loo diro', true);
        return;
      }
      const title = document.getElementById('voiceTitleInput').value.trim();
      var body = { groupJids: selected, title: title };

      if (_voiceAudioMode === 'file') {
        if (!_voiceFileBase64) {
          showToast('❌ Fadlan dooro fayl cod ah (MP3 / OGG / WAV)', true);
          return;
        }
        body.audioBase64 = _voiceFileBase64;
      } else if (_voiceAudioMode === 'url') {
        const urlVal = document.getElementById('voiceUrlInput').value.trim();
        if (!urlVal) {
          showToast('❌ Fadlan geli link-ga codka (Audio URL)', true);
          return;
        }
        body.audioUrl = urlVal;
      } else {
        const text = document.getElementById('voiceTextInput').value.trim();
        if (!text) {
          showToast('❌ Fadlan qor qoraalka la doonayo in cod loo beddelo', true);
          return;
        }
        body.text = text;
      }

      btn.disabled = true;
      btn.textContent = _voiceAudioMode === 'url' ? '⏳ Waa la soo dejinayaa link-ga oo codka loo beddelayaa...' : '⏳ Waa la dirayaa codka...';
      try {
        const res = await fetch('/api/owner/send-voice-group', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        showToast(data.status === 'ok' ? '✅ ' + data.message : '❌ ' + (data.message || 'Cilad ayaa dhacday'), data.status !== 'ok');
      } catch (err) {
        showToast('❌ Cilad: ' + err.message, true);
      } finally {
        btn.disabled = false;
        btn.textContent = '🚀 U Dir Kooxaha La Doortay (Send Voice Note PTT)';
      }
    }

    // Auto-Add Daily Members UI Logic
    var _selectedAutoAddGroup = '';

    async function onAutoAddGroupChanged(jid) {
      _selectedAutoAddGroup = jid;
      if (jid) await loadAutoAddStatusForGroup(jid);
    }

    async function loadAutoAddStatusForGroup(jid) {
      if (!jid) return;
      _selectedAutoAddGroup = jid;
      try {
        const res = await fetch('/api/owner/auto-add/status?groupJid=' + encodeURIComponent(jid));
        const data = await res.json();
        if (data.status === 'ok') {
          const cfg = data.config || {};
          const counts = data.counts || {};
          document.getElementById('statTotalContacts').textContent = String(counts.totalContacts || 0);
          document.getElementById('statEligibleContacts').textContent = String(counts.eligibleCount || 0);
          document.getElementById('statAlreadyInGroup').textContent = String(counts.alreadyInGroupCount || 0);
          document.getElementById('statTotalAdded').textContent = String(cfg.totalAdded || 0);
          document.getElementById('statAutoAddLastRun').textContent = 'Maalintii u dambaysay: ' + (cfg.lastRunDate || 'Wali ma socon') + ' · Xadka: ' + (cfg.dailyLimit || 5) + ' qof/maalintii';

          const btnToggle = document.getElementById('btnToggleAutoAdd');
          if (btnToggle) {
            btnToggle.textContent = cfg.enabled ? '🛑 Dami Ku-darista Maalinlaha ah (Daily OFF)' : '🟢 Shid Ku-darista Maalinlaha ah (Daily ON)';
            btnToggle.className = cfg.enabled ? 'btn btn-danger btn-sm' : 'btn btn-emerald btn-sm';
          }
          const badge = document.getElementById('autoAddActiveBadge');
          if (badge) {
            badge.textContent = cfg.enabled ? 'Auto-Growth ON 🟢' : 'Auto-Growth OFF 🛑';
            badge.className = cfg.enabled ? 'pill pill-green' : 'pill pill-muted';
          }
        }
      } catch (err) {
        console.warn('loadAutoAddStatusForGroup error:', err);
      }
    }

    async function toggleAutoAddForSelectedGroup() {
      const select = document.getElementById('autoAddGroupSelect');
      const jid = select ? select.value : _selectedAutoAddGroup;
      if (!jid) { showToast('❌ Fadlan dooro koox marka hore', true); return; }
      try {
        const currentBtn = document.getElementById('btnToggleAutoAdd');
        const willEnable = currentBtn && currentBtn.textContent.includes('Shid');
        const res = await fetch('/api/owner/auto-add/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupJid: jid, enabled: willEnable, dailyLimit: 5 })
        });
        const data = await res.json();
        showToast(data.message || (willEnable ? 'Ku-darista waa la shiday' : 'Ku-darista waa la damiyay'));
        await loadAutoAddStatusForGroup(jid);
      } catch (err) {
        showToast('❌ Cilad: ' + err.message, true);
      }
    }

    async function runAutoAddNowForSelectedGroup() {
      const select = document.getElementById('autoAddGroupSelect');
      const jid = select ? select.value : _selectedAutoAddGroup;
      if (!jid) { showToast('❌ Fadlan dooro koox marka hore', true); return; }
      const btn = document.getElementById('btnRunAutoAddNow');
      btn.disabled = true;
      btn.textContent = '⏳ Waa la darayaa...';
      try {
        const res = await fetch('/api/owner/auto-add/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupJid: jid, limit: 5 })
        });
        const data = await res.json();
        showToast(data.message || 'Done', !data.success);
        await loadAutoAddStatusForGroup(jid);
      } catch (err) {
        showToast('❌ Cilad: ' + err.message, true);
      } finally {
        btn.disabled = false;
        btn.textContent = '🚀 Ku Dar 5 Xubnood Hadda (Run Now)';
      }
    }

    window._adminViewsContacts = [];

    function handleVipPhotoPicked(ev) {
      const file = ev && ev.target && ev.target.files && ev.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function() {
        const img = new Image();
        img.onload = function() {
          const maxDim = 220;
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
          document.getElementById('vipAddAvatarData').value = dataUrl;
          showToast('✅ Sawirka VIP waa diyaar!');
        };
        img.src = String(reader.result || '');
      };
      reader.readAsDataURL(file);
    }

    async function loadAdminViewsHub() {
      try {
        const res = await fetch('/api/admin/views/overview');
        const data = await res.json();
        if (!data || data.status !== 'ok') return;
        const stats = data.stats || {};
        const cfg = data.config || {};
        window._adminViewsContacts = data.contacts || [];

        document.getElementById('adminViewsTotal').textContent = String(stats.totalContacts || 0);
        document.getElementById('adminViewsVipCount').textContent = String(stats.activeVipCount || 0);
        document.getElementById('adminViewsBatch').textContent = '#' + (cfg.currentBatch || 1);
        document.getElementById('adminViewsBatchFill').textContent = (stats.currentBatchFreeCount || 0) + ' / ' + (cfg.batchTarget || 100) + ' (+' + (stats.activeVipCount || 0) + ' VIP)';
        document.getElementById('adminViewsDownloads').textContent = String(stats.totalDownloads || 0);
        const vPill = document.getElementById('adminViewsVerifiedPill');
        if (vPill) vPill.textContent = '✅ ' + (stats.verifiedSaversCount || 0) + ' Verified · 📥 ' + (stats.downloadedMembersCount || 0) + ' Downloaded';

        const nextBtn = document.getElementById('btnNextBatchAdmin');
        if (nextBtn) {
          nextBtn.textContent = stats.canStartNextBatch
            ? ('📦 Fur Batch #' + ((cfg.currentBatch || 1) + 1) + ' Hadda')
            : ('⏳ Auto-Next Markuu Buuxsamo (' + (stats.currentBatchFreeCount || 0) + '/' + (cfg.batchTarget || 100) + ')');
        }
        const unlockBtn = document.getElementById('btnUnlockBatchAdmin');
        if (unlockBtn) {
          unlockBtn.style.display = (cfg.downloadMode === 'locked' && !stats.currentBatchUnlocked) ? 'inline-flex' : 'none';
        }

        document.getElementById('cfgViewsPrefix').value = cfg.contactPrefix || 'CV - ';
        document.getElementById('cfgViewsTarget').value = String(cfg.batchTarget || 100);
        document.getElementById('cfgViewsDownloadMode').value = cfg.downloadMode || 'instant';
        document.getElementById('cfgViewsVipPhone').value = cfg.ownerVipPhone || '';
        document.getElementById('cfgViewsVipPrice').value = cfg.vipPriceLabel || '$5 / Bil';
        document.getElementById('cfgViewsAnnouncement').value = cfg.announcement || '';

        renderAdminViewsTable();
      } catch (err) {
        showToast('❌ Views Hub lama soo rari karin: ' + err.message, true);
      }
    }

    async function downloadAdminVcf(scope) {
      try {
        const res = await fetch('/api/admin/views/download.vcf?scope=' + encodeURIComponent(scope || 'all'), { cache: 'no-store' });
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (!res.ok || ct.includes('application/json')) {
          const err = await res.json().catch(function() { return {}; });
          throw new Error(err.message || 'Contacts ma jiraan');
        }
        const text = await res.text();
        const disp = res.headers.get('content-disposition') || '';
        const m = disp.match(/filename="([^"]+)"/i);
        const filename = (m && m[1]) ? m[1] : 'CARDOSO_Views_Master.vcf';
        const blob = new Blob([text], { type: 'text/vcard;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function() { URL.revokeObjectURL(url); }, 15000);
        showToast('✅ ' + filename + ' waa soo degay!');
      } catch (err) {
        showToast('❌ ' + err.message, true);
      }
    }

    function renderAdminViewsTable() {
      const tbody = document.getElementById('adminViewsTableBody');
      if (!tbody) return;
      const q = String((document.getElementById('adminViewsSearch') || {}).value || '').trim().toLowerCase();
      const rows = (window._adminViewsContacts || []).filter(function(c) {
        if (!q) return true;
        return String(c.displayName || '').toLowerCase().includes(q) ||
          String(c.phone || '').includes(q) ||
          String(c.city || '').toLowerCase().includes(q);
      });
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);">Weli cidna kuma jirto Views Hub-ka.</td></tr>';
        return;
      }
      tbody.innerHTML = rows.map(function(c) {
        const vipBadge = c.isVip
          ? ('<span class="pill pill-amber">👑 VIP #' + c.vipPriority + (c.vipExpiresAt ? (' · ' + Math.max(0, Math.ceil((c.vipExpiresAt - Date.now()) / 86400000)) + 'd') : ' · ∞') + '</span>')
          : '<span class="pill pill-muted">Free</span>';
        const dlBadge = c.hasDownloaded
          ? '<span class="pill pill-green" style="font-size:0.7rem;">📥 Downloaded</span>'
          : '<span class="pill pill-muted" style="font-size:0.7rem;">⏳ Pending</span>';
        const verBadge = c.verifiedSaver
          ? ' <span class="pill pill-cyan" style="font-size:0.7rem;">✅ Verified</span>'
          : '';
        return '<tr>' +
          '<td><strong>' + escapeHtml(c.displayName) + '</strong><div style="font-size:0.78rem;color:var(--text-muted);">+' + escapeHtml(c.phone) + (c.tagline ? (' · ' + escapeHtml(c.tagline)) : '') + ' · Ref: ' + String(c.referralsCount || 0) + '</div></td>' +
          '<td>' + escapeHtml(c.city) + '</td>' +
          '<td><span class="pill pill-cyan">#' + c.batchNumber + '</span></td>' +
          '<td>' + vipBadge + '</td>' +
          '<td>' + dlBadge + verBadge + '</td>' +
          '<td style="display:flex;gap:0.35rem;flex-wrap:wrap;">' +
            (c.isVip
              ? ('<button class="btn btn-emerald btn-sm" onclick="renewViewsVip(' + c.id + ')">+30d</button>' +
                 '<button class="btn btn-ghost btn-sm" onclick="toggleViewsVip(' + c.id + ', false)">Unpin</button>')
              : ('<button class="btn btn-primary btn-sm" onclick="toggleViewsVip(' + c.id + ', true)">👑 Make VIP</button>')) +
            '<button class="btn btn-danger btn-sm" onclick="deleteViewsContact(' + c.id + ')">🗑️</button>' +
          '</td>' +
        '</tr>';
      }).join('');
    }

    async function submitAdminVip(e) {
      e.preventDefault();
      const btn = document.getElementById('vipAddSubmitBtn');
      btn.disabled = true;
      try {
        const res = await fetch('/api/admin/views/vip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: document.getElementById('vipAddName').value.trim(),
            countryCode: document.getElementById('vipAddCountry').value,
            phone: document.getElementById('vipAddPhone').value.trim(),
            city: document.getElementById('vipAddCity').value.trim(),
            durationDays: Number(document.getElementById('vipAddDays').value),
            vipPriority: Number(document.getElementById('vipAddPriority').value) || 1,
            tagline: document.getElementById('vipAddTagline').value.trim(),
            avatarUrl: document.getElementById('vipAddAvatarData').value || ''
          })
        });
        const data = await res.json();
        if (!res.ok || data.status !== 'ok') throw new Error(data.message || 'Failed');
        showToast(data.message || '👑 VIP waa la daray!');
        document.getElementById('vipAddName').value = '';
        document.getElementById('vipAddPhone').value = '';
        document.getElementById('vipAddTagline').value = '';
        document.getElementById('vipAddAvatarData').value = '';
        document.getElementById('vipAddPhotoFile').value = '';
        await loadAdminViewsHub();
      } catch (err) {
        showToast('❌ ' + err.message, true);
      } finally {
        btn.disabled = false;
      }
    }

    async function saveAdminViewsConfig(e) {
      e.preventDefault();
      try {
        const res = await fetch('/api/admin/views/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contactPrefix: document.getElementById('cfgViewsPrefix').value,
            batchTarget: Number(document.getElementById('cfgViewsTarget').value) || 100,
            downloadMode: document.getElementById('cfgViewsDownloadMode').value,
            ownerVipPhone: document.getElementById('cfgViewsVipPhone').value.trim(),
            vipPriceLabel: document.getElementById('cfgViewsVipPrice').value.trim(),
            announcement: document.getElementById('cfgViewsAnnouncement').value.trim()
          })
        });
        const data = await res.json();
        if (!res.ok || data.status !== 'ok') throw new Error(data.message || 'Failed');
        showToast(data.message || '✅ Dejinta waa la keydiyay!');
        await loadAdminViewsHub();
      } catch (err) {
        showToast('❌ ' + err.message, true);
      }
    }

    async function unlockCurrentViewsBatch() {
      try {
        const res = await fetch('/api/admin/views/unlock-batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const data = await res.json();
        if (!res.ok || data.status !== 'ok') throw new Error(data.message || 'Failed');
        showToast(data.message || '🔓 Batch waa la furay!');
        await loadAdminViewsHub();
      } catch (err) {
        showToast('❌ ' + err.message, true);
      }
    }

    async function startNextViewsBatch() {
      try {
        const res = await fetch('/api/admin/views/new-batch', { method: 'POST' });
        const data = await res.json();
        if (!res.ok || data.status !== 'ok') {
          showToast(data.message || '⛔ Batch-ku weli ma buuxsamin', true);
          return;
        }
        showToast(data.message || '📦 Batch cusub waa la bilaabay!');
        await loadAdminViewsHub();
      } catch (err) {
        showToast('❌ ' + err.message, true);
      }
    }

    async function toggleViewsVip(id, makeVip) {
      try {
        const res = await fetch('/api/admin/views/contacts/' + id, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isVip: makeVip, durationDays: makeVip ? 30 : 0, vipPriority: 10 })
        });
        const data = await res.json();
        if (!res.ok || data.status !== 'ok') throw new Error(data.message || 'Failed');
        showToast(makeVip ? '👑 VIP Pinned waa la shiday (+30d)!' : 'ℹ️ VIP waa laga saaray');
        await loadAdminViewsHub();
      } catch (err) {
        showToast('❌ ' + err.message, true);
      }
    }

    async function renewViewsVip(id) {
      try {
        const res = await fetch('/api/admin/views/contacts/' + id, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isVip: true, durationDays: 30 })
        });
        const data = await res.json();
        if (!res.ok || data.status !== 'ok') throw new Error(data.message || 'Failed');
        showToast('✅ +30 maalmood oo VIP ah waa la kordhiyay!');
        await loadAdminViewsHub();
      } catch (err) {
        showToast('❌ ' + err.message, true);
      }
    }

    async function deleteViewsContact(id) {
      if (!confirm('Ma hubtaa inaad tirtirto qofkan?')) return;
      try {
        await fetch('/api/admin/views/contacts/' + id, { method: 'DELETE' });
        showToast('🗑️ Waa la tirtiray');
        await loadAdminViewsHub();
      } catch (err) {
        showToast('❌ ' + err.message, true);
      }
    }

    loadAdminOverview();
    setInterval(loadAdminOverview, 6000);
  </script>
</body>
</html>`;
}

function escapeAdminHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
