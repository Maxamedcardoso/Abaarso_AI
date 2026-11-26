import { Request, Response, Router } from 'express';
import { SQLiteStudentMemory } from '../memory/sqlite-memory.js';
import {
  getLiveCallConfig,
  getTurnDiagnostics,
  LiveCallConfig,
  resolveDynamicIceServers,
} from './live-call.config.js';
import { LivePeerStats } from './live-call.types.js';
import { renderStandaloneLiveCallHTML } from './web/live-call-panel.js';

export interface LiveCallAppTarget {
  tenantId: string;
  memory: SQLiteStudentMemory;
  botFallbackName: string;
}

export interface LiveCallRouterDeps {
  resolveAppTarget: (tenantId?: unknown, token?: unknown) => Promise<LiveCallAppTarget>;
  getPeerStats?: () => LivePeerStats;
  config?: LiveCallConfig;
}

/**
 * Creates the clean Express Router for CARDOSO Live Peer-to-Peer Video & Voice Calls.
 * Exposes live online presence stats (`/api/live-call/peer/stats`) and the standalone
 * responsive `/live-call` page without affecting any existing CARDOSO AI route.
 */
export function createLiveCallRouter(deps: LiveCallRouterDeps): Router {
  const router = Router();
  const cfg = deps.config || getLiveCallConfig();

  // 1. Live Peer-to-Peer Human Video Call Presence Stats & WebRTC ICE Servers (including dynamic Metered TURN)
  router.get('/api/live-call/peer/stats', async (_req: Request, res: Response) => {
    const stats = deps.getPeerStats ? deps.getPeerStats() : { onlineCount: 0, waitingCount: 0, activeCalls: 0 };
    const resolvedIce = await resolveDynamicIceServers(cfg);
    res.json({
      status: 'ok',
      enabled: cfg.enabled,
      ...stats,
      wsPath: '/ws/live-peer',
      turn: getTurnDiagnostics(cfg, resolvedIce),
      iceServers: resolvedIce,
    });
  });

  // 2. Full-Screen Responsive Standalone Live Video Chat Page (`/live-call`)
  router.get('/live-call', async (req: Request, res: Response) => {
    const tenantId = typeof req.query.tenant === 'string' ? req.query.tenant.trim() : '';
    const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
    const target = await deps.resolveAppTarget(tenantId, token);
    let botName = target.botFallbackName;
    try {
      const custom = await target.memory.getBotConfig();
      if (custom?.botName?.trim()) botName = custom.botName.trim();
    } catch {}
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(
      renderStandaloneLiveCallHTML({
        botName,
        tenantId: target.tenantId === 'owner' ? '' : target.tenantId,
        tenantToken: target.tenantId === 'owner' ? '' : token,
      })
    );
  });

  return router;
}
