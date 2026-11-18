// The settings panel: the sound's volume and whether the moving touches play. It opens in the same
// reading panel as the rules (pages.ts). What a player picks is kept in this browser (src/core/prefs.ts).
import { prefs, savePrefs } from '../core/prefs';
import { isMuted, setMuted, sfx, volume } from '../audio';
import { openPage } from './pages';

/** Opens the settings panel. */
export function openSettings() {
  const vol = Math.round((isMuted() ? 0 : volume()) * 100);
  const two = (id: string, a: [string, string], on: number) =>
    `<div class="st-two" id="${id}">${a.map((l, k) => `<button data-k="${k}" class="${k === on ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const body = openPage('Cài đặt', `
    <div class="st-row"><div class="st-label">Âm lượng <b id="st-vol-v">${vol}%</b></div>
      <input type="range" id="st-vol" min="0" max="100" step="5" value="${vol}" aria-label="Âm lượng"></div>
    <div class="st-row"><div class="st-label">Hiệu ứng chuyển động</div>
      ${two('st-fx', ['Bật', 'Tắt'], prefs.effects ? 0 : 1)}
      <p class="st-note">Tắt: không còn xu bay, pháo giấy, quân nhảy và vịt bơi. Hợp với máy yếu.</p></div>`);
  const range = body.querySelector('#st-vol') as HTMLInputElement, shown = body.querySelector('#st-vol-v') as HTMLElement;
  range.oninput = () => {
    prefs.volume = Number(range.value) / 100; shown.textContent = `${range.value}%`;
    setMuted(prefs.volume === 0); savePrefs();
  };
  range.onchange = () => sfx.coin(); // a sample at the new volume
  const pick = (id: string, run: (k: number) => void) => body.querySelectorAll(`#${id} button`).forEach(b => {
    (b as HTMLButtonElement).onclick = () => {
      const k = Number((b as HTMLElement).dataset.k);
      body.querySelectorAll(`#${id} button`).forEach(x => x.classList.toggle('on', x === b)); run(k);
    };
  });
  pick('st-fx', k => { prefs.effects = k === 0; savePrefs(); });
}
