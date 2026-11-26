import { IceServerEntry } from './live-call.types.js';

export interface LiveCallConfig {
  enabled: boolean;
  webrtc: {
    stunUrls: string[];
    turnUrl: string;
    turnUsername: string;
    turnCredential: string;
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
  const source = raw?.trim() || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302';
  return source
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
}

/**
 * Loads strongly typed WebRTC Live Video Call configuration from environment variables.
 * Uses free Google STUN servers by default ($0 cost, works on Render Free Tier).
 */
export function getLiveCallConfig(env: NodeJS.ProcessEnv = process.env): LiveCallConfig {
  return {
    enabled: parseBool(env.LIVE_CALL_ENABLED, true),
    webrtc: {
      stunUrls: parseStunUrls(env.LIVE_CALL_STUN_URLS),
      turnUrl: (env.LIVE_CALL_TURN_URL || '').trim(),
      turnUsername: (env.LIVE_CALL_TURN_USERNAME || '').trim(),
      turnCredential: (env.LIVE_CALL_TURN_CREDENTIAL || '').trim(),
    },
  };
}

/**
 * Builds standard RTCIceServer[] payload for WebRTC browser clients.
 */
export function buildIceServers(cfg: LiveCallConfig): IceServerEntry[] {
  const servers: IceServerEntry[] = [];
  if (cfg.webrtc.stunUrls.length > 0) {
    servers.push({ urls: cfg.webrtc.stunUrls });
  }
  if (cfg.webrtc.turnUrl) {
    const turn: IceServerEntry = { urls: cfg.webrtc.turnUrl };
    if (cfg.webrtc.turnUsername) turn.username = cfg.webrtc.turnUsername;
    if (cfg.webrtc.turnCredential) turn.credential = cfg.webrtc.turnCredential;
    servers.push(turn);
  }
  return servers;
}
