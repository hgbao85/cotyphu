import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import {
  addChat,
  addPlayer,
  applyAction,
  botDecide,
  createGame,
  currentPlayer,
  MAX_PLAYERS,
  removePlayer,
  startGame,
  type GameAction,
  type GameState,
} from '@cotyphu/shared';

// Khi dev luôn dùng 3001 (Vite proxy tới đây); khi deploy dùng PORT của nhà cung cấp.
const PORT = process.argv.includes("--dev") ? 3001 : Number(process.env.PORT ?? 3001);
const TURN_MS = 30_000; // thời gian mỗi bước của người chơi
const BOT_DELAY_MS = 900;
const EMPTY_ROOM_TTL_MS = 5 * 60_000;

interface Room {
  state: GameState;
  /** token bí mật -> playerId, dùng để vào lại ván khi rớt mạng */
  tokens: Map<string, string>;
  timer?: NodeJS.Timeout;
  cleanup?: NodeJS.Timeout;
}

const rooms = new Map<string, Room>();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: true } });

const clientDist = fileURLToPath(new URL('../../client/dist', import.meta.url));
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(`${clientDist}/index.html`));
}

function newCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code: string;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function cleanName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const n = name.trim().replace(/\s+/g, ' ');
  return n.length >= 1 && n.length <= 16 ? n : null;
}

function broadcast(room: Room): void {
  io.to(room.state.code).emit('state', { ...room.state, serverTime: Date.now() });
}

/** Lên lịch hành động tự động: bot, người rớt mạng, hoặc người hết giờ. */
function schedule(room: Room): void {
  clearTimeout(room.timer);
  const s = room.state;
  if (s.status !== 'playing') {
    s.turnDeadline = null;
    return;
  }
  const cur = currentPlayer(s);
  const auto = cur.isBot || !cur.connected;
  s.turnDeadline = auto ? null : Date.now() + TURN_MS;
  room.timer = setTimeout(
    () => {
      const action = botDecide(s, cur.id);
      if (action) {
        const r = applyAction(s, cur.id, action, Math.random);
        if (!r.ok) console.warn(`[${s.code}] auto action failed`, action, r.error);
      }
      schedule(room);
      broadcast(room);
    },
    auto ? BOT_DELAY_MS : TURN_MS,
  );
}

function humansConnected(room: Room): boolean {
  return room.state.players.some((p) => !p.isBot && p.connected);
}

function maybeCleanup(room: Room): void {
  clearTimeout(room.cleanup);
  if (humansConnected(room)) return;
  room.cleanup = setTimeout(() => {
    if (humansConnected(room)) return;
    clearTimeout(room.timer);
    rooms.delete(room.state.code);
    console.log(`[${room.state.code}] room closed`);
  }, EMPTY_ROOM_TTL_MS);
}

type Ack = (res: Record<string, unknown>) => void;
const safeAck = (ack: unknown): Ack => (typeof ack === 'function' ? (ack as Ack) : () => {});

function joinRoom(socket: Socket, room: Room, playerId: string): void {
  socket.data.code = room.state.code;
  socket.data.playerId = playerId;
  socket.join(room.state.code);
}

function ctx(socket: Socket): { room: Room; playerId: string } | null {
  const room = rooms.get(socket.data.code);
  const playerId = socket.data.playerId as string | undefined;
  if (!room || !playerId) return null;
  return { room, playerId };
}

