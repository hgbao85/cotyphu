// Board geometry in world units: the board is 12.2 wide, corners 1.6, tiles 1.0. No browser.

// ---- Board geometry (world units: the board is 12.2 wide, corners 1.6, tiles 1.0) ----------
export const L = 12.2, HALF = L / 2, CORNER = 1.6, BAND = 0.38, BOARD_TOP = 0.3;
/** A tile's place on the board. */
interface TileInfo { x: number; z: number; ox: number; oz: number; side: number }

/** Centre x,z; outward unit ox,oz; side 0 bottom, 1 left, 2 top, 3 right, -1 corner. */
export function tileInfo(i: number): TileInfo { // center x,z; outward unit ox,oz; side 0 bottom,1 left,2 top,3 right,-1 corner
  const c = HALF - CORNER / 2; // 5.3
  if (i === 0) return { x: c, z: c, ox: 0.7, oz: 0.7, side: -1 };
  if (i === 10) return { x: -c, z: c, ox: -0.7, oz: 0.7, side: -1 };
  if (i === 20) return { x: -c, z: -c, ox: -0.7, oz: -0.7, side: -1 };
  if (i === 30) return { x: c, z: -c, ox: 0.7, oz: -0.7, side: -1 };
  if (i < 10) return { x: 4.0 - (i - 1), z: c, ox: 0, oz: 1, side: 0 };
  if (i < 20) return { x: -c, z: 4.0 - (i - 11), ox: -1, oz: 0, side: 1 };
  if (i < 30) return { x: -4.0 + (i - 21), z: -c, ox: 0, oz: -1, side: 2 };
  return { x: c, z: -4.0 + (i - 31), ox: 1, oz: 0, side: 3 };
}
/** The tile under a board point, or -1. */
export function tileAt(x: number, z: number): number { // the tile under a board point, or -1
  const e = HALF - CORNER; // 4.5
  if (Math.abs(x) > HALF || Math.abs(z) > HALF) return -1;
  if (z > e) { if (x > e) return 0; if (x < -e) return 10; return 1 + Math.floor(e - x); }
  if (z < -e) { if (x < -e) return 20; if (x > e) return 30; return 21 + Math.floor(x + e); }
  if (x < -e) return 11 + Math.floor(e - z);
  if (x > e) return 31 + Math.floor(z + e);
  return -1;
}
const SLOT = [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]];
/** Where the pieces on a tile stand, as the player sees the board: side by side across the screen, in
 * the tile's lower part, feet near its bottom edge, so the bodies cover as little of the name as they can. [x, z] from the tile's centre, by how many
 * share it. A row's tile is narrow and deep; a column's wide and shallow. */
const SHARE_ROW = [[], [[0, 0.5]], [[-0.24, 0.5], [0.24, 0.5]], [[-0.24, 0.25], [0.24, 0.25], [0, 0.58]], [[-0.24, 0.18], [0.24, 0.18], [-0.24, 0.55], [0.24, 0.55]]];
const SHARE_COLUMN = [[], [[0, 0.3]], [[-0.32, 0.3], [0.32, 0.3]], [[-0.46, 0.3], [0, 0.3], [0.46, 0.3]], [[-0.32, 0.05], [0.32, 0.05], [-0.32, 0.38], [0.32, 0.38]]];
/** A corner, a 1.6 square: a roomy square of four. */
const SHARE_CORNER = [[], [[0, 0.35]], [[-0.35, 0.4], [0.35, 0.4]], [[-0.35, 0.12], [0.35, 0.12], [0, 0.55]], [[-0.35, 0.08], [0.35, 0.08], [-0.35, 0.56], [0.35, 0.56]]];
/** Spot i of the n pieces standing on a tile together, spread so they do not overlap on the screen. */
function sharedSpot(ti: ReturnType<typeof tileInfo>, pos: number, jailed: boolean, slot: { i: number; n: number }): { x: number; z: number } {
  const n = Math.max(1, Math.min(4, slot.n)), i = Math.min(slot.i, n - 1);
  if (ti.side < 0) {
    const [a, b] = SHARE_CORNER[n][i];
    if (pos === 10) { // the jail corner: inside the bars, or just visiting on the edge (a tighter group there)
      const base = jailed ? { x: ti.x + 0.25, z: ti.z - 0.25 } : { x: ti.x - 0.3, z: ti.z + 0.3 };
      return { x: base.x + a * 0.6, z: base.z + b * 0.6 };
    }
    return { x: ti.x + a, z: ti.z + b };
  }
  const [dx, dz] = (ti.side === 0 || ti.side === 2 ? SHARE_ROW : SHARE_COLUMN)[n][i];
  return { x: ti.x + dx, z: ti.z + dz }; // +z is down the screen; a piece's body rises up over the tile from its feet
}
/** Where seat pi's token stands on tile pos. */
export function tokenSpot(pi: number, pos: number, jailed: boolean, slot?: { i: number; n: number }): { x: number; z: number } { // where player pi's token stands on tile pos
  const ti = tileInfo(pos);
  if (slot) return sharedSpot(ti, pos, jailed, slot);
  let x = ti.x, z = ti.z;
  if (ti.side >= 0) { x += ti.ox * 0.18; z += ti.oz * 0.18; }
  if (pos === 10) { // the jail corner: inside the bars, or just visiting on the edge
    if (jailed) { x = ti.x + 0.25; z = ti.z - 0.25; } else { x = ti.x - 0.3; z = ti.z + 0.3; }
  }
  return { x: x + SLOT[pi][0], z: z + SLOT[pi][1] };
}
