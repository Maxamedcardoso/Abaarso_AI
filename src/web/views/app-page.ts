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
  const initialSub = options?.businessName || 'Kaaliyahaaga Casriga ah — Chat, Cod & Adeegyo';
  const safeTenantId = JSON.stringify(options?.tenantId || '');
  const safeTenantToken = JSON.stringify(options?.tenantToken || '');
  const safeMode = JSON.stringify(options?.mode || 'baileys');

  return `<!DOCTYPE html>
<html lang="so">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover" />
  <title>${escapeAttr(initialBotName)} — Smart App</title>
  ${PWA_HEAD_TAGS}
  <style>
    :root {
      --bg: #070b14;
      --bg-panel: #0c1324;
      --bg-card: rgba(17, 25, 44, 0.84);
      --border: rgba(148, 163, 184, 0.15);
      --primary: #06b6d4;
      --primary-2: #2563eb;
      --accent: #10b981;
      --violet: #8b5cf6;
      --amber: #f59e0b;
      --danger: #ef4444;
      --text: #f8fafc;
      --muted: #94a3b8;
      --user-bubble: linear-gradient(135deg, #06b6d4, #2563eb);
      --ai-bubble: rgba(19, 29, 51, 0.92);
      --safe-top: env(safe-area-inset-top, 0px);
      --safe-bottom: env(safe-area-inset-bottom, 0px);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', system-ui, -apple-system, BlinkMacSystemFont, sans-serif; -webkit-tap-highlight-color: transparent; }

    html, body {
      height: 100%;
      height: 100dvh;
      overflow: hidden;
      background:
        radial-gradient(ellipse 80% 50% at 50% -15%, rgba(6, 182, 212, 0.16), transparent),
        radial-gradient(ellipse 55% 40% at 95% 10%, rgba(139, 92, 246, 0.12), transparent),
        var(--bg);
      color: var(--text);
    }

    .app-shell {
      display: flex;
      height: 100%;
      width: 100%;
      overflow: hidden;
    }

    /* ─── Desktop Sidebar ─── */
    .sidebar {
      width: 272px;
      flex-shrink: 0;
      background: rgba(9, 14, 28, 0.94);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      padding: 1rem;
      gap: 0.85rem;
    }
    .side-brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.35rem 0.25rem;
    }
    .side-brand img {
      width: 42px;
      height: 42px;
      border-radius: 12px;
      box-shadow: 0 6px 18px rgba(6, 182, 212, 0.3);
    }
    .side-brand h1 { font-size: 1.08rem; font-weight: 800; letter-spacing: -0.02em; }
    .side-brand h1 span { color: var(--primary); }
    .side-brand p { font-size: 0.74rem; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 175px; }

    .new-chat-btn {
      width: 100%;
      border: 1px solid rgba(6, 182, 212, 0.35);
      background: rgba(6, 182, 212, 0.12);
      color: #67e8f9;
      border-radius: 12px;
      padding: 0.7rem 0.9rem;
      font-weight: 700;
      font-size: 0.86rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      transition: all 0.18s;
    }
    .new-chat-btn:hover { background: rgba(6, 182, 212, 0.22); transform: translateY(-1px); }

    .side-nav { display: flex; flex-direction: column; gap: 0.35rem; }
    .side-nav-btn {
      width: 100%;
      text-align: left;
      border: 1px solid transparent;
      background: transparent;
      color: var(--muted);
      padding: 0.72rem 0.85rem;
      border-radius: 11px;
      font-size: 0.88rem;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.65rem;
      transition: all 0.18s;
    }
    .side-nav-btn:hover { color: #fff; background: rgba(255, 255, 255, 0.04); }
    .side-nav-btn.active {
      background: linear-gradient(135deg, rgba(6, 182, 212, 0.18), rgba(37, 99, 235, 0.18));
      border-color: rgba(6, 182, 212, 0.35);
      color: #fff;
    }

    .side-divider { height: 1px; background: var(--border); margin: 0.2rem 0; }
    .side-links { display: flex; flex-direction: column; gap: 0.35rem; }
    .side-link {
      display: flex; align-items: center; gap: 0.6rem;
      padding: 0.58rem 0.8rem; border-radius: 10px;
      color: #cbd5e1; text-decoration: none; font-size: 0.82rem; font-weight: 600;
      background: rgba(148, 163, 184, 0.06); border: 1px solid var(--border);
      transition: all 0.16s;
    }
    .side-link:hover { background: rgba(148, 163, 184, 0.14); color: #fff; }

    .side-install-card {
      margin-top: auto;
      background: linear-gradient(150deg, rgba(6, 182, 212, 0.14), rgba(99, 102, 241, 0.14));
      border: 1px solid rgba(6, 182, 212, 0.3);
      border-radius: 14px;
      padding: 0.9rem;
    }
    .side-install-card h3 { font-size: 0.86rem; font-weight: 800; margin-bottom: 0.25rem; }
    .side-install-card p { font-size: 0.74rem; color: var(--muted); line-height: 1.45; margin-bottom: 0.65rem; }

    /* ─── Main Area ─── */
    .main-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
      height: 100%;
      position: relative;
    }

    .app-topbar {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.65rem;
      padding: calc(0.65rem + var(--safe-top)) 1rem 0.65rem;
      background: rgba(7, 11, 20, 0.88);
      backdrop-filter: blur(14px);
      border-bottom: 1px solid var(--border);
      z-index: 20;
    }
    .topbar-left { display: flex; align-items: center; gap: 0.65rem; min-width: 0; }
    .mobile-logo {
      display: none;
      width: 36px; height: 36px; border-radius: 10px;
      flex-shrink: 0;
    }
    .topbar-title-wrap { min-width: 0; }
    .topbar-title { font-size: 0.98rem; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .topbar-status { display: flex; align-items: center; gap: 0.4rem; font-size: 0.74rem; color: var(--muted); }
    .dot-online { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 8px var(--accent); flex-shrink: 0; }

    .topbar-actions { display: flex; align-items: center; gap: 0.45rem; flex-shrink: 0; }

    .icon-pill {
      display: inline-flex; align-items: center; justify-content: center; gap: 0.35rem;
      border: 1px solid var(--border);
      background: rgba(148, 163, 184, 0.1);
      color: #e2e8f0;
      border-radius: 999px;
      padding: 0.42rem 0.75rem;
      font-size: 0.78rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.16s;
      white-space: nowrap;
    }
    .icon-pill:hover { background: rgba(148, 163, 184, 0.2); }
    .icon-pill.active {
      background: rgba(16, 185, 129, 0.18);
      border-color: rgba(16, 185, 129, 0.45);
      color: #34d399;
    }
    .icon-pill.install-cta {
      background: linear-gradient(135deg, #06b6d4, #2563eb);
      border-color: transparent;
      color: #fff;
      box-shadow: 0 4px 14px rgba(6, 182, 212, 0.28);
    }

    /* Install Banner (dismissible top strip on mobile) */
    .install-banner {
      display: none;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 0.6rem 1rem;
      background: linear-gradient(90deg, rgba(6, 182, 212, 0.16), rgba(99, 102, 241, 0.18));
      border-bottom: 1px solid rgba(6, 182, 212, 0.28);
      font-size: 0.8rem;
      flex-shrink: 0;
    }
    .install-banner strong { color: #67e8f9; }
    .install-banner-actions { display: flex; align-items: center; gap: 0.45rem; flex-shrink: 0; }

    /* ─── Views ─── */
    .view-pane {
      display: none;
      flex: 1;
      min-height: 0;
      flex-direction: column;
      overflow: hidden;
    }
    .view-pane.active { display: flex; }

    .scroll-pane {
      flex: 1;
      overflow-y: auto;
      padding: 1.15rem;
      -webkit-overflow-scrolling: touch;
    }
    .scroll-inner { max-width: 860px; margin: 0 auto; width: 100%; }

    /* ─── Chat Messages ─── */
    .chat-scroll {
      flex: 1;
      overflow-y: auto;
      padding: 1rem 1rem 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.9rem;
      -webkit-overflow-scrolling: touch;
    }
    .chat-inner {
      max-width: 820px;
      width: 100%;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
    }

    .welcome-hero {
      text-align: center;
      padding: 1.8rem 1rem 1.2rem;
      max-width: 680px;
      margin: 0.5rem auto 0;
    }
    .welcome-hero img {
      width: 72px; height: 72px; border-radius: 20px;
      margin-bottom: 0.9rem;
      box-shadow: 0 12px 32px rgba(6, 182, 212, 0.32);
    }
    .welcome-hero h2 { font-size: 1.55rem; font-weight: 800; letter-spacing: -0.02em; margin-bottom: 0.45rem; }
    .welcome-hero p { color: var(--muted); font-size: 0.9rem; line-height: 1.55; margin-bottom: 1.35rem; }

    .starter-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.65rem;
      text-align: left;
    }
    .starter-chip {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 0.8rem 0.9rem;
      color: var(--text);
      cursor: pointer;
      transition: all 0.18s;
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }
    .starter-chip:hover {
      border-color: rgba(6, 182, 212, 0.55);
      background: rgba(6, 182, 212, 0.1);
      transform: translateY(-1px);
    }
    .starter-chip strong { font-size: 0.86rem; display: flex; align-items: center; gap: 0.4rem; }
    .starter-chip span { font-size: 0.76rem; color: var(--muted); }

    .msg-row {
      display: flex;
      gap: 0.6rem;
      align-items: flex-end;
      animation: msgIn 0.2s ease;
    }
    .msg-row.user { flex-direction: row-reverse; }
    @keyframes msgIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }

    .msg-avatar {
      width: 32px; height: 32px; border-radius: 10px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      font-size: 0.95rem; font-weight: 800;
      background: rgba(148, 163, 184, 0.14);
      border: 1px solid var(--border);
    }
    .msg-row.model .msg-avatar {
      background: linear-gradient(135deg, rgba(6, 182, 212, 0.25), rgba(99, 102, 241, 0.25));
      border-color: rgba(6, 182, 212, 0.35);
    }
    .msg-row.user .msg-avatar {
      background: linear-gradient(135deg, #06b6d4, #2563eb);
      border-color: transparent;
      color: #fff;
    }

    .msg-bubble {
      max-width: min(82%, 640px);
      border-radius: 18px;
      padding: 0.78rem 1rem;
      font-size: 0.92rem;
      line-height: 1.55;
      word-break: break-word;
      position: relative;
    }
    .msg-row.user .msg-bubble {
      background: var(--user-bubble);
      color: #fff;
      border-bottom-right-radius: 6px;
      box-shadow: 0 6px 20px rgba(37, 99, 235, 0.24);
    }
    .msg-row.model .msg-bubble {
      background: var(--ai-bubble);
      border: 1px solid var(--border);
      color: var(--text);
      border-bottom-left-radius: 6px;
    }

    .msg-text p { margin-bottom: 0.45rem; }
    .msg-text p:last-child { margin-bottom: 0; }
    .msg-text ul { padding-left: 1.2rem; margin: 0.35rem 0; }
    .msg-text li { margin-bottom: 0.2rem; }
    .msg-text code.inline-code {
      background: rgba(2, 6, 23, 0.65);
      border: 1px solid rgba(148, 163, 184, 0.2);
      padding: 0.1rem 0.35rem;
      border-radius: 6px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.83rem;
      color: #67e8f9;
    }
    .msg-text pre.code-block {
      background: #040812;
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 12px;
      padding: 0.75rem 0.85rem;
      overflow-x: auto;
      margin: 0.55rem 0;
      position: relative;
    }
    .msg-text pre.code-block code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.82rem;
      color: #e2e8f0;
      white-space: pre;
    }
    .code-copy-btn {
      position: absolute; top: 0.4rem; right: 0.45rem;
      border: 1px solid rgba(148, 163, 184, 0.25);
      background: rgba(15, 23, 42, 0.9);
      color: #cbd5e1; border-radius: 6px; padding: 0.18rem 0.5rem;
      font-size: 0.7rem; font-weight: 700; cursor: pointer;
    }
    .msg-text a { color: #38bdf8; text-decoration: underline; }
    .msg-row.user .msg-text a { color: #e0f2fe; }

    .msg-img {
      display: block;
      max-width: 100%;
      max-height: 320px;
      border-radius: 12px;
      margin-bottom: 0.55rem;
      border: 1px solid rgba(255, 255, 255, 0.12);
    }

    .msg-audio {
      width: 100%;
      min-width: 220px;
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
      font-size: 0.71rem;
      color: var(--muted);
    }
    .msg-row.user .msg-foot { color: rgba(255, 255, 255, 0.75); justify-content: flex-end; }

    .msg-actions { display: flex; align-items: center; gap: 0.35rem; }
    .mini-act-btn {
      border: 1px solid rgba(148, 163, 184, 0.2);
      background: rgba(255, 255, 255, 0.05);
      color: #cbd5e1;
      border-radius: 999px;
      padding: 0.2rem 0.55rem;
      font-size: 0.71rem;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
    }
    .mini-act-btn:hover { background: rgba(6, 182, 212, 0.2); color: #fff; border-color: rgba(6, 182, 212, 0.4); }

    .typing-dots { display: inline-flex; gap: 4px; align-items: center; padding: 0.2rem 0; }
    .typing-dots span {
      width: 7px; height: 7px; border-radius: 50%; background: var(--primary);
      animation: bounceDot 1.2s infinite ease-in-out;
    }
    .typing-dots span:nth-child(2) { animation-delay: 0.18s; }
    .typing-dots span:nth-child(3) { animation-delay: 0.36s; }
    @keyframes bounceDot { 0%, 80%, 100% { opacity: 0.35; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1.15); } }

    /* ─── Composer Bar ─── */
    .composer-wrap {
      flex-shrink: 0;
      padding: 0.65rem 0.9rem calc(0.75rem + var(--safe-bottom));
      background: rgba(7, 11, 20, 0.92);
      backdrop-filter: blur(14px);
      border-top: 1px solid var(--border);
    }
    .composer-inner { max-width: 820px; margin: 0 auto; }

    .attach-preview {
      display: none;
      align-items: center;
      justify-content: space-between;
      gap: 0.7rem;
      padding: 0.5rem 0.75rem;
      margin-bottom: 0.55rem;
      border-radius: 12px;
      background: rgba(6, 182, 212, 0.1);
      border: 1px solid rgba(6, 182, 212, 0.32);
    }
    .attach-preview.show { display: flex; }
    .attach-preview-left { display: flex; align-items: center; gap: 0.65rem; min-width: 0; }
    .attach-preview img { width: 44px; height: 44px; object-fit: cover; border-radius: 8px; }
    .attach-preview-name { font-size: 0.8rem; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    .composer-box {
      display: flex;
      align-items: flex-end;
      gap: 0.45rem;
      background: rgba(15, 23, 42, 0.95);
      border: 1px solid rgba(148, 163, 184, 0.22);
      border-radius: 16px;
      padding: 0.42rem 0.45rem;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .composer-box:focus-within {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.14);
    }

    .comp-btn {
      width: 40px; height: 40px; border-radius: 12px; border: none;
      background: rgba(148, 163, 184, 0.12); color: #e2e8f0;
      font-size: 1.08rem; cursor: pointer; flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center;
      transition: all 0.16s;
    }
    .comp-btn:hover { background: rgba(148, 163, 184, 0.22); }
    .comp-btn.recording {
      background: rgba(239, 68, 68, 0.24);
      color: #fca5a5;
      border: 1px solid rgba(239, 68, 68, 0.6);
      animation: pulseRec 1.1s infinite;
    }
    @keyframes pulseRec { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }

    .send-btn {
      background: linear-gradient(135deg, #06b6d4, #2563eb);
      color: #fff;
      font-weight: 800;
      box-shadow: 0 4px 14px rgba(6, 182, 212, 0.3);
    }
    .send-btn:disabled { opacity: 0.45; cursor: not-allowed; }

    #chatInput {
      flex: 1;
      border: none;
      background: transparent;
      color: var(--text);
      font-size: 0.94rem;
      line-height: 1.45;
      padding: 0.5rem 0.4rem;
      max-height: 132px;
      min-height: 40px;
      resize: none;
      outline: none;
    }
    #chatInput::placeholder { color: #64748b; }

    /* ─── Cards for Tools & Settings ─── */
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 1.2rem;
      margin-bottom: 1rem;
    }
    .card h3 { font-size: 1rem; font-weight: 800; margin-bottom: 0.25rem; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
    .card .sub { font-size: 0.82rem; color: var(--muted); margin-bottom: 0.95rem; }

    .prayer-grid {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 0.55rem;
      margin-bottom: 0.9rem;
    }
    .prayer-box {
      background: rgba(8, 13, 26, 0.85);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 0.7rem 0.5rem;
      text-align: center;
    }
    .prayer-box.next {
      border-color: var(--primary);
      background: linear-gradient(160deg, rgba(6, 182, 212, 0.2), rgba(37, 99, 235, 0.14));
    }
    .prayer-box .p-name { font-size: 0.78rem; font-weight: 800; color: #e2e8f0; }
    .prayer-box .p-ar { font-size: 0.76rem; color: var(--muted); margin: 0.1rem 0 0.3rem; }
    .prayer-box .p-time { font-size: 1.05rem; font-weight: 800; color: #22d3ee; }

    .ayah-box {
      background: rgba(16, 185, 129, 0.08);
      border: 1px solid rgba(16, 185, 129, 0.25);
      border-radius: 12px;
      padding: 0.85rem 1rem;
      font-size: 0.84rem;
      line-height: 1.55;
    }
    .ayah-ar { font-size: 1.02rem; text-align: right; direction: rtl; color: #f8fafc; margin-bottom: 0.45rem; }

    .field-label { display: block; font-size: 0.79rem; font-weight: 700; color: #cbd5e1; margin-bottom: 0.35rem; }
    .field {
      width: 100%; padding: 0.72rem 0.9rem; border-radius: 11px;
      border: 1px solid var(--border); background: rgba(7, 11, 20, 0.88);
      color: var(--text); font-size: 0.9rem; outline: none;
    }
    .field:focus { border-color: var(--primary); }
    .form-row { margin-bottom: 0.85rem; }

    .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 0.45rem;
      border: none; border-radius: 11px; padding: 0.68rem 1.05rem;
      font-size: 0.85rem; font-weight: 700; cursor: pointer; text-decoration: none;
      transition: all 0.16s;
    }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-primary { background: linear-gradient(135deg, #06b6d4, #2563eb); color: #fff; }
    .btn-emerald { background: linear-gradient(135deg, #10b981, #059669); color: #fff; }
    .btn-ghost { background: rgba(148, 163, 184, 0.12); color: #e2e8f0; border: 1px solid var(--border); }
    .btn-danger { background: rgba(239, 68, 68, 0.18); color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.35); }
    .btn-sm { padding: 0.45rem 0.78rem; font-size: 0.78rem; border-radius: 9px; }

    .hub-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.75rem; }
    .hub-card {
      display: flex; flex-direction: column; gap: 0.3rem;
      padding: 0.95rem; border-radius: 13px; text-decoration: none; color: var(--text);
      background: rgba(10, 17, 34, 0.85); border: 1px solid var(--border);
      transition: all 0.18s;
    }
    .hub-card:hover { border-color: rgba(6, 182, 212, 0.5); transform: translateY(-1px); }
    .hub-card span { font-size: 0.76rem; color: var(--muted); }

    /* ─── Mobile Bottom Navigation ─── */
    .bottom-nav {
      display: none;
      flex-shrink: 0;
      background: rgba(8, 13, 25, 0.96);
      backdrop-filter: blur(14px);
      border-top: 1px solid var(--border);
      padding: 0.4rem 0.4rem calc(0.45rem + var(--safe-bottom));
      grid-template-columns: repeat(5, 1fr);
      gap: 0.25rem;
    }

    .views-meter-track { height: 10px; border-radius: 999px; background: rgba(148, 163, 184, 0.14); overflow: hidden; margin: 0.45rem 0 0.75rem; }
    .views-meter-fill { height: 100%; width: 0%; border-radius: 999px; background: linear-gradient(90deg, #06b6d4, #10b981, #f59e0b); transition: width 0.4s ease; }
    .mini-vip-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.65rem; }
    .mini-vip-card {
      background: linear-gradient(155deg, rgba(30, 27, 18, 0.78), rgba(14, 21, 39, 0.92));
      border: 1px solid rgba(245, 158, 11, 0.42);
      border-radius: 14px; padding: 0.85rem;
      display: flex; flex-direction: column; gap: 0.45rem;
    }
    @media (max-width: 680px) { .mini-vip-grid { grid-template-columns: 1fr; } }
    .bnav-btn {
      border: none; background: transparent; color: var(--muted);
      padding: 0.45rem 0.3rem; border-radius: 11px;
      display: flex; flex-direction: column; align-items: center; gap: 0.15rem;
      font-size: 0.72rem; font-weight: 700; cursor: pointer;
    }
    .bnav-btn .ico { font-size: 1.2rem; }
    .bnav-btn.active { color: #22d3ee; background: rgba(6, 182, 212, 0.12); }

    /* ─── Toast & Modal ─── */
    .toast-banner {
      position: fixed; top: calc(0.9rem + var(--safe-top)); right: 1rem; z-index: 250;
      padding: 0.75rem 1.05rem; border-radius: 12px;
      background: #0f172a; border: 1px solid var(--primary);
      color: #fff; font-weight: 600; font-size: 0.84rem;
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.45);
      display: none; max-width: 340px;
    }
    .toast-banner.show { display: block; }

    .modal-backdrop {
      position: fixed; inset: 0; z-index: 200;
      background: rgba(2, 6, 15, 0.8); backdrop-filter: blur(6px);
      display: none; align-items: center; justify-content: center; padding: 1rem;
    }
    .modal-backdrop.open { display: flex; }
    .modal-box {
      max-width: 480px; width: 100%; max-height: 88vh; overflow-y: auto;
      background: #0d1527; border: 1px solid rgba(6, 182, 212, 0.35);
      border-radius: 18px; padding: 1.35rem;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55);
    }
    .install-step {
      background: rgba(15, 23, 42, 0.85); border: 1px solid var(--border);
      border-radius: 12px; padding: 0.8rem 0.95rem; margin-bottom: 0.65rem;
      font-size: 0.84rem; line-height: 1.5;
    }
    .install-step strong { color: #67e8f9; display: block; margin-bottom: 0.2rem; }

    @media (max-width: 900px) {
      .sidebar { display: none; }
      .mobile-logo { display: block; }
      .bottom-nav { display: grid; }
      .composer-wrap { padding-bottom: 0.55rem; }
      .starter-grid { grid-template-columns: 1fr; }
      .prayer-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .hub-grid { grid-template-columns: 1fr; }
      .msg-bubble { max-width: 88%; }
    }
    ${renderLiveCallPanelCSS()}
  </style>
</head>
<body>
  <div class="app-shell">
    <!-- Desktop Sidebar -->
    <aside class="sidebar">
      <div class="side-brand">
        <img src="/pwa/icon-192.png" alt="CARDOSO AI" />
        <div>
          <h1 id="sideBotTitle">CARDOSO <span>AI</span></h1>
          <p id="sideBotSub">${escapeAttr(initialSub)}</p>
        </div>
      </div>

      <button class="new-chat-btn" onclick="startFreshChat()">✨ Sheeko Cusub (New Chat)</button>

      <nav class="side-nav">
        <button class="side-nav-btn active" data-tab="chat" onclick="switchAppTab('chat')">💬 Sheeko AI (Chat)</button>
        <button class="side-nav-btn" data-tab="call" onclick="switchAppTab('call')">📹 Live Video Call</button>
        <button class="side-nav-btn" data-tab="views" onclick="switchAppTab('views')">📈 Views &amp; .vcf Hub</button>
        <button class="side-nav-btn" data-tab="tools" onclick="switchAppTab('tools')">🛠️ Adeegyada &amp; Salaadda</button>
        <button class="side-nav-btn" data-tab="settings" onclick="switchAppTab('settings')">⚙️ Dejinta &amp; Install App</button>
      </nav>

      <div class="side-divider"></div>

      <div class="side-links">
        <a href="/live-call" class="side-link">📹 Live Video Call (/live-call)</a>
        <a href="/views" class="side-link">📈 Bogga Views Hub (/views)</a>
        <a href="/portal" class="side-link">🔑 Client Portal (/portal)</a>
        <a href="/join" class="side-link">📝 Isdiiwaangeli (/join)</a>
        <a href="/admin-login" class="side-link">👑 Admin Studio (/)</a>
      </div>

      <div class="side-install-card">
        <h3>📲 Ku Install Garee App-ka</h3>
        <p>U isticmaal sida App dhab ah oo ku jira telefoonkaaga ama kombiyuutarkaaga (WhatsApp la'aan).</p>
        <button class="btn btn-primary btn-sm" style="width:100%;" data-pwa-install-btn onclick="triggerCardosoInstall()">📲 Install CARDOSO AI</button>
        <div data-pwa-installed-badge style="display:none;color:#34d399;font-size:0.8rem;font-weight:700;">✅ App Mode Waa Shidan Yahay</div>
      </div>
    </aside>

    <!-- Main App Area -->
    <div class="main-area">
      <!-- Top App Bar -->
      <header class="app-topbar">
        <div class="topbar-left">
          <img src="/pwa/icon-192.png" alt="CARDOSO AI" class="mobile-logo" />
          <div class="topbar-title-wrap">
            <div class="topbar-title" id="topBotName">${escapeAttr(initialBotName)}</div>
            <div class="topbar-status">
              <span class="dot-online"></span>
              <span id="topStatusText">Online · CARDOSO AI App</span>
            </div>
          </div>
        </div>
        <div class="topbar-actions">
          <button class="icon-pill" id="autoVoiceToggleBtn" onclick="toggleAutoVoice()" title="Jawaab kasta cod ha la socdo">🔇 Cod: Off</button>
          <button class="icon-pill install-cta" data-pwa-install-btn onclick="triggerCardosoInstall()">📲 Install</button>
          <span class="icon-pill active" data-pwa-installed-badge style="display:none;">✅ App</span>
          <button class="icon-pill" onclick="startFreshChat()" title="Tirtir oo billow sheeko cusub">🗑️</button>
        </div>
      </header>

      <!-- Smart Install Banner -->
      <div id="pwaInstallBanner" class="install-banner">
        <div>📲 <strong>Install CARDOSO AI</strong> — Ku dar shaashadda telefoonkaaga ama PC-ga!</div>
        <div class="install-banner-actions">
          <button class="btn btn-primary btn-sm" onclick="triggerCardosoInstall()">Install</button>
          <button class="btn btn-ghost btn-sm" onclick="dismissCardosoInstallBanner()">✕</button>
        </div>
      </div>

      <!-- TAB 1: CHAT -->
      <section id="pane-chat" class="view-pane active">
        <div class="chat-scroll" id="chatScroll">
          <div class="chat-inner" id="chatMessages">
            <div class="welcome-hero" id="welcomeHero">
              <img src="/pwa/icon-192.png" alt="CARDOSO AI" />
              <h2>Ku soo dhawoow CARDOSO AI App 👋</h2>
              <p>
                Hadda uma baahnid WhatsApp bot kaliya — si toos ah iila sheekeyso qoraal, cod Soomaali/Ingiriisi ah, ama sawirro ii soo dir si aan kuu caawiyo!
              </p>
              <div class="starter-grid">
                <button class="starter-chip" onclick="sendStarter('Asc sxb! Iga caawi sidaan Python u barto bilow ilaa heer sare.')">
                  <strong>💻 Barashada Coding &amp; Python</strong>
                  <span>Tallaabo-tallaabo Af-Soomaali fudud</span>
                </button>
                <button class="starter-chip" onclick="sendStarter('Ii samee jadwal waxbarasho oo Pomodoro ah oo arday jaamacadeed ku habboon.')">
                  <strong>📚 Jadwal Waxbarasho</strong>
                  <span>Qorshe diyaarin &amp; imtixaan</span>
                </button>
                <button class="starter-chip" onclick="sendStarter('Ii samee sawir qurux badan oo magaalada Muqdisho xilli qorrax dhac ah.')">
                  <strong>🎨 Samee Sawir AI</strong>
                  <span>Sawirro cusub oo AI curiyo</span>
                </button>
                <button class="starter-chip" onclick="sendStarter('Iigu dhiirigeli Af-Soomaali qurux badan maanta si aan shaqadayda u dhammeeyo.', true)">
                  <strong>🎙️ Dhiirigelin Cod Soomaali ah</strong>
                  <span>Qoraal + cod dabiici ah (Voice)</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Chat Composer -->
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
              <button class="btn btn-danger btn-sm" onclick="clearAttachment()">✕ Ka saar</button>
            </div>

            <div class="composer-box">
              <input type="file" id="imageFileInput" accept="image/*" style="display:none;" onchange="handleFilePicked(event)" />
              <button class="comp-btn" type="button" onclick="document.getElementById('imageFileInput').click()" title="Soo dir sawir (Homework, Code, Rasiid)">📎</button>
              <button class="comp-btn" id="micBtn" type="button" onclick="toggleVoiceRecord()" title="Duub fariin cod ah">🎙️</button>
              <textarea id="chatInput" rows="1" placeholder="Qor fariintaada Af-Soomaali ama English..."></textarea>
              <button class="comp-btn send-btn" id="sendBtn" type="button" onclick="sendChatMessage()" title="Dir fariinta">➤</button>
            </div>
          </div>
        </div>
      </section>

      <!-- TAB 1a: AI LIVE VIDEO CALL (INDEPENDENT MODULE) -->
      <section id="pane-call" class="view-pane">
        ${renderLiveCallPanelHTML()}
      </section>

      <!-- TAB 1b: VIEWS & .VCF CONTACT EXCHANGE HUB -->
      <section id="pane-views" class="view-pane">
        <div class="scroll-pane">
          <div class="scroll-inner">
            <div class="card" style="border-color:rgba(16,185,129,0.38);background:linear-gradient(155deg,rgba(6,182,212,0.12),rgba(16,185,129,0.08));">
              <h3>
                <span>📈 CARDOSO Status Views Hub (0% Ban)</span>
                <a href="/views" class="btn btn-ghost btn-sm">🔗 Bogga Buuxa</a>
              </h3>
              <p class="sub">Geli lambarkaaga -> Hal gujis ku soo deji faylka <b>.vcf</b> -> Dhammaan dadka Pool-ka si toos ah ayaad isku arki doontaan WhatsApp Status-ka!</p>
              <div style="display:flex;justify-content:space-between;font-size:0.8rem;font-weight:700;">
                <span id="appViewsMeterText">📦 Batch #1: 0 / 100 Qof</span>
                <span style="color:#22d3ee;" id="appViewsTotalText">0 Contacts</span>
              </div>
              <div class="views-meter-track"><div class="views-meter-fill" id="appViewsMeterFill"></div></div>

              <!-- Quick Join OR Unlocked Download -->
              <form id="appViewsJoinForm" onsubmit="submitAppViewsJoin(event)">
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:0.55rem;margin-bottom:0.65rem;">
                  <input class="field" id="appViewsName" required placeholder="Magacaaga..." />
                  <select class="field" id="appViewsCountry">
                    <option value="252">🇸🇴 +252</option>
                    <option value="251">🇪🇹 +251</option>
                    <option value="254">🇰🇪 +254</option>
                    <option value="253">🇩🇯 +253</option>
                    <option value="">🌍 Kale</option>
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
                <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
                  <button type="submit" id="appViewsJoinBtn" class="btn btn-primary" style="flex:1;">🚀 Ku Biir &amp; Fur Faylka .vcf</button>
                  <button type="button" class="btn btn-ghost btn-sm" onclick="lookupExistingAppViews()">🔑 Horay Ma U Gashay?</button>
                </div>
              </form>

              <div id="appViewsUnlockedBox" style="display:none;margin-top:0.5rem;">
                <div style="font-size:0.84rem;color:#34d399;font-weight:700;margin-bottom:0.6rem;" id="appViewsJoinedBadge">✅ Waad ku jirtaa Pool-ka!</div>
                <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
                  <button class="btn btn-emerald" style="flex:1;" onclick="downloadAppViewsVcf('current')">📥 Soo Deji Batch .vcf</button>
                  <button class="btn btn-primary btn-sm" onclick="downloadAppViewsVcf('all')">🌍 All .vcf</button>
                  <button class="btn btn-ghost btn-sm" onclick="verifyAppViewsSaver()">✅ Xaqiiji Save</button>
                  <button class="btn btn-ghost btn-sm" onclick="shareAppViewsLink()">📤 Share</button>
                </div>
              </div>
            </div>

            <div class="card" style="border-color:rgba(245,158,11,0.35);">
              <h3>
                <span>👑 VIP Pinned Sponsors</span>
                <button class="btn btn-ghost btn-sm" onclick="downloadAppViewsVcf('vip')">📥 VIP .vcf</button>
              </h3>
              <p class="sub">Macaamiisha VIP-ga ah ee korka ku xiran fayl kasta oo .vcf ah.</p>
              <div class="mini-vip-grid" id="appViewsVipGrid">
                <div style="color:var(--muted);font-size:0.82rem;">Waa la soo rarayaa...</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- TAB 2: TOOLS & PRAYER TIMES -->
      <section id="pane-tools" class="view-pane">
        <div class="scroll-pane">
          <div class="scroll-inner">
            <!-- Prayer Times Card -->
            <div class="card">
              <h3>
                <span>🕌 Waqtiga Salaadda Maanta (Somalia · EAT)</span>
                <span style="font-size:0.76rem;color:#22d3ee;" id="prayerDateLabel">--</span>
              </h3>
              <p class="sub">Jadwalka 5-ta salaadood iyo Aayad Quraan ah oo la xaqiijiyay.</p>
              <div class="prayer-grid" id="prayerGrid">
                <div class="prayer-box"><div class="p-name">Waa la soo rarayaa...</div></div>
              </div>
              <div class="ayah-box" id="prayerAyahBox" style="display:none;">
                <div class="ayah-ar" id="prayerAyahAr"></div>
                <div id="prayerAyahSo" style="color:#cbd5e1;"></div>
                <div id="prayerAyahRef" style="color:#34d399;font-size:0.76rem;font-weight:700;margin-top:0.35rem;"></div>
              </div>
            </div>

            <!-- Voice Studio Card -->
            <div class="card">
              <h3>🎙️ Somali &amp; English Voice Studio (Qoraal ➔ Cod)</h3>
              <p class="sub">Qor qoraal kasta si CARDOSO AI ugu beddelo cod MP3 dabiici ah oo aad dhageysan karto ama soo dejisan karto.</p>
              <div class="form-row">
                <label class="field-label">Luqadda Codka</label>
                <select class="field" id="ttsLangSelect">
                  <option value="so">🇸🇴 Af-Soomaali — Mohamed (Wiil Neural)</option>
                  <option value="so_female">🇸🇴 Af-Soomaali — Safa (Gabadh Neural)</option>
                  <option value="en">🇬🇧 English (Christopher Neural)</option>
                  <option value="ar">🇸🇦 العربية (Hamed Neural)</option>
                </select>
              </div>
              <div class="form-row">
                <label class="field-label">Qoraalka aad codka u beddelayso</label>
                <textarea class="field" id="ttsInputText" rows="3" placeholder="Tusaale: Assalaamu calaykum walaal, ku soo dhawoow CARDOSO AI App!"></textarea>
              </div>
              <div style="display:flex;gap:0.6rem;flex-wrap:wrap;align-items:center;">
                <button class="btn btn-primary" id="ttsGenBtn" onclick="generateStudioVoice()">🎙️ Samee Cod (MP3)</button>
                <a id="ttsDownloadLink" class="btn btn-emerald btn-sm" style="display:none;" download="cardoso-voice.mp3">⬇️ Soo Deji MP3</a>
              </div>
              <audio id="ttsPreviewAudio" controls class="msg-audio" style="display:none;margin-top:0.85rem;"></audio>
            </div>

            <!-- Safa & Mohamed World-Class Somali Podcast Studio -->
            <div class="card" style="border-color:rgba(139,92,246,0.45);background:linear-gradient(155deg,rgba(15,23,42,0.92),rgba(30,20,58,0.68));">
              <h3>
                <span>🎙️ Safa &amp; Mohamed Podcast Studio (Heer Caalami)</span>
                <span style="font-size:0.74rem;color:#34d399;font-weight:700;">Studio Mastering · 100% Free</span>
              </h3>
              <p class="sub">Geli <b>Mawduuc/Title</b> ama <b>Link Maqaal</b>, dooro qaabka (<b>Dood Kulul, Cashar, Sheeko, Xayeysiis, Diini</b>) iyo <b>Daqiiqadaha (1–5 min)</b> — Safa &amp; Mohamed sidii laba qof oo dhab ah ayay u doodayaan, u qoslayaan, uguna falanqeynayaan!</p>

              <div class="form-row">
                <label class="field-label">📌 Mawduuca Maanta / Link Maqaal (Ikhtiyaari)</label>
                <input class="field" id="podcastTopicInput" placeholder="Tusaale: Jacaylka iyo Lacagta, Ganacsiga Online-ka, ama https://..." />
              </div>

              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:0.6rem;margin-bottom:0.85rem;">
                <div>
                  <label class="field-label">🎭 Qaabka Podcast-ka</label>
                  <select class="field" id="podcastStyleSelect">
                    <option value="debate">🔥 Dood Kulul (Debate)</option>
                    <option value="study">📚 Cashar &amp; Imtixaan (Study)</option>
                    <option value="story">📖 Sheeko &amp; Taariikh (Story)</option>
                    <option value="ad">📢 Xayeysiis Radio (Ad)</option>
                    <option value="diini">🕌 Wacdi &amp; Diini (Clean)</option>
                  </select>
                </div>
                <div>
                  <label class="field-label">⏱️ Muddada (Minutes)</label>
                  <select class="field" id="podcastDurationSelect">
                    <option value="1">⚡ 1 Daqiiqo</option>
                    <option value="2" selected>🎙️ 2 Daqiiqo</option>
                    <option value="3">🔥 3 Daqiiqo</option>
                    <option value="4">🎧 4 Daqiiqo</option>
                    <option value="5">🏆 5 Daqiiqo (Deep Dive)</option>
                  </select>
                </div>
                <div>
                  <label class="field-label">🎚️ Codka Istuudiyaha</label>
                  <select class="field" id="podcastSoundSelect">
                    <option value="chime" selected>🎵 Studio Chime + Mastering</option>
                    <option value="ambient">🎹 Soft Ambient Bed + Mastering</option>
                    <option value="clean">🎙️ Cod Saafi ah (Muusig la'aan)</option>
                  </select>
                </div>
              </div>

              <div class="form-row">
                <label class="field-label">📝 Qoraalka Wada-Sheekeysiga (haddii mawduuca kore bannaanyahay)</label>
                <textarea class="field" id="podcastScriptInput" rows="7">Safa: [excited] Assalaamu calaykum Mohamed! War maanta dadkoo dhan waxay hadal hayaan CARDOSO AI — adigana ma ogtahay inaan markii hore u haystay bot caadi ah?
Mohamed: [laugh] Wa calaykumus salaam Safa! Haa-haa, taasi waa qaladkii dad badan galeen! Maya walaal, CARDOSO AI waa kaaliye casri ah oo Af-Soomaali dabiici ah kula sheekeysta.
Safa: [debate] Sug sug Mohamed, ha igu buunbuunin! Bal i tusi waxa uu kaga duwan yahay barnaamijyada kale?
Mohamed: [debate] Wallaahi farqi weyn baa jira Safa! Af-Soomaaliga ayuu si qoto dheer u fahmaa, ardayda casharro iyo koodh ayuu u sharxaa, sawirro cusub ayuu curiyaa, waqtiga salaaddana wuu ku xasuusiyaa!
Safa: [backchannel] Haa-haa, run miyaa? Oo ma WhatsApp keliya baa laga helaa?
Mohamed: [excited] Maya! Labadaba — WhatsApp-kaaga ayuu ka shaqeeyaa, sidoo kalena App casri ah oo telefoonka lagu install gareysto ayuu leeyahay!
Safa: [laugh] Wallaahi waad i qancisay Mohamed! Asxaabey, adinkuna ha moogaanina CARDOSO AI — barasho, ganacsi, iyo hal-abuur hal meel ku wada jira!
Mohamed: [calm] Ku soo dhawaada CARDOSO AI Studio — nabad gelyo iyo horumar wacan!</textarea>
              </div>

              <div id="podcastTeaserBox" style="display:none;margin-bottom:0.8rem;padding:0.75rem 0.9rem;border-radius:11px;background:rgba(6,182,212,0.12);border:1px solid rgba(6,182,212,0.35);font-size:0.84rem;color:#cffafe;"></div>

              <div style="display:flex;gap:0.55rem;flex-wrap:wrap;align-items:center;">
                <button class="btn btn-primary" id="podcastGenMp3Btn" onclick="generateSafaMohamedPodcast('mp3')">🎧 Podcast Stereo (MP3)</button>
                <button class="btn btn-ghost btn-sm" id="podcastGenOggBtn" onclick="generateSafaMohamedPodcast('ogg')">🎙️ WhatsApp Voice (.ogg)</button>
                <button class="btn btn-ghost btn-sm" id="podcastGenMp4Btn" onclick="generateSafaMohamedPodcast('mp4')" style="border-color:rgba(139,92,246,0.5);color:#ddd6fe;">🎬 Video Status/TikTok (.mp4)</button>
                <a id="podcastDownloadLink" class="btn btn-emerald btn-sm" style="display:none;" download="cardoso-ai-safa-mohamed.mp3">⬇️ Soo Deji</a>
              </div>

              <audio id="podcastPreviewAudio" controls class="msg-audio" style="display:none;margin-top:0.85rem;"></audio>
              <video id="podcastPreviewVideo" controls playsinline style="display:none;width:100%;max-height:420px;border-radius:14px;margin-top:0.85rem;background:#020617;"></video>

              <div id="podcastTranscriptWrap" style="display:none;margin-top:0.9rem;padding:0.85rem;border-radius:12px;background:rgba(8,13,25,0.85);border:1px solid var(--border);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.45rem;">
                  <strong style="font-size:0.82rem;color:#67e8f9;">📝 Qoraalka Sheekada (Safa &amp; Mohamed Transcript)</strong>
                  <button type="button" class="btn btn-ghost btn-sm" onclick="copyPodcastTranscript()">📋 Copy</button>
                </div>
                <pre id="podcastTranscriptText" style="white-space:pre-wrap;font-family:inherit;font-size:0.82rem;line-height:1.55;color:#e2e8f0;margin:0;max-height:220px;overflow-y:auto;"></pre>
              </div>
            </div>

            <!-- Image Creator Quick Card -->
            <div class="card">
              <h3>🎨 Samee Sawir AI (Instant Prompt)</h3>
              <p class="sub">Sharax sawirka aad rabto — CARDOSO AI ayaa kuugu sameynaya toos qolka sheekada.</p>
              <div style="display:flex;gap:0.55rem;flex-wrap:wrap;">
                <input class="field" id="quickImgPrompt" style="flex:1;min-width:220px;" placeholder="Tusaale: Geel daaqaya dhul doog ah xilli subax ah..." />
                <button class="btn btn-primary" onclick="runQuickImagePrompt()">🎨 Samee</button>
              </div>
            </div>

            <!-- WhatsApp & SaaS Links Hub -->
            <div class="card">
              <h3>🔗 Maamulka Bot-ka &amp; SaaS Hub</h3>
              <p class="sub">Haddii aad sidoo kale isticmaasho WhatsApp automation, halkan ka gal bogagga maamulka.</p>
              <div class="hub-grid">
                <a href="/portal" class="hub-card">
                  <strong>🔑 Client Portal</strong>
                  <span>QR/8-Lambar, Auto-Reply &amp; Leads</span>
                </a>
                <a href="/join" class="hub-card">
                  <strong>📝 Isdiiwaangeli</strong>
                  <span>Sameyso bot ganacsi ama shakhsi</span>
                </a>
                <a href="/admin-login" class="hub-card">
                  <strong>👑 Admin Studio</strong>
                  <span>Maamulka Guud ee Mulkiilaha</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- TAB 3: SETTINGS & INSTALL -->
      <section id="pane-settings" class="view-pane">
        <div class="scroll-pane">
          <div class="scroll-inner">
            <!-- Install App Card -->
            <div class="card" style="border-color:rgba(6,182,212,0.38);">
              <h3>
                <span>📲 Ku Install Garee Telefoonka ama PC-ga</span>
                <span data-pwa-installed-badge style="display:none;color:#34d399;font-size:0.78rem;">✅ Waa Installed</span>
              </h3>
              <p class="sub">CARDOSO AI waa Progressive Web App (PWA) buuxa — hal gujis ku install garee adigoon Play Store u baahnayn.</p>
              <div style="display:flex;gap:0.65rem;flex-wrap:wrap;margin-bottom:1rem;">
                <button class="btn btn-primary" data-pwa-install-btn onclick="triggerCardosoInstall()">📲 Install CARDOSO AI Hadda</button>
                <button class="btn btn-ghost" onclick="document.getElementById('pwaInstallHelpModal').classList.add('open')">📖 Tilmaanta Install-ka (iPhone / Android / PC)</button>
              </div>
              <div class="install-step">
                <strong>🤖 Android (Chrome)</strong>
                Guji badhanka <b>Install CARDOSO AI</b> ee kor ku yaal, ama guji saddexda dhibcood (⋮) ➔ <b>Install app</b>.
              </div>
              <div class="install-step">
                <strong>🍎 iPhone / iPad (Safari)</strong>
                Ku fur Safari ➔ guji badhanka <b>Share (⬆️)</b> ee hoose ➔ dooro <b>Add to Home Screen ➕</b> ➔ guji <b>Add</b>.
              </div>
              <div class="install-step" style="margin-bottom:0;">
                <strong>💻 Windows / Mac (Chrome ama Edge)</strong>
                Guji calaamadda <b>Install (⊕)</b> ee dhinaca midig ee address bar-ka, ama guji badhanka sare.
              </div>
            </div>

            <!-- Profile Settings -->
            <div class="card">
              <h3>👤 Xogtaada &amp; Doorka App-ka</h3>
              <p class="sub">Magacaaga halkan ku qor si CARDOSO AI magacaaga kuugu yeedho mar kasta.</p>
              <div class="form-row">
                <label class="field-label">Magacaaga (Display Name)</label>
                <input class="field" id="settingUserName" placeholder="Tusaale: Mohamed" />
              </div>
              <div style="display:flex;gap:0.6rem;flex-wrap:wrap;">
                <button class="btn btn-primary" onclick="saveProfileSettings()">💾 Keydi Magaca</button>
                <button class="btn btn-ghost" onclick="exportChatTranscript()">📄 Soo Deji Sheekada (.txt)</button>
                <button class="btn btn-danger" onclick="startFreshChat(true)">🗑️ Tirtir Dhammaan Xogtayda</button>
              </div>
            </div>

            <!-- App Diagnostics -->
            <div class="card">
              <h3>📊 Xaaladda Server-ka</h3>
              <p class="sub">Macluumaadka adeegga uu App-kani ku xiran yahay.</p>
              <div style="display:flex;flex-wrap:wrap;gap:0.6rem;font-size:0.82rem;color:#cbd5e1;" id="appDiagBadges">
                <span>Mode: <strong id="diagMode">--</strong></span>
                <span>·</span>
                <span>WhatsApp: <strong id="diagWa">--</strong></span>
                <span>·</span>
                <span>Session ID: <strong id="diagSession">--</strong></span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Mobile Bottom Navigation -->
      <nav class="bottom-nav">
        <button class="bnav-btn active" data-tab="chat" onclick="switchAppTab('chat')">
          <span class="ico">💬</span>
          <span>Sheeko</span>
        </button>
        <button class="bnav-btn" data-tab="call" onclick="switchAppTab('call')">
          <span class="ico">📹</span>
          <span>Video</span>
        </button>
        <button class="bnav-btn" data-tab="views" onclick="switchAppTab('views')">
          <span class="ico">📈</span>
          <span>Views</span>
        </button>
        <button class="bnav-btn" data-tab="tools" onclick="switchAppTab('tools')">
          <span class="ico">🛠️</span>
          <span>Adeegyada</span>
        </button>
        <button class="bnav-btn" data-tab="settings" onclick="switchAppTab('settings')">
          <span class="ico">⚙️</span>
          <span>Dejinta</span>
        </button>
      </nav>
    </div>
  </div>

  <!-- Install Guide Modal (especially helpful for iPhone Safari & desktop browsers) -->
  <div id="pwaInstallHelpModal" class="modal-backdrop" onclick="if(event.target===this)this.classList.remove('open')">
    <div class="modal-box">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.85rem;">
        <h3 style="font-size:1.1rem;font-weight:800;">📲 Sida Loo Install Gareeyo CARDOSO AI</h3>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('pwaInstallHelpModal').classList.remove('open')">✕</button>
      </div>
      <div class="install-step">
        <strong>🍎 iPhone / iPad (Safari)</strong>
        1. Hubi inaad ku furtay <b>Safari</b>.<br/>
        2. Guji badhanka <b>Share (⬆️)</b> ee hoose.<br/>
        3. Hoos u deg oo guji <b>Add to Home Screen ➕</b> kadibna <b>Add</b>.
      </div>
      <div class="install-step">
        <strong>🤖 Android (Google Chrome)</strong>
        1. Guji saddexda dhibcood <b>(⋮)</b> ee geeska sare ee midig.<br/>
        2. Dooro <b>Install app</b> ama <b>Add to Home screen</b>.<br/>
        3. App-ku wuxuu ku soo baxayaa shaashaddaada sida WhatsApp!
      </div>
      <div class="install-step">
        <strong>💻 Windows / Mac (Chrome ama Edge)</strong>
        1. Eeg geeska midig ee cinwaanka (Address bar) oo guji calaamadda <b>Install App</b>.<br/>
        2. Ama Menu (⋮) ➔ <b>Cast, save, and share</b> ➔ <b>Install page as app</b>.
      </div>
      <button class="btn btn-primary" style="width:100%;" onclick="document.getElementById('pwaInstallHelpModal').classList.remove('open')">👍 Waan Fahmay</button>
    </div>
  </div>

  <div id="toastBanner" class="toast-banner"></div>

  <script>
    ${COMMON_CLIENT_JS}

    const INITIAL_TENANT_ID = ${safeTenantId};
    const INITIAL_TENANT_TOKEN = ${safeTenantToken};
    const INITIAL_MODE = ${safeMode};

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
    } catch {}

    function updateAutoVoiceUI() {
      const btn = document.getElementById('autoVoiceToggleBtn');
      if (!btn) return;
      if (state.autoVoice) {
        btn.textContent = '🔊 Cod: On';
        btn.classList.add('active');
      } else {
        btn.textContent = '🔇 Cod: Off';
        btn.classList.remove('active');
      }
    }

    function toggleAutoVoice() {
      state.autoVoice = !state.autoVoice;
      try { localStorage.setItem('cardoso_app_auto_voice', state.autoVoice ? '1' : '0'); } catch {}
      updateAutoVoiceUI();
      showToast(state.autoVoice ? '🔊 Jawaab kasta hadda cod ayaa la socon doona' : '🔇 Jawaabaha codka tooska ah waa la damiyay');
    }

    function switchAppTab(tabName) {
      document.querySelectorAll('.view-pane').forEach(function(p) { p.classList.remove('active'); });
      const target = document.getElementById('pane-' + tabName);
      if (target) target.classList.add('active');

      document.querySelectorAll('[data-tab]').forEach(function(b) {
        if (b.getAttribute('data-tab') === tabName) b.classList.add('active');
        else b.classList.remove('active');
      });

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
          '✅ ' + (appViewsMember.displayName || 'Xubin') + ' (+' + appViewsMember.phone + ') — Batch #' + (appViewsMember.batchNumber || 1);
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
          '📦 Batch #' + (stats.currentBatch || 1) + ': ' + (stats.currentBatchFreeCount || 0) + ' / ' + (stats.batchTarget || 100) + ' Qof (+' + (stats.activeVipCount || 0) + ' VIP)';
        document.getElementById('appViewsTotalText').textContent = (stats.totalContacts || 0) + ' Contacts · ' + (stats.totalDownloads || 0) + ' DL';
        document.getElementById('appViewsMeterFill').style.width = (stats.progressPct || 0) + '%';

        const grid = document.getElementById('appViewsVipGrid');
        const vips = data.vips || [];
        if (!vips.length) {
          const vipPhone = (cfg.ownerVipPhone || '').replace(/\\D/g, '');
          const vipHref = vipPhone ? ('https://wa.me/' + vipPhone + '?text=' + encodeURIComponent('Asc! Waxaan rabaa VIP Pinned CARDOSO Views Hub.')) : '/views';
          grid.innerHTML = '<div class="mini-vip-card"><strong>👑 Booska VIP Waa Banaan Yahay</strong><span style="font-size:0.78rem;color:var(--muted);">Ku xir ganacsigaaga korka .vcf kasta (' + escapeHtml(cfg.vipPriceLabel || '$5 / Bil') + ')</span><a href="' + vipHref + '" target="_blank" class="btn btn-primary btn-sm">Dalbo VIP</a></div>';
        } else {
          grid.innerHTML = vips.map(function(v) {
            const waUrl = 'https://wa.me/' + encodeURIComponent(v.phone) + '?text=' + encodeURIComponent('Asc ' + v.displayName + '! Waxaan kaa helay CARDOSO AI App.');
            return '<div class="mini-vip-card">' +
              '<div style="font-weight:800;font-size:0.9rem;">👑 ' + escapeHtml(v.displayName) + '</div>' +
              '<div style="font-size:0.75rem;color:#fcd34d;">📍 ' + escapeHtml(v.city) + '</div>' +
              '<div style="font-size:0.78rem;color:#cbd5e1;">' + escapeHtml(v.tagline || 'VIP Pinned Sponsor') + '</div>' +
              '<div style="display:flex;gap:0.4rem;margin-top:0.2rem;">' +
                '<a href="' + waUrl + '" target="_blank" class="btn btn-emerald btn-sm" style="flex:1;">💬 Chat</a>' +
                '<button class="btn btn-ghost btn-sm" onclick="downloadAppSingleVip(' + v.id + ')">➕ .vcf</button>' +
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
      btn.textContent = '⏳ Waa la diiwaangelinayaa...';
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
        showToast('🎉 Waad ku biirtay Views Hub — hadda soo deji .vcf!');
        await loadAppViewsHub();
      } catch (err) {
        showToast('❌ ' + (err.message || 'Khalad'), true);
      } finally {
        btn.disabled = false;
        btn.textContent = '🚀 Ku Biir & Fur Faylka .vcf';
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
        showToast('✅ Akoonkaaga waa la furay, ' + data.contact.displayName + '!');
        await loadAppViewsHub();
      } catch (err) {
        showToast('❌ ' + (err.message || 'Khalad'), true);
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
        showToast('✅ ' + (cnt || '') + ' Contacts (.vcf) waa soo degeen — guji si aad u Import gareyso!');
        await loadAppViewsHub();
      } catch (err) {
        showToast('❌ ' + (err.message || 'Lama soo dejin karin'), true);
      }
    }

    async function downloadAppSingleVip(id) {
      try {
        await fetchAndSaveAppVcf('/api/views/download.vcf?scope=single&id=' + encodeURIComponent(String(id)), 'CARDOSO_VIP.vcf');
        showToast('✅ Contact-ka VIP waa soo degay!');
      } catch (err) {
        showToast('❌ ' + (err.message || 'Lama soo dejin karin'), true);
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
          showToast('✅ Waad ku mahadsan tahay! Verified Saver waa la diiwaangeliyay.');
          await loadAppViewsHub();
        }
      } catch {}
    }

    function shareAppViewsLink() {
      const ref = appViewsMember && appViewsMember.phone ? ('?ref=' + encodeURIComponent(appViewsMember.phone)) : '';
      const url = location.origin + '/views' + ref;
      const msg = '📈 Hel 200+ WhatsApp Status Views dhab ah (0% Ban) adigoo 1-click .vcf soo dejinaya: ' + url;
      window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
    }

    function renderSafeMarkdown(rawText) {
      const NL = String.fromCharCode(10);
      const src = String(rawText || '').replace(/\\r\\n/g, NL);
      const blocks = [];
      const withPlaceholders = src.replace(/\`\`\`([a-zA-Z0-9_-]*)?\\n?([\\s\\S]*?)\`\`\`/g, function(_, lang, code) {
        const idx = blocks.length;
        blocks.push('<pre class="code-block"><button class="code-copy-btn" onclick="copyCodeBlock(this)">Copy</button><code>' + escapeHtml(code.trim()) + '</code></pre>');
        return '@@CODEBLOCK_' + idx + '@@';
      });

      let html = escapeHtml(withPlaceholders);
      // Inline code
      html = html.replace(/\`([^\`\\n]+)\`/g, '<code class="inline-code">$1</code>');
      // Bold (**text** or WhatsApp *text*)
      html = html.replace(/\\*\\*([^\\*\\n]+)\\*\\*/g, '<strong>$1</strong>');
      html = html.replace(/(^|\\s)\\*([^\\*\\n]+)\\*(?=[\\s.,!?:;]|$)/g, '$1<strong>$2</strong>');
      // Italic (_text_)
      html = html.replace(/(^|\\s)_([^_\\n]+)_(?=[\\s.,!?:;]|$)/g, '$1<em>$2</em>');
      // Auto-link URLs
      html = html.replace(/(https?:\\/\\/[^\\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');

      // Paragraphs & bullets
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
          if (line.trim() === '') {
            out += '';
          } else {
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
      copyText(code.textContent || '', '✅ Code-ka waa la koobiyeeyay!');
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
      avatar.textContent = isUser ? (state.userName ? state.userName.slice(0, 1).toUpperCase() : '👤') : '🤖';

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
        dlWrap.innerHTML = '<a class="mini-act-btn" href="' + srcUrl + '" download="cardoso-ai-image.png">⬇️ Soo Deji Sawirka</a>';
        bubble.appendChild(dlWrap);
      }

      const textEl = document.createElement('div');
      textEl.className = 'msg-text';
      textEl.innerHTML = renderSafeMarkdown(msg.content || '');
      bubble.appendChild(textEl);

      // Audio slot (either returned immediately or populated when clicking Listen)
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
        listenBtn.textContent = '🔊 Dhageyso';
        listenBtn.onclick = function() { playMessageTts(msgId, msg.content || '', msg.language || 'so', listenBtn); };
        acts.appendChild(listenBtn);

        const cpBtn = document.createElement('button');
        cpBtn.className = 'mini-act-btn';
        cpBtn.textContent = '📋 Copy';
        cpBtn.onclick = function() { copyText(msg.content || '', '✅ Jawaabta waa la koobiyeeyay!'); };
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
      btnEl.textContent = '⏳ Cod...';
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
        btnEl.textContent = '🔊 Mar kale';
      } catch (err) {
        showToast('❌ ' + (err.message || 'Codka lama heli karin'), true);
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
      row.innerHTML = '<div class="msg-avatar">🤖</div><div class="msg-bubble"><div class="typing-dots"><span></span><span></span><span></span></div></div>';
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
        showToast('❌ Sawirku waa ka weyn yahay 9MB — fadlan mid ka yar soo xul', true);
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

    async function toggleVoiceRecord() {
      const micBtn = document.getElementById('micBtn');
      if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
        state.mediaRecorder.stop();
        return;
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
        showToast('🎙️ Browser-kan ma taageero duubista codka tooska ah (HTTPS ayaa loo baahan yahay)', true);
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
        micBtn.textContent = '⏹️';
        showToast('🎙️ Codkaaga waa la duubayaa... mar kale guji si aad u dirto');

        recorder.ondataavailable = function(e) {
          if (e.data && e.data.size > 0) state.recChunks.push(e.data);
        };
        recorder.onstop = function() {
          stream.getTracks().forEach(function(t) { t.stop(); });
          micBtn.classList.remove('recording');
          micBtn.textContent = '🎙️';
          const outMime = recorder.mimeType || 'audio/webm';
          const blob = new Blob(state.recChunks, { type: outMime });
          if (blob.size < 400) {
            showToast('⚠️ Codku aad buu u gaabnaa — mar kale isku day', true);
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
            sendChatMessage('🎙️ Fariin cod ah', true);
          };
          reader.readAsDataURL(blob);
        };
        recorder.start();
      } catch (err) {
        showToast('❌ Ogolaanshaha Makarafoonka lama siin', true);
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

      const displayText = text || (media && media.type === 'image' ? '📷 Sawir ayaan soo diray — fadlan ii sharax.' : '🎙️ Fariin cod ah');
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
        const errMsg = {
          role: 'model',
          content: '⚠️ ' + (err.message || 'Khalad ayaa dhacay. Fadlan hubi internet-kaaga oo mar kale isku day.'),
          timestamp: Date.now()
        };
        appendMessageBubble(errMsg);
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
      showToast('✨ Sheeko cusub ayaa kuu furan!');
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
          document.getElementById('topBotName').textContent = name;
          document.getElementById('sideBotTitle').innerHTML = escapeHtml(name);
          if (data.businessName) {
            document.getElementById('sideBotSub').textContent = data.businessName;
          }
          document.getElementById('topStatusText').textContent = data.whatsappConnected
            ? 'Online · App + WhatsApp'
            : 'Online · Standalone AI App';
          document.getElementById('diagMode').textContent = data.mode || INITIAL_MODE;
          document.getElementById('diagWa').textContent = data.whatsappConnected ? 'Connected ✅' : 'Offline (App Mode)';
          document.getElementById('diagSession').textContent = state.sessionId;
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
            '<div class="p-name">' + escapeHtml(p.somaliName) + (p.key === data.nextPrayerKey ? ' ✨' : '') + '</div>' +
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
      btn.textContent = '⏳ Codka waa la samaynayaa...';
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
        showToast('✅ Codkaaga MP3 waa diyaar!');
      } catch (err) {
        showToast('❌ ' + (err.message || 'Khalad ayaa dhacay'), true);
      } finally {
        btn.disabled = false;
        btn.textContent = '🎙️ Samee Cod (MP3)';
      }
    }

    function copyPodcastTranscript() {
      const el = document.getElementById('podcastTranscriptText');
      const txt = String(el ? el.textContent : '').trim();
      if (!txt) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function() {
          showToast('📋 Qoraalka Safa & Mohamed waa la koobiyeeyay!');
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
      mp3Btn.textContent = '🎙️ Safa & Mohamed Studio...';
      if (teaserEl) {
        teaserEl.style.display = 'block';
        teaserEl.innerHTML = '📻 <strong>Goor dhow la soco!</strong> Safa &amp; Mohamed waxay maanta si qoto dheer uga wada hadlayaan <strong>' +
          escapeHtml(topic || 'CARDOSO AI') + '</strong> (~' + durationMinutes + ' daqiiqo)... 🎧';
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
        dl.textContent = '⬇️ Soo Deji (' + String(data.fileExt || fmt).toUpperCase() + ' · ' + (data.seconds || '?') + 's)';
        dl.style.display = 'inline-flex';

        if (tWrap && tText && data.transcript) {
          tText.textContent = data.transcript;
          tWrap.style.display = 'block';
        }
        if (teaserEl) {
          teaserEl.innerHTML = '✅ <strong>Safa &amp; Mohamed Podcast waa diyaar!</strong> (' + (data.seconds || '?') + ' ilbiriqsi · ' + (data.turnCount || '?') + ' qaybood) 🎧🔥';
        }
        showToast('🎧 Podcast-ka Safa & Mohamed waa diyaar!');
      } catch (err) {
        if (teaserEl) teaserEl.style.display = 'none';
        showToast('❌ ' + (err.message || 'Khalad ayaa dhacay'), true);
      } finally {
        mp3Btn.disabled = false;
        oggBtn.disabled = false;
        if (mp4Btn) mp4Btn.disabled = false;
        mp3Btn.textContent = '🎧 Podcast Stereo (MP3)';
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
      showToast('✅ Magacaaga waa la keydiyay!');
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

    // Auto-resize textarea + Enter-to-send on desktop
    (function setupInput() {
      const input = document.getElementById('chatInput');
      if (!input) return;
      input.addEventListener('input', function() {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 132) + 'px';
      });
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendChatMessage();
        }
      });
    })();

    // Init
    (function bootApp() {
      const nameInput = document.getElementById('settingUserName');
      if (nameInput) nameInput.value = state.userName;
      updateAutoVoiceUI();
      loadBootstrap();
      loadHistory();
    })();

    ${renderLiveCallClientJS()}
  </script>
</body>
</html>`;
}
