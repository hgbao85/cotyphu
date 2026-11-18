// The board's face, drawn once on a canvas and laid on the 3D table: tiles, prices, icons, colour bands.

import { tune } from '../config';
import { GROUPS, TILES } from '../game/data';
import { FONT, rrect, wrapLines } from '../screen';
import { HALF, CORNER, BAND, L as BOARD_SIZE, tileInfo } from '../game/board';
import type { Loose } from '../game/types';
import { canvasTex } from './materials';
import { icon, TILE_ICON } from '../draw/icons';

export function boardTexture() {
  const S = 2048, k = S / BOARD_SIZE;
  return canvasTex(S, S, (c: CanvasRenderingContext2D) => {
    const X = (x: number) => (x + HALF) * k, Z = (z: number) => (z + HALF) * k;
    c.fillStyle = '#f2e6c8'; c.fillRect(0, 0, S, S);
    // the centre: a bamboo frame, rice-field stripes, the title, and the two deck spots
    const e = HALF - CORNER;
    c.fillStyle = '#e9dcb6'; c.fillRect(X(-e), Z(-e), (2 * e) * k, (2 * e) * k);
    c.save(); c.beginPath(); c.rect(X(-e), Z(-e), 2 * e * k, 2 * e * k); c.clip();
    for (let r = -20; r < 30; r++) { c.fillStyle = r % 2 ? 'rgba(120,170,80,0.10)' : 'rgba(200,190,120,0.08)'; c.fillRect(X(-e) + r * 60, Z(-e), 30, 2 * e * k); }
    c.restore();
    c.strokeStyle = '#7a8a3a'; c.lineWidth = 10; c.strokeRect(X(-e) + 26, Z(-e) + 26, 2 * e * k - 52, 2 * e * k - 52);
    c.strokeStyle = '#a9b65a'; c.lineWidth = 3;
    for (let s = 0; s < 4; s++) for (let n = 0; n < 12; n++) { // bamboo nodes along the frame
      const t = (n + 0.5) / 12, a = X(-e) + 26, b = 2 * e * k - 52;
      const pts = [[a + t * b, Z(-e) + 26], [X(-e) + 26 + b, Z(-e) + 26 + t * b], [a + t * b, Z(-e) + 26 + b], [X(-e) + 26, Z(-e) + 26 + t * b]][s];
      c.beginPath(); if (s % 2 === 0) { c.moveTo(pts[0], pts[1] - 9); c.lineTo(pts[0], pts[1] + 9); } else { c.moveTo(pts[0] - 9, pts[1]); c.lineTo(pts[0] + 9, pts[1]); } c.stroke();
    }
    // the title, printed faintly into the board: the turn's buttons sit over it and must stand out
    c.save(); c.translate(S / 2, Z(3.0));
    c.strokeStyle = 'rgba(150,40,30,0.28)'; c.lineWidth = 5; rrect(c, -540, -77, 1080, 154, 22); c.stroke();
    c.fillStyle = 'rgba(150,40,30,0.30)'; c.font = `bold 108px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('TỶ PHÚ ĐẤT VIỆT', 0, 6);
    c.restore();
    c.fillStyle = '#6a4a2a'; c.font = `italic 40px ${FONT}`; c.textAlign = 'center';
    // deck spots
    for (const [dx, dz, , label] of [[-2.3, -2.9, 'co', 'CƠ HỘI'], [2.3, -2.9, 'kv', 'KHÍ VẬN']] as [number, number, string, string][]) {
      c.save(); c.translate(X(dx), Z(dz)); c.rotate(dx < 0 ? -0.12 : 0.12);
      c.setLineDash([16, 10]); c.strokeStyle = '#8a6a3a'; c.lineWidth = 5; rrect(c, -150, -110, 300, 220, 18); c.stroke(); c.setLineDash([]);
      c.fillStyle = '#6a4a2a'; c.font = `bold 40px ${FONT}`; c.textAlign = 'center'; c.fillText(label, 0, 150);
      c.restore();
    }
    // tiles
    for (let i = 0; i < 40; i++) {
      const t = TILES[i], ti = tileInfo(i);
      let x0, z0, w, h; // tile rect in world units
      if (ti.side === -1) { x0 = ti.x - 0.8; z0 = ti.z - 0.8; w = 1.6; h = 1.6; }
      else if (ti.side === 0 || ti.side === 2) { x0 = ti.x - 0.5; z0 = ti.z - 0.8; w = 1; h = 1.6; }
      else { x0 = ti.x - 0.8; z0 = ti.z - 0.5; w = 1.6; h = 1; }
      const px = X(x0), pz = Z(z0), pw = w * k, ph = h * k;
      c.fillStyle = t.t === 'prop' ? '#fbf3df' : ti.side === -1 ? '#f6e3b8' : '#f4ecd6';
      c.fillRect(px, pz, pw, ph);
      // text area: the tile minus its inner band
      let tx = px, tz = pz, tw = pw, th = ph;
      if (t.t === 'prop') {
        c.fillStyle = GROUPS[t.g!].color;
        const b = BAND * k;
        if (ti.side === 0) { c.fillRect(px, pz, pw, b); tz += b; th -= b; }
        if (ti.side === 2) { c.fillRect(px, pz + ph - b, pw, b); th -= b; }
        if (ti.side === 1) { c.fillRect(px + pw - b, pz, b, ph); tw -= b; }
        if (ti.side === 3) { c.fillRect(px, pz, b, ph); tx += b; tw -= b; }
        c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 2;
        if (ti.side === 0) { c.beginPath(); c.moveTo(px, pz + b); c.lineTo(px + pw, pz + b); c.stroke(); }
        if (ti.side === 2) { c.beginPath(); c.moveTo(px, pz + ph - b); c.lineTo(px + pw, pz + ph - b); c.stroke(); }
        if (ti.side === 1) { c.beginPath(); c.moveTo(px + pw - b, pz); c.lineTo(px + pw - b, pz + ph); c.stroke(); }
        if (ti.side === 3) { c.beginPath(); c.moveTo(px + b, pz); c.lineTo(px + b, pz + ph); c.stroke(); }
      }
      c.strokeStyle = '#5a3d2b'; c.lineWidth = 4; c.strokeRect(px, pz, pw, ph);
      const cx = tx + tw / 2;
      c.fillStyle = '#2b1d12'; c.textAlign = 'center'; c.textBaseline = 'middle';
      // Names as large as the tile allows: start big and shrink until they fit in at most 3 lines.
      const label = t.t === 'co' || t.t === 'kv' ? t.n.toUpperCase() : (t.b || t.n);
      const hasIcon = t.t !== 'prop';
      const maxLines = 3, nameRoom = th * (hasIcon ? 0.56 : 0.64);
      let nameSize = ti.side === -1 ? 50 : 54, lines;
      for (;; nameSize -= 2) {
        c.font = `bold ${nameSize}px ${FONT}`;
        lines = wrapLines(c, label, tw * 0.92);
        const fits = lines.length <= maxLines && lines.every(l => c.measureText(l).width <= tw * 0.94) && lines.length * (nameSize + 2) <= nameRoom;
        if (fits || nameSize <= 30) break;
      }
      const fitFont = (txt: string, size: number, maxW: number, weight = 'bold') => { // one line, shrunk until it fits maxW
        for (; size > 20; size -= 2) { c.font = `${weight} ${size}px ${FONT}`; if (c.measureText(txt).width <= maxW) break; }
      };
      if (ti.side === -1) {
        const cz = tz + th / 2;
        c.font = `bold 50px ${FONT}`;
        if (t.t === 'go') { c.fillText('XUẤT PHÁT', cx, tz + 62); icon.arrow(c, cx, cz + 30, 170, Math.PI); fitFont('Nhận lương', 40, tw * 0.9); c.fillText('Nhận lương', cx, tz + th - 46); }
        if (t.t === 'jail') { icon.bars(c, cx + 30, cz - 40, 140); c.fillText('NHÀ TÙ', cx + 30, cz + 70); fitFont('Chỉ ghé thăm', 38, tw * 0.9, ''); c.textAlign = 'left'; c.fillText('Chỉ ghé thăm', tx + 16, tz + th - 30); c.textAlign = 'center'; }
        if (t.t === 'free') { c.fillText('BẾN ĐỖ', cx, tz + 48); c.fillText('TỰ DO', cx, tz + 100); icon.palm(c, cx, cz + 30, 130); c.fillStyle = '#b3201e'; fitFont('Nhận hũ tiền', 40, tw * 0.9); c.fillText('Nhận hũ tiền', cx, tz + th - 44); }
        if (t.t === 'gojail') { c.fillText('ĐI TÙ', cx, tz + 58); icon.cap(c, cx, cz + 10, 180); fitFont('Vào thẳng Nhà Tù', 36, tw * 0.9, ''); c.fillText('Vào thẳng Nhà Tù', cx, tz + th - 44); }
        continue;
      }
      c.font = `bold ${nameSize}px ${FONT}`;
      const top = tz + 14 + nameSize / 2;
      lines.forEach((ln, j) => c.fillText(ln, cx, top + j * (nameSize + 2)));
      const priceY = tz + th - 30, nameBottom = top + (lines.length - 1) * (nameSize + 2) + nameSize / 2;
      const twoLine = t.t === 'tax' && t.kind === 'prop', priceTop = twoLine ? priceY - 44 : priceY; // Thuế Tài Sản: "10%" over "tối đa 2 tr"
      const iconS = Math.min(tw * 0.55, priceTop - 26 - nameBottom - 6), iconY = (nameBottom + priceTop - 22) / 2 + 2;
      if (t.t === 'co') icon.lantern(c, cx, iconY, iconS);
      if (t.t === 'kv') icon.envelope(c, cx, iconY, iconS);
      if (t.t === 'tax' && iconS > 12) { icon.coins(c, cx, iconY, iconS); } // no room for the coins under two lines of words
      if (TILE_ICON[t.icon!]) (icon as Loose)[TILE_ICON[t.icon!]](c, cx, iconY, iconS);
      c.fillStyle = '#3a2416';
      let price = '';
      if (t.p) price = (t.p / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tr';
      if (t.t === 'tax' && t.kind === 'income') price = `Trả ${(tune.income_tax / 1000).toLocaleString('vi-VN')} tr`;
      if (twoLine) { // two short lines read at a glance, where one long line shrank to a whisper
        fitFont(`${Math.round(tune.prop_tax_pct * 100)}%`, 46, tw * 0.92); c.fillText(`${Math.round(tune.prop_tax_pct * 100)}%`, cx, priceTop);
        price = `tối đa ${(tune.prop_tax_flat / 1000).toLocaleString('vi-VN')} tr`;
      }
      if (price) { fitFont(price, 40, tw * 0.92); c.fillText(price, cx, priceY); }
    }
    c.strokeStyle = '#3a2416'; c.lineWidth = 10; c.strokeRect(5, 5, S - 10, S - 10);
  });
}
export function pipTexture(n: number) {
  return canvasTex(128, 128, (c: CanvasRenderingContext2D, w: number) => {
    c.fillStyle = '#fbf7ee'; c.fillRect(0, 0, w, w);
    c.strokeStyle = '#d8d0bf'; c.lineWidth = 6; c.strokeRect(3, 3, w - 6, w - 6);
    const P3 = { 1: [[2, 2]], 2: [[1, 1], [3, 3]], 3: [[1, 1], [2, 2], [3, 3]], 4: [[1, 1], [3, 1], [1, 3], [3, 3]], 5: [[1, 1], [3, 1], [2, 2], [1, 3], [3, 3]], 6: [[1, 1], [3, 1], [1, 2], [3, 2], [1, 3], [3, 3]] }[n];
    c.fillStyle = n === 1 ? '#c8201f' : '#1d1d1d';
    for (const [a, b] of P3!) { c.beginPath(); c.arc(a * w / 4, b * w / 4, n === 1 ? 17 : 12, 0, Math.PI * 2); c.fill(); }
  });
}
