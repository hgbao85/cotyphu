import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  BOARD,
  calcRent,
  canBuild,
  canSellHouse,
  GROUP_COLORS,
  GROUP_NAMES,
  JAIL_FINE,
  netWorth,
  type GameAction,
} from '@cotyphu/shared';
import { emit, sendAction, type ServerState } from '../socket';
import Board, { tileIcon } from './Board';

const DIE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

function useNow(ms = 250) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

interface Props {
  state: ServerState;
  me: string;
  clockOffset: number;
  onLeave: () => void;
}

export default function Game({ state, me, clockOffset, onLeave }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState('');

  const act = async (a: GameAction) => {
    setError('');
    const r = await sendAction(a);
    if (!r.ok) setError(r.error ?? 'Có lỗi xảy ra');
  };

  return (
    <div className="game">
      <Board state={state} onSelect={setSelected}>
        <CenterPanel state={state} me={me} clockOffset={clockOffset} act={act} error={error} />
      </Board>
      <aside className="sidebar">
        <PlayerList state={state} me={me} />
        <LogChat state={state} />
        <button className="btn ghost small" onClick={() => confirm('Rời ván? Bot sẽ chơi thay bạn.') && onLeave()}>
          Rời ván
        </button>
      </aside>
      {selected !== null && (
        <TileInfo state={state} me={me} tileId={selected} act={act} onClose={() => setSelected(null)} />
      )}
      {state.status === 'ended' && <EndModal state={state} me={me} onLeave={onLeave} />}
    </div>
  );
}

