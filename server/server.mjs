// Sự Thảy online: serves the built game (dist/) and relays messages between the players
// of a room over WebSocket (/ws). The rules run in the host's browser; this server only knows who
// is in which room and passes messages along, so it stays small and holds no game state.
//
//   node server/server.mjs           PORT (default 8787), STATIC_DIR (default dist)
//
// Messages are JSON. From a browser:
//   { t: 'create', name, key, fresh? }     make a room, become its host (fresh: close this key's old room first)
//   { t: 'join', code, name, key }         join a room (the same key rejoins the same place)
//   { t: 'toHost', data }                  a guest's message for the host
//   { t: 'toAll', data }                   the host's message for every guest
//   { t: 'toOne', to, data }               the host's message for one guest
//   { t: 'leave' }                         a guest leaves the room for good (their seat is freed)
//   { t: 'close' }                         the host closes the room: every guest is sent home
// From the server:
//   { t: 'created', code, id }   { t: 'joined', code, id }   { t: 'error', msg }
//   { t: 'peer', id, name, online }        to the host: a guest came, went or came back
//   { t: 'fromPeer', from, data }          to the host
//   { t: 'fromHost', data }                to a guest
//   { t: 'host', online }                  to the guests: the host dropped or came back
//   { t: 'peer', id, name, online: false, left: true }   to the host: a guest left for good
//   { t: 'closed' }                        to the guests: the host closed the room
//   { t: 'beat' }                          to everyone, every BEAT_MS: the link is alive
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 8787;
const STATIC_DIR = resolve(process.env.STATIC_DIR || 'dist');
const ROOM_IDLE_MS = 30 * 60 * 1000;   // a room with nobody connected is closed after this long
const MAX_GUESTS = 3;                  // four seats: the host and three friends
const MAX_MESSAGE = 256 * 1024;        // a game state is a few kilobytes
const BEAT_MS = Number(process.env.BEAT_MS) || 20 * 1000; // how often each socket is pinged and sent a beat
const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';  // no I, L, O: easy to read out loud

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

// ---- Static files: the built game -------------------------------------------------------
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://x');
    if (url.pathname === '/health') { res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }); res.end('ok'); return; } // the page on Vercel wakes us with it
    let path = normalize(join(STATIC_DIR, decodeURIComponent(url.pathname)));
    if (path !== STATIC_DIR && !path.startsWith(STATIC_DIR + sep)) { res.writeHead(403); res.end(); return; } // inside dist/, not a sibling such as dist-single/
    const info = await stat(path).catch(() => null);
    if (!info || info.isDirectory()) path = join(STATIC_DIR, 'index.html');
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});

// ---- Rooms --------------------------------------------------------------------------------
/** code -> { code, host: { ws, key, name }, guests: Map<id, { ws, key, name }>, nextId, idleSince } */
const rooms = new Map();

/** A free room code, or null when none turned up (the server is nearly full of rooms). */
function newCode() {
  for (let tries = 0; tries < 200; tries++) {
    let c = '';
    for (let i = 0; i < 2; i++) c += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
    c += String(10 + Math.floor(Math.random() * 90));
    if (!rooms.has(c)) return c;
  }
  return null;
}
/** A socket that another one took the place of (the same key, from another tab): told why and closed.
 * The error makes the browser stop instead of reconnecting, so two tabs do not take the room in turn. */
function replaced(old, ws) {
  if (!old || old === ws || old.readyState !== 1) return;
  send(old, { t: 'error', msg: 'Phòng này đã được mở ở một tab hoặc máy khác.' });
  old.close();
}
const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, n);

