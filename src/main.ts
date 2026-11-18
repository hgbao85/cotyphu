// Tỷ Phú Đất Việt: a property board game on a map of Việt Nam, 2-4 seats, each a person or the
// computer. The 3D board is drawn with three.js into an offscreen canvas and copied into the 2D
// canvas each frame; the HUD, popups and buttons are drawn on top in 2D.
// Design record: design/game-brief.md. Rules with no browser live in src/game/.

import { CONFIG, tune } from './config';
import { clock, install, params } from './hook';
import { startAudio, setMuted, isMuted, sfx } from './audio';
import * as net from './net/net';
import { W, H, BW, canvas, ctx, beforeFit, setLogical, fit, clear, text, rrect } from './screen';

import { TILES, LEVEL_NAMES, PLAYER_COLORS, ANIMALS, DEFAULT_ANIMALS, AI_LEVELS } from './game/data';

import { tileAt } from './game/board';

import { state, scene, setup, setScene } from './core/store';

import { showRules } from './ui/pages';

import { money } from './game/rules';
import type { Loose, Seat } from './game/types';
import { aiAct } from './game/ai';
import { owned, reset, liquidValue, teamTag, teamOfSeat, kindLabel, drawEvent, throwDice, afterDice, floatAtToken, salaryNow, gain, resolveLanding, nextOrderThrow, log, curP, startShake, payJail, doBuy, skip, buildPrice, doBuild, afterAction, applyCard, useNoRent, payRent, useReroll, beginMove, flyTo, payDebt, autoRaise, declareBankrupt, nextTurn, isAI } from './game/turn';
import { localGame, resumeLocalGame, keepLocalGame, forgetLocalGame } from './core/keepLocal';
import { buildVoteUI, startVote, leaveRoom, showOnlinePanel, lastRoom, rejoinRoom, drawVote, netStep, isGuest, mySeat, isHost, roomCode, myName, lobby, peerOnline, sendLobby } from './net/room';
import { F } from './core/flags';
import { buildTip, drawTip, tipNow } from './ui/tips';
import { drawSummary } from './ui/summary';
import { camera, aimCamera, boardPointAt, render3D, project, figItems, updateTokens, syncBuildings, hop, build3D, renderer, figCamera } from './three/scene3d';
import { buildPropUI, openAnimalPicker, buildPicker, openSeatPicker, teamSpot, openPicker, clearSetupNote, drawNetBanner, drawPicker, handleInput, clearVis } from './ui/setupScreen';
import { propRows, PROP_Y, PROP_ROW_H, lacquer, drawBoardView, drawPotLabel, drawDiceFeel, drawPopup, drawPanel, drawFloaters, drawInspect, messageBox, drawButton, drawTokenIcon } from './ui/draw';
import { buildSheetUI, buildSheetButton, drawTitlePhone, drawPhoneChrome, drawSheet, drawResultsPhone, titleSpots } from './ui/phone';
import { moodStep } from './three/moods';
import { buildToolbar, buildPhoneHistory, buildEmoteMenu, drawEmotes, drawEmoteMenu } from './ui/toolbar';
import { rulesSpot } from './app/install';
import { CHECKED } from './core/env';

if (import.meta.env.DEV) await import('./dev/tune'); // the tweak panel, on the dev server only

// ---- Layout: wide screens and phones held upright --------------------------------------
// A wide screen is 1280x720: the board on the left, the panel on the right, the turn's buttons over
// the board. A phone held upright is 480x960: a header, a square board, the players, then a strip
// of big buttons. Everything that sits over or beside the board reads its place from L.
interface Layout {
  phone: boolean;
  /** The board view's rectangle on the screen. */
  bx: number; by: number; bw: number; bh: number;
  /** The centre line of the turn's buttons and messages, and the popup card's centre. */
  cx: number; popCy: number;
  /** Where the turn's message, the roll button and the popup buttons sit. */
  msgY: number; rollY: number; btnY: number;
  /** The widest message box, the power bar, the network banner, the F.inspect card's close button. */
  maxW: number; powerY: number; bannerY: number; closeY: number;
}
const WIDE: Layout = { phone: false, bx: 0, by: 0, bw: BW, bh: 720, cx: BW / 2, popCy: 330, msgY: 322, rollY: 372, btnY: 600, maxW: 640, powerY: 446, bannerY: 676, closeY: 548 };
const PHONE: Layout = { phone: true, bx: 0, by: 50, bw: 480, bh: 480, cx: 240, popCy: 290, msgY: 738, rollY: 782, btnY: 782, maxW: 464, powerY: 908, bannerY: 942, closeY: 782 };
/** The tallest phone screen, in logical pixels: a longer phone gets a taller board, not empty bands. */
const PHONE_MAX_H = 1100;
/** The phone layout for a screen `extra` logical pixels taller than 480x960: the board takes the
 * extra height, and everything under it moves down by as much. */
function phoneLayout(extra: number): Layout {
  return { ...PHONE, bh: PHONE.bh + extra, popCy: PHONE.popCy + extra / 2, msgY: PHONE.msgY + extra, rollY: PHONE.rollY + extra, btnY: PHONE.btnY + extra, powerY: PHONE.powerY + extra, bannerY: PHONE.bannerY + extra, closeY: PHONE.closeY + extra };
}
export let L: Layout = WIDE;
/** How much taller than 960 the phone screen is (0 on a wide screen): a screen drawn for 960 moves down half of it. */
export const phoneExtra = (): number => (L.phone ? L.bh - PHONE.bh : 0);
/** Picks the layout from the window's shape: a tall window gets the phone layout, as tall as the screen. */
function chooseLayout() {
  const phone = innerHeight > innerWidth * 1.05;
  const h = phone ? Math.max(960, Math.min(PHONE_MAX_H, Math.round(480 * innerHeight / innerWidth))) : 720;
  if (phone !== L.phone || (phone && h - 960 !== L.bh - PHONE.bh)) {
    L = phone ? phoneLayout(h - 960) : WIDE; F.propScroll = 0; F.sheetOpen = false;
    if (camera) aimCamera();
  }
  setLogical(phone ? 480 : 1280, h);
}
beforeFit(chooseLayout);
/** True when a point on the screen is over the board view. */
export const inBoard = (x: number, y: number): boolean => x >= L.bx && x < L.bx + L.bw && y >= L.by && y < L.by + L.bh;

