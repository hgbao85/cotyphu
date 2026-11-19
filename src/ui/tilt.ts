// The tilted board of Cá Ngựa and Rắn và Thang: the flat board seen from a camera above its near side,
// as Cờ Tỷ Phú's 3D table is (src/three/scene3d.ts aimCamera: about 55° on a wide screen, steeper on a
// phone). The board is still drawn flat once (each game's own canvas); this file projects points of it to
// the screen and draws that canvas as the tilted plane, strip by strip (canvas 2D has no perspective).
// Each row of the board stays a level line on the screen, so a strip per row of pixels is exact.

/** A board point on the screen, and how big things are there next to the flat board (far: smaller). */
export interface Spot { x: number; y: number; k: number }

/** The camera's angle above the table: a wide screen as Cờ Tỷ Phú's (atan(19.7 / 13.75)), a phone steeper. */
const ANGLE_WIDE = Math.atan2(19.7, 13.75), ANGLE_PHONE = 1.24;
/** The camera's distance, in board widths (Cờ Tỷ Phú's table: about 24 units from a board of about 11). */
const DIST = 2.2;
/** The camera's angle above the table, for pictures seen from it (the 3D pieces, src/three/figureSprites.ts). */
export const tiltAngle = (phone: boolean): number => (phone ? ANGLE_PHONE : ANGLE_WIDE);

/** A tilted view of a square board drawn in rect (its flat square on the screen). */
export interface Tilt {
  /** u across (0 left, 1 right), v down the board (0 far, 1 near) → the screen. */
  project(u: number, v: number): Spot;
  /** The tilted board's top and bottom on the screen. */
  top: number; bottom: number;
  /** Draws the flat board canvas as the tilted plane (with a soft shadow under its near edge). */
  draw(c: CanvasRenderingContext2D, flat: HTMLCanvasElement): void;
}

const cache = new Map<string, { key: string; tilt: Tilt }>();
/** The tilt for a game's board square on the screen (made once per game and size: each keeps its own picture). */
export function tiltOf(game: string, rect: { x: number; y: number; s: number }, phone: boolean): Tilt {
  const key = `${rect.x},${rect.y},${rect.s},${phone}`, had = cache.get(game);
  if (had?.key === key) return had.tilt;
  const phi = phone ? ANGLE_PHONE : ANGLE_WIDE, sin = Math.sin(phi), cos = Math.cos(phi);
  // the camera's view of a board point (X, Z from the centre, Z toward the viewer): x / depth, Z sin / depth
  const raw = (u: number, v: number) => { const X = u - 0.5, Z = v - 0.5, d = DIST - Z * cos; return { x: X / d, y: (Z * sin) / d, d }; };
  const near = raw(0, 1), far = raw(0, 0);
  const S = rect.s / (2 * Math.abs(near.x)); // the near edge as wide as the flat board
  const h = (near.y - far.y) * S, top = rect.y + (rect.s - h) / 2, cx = rect.x + rect.s / 2;
  const project = (u: number, v: number): Spot => {
    const p = raw(u, v);
    return { x: cx + p.x * S, y: top + (p.y - far.y) * S, k: S / (p.d * rect.s) };
  };
  let img: HTMLCanvasElement | null = null, imgOf: HTMLCanvasElement | null = null;
  const tilt: Tilt = {
    project, top, bottom: top + h,
    draw(c, flat) {
      if (!img || imgOf !== flat) { // the tilted board, made once: one strip per row of the flat board's pixels
        const px = flat.width / rect.s; // the flat canvas's pixels per screen unit
        img = document.createElement('canvas'); img.width = Math.ceil(rect.s * px); img.height = Math.ceil(h * px);
        const g = img.getContext('2d')!; g.imageSmoothingQuality = 'high';
        const rows = flat.height;
        for (let i = 0; i < rows; i++) {
          const v0 = i / rows, v1 = (i + 1) / rows, a = project(0, (v0 + v1) / 2), b = project(1, (v0 + v1) / 2);
          const y0 = (project(0.5, v0).y - top) * px, y1 = (project(0.5, v1).y - top) * px;
          g.drawImage(flat, 0, i, flat.width, 1, (a.x - rect.x) * px, y0, (b.x - a.x) * px, y1 - y0 + 0.75);
        }
        imgOf = flat;
      }
      const nl = project(0, 1), nr = project(1, 1), fl = project(0, 0), fr = project(1, 0);
      c.save(); c.fillStyle = 'rgba(40,90,110,0.2)'; // the board's shadow on the water, a little under its near edge
      c.beginPath(); c.moveTo(fl.x + 6, fl.y + 10); c.lineTo(fr.x + 6, fr.y + 10); c.lineTo(nr.x + 6, nr.y + 14); c.lineTo(nl.x + 6, nl.y + 14); c.closePath(); c.fill();
      c.drawImage(img, rect.x, top, rect.s, h);
      c.restore();
    },
  };
  cache.set(game, { key, tilt });
  return tilt;
}
