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
  emote() { tone(880, 0.06, 'sine', 0.18); tone(1320, 0.08, 'sine', 0.14, 0.06); },
};

