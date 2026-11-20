import { COMMON_CLIENT_JS, SAAS_STYLES } from './styles.js';

export function renderPortalLoginHTML(): string {
  return `<!DOCTYPE html>
<html lang="so">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CARDOSO AI — Galitaanka Dashboard-ka Macmiilka (/portal)</title>
  <style>${SAAS_STYLES}</style>
</head>
<body>
  <header class="topbar">
    <div class="brand">
      <div class="brand-mark">🔑</div>
      <div>
        <h1>CARDOSO <span>AI</span> Portal</h1>
        <p>Dib u Fur Dashboard-kaaga adigoon mar labaad isdiiwaangelin</p>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:0.65rem;">
      <a href="/join" class="btn btn-ghost btn-sm">📝 Isdiiwaangeli (Cusub)</a>
    </div>
  </header>

  <main class="container-narrow" style="max-width:620px;">
    <div style="text-align:center;margin-bottom:1.75rem;">
      <div class="pill pill-cyan" style="margin-bottom:0.75rem;">🚀 Horay Ma Isku Diiwaangelisay?</div>
      <h2 style="font-size:1.75rem;font-weight:800;letter-spacing:-0.02em;margin-bottom:0.5rem;">
        Fur Dashboard-ka Bot-kaaga WhatsApp
      </h2>
      <p style="color:var(--text-muted);font-size:0.9rem;">
        Ku soo gal <strong>Lambarkaaga + PIN-ka</strong> ama dalbo <strong>6-Lambar oo WhatsApp-kaaga ku soo dhacaya</strong>.
      </p>
    </div>

    <nav class="tabs-bar" style="justify-content:center;">
      <button class="tab-btn active" onclick="switchLoginTab('admin', this)">👑 Owner / Admin</button>
      <button class="tab-btn" onclick="switchLoginTab('pin', this)">🔑 Macmiilka (PIN)</button>
      <button class="tab-btn" onclick="switchLoginTab('otp', this)">📲 WhatsApp OTP</button>
    </nav>

    <!-- METHOD 0: OWNER / ADMIN STUDIO LOGIN -->
    <section id="login-tab-admin" class="glass-card tab-pane active">
      <div class="card-title">👑 Galitaanka Mulkiilaha (Owner Super Admin)</div>
      <div class="card-sub">Ku soo gal Username-ka (admin ama lambarkaaga) iyo Studio Password-kaaga.</div>

      <form onsubmit="loginAsAdmin(event)">
        <div class="form-group">
          <label class="field-label">Username ama Lambarka WhatsApp</label>
          <input class="field" id="adminUserField" value="admin" required placeholder="admin ama 0634949642" />
        </div>
        <div class="form-group">
          <label class="field-label">Studio Password (Furaha Maamulka)</label>
          <input class="field" id="adminPassField" type="password" required placeholder="Geli password-kaaga..." />
        </div>
        <button class="btn btn-primary" id="adminLoginBtn" type="submit" style="width:100%;padding:0.85rem;">
          👑 Fur Owner Admin Studio
        </button>
      </form>
    </section>

    <!-- METHOD 1: PHONE + PIN LOGIN -->
    <section id="login-tab-pin" class="glass-card tab-pane">
      <div class="card-title">🔑 Ku Soo Gal Lambarkaaga &amp; PIN-ka</div>
      <div class="card-sub">Geli lambarkii aad isku diiwaangelisay iyo PIN-kii aad samaysatay.</div>

      <form onsubmit="loginWithPin(event)">
        <div class="form-group">
          <label class="field-label">Lambarkaaga WhatsApp</label>
          <input class="field" id="pinPhone" required placeholder="Tusaale: 0634xxxxxx ama 252634xxxxxx" />
        </div>
        <div class="form-group">
          <label class="field-label">Dashboard PIN / Password</label>
          <input class="field" id="pinCode" type="password" required placeholder="Geli PIN-kaaga..." />
        </div>
        <button class="btn btn-primary" id="pinLoginBtn" type="submit" style="width:100%;padding:0.85rem;">
          🚀 Fur Dashboard-kayga
        </button>
      </form>
    </section>

    <!-- METHOD 2: WHATSAPP OTP LOGIN -->
    <section id="login-tab-otp" class="glass-card tab-pane">
      <div class="card-title">📲 Soo Dir Code-ka Xaqiijinta (WhatsApp OTP)</div>
      <div class="card-sub">Haddii aadan samaysan PIN ama aad ilowday, geli lambarkaaga si 6-lambar WhatsApp-ka loogu soo diro.</div>

      <div class="form-group">
        <label class="field-label">Lambarkaaga WhatsApp</label>
        <div style="display:flex;gap:0.5rem;">
          <input class="field" id="otpPhone" placeholder="0634xxxxxx ama 252634xxxxxx" />
          <button class="btn btn-primary btn-sm" id="sendOtpBtn" onclick="requestOtp()">📤 Soo Dir</button>
        </div>
      </div>

      <div id="otpVerifyBox" style="display:none;margin-top:1rem;padding-top:1rem;border-top:1px solid var(--card-border);">
        <div class="form-group">
          <label class="field-label">Geli 6-da Lambar ee WhatsApp-kaaga Ku Soo Dhacday</label>
          <input class="field" id="otpCodeInput" placeholder="Tusaale: 482910" maxlength="8" />
        </div>
        <button class="btn btn-emerald" id="verifyOtpBtn" onclick="verifyOtp()" style="width:100%;">
          ✅ Xaqiiji &amp; Fur Dashboard-ka
        </button>
      </div>

      <div id="otpStatusBox" style="display:none;margin-top:0.9rem;padding:0.85rem;border-radius:10px;background:rgba(6,182,212,0.1);border:1px solid rgba(6,182,212,0.35);font-size:0.85rem;"></div>
    </section>

    <div style="text-align:center;margin-top:1.25rem;font-size:0.85rem;color:var(--text-muted);">
      Ma tihid macmiil hore? <a href="/join" style="color:var(--primary);font-weight:700;text-decoration:none;">Halkan iska diiwaangeli ➔</a>
    </div>
  </main>

  <div id="toastBanner" class="toast-banner"></div>

  <script>
    ${COMMON_CLIENT_JS}

    function switchLoginTab(name, btn) {
      document.querySelectorAll('.tab-pane').forEach(function(p) { p.classList.remove('active'); });
      document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
      var pane = document.getElementById('login-tab-' + name);
      if (pane) pane.classList.add('active');
      if (btn) btn.classList.add('active');
    }

    async function loginAsAdmin(e) {
      e.preventDefault();
      var btn = document.getElementById('adminLoginBtn');
      btn.disabled = true;
      btn.textContent = "⏳ Waa la hubinayaa...";
      try {
        var res = await fetch('/api/public/portal-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: document.getElementById('adminUserField').value.trim(),
            pin: document.getElementById('adminPassField').value.trim()
          })
        });
        var data = await res.json();
        if (!res.ok || data.status !== 'ok') {
          showToast('❌ ' + (data.message || 'Furaha sirta ah ama Username-ka ma saxna'), true);
          return;
        }
        showToast('✅ Ku soo dhawoow Mulkiile! Waxaa laguu wareejinayaa Admin Studio...');
        window.location.href = data.portalUrl || '/';
      } catch (err) {
        showToast("❌ Xidhiidhka server-ka ayaa go'an", true);
      } finally {
        btn.disabled = false;
        btn.textContent = "👑 Fur Owner Admin Studio";
      }
    }

    async function loginWithPin(e) {
      e.preventDefault();
      var btn = document.getElementById('pinLoginBtn');
      btn.disabled = true;
      btn.textContent = "⏳ Waa la hubinayaa...";
      try {
        var res = await fetch('/api/public/portal-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: document.getElementById('pinPhone').value.trim(),
            pin: document.getElementById('pinCode').value.trim()
          })
        });
        var data = await res.json();
        if (!res.ok || data.status !== 'ok') {
          showToast('❌ ' + (data.message || 'Lambarka ama PIN-ka ma saxna'), true);
          return;
        }
        showToast('✅ Waa lagu helay! Waxaa laguu wareejinayaa Dashboard-kaaga...');
        window.location.href = data.portalUrl;
      } catch (err) {
        showToast("❌ Xidhiidhka server-ka ayaa go'an", true);
      } finally {
        btn.disabled = false;
        btn.textContent = "🚀 Fur Dashboard-kayga";
      }
    }

    async function requestOtp() {
      var phone = document.getElementById('otpPhone').value.trim();
      if (!phone) { showToast('❌ Fadlan geli lambarkaaga', true); return; }
      var btn = document.getElementById('sendOtpBtn');
      btn.disabled = true;
      btn.textContent = "⏳...";
      try {
        var res = await fetch('/api/public/portal-otp/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: phone })
        });
        var data = await res.json();
        var box = document.getElementById('otpStatusBox');
        box.style.display = 'block';
        box.textContent = data.message || 'Done';
        if (res.ok && data.sent) {
          document.getElementById('otpVerifyBox').style.display = 'block';
          showToast('📲 Code-ka xaqiijinta WhatsApp-kaaga ayaa loo diray!');
        } else {
          showToast(data.message || 'Lama diri karin OTP', !res.ok);
        }
      } catch (err) {
        showToast("❌ Xidhiidhka server-ka ayaa go'an", true);
      } finally {
        btn.disabled = false;
        btn.textContent = "📤 Soo Dir";
      }
    }

    async function verifyOtp() {
      var phone = document.getElementById('otpPhone').value.trim();
      var code = document.getElementById('otpCodeInput').value.trim();
      if (!phone || !code) return;
      var btn = document.getElementById('verifyOtpBtn');
      btn.disabled = true;
      try {
        var res = await fetch('/api/public/portal-otp/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: phone, code: code })
        });
        var data = await res.json();
        if (!res.ok || data.status !== 'ok') {
          showToast('❌ ' + (data.message || 'Code-ku ma saxna'), true);
          return;
        }
        window.location.href = data.portalUrl;
      } finally {
        btn.disabled = false;
      }
    }
  </script>
</body>
</html>`;
}

