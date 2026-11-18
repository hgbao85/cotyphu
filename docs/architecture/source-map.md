# Source map

Where each part of Tỷ Phú Đất Việt lives, and the four rules that keep the files apart. Written when
`src/main.ts` (3,377 lines) was split, 2026-11-18. The first line of every file says what it holds.

## Where things are

| Area | Files |
| --- | --- |
| Start, scenes, the loop, layout, input, the check hook | `src/main.ts` |
| What the whole game shares | `src/core/store.ts` (state, scene, setup), `src/core/flags.ts` (F: open menus, scroll, notes), `src/core/env.ts` (how the page was opened) |
| Rules with no browser (Vitest) | `src/game/rules.ts`, `data.ts`, `board.ts`, `rng.ts`, `chat.ts`, `types.ts` |
| The turn: reset, order of play, landing, cards, rent, building, debt, keep cards, round events | `src/game/turn.ts` |
| The computer players | `src/game/ai.ts` |
| Online: the relay socket / the room, seats, sync, coming back, the vote | `src/net/net.ts` / `src/net/room.ts` |
| A one-screen game kept across reloads | `src/core/keepLocal.ts` |
| 3D: the table and frame sync / models / board face / materials / moods | `src/three/scene3d.ts`, `buildings.ts`, `boardTexture.ts`, `materials.ts`, `moods.ts`; pieces in `src/animals.ts` |
| 2D drawing, the phone layout, the setup screen | `src/ui/draw.ts`, `phone.ts`, `setupScreen.ts`, icons in `src/draw/icons.ts` |
| Small screens | `src/ui/toolbar.ts` (history, emotes, chat), `tips.ts`, `summary.ts`, `pages.ts` (rules, history), `chatBox.ts` |
| Installing as an app, keeping the screen on | `src/app/install.ts` |
| Sound, the canvas, tuning | `src/audio.ts`, `src/screen.ts`, `src/config.ts` (+ `data/config.json`) |

## The rules that keep it working

1. **Only `store.ts` assigns `state`, `scene` and `setup`.** Everyone reads them directly (ES module
   bindings follow every change); a whole new value goes through `setState`, `setScene`, `setSetup`.
   Changing a field (`state.round++`) is fine anywhere.
2. **A flag several files change lives in `F`** (`src/core/flags.ts`): `F.inspect = 3`, not a `let` in one
   file that others cannot assign.
3. **No file reads another file's value while the modules load.** The files import each other in a
   cycle through `main.ts`, which is safe only while every cross-file read happens inside a function.
   A value needed at load time (like `CHEAP`) goes in a leaf file that imports nothing from the game
   (`src/core/env.ts`). `tests/integration/dev.spec.ts` loads the dev server and fails if this breaks;
   the bundled build does not show it.
4. **Moving code is checked like a feature:** `npm test`, and the same-seed replay
   (`.claude/scripts/one-shot-grow.sh replay ty-phu-dat-viet --as story`) must still match.
