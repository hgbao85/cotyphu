// The self-play numbers as Markdown tables: game length, wins by place in the turn order, wins by
// level, and the rent each tile and colour group earned. Observations only; reading them is the
// designer's.
//
//   node --experimental-strip-types tools/balance/report.mjs <experiment.json>... > report.md
import { readFileSync } from 'node:fs';
import { TILES, GROUPS } from '../../src/game/data.ts';

const files = process.argv.slice(2);
const exps = files.map(f => JSON.parse(readFileSync(f, 'utf8')));
const LV = ['Dễ', 'Vừa', 'Khó'];
const pct = (a, b) => (b ? `${(100 * a / b).toFixed(1)}%` : '–');
const money = v => `${(v / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tr`; // money is in thousands of đồng
const q = (xs, f) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(f * (s.length - 1) + 0.5))]; };
const out = [];
const row = cells => out.push(`| ${cells.join(' | ')} |`);
const head = cells => { row(cells); row(cells.map(() => '---')); };

out.push('## Độ dài ván', '');
head(['Thử nghiệm', 'Ván', 'Kiểu', 'Xong', 'Chưa xong (tới giới hạn)', 'Vòng: trung vị', 'Vòng: 10% – 90%', 'Có người phá sản']);
for (const e of exps) {
  const done = e.results.filter(r => r.finished), rounds = done.map(r => r.rounds);
  const anyBroke = e.results.filter(r => r.players.some(p => p.bankrupt)).length;
  row([e.name, e.games, e.mode === 'rounds' ? 'theo vòng' : `tới khi phá sản (giới hạn ${e.maxRounds} vòng)`, done.length, e.results.length - done.length,
    rounds.length ? q(rounds, 0.5) : '–', rounds.length ? `${q(rounds, 0.1)} – ${q(rounds, 0.9)}` : '–', pct(anyBroke, e.results.length)]);
}

out.push('', '## Thắng theo thứ tự đi', '', 'Vị trí 1 là người đi đầu (tung cao nhất). Công bằng là 100% chia đều số người; ± là khoảng dao động thường gặp (2 độ lệch chuẩn) với số ván này.', '');
for (const e of exps) {
  const done = e.results.filter(r => r.finished && r.winnerPos >= 0), n = e.results[0]?.players.length || 0;
  if (!done.length || new Set(e.seats.filter(s => s.kind === 'ai').map(s => s.lv)).size > 1) continue;
  const fair = 1 / n, band = 2 * Math.sqrt(fair * (1 - fair) / done.length);
  head([`${e.name} (${done.length} ván xong)`, ...Array.from({ length: n }, (_, i) => `Đi thứ ${i + 1}`)]);
  row(['Tỉ lệ thắng', ...Array.from({ length: n }, (_, i) => pct(done.filter(r => r.winnerPos === i).length, done.length))]);
  row(['Công bằng', ...Array.from({ length: n }, () => `${(100 * fair).toFixed(0)}% ± ${(100 * band).toFixed(0)}`)]);
  out.push('');
}

out.push('## Thắng theo cấp máy', '');
for (const e of exps) {
  const lvs = [...new Set(e.seats.filter(s => s.kind === 'ai').map(s => s.lv))];
  if (lvs.length < 2) continue;
  const done = e.results.filter(r => r.finished && r.winnerPos >= 0);
  head([`${e.name} (${done.length} ván xong)`, 'Số ghế', 'Thắng', 'Nếu ngang sức']);
  for (const lv of lvs) {
    const seats = e.seats.filter(s => s.kind === 'ai' && s.lv === lv).length, total = e.seats.filter(s => s.kind === 'ai').length;
    row([`Máy ${LV[lv]}`, seats, pct(done.filter(r => r.players[r.winnerPos].lv === lv).length, done.length), pct(seats, total)]);
  }
  out.push('');
}

out.push('## Tiền thuê theo ô', '', 'Tổng tiền thuê một ô thu được, chia cho số ván, trong các thử nghiệm theo vòng toàn máy Vừa (mọi ván dài như nhau). Tính cả tiền thuê người trả không đủ. "Thu / giá" là tiền thuê trung bình mỗi ván so với giá mua ô.', '');
const same = exps.filter(e => e.mode === 'rounds' && e.seats.filter(s => s.kind === 'ai').every(s => s.lv === 1)); // games of one length
const nGames = same.reduce((a, e) => a + e.results.length, 0);
const rent = Array(40).fill(0);
for (const e of same) for (const r of e.results) for (const [t, v] of Object.entries(r.rents)) rent[t] += v;
const tiles = TILES.map((t, i) => ({ i, t, perGame: rent[i] / nGames })).filter(x => x.t.p);
const kind = t => t.t === 'prop' ? GROUPS[t.g].name : t.t === 'port' ? 'Bến cảng, sân bay' : 'Công ty';
head(['Hạng', 'Ô', 'Nhóm', 'Giá', 'Tiền thuê / ván', 'Thu / giá']);
[...tiles].sort((a, b) => b.perGame - a.perGame).forEach((x, k) => row([k + 1, x.t.n, kind(x.t), money(x.t.p), money(x.perGame), `${(x.perGame / x.t.p).toFixed(2)}×`]));

out.push('', '## Tiền thuê theo nhóm', '');
head(['Nhóm', 'Số ô', 'Tổng giá mua', 'Tiền thuê / ván', 'Thu / giá']);
const groups = new Map();
for (const x of tiles) { const k = kind(x.t); const g = groups.get(k) || { n: 0, price: 0, rent: 0 }; g.n++; g.price += x.t.p; g.rent += x.perGame; groups.set(k, g); }
[...groups.entries()].sort((a, b) => b[1].rent - a[1].rent).forEach(([k, g]) => row([k, g.n, money(g.price), money(g.rent), `${(g.rent / g.price).toFixed(2)}×`]));

const errs = exps.flatMap(e => e.errors);
out.push('', `Lỗi trang trong lúc chạy: ${errs.length ? errs.join('; ') : 'không có'}.`);
console.log(out.join('\n'));
