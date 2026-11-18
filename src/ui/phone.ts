// The phone layout's own pieces: header, players, the button strip, the property sheet.

import { tune } from '../config';

import { W, H, BW, FONT, ctx, clear, text, rrect, wrapLines } from '../screen';

import { GROUPS, TILES, LEVEL_SHORT, PLAYER_COLORS, ANIMALS } from '../game/data';

import { state, setup } from '../core/store';

import { money } from '../game/rules';
import type { Seat } from '../game/types';

import { owned, teamTag, maxRounds, teamOfSeat, kindLabel, curP, sellLevel, mortgage, unmortgage } from '../game/turn';

import { drawVote, isGuest, mySeat, isHost, roomCode, lobby } from '../net/room';
import { F } from '../core/flags';

import { drawSummary } from '../ui/summary';

import { drawNetBanner, drawPicker, fitText } from '../ui/setupScreen';
import { lacquer, drawBoardView, drawButton, drawTokenIcon, faceOf } from '../ui/draw';
import { phoneExtra, roomPill, TITLE, drawSeatAnimal, titleTeams, seatLabel, L, PX, PW, btn, humanTurn, seatAnimal } from '../main';
import { rulesSpot } from '../app/install';

// ---- The phone layout's own pieces: header, players, the button strip, the property sheet --------
/** Where a player's money shows: floaters rise from there. */
export function rowSpot(pi: number): { x: number; y: number } {
  if (!L.phone) return { x: PX + PW - 26, y: 76 + pi * 72 + 40 };
  const c = phoneCard(pi);
  return { x: c.x + c.w - 10, y: c.y + 40 };
}
/** A player's card on the phone: two columns, two rows, under the board. */
function phoneCard(pi: number): { x: number; y: number; w: number; h: number } {
  return { x: 8 + (pi % 2) * 236, y: L.by + L.bh + 34 + Math.floor(pi / 2) * 64, w: 228, h: 58 };
}
/** The header, the log line, the players and the strip behind the buttons. */
export function drawPhoneChrome() {
  lacquer(0, 0, W, L.by);
  text('TỶ PHÚ ĐẤT VIỆT', 12, L.by / 2, 17, '#f2c44a', 'left', 'bold');
  const roundTxt = state.mode === 'rounds' ? `Vòng ${Math.min(state.round, maxRounds())}/${maxRounds()}` : `Vòng ${state.round}`;
  if (roomCode) { // in the gap between the rules pill and the room pill, smaller if it does not fit
    const r = rulesSpot(), left = r.x + r.w + 6, right = roomPill().x - 6;
    fitText(roundTxt, (left + right) / 2, L.by / 2, right - left, 15, '#e8d9b5', '');
  } else text(roundTxt, W - 64, L.by / 2, 15, '#e8d9b5', 'right');
  const top = L.by + L.bh;
  lacquer(0, top, W, H - top);
  const last = state.log[state.log.length - 1] || '';
  ctx.save(); ctx.font = `14px ${FONT}`;
  let line = last;
  while (line.length > 4 && ctx.measureText(line).width > W - 24) line = line.slice(0, -2);
  if (line !== last) line = line.slice(0, -1) + '…';
  ctx.restore();
  text(line, 12, top + 17, 14, '#e8d9b5', 'left');
  state.players.forEach((p, pi) => {
    const c = phoneCard(pi), cur = pi === state.cur && state.phase !== 'over';
    ctx.save(); ctx.globalAlpha = p.bankrupt ? 0.45 : 1;
    ctx.fillStyle = cur ? '#5a2a1c' : '#2c140f'; rrect(ctx, c.x, c.y, c.w, c.h, 10); ctx.fill();
    ctx.strokeStyle = cur ? '#f2c44a' : '#6a4a2a'; ctx.lineWidth = cur ? 3 : 1; ctx.stroke();
    ctx.fillStyle = p.color; rrect(ctx, c.x, c.y, 7, c.h, 4); ctx.fill();
    ctx.fillStyle = '#f4ead2'; ctx.beginPath(); ctx.arc(c.x + 30, c.y + c.h / 2, 19, 0, 7); ctx.fill();
    drawTokenIcon(p.token, c.x + 30, c.y + c.h / 2 + 2, 32, p.color, faceOf(p));
    let name = p.name;
    ctx.font = `bold 16px ${FONT}`;
    while (name.length > 3 && ctx.measureText(name).width > c.w - 64) name = name.slice(0, -1);
    ctx.restore();
    ctx.save(); ctx.globalAlpha = p.bankrupt ? 0.45 : 1;
    text(name, c.x + 56, c.y + 18, 16, '#fff8e6', 'left', 'bold');
    text(money(p.cash), c.x + 56, c.y + 40, 16, p.cash < 0 ? '#ff8a7a' : '#f2c44a', 'left', 'bold');
    const tag = (state.teams ? `Đ${(p.team ?? 0) + 1} · ` : '') + (p.bankrupt ? 'phá sản' : p.inJail ? 'trong tù' : p.kind === 'remote' && p.offline ? 'mất mạng' : `${owned(pi).length} ô`);
    text(tag, c.x + c.w - 8, c.y + 18, 13, '#d9c8a6', 'right');
    ctx.restore();
  });
}
/** Phone: the button that opens the property sheet, under the turn's buttons. */
export function buildSheetButton(pi: number) {
  btn(L.cx - 110, L.btnY + 64, 220, 44, `Tài sản (${owned(pi).length})`, () => { F.sheetOpen = true; F.propScroll = 0; }, '', true, '#6a4a2a');
}
const SHEET = { x: 10, y: 60, w: 460, rowY: 120, rowH: 46, rows: 15 };
/** Phone: the property sheet's buttons: sell, mortgage, unmortgage on the player's turn; a row's name opens its card. */
export function buildSheetUI(pi: number) {
  const mine = owned(pi), p = state.players[pi];
  const act = humanTurn() && ['roll', 'end', 'debt', 'jail'].includes(state.phase);
  F.propScroll = Math.max(0, Math.min(F.propScroll, mine.length - SHEET.rows));
  mine.slice(F.propScroll, F.propScroll + SHEET.rows).forEach((i, r) => {
    const y = SHEET.rowY + r * SHEET.rowH;
    btn(SHEET.x + 4, y, 300, SHEET.rowH - 4, '', () => { F.inspect = i; }, 'hidden');
    if (!act) return;
    if (state.level[i] > 0) btn(SHEET.x + SHEET.w - 126, y + 4, 118, SHEET.rowH - 12, 'Bán 1 cấp', () => sellLevel(pi, i), 'row', true, undefined, `sell:${i}`);
    else if (state.mort[i]) btn(SHEET.x + SHEET.w - 126, y + 4, 118, SHEET.rowH - 12, 'Chuộc', () => unmortgage(pi, i), 'row', p.cash >= TILES[i].p! * tune.unmortgage_pct, undefined, `unmort:${i}`);
    else btn(SHEET.x + SHEET.w - 126, y + 4, 118, SHEET.rowH - 12, 'Cầm cố', () => mortgage(pi, i), 'row', true, undefined, `mort:${i}`);
  });
  const bottom = SHEET.rowY + SHEET.rows * SHEET.rowH + 8;
  if (mine.length > SHEET.rows) {
    btn(SHEET.x + 20, bottom, 120, 44, 'up', () => { F.propScroll = Math.max(0, F.propScroll - SHEET.rows); }, 'arrowUp', F.propScroll > 0);
    btn(SHEET.x + SHEET.w - 140, bottom, 120, 44, 'down', () => { F.propScroll += SHEET.rows; }, 'arrowDown', F.propScroll + SHEET.rows < mine.length);
  }
  btn(L.cx - 110, bottom + 56, 220, 52, 'Đóng', () => { F.sheetOpen = false; }, 'secondary', true, '#6a4a2a');
}
/** Phone: the property sheet itself, under its buttons. */
export function drawSheet() {
  const pi = state.cur, p = curP(), mine = owned(pi);
  const h = SHEET.rowY + SHEET.rows * SHEET.rowH + 130 - SHEET.y;
  ctx.save(); ctx.fillStyle = 'rgba(10,5,3,0.6)'; ctx.fillRect(0, 0, W, H); ctx.restore();
  lacquer(SHEET.x, SHEET.y, SHEET.w, h);
  text(humanTurn() ? 'Tài sản của bạn' : `Tài sản của ${p.name}`, SHEET.x + SHEET.w / 2, SHEET.y + 30, 20, '#f2c44a', 'center', 'bold');
  if (!mine.length) text('Chưa có ô đất nào.', SHEET.x + SHEET.w / 2, SHEET.rowY + 30, 17, '#d9c8a6');
  mine.slice(F.propScroll, F.propScroll + SHEET.rows).forEach((i, r) => {
    const y = SHEET.rowY + r * SHEET.rowH, t = TILES[i];
    ctx.fillStyle = r % 2 ? '#2c140f' : '#34180f'; ctx.fillRect(SHEET.x + 8, y, SHEET.w - 16, SHEET.rowH - 4);
    ctx.fillStyle = t.t === 'prop' ? GROUPS[t.g!].color : '#9a8a6a'; ctx.fillRect(SHEET.x + 16, y + 11, 16, 20);
    text(t.n, SHEET.x + 42, y + 21, 17, state.mort[i] ? '#9a8a7a' : '#fff8e6', 'left');
    const tag = state.mort[i] ? 'cầm cố' : LEVEL_SHORT[state.level[i]];
    if (tag) text(tag, SHEET.x + 262, y + 21, 15, state.mort[i] ? '#ff9a8a' : '#7ee08a', 'center', 'bold');
  });
}

