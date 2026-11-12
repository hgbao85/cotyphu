import type { ReactNode } from 'react';
import { BOARD, GROUP_COLORS, type GameState, type Tile } from '@cotyphu/shared';

const ICONS: Partial<Record<Tile['type'], string>> = {
  start: '🚩',
  jail: '🔒',
  parking: '🌳',
  gotojail: '👮',
  chance: '❓',
  community: '🍀',
  tax: '💰',
  airport: '✈️',
};

export function tileIcon(t: Tile): string {
  if (t.type === 'utility') return t.id === 12 ? '💡' : '💧';
  return ICONS[t.type] ?? '';
}

export function shortName(t: Tile): string {
  return t.name.replace('Sân bay ', '').replace('Công ty ', '');
}

/** Ô 0 ở góc dưới phải, đi ngược chiều kim đồng hồ. Trả về dòng/cột (1–11). */
function gridPos(i: number): { row: number; col: number; side: 'bottom' | 'left' | 'top' | 'right' } {
  if (i <= 10) return { row: 11, col: 11 - i, side: 'bottom' };
  if (i < 20) return { row: 11 - (i - 10), col: 1, side: 'left' };
  if (i <= 30) return { row: 1, col: 1 + (i - 20), side: 'top' };
  return { row: 1 + (i - 30), col: 11, side: 'right' };
}

export default function Board({
  state,
  onSelect,
  children,
}: {
  state: GameState;
  onSelect: (id: number) => void;
  children: ReactNode;
}) {
  const current = state.players[state.currentIdx];
  return (
    <div className="board-wrap">
      <div className="board">
        {BOARD.map((t) => {
          const { row, col, side } = gridPos(t.id);
          const own = state.owners[t.id];
          const owner = own ? state.players.find((p) => p.id === own.ownerId) : undefined;
          const here = state.players.filter((p) => !p.bankrupt && p.position === t.id);
          const corner = t.id % 10 === 0;
          return (
            <button
              key={t.id}
              className={`tile side-${side} ${corner ? 'corner' : ''} ${current && current.position === t.id && state.status === 'playing' ? 'active' : ''}`}
              style={{ gridRow: row, gridColumn: col, ...(owner ? { ['--owner' as string]: owner.color } : {}) }}
              onClick={() => onSelect(t.id)}
              title={t.name}
            >
              {t.group && <span className="strip" style={{ background: GROUP_COLORS[t.group] }} />}
              <span className="tile-body">
                {tileIcon(t) && <span className="tile-icon">{tileIcon(t)}</span>}
                <span className="tile-name">{shortName(t)}</span>
                {t.price !== undefined && !owner && <span className="tile-price">{t.price}</span>}
                {t.tax !== undefined && <span className="tile-price">-{t.tax}</span>}
                {owner && (
                  <span className="owner-badge" style={{ background: owner.color }}>
                    {own!.houses === 5 ? '🏨' : own!.houses > 0 ? '🏠'.repeat(own!.houses) : owner.name[0]}
                  </span>
                )}
              </span>
              {here.length > 0 && (
                <span className="tokens">
                  {here.map((p) => (
                    <span
                      key={p.id}
                      className={`token ${p.id === current?.id ? 'bounce' : ''}`}
                      style={{ background: p.color }}
                      title={p.name}
                    >
                      {p.name[0]}
                    </span>
                  ))}
                </span>
              )}
            </button>
          );
        })}
        <div className="center">{children}</div>
      </div>
    </div>
  );
}
