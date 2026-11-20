import { COMMON_CLIENT_JS, SAAS_STYLES } from './styles.js';

export function renderAdminDashboardHTML(adminLabel: string = 'Owner Admin'): string {
  return `<!DOCTYPE html>
<html lang="so">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CARDOSO AI — Super Admin SaaS Control Center</title>
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
            <span>👥 Dooro Kooxaha (WhatsApp Groups)</span>
            <button type="button" class="btn btn-ghost btn-sm" onclick="loadGroupsForVoice()">🔄 Refresh</button>
          </div>
          <div class="card-sub">Dooro hal ama dhowr kooxood oo aad rabto inaad codka tooska ah ugu dirto:</div>

          <div style="margin-bottom:0.75rem;display:flex;align-items:center;gap:0.5rem;padding:0.4rem 0.6rem;background:rgba(6,182,212,0.1);border-radius:8px;">
            <input type="checkbox" id="selectAllVoiceGroups" onchange="toggleSelectAllGroups(this)" style="cursor:pointer;width:18px;height:18px;" />
            <label for="selectAllVoiceGroups" style="font-size:0.85rem;font-weight:700;cursor:pointer;margin:0;">Dooro Dhammaan Kooxaha (Select All)</label>
          </div>

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
              <button type="button" class="btn btn-primary btn-sm" id="btnAudioModeFile" onclick="setAudioSourceMode('file')">📁 Soo Geli Fayl Cod ah (MP3/OGG)</button>
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

    function switchAdminTab(name, btn) {
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      const pane = document.getElementById('admin-tab-' + name);
      if (pane) pane.classList.add('active');
      if (btn) btn.classList.add('active');
      if (name === 'owner') { loadOwnerConfig(); loadOwnerStatus(); loadOwnerLeads(); }
      if (name === 'admins') { loadAdminUsers(); loadPromos(); }
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
    var _voiceAudioMode = 'file'; // 'file' or 'tts'

    function setAudioSourceMode(mode) {
      _voiceAudioMode = mode;
      var fileBox = document.getElementById('voiceBoxFile');
      var ttsBox = document.getElementById('voiceBoxTTS');
      var btnFile = document.getElementById('btnAudioModeFile');
      var btnTts = document.getElementById('btnAudioModeTTS');
      if (fileBox) fileBox.style.display = mode === 'file' ? 'block' : 'none';
      if (ttsBox) ttsBox.style.display = mode === 'tts' ? 'block' : 'none';
      if (btnFile) btnFile.className = mode === 'file' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
      if (btnTts) btnTts.className = mode === 'tts' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
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

    function toggleSelectAllGroups(cb) {
      document.querySelectorAll('.voice-group-cb').forEach(function(el) {
        el.checked = cb.checked;
      });
    }

    async function loadGroupsForVoice() {
      const box = document.getElementById('voiceGroupsListBox');
      if (!box) return;
      box.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;">Waa la soo rarayaa kooxaha...</div>';
      try {
        const res = await fetch('/api/owner/groups');
        const data = await res.json();
        if (!data.groups || data.groups.length === 0) {
          box.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;">Koox la heli waayay. WhatsApp ma xiran yahay ama kooxo kuma jiro?</div>';
          return;
        }
        box.innerHTML = data.groups.map(function(g) {
          const checked = g.isManaged ? 'checked' : '';
          const badge = g.isManaged
            ? ' <span class="pill pill-green" style="font-size:0.7rem;padding:0.1rem 0.5rem;">Managed</span>'
            : '';
          return '<label style="display:flex;align-items:center;gap:0.6rem;padding:0.5rem;border-radius:8px;cursor:pointer;border:1px solid var(--card-border);background:rgba(255,255,255,0.03);">' +
            '<input type="checkbox" class="voice-group-cb" value="' + escapeAdminHtml(g.id) + '" style="cursor:pointer;width:16px;height:16px;" ' + checked + ' />' +
            '<span style="flex:1;"><strong>' + escapeAdminHtml(g.name || g.id) + '</strong>' + badge +
            '<br/><span style="font-size:0.75rem;color:var(--text-muted);">' + escapeAdminHtml(g.id) + ' · ' + (g.participantsCount || '?') + ' xubnood</span></span>' +
            '</label>';
        }).join('');
      } catch (err) {
        box.innerHTML = '<div style="color:#f87171;font-size:0.85rem;">Cilad ayaa dhacday: ' + err.message + '</div>';
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
      } else {
        const text = document.getElementById('voiceTextInput').value.trim();
        if (!text) {
          showToast('❌ Fadlan qor qoraalka la doonayo in cod loo beddelo', true);
          return;
        }
        body.text = text;
      }

      btn.disabled = true;
      btn.textContent = '⏳ Waa la dirayaa codka...';
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
