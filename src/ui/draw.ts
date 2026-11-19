// 2D drawing over the 3D view: buttons, the side panel, tile cards, popups, the log, the dice feel.

import { tune } from '../config';

import { W, H, BW, FONT, ctx, text, rrect, wrapLines, screenScale } from '../screen';

import { GROUPS, TILES, OWNABLE, LEVEL_NAMES, LEVEL_SHORT, MAX_LEVEL, AI_LEVELS } from '../game/data';
import { drawAnimalIcon, type IconMood } from '../animals';
import { BOARD_TOP } from '../game/board';

import { state, scene } from '../core/store';

import { icon, star } from '../draw/icons';

import { buyHint, money, rentHint } from '../game/rules';
import type { Loose, Player, Tile } from '../game/types';

import { owned, rentOf, shakePower, teamTag, maxRounds, hasKeep, rentPct, drawOrder, ownsGroup, curP, isAI, firstLap } from '../game/turn';

import { roomCode, isGuest } from '../net/room';
import { meterPos } from '../game/dice';
import { drawGauge } from './gameChrome';
import { F } from '../core/flags';
import { CHIBI, themeCanvas } from '../core/theme';

import { render3D, project, dice3, POT_X, renderer, POT_Z } from '../three/scene3d';
import { fitText } from '../ui/setupScreen';
import { muted, L, pointer, PX, PW, humanTurn, shakeShown } from '../main';
import { rowSpot } from './phone';

