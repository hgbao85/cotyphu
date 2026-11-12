import { BOARD } from './board';
import { canBuild, currentPlayer, getPlayer, JAIL_FINE } from './engine';
import type { GameAction, GameState } from './types';

/** Bot đơn giản: mua khi còn dư tiền, xây nhà khi đủ nhóm, ra tù sớm khi giàu. */
export function botDecide(state: GameState, playerId: string): GameAction | null {
  const p = getPlayer(state, playerId);
  if (!p || state.status !== 'playing' || currentPlayer(state).id !== playerId) return null;

  if (state.phase === 'buy') {
    const tile = BOARD[p.position];
    return tile.price !== undefined && p.money - tile.price >= 150 ? { type: 'BUY' } : { type: 'SKIP_BUY' };
  }

  const build = BOARD.find(
    (t) => t.type === 'property' && canBuild(state, playerId, t.id) === null && p.money - t.houseCost! >= 300,
  );
  if (build) return { type: 'BUILD', tileId: build.id };

  if (state.phase === 'roll') {
    if (p.inJail && p.jailCards > 0) return { type: 'USE_JAIL_CARD' };
    if (p.inJail && p.money >= 500 + JAIL_FINE) return { type: 'PAY_JAIL' };
    return { type: 'ROLL' };
  }
  return { type: 'END_TURN' };
}
