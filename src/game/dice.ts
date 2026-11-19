// The dice for every game on the hub: a hard throw tends to the high faces, a soft one to the low ones,
// and every face can still come up. The shake's power (0 a flick, 1 a full shake, src/*/game.ts
// shakePower) tilts the six faces' chances: face f weighs e^(t (f - 3.5)), t = dice_power_tilt x
// (2 power - 1), so a middle throw is fair and dice_power_tilt 0 makes every throw fair. One rng() per die,
// as before, so a seed still replays a game exactly. Pure (tune and rng only): Vitest runs it.
import { tune } from '../config';
import { rng } from './rng';

/** The six faces' chances (index 0 is face 1) for a throw of this power, with this tilt (data/config.json). */
export function faceChances(power: number, tilt = tune.dice_power_tilt): number[] {
  const t = tilt * (2 * Math.min(1, Math.max(0, power)) - 1);
  const w = [1, 2, 3, 4, 5, 6].map(f => Math.exp(t * (f - 3.5))), sum = w.reduce((a, b) => a + b, 0);
  return w.map(x => x / sum);
}
/** One die, thrown with this power: 1 to 6. */
export function rollFace(power: number, tilt = tune.dice_power_tilt): number {
  const p = faceChances(power, tilt);
  let u = rng();
  for (let f = 0; f < 5; f++) { if (u < p[f]) return f + 1; u -= p[f]; }
  return 6;
}
/** n dice thrown with this power. */
export const rollDice = (n: number, power: number): number[] => Array.from({ length: n }, () => rollFace(power));

/** Every throw of n dice (1 or 2) with its chance at this power: what a computer weighs before it shakes. */
export function throwChances(n: number, power: number): { dice: number[]; p: number }[] {
  const p = faceChances(power), out: { dice: number[]; p: number }[] = [];
  if (n < 2) for (let a = 1; a <= 6; a++) out.push({ dice: [a], p: p[a - 1] });
  else for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) out.push({ dice: [a, b], p: p[a - 1] * p[b - 1] });
  return out;
}
/** The powers a computer that aims picks from: a flick, a middle throw, a full shake. */
export const AIM_POWERS = [0, 0.5, 1];
/**
 * The power that makes the throw worth most, by value(dice) weighed by each throw's chance (ties: the
 * middle throw). For Khó, which aims as a person can; Dễ and Vừa shake for a random time.
 */
export function bestPower(n: number, value: (dice: number[]) => number): number {
  let best = 0.5, bestV = -Infinity;
  for (const pw of [0.5, 0, 1]) {
    const v = throwChances(n, pw).reduce((s, x) => s + x.p * value(x.dice), 0);
    if (v > bestV + 1e-9) { bestV = v; best = pw; }
  }
  return best;
}
/** How long to hold the shake for a power (the computer's hold; see meterPos). */
export const holdForPower = (power: number): number => Math.max(0.05, power) * tune.dice_meter_sweep; // the bar climbs first: power p at p x sweep

// ---- The power bar: it runs up and down while the button is held; a sweet zone is lucky -----------
// Held, the bar climbs from empty to full in dice_meter_sweep seconds, falls back, and climbs again; the
// throw's power is where the bar stands when the button is let go (or after shake_max_time, where it is
// then). Each shake has a small sweet zone, 10 to 15% of the bar somewhere between 20% and 80%: let go
// inside it and, with chance dice_zone_luck, the dice are thrown twice and the throw better for the
// thrower is kept (its worth as the game's Khó weighs it). Asked for 19/11/2026: a little more skill.

/** The sweet zone of one shake: from a to b, shares of the bar. */
export interface Zone { a: number; b: number }
/** A new sweet zone: 10 to 15% of the bar, wholly between 20% and 80%. */
export function makeZone(): Zone {
  const w = 0.10 + rng() * 0.05, a = 0.2 + rng() * (0.6 - w);
  return { a, b: a + w };
}
/** Where the bar stands t seconds into the shake: 0 to 1 and back, again and again. */
export function meterPos(t: number): number {
  const s = Math.max(0, t) / tune.dice_meter_sweep, f = s % 2;
  return f <= 1 ? f : 2 - f;
}
/** True when a throw of this power let go inside the zone. */
export const inZone = (power: number, z?: Zone | null): boolean => !!z && power >= z.a && power <= z.b;
/** How often a computer of this level lets go inside the zone (data/config.json ai_zone_hit_*). */
const zoneHitChance = (lv: number): number => (lv >= 2 ? tune.ai_zone_hit_hard : lv >= 1 ? tune.ai_zone_hit_mid : tune.ai_zone_hit_easy);
/**
 * How long a computer holds: into the zone as often as its level hits it, else to its aim (Khó's
 * bestPower) or a random power outside the zone. The bar climbs first, so a power p is reached at p x sweep.
 */
export function aiHold(lv: number, zone: Zone, aim?: number): number {
  let target: number;
  if (rng() < zoneHitChance(lv)) target = zone.a + (0.2 + rng() * 0.6) * (zone.b - zone.a);
  else {
    // Khó's aim is a person's, not a machine's: now and then it throws without aiming (ai_hard_aim_miss), and
    // when it aims its hand is off by up to ai_hard_aim_spread of the bar either way
    if (aim !== undefined && rng() < tune.ai_hard_aim_miss) aim = undefined;
    if (aim !== undefined) aim = Math.max(0, Math.min(1, aim + (rng() * 2 - 1) * tune.ai_hard_aim_spread));
    target = aim ?? 0.25 + rng() * 0.7;
    if (inZone(target, zone)) target = target - zone.a < zone.b - target ? zone.a - 0.03 : zone.b + 0.03; // a miss stays a miss
  }
  return Math.max(0.05, Math.min(1, target)) * tune.dice_meter_sweep;
}
/**
 * The dice of a throw: n dice at this power; let go inside the zone, with chance dice_zone_luck a second
 * throw is made and the one worth more to the thrower kept (worth: the game's own measure, as Khó's).
 */
export function throwWithZone(n: number, power: number, hit: boolean, worth: (dice: number[]) => number): number[] {
  const first = rollDice(n, power);
  if (!hit || rng() >= tune.dice_zone_luck) return first;
  const second = rollDice(n, power);
  return worth(second) > worth(first) ? second : first;
}
/** A friend's let-go power from their own screen, made safe: a number 0 to 1, or undefined. */
export const safePower = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : undefined);
