import zlib from 'zlib';

export interface PwaManifestOptions {
  name?: string;
  shortName?: string;
  startUrl?: string;
}

/**
 * Builds a standards-compliant Web App Manifest for Android, iOS, Windows & macOS PWA installation.
 */
export function buildWebManifest(options?: PwaManifestOptions) {
  return {
    id: '/app',
    name: options?.name || 'CARDOSO AI — Smart Assistant App',
    short_name: options?.shortName || 'CARDOSO AI',
    description:
      'Kaaliyahaaga casriga ah ee CARDOSO AI — Sheeko AI (Af-Soomaali & Ingiriisi), Cod (Voice), Sawirro, Waqtiga Salaadda & Maamulka Bot-ka.',
    start_url: options?.startUrl || '/app',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    orientation: 'portrait-primary',
    background_color: '#070b14',
    theme_color: '#06b6d4',
    lang: 'so',
    dir: 'ltr',
    categories: ['productivity', 'education', 'utilities'],
    icons: [
      {
        src: '/pwa/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/pwa/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/pwa/icon-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/pwa/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
    shortcuts: [
      {
        name: 'Sheeko AI (Chat)',
        short_name: 'Chat AI',
        description: 'Toos ula sheekeyso CARDOSO AI',
        url: '/app',
        icons: [{ src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Status Views & .vcf Hub',
        short_name: 'Views Hub',
        description: 'Hel 200+ Status Views adigoon ban la kulmin (.vcf)',
        url: '/views',
        icons: [{ src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Client Portal',
        short_name: 'Portal',
        description: 'Maamul dashboard-ka macmiilka',
        url: '/portal',
        icons: [{ src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Admin Studio',
        short_name: 'Admin',
        description: 'Maamulka Guud ee Mulkiilaha',
        url: '/admin-login',
        icons: [{ src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
  };
}

/**
 * Branded vector SVG app icon.
 */
export function getAppIconSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0b1329"/>
      <stop offset="55%" stop-color="#0f2544"/>
      <stop offset="100%" stop-color="#07101f"/>
    </linearGradient>
    <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#22d3ee"/>
      <stop offset="50%" stop-color="#06b6d4"/>
      <stop offset="100%" stop-color="#6366f1"/>
    </linearGradient>
    <linearGradient id="sparkGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#34d399"/>
      <stop offset="100%" stop-color="#22d3ee"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bgGrad)"/>
  <circle cx="256" cy="256" r="184" fill="none" stroke="url(#ringGrad)" stroke-width="18" opacity="0.28"/>
  <path d="M 340 168 A 126 126 0 1 0 340 344" fill="none" stroke="url(#ringGrad)" stroke-width="46" stroke-linecap="round"/>
  <circle cx="352" cy="176" r="24" fill="url(#sparkGrad)"/>
  <circle cx="352" cy="336" r="18" fill="#6366f1"/>
  <path d="M256 206 L270 242 L306 256 L270 270 L256 306 L242 270 L206 256 L242 242 Z" fill="#f8fafc"/>
</svg>`;
}

// ─── Pure-Node PNG Encoder (Zero External Dependencies) ───────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function blendPixel(
  rgba: Uint8Array,
  idx: number,
  sr: number,
  sg: number,
  sb: number,
  sa: number
): void {
  if (sa <= 0) return;
  if (sa >= 1) {
    rgba[idx] = clampByte(sr);
    rgba[idx + 1] = clampByte(sg);
    rgba[idx + 2] = clampByte(sb);
    rgba[idx + 3] = 255;
    return;
  }
  const dr = rgba[idx];
  const dg = rgba[idx + 1];
  const db = rgba[idx + 2];
  const da = rgba[idx + 3] / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return;
  rgba[idx] = clampByte((sr * sa + dr * da * (1 - sa)) / outA);
  rgba[idx + 1] = clampByte((sg * sa + dg * da * (1 - sa)) / outA);
  rgba[idx + 2] = clampByte((sb * sa + db * da * (1 - sa)) / outA);
  rgba[idx + 3] = clampByte(outA * 255);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

const iconCache = new Map<string, Buffer>();

/**
 * Generates and caches a crisp, anti-aliased RGBA PNG app icon of the requested size.
 */
export function getAppIconPng(size: number = 192, maskable: boolean = false): Buffer {
  const safeSize = Math.max(64, Math.min(512, Math.floor(size)));
  const cacheKey = `${safeSize}_${maskable ? 'm' : 'a'}`;
  const cached = iconCache.get(cacheKey);
  if (cached) return cached;

  const rgba = new Uint8Array(safeSize * safeSize * 4);
  const cx = safeSize * 0.5;
  const cy = safeSize * 0.5;
  const scale = maskable ? 0.76 : 1.0;
  const invSize = 1 / safeSize;
  const aa = 1.5;

  // Rounded-square SDF corner radius (non-maskable uses rounded corners; maskable fills full square)
  const cornerR = maskable ? 0 : safeSize * 0.22;
  const halfBox = safeSize * 0.5 - cornerR;

  const ringOuterR = safeSize * 0.36 * scale;
  const ringStroke = safeSize * 0.032 * scale;
  const cRadius = safeSize * 0.245 * scale;
  const cHalfThick = safeSize * 0.048 * scale;
  const dotTopX = cx + safeSize * 0.195 * scale;
  const dotTopY = cy - safeSize * 0.155 * scale;
  const dotTopR = safeSize * 0.046 * scale;
  const dotBotX = cx + safeSize * 0.195 * scale;
  const dotBotY = cy + safeSize * 0.155 * scale;
  const dotBotR = safeSize * 0.036 * scale;
  const sparkR = safeSize * 0.095 * scale;

  for (let y = 0; y < safeSize; y++) {
    const ny = y * invSize;
    const dy = y + 0.5 - cy;
    for (let x = 0; x < safeSize; x++) {
      const nx = x * invSize;
      const dx = x + 0.5 - cx;
      const idx = (y * safeSize + x) * 4;

      // 1. Background rounded rect alpha
      let bgAlpha = 1;
      if (!maskable) {
        const qx = Math.abs(dx) - halfBox;
        const qy = Math.abs(dy) - halfBox;
        const sdf =
          Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
          Math.min(Math.max(qx, qy), 0) -
          cornerR;
        bgAlpha = 1 - smoothstep(-aa * 0.5, aa * 0.5, sdf);
      }
      if (bgAlpha <= 0) continue;

      // Deep futuristic navy gradient with subtle radial glow
      const diag = (nx + ny) * 0.5;
      const distCenter = Math.hypot(dx, dy);
      const glow = Math.max(0, 1 - distCenter / (safeSize * 0.65));
      const bgR = 8 + diag * 10 + glow * 10;
      const bgG = 14 + diag * 24 + glow * 34;
      const bgB = 30 + diag * 42 + glow * 54;
      blendPixel(rgba, idx, bgR, bgG, bgB, bgAlpha);

      // Gradient accent color (cyan -> indigo)
      const gradT = Math.max(0, Math.min(1, (nx * 0.65 + ny * 0.35)));
      const accR = 34 + (99 - 34) * gradT;
      const accG = 211 + (102 - 211) * gradT;
      const accB = 238 + (241 - 238) * gradT;

      // 2. Subtle outer glowing halo ring
      const outerRingDist = Math.abs(distCenter - ringOuterR) - ringStroke * 0.5;
      if (outerRingDist < aa) {
        const a = (1 - smoothstep(-aa * 0.5, aa * 0.5, outerRingDist)) * 0.32 * bgAlpha;
        blendPixel(rgba, idx, accR, accG, accB, a);
      }

      // 3. Bold stylized "C" arc (open on the right between -42deg and +42deg)
      const angle = Math.atan2(dy, dx); // -PI..PI
      const openHalfAngle = 0.72; // ~41 degrees
      let cDist: number;
      if (Math.abs(angle) >= openHalfAngle) {
        cDist = Math.abs(distCenter - cRadius) - cHalfThick;
      } else {
        // Rounded arc end-caps
        const capTopX = Math.cos(-openHalfAngle) * cRadius;
        const capTopY = Math.sin(-openHalfAngle) * cRadius;
        const capBotX = Math.cos(openHalfAngle) * cRadius;
        const capBotY = Math.sin(openHalfAngle) * cRadius;
        const dTop = Math.hypot(dx - capTopX, dy - capTopY) - cHalfThick;
        const dBot = Math.hypot(dx - capBotX, dy - capBotY) - cHalfThick;
        cDist = Math.min(dTop, dBot);
      }
      if (cDist < aa) {
        const a = (1 - smoothstep(-aa * 0.5, aa * 0.5, cDist)) * bgAlpha;
        blendPixel(rgba, idx, accR, accG, accB, a);
      }

      // 4. Emerald-cyan top AI node dot
      const dDot1 = Math.hypot(x + 0.5 - dotTopX, y + 0.5 - dotTopY) - dotTopR;
      if (dDot1 < aa) {
        const a = (1 - smoothstep(-aa * 0.5, aa * 0.5, dDot1)) * bgAlpha;
        blendPixel(rgba, idx, 52, 211, 153, a);
      }

      // 5. Violet-indigo bottom node dot
      const dDot2 = Math.hypot(x + 0.5 - dotBotX, y + 0.5 - dotBotY) - dotBotR;
      if (dDot2 < aa) {
        const a = (1 - smoothstep(-aa * 0.5, aa * 0.5, dDot2)) * bgAlpha;
        blendPixel(rgba, idx, 129, 140, 248, a);
      }

      // 6. Center crisp white 4-point AI star spark (astroid curve: |x|^0.6 + |y|^0.6 <= R^0.6)
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      if (adx < sparkR + aa && ady < sparkR + aa) {
        const norm = Math.pow(adx / sparkR, 0.58) + Math.pow(ady / sparkR, 0.58);
        const starDist = (norm - 1.0) * sparkR * 0.45;
        if (starDist < aa) {
          const a = (1 - smoothstep(-aa * 0.5, aa * 0.5, starDist)) * bgAlpha;
          blendPixel(rgba, idx, 248, 250, 252, a);
        }
      }
    }
  }

  // Pack PNG scanlines (filter type 0 per row)
  const stride = safeSize * 4;
  const raw = Buffer.alloc((stride + 1) * safeSize);
  for (let y = 0; y < safeSize; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // None filter
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), rowStart + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(safeSize, 0);
  ihdr.writeUInt32BE(safeSize, 4);
  ihdr[8] = 8; // Bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // Compression
  ihdr[11] = 0; // Filter
  ihdr[12] = 0; // Interlace

  const idat = zlib.deflateSync(raw, { level: 6 });
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const png = Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', idat),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);

  iconCache.set(cacheKey, png);
  return png;
}

/**
 * Service Worker JS enabling real PWA installation, shell caching, and graceful offline handling.
 */
export function getServiceWorkerJS(): string {
  return `const CACHE_NAME = 'cardoso-ai-pwa-v1';
const SHELL_ASSETS = [
  '/app',
  '/manifest.webmanifest',
  '/pwa/icon-192.png',
  '/pwa/icon-512.png',
  '/pwa/icon.svg',
  '/pwa/offline'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never cache dynamic API endpoints
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req).catch(() => new Response(
        JSON.stringify({ status: 'error', offline: true, message: 'Internet ma jiro — fadlan hubi khadkaaga.' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      ))
    );
    return;
  }

  // Cache-first for static PWA assets (icons & manifest)
  if (url.pathname.startsWith('/pwa/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        });
      })
    );
    return;
  }

  // Network-first for HTML navigations with offline fallback
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200 && url.pathname === '/app') {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match('/app')).then((c) => c || caches.match('/pwa/offline')))
    );
  }
});
`;
}

/**
 * Clean Somali offline fallback page served by the Service Worker when disconnected.
 */
export function renderOfflineHTML(): string {
  return `<!DOCTYPE html>
<html lang="so">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <meta name="theme-color" content="#06b6d4" />
  <title>CARDOSO AI — Offline</title>
  <style>
    body {
      margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
      background: #070b14; color: #f8fafc; font-family: system-ui, -apple-system, sans-serif;
      padding: 1.5rem; text-align: center;
    }
    .card {
      max-width: 420px; width: 100%; background: rgba(17,25,44,0.88);
      border: 1px solid rgba(148,163,184,0.2); border-radius: 20px; padding: 2rem 1.5rem;
    }
    .icon { font-size: 3rem; margin-bottom: 0.75rem; }
    h1 { font-size: 1.35rem; margin: 0 0 0.5rem; }
    p { color: #94a3b8; font-size: 0.92rem; line-height: 1.55; margin: 0 0 1.35rem; }
    button {
      background: linear-gradient(135deg, #06b6d4, #2563eb); color: #fff; border: none;
      border-radius: 12px; padding: 0.8rem 1.4rem; font-size: 0.95rem; font-weight: 700; cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">📡</div>
    <h1>Khadka Internet-ku Waa Go'an Yahay</h1>
    <p>CARDOSO AI wuxuu u baahan yahay internet si uu kuugu jawaabo. Marka khadku soo noqdo guji badhanka hoose.</p>
    <button onclick="location.reload()">🔄 Dib u Isku Day</button>
  </div>
</body>
</html>`;
}

/**
 * Reusable <head> tags injected into every CARDOSO AI web page for full PWA installability.
 */
export const PWA_HEAD_TAGS = `
  <link rel="manifest" href="/manifest.webmanifest" />
  <meta name="theme-color" content="#06b6d4" />
  <meta name="application-name" content="CARDOSO AI" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="CARDOSO AI" />
  <link rel="icon" type="image/svg+xml" href="/pwa/icon.svg" />
  <link rel="icon" type="image/png" sizes="192x192" href="/pwa/icon-192.png" />
  <link rel="apple-touch-icon" sizes="180x180" href="/pwa/apple-touch-icon.png" />
`;

/**
 * Client-side PWA Service Worker registration + native Install prompt handler (Android, Desktop & iOS Safari).
 */
export const PWA_INSTALL_CLIENT_JS = `
  (function initCardosoPwa() {
    if (typeof window === 'undefined') return;
    window.__cardosoDeferredInstallPrompt = null;

    const isStandalone = () =>
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;

    const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent || '');

    function refreshInstallButtons() {
      const btns = document.querySelectorAll('[data-pwa-install-btn]');
      const installedBadges = document.querySelectorAll('[data-pwa-installed-badge]');
      const banner = document.getElementById('pwaInstallBanner');

      if (isStandalone()) {
        btns.forEach(function(b) { b.style.display = 'none'; });
        installedBadges.forEach(function(b) { b.style.display = 'inline-flex'; });
        if (banner) banner.style.display = 'none';
        return;
      }

      installedBadges.forEach(function(b) { b.style.display = 'none'; });
      btns.forEach(function(b) { b.style.display = 'inline-flex'; });
      if (banner && !localStorage.getItem('cardoso_pwa_banner_dismissed')) {
        if (window.__cardosoDeferredInstallPrompt || isIos()) {
          banner.style.display = 'flex';
        }
      }
    }

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function() {
        navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function() {});
        refreshInstallButtons();
      });
    } else {
      window.addEventListener('load', refreshInstallButtons);
    }

    window.addEventListener('beforeinstallprompt', function(e) {
      e.preventDefault();
      window.__cardosoDeferredInstallPrompt = e;
      refreshInstallButtons();
    });

    window.addEventListener('appinstalled', function() {
      window.__cardosoDeferredInstallPrompt = null;
      refreshInstallButtons();
      if (typeof showToast === 'function') {
        showToast('✅ CARDOSO AI App si guul leh ayaa loo install gareeyay!');
      }
    });

    window.triggerCardosoInstall = async function() {
      if (isStandalone()) {
        if (typeof showToast === 'function') showToast('✅ Horay ayaad ugu jirtaa CARDOSO AI App!');
        return;
      }
      const deferred = window.__cardosoDeferredInstallPrompt;
      if (deferred && typeof deferred.prompt === 'function') {
        deferred.prompt();
        try {
          const choice = await deferred.userChoice;
          if (choice && choice.outcome === 'accepted') {
            window.__cardosoDeferredInstallPrompt = null;
            refreshInstallButtons();
          }
        } catch {}
        return;
      }

      // Open custom install help modal if present, otherwise toast helpful Somali steps
      const modal = document.getElementById('pwaInstallHelpModal');
      if (modal) {
        modal.classList.add('open');
        return;
      }

      const msg = isIos()
        ? '📲 iPhone/iPad: Guji badhanka Share (⬆️) ee Safari kadibna dooro "Add to Home Screen" ➕'
        : '📲 Guji saddexda dhibcood (⋮) ee Chrome/Edge kadibna dooro "Install app" ama "Add to Home screen"';
      if (typeof showToast === 'function') {
        showToast(msg);
      } else {
        alert(msg);
      }
    };

    window.dismissCardosoInstallBanner = function() {
      try { localStorage.setItem('cardoso_pwa_banner_dismissed', '1'); } catch {}
      const banner = document.getElementById('pwaInstallBanner');
      if (banner) banner.style.display = 'none';
    };
  })();
`;
