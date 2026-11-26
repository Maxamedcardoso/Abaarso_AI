import crypto from 'crypto';
import http from 'http';
import { URL } from 'url';
import { WebSocket, WebSocketServer } from 'ws';
import { buildIceServers, getLiveCallConfig, LiveCallConfig, resolveDynamicIceServers } from '../live-call.config.js';
import { IceServerEntry, LivePeerStats, PeerMatchLanguage } from '../live-call.types.js';

export type { LivePeerStats, PeerMatchLanguage };

export interface LivePeerWebSocketDeps {
  config?: LiveCallConfig;
  heartbeatIntervalMs?: number;
}

export interface LivePeerWebSocketHandle {
  wss: WebSocketServer;
  getStats: () => LivePeerStats;
  close: () => void;
}

interface PeerClient {
  id: string;
  ws: WebSocket;
  isAlive: boolean;
  displayName: string;
  language: PeerMatchLanguage;
  camOn: boolean;
  micOn: boolean;
  state: 'idle' | 'waiting' | 'room_waiting' | 'matched';
  roomId: string | null;
  roomCode: string | null;
  partnerId: string | null;
  lastPartnerId: string | null;
  blockedIds: Set<string>;
  joinedQueueAt: number;
}

interface ActivePeerRoom {
  roomId: string;
  mode: 'random' | 'private';
  roomCode?: string;
  peerA: string;
  peerB: string;
  createdAt: number;
}

function sanitizeDisplayName(raw: unknown): string {
  const clean = String(raw || '')
    .replace(/[\r\n\t<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32);
  return clean || 'Marti CARDOSO';
}

function sanitizePeerLang(raw: unknown): PeerMatchLanguage {
  const v = String(raw || 'all').trim().toLowerCase();
  if (v === 'so' || v === 'en') return v;
  return 'all';
}

function sanitizeRoomCode(raw: unknown): string {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 18);
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(6);
  let code = 'CAR-';
  for (let i = 0; i < 4; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

function buildPeerIceServers(cfg: LiveCallConfig): IceServerEntry[] {
  const base = buildIceServers(cfg);
  const existingUrls = new Set<string>();
  for (const entry of base) {
    if (Array.isArray(entry.urls)) {
      entry.urls.forEach((u) => existingUrls.add(u));
    } else if (typeof entry.urls === 'string') {
      existingUrls.add(entry.urls);
    }
  }
  const extraStuns = [
    'stun:stun.l.google.com:19302',
    'stun:stun1.l.google.com:19302',
    'stun:stun2.l.google.com:19302',
    'stun:stun.cloudflare.com:3478',
  ].filter((u) => !existingUrls.has(u));

  if (extraStuns.length > 0) {
    return [{ urls: extraStuns }, ...base];
  }
  return base;
}

function sendJson(ws: WebSocket, payload: Record<string, unknown>): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    // Ignore closing socket write errors
  }
}

/**
 * CARDOSO Live — Real-Time 2-Person Human Video & Voice Call Signaling Hub (`/ws/live-peer`).
 *
 * 100% Free ($0, zero GPU required, works on Render Free Tier):
 * - Omegle / OmeTV-style Random Matchmaking Queue (`match.find`, `match.next`, `match.cancel`)
 * - Private 2-Person Room Links (`room.create`, `room.join`)
 * - Full P2P WebRTC SDP Offer/Answer + Trickle ICE relay (including mid-call Camera On/Off renegotiation!)
 * - Camera-Off / Audio-Only state sync (`media.state` -> `partner.media`)
 * - Real-time In-Call Text Chat (`chat.send` -> `chat.message`) & Block/Skip safety
 * - Live Online / Waiting / Active Call presence broadcast + 20s heartbeat
 */
