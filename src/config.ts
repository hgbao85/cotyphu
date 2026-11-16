// Every tuning value, from data/config.json: each with value, min, max and step.
// The game reads them live through `tune.<name>`, so the dev server's tweak panel
// (src/dev/tune.ts, loaded by main.ts on the dev server only) changes play at once.
// No browser here: the rules import this under Vitest too.
import data from '../data/config.json';

/** One tunable value and the range the tweak panel offers. */
export interface Entry {
  value: number;
  min: number;
  max: number;
  step: number;
}

/** The whole file: `seed` is a plain number, every other key an Entry. */
export const CONFIG = data as unknown as Record<string, Entry> & { seed: number };

/** Live reads: `tune.salary` is `CONFIG.salary.value` at the moment it is read. */
export const tune = new Proxy({} as Record<string, number>, {
  get: (_, k: string) => (CONFIG[k] as Entry).value,
});
