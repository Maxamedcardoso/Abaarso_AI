import { PWA_HEAD_TAGS } from '../../web/pwa-assets.js';
import { COMMON_CLIENT_JS } from '../../web/views/styles.js';

function escapeAttr(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Modular CSS for CARDOSO Live — Real-Time 2-Person Human Video & Voice Call.
 * Mobile-first flex architecture guarantees Controls Dock & Video Stage ALWAYS fit
 * cleanly inside any viewport (320px Android/iOS phones up to 4K desktops) with zero overlap.
 */
export function renderLiveCallPanelCSS(): string {
  return `
    /* ─── CARDOSO Live — Responsive P2P Video & Voice Call ─── */
    .lc-shell {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 330px;
      gap: 0.75rem;
      flex: 1;
      width: 100%;
      height: 100%;
      min-height: 0;
      padding: 0.7rem;
      overflow: hidden;
    }

    .lc-stage-col {
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
      min-height: 0;
      min-width: 0;
      height: 100%;
      overflow: hidden;
    }

    /* Top Mode & Live Online Counter Bar */
    .lc-mode-bar {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.45rem;
      padding: 0.4rem 0.58rem;
      border-radius: 14px;
      background: rgba(12, 19, 36, 0.94);
      border: 1px solid rgba(56, 189, 248, 0.22);
      min-width: 0;
    }
    .lc-mode-tabs {
      display: inline-flex;
      gap: 0.28rem;
      background: rgba(7, 11, 20, 0.88);
      padding: 0.2rem;
      border-radius: 10px;
      border: 1px solid rgba(148, 163, 184, 0.16);
      min-width: 0;
    }
    .lc-mode-tab {
      border: none;
      background: transparent;
      color: #94a3b8;
      font-size: 0.76rem;
      font-weight: 800;
      padding: 0.38rem 0.78rem;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.16s ease;
      display: inline-flex;
      align-items: center;
      gap: 0.32rem;
      white-space: nowrap;
    }
    .lc-mode-tab:hover { color: #e2e8f0; }
    .lc-mode-tab.active {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.3), rgba(6, 182, 212, 0.32));
      color: #fff;
      box-shadow: inset 0 0 0 1px rgba(52, 211, 153, 0.58);
    }
    .lc-mode-tab.active[data-peer-mode="private"] {
      background: linear-gradient(135deg, rgba(59, 130, 246, 0.3), rgba(139, 92, 246, 0.34));
      box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.58);
    }

    .lc-presence-row {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      flex-shrink: 0;
    }
    .lc-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.34rem;
      padding: 0.28rem 0.6rem;
      border-radius: 999px;
      font-size: 0.72rem;
      font-weight: 700;
      background: rgba(7, 11, 20, 0.85);
      border: 1px solid rgba(148, 163, 184, 0.22);
      color: #e2e8f0;
      text-decoration: none;
      white-space: nowrap;
    }
    .lc-badge.live {
      border-color: rgba(16, 185, 129, 0.55);
      color: #6ee7b7;
    }
    .lc-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #94a3b8;
      flex-shrink: 0;
    }
    .lc-dot.live { background: #10b981; box-shadow: 0 0 9px #10b981; animation: lcPulse 1.4s infinite; }
    @keyframes lcPulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.3); opacity: 0.65; } }

    /* Desktop: 50/50 Side-by-Side Split-Screen Video Stage */
    .lc-video-stage {
      position: relative;
      flex: 1;
      min-height: 0;
      border-radius: 18px;
      overflow: hidden;
      background:
        radial-gradient(circle at 50% 25%, rgba(6, 182, 212, 0.14), rgba(7, 11, 20, 0.98) 72%),
        #070b14;
      border: 1px solid rgba(56, 189, 248, 0.24);
      box-shadow: 0 14px 36px rgba(0, 0, 0, 0.42);
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 0.55rem;
      padding: 0.55rem;
    }

    .lc-peer-tile {
      position: relative;
      width: 100%;
      height: 100%;
      min-height: 0;
      border-radius: 14px;
      overflow: hidden;
      background: radial-gradient(circle at 50% 35%, rgba(15, 23, 42, 0.96), #050912);
      border: 2px solid rgba(148, 163, 184, 0.22);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: border-color 0.22s ease, box-shadow 0.22s ease;
    }
    .lc-peer-tile.connected {
      border-color: rgba(16, 185, 129, 0.72);
      box-shadow: 0 0 0 1px rgba(16, 185, 129, 0.28), 0 0 24px rgba(16, 185, 129, 0.18);
    }
    .lc-peer-tile.self-tile.cam-on {
      border-color: rgba(56, 189, 248, 0.55);
    }

    /* IMPORTANT: Never use display:none on WebRTC <video> so Android/iOS always decode frames immediately! */
    .lc-stream-video {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      background: #050912;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
      z-index: 2;
    }
    .lc-stream-video.active {
      opacity: 1;
      pointer-events: auto;
    }
    .lc-stream-video.mirrored { transform: scaleX(-1); }

    /* Off-pixel remote audio element (NOT display:none so Safari/Android WebView never block playback!) */
    .lc-hidden-audio {
      position: absolute;
      width: 1px;
      height: 1px;
      opacity: 0;
      pointer-events: none;
    }

    /* Center State Overlay */
    .lc-tile-overlay {
      position: relative;
      z-index: 4;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      gap: 0.45rem;
      padding: 2.3rem 0.9rem 2.4rem;
      max-width: 300px;
      color: #e2e8f0;
    }
    .lc-tile-overlay.hidden { display: none; }

    .lc-avatar-orb {
      width: 66px;
      height: 66px;
      border-radius: 50%;
      background: linear-gradient(135deg, rgba(6, 182, 212, 0.22), rgba(16, 185, 129, 0.22));
      border: 2px solid rgba(56, 189, 248, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.75rem;
      flex-shrink: 0;
      box-shadow: 0 0 24px rgba(6, 182, 212, 0.2);
    }
    .lc-avatar-orb.radar {
      border-color: #22d3ee;
      animation: lcRadar 1.5s infinite ease-out;
    }
    .lc-avatar-orb.audio-live {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.28), rgba(6, 182, 212, 0.26));
      border-color: #34d399;
      animation: lcRadar 1.8s infinite ease-out;
    }
    @keyframes lcRadar {
      0% { box-shadow: 0 0 0 0 rgba(34, 211, 238, 0.55); }
      70% { box-shadow: 0 0 0 18px rgba(34, 211, 238, 0); }
      100% { box-shadow: 0 0 0 0 rgba(34, 211, 238, 0); }
    }

    .lc-ov-title { font-size: 0.92rem; font-weight: 800; color: #f8fafc; line-height: 1.28; }
    .lc-ov-sub { font-size: 0.76rem; color: #94a3b8; line-height: 1.4; }
    .lc-ov-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 0.4rem;
      margin-top: 0.15rem;
    }
    .lc-room-code-big {
      font-family: monospace;
      font-size: 1.12rem;
      font-weight: 900;
      letter-spacing: 0.08em;
      padding: 0.36rem 0.85rem;
      border-radius: 10px;
      background: rgba(15, 23, 42, 0.94);
      border: 1px dashed rgba(56, 189, 248, 0.65);
      color: #67e8f9;
    }

    /* Prominent 1-Tap Audio Unlock Pill if Mobile Browser Blocks Autoplay */
    .lc-audio-unlock {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 9;
      display: none;
      align-items: center;
      gap: 0.45rem;
      padding: 0.65rem 1.1rem;
      border-radius: 999px;
      border: 1px solid rgba(52, 211, 153, 0.85);
      background: rgba(6, 78, 59, 0.94);
      color: #fff;
      font-size: 0.82rem;
      font-weight: 800;
      cursor: pointer;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.65);
      white-space: nowrap;
    }
    .lc-audio-unlock.show { display: inline-flex; }

    /* Corner Badges inside Video Tiles */
    .lc-tile-top {
      position: absolute;
      top: 0.48rem;
      left: 0.48rem;
      right: 0.48rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.35rem;
      z-index: 6;
      pointer-events: none;
    }
    .lc-tile-bottom {
      position: absolute;
      bottom: 0.48rem;
      left: 0.48rem;
      right: 0.48rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.35rem;
      z-index: 6;
      pointer-events: none;
    }
    .lc-tile-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      padding: 0.22rem 0.56rem;
      border-radius: 999px;
      background: rgba(5, 9, 18, 0.78);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(148, 163, 184, 0.26);
      color: #f8fafc;
      font-size: 0.7rem;
      font-weight: 800;
      max-width: 72%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .lc-tile-pill.cam-off { border-color: rgba(245, 158, 11, 0.55); color: #fde68a; }
    .lc-tile-pill.muted { border-color: rgba(239, 68, 68, 0.55); color: #fca5a5; }
    .lc-tile-pill.ok { border-color: rgba(16, 185, 129, 0.55); color: #6ee7b7; }
    .lc-block-btn {
      pointer-events: auto;
      border: 1px solid rgba(239, 68, 68, 0.45);
      background: rgba(127, 29, 29, 0.76);
      color: #fecaca;
      border-radius: 999px;
      padding: 0.2rem 0.52rem;
      font-size: 0.68rem;
      font-weight: 700;
      cursor: pointer;
    }
    .lc-block-btn:hover { background: rgba(220, 38, 38, 0.88); color: #fff; }

    /* Pinned Bottom Call Controls Dock (ALWAYS VISIBLE on Every Screen!) */
    .lc-controls-dock {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-wrap: nowrap;
      gap: 0.45rem;
      padding: 0.5rem 0.65rem;
      border-radius: 16px;
      background: rgba(12, 19, 36, 0.95);
      border: 1px solid rgba(148, 163, 184, 0.2);
      z-index: 15;
    }

    .lc-ctrl-btn {
      position: relative;
      min-width: 44px;
      height: 44px;
      padding: 0 0.85rem;
      border-radius: 999px;
      border: 1px solid rgba(148, 163, 184, 0.24);
      background: rgba(30, 41, 59, 0.86);
      color: #f8fafc;
      font-size: 0.82rem;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.36rem;
      white-space: nowrap;
      flex-shrink: 0;
      transition: all 0.15s ease;
    }
    .lc-ctrl-btn:hover { background: rgba(51, 65, 85, 0.95); transform: translateY(-1px); }
    .lc-ctrl-btn.off {
      background: rgba(239, 68, 68, 0.22);
      border-color: rgba(239, 68, 68, 0.55);
      color: #fca5a5;
    }
    .lc-ctrl-btn.active {
      background: rgba(6, 182, 212, 0.2);
      border-color: rgba(6, 182, 212, 0.55);
      color: #67e8f9;
    }
    .lc-ctrl-btn.call-start {
      background: linear-gradient(135deg, #10b981, #059669);
      border-color: transparent;
      color: #fff;
      padding: 0 1.2rem;
      box-shadow: 0 5px 18px rgba(16, 185, 129, 0.34);
    }
    .lc-ctrl-btn.call-next {
      background: linear-gradient(135deg, #06b6d4, #2563eb);
      border-color: transparent;
      color: #fff;
      padding: 0 1.15rem;
      box-shadow: 0 5px 18px rgba(6, 182, 212, 0.34);
    }
    .lc-ctrl-btn.call-end {
      background: linear-gradient(135deg, #ef4444, #dc2626);
      border-color: transparent;
      color: #fff;
      padding: 0 1rem;
      box-shadow: 0 5px 16px rgba(239, 68, 68, 0.3);
    }
    .lc-mobile-chat-btn { display: none; }
    .lc-unread-dot {
      position: absolute;
      top: -2px;
      right: -2px;
      min-width: 17px;
      height: 17px;
      padding: 0 4px;
      border-radius: 999px;
      background: #10b981;
      color: #fff;
      font-size: 0.64rem;
      font-weight: 900;
      display: none;
      align-items: center;
      justify-content: center;
      box-shadow: 0 0 0 2px #0c1324;
    }
    .lc-unread-dot.show { display: inline-flex; }

    /* Right Panel: Profile, Camera-Off Privacy Switch, Private Room & Live Text Chat */
    .lc-drawer-backdrop {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(2, 6, 15, 0.68);
      backdrop-filter: blur(4px);
      z-index: 110;
    }
    .lc-drawer-backdrop.open { display: block; }

    .lc-side-panel {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      min-height: 0;
      background: rgba(12, 19, 36, 0.94);
      border: 1px solid rgba(148, 163, 184, 0.16);
      border-radius: 18px;
      padding: 0.8rem;
      overflow: hidden;
    }
    .lc-side-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      flex-shrink: 0;
    }
    .lc-side-head h3 { font-size: 0.86rem; font-weight: 800; color: #f8fafc; }
    .lc-drawer-close { display: none; }

    .lc-field-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.42rem;
      flex-shrink: 0;
    }
    .lc-input, .lc-select {
      width: 100%;
      padding: 0.48rem 0.62rem;
      border-radius: 10px;
      border: 1px solid rgba(148, 163, 184, 0.24);
      background: rgba(7, 11, 20, 0.92);
      color: #f8fafc;
      font-size: 0.79rem;
      font-weight: 600;
      outline: none;
    }
    .lc-input:focus, .lc-select:focus { border-color: #06b6d4; }

    /* Camera Privacy Card (Explicit Camera-Off / Audio-Only Toggle) */
    .lc-privacy-box {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.5rem 0.68rem;
      border-radius: 12px;
      background: rgba(7, 11, 20, 0.84);
      border: 1px solid rgba(56, 189, 248, 0.22);
      cursor: pointer;
    }
    .lc-privacy-box.cam-off {
      border-color: rgba(245, 158, 11, 0.55);
      background: rgba(245, 158, 11, 0.08);
    }
    .lc-privacy-info { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
    .lc-privacy-title { font-size: 0.76rem; font-weight: 800; color: #f8fafc; }
    .lc-privacy-sub { font-size: 0.67rem; color: #94a3b8; }
    .lc-switch-pill {
      padding: 0.22rem 0.58rem;
      border-radius: 999px;
      font-size: 0.68rem;
      font-weight: 800;
      background: rgba(16, 185, 129, 0.2);
      color: #6ee7b7;
      border: 1px solid rgba(16, 185, 129, 0.45);
      flex-shrink: 0;
    }
    .lc-privacy-box.cam-off .lc-switch-pill {
      background: rgba(245, 158, 11, 0.2);
      color: #fde68a;
      border-color: rgba(245, 158, 11, 0.55);
    }

    /* Private Room Panel */
    .lc-room-box {
      flex-shrink: 0;
      display: none;
      flex-direction: column;
      gap: 0.45rem;
      padding: 0.6rem;
      border-radius: 12px;
      background: rgba(7, 11, 20, 0.88);
      border: 1px solid rgba(139, 92, 246, 0.34);
    }
    .lc-room-box.show { display: flex; }
    .lc-room-row { display: flex; gap: 0.36rem; }
    .lc-room-share {
      display: none;
      flex-direction: column;
      gap: 0.36rem;
      padding-top: 0.35rem;
      border-top: 1px solid rgba(148, 163, 184, 0.15);
    }
    .lc-room-share.show { display: flex; }

    /* Live Text Chat List */
    .lc-transcript-list {
      flex: 1;
      min-height: 90px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
      padding-right: 0.2rem;
      -webkit-overflow-scrolling: touch;
    }
    .lc-turn {
      padding: 0.5rem 0.7rem;
      border-radius: 12px;
      font-size: 0.79rem;
      line-height: 1.4;
      word-break: break-word;
    }
    .lc-turn.user {
      background: rgba(37, 99, 235, 0.26);
      border: 1px solid rgba(56, 189, 248, 0.32);
      align-self: flex-end;
      max-width: 90%;
    }
    .lc-turn.partner {
      background: rgba(16, 185, 129, 0.18);
      border: 1px solid rgba(52, 211, 153, 0.32);
      align-self: flex-start;
      max-width: 90%;
    }
    .lc-turn.system {
      background: rgba(15, 23, 42, 0.85);
      border: 1px solid rgba(148, 163, 184, 0.18);
      color: #cbd5e1;
      font-size: 0.74rem;
      align-self: stretch;
      text-align: center;
    }
    .lc-turn-meta {
      font-size: 0.66rem;
      color: #94a3b8;
      margin-bottom: 0.14rem;
      font-weight: 700;
    }

    .lc-text-bar { display: flex; gap: 0.36rem; flex-shrink: 0; }
    .lc-text-bar input {
      flex: 1;
      min-width: 0;
      padding: 0.52rem 0.7rem;
      border-radius: 10px;
      border: 1px solid rgba(148, 163, 184, 0.24);
      background: rgba(7, 11, 20, 0.92);
      color: #f8fafc;
      font-size: 0.82rem;
      outline: none;
    }
    .lc-text-bar input:focus { border-color: #06b6d4; }

    .lc-mini-btn {
      border: 1px solid rgba(148, 163, 184, 0.28);
      background: rgba(15, 23, 42, 0.92);
      color: #f8fafc;
      border-radius: 9px;
      padding: 0.4rem 0.74rem;
      font-size: 0.75rem;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.3rem;
      text-decoration: none;
      white-space: nowrap;
    }
    .lc-mini-btn:hover { border-color: #22d3ee; background: rgba(30, 41, 59, 0.95); }
    .lc-mini-btn.primary {
      background: linear-gradient(135deg, #10b981, #059669);
      border-color: transparent;
      color: #fff;
    }
    .lc-mini-btn.next-btn {
      background: linear-gradient(135deg, #06b6d4, #2563eb);
      border-color: transparent;
      color: #fff;
    }
    .lc-mini-btn.wa {
      background: linear-gradient(135deg, #16a34a, #15803d);
      border-color: transparent;
      color: #fff;
    }

    /* ─── MOBILE & SMALL SCREEN LAYOUT (<= 900px): 100% Viewport Fit, Zero Clipped Buttons! ─── */
    @media (max-width: 900px) {
      .lc-shell {
        display: flex;
        flex-direction: column;
        padding: 0.38rem;
        gap: 0;
        overflow: hidden;
      }
      .lc-stage-col {
        flex: 1;
        min-height: 0;
        gap: 0.4rem;
      }
      .lc-mode-bar {
        padding: 0.3rem 0.42rem;
        border-radius: 12px;
        gap: 0.3rem;
      }
      .lc-mode-tab {
        font-size: 0.72rem;
        padding: 0.34rem 0.56rem;
      }
      .lc-mode-tab .lc-tab-long { display: none; }
      .lc-badge {
        padding: 0.24rem 0.5rem;
        font-size: 0.69rem;
      }
      .lc-full-link { display: none; }

      /* Mobile FaceTime Video Stage: Partner fills 100%, Your Camera floats cleanly in Corner PiP! */
      .lc-video-stage {
        display: block;
        position: relative;
        flex: 1;
        min-height: 0;
        padding: 0;
        border-radius: 16px;
      }
      .lc-peer-tile.partner-tile {
        width: 100%;
        height: 100%;
        border-radius: 15px;
      }
      .lc-peer-tile.self-tile {
        position: absolute;
        bottom: 0.55rem;
        right: 0.55rem;
        width: 92px;
        height: 124px;
        border-radius: 13px;
        z-index: 8;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.72);
        border-width: 2px;
        cursor: pointer;
      }
      /* Keep Corner PiP ultra-clean on small screens — hide verbose text inside 92px box */
      .lc-peer-tile.self-tile .lc-tile-top,
      .lc-peer-tile.self-tile .lc-tile-bottom,
      .lc-peer-tile.self-tile .lc-ov-sub,
      .lc-peer-tile.self-tile .lc-ov-actions {
        display: none !important;
      }
      .lc-peer-tile.self-tile .lc-tile-overlay {
        padding: 0.35rem;
        gap: 0.25rem;
      }
      .lc-peer-tile.self-tile .lc-avatar-orb {
        width: 36px;
        height: 36px;
        font-size: 1.05rem;
      }
      .lc-peer-tile.self-tile .lc-ov-title {
        font-size: 0.63rem;
        line-height: 1.2;
      }

      /* Compact partner overlay so nothing ever collides on small phones (320px-430px) */
      .lc-peer-tile.partner-tile .lc-tile-overlay {
        padding: 2.2rem 0.85rem 2.2rem;
        gap: 0.4rem;
        max-width: 270px;
      }
      .lc-peer-tile.partner-tile .lc-avatar-orb {
        width: 54px;
        height: 54px;
        font-size: 1.5rem;
      }
      .lc-peer-tile.partner-tile .lc-ov-title { font-size: 0.88rem; }
      .lc-peer-tile.partner-tile .lc-ov-sub { font-size: 0.73rem; }
      .lc-peer-tile.partner-tile .lc-tile-bottom {
        right: 106px; /* Never overlap with bottom-right self PiP! */
      }

      /* Always-Visible Compact Single-Row Controls Dock */
      .lc-controls-dock {
        justify-content: space-between;
        gap: 0.28rem;
        padding: 0.38rem 0.44rem;
        border-radius: 14px;
      }
      .lc-ctrl-btn {
        min-width: 40px;
        height: 40px;
        padding: 0 0.58rem;
        font-size: 0.92rem;
      }
      .lc-ctrl-btn .lc-lbl { display: none; }
      .lc-ctrl-btn.call-start,
      .lc-ctrl-btn.call-next {
        padding: 0 0.92rem;
        font-size: 0.78rem;
        flex: 1;
        max-width: 150px;
      }
      .lc-ctrl-btn.call-start .lc-lbl,
      .lc-ctrl-btn.call-next .lc-lbl { display: inline; }
      .lc-ctrl-btn.call-end {
        padding: 0 0.68rem;
      }
      .lc-mobile-chat-btn { display: inline-flex; }
      #lcFlipBtn { display: none; }

      /* Slide-Up Mobile Drawer for Chat, Name, Camera Privacy & Private Room */
      .lc-side-panel {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        height: 74dvh;
        max-height: 560px;
        z-index: 120;
        border-radius: 20px 20px 0 0;
        border-bottom: none;
        box-shadow: 0 -16px 48px rgba(0, 0, 0, 0.72);
        transform: translateY(105%);
        transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
        pointer-events: none;
      }
      .lc-side-panel.drawer-open {
        transform: translateY(0);
        pointer-events: auto;
      }
      .lc-drawer-close {
        display: inline-flex;
        border: 1px solid rgba(148, 163, 184, 0.28);
        background: rgba(30, 41, 59, 0.9);
        color: #f8fafc;
        border-radius: 8px;
        padding: 0.24rem 0.6rem;
        font-size: 0.73rem;
        font-weight: 700;
        cursor: pointer;
      }
    }

    @media (max-width: 370px) {
      .lc-ctrl-btn { min-width: 36px; height: 38px; padding: 0 0.45rem; font-size: 0.86rem; }
      .lc-ctrl-btn.call-start, .lc-ctrl-btn.call-next { padding: 0 0.7rem; font-size: 0.74rem; }
      .lc-peer-tile.self-tile { width: 82px; height: 110px; }
      .lc-peer-tile.partner-tile .lc-tile-bottom { right: 94px; }
    }
  `;
}

/**
 * Modular HTML markup for CARDOSO Live — Random Match + Private Room Video & Voice Call.
 */
export function renderLiveCallPanelHTML(): string {
  return `
    <div class="lc-shell" id="liveCallRoot">
      <!-- Primary 2-Person Live Video Call Stage -->
      <div class="lc-stage-col">
        <!-- Top Bar: Mode Switch (Random Match vs Private Room) + Live Online Counter -->
        <div class="lc-mode-bar">
          <div class="lc-mode-tabs" role="tablist">
            <button type="button" class="lc-mode-tab active" data-peer-mode="random" id="lcModeRandomBtn" onclick="window.cardosoLiveCall && window.cardosoLiveCall.setPeerMode('random')">
              🎲 Random<span class="lc-tab-long"> Match</span>
            </button>
            <button type="button" class="lc-mode-tab" data-peer-mode="private" id="lcModePrivateBtn" onclick="window.cardosoLiveCall && window.cardosoLiveCall.setPeerMode('private')">
              🔗 Qol<span class="lc-tab-long"> Gaar ah</span>
            </button>
          </div>
          <div class="lc-presence-row">
            <span class="lc-badge live" id="lcOnlineBadge">
              <span class="lc-dot live" id="lcOnlineDot"></span>
              <span id="lcOnlineText">Online: 1</span>
            </span>
            <span class="lc-badge" id="lcTimerBadge" style="display:none;">00:00</span>
            <a href="/live-call" class="lc-badge lc-full-link" title="Fur shaashad buuxda">⛶ Full</a>
          </div>
        </div>

        <!-- Video Stage: 50/50 Split on Desktop | Full Partner + Floating Self PiP on Mobile -->
        <div class="lc-video-stage" id="lcVideoStage">
          <!-- TILE 1: REMOTE PARTNER -->
          <div class="lc-peer-tile partner-tile" id="lcPartnerTile">
            <video id="lcRemoteVideo" class="lc-stream-video" autoplay muted playsinline></video>
            <audio id="lcRemoteAudio" class="lc-hidden-audio" autoplay playsinline></audio>

            <button type="button" class="lc-audio-unlock" id="lcAudioUnlockBtn" onclick="window.cardosoLiveCall && window.cardosoLiveCall.forceUnlockAudio()">
              🔊 Guji si Codku u Furmo
            </button>

            <div class="lc-tile-top">
              <span class="lc-tile-pill" id="lcPartnerStatusBadge">Diyaar</span>
              <button type="button" class="lc-block-btn" id="lcBlockBtn" style="display:none;" onclick="window.cardosoLiveCall && window.cardosoLiveCall.blockPartner()" title="Ka xidh qofkan oo qof kale raadi">🚫 Block</button>
            </div>

            <div class="lc-tile-overlay" id="lcPartnerOverlay">
              <div class="lc-avatar-orb" id="lcPartnerOrb">🌍</div>
              <div class="lc-ov-title" id="lcPartnerTitle">CARDOSO Live — Video &amp; Cod Toos ah</div>
              <div class="lc-ov-sub" id="lcPartnerSub">Guji <strong>Raadi Qof</strong> si aad toos ula sheekaysato dadka online-ka ah — Video ama Cod Keliya!</div>
              <div class="lc-room-code-big" id="lcStageRoomCode" style="display:none;"></div>
              <div class="lc-ov-actions" id="lcPartnerActions">
                <button type="button" class="lc-mini-btn primary" onclick="window.cardosoLiveCall && window.cardosoLiveCall.findRandomMatch()">🔍 Raadi Qof Online ah</button>
              </div>
            </div>

            <div class="lc-tile-bottom">
              <span class="lc-tile-pill" id="lcPartnerNameTag">👤 Qofka Kula Hadlaya</span>
              <span class="lc-tile-pill muted" id="lcPartnerMuteTag" style="display:none;">🔇 Muted</span>
            </div>
          </div>

          <!-- TILE 2: YOUR OWN CAMERA / VOICE-ONLY CARD (Floating Corner PiP on Mobile!) -->
          <div class="lc-peer-tile self-tile" id="lcSelfTile" onclick="if (window.innerWidth <= 900 && window.cardosoLiveCall) window.cardosoLiveCall.toggleCamera();" title="Guji si aad u furto/xidho kaamirada">
            <video id="lcLocalVideo" class="lc-stream-video mirrored" autoplay muted playsinline></video>

            <div class="lc-tile-top">
              <span class="lc-tile-pill" id="lcSelfCamBadge">📷 Kaamiro Diyaar</span>
              <span class="lc-tile-pill muted" id="lcSelfMicBadge" style="display:none;">🔇 Mic Off</span>
            </div>

            <div class="lc-tile-overlay" id="lcSelfOverlay">
              <div class="lc-avatar-orb" id="lcSelfOrb">📷</div>
              <div class="lc-ov-title" id="lcSelfOvTitle">Kaamiradu Waa Diyaar</div>
              <div class="lc-ov-sub" id="lcSelfOvSub">Waad ku wada hadli kartaa <strong>Cod Keliya</strong>, ama hal gujis ku fur kaamiradaada mar kasta!</div>
              <div class="lc-ov-actions">
                <button type="button" class="lc-mini-btn" id="lcSelfQuickCamBtn" onclick="event.stopPropagation(); window.cardosoLiveCall && window.cardosoLiveCall.toggleCamera()">📷 Fur Kaamirada</button>
              </div>
            </div>

            <div class="lc-tile-bottom">
              <span class="lc-tile-pill" id="lcSelfNameTag">👤 Adiga</span>
              <span class="lc-tile-pill cam-off" id="lcSelfPrivacyPill" style="display:none;">🙈 Cod Keliya</span>
            </div>
          </div>
        </div>

        <!-- Always-Visible Pinned Bottom Call Controls Dock -->
        <div class="lc-controls-dock">
          <button type="button" class="lc-ctrl-btn call-start" id="lcMatchBtn" onclick="window.cardosoLiveCall && window.cardosoLiveCall.handlePrimaryAction()">
            🔍 <span class="lc-lbl">Raadi Qof</span>
          </button>
          <button type="button" class="lc-ctrl-btn call-next" id="lcNextBtn" style="display:none;" onclick="window.cardosoLiveCall && window.cardosoLiveCall.nextMatch()" title="U gudub qof kale oo cusub">
            ⏭️ <span class="lc-lbl">Next</span>
          </button>
          <button type="button" class="lc-ctrl-btn call-end" id="lcStopBtn" style="display:none;" onclick="window.cardosoLiveCall && window.cardosoLiveCall.leaveCall()" title="Ka bax wicitaanka">
            ⏹️ <span class="lc-lbl">Jooji</span>
          </button>
          <button type="button" class="lc-ctrl-btn active" id="lcCamBtn" onclick="window.cardosoLiveCall && window.cardosoLiveCall.toggleCamera()" title="Fur ama Xidh Kaamirada">
            📷 <span class="lc-lbl">Cam On</span>
          </button>
          <button type="button" class="lc-ctrl-btn active" id="lcMicBtn" onclick="window.cardosoLiveCall && window.cardosoLiveCall.toggleMic()" title="Shid ama Dami Makarafoonka">
            🎙️ <span class="lc-lbl">Mic On</span>
          </button>
          <button type="button" class="lc-ctrl-btn active" id="lcSpeakerBtn" onclick="window.cardosoLiveCall && window.cardosoLiveCall.toggleSpeaker()" title="Shid ama Dami Codka Qofka Kale">
            🔊 <span class="lc-lbl">Cod</span>
          </button>
          <button type="button" class="lc-ctrl-btn" id="lcFlipBtn" onclick="window.cardosoLiveCall && window.cardosoLiveCall.flipCamera()" title="Beddel kaamirada hore / dambe">
            🔄 <span class="lc-lbl">Flip</span>
          </button>
          <button type="button" class="lc-ctrl-btn lc-mobile-chat-btn" id="lcChatDrawerBtn" onclick="window.cardosoLiveCall && window.cardosoLiveCall.toggleMobileDrawer()" title="Fur Chat &amp; Dejinta">
            💬<span class="lc-unread-dot" id="lcChatUnreadBadge">0</span>
          </button>
        </div>
      </div>

      <!-- Mobile Drawer Backdrop -->
      <div class="lc-drawer-backdrop" id="lcDrawerBackdrop" onclick="window.cardosoLiveCall && window.cardosoLiveCall.closeMobileDrawer()"></div>

      <!-- Right Sidebar (Desktop) / Slide-Up Drawer (Mobile): Name, Camera Privacy, Private Room & Live Chat -->
      <aside class="lc-side-panel" id="lcSidePanel">
        <div class="lc-side-head">
          <h3>📹 CARDOSO Live · Chat &amp; Dejin</h3>
          <div style="display:flex;align-items:center;gap:0.4rem;">
            <span style="font-size:0.7rem;color:#34d399;font-weight:800;" id="lcConnModeTag">Live WebRTC</span>
            <button type="button" class="lc-drawer-close" onclick="window.cardosoLiveCall && window.cardosoLiveCall.closeMobileDrawer()">✕ Xidh</button>
          </div>
        </div>

        <div class="lc-field-grid">
          <input type="text" id="lcDisplayNameInput" class="lc-input" maxlength="32" placeholder="Magacaaga (tusaale: Cali)" onchange="window.cardosoLiveCall && window.cardosoLiveCall.updateProfile()" />
          <select class="lc-select" id="lcLangSelect" onchange="window.cardosoLiveCall && window.cardosoLiveCall.updateProfile()">
            <option value="all" selected>🌍 Dhammaan</option>
            <option value="so">🇸🇴 Af-Soomaali</option>
            <option value="en">🇬🇧 English</option>
          </select>
        </div>

        <!-- One-Tap Camera Privacy Control -->
        <div class="lc-privacy-box" id="lcPrivacyBox" onclick="window.cardosoLiveCall && window.cardosoLiveCall.toggleCamera()">
          <div class="lc-privacy-info">
            <span class="lc-privacy-title" id="lcPrivacyTitle">📷 Kaamiradu Way Furan Tahay</span>
            <span class="lc-privacy-sub" id="lcPrivacySub">Guji si aad u xidho kaamirada (Cod Keliya)</span>
          </div>
          <span class="lc-switch-pill" id="lcPrivacyPill">VIDEO ON</span>
        </div>

        <!-- Private Room Box -->
        <div class="lc-room-box" id="lcPrivateRoomBox">
          <div class="lc-room-row">
            <button type="button" class="lc-mini-btn primary" style="flex:1;" onclick="window.cardosoLiveCall && window.cardosoLiveCall.createPrivateRoom()">➕ Samee Qol Cusub</button>
          </div>
          <div class="lc-room-row">
            <input type="text" id="lcRoomCodeInput" class="lc-input" placeholder="Koodhka qolka (CAR-7429)" style="text-transform:uppercase;" />
            <button type="button" class="lc-mini-btn" onclick="window.cardosoLiveCall && window.cardosoLiveCall.joinPrivateRoom()">🔑 Gal</button>
          </div>
          <div class="lc-room-share" id="lcRoomShareBox">
            <div style="font-size:0.72rem;color:#bae6fd;font-weight:700;">Link-ga qolkaaga u dir saaxiibkaa:</div>
            <div class="lc-room-row">
              <button type="button" class="lc-mini-btn" style="flex:1;" onclick="window.cardosoLiveCall && window.cardosoLiveCall.copyRoomLink()">📋 Copy Link</button>
              <a href="#" target="_blank" rel="noopener" class="lc-mini-btn wa" id="lcWaShareBtn" style="flex:1;">💬 WhatsApp</a>
            </div>
          </div>
        </div>

        <div class="lc-side-head" style="margin-top:0.05rem;">
          <h3>💬 Sheekada Qoraalka</h3>
          <button type="button" class="btn btn-ghost btn-sm" style="padding:0.2rem 0.5rem;font-size:0.7rem;" onclick="window.cardosoLiveCall && window.cardosoLiveCall.clearTranscript()">Tirtir</button>
        </div>

        <div class="lc-transcript-list" id="lcTranscriptList">
          <div class="lc-turn system">
            Ku soo dhawoow <strong>CARDOSO Live</strong>! Guji <strong>🔍 Raadi Qof</strong> si aad ula hadasho qof online ah, ama dooro <strong>🔗 Qol Gaar ah</strong>. Kaamirada mar walba waad xidhi kartaa!
          </div>
        </div>

        <form class="lc-text-bar" onsubmit="event.preventDefault(); window.cardosoLiveCall && window.cardosoLiveCall.sendQuickText();">
          <input type="text" id="lcQuickTextInput" placeholder="U qor fariin qofka kula hadlaya..." />
          <button type="submit" class="btn btn-primary btn-sm">➤</button>
        </form>
      </aside>
    </div>
  `;
}

/**
 * Self-contained browser WebRTC P2P + Random Match + Private Room + Camera On/Off controller.
 * Features serialized signaling queue (zero offer/match race), dedicated audio-only playback
 * with mobile gesture unlock, automatic ICE restart, and responsive mobile drawer controls.
 * Verified syntactically with `new vm.Script()` in automated tests.
 */
export function renderLiveCallClientJS(): string {
  return `
  (function initCardosoLivePeerClient() {
    if (typeof window === 'undefined') return;

    function el(id) { return document.getElementById(id); }

    function toast(msg, isErr) {
      if (typeof showToast === 'function') {
        showToast(msg, Boolean(isErr));
      }
    }

    function getSavedName() {
      if (typeof state !== 'undefined' && state && state.userName) return state.userName;
      try {
        return localStorage.getItem('cardoso_live_display_name') || localStorage.getItem('cardoso_app_user_name') || '';
      } catch (e) {
        return '';
      }
    }

    function saveName(name) {
      try {
        if (name) localStorage.setItem('cardoso_live_display_name', name);
      } catch (e) {}
    }

    var peer = {
      booted: false,
      ws: null,
      wsConnected: false,
      reconnectTimer: null,
      pingTimer: null,
      signalChain: Promise.resolve(),
      peerId: '',
      mode: 'random',
      state: 'idle',
      iceState: 'new',
      iceRestartTimer: null,
      iceRestartAttempts: 0,
      roomId: '',
      roomCode: '',
      initiator: false,
      partner: null,
      displayName: '',
      language: 'all',
      camEnabled: true,
      micEnabled: true,
      speakerEnabled: true,
      facingMode: 'user',
      localStream: null,
      remoteVideoStream: null,
      remoteAudioStream: null,
      hasRemoteVideoTrack: false,
      hasRemoteAudioTrack: false,
      audioBlocked: false,
      pc: null,
      pendingIce: [],
      iceServers: [
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }
      ],
      callStartedAt: 0,
      timerHandle: null,
      stats: { onlineCount: 1, waitingCount: 0, activeCalls: 0 },
      autoJoinRoomCode: '',
      drawerOpen: false,
      unreadChatCount: 0
    };

    function getDisplayName() {
      var inp = el('lcDisplayNameInput');
      var val = String((inp && inp.value) || peer.displayName || getSavedName() || '').trim();
      return val || 'Marti CARDOSO';
    }

    function getRoomShareUrl(code) {
      return location.origin + '/live-call?room=' + encodeURIComponent(code || peer.roomCode || '');
    }

    function sendWs(payload) {
      if (peer.ws && peer.ws.readyState === WebSocket.OPEN) {
        peer.ws.send(JSON.stringify(payload));
        return true;
      }
      return false;
    }

    // Unlock Android Chrome / iOS Safari autoplay policy synchronously inside user tap gestures!
    function unlockRemoteMedia() {
      try {
        var AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          if (!peer._audioCtx) peer._audioCtx = new AudioCtx();
          if (peer._audioCtx.state === 'suspended') peer._audioCtx.resume().catch(function () {});
        }
      } catch (e) {}
      try {
        var ra = el('lcRemoteAudio');
        if (ra) {
          ra.muted = !peer.speakerEnabled;
          if (ra.srcObject) {
            var ap = ra.play();
            if (ap && typeof ap.then === 'function') {
              ap.then(function () { setAudioBlockedUI(false); }).catch(function () {});
            }
          }
        }
        var rv = el('lcRemoteVideo');
        if (rv && rv.srcObject) {
          var vp = rv.play();
          if (vp && typeof vp.catch === 'function') vp.catch(function () {});
        }
      } catch (e) {}
    }

    function setAudioBlockedUI(blocked) {
      peer.audioBlocked = Boolean(blocked);
      var btn = el('lcAudioUnlockBtn');
      if (btn) {
        if (peer.audioBlocked && peer.state === 'matched' && peer.speakerEnabled) btn.classList.add('show');
        else btn.classList.remove('show');
      }
    }

    function updateUnreadBadge() {
      var b = el('lcChatUnreadBadge');
      if (!b) return;
      if (peer.unreadChatCount > 0 && !peer.drawerOpen) {
        b.textContent = peer.unreadChatCount > 9 ? '9+' : String(peer.unreadChatCount);
        b.classList.add('show');
      } else {
        b.classList.remove('show');
      }
    }

    function appendChat(kind, text, who) {
      var list = el('lcTranscriptList');
      if (!list || !text) return;
      var item = document.createElement('div');
      item.className = 'lc-turn ' + kind;
      if (kind !== 'system' && who) {
        var meta = document.createElement('div');
        meta.className = 'lc-turn-meta';
        var now = new Date();
        var hh = String(now.getHours()).padStart(2, '0');
        var mm = String(now.getMinutes()).padStart(2, '0');
        meta.textContent = who + ' · ' + hh + ':' + mm;
        item.appendChild(meta);
      }
      var body = document.createElement('div');
      body.textContent = text;
      item.appendChild(body);
      list.appendChild(item);
      list.scrollTop = list.scrollHeight;
      if (kind === 'partner' && !peer.drawerOpen && window.innerWidth <= 900) {
        peer.unreadChatCount += 1;
        updateUnreadBadge();
        toast('💬 ' + (who || 'Fariin') + ': ' + text.slice(0, 60), false);
      }
    }

    function updatePresenceUI(stats) {
      if (stats) {
        peer.stats = {
          onlineCount: Math.max(1, Number(stats.onlineCount || 1)),
          waitingCount: Math.max(0, Number(stats.waitingCount || 0)),
          activeCalls: Math.max(0, Number(stats.activeCalls || 0))
        };
      }
      var txt = el('lcOnlineText');
      if (txt) {
        txt.textContent = 'Online: ' + peer.stats.onlineCount;
      }
    }

    function updateCallTimer() {
      var badge = el('lcTimerBadge');
      if (!badge) return;
      if (peer.state !== 'matched' || !peer.callStartedAt) {
        badge.style.display = 'none';
        return;
      }
      var secs = Math.max(0, Math.floor((Date.now() - peer.callStartedAt) / 1000));
      var mm = String(Math.floor(secs / 60)).padStart(2, '0');
      var ss = String(secs % 60).padStart(2, '0');
      badge.textContent = mm + ':' + ss;
      badge.style.display = 'inline-flex';
    }

    function updateSelfTileUI() {
      var vid = el('lcLocalVideo');
      var ov = el('lcSelfOverlay');
      var tile = el('lcSelfTile');
      var camBadge = el('lcSelfCamBadge');
      var micBadge = el('lcSelfMicBadge');
      var nameTag = el('lcSelfNameTag');
      var privPill = el('lcSelfPrivacyPill');
      var privBox = el('lcPrivacyBox');
      var privTitle = el('lcPrivacyTitle');
      var privSub = el('lcPrivacySub');
      var privSwitch = el('lcPrivacyPill');
      var quickBtn = el('lcSelfQuickCamBtn');

      var hasLiveVideo = Boolean(
        peer.camEnabled &&
        peer.localStream &&
        peer.localStream.getVideoTracks().some(function (t) { return t.readyState === 'live' && t.enabled; })
      );

      if (vid) {
        if (hasLiveVideo) {
          if (vid.srcObject !== peer.localStream) vid.srcObject = peer.localStream;
          vid.muted = true;
          vid.classList.add('active');
          var vp = vid.play();
          if (vp && typeof vp.catch === 'function') vp.catch(function () {});
        } else {
          vid.srcObject = null;
          vid.classList.remove('active');
        }
      }

      if (ov) {
        if (hasLiveVideo) ov.classList.add('hidden');
        else ov.classList.remove('hidden');
      }
      if (tile) {
        if (hasLiveVideo) tile.classList.add('cam-on');
        else tile.classList.remove('cam-on');
      }
      if (camBadge) {
        camBadge.className = 'lc-tile-pill' + (peer.camEnabled ? (hasLiveVideo ? ' ok' : '') : ' cam-off');
        camBadge.textContent = peer.camEnabled ? (hasLiveVideo ? '📷 Video Live' : '📷 Cam Diyaar') : '🙈 Cam Off';
      }
      if (micBadge) {
        micBadge.style.display = peer.micEnabled ? 'none' : 'inline-flex';
      }
      if (nameTag) {
        nameTag.textContent = '👤 ' + getDisplayName();
      }
      if (privPill) {
        privPill.style.display = peer.camEnabled ? 'none' : 'inline-flex';
      }

      var selfOrb = el('lcSelfOrb');
      var selfTitle = el('lcSelfOvTitle');
      var selfSub = el('lcSelfOvSub');
      if (selfOrb) selfOrb.textContent = peer.camEnabled ? '📷' : '🙈';
      if (selfTitle) {
        selfTitle.textContent = peer.camEnabled ? 'Kaamiro Diyaar' : 'Cam Off';
      }
      if (selfSub) {
        selfSub.innerHTML = peer.camEnabled
          ? 'Guji <strong>Fur Kaamirada</strong> ama <strong>Raadi Qof</strong> — mar walba waad xidhi kartaa!'
          : 'Qofku <strong>codkaaga keliya</strong> ayuu maqlayaa — kaamiradu way dansan tahay.';
      }
      if (quickBtn) {
        quickBtn.textContent = peer.camEnabled ? '📷 Tijaabi Kaamirada' : '📷 Fur Kaamirada';
      }

      if (privBox) privBox.className = 'lc-privacy-box' + (peer.camEnabled ? '' : ' cam-off');
      if (privTitle) privTitle.textContent = peer.camEnabled ? '📷 Kaamiradu Way Furan Tahay' : '🙈 Kaamiradu Way Xiran Tahay (Cod Keliya)';
      if (privSub) privSub.textContent = peer.camEnabled ? 'Guji si aad u xidho kaamirada (Cod Keliya)' : 'Guji mar kale si aad u furto muuqaalkaaga';
      if (privSwitch) privSwitch.textContent = peer.camEnabled ? 'VIDEO ON' : 'CAM OFF';
    }

    function updatePartnerTileUI() {
      var tile = el('lcPartnerTile');
      var vid = el('lcRemoteVideo');
      var ov = el('lcPartnerOverlay');
      var orb = el('lcPartnerOrb');
      var title = el('lcPartnerTitle');
      var sub = el('lcPartnerSub');
      var codeBox = el('lcStageRoomCode');
      var actions = el('lcPartnerActions');
      var statusBadge = el('lcPartnerStatusBadge');
      var nameTag = el('lcPartnerNameTag');
      var muteTag = el('lcPartnerMuteTag');
      var blockBtn = el('lcBlockBtn');

      // Show video as soon as a live remote video track exists & partner did not turn Cam OFF
      // (Never wait on !track.muted, which causes a mobile decode deadlock!)
      var liveRemoteVideoTracks = peer.remoteVideoStream
        ? peer.remoteVideoStream.getVideoTracks().filter(function (t) { return t.readyState === 'live'; })
        : [];
      var showRemoteVideo = Boolean(
        peer.state === 'matched' &&
        peer.partner &&
        peer.partner.camOn !== false &&
        liveRemoteVideoTracks.length > 0 &&
        (peer.iceState === 'connected' || peer.iceState === 'completed' || (vid && vid.readyState >= 2))
      );

      if (tile) {
        if (peer.state === 'matched') tile.classList.add('connected');
        else tile.classList.remove('connected');
      }
      if (blockBtn) blockBtn.style.display = peer.state === 'matched' ? 'inline-flex' : 'none';
      if (muteTag) muteTag.style.display = (peer.state === 'matched' && peer.partner && peer.partner.micOn === false) ? 'inline-flex' : 'none';
      if (nameTag) {
        nameTag.textContent = (peer.state === 'matched' && peer.partner)
          ? ('👤 ' + (peer.partner.name || 'Marti CARDOSO'))
          : '👤 Qofka Kula Hadlaya';
      }
      if (codeBox) codeBox.style.display = 'none';

      if (vid) {
        if (showRemoteVideo) vid.classList.add('active');
        else vid.classList.remove('active');
      }

      if (peer.state === 'matched') {
        var iceConnected = peer.iceState === 'connected' || peer.iceState === 'completed';
        var iceFailed = peer.iceState === 'failed';
        if (statusBadge) {
          statusBadge.className = 'lc-tile-pill ' + (iceFailed ? 'muted' : iceConnected ? 'ok' : 'cam-off');
          statusBadge.textContent = iceFailed
            ? '⚠️ Shabakadda xidhay'
            : !iceConnected
              ? '🔄 Xidhiidhaya...'
              : showRemoteVideo
                ? '🟢 Live Video'
                : '🎙️ Live Cod';
        }
        if (ov) {
          if (showRemoteVideo) {
            ov.classList.add('hidden');
          } else {
            ov.classList.remove('hidden');
            var pName = (peer.partner && peer.partner.name) || 'Marti CARDOSO';
            if (iceFailed) {
              if (orb) { orb.className = 'lc-avatar-orb'; orb.textContent = '📡'; }
              if (title) title.textContent = 'Xidhiidhka Video-ga wuu xirmay';
              if (sub) sub.innerHTML = 'Shabakadda 4G/Firewall ayaa celisay muuqaalka tooska ah. Qoraalka (💬) weli wuu shaqaynayaa.';
              if (actions) {
                actions.innerHTML =
                  '<button type="button" class="lc-mini-btn primary" onclick="window.cardosoLiveCall && window.cardosoLiveCall.retryWebRtc()">🔄 Isku Day Mar Kale</button>' +
                  '<button type="button" class="lc-mini-btn next-btn" onclick="window.cardosoLiveCall && window.cardosoLiveCall.nextMatch()">⏭️ Next</button>';
              }
            } else if (peer.partner && peer.partner.camOn === false) {
              if (orb) { orb.className = 'lc-avatar-orb audio-live'; orb.textContent = '🎙️'; }
              if (title) title.textContent = pName;
              if (sub) sub.innerHTML = iceConnected
                ? '<strong>Kaamiro Xiran · Cod Keliya</strong> — Toos ayaad u wada hadlaysaan!'
                : 'Xidhiidhka codka wuu furmayaa...';
              if (actions) actions.innerHTML = '';
            } else {
              if (orb) { orb.className = 'lc-avatar-orb radar'; orb.textContent = '📡'; }
              if (title) title.textContent = pName;
              if (sub) sub.innerHTML = 'Muuqaalka & codka tooska ah way furmayaan...';
              if (actions) actions.innerHTML = '';
            }
          }
        }
        return;
      }

      setAudioBlockedUI(false);
      if (ov) ov.classList.remove('hidden');

      if (peer.state === 'waiting') {
        if (statusBadge) { statusBadge.className = 'lc-tile-pill cam-off'; statusBadge.textContent = '🔍 Raadinaya...'; }
        if (orb) { orb.className = 'lc-avatar-orb radar'; orb.textContent = '📡'; }
        if (title) title.textContent = 'Waxaa la raadinayaa qof online ah...';
        if (sub) sub.innerHTML = 'Fadlan sug waxyar — waxaa laguu xidhayaa qof online ah...';
        if (actions) {
          actions.innerHTML = '<button type="button" class="lc-mini-btn next-btn" onclick="window.cardosoLiveCall && window.cardosoLiveCall.nextMatch()">⏭️ Next (Qof Kale)</button>';
        }
        return;
      }

      if (peer.state === 'room_waiting') {
        if (statusBadge) { statusBadge.className = 'lc-tile-pill cam-off'; statusBadge.textContent = '🔗 Qol Sugaya'; }
        if (orb) { orb.className = 'lc-avatar-orb radar'; orb.textContent = '🔗'; }
        if (title) title.textContent = 'Qolkaagu Waa Diyaar';
        if (sub) sub.innerHTML = 'Koodhkan ama link-ga u dir saaxiibkaa!';
        if (codeBox && peer.roomCode) {
          codeBox.textContent = peer.roomCode;
          codeBox.style.display = 'inline-block';
        }
        if (actions) {
          var waHref = 'https://wa.me/?text=' + encodeURIComponent('Ku soo biir CARDOSO Live (Koodh: ' + peer.roomCode + '): ' + getRoomShareUrl(peer.roomCode));
          actions.innerHTML =
            '<button type="button" class="lc-mini-btn" onclick="window.cardosoLiveCall && window.cardosoLiveCall.copyRoomLink()">📋 Copy</button>' +
            '<a href="' + waHref + '" target="_blank" rel="noopener" class="lc-mini-btn wa">💬 WhatsApp</a>';
        }
        return;
      }

      // Idle
      if (statusBadge) { statusBadge.className = 'lc-tile-pill'; statusBadge.textContent = 'Diyaar'; }
      if (orb) { orb.className = 'lc-avatar-orb'; orb.textContent = peer.mode === 'private' ? '🔗' : '🌍'; }
      if (title) {
        title.textContent = peer.mode === 'private'
          ? 'Qol Gaar ah — Adiga & Saaxiibkaa'
          : 'CARDOSO Live — Video & Cod Toos ah';
      }
      if (sub) {
        sub.innerHTML = peer.mode === 'private'
          ? 'Samee qol cusub oo link-ga <strong>WhatsApp</strong> ugu dir saaxiibkaa, ama geli koodhka!'
          : 'Guji <strong>Raadi Qof</strong> si aad toos ula sheekaysato dadka online-ka ah!';
      }
      if (actions) {
        actions.innerHTML = peer.mode === 'private'
          ? '<button type="button" class="lc-mini-btn primary" onclick="window.cardosoLiveCall && window.cardosoLiveCall.createPrivateRoom()">➕ Samee Qol Cusub</button>' +
            '<button type="button" class="lc-mini-btn" onclick="window.cardosoLiveCall && window.cardosoLiveCall.openMobileDrawer()">🔑 Geli Koodh</button>'
          : '<button type="button" class="lc-mini-btn primary" onclick="window.cardosoLiveCall && window.cardosoLiveCall.findRandomMatch()">🔍 Raadi Qof Online ah</button>';
      }
    }

    function refreshControlsUI() {
      var matchBtn = el('lcMatchBtn');
      var nextBtn = el('lcNextBtn');
      var stopBtn = el('lcStopBtn');
      var camBtn = el('lcCamBtn');
      var micBtn = el('lcMicBtn');
      var spkBtn = el('lcSpeakerBtn');

      var isMatched = peer.state === 'matched';
      var isSearching = peer.state === 'waiting' || peer.state === 'room_waiting';

      if (matchBtn) {
        matchBtn.style.display = (isMatched || isSearching) ? 'none' : 'inline-flex';
        matchBtn.innerHTML = peer.mode === 'private'
          ? '➕ <span class="lc-lbl">Samee Qol</span>'
          : '🔍 <span class="lc-lbl">Raadi Qof</span>';
      }
      if (nextBtn) {
        nextBtn.style.display = ((isMatched || peer.state === 'waiting') && peer.mode === 'random') ? 'inline-flex' : 'none';
      }
      if (stopBtn) {
        stopBtn.style.display = (isMatched || isSearching) ? 'inline-flex' : 'none';
      }
      if (camBtn) {
        camBtn.className = 'lc-ctrl-btn' + (peer.camEnabled ? ' active' : ' off');
        camBtn.innerHTML = (peer.camEnabled ? '📷' : '🙈') + ' <span class="lc-lbl">' + (peer.camEnabled ? 'Cam On' : 'Cam Off') + '</span>';
      }
      if (micBtn) {
        micBtn.className = 'lc-ctrl-btn' + (peer.micEnabled ? ' active' : ' off');
        micBtn.innerHTML = (peer.micEnabled ? '🎙️' : '🔇') + ' <span class="lc-lbl">' + (peer.micEnabled ? 'Mic On' : 'Mic Off') + '</span>';
      }
      if (spkBtn) {
        spkBtn.className = 'lc-ctrl-btn' + (peer.speakerEnabled ? ' active' : ' off');
        spkBtn.innerHTML = (peer.speakerEnabled ? '🔊' : '🔇') + ' <span class="lc-lbl">Cod</span>';
      }

      var randTab = el('lcModeRandomBtn');
      var privTab = el('lcModePrivateBtn');
      var privBox = el('lcPrivateRoomBox');
      if (randTab) randTab.className = 'lc-mode-tab' + (peer.mode === 'random' ? ' active' : '');
      if (privTab) privTab.className = 'lc-mode-tab' + (peer.mode === 'private' ? ' active' : '');
      if (privBox) {
        if (peer.mode === 'private') privBox.classList.add('show');
        else privBox.classList.remove('show');
      }

      var shareBox = el('lcRoomShareBox');
      var waBtn = el('lcWaShareBtn');
      if (shareBox) {
        if (peer.roomCode && peer.mode === 'private') {
          shareBox.classList.add('show');
          if (waBtn) {
            var shareUrl = getRoomShareUrl(peer.roomCode);
            waBtn.href = 'https://wa.me/?text=' + encodeURIComponent('Ku soo biir Video Call-keenna tooska ah ee CARDOSO Live (Koodh: ' + peer.roomCode + '): ' + shareUrl);
          }
        } else {
          shareBox.classList.remove('show');
        }
      }

      updateSelfTileUI();
      updatePartnerTileUI();
      updateCallTimer();
    }

    function describeMediaError(err) {
      var name = String((err && err.name) || '');
      var msg = String((err && err.message) || '');
      if (typeof window !== 'undefined' && window.isSecureContext === false) {
        return '🔒 Browser-ku wuxuu u baahan yahay https:// ama http://localhost:3000 si Camera & Mic u furmaan';
      }
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || /denied|permission/i.test(msg)) {
        return '🚫 Ogolaanshaha Camera/Mic waa la diiday — guji qufulka (🔒) oo dooro Allow';
      }
      if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        return '📷 Kaamiro ama Makarafoon laguma helin qalabkan';
      }
      if (name === 'NotReadableError' || name === 'TrackStartError') {
        return '⚠️ Kaamirada barnaamij kale ayaa haya (Zoom / WhatsApp / tab kale)';
      }
      return msg || 'Camera/Mic lama furi karin';
    }

    async function ensureLocalMedia(forceCamPrompt) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if (forceCamPrompt) toast(describeMediaError(null), true);
        return peer.localStream;
      }

      var needVideo = Boolean(peer.camEnabled);
      var needAudio = Boolean(peer.micEnabled);

      var hasLiveAudio = Boolean(peer.localStream && peer.localStream.getAudioTracks().some(function (t) { return t.readyState === 'live'; }));
      var hasLiveVideo = Boolean(peer.localStream && peer.localStream.getVideoTracks().some(function (t) { return t.readyState === 'live'; }));

      if (!peer.localStream && typeof MediaStream !== 'undefined') {
        peer.localStream = new MediaStream();
      }

      if (needAudio && needVideo && !hasLiveAudio && !hasLiveVideo) {
        try {
          var both = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            video: { facingMode: peer.facingMode, width: { ideal: 640 }, height: { ideal: 480 } }
          });
          both.getTracks().forEach(function (t) { peer.localStream.addTrack(t); });
          hasLiveAudio = peer.localStream.getAudioTracks().length > 0;
          hasLiveVideo = peer.localStream.getVideoTracks().length > 0;
        } catch (e1) {}
      }

      if (needAudio && !hasLiveAudio) {
        try {
          var aStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            video: false
          });
          aStream.getAudioTracks().forEach(function (t) { peer.localStream.addTrack(t); });
        } catch (aErr) {
          peer.micEnabled = false;
          toast(describeMediaError(aErr), true);
        }
      }

      if (needVideo && !hasLiveVideo) {
        try {
          var vStream = null;
          try {
            vStream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: peer.facingMode, width: { ideal: 640 }, height: { ideal: 480 } },
              audio: false
            });
          } catch (vcErr) {
            vStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          }
          vStream.getVideoTracks().forEach(function (t) { peer.localStream.addTrack(t); });
        } catch (vErr) {
          peer.camEnabled = false;
          toast(describeMediaError(vErr) + ' — waxaa lagu sii soconayaa Cod Keliya!', false);
        }
      }

      if (peer.localStream) {
        peer.localStream.getAudioTracks().forEach(function (t) { t.enabled = peer.micEnabled; });
        peer.localStream.getVideoTracks().forEach(function (t) { t.enabled = peer.camEnabled; });
      }
      updateSelfTileUI();
      return peer.localStream;
    }

    function teardownPeerConnection() {
      peer.pendingIce = [];
      peer.iceState = 'new';
      peer.iceRestartAttempts = 0;
      if (peer.iceRestartTimer) {
        clearTimeout(peer.iceRestartTimer);
        peer.iceRestartTimer = null;
      }
      if (peer.pc) {
        try { peer.pc.onicecandidate = null; } catch (e) {}
        try { peer.pc.ontrack = null; } catch (e) {}
        try { peer.pc.oniceconnectionstatechange = null; } catch (e) {}
        try { peer.pc.onconnectionstatechange = null; } catch (e) {}
        try { peer.pc.close(); } catch (e) {}
        peer.pc = null;
      }
      peer.remoteVideoStream = null;
      peer.remoteAudioStream = null;
      peer.hasRemoteVideoTrack = false;
      peer.hasRemoteAudioTrack = false;
      setAudioBlockedUI(false);

      var rv = el('lcRemoteVideo');
      if (rv) {
        try { rv.pause(); } catch (e) {}
        rv.srcObject = null;
        rv.classList.remove('active');
      }
      var ra = el('lcRemoteAudio');
      if (ra) {
        try { ra.pause(); } catch (e) {}
        ra.srcObject = null;
      }
      if (peer.timerHandle) {
        clearInterval(peer.timerHandle);
        peer.timerHandle = null;
      }
      peer.callStartedAt = 0;
    }

    function attachRemoteTrack(track) {
      if (!track) return;

      if (track.kind === 'video') {
        peer.hasRemoteVideoTrack = true;
        if (!peer.remoteVideoStream && typeof MediaStream !== 'undefined') {
          peer.remoteVideoStream = new MediaStream();
        }
        if (peer.remoteVideoStream) {
          peer.remoteVideoStream.getVideoTracks().forEach(function (oldT) {
            if (oldT.id !== track.id) {
              try { peer.remoteVideoStream.removeTrack(oldT); } catch (e) {}
            }
          });
          if (!peer.remoteVideoStream.getVideoTracks().some(function (t) { return t.id === track.id; })) {
            try { peer.remoteVideoStream.addTrack(track); } catch (e) {}
          }
        }
        var rv = el('lcRemoteVideo');
        if (rv && peer.remoteVideoStream) {
          rv.muted = true; // Audio plays exclusively via dedicated #lcRemoteAudio (zero echo!)
          rv.playsInline = true;
          if (rv.srcObject !== peer.remoteVideoStream) rv.srcObject = peer.remoteVideoStream;
          rv.onloadedmetadata = function () { updatePartnerTileUI(); };
          rv.onloadeddata = function () { updatePartnerTileUI(); };
          rv.onplaying = function () { updatePartnerTileUI(); };
          rv.oncanplay = function () { updatePartnerTileUI(); };
          rv.onresize = function () { updatePartnerTileUI(); };
          var vp = rv.play();
          if (vp && typeof vp.catch === 'function') vp.catch(function () {});
        }
      } else if (track.kind === 'audio') {
        peer.hasRemoteAudioTrack = true;
        if (!peer.remoteAudioStream && typeof MediaStream !== 'undefined') {
          peer.remoteAudioStream = new MediaStream();
        }
        if (peer.remoteAudioStream) {
          peer.remoteAudioStream.getAudioTracks().forEach(function (oldA) {
            if (oldA.id !== track.id) {
              try { peer.remoteAudioStream.removeTrack(oldA); } catch (e) {}
            }
          });
          if (!peer.remoteAudioStream.getAudioTracks().some(function (t) { return t.id === track.id; })) {
            try { peer.remoteAudioStream.addTrack(track); } catch (e) {}
          }
        }
        var ra = el('lcRemoteAudio');
        if (ra && peer.remoteAudioStream) {
          ra.muted = !peer.speakerEnabled;
          ra.volume = 1.0;
          if (ra.srcObject !== peer.remoteAudioStream) ra.srcObject = peer.remoteAudioStream;
          var ap = ra.play();
          if (ap && typeof ap.then === 'function') {
            ap.then(function () {
              setAudioBlockedUI(false);
            }).catch(function () {
              setAudioBlockedUI(true);
            });
          }
        }
      }

      track.onunmute = function () { updatePartnerTileUI(); };
      track.onmute = function () { updatePartnerTileUI(); };
      track.onended = function () { updatePartnerTileUI(); };
      updatePartnerTileUI();
    }

    async function triggerIceRestart() {
      if (!peer.pc || peer.state !== 'matched') return;
      if (peer.iceRestartAttempts >= 2) {
        updatePartnerTileUI();
        return;
      }
      peer.iceRestartAttempts += 1;
      try {
        var offer = await peer.pc.createOffer({ iceRestart: true });
        await peer.pc.setLocalDescription(offer);
        sendWs({ type: 'rtc.offer', sdp: offer.sdp });
      } catch (e) {}
    }

    async function setupWebRtcForMatch(isInitiator) {
      teardownPeerConnection();
      if (typeof RTCPeerConnection === 'undefined') {
        toast('⚠️ Browser-kan ma taageero WebRTC Video Call', true);
        return;
      }

      await ensureLocalMedia(false);
      // Guard: call may have ended while awaiting getUserMedia
      if (peer.state !== 'matched') return;

      var pc = new RTCPeerConnection({
        iceServers: peer.iceServers,
        iceCandidatePoolSize: 4
      });
      peer.pc = pc;
      peer.initiator = Boolean(isInitiator);
      peer.iceState = 'checking';

      var addedAudio = false;
      var addedVideo = false;
      if (peer.localStream) {
        peer.localStream.getTracks().forEach(function (track) {
          if (track.readyState === 'live') {
            pc.addTrack(track, peer.localStream);
            if (track.kind === 'audio') addedAudio = true;
            if (track.kind === 'video') addedVideo = true;
          }
        });
      }

      // Always ensure we can receive remote audio & video even if we joined Cam-Off or Mic-Off!
      if (typeof pc.addTransceiver === 'function') {
        if (!addedAudio) {
          try { pc.addTransceiver('audio', { direction: 'recvonly' }); } catch (e) {}
        }
        if (!addedVideo) {
          try { pc.addTransceiver('video', { direction: 'recvonly' }); } catch (e) {}
        }
      }

      pc.ontrack = function (ev) {
        if (peer.pc !== pc) return;
        attachRemoteTrack(ev.track);
      };

      pc.onicecandidate = function (ev) {
        if (peer.pc !== pc) return;
        if (ev.candidate) {
          sendWs({
            type: 'rtc.ice',
            candidate: ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate
          });
        }
      };

      var syncConnState = function () {
        if (peer.pc !== pc) return;
        var iceSt = pc.iceConnectionState || 'new';
        var connSt = pc.connectionState || 'new';
        var st = (iceSt === 'connected' || iceSt === 'completed' || connSt === 'connected')
          ? 'connected'
          : (iceSt === 'failed' || connSt === 'failed')
            ? 'failed'
            : (iceSt === 'disconnected' || connSt === 'disconnected')
              ? 'disconnected'
              : 'checking';
        peer.iceState = st;
        if (st === 'connected' || st === 'completed') {
          peer.iceRestartAttempts = 0;
          if (peer.iceRestartTimer) { clearTimeout(peer.iceRestartTimer); peer.iceRestartTimer = null; }
          // Ensure remote media starts playing cleanly once ICE connects
          var rv = el('lcRemoteVideo');
          if (rv && rv.srcObject) {
            var vp = rv.play();
            if (vp && typeof vp.catch === 'function') vp.catch(function () {});
          }
          var ra = el('lcRemoteAudio');
          if (ra && ra.srcObject && peer.speakerEnabled) {
            var ap = ra.play();
            if (ap && typeof ap.then === 'function') {
              ap.then(function () { setAudioBlockedUI(false); }).catch(function () { setAudioBlockedUI(true); });
            }
          }
        } else if (st === 'failed') {
          if (peer.initiator && peer.iceRestartAttempts < 2) {
            triggerIceRestart();
          }
        } else if (st === 'disconnected') {
          if (peer.initiator && !peer.iceRestartTimer) {
            peer.iceRestartTimer = setTimeout(function () {
              peer.iceRestartTimer = null;
              if (peer.pc === pc && (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed')) {
                triggerIceRestart();
              }
            }, 3500);
          }
        }
        updatePartnerTileUI();
      };

      pc.oniceconnectionstatechange = syncConnState;
      pc.onconnectionstatechange = syncConnState;

      // Sync our actual media status immediately after acquiring tracks
      sendWs({ type: 'media.state', camOn: peer.camEnabled, micOn: peer.micEnabled });

      if (isInitiator) {
        try {
          var offer = await pc.createOffer();
          if (peer.pc !== pc) return;
          await pc.setLocalDescription(offer);
          sendWs({ type: 'rtc.offer', sdp: offer.sdp });
        } catch (e) {}
      }
      updatePartnerTileUI();
    }

    async function flushPendingIce() {
      if (!peer.pc || !peer.pc.remoteDescription) return;
      while (peer.pendingIce.length > 0) {
        var cand = peer.pendingIce.shift();
        try {
          await peer.pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (e) {}
      }
    }

    async function renegotiateWithNewVideoTrack(newTrack) {
      if (!peer.pc || peer.state !== 'matched') return;
      try {
        var senders = peer.pc.getSenders ? peer.pc.getSenders() : [];
        var videoSender = senders.find(function (s) { return s.track && s.track.kind === 'video'; });
        if (!videoSender && peer.pc.getTransceivers) {
          var vt = peer.pc.getTransceivers().find(function (tr) {
            return tr.receiver && tr.receiver.track && tr.receiver.track.kind === 'video';
          });
          if (vt && vt.sender) {
            videoSender = vt.sender;
            try { vt.direction = 'sendrecv'; } catch (e) {}
          }
        }
        if (videoSender) {
          await videoSender.replaceTrack(newTrack);
        } else {
          peer.pc.addTrack(newTrack, peer.localStream);
        }
        var offer = await peer.pc.createOffer();
        await peer.pc.setLocalDescription(offer);
        sendWs({ type: 'rtc.offer', sdp: offer.sdp });
      } catch (e) {}
    }

    async function processServerMessage(msg) {
      if (!msg || !msg.type) return;

      switch (msg.type) {
        case 'welcome':
          peer.peerId = msg.peerId || '';
          if (Array.isArray(msg.iceServers) && msg.iceServers.length > 0) {
            peer.iceServers = msg.iceServers;
          }
          updatePresenceUI(msg.stats);
          if (peer.autoJoinRoomCode) {
            var code = peer.autoJoinRoomCode;
            peer.autoJoinRoomCode = '';
            api.setPeerMode('private');
            var inp = el('lcRoomCodeInput');
            if (inp) inp.value = code;
            api.joinPrivateRoom();
          }
          break;

        case 'ice.update':
          if (Array.isArray(msg.iceServers) && msg.iceServers.length > 0) {
            peer.iceServers = msg.iceServers;
          }
          break;

        case 'presence':
          updatePresenceUI(msg);
          break;

        case 'match.waiting':
          peer.state = 'waiting';
          peer.partner = null;
          updatePresenceUI(msg.stats);
          refreshControlsUI();
          break;

        case 'room.created':
          peer.state = 'room_waiting';
          peer.roomCode = msg.roomCode || '';
          peer.partner = null;
          var rInp = el('lcRoomCodeInput');
          if (rInp && peer.roomCode) rInp.value = peer.roomCode;
          updatePresenceUI(msg.stats);
          refreshControlsUI();
          appendChat('system', '🔗 Qolkaaga waa diyaar (' + peer.roomCode + '). Link-ga u dir saaxiibkaa!');
          break;

        case 'match.found':
          peer.state = 'matched';
          peer.roomId = msg.roomId || '';
          if (msg.roomCode) peer.roomCode = msg.roomCode;
          peer.partner = msg.partner || { name: 'Marti CARDOSO', camOn: true, micOn: true };
          peer.callStartedAt = Date.now();
          if (peer.timerHandle) clearInterval(peer.timerHandle);
          peer.timerHandle = setInterval(updateCallTimer, 1000);
          refreshControlsUI();
          appendChat('system', '🟢 Waxaad ku xidhantay: ' + (peer.partner.name || 'Marti CARDOSO') + (peer.partner.camOn === false ? ' (Cod Keliya)' : ''));
          toast('🟢 Waa laguu helay: ' + (peer.partner.name || 'Marti CARDOSO'), false);
          await setupWebRtcForMatch(Boolean(msg.initiator));
          break;

        case 'rtc.offer':
          if (peer.state !== 'matched') break;
          if (!peer.pc) {
            await setupWebRtcForMatch(false);
          }
          if (peer.pc && msg.sdp) {
            try {
              // Handle glare cleanly if both peers offered simultaneously
              if (peer.pc.signalingState !== 'stable') {
                try { await peer.pc.setLocalDescription({ type: 'rollback' }); } catch (rbErr) {}
              }
              await peer.pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: msg.sdp }));
              await flushPendingIce();
              var ans = await peer.pc.createAnswer();
              await peer.pc.setLocalDescription(ans);
              sendWs({ type: 'rtc.answer', sdp: ans.sdp });
            } catch (e) {}
          }
          break;

        case 'rtc.answer':
          if (peer.pc && msg.sdp && peer.pc.signalingState === 'have-local-offer') {
            try {
              await peer.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: msg.sdp }));
              await flushPendingIce();
            } catch (e) {}
          }
          break;

        case 'rtc.ice':
          if (msg.candidate) {
            if (peer.pc && peer.pc.remoteDescription) {
              try {
                await peer.pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
              } catch (e) {}
            } else {
              // Buffer even if peer.pc is still initializing — NEVER drop early ICE candidates!
              peer.pendingIce.push(msg.candidate);
            }
          }
          break;

        case 'partner.media':
          if (peer.partner) {
            if (msg.camOn !== undefined) peer.partner.camOn = Boolean(msg.camOn);
            if (msg.micOn !== undefined) peer.partner.micOn = Boolean(msg.micOn);
            updatePartnerTileUI();
          }
          break;

        case 'chat.message':
          appendChat('partner', msg.text, msg.senderName || (peer.partner && peer.partner.name) || 'Qofka Kale');
          break;

        case 'chat.sent':
          appendChat('user', msg.text, getDisplayName());
          break;

        case 'partner.left': {
          var prevName = (peer.partner && peer.partner.name) || 'Qofkii';
          teardownPeerConnection();
          peer.state = 'idle';
          peer.roomId = '';
          peer.partner = null;
          refreshControlsUI();
          var why = msg.reason === 'next' ? ' wuu ka gudbay wicitaanka (Next).' : ' wuu ka baxay wicitaanka.';
          appendChat('system', '👋 ' + prevName + why + ' Guji "Raadi Qof" si aad qof cusub u hesho.');
          toast('👋 ' + prevName + why, false);
          break;
        }

        case 'match.cancelled':
        case 'call.left':
        case 'partner.blocked':
          teardownPeerConnection();
          peer.state = 'idle';
          peer.roomId = '';
          peer.partner = null;
          if (msg.stats) updatePresenceUI(msg.stats);
          refreshControlsUI();
          break;

        case 'error':
          toast('⚠️ ' + (msg.message || 'Khalad ayaa dhacay'), true);
          break;
      }
    }

    // Strictly serialize all WebSocket signaling messages so match.found & rtc.offer NEVER race!
    function enqueueServerMessage(msg) {
      peer.signalChain = peer.signalChain
        .then(function () { return processServerMessage(msg); })
        .catch(function () {});
    }

    function connectPeerSocket() {
      if (peer.ws && (peer.ws.readyState === WebSocket.OPEN || peer.ws.readyState === WebSocket.CONNECTING)) {
        return;
      }
      var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      var q = new URLSearchParams({
        name: getDisplayName(),
        lang: peer.language,
        cam: peer.camEnabled ? '1' : '0',
        mic: peer.micEnabled ? '1' : '0'
      });
      var ws = new WebSocket(proto + '//' + location.host + '/ws/live-peer?' + q.toString());
      peer.ws = ws;

      ws.onopen = function () {
        peer.wsConnected = true;
        if (peer.pingTimer) clearInterval(peer.pingTimer);
        peer.pingTimer = setInterval(function () {
          sendWs({ type: 'ping', clientTs: Date.now() });
        }, 18000);
      };

      ws.onmessage = function (ev) {
        try {
          enqueueServerMessage(JSON.parse(ev.data));
        } catch (e) {}
      };

      ws.onclose = function () {
        peer.wsConnected = false;
        if (peer.pingTimer) { clearInterval(peer.pingTimer); peer.pingTimer = null; }
        if (peer.state === 'matched' || peer.state === 'waiting' || peer.state === 'room_waiting') {
          teardownPeerConnection();
          peer.state = 'idle';
          peer.partner = null;
          refreshControlsUI();
        }
        if (peer.reconnectTimer) clearTimeout(peer.reconnectTimer);
        peer.reconnectTimer = setTimeout(connectPeerSocket, 3000);
      };

      ws.onerror = function () {};
    }

    function ensureSocketReady(cb) {
      if (peer.ws && peer.ws.readyState === WebSocket.OPEN) {
        cb();
        return;
      }
      connectPeerSocket();
      var tries = 0;
      var wait = setInterval(function () {
        tries += 1;
        if (peer.ws && peer.ws.readyState === WebSocket.OPEN) {
          clearInterval(wait);
          cb();
        } else if (tries > 30) {
          clearInterval(wait);
          toast('❌ Server-ka /ws/live-peer laguma xidhmin — hubi internet-ka', true);
        }
      }, 150);
    }

    var api = {
      onTabActivated: function () {
        if (!peer.booted) {
          peer.booted = true;
          var saved = getSavedName();
          var nameInp = el('lcDisplayNameInput');
          if (nameInp && saved && !nameInp.value) nameInp.value = saved;
          peer.displayName = saved;

          try {
            var params = new URLSearchParams(location.search || '');
            var urlRoom = String(params.get('room') || '').trim().toUpperCase();
            if (urlRoom && urlRoom.length >= 3) {
              peer.autoJoinRoomCode = urlRoom;
            }
          } catch (e) {}

          refreshControlsUI();
          connectPeerSocket();
        } else {
          connectPeerSocket();
          refreshControlsUI();
        }
      },

      openMobileDrawer: function () {
        peer.drawerOpen = true;
        peer.unreadChatCount = 0;
        updateUnreadBadge();
        var panel = el('lcSidePanel');
        var bg = el('lcDrawerBackdrop');
        if (panel) panel.classList.add('drawer-open');
        if (bg) bg.classList.add('open');
      },

      closeMobileDrawer: function () {
        peer.drawerOpen = false;
        var panel = el('lcSidePanel');
        var bg = el('lcDrawerBackdrop');
        if (panel) panel.classList.remove('drawer-open');
        if (bg) bg.classList.remove('open');
      },

      toggleMobileDrawer: function () {
        if (peer.drawerOpen) api.closeMobileDrawer();
        else api.openMobileDrawer();
      },

      forceUnlockAudio: function () {
        peer.speakerEnabled = true;
        unlockRemoteMedia();
        setAudioBlockedUI(false);
        refreshControlsUI();
        toast('🔊 Codka qofka kale waa furmay!', false);
      },

      retryWebRtc: function () {
        if (peer.state !== 'matched') return;
        peer.iceRestartAttempts = 0;
        peer.iceState = 'checking';
        updatePartnerTileUI();
        if (peer.pc) {
          triggerIceRestart();
        } else {
          setupWebRtcForMatch(true);
        }
      },

      setPeerMode: function (mode) {
        var next = mode === 'private' ? 'private' : 'random';
        if (peer.mode === next) return;
        if (peer.state !== 'idle') {
          api.leaveCall();
        }
        peer.mode = next;
        refreshControlsUI();
      },

      updateProfile: function () {
        var nameInp = el('lcDisplayNameInput');
        var langSel = el('lcLangSelect');
        peer.displayName = String((nameInp && nameInp.value) || '').trim();
        saveName(peer.displayName);
        peer.language = (langSel && (langSel.value === 'so' || langSel.value === 'en')) ? langSel.value : 'all';
        updateSelfTileUI();
        sendWs({
          type: 'hello',
          displayName: getDisplayName(),
          language: peer.language,
          camOn: peer.camEnabled,
          micOn: peer.micEnabled
        });
      },

      handlePrimaryAction: function () {
        unlockRemoteMedia();
        if (peer.mode === 'private') api.createPrivateRoom();
        else api.findRandomMatch();
      },

      findRandomMatch: async function () {
        unlockRemoteMedia();
        peer.mode = 'random';
        await ensureLocalMedia(false);
        ensureSocketReady(function () {
          sendWs({
            type: 'match.find',
            displayName: getDisplayName(),
            language: peer.language,
            camOn: peer.camEnabled,
            micOn: peer.micEnabled
          });
        });
      },

      nextMatch: async function () {
        unlockRemoteMedia();
        teardownPeerConnection();
        peer.partner = null;
        peer.state = 'waiting';
        refreshControlsUI();
        await ensureLocalMedia(false);
        ensureSocketReady(function () {
          sendWs({
            type: 'match.next',
            displayName: getDisplayName(),
            language: peer.language,
            camOn: peer.camEnabled,
            micOn: peer.micEnabled
          });
        });
      },

      createPrivateRoom: async function () {
        unlockRemoteMedia();
        peer.mode = 'private';
        api.closeMobileDrawer();
        await ensureLocalMedia(false);
        ensureSocketReady(function () {
          sendWs({
            type: 'room.create',
            displayName: getDisplayName(),
            camOn: peer.camEnabled,
            micOn: peer.micEnabled
          });
        });
      },

      joinPrivateRoom: async function () {
        unlockRemoteMedia();
        var inp = el('lcRoomCodeInput');
        var code = String((inp && inp.value) || '').trim().toUpperCase();
        if (!code || code.length < 3) {
          toast('⚠️ Geli koodhka qolka (tusaale: CAR-7429)', true);
          return;
        }
        peer.mode = 'private';
        peer.roomCode = code;
        api.closeMobileDrawer();
        await ensureLocalMedia(false);
        ensureSocketReady(function () {
          sendWs({
            type: 'room.join',
            roomCode: code,
            displayName: getDisplayName(),
            camOn: peer.camEnabled,
            micOn: peer.micEnabled
          });
        });
      },

      copyRoomLink: function () {
        if (!peer.roomCode) return;
        var url = getRoomShareUrl(peer.roomCode);
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function () {
            toast('📋 Link-ga qolka waa la koobiyeeyay!', false);
          }).catch(function () {
            toast('Link: ' + url, false);
          });
        } else {
          toast('Link: ' + url, false);
        }
      },

      leaveCall: function () {
        var wasWaiting = peer.state === 'waiting' || peer.state === 'room_waiting';
        teardownPeerConnection();
        peer.state = 'idle';
        peer.roomId = '';
        peer.partner = null;
        sendWs({ type: wasWaiting ? 'match.cancel' : 'call.leave' });
        refreshControlsUI();
      },

      blockPartner: function () {
        if (peer.state !== 'matched') return;
        teardownPeerConnection();
        peer.state = 'idle';
        peer.partner = null;
        sendWs({ type: 'partner.block' });
        appendChat('system', '🚫 Qofkaas waa la xidhay — mar dambe kuguma soo noqon doono.');
        toast('🚫 Qofkaas waa la xidhay', false);
        refreshControlsUI();
      },

      toggleCamera: async function () {
        var wantOn = !peer.camEnabled;
        if (!wantOn) {
          peer.camEnabled = false;
          if (peer.localStream) {
            peer.localStream.getVideoTracks().forEach(function (t) {
              try { t.stop(); } catch (e) {}
              try { peer.localStream.removeTrack(t); } catch (e) {}
            });
          }
          if (peer.pc && peer.pc.getSenders) {
            peer.pc.getSenders().forEach(function (s) {
              if (s.track && s.track.kind === 'video') {
                try { s.replaceTrack(null); } catch (e) {}
              }
            });
          }
          sendWs({ type: 'media.state', camOn: false, micOn: peer.micEnabled });
          refreshControlsUI();
          toast('🙈 Kaamirada waa la xidhay (Cod Keliya)', false);
          return;
        }

        peer.camEnabled = true;
        await ensureLocalMedia(true);
        var liveVid = peer.localStream ? peer.localStream.getVideoTracks().find(function (t) { return t.readyState === 'live'; }) : null;
        if (liveVid) {
          if (peer.pc && peer.state === 'matched') {
            await renegotiateWithNewVideoTrack(liveVid);
          }
          sendWs({ type: 'media.state', camOn: true, micOn: peer.micEnabled });
          toast('📷 Kaamiradu way furantay!', false);
        }
        refreshControlsUI();
      },

      toggleMic: async function () {
        peer.micEnabled = !peer.micEnabled;
        if (peer.micEnabled) {
          await ensureLocalMedia(false);
        }
        if (peer.localStream) {
          peer.localStream.getAudioTracks().forEach(function (t) { t.enabled = peer.micEnabled; });
        }
        sendWs({ type: 'media.state', camOn: peer.camEnabled, micOn: peer.micEnabled });
        refreshControlsUI();
        toast(peer.micEnabled ? '🎙️ Makarafoonku waa shidan yahay' : '🔇 Makarafoonku waa xiran yahay', false);
      },

      toggleSpeaker: function () {
        peer.speakerEnabled = !peer.speakerEnabled;
        var ra = el('lcRemoteAudio');
        if (ra) {
          ra.muted = !peer.speakerEnabled;
          if (peer.speakerEnabled && ra.srcObject) {
            var ap = ra.play();
            if (ap && typeof ap.then === 'function') {
              ap.then(function () { setAudioBlockedUI(false); }).catch(function () {});
            }
          }
        }
        if (!peer.speakerEnabled) setAudioBlockedUI(false);
        refreshControlsUI();
      },

      flipCamera: async function () {
        if (!peer.camEnabled) {
          toast('📷 Marka hore fur kaamirada si aad u beddesho', false);
          return;
        }
        peer.facingMode = peer.facingMode === 'user' ? 'environment' : 'user';
        if (peer.localStream) {
          peer.localStream.getVideoTracks().forEach(function (t) {
            try { t.stop(); } catch (e) {}
            try { peer.localStream.removeTrack(t); } catch (e) {}
          });
        }
        await ensureLocalMedia(true);
        var liveVid = peer.localStream ? peer.localStream.getVideoTracks().find(function (t) { return t.readyState === 'live'; }) : null;
        if (liveVid && peer.pc && peer.state === 'matched') {
          await renegotiateWithNewVideoTrack(liveVid);
        }
        var lv = el('lcLocalVideo');
        if (lv) {
          if (peer.facingMode === 'user') lv.classList.add('mirrored');
          else lv.classList.remove('mirrored');
        }
      },

      clearTranscript: function () {
        var list = el('lcTranscriptList');
        if (list) list.innerHTML = '';
      },

      sendQuickText: function () {
        var inp = el('lcQuickTextInput');
        var txt = String((inp && inp.value) || '').trim();
        if (!txt) return;
        inp.value = '';
        if (peer.state !== 'matched') {
          toast('🔍 Marka hore guji "Raadi Qof" si aad qof ula sheekaysato', false);
          return;
        }
        sendWs({ type: 'chat.send', text: txt });
      }
    };

    window.cardosoLiveCall = api;
  })();
  `;
}

/**
 * Full-screen standalone page rendered at `/live-call` (responsive for Android & Desktop).
 */
export function renderStandaloneLiveCallHTML(options?: {
  botName?: string;
  tenantId?: string;
  tenantToken?: string;
}): string {
  const botName = options?.botName || 'CARDOSO AI';
  const safeTenantId = JSON.stringify(options?.tenantId || '');
  const safeTenantToken = JSON.stringify(options?.tenantToken || '');

  return `<!DOCTYPE html>
<html lang="so">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover" />
  <title>${escapeAttr(botName)} — CARDOSO Live Video Call</title>
  ${PWA_HEAD_TAGS}
  <style>
    :root {
      --bg: #070b14;
      --border: rgba(148, 163, 184, 0.16);
      --primary: #06b6d4;
      --text: #f8fafc;
      --muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif; }
    html, body {
      height: 100%;
      height: 100dvh;
      background:
        radial-gradient(ellipse 80% 50% at 50% -15%, rgba(16, 185, 129, 0.16), transparent),
        var(--bg);
      color: var(--text);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .standalone-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.65rem;
      padding: 0.5rem 0.85rem;
      background: rgba(7, 11, 20, 0.94);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .standalone-brand { display: flex; align-items: center; gap: 0.55rem; font-weight: 800; font-size: 0.92rem; }
    .standalone-brand img { width: 28px; height: 28px; border-radius: 8px; }
    .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 0.35rem;
      border: none; border-radius: 10px; padding: 0.45rem 0.8rem;
      font-size: 0.78rem; font-weight: 700; cursor: pointer; text-decoration: none;
    }
    .btn-primary { background: linear-gradient(135deg, #06b6d4, #2563eb); color: #fff; }
    .btn-ghost { background: rgba(148, 163, 184, 0.14); color: #e2e8f0; border: 1px solid var(--border); }
    .btn-sm { padding: 0.38rem 0.7rem; font-size: 0.76rem; }
    .toast-banner {
      position: fixed; top: 0.8rem; right: 0.8rem; z-index: 250;
      padding: 0.68rem 0.95rem; border-radius: 12px;
      background: #0f172a; border: 1px solid var(--primary);
      color: #fff; font-weight: 600; font-size: 0.8rem; display: none; max-width: 310px;
    }
    .toast-banner.show { display: block; }
    ${renderLiveCallPanelCSS()}
  </style>
</head>
<body>
  <header class="standalone-bar">
    <div class="standalone-brand">
      <img src="/pwa/icon-192.png" alt="CARDOSO AI" />
      <span>${escapeAttr(botName)} · 📹 Live</span>
    </div>
    <div style="display:flex;gap:0.4rem;">
      <a href="/app" class="btn btn-ghost btn-sm">← App</a>
    </div>
  </header>

  ${renderLiveCallPanelHTML()}

  <div id="toastBanner" class="toast-banner"></div>

  <script>
    ${COMMON_CLIENT_JS}
    const INITIAL_TENANT_ID = ${safeTenantId};
    const INITIAL_TENANT_TOKEN = ${safeTenantToken};
    ${renderLiveCallClientJS()}
    window.addEventListener('load', function () {
      if (window.cardosoLiveCall) window.cardosoLiveCall.onTabActivated();
    });
  </script>
</body>
</html>`;
}
