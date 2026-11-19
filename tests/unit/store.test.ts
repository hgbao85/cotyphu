// Vitest: the shared store (src/core/store.ts) and the flags it resets.
import { describe, expect, it } from 'vitest';
import { F } from '../../src/core/flags';
import { onSceneChange, scene, setScene } from '../../src/core/store';

describe('setScene', () => {
  it('closes an open "leave the room?" menu when the screen changes', () => {
    // Bug: a room closed under the open menu, and it opened over the next game (no turn buttons in Cờ Tỷ Phú).
    setScene('ludo'); F.roomMenu = true;
    setScene('ludoSetup');
    expect(F.roomMenu).toBe(false);
  });
  it('keeps the menu open when the same screen is set again', () => {
    setScene('play'); F.roomMenu = true;
    setScene('play');
    expect(F.roomMenu).toBe(true);
    expect(scene).toBe('play');
    F.roomMenu = false;
  });
});

describe('onSceneChange', () => {
  it('tells a watcher the new screen each time it changes, and not when it stays', () => {
    // Used by Cá Ngựa to forget a horse tapped in an earlier game when its screen opens again.
    const seen: string[] = [];
    setScene('hub');
    onSceneChange(s => seen.push(s));
    setScene('ludoSetup'); setScene('ludo'); setScene('ludo'); setScene('hub');
    expect(seen).toEqual(['ludoSetup', 'ludo', 'hub']);
  });
});
