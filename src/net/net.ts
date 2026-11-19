// The browser's side of online play: one WebSocket to server/server.mjs, which relays messages
// between the host (whose browser runs the rules) and the guests. It reconnects on its own, and
// a key kept in localStorage lets a player who drops come back to the same seat.
import type { Loose } from '../game/types';

/** Who this browser is in an online game. */
type Role = 'off' | 'host' | 'guest';

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
let reconnect: ReturnType<typeof setTimeout> | null = null; // the next try after a drop, cancelled on leave
let heard = 0; // when the server was last heard from (any message, the beat included)
/** Silence this long means a dead link (a phone that changed network keeps a socket "open" for
 * minutes): the server sends a beat every 20 s (server/server.mjs BEAT_MS), so 50 s is two missed. */
const SILENT_MS = 50 * 1000;
let since = 0; // when this browser started trying to reach the server and has not got through yet (0: through, or not trying)
/** When the first try to reach the room server began, while it has not got through yet; else 0. */
export const connectingSince = (): number => since;

function storage(): Storage | null {
  try { return localStorage; } catch { return null; }
}

/** A key that stays the same in this browser, so a reconnect gets the same seat back. */
function playerKey(): string {
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

/** The room server's own address when it is not the page's (vite.config.ts ROOM_SERVER), else ''. */
const ROOM_SERVER: string = __ROOM_SERVER__;
/** The server's address: the room server's, else the page's own host, on /ws. */
function url(): string {
  if (ROOM_SERVER) return ROOM_SERVER.replace(/^http/, 'ws') + '/ws';
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}
/** Wakes the room server as the page opens, when it lives elsewhere and sleeps (a free Render
 * service takes up to a minute): by the time someone opens a room it is usually up. */
export function wakeServer(): void {
  if (ROOM_SERVER && location.protocol.startsWith('http')) fetch(ROOM_SERVER + '/health', { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
}

function open(): void {
  if (!since && role !== 'off') since = performance.now();
  reconnect = null;
  const sock = new WebSocket(url());
  ws = sock;
  sock.onopen = () => { heard = performance.now(); retry = 0; since = 0; handlers?.onLink(true); if (wanted) sock.send(JSON.stringify(wanted)); };
  sock.onclose = () => {
    if (ws !== sock) return; // an old socket closing after a leave and a new room: not this link
    handlers?.onLink(false);
    if (role === 'off') return;
    retry = Math.min(retry + 1, 6);
    reconnect = setTimeout(open, 500 * retry); // back off a little, up to 3 s
  };
  sock.onmessage = ev => {
    if (ws !== sock) return;
    heard = performance.now();
    let m: Loose;
    try { m = JSON.parse(String(ev.data)); } catch { return; }
    const h = handlers;
    if (!h) return;
    if (m.t === 'beat') return;
    if (m.t === 'created' && wanted) delete wanted.fresh; // a reconnect after this gets this room back, not yet another
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

// A dead link that still looks open is closed here, and onclose reconnects as after any drop.
// A dead socket's close can take minutes to finish, so it is let go of at once and a new one opened.
setInterval(() => {
  if (role === 'off' || !ws || ws.readyState !== 1 || performance.now() - heard <= SILENT_MS) return;
  const dead = ws;
  ws = null; // its onclose, whenever it comes, is no longer this link's
  dead.close();
  handlers?.onLink(false);
  if (!reconnect) open();
}, 5 * 1000);

/** Makes a room; this browser becomes its host. `game` keeps each game's rooms apart: the server gives
 * a host coming back with the same key its old room, so Cờ Tỷ Phú ('') and Cá Ngựa ('ludo') use keys
 * of their own, and a host never gets back the other game's room. `fresh` ("Tạo phòng mới"): the old
 * room with this key, if the server still has it, is closed and a new one made; without it (going
 * back into the last room) the old room comes back. */
export function createRoom(name: string, h: NetHandlers, game = '', fresh = false): void {
  storage()?.setItem('tpdv-name', name);
  role = 'host'; handlers = h; wanted = { t: 'create', name, key: playerKey() + (game ? ':' + game : ''), ...(fresh ? { fresh: true } : {}) };
  open();
}

/** Joins the room with this code as a guest (`game` as for createRoom: the seat comes back by the same key). */
export function joinRoom(code: string, name: string, h: NetHandlers, game = ''): void {
  storage()?.setItem('tpdv-name', name);
  role = 'guest'; handlers = h; wanted = { t: 'join', code: code.trim().toUpperCase(), name, key: playerKey() + (game ? ':' + game : '') };
  open();
}

/** Leaves the room and closes the connection. */
export function leave(): void {
  role = 'off'; wanted = null; handlers = null; since = 0;
  if (reconnect) { clearTimeout(reconnect); reconnect = null; }
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
