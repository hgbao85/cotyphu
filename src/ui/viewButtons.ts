// The view buttons every game puts beside its board: zoom in (+), zoom out (−), turn a quarter (↻), and
// back to the usual view (Gốc, only once the view has moved). Keys do the same: = and - zoom, [ and ]
// turn, Backspace goes back. Gestures are in ./viewGestures.ts; the view itself in src/three/orbitView.ts.
import type { OrbitView } from '../three/orbitView';
import { tune } from '../config';

type Btn = (x: number, y: number, w: number, h: number, label: string, fn: () => void, role: string, enabled?: boolean, color?: string) => void;
/** A button's rectangle, or null to leave that button out. */
export type Spot4 = { x: number; y: number; w: number; h: number } | null;

/** The labels, for checks and for the games' own layouts. */
export const VIEW_LABELS = { zoomIn: '+', zoomOut: '−', turn: '↻', home: 'Gốc' };

/**
 * Builds the view buttons at the given rectangles (zoom in, zoom out, turn, home) with the game's btn.
 * role: the buttons' look ('room': the small cream ones). Home shows only when the view has moved.
 */
export function buildViewButtons(btn: Btn, orbit: OrbitView, at: [Spot4, Spot4, Spot4, Spot4], role = 'room', color = ''): void {
  const [zi, zo, tr, hm] = at;
  if (zi) btn(zi.x, zi.y, zi.w, zi.h, VIEW_LABELS.zoomIn, () => orbit.zoomBy(tune.view_wheel_step * tune.view_wheel_step), role, orbit.zoomT < tune.view_zoom_max - 1e-3, color);
  if (zo) btn(zo.x, zo.y, zo.w, zo.h, VIEW_LABELS.zoomOut, () => orbit.zoomBy(1 / (tune.view_wheel_step * tune.view_wheel_step)), role, orbit.zoomT > 1 + 1e-3, color);
  if (tr) btn(tr.x, tr.y, tr.w, tr.h, VIEW_LABELS.turn, () => orbit.turn(1), role, true, color);
  if (hm && !orbit.isHome()) btn(hm.x, hm.y, hm.w, hm.h, VIEW_LABELS.home, () => orbit.home(), role, true, color);
}
/** The view keys: = / - zoom, [ / ] turn a quarter, Backspace back to the usual view. */
export function viewKeys(orbit: OrbitView, pressed: (code: string) => boolean): void {
  if (pressed('Equal') || pressed('NumpadAdd')) orbit.zoomBy(tune.view_wheel_step * tune.view_wheel_step);
  if (pressed('Minus') || pressed('NumpadSubtract')) orbit.zoomBy(1 / (tune.view_wheel_step * tune.view_wheel_step));
  if (pressed('BracketRight')) orbit.turn(1);
  if (pressed('BracketLeft')) orbit.turn(-1);
  if (pressed('Backspace')) orbit.home();
}
/** Four buttons in a row from (x, y): the small square ones, then "Gốc" a little wider. */
export function viewRow(x: number, y: number, h = 32, gap = 6): [Spot4, Spot4, Spot4, Spot4] {
  const s = h + 4;
  return [{ x, y, w: s, h }, { x: x + (s + gap), y, w: s, h }, { x: x + 2 * (s + gap), y, w: s, h }, { x: x + 3 * (s + gap), y, w: 56, h }];
}