io.on('connection', (socket) => {
  socket.on('create', (data: { name?: string }, ackFn: unknown) => {
    const ack = safeAck(ackFn);
    const name = cleanName(data?.name);
    if (!name) return ack({ ok: false, error: 'Tên phải từ 1 đến 16 ký tự' });
    const code = newCode();
    const room: Room = { state: createGame(code), tokens: new Map() };
    rooms.set(code, room);
    const playerId = randomUUID();
    const token = randomUUID();
    addPlayer(room.state, playerId, name, false);
    room.tokens.set(token, playerId);
    joinRoom(socket, room, playerId);
    ack({ ok: true, code, playerId, token });
    broadcast(room);
  });

  socket.on('join', (data: { code?: string; name?: string }, ackFn: unknown) => {
    const ack = safeAck(ackFn);
    const name = cleanName(data?.name);
    const room = rooms.get(String(data?.code ?? '').toUpperCase().trim());
    if (!name) return ack({ ok: false, error: 'Tên phải từ 1 đến 16 ký tự' });
    if (!room) return ack({ ok: false, error: 'Không tìm thấy phòng' });
    if (room.state.status !== 'lobby') return ack({ ok: false, error: 'Ván đã bắt đầu' });
    if (room.state.players.length >= MAX_PLAYERS) return ack({ ok: false, error: 'Phòng đã đủ người' });
    const playerId = randomUUID();
    const token = randomUUID();
    addPlayer(room.state, playerId, name, false);
    room.tokens.set(token, playerId);
    joinRoom(socket, room, playerId);
    clearTimeout(room.cleanup);
    ack({ ok: true, code: room.state.code, playerId, token });
    broadcast(room);
  });

  socket.on('rejoin', (data: { code?: string; token?: string }, ackFn: unknown) => {
    const ack = safeAck(ackFn);
    const room = rooms.get(String(data?.code ?? ''));
    const playerId = room?.tokens.get(String(data?.token ?? ''));
    const player = playerId ? room!.state.players.find((p) => p.id === playerId) : undefined;
    if (!room || !playerId || !player) return ack({ ok: false, error: 'Phiên chơi đã hết hạn' });
    player.connected = true;
    joinRoom(socket, room, playerId);
    clearTimeout(room.cleanup);
    ack({ ok: true, code: room.state.code, playerId });
    if (room.state.status === 'playing' && currentPlayer(room.state).id === playerId) schedule(room);
    broadcast(room);
  });

  socket.on('addBot', (_data: unknown, ackFn: unknown) => {
    const ack = safeAck(ackFn);
    const c = ctx(socket);
    if (!c) return ack({ ok: false, error: 'Bạn chưa vào phòng' });
    const { state } = c.room;
    if (state.hostId !== c.playerId) return ack({ ok: false, error: 'Chỉ chủ phòng được thêm bot' });
    const n = state.players.filter((p) => p.isBot).length + 1;
    if (!addPlayer(state, `bot-${randomUUID()}`, `Bot ${n}`, true)) return ack({ ok: false, error: 'Phòng đã đủ người' });
    ack({ ok: true });
    broadcast(c.room);
  });

  socket.on('kick', (data: { playerId?: string }, ackFn: unknown) => {
    const ack = safeAck(ackFn);
    const c = ctx(socket);
    if (!c) return ack({ ok: false, error: 'Bạn chưa vào phòng' });
    const { state } = c.room;
    if (state.hostId !== c.playerId || state.status !== 'lobby') return ack({ ok: false, error: 'Không được phép' });
    const target = state.players.find((p) => p.id === data?.playerId);
    if (!target || target.id === c.playerId) return ack({ ok: false, error: 'Không hợp lệ' });
    removePlayer(state, target.id);
    for (const [t, id] of c.room.tokens) if (id === target.id) c.room.tokens.delete(t);
    io.to(state.code).emit('kicked', { playerId: target.id });
    ack({ ok: true });
    broadcast(c.room);
  });

  socket.on('start', (_data: unknown, ackFn: unknown) => {
    const ack = safeAck(ackFn);
    const c = ctx(socket);
    if (!c) return ack({ ok: false, error: 'Bạn chưa vào phòng' });
    if (c.room.state.hostId !== c.playerId) return ack({ ok: false, error: 'Chỉ chủ phòng được bắt đầu' });
    const r = startGame(c.room.state, Math.random);
    ack(r);
    if (r.ok) {
      schedule(c.room);
      broadcast(c.room);
    }
  });

  socket.on('action', (action: GameAction, ackFn: unknown) => {
    const ack = safeAck(ackFn);
    const c = ctx(socket);
    if (!c) return ack({ ok: false, error: 'Bạn chưa vào phòng' });
    const r = applyAction(c.room.state, c.playerId, action, Math.random);
    ack(r);
    if (r.ok) {
      schedule(c.room);
      broadcast(c.room);
    }
  });

  socket.on('chat', (data: { text?: string }) => {
    const c = ctx(socket);
    const text = typeof data?.text === 'string' ? data.text.trim() : '';
    if (!c || !text) return;
    addChat(c.room.state, c.playerId, text);
    broadcast(c.room);
  });

  const leave = (explicit: boolean) => {
    const c = ctx(socket);
    if (!c) return;
    const { room, playerId } = c;
    socket.leave(room.state.code);
    socket.data.code = undefined;
    socket.data.playerId = undefined;
    // còn socket khác của cùng người chơi (tab khác)? thì không coi là rời
    const stillHere = [...(io.sockets.adapter.rooms.get(room.state.code) ?? [])].some(
      (sid) => io.sockets.sockets.get(sid)?.data.playerId === playerId,
    );
    if (stillHere && !explicit) return;
    if (room.state.status === 'lobby' && !explicit) {
      // rớt mạng/tải lại trang trong phòng chờ: cho 20 giây để vào lại
      const p = room.state.players.find((x) => x.id === playerId);
      if (p) p.connected = false;
      setTimeout(() => {
        const still = room.state.players.find((x) => x.id === playerId);
        if (room.state.status === 'lobby' && still && !still.connected) {
          removePlayer(room.state, playerId);
          for (const [t, id] of room.tokens) if (id === playerId) room.tokens.delete(t);
          if (!room.state.players.some((x) => !x.isBot)) rooms.delete(room.state.code);
          else broadcast(room);
        }
      }, 20_000);
      broadcast(room);
      return;
    }
    if (room.state.status === 'lobby') {
      removePlayer(room.state, playerId);
      for (const [t, id] of room.tokens) if (id === playerId) room.tokens.delete(t);
      if (!room.state.players.some((p) => !p.isBot)) {
        rooms.delete(room.state.code);
        return;
      }
    } else {
      const p = room.state.players.find((x) => x.id === playerId);
      if (p) p.connected = false;
      if (room.state.status === 'playing' && currentPlayer(room.state).id === playerId) schedule(room);
    }
    maybeCleanup(room);
    broadcast(room);
  };

  socket.on('leave', () => leave(true));
  socket.on('disconnect', () => leave(false));
});

httpServer.listen(PORT, () => {
  console.log(`Cờ Tỷ Phú server chạy tại http://localhost:${PORT}`);
});