export function attachLivePeerWebSocket(
  httpServer: http.Server,
  deps: LivePeerWebSocketDeps = {}
): LivePeerWebSocketHandle {
  const cfg = deps.config || getLiveCallConfig();
  const heartbeatMs = Math.max(5000, deps.heartbeatIntervalMs ?? 20_000);
  const iceServers = buildPeerIceServers(cfg);

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 256 * 1024, // Signaling + text chat only (media flows directly P2P over WebRTC!)
  });

  const peers = new Map<string, PeerClient>();
  const wsToPeerId = new Map<WebSocket, string>();
  const waitingQueue: string[] = [];
  const privateWaitingRooms = new Map<string, string>(); // roomCode -> waiting peerId
  const activeRooms = new Map<string, ActivePeerRoom>(); // roomId -> room

  const getStats = (): LivePeerStats => ({
    onlineCount: peers.size,
    waitingCount: waitingQueue.length + privateWaitingRooms.size,
    activeCalls: activeRooms.size,
  });

  const broadcastPresence = () => {
    const stats = getStats();
    const payload = {
      type: 'presence',
      onlineCount: stats.onlineCount,
      waitingCount: stats.waitingCount,
      activeCalls: stats.activeCalls,
    };
    for (const p of peers.values()) {
      sendJson(p.ws, payload);
    }
  };

  const removeFromQueue = (peerId: string) => {
    const idx = waitingQueue.indexOf(peerId);
    if (idx >= 0) waitingQueue.splice(idx, 1);
  };

  const removeFromPrivateWaiting = (peer: PeerClient) => {
    if (peer.roomCode && privateWaitingRooms.get(peer.roomCode) === peer.id) {
      privateWaitingRooms.delete(peer.roomCode);
    }
  };

  const detachFromRoom = (peer: PeerClient, reason: 'left' | 'next' | 'blocked' | 'disconnected' = 'left') => {
    removeFromQueue(peer.id);
    removeFromPrivateWaiting(peer);

    if (peer.roomId) {
      const room = activeRooms.get(peer.roomId);
      activeRooms.delete(peer.roomId);
      if (room) {
        const partnerId = room.peerA === peer.id ? room.peerB : room.peerA;
        const partner = peers.get(partnerId);
        if (partner) {
          partner.lastPartnerId = peer.id;
          partner.partnerId = null;
          partner.roomId = null;
          partner.roomCode = null;
          partner.state = 'idle';
          sendJson(partner.ws, {
            type: 'partner.left',
            reason,
            roomId: room.roomId,
          });
        }
        peer.lastPartnerId = partnerId;
      }
    }

    peer.partnerId = null;
    peer.roomId = null;
    peer.roomCode = null;
    peer.state = 'idle';
  };

  const pairTwoPeers = (
    peerA: PeerClient,
    peerB: PeerClient,
    mode: 'random' | 'private',
    roomCode?: string
  ) => {
    removeFromQueue(peerA.id);
    removeFromQueue(peerB.id);
    removeFromPrivateWaiting(peerA);
    removeFromPrivateWaiting(peerB);

    const roomId = `${mode}_${crypto.randomBytes(5).toString('hex')}`;
    activeRooms.set(roomId, {
      roomId,
      mode,
      roomCode,
      peerA: peerA.id,
      peerB: peerB.id,
      createdAt: Date.now(),
    });

    peerA.state = 'matched';
    peerA.roomId = roomId;
    peerA.roomCode = roomCode || null;
    peerA.partnerId = peerB.id;

    peerB.state = 'matched';
    peerB.roomId = roomId;
    peerB.roomCode = roomCode || null;
    peerB.partnerId = peerA.id;

    // Peer A is WebRTC Offer initiator; Peer B receives Offer and creates Answer
    sendJson(peerA.ws, {
      type: 'match.found',
      roomId,
      mode,
      roomCode: roomCode || undefined,
      initiator: true,
      partner: {
        id: peerB.id,
        name: peerB.displayName,
        language: peerB.language,
        camOn: peerB.camOn,
        micOn: peerB.micOn,
      },
    });
    sendJson(peerB.ws, {
      type: 'match.found',
      roomId,
      mode,
      roomCode: roomCode || undefined,
      initiator: false,
      partner: {
        id: peerA.id,
        name: peerA.displayName,
        language: peerA.language,
        camOn: peerA.camOn,
        micOn: peerA.micOn,
      },
    });

    broadcastPresence();
  };

  const languagesCompatible = (a: PeerMatchLanguage, b: PeerMatchLanguage): boolean => {
    return a === 'all' || b === 'all' || a === b;
  };

  const tryMatchFromQueue = (seeker: PeerClient): boolean => {
    // Pass 1: Prefer a fresh partner (not the exact lastPartnerId)
    let fallbackCandidate: PeerClient | null = null;

    for (let i = 0; i < waitingQueue.length; i++) {
      const candId = waitingQueue[i];
      if (candId === seeker.id) continue;
      const cand = peers.get(candId);
      if (!cand || cand.state !== 'waiting' || cand.ws.readyState !== WebSocket.OPEN) {
        waitingQueue.splice(i, 1);
        i--;
        continue;
      }
      if (seeker.blockedIds.has(cand.id) || cand.blockedIds.has(seeker.id)) continue;
      if (!languagesCompatible(seeker.language, cand.language)) continue;

      if (seeker.lastPartnerId === cand.id) {
        if (!fallbackCandidate) fallbackCandidate = cand;
        continue;
      }

      pairTwoPeers(cand, seeker, 'random');
      return true;
    }

    // Pass 2: If only the previous partner is waiting and nobody else is in queue, match after brief check
    if (fallbackCandidate && waitingQueue.length === 1) {
      pairTwoPeers(fallbackCandidate, seeker, 'random');
      return true;
    }

    return false;
  };

  const enterRandomQueue = (peer: PeerClient, msg: any) => {
    if (msg?.displayName !== undefined) peer.displayName = sanitizeDisplayName(msg.displayName);
    if (msg?.language !== undefined) peer.language = sanitizePeerLang(msg.language);
    if (msg?.camOn !== undefined) peer.camOn = Boolean(msg.camOn);
    if (msg?.micOn !== undefined) peer.micOn = Boolean(msg.micOn);

    if (tryMatchFromQueue(peer)) {
      return;
    }

    removeFromQueue(peer.id);
    peer.state = 'waiting';
    peer.joinedQueueAt = Date.now();
    waitingQueue.push(peer.id);

    sendJson(peer.ws, {
      type: 'match.waiting',
      queuePosition: waitingQueue.length,
      stats: getStats(),
    });
    broadcastPresence();
  };

  const getPartner = (peer: PeerClient): PeerClient | null => {
    if (!peer.partnerId) return null;
    const p = peers.get(peer.partnerId);
    if (!p || p.partnerId !== peer.id || p.ws.readyState !== WebSocket.OPEN) return null;
    return p;
  };

  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    const parsed = new URL(req.url || '/ws/live-peer', 'http://localhost');
    const peerId = `peer_${crypto.randomBytes(5).toString('hex')}`;
    const peer: PeerClient = {
      id: peerId,
      ws,
      isAlive: true,
      displayName: sanitizeDisplayName(parsed.searchParams.get('name')),
      language: sanitizePeerLang(parsed.searchParams.get('lang')),
      camOn: parsed.searchParams.get('cam') !== '0',
      micOn: parsed.searchParams.get('mic') !== '0',
      state: 'idle',
      roomId: null,
      roomCode: null,
      partnerId: null,
      lastPartnerId: null,
      blockedIds: new Set<string>(),
      joinedQueueAt: 0,
    };

    peers.set(peerId, peer);
    wsToPeerId.set(ws, peerId);

    sendJson(ws, {
      type: 'welcome',
      peerId,
      iceServers,
      stats: getStats(),
    });
    if (cfg.webrtc.meteredDomain && cfg.webrtc.meteredApiKey) {
      void resolveDynamicIceServers(cfg).then((dynamicIce) => {
        if (dynamicIce.length > iceServers.length && ws.readyState === WebSocket.OPEN) {
          sendJson(ws, { type: 'ice.update', iceServers: dynamicIce });
        }
      });
    }
    broadcastPresence();

    ws.on('pong', () => {
      peer.isAlive = true;
    });

    ws.on('message', (data) => {
      peer.isAlive = true;
      let msg: any;
      try {
        msg = JSON.parse(data.toString('utf8'));
      } catch {
        sendJson(ws, { type: 'error', code: 'BAD_JSON', message: 'Invalid signaling frame.' });
        return;
      }
      if (!msg || typeof msg.type !== 'string') return;

      switch (msg.type) {
        case 'ping':
          sendJson(ws, { type: 'pong', clientTs: msg.clientTs, serverTs: Date.now() });
          break;

        case 'hello':
          if (msg.displayName !== undefined) peer.displayName = sanitizeDisplayName(msg.displayName);
          if (msg.language !== undefined) peer.language = sanitizePeerLang(msg.language);
          if (msg.camOn !== undefined) peer.camOn = Boolean(msg.camOn);
          if (msg.micOn !== undefined) peer.micOn = Boolean(msg.micOn);
          sendJson(ws, { type: 'welcome', peerId: peer.id, iceServers, stats: getStats() });
          break;

        case 'match.find':
          detachFromRoom(peer, 'left');
          enterRandomQueue(peer, msg);
          break;

        case 'match.next':
          detachFromRoom(peer, 'next');
          enterRandomQueue(peer, msg);
          break;

        case 'match.cancel':
          removeFromQueue(peer.id);
          removeFromPrivateWaiting(peer);
          if (peer.state === 'waiting' || peer.state === 'room_waiting') {
            peer.state = 'idle';
            peer.roomCode = null;
          }
          sendJson(ws, { type: 'match.cancelled', stats: getStats() });
          broadcastPresence();
          break;

        case 'room.create': {
          detachFromRoom(peer, 'left');
          if (msg.displayName !== undefined) peer.displayName = sanitizeDisplayName(msg.displayName);
          if (msg.camOn !== undefined) peer.camOn = Boolean(msg.camOn);
          if (msg.micOn !== undefined) peer.micOn = Boolean(msg.micOn);

          let code = sanitizeRoomCode(msg.roomCode);
          if (!code || code.length < 3) code = generateRoomCode();
          while (privateWaitingRooms.has(code)) {
            code = generateRoomCode();
          }

          peer.state = 'room_waiting';
          peer.roomCode = code;
          privateWaitingRooms.set(code, peer.id);

          sendJson(ws, {
            type: 'room.created',
            roomCode: code,
            stats: getStats(),
          });
          broadcastPresence();
          break;
        }

        case 'room.join': {
          const code = sanitizeRoomCode(msg.roomCode);
          if (!code || code.length < 3) {
            sendJson(ws, { type: 'error', code: 'INVALID_ROOM', message: 'Koodhka qolku ma saxna.' });
            break;
          }
          detachFromRoom(peer, 'left');
          if (msg.displayName !== undefined) peer.displayName = sanitizeDisplayName(msg.displayName);
          if (msg.camOn !== undefined) peer.camOn = Boolean(msg.camOn);
          if (msg.micOn !== undefined) peer.micOn = Boolean(msg.micOn);

          // Check if room is already full (2 people currently in an active private call with same code)
          let alreadyFull = false;
          for (const room of activeRooms.values()) {
            if (room.mode === 'private' && room.roomCode === code) {
              alreadyFull = true;
              break;
            }
          }
          if (alreadyFull) {
            sendJson(ws, { type: 'error', code: 'ROOM_FULL', message: 'Qolkan 2 qof baa hore ugu jirta.' });
            break;
          }

          const hostId = privateWaitingRooms.get(code);
          const host = hostId ? peers.get(hostId) : undefined;
          if (host && host.id !== peer.id && host.state === 'room_waiting' && host.ws.readyState === WebSocket.OPEN) {
            pairTwoPeers(host, peer, 'private', code);
          } else {
            // Host hasn't arrived yet — hold this room open cleanly so whoever arrives second matches immediately!
            peer.state = 'room_waiting';
            peer.roomCode = code;
            privateWaitingRooms.set(code, peer.id);
            sendJson(ws, {
              type: 'room.created',
              roomCode: code,
              stats: getStats(),
            });
            broadcastPresence();
          }
          break;
        }

        case 'rtc.offer': {
          const partner = getPartner(peer);
          if (partner && typeof msg.sdp === 'string') {
            sendJson(partner.ws, { type: 'rtc.offer', sdp: msg.sdp, from: peer.id });
          }
          break;
        }

        case 'rtc.answer': {
          const partner = getPartner(peer);
          if (partner && typeof msg.sdp === 'string') {
            sendJson(partner.ws, { type: 'rtc.answer', sdp: msg.sdp, from: peer.id });
          }
          break;
        }

        case 'rtc.ice': {
          const partner = getPartner(peer);
          if (partner && msg.candidate !== undefined) {
            sendJson(partner.ws, { type: 'rtc.ice', candidate: msg.candidate, from: peer.id });
          }
          break;
        }

        case 'media.state': {
          if (msg.camOn !== undefined) peer.camOn = Boolean(msg.camOn);
          if (msg.micOn !== undefined) peer.micOn = Boolean(msg.micOn);
          const partner = getPartner(peer);
          if (partner) {
            sendJson(partner.ws, {
              type: 'partner.media',
              camOn: peer.camOn,
              micOn: peer.micOn,
            });
          }
          break;
        }

        case 'chat.send': {
          const text = String(msg.text || '').trim().slice(0, 500);
          if (!text) break;
          const partner = getPartner(peer);
          if (!partner) {
            sendJson(ws, { type: 'error', code: 'NOT_MATCHED', message: 'Qof weli kuguma xidhna.' });
            break;
          }
          const ts = Date.now();
          sendJson(partner.ws, {
            type: 'chat.message',
            from: peer.id,
            senderName: peer.displayName,
            text,
            ts,
          });
          sendJson(ws, {
            type: 'chat.sent',
            text,
            ts,
          });
          break;
        }

        case 'partner.block': {
          if (peer.partnerId) {
            peer.blockedIds.add(peer.partnerId);
          }
          detachFromRoom(peer, 'blocked');
          sendJson(ws, { type: 'partner.blocked' });
          broadcastPresence();
          break;
        }

        case 'call.leave':
          detachFromRoom(peer, 'left');
          sendJson(ws, { type: 'call.left', stats: getStats() });
          broadcastPresence();
          break;

        default:
          sendJson(ws, { type: 'error', code: 'UNKNOWN_EVENT', message: 'Unsupported live-peer event.' });
      }
    });

    const cleanup = () => {
      const id = wsToPeerId.get(ws);
      wsToPeerId.delete(ws);
      if (id) {
        const existing = peers.get(id);
        if (existing) {
          detachFromRoom(existing, 'disconnected');
          peers.delete(id);
        }
        broadcastPresence();
      }
    };

    ws.on('close', cleanup);
    ws.on('error', cleanup);
  });

  // Intercept HTTP Upgrade ONLY for `/ws/live-peer`
  const onUpgrade = (req: http.IncomingMessage, socket: any, head: Buffer) => {
    try {
      const parsed = new URL(req.url || '/', 'http://localhost');
      if (parsed.pathname !== '/ws/live-peer') {
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } catch {
      try {
        socket.destroy();
      } catch {}
    }
  };

  httpServer.on('upgrade', onUpgrade);

  const heartbeatTimer = setInterval(() => {
    for (const peer of Array.from(peers.values())) {
      if (!peer.isAlive) {
        detachFromRoom(peer, 'disconnected');
        peers.delete(peer.id);
        wsToPeerId.delete(peer.ws);
        try {
          peer.ws.terminate();
        } catch {}
        continue;
      }
      peer.isAlive = false;
      try {
        peer.ws.ping();
      } catch {}
    }
  }, heartbeatMs);
  if (typeof heartbeatTimer.unref === 'function') {
    heartbeatTimer.unref();
  }

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeatTimer);
    httpServer.off('upgrade', onUpgrade);
    for (const peer of peers.values()) {
      try {
        peer.ws.terminate();
      } catch {}
    }
    peers.clear();
    wsToPeerId.clear();
    waitingQueue.length = 0;
    privateWaitingRooms.clear();
    activeRooms.clear();
    try {
      wss.close();
    } catch {}
  };

  httpServer.on('close', close);

  return {
    wss,
    getStats,
    close,
  };
}
