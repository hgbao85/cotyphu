// Self-play for balance: the computer plays itself many times and the numbers are written out.
//
//   npm run build:single
//   node tools/balance/self-play.mjs <name> <games> <seats> <mode> <out.json> [maxRounds]
//     seats: comma list of ai0 (Dễ), ai1 (Vừa), ai2 (Khó), e.g. ai1,ai1,ai1,ai1
//     mode:  bankrupt (until one is left) or rounds (max_rounds, richest wins)
//
// It opens the single-file build in headless Chrome (the same one the checks use), sets each game up
// through window.game.configure with its own seed, steps the game without drawing, and records per
// game: the rounds, who won (their place in the turn order and their level), who went bankrupt, and the
// rent each tile collected (the game's 'rent' events). It emits numbers only; the report reads them.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [name, gamesArg, seatsArg, mode, out, capArg] = process.argv.slice(2);
if (!out) { console.error('usage: self-play.mjs <name> <games> <seats> <mode> <out.json>'); process.exit(2); }
const games = Number(gamesArg);
const seats = seatsArg.split(',').map(s => ({ kind: 'ai', lv: Number(s.replace('ai', '')) }));
while (seats.length < 4) seats.push({ kind: 'off' });

const { chromium } = createRequire(resolve('package.json'))('@playwright/test');
const which = spawnSync('bash', ['.claude/scripts/page-shot.sh', '--which'], { encoding: 'utf8' });
const browser = await chromium.launch({ executablePath: which.status === 0 ? which.stdout.trim() || undefined : undefined });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(`${pathToFileURL(resolve('dist-single/index.html')).href}?manual=1&render=cheap`);
await page.waitForFunction(() => typeof window.game?.step === 'function');

const MAX_ROUNDS = Number(capArg) || 150; // a game still going after this round is counted as unfinished
const results = [];
const t0 = Date.now();
for (let g = 0; g < games; g++) {
  const seed = 1000 + g;
  const r = await page.evaluate(({ seats, mode, seed, MAX_ROUNDS }) => {
    const game = window.game;
    game.configure({ seats, mode, seed });
    game.events.length = 0;
    game.press('Enter'); game.step(1, false);
    const rents = {};
    let steps = 0;
    while (game.scene === 'play' && game.state.round <= MAX_ROUNDS && steps < 3e6) {
      game.step(600, false); steps += 600;
      for (const e of game.events) if (e.type === 'rent') rents[e.tile] = (rents[e.tile] || 0) + e.amt;
      game.events.length = 0;
    }
    const s = game.state;
    return {
      seed, steps, finished: game.scene === 'results', rounds: s.round, reason: s.reason || '',
      players: s.players.map((p, pos) => ({ pos, seat: p.id, lv: p.lv, bankrupt: p.bankrupt, cash: p.cash })),
      winnerPos: game.scene === 'results' ? s.ranking[0].i : -1,
      owner: s.owner, level: s.level, rents,
    };
  }, { seats, mode, seed, MAX_ROUNDS });
  results.push(r);
  if ((g + 1) % 25 === 0) console.log(`${name}: ${g + 1}/${games} games, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
await browser.close();
writeFileSync(out, JSON.stringify({ name, games, seats, mode, maxRounds: MAX_ROUNDS, errors, results }));
console.log(`${name}: done, ${errors.length} page errors -> ${out}`);
