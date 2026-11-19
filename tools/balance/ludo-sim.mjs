// Cá Ngựa self-play: the computers play many games with the real rules and choices (src/ludo/rules.ts),
// turn by turn as src/ludo/game.ts runs them (a double throws again, a die left moves again), and this
// prints what a game is like: how long, how many kicks, who wins by seat. Observations, not verdicts.
//
//   node --experimental-strip-types tools/balance/ludo-sim.mjs [games=400] [players=4] [lv=1] [key=value ...]
//   e.g. ... 400 4 2 ludo_no_jump=0      (any ludo_* value of data/config.json, for this run only)
//   lv may differ by seat ("1,0,0,0"), and a value one seat only ("seat0.ludo_ai_ahead=0"): one
//   computer against the others, to see whether a change plays better, not only faster.
import { readFileSync } from 'node:fs';
import { legalMoves, applyMove, aiPlan, allHome, throwsAgain } from '../../src/ludo/rules.ts';

const [games = 400, nPlayers = 4, lv = 1, ...over] = process.argv.slice(2);
const cfg = JSON.parse(readFileSync(new URL('../../data/config.json', import.meta.url), 'utf8'));
const tune = Object.fromEntries(Object.entries(cfg).filter(([, v]) => v && typeof v === 'object').map(([k, v]) => [k, v.value]));
const seatTune = [{}, {}, {}, {}];
for (const kv of over) { const [k, v] = kv.split('='); const m = /^seat(\d)\.(.+)$/.exec(k); if (m) seatTune[+m[1]][m[2]] = Number(v); else tune[k] = Number(v); }
const levels = String(lv).split(',').map(Number), levelOf = id => levels[id % levels.length];
const aiOf = t => ({ cell: t.ludo_ai_cell, ahead: t.ludo_ai_ahead, kick: t.ludo_ai_kick, kickFar: t.ludo_ai_kick_far, out: t.ludo_ai_out, home: t.ludo_ai_home, danger: t.ludo_ai_danger, escape: t.ludo_ai_escape });
const R = {
  horses: Math.max(1, Math.min(4, Math.round(tune.ludo_horses))), dice: tune.ludo_dice >= 2 ? 2 : 1,
  exitOnOne: tune.ludo_exit_on_one >= 1, exitDouble: tune.ludo_exit_double >= 1, bonusSix: tune.ludo_bonus_six >= 1, bonusKick: tune.ludo_bonus_kick >= 1,
  noJump: tune.ludo_no_jump >= 1, homeStrict: tune.ludo_home_strict >= 1,
  ai: aiOf(tune),
};
const rulesFor = id => ({ ...R, ai: aiOf({ ...tune, ...seatTune[id] }) });

/** A seeded generator (mulberry32), so a run repeats exactly. */
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// the sides played: the first n corners, or SIDES=0,2 (two players across the board)
const SIDES = process.env.SIDES ? process.env.SIDES.split(',').map(Number) : [0, 1, 2, 3].slice(0, Number(nPlayers));
const out = { turns: [], throws: [], kicks: [], stuck: [], winnerSeat: SIDES.map(() => 0), winnerId: SIDES.map(() => 0), firstWins: 0, unfinished: 0, kickedFar: [] };
for (let g = 0; g < Number(games); g++) {
  const rand = rng(1000 + g);
  const players = SIDES.map((side, id) => ({ id, side, name: `P${id}`, kind: 'ai', lv: levelOf(id), horses: Array(R.horses).fill(-1), place: 0, kicks: 0, kicked: 0, sixes: 0 }));
  const first = Math.floor(rand() * players.length);
  let cur = first, throws = 0, stuck = 0, turns = 0, winner = -1;
  const far = [];
  while (winner < 0 && throws < 20000) {
    turns++;
    let again = true;
    while (again && winner < 0) {
      throws++;
      const d = Array.from({ length: R.dice }, () => 1 + Math.floor(rand() * 6));
      again = throwsAgain(d) && R.bonusSix;
      const use = [...d];
      let moved = false;
      while (use.length) {
        const moves = legalMoves(players, cur, use, R);
        if (!moves.length) break;
        const m = aiPlan(players, cur, moves, use, levelOf(cur), rulesFor(cur), rand);
        if (m.kick) { far.push(players[m.kick.pi].horses[m.kick.h]); if (R.bonusKick) again = true; }
        applyMove(players, cur, m); moved = true;
        for (const x of m.dice) use.splice(use.indexOf(x), 1);
        if (allHome(players[cur])) { winner = cur; break; }
      }
      if (!moved) stuck++;
    }
    cur = (cur + 1) % players.length;
  }
  if (winner < 0) { out.unfinished++; continue; }
  out.turns.push(turns); out.throws.push(throws); out.stuck.push(stuck / throws);
  out.kicks.push(players.reduce((s, p) => s + p.kicks, 0)); out.kickedFar.push(...far);
  out.winnerSeat[(winner - first + players.length) % players.length]++; out.winnerId[winner]++;
}
const avg = a => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(q * (s.length - 1))] ?? 0; };
console.log(JSON.stringify({
  rules: R, players: Number(nPlayers), lv: String(lv), games: Number(games), unfinished: out.unfinished,
  throwsPerGame: { avg: Math.round(avg(out.throws)), p10: pct(out.throws, 0.1), p90: pct(out.throws, 0.9) },
  turnsPerGame: Math.round(avg(out.turns)),
  kicksPerGame: { avg: +avg(out.kicks).toFixed(1), p90: pct(out.kicks, 0.9) },
  kicksPer100Throws: +(100 * avg(out.kicks) / avg(out.throws)).toFixed(1),
  kickedHorseHadCome: Math.round(avg(out.kickedFar)), // how far, on average, a kicked horse had got (of 51)
  throwsWithNoMove: `${Math.round(100 * avg(out.stuck))}%`,
  winsBySeat: out.winnerId.map(n => `${Math.round(100 * n / Math.max(1, Number(games) - out.unfinished))}%`), // seat 0, 1... (their levels and values)
  winsByTurnOrder: out.winnerSeat.map(n => `${Math.round(100 * n / Math.max(1, Number(games) - out.unfinished))}%`), // who went first, second...
}, null, 1));
