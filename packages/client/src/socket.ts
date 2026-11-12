import { io } from 'socket.io-client';
import type { GameAction, GameState } from '@cotyphu/shared';

export const socket = io();

export type ServerState = GameState & { serverTime: number };
export type Ack = { ok: boolean; error?: string; code?: string; playerId?: string; token?: string };

export function emit(event: string, data: unknown = {}): Promise<Ack> {
  return new Promise((resolve) => {
    socket.timeout(8000).emit(event, data, (err: Error | null, res: Ack) => {
      resolve(err ? { ok: false, error: 'Mất kết nối tới server' } : res);
    });
  });
}

export const sendAction = (action: GameAction) => emit('action', action);

export interface Session {
  code: string;
  token: string;
  playerId: string;
}

const KEY = 'cotyphu.session';

export function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null): void {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* bỏ qua */
  }
}
