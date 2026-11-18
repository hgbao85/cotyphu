// The chat box: plain HTML over the canvas, so a phone brings up its own keyboard. What to do with a
// line is the game's (setChatSender): this file only takes the typing.
import { tune } from '../config';

let onSend: (line: string) => void = () => {};
/** Tells the box what sends a line. */
export function setChatSender(fn: (line: string) => void) { onSend = fn; }
// The chat box: plain HTML over the canvas, so a phone brings up its own keyboard.
let chatPanel: HTMLDivElement | null = null;
export function showChat(on: boolean) {
  if (!chatPanel) {
    const d = document.createElement('div');
    d.id = 'chat';
    d.innerHTML = '<div class="ch-card"><input id="ch-text" autocomplete="off" placeholder="Nhắn cho cả phòng..."><button id="ch-send">Gửi</button><button id="ch-close">Đóng</button><div id="ch-count"></div></div>';
    document.body.appendChild(d);
    const input = d.querySelector('#ch-text') as HTMLInputElement, count = d.querySelector('#ch-count') as HTMLElement;
    const send = () => { if (input.value.trim()) onSend(input.value); input.value = ''; showChat(false); };
    input.maxLength = tune.chat_max_len;
    input.addEventListener('input', () => { count.textContent = `${[...input.value].length}/${tune.chat_max_len}`; });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); if (e.key === 'Escape') showChat(false); e.stopPropagation(); });
    (d.querySelector('#ch-send') as HTMLButtonElement).onclick = send;
    (d.querySelector('#ch-close') as HTMLButtonElement).onclick = () => showChat(false);
    d.addEventListener('pointerdown', e => { if (e.target === d) showChat(false); e.stopPropagation(); });
    chatPanel = d;
  }
  chatPanel.style.display = on ? 'flex' : 'none';
  if (on) { const input = chatPanel.querySelector('#ch-text') as HTMLInputElement; input.value = ''; (chatPanel.querySelector('#ch-count') as HTMLElement).textContent = `0/${tune.chat_max_len}`; input.focus(); }
}
export const chatOpen = (): boolean => !!chatPanel && chatPanel.style.display === 'flex';
addEventListener('keydown', e => { if (chatOpen()) e.stopImmediatePropagation(); }, true); // the game hears no keys while typing
