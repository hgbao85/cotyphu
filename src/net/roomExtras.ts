// What an online room of Cá Ngựa or Rắn và Thang has besides the game, as Cờ Tỷ Phú's room has it:
// quick emotes and typed lines shown as bubbles over a player's card, and a vote for a new game that
// every player online must agree to. The host runs it all (a friend only asks); it lives in the game
// object the host sends 20 times a second (G.emotes, G.vote), so every screen draws the same.
// Each game plugs in through an adapter (makeRoomExtras): this file knows no game's rules.
import { tune } from '../config';
import { W, H, ctx, text, rrect, wrapLines, FONT } from '../screen';
import { F } from '../core/flags';
import { cleanChat, since } from '../game/chat';
import { showChat, setChatSender } from '../ui/chatBox';
import { drawButton } from '../ui/draw';
import { EMOTES } from '../ui/words';
import { rawSfx } from './room';
import type { Loose } from '../game/types';

/** A bubble over a player's card: a ready-made emote (i) or a typed line (text), t seconds old. */
export interface Bubble { slot: number; i: number; text?: string; t: number; id: string }
/** The vote for a new game: who asked, each voter's answer (null: not yet), its clock. */
export interface Vote { by: string; t: number; list: { id: string; name: string; ans: boolean | null }[] }
/** What the extras read in a game: its clock, its players, and the two fields they keep in it. */
export interface RoomGame { t: number; players: { name: string; kind: string; peer?: number }[]; emotes?: Bubble[]; vote?: Vote }

/** How a game plugs in. A slot is a player's index in G.players. */
export interface RoomAdapter {
  G(): RoomGame | null;
  isHost(): boolean;
  isGuest(): boolean;
  /** This screen's own slot (the host's seat, or the friend's), or -1. */
  mySlot(): number;
  peerOnline(id?: number): boolean;
  /** Friend: a press for the host, with what it carries (an emote's i, a line's text). */
  sendAct(act: string, extra: Record<string, unknown>): void;
  /** Host: a new game for everyone (the vote passed). */
  restart(): void;
  log(s: string): void;
  /** Where the dialogs centre (the board's middle on a wide screen). */
  cx(): number;
  phone(): boolean;
  /** Builds a button into this frame's list (the game's own btn). */
  btn(x: number, y: number, w: number, h: number, label: string, fn: () => void, role: string, enabled?: boolean, color?: string): void;
}

/** A bubble's life: a typed line stays longer than a ready-made emote. */
const lifeOf = (b: Bubble): number => (b.text ? tune.chat_time : tune.emote_time);