// ---- 2D drawing ----------------------------------------------------------------------
export function drawBoardView() { render3D(); ctx.drawImage(renderer!.domElement, L.bx, L.by, L.bw, L.bh); }
export function lacquer(x: number, y: number, w: number, h: number) { // sơn mài: deep red-black lacquer with a gold trim (chibi: a cream wooden sign)
  const g = ctx.createLinearGradient(x, y, x, y + h);
  if (CHIBI) { g.addColorStop(0, '#fff3d6'); g.addColorStop(1, '#f7dfb0'); } else { g.addColorStop(0, '#3b1712'); g.addColorStop(1, '#1f0c09'); }
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 2; ctx.strokeRect(x + 6, y + 6, w - 12, h - 12);
}
export function drawButton(b: Loose) {
  if (b.role === 'mute') { drawSpeaker(b); return; }
  if (b.role === 'hidden' || (b.role === 'close' && !F.drawingInspect)) return;
  if ((b.role === 'menu' || b.role === 'menuSecondary') && !F.drawingMenu) return;
  if (b.role === 'room') { // the room code: a small gold pill
    ctx.save(); ctx.fillStyle = '#5a2a1c'; rrect(ctx, b.x, b.y, b.w, b.h, b.h / 2); ctx.fill();
    ctx.strokeStyle = '#f2c44a'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
    text(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1, L.phone ? 15 : 15, '#f2c44a', 'center', 'bold');
    return;
  }
  const hover = pointer.x >= b.x && pointer.x <= b.x + b.w && pointer.y >= b.y && pointer.y <= b.y + b.h;
  ctx.save();
  if (b.role === 'arrowUp' || b.role === 'arrowDown') {
    ctx.fillStyle = b.enabled ? '#c9a24a' : '#5a4a3a'; ctx.beginPath();
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2, up = b.role === 'arrowUp';
    ctx.moveTo(cx - 12, cy + (up ? 6 : -6)); ctx.lineTo(cx + 12, cy + (up ? 6 : -6)); ctx.lineTo(cx, cy + (up ? -7 : 7)); ctx.closePath(); ctx.fill();
    ctx.restore(); return;
  }
  const base = b.color || (b.role === 'seat' ? '#f4ead2' : b.role === 'row' ? '#6a4a2a' : '#8a5a2a');
  ctx.globalAlpha = b.enabled ? 1 : 0.45;
  if (b.role !== 'row') { ctx.fillStyle = 'rgba(0,0,0,0.35)'; rrect(ctx, b.x, b.y + 4, b.w, b.h, 12); ctx.fill(); }
  ctx.fillStyle = base; rrect(ctx, b.x, b.y, b.w, b.h, b.role === 'row' ? 6 : 12); ctx.fill();
  if (hover && b.enabled) { ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fill(); }
  ctx.strokeStyle = b.role === 'seat' ? '#5a3d2b' : '#f2c44a'; ctx.lineWidth = b.role === 'row' ? 1 : 2; ctx.stroke();
  const pulse = b.role === 'primary' && b.enabled && scene === 'play' ? 0.5 + 0.5 * Math.sin(state.t * 5) : 0;
  if (pulse) { ctx.strokeStyle = `rgba(255,236,150,${0.3 + 0.6 * pulse})`; ctx.lineWidth = 4; rrect(ctx, b.x - 3, b.y - 3, b.w + 6, b.h + 6, 14); ctx.stroke(); }
  const fs = b.role === 'row' ? 14 : b.h >= 54 ? 21 : 19;
  text(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1, fs, b.role === 'seat' ? '#2b1d12' : '#fff8e6', 'center', 'bold');
  ctx.restore();
}
function drawSpeaker(b: Loose) {
  ctx.save(); ctx.translate(b.x + 8, b.y + b.h / 2);
  ctx.fillStyle = '#e8d9b5'; ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(6, -5); ctx.lineTo(13, -11); ctx.lineTo(13, 11); ctx.lineTo(6, 5); ctx.lineTo(0, 5); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#e8d9b5'; ctx.lineWidth = 2.5;
  if (muted()) { ctx.beginPath(); ctx.moveTo(17, -6); ctx.lineTo(27, 6); ctx.moveTo(27, -6); ctx.lineTo(17, 6); ctx.stroke(); }
  else { ctx.beginPath(); ctx.arc(14, 0, 7, -0.9, 0.9); ctx.stroke(); ctx.beginPath(); ctx.arc(14, 0, 12, -0.9, 0.9); ctx.stroke(); }
  ctx.restore();
}
/** A piece's face for the HUD: its zodiac animal (src/animals.ts). */
export function drawTokenIcon(animal: number, x: number, y: number, s: number, color: string, mood?: IconMood) {
  // drawn once into a small canvas at the screen's pixel size, then copied: the cards show the same faces every frame
  const px = Math.max(1, Math.round(s * 1.6 * screenScale)), key = `${animal}|${color}|${mood ?? ''}|${px}`;
  let c = iconCache.get(key);
  if (!c) {
    c = document.createElement('canvas'); c.width = c.height = px;
    const g = c.getContext('2d')!; themeCanvas(g); // the look's colours, as on the screen
    g.scale(px / (s * 1.6), px / (s * 1.6)); drawAnimalIcon(g, animal, s * 0.8, s * 0.8, s, color, mood);
    if (iconCache.size > 200) iconCache.clear();
    iconCache.set(key, c);
  }
  ctx.drawImage(c, x - s * 0.8, y - s * 0.8, s * 1.6, s * 1.6);
}
const iconCache = new Map<string, HTMLCanvasElement>();
/** How long a player's animal keeps its happy or sad face after money moves (seconds). */
const FACE_TIME = 2.5;
/** The face a player's animal makes on their card now: the last money for a moment, else asleep in jail. */
export function faceOf(p: Player): IconMood | undefined {
  if (p.face && state.t - p.face.at < FACE_TIME) return p.face.k;
  return p.inJail && !p.bankrupt ? 'sleep' : undefined;
}
export function drawPanel() {
  lacquer(PX, 0, PW, H);
  fitText('CỜ TỶ PHÚ', PX + 254, 30, 136, 22, '#f2c44a', 'bold'); // the game's name, as Cá Ngựa and Rắn và Thang show theirs: between "Luật" and the speaker
  const roundTxt = state.mode === 'rounds' ? `Vòng ${Math.min(state.round, maxRounds())} / ${maxRounds()}` : `Vòng ${state.round} · tới khi phá sản`;
  if (roomCode) text(state.mode === 'rounds' ? `Vòng ${Math.min(state.round, maxRounds())}/${maxRounds()}` : `Vòng ${state.round}`, PX + 24, 59, 16, '#e8d9b5', 'left');
  else text(roundTxt, PX + PW / 2, 58, 16, '#e8d9b5');
  state.players.forEach((p, pi) => {
    const y = 76 + pi * 72, cur = pi === state.cur && state.phase !== 'over';
    ctx.save();
    ctx.globalAlpha = p.bankrupt ? 0.45 : 1;
    ctx.fillStyle = cur ? '#5a2a1c' : '#2c140f'; rrect(ctx, PX + 14, y, PW - 28, 64, 10); ctx.fill();
    ctx.strokeStyle = cur ? '#f2c44a' : '#6a4a2a'; ctx.lineWidth = cur ? 3 : 1; ctx.stroke();
    ctx.fillStyle = p.color; rrect(ctx, PX + 14, y, 8, 64, 4); ctx.fill();
    ctx.fillStyle = '#f4ead2'; ctx.beginPath(); ctx.arc(PX + 52, y + 32, 22, 0, 7); ctx.fill();
    drawTokenIcon(p.token, PX + 52, y + 34, 38, p.color, faceOf(p));
    const cash = money(p.cash);
    ctx.font = `bold 18px ${FONT}`; const cashW = ctx.measureText(cash).width;
    text(clipText(p.name, PW - 84 - 26 - cashW - 12, `bold 18px ${FONT}`), PX + 84, y + 18, 18, '#fff8e6', 'left', 'bold'); // clear of the money (Bug: a long name ran under it)
    const sub = (state.teams ? `${teamTag(p.team)} · ` : '') + (isAI(p) ? `Máy ${AI_LEVELS[p.lv]}` : p.kind === 'remote' ? (p.offline ? 'Online · mất kết nối' : 'Online') : 'Người chơi') + ` · ${owned(pi).length} ô` + (firstLap(p) && !p.bankrupt ? ' · vòng đầu' : '') + (p.inJail ? ' · trong tù' : '') + (p.noSalary ? ' · mất lương' : '') + (p.freeCards.length ? ' · có thẻ ra tù' : '') + (hasKeep(p, 'norent') ? ' · thẻ miễn thuê' : '') + (hasKeep(p, 'reroll') ? ' · thẻ đổ lại' : '') + (p.bankrupt ? ' · phá sản' : '');
    const subW = PW - 84 - 22; let subSz = 15; // the status line inside the card: smaller, then cut (Bug: "· có thẻ ra tù" fell off the panel)
    ctx.font = `${subSz}px ${FONT}`; while (subSz > 12 && ctx.measureText(sub).width > subW) { subSz--; ctx.font = `${subSz}px ${FONT}`; }
    text(clipText(sub, subW, `${subSz}px ${FONT}`), PX + 84, y + 45, subSz, '#d9c8a6', 'left');
    text(cash, PX + PW - 26, y + 18, 18, p.cash < 0 ? '#ff8a7a' : '#f2c44a', 'right', 'bold');
    ctx.restore();
  });
  // the property list for the person whose turn it is
  const pi = state.cur, p = curP(), mine = owned(pi);
  const y0 = 370;
  text(humanTurn() ? 'Tài sản của bạn' : `Tài sản của ${p.name}`, PX + 22, y0 + 14, 17, '#f2c44a', 'left', 'bold');
  if (!mine.length) text('Chưa có ô đất nào.', PX + 22, y0 + 48, 15, '#d9c8a6', 'left');
  const rowH = PROP_ROW_H, rows = propRows(mine.length);
  mine.slice(F.propScroll, F.propScroll + rows).forEach((i, r) => {
    const y = PROP_Y + r * rowH, t = TILES[i];
    ctx.fillStyle = r % 2 ? '#2c140f' : '#34180f'; ctx.fillRect(PX + 14, y, PW - 28, rowH);
    ctx.fillStyle = t.t === 'prop' ? GROUPS[t.g!].color : '#9a8a6a'; ctx.fillRect(PX + 20, y + 7, 14, 16);
    text(t.n, PX + 42, y + 15, 15, state.mort[i] ? '#9a8a7a' : '#fff8e6', 'left');
    const tag = state.mort[i] ? 'cầm cố' : LEVEL_SHORT[state.level[i]];
    if (tag) text(tag, PX + 230, y + 15, 14, state.mort[i] ? '#ff9a8a' : '#7ee08a', 'center', 'bold');
  });
  drawPanelLog(panelLogTop(mine.length));
}
/** The wide panel's property list: where its rows start, how tall each is, and at most how many show
 * (more scroll), so the log under it keeps room. */
