// The game's random numbers: mulberry32, seeded once per game. Every gameplay random call reads
// rng(), never Math.random, so a seed replays a game exactly. No browser.

let seed = 1;

/** Starts the sequence from seed s. */
export function setSeed(s: number): void {
  seed = s;
}

/** A new random seed for a new game, from the platform's crypto source. */
export function freshSeed(): number {
  const u = new Uint32Array(1);
  if (globalThis.crypto && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(u);
  else u[0] = (Date.now() * 2654435761) >>> 0;
  return (u[0] | 0) || 1;
}

/** The next number in [0, 1). */
export function rng(): number {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** 0..n-1 in a random order (Fisher-Yates over rng()). */
export function shuffled(n: number): number[] {
  const a = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
