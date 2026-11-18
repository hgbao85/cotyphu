// What a player set in the settings panel, kept in this browser: the sound's volume and whether the
// moving touches play (coins flying, confetti, pieces hopping, ducks swimming). A leaf file: it imports
// nothing from the game, so any file may read it while the modules load. The look (chibi or sơn mài)
// is kept by src/core/theme.ts, which must know it before anything is drawn.

const KEY = 'tpdv-prefs';
/** A player who asked their system for less motion starts with the effects off. */
const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The settings now. volume: 0 to 1, or null for the game's own (data/config.json). */
export const prefs: { volume: number | null; effects: boolean } = { volume: null, effects: !calm };
try {
  const kept = JSON.parse(localStorage.getItem(KEY) || '{}');
  if (typeof kept.volume === 'number' && kept.volume >= 0 && kept.volume <= 1) prefs.volume = kept.volume;
  if (typeof kept.effects === 'boolean') prefs.effects = kept.effects;
} catch { /* a private window, or nothing kept yet: the defaults */ }

/** Keeps the settings for the next visit (silently does nothing where storage is blocked). */
export function savePrefs(): void {
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* not kept: fine */ }
}
