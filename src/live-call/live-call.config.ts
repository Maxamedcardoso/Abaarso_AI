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
  return {
    enabled: parseBool(env.LIVE_CALL_ENABLED, true),
    webrtc: {
      stunUrls: parseStunUrls(env.LIVE_CALL_STUN_URLS),
      turnUrl: (env.LIVE_CALL_TURN_URL || '').trim(),
      turnUsername: (env.LIVE_CALL_TURN_USERNAME || '').trim(),
      turnCredential: (env.LIVE_CALL_TURN_CREDENTIAL || '').trim(),
      meteredDomain: (env.LIVE_CALL_METERED_DOMAIN || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, ''),
      meteredApiKey: (env.LIVE_CALL_METERED_API_KEY || '').trim(),
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

/**
 * Resolves live ICE servers, optionally fetching dynamic free-tier TURN credentials
 * from Metered.ca (50 GB/mo free) when LIVE_CALL_METERED_DOMAIN + LIVE_CALL_METERED_API_KEY are set.
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const url = `https://${cfg.webrtc.meteredDomain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(cfg.webrtc.meteredApiKey)}`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const list = (await res.json()) as unknown;
      if (Array.isArray(list) && list.length > 0) {
        const clean = list.filter((e: any) => e && e.urls) as IceServerEntry[];
        if (clean.length > 0) {
          cachedMeteredTurn = { expiresAt: now + 10 * 60 * 1000, servers: clean };
          return [...base, ...clean];
        }
      }
    }
  } catch {
    clearTimeout(timer);
  }
  return base;
}
