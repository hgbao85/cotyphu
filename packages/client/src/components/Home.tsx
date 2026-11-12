import { useState, type FormEvent } from 'react';
import { emit, type Session } from '../socket';

const NAME_KEY = 'cotyphu.name';

function readName() {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export default function Home({ onEnter, waiting }: { onEnter: (s: Session) => void; waiting: boolean }) {
  const [name, setName] = useState(readName);
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const go = async (kind: 'create' | 'join', e?: FormEvent) => {
    e?.preventDefault();
    setError('');
    if (!name.trim()) return setError('Hãy nhập tên của bạn');
    if (kind === 'join' && !code.trim()) return setError('Hãy nhập mã phòng');
    try {
      localStorage.setItem(NAME_KEY, name.trim());
    } catch {
      /* bỏ qua */
    }
    setBusy(true);
    const r = await emit(kind, { name, code });
    setBusy(false);
    if (!r.ok) return setError(r.error ?? 'Có lỗi xảy ra');
    history.replaceState(null, '', `?room=${r.code}`);
    onEnter({ code: r.code!, token: r.token!, playerId: r.playerId! });
  };

  if (waiting) {
    return (
      <main className="home">
        <p className="muted">Đang vào lại phòng…</p>
      </main>
    );
  }

  return (
    <main className="home">
      <div className="home-card">
        <div className="logo">
          <span className="logo-dice">🎲</span>
          <h1>Cờ Tỷ Phú</h1>
          <p className="muted">Mua đất, xây nhà, thu tiền thuê khắp ba miền</p>
        </div>

        <label className="field">
          <span>Tên của bạn</span>
          <input value={name} maxLength={16} onChange={(e) => setName(e.target.value)} placeholder="VD: Minh Anh" />
        </label>

        <button className="btn primary big" disabled={busy} onClick={() => go('create')}>
          Tạo phòng mới
        </button>

        <div className="divider">
          <span>hoặc vào phòng có sẵn</span>
        </div>

        <form className="join-row" onSubmit={(e) => go('join', e)}>
          <input
            value={code}
            maxLength={5}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="MÃ PHÒNG"
            className="code-input"
          />
          <button className="btn" disabled={busy} type="submit">
            Vào phòng
          </button>
        </form>

        {error && <p className="error">{error}</p>}
      </div>
    </main>
  );
}
