export const SAAS_STYLES = `
  :root {
    --bg: #070b14;
    --bg-soft: #0d1424;
    --card-bg: rgba(17, 25, 44, 0.78);
    --card-border: rgba(148, 163, 184, 0.14);
    --card-highlight: rgba(56, 189, 248, 0.24);
    --primary: #06b6d4;
    --primary-strong: #0891b2;
    --accent: #10b981;
    --violet: #8b5cf6;
    --warning: #f59e0b;
    --danger: #ef4444;
    --text-main: #f8fafc;
    --text-muted: #94a3b8;
    --input-bg: rgba(8, 13, 25, 0.85);
  }

  * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif; }

  body {
    background:
      radial-gradient(ellipse 80% 50% at 50% -10%, rgba(6, 182, 212, 0.18), transparent),
      radial-gradient(ellipse 60% 40% at 90% 10%, rgba(139, 92, 246, 0.12), transparent),
      var(--bg);
    color: var(--text-main);
    min-height: 100vh;
    padding-bottom: 4rem;
    line-height: 1.5;
  }

  header.topbar {
    position: sticky;
    top: 0;
    z-index: 50;
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 2rem;
    background: rgba(7, 11, 20, 0.84);
    backdrop-filter: blur(14px);
    border-bottom: 1px solid var(--card-border);
  }

  .brand { display: flex; align-items: center; gap: 0.85rem; }
  .brand-mark {
    width: 44px; height: 44px; border-radius: 13px;
    background: linear-gradient(135deg, #06b6d4, #3b82f6);
    display: flex; align-items: center; justify-content: center;
    font-size: 1.35rem; font-weight: 800; color: #fff;
    box-shadow: 0 6px 20px rgba(6, 182, 212, 0.35);
  }
  .brand h1 { font-size: 1.2rem; font-weight: 800; letter-spacing: -0.02em; }
  .brand h1 span { color: var(--primary); }
  .brand p { font-size: 0.78rem; color: var(--text-muted); }

  .container { max-width: 1280px; margin: 0 auto; padding: 1.75rem 1.25rem; }
  .container-narrow { max-width: 980px; margin: 0 auto; padding: 2rem 1.25rem; }

  .glass-card {
    background: var(--card-bg);
    backdrop-filter: blur(14px);
    border: 1px solid var(--card-border);
    border-radius: 16px;
    padding: 1.35rem;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
  }

  .card-title {
    font-size: 1.05rem;
    font-weight: 700;
    margin-bottom: 0.35rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.65rem;
  }

  .card-sub { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1.1rem; }

  .grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.25rem; }
  .grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; }
  .grid-4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1rem; }
  @media (max-width: 960px) {
    .grid-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .grid-3, .grid-2 { grid-template-columns: 1fr; }
    header.topbar { padding: 0.9rem 1rem; }
  }
  @media (max-width: 520px) {
    .grid-4 { grid-template-columns: 1fr; }
  }

  .kpi-box {
    background: linear-gradient(160deg, rgba(22, 33, 58, 0.85), rgba(11, 18, 34, 0.9));
    border: 1px solid var(--card-border);
    border-radius: 14px;
    padding: 1.1rem 1.2rem;
  }
  .kpi-label { font-size: 0.78rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  .kpi-val { font-size: 1.85rem; font-weight: 800; margin-top: 0.25rem; color: #fff; }
  .kpi-foot { font-size: 0.78rem; color: var(--text-muted); margin-top: 0.25rem; }

  .pill {
    display: inline-flex; align-items: center; gap: 0.4rem;
    padding: 0.32rem 0.78rem; border-radius: 999px;
    font-size: 0.76rem; font-weight: 700; white-space: nowrap;
  }
  .pill-green { background: rgba(16, 185, 129, 0.16); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35); }
  .pill-amber { background: rgba(245, 158, 11, 0.16); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.35); }
  .pill-red { background: rgba(239, 68, 68, 0.16); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.35); }
  .pill-cyan { background: rgba(6, 182, 212, 0.16); color: #22d3ee; border: 1px solid rgba(6, 182, 212, 0.35); }
  .pill-violet { background: rgba(139, 92, 246, 0.18); color: #c4b5fd; border: 1px solid rgba(139, 92, 246, 0.35); }
  .pill-muted { background: rgba(148, 163, 184, 0.14); color: #cbd5e1; border: 1px solid rgba(148, 163, 184, 0.25); }

  .tabs-bar {
    display: flex; flex-wrap: wrap; gap: 0.5rem;
    margin-bottom: 1.4rem;
    padding: 0.4rem;
    background: rgba(12, 18, 33, 0.85);
    border: 1px solid var(--card-border);
    border-radius: 14px;
  }
  .tab-btn {
    border: none; background: transparent; color: var(--text-muted);
    padding: 0.6rem 1.05rem; border-radius: 10px;
    font-size: 0.86rem; font-weight: 700; cursor: pointer; transition: all 0.2s;
  }
  .tab-btn:hover { color: #fff; background: rgba(255, 255, 255, 0.05); }
  .tab-btn.active {
    background: linear-gradient(135deg, var(--primary), #2563eb);
    color: #fff;
    box-shadow: 0 4px 14px rgba(6, 182, 212, 0.28);
  }
  .tab-pane { display: none; }
  .tab-pane.active { display: block; }

  label.field-label { display: block; font-size: 0.8rem; font-weight: 600; color: #cbd5e1; margin-bottom: 0.35rem; }
  input.field, select.field, textarea.field {
    width: 100%; padding: 0.72rem 0.9rem;
    background: var(--input-bg);
    border: 1px solid var(--card-border);
    border-radius: 10px;
    color: var(--text-main);
    font-size: 0.9rem;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  input.field:focus, select.field:focus, textarea.field:focus {
    border-color: var(--primary);
    box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.16);
  }
  textarea.field { min-height: 110px; resize: vertical; }
  .form-group { margin-bottom: 0.95rem; }

  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 0.45rem;
    border: none; border-radius: 10px; padding: 0.65rem 1.15rem;
    font-size: 0.86rem; font-weight: 700; cursor: pointer; transition: all 0.18s;
    text-decoration: none;
  }
  .btn:disabled { opacity: 0.55; cursor: not-allowed; }
  .btn-primary { background: linear-gradient(135deg, #06b6d4, #2563eb); color: #fff; }
  .btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(6, 182, 212, 0.3); }
  .btn-emerald { background: linear-gradient(135deg, #10b981, #059669); color: #fff; }
  .btn-emerald:hover:not(:disabled) { transform: translateY(-1px); }
  .btn-danger { background: rgba(239, 68, 68, 0.18); color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.35); }
  .btn-danger:hover:not(:disabled) { background: rgba(239, 68, 68, 0.3); }
  .btn-ghost { background: rgba(148, 163, 184, 0.12); color: #e2e8f0; border: 1px solid var(--card-border); }
  .btn-ghost:hover:not(:disabled) { background: rgba(148, 163, 184, 0.22); }
  .btn-sm { padding: 0.42rem 0.72rem; font-size: 0.78rem; border-radius: 8px; }

  .table-wrap { overflow-x: auto; border-radius: 12px; border: 1px solid var(--card-border); }
  table.saas-table { width: 100%; border-collapse: collapse; font-size: 0.84rem; }
  table.saas-table th {
    text-align: left; padding: 0.75rem 0.9rem;
    background: rgba(10, 16, 30, 0.9);
    color: var(--text-muted); font-weight: 700; font-size: 0.75rem; text-transform: uppercase;
    border-bottom: 1px solid var(--card-border);
  }
  table.saas-table td {
    padding: 0.8rem 0.9rem;
    border-bottom: 1px solid rgba(148, 163, 184, 0.08);
    vertical-align: middle;
  }
  table.saas-table tr:hover td { background: rgba(255, 255, 255, 0.02); }

  .pairing-code-box {
    background: rgba(6, 182, 212, 0.08);
    border: 1px dashed rgba(6, 182, 212, 0.45);
    border-radius: 14px;
    padding: 1.25rem;
    text-align: center;
    margin-top: 1rem;
  }
  .pairing-digits {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 2.15rem;
    font-weight: 800;
    letter-spacing: 0.18em;
    color: #22d3ee;
    margin: 0.4rem 0;
  }

  .progress-track { height: 8px; background: rgba(148, 163, 184, 0.14); border-radius: 999px; overflow: hidden; margin-top: 0.35rem; }
  .progress-fill { height: 100%; background: linear-gradient(90deg, #06b6d4, #10b981); border-radius: 999px; transition: width 0.3s ease; }

  .role-card {
    background: rgba(15, 23, 42, 0.72);
    border: 2px solid var(--card-border);
    border-radius: 16px;
    padding: 1.2rem;
    cursor: pointer;
    transition: all 0.2s ease;
    position: relative;
  }
  .role-card:hover { border-color: rgba(6, 182, 212, 0.5); transform: translateY(-2px); }
  .role-card.selected {
    border-color: var(--primary);
    background: linear-gradient(160deg, rgba(6, 182, 212, 0.16), rgba(37, 99, 235, 0.12));
    box-shadow: 0 10px 26px rgba(6, 182, 212, 0.2);
  }

  .toast-banner {
    position: fixed; bottom: 1.5rem; right: 1.5rem; z-index: 200;
    padding: 0.85rem 1.25rem; border-radius: 12px;
    background: #0f172a; border: 1px solid var(--primary);
    color: #fff; font-weight: 600; font-size: 0.88rem;
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.45);
    display: none; max-width: 380px;
  }
  .toast-banner.show { display: block; animation: fadeInUp 0.2s ease; }
  @keyframes fadeInUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

  .modal-backdrop {
    position: fixed; inset: 0; z-index: 150;
    background: rgba(2, 6, 15, 0.78); backdrop-filter: blur(6px);
    display: none; align-items: center; justify-content: center; padding: 1rem;
  }
  .modal-backdrop.open { display: flex; }
  .modal-box { max-width: 600px; width: 100%; max-height: 90vh; overflow-y: auto; }
`;

