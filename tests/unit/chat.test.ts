// Vitest: what a typed chat line becomes before the room sees it (src/game/chat.ts).
import { describe, expect, it } from 'vitest';
import config from '../../data/config.json';
import { cleanChat, since } from '../../src/game/chat';

const MAX = config.chat_max_len.value;

describe('cleanChat', () => {
  it('keeps what was typed, every word of it: there is no word filter', () => {
    for (const line of ['Đất này lớn quá', 'các bạn ơi', 'Đéo chơi nữa', 'vcl thật', 'Hà Nội đẹp']) expect(cleanChat(line, MAX)).toBe(line);
  });

  it('trims and folds spaces, and keeps long repeats as typed', () => {
    expect(cleanChat('  hay   quá  ', MAX)).toBe('hay quá');
    expect(cleanChat('hayyyyyyyy', MAX)).toBe('hayyyyyyyy'); // asked for: "aaaaaa" stays as typed
    expect(cleanChat('hahahahahaha!!!!!!', MAX)).toBe('hahahahahaha!!!!!!');
  });

  it('caps the length at chat_max_len characters, accents counted as one', () => {
    expect(MAX).toBe(100); // asked for: 100 characters
    expect([...cleanChat('ạ'.repeat(3) + 'b '.repeat(200), MAX)].length).toBeLessThanOrEqual(MAX);
  });

  it('drops control and invisible characters, and gives nothing for a blank line', () => {
    expect(cleanChat('xin' + String.fromCharCode(0) + 'chào' + String.fromCharCode(0x200b), MAX)).toBe('xin chào');
    expect(cleanChat('   ', MAX)).toBe('');
    expect(cleanChat(undefined, MAX)).toBe('');
  });
});

describe('since', () => {
  it("counts the seconds since the last line on this game's clock", () => {
    expect(since(10, 12.5)).toBe(2.5);
    expect(since(undefined, 3)).toBe(Infinity);
  });
  it('ignores a time from the game before, whose clock was further on', () => {
    expect(since(1200, 4)).toBe(Infinity); // a new game at 4 s: a line sent at 20 min last game does not hold this one back
  });
});