/** Where the title screen's buttons sit, wide or phone. */
export function titleSpots() {
  return L.phone
    ? { seatX: 246, seatW: 226, seatH: 52, y0: 178, step: 64, modeDy: 8, start: [16, 560, 448, 60], online: [16, 632, 448, 56], leave: [16, 600, 448, 60], rejoin: [16, 700, 448, 56], rejoin2: [16, 766, 448, 48] }
    : { seatX: BW / 2 - 20, seatW: 300, seatH: 50, y0: 250, step: 62, modeDy: 10, start: [BW / 2 - 290, 600, 280, 60], online: [BW / 2 + 10, 600, 280, 60], leave: [BW / 2 - 140, 600, 280, 60], rejoin: [PX + 24, 610, PW - 48, 56], rejoin2: [PX + 24, 672, PW - 48, 40] };
}
/** Phone: the title screen, one column. */
export function drawTitlePhone() {
  clear('#1d120c');
  drawBoardView();
  ctx.fillStyle = 'rgba(20,10,6,0.86)'; ctx.fillRect(0, 0, W, H);
  const T = titleSpots();
  text(TITLE.toUpperCase(), W / 2, 58, 34, '#f2c44a', 'center', 'bold');
  text('Cờ tỷ phú trên bản đồ Việt Nam · 2 đến 4 người', W / 2, 96, 15, '#e8d9b5');
  const hint = isGuest() ? (lobby ? `Phòng ${roomCode} · chờ ${lobby.hostName || 'chủ phòng'} bắt đầu ván` : `Đang vào phòng ${roomCode}...`)
    : isHost() ? `Gửi mã ${roomCode} cho bạn bè: họ sẽ vào chỗ "Chờ bạn online"` : 'Bấm vào chỗ ngồi, con vật hay kiểu ván để chọn từ danh sách';
  ctx.font = `15px ${FONT}`;
  wrapLines(ctx, hint, W - 40).slice(0, 2).forEach((l, j) => text(l, W / 2, 130 + j * 20, 15, isGuest() || isHost() ? '#f2c44a' : '#cbb994'));
  const seatsShown: Seat[] = isGuest() ? (lobby ? lobby.seats : []) : setup.seats;
  seatsShown.forEach((s, i) => {
    const y = T.y0 + i * T.step, cy = y + T.seatH / 2;
    drawSeatAnimal(i, 34, cy, 24, s);
    text(ANIMALS[seatAnimal(i)].name, 66, cy, 17, s.kind === 'off' ? '#7a6a5a' : '#fff8e6', 'left', 'bold');
    if (isGuest() && titleTeams()) text(teamTag(teamOfSeat(i)), T.seatX - 52, cy, 15, '#f2c44a', 'center', 'bold');
    if (isGuest()) {
      ctx.save(); ctx.fillStyle = i === mySeat ? '#5a2a1c' : '#2c140f'; rrect(ctx, T.seatX, y, T.seatW, T.seatH, 12); ctx.fill();
      ctx.strokeStyle = i === mySeat ? '#f2c44a' : '#6a4a2a'; ctx.lineWidth = i === mySeat ? 3 : 1; ctx.stroke(); ctx.restore();
      text(seatLabel(s, i) + (i === mySeat ? ' (bạn)' : ''), T.seatX + T.seatW / 2, cy, 15, '#fff8e6', 'center', 'bold');
    }
  });
  const modeY = T.y0 + 4 * T.step + T.modeDy + T.seatH / 2;
  text('Kiểu ván', 64, modeY, 16, '#fff8e6', 'left', 'bold');
  if (isGuest() && lobby) text(kindLabel(lobby.mode, lobby.rounds ?? tune.max_rounds, false, !!lobby.teams), T.seatX + T.seatW / 2, modeY, 15, '#fff8e6', 'center', 'bold');
  F.ui.forEach(drawButton);
  if (roomCode) {
    ctx.save(); ctx.fillStyle = '#5a2a1c'; rrect(ctx, 60, 712, W - 120, 96, 14); ctx.fill(); ctx.strokeStyle = '#f2c44a'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
    text('MÃ PHÒNG', W / 2, 734, 15, '#e8d9b5', 'center', 'bold');
    text(roomCode, W / 2, 776, 42, '#f2c44a', 'center', 'bold');
  }
  const tips = ['Giữ nút để lắc xúc xắc, thả ra để ném.', 'Chạm vào một ô trên bàn cờ để xem thông tin.', 'Dẫm lại đất của mình: xây thêm 1 cấp.'];
  tips.forEach((t, j) => text(t, W / 2, 846 + j * 26, 14, '#cbb994'));
  drawNetBanner();
  drawPicker();
}
/** Phone: the end of the game, one column. */
export function drawResultsPhone() {
  clear('#1d120c');
  drawBoardView();
  ctx.fillStyle = 'rgba(20,10,6,0.7)'; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.translate(0, phoneExtra() / 2); // drawn for 960 high: a taller phone centres it
  ctx.save(); ctx.fillStyle = 'rgba(30,12,8,0.94)'; rrect(ctx, 10, 60, W - 20, 760, 20); ctx.fill(); ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
  for (let k = 0; k < 30; k++) { // a fanfare of drawn confetti
    const x = 30 + ((k * 137) % (W - 60)), y = 70 + ((k * 53 + state.t * 90 * (1 + k % 3)) % 740);
    ctx.fillStyle = PLAYER_COLORS[k % 4]; ctx.save(); ctx.translate(x, y); ctx.rotate(k + state.t * 3); ctx.fillRect(-5, -2, 10, 4); ctx.restore();
  }
  const w = state.players[state.ranking![0].i];
  ctx.font = `16px ${FONT}`;
  wrapLines(ctx, state.reason || '', W - 60).forEach((l, j) => text(l, W / 2, 100 + j * 22, 16, '#e8d9b5'));
  ctx.fillStyle = '#f4ead2'; ctx.beginPath(); ctx.arc(W / 2, 185, 44, 0, 7); ctx.fill();
  drawTokenIcon(w.token, W / 2, 188, 72, w.color);
  ctx.font = `bold 26px ${FONT}`;
  wrapLines(ctx, state.gained, W - 50).forEach((l, j) => text(l, W / 2, 262 + j * 32, 26, '#f2c44a', 'center', 'bold'));
  state.ranking!.forEach((r, j) => {
    const p = state.players[r.i], y = 350 + j * 62;
    ctx.fillStyle = j === 0 ? '#5a2a1c' : '#2c140f'; rrect(ctx, 26, y - 26, W - 52, 54, 8); ctx.fill();
    text(`${j + 1}.`, 48, y, 20, '#f2c44a', 'center', 'bold');
    ctx.fillStyle = p.color; ctx.fillRect(66, y - 12, 10, 24);
    text(p.name + (state.teams ? ` · ${teamTag(p.team)}` : ''), 86, y - 10, 17, '#fff8e6', 'left', 'bold');
    text(r.bankrupt ? 'Phá sản' : `Tài sản ${money(r.worth)}`, 86, y + 13, 15, r.bankrupt ? '#ff9a8a' : '#e8d9b5', 'left');
  });
  drawSummary(26, 350 + state.ranking!.length * 62, W - 52);
  if (isGuest() && !state.vote) text('Bấm Chơi lại để bỏ phiếu ván mới', W / 2, 800, 16, '#e8d9b5');
  ctx.restore();
  F.ui.forEach(drawButton);
  drawNetBanner();
  drawVote();
}

