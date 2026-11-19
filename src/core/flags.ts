// Small flags the screens share and several files change: which menu or card is open, the scroll of a
// list, the note on the setup screen... One object, so any file can change a field (F.inspect = 3).
import type { Loose } from '../game/types';
import type { PickItem } from '../ui/setupScreen';

export const F = {
  emoteMenu: false,
  sheetOpen: false, // phone: the property list, opened from its button
  drawingInspect: false, // the tile whose card is open from a click, and the tile under the mouse
  wheel: 0,
  picker: null as { x: number; y: number; w: number; cols: number; itemH: number; items: PickItem[]; current: number | string; onPick: (v: number | string) => void; rects: { x: number; y: number; w: number; h: number }[] } | null, // the setup screen's open dropdown
  inspect: -1, // the tile whose card is open from a click (-1: none)
  ui: [] as Loose[], // buttons this frame: { x, y, w, h, label, fn, role: 'primary'|'secondary'|'', enabled, color }
  roomMenu: false, // the room menu: leave (a friend) or close the room (the host), asked twice
  propScroll: 0,
  netError: '',
  guestShaking: false, // guest: holding the shake button, waiting to let go
  guestShakeAt: 0, // guest: when it began (seconds), for the power bar on this screen
  drawingMenu: false,
};
