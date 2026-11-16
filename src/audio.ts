// Sound: Web Audio tones, started on the first input, muted on M. Every effect is a short
// synthesised tone, so the game ships no sound files.
import { tune } from './config';
import { audioContext } from './hook';

let audio: { ac: AudioContext; out: GainNode } | null = null;
let muted = false;

/** True while the sound is off. */
export function isMuted(): boolean {
  return muted;
}

/** Makes the audio context on the first input (browsers allow sound only after one). */
export function startAudio(): void {
  if (!audio) {
    const ac = audioContext(); // a check may inject one
    const out = ac.createGain(); out.gain.value = muted ? 0 : tune.volume;
    out.connect(ac.destination); audio = { ac, out };
  }
  if (audio.ac.state === 'suspended') audio.ac.resume();
}

/** Turns the sound off or on. */
export function setMuted(m: boolean): void {
  muted = m;
  if (audio) audio.out.gain.value = m ? 0 : tune.volume;
}
addEventListener('tune', () => setMuted(muted)); // the tweak panel moved a value: the volume follows

/** One tone: freq Hz for dur seconds, starting delay seconds from now. */
export function tone(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.3, delay = 0): void {
  if (!audio || muted) return;
  const t = audio.ac.currentTime + delay, o = audio.ac.createOscillator(), g = audio.ac.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(audio.out); o.start(t); o.stop(t + dur);
}

/** The game's sound effects. */
export const sfx = {
  tick() { tone(880, 0.045, 'triangle', 0.25); tone(1320, 0.03, 'sine', 0.12); },          // quân cờ "tách"
  dice() { for (let i = 0; i < 6; i++) tone(180 + i * 37, 0.05, 'square', 0.08, i * 0.07); },
  coin() { tone(1250, 0.08, 'sine', 0.25); tone(1870, 0.18, 'sine', 0.2, 0.07); },          // "ting"
  buy() { [523, 659, 784].forEach((f, i) => tone(f, 0.12, 'triangle', 0.22, i * 0.07)); },
  build() { [392, 523, 659, 1047].forEach((f, i) => tone(f, 0.1, 'square', 0.12, i * 0.06)); },
  pay() { tone(330, 0.12, 'triangle', 0.25); tone(247, 0.2, 'triangle', 0.22, 0.1); },
  card() { tone(700, 0.05, 'sine', 0.2); tone(1050, 0.08, 'sine', 0.2, 0.05); },
  jail() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.16, 'sawtooth', 0.1, i * 0.12)); },
  broke() { [300, 250, 200, 140].forEach((f, i) => tone(f, 0.25, 'sawtooth', 0.12, i * 0.18)); },
  win() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.18, 'triangle', 0.25, i * 0.13)); },
  click() { tone(600, 0.03, 'square', 0.08); },
  rattle(t: number) { tone(240 + (Math.floor(t * 37) % 5) * 45, 0.035, 'square', 0.07); tone(520 + (Math.floor(t * 53) % 4) * 60, 0.025, 'triangle', 0.05, 0.03); },
  land() { tone(150, 0.08, 'triangle', 0.3); tone(110, 0.1, 'triangle', 0.25, 0.08); },
  double() { tone(150, 0.08, 'triangle', 0.3); [784, 988, 1175].forEach((f, i) => tone(f, 0.12, 'triangle', 0.2, 0.08 + i * 0.07)); },
  /** A short call for each zodiac animal, 0 Chuột ... 11 Heo: a squeak, a moo, a meow. */
  animal(a: number) {
    const calls: [number, number, OscillatorType, number][][] = [ // [freq, duration, wave, start]
      [[1900, 0.05, 'sine', 0], [2200, 0.05, 'sine', 0.08]],                                  // Chuột
      [[150, 0.3, 'sawtooth', 0], [120, 0.35, 'sawtooth', 0.22]],                             // Trâu
      [[95, 0.32, 'sawtooth', 0], [75, 0.3, 'square', 0.12]],                                 // Hổ
      [[660, 0.1, 'sine', 0], [880, 0.14, 'sine', 0.08], [620, 0.18, 'sine', 0.2]],           // Mèo
      [[220, 0.25, 'sawtooth', 0], [165, 0.3, 'square', 0.15], [260, 0.2, 'sawtooth', 0.35]], // Rồng
      [[2600, 0.25, 'square', 0], [2900, 0.2, 'square', 0.05]],                               // Rắn
      [[950, 0.08, 'triangle', 0], [1150, 0.08, 'triangle', 0.08], [850, 0.1, 'triangle', 0.16], [650, 0.15, 'triangle', 0.26]], // Ngựa
      [[520, 0.07, 'square', 0], [500, 0.07, 'square', 0.08], [520, 0.07, 'square', 0.16], [480, 0.12, 'square', 0.24]],          // Dê
      [[620, 0.07, 'sine', 0], [920, 0.07, 'sine', 0.1], [620, 0.07, 'sine', 0.2], [920, 0.09, 'sine', 0.3]],                     // Khỉ
      [[620, 0.08, 'square', 0], [820, 0.08, 'square', 0.1], [920, 0.18, 'square', 0.2], [720, 0.12, 'square', 0.4]],            // Gà
      [[260, 0.08, 'square', 0], [190, 0.1, 'square', 0.05], [260, 0.08, 'square', 0.22], [190, 0.1, 'square', 0.27]],           // Chó
      [[300, 0.09, 'sawtooth', 0], [230, 0.12, 'sawtooth', 0.07], [300, 0.09, 'sawtooth', 0.24], [230, 0.12, 'sawtooth', 0.31]], // Heo
    ];
    const vol = (w: OscillatorType) => (w === 'sine' ? 0.22 : w === 'triangle' ? 0.2 : 0.07);
    for (const [f, d, w, at] of calls[a] || []) tone(f, d, w, vol(w), at);
  },
  emote() { tone(880, 0.06, 'sine', 0.18); tone(1320, 0.08, 'sine', 0.14, 0.06); },
};

