// Tỷ Phú Đất Việt online: serves the built game (dist/) and relays messages between the players
// of a room over WebSocket (/ws). The rules run in the host's browser; this server only knows who
// is in which room and passes messages along, so it stays small and holds no game state.
//
//   node server/server.mjs           PORT (default 8787), STATIC_DIR (default dist)
//
// Messages are JSON. From a browser:
//   { t: 'create', name, key }             make a room, become its host
//   { t: 'join', code, name, key }         join a room (the same key rejoins the same place)
//   { t: 'toHost', data }                  a guest's message for the host
//   { t: 'toAll', data }                   the host's message for every guest
//   { t: 'toOne', to, data }               the host's message for one guest
// From the server:
//   { t: 'created', code, id }   { t: 'joined', code, id }   { t: 'error', msg }
//   { t: 'peer', id, name, online }        to the host: a guest came, went or came back
//   { t: 'fromPeer', from, data }          to the host
//   { t: 'fromHost', data }                to a guest
//   { t: 'host', online }                  to the guests: the host dropped or came back
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 8787;
const STATIC_DIR = resolve(process.env.STATIC_DIR || 'dist');
const ROOM_IDLE_MS = 30 * 60 * 1000;   // a room with nobody connected is closed after this long
const MAX_GUESTS = 3;                  // four seats: the host and three friends
const MAX_MESSAGE = 256 * 1024;        // a game state is a few kilobytes
const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';  // no I, L, O: easy to read out loud

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

// ---- Static files: the built game -------------------------------------------------------
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://x');
    if (url.pathname === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return; }
    let path = normalize(join(STATIC_DIR, decodeURIComponent(url.pathname)));
    if (!path.startsWith(STATIC_DIR)) { res.writeHead(403); res.end(); return; }
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

function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 2; i++) c += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
    c += String(10 + Math.floor(Math.random() * 90));
    if (!rooms.has(c)) return c;
  }
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
  }
}, 60 * 1000).unref();

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MESSAGE });
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
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
      if (back) {
        back.host.ws = ws; me = { room: back, role: 'host', id: 0 };
        send(ws, { t: 'created', code: back.code, id: 0, back: true });
        for (const [id, g] of back.guests) send(ws, { t: 'peer', id, name: g.name, online: !!(g.ws && g.ws.readyState === 1) });
        for (const g of back.guests.values()) send(g.ws, { t: 'host', online: true });
        touch(back); return;
      }
      const room = { code: newCode(), host: { ws, key, name: clean(msg.name, 20) }, guests: new Map(), nextId: 1, idleSince: 0 };
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
        if (room.guests.size >= MAX_GUESTS) { send(ws, { t: 'error', msg: 'Phòng đã đủ người.' }); return; }
        id = room.nextId++;
        room.guests.set(id, { ws, key, name });
      } else {
        const g = room.guests.get(id); g.ws = ws; g.name = name;
      }
      me = { room, role: 'guest', id };
      send(ws, { t: 'joined', code: room.code, id, hostOnline: !!(room.host.ws && room.host.ws.readyState === 1) });
      send(room.host.ws, { t: 'peer', id, name, online: true });
      touch(room); return;
    }

    if (!me) return;
    const room = me.room;
    if (msg.t === 'toHost' && me.role === 'guest') send(room.host.ws, { t: 'fromPeer', from: me.id, data: msg.data });
    else if (msg.t === 'toAll' && me.role === 'host') {
      const text = JSON.stringify({ t: 'fromHost', data: msg.data });
      for (const g of room.guests.values()) if (g.ws && g.ws.readyState === 1) g.ws.send(text);
    } else if (msg.t === 'toOne' && me.role === 'host') send(room.guests.get(msg.to)?.ws, { t: 'fromHost', data: msg.data });
  });

  ws.on('close', () => {
    if (!me) return;
    const room = me.room;
    if (me.role === 'host') {
      if (room.host.ws === ws) for (const g of room.guests.values()) send(g.ws, { t: 'host', online: false });
    } else {
      const g = room.guests.get(me.id);
      if (g && g.ws === ws) send(room.host.ws, { t: 'peer', id: me.id, name: g.name, online: false });
    }
    touch(room);
  });
});

// Drop sockets that stopped answering (a phone that went to sleep), so the host learns they left.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 20 * 1000).unref();

server.listen(PORT, () => console.log(`Tỷ Phú Đất Việt: http://localhost:${PORT}  (rooms on /ws, files from ${STATIC_DIR})`));
