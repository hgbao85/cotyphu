import { useState } from 'react';
import { MAX_PLAYERS } from '@cotyphu/shared';
import { emit, type ServerState } from '../socket';

export default function Lobby({ state, me, onLeave }: { state: ServerState; me: string; onLeave: () => void }) {
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const isHost = state.hostId === me;
  const link = `${location.origin}/?room=${state.code}`;

  const call = async (event: string, data?: unknown) => {
    setError('');
    const r = await emit(event, data);
    if (!r.ok) setError(r.error ?? 'Có lỗi xảy ra');
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* bỏ qua */
    }
  };

  return (
    <main className="home">
      <div className="home-card lobby">
        <p className="muted">Mã phòng</p>
        <div className="room-code">{state.code}</div>
        <button className="btn ghost small" onClick={copy}>
          {copied ? 'Đã sao chép!' : 'Sao chép link mời bạn bè'}
        </button>

        <h2>
          Người chơi ({state.players.length}/{MAX_PLAYERS})
        </h2>
        <ul className="lobby-players">
          {state.players.map((p) => (
            <li key={p.id} className={p.connected ? '' : 'dim'}>
              <span className="token" style={{ background: p.color }}>
                {p.name[0]}
              </span>
              <span className="grow">
                {p.name}
                {p.id === me && <span className="tag">bạn</span>}
                {p.id === state.hostId && <span className="tag gold">chủ phòng</span>}
                {p.isBot && <span className="tag">bot</span>}
                {!p.connected && <span className="tag">mất kết nối</span>}
              </span>
              {isHost && p.id !== me && (
                <button className="btn ghost small" onClick={() => call('kick', { playerId: p.id })}>
                  Mời ra
                </button>
              )}
            </li>
          ))}
          {Array.from({ length: MAX_PLAYERS - state.players.length }).map((_, i) => (
            <li key={`empty-${i}`} className="empty">
              Đang chờ người chơi…
            </li>
          ))}
        </ul>

        {isHost ? (
          <div className="row">
            <button
              className="btn"
              disabled={state.players.length >= MAX_PLAYERS}
              onClick={() => call('addBot')}
            >
              + Thêm bot
            </button>
            <button className="btn primary grow" disabled={state.players.length < 2} onClick={() => call('start')}>
              Bắt đầu ván
            </button>
          </div>
        ) : (
          <p className="muted">Đang chờ chủ phòng bắt đầu…</p>
        )}
        {error && <p className="error">{error}</p>}
        <button className="btn ghost small" onClick={onLeave}>
          Rời phòng
        </button>
      </div>
    </main>
  );
}
