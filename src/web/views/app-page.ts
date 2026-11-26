import { PWA_HEAD_TAGS } from '../pwa-assets.js';
import { COMMON_CLIENT_JS } from './styles.js';
import {
  renderLiveCallClientJS,
  renderLiveCallPanelCSS,
  renderLiveCallPanelHTML,
} from '../../live-call/web/live-call-panel.js';

export interface RenderAppPageOptions {
  botName?: string;
  businessName?: string;
  tenantId?: string;
  tenantToken?: string;
  mode?: string;
}

function escapeAttr(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderPwaAppHTML(options?: RenderAppPageOptions): string {
  const initialBotName = options?.botName || 'CARDOSO AI';
  const initialSub = options?.businessName || 'Kaaliyahaaga AI — Af-Soomaali & English';
  const safeTenantId = JSON.stringify(options?.tenantId || '');
  const safeTenantToken = JSON.stringify(options?.tenantToken || '');
  const safeMode = JSON.stringify(options?.mode || 'baileys');

  return `<!DOCTYPE html>
<html lang="so" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>${escapeAttr(initialBotName)} — Smart App</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  ${PWA_HEAD_TAGS}
  <script>
    (function() {
      try {
        var t = localStorage.getItem('cardoso_app_theme');
        if (t === 'light' || t === 'dark') {
          document.documentElement.setAttribute('data-theme', t);
        }
      } catch (e) {}
    })();
  </script>
  <style>
    :root,
    html[data-theme="dark"] {
      --bg: #090c12;
      --bg-subtle: #0e131d;
      --bg-surface: #131926;
      --bg-elevated: #192132;
      --bg-glass: rgba(11, 15, 23, 0.84);
      --bg-hover: rgba(255, 255, 255, 0.055);
      --border: rgba(255, 255, 255, 0.085);
      --border-strong: rgba(255, 255, 255, 0.16);
      --primary: #06b6d4;
      --primary-2: #2563eb;
      --primary-soft: rgba(6, 182, 212, 0.13);
      --primary-text: #67e8f9;
      --accent: #10b981;
      --accent-soft: rgba(16, 185, 129, 0.14);
      --violet: #8b5cf6;
      --amber: #f59e0b;
      --danger: #ef4444;
      --danger-soft: rgba(239, 68, 68, 0.14);
      --text: #f3f6fb;
      --text-2: #cbd5e1;
      --muted: #8b98ad;
      --user-bubble: linear-gradient(135deg, #0891b2, #2563eb);
      --ai-bubble: #131926;
      --code-bg: #070a10;
      --shadow-sm: 0 2px 10px rgba(0, 0, 0, 0.22);
      --shadow-md: 0 12px 32px rgba(0, 0, 0, 0.36);
      --aura-1: rgba(6, 182, 212, 0.11);
      --aura-2: rgba(99, 102, 241, 0.09);
      --safe-top: env(safe-area-inset-top, 0px);
      --safe-bottom: env(safe-area-inset-bottom, 0px);
      color-scheme: dark;
    }

    html[data-theme="light"] {
      --bg: #f6f8fb;
      --bg-subtle: #ffffff;
      --bg-surface: #ffffff;
      --bg-elevated: #f1f5f9;
      --bg-glass: rgba(255, 255, 255, 0.86);
      --bg-hover: rgba(15, 23, 42, 0.05);
      --border: rgba(15, 23, 42, 0.09);
      --border-strong: rgba(15, 23, 42, 0.17);
      --primary: #0891b2;
      --primary-2: #2563eb;
      --primary-soft: rgba(8, 145, 178, 0.1);
      --primary-text: #0e7490;
      --accent: #059669;
      --accent-soft: rgba(5, 150, 105, 0.1);
      --violet: #7c3aed;
      --amber: #d97706;
      --danger: #dc2626;
      --danger-soft: rgba(220, 38, 38, 0.1);
      --text: #0f172a;
      --text-2: #334155;
      --muted: #64748b;
      --user-bubble: linear-gradient(135deg, #0891b2, #2563eb);
      --ai-bubble: #ffffff;
      --code-bg: #0f172a;
      --shadow-sm: 0 2px 10px rgba(15, 23, 42, 0.05);
      --shadow-md: 0 12px 30px rgba(15, 23, 42, 0.1);
      --aura-1: rgba(6, 182, 212, 0.08);
      --aura-2: rgba(37, 99, 235, 0.06);
      color-scheme: light;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: 'Plus Jakarta Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      -webkit-tap-highlight-color: transparent;
    }

    html, body {
      height: 100%;
      height: 100dvh;
      width: 100%;
      overflow: hidden;
      background:
        radial-gradient(ellipse 75% 42% at 50% -12%, var(--aura-1), transparent),
        radial-gradient(ellipse 50% 35% at 96% 8%, var(--aura-2), transparent),
        var(--bg);
      color: var(--text);
      -webkit-font-smoothing: antialiased;
    }

    svg.ico-svg {
      width: 18px;
      height: 18px;
      stroke: currentColor;
      fill: none;
      stroke-width: 1.9;
      stroke-linecap: round;
      stroke-linejoin: round;
      flex-shrink: 0;
    }
    svg.ico-sm { width: 16px; height: 16px; }
    svg.ico-lg { width: 20px; height: 20px; }

    /* Custom subtle scrollbars */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 999px; }

    .app-shell {
      display: flex;
      height: 100%;
      width: 100%;
      overflow: hidden;
    }

    /* ─── Modern Sidebar (Desktop) ─── */
    .sidebar {
      width: 264px;
      flex-shrink: 0;
      background: var(--bg-subtle);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      padding: 1rem 0.85rem;
      gap: 0.75rem;
      height: 100%;
      overflow-y: auto;
      overscroll-behavior: contain;
      transition: width 0.22s ease, padding 0.22s ease;
    }
    .sidebar.collapsed {
      width: 0;
      padding-left: 0;
      padding-right: 0;
      border-right: none;
      overflow: hidden;
    }

    .side-brand {
      display: flex;
      align-items: center;
      gap: 0.7rem;
      padding: 0.25rem 0.35rem 0.35rem;
      flex-shrink: 0;
    }
    .side-brand img {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      box-shadow: 0 4px 14px rgba(6, 182, 212, 0.24);
      flex-shrink: 0;
    }
    .side-brand-meta { min-width: 0; flex: 1; }
    .side-brand h1 {
      font-size: 0.98rem;
      font-weight: 800;
      letter-spacing: -0.025em;
      line-height: 1.15;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .side-brand h1 span { color: var(--primary); }
    .side-brand-sub {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.72rem;
      color: var(--muted);
      margin-top: 0.14rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .dot-online {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-soft);
      flex-shrink: 0;
    }

    .new-chat-btn {
      width: 100%;
      border: 1px solid var(--border-strong);
      background: var(--bg-surface);
      color: var(--text);
      border-radius: 12px;
      padding: 0.68rem 0.9rem;
      font-weight: 700;
      font-size: 0.84rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      flex-shrink: 0;
      box-shadow: var(--shadow-sm);
      transition: background 0.16s, border-color 0.16s, transform 0.16s;
    }
    .new-chat-btn:hover {
      border-color: var(--primary);
      background: var(--primary-soft);
      color: var(--primary-text);
      transform: translateY(-1px);
    }

    .side-section-label {
      font-size: 0.68rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      padding: 0.35rem 0.65rem 0.1rem;
      flex-shrink: 0;
    }

    .side-nav {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      flex-shrink: 0;
    }
    .side-nav-btn {
      width: 100%;
      text-align: left;
      border: 1px solid transparent;
      background: transparent;
      color: var(--muted);
      padding: 0.68rem 0.78rem;
      border-radius: 11px;
      font-size: 0.86rem;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.68rem;
      transition: all 0.16s ease;
    }
    .side-nav-btn:hover {
      color: var(--text);
      background: var(--bg-hover);
    }
    .side-nav-btn.active {
      background: var(--primary-soft);
      border-color: rgba(6, 182, 212, 0.26);
      color: var(--text);
      font-weight: 700;
    }
    .side-nav-btn.active svg { color: var(--primary); }
    .nav-pill-live {
      margin-left: auto;
      font-size: 0.65rem;
      font-weight: 800;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      padding: 0.16rem 0.45rem;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent);
      display: inline-flex;
      align-items: center;
      gap: 0.28rem;
    }
    .nav-pill-live::before {
      content: '';
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: var(--accent);
    }

    .side-footer {
      margin-top: auto;
      padding-top: 0.75rem;
      border-top: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
      flex-shrink: 0;
    }

    .side-install-card {
      background: linear-gradient(145deg, var(--primary-soft), rgba(37, 99, 235, 0.08));
      border: 1px solid rgba(6, 182, 212, 0.25);
      border-radius: 13px;
      padding: 0.8rem;
    }
    .side-install-head {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      font-size: 0.82rem;
      font-weight: 700;
      margin-bottom: 0.22rem;
    }
    .side-install-head svg { color: var(--primary); }
    .side-install-card p {
      font-size: 0.73rem;
      color: var(--muted);
      line-height: 1.45;
      margin-bottom: 0.6rem;
    }

    /* ─── Main Workspace ─── */
    .main-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
      height: 100%;
      position: relative;
      overflow: hidden;
    }

    .app-topbar {
      flex-shrink: 0;
      height: calc(56px + var(--safe-top));
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding: var(--safe-top) 1rem 0;
      background: var(--bg-glass);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--border);
      z-index: 20;
    }
    .topbar-left {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      min-width: 0;
    }
    .sidebar-toggle-btn {
      width: 34px;
      height: 34px;
      border-radius: 9px;
      border: 1px solid var(--border);
      background: transparent;
      color: var(--muted);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.15s;
      flex-shrink: 0;
    }
    .sidebar-toggle-btn:hover { background: var(--bg-hover); color: var(--text); }

    .mobile-brand {
      display: none;
      align-items: center;
      gap: 0.55rem;
      min-width: 0;
    }
    .mobile-logo {
      width: 30px;
      height: 30px;
      border-radius: 8px;
      flex-shrink: 0;
    }

    .topbar-title-wrap { min-width: 0; display: flex; align-items: center; gap: 0.55rem; }
    .topbar-title {
      font-size: 0.94rem;
      font-weight: 700;
      letter-spacing: -0.015em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .topbar-status-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.18rem 0.55rem;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent);
      font-size: 0.7rem;
      font-weight: 700;
      white-space: nowrap;
    }

    .topbar-actions {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      flex-shrink: 0;
    }

    .icon-btn {
      height: 34px;
      min-width: 34px;
      padding: 0 0.62rem;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: var(--bg-surface);
      color: var(--text-2);
      font-size: 0.76rem;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.35rem;
      transition: all 0.16s;
      white-space: nowrap;
    }
    .icon-btn:hover { background: var(--bg-hover); color: var(--text); border-color: var(--border-strong); }
    .icon-btn.sq { width: 34px; padding: 0; }
    .icon-btn.active {
      background: var(--accent-soft);
      border-color: rgba(16, 185, 129, 0.35);
      color: var(--accent);
    }
    .mobile-install-slot {
      display: none;
      align-items: center;
    }
    .icon-btn.install-mobile {
      background: linear-gradient(135deg, var(--primary), var(--primary-2));
      border-color: transparent;
      color: #fff;
      box-shadow: 0 4px 12px rgba(6, 182, 212, 0.25);
    }

    /* ─── Views ─── */
    .view-pane {
      display: none;
      flex: 1;
      min-height: 0;
      flex-direction: column;
      overflow: hidden;
    }
    .view-pane.active { display: flex; }

    /* Keep Live Video Call cinematic dark even in light mode */
    #pane-call {
      background: #070b14;
      color: #f8fafc;
    }

    .scroll-pane {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 1.25rem 1.1rem 1.75rem;
      -webkit-overflow-scrolling: touch;
    }
    .scroll-inner { max-width: 820px; margin: 0 auto; width: 100%; }

    /* ─── Chat Surface ─── */
    .chat-scroll {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 1rem 1rem 1.25rem;
      display: flex;
      flex-direction: column;
      -webkit-overflow-scrolling: touch;
    }
    .chat-inner {
      max-width: 780px;
      width: 100%;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 0.9rem;
      flex: 1;
    }

    .welcome-hero {
      margin: auto;
      width: 100%;
      max-width: 660px;
      text-align: center;
      padding: 1.25rem 0.25rem 0.75rem;
    }
    .welcome-badge-img {
      width: 54px;
      height: 54px;
      border-radius: 16px;
      margin: 0 auto 0.9rem;
      display: block;
      box-shadow: 0 10px 28px rgba(6, 182, 212, 0.26);
    }
    .welcome-hero h2 {
      font-size: clamp(1.32rem, 3.2vw, 1.75rem);
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.2;
      margin-bottom: 0.4rem;
    }
    .welcome-hero p {
      color: var(--muted);
      font-size: 0.88rem;
      line-height: 1.5;
      max-width: 460px;
      margin: 0 auto 1.15rem;
    }

    .hero-live-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.95rem;
      margin-bottom: 1.25rem;
      border-radius: 999px;
      border: 1px solid rgba(16, 185, 129, 0.34);
      background: var(--accent-soft);
      color: var(--accent);
      font-size: 0.8rem;
      font-weight: 700;
      cursor: pointer;
      transition: transform 0.16s, background 0.16s;
    }
    .hero-live-pill:hover { transform: translateY(-1px); background: rgba(16, 185, 129, 0.22); }

    .starter-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.65rem;
      text-align: left;
    }
    .starter-chip {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 0.82rem 0.92rem;
      color: var(--text);
      cursor: pointer;
      transition: all 0.18s ease;
      display: flex;
      align-items: flex-start;
      gap: 0.7rem;
      box-shadow: var(--shadow-sm);
    }
    .starter-chip:hover {
      border-color: rgba(6, 182, 212, 0.5);
      background: var(--bg-elevated);
      transform: translateY(-2px);
    }
    .starter-ico {
      width: 34px;
      height: 34px;
      border-radius: 10px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      background: var(--primary-soft);
      color: var(--primary);
    }
    .starter-ico.emerald { background: var(--accent-soft); color: var(--accent); }
    .starter-ico.violet { background: rgba(139, 92, 246, 0.14); color: var(--violet); }
    .starter-ico.amber { background: rgba(245, 158, 11, 0.14); color: var(--amber); }
    .starter-copy { min-width: 0; display: flex; flex-direction: column; gap: 0.15rem; }
    .starter-chip strong { font-size: 0.84rem; font-weight: 700; line-height: 1.3; }
    .starter-chip span { font-size: 0.74rem; color: var(--muted); line-height: 1.35; }

    /* Chat Bubbles */
    .msg-row {
      display: flex;
      gap: 0.6rem;
      align-items: flex-end;
      animation: msgIn 0.18s ease;
    }
    .msg-row.user { flex-direction: row-reverse; }
    @keyframes msgIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }

    .msg-avatar {
      width: 30px;
      height: 30px;
      border-radius: 10px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.76rem;
      font-weight: 800;
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      color: var(--text-2);
    }
    .msg-row.model .msg-avatar {
      background: var(--primary-soft);
      border-color: rgba(6, 182, 212, 0.3);
      color: var(--primary);
    }
    .msg-row.user .msg-avatar {
      background: var(--user-bubble);
      border-color: transparent;
      color: #fff;
    }

    .msg-bubble {
      max-width: min(82%, 620px);
      border-radius: 18px;
      padding: 0.78rem 1rem;
      font-size: 0.91rem;
      line-height: 1.58;
      word-break: break-word;
      position: relative;
    }
    .msg-row.user .msg-bubble {
      background: var(--user-bubble);
      color: #fff;
      border-bottom-right-radius: 6px;
      box-shadow: 0 6px 18px rgba(37, 99, 235, 0.22);
    }
    .msg-row.model .msg-bubble {
      background: var(--ai-bubble);
      border: 1px solid var(--border);
      color: var(--text);
      border-bottom-left-radius: 6px;
      box-shadow: var(--shadow-sm);
    }

    .msg-text p { margin-bottom: 0.45rem; }
    .msg-text p:last-child { margin-bottom: 0; }
    .msg-text ul { padding-left: 1.2rem; margin: 0.35rem 0; }
    .msg-text li { margin-bottom: 0.2rem; }
    .msg-text code.inline-code {
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      padding: 0.1rem 0.35rem;
      border-radius: 6px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.82rem;
      color: var(--primary-text);
    }
    .msg-row.user .msg-text code.inline-code {
      background: rgba(255, 255, 255, 0.18);
      border-color: transparent;
      color: #fff;
    }
    .msg-text pre.code-block {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 0.8rem 0.9rem;
      overflow-x: auto;
      margin: 0.55rem 0;
      position: relative;
    }
    .msg-text pre.code-block code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.81rem;
      color: #e2e8f0;
      white-space: pre;
    }
    .code-copy-btn {
      position: absolute;
      top: 0.45rem;
      right: 0.5rem;
      border: 1px solid rgba(255, 255, 255, 0.16);
      background: rgba(15, 23, 42, 0.9);
      color: #cbd5e1;
      border-radius: 7px;
      padding: 0.2rem 0.55rem;
      font-size: 0.7rem;
      font-weight: 700;
      cursor: pointer;
    }
    .msg-text a { color: var(--primary); text-decoration: underline; }
    .msg-row.user .msg-text a { color: #e0f2fe; }

    .msg-img {
      display: block;
      max-width: 100%;
      max-height: 320px;
      border-radius: 12px;
      margin-bottom: 0.55rem;
      border: 1px solid var(--border);
    }
    .msg-audio {
      width: 100%;
      min-width: 210px;
      height: 38px;
      margin-top: 0.55rem;
      border-radius: 10px;
    }

    .msg-foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      margin-top: 0.45rem;
      font-size: 0.7rem;
      color: var(--muted);
    }
    .msg-row.user .msg-foot { color: rgba(255, 255, 255, 0.78); justify-content: flex-end; }
    .msg-actions { display: flex; align-items: center; gap: 0.3rem; }
    .mini-act-btn {
      border: 1px solid var(--border);
      background: var(--bg-elevated);
      color: var(--text-2);
      border-radius: 999px;
      padding: 0.2rem 0.58rem;
      font-size: 0.7rem;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.28rem;
      text-decoration: none;
      transition: all 0.15s;
    }
    .mini-act-btn:hover { background: var(--primary-soft); color: var(--primary-text); border-color: rgba(6, 182, 212, 0.35); }

    .typing-dots { display: inline-flex; gap: 4px; align-items: center; padding: 0.25rem 0; }
    .typing-dots span {
      width: 7px; height: 7px; border-radius: 50%; background: var(--primary);
      animation: bounceDot 1.2s infinite ease-in-out;
    }
    .typing-dots span:nth-child(2) { animation-delay: 0.18s; }
    .typing-dots span:nth-child(3) { animation-delay: 0.36s; }
    @keyframes bounceDot { 0%, 80%, 100% { opacity: 0.35; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1.15); } }

    /* ─── Floating Pill Composer ─── */
    .composer-wrap {
      flex-shrink: 0;
      padding: 0.5rem 1rem calc(0.85rem + var(--safe-bottom));
      background: linear-gradient(to top, var(--bg) 72%, transparent);
    }
    .composer-inner { max-width: 780px; margin: 0 auto; }

    .attach-preview {
      display: none;
      align-items: center;
      justify-content: space-between;
      gap: 0.7rem;
      padding: 0.5rem 0.75rem;
      margin-bottom: 0.5rem;
      border-radius: 13px;
      background: var(--primary-soft);
      border: 1px solid rgba(6, 182, 212, 0.3);
    }
    .attach-preview.show { display: flex; }
    .attach-preview-left { display: flex; align-items: center; gap: 0.65rem; min-width: 0; }
    .attach-preview img { width: 42px; height: 42px; object-fit: cover; border-radius: 8px; }
    .attach-preview-name { font-size: 0.8rem; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    .composer-box {
      display: flex;
      align-items: flex-end;
      gap: 0.38rem;
      background: var(--bg-surface);
      border: 1px solid var(--border-strong);
      border-radius: 22px;
      padding: 0.38rem 0.42rem;
      box-shadow: var(--shadow-md);
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .composer-box:focus-within {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px var(--primary-soft), var(--shadow-md);
    }

    .comp-btn {
      width: 38px;
      height: 38px;
      border-radius: 50%;
      border: none;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: all 0.16s;
    }
    .comp-btn:hover { background: var(--bg-hover); color: var(--text); }
    .comp-btn.recording {
      background: var(--danger-soft);
      color: var(--danger);
      border: 1px solid rgba(239, 68, 68, 0.55);
      animation: pulseRec 1.1s infinite;
    }
    @keyframes pulseRec { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.07); } }

    .send-btn {
      background: linear-gradient(135deg, var(--primary), var(--primary-2));
      color: #fff;
      box-shadow: 0 4px 14px rgba(6, 182, 212, 0.3);
    }
    .send-btn:hover { background: linear-gradient(135deg, #22d3ee, #3b82f6); color: #fff; }
    .send-btn:disabled { opacity: 0.42; cursor: not-allowed; }

    #chatInput {
      flex: 1;
      border: none;
      background: transparent;
      color: var(--text);
      font-size: 0.93rem;
      line-height: 1.45;
      padding: 0.48rem 0.35rem;
      max-height: 128px;
      min-height: 38px;
      resize: none;
      outline: none;
    }
    #chatInput::placeholder { color: var(--muted); }

    /* ─── Cards, Forms & Sub-tabs ─── */
    .page-header {
      margin-bottom: 1rem;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    .page-header h2 { font-size: 1.25rem; font-weight: 800; letter-spacing: -0.025em; }
    .page-header p { font-size: 0.83rem; color: var(--muted); margin-top: 0.2rem; }

    .seg-tabs {
      display: flex;
      gap: 0.35rem;
      padding: 0.3rem;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      margin-bottom: 1rem;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .seg-tabs::-webkit-scrollbar { display: none; }
    .seg-btn {
      flex: 1;
      min-width: max-content;
      border: none;
      background: transparent;
      color: var(--muted);
      padding: 0.56rem 0.85rem;
      border-radius: 10px;
      font-size: 0.81rem;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.42rem;
      transition: all 0.16s;
      white-space: nowrap;
    }
    .seg-btn:hover { color: var(--text); }
    .seg-btn.active {
      background: var(--primary-soft);
      color: var(--primary-text);
    }

    .tool-panel { display: none; }
    .tool-panel.active { display: block; animation: msgIn 0.18s ease; }

    .card {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 1.25rem;
      margin-bottom: 1rem;
      box-shadow: var(--shadow-sm);
    }
    .card h3 {
      font-size: 0.98rem;
      font-weight: 800;
      margin-bottom: 0.25rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .card-title-grp { display: inline-flex; align-items: center; gap: 0.48rem; }
    .card-title-grp svg { color: var(--primary); }
    .card .sub { font-size: 0.82rem; color: var(--muted); line-height: 1.5; margin-bottom: 1rem; }

    .prayer-grid {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 0.55rem;
      margin-bottom: 0.95rem;
    }
    .prayer-box {
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: 13px;
      padding: 0.78rem 0.5rem;
      text-align: center;
      transition: border-color 0.15s;
    }
    .prayer-box.next {
      border-color: var(--primary);
      background: linear-gradient(160deg, var(--primary-soft), rgba(37, 99, 235, 0.08));
    }
    .prayer-box .p-name { font-size: 0.78rem; font-weight: 700; color: var(--text); }
    .prayer-box .p-ar { font-size: 0.74rem; color: var(--muted); margin: 0.12rem 0 0.32rem; }
    .prayer-box .p-time { font-size: 1.02rem; font-weight: 800; color: var(--primary); }

    .ayah-box {
      background: var(--accent-soft);
      border: 1px solid rgba(16, 185, 129, 0.26);
      border-radius: 13px;
      padding: 0.9rem 1rem;
      font-size: 0.84rem;
      line-height: 1.6;
    }
    .ayah-ar { font-size: 1.04rem; text-align: right; direction: rtl; color: var(--text); margin-bottom: 0.45rem; }

    .field-label { display: block; font-size: 0.78rem; font-weight: 700; color: var(--text-2); margin-bottom: 0.35rem; }
    .field {
      width: 100%;
      padding: 0.7rem 0.88rem;
      border-radius: 12px;
      border: 1px solid var(--border-strong);
      background: var(--bg);
      color: var(--text);
      font-size: 0.89rem;
      outline: none;
      transition: border-color 0.16s, box-shadow 0.16s;
    }
    .field:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px var(--primary-soft);
    }
    .form-row { margin-bottom: 0.85rem; }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.45rem;
      border: none;
      border-radius: 12px;
      padding: 0.68rem 1.05rem;
      font-size: 0.84rem;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.16s ease;
    }
    .btn:disabled { opacity: 0.48; cursor: not-allowed; }
    .btn-primary { background: linear-gradient(135deg, var(--primary), var(--primary-2)); color: #fff; box-shadow: 0 4px 14px rgba(6, 182, 212, 0.24); }
    .btn-primary:hover:not(:disabled) { filter: brightness(1.07); transform: translateY(-1px); }
    .btn-emerald { background: linear-gradient(135deg, #10b981, #059669); color: #fff; }
    .btn-ghost { background: var(--bg-elevated); color: var(--text-2); border: 1px solid var(--border); }
    .btn-ghost:hover { border-color: var(--border-strong); color: var(--text); }
    .btn-danger { background: var(--danger-soft); color: var(--danger); border: 1px solid rgba(239, 68, 68, 0.3); }
    .btn-sm { padding: 0.46rem 0.78rem; font-size: 0.77rem; border-radius: 10px; }

    /* Views Hub */
    .views-meter-track { height: 9px; border-radius: 999px; background: var(--bg-elevated); overflow: hidden; margin: 0.45rem 0 0.85rem; }
    .views-meter-fill { height: 100%; width: 0%; border-radius: 999px; background: linear-gradient(90deg, var(--primary), var(--accent), var(--amber)); transition: width 0.4s ease; }
    .views-form-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.55rem;
      margin-bottom: 0.75rem;
    }
    .mini-vip-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.7rem; }
    .mini-vip-card {
      background: linear-gradient(155deg, rgba(245, 158, 11, 0.08), var(--bg-elevated));
      border: 1px solid rgba(245, 158, 11, 0.32);
      border-radius: 14px;
      padding: 0.9rem;
      display: flex;
      flex-direction: column;
      gap: 0.42rem;
    }

    /* Theme Selector Row */
    .theme-switch-row {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.6rem;
    }
    .theme-opt {
      padding: 0.78rem 0.9rem;
      border-radius: 13px;
      border: 1px solid var(--border);
      background: var(--bg-elevated);
      color: var(--text-2);
      font-size: 0.84rem;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      transition: all 0.16s;
    }
    .theme-opt.active {
      border-color: var(--primary);
      background: var(--primary-soft);
      color: var(--primary-text);
    }

    .hub-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.65rem; }
    .hub-card {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      padding: 0.88rem;
      border-radius: 13px;
      text-decoration: none;
      color: var(--text);
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      transition: all 0.16s;
    }
    .hub-card:hover { border-color: var(--primary); transform: translateY(-1px); }
    .hub-card strong { font-size: 0.84rem; }
    .hub-card span { font-size: 0.74rem; color: var(--muted); }

    details.advanced-panel {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 0.9rem 1.1rem;
      margin-bottom: 1rem;
    }
    details.advanced-panel summary {
      cursor: pointer;
      font-size: 0.84rem;
      font-weight: 700;
      color: var(--muted);
      list-style: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    details.advanced-panel summary::-webkit-details-marker { display: none; }
    details.advanced-panel[open] summary { color: var(--text); margin-bottom: 0.85rem; }

    .install-step {
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 0.78rem 0.92rem;
      margin-bottom: 0.55rem;
      font-size: 0.82rem;
      line-height: 1.5;
      color: var(--text-2);
    }
    .install-step strong { color: var(--text); display: block; margin-bottom: 0.18rem; }

    /* ─── Mobile Bottom Navigation ─── */
    .bottom-nav {
      display: none;
      flex-shrink: 0;
      background: var(--bg-glass);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
      border-top: 1px solid var(--border);
      padding: 0.35rem 0.35rem calc(0.4rem + var(--safe-bottom));
      grid-template-columns: repeat(5, 1fr);
      gap: 0.2rem;
      z-index: 25;
    }
    .bnav-btn {
      border: none;
      background: transparent;
      color: var(--muted);
      padding: 0.42rem 0.2rem;
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.22rem;
      font-size: 0.68rem;
      font-weight: 700;
      cursor: pointer;
      position: relative;
      transition: color 0.16s, background 0.16s;
    }
    .bnav-btn.active {
      color: var(--primary);
      background: var(--primary-soft);
    }
    .bnav-live-dot {
      position: absolute;
      top: 6px;
      right: calc(50% - 14px);
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--accent);
    }

    /* ─── Toast & Modal ─── */
    .toast-banner {
      position: fixed;
      top: calc(0.85rem + var(--safe-top));
      right: 1rem;
      z-index: 250;
      padding: 0.72rem 1rem;
      border-radius: 13px;
      background: var(--bg-surface);
      border: 1px solid var(--primary);
      color: var(--text);
      font-weight: 600;
      font-size: 0.82rem;
      box-shadow: var(--shadow-md);
      display: none;
      max-width: min(340px, calc(100vw - 2rem));
    }
    .toast-banner.show { display: block; animation: msgIn 0.18s ease; }

    .modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 200;
      background: rgba(2, 6, 15, 0.76);
      backdrop-filter: blur(8px);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }
    .modal-backdrop.open { display: flex; }
    .modal-box {
      max-width: 460px;
      width: 100%;
      max-height: 88vh;
      overflow-y: auto;
      background: var(--bg-surface);
      border: 1px solid var(--border-strong);
      border-radius: 20px;
      padding: 1.3rem;
      box-shadow: var(--shadow-md);
    }

    /* ─── Responsive Breakpoints ─── */
    @media (max-width: 1120px) {
      .sidebar { width: 238px; }
      .views-form-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }

    @media (max-width: 900px) {
      .sidebar { display: none; }
      .sidebar-toggle-btn { display: none; }
      .mobile-brand { display: flex; }
      .topbar-title-desktop { display: none; }
      .topbar-status-chip { display: none; }
      .mobile-install-slot { display: inline-flex; }
      .bottom-nav { display: grid; }
      .app-topbar { height: calc(52px + var(--safe-top)); padding: var(--safe-top) 0.75rem 0; }
      .composer-wrap { padding: 0.42rem 0.65rem 0.55rem; }
      .scroll-pane { padding: 0.9rem 0.8rem 1.25rem; }
      .chat-scroll { padding: 0.75rem 0.75rem 0.9rem; }
      .welcome-hero { padding: 0.65rem 0.1rem 0.4rem; }
      .welcome-badge-img { width: 44px; height: 44px; border-radius: 13px; margin-bottom: 0.65rem; }
      .welcome-hero p { font-size: 0.82rem; margin-bottom: 0.9rem; }
      .hero-live-pill { margin-bottom: 0.95rem; font-size: 0.76rem; padding: 0.44rem 0.85rem; }
      .starter-grid { gap: 0.5rem; }
      .starter-chip { padding: 0.7rem 0.72rem; flex-direction: column; gap: 0.45rem; }
      .starter-ico { width: 30px; height: 30px; }
      .starter-chip strong { font-size: 0.79rem; }
      .starter-chip span { font-size: 0.71rem; }
      .prayer-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .prayer-box:last-child:nth-child(odd) { grid-column: span 2; }
      .hub-grid { grid-template-columns: 1fr; }
      .mini-vip-grid { grid-template-columns: 1fr; }
      .msg-bubble { max-width: 88%; font-size: 0.89rem; }
    }

    @media (max-width: 540px) {
      .views-form-grid { grid-template-columns: 1fr; }
      .voice-label-text { display: none; }
      .install-label-text { display: none; }
      .icon-btn.install-mobile { padding: 0 0.55rem; }
      .card { padding: 1rem; border-radius: 15px; }
    }

    @media (max-width: 360px) {
      .starter-grid { grid-template-columns: 1fr; }
      .starter-chip { flex-direction: row; align-items: center; }
    }

    ${renderLiveCallPanelCSS()}
  </style>
</head>
<body>
  <div class="app-shell">
    <!-- Modern Desktop Sidebar -->
    <aside class="sidebar" id="appSidebar">
      <div class="side-brand">
        <img src="/pwa/icon-192.png" alt="CARDOSO AI" />
        <div class="side-brand-meta">
          <h1 id="sideBotTitle">CARDOSO <span>AI</span></h1>
          <div class="side-brand-sub">
            <span class="dot-online"></span>
            <span id="sideBotSub">${escapeAttr(initialSub)}</span>
          </div>
        </div>
      </div>

      <button class="new-chat-btn" type="button" onclick="startFreshChat()">
        <svg class="ico-svg ico-sm" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        <span>Sheeko Cusub</span>
      </button>

      <div class="side-section-label">Menu</div>
      <nav class="side-nav" aria-label="Main navigation">
        <button class="side-nav-btn active" type="button" data-tab="chat" onclick="switchAppTab('chat')">
          <svg class="ico-svg" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span>Sheeko AI</span>
        </button>
        <button class="side-nav-btn" type="button" data-tab="call" onclick="switchAppTab('call')">
          <svg class="ico-svg" viewBox="0 0 24 24"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
          <span>Live Video Call</span>
          <span class="nav-pill-live">Live</span>
        </button>
        <button class="side-nav-btn" type="button" data-tab="views" onclick="switchAppTab('views')">
          <svg class="ico-svg" viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
          <span>Views &amp; .vcf Hub</span>
        </button>
        <button class="side-nav-btn" type="button" data-tab="tools" onclick="switchAppTab('tools')">
          <svg class="ico-svg" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>
          <span>Adeegyada</span>
        </button>
        <button class="side-nav-btn" type="button" data-tab="settings" onclick="switchAppTab('settings')">
          <svg class="ico-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          <span>Dejinta</span>
        </button>
      </nav>

      <div class="side-footer">
        <div class="side-install-card" id="sideInstallCard">
          <div class="side-install-head">
            <svg class="ico-svg ico-sm" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>Ku dar Shaashadda</span>
          </div>
          <p>U fur CARDOSO AI sidii App degdeg ah — hal gujis.</p>
          <button class="btn btn-primary btn-sm" type="button" style="width:100%;" data-pwa-install-btn onclick="triggerCardosoInstall()">Install App</button>
          <div data-pwa-installed-badge style="display:none;color:var(--accent);font-size:0.78rem;font-weight:700;">App Mode Waa Shidan Yahay</div>
        </div>
      </div>
    </aside>

    <!-- Main Workspace -->
    <div class="main-area">
      <!-- Slim Adaptive Topbar -->
      <header class="app-topbar">
        <div class="topbar-left">
          <button class="sidebar-toggle-btn" type="button" onclick="toggleDesktopSidebar()" title="Qari ama muuji menu-ga" aria-label="Toggle sidebar">
            <svg class="ico-svg ico-sm" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
          </button>

          <!-- Mobile Brand -->
          <div class="mobile-brand">
            <img src="/pwa/icon-192.png" alt="CARDOSO AI" class="mobile-logo" />
            <div class="topbar-title" id="topBotName">${escapeAttr(initialBotName)}</div>
            <span class="dot-online" title="Online"></span>
          </div>

          <!-- Desktop Active View Title -->
          <div class="topbar-title-wrap topbar-title-desktop">
            <div class="topbar-title" id="activeViewTitle">Sheeko AI</div>
            <span class="topbar-status-chip">
              <span class="dot-online" style="box-shadow:none;width:6px;height:6px;"></span>
              <span id="topStatusText">Online</span>
            </span>
          </div>
        </div>

        <div class="topbar-actions">
          <button class="icon-btn" type="button" id="autoVoiceToggleBtn" onclick="toggleAutoVoice()" title="Jawaab kasta cod ha la socdo">
            <svg class="ico-svg ico-sm" id="autoVoiceIcon" viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
            <span class="voice-label-text" id="autoVoiceLabel">Cod: Off</span>
          </button>

          <button class="icon-btn sq" type="button" id="themeToggleBtn" onclick="toggleAppTheme()" title="Beddel Dark / Light Mode" aria-label="Toggle theme">
            <svg class="ico-svg ico-sm" id="themeToggleIcon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
          </button>

          <span class="mobile-install-slot">
            <button class="icon-btn install-mobile" type="button" data-pwa-install-btn onclick="triggerCardosoInstall()" title="Install CARDOSO AI">
              <svg class="ico-svg ico-sm" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span class="install-label-text">Install</span>
            </button>
          </span>

          <button class="icon-btn sq" type="button" onclick="startFreshChat()" title="Sheeko cusub" aria-label="New chat">
            <svg class="ico-svg ico-sm" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button>
        </div>
      </header>

      <!-- TAB 1: CHAT -->
      <section id="pane-chat" class="view-pane active">
        <div class="chat-scroll" id="chatScroll">
          <div class="chat-inner" id="chatMessages">
            <div class="welcome-hero" id="welcomeHero">
              <img src="/pwa/icon-192.png" alt="CARDOSO AI" class="welcome-badge-img" />
              <h2>Maxaan maanta kaa caawiyaa?</h2>
              <p>Iila hadal qoraal, cod Soomaali/Ingiriisi ah, ama sawir ii soo dir — si degdeg ah ayaan kuugu jawaabayaa.</p>

              <button type="button" class="hero-live-pill" onclick="switchAppTab('call')">
                <svg class="ico-svg ico-sm" viewBox="0 0 24 24"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                <span>Fur Live Video &amp; Voice Call</span>
                <svg class="ico-svg ico-sm" viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
              </button>

              <div class="starter-grid">
                <button class="starter-chip" type="button" onclick="sendStarter('Asc sxb! Iga caawi sidaan Python u barto bilow ilaa heer sare.')">
                  <span class="starter-ico">
                    <svg class="ico-svg ico-sm" viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                  </span>
                  <div class="starter-copy">
                    <strong>Barashada Coding &amp; Python</strong>
                    <span>Tallaabo-tallaabo Af-Soomaali fudud</span>
                  </div>
                </button>
                <button class="starter-chip" type="button" onclick="sendStarter('Ii samee jadwal waxbarasho oo Pomodoro ah oo arday jaamacadeed ku habboon.')">
                  <span class="starter-ico emerald">
                    <svg class="ico-svg ico-sm" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                  </span>
                  <div class="starter-copy">
                    <strong>Jadwal Waxbarasho</strong>
                    <span>Qorshe diyaarin &amp; imtixaan</span>
                  </div>
                </button>
                <button class="starter-chip" type="button" onclick="sendStarter('Ii samee sawir qurux badan oo magaalada Muqdisho xilli qorrax dhac ah.')">
                  <span class="starter-ico violet">
                    <svg class="ico-svg ico-sm" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                  </span>
                  <div class="starter-copy">
                    <strong>Samee Sawir AI</strong>
                    <span>Sawirro cusub oo AI curiyo</span>
                  </div>
                </button>
                <button class="starter-chip" type="button" onclick="sendStarter('Iigu dhiirigeli Af-Soomaali qurux badan maanta si aan shaqadayda u dhammeeyo.', true)">
                  <span class="starter-ico amber">
                    <svg class="ico-svg ico-sm" viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                  </span>
                  <div class="starter-copy">
                    <strong>Dhiirigelin Cod Soomaali ah</strong>
                    <span>Qoraal + cod dabiici ah (Voice)</span>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Floating Chat Composer -->
        <div class="composer-wrap">
          <div class="composer-inner">
            <div id="attachPreview" class="attach-preview">
              <div class="attach-preview-left">
                <img id="attachThumb" src="" alt="Preview" style="display:none;" />
                <div>
                  <div class="attach-preview-name" id="attachName">Fayl la xulay</div>
                  <div style="font-size:0.72rem;color:var(--muted);" id="attachMeta">Diyaar u ah dirista</div>
                </div>
              </div>
              <button class="btn btn-danger btn-sm" type="button" onclick="clearAttachment()">Ka saar</button>
            </div>

            <div class="composer-box">
              <input type="file" id="imageFileInput" accept="image/*" style="display:none;" onchange="handleFilePicked(event)" />
              <button class="comp-btn" type="button" onclick="document.getElementById('imageFileInput').click()" title="Soo dir sawir" aria-label="Attach image">
                <svg class="ico-svg" viewBox="0 0 24 24"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
              </button>
              <button class="comp-btn" id="micBtn" type="button" onclick="toggleVoiceRecord()" title="Duub fariin cod ah" aria-label="Record voice">
                <svg class="ico-svg" viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
              </button>
              <textarea id="chatInput" rows="1" placeholder="Qor fariintaada Af-Soomaali ama English..."></textarea>
              <button class="comp-btn send-btn" id="sendBtn" type="button" onclick="sendChatMessage()" title="Dir fariinta" aria-label="Send message">
                <svg class="ico-svg ico-sm" viewBox="0 0 24 24"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- TAB 2: CARDOSO LIVE VIDEO & VOICE CALL -->
      <section id="pane-call" class="view-pane">
        ${renderLiveCallPanelHTML()}
      </section>

      <!-- TAB 3: VIEWS & .VCF CONTACT EXCHANGE HUB -->
      <section id="pane-views" class="view-pane">
        <div class="scroll-pane">
          <div class="scroll-inner">
            <div class="page-header">
              <div>
                <h2>Views &amp; .vcf Hub</h2>
                <p>Kordhi WhatsApp Status Views si badbaado leh (0% Ban) adigoo soo dejinaya faylka .vcf.</p>
              </div>
              <a href="/views" class="btn btn-ghost btn-sm">Bogga Buuxa ↗</a>
            </div>

            <div class="card" style="border-color:rgba(16,185,129,0.32);">
              <h3>
                <span class="card-title-grp">
                  <svg class="ico-svg" viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                  <span>Status Views Pool</span>
                </span>
                <span style="font-size:0.78rem;color:var(--primary);font-weight:700;" id="appViewsTotalText">0 Contacts</span>
              </h3>
              <p class="sub">Geli lambarkaaga, hal gujis ku soo deji faylka <b>.vcf</b> si aad ula wadaagto Status Views dhammaan dadka Pool-ka.</p>

              <div style="display:flex;justify-content:space-between;font-size:0.79rem;font-weight:700;">
                <span id="appViewsMeterText">Batch #1: 0 / 100 Qof</span>
              </div>
              <div class="views-meter-track"><div class="views-meter-fill" id="appViewsMeterFill"></div></div>

              <form id="appViewsJoinForm" onsubmit="submitAppViewsJoin(event)">
                <div class="views-form-grid">
                  <input class="field" id="appViewsName" required placeholder="Magacaaga..." />
                  <select class="field" id="appViewsCountry">
                    <option value="252">Somalia (+252)</option>
                    <option value="251">Ethiopia (+251)</option>
                    <option value="254">Kenya (+254)</option>
                    <option value="253">Djibouti (+253)</option>
                    <option value="">Dal Kale</option>
                  </select>
                  <input class="field" id="appViewsPhone" required placeholder="634... ama 915..." />
                  <select class="field" id="appViewsCity">
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
                <div style="display:flex;gap:0.55rem;flex-wrap:wrap;">
                  <button type="submit" id="appViewsJoinBtn" class="btn btn-primary" style="flex:1;">Ku Biir &amp; Fur Faylka .vcf</button>
                  <button type="button" class="btn btn-ghost btn-sm" onclick="lookupExistingAppViews()">Horay Ma U Gashay?</button>
                </div>
              </form>

              <div id="appViewsUnlockedBox" style="display:none;margin-top:0.65rem;">
                <div style="font-size:0.83rem;color:var(--accent);font-weight:700;margin-bottom:0.65rem;" id="appViewsJoinedBadge">Waad ku jirtaa Pool-ka!</div>
                <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
                  <button class="btn btn-emerald" type="button" style="flex:1;" onclick="downloadAppViewsVcf('current')">Soo Deji Batch .vcf</button>
                  <button class="btn btn-primary btn-sm" type="button" onclick="downloadAppViewsVcf('all')">All .vcf</button>
                  <button class="btn btn-ghost btn-sm" type="button" onclick="verifyAppViewsSaver()">Xaqiiji Save</button>
                  <button class="btn btn-ghost btn-sm" type="button" onclick="shareAppViewsLink()">Share</button>
                </div>
              </div>
            </div>

            <div class="card">
              <h3>
                <span class="card-title-grp">
                  <svg class="ico-svg" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                  <span>VIP Pinned Sponsors</span>
                </span>
                <button class="btn btn-ghost btn-sm" type="button" onclick="downloadAppViewsVcf('vip')">Soo Deji VIP .vcf</button>
              </h3>
              <p class="sub">Macaamiisha VIP-ga ah ee korka ku xiran fayl kasta oo .vcf ah.</p>
              <div class="mini-vip-grid" id="appViewsVipGrid">
                <div style="color:var(--muted);font-size:0.82rem;">Waa la soo rarayaa...</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- TAB 4: TOOLS (CLEAN SUB-TABS) -->
      <section id="pane-tools" class="view-pane">
        <div class="scroll-pane">
          <div class="scroll-inner">
            <div class="page-header">
              <div>
                <h2>Adeegyada CARDOSO</h2>
                <p>Waqtiga salaadda, cod-sameeyaha, podcast-ka, iyo curinta sawirrada AI.</p>
              </div>
            </div>

            <div class="seg-tabs" role="tablist" aria-label="Adeegyada">
              <button class="seg-btn active" type="button" data-tool-tab="prayer" onclick="switchToolSubTab('prayer')">
                <svg class="ico-svg ico-sm" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <span>Salaadda</span>
              </button>
              <button class="seg-btn" type="button" data-tool-tab="voice" onclick="switchToolSubTab('voice')">
                <svg class="ico-svg ico-sm" viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
                <span>Voice Studio</span>
              </button>
              <button class="seg-btn" type="button" data-tool-tab="podcast" onclick="switchToolSubTab('podcast')">
                <svg class="ico-svg ico-sm" viewBox="0 0 24 24"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>
                <span>Podcast</span>
              </button>
              <button class="seg-btn" type="button" data-tool-tab="image" onclick="switchToolSubTab('image')">
                <svg class="ico-svg ico-sm" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                <span>Sawir AI</span>
              </button>
            </div>

            <!-- Sub-tab 1: Prayer Times -->
            <div class="tool-panel active" id="tool-panel-prayer">
              <div class="card">
                <h3>
                  <span class="card-title-grp">
                    <svg class="ico-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    <span>Waqtiga Salaadda (Somalia · EAT)</span>
                  </span>
                  <span style="font-size:0.75rem;color:var(--primary);font-weight:700;" id="prayerDateLabel">--</span>
                </h3>
                <p class="sub">Jadwalka 5-ta salaadood iyo Aayad Quraan ah oo maalinle ah.</p>
                <div class="prayer-grid" id="prayerGrid">
                  <div class="prayer-box"><div class="p-name">Waa la soo rarayaa...</div></div>
                </div>
                <div class="ayah-box" id="prayerAyahBox" style="display:none;">
                  <div class="ayah-ar" id="prayerAyahAr"></div>
                  <div id="prayerAyahSo" style="color:var(--text-2);"></div>
                  <div id="prayerAyahRef" style="color:var(--accent);font-size:0.76rem;font-weight:700;margin-top:0.35rem;"></div>
                </div>
              </div>
            </div>

            <!-- Sub-tab 2: Voice Studio -->
            <div class="tool-panel" id="tool-panel-voice">
              <div class="card">
                <h3>
                  <span class="card-title-grp">
                    <svg class="ico-svg" viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
                    <span>Voice Studio (Qoraal → Cod)</span>
                  </span>
                </h3>
                <p class="sub">Qoraal kasta u beddel cod MP3 dabiici ah oo Af-Soomaali, English, ama Carabi ah.</p>
                <div class="form-row">
                  <label class="field-label" for="ttsLangSelect">Luqadda Codka</label>
                  <select class="field" id="ttsLangSelect">
                    <option value="so">Af-Soomaali — Mohamed (Wiil Neural)</option>
                    <option value="so_female">Af-Soomaali — Safa (Gabadh Neural)</option>
                    <option value="en">English — Christopher Neural</option>
                    <option value="ar">العربية — Hamed Neural</option>
                  </select>
                </div>
                <div class="form-row">
                  <label class="field-label" for="ttsInputText">Qoraalka</label>
                  <textarea class="field" id="ttsInputText" rows="3" placeholder="Tusaale: Assalaamu calaykum walaal, ku soo dhawoow CARDOSO AI!"></textarea>
                </div>
                <div style="display:flex;gap:0.55rem;flex-wrap:wrap;align-items:center;">
                  <button class="btn btn-primary" type="button" id="ttsGenBtn" onclick="generateStudioVoice()">Samee Cod (MP3)</button>
                  <a id="ttsDownloadLink" class="btn btn-emerald btn-sm" style="display:none;" download="cardoso-voice.mp3">Soo Deji MP3</a>
                </div>
                <audio id="ttsPreviewAudio" controls class="msg-audio" style="display:none;margin-top:0.85rem;"></audio>
              </div>
            </div>

            <!-- Sub-tab 3: Safa & Mohamed Podcast Studio -->
            <div class="tool-panel" id="tool-panel-podcast">
              <div class="card">
                <h3>
                  <span class="card-title-grp">
                    <svg class="ico-svg" viewBox="0 0 24 24"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>
                    <span>Safa &amp; Mohamed Podcast Studio</span>
                  </span>
                  <span style="font-size:0.72rem;color:var(--accent);font-weight:700;">100% Free</span>
                </h3>
                <p class="sub">Geli mawduuc ama link maqaal — Safa &amp; Mohamed waxay u doodayaan una falanqeynayaan sidii laba qof oo dhab ah.</p>

                <div class="form-row">
                  <label class="field-label" for="podcastTopicInput">Mawduuca / Link Maqaal (Ikhtiyaari)</label>
                  <input class="field" id="podcastTopicInput" placeholder="Tusaale: Ganacsiga Online-ka, Waxbarashada AI, ama https://..." />
                </div>

                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:0.6rem;margin-bottom:0.85rem;">
                  <div>
                    <label class="field-label" for="podcastStyleSelect">Qaabka</label>
                    <select class="field" id="podcastStyleSelect">
                      <option value="debate">Dood Kulul (Debate)</option>
                      <option value="study">Cashar &amp; Imtixaan (Study)</option>
                      <option value="story">Sheeko &amp; Taariikh (Story)</option>
                      <option value="ad">Xayeysiis Radio (Ad)</option>
                      <option value="diini">Wacdi &amp; Diini (Clean)</option>
                    </select>
                  </div>
                  <div>
                    <label class="field-label" for="podcastDurationSelect">Muddada</label>
                    <select class="field" id="podcastDurationSelect">
                      <option value="1">1 Daqiiqo</option>
                      <option value="2" selected>2 Daqiiqo</option>
                      <option value="3">3 Daqiiqo</option>
                      <option value="4">4 Daqiiqo</option>
                      <option value="5">5 Daqiiqo</option>
                    </select>
                  </div>
                  <div>
                    <label class="field-label" for="podcastSoundSelect">Codka Istuudiyaha</label>
                    <select class="field" id="podcastSoundSelect">
                      <option value="chime" selected>Studio Chime + Mastering</option>
                      <option value="ambient">Soft Ambient + Mastering</option>
                      <option value="clean">Cod Saafi ah (Muusig la'aan)</option>
                    </select>
                  </div>
                </div>

                <div class="form-row">
                  <label class="field-label" for="podcastScriptInput">Qoraalka Wada-Sheekeysiga (haddii mawduuca kore bannaan yahay)</label>
                  <textarea class="field" id="podcastScriptInput" rows="6">Safa: [excited] Assalaamu calaykum Mohamed! War maanta dadkoo dhan waxay hadal hayaan CARDOSO AI — adigana ma ogtahay inaan markii hore u haystay bot caadi ah?
Mohamed: [laugh] Wa calaykumus salaam Safa! Haa-haa, taasi waa qaladkii dad badan galeen! Maya walaal, CARDOSO AI waa kaaliye casri ah oo Af-Soomaali dabiici ah kula sheekeysta.
Safa: [debate] Sug sug Mohamed, ha igu buunbuunin! Bal i tusi waxa uu kaga duwan yahay barnaamijyada kale?
Mohamed: [debate] Wallaahi farqi weyn baa jira Safa! Af-Soomaaliga ayuu si qoto dheer u fahmaa, ardayda casharro iyo koodh ayuu u sharxaa, sawirro cusub ayuu curiyaa, waqtiga salaaddana wuu ku xasuusiyaa!
Safa: [backchannel] Haa-haa, run miyaa? Oo ma WhatsApp keliya baa laga helaa?
Mohamed: [excited] Maya! Labadaba — WhatsApp-kaaga ayuu ka shaqeeyaa, sidoo kalena App casri ah oo telefoonka lagu install gareysto ayuu leeyahay!
Safa: [laugh] Wallaahi waad i qancisay Mohamed! Asxaabey, adinkuna ha moogaanina CARDOSO AI — barasho, ganacsi, iyo hal-abuur hal meel ku wada jira!
Mohamed: [calm] Ku soo dhawaada CARDOSO AI Studio — nabad gelyo iyo horumar wacan!</textarea>
                </div>

                <div id="podcastTeaserBox" style="display:none;margin-bottom:0.8rem;padding:0.75rem 0.9rem;border-radius:11px;background:var(--primary-soft);border:1px solid rgba(6,182,212,0.3);font-size:0.83rem;color:var(--text);"></div>

                <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;">
                  <button class="btn btn-primary" type="button" id="podcastGenMp3Btn" onclick="generateSafaMohamedPodcast('mp3')">Podcast Stereo (MP3)</button>
                  <button class="btn btn-ghost btn-sm" type="button" id="podcastGenOggBtn" onclick="generateSafaMohamedPodcast('ogg')">WhatsApp Voice (.ogg)</button>
                  <button class="btn btn-ghost btn-sm" type="button" id="podcastGenMp4Btn" onclick="generateSafaMohamedPodcast('mp4')">Video Status (.mp4)</button>
                  <a id="podcastDownloadLink" class="btn btn-emerald btn-sm" style="display:none;" download="cardoso-ai-safa-mohamed.mp3">Soo Deji</a>
                </div>

                <audio id="podcastPreviewAudio" controls class="msg-audio" style="display:none;margin-top:0.85rem;"></audio>
                <video id="podcastPreviewVideo" controls playsinline style="display:none;width:100%;max-height:420px;border-radius:14px;margin-top:0.85rem;background:#020617;"></video>

                <div id="podcastTranscriptWrap" style="display:none;margin-top:0.9rem;padding:0.85rem;border-radius:12px;background:var(--bg-elevated);border:1px solid var(--border);">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.45rem;">
                    <strong style="font-size:0.82rem;color:var(--primary-text);">Qoraalka Sheekada (Transcript)</strong>
                    <button type="button" class="btn btn-ghost btn-sm" onclick="copyPodcastTranscript()">Copy</button>
                  </div>
                  <pre id="podcastTranscriptText" style="white-space:pre-wrap;font-family:inherit;font-size:0.82rem;line-height:1.55;color:var(--text-2);margin:0;max-height:220px;overflow-y:auto;"></pre>
                </div>
              </div>
            </div>

            <!-- Sub-tab 4: Quick Image Creator -->
            <div class="tool-panel" id="tool-panel-image">
              <div class="card">
                <h3>
                  <span class="card-title-grp">
                    <svg class="ico-svg" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                    <span>Samee Sawir AI</span>
                  </span>
                </h3>
                <p class="sub">Sharax sawirka aad rabto — CARDOSO AI ayaa si toos ah kuugu soo saaraya qolka sheekada.</p>
                <div style="display:flex;gap:0.55rem;flex-wrap:wrap;">
                  <input class="field" id="quickImgPrompt" style="flex:1;min-width:200px;" placeholder="Tusaale: Geel daaqaya dhul doog ah xilli subax ah..." />
                  <button class="btn btn-primary" type="button" onclick="runQuickImagePrompt()">Samee Sawir</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- TAB 5: SETTINGS -->
      <section id="pane-settings" class="view-pane">
        <div class="scroll-pane">
          <div class="scroll-inner">
            <div class="page-header">
              <div>
                <h2>Dejinta</h2>
                <p>Muuqaalka App-ka, xogtaada, iyo ku-darista shaashadda telefoonka.</p>
              </div>
            </div>

            <!-- Theme Selector Card -->
            <div class="card">
              <h3>
                <span class="card-title-grp">
                  <svg class="ico-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/></svg>
                  <span>Muuqaalka (Theme)</span>
                </span>
              </h3>
              <p class="sub">Dooro midabka kuu raaxada badan maalintii ama habeenkii.</p>
              <div class="theme-switch-row">
                <button type="button" class="theme-opt" id="themeOptDark" onclick="setAppTheme('dark')">
                  <svg class="ico-svg ico-sm" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                  <span>Dark Mode</span>
                </button>
                <button type="button" class="theme-opt" id="themeOptLight" onclick="setAppTheme('light')">
                  <svg class="ico-svg ico-sm" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/></svg>
                  <span>Light Mode</span>
                </button>
              </div>
            </div>

            <!-- Profile Settings -->
            <div class="card">
              <h3>
                <span class="card-title-grp">
                  <svg class="ico-svg" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  <span>Xogtaada</span>
                </span>
              </h3>
              <p class="sub">Magacaaga geli si CARDOSO AI magacaaga kuugu yeedho marka aad sheekeysanaysaan.</p>
              <div class="form-row">
                <label class="field-label" for="settingUserName">Magacaaga</label>
                <input class="field" id="settingUserName" placeholder="Tusaale: Mohamed" />
              </div>
              <div style="display:flex;gap:0.55rem;flex-wrap:wrap;">
                <button class="btn btn-primary" type="button" onclick="saveProfileSettings()">Keydi Magaca</button>
                <button class="btn btn-ghost" type="button" onclick="exportChatTranscript()">Soo Deji Sheekada (.txt)</button>
                <button class="btn btn-danger" type="button" onclick="startFreshChat(true)">Tirtir Xogtayda</button>
              </div>
            </div>

            <!-- Install App Card -->
            <div class="card">
              <h3>
                <span class="card-title-grp">
                  <svg class="ico-svg" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  <span>Install App (Telefoon / PC)</span>
                </span>
                <span data-pwa-installed-badge style="display:none;color:var(--accent);font-size:0.78rem;">Waa Installed</span>
              </h3>
              <p class="sub">Ku dar shaashaddaada adigoon Play Store ama App Store u baahnayn.</p>
              <div style="display:flex;gap:0.55rem;flex-wrap:wrap;margin-bottom:0.85rem;">
                <button class="btn btn-primary" type="button" data-pwa-install-btn onclick="triggerCardosoInstall()">Install CARDOSO AI</button>
                <button class="btn btn-ghost" type="button" onclick="document.getElementById('pwaInstallHelpModal').classList.add('open')">Tilmaanta Install-ka</button>
              </div>
              <div class="install-step">
                <strong>Android (Chrome)</strong>
                Guji badhanka <b>Install CARDOSO AI</b> ama saddexda dhibcood (⋮) → <b>Install app</b>.
              </div>
              <div class="install-step" style="margin-bottom:0;">
                <strong>iPhone / iPad (Safari)</strong>
                Guji badhanka <b>Share</b> ee hoose → dooro <b>Add to Home Screen</b> → <b>Add</b>.
              </div>
            </div>

            <!-- Discreet Collapsible Business / Admin Panel (Hidden from casual view) -->
            <details class="advanced-panel">
              <summary>
                <span>Maamulka Ganacsiga &amp; Xaaladda Adeegga</span>
                <svg class="ico-svg ico-sm" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
              </summary>
              <div class="hub-grid" style="margin-bottom:0.85rem;">
                <a href="/portal" class="hub-card">
                  <strong>Client Portal</strong>
                  <span>WhatsApp QR, Auto-Reply &amp; Leads</span>
                </a>
                <a href="/join" class="hub-card">
                  <strong>Isdiiwaangeli</strong>
                  <span>Sameyso bot ganacsi ama shakhsi</span>
                </a>
                <a href="/admin-login" class="hub-card">
                  <strong>Admin Studio</strong>
                  <span>Maamulka Guud ee Mulkiilaha</span>
                </a>
              </div>
              <div style="display:flex;flex-wrap:wrap;gap:0.55rem;font-size:0.78rem;color:var(--muted);" id="appDiagBadges">
                <span>Mode: <strong id="diagMode" style="color:var(--text-2);">--</strong></span>
                <span>·</span>
                <span>WhatsApp: <strong id="diagWa" style="color:var(--text-2);">--</strong></span>
                <span>·</span>
                <span>Session: <strong id="diagSession" style="color:var(--text-2);">--</strong></span>
              </div>
            </details>
          </div>
        </div>
      </section>

      <!-- Mobile Bottom Navigation -->
      <nav class="bottom-nav" aria-label="Mobile navigation">
        <button class="bnav-btn active" type="button" data-tab="chat" onclick="switchAppTab('chat')">
          <svg class="ico-svg ico-lg" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span>Sheeko</span>
        </button>
        <button class="bnav-btn" type="button" data-tab="call" onclick="switchAppTab('call')">
          <span class="bnav-live-dot"></span>
          <svg class="ico-svg ico-lg" viewBox="0 0 24 24"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
          <span>Video</span>
        </button>
        <button class="bnav-btn" type="button" data-tab="views" onclick="switchAppTab('views')">
          <svg class="ico-svg ico-lg" viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
          <span>Views</span>
        </button>
        <button class="bnav-btn" type="button" data-tab="tools" onclick="switchAppTab('tools')">
          <svg class="ico-svg ico-lg" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>
          <span>Adeegyo</span>
        </button>
        <button class="bnav-btn" type="button" data-tab="settings" onclick="switchAppTab('settings')">
          <svg class="ico-svg ico-lg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          <span>Dejinta</span>
        </button>
      </nav>
    </div>
  </div>

  <!-- Install Guide Modal -->
  <div id="pwaInstallHelpModal" class="modal-backdrop" onclick="if(event.target===this)this.classList.remove('open')">
    <div class="modal-box">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.85rem;">
        <h3 style="font-size:1.05rem;font-weight:800;">Sida Loo Install Gareeyo CARDOSO AI</h3>
        <button class="btn btn-ghost btn-sm" type="button" onclick="document.getElementById('pwaInstallHelpModal').classList.remove('open')">✕</button>
      </div>
      <div class="install-step">
        <strong>iPhone / iPad (Safari)</strong>
        1. Ku fur <b>Safari</b>.<br/>
        2. Guji badhanka <b>Share</b> ee hoose.<br/>
        3. Dooro <b>Add to Home Screen</b> kadibna guji <b>Add</b>.
      </div>
      <div class="install-step">
        <strong>Android (Google Chrome)</strong>
        1. Guji saddexda dhibcood <b>(⋮)</b> ee geeska midig.<br/>
        2. Dooro <b>Install app</b> ama <b>Add to Home screen</b>.
      </div>
      <div class="install-step">
        <strong>Windows / Mac (Chrome ama Edge)</strong>
        Guji calaamadda <b>Install</b> ee dhinaca midig ee address bar-ka.
      </div>
      <button class="btn btn-primary" type="button" style="width:100%;" onclick="document.getElementById('pwaInstallHelpModal').classList.remove('open')">Waan Fahmay</button>
    </div>
  </div>

  <div id="toastBanner" class="toast-banner"></div>

  <script>
    ${COMMON_CLIENT_JS}

    const INITIAL_TENANT_ID = ${safeTenantId};
    const INITIAL_TENANT_TOKEN = ${safeTenantToken};
    const INITIAL_MODE = ${safeMode};

    const TAB_TITLES = {
      chat: 'Sheeko AI',
      call: 'Live Video Call',
      views: 'Views & .vcf Hub',
      tools: 'Adeegyada',
      settings: 'Dejinta'
    };

    function getOrCreateSessionId() {
      let sid = '';
      try { sid = localStorage.getItem('cardoso_app_session_id') || ''; } catch {}
      if (!sid || sid.length < 8) {
        sid = 'web_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
        try { localStorage.setItem('cardoso_app_session_id', sid); } catch {}
      }
      return sid;
    }

    const state = {
      sessionId: getOrCreateSessionId(),
      tenantId: INITIAL_TENANT_ID,
      tenantToken: INITIAL_TENANT_TOKEN,
      userName: '',
      autoVoice: false,
      theme: 'dark',
      busy: false,
      messages: [],
      pendingMedia: null,
      mediaRecorder: null,
      recChunks: [],
      recStartedAt: 0,
      recTimer: null,
      ttsCache: {}
    };

    try {
      state.userName = localStorage.getItem('cardoso_app_user_name') || '';
      state.autoVoice = localStorage.getItem('cardoso_app_auto_voice') === '1';
      const savedTheme = localStorage.getItem('cardoso_app_theme');
      if (savedTheme === 'light' || savedTheme === 'dark') state.theme = savedTheme;
    } catch {}

    function setAppTheme(theme) {
      state.theme = theme === 'light' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', state.theme);
      try { localStorage.setItem('cardoso_app_theme', state.theme); } catch {}
      const icon = document.getElementById('themeToggleIcon');
      if (icon) {
        icon.innerHTML = state.theme === 'dark'
          ? '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'
          : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
      }
      const dOpt = document.getElementById('themeOptDark');
      const lOpt = document.getElementById('themeOptLight');
      if (dOpt) dOpt.classList.toggle('active', state.theme === 'dark');
      if (lOpt) lOpt.classList.toggle('active', state.theme === 'light');
    }

    function toggleAppTheme() {
      setAppTheme(state.theme === 'dark' ? 'light' : 'dark');
    }

    function toggleDesktopSidebar() {
      const sb = document.getElementById('appSidebar');
      if (sb) sb.classList.toggle('collapsed');
    }

    function updateAutoVoiceUI() {
      const btn = document.getElementById('autoVoiceToggleBtn');
      const label = document.getElementById('autoVoiceLabel');
      const icon = document.getElementById('autoVoiceIcon');
      if (!btn) return;
      if (state.autoVoice) {
        if (label) label.textContent = 'Cod: On';
        if (icon) icon.innerHTML = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>';
        btn.classList.add('active');
      } else {
        if (label) label.textContent = 'Cod: Off';
        if (icon) icon.innerHTML = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>';
        btn.classList.remove('active');
      }
    }

    function toggleAutoVoice() {
      state.autoVoice = !state.autoVoice;
      try { localStorage.setItem('cardoso_app_auto_voice', state.autoVoice ? '1' : '0'); } catch {}
      updateAutoVoiceUI();
      showToast(state.autoVoice ? 'Jawaab kasta hadda cod ayaa la socon doona' : 'Jawaabaha codka tooska ah waa la damiyay');
    }

    function switchToolSubTab(sub) {
      document.querySelectorAll('.tool-panel').forEach(function(p) { p.classList.remove('active'); });
      const panel = document.getElementById('tool-panel-' + sub);
      if (panel) panel.classList.add('active');
      document.querySelectorAll('[data-tool-tab]').forEach(function(b) {
        b.classList.toggle('active', b.getAttribute('data-tool-tab') === sub);
      });
      if (sub === 'prayer') loadPrayerTimes();
    }

    function switchAppTab(tabName) {
      document.querySelectorAll('.view-pane').forEach(function(p) { p.classList.remove('active'); });
      const target = document.getElementById('pane-' + tabName);
      if (target) target.classList.add('active');

      document.querySelectorAll('[data-tab]').forEach(function(b) {
        b.classList.toggle('active', b.getAttribute('data-tab') === tabName);
      });

      const titleEl = document.getElementById('activeViewTitle');
      if (titleEl && TAB_TITLES[tabName]) titleEl.textContent = TAB_TITLES[tabName];

      if (tabName === 'tools') loadPrayerTimes();
      if (tabName === 'views') loadAppViewsHub();
      if (tabName === 'call' && window.cardosoLiveCall) window.cardosoLiveCall.onTabActivated();
    }

    let appViewsMember = null;
    try {
      const savedM = localStorage.getItem('cardoso_views_member');
      if (savedM) appViewsMember = JSON.parse(savedM);
    } catch {}

    function renderAppViewsAuthUI() {
      const form = document.getElementById('appViewsJoinForm');
      const unl = document.getElementById('appViewsUnlockedBox');
      if (!form || !unl) return;
      if (appViewsMember && appViewsMember.phone) {
        form.style.display = 'none';
        unl.style.display = 'block';
        document.getElementById('appViewsJoinedBadge').textContent =
          (appViewsMember.displayName || 'Xubin') + ' (+' + appViewsMember.phone + ') — Batch #' + (appViewsMember.batchNumber || 1);
      } else {
        form.style.display = 'block';
        unl.style.display = 'none';
      }
    }

    async function loadAppViewsHub() {
      renderAppViewsAuthUI();
      try {
        const res = await fetch('/api/views/summary');
        const data = await res.json();
        if (!data || data.status !== 'ok') return;
        const stats = data.stats || {};
        const cfg = data.config || {};
        document.getElementById('appViewsMeterText').textContent =
          'Batch #' + (stats.currentBatch || 1) + ': ' + (stats.currentBatchFreeCount || 0) + ' / ' + (stats.batchTarget || 100) + ' Qof (+' + (stats.activeVipCount || 0) + ' VIP)';
        document.getElementById('appViewsTotalText').textContent = (stats.totalContacts || 0) + ' Contacts · ' + (stats.totalDownloads || 0) + ' DL';
        document.getElementById('appViewsMeterFill').style.width = (stats.progressPct || 0) + '%';

        const grid = document.getElementById('appViewsVipGrid');
        const vips = data.vips || [];
        if (!vips.length) {
          const vipPhone = (cfg.ownerVipPhone || '').replace(/\\D/g, '');
          const vipHref = vipPhone ? ('https://wa.me/' + vipPhone + '?text=' + encodeURIComponent('Asc! Waxaan rabaa VIP Pinned CARDOSO Views Hub.')) : '/views';
          grid.innerHTML = '<div class="mini-vip-card"><strong>Booska VIP Waa Banaan Yahay</strong><span style="font-size:0.78rem;color:var(--muted);">Ku xir ganacsigaaga korka .vcf kasta (' + escapeHtml(cfg.vipPriceLabel || '$5 / Bil') + ')</span><a href="' + vipHref + '" target="_blank" class="btn btn-primary btn-sm">Dalbo VIP</a></div>';
        } else {
          grid.innerHTML = vips.map(function(v) {
            const waUrl = 'https://wa.me/' + encodeURIComponent(v.phone) + '?text=' + encodeURIComponent('Asc ' + v.displayName + '! Waxaan kaa helay CARDOSO AI App.');
            return '<div class="mini-vip-card">' +
              '<div style="font-weight:800;font-size:0.88rem;">' + escapeHtml(v.displayName) + '</div>' +
              '<div style="font-size:0.74rem;color:var(--amber);">' + escapeHtml(v.city) + '</div>' +
              '<div style="font-size:0.78rem;color:var(--text-2);">' + escapeHtml(v.tagline || 'VIP Pinned Sponsor') + '</div>' +
              '<div style="display:flex;gap:0.4rem;margin-top:0.25rem;">' +
                '<a href="' + waUrl + '" target="_blank" class="btn btn-emerald btn-sm" style="flex:1;">Chat</a>' +
                '<button class="btn btn-ghost btn-sm" type="button" onclick="downloadAppSingleVip(' + v.id + ')">+ .vcf</button>' +
              '</div>' +
            '</div>';
          }).join('');
        }
      } catch {}
    }

    async function fetchAndSaveAppVcf(url, fallbackName) {
      const res = await fetch(url, { cache: 'no-store' });
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (!res.ok || ct.includes('application/json')) {
        const err = await res.json().catch(function() { return {}; });
        throw new Error(err.message || 'Faylka .vcf lama soo dejin karin');
      }
      const text = await res.text();
      if (!text || !text.includes('BEGIN:VCARD')) {
        throw new Error('Weli contacts diyaar ah ma jiraan');
      }
      const disp = res.headers.get('content-disposition') || '';
      const m = disp.match(/filename="([^"]+)"/i);
      const filename = (m && m[1]) ? m[1] : (fallbackName || 'CARDOSO_Views.vcf');
      const blob = new Blob([text], { type: 'text/vcard;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function() { URL.revokeObjectURL(blobUrl); }, 15000);
      return Number(res.headers.get('x-contacts-count') || 0);
    }

    async function submitAppViewsJoin(e) {
      e.preventDefault();
      const btn = document.getElementById('appViewsJoinBtn');
      btn.disabled = true;
      btn.textContent = 'Waa la diiwaangelinayaa...';
      try {
        const res = await fetch('/api/views/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: document.getElementById('appViewsName').value.trim(),
            countryCode: document.getElementById('appViewsCountry').value,
            phone: document.getElementById('appViewsPhone').value.trim(),
            city: document.getElementById('appViewsCity').value
          })
        });
        const data = await res.json();
        if (!res.ok || data.status !== 'ok') throw new Error(data.message || 'Khalad ayaa dhacay');
        appViewsMember = data.contact;
        try { localStorage.setItem('cardoso_views_member', JSON.stringify(data.contact)); } catch {}
        showToast('Waad ku biirtay Views Hub — hadda soo deji .vcf!');
        await loadAppViewsHub();
      } catch (err) {
        showToast(err.message || 'Khalad', true);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Ku Biir & Fur Faylka .vcf';
      }
    }

    async function lookupExistingAppViews() {
      const phone = String((document.getElementById('appViewsPhone') || {}).value || '').trim();
      const cc = String((document.getElementById('appViewsCountry') || {}).value || '');
      if (!phone) {
        showToast('Fadlan marka hore geli lambarkaaga sanduuqa lambarka', true);
        return;
      }
      try {
        const res = await fetch('/api/views/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: phone, countryCode: cc })
        });
        const data = await res.json();
        if (!res.ok || data.status !== 'ok') throw new Error(data.message || 'Lambarka lama helin');
        appViewsMember = data.contact;
        try { localStorage.setItem('cardoso_views_member', JSON.stringify(data.contact)); } catch {}
        showToast('Akoonkaaga waa la furay, ' + data.contact.displayName + '!');
        await loadAppViewsHub();
      } catch (err) {
        showToast(err.message || 'Khalad', true);
      }
    }

    async function downloadAppViewsVcf(scope) {
      const q = new URLSearchParams({ scope: scope || 'current' });
      if (appViewsMember && appViewsMember.phone) {
        q.set('myPhone', appViewsMember.phone);
        if ((scope || 'current') === 'current' && appViewsMember.batchNumber) {
          q.set('batch', String(appViewsMember.batchNumber));
        }
      }
      try {
        const cnt = await fetchAndSaveAppVcf('/api/views/download.vcf?' + q.toString(), 'CARDOSO_Views.vcf');
        showToast((cnt || '') + ' Contacts (.vcf) waa soo degeen — guji si aad u Import gareyso!');
        await loadAppViewsHub();
      } catch (err) {
        showToast(err.message || 'Lama soo dejin karin', true);
      }
    }

    async function downloadAppSingleVip(id) {
      try {
        await fetchAndSaveAppVcf('/api/views/download.vcf?scope=single&id=' + encodeURIComponent(String(id)), 'CARDOSO_VIP.vcf');
        showToast('Contact-ka VIP waa soo degay!');
      } catch (err) {
        showToast(err.message || 'Lama soo dejin karin', true);
      }
    }

    async function verifyAppViewsSaver() {
      if (!appViewsMember || !appViewsMember.phone) return;
      try {
        const res = await fetch('/api/views/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: appViewsMember.phone })
        });
        const data = await res.json();
        if (res.ok && data.status === 'ok') {
          showToast('Waad ku mahadsan tahay! Verified Saver waa la diiwaangeliyay.');
          await loadAppViewsHub();
        }
      } catch {}
    }

    function shareAppViewsLink() {
      const ref = appViewsMember && appViewsMember.phone ? ('?ref=' + encodeURIComponent(appViewsMember.phone)) : '';
      const url = location.origin + '/views' + ref;
      const msg = 'Hel 200+ WhatsApp Status Views dhab ah (0% Ban) adigoo 1-click .vcf soo dejinaya: ' + url;
      window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
    }

    function renderSafeMarkdown(rawText) {
      const NL = String.fromCharCode(10);
      const src = String(rawText || '').replace(/\\r\\n/g, NL);
      const blocks = [];
      const withPlaceholders = src.replace(/\`\`\`([a-zA-Z0-9_-]*)?\\n?([\\s\\S]*?)\`\`\`/g, function(_, lang, code) {
        const idx = blocks.length;
        blocks.push('<pre class="code-block"><button class="code-copy-btn" type="button" onclick="copyCodeBlock(this)">Copy</button><code>' + escapeHtml(code.trim()) + '</code></pre>');
        return '@@CODEBLOCK_' + idx + '@@';
      });

      let html = escapeHtml(withPlaceholders);
      html = html.replace(/\`([^\`\\n]+)\`/g, '<code class="inline-code">$1</code>');
      html = html.replace(/\\*\\*([^\\*\\n]+)\\*\\*/g, '<strong>$1</strong>');
      html = html.replace(/(^|\\s)\\*([^\\*\\n]+)\\*(?=[\\s.,!?:;]|$)/g, '$1<strong>$2</strong>');
      html = html.replace(/(^|\\s)_([^_\\n]+)_(?=[\\s.,!?:;]|$)/g, '$1<em>$2</em>');
      html = html.replace(/(https?:\\/\\/[^\\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');

      const lines = html.split(NL);
      let out = '';
      let inList = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^@@CODEBLOCK_\\d+@@$/.test(line.trim())) {
          if (inList) { out += '</ul>'; inList = false; }
          out += line.trim();
          continue;
        }
        const bulletMatch = line.match(/^\\s*(?:[•\\-\\*])\\s+(.*)$/);
        if (bulletMatch) {
          if (!inList) { out += '<ul>'; inList = true; }
          out += '<li>' + bulletMatch[1] + '</li>';
        } else {
          if (inList) { out += '</ul>'; inList = false; }
          if (line.trim() !== '') {
            out += '<p>' + line + '</p>';
          }
        }
      }
      if (inList) out += '</ul>';

      for (let b = 0; b < blocks.length; b++) {
        out = out.replace('@@CODEBLOCK_' + b + '@@', blocks[b]);
      }
      return out || '<p></p>';
    }

    function copyCodeBlock(btn) {
      const pre = btn && btn.parentElement;
      const code = pre && pre.querySelector('code');
      if (!code) return;
      copyText(code.textContent || '', 'Code-ka waa la koobiyeeyay!');
    }

    function formatClock(ts) {
      try {
        const d = new Date(ts || Date.now());
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } catch { return ''; }
    }

    function scrollChatBottom() {
      const box = document.getElementById('chatScroll');
      if (box) box.scrollTop = box.scrollHeight;
    }

    function appendMessageBubble(msg) {
      const hero = document.getElementById('welcomeHero');
      if (hero) hero.style.display = 'none';

      const container = document.getElementById('chatMessages');
      if (!container) return;

      const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      const isUser = msg.role === 'user';
      const row = document.createElement('div');
      row.className = 'msg-row ' + (isUser ? 'user' : 'model');

      const avatar = document.createElement('div');
      avatar.className = 'msg-avatar';
      avatar.textContent = isUser ? (state.userName ? state.userName.slice(0, 1).toUpperCase() : 'U') : 'AI';

      const bubble = document.createElement('div');
      bubble.className = 'msg-bubble';

      if (msg.imageDataUrl) {
        const img = document.createElement('img');
        img.className = 'msg-img';
        img.src = msg.imageDataUrl;
        img.alt = 'Media';
        bubble.appendChild(img);
      }

      if (msg.replyMedia && msg.replyMedia.type === 'image' && msg.replyMedia.dataBase64) {
        const srcUrl = 'data:' + (msg.replyMedia.mimeType || 'image/png') + ';base64,' + msg.replyMedia.dataBase64;
        const img = document.createElement('img');
        img.className = 'msg-img';
        img.src = srcUrl;
        img.alt = 'CARDOSO AI Image';
        bubble.appendChild(img);

        const dlWrap = document.createElement('div');
        dlWrap.style.marginBottom = '0.45rem';
        dlWrap.innerHTML = '<a class="mini-act-btn" href="' + srcUrl + '" download="cardoso-ai-image.png">Soo Deji Sawirka</a>';
        bubble.appendChild(dlWrap);
      }

      const textEl = document.createElement('div');
      textEl.className = 'msg-text';
      textEl.innerHTML = renderSafeMarkdown(msg.content || '');
      bubble.appendChild(textEl);

      const audioSlot = document.createElement('div');
      audioSlot.id = msgId + '_audio';
      bubble.appendChild(audioSlot);

      if (msg.replyMedia && msg.replyMedia.type === 'audio' && msg.replyMedia.dataBase64) {
        const audioSrc = 'data:' + (msg.replyMedia.mimeType || 'audio/mpeg') + ';base64,' + msg.replyMedia.dataBase64;
        const audio = document.createElement('audio');
        audio.className = 'msg-audio';
        audio.controls = true;
        audio.src = audioSrc;
        audioSlot.appendChild(audio);
        if (msg.autoPlayAudio) {
          audio.play().catch(function() {});
        }
      }

      const foot = document.createElement('div');
      foot.className = 'msg-foot';
      if (!isUser) {
        const acts = document.createElement('div');
        acts.className = 'msg-actions';

        const listenBtn = document.createElement('button');
        listenBtn.className = 'mini-act-btn';
        listenBtn.type = 'button';
        listenBtn.textContent = 'Dhageyso';
        listenBtn.onclick = function() { playMessageTts(msgId, msg.content || '', msg.language || 'so', listenBtn); };
        acts.appendChild(listenBtn);

        const cpBtn = document.createElement('button');
        cpBtn.className = 'mini-act-btn';
        cpBtn.type = 'button';
        cpBtn.textContent = 'Copy';
        cpBtn.onclick = function() { copyText(msg.content || '', 'Jawaabta waa la koobiyeeyay!'); };
        acts.appendChild(cpBtn);

        foot.appendChild(acts);
      }

      const timeSpan = document.createElement('span');
      timeSpan.textContent = formatClock(msg.timestamp);
      foot.appendChild(timeSpan);

      bubble.appendChild(foot);
      row.appendChild(avatar);
      row.appendChild(bubble);
      container.appendChild(row);
      scrollChatBottom();
    }

    async function playMessageTts(msgId, text, language, btnEl) {
      const slot = document.getElementById(msgId + '_audio');
      if (!slot || !text.trim()) return;

      if (state.ttsCache[msgId]) {
        const existingAudio = slot.querySelector('audio');
        if (existingAudio) {
          existingAudio.currentTime = 0;
          existingAudio.play().catch(function() {});
          return;
        }
      }

      const prevLabel = btnEl.textContent;
      btnEl.disabled = true;
      btnEl.textContent = 'Cod...';
      try {
        const res = await fetch('/api/app/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: text, language: language || 'so' })
        });
        if (!res.ok) {
          const err = await res.json().catch(function() { return {}; });
          throw new Error(err.message || 'Codka lama samayn karin');
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        state.ttsCache[msgId] = url;
        slot.innerHTML = '';
        const audio = document.createElement('audio');
        audio.className = 'msg-audio';
        audio.controls = true;
        audio.src = url;
        slot.appendChild(audio);
        audio.play().catch(function() {});
        btnEl.textContent = 'Mar kale';
      } catch (err) {
        showToast(err.message || 'Codka lama heli karin', true);
        btnEl.textContent = prevLabel;
      } finally {
        btnEl.disabled = false;
      }
    }

    function showTypingBubble() {
      removeTypingBubble();
      const container = document.getElementById('chatMessages');
      if (!container) return;
      const row = document.createElement('div');
      row.id = 'typingRow';
      row.className = 'msg-row model';
      row.innerHTML = '<div class="msg-avatar">AI</div><div class="msg-bubble"><div class="typing-dots"><span></span><span></span><span></span></div></div>';
      container.appendChild(row);
      scrollChatBottom();
    }

    function removeTypingBubble() {
      const el = document.getElementById('typingRow');
      if (el) el.remove();
    }

    function handleFilePicked(ev) {
      const file = ev && ev.target && ev.target.files && ev.target.files[0];
      if (!file) return;
      if (file.size > 9 * 1024 * 1024) {
        showToast('Sawirku waa ka weyn yahay 9MB — fadlan mid ka yar soo xul', true);
        ev.target.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = function() {
        const dataUrl = String(reader.result || '');
        const commaIdx = dataUrl.indexOf(',');
        const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
        state.pendingMedia = {
          type: 'image',
          mimeType: file.type || 'image/jpeg',
          dataBase64: base64,
          fileName: file.name,
          previewUrl: dataUrl
        };
        const thumb = document.getElementById('attachThumb');
        thumb.src = dataUrl;
        thumb.style.display = 'block';
        document.getElementById('attachName').textContent = file.name;
        document.getElementById('attachMeta').textContent = 'Sawir diyaar u ah dirista';
        document.getElementById('attachPreview').classList.add('show');
      };
      reader.readAsDataURL(file);
      ev.target.value = '';
    }

    function clearAttachment() {
      state.pendingMedia = null;
      document.getElementById('attachPreview').classList.remove('show');
      const thumb = document.getElementById('attachThumb');
      thumb.src = '';
      thumb.style.display = 'none';
    }

    const MIC_IDLE_SVG = '<svg class="ico-svg" viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
    const MIC_STOP_SVG = '<svg class="ico-svg ico-sm" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>';

    async function toggleVoiceRecord() {
      const micBtn = document.getElementById('micBtn');
      if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
        state.mediaRecorder.stop();
        return;
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
        showToast('Browser-kan ma taageero duubista codka tooska ah (HTTPS ayaa loo baahan yahay)', true);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');
        const recorder = mimeType ? new MediaRecorder(stream, { mimeType: mimeType }) : new MediaRecorder(stream);
        state.mediaRecorder = recorder;
        state.recChunks = [];
        state.recStartedAt = Date.now();

        micBtn.classList.add('recording');
        micBtn.innerHTML = MIC_STOP_SVG;
        showToast('Codkaaga waa la duubayaa... mar kale guji si aad u dirto');

        recorder.ondataavailable = function(e) {
          if (e.data && e.data.size > 0) state.recChunks.push(e.data);
        };
        recorder.onstop = function() {
          stream.getTracks().forEach(function(t) { t.stop(); });
          micBtn.classList.remove('recording');
          micBtn.innerHTML = MIC_IDLE_SVG;
          const outMime = recorder.mimeType || 'audio/webm';
          const blob = new Blob(state.recChunks, { type: outMime });
          if (blob.size < 400) {
            showToast('Codku aad buu u gaabnaa — mar kale isku day', true);
            return;
          }
          const reader = new FileReader();
          reader.onload = function() {
            const dataUrl = String(reader.result || '');
            const idx = dataUrl.indexOf(',');
            const base64 = idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
            state.pendingMedia = {
              type: 'audio',
              mimeType: outMime.split(';')[0],
              dataBase64: base64,
              fileName: 'voice-note.webm'
            };
            sendChatMessage('Fariin cod ah', true);
          };
          reader.readAsDataURL(blob);
        };
        recorder.start();
      } catch (err) {
        showToast('Ogolaanshaha Makarafoonka lama siin', true);
      }
    }

    function sendStarter(promptText, forceVoice) {
      const input = document.getElementById('chatInput');
      if (input) input.value = promptText;
      sendChatMessage(promptText, Boolean(forceVoice));
    }

    async function sendChatMessage(overrideText, forceVoiceOnce) {
      if (state.busy) return;
      const input = document.getElementById('chatInput');
      const rawText = overrideText !== undefined ? String(overrideText) : String(input ? input.value : '');
      const text = rawText.trim();
      const media = state.pendingMedia;

      if (!text && !media) return;

      const displayText = text || (media && media.type === 'image' ? 'Sawir ayaan soo diray — fadlan ii sharax.' : 'Fariin cod ah');
      const userMsg = {
        role: 'user',
        content: displayText,
        timestamp: Date.now(),
        imageDataUrl: media && media.type === 'image' ? media.previewUrl : undefined
      };
      state.messages.push(userMsg);
      appendMessageBubble(userMsg);

      if (input) {
        input.value = '';
        input.style.height = 'auto';
      }
      const mediaPayload = media ? {
        type: media.type,
        mimeType: media.mimeType,
        dataBase64: media.dataBase64,
        fileName: media.fileName
      } : undefined;
      clearAttachment();

      state.busy = true;
      const sendBtn = document.getElementById('sendBtn');
      if (sendBtn) sendBtn.disabled = true;
      showTypingBubble();

      try {
        const res = await fetch('/api/app/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: state.sessionId,
            message: displayText,
            senderName: state.userName || undefined,
            wantVoice: Boolean(forceVoiceOnce || state.autoVoice),
            media: mediaPayload,
            tenantId: state.tenantId || undefined,
            token: state.tenantToken || undefined
          })
        });
        const data = await res.json();
        removeTypingBubble();
        if (!res.ok || data.status !== 'ok') {
          throw new Error(data.message || 'Jawaab lama helin');
        }
        const aiMsg = {
          role: 'model',
          content: data.reply || '...',
          language: data.language || 'so',
          timestamp: Date.now(),
          replyMedia: data.replyMedia || null,
          autoPlayAudio: Boolean(forceVoiceOnce || state.autoVoice)
        };
        state.messages.push(aiMsg);
        appendMessageBubble(aiMsg);
      } catch (err) {
        removeTypingBubble();
        appendMessageBubble({
          role: 'model',
          content: 'Khalad ayaa dhacay: ' + (err.message || 'Fadlan hubi internet-kaaga oo mar kale isku day.'),
          timestamp: Date.now()
        });
      } finally {
        state.busy = false;
        if (sendBtn) sendBtn.disabled = false;
        if (input) input.focus();
      }
    }

    async function loadHistory() {
      try {
        const q = new URLSearchParams({ sessionId: state.sessionId });
        if (state.tenantId && state.tenantToken) {
          q.set('tenantId', state.tenantId);
          q.set('token', state.tenantToken);
        }
        const res = await fetch('/api/app/history?' + q.toString());
        const data = await res.json();
        if (data && data.status === 'ok' && Array.isArray(data.messages) && data.messages.length > 0) {
          state.messages = data.messages;
          data.messages.forEach(function(m) {
            appendMessageBubble({
              role: m.role === 'user' ? 'user' : 'model',
              content: m.content,
              language: m.languageDetected || 'so',
              timestamp: m.timestamp
            });
          });
        }
      } catch {}
    }

    async function startFreshChat(skipConfirm) {
      if (!skipConfirm && state.messages.length > 0) {
        if (!confirm('Ma hubtaa inaad tirtirto sheekada hadda socota oo aad billowdo sheeko cusub?')) return;
      }
      try {
        const q = new URLSearchParams({ sessionId: state.sessionId });
        if (state.tenantId && state.tenantToken) {
          q.set('tenantId', state.tenantId);
          q.set('token', state.tenantToken);
        }
        await fetch('/api/app/history?' + q.toString(), { method: 'DELETE' });
      } catch {}

      state.messages = [];
      state.ttsCache = {};
      const container = document.getElementById('chatMessages');
      if (container) {
        container.querySelectorAll('.msg-row').forEach(function(r) { r.remove(); });
      }
      const hero = document.getElementById('welcomeHero');
      if (hero) hero.style.display = 'block';
      switchAppTab('chat');
      showToast('Sheeko cusub ayaa kuu furan!');
    }

    async function loadBootstrap() {
      try {
        const q = new URLSearchParams();
        if (state.tenantId && state.tenantToken) {
          q.set('tenantId', state.tenantId);
          q.set('token', state.tenantToken);
        }
        const res = await fetch('/api/app/bootstrap' + (q.toString() ? '?' + q.toString() : ''));
        const data = await res.json();
        if (data && data.status === 'ok') {
          const name = data.botName || 'CARDOSO AI';
          const topName = document.getElementById('topBotName');
          if (topName) topName.textContent = name;
          const sideTitle = document.getElementById('sideBotTitle');
          if (sideTitle) sideTitle.innerHTML = escapeHtml(name);
          if (data.businessName) {
            const sub = document.getElementById('sideBotSub');
            if (sub) sub.textContent = data.businessName;
          }
          const st = document.getElementById('topStatusText');
          if (st) st.textContent = 'Online';
          const dm = document.getElementById('diagMode');
          if (dm) dm.textContent = data.mode || INITIAL_MODE;
          const dw = document.getElementById('diagWa');
          if (dw) dw.textContent = data.whatsappConnected ? 'Connected' : 'App Mode';
          const ds = document.getElementById('diagSession');
          if (ds) ds.textContent = state.sessionId;
        }
      } catch {}
    }

    let prayersLoaded = false;
    async function loadPrayerTimes() {
      if (prayersLoaded) return;
      try {
        const res = await fetch('/api/app/prayer-times');
        const data = await res.json();
        if (!data || data.status !== 'ok') return;
        prayersLoaded = true;
        document.getElementById('prayerDateLabel').textContent = data.dateStr + ' (' + (data.currentTimeEAT || '') + ' EAT)';
        const grid = document.getElementById('prayerGrid');
        grid.innerHTML = '';
        (data.prayers || []).forEach(function(p) {
          const box = document.createElement('div');
          box.className = 'prayer-box' + (p.key === data.nextPrayerKey ? ' next' : '');
          box.innerHTML =
            '<div class="p-name">' + escapeHtml(p.somaliName) + (p.key === data.nextPrayerKey ? ' · Next' : '') + '</div>' +
            '<div class="p-ar">' + escapeHtml(p.arabicName) + '</div>' +
            '<div class="p-time">' + escapeHtml(p.timeStr) + '</div>';
          grid.appendChild(box);
        });
        if (data.featuredAyah) {
          document.getElementById('prayerAyahBox').style.display = 'block';
          document.getElementById('prayerAyahAr').textContent = data.featuredAyah.arabic || '';
          document.getElementById('prayerAyahSo').textContent = data.featuredAyah.somali || '';
          document.getElementById('prayerAyahRef').textContent = data.featuredAyah.ref || '';
        }
      } catch {}
    }

    async function generateStudioVoice() {
      const textEl = document.getElementById('ttsInputText');
      const langEl = document.getElementById('ttsLangSelect');
      const btn = document.getElementById('ttsGenBtn');
      const audio = document.getElementById('ttsPreviewAudio');
      const dl = document.getElementById('ttsDownloadLink');
      const text = String(textEl ? textEl.value : '').trim();
      if (!text) {
        showToast('Fadlan qor qoraalka aad codka u beddelayso', true);
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Codka waa la samaynayaa...';
      try {
        const res = await fetch('/api/app/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: text, language: langEl ? langEl.value : 'so' })
        });
        if (!res.ok) {
          const err = await res.json().catch(function() { return {}; });
          throw new Error(err.message || 'Codka lama samayn karin');
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        audio.src = url;
        audio.style.display = 'block';
        audio.play().catch(function() {});
        dl.href = url;
        dl.style.display = 'inline-flex';
        showToast('Codkaaga MP3 waa diyaar!');
      } catch (err) {
        showToast(err.message || 'Khalad ayaa dhacay', true);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Samee Cod (MP3)';
      }
    }

    function copyPodcastTranscript() {
      const el = document.getElementById('podcastTranscriptText');
      const txt = String(el ? el.textContent : '').trim();
      if (!txt) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function() {
          showToast('Qoraalka Safa & Mohamed waa la koobiyeeyay!');
        }).catch(function() {});
      }
    }

    async function generateSafaMohamedPodcast(format) {
      const topicEl = document.getElementById('podcastTopicInput');
      const scriptEl = document.getElementById('podcastScriptInput');
      const styleEl = document.getElementById('podcastStyleSelect');
      const durEl = document.getElementById('podcastDurationSelect');
      const soundEl = document.getElementById('podcastSoundSelect');
      const teaserEl = document.getElementById('podcastTeaserBox');
      const mp3Btn = document.getElementById('podcastGenMp3Btn');
      const oggBtn = document.getElementById('podcastGenOggBtn');
      const mp4Btn = document.getElementById('podcastGenMp4Btn');
      const audio = document.getElementById('podcastPreviewAudio');
      const video = document.getElementById('podcastPreviewVideo');
      const dl = document.getElementById('podcastDownloadLink');
      const tWrap = document.getElementById('podcastTranscriptWrap');
      const tText = document.getElementById('podcastTranscriptText');

      const topic = String(topicEl ? topicEl.value : '').trim();
      const script = String(scriptEl ? scriptEl.value : '').trim();
      const style = styleEl ? styleEl.value : 'debate';
      const durationMinutes = Number(durEl ? durEl.value : 2) || 2;
      const soundMode = soundEl ? soundEl.value : 'chime';

      if (!topic && !script) {
        showToast('Fadlan geli mawduuc ama qor wada-sheekeysiga Safa iyo Mohamed', true);
        return;
      }

      const fmt = format === 'ogg' ? 'ogg' : format === 'mp4' ? 'mp4' : 'mp3';
      mp3Btn.disabled = true;
      oggBtn.disabled = true;
      if (mp4Btn) mp4Btn.disabled = true;
      mp3Btn.textContent = 'Safa & Mohamed Studio...';
      if (teaserEl) {
        teaserEl.style.display = 'block';
        teaserEl.innerHTML = '<strong>Goor dhow la soco:</strong> Safa &amp; Mohamed waxay ka wada hadlayaan <strong>' +
          escapeHtml(topic || 'CARDOSO AI') + '</strong> (~' + durationMinutes + ' daqiiqo)...';
      }

      try {
        const payload = {
          style: style,
          durationMinutes: durationMinutes,
          soundMode: soundMode,
          format: fmt,
          returnJson: true
        };
        if (topic) payload.topic = topic;
        else payload.script = script;

        const res = await fetch('/api/app/podcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(function() { return {}; });
        if (!res.ok || data.status !== 'ok' || !data.mediaBase64) {
          throw new Error(data.message || 'Podcast-ka lama samayn karin');
        }

        const binStr = atob(data.mediaBase64);
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
        const blob = new Blob([bytes], { type: data.mimeType || (fmt === 'mp4' ? 'video/mp4' : 'audio/mpeg') });
        const url = URL.createObjectURL(blob);

        if (fmt === 'mp4' && video) {
          audio.style.display = 'none';
          video.src = url;
          video.style.display = 'block';
          video.play().catch(function() {});
        } else {
          if (video) video.style.display = 'none';
          audio.src = url;
          audio.style.display = 'block';
          audio.play().catch(function() {});
        }

        dl.href = url;
        dl.download = 'cardoso-ai-safa-mohamed.' + (data.fileExt || fmt);
        dl.textContent = 'Soo Deji (' + String(data.fileExt || fmt).toUpperCase() + ' · ' + (data.seconds || '?') + 's)';
        dl.style.display = 'inline-flex';

        if (tWrap && tText && data.transcript) {
          tText.textContent = data.transcript;
          tWrap.style.display = 'block';
        }
        if (teaserEl) {
          teaserEl.innerHTML = '<strong>Safa &amp; Mohamed Podcast waa diyaar!</strong> (' + (data.seconds || '?') + 's · ' + (data.turnCount || '?') + ' qaybood)';
        }
        showToast('Podcast-ka Safa & Mohamed waa diyaar!');
      } catch (err) {
        if (teaserEl) teaserEl.style.display = 'none';
        showToast(err.message || 'Khalad ayaa dhacay', true);
      } finally {
        mp3Btn.disabled = false;
        oggBtn.disabled = false;
        if (mp4Btn) mp4Btn.disabled = false;
        mp3Btn.textContent = 'Podcast Stereo (MP3)';
      }
    }

    function runQuickImagePrompt() {
      const el = document.getElementById('quickImgPrompt');
      const val = String(el ? el.value : '').trim();
      if (!val) {
        showToast('Fadlan qor faahfaahinta sawirka', true);
        return;
      }
      el.value = '';
      switchAppTab('chat');
      sendStarter('Ii samee sawir: ' + val, false);
    }

    function saveProfileSettings() {
      const el = document.getElementById('settingUserName');
      state.userName = String(el ? el.value : '').trim();
      try { localStorage.setItem('cardoso_app_user_name', state.userName); } catch {}
      showToast('Magacaaga waa la keydiyay!');
    }

    function exportChatTranscript() {
      if (!state.messages || state.messages.length === 0) {
        showToast('Ma jirto sheeko la soo dejiyo', true);
        return;
      }
      const NL = String.fromCharCode(10);
      const text = state.messages.map(function(m) {
        const who = m.role === 'user' ? (state.userName || 'Adiga') : 'CARDOSO AI';
        return '[' + formatClock(m.timestamp) + '] ' + who + ':' + NL + m.content + NL;
      }).join(NL);
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'cardoso-ai-chat.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
    }

    (function setupInput() {
      const input = document.getElementById('chatInput');
      if (!input) return;
      input.addEventListener('input', function() {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 128) + 'px';
      });
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendChatMessage();
        }
      });
    })();

    (function bootApp() {
      const nameInput = document.getElementById('settingUserName');
      if (nameInput) nameInput.value = state.userName;
      setAppTheme(state.theme);
      updateAutoVoiceUI();
      loadBootstrap();
      loadHistory();
    })();

    ${renderLiveCallClientJS()}
  </script>
</body>
</html>`;
}
