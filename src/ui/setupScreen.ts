// The setup screen's dropdowns: seats, animals, teams, the kind of game.

import { tune } from '../config';

import { sfx } from '../audio';
import * as net from '../net/net';
import { W, H, FONT, ctx, text, rrect } from '../screen';

import { TILES, ANIMALS, AI_LEVELS } from '../game/data';

import { tileAt } from '../game/board';

import { state, scene, setup } from '../core/store';

import type { Loose, Seat } from '../game/types';

import { owned, setAnimal, sellLevel, mortgage, unmortgage, flyTo } from '../game/turn';

import { rawSfx, sendAct, onlinePanel, isGuest, isHost, sendLobby, linkUp, hostOnline, roomCode, lobby } from '../net/room';
import { F } from '../core/flags';

import { resetCoins, lastPos, tileShown, boardPointAt, tokVis, tokAnim, riseAnims } from '../three/scene3d';
import { pointer, seatAnimal, PX, clicks, inBoard, pressed, btn, L, PW, humanTurn } from '../main';
import { drawTokenIcon, messageBox, PROP_Y, PROP_ROW_H, propMaxRows, propArrowY } from './draw';
import { titleSpots } from './phone';
import { moods, moodPrev } from '../three/moods';

// ---- Dropdowns on the setup screen ----------------------------------------------------------------
// A tap on a choice opens its list just under it (above when there is no room); a tap on an item picks
// it, a tap anywhere else closes the list. Items the player cannot take (an animal another seat has) show
// dimmed. Drawn on the canvas like everything else, so it looks the same on a phone.
export type PickItem = { label: string; value: number | string; enabled?: boolean; animal?: number };
/** Opens a list under the anchor button. */
export function openPicker(anchor: { x: number; y: number; w: number; h: number }, items: PickItem[], current: number | string, onPick: (v: number | string) => void, cols = 1) {
  const itemH = 44, rows = Math.ceil(items.length / cols), h = rows * itemH + 10;
  const w = Math.min(W - 16, Math.max(anchor.w, cols > 1 ? cols * 140 + 10 : 160));
  const x = Math.max(8, Math.min(anchor.x, W - 8 - w));
  let y = anchor.y + anchor.h + 4;
  if (y + h > H - 8) y = Math.max(8, anchor.y - 4 - h);
  const cw = (w - 10) / cols;
  const rects = items.map((_, k) => ({ x: x + 5 + (k % cols) * cw, y: y + 5 + Math.floor(k / cols) * itemH, w: cw, h: itemH }));
  F.picker = { x, y, w, cols, itemH, items, current, onPick, rects };
  sfx.click();
}
/** The list's taps, in front of every other button: its items, then the rest of the screen to close it. */
export function buildPicker() {
  if (!F.picker) return;
  const pk = F.picker, saved = F.ui; F.ui = [];
  pk.items.forEach((it, k) => { const r = pk.rects[k]; btn(r.x, r.y, r.w, r.h, '', () => { F.picker = null; pk.onPick(it.value); }, 'hidden', it.enabled !== false); });
  btn(pk.x, pk.y, pk.w, pk.rects.length ? pk.rects[pk.rects.length - 1].y + pk.itemH + 5 - pk.y : 0, '', () => { /* the list's own frame */ }, 'hidden');
  btn(0, 0, W, H, '', () => { F.picker = null; }, 'hidden');
  F.ui = [...F.ui, ...saved];
}
export function drawPicker() {
  if (!F.picker) return;
  const pk = F.picker, last = pk.rects[pk.rects.length - 1], h = last.y + pk.itemH + 5 - pk.y;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; rrect(ctx, pk.x + 4, pk.y + 6, pk.w, h, 12); ctx.fill();
  ctx.fillStyle = '#2c140f'; rrect(ctx, pk.x, pk.y, pk.w, h, 12); ctx.fill(); ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 2; ctx.stroke();
  pk.items.forEach((it, k) => {
    const r = pk.rects[k], on = it.value === pk.current, ok = it.enabled !== false;
    const hover = pointer.x >= r.x && pointer.x <= r.x + r.w && pointer.y >= r.y && pointer.y <= r.y + r.h;
    if (on || (hover && ok)) { ctx.fillStyle = on ? '#5a2a1c' : 'rgba(255,255,255,0.08)'; rrect(ctx, r.x + 2, r.y + 2, r.w - 4, r.h - 4, 8); ctx.fill(); }
    ctx.globalAlpha = ok ? 1 : 0.35;
    if (it.animal !== undefined) {
      ctx.fillStyle = '#f4ead2'; ctx.beginPath(); ctx.arc(r.x + 22, r.y + r.h / 2, 17, 0, 7); ctx.fill();
      drawTokenIcon(it.animal, r.x + 22, r.y + r.h / 2 + 1, 28, ANIMALS[it.animal].color);
      text(it.label, r.x + 46, r.y + r.h / 2, 16, on ? '#f2c44a' : '#fff8e6', 'left', 'bold');
    } else text(it.label, r.x + 14, r.y + r.h / 2, 17, on ? '#f2c44a' : '#fff8e6', 'left', 'bold');
    ctx.globalAlpha = 1;
  });
  ctx.restore();
}
/** The list of what a seat can be: a person, a friend online (a host), a computer, or empty (not seat 1). */
export function openSeatPicker(i: number, at: { x: number; y: number; w: number; h: number }) {
  const s = setup.seats[i], cur = s.kind === 'ai' ? 'ai' + s.lv : s.kind;
  const items: PickItem[] = [{ label: 'Người chơi', value: 'human' }];
  if (isHost()) items.push({ label: 'Chờ bạn online', value: 'remote' });
  AI_LEVELS.forEach((n, lv) => items.push({ label: `Máy · ${n}`, value: 'ai' + lv }));
  if (i > 0) items.push({ label: 'Không chơi', value: 'off' });
  openPicker(at, items, cur, v => {
    const k = String(v);
    setup.seats[i] = k.startsWith('ai') ? { kind: 'ai', lv: Number(k[2]) } : { kind: k as Seat['kind'] };
    clearSetupNote(); sendLobby();
  });
}
/** The list of the twelve animals; the ones other seats have are dimmed. */
export function openAnimalPicker(i: number, at: { x: number; y: number; w: number; h: number }) {
  const mine = seatAnimal(i), taken = new Set([0, 1, 2, 3].filter(k => k !== i).map(seatAnimal));
  const items: PickItem[] = ANIMALS.map((an, a) => ({ label: an.name, value: a, animal: a, enabled: !taken.has(a) }));
  openPicker(at, items, mine, v => { if (isGuest()) sendAct('animalSet', v as number); else { setAnimal(i, v); rawSfx.animal(v as number); } }, L.phone ? 2 : 3);
}
/** Where a seat's team choice sits: between its animal's name and its kind. */
export function teamSpot(i: number): { x: number; y: number; w: number; h: number } {
  const T = titleSpots(), y = T.y0 + i * T.step + (T.seatH - 34) / 2;
  return L.phone ? { x: T.seatX - 96, y, w: 88, h: 34 } : { x: T.seatX - 104, y, w: 94, h: 34 };
}
/** The seats changed: the note about too few players (or uneven teams) goes. */
export function clearSetupNote() { if (F.netError.startsWith('Cần ít nhất 2') || F.netError.startsWith('Chơi 2 đội')) F.netError = ''; }
/** One centred line of text, its font made smaller (down to 10 px) until it fits maxW. */
export function fitText(s: string, x: number, y: number, maxW: number, size: number, color: string, weight = 'bold') {
  let sz = size;
  ctx.save(); ctx.font = `${weight} ${sz}px ${FONT}`;
  while (sz > 10 && ctx.measureText(s).width > maxW) { sz--; ctx.font = `${weight} ${sz}px ${FONT}`; }
  ctx.restore();
  text(s, x, y, sz, color, 'center', weight);
}
/** A line about the connection, over the board, when something is wrong with it. */
/** The note while a room opens and the room server wakes: a count from 30 seconds, then a promise. */
function roomWaitText(): string {
  const since = net.connectingSince();
  const left = since ? Math.ceil(ROOM_WAIT - (performance.now() - since) / 1000) : ROOM_WAIT;
  return left > 0 ? `Đang mở phòng, máy chủ đang thức dậy... ${left}` : 'Đang chuẩn bị bàn cờ, sắp xong rồi...';
}
/** How long the note counts down for: about how long a sleeping free Render service takes to wake. */
const ROOM_WAIT = 30;
export function drawNetBanner() {
  let msg = '';
  if (net.getRole() !== 'off' && !linkUp) msg = roomCode || isGuest() && lobby ? 'Mất kết nối mạng, đang nối lại...' : roomWaitText();
  else if (isGuest() && !hostOnline) msg = 'Chủ phòng mất kết nối, đang chờ quay lại...';
  else if (F.netError && !(onlinePanel && onlinePanel.style.display === 'flex')) msg = F.netError;
  if (msg) messageBox([msg], L.cx, Math.min(L.bannerY, H - 44), 620); // a tall phone's banner stays on the screen
}
export function clearVis() { moods.length = 0; moodPrev.length = 0; F.inspect = -1; lastPos.length = 0; tokVis.length = 0; tokAnim.length = 0; for (let i = 0; i < 40; i++) tileShown[i] = -1; riseAnims.length = 0; resetCoins(); }
export function buildPropUI(pi: number) {
  const mine = owned(pi);
  const rowH = PROP_ROW_H, y0 = PROP_Y, rows = propMaxRows();
  F.propScroll = Math.max(0, Math.min(F.propScroll, mine.length - rows));
  mine.slice(F.propScroll, F.propScroll + rows).forEach((i, r) => {
    const y = y0 + r * rowH, p = state.players[pi];
    if (state.level[i] > 0) btn(W - 104, y + 3, 92, 24, 'Bán 1 cấp', () => sellLevel(pi, i), 'row', true, undefined, `sell:${i}`);
    else if (state.mort[i]) btn(W - 104, y + 3, 92, 24, 'Chuộc', () => unmortgage(pi, i), 'row', p.cash >= TILES[i].p! * tune.unmortgage_pct, undefined, `unmort:${i}`);
    else btn(W - 104, y + 3, 92, 24, 'Cầm cố', () => mortgage(pi, i), 'row', true, undefined, `mort:${i}`);
  });
  if (mine.length > rows) {
    btn(PX + PW / 2 - 70, propArrowY(mine.length), 60, 20, 'up', () => { F.propScroll = Math.max(0, F.propScroll - rows); }, 'arrowUp', F.propScroll > 0);
    btn(PX + PW / 2 + 10, propArrowY(mine.length), 60, 20, 'down', () => { F.propScroll += rows; }, 'arrowDown', F.propScroll + rows < mine.length);
  }
}
/** A button pressed here: a guest sends its act to the host; everyone else runs it. */
function pressBtn(b: Loose) {
  sfx.click();
  if (isGuest() && b.act) { sendAct(b.act); if (b.act === 'shake') { F.guestShaking = true; F.guestShakeAt = performance.now() / 1000; } return; }
  b.fn();
}
/** The same for an act with no button (picking a tile with the plane ticket). */
function pressAct(act: string, run: () => void) {
  if (isGuest()) sendAct(act); else run();
}
function pickTile(i: number) {
  if (isGuest()) sendAct('pick', i); else state.pick = i;
}
export function handleInput() {
  // One button per step: the buttons were built for the state before the press, so a second press in
  // the same step (a double tap on a slow frame, a tap and Space) would act on a state that has moved
  // on: "Kết thúc lượt" twice skipped the next player, "Mua" twice bought with no popup.
  let pressedOne = false;
  for (const c of clicks) {
    const b = F.ui.find(b => c.x >= b.x && c.x <= b.x + b.w && c.y >= b.y && c.y <= b.y + b.h);
    if (b) { if (b.enabled && !pressedOne) { pressBtn(b); pressedOne = true; } continue; }
    if (F.roomMenu) continue; // the room menu is open: only its buttons answer
    if (scene === 'play' && F.inspect >= 0) { F.inspect = -1; continue; } // a tile card is open: a tap anywhere closes it, and opens nothing
    if (scene === 'play' && state.phase === 'pick' && humanTurn() && inBoard(c.x, c.y)) {
      const pt = boardPointAt(c.x, c.y);
      if (pt) { const i = tileAt(pt.x, pt.z); if (i >= 0) { if (i === state.pick) pressAct('fly', () => flyTo(i)); else pickTile(i); } }
    } else if (scene === 'play' && inBoard(c.x, c.y)) { // anywhere else on the board: open that tile's card
      const pt = boardPointAt(c.x, c.y), i = pt ? tileAt(pt.x, pt.z) : -1;
      if (i >= 0) { F.inspect = i; sfx.card(); }
    }
  }
  clicks.length = 0;
  if (F.inspect >= 0 && (pressed('Space') || pressed('Enter') || pressed('Escape') || pressed('KeyN'))) { F.inspect = -1; return; }
  if (F.wheel && scene === 'play') { F.propScroll = Math.max(0, F.propScroll + F.wheel); F.wheel = 0; }
  if (F.picker && (pressed('Space') || pressed('Enter') || pressed('Escape'))) { F.picker = null; return; } // a list open: the keys close it
  if (pressedOne) return; // a tap pressed a button this step: the keys wait for the next one
  if (pressed('Space') || pressed('Enter')) { const b = F.ui.find(b => b.role === 'primary' && b.enabled); if (b) { pressBtn(b); return; } }
  if (pressed('KeyN') || pressed('Escape')) { const b = F.ui.find(b => (b.role === 'secondary' || b.role === 'menuSecondary') && b.enabled); if (b) { pressBtn(b); return; } }
  if (scene === 'play' && state.phase === 'pick' && humanTurn()) {
    if (pressed('ArrowRight') || pressed('ArrowUp')) pickTile((state.pick + 1) % 40);
    if (pressed('ArrowLeft') || pressed('ArrowDown')) pickTile((state.pick + 39) % 40);
  }
}