export const COMMON_CLIENT_JS = `
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  let _toastTimer = null;
  function showToast(msg, isError) {
    const el = document.getElementById('toastBanner');
    if (!el) return;
    el.textContent = msg;
    el.style.borderColor = isError ? '#ef4444' : '#06b6d4';
    el.classList.add('show');
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove('show'), 4200);
  }

  async function copyText(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      showToast('✅ ' + (label || 'Waa la koobiyey!'));
    } catch {
      showToast(text);
    }
  }

  function formatDaysLeft(expiresAt) {
    if (!expiresAt) return 'Aan dhicin (Lifetime)';
    const diff = expiresAt - Date.now();
    if (diff <= 0) return 'Wuu dhammaaday';
    const days = Math.ceil(diff / (24 * 60 * 60 * 1000));
    return days + ' maalmood';
  }

  function categoryBadge(cat) {
    if (cat === 'business') return '<span class="pill pill-amber">🛍️ Ganacsato</span>';
    if (cat === 'education') return '<span class="pill pill-violet">🎓 Waxbarasho</span>';
    return '<span class="pill pill-cyan">👤 Qof Caadi ah</span>';
  }

  function statusBadge(st) {
    if (st === 'active') return '<span class="pill pill-green">● ACTIVE</span>';
    if (st === 'pending') return '<span class="pill pill-amber">⏳ PENDING</span>';
    if (st === 'expired') return '<span class="pill pill-red">⏰ EXPIRED</span>';
    if (st === 'suspended') return '<span class="pill pill-red">⛔ SUSPENDED</span>';
    return '<span class="pill pill-muted">' + escapeHtml(st) + '</span>';
  }
`;

