// The toolbar over the board: the game's history, quick emotes and chat online.

import { tune } from '../config';

import * as net from '../net/net';
import { W, H, ctx, text, rrect, wrapLines } from '../screen';

import { BOARD_TOP } from '../game/board';

import { state } from '../core/store';
import { cleanChat } from '../game/chat';

import { showHistory } from '../ui/pages';
import { showChat, setChatSender } from '../ui/chatBox';
import { EMOTES } from '../ui/words';

import { log } from '../game/turn';

import { rawSfx, sendAct, isGuest, roomCode } from '../net/room';
import { F } from '../core/flags';

import { project, tokVis } from '../three/scene3d';

import { drawButton } from '../ui/draw';

import { L, btn } from '../main';

// ---- The toolbar: the game's history, quick emotes online ----------------------------------
/** The row of small pills: the board's bottom-left on a wide screen. A phone puts the history in the
 * strip under the board (historySpot) and only the emotes over the board's top-left corner. */
export function buildToolbar() {
  let x = 12; const y = L.phone ? L.by + 6 : H - 42, h = L.phone ? 32 : 30;
  const pill = (w: number, label: string, fn: () => void) => { btn(x, y, w, h, label, fn, 'room'); x += w + 8; };
  if (!L.phone) pill(84, 'Lịch sử', openHistory);
  if (roomCode) pill(96, 'Biểu cảm', () => { F.emoteMenu = !F.emoteMenu; F.roomMenu = false; F.inspect = -1; F.sheetOpen = false; });
}
function openHistory() { if (isGuest()) sendAct('history'); else showHistory(state.history || []); }
/** Phone: the history button, in the row under the turn's buttons. */
export function buildPhoneHistory() { const r = historySpot(); btn(r.x, r.y, r.w, r.h, 'Lịch sử', openHistory, '', true, '#6a4a2a'); }
/** Phone: where the history button sits, left in the row under the turn's buttons (the property button in the
 * middle, the speed button right). */
