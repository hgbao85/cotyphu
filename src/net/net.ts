// The browser's side of online play: one WebSocket to server/server.mjs, which relays messages
// between the host (whose browser runs the rules) and the guests. It reconnects on its own, and
// a key kept in localStorage lets a player who drops come back to the same seat.
import type { Loose } from '../game/types';

/** Who this browser is in an online game. */
export type Role = 'off' | 'host' | 'guest';

export interface NetHandlers {
  /** The room exists: its code, and this browser's id in it (0 for the host). */
  onRoom(code: string, id: number): void;
  /** Host only: a guest joined, dropped or came back; left is true when they left the room for good. */
  onPeer(id: number, name: string, online: boolean, left?: boolean): void;
  /** Host only: a guest's message. */
  onFromPeer(from: number, data: Loose): void;
  /** Guest only: the host's message. */
  onFromHost(data: Loose): void;
  /** Guest only: the host dropped or came back. */
  onHost(online: boolean): void;
  /** Guest only: the host closed the room. */
  onClosed(): void;
  /** The connection is up or down. */
  onLink(up: boolean): void;
  onError(msg: string): void;
}

let ws: WebSocket | null = null;
let role: Role = 'off';
let wanted: Loose = null;           // the create or join message, sent again after a reconnect
let handlers: NetHandlers | null = null;
let retry = 0;

function storage(): Storage | null {
  try { return localStorage; } catch { return null; }
}

/** A key that stays the same in this browser, so a reconnect gets the same seat back. */
export function playerKey(): string {
  const s = storage();
  let k = s?.getItem('tpdv-key') || '';
  if (!k) {
    const a = new Uint32Array(4); crypto.getRandomValues(a);
    k = [...a].map(n => n.toString(36)).join('');
    s?.setItem('tpdv-key', k);
  }
  return k;
}

/** The name typed last time, to fill the box. */
export function savedName(): string {
  return storage()?.getItem('tpdv-name') || '';
}

export function getRole(): Role {
  return role;
}

/** The server's address: the page's own host, on /ws. */
function url(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

function open(): void {
  ws = new WebSocket(url());
  ws.onopen = () => { retry = 0; handlers?.onLink(true); if (wanted) ws?.send(JSON.stringify(wanted)); };
  ws.onclose = () => {
    handlers?.onLink(false);
    if (role === 'off') return;
    retry = Math.min(retry + 1, 6);
    setTimeout(open, 500 * retry); // back off a little, up to 3 s
  };
  ws.onmessage = ev => {
    let m: Loose;
    try { m = JSON.parse(String(ev.data)); } catch { return; }
    const h = handlers;
    if (!h) return;
    if (m.t === 'created' || m.t === 'joined') h.onRoom(m.code, m.id);
    else if (m.t === 'peer') h.onPeer(m.id, m.name, m.online, m.left);
    else if (m.t === 'fromPeer') h.onFromPeer(m.from, m.data);
    else if (m.t === 'fromHost') h.onFromHost(m.data);
    else if (m.t === 'host') h.onHost(m.online);
    else if (m.t === 'closed') { leave(); h.onClosed(); }
    else if (m.t === 'error') { h.onError(m.msg); if (!m.keep) leave(); }
    if (m.t === 'joined' && m.hostOnline === false) h.onHost(false);
  };
}

/** Makes a room; this browser becomes its host. */
export function createRoom(name: string, h: NetHandlers): void {
  storage()?.setItem('tpdv-name', name);
  role = 'host'; handlers = h; wanted = { t: 'create', name, key: playerKey() };
  open();
}

/** Joins the room with this code as a guest. */
export function joinRoom(code: string, name: string, h: NetHandlers): void {
  storage()?.setItem('tpdv-name', name);
  role = 'guest'; handlers = h; wanted = { t: 'join', code: code.trim().toUpperCase(), name, key: playerKey() };
  open();
}

/** Leaves the room and closes the connection. */
export function leave(): void {
  role = 'off'; wanted = null; handlers = null;
  ws?.close(); ws = null;
}

/** Guest: leaves the room for good, so the host frees the seat. */
export function quitRoom(): void {
  if (role === 'guest' && ws?.readyState === 1) ws.send(JSON.stringify({ t: 'leave' }));
  leave();
}

/** Host: closes the room; every guest is sent back to their own title screen. */
export function closeRoom(): void {
  if (role === 'host' && ws?.readyState === 1) ws.send(JSON.stringify({ t: 'close' }));
  leave();
}

/** Guest: a message for the host. */
export function toHost(data: Loose): void {
  if (ws?.readyState === 1) ws.send(JSON.stringify({ t: 'toHost', data }));
}

/** Host: a message for every guest. */
export function toAll(data: Loose): void {
  if (ws?.readyState === 1) ws.send(JSON.stringify({ t: 'toAll', data }));
}

/** Host: a message for one guest. */
export function toOne(to: number, data: Loose): void {
  if (ws?.readyState === 1) ws.send(JSON.stringify({ t: 'toOne', to, data }));
}
