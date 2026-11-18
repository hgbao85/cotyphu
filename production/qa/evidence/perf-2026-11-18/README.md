# Speed on a slow phone, 2026-11-18

Measured with `tools/fps.mjs` (Chrome, the real GPU, the CPU slowed 4x; a game of four computers running
at ×1; 6–8 s of frames). `node tools/fps.mjs 4 8` repeats it. Absolute numbers depend on the machine:
compare before and after on the same one.

| Screen | Before fps | After fps | Draw calls before → after |
| --- | --- | --- | --- |
| Phone 390×844 | 13–15 | 31–37 | 316 → 160 |
| Phone 360×640 | 24 | 38 | 316 → 160–254 |
| Wide 1280×720 | 10 | 33 | 322 → 166 |

Where the time went (CPU profile, phone): the 3D drawing 54% (over 300 draw calls a frame, shadows
15%), the player cards 17% (each animal face drawn with paths every frame; `money()` building a
Vietnamese number formatter on every call, 4%).

What changed: `money()` keeps its strings; the animal faces are drawn once into small canvases;
plain materials are shared (`mat()`); the decks are one block each; flat things cast no shadow; the
shadow map is redrawn every other frame. The board looks the same (board-before.png, board-after.png).
