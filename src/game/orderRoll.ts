// Choosing who goes first, for Cá Ngựa and Rắn và Thang as Cờ Tỷ Phú does it (src/game/turn.ts startOrder):
// with order_roll on (data/config.json), a game opens with every player throwing once, in seat order; the
// highest total goes first, then downwards. Players who tie throw again among themselves only (settleOrder).
// The game's own throw (shake, tumble, land) is used: this file only keeps the throws and settles the order.
import { settleOrder } from './rules';

/** The throws for the order so far: this round's (null: not yet) and each player's earlier ones (re-throws). */
export interface OrderState { throws: (number | null)[]; past: number[][] }
/** What it reads in a game: its players (their id is their place in the list), whose throw it is, the order. */
export interface OrderGame { players: { id: number; name: string }[]; cur: number; order?: OrderState }

/** Opens the throws for the order: the first seat throws first. */
export function startOrder(g: OrderGame, log: (s: string) => void): void {
  g.order = { throws: g.players.map(() => null), past: g.players.map(() => []) };
  g.cur = 0;
  log('Tung xúc xắc chọn lượt: cao nhất đi trước, thấp nhất đi cuối.');
}
/** The current player's throw for the order landed: its total. */
export function recordOrder(g: OrderGame, total: number, log: (s: string) => void): void {
  if (!g.order) return;
  g.order.throws[g.cur] = total;
  log(`${g.players[g.cur].name} tung được ${total}.`);
}
/**
 * After a throw for the order: the next player to throw (false), or, everyone thrown and nobody tied, the
 * players put in order, highest first, and the first to play is current (true). Ties throw again.
 */
export function nextOrder(g: OrderGame, log: (s: string) => void): boolean {
  const o = g.order; if (!o) return true;
  const next = o.throws.findIndex(v => v === null);
  if (next >= 0) { g.cur = next; return false; }
  const r = settleOrder(o.past, o.throws as number[]);
  if ('tied' in r) {
    log(`Hòa điểm: ${r.tied.map(i => g.players[i].name).join(', ')} tung lại.`);
    o.past = r.past;
    for (const i of r.tied) o.throws[i] = null;
    g.cur = r.tied[0];
    return false;
  }
  g.players = r.order.map(i => g.players[i]);
  g.players.forEach((p, k) => { p.id = k; }); // a player's id is its place in the list (the rules compare them)
  g.order = undefined; g.cur = 0;
  log(`Thứ tự đi: ${g.players.map(p => p.name).join(' → ')}.`);
  return true;
}