export function historySpot(): { x: number; y: number; w: number; h: number } {
  return { x: 12, y: L.btnY + 64, w: 104, h: 44 };
}
/** The phone toolbar's width over the board: only the emotes, online. */
export const phoneToolbarEnd = (): number => 12 + (roomCode ? 96 + 8 : 0);
const emoteLast: number[] = [];       // host: when each seat last sent one, so nobody floods the table
const emoteSeen = new Set<string>();  // the bubbles already heard here, so each pops once
/** Host: a player sends a quick emote; it shows over their piece for everyone. */
export function hostEmote(seat: number, i: unknown) {
  if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= EMOTES.length) return;
  if (state.t - (emoteLast[seat] ?? -99) < tune.emote_gap) return;
  emoteLast[seat] = state.t;
  (state.emotes ||= []).push({ seat, i, t: 0, id: `${seat}:${state.t.toFixed(2)}` });
}
/** How long a bubble stays: a typed line longer than a ready-made emote. */
export const bubbleLife = (e: { text?: string }): number => (e.text ? tune.chat_time : tune.emote_time);
const chatLast: number[] = []; // host: when each seat last chatted
const chatPrev: string[] = []; // host: each seat's last line, so the same line is not sent twice in a row
/** Host: a player's typed line, cleaned (src/game/chat.ts) and shown over their piece and in the log. */
export function hostChat(seat: number, raw: unknown) {
  const text = cleanChat(raw, tune.chat_max_len), p = state.players.find(q => q.id === seat);
  if (!text || !p) return;
  if (state.t - (chatLast[seat] ?? -99) < tune.chat_gap) return;   // too soon after the last one
  if (text === chatPrev[seat] && state.t - (chatLast[seat] ?? -99) < 30) return; // the same line again
  chatLast[seat] = state.t; chatPrev[seat] = text;
  (state.emotes ||= []).push({ seat, i: -1, text, t: 0, id: `c${seat}:${state.t.toFixed(2)}` });
  log(`${p.name}: ${text}`);
}
/** This screen's player sends a line: the host shows it, a friend sends it to the host. */
function sendChat(raw: string) {
  if (isGuest()) net.toHost({ k: 'act', act: 'chat', text: String(raw).slice(0, tune.chat_max_len * 2) });
  else hostChat(0, raw); // the host always sits in seat 0
}
setChatSender(sendChat);
function sendEmote(i: number) {
  F.emoteMenu = false;
  if (isGuest()) sendAct('emote', i); else hostEmote(0, i); // the host always sits in seat 0
}
export function buildEmoteMenu() {
  const bw = L.phone ? 200 : 180, bh = 48, cols = L.phone ? 2 : 4, x0 = L.cx - (cols * bw + (cols - 1) * 10) / 2, y0 = L.phone ? 400 : 270;
  EMOTES.forEach((e, k) => btn(x0 + (k % cols) * (bw + 10), y0 + Math.floor(k / cols) * (bh + 10), bw, bh, e, () => sendEmote(k), 'menu', true, '#8a5a2a'));
  const rows = Math.ceil(EMOTES.length / cols);
  btn(L.cx - 170, y0 + rows * (bh + 10) + 6, 160, 46, 'Nhắn tin…', () => { F.emoteMenu = false; setChatSender(sendChat); showChat(true); }, 'menu', true, '#2b6cd6');
  btn(L.cx + 10, y0 + rows * (bh + 10) + 6, 160, 46, 'Đóng', () => { F.emoteMenu = false; }, 'menuSecondary', true, '#6a4a2a');
}
export function drawEmoteMenu() {
  if (!F.emoteMenu || !roomCode) return;
  ctx.save(); ctx.fillStyle = 'rgba(10,5,3,0.55)'; ctx.fillRect(0, 0, W, H); ctx.restore();
  text('Gửi biểu cảm', L.cx, L.phone ? 370 : 240, 24, '#f2c44a', 'center', 'bold');
  F.drawingMenu = true; F.ui.forEach(b => { if (b.role === 'menu' || b.role === 'menuSecondary') drawButton(b); }); F.drawingMenu = false;
}
/** The speech bubbles over the pieces, with a pop the first time each one shows. */
export function drawEmotes() {
  for (const e of state.emotes || []) {
    const v = tokVis[e.seat], p = state.players[e.seat];
    if (!v || !p) continue;
    if (!emoteSeen.has(e.id)) { if (emoteSeen.size > 200) emoteSeen.clear(); emoteSeen.add(e.id); rawSfx.emote(); }
    const s = project(v.x, BOARD_TOP + v.y + 1.1, v.z), msg = e.text ?? (EMOTES[e.i] || ''), fs = e.text ? (L.phone ? 15 : 16) : (L.phone ? 17 : 18);
    const pop = Math.min(1, e.t / 0.15), fade = Math.max(0, Math.min(1, (bubbleLife(e) - e.t) / 0.4));
    ctx.save(); ctx.globalAlpha = fade;
    ctx.font = `bold ${fs}px "Segoe UI", Arial, sans-serif`;
    let lines = wrapLines(ctx, msg, L.phone ? 260 : 300);
    if (lines.length > 3) { lines = lines.slice(0, 3); lines[2] = lines[2].replace(/.{0,2}$/u, '…'); }
    const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 24, h = 14 + lines.length * (fs + 4), x = Math.max(6, Math.min(W - 6 - w, s.x - w / 2)), y = s.y - h - 10 - (1 - pop) * 8;
    ctx.fillStyle = '#fff8e6'; ctx.strokeStyle = p.color; ctx.lineWidth = 3;
    rrect(ctx, x, y, w, h, 14); ctx.fill(); ctx.stroke();
    const tx = Math.max(x + 16, Math.min(x + w - 16, s.x));
    ctx.beginPath(); ctx.moveTo(tx - 8, y + h - 1); ctx.lineTo(tx + 8, y + h - 1); ctx.lineTo(s.x, y + h + 10); ctx.closePath(); ctx.fill();
    lines.forEach((l, j) => text(l, x + w / 2, y + 7 + (fs + 4) * (j + 0.5) + 1, fs, '#2a1a10', 'center', 'bold'));
    ctx.restore();
  }
}

