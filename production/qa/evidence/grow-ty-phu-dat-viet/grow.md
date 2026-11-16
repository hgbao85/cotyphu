# Grow record: ty-phu-dat-viet

The one-shot `prototypes/ty-phu-dat-viet/` (from commit c114940, first build tag
`one-shot/ty-phu-dat-viet`) grown into the Web project at the root. The one-shot folder is
unchanged.

| Step | What | Result |
|---|---|---|
| 1 Reference | same-seed replay of the one-shot, run twice | `exact yes`, 0 errors (`reference.png`) |
| 2 Copy | Vite project, still JavaScript; three.js pinned as an npm dependency (0.186.1) | `match yes`, 0 errors (`copy.png`) |
| 3 TypeScript | split into `src/game/` (data, board, rules, rng, types), `audio.ts`, `screen.ts`, `config.ts`, `main.ts`; `@types/three` 0.186.0 | `tsc --noEmit` clean, `match yes`, 0 errors (`typescript.png`) |
| 4 Rules under test | Vitest: rent (empty land, full group, ports, utilities), build cost, net worth, money, rng; Playwright: boot and a scripted turn repeated by seed | 8 unit + 2 integration passed; the full-group test was watched failing against a broken rule |
| 5 Record | `engine.name: Web` written; build, `test-run.sh web` (`web:pass`, 10 tests), `npm run smoke` | all passed |

Seen: `typescript.png` beside `reference.png`: the same board, HUD and popup.

NOT ASSESSED: nothing.

Still `Loose` (typing to do): popups, debts, UI buttons, floaters, token and dice animation
records, the card-draw and payment lists, and the ranking rows (`src/game/types.ts`, `src/main.ts`).
