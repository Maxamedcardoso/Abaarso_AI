import { COMMON_CLIENT_JS, SAAS_STYLES } from './styles.js';

export function renderAdminLoginHTML(): string {
  return `<!DOCTYPE html>
<html lang="so">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CARDOSO AI — Super Admin Studio Login</title>
  <style>${SAAS_STYLES}</style>
</head>
<body>
  <header class="topbar">
    <div class="brand">
      <div class="brand-mark" style="background:linear-gradient(135deg, #8b5cf6, #3b82f6);">👑</div>
      <div>
        <h1>CARDOSO <span>AI</span> Admin Studio</h1>
        <p>Albaabka Gaarka ah ee Mulkiilaha &amp; Maamulka Guud</p>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:0.65rem;">
      <a href="/portal" class="btn btn-ghost btn-sm">🚪 Bogga Macmiisha (/portal)</a>
    </div>
  </header>

  <main class="container-narrow" style="max-width:520px;margin-top:2.5rem;">
    <div style="text-align:center;margin-bottom:2rem;">
      <div class="pill pill-violet" style="margin-bottom:0.85rem;font-size:0.85rem;padding:0.35rem 0.9rem;">
        🔒 PRIVATE ADMIN CONSOLE
      </div>
      <h2 style="font-size:1.85rem;font-weight:800;letter-spacing:-0.02em;margin-bottom:0.5rem;">
        Galitaanka Mulkiilaha
      </h2>
      <p style="color:var(--text-muted);font-size:0.9rem;">
        Fadlan geli macluumaadkaaga maamul si aad u furato Dashboard-ka Guud.
      </p>
    </div>

    <section class="glass-card" style="border-color:rgba(139,92,246,0.35);box-shadow:0 12px 36px rgba(0,0,0,0.45);">
      <div class="card-title" style="color:#c084fc;">👑 Admin Authentication</div>
      <div class="card-sub">Geli Username-kaaga (admin ama lambarkaaga) iyo Studio Password-ka.</div>

      <form onsubmit="handleAdminLogin(event)">
        <div class="form-group">
          <label class="field-label">Username ama Lambarka Admin-ka</label>
          <input class="field" id="adminUser" value="admin" required placeholder="admin ama 0634949642" autocomplete="username" />
        </div>
        <div class="form-group">
          <label class="field-label">Studio Password (Furaha Maamulka)</label>
          <input class="field" id="adminPass" type="password" required placeholder="Geli password-kaaga..." autocomplete="current-password" />
        </div>
        <button class="btn btn-primary" id="adminSubmitBtn" type="submit" style="width:100%;padding:0.9rem;font-weight:700;font-size:1rem;background:linear-gradient(135deg, #8b5cf6, #06b6d4);">
          👑 Fur Owner Admin Studio
        </button>
      </form>
    </section>

    <div style="text-align:center;margin-top:2rem;font-size:0.85rem;color:var(--text-muted);">
      Ma tihid maamule? <a href="/portal" style="color:var(--primary);font-weight:700;text-decoration:none;">U gudub Bogga Macmiisha ➔</a>
    </div>
  </main>

  <div id="toastBanner" class="toast-banner"></div>

  <script>
    ${COMMON_CLIENT_JS}

    async function handleAdminLogin(e) {
      e.preventDefault();
      var btn = document.getElementById('adminSubmitBtn');
      btn.disabled = true;
      btn.textContent = "⏳ Waa la hubinayaa...";

      var user = document.getElementById('adminUser').value.trim();
      var pass = document.getElementById('adminPass').value.trim();

      try {
        var res = await fetch('/api/public/portal-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: user, pin: pass })
        });
        var data = await res.json();
        if (!res.ok || data.status !== 'ok' || !data.isAdmin) {
          showToast('❌ ' + (data.message || 'Username-ka ama Furaha sirta ah ma saxna'), true);
          return;
        }
        showToast('✅ Ku soo dhawoow Mulkiile! Waxaa laguu furayaa Admin Studio...');
        setTimeout(function() {
          window.location.href = data.portalUrl || '/';
        }, 300);
      } catch (err) {
        showToast("❌ Xidhiidhka server-ka ayaa go'an", true);
      } finally {
        btn.disabled = false;
        btn.textContent = "👑 Fur Owner Admin Studio";
      }
    }
  </script>
</body>
</html>`;
}