function CenterPanel({
  state,
  me,
  clockOffset,
  act,
  error,
}: {
  state: ServerState;
  me: string;
  clockOffset: number;
  act: (a: GameAction) => void;
  error: string;
}) {
  const now = useNow();
  const cur = state.players[state.currentIdx];
  const mine = state.players.find((p) => p.id === me);
  const myTurn = cur.id === me && state.status === 'playing';
  const remaining = state.turnDeadline ? Math.max(0, Math.ceil((state.turnDeadline - (now + clockOffset)) / 1000)) : null;
  const tile = BOARD[cur.position];
  const lastRoll = state.log.filter((l) => l.text.includes(' gieo ')).at(-1)?.id ?? 0;

  return (
    <div className="center-inner">
      <div className="center-title">Cờ Tỷ Phú</div>
      <div className="round">
        Vòng {Math.min(state.round, state.maxRounds)}/{state.maxRounds}
      </div>

      <div className="dice" key={lastRoll}>
        {state.dice ? (
          <>
            <span className="die">{DIE[state.dice[0]]}</span>
            <span className="die">{DIE[state.dice[1]]}</span>
          </>
        ) : (
          <span className="die faded">⚄</span>
        )}
      </div>

      <div className="turn">
        <span className="token" style={{ background: cur.color }}>
          {cur.name[0]}
        </span>
        {myTurn ? <strong>Lượt của bạn</strong> : <span>Lượt của {cur.name}</span>}
        {remaining !== null && <span className={`timer ${remaining <= 5 ? 'warn' : ''}`}>{remaining}s</span>}
      </div>

      {state.lastCard && (
        <div className={`card-pop ${state.lastCard.deck}`}>
          <b>{state.lastCard.deck === 'chance' ? '❓ Cơ hội' : '🍀 Khí vận'}</b>
          <span>{state.lastCard.text}</span>
        </div>
      )}

      {myTurn && mine && (
        <div className="actions">
          {state.phase === 'roll' && (
            <>
              <button className="btn primary big roll" onClick={() => act({ type: 'ROLL' })}>
                🎲 Gieo xúc xắc
              </button>
              {mine.inJail && (
                <div className="row">
                  <button className="btn small" disabled={mine.money < JAIL_FINE} onClick={() => act({ type: 'PAY_JAIL' })}>
                    Nộp {JAIL_FINE} ra tù
                  </button>
                  {mine.jailCards > 0 && (
                    <button className="btn small" onClick={() => act({ type: 'USE_JAIL_CARD' })}>
                      Dùng thẻ ra tù
                    </button>
                  )}
                </div>
              )}
            </>
          )}
          {state.phase === 'buy' && (
            <>
              <div className="buy-label">
                {tileIcon(tile)} <b>{tile.name}</b> chưa có chủ
              </div>
              <div className="row">
                <button
                  className="btn primary grow"
                  disabled={mine.money < (tile.price ?? 0)}
                  onClick={() => act({ type: 'BUY' })}
                >
                  Mua {tile.price}
                </button>
                <button className="btn grow" onClick={() => act({ type: 'SKIP_BUY' })}>
                  Bỏ qua
                </button>
              </div>
            </>
          )}
          {state.phase === 'end-turn' && (
            <button className="btn primary big" onClick={() => act({ type: 'END_TURN' })}>
              Kết thúc lượt
            </button>
          )}
          <p className="hint">Bấm vào ô đất của bạn để xây nhà.</p>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function PlayerList({ state, me }: { state: ServerState; me: string }) {
  const cur = state.players[state.currentIdx];
  return (
    <ul className="players">
      {state.players.map((p) => {
        const owned = Object.entries(state.owners).filter(([, o]) => o.ownerId === p.id);
        return (
          <li key={p.id} className={`${p.id === cur.id ? 'current' : ''} ${p.bankrupt ? 'out' : ''}`} style={{ ['--pc' as string]: p.color }}>
            <div className="p-head">
              <span className="token" style={{ background: p.color }}>
                {p.name[0]}
              </span>
              <span className="p-name">
                {p.name}
                {p.id === me && <span className="tag">bạn</span>}
                {p.isBot && <span className="tag">bot</span>}
                {!p.isBot && !p.connected && <span className="tag">mất kết nối</span>}
              </span>
              <span className="money">{p.bankrupt ? 'Phá sản' : `💵 ${p.money}`}</span>
            </div>
            {!p.bankrupt && (
              <div className="p-sub">
                <span>Tài sản {netWorth(state, p.id)}</span>
                {p.inJail && <span>🔒 Đang ở tù</span>}
                {p.jailCards > 0 && <span>🎫 ×{p.jailCards}</span>}
              </div>
            )}
            {owned.length > 0 && (
              <div className="chips">
                {owned.map(([id]) => {
                  const t = BOARD[Number(id)];
                  return (
                    <span
                      key={id}
                      className="chip"
                      title={t.name}
                      style={{ background: t.group ? GROUP_COLORS[t.group] : '#777' }}
                    />
                  );
                })}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function LogChat({ state }: { state: ServerState }) {
  const [tab, setTab] = useState<'log' | 'chat'>('log');
  const [text, setText] = useState('');
  const [seenChat, setSeenChat] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const lastChat = state.chat.at(-1)?.id ?? 0;

  useEffect(() => {
    if (tab === 'chat') setSeenChat(lastChat);
  }, [tab, lastChat]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [tab, state.log.length, state.chat.length]);

  const send = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    emit('chat', { text });
    setText('');
  };

  return (
    <div className="logchat">
      <div className="tabs">
        <button className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>
          Diễn biến
        </button>
        <button className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>
          Chat {lastChat > seenChat && tab !== 'chat' && <span className="dot" />}
        </button>
      </div>
      <div className="list" ref={listRef}>
        {tab === 'log'
          ? state.log.map((l) => <p key={l.id}>{l.text}</p>)
          : state.chat.map((c) => (
              <p key={c.id}>
                <b style={{ color: state.players.find((p) => p.id === c.playerId)?.color }}>{c.name}:</b> {c.text}
              </p>
            ))}
        {tab === 'chat' && state.chat.length === 0 && <p className="muted">Chưa có tin nhắn.</p>}
      </div>
      {tab === 'chat' && (
        <form className="chat-form" onSubmit={send}>
          <input value={text} maxLength={200} onChange={(e) => setText(e.target.value)} placeholder="Nhắn gì đó…" />
          <button className="btn small" type="submit">
            Gửi
          </button>
        </form>
      )}
    </div>
  );
}

function TileInfo({
  state,
  me,
  tileId,
  act,
  onClose,
}: {
  state: ServerState;
  me: string;
  tileId: number;
  act: (a: GameAction) => void;
  onClose: () => void;
}) {
  const t = BOARD[tileId];
  const own = state.owners[tileId];
  const owner = own ? state.players.find((p) => p.id === own.ownerId) : undefined;
  const myTurn = state.players[state.currentIdx]?.id === me && state.status === 'playing' && state.phase !== 'buy';
  const isMine = own?.ownerId === me;
  const buildErr = canBuild(state, me, tileId);
  const sellErr = canSellHouse(state, me, tileId);
  const labels = ['Không nhà', '1 nhà', '2 nhà', '3 nhà', '4 nhà', 'Khách sạn'];

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head" style={{ background: t.group ? GROUP_COLORS[t.group] : 'var(--surface-2)' }}>
          <span>
            {tileIcon(t)} {t.name}
          </span>
          {t.group && <small>{GROUP_NAMES[t.group]}</small>}
        </div>
        <div className="modal-body">
          {t.type === 'property' && (
            <table className="rent">
              <tbody>
                {t.rent!.map((r, i) => (
                  <tr key={i} className={own && own.houses === i ? 'on' : ''}>
                    <td>{labels[i]}</td>
                    <td>{i === 0 ? `${r} (×2 khi đủ nhóm)` : r}</td>
                  </tr>
                ))}
                <tr>
                  <td>Giá xây mỗi nhà</td>
                  <td>{t.houseCost}</td>
                </tr>
              </tbody>
            </table>
          )}
          {t.type === 'airport' && <p>Tiền thuê: 25 / 50 / 100 / 200 theo số sân bay cùng chủ.</p>}
          {t.type === 'utility' && <p>Tiền thuê: tổng xúc xắc × 4, có cả Điện và Nước thì × 10.</p>}
          {t.type === 'chance' && <p>Rút một thẻ Cơ hội: có thể được tiền, đi tới ô khác hoặc vào tù.</p>}
          {t.type === 'community' && <p>Rút một thẻ Khí vận: phần lớn là tiền thưởng hoặc tiền phạt nhỏ.</p>}
          {t.type === 'tax' && <p>Nộp {t.tax} cho ngân hàng.</p>}
          {t.type === 'start' && <p>Mỗi lần đi qua nhận 200.</p>}
          {t.type === 'jail' && <p>Chỉ thăm tù thì không sao. Đang ở tù: gieo ra đôi, nộp {JAIL_FINE}, hoặc dùng thẻ để ra.</p>}
          {t.type === 'gotojail' && <p>Dừng ở đây là vào tù ngay.</p>}
          {t.type === 'parking' && <p>Ô nghỉ chân, không mất gì.</p>}
          {t.price !== undefined && (
            <p>
              Giá mua: <b>{t.price}</b> ·{' '}
              {owner ? (
                <>
                  Chủ: <b style={{ color: owner.color }}>{owner.name}</b>
                  {own && own.houses === 0 && t.type === 'property' && <> · Thuê hiện tại: {calcRent(state, tileId, 7)}</>}
                </>
              ) : (
                'Chưa có chủ'
              )}
            </p>
          )}
          {isMine && t.type === 'property' && (
            <div className="row">
              <button
                className="btn primary grow"
                disabled={!myTurn || !!buildErr}
                title={buildErr ?? ''}
                onClick={() => act({ type: 'BUILD', tileId })}
              >
                Xây ({t.houseCost})
              </button>
              <button
                className="btn grow"
                disabled={!myTurn || !!sellErr}
                title={sellErr ?? ''}
                onClick={() => act({ type: 'SELL_HOUSE', tileId })}
              >
                Bán nhà (+{Math.floor(t.houseCost! / 2)})
              </button>
            </div>
          )}
          {isMine && t.type === 'property' && (
            <p className="hint">{!myTurn ? 'Chỉ xây/bán được trong lượt của bạn.' : buildErr ? `Chưa xây được: ${buildErr}.` : ''}</p>
          )}
        </div>
        <button className="btn ghost small" onClick={onClose}>
          Đóng
        </button>
      </div>
    </div>
  );
}

function EndModal({ state, me, onLeave }: { state: ServerState; me: string; onLeave: () => void }) {
  const ranked = [...state.players].sort((a, b) => {
    if (a.id === state.winnerId) return -1;
    if (b.id === state.winnerId) return 1;
    return netWorth(state, b.id) - netWorth(state, a.id);
  });
  const winner = state.players.find((p) => p.id === state.winnerId);
  return (
    <div className="modal-bg">
      <div className="modal end">
        <div className="trophy">🏆</div>
        <h2>{winner ? (winner.id === me ? 'Bạn thắng rồi!' : `${winner.name} thắng!`) : 'Ván kết thúc'}</h2>
        <ol className="ranking">
          {ranked.map((p) => (
            <li key={p.id}>
              <span className="token" style={{ background: p.color }}>
                {p.name[0]}
              </span>
              <span className="grow">{p.name}</span>
              <span>{p.bankrupt ? 'Phá sản' : netWorth(state, p.id)}</span>
            </li>
          ))}
        </ol>
        <button className="btn primary big" onClick={onLeave}>
          Về trang chủ
        </button>
      </div>
    </div>
  );
}
