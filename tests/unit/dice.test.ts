// Vitest: the dice by the shake's power (src/game/dice.ts). A hard throw tends high, a soft one low, a
// middle one is fair, and every face can still come up. Values from data/config.json dice_power_tilt.
import { describe, expect, it } from 'vitest';
import config from '../../data/config.json';
import { faceChances, rollFace, bestPower, throwChances, meterPos, makeZone, inZone, aiHold, throwWithZone, rollDice, friendPower, letGoPower } from '../../src/game/dice';
import { setSeed } from '../../src/game/rng';

const TILT = config.dice_power_tilt.value;
const round3 = (a: number[]) => a.map(x => Math.round(x * 1000) / 1000);

describe('faceChances', () => {
  it('is fair for a middle throw, and for any throw with the tilt at 0', () => {
    expect(round3(faceChances(0.5, TILT))).toEqual(Array(6).fill(0.167));
    expect(round3(faceChances(1, 0))).toEqual(Array(6).fill(0.167));
    expect(round3(faceChances(0, 0))).toEqual(Array(6).fill(0.167));
  });
  it('tends high for a full shake (about a quarter sixes) and low for a flick, every face still possible', () => {
    // Asked for (19/11/2026): a hard throw should throw high and a soft one low ("vừa phải": six about 25%).
    const hard = faceChances(1, TILT), soft = faceChances(0, TILT);
    expect(hard[5]).toBeCloseTo(0.25, 2);
    expect(hard[0]).toBeCloseTo(0.10, 2);
    expect(round3(soft)).toEqual(round3([...hard].reverse()));
    expect(Math.min(...hard, ...soft)).toBeGreaterThan(0.05);
    for (let k = 1; k < 6; k++) expect(hard[k]).toBeGreaterThan(hard[k - 1]);
  });
});

describe('rollFace', () => {
  it('throws the faces at those chances (120000 throws, a fixed seed)', () => {
    setSeed(42);
    const n = 120000, count = Array(6).fill(0);
    for (let i = 0; i < n; i++) count[rollFace(1, TILT) - 1]++;
    const want = faceChances(1, TILT);
    count.forEach((c, k) => expect(Math.abs(c / n - want[k])).toBeLessThan(0.006));
  });
});

describe('bestPower (how Khó aims)', () => {
  it('shakes hard to throw high, flicks to throw low, and throws in the middle when it does not care', () => {
    expect(bestPower(2, d => d[0] + d[1])).toBe(1);
    expect(bestPower(2, d => -(d[0] + d[1]))).toBe(0);
    expect(bestPower(2, () => 7)).toBe(0.5);
  });
  it('weighs every throw of two dice, their chances adding up to 1', () => {
    expect(throwChances(2, 1).length).toBe(36);
    expect(throwChances(2, 1).reduce((s, x) => s + x.p, 0)).toBeCloseTo(1, 10);
    expect(throwChances(1, 0).reduce((s, x) => s + x.p, 0)).toBeCloseTo(1, 10);
  });
});

const SWEEP = config.dice_meter_sweep.value;

