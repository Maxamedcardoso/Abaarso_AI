import { IceServerEntry } from './live-call.types.js';

export interface LiveCallConfig {
  enabled: boolean;
  webrtc: {
    stunUrls: string[];
    turnUrl: string;
    turnUsername: string;
    turnCredential: string;
    meteredDomain: string;
    meteredApiKey: string;
  };
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === '') return fallback;
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return true;
  if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false;
  return fallback;
}

function parseStunUrls(raw: string | undefined): string[] {
  const source =
    raw?.trim() ||
    'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302,stun:stun.cloudflare.com:3478';
  return source
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
}

/**
 * Loads strongly typed WebRTC Live Video Call configuration from environment variables.
 * Uses free multi-provider STUN servers by default, plus optional static TURN or
 * Metered.ca Free Tier TURN (50 GB/mo free) for 4G/5G symmetric NAT traversal.
 */
export function getLiveCallConfig(env: NodeJS.ProcessEnv = process.env): LiveCallConfig {
  const rawMeteredDomain = (env.LIVE_CALL_METERED_DOMAIN || '').trim();
  const rawMeteredKey = (env.LIVE_CALL_METERED_API_KEY || '').trim();
  let meteredDomain = rawMeteredDomain
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .trim();
  let meteredApiKey = rawMeteredKey
    .replace(/^["']|["']$/g, '')
    .replace(/^https?:\/\/[^?]+\?(?:apiKey|secretKey)=/i, '')
    .replace(/^(?:apiKey|secretKey)=/i, '')
    .trim();
  // Foolproof: if user pasted the entire Metered credentials URL into LIVE_CALL_METERED_DOMAIN
  if (!meteredApiKey && /[?&](?:apiKey|secretKey)=([^&]+)/i.test(rawMeteredDomain)) {
    const m = rawMeteredDomain.match(/[?&](?:apiKey|secretKey)=([^&]+)/i);
    if (m && m[1]) meteredApiKey = decodeURIComponent(m[1]).trim();
  }
  return {
    enabled: parseBool(env.LIVE_CALL_ENABLED, true),
    webrtc: {
      stunUrls: parseStunUrls(env.LIVE_CALL_STUN_URLS),
      turnUrl: (env.LIVE_CALL_TURN_URL || '').trim(),
      turnUsername: (env.LIVE_CALL_TURN_USERNAME || '').trim(),
      turnCredential: (env.LIVE_CALL_TURN_CREDENTIAL || '').trim(),
      meteredDomain,
      meteredApiKey,
    },
  };
}

/**
 * Builds standard RTCIceServer[] payload for WebRTC browser clients.
 * Supports comma-separated TURN URLs (e.g. UDP + TCP + TLS on port 443).
 */
export function buildIceServers(cfg: LiveCallConfig): IceServerEntry[] {
  const servers: IceServerEntry[] = [];
  if (cfg.webrtc.stunUrls.length > 0) {
    servers.push({ urls: cfg.webrtc.stunUrls });
  }
  if (cfg.webrtc.turnUrl) {
    const turnUrls = cfg.webrtc.turnUrl
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);
    if (turnUrls.length > 0) {
      const turn: IceServerEntry = { urls: turnUrls.length === 1 ? turnUrls[0] : turnUrls };
      if (cfg.webrtc.turnUsername) turn.username = cfg.webrtc.turnUsername;
      if (cfg.webrtc.turnCredential) turn.credential = cfg.webrtc.turnCredential;
      servers.push(turn);
    }
  }
  return servers;
}

let cachedMeteredTurn: { expiresAt: number; servers: IceServerEntry[] } | null = null;
let lastMeteredStatus = 'not_configured';

export function hasTurnServer(servers: IceServerEntry[]): boolean {
  return servers.some((s) => {
    const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
    return urls.some((u) => /^turns?:/i.test(String(u || '').trim()));
  });
}

export function getTurnDiagnostics(cfg: LiveCallConfig, resolved: IceServerEntry[]) {
  return {
    turnReady: hasTurnServer(resolved),
    meteredConfigured: Boolean(cfg.webrtc.meteredDomain && cfg.webrtc.meteredApiKey),
    meteredDomain: cfg.webrtc.meteredDomain || '',
    staticTurnConfigured: Boolean(cfg.webrtc.turnUrl),
    status: hasTurnServer(resolved)
      ? 'active'
      : cfg.webrtc.meteredDomain && cfg.webrtc.meteredApiKey
        ? lastMeteredStatus
        : 'not_configured',
  };
}

async function fetchMeteredIceByApiKey(
  domain: string,
  apiKey: string
): Promise<{ servers: IceServerEntry[]; status: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6500);
  try {
    const url = `https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const list = (await res.json()) as unknown;
      if (Array.isArray(list) && list.length > 0) {
        const clean = list.filter((e: any) => e && e.urls) as IceServerEntry[];
        if (clean.length > 0) {
          return { servers: clean, status: `ok_${clean.length}_servers` };
        }
      }
      return { servers: [], status: 'empty_response' };
    }
    return { servers: [], status: `http_${res.status}` };
  } catch (err: any) {
    clearTimeout(timer);
    return { servers: [], status: `err_${err?.name || 'failed'}` };
  }
}

/**
 * Resolves live ICE servers, supporting BOTH Metered.ca TURN API Key (`GET /credentials?apiKey=...`)
 * AND Metered.ca App Secret Key (`POST /credential?secretKey=...`, auto-creating 24h credentials!).
 */
export async function resolveDynamicIceServers(cfg: LiveCallConfig): Promise<IceServerEntry[]> {
  const base = buildIceServers(cfg);
  if (!cfg.webrtc.meteredDomain || !cfg.webrtc.meteredApiKey) {
    return base;
  }
  const now = Date.now();
  if (cachedMeteredTurn && cachedMeteredTurn.expiresAt > now) {
    return [...base, ...cachedMeteredTurn.servers];
  }

  const domain = cfg.webrtc.meteredDomain;
  const key = cfg.webrtc.meteredApiKey;

  // 1. Try direct Metered TURN API Key (`GET /api/v1/turn/credentials?apiKey=...`)
  const direct = await fetchMeteredIceByApiKey(domain, key);
  if (direct.servers.length > 0) {
    cachedMeteredTurn = { expiresAt: now + 10 * 60 * 1000, servers: direct.servers };
    lastMeteredStatus = `apikey_${direct.status}`;
    return [...base, ...direct.servers];
  }

  // 2. Fallback: Metered Secret Key (`POST /api/v1/turn/credential?secretKey=...`)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6500);
  try {
    const postUrl = `https://${domain}/api/v1/turn/credential?secretKey=${encodeURIComponent(key)}`;
    const res = await fetch(postUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiryInSeconds: 86400, label: 'cardoso-live' }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = (await res.json()) as any;
      if (data?.apiKey && typeof data.apiKey === 'string') {
        const fetched = await fetchMeteredIceByApiKey(domain, data.apiKey);
        if (fetched.servers.length > 0) {
          cachedMeteredTurn = { expiresAt: now + 6 * 60 * 60 * 1000, servers: fetched.servers };
          lastMeteredStatus = `secret_ok_${fetched.servers.length}_servers`;
          return [...base, ...fetched.servers];
        }
      }
      if (data?.username && (data?.password || data?.credential)) {
        const fallbackTurn: IceServerEntry[] = [
          {
            urls: [
              'turn:global.relay.metered.ca:80',
              'turn:global.relay.metered.ca:80?transport=tcp',
              'turn:global.relay.metered.ca:443',
              'turns:global.relay.metered.ca:443?transport=tcp',
            ],
            username: String(data.username),
            credential: String(data.password || data.credential),
          },
        ];
        cachedMeteredTurn = { expiresAt: now + 6 * 60 * 60 * 1000, servers: fallbackTurn };
        lastMeteredStatus = 'secret_direct_turn_ok';
        return [...base, ...fallbackTurn];
      }
      lastMeteredStatus = `apikey_${direct.status}|secret_empty`;
    } else {
      lastMeteredStatus = `apikey_${direct.status}|secret_http_${res.status}`;
    }
  } catch (err: any) {
    clearTimeout(timer);
    lastMeteredStatus = `apikey_${direct.status}|secret_err_${err?.name || 'failed'}`;
  }

  return base;
}
