// Self-play numbers by place in the turn order: wins, the first land, land at round 10, rent paid and
// received, going broke. Observations only.
//
//   node tools/balance/by-place.mjs <runs.json>... > by-place.md
import { readFileSync } from 'node:fs';

const runs = process.argv.slice(2).flatMap(f => JSON.parse(readFileSync(f, 'utf8')).results);
const n = runs[0].players.length, done = runs.filter(r => r.finished && r.winnerPos >= 0);
const avg = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const tr = v => `${(v / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tr`;
const pct = (a, b) => `${(100 * a / b).toFixed(1)}%`;
const fair = 1 / n, band = 2 * Math.sqrt(fair * (1 - fair) / done.length);
const L = [];
L.push(`${runs.length} ván, ${done.length} ván xong. Công bằng: ${(100 * fair).toFixed(0)}% ± ${(100 * band).toFixed(1)}.`, '');
L.push(`| | ${Array.from({ length: n }, (_, i) => `Đi thứ ${i + 1}`).join(' | ')} |`, `| --- |${' --- |'.repeat(n)}`);
const line = (label, f) => L.push(`| ${label} | ${Array.from({ length: n }, (_, i) => f(i)).join(' | ')} |`);
line('Thắng', i => pct(done.filter(r => r.winnerPos === i).length, done.length));
line('Phá sản đầu tiên trong ván', i => pct(runs.filter(r => { const b = r.broke || []; const first = Math.min(...b.filter(x => x !== undefined && x !== null)); return Number.isFinite(first) && b[i] === first; }).length, runs.length));
line('Vòng mua đất đầu tiên (TB)', i => avg(runs.map(r => r.firstBuy?.[i]).filter(x => x != null)).toFixed(2));
line('Số ô có ở vòng 10 (TB)', i => avg(runs.map(r => r.props10?.[i] ?? 0)).toFixed(2));
line('Tiền thuê đã trả / ván (TB)', i => tr(avg(runs.map(r => r.paid?.[i] ?? 0))));
line('Tiền thuê đã nhận / ván (TB)', i => tr(avg(runs.map(r => r.got?.[i] ?? 0))));
line('Nhận trừ trả / ván (TB)', i => tr(avg(runs.map(r => (r.got?.[i] ?? 0) - (r.paid?.[i] ?? 0)))));
line('Phá sản ở vòng (TB, ai phá sản)', i => avg(runs.map(r => r.broke?.[i]).filter(x => x != null)).toFixed(1));
console.log(L.join('\n'));