describe('the power bar (asked for 19/11/2026: it runs up and down, a sweet zone on it)', () => {
  it('climbs from empty to full in dice_meter_sweep seconds, falls back, and climbs again', () => {
    expect(meterPos(0)).toBe(0);
    expect(meterPos(SWEEP / 2)).toBeCloseTo(0.5, 10);
    expect(meterPos(SWEEP)).toBeCloseTo(1, 10);
    expect(meterPos(SWEEP * 1.5)).toBeCloseTo(0.5, 10);
    expect(meterPos(SWEEP * 2)).toBeCloseTo(0, 10);
    expect(meterPos(SWEEP * 2.25)).toBeCloseTo(0.25, 10);
  });
  it('puts its sweet zone 10 to 15% wide, wholly between 20% and 80% of the bar', () => {
    setSeed(7);
    for (let k = 0; k < 2000; k++) {
      const z = makeZone();
      expect(z.b - z.a).toBeGreaterThanOrEqual(0.1 - 1e-9);
      expect(z.b - z.a).toBeLessThanOrEqual(0.15 + 1e-9);
      expect(z.a).toBeGreaterThanOrEqual(0.2);
      expect(z.b).toBeLessThanOrEqual(0.8 + 1e-9);
    }
    expect(inZone(0.5, { a: 0.45, b: 0.57 })).toBe(true);
    expect(inZone(0.6, { a: 0.45, b: 0.57 })).toBe(false);
    expect(inZone(0.5, null)).toBe(false);
  });
  it('lets the computers into the zone by level: Dễ seldom, Vừa sometimes, Khó mostly (ai_zone_hit_*)', () => {
    setSeed(11);
    const rate = (lv: number) => { let hit = 0; for (let k = 0; k < 4000; k++) { const z = makeZone(); if (inZone(meterPos(aiHold(lv, z)), z)) hit++; } return hit / 4000; };
    expect(rate(0)).toBeCloseTo(config.ai_zone_hit_easy.value, 1);
    expect(rate(1)).toBeCloseTo(config.ai_zone_hit_mid.value, 1);
    expect(rate(2)).toBeCloseTo(config.ai_zone_hit_hard.value, 1);
  });
  it('lets Khó aim like a person: off by up to ai_hard_aim_spread, and now and then not aiming at all', () => {
    // Asked for (19/11/2026): Khó aimed exactly and won 83% against Vừa. Its zone hits are left out here (zone at the far end).
    setSeed(13);
    const zone = { a: 0.0, b: 0.0 }, spread = config.ai_hard_aim_spread.value, n = 4000;
    const powers = Array.from({ length: n }, () => meterPos(aiHold(2, zone, 1)));
    expect(Math.max(...powers)).toBeLessThanOrEqual(1);
    // aimed at the top, its hand off: powers just under the top (an exact aim gave 1 every time)
    expect(powers.filter(p => p > 1 - spread + 0.01 && p < 0.97).length / n).toBeGreaterThan(0.05);
    // not aimed: powers anywhere in the middle (an exact aim never gave these)
    expect(powers.filter(p => p > 0.25 && p < 1 - spread - 0.01).length / n).toBeGreaterThan(0.03);
  });
  it('keeps a missed throw as it is, and a throw in the zone can only get better for the thrower', () => {
    const worth = (d: number[]) => d[0] + d[1];
    setSeed(3); const plain = Array.from({ length: 50 }, () => rollDice(2, 0.5));
    setSeed(3); const missed = Array.from({ length: 50 }, () => throwWithZone(2, 0.5, false, worth));
    expect(missed).toEqual(plain);                      // a miss: the same dice as before
    setSeed(5); let sumHit = 0, sumMiss = 0;
    for (let k = 0; k < 20000; k++) { sumHit += worth(throwWithZone(2, 0.5, true, worth)); sumMiss += worth(rollDice(2, 0.5)); }
    expect(sumHit / 20000).toBeGreaterThan(sumMiss / 20000 + 0.5); // half the time the better of two: about +0.9
  });
  it("takes a friend's held time only near the host's own clock of the shake", () => {
    const sweep = config.dice_meter_sweep.value, slack = config.net_hold_slack.value;
    expect(friendPower(0.5 * sweep, 0.5 * sweep)).toBeCloseTo(0.5, 6);                                // honest: the bar where they let go
    expect(friendPower(0.5 * sweep + slack / 2, 0.5 * sweep)).toBeCloseTo(meterPos(0.5 * sweep + slack / 2), 6); // the trip's lag: taken as sent
    expect(friendPower(0.95 * sweep, 0.2 * sweep)).toBeCloseTo(meterPos(0.2 * sweep + slack), 6);    // a changed screen asking for a later bar: pulled back
    expect(friendPower(0, 0.9 * sweep)).toBeCloseTo(meterPos(0.9 * sweep - slack), 6);              // or an earlier one
    expect(friendPower('1', 0.5)).toBeUndefined();
    expect(friendPower(NaN, 0.5)).toBeUndefined();
  });
  it("lets a computer go where it aimed at any game speed, a person where the bar stands", () => {
    // Regression (full review 19/11/2026): at ×4 a step is 4/60 s; the let-go read the bar one step past the aim,
    // so some aimed zone hits fell outside it and some aimed misses inside.
    setSeed(9);
    for (const dt of [1 / 60, 2 / 60, 4 / 60]) {
      for (let k = 0; k < 400; k++) {
        const zone = makeZone(), holdFor = aiHold(2, zone, 0.5);
        let t = 0; while (t < holdFor) t += dt;                       // the game's step: it lets go on the first step at or past holdFor
        const aimed = meterPos(holdFor), got = letGoPower({ t, ai: true, holdFor });
        expect(got).toBeCloseTo(aimed, 9);
        expect(inZone(got, zone)).toBe(inZone(aimed, zone));
      }
    }
    expect(letGoPower({ t: 0.7, ai: false, holdFor: 0 })).toBeCloseTo(meterPos(0.7), 9); // a person: the bar now
    expect(letGoPower({ t: 0.7, ai: false, holdFor: 0, power: 0.3 })).toBe(0.3);         // a friend: as the host worked it out
  });
});
