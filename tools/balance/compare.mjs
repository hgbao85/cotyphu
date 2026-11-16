// Several tuning candidates side by side, one row each: how the "until bankrupt" games end and how
// the 30-round games go. Numbers only; choosing a candidate is the designer's.
//
//   node tools/balance/compare.mjs <label>=<bankrupt.json>,<rounds.json> ... > compare.md
import { readFileSync } from 'node:fs';

const pct = (a, b) => (b ? `${Math.round(100 * a / b)}%` : '–');
const q = (xs, f) => { if (!xs.length) return '–'; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(f * (s.length - 1) + 0.5))]; };
const tr = v => `${(v / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tr`;
const rows = process.argv.slice(2).map(arg => {
  const [label, files] = arg.split('='), [bf, rf] = files.split(',');
  const b = JSON.parse(readFileSync(bf, 'utf8')), r = JSON.parse(readFileSync(rf, 'utf8'));
  const done = b.results.filter(x => x.finished), rounds = done.map(x => x.rounds);
  const rd = r.results.filter(x => x.finished && x.winnerPos >= 0), n = r.results[0].players.length;
  const out = r.results.reduce((a, x) => a + x.players.filter(p => p.bankrupt).length, 0) / r.results.length;
  const rent = r.results.reduce((a, x) => a + Object.values(x.rents).reduce((s, v) => s + v, 0), 0) / r.results.length;
  return {
    label, tune: Object.entries(r.tune || {}).map(([k, v]) => `${k} ${v}`).join(', ') || 'số hiện tại',
    finished: `${pct(done.length, b.results.length)} (${done.length}/${b.results.length})`, median: q(rounds, 0.5), spread: rounds.length ? `${q(rounds, 0.1)}–${q(rounds, 0.9)}` : '–',
    broke30: pct(r.results.filter(x => x.players.some(p => p.bankrupt)).length, r.results.length), out30: out.toFixed(2), rent30: tr(rent),
    pos: Array.from({ length: n }, (_, i) => pct(rd.filter(x => x.winnerPos === i).length, rd.length)).join(' / '), n30: rd.length,
  };
});
const L = [];
L.push('| Bộ số | Giá trị | "Phá sản": ván xong trước vòng 150 | Vòng lúc xong: trung vị (10–90%) | 30 vòng: ván có người phá sản | 30 vòng: số người phá sản / ván | 30 vòng: tổng tiền thuê / ván | 30 vòng: thắng theo thứ tự đi 1 / 2 / 3 / 4 |');
L.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const x of rows) L.push(`| ${x.label} | ${x.tune} | ${x.finished} | ${x.median} (${x.spread}) | ${x.broke30} | ${x.out30} | ${x.rent30} | ${x.pos} |`);
console.log(L.join('\n'));
