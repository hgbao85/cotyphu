import { useCallback, useEffect, useState } from 'react';
import Game from './components/Game';
import Home from './components/Home';
import Lobby from './components/Lobby';
import { emit, loadSession, saveSession, socket, type ServerState, type Session } from './socket';

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [state, setState] = useState<ServerState | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [connected, setConnected] = useState(socket.connected);

  const reset = useCallback(() => {
    saveSession(null);
    setSession(null);
    setState(null);
  }, []);

  useEffect(() => {
    const rejoin = async () => {
      setConnected(true);
      const s = loadSession();
      if (!s) return;
      const r = await emit('rejoin', { code: s.code, token: s.token });
      if (!r.ok) reset();
    };
    const onState = (s: ServerState) => {
      setClockOffset(s.serverTime - Date.now());
      setState(s);
    };
    const onKicked = ({ playerId }: { playerId: string }) => {
      if (loadSession()?.playerId === playerId) {
        reset();
        alert('Bạn đã bị mời ra khỏi phòng.');
      }
    };
    const onDisconnect = () => setConnected(false);

    socket.on('connect', rejoin);
    socket.on('disconnect', onDisconnect);
    socket.on('state', onState);
    socket.on('kicked', onKicked);
    if (socket.connected) rejoin();
    return () => {
      socket.off('connect', rejoin);
      socket.off('disconnect', onDisconnect);
      socket.off('state', onState);
      socket.off('kicked', onKicked);
    };
  }, [reset]);

  const onEnter = (s: Session) => {
    saveSession(s);
    setSession(s);
  };

  const leave = () => {
    socket.emit('leave');
    reset();
  };

  let screen;
  if (!session || !state || state.code !== session.code) {
    screen = <Home onEnter={onEnter} waiting={!!session} />;
  } else if (state.status === 'lobby') {
    screen = <Lobby state={state} me={session.playerId} onLeave={leave} />;
  } else {
    screen = <Game state={state} me={session.playerId} clockOffset={clockOffset} onLeave={leave} />;
  }

  return (
    <>
      {!connected && <div className="offline">Đang kết nối lại tới server…</div>}
      {screen}
    </>
  );
}