export const PROP_Y = 400, PROP_ROW_H = 30, PROP_MAX_ROWS = 6;
/** How many property rows the panel shows for a player with n lands. */
/** At most how many property rows show now: fewer while the shake button sits at the panel's foot, so the log
 * keeps a few lines (Bug 19/11/2026: with 6 lands and the button, the log was 6 px tall and its lines gone). */
export const propMaxRows = (): number => (shakeShown() ? 3 : PROP_MAX_ROWS);
export const propRows = (n: number): number => Math.min(n, propMaxRows());
/** Where the scroll arrows sit: under the last row. */
export const propArrowY = (n: number): number => PROP_Y + propRows(n) * PROP_ROW_H + 4;
/** Where the log starts: under the list (or its empty note) and its arrows. */
const panelLogTop = (n: number): number => PROP_Y + Math.max(1, propRows(n)) * PROP_ROW_H + (n > propMaxRows() ? 30 : 0) + 14;
/** The game's latest lines, newest at the top (as in Cá Ngựa and Rắn và Thang), filling the panel down to its foot. */
function drawPanelLog(top: number) {
  const x = PX + 14, w = PW - 28, bottom = H - 16 - (shakeShown() ? 74 : 0), lineH = 20; // above the shake button when it shows
  ctx.save(); ctx.fillStyle = 'rgba(10,5,3,0.35)'; rrect(ctx, x, top, w, bottom - top, 8); ctx.fill(); ctx.restore();
  text('Diễn biến', x + 8, top + 14, 15, '#f2c44a', 'left', 'bold');
  ctx.save(); ctx.font = `14px ${FONT}`;
  const room = Math.floor((bottom - top - 34) / lineH), lines: { s: string; last: boolean }[] = [];
  for (let k = state.log.length - 1; k >= 0 && lines.length < room; k--) {
    const wrapped = wrapLines(ctx, state.log[k], w - 20);
    for (let j = 0; j < wrapped.length && lines.length < room; j++) lines.push({ s: wrapped[j], last: k === state.log.length - 1 });
  }
  ctx.restore();
  lines.forEach((l, j) => text(l.s, x + 10, top + 38 + j * lineH, 14, l.last ? '#fff8e6' : '#cbb994', 'left'));
}
export function drawDiceFeel() {
  // the power gauge in the middle of the board: from the moment it is this screen's throw (its zone to see), and while shaking
  const gx = L.cx, gy = L.phone ? L.by + L.bh * 0.62 : L.bh * 0.5 + 50; // the half-disc's middle at the board's
  if (state.shaking && !state.shaking.ai && (humanTurn() || (isGuest() && F.guestShaking))) {
    const own = isGuest() && F.guestShaking, t = own ? performance.now() / 1000 - F.guestShakeAt : state.shaking.t; // a friend's own clock: no lag
    drawGauge(gx, gy, own ? meterPos(t) : shakePower(), state.shaking.zone, false, tune.shake_max_time - t);
  } else if (!state.shaking && state.zone && humanTurn() && (state.phase === 'roll' || state.phase === 'order' || state.phase === 'jail')) drawGauge(gx, gy, 0, state.zone, true, 0);
  const ds = state.diceShow;
  if (!ds || ds.t > 1.6) return;
  const s = project((dice3[0].position.x + dice3[1].position.x) / 2, BOARD_TOP + 1.1, (dice3[0].position.z + dice3[1].position.z) / 2);
  const pop = ds.t < 0.18 ? 0.4 + 0.6 * (ds.t / 0.18) * 1.25 : 1 + 0.25 * Math.max(0, 1 - (ds.t - 0.18) * 5);
  const alpha = ds.t > 1.2 ? Math.max(0, 1 - (ds.t - 1.2) / 0.4) : 1;
  const label = ds.dbl ? `ĐÔI! ${ds.a} + ${ds.b} = ${ds.a + ds.b}` : `${ds.a} + ${ds.b} = ${ds.a + ds.b}`;
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(s.x, s.y - ds.t * 12); ctx.scale(pop, pop);
  ctx.font = `bold 44px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(40,14,8,0.9)'; ctx.strokeText(label, 0, 0);
  ctx.fillStyle = ds.dbl ? '#f2c44a' : '#fff8e6'; ctx.fillText(label, 0, 0);
  if (ds.dbl) { ctx.fillStyle = '#ffe9a8'; for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4 + ds.t * 2, r = 150 + 20 * Math.sin(ds.t * 9 + k); star(ctx, Math.cos(a) * r, Math.sin(a) * r * 0.45, 10); } }
  ctx.restore();
}
export function drawPotLabel() {
  const s = project(POT_X, BOARD_TOP + 1.05, POT_Z);
  const label = `Hũ tiền: ${money(state.pot)}`;
  ctx.save(); ctx.font = `bold 16px ${FONT}`;
  const w = ctx.measureText(label).width + 22;
  ctx.fillStyle = 'rgba(40,16,10,0.85)'; rrect(ctx, s.x - w / 2, s.y - 14, w, 28, 8); ctx.fill();
  ctx.strokeStyle = '#f2c44a'; ctx.lineWidth = 1.5; ctx.stroke();
  text(label, s.x, s.y + 1, 16, '#f2c44a', 'center', 'bold');
  ctx.restore();
}
/** The land card's height: taller with a đặc sản line. */
const tileCardH = (t: { sp?: string }): number => (t.sp ? 382 : 360);
function tileCard(i: number, cx: number, cy: number, extra?: (x: number, y: number, w: number, h: number) => void) { // the land card: band, name, price, rent per level, landmark
  const t = TILES[i], w = 330, h = tileCardH(t), x = cx - w / 2, y = cy - h / 2;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; rrect(ctx, x + 6, y + 8, w, h, 14); ctx.fill();
  ctx.fillStyle = '#fbf3df'; rrect(ctx, x, y, w, h, 14); ctx.fill();
  ctx.strokeStyle = '#5a3d2b'; ctx.lineWidth = 3; ctx.stroke();
  const band = t.t === 'prop' ? GROUPS[t.g!].color : '#5a3d2b';
  ctx.fillStyle = band; rrect(ctx, x + 10, y + 10, w - 20, 70, 8); ctx.fill();
  const dark = t.t === 'prop' && [0, 3, 4].includes(t.g!);
  text(t.n, cx, y + 38, 26, dark ? '#2b1d12' : '#fff8e6', 'center', 'bold');
  text(t.t === 'prop' ? GROUPS[t.g!].name : t.t === 'port' ? 'Bến cảng · Sân bay' : 'Công ty', cx, y + 66, 15, dark ? '#3a2416' : '#f4ead2');
  let yy = y + 104;
  text(`Giá đất: ${money(t.p!)}`, cx, yy, 18, '#2b1d12', 'center', 'bold'); yy += 30;
  if (t.t === 'prop') {
    for (let l = 0; l <= MAX_LEVEL; l++) {
      const r = Math.round(t.p! * rentPct(l) * tune.rent_scale); // the same exact sum rentOf charges
      const here = state.owner[i] >= 0 && state.level[i] === l;
      if (here) { ctx.fillStyle = 'rgba(242,196,74,0.35)'; ctx.fillRect(x + 16, yy - 11, w - 32, 22); }
      text(LEVEL_NAMES[l] + (l === 6 ? `: ${t.lm}` : ''), x + 22, yy, 15, '#3a2416', 'left');
      text(money(r), x + w - 22, yy, 15, '#3a2416', 'right', here ? 'bold' : '');
      yy += 22;
    }
    text(`Gom đủ nhóm: thuê × ${tune.full_group_mult}`, cx, yy + 6, 15, '#8a3a24', 'center', 'bold'); yy += 30;
    if (t.sp) text(`Đặc sản: ${t.sp}`, cx, yy + 4, 15, '#5a3d2b', 'center', 'italic');
  } else if (t.t === 'port') {
    [1, 2, 3, 4].forEach(n => { text(`Có ${n} bến`, x + 22, yy, 15, '#3a2416', 'left'); text(money(tune.port_rent * Math.pow(2, n - 1) * tune.rent_scale), x + w - 22, yy, 15, '#3a2416', 'right'); yy += 24; });
  } else {
    text(`1 công ty: tổng xúc xắc × ${money(tune.util_mult_one)}`, cx, yy, 15, '#3a2416'); yy += 24;
    text(`2 công ty: tổng xúc xắc × ${money(tune.util_mult_two)}`, cx, yy, 15, '#3a2416'); yy += 24;
  }
  const o = state.owner[i];
  if (o >= 0) text(`Chủ: ${state.players[o].name}${state.mort[i] ? ' (cầm cố)' : ''}`, cx, y + h - 22, 16, state.players[o].color, 'center', 'bold');
  else text('Chưa có chủ', cx, y + h - 22, 16, '#6a5a4a', 'center');
  if (extra) extra(x, y, w, h);
  ctx.restore();
}
/** s cut to fit maxW in this font, ending in "…" when cut. */
export function clipText(s: string, maxW: number, font: string): string {
  ctx.save(); ctx.font = font;
  let out = s;
  if (ctx.measureText(out).width > maxW) { while (out.length > 1 && ctx.measureText(out + '…').width > maxW) out = out.slice(0, -1); out += '…'; }
  ctx.restore();
  return out;
}
/** A dark box of lines centred on (cx, cy); anchored at its 'foot', cy is its bottom edge (it grows up), at its 'top', its top edge. */
export function messageBox(lines: string[], cx: number, cy: number, w: number, anchor: 'mid' | 'foot' | 'top' = 'mid') {
  w = Math.min(w, L.maxW);
  ctx.save(); ctx.font = `bold 19px ${FONT}`;
  const all = lines.flatMap((l: string) => wrapLines(ctx, l, w - 40));
  const h = all.length * 28 + 26;
  if (anchor === 'foot') cy -= h / 2; else if (anchor === 'top') cy += h / 2;
  ctx.fillStyle = 'rgba(20,10,6,0.82)'; rrect(ctx, cx - w / 2, cy - h / 2, w, h, 14); ctx.fill();
  ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 2; ctx.stroke();
  all.forEach((l: string, j: number) => text(l, cx, cy - h / 2 + 26 + j * 28, 19, '#fff8e6', 'center', 'bold'));
  ctx.restore();
}
export function drawPopup() {
  const p = curP(), pop = state.popup, human = humanTurn();
  const cx = L.cx, cy = L.popCy;
  // wide: over the board at y; phone: its foot just above the turn's buttons, growing up (Bug 19/11/2026: centred on
  // the card strip, a box of 3 or 4 lines covered the players' cards and the shake button)
  const mb = (lines: string[], y: number, w: number): void => messageBox(lines, cx, L.phone ? L.rollY - 8 : y, w, L.phone ? 'foot' : 'mid');
  // wide: a note under the gauge, its top just below the gauge's foot however many lines it takes
  const underGauge = (lines: string[], w: number): void => (L.phone ? mb(lines, 0, w) : messageBox(lines, cx, L.bh * 0.5 + 50 + 10, w, 'top'));
  drawOrder();
  // whose turn it is shows on the player's card and, when several people share this screen, on the button
  if (state.phase === 'roll' && human && !state.shaking && state.rolledDouble) underGauge([`${p.name}: đổ đôi, được đổ tiếp!`], 460);
  if (state.phase === 'jail' && human && !state.shaking) underGauge([L.phone // a phone: two short lines, clear of the players' cards
    ? `${p.name} ở tù: đổ đôi thì ra (lượt ${p.jailTries + 1}/3).${p.noSalary ? (p.freeCards.length ? ' Dùng Thẻ Ra Tù: có lương lại.' : ' Qua Xuất Phát tới: mất lương.') : ''}`
    : `${p.name} đang ở tù. Đổ được đôi thì ra ngay (lượt ${p.jailTries + 1}/3; ở đủ 3 lượt thì lượt sau được ra).${p.noSalary ? (p.freeCards.length ? ' Dùng Thẻ Ra Tù thì được nhận lương lại!' : ' Lần qua Xuất Phát tới sẽ mất lương.') : ''}`], 520);
  if (state.phase === 'end' && human) mb([`${p.name}: hết lượt. Quản lý tài sản ${L.phone ? 'ở nút Tài sản' : 'ở bên phải'} nếu cần.`], 318, 640);
  if (!pop && state.phase !== 'pick' && state.phase !== 'debt') return;
  if (state.phase === 'pick') { mb([human ? 'Vé máy bay: bấm một ô trên bàn cờ (hoặc dùng phím mũi tên) để bay tới.' : `${p.name} đang chọn nơi bay tới...`], 545, 600); return; }
  if (state.phase === 'debt') {
    const d = state.debt; // a phone gets two short lines, clear of the players' cards above
    if (L.phone) mb([`Cần trả ${money(d.total)}, đang có ${money(p.cash)}.`, 'Bán bớt hoặc cầm cố ở nút Tài sản.'], 0, 620);
    else messageBox([`${p.name} cần trả ${money(d.total)}, đang có ${money(p.cash)}.`, 'Bán bớt nhà hoặc cầm cố đất ở danh sách bên phải, rồi bấm Trả nợ.'], cx, 520, 620);
    return;
  }
  if (pop.kind === 'rentChoice' || pop.kind === 'reroll') {
    tileCard(pop.tile, cx, cy - 10);
    mb([pop.kind === 'rentChoice' ? `${p.name} phải trả ${money(pop.rent)}. Dùng Thẻ Miễn Thuê?` : `Sắp dẫm vào ${TILES[pop.tile].n}: trả ${money(pop.rent)}. Dùng Thẻ Đổ Lại?`], 548, 600);
    if (!human) mb([`${p.name} đang suy nghĩ...`], 600, 420);
    return;
  }
  if (pop.kind === 'notax') { messageBox([`Vòng đầu tiên (chưa qua Xuất Phát): miễn ${TILES[pop.tile].n}!`], cx, L.phone ? L.popCy : 330, 560); return; }
  if (pop.kind === 'buy' || pop.kind === 'build' || pop.kind === 'rent' || pop.kind === 'nobuy') {
    tileCard(pop.tile, cx, cy - 10);
    if (pop.kind === 'rent') { const why = rentHint(state, pop.tile); mb([`${p.name} trả ${state.players[pop.owner].name} ${money(pop.rent)}`, ...(why ? [why] : [])], why ? 552 : 548, 560); } // two lines: clear of the card's foot
    if (pop.kind === 'buy' && human) mb([buyHint(state, state.cur, pop.tile)], 548, 600); // what buying it does for them
    if (pop.kind === 'build') mb([`Đất của bạn! Xây thêm 1 cấp?`], 548, 420);
    if (pop.kind === 'nobuy') mb([`Vòng đầu tiên (chưa qua Xuất Phát): chưa được mua, chỉ ghé xem.`], 548, 600);
    if (!human && pop.kind !== 'rent' && pop.kind !== 'nobuy') mb([`${p.name} đang suy nghĩ...`], 548, 420);
  }
  if (pop.kind === 'card') {
    const w = 380, h = 250, x = cx - w / 2, y = cy - h / 2;
    const co = pop.deck === 'co';
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; rrect(ctx, x + 6, y + 8, w, h, 16); ctx.fill();
    ctx.fillStyle = co ? '#f6d26a' : '#c8201f'; rrect(ctx, x, y, w, h, 16); ctx.fill();
    ctx.strokeStyle = co ? '#b3201e' : '#f2c44a'; ctx.lineWidth = 4; rrect(ctx, x + 10, y + 10, w - 20, h - 20, 10); ctx.stroke();
    if (co) icon.lantern(ctx, x + 56, y + 70, 70); else icon.envelope(ctx, x + 56, y + 70, 76);
    text(co ? 'CƠ HỘI' : 'KHÍ VẬN', cx + 30, y + 56, 30, co ? '#8a1a14' : '#ffe9a8', 'center', 'bold');
    ctx.font = `bold 20px ${FONT}`;
    wrapLines(ctx, pop.card.txt, w - 60).forEach((l, j) => text(l, cx, y + 132 + j * 28, 20, co ? '#2b1d12' : '#fff8e6', 'center', 'bold'));
    ctx.restore();
    if (!human) mb([`${p.name} đọc thẻ...`], 548, 360);
  }
}
const SPECIAL_INFO: Record<string, (t: Tile) => string[]> = {
  go: () => [`Đi qua hoặc dừng ở đây: nhận lương ${money(tune.salary)}.`],
  jail: () => ['Đứng trên mép ô: chỉ ghé thăm, không sao.', `Ở trong tù: mỗi lượt đổ tìm đôi để ra, hoặc dùng Thẻ Ra Tù. Ở đủ 3 lượt mà không ra đôi thì lượt sau được ra, không mất tiền. Vào tù vì rút thẻ thì lần qua Xuất Phát tới mất lương, trừ khi ra tù bằng Thẻ Ra Tù.`],
  free: () => ['Dừng ở đây: lấy hết tiền trong hũ giữa bàn (tiền 2 ô thuế dồn vào hũ).', `Hũ đang có: ${money(state.pot)}.`],
  gojail: () => ['Dừng ở đây: vào thẳng Nhà Tù, không đi qua Xuất Phát, không nhận lương.'],
  co: () => ['Rút một thẻ Cơ Hội: thường là đi tới đâu đó (về Xuất Phát, bay đi du lịch, lùi lại...), đôi khi được tiền hoặc bị phạt.'],
  kv: () => ['Rút một thẻ Khí Vận (bao lì xì): thường là được tiền hoặc mất tiền: lì xì, sinh nhật, khám răng, trúng số...'],
  tax: (t: Tile) => [t.kind === 'income' ? `Trả cố định ${money(tune.income_tax)}. Tiền vào hũ giữa bàn.` : `Trả ${Math.round(tune.prop_tax_pct * 100)}% tiền mặt đang có, tối đa ${money(tune.prop_tax_flat)}. Tiền vào hũ giữa bàn.`, 'Vòng đầu (chưa qua Xuất Phát lần nào): được miễn.'],
};
export function drawInspect() {
  if (F.inspect < 0 || scene !== 'play') return;
  const i = F.inspect, t = TILES[i];
  ctx.save(); ctx.fillStyle = 'rgba(10,5,3,0.45)'; ctx.fillRect(0, 0, L.phone ? W : BW, H); ctx.restore();
  if (OWNABLE(t)) {
    const cy = L.phone ? L.popCy : L.popCy - 18; // wide: room under it for the rent line above the close button
    tileCard(i, L.cx, cy);
    if (state.owner[i] >= 0 && !state.mort[i]) { // under the card, on a dark strip: the board shows through the dim
      const msg = `Hiện thu: ${t.t === 'util' ? 'tổng xúc xắc × ' + money(rentOf(i, 1)) : money(rentOf(i, 7))}${t.t === 'prop' && ownsGroup(state.owner[i], t.g!) ? ' (đủ nhóm)' : ''}`;
      const y = cy + tileCardH(t) / 2 + 22;
      ctx.save(); ctx.font = `bold 17px ${FONT}`; const mw = ctx.measureText(msg).width + 28;
      ctx.fillStyle = 'rgba(20,10,6,0.85)'; rrect(ctx, L.cx - mw / 2, y - 17, mw, 34, 10); ctx.fill(); ctx.restore();
      text(msg, L.cx, y, 17, '#fff8e6', 'center', 'bold');
    }
  } else {
    const w = 440; ctx.font = `17px ${FONT}`;
    const infoLines = SPECIAL_INFO[t.t](t).flatMap((para: string) => wrapLines(ctx, para, w - 50));
    const h = Math.max(300, 190 + infoLines.length * 24), x = L.cx - w / 2, y = Math.max(L.by + 10, L.popCy - 10 - h / 2);
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; rrect(ctx, x + 6, y + 8, w, h, 14); ctx.fill();
    ctx.fillStyle = '#fbf3df'; rrect(ctx, x, y, w, h, 14); ctx.fill(); ctx.strokeStyle = '#5a3d2b'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#5a3d2b'; rrect(ctx, x + 10, y + 10, w - 20, 60, 8); ctx.fill();
    text(t.n, L.cx, y + 40, 26, '#fff8e6', 'center', 'bold');
    const draw = ({ co: 'lantern', kv: 'envelope', tax: 'coins', go: 'arrow', jail: 'bars', free: 'palm', gojail: 'cap' } as Record<string, string>)[t.t];
    if (draw === 'arrow') icon.arrow(ctx, L.cx, y + 115, 70, Math.PI); else (icon as Loose)[draw](ctx, L.cx, y + 115, 70);
    let yy = y + 175;
    for (const ln of infoLines) { text(ln, L.cx, yy, 17, '#2b1d12'); yy += 24; }
    ctx.restore();
  }
  const here = state.players.filter(p => !p.bankrupt && p.pos === i).map(p => p.name);
  // a phone puts it between the toolbar and the card, a wide screen above the card; long lists shrink to fit
  if (here.length) fitText(`Đang đứng ở đây: ${here.join(', ')}`, L.cx, L.phone ? L.by + 60 : 140, W - 24, 16, '#fff8e6');
  F.drawingInspect = true; F.ui.forEach(b => { if (b.role === 'close') drawButton(b); }); F.drawingInspect = false;
}
export function drawFloaters() {
  for (const f of state.floaters) {
    const u = f.t / 1.4, a = 1 - u;
    let x, y;
    if (f.row !== undefined) { const r = rowSpot(f.row); x = r.x; y = r.y - u * 26; }
    else { const s = project(f.world.x, f.world.y, f.world.z); x = s.x; y = s.y - u * 50; }
    ctx.save(); ctx.globalAlpha = Math.max(0, a);
    ctx.font = `bold 18px ${FONT}`; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.textAlign = f.row !== undefined ? 'right' : 'center'; ctx.textBaseline = 'middle';
    ctx.strokeText(f.s, x, y); ctx.fillStyle = f.color; ctx.fillText(f.s, x, y);
    ctx.restore();
  }
}