export const STEP = 1 / 60;            // simulation step in seconds; motion is per second, never per frame
export const TITLE = 'Tỷ Phú Đất Việt';
const CONTROLS = ['Chuột: bấm các nút', 'Space / Enter: đổ xúc xắc, đồng ý', 'N / Esc: bỏ qua', 'M: tắt tiếng'];
export const events: Loose[] = []; // window.game.events: anything the game wants a run to see
export let checkSeed: number | null = null; // a seed a check set for the next games (window.game.configure)

export const muted = (): boolean => isMuted();

// ---- Input: keys by position (event.code), OS key repeat ignored ------------------------
export const down = new Set(), hit = new Set();
export const pressed = (code: string) => hit.has(code); // true for one step after the key goes down
export const clicks: { x: number; y: number }[] = []; // pointer clicks in logical coordinates, read by the next step
export let pointer = { x: -1, y: -1 };
addEventListener('keydown', e => {
  startAudio();
  if (!e.repeat) { down.add(e.code); hit.add(e.code); }
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup', e => down.delete(e.code));
function toLogical(e: { clientX: number; clientY: number }) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
}
export let pointerHeld = false;
addEventListener('pointerdown', e => { startAudio(); pointerHeld = true; clicks.push(toLogical(e)); });
addEventListener('pointerup', e => { pointerHeld = false; if (e.pointerType !== 'mouse') pointer = { x: -1, y: -1 }; }); // a finger leaves no hover behind
addEventListener('contextmenu', e => e.preventDefault()); // a long press shakes the dice, it opens no menu
addEventListener('pointercancel', () => { pointerHeld = false; });
addEventListener('pointermove', e => { pointer = toLogical(e); });
addEventListener('wheel', e => { F.wheel += Math.sign(e.deltaY); }, { passive: true });
addEventListener('blur', () => { down.clear(); pointerHeld = false; });

// ---- 2D UI ---------------------------------------------------------------------------
export const PX = BW, PW = 1280 - BW; // the wide layout's panel
export let hoverTile = -1; // the tile whose card is open from a click, and the tile under the mouse
/** Adds a button for this frame. act names it for online play: a guest sends the act, and the host
 * presses its own button with that act, so the rules and their checks run in one place. */
export function btn(x: number, y: number, w: number, h: number, label: string, fn: () => void, role = '', enabled = true, color?: string, act?: string) { F.ui.push({ x, y, w, h, label, fn, role, enabled, color, act }); }
/** True when the player whose turn it is plays on this screen. */
export function humanTurn(): boolean {
  if (!state || !state.players || state.phase === 'over') return false;
  const p = curP();
  return isGuest() ? p.id === mySeat : p.kind === 'human';
}
function buildUI() {
  F.ui = [];
  if (scene === 'title') { buildTitleUI(); return; }
  if (scene === 'results') {
    if (state.vote) { buildVoteUI(); return; }
    if (isGuest()) { // a friend asks for a new game, or leaves; only the host goes back to the title
      btn(L.cx - 200, L.phone ? 840 + phoneExtra() / 2 : 560, 190, 52, 'Chơi lại', startVote, 'primary');
      btn(L.cx + 10, L.phone ? 840 + phoneExtra() / 2 : 560, 190, 52, 'Rời phòng', leaveRoom, 'secondary', true, '#6a4a2a');
      return;
    }
    btn(L.cx - 200, L.phone ? 840 + phoneExtra() / 2 : 560, 190, 52, 'Chơi lại (Enter)', () => { if (roomCode) startVote(); else { reset(); clearVis(); setScene('play'); } }, 'primary');
    btn(L.cx + 10, L.phone ? 840 + phoneExtra() / 2 : 560, 190, 52, 'Ván mới (N)', () => { setScene('title'); }, 'secondary');
    return;
  }
  if (scene !== 'play') return;
  btn(W - 52, 12, 40, 34, '', () => setMuted(!muted()), 'mute');
  { const r = rulesSpot(); btn(r.x, r.y, r.w, r.h, 'Luật', () => showRules(true), 'room'); }
  const speedOn = !isGuest() && state.players.some(p => p.kind !== 'human');
  if (speedOn && !L.phone) { const r = speedSpot(); btn(r.x, r.y, r.w, r.h, `×${gameSpeed}`, cycleSpeed, 'room'); }
  if (roomCode) {
    const r = roomPill();
    btn(r.x, r.y, r.w, r.h, `Phòng ${roomCode}`, () => { F.roomMenu = true; F.emoteMenu = false; F.inspect = -1; F.sheetOpen = false; }, 'room');
  }
  buildToolbar();
  buildTip();
  if (state.vote) { buildVoteUI(); return; }
  if (F.roomMenu) { buildRoomMenu(); return; }
  if (F.emoteMenu) { buildEmoteMenu(); return; }
  if (F.inspect >= 0) { btn(L.cx - 90, L.closeY, 180, 50, 'Đóng', () => { F.inspect = -1; }, 'close'); return; }
  if (F.sheetOpen) { buildSheetUI(state.cur); return; }
  if (L.phone) { // the row under the turn's buttons, hidden while a sheet, card or menu is open over it
    buildPhoneHistory();
    if (speedOn) { const r = speedSpot(); btn(r.x, r.y, r.w, r.h, `Tốc độ ×${gameSpeed}`, cycleSpeed, '', true, '#6a4a2a'); }
  }
  if (!L.phone) { // click a row of the property list to see that land's card
    const mine = owned(state.cur), rows = propRows(mine.length);
    mine.slice(F.propScroll, F.propScroll + rows).forEach((i, r) => btn(PX + 14, PROP_Y + r * PROP_ROW_H, 250, PROP_ROW_H, '', () => { F.inspect = i; }, 'hidden'));
  }
  if (humanTurn()) buildTurnUI();
}
/** The buttons of the current player's turn: drawn when they play here, built unseen on the host
 * when a friend online plays, so the friend's act finds the same button. */
export function buildTurnUI() {
  const p = curP();
  const ax = L.cx, ay = L.rollY, by = L.btnY; // wide: the board's open centre; phone: the strip under the players
  // several people on this screen: the shake button says whose turn it is
  const named = !isGuest() && state.players.filter(q => q.kind === 'human' && !q.bankrupt).length > 1;
  const shakeLabel = (alone: string) => state.shaking ? 'Thả ra để ném!' : named ? `${p.name}: giữ để lắc` : alone;
  const sw = named ? 300 : 260;
  switch (state.phase) {
    case 'order': btn(ax - sw / 2, ay, sw, 58, shakeLabel('Giữ để lắc chọn lượt'), () => startShake(), 'primary', true, '#c8201f', 'shake'); break;
    case 'roll': btn(ax - sw / 2, ay, sw, 58, shakeLabel('Giữ để lắc xúc xắc'), () => startShake(), 'primary', true, '#c8201f', 'shake'); break;
    case 'jail': {
      btn(ax - 230, ay, 220, 54, state.shaking ? 'Thả ra để ném!' : 'Giữ lắc tìm đôi', () => startShake(), 'primary', true, '#c8201f', 'shake');
      if (p.freeCards.length > 0) btn(ax + 10, ay, 220, 54, 'Dùng thẻ ra tù', payJail, 'secondary', true, undefined, 'jailCard');
      break;
    }
    case 'buy': { const t = TILES[state.popup.tile]; btn(ax - 230, by, 220, 54, `Mua ${money(t.p!)}`, doBuy, 'primary', p.cash >= t.p!, '#2f8a3a', 'buy'); btn(ax + 10, by, 220, 54, 'Bỏ qua', () => { log(`${p.name} bỏ qua ${t.n}.`); skip(); }, 'secondary', true, undefined, 'skip'); break; }
    case 'build': {
      const i = state.popup.tile, to = state.level[i] + 1, cost = buildPrice(i, to);
      btn(ax - 230, by, 220, 54, `Xây ${LEVEL_NAMES[to]}: ${money(cost)}`, () => { doBuild(i); state.popup = null; afterAction(); }, 'primary', p.cash >= cost, '#2f8a3a', 'build');
      btn(ax + 10, by, 220, 54, 'Không xây', () => { state.popup = null; afterAction(); }, 'secondary', true, undefined, 'noBuild');
      break;
    }
    case 'card': btn(ax - 110, by, 220, 54, 'Đồng ý', applyCard, 'primary', true, '#c8201f', 'cardOk'); break;
    case 'rentShow': btn(ax - 110, by, 220, 54, 'Tiếp tục', () => { state.popup = null; afterAction(); }, 'primary', true, undefined, 'continue'); break;
    case 'rentChoice': {
      const pop = state.popup;
      btn(ax - 230, by, 220, 54, 'Dùng Thẻ Miễn Thuê', useNoRent, 'primary', true, '#2f8a3a', 'noRent');
      btn(ax + 10, by, 220, 54, `Trả ${money(pop.rent)}`, () => payRent(pop.tile, pop.rent, pop.owner), 'secondary', true, undefined, 'payRent');
      break;
    }
    case 'rerollChoice': {
      const n = state.popup.n;
      btn(ax - 230, by, 220, 54, 'Dùng Thẻ Đổ Lại', useReroll, 'primary', true, '#2f8a3a', 'reroll');
      btn(ax + 10, by, 220, 54, 'Đi tiếp', () => { state.popup = null; beginMove(n); }, 'secondary', true, undefined, 'goOn');
      break;
    }
    case 'pick': btn(ax - 110, by, 220, 54, `Bay tới ${TILES[state.pick].n}`, () => flyTo(state.pick), 'primary', true, '#2f8a3a', 'fly'); break;
    case 'debt': {
      const d = state.debt;
      btn(ax - (L.phone ? 232 : 255), by, L.phone ? 148 : 160, 54, 'Trả nợ', payDebt, 'primary', p.cash >= d.total, '#2f8a3a', 'payDebt');
      btn(ax - (L.phone ? 74 : 80), by, L.phone ? 148 : 160, 54, 'Tự bán bớt', () => { autoRaise(state.cur, d.total); }, '', liquidValue(state.cur) > 0, undefined, 'autoRaise');
      btn(ax + (L.phone ? 84 : 95), by, L.phone ? 148 : 160, 54, 'Phá sản', declareBankrupt, 'secondary', true, '#6a6a6a', 'bankrupt');
      break;
    }
    case 'end': btn(ax - 110, ay, 220, 58, 'Kết thúc lượt', nextTurn, 'primary', true, '#c8201f', 'endTurn'); break;
  }
  if (['roll', 'end', 'debt', 'jail'].includes(state.phase)) { if (L.phone) buildSheetButton(state.cur); else buildPropUI(state.cur); }
}
/** What a seat is, in the seat's button. */
/** Where the room code's button sits: the panel's top line, or the phone's header. */
export function roomPill(): { x: number; y: number; w: number; h: number } {
  return L.phone ? { x: W - 162, y: 9, w: 100, h: 32 } : { x: W - 186, y: 44, w: 126, h: 30 };
}
/** The room menu's two buttons, over everything. */
function buildRoomMenu() {
  const y = (L.phone ? 470 : 360) + 46;
  const go = isHost() ? 'Giải tán phòng' : 'Rời phòng';
  btn(L.cx - 210, y + 66, 420, 50, 'Bỏ phiếu chơi lại ván mới', startVote, 'menu', true, '#2b6cd6');
  btn(L.cx - 210, y, 200, 54, go, leaveRoom, 'menu', true, '#c8201f');
  btn(L.cx + 10, y, 200, 54, 'Ở lại', () => { F.roomMenu = false; }, 'menuSecondary', true, '#6a4a2a');
}
/** The room menu: what leaving does, then the two buttons. */
function drawRoomMenu() {
  if (!F.roomMenu || !roomCode) return;
  ctx.save(); ctx.fillStyle = 'rgba(10,5,3,0.6)'; ctx.fillRect(0, 0, W, H); ctx.restore();
  const y = L.phone ? 470 : 360;
  const say = isHost() ? [`Phòng ${roomCode}`, 'Giải tán phòng? Mọi người sẽ ra khỏi ván và về màn hình đầu.']
    : [`Phòng ${roomCode}`, 'Rời phòng? Máy sẽ chơi thay chỗ của bạn trong ván này.'];
  messageBox(say, L.cx, y - 40, 460);
  F.drawingMenu = true; F.ui.forEach(b => { if (b.role === 'menu' || b.role === 'menuSecondary') drawButton(b); }); F.drawingMenu = false;
}
export function seatLabel(s: Seat, i = -1): string {
  // online, seat 0 is the host's own seat
  if (s.kind === 'human' && i === 0 && (isHost() || isGuest())) return `Chủ phòng · ${(isHost() ? myName : lobby?.hostName) || 'chủ phòng'}`;
  if (s.kind === 'human') return 'Người chơi';
  if (s.kind === 'remote') return s.peer === undefined ? 'Chờ bạn online...' : `Online · ${s.name || 'Bạn'}${peerOnline(s.peer) || isGuest() ? '' : ' (đã rời)'}`;
  if (s.kind === 'ai') return `Máy · ${AI_LEVELS[s.lv!]}`;
  return 'Không chơi';
}
/** Starts the game from the title screen, when at least two seats play. */
function startGame() {
  F.picker = null;
  if (setup.seats.filter(s => s.kind !== 'off').length < 2) { F.netError = 'Cần ít nhất 2 người chơi để bắt đầu.'; sfx.click(); return; }
  if (setup.teams && setup.seats.some(s => s.kind === 'off')) { F.netError = 'Chơi 2 đội cần đủ 4 người.'; sfx.click(); return; }
  if (setup.teams && setup.teamOf.filter(t => t === 0).length !== 2) { F.netError = 'Chơi 2 đội: mỗi đội cần đúng 2 người.'; sfx.click(); return; }
  if (F.netError.startsWith('Cần ít nhất 2') || F.netError.startsWith('Chơi 2 đội')) F.netError = '';
  if (!isHost()) forgetLocalGame(); // a new game on this screen replaces the one left unfinished; an online game does not
  reset(); clearVis(); setScene('play');
}
/** Whether the title screen shows a team game: the host's choice, or what the host sent a friend. */
export const titleTeams = (): boolean => (isGuest() ? !!lobby?.teams : setup.teams);
/** A seat's animal on the title screen: the host's choice, or what the host sent a friend. */
export function seatAnimal(i: number): number {
  return isGuest() ? (lobby?.animals?.[i] ?? DEFAULT_ANIMALS[i]) : setup.animals[i];
}
/** Where a seat's animal sits on the title screen. */
function animalSpot(i: number): { x: number; y: number; r: number } {
  const T = titleSpots();
  return L.phone ? { x: 34, y: T.y0 + i * T.step + T.seatH / 2, r: 24 } : { x: BW / 2 - 260, y: 250 + i * 62 + 25, r: 26 };
}
/** Who may change this seat's animal here: the host or the one screen for every seat but a friend's;
 * a friend only their own. */
function canPickAnimal(i: number, s: Seat): boolean {
  if (isGuest()) return i === mySeat;
  return !(s.kind === 'remote' && peerOnline(s.peer));
}
/** A seat's animal in its round frame, with a small mark when a tap changes it. */
export function drawSeatAnimal(i: number, x: number, y: number, r: number, s: Seat) {
  const a = seatAnimal(i), off = s.kind === 'off';
  ctx.save(); ctx.globalAlpha = off ? 0.45 : 1;
  ctx.fillStyle = '#f4ead2'; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  ctx.strokeStyle = ANIMALS[a].color; ctx.lineWidth = 3; ctx.stroke();
  drawTokenIcon(a, x, y + 1, r * 1.55, ANIMALS[a].color);
  if (canPickAnimal(i, s) && !off) { // a little gold arrow: tap to change
    ctx.fillStyle = '#f2c44a'; ctx.beginPath(); ctx.arc(x + r * 0.8, y + r * 0.8, r * 0.36, 0, 7); ctx.fill();
    ctx.strokeStyle = '#5a2a1c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x + r * 0.8, y + r * 0.8, r * 0.18, -2.4, 1.6); ctx.stroke();
  }
  ctx.restore();
}
function buildTitleUI() {
  const T = titleSpots();
  (isGuest() ? (lobby ? lobby.seats as Seat[] : []) : setup.seats).forEach((s, i) => { // tap an animal: the list of animals
    if (!canPickAnimal(i, s) || s.kind === 'off') return;
    const c = animalSpot(i), anchor = { x: c.x - c.r - 4, y: c.y - c.r - 4, w: c.r * 2 + 8, h: c.r * 2 + 8 };
    btn(anchor.x, anchor.y, anchor.w, anchor.h, '', () => openAnimalPicker(i, anchor), 'hidden');
  });
  { const r = rulesSpot(); btn(r.x, r.y, r.w, r.h, 'Luật chơi', () => showRules(true), 'room'); }
  const b4 = (r: number[], label: string, fn: () => void, role: string, color: string) => btn(r[0], r[1], r[2], r[3], label, fn, role, true, color);
  if (isGuest()) { b4(T.leave, 'Rời phòng', leaveRoom, 'secondary', '#6a4a2a'); buildPicker(); return; }
  setup.seats.forEach((s, i) => {
    // online, the host plays seat 0, and a friend who is in the room keeps their seat
    const locked = isHost() && (i === 0 || (s.kind === 'remote' && peerOnline(s.peer)));
    const at = { x: T.seatX, y: T.y0 + i * T.step, w: T.seatW, h: T.seatH };
    btn(at.x, at.y, at.w, at.h, seatLabel(s, i) + (locked ? '' : ' ▾'), () => openSeatPicker(i, at), 'seat', !locked);
    if (setup.teams) { // the seat's team, between its animal and its kind
      const tp = teamSpot(i);
      btn(tp.x, tp.y, tp.w, tp.h, `${teamTag(setup.teamOf[i])} ▾`, () => openPicker(tp, [0, 1].map(t => ({ label: teamTag(t), value: t })), setup.teamOf[i], v => { setup.teamOf[i] = v as number; clearSetupNote(); sendLobby(); }), 'room');
    }
  });
  // the kind of game: two lists side by side, single or teams, and how long
  const kindY = T.y0 + 4 * T.step + T.modeDy, half = (T.seatW - 8) / 2;
  const single = { x: T.seatX, y: kindY, w: half, h: T.seatH }, length = { x: T.seatX + half + 8, y: kindY, w: half, h: T.seatH };
  btn(single.x, single.y, single.w, single.h, `${setup.teams ? 'Đội' : 'Đơn'} ▾`, () => openPicker(single, [{ label: 'Đơn', value: 0 }, { label: 'Đội (2 đấu 2)', value: 1 }], setup.teams ? 1 : 0, v => { setup.teams = v === 1; clearSetupNote(); sendLobby(); }), 'seat');
  const lengths = [{ label: `${tune.max_rounds} vòng`, value: 'r' + tune.max_rounds }, { label: `${tune.max_rounds_long} vòng`, value: 'r' + tune.max_rounds_long }, { label: 'Tới khi phá sản', value: 'bankrupt' }];
  const curLen = setup.mode === 'bankrupt' ? 'bankrupt' : 'r' + setup.rounds;
  btn(length.x, length.y, length.w, length.h, `${setup.mode === 'bankrupt' ? 'Phá sản' : `${setup.rounds} vòng`} ▾`, () => openPicker(length, lengths, curLen, v => {
    if (v === 'bankrupt') setup.mode = 'bankrupt'; else { setup.mode = 'rounds'; setup.rounds = Number(String(v).slice(1)); }
    sendLobby();
  }), 'seat');
  b4(T.start, L.phone ? 'Bắt đầu' : 'Bắt đầu (Enter)', startGame, 'primary', '#c8201f');
  if (isHost()) b4(T.online, `Giải tán phòng ${roomCode}`, leaveRoom, '', '#6a4a2a');
  else b4(T.online, 'Chơi online', () => showOnlinePanel(true), '', '#2b6cd6');
  const last = !isHost() && !isGuest() ? lastRoom() : null, kept = !isHost() && !isGuest() ? localGame() : null;
  if (kept) b4(T.rejoin, `Chơi tiếp ván trước (vòng ${kept.round})`, resumeLocalGame, '', '#2f8a3a');
  if (last) b4(kept ? T.rejoin2 : T.rejoin, `Vào lại phòng ${last.code}`, rejoinRoom, '', '#2f8a3a');
  buildPicker();
}
// ---- Fast forward ---------------------------------------------------------------------------
// A button runs the computer's turns at ×2 or ×4: its shake, its throw, its hops and its thinking.
// A person's turn always runs at its own pace. Online, the host's button sets it for everyone.
const SPEEDS = [1, 2, 4];
let gameSpeed = 1;
const checkedRun = CHECKED; // a check always runs at ×1
try { gameSpeed = !checkedRun && SPEEDS.includes(Number(localStorage.getItem('tpdv-speed'))) ? Number(localStorage.getItem('tpdv-speed')) : 1; } catch { gameSpeed = 1; }
/** How much faster this step runs: the computer's turns at the chosen speed, everything else at 1. */
function turnSpeed(): number {
  if (!state || !state.players || state.phase === 'over' || state.vote) return 1;
  const p = curP();
  const computer = isAI(p) || (p.kind === 'remote' && !peerOnline(p.peer));
  return computer ? gameSpeed : 1;
}
function cycleSpeed() {
  gameSpeed = SPEEDS[(SPEEDS.indexOf(gameSpeed) + 1) % SPEEDS.length];
  try { localStorage.setItem('tpdv-speed', String(gameSpeed)); } catch { /* not kept: fine */ }
}
/** Where the speed button sits: under the sound button, or beside the phone's property button. */
function speedSpot(): { x: number; y: number; w: number; h: number } {
  return L.phone ? { x: W - 116, y: L.btnY + 64, w: 104, h: 44 } : { x: W - 60, y: 48, w: 48, h: 26 };
}

// ---- Scenes ------------------------------------------------------------------------------
const scenes: Record<string, { update(dt: number): void; draw(): void }> = {
  figures: {
    update(dt: number) { state.t += dt; },
    draw() {
      clear('#2a1a10');
      render3D(); ctx.drawImage(renderer!.domElement, 0, 0, BW, H);
      for (const it of figItems) { const s = project(it.x, 0, it.z + 0.42, figCamera); text(it.name, s.x, s.y, 16, '#fff8e6', 'center', 'bold'); }
      lacquer(PX, 0, PW, H);
      text('Quân cờ, nhà và Landmark', PX + PW / 2, 40, 20, '#f2c44a', 'center', 'bold');
      ANIMALS.forEach((an, k) => { drawTokenIcon(k, PX + 50 + (k % 2) * 150, 100 + Math.floor(k / 2) * 56, 40, an.color); text(an.name, PX + 80 + (k % 2) * 150, 100 + Math.floor(k / 2) * 56, 18, '#fff8e6', 'left'); });
    },
  },
  title: {
    update(dt: number) { state.t += dt; buildUI(); handleInput(); },
    draw() {
      if (L.phone) { drawTitlePhone(); return; }
      clear('#1d120c');
      drawBoardView();
      ctx.fillStyle = 'rgba(20,10,6,0.55)'; ctx.fillRect(0, 0, BW, H);
      ctx.save(); ctx.fillStyle = 'rgba(30,12,8,0.9)'; rrect(ctx, BW / 2 - 330, 40, 660, 640, 20); ctx.fill(); ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
      text(TITLE.toUpperCase(), BW / 2, 100, 50, '#f2c44a', 'center', 'bold');
      text('Cờ tỷ phú trên bản đồ Việt Nam · 2 đến 4 người', BW / 2, 150, 19, '#e8d9b5');
      const hint = isGuest() ? (lobby ? `Phòng ${roomCode} · chờ ${lobby.hostName || 'chủ phòng'} bắt đầu ván` : `Đang vào phòng ${roomCode}...`)
        : isHost() ? `Gửi mã phòng ${roomCode} cho bạn bè: họ sẽ vào chỗ "Chờ bạn online"` : 'Bấm vào chỗ ngồi, con vật hay kiểu ván để chọn từ danh sách';
      text(hint, BW / 2, 200, 16, isGuest() || isHost() ? '#f2c44a' : '#cbb994');
      const seatsShown: Seat[] = isGuest() ? (lobby ? lobby.seats : []) : setup.seats;
      if (isGuest()) seatsShown.forEach((s, i) => { // a guest sees the seats, not their buttons
        const y = 250 + i * 62;
        ctx.save(); ctx.fillStyle = i === mySeat ? '#5a2a1c' : '#2c140f'; rrect(ctx, BW / 2 - 20, y, 300, 50, 12); ctx.fill();
        ctx.strokeStyle = i === mySeat ? '#f2c44a' : '#6a4a2a'; ctx.lineWidth = i === mySeat ? 3 : 1; ctx.stroke(); ctx.restore();
        text(seatLabel(s, i) + (i === mySeat ? ' (bạn)' : ''), BW / 2 + 130, y + 26, 18, '#fff8e6', 'center', 'bold');
      });
      if (isGuest() && lobby) text(kindLabel(lobby.mode, lobby.rounds ?? tune.max_rounds, true, !!lobby.teams), BW / 2 + 130, 250 + 4 * 62 + 35, 18, '#fff8e6', 'center', 'bold');
      seatsShown.forEach((s, i) => {
        const y = 250 + i * 62 + 25;
        drawSeatAnimal(i, BW / 2 - 300 + 40, y, 26, s);
        text(ANIMALS[seatAnimal(i)].name, BW / 2 - 300 + 78, y, 20, s.kind === 'off' ? '#7a6a5a' : '#fff8e6', 'left', 'bold');
        if (isGuest() && titleTeams()) text(teamTag(teamOfSeat(i)), BW / 2 - 77, y, 18, '#f2c44a', 'center', 'bold');
      });
      text('Kiểu ván', BW / 2 - 300 + 76, 250 + 4 * 62 + 35, 20, '#fff8e6', 'left', 'bold');
      F.ui.forEach(drawButton);
      drawNetBanner();
      lacquer(PX, 0, PW, H);
      text('Cách chơi', PX + PW / 2, 44, 24, '#f2c44a', 'center', 'bold');
      const rules = ['Đổ 2 xúc xắc, đi quân, mua đất trống.', 'Vòng đầu (tới khi qua Xuất Phát):', '   chưa mua đất, miễn thuế.', 'Bấm vào một ô bất kỳ để xem thông tin.', 'Dẫm lại đất của mình: xây thêm 1 cấp.', 'Cấp xây: Nhà 1 tới Nhà 4, Khách sạn, Landmark.', 'Gom đủ một nhóm màu: tiền thuê × 2.', 'Tiền 2 ô thuế dồn vào hũ giữa bàn.', 'Dừng ở Bến Đỗ Tự Do: lấy cả hũ.', 'Thiếu tiền: bán nhà, cầm cố đất.', 'Hết tiền: phá sản, bị loại.'];
      rules.forEach((r, j) => text(r, PX + 24, 86 + j * 29, 16, '#e8d9b5', 'left'));
      text('Phím', PX + PW / 2, 420, 22, '#f2c44a', 'center', 'bold');
      CONTROLS.forEach((c, i) => text(c, PX + 24, 460 + i * 32, 16, '#e8d9b5', 'left'));
      if (roomCode) { // the room code, big enough to read out to a friend
        ctx.save(); ctx.fillStyle = '#5a2a1c'; rrect(ctx, PX + 20, 590, PW - 40, 100, 14); ctx.fill(); ctx.strokeStyle = '#f2c44a'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
        text('MÃ PHÒNG', PX + PW / 2, 612, 16, '#e8d9b5', 'center', 'bold');
        text(roomCode, PX + PW / 2, 655, 44, '#f2c44a', 'center', 'bold');
      }
      F.ui.forEach(b => { if (b.role === 'room') drawButton(b); }); // the rules button sits on the panel
      drawPicker();
    },
  },
  play: {
    update(dt: number) {
      if (!isGuest()) state.t += dt;
      buildUI(); handleInput();
      if (scene !== 'play') return;
      { // the tile under the mouse lights up and the cursor says it can be clicked
        const onBtn = F.ui.some(b => b.role !== 'hidden' && pointer.x >= b.x && pointer.x <= b.x + b.w && pointer.y >= b.y && pointer.y <= b.y + b.h);
        const pt = inBoard(pointer.x, pointer.y) && !onBtn ? boardPointAt(pointer.x, pointer.y) : null;
        hoverTile = pt ? tileAt(pt.x, pt.z) : -1;
        canvas.style.cursor = hoverTile >= 0 || onBtn ? 'pointer' : 'default';
      }
      if (isGuest()) { updateTokens(dt); syncBuildings(dt); moodStep(dt); return; } // the host runs the turns
      const k = turnSpeed(); // the computer's turns can run faster
      updateTurn(dt * k);
      updateTokens(dt * k); syncBuildings(dt); moodStep(dt);
      keepLocalGame();
      if (state.event) state.event.t += dt;
      state.flash.t += dt;
      for (const f of state.floaters) f.t += dt;
      state.floaters = state.floaters.filter(f => f.t < 1.4);
    },
    draw() {
      clear('#1d120c');
      drawBoardView();
      if (L.phone) drawPhoneChrome(); // a wide screen's log is in the panel
      drawPotLabel();
      drawDiceFeel();
      drawPopup();
      if (!L.phone) drawPanel();
      if (F.sheetOpen) drawSheet();
      F.ui.forEach(drawButton);
      drawFloaters();
      drawInspect();
      drawNetBanner();
      drawEvent();
      drawTip();
      drawEmotes();
      drawEmoteMenu();
      drawRoomMenu();
      drawVote();
    },
  },
  results: {
    update(dt: number) {
      if (!isGuest()) state.t += dt;
      buildUI(); handleInput();
      updateTokens(dt); syncBuildings(dt); moodStep(dt);
      if (isGuest()) return;
      for (const f of state.floaters) f.t += dt; state.floaters = state.floaters.filter(f => f.t < 1.4);
    },
    draw() {
      if (L.phone) { drawResultsPhone(); return; }
      clear('#1d120c');
      drawBoardView();
      ctx.fillStyle = 'rgba(20,10,6,0.55)'; ctx.fillRect(0, 0, BW, H);
      ctx.save(); ctx.fillStyle = 'rgba(30,12,8,0.94)'; rrect(ctx, BW / 2 - 320, 70, 640, 580, 20); ctx.fill(); ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
      // a fanfare of drawn confetti
      for (let k = 0; k < 40; k++) {
        const x = BW / 2 - 300 + ((k * 137) % 600), y = 80 + ((k * 53 + state.t * 90 * (1 + k % 3)) % 560);
        ctx.fillStyle = PLAYER_COLORS[k % 4]; ctx.save(); ctx.translate(x, y); ctx.rotate(k + state.t * 3); ctx.fillRect(-5, -2, 10, 4); ctx.restore();
      }
      const w = state.players[state.ranking![0].i];
      text(state.reason || '', BW / 2, 112, 18, '#e8d9b5');
      ctx.fillStyle = '#f4ead2'; ctx.beginPath(); ctx.arc(BW / 2, 185, 44, 0, 7); ctx.fill();
      drawTokenIcon(w.token, BW / 2, 188, 72, w.color);
      text(state.gained, BW / 2, 262, 30, '#f2c44a', 'center', 'bold');
      state.ranking!.forEach((r, j) => {
        const p = state.players[r.i], y = 320 + j * 50;
        ctx.fillStyle = j === 0 ? '#5a2a1c' : '#2c140f'; rrect(ctx, BW / 2 - 260, y - 20, 520, 42, 8); ctx.fill();
        text(`${j + 1}.`, BW / 2 - 236, y, 20, '#f2c44a', 'center', 'bold');
        ctx.fillStyle = p.color; ctx.fillRect(BW / 2 - 214, y - 10, 12, 20);
        text(p.name + (state.teams ? ` · ${teamTag(p.team)}` : ''), BW / 2 - 194, y, 19, '#fff8e6', 'left', 'bold');
        text(r.bankrupt ? 'Phá sản' : `Tài sản ${money(r.worth)}`, BW / 2 + 246, y, 18, r.bankrupt ? '#ff9a8a' : '#e8d9b5', 'right');
      });
      F.ui.forEach(drawButton);
      drawPanel();
      drawSummary(PX + 14, 372, PW - 28, H - 16 - 372); // covers the panel's land list, which means little once the game is over
      drawVote();
    },
  },
};
function updateTurn(dt: number) {
  const p = curP();
  if (state.vote) return; // the table is voting: the game waits
  state.timer += dt;
  if (state.diceShow) state.diceShow.t += dt;
  if (state.shaking) {
    const sh = state.shaking; sh.t += dt; sh.rattle -= dt;
    if (sh.rattle <= 0) { sfx.rattle(sh.t); sh.rattle = 0.09; }
    const held = sh.ai ? sh.t < sh.holdFor : sh.remote ? !sh.released && peerOnline(p.peer) : (pointerHeld || down.has('Space') || down.has('Enter'));
    if (!held || sh.t > tune.shake_max_time) throwDice();
    return;
  }
  if (state.phase === 'dice') {
    state.diceT += dt;
    if (state.diceT >= state.diceDur!) afterDice();
    return;
  }
  if (state.diceT < (state.diceDur || tune.dice_time)) state.diceT += dt;
  if (state.phase === 'move') {
    const hopDur = state.hopFast ? tune.hop_time * 0.6 : tune.hop_time;
    state.hopT += dt;
    if (state.hopT >= hopDur) {
      state.hopT = 0;
      const pi = state.cur, from = p.pos;
      p.pos = (p.pos + state.moveDir + 40) % 40;
      hop(pi, from, p.pos, hopDur * 0.95);
      sfx.tick();
      if (p.pos === 0 && state.moveDir > 0) p.laps++;
      if (p.pos === 0 && state.moveDir > 0 && p.noSalary) { p.noSalary = false; floatAtToken(pi, 'Mất lương!', '#ff5a4a'); log(`${p.name} qua Xuất Phát nhưng không được nhận lương (thẻ vào tù).`); sfx.pay(); }
      else if (p.pos === 0 && state.moveDir > 0) { const pay = salaryNow(); gain(pi, pay, `${p.name} qua Xuất Phát: nhận lương ${money(pay)}${pay !== tune.salary ? ' (Tết: lương × 2)' : ''}.`); }
      state.moveLeft--;
      if (state.moveLeft <= 0) { state.phase = 'landing'; state.timer = 0; }
    }
    return;
  }
  if (state.phase === 'landing') { if (state.timer >= 0.25) resolveLanding(); return; }
  if (state.phase === 'orderShow') { if (state.timer >= tune.order_show_time) nextOrderThrow(); return; }
  const auto = isAI(p) || (p.kind === 'remote' && !peerOnline(p.peer));
  if (auto && state.phase !== 'over' && state.timer >= tune.ai_delay) { state.timer = 0; aiAct(); }
}

// ---- Loop: fixed step, frame time clamped ---------------------------------------------
function step() {
  if (pressed('KeyM')) { setMuted(!muted()); hit.delete('KeyM'); }
  scenes[scene].update(STEP); netStep(); hit.clear();
}
let last = 0, acc = 0;
function tick() {
  const now = clock.now();
  acc += Math.min(now - last, isHost() ? 1 : 0.25); last = now;
  while (acc >= STEP) { step(); acc -= STEP; }
  drawFrame();
}
function drawFrame() { scenes[scene].draw(); }
function frame() { tick(); requestAnimationFrame(frame); }
function timer() { if ((document.visibilityState === 'visible' || isHost()) && clock.now() - last > 0.1) tick(); }

// ---- What a check can read and drive (?manual=1 stops the loop; players never see it) ----
install({
  get scene() { return scene; },
  get state() { return state; },
  press(code: string) { hit.add(code); },
  hold(code: string, on: boolean) { if (on) down.add(code); else down.delete(code); },
  get events() { return events; },
  /** For checks and the balance tools: the seats, the kind of game, the seed and tuning values for the next game, and
   * back to the title screen, where Enter starts it. */
  configure(o: { seats?: Seat[]; mode?: 'bankrupt' | 'rounds'; rounds?: number; teams?: boolean; teamOf?: number[]; seed?: number; tune?: Record<string, number> }) {
    for (const [k, v] of Object.entries(o.tune || {})) if (CONFIG[k] && typeof v === 'number') CONFIG[k].value = v; // try other values
    if (o.seats) setup.seats = o.seats.map(x => ({ ...x }));
    if (o.mode) setup.mode = o.mode;
    if (o.rounds) setup.rounds = o.rounds;
    if (o.teams !== undefined) setup.teams = o.teams;
    if (o.teamOf) setup.teamOf = [...o.teamOf];
    F.picker = null;
    if (o.seed !== undefined) checkSeed = o.seed;
    setScene('title'); clearVis();
  },
  get view() { return { inspect: F.inspect, tip: tipNow, picker: F.picker ? F.picker.items.map((it, k) => ({ label: it.label, enabled: it.enabled !== false, ...F.picker!.rects[k] })) : null }; },
  get online() {
    return { role: net.getRole(), code: roomCode, mySeat, seats: isGuest() ? lobby?.seats ?? null : setup.seats, animals: isGuest() ? lobby?.animals ?? null : setup.animals, mode: isGuest() ? lobby?.mode ?? null : setup.mode, rounds: isGuest() ? lobby?.rounds ?? null : setup.rounds, teams: isGuest() ? !!lobby?.teams : setup.teams };
  },
  step(n = 1, draw = true, _alpha = 1) {
    for (let i = 0; i < n; i++) step();
    if (draw) drawFrame();
  },
} as Parameters<typeof install>[0]);

fit();
build3D();
reset();
setScene(params.get('scene') || 'title');
if (scene === 'play') clearVis();
last = clock.now();
if (params.get('manual') === '1') drawFrame();
else { requestAnimationFrame(frame); setInterval(timer, 50); }
