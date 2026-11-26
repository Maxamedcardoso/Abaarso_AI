/**
 * CARDOSO Live — Peer-to-Peer WebRTC Video & Voice Call Types
 */

export interface IceServerEntry {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export type PeerMatchLanguage = 'all' | 'so' | 'en';

export interface LivePeerStats {
  onlineCount: number;
  waitingCount: number;
  activeCalls: number;
}