function touch(room) {
  const anyone = (room.host.ws && room.host.ws.readyState === 1) || [...room.guests.values()].some(g => g.ws && g.ws.readyState === 1);
  room.idleSince = anyone ? 0 : (room.idleSince || Date.now());
}
setInterval(() => {
  for (const [code, room] of rooms) {
    touch(room);
    if (room.idleSince && Date.now() - room.idleSince > ROOM_IDLE_MS) rooms.delete(code);
    else if (room.hostGoneSince && Date.now() - room.hostGoneSince > ROOM_IDLE_MS) { // the host never came back: guests waiting on it are sent home
      for (const g of room.guests.values()) send(g.ws, { t: 'closed' });
      rooms.delete(code);
    }
  }
}, 60 * 1000).unref();

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MESSAGE });
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  // A bad frame (too big, broken UTF-8, a wrong opcode) makes ws emit 'error' and then close the
  // socket. With no listener that error would end the whole process and every room with it.
  ws.on('error', () => {});
  /** what this socket is: { room, role: 'host' | 'guest', id } */
  let me = null;

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'create' && !me) {
      const key = clean(msg.key, 64);
      // a host coming back with its key gets its room back
      const back = [...rooms.values()].find(r => r.host.key && r.host.key === key);
      if (back && msg.fresh) { // "Tạo phòng mới": the old room is closed for its guests, and a new one made
        replaced(back.host.ws, ws);
        for (const g of back.guests.values()) send(g.ws, { t: 'closed' });
        rooms.delete(back.code);
      } else if (back) {
        replaced(back.host.ws, ws);
        back.host.ws = ws; back.hostGoneSince = 0; me = { room: back, role: 'host', id: 0 };
        send(ws, { t: 'created', code: back.code, id: 0, back: true });
        for (const [id, g] of back.guests) send(ws, { t: 'peer', id, name: g.name, online: !!(g.ws && g.ws.readyState === 1) });
        for (const g of back.guests.values()) send(g.ws, { t: 'host', online: true });
        touch(back); return;
      }
      const code = newCode();
      if (!code) { send(ws, { t: 'error', msg: 'Máy chủ đang bận, thử lại sau nhé.' }); return; }
      const room = { code, host: { ws, key, name: clean(msg.name, 20) }, guests: new Map(), nextId: 1, idleSince: 0 };
      rooms.set(room.code, room);
      me = { room, role: 'host', id: 0 };
      send(ws, { t: 'created', code: room.code, id: 0 });
      return;
    }

    if (msg.t === 'join' && !me) {
      const room = rooms.get(clean(msg.code, 8).toUpperCase());
      if (!room) { send(ws, { t: 'error', msg: 'Không tìm thấy phòng này.' }); return; }
      const key = clean(msg.key, 64), name = clean(msg.name, 20) || 'Bạn';
      let id = [...room.guests].find(([, g]) => key && g.key === key)?.[0];
      if (id === undefined) {
        if (room.guests.size >= MAX_GUESTS) { // full: a seat whose guest is gone (a closed tab) goes to the newcomer
          const gone = [...room.guests].find(([, g]) => !g.ws || g.ws.readyState !== 1);
          if (!gone) { send(ws, { t: 'error', msg: 'Phòng đã đủ người.' }); return; }
          room.guests.delete(gone[0]);
          send(room.host.ws, { t: 'peer', id: gone[0], name: gone[1].name, online: false, left: true });
        }
        id = room.nextId++;
        room.guests.set(id, { ws, key, name });
      } else {
        const g = room.guests.get(id); replaced(g.ws, ws); g.ws = ws; g.name = name;
      }
      me = { room, role: 'guest', id };
      send(ws, { t: 'joined', code: room.code, id, hostOnline: !!(room.host.ws && room.host.ws.readyState === 1) });
      send(room.host.ws, { t: 'peer', id, name, online: true });
      touch(room); return;
    }

    if (!me) return;
    const room = me.room;
    // a socket another one took the place of says nothing more (it is being closed)
    if (me.role === 'host' ? room.host.ws !== ws : room.guests.get(me.id)?.ws !== ws) return;
    if (msg.t === 'toHost' && me.role === 'guest') send(room.host.ws, { t: 'fromPeer', from: me.id, data: msg.data });
    else if (msg.t === 'toAll' && me.role === 'host') {
      const text = JSON.stringify({ t: 'fromHost', data: msg.data });
      for (const g of room.guests.values()) if (g.ws && g.ws.readyState === 1) g.ws.send(text);
    } else if (msg.t === 'toOne' && me.role === 'host') send(room.guests.get(msg.to)?.ws, { t: 'fromHost', data: msg.data });
    else if (msg.t === 'leave' && me.role === 'guest') {
      const g = room.guests.get(me.id);
      room.guests.delete(me.id);
      send(room.host.ws, { t: 'peer', id: me.id, name: g?.name || '', online: false, left: true });
      me = null; touch(room);
    } else if (msg.t === 'close' && me.role === 'host') {
      for (const g of room.guests.values()) send(g.ws, { t: 'closed' });
      rooms.delete(room.code);
      me = null;
    }
  });

  ws.on('close', () => {
    if (!me) return;
    const room = me.room;
    if (me.role === 'host') {
      if (room.host.ws === ws) { room.hostGoneSince = Date.now(); for (const g of room.guests.values()) send(g.ws, { t: 'host', online: false }); }
    } else {
      const g = room.guests.get(me.id);
      if (g && g.ws === ws) send(room.host.ws, { t: 'peer', id: me.id, name: g.name, online: false });
    }
    touch(room);
  });
});

// Drop sockets that stopped answering (a phone that went to sleep), so the host learns they left.
// Each socket also gets a { t: 'beat' }: a browser answers pings on its own but cannot see them, and a
// page that hears nothing for a while knows its link is dead and reconnects (src/net/net.ts).
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping(); send(ws, { t: 'beat' });
  }
}, BEAT_MS).unref();

server.listen(PORT, () => console.log(`Sự Thảy: http://localhost:${PORT}  (rooms on /ws, files from ${STATIC_DIR})`));
