import { describe, expect, it } from 'vitest';
import { botDecide } from './bot';
import {
  addPlayer,
  applyAction,
  canBuild,
  createGame,
  currentPlayer,
  JAIL_FINE,
  PASS_START_BONUS,
  START_MONEY,
  startGame,
} from './engine';
import type { GameState } from './types';

/** rng trả về đúng các mặt xúc xắc cho trước (1–6). */
function dice(...faces: number[]) {
  let i = 0;
  return () => {
    const f = faces[i++ % faces.length];
    return (f - 1) / 6 + 0.01;
  };
}

function setup(n = 2): GameState {
  const s = createGame('TEST');
  for (let i = 0; i < n; i++) addPlayer(s, `p${i}`, `Người ${i}`, false);
  startGame(s, Math.random, false);
  return s;
}

describe('engine', () => {
  it('gieo, dừng ở đất trống và mua', () => {
    const s = setup();
    expect(applyAction(s, 'p0', { type: 'ROLL' }, dice(1, 2)).ok).toBe(true);
    expect(s.players[0].position).toBe(3);
    expect(s.phase).toBe('buy');
    expect(applyAction(s, 'p0', { type: 'BUY' }, dice(1)).ok).toBe(true);
    expect(s.owners[3].ownerId).toBe('p0');
    expect(s.players[0].money).toBe(START_MONEY - 60);
    expect(s.phase).toBe('end-turn');
  });

  it('không cho người khác hành động ngoài lượt', () => {
    const s = setup();
    const r = applyAction(s, 'p1', { type: 'ROLL' }, dice(1, 2));
    expect(r.ok).toBe(false);
  });

  it('trả tiền thuê cho chủ đất', () => {
    const s = setup();
    s.owners[3] = { ownerId: 'p1', houses: 0 };
    applyAction(s, 'p0', { type: 'ROLL' }, dice(1, 2));
    expect(s.players[0].money).toBe(START_MONEY - 6);
    expect(s.players[1].money).toBe(START_MONEY + 6);
  });

  it('tiền thuê gấp đôi khi đủ nhóm, theo nhà khi đã xây', () => {
    const s = setup();
    s.owners[1] = { ownerId: 'p1', houses: 0 };
    s.owners[3] = { ownerId: 'p1', houses: 0 };
    applyAction(s, 'p0', { type: 'ROLL' }, dice(1, 2));
    expect(s.players[0].money).toBe(START_MONEY - 12);
    s.owners[3].houses = 2;
    s.players[0].position = 0;
    s.phase = 'roll';
    applyAction(s, 'p0', { type: 'ROLL' }, dice(1, 2));
    expect(s.players[0].money).toBe(START_MONEY - 12 - 90);
  });

  it('qua Xuất phát nhận tiền', () => {
    const s = setup();
    s.players[0].position = 38;
    applyAction(s, 'p0', { type: 'ROLL' }, dice(1, 2)); // 38 -> 1 (Cà Mau)
    expect(s.players[0].position).toBe(1);
    expect(s.players[0].money).toBe(START_MONEY + PASS_START_BONUS);
  });

  it('gieo đôi được gieo tiếp, 3 lần đôi vào tù', () => {
    const s = setup();
    applyAction(s, 'p0', { type: 'ROLL' }, dice(2, 2)); // ô 4: thuế
    expect(s.phase).toBe('roll');
    applyAction(s, 'p0', { type: 'ROLL' }, dice(3, 3)); // ô 10: nhà tù (thăm)
    expect(s.phase).toBe('roll');
    applyAction(s, 'p0', { type: 'ROLL' }, dice(1, 1));
    expect(s.players[0].inJail).toBe(true);
    expect(s.players[0].position).toBe(10);
    expect(s.phase).toBe('end-turn');
  });

  it('ở tù: không ra đôi thì nghỉ, lần 3 tự nộp phạt', () => {
    const s = setup();
    const p = s.players[0];
    p.inJail = true;
    p.position = 10;
    for (let i = 0; i < 2; i++) {
      s.currentIdx = 0;
      s.phase = 'roll';
      applyAction(s, 'p0', { type: 'ROLL' }, dice(1, 2));
      expect(p.inJail).toBe(true);
      expect(p.position).toBe(10);
    }
    s.currentIdx = 0;
    s.phase = 'roll';
    applyAction(s, 'p0', { type: 'ROLL' }, dice(1, 2)); // 10 -> 13 Pleiku
    expect(p.inJail).toBe(false);
    expect(p.position).toBe(13);
    expect(p.money).toBe(START_MONEY - JAIL_FINE);
  });

  it('xây nhà phải đủ nhóm và xây đều', () => {
    const s = setup();
    s.owners[1] = { ownerId: 'p0', houses: 0 };
    expect(canBuild(s, 'p0', 1)).toMatch(/nhóm/);
    s.owners[3] = { ownerId: 'p0', houses: 0 };
    expect(applyAction(s, 'p0', { type: 'BUILD', tileId: 1 }, dice(1)).ok).toBe(true);
    expect(canBuild(s, 'p0', 1)).toMatch(/đều/);
    expect(applyAction(s, 'p0', { type: 'BUILD', tileId: 3 }, dice(1)).ok).toBe(true);
    expect(s.players[0].money).toBe(START_MONEY - 100);
  });

  it('phá sản: bán nhà trước, rồi chuyển đất cho chủ nợ và kết thúc ván 2 người', () => {
    const s = setup();
    s.owners[39] = { ownerId: 'p1', houses: 5 };
    s.owners[37] = { ownerId: 'p1', houses: 5 };
    s.owners[1] = { ownerId: 'p0', houses: 1 };
    s.owners[3] = { ownerId: 'p0', houses: 1 };
    s.players[0].money = 100;
    s.players[0].position = 36;
    applyAction(s, 'p0', { type: 'ROLL' }, dice(1, 2)); // -> 39, thuê 2800
    expect(s.players[0].bankrupt).toBe(true);
    expect(s.owners[1]).toEqual({ ownerId: 'p1', houses: 0 });
    expect(s.players[1].money).toBe(START_MONEY + 100 + 50);
    expect(s.status).toBe('ended');
    expect(s.winnerId).toBe('p1');
  });

  it('kết thúc lượt chuyển sang người kế và tăng vòng khi quay lại', () => {
    const s = setup(3);
    applyAction(s, 'p0', { type: 'ROLL' }, dice(1, 2));
    applyAction(s, 'p0', { type: 'SKIP_BUY' }, dice(1));
    applyAction(s, 'p0', { type: 'END_TURN' }, dice(1));
    expect(currentPlayer(s).id).toBe('p1');
    s.currentIdx = 2;
    s.phase = 'end-turn';
    applyAction(s, 'p2', { type: 'END_TURN' }, dice(1));
    expect(currentPlayer(s).id).toBe('p0');
    expect(s.round).toBe(2);
  });
});

describe('mô phỏng toàn bot', () => {
  it('100 ván bot chạy tới cuối không lỗi, tiền không âm', () => {
    for (let g = 0; g < 100; g++) {
      const s = createGame('SIM');
      for (let i = 0; i < 4; i++) addPlayer(s, `b${i}`, `Bot ${i}`, true);
      startGame(s, Math.random);
      let steps = 0;
      while (s.status === 'playing' && steps < 20000) {
        const cur = currentPlayer(s);
        const action = botDecide(s, cur.id)!;
        const r = applyAction(s, cur.id, action, Math.random);
        expect(r, JSON.stringify(action) + ' ' + s.phase).toEqual({ ok: true });
        for (const p of s.players) expect(p.money).toBeGreaterThanOrEqual(0);
        steps++;
      }
      expect(s.status).toBe('ended');
      expect(s.winnerId).not.toBeNull();
    }
  });
});