/** The room extras for one game. */
export function makeRoomExtras(A: RoomAdapter) {
  const emoteLast: number[] = [], chatLast: number[] = [], chatPrev: string[] = [];
  const lastAsk = new Map<string, number>(); // when each friend last asked for a new game (G.t)
  const seen = new Set<string>();            // bubbles already popped on this screen

  const voterId = (slot: number): string => (slot === hostSlot() ? 'host' : `p${A.G()?.players[slot]?.peer}`);
  const hostSlot = (): number => { const g = A.G(); return g ? g.players.findIndex(p => p.kind === 'human') : -1; };
  const myVoter = (): string => (A.isHost() ? 'host' : `p${A.G()?.players[A.mySlot()]?.peer}`);

  // ---- The host's side ------------------------------------------------------------------------
  function hostEmote(slot: number, i: unknown): void {
    const g = A.G();
    if (!g || typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= EMOTES.length || !g.players[slot]) return;
    if (since(emoteLast[slot], g.t) < tune.emote_gap) return; // nobody floods the table
    emoteLast[slot] = g.t;
    (g.emotes ||= []).push({ slot, i, t: 0, id: `${slot}:${g.t.toFixed(2)}` });
  }
  function hostChat(slot: number, raw: unknown): void {
    const g = A.G(), line = cleanChat(raw, tune.chat_max_len), p = g?.players[slot];
    if (!g || !line || !p) return;
    if (since(chatLast[slot], g.t) < tune.chat_gap) return;                  // too soon after the last one
    if (line === chatPrev[slot] && since(chatLast[slot], g.t) < 30) return; // the same line again
    chatLast[slot] = g.t; chatPrev[slot] = line;
    (g.emotes ||= []).push({ slot, i: -1, text: line, t: 0, id: `c${slot}:${g.t.toFixed(2)}` });
    A.log(`${p.name}: ${line}`);
  }
  /** Who votes: the host, then each friend online who plays in this game. The computer has no vote. */
  function voters(): { id: string; name: string }[] {
    const g = A.G(); if (!g) return [];
    return g.players.flatMap((p, k) => (k === hostSlot() ? [{ id: 'host', name: p.name }] : p.kind === 'remote' && A.peerOnline(p.peer) ? [{ id: `p${p.peer}`, name: p.name }] : []));
  }
  function hostStartVote(by: string): void {
    const g = A.G(); if (!g || g.vote) return;
    const list = voters();
    if (list.length <= 1) { A.restart(); return; } // nobody else to ask
    const who = list.find(v => v.id === by); if (!who) return;
    const asked = lastAsk.get(by); // a friend turned down waits vote_again_time (data/config.json) to ask again
    if (by !== 'host' && asked !== undefined && asked <= g.t && g.t - asked < tune.vote_again_time) return;
    lastAsk.set(by, g.t);
    g.vote = { by: who.name, t: 0, list: list.map(v => ({ ...v, ans: v.id === by ? true : null })) };
    A.log(`${who.name} đề nghị chơi lại ván mới.`);
    F.roomMenu = false;
  }
  function hostCastVote(id: string, yes: boolean): void {
    const g = A.G(), v = g?.vote; if (!g || !v) return;
    const me = v.list.find(e => e.id === id); if (!me || me.ans !== null) return;
    me.ans = yes;
    if (!yes) { g.vote = undefined; A.log(`${me.name} không đồng ý chơi lại: ván tiếp tục.`); return; }
    if (v.list.every(e => e.ans === true)) { g.vote = undefined; A.restart(); }
  }

  /** Host: a friend's press for the extras; true when it was one. */
  function onAct(from: number, a: Loose): boolean {
    const g = A.G(); if (!g) return false;
    const slot = g.players.findIndex(p => p.peer === from);
    if (a.act === 'emote') { if (slot >= 0) hostEmote(slot, a.i); return true; }
    if (a.act === 'chat') { if (slot >= 0) hostChat(slot, a.text); return true; }
    if (a.act === 'voteStart') { if (slot >= 0) hostStartVote(`p${from}`); return true; }
    if (a.act === 'vote:yes' || a.act === 'vote:no') { hostCastVote(`p${from}`, a.act === 'vote:yes'); return true; }
    return false;
  }

  /** Every step, on every screen: the bubbles age; the host runs the vote's clock and drops friends who left. */
  function step(dt: number): void {
    const g = A.G(); if (!g) return;
    if (g.emotes) { for (const b of g.emotes) b.t += dt; if (A.isHost()) g.emotes = g.emotes.filter(b => b.t < lifeOf(b)); }
    const v = g.vote; if (!v || !A.isHost()) return;
    v.t += dt;
    v.list = v.list.filter(e => e.id === 'host' || A.peerOnline(Number(e.id.slice(1))));
    if (v.t >= tune.vote_time) { g.vote = undefined; A.log('Hết giờ bỏ phiếu: ván tiếp tục.'); }
    else if (v.list.every(e => e.ans === true)) { g.vote = undefined; A.restart(); }
  }

  // ---- This screen's presses ---------------------------------------------------------------------
  /** Asks for a new game: a friend asks the host; the host opens the vote (or restarts, alone). */
  function startVote(): void { if (A.isGuest()) A.sendAct('voteStart', {}); else hostStartVote('host'); }
  function castVote(yes: boolean): void { if (A.isGuest()) A.sendAct(yes ? 'vote:yes' : 'vote:no', {}); else hostCastVote('host', yes); }
  function sendEmote(i: number): void { F.emoteMenu = false; if (A.isGuest()) A.sendAct('emote', { i }); else hostEmote(A.mySlot(), i); }
  function sendChat(raw: string): void { if (A.isGuest()) A.sendAct('chat', { text: String(raw).slice(0, tune.chat_max_len * 2) }); else hostChat(A.mySlot(), raw); }
  /** Opens or closes the emote menu. */
  function toggleEmotes(): void { F.emoteMenu = !F.emoteMenu; F.roomMenu = false; }

  // ---- What shows: the vote, the emote menu, the bubbles --------------------------------------------
  const voteBox = (): { x: number; y: number; w: number; h: number } => {
    const n = A.G()?.vote?.list.length ?? 0, h = 210 + n * 30, w = Math.min(460, W - 24);
    return { x: A.cx() - w / 2, y: (A.phone() ? H / 2 : 360) - h / 2, w, h };
  };
  /** The overlay's buttons, when one is open: true then, and the game builds nothing else this frame. */
  function buildOverlay(): boolean {
    const g = A.G();
    if (g?.vote) {
      const me = g.vote.list.find(e => e.id === myVoter());
      if (me && me.ans === null) {
        const y = voteBox().y + voteBox().h - 70, cx = A.cx();
        A.btn(cx - 210, y, 200, 54, 'Đồng ý', () => castVote(true), 'menu', true, '#2f8a3a');
        A.btn(cx + 10, y, 200, 54, 'Không', () => castVote(false), 'menuSecondary', true, '#6a4a2a');
      }
      return true;
    }
    if (F.emoteMenu) {
      const cx = A.cx(), bw = A.phone() ? 200 : 150, bh = 48, cols = A.phone() ? 2 : 4, x0 = cx - (cols * bw + (cols - 1) * 10) / 2, y0 = A.phone() ? 400 : 270;
      EMOTES.forEach((e, k) => A.btn(x0 + (k % cols) * (bw + 10), y0 + Math.floor(k / cols) * (bh + 10), bw, bh, e, () => sendEmote(k), 'menu', true, '#8a5a2a'));
      const rows = Math.ceil(EMOTES.length / cols), y = y0 + rows * (bh + 10) + 6;
      A.btn(cx - 170, y, 160, 46, 'Nhắn tin…', () => { F.emoteMenu = false; setChatSender(sendChat); showChat(true); }, 'menu', true, '#2b6cd6');
      A.btn(cx + 10, y, 160, 46, 'Đóng', () => { F.emoteMenu = false; }, 'menuSecondary', true, '#6a4a2a');
      return true;
    }
    return false;
  }
  /** Draws the open overlay over everything, with its buttons. */
  function drawOverlay(ui: Loose[]): void {
    const g = A.G(), v = g?.vote, cx = A.cx();
    if (!v && !F.emoteMenu) return;
    ctx.save(); ctx.fillStyle = 'rgba(70,110,130,0.45)'; ctx.fillRect(0, 0, W, H); ctx.restore();
    if (v) {
      const b = voteBox();
      ctx.save(); ctx.fillStyle = 'rgba(255,249,234,0.98)'; rrect(ctx, b.x, b.y, b.w, b.h, 16); ctx.fill();
      ctx.strokeStyle = '#e8a86a'; ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
      text('Bỏ phiếu chơi lại ván mới', cx, b.y + 30, 22, '#d9622b', 'center', 'bold');
      text(`${v.by} đề nghị · còn ${Math.max(0, Math.ceil(tune.vote_time - v.t))} giây`, cx, b.y + 60, 16, '#6a4a32');
      v.list.forEach((e, j) => {
        const y = b.y + 98 + j * 30;
        text(e.name + (e.id === myVoter() ? ' (bạn)' : ''), b.x + 30, y, 17, '#4a3020', 'left');
        const [say, col] = e.ans === true ? ['Đồng ý', '#2f8a3a'] : e.ans === false ? ['Không', '#c8201f'] : ['Đang chờ...', '#8a6a4a'];
        text(say, b.x + b.w - 30, y, 17, col, 'right', 'bold');
      });
    } else text('Gửi biểu cảm', cx, A.phone() ? 370 : 240, 24, '#d9622b', 'center', 'bold');
    F.drawingMenu = true; ui.forEach(b => { if (b.role === 'menu' || b.role === 'menuSecondary') drawButton(b); }); F.drawingMenu = false;
  }
  /** The bubbles over the players' cards (spot: where a card's top middle is), each popping once. */
  function drawBubbles(spot: (slot: number) => { x: number; y: number } | null, colorOf: (slot: number) => string): void {
    const g = A.G(); if (!g?.emotes) return;
    for (const e of g.emotes) {
      const s = spot(e.slot); if (!s) continue;
      if (!seen.has(e.id)) { if (seen.size > 200) seen.clear(); seen.add(e.id); rawSfx.emote?.(); }
      const msg = e.text ?? (EMOTES[e.i] || ''), fs = e.text ? 15 : 17;
      const pop = Math.min(1, e.t / 0.15), fade = Math.max(0, Math.min(1, (lifeOf(e) - e.t) / 0.4));
      ctx.save(); ctx.globalAlpha = fade; ctx.font = `bold ${fs}px ${FONT}`;
      let lines = wrapLines(ctx, msg, 260);
      if (lines.length > 3) { lines = lines.slice(0, 3); lines[2] = lines[2].replace(/.{0,2}$/u, '…'); }
      const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 24, h = 14 + lines.length * (fs + 4);
      const x = Math.max(6, Math.min(W - 6 - w, s.x - w / 2)), y = Math.max(4, s.y - h - 8 - (1 - pop) * 8);
      ctx.fillStyle = '#fff8e6'; ctx.strokeStyle = colorOf(e.slot); ctx.lineWidth = 3;
      rrect(ctx, x, y, w, h, 14); ctx.fill(); ctx.stroke();
      lines.forEach((l, j) => text(l, x + w / 2, y + 7 + (fs + 4) * (j + 0.5) + 1, fs, '#2a1a10', 'center', 'bold'));
      ctx.restore();
    }
  }

  return { onAct, step, startVote, toggleEmotes, buildOverlay, drawOverlay, drawBubbles, hostStartVote };
}
