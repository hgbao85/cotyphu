import { AIRPORTS, BOARD, GROUP_TILES, isOwnable, JAIL_INDEX, UTILITIES } from './board';
import { CHANCE, COMMUNITY, type Card } from './cards';
import type { ActionResult, ColorGroup, GameAction, GameState, Player } from './types';

/** Trả về số ngẫu nhiên trong [0, 1). Server dùng Math.random, test dùng chuỗi cố định. */
export type Rng = () => number;

export const START_MONEY = 1500;
export const PASS_START_BONUS = 200;
export const JAIL_FINE = 50;
export const MAX_PLAYERS = 4;
export const DEFAULT_MAX_ROUNDS = 30;
export const PLAYER_COLORS = ['#e63946', '#1d8fe1', '#2a9d5c', '#f4a300'];

const ok = (): ActionResult => ({ ok: true });
const fail = (error: string): ActionResult => ({ ok: false, error });

// ---------- Khởi tạo & phòng chờ ----------

export function createGame(code: string): GameState {
  return {
    code,
    status: 'lobby',
    hostId: '',
    players: [],
    owners: {},
    currentIdx: 0,
    phase: 'roll',
    dice: null,
    rolledDoubles: false,
    doublesCount: 0,
    round: 1,
    maxRounds: DEFAULT_MAX_ROUNDS,
    log: [],
    chat: [],
    lastCard: null,
    winnerId: null,
    turnDeadline: null,
    seq: 0,
  };
}

export function addPlayer(state: GameState, id: string, name: string, isBot: boolean): Player | null {
  if (state.status !== 'lobby' || state.players.length >= MAX_PLAYERS) return null;
  const used = new Set(state.players.map((p) => p.color));
  const color = PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[0];
  const player: Player = {
    id,
    name,
    color,
    isBot,
    connected: true,
    money: START_MONEY,
    position: 0,
    inJail: false,
    jailTurns: 0,
    jailCards: 0,
    bankrupt: false,
  };
  state.players.push(player);
  if (!state.hostId && !isBot) state.hostId = id;
  return player;
}

export function removePlayer(state: GameState, id: string): void {
  state.players = state.players.filter((p) => p.id !== id);
  if (state.hostId === id) state.hostId = state.players.find((p) => !p.isBot)?.id ?? '';
}

export function startGame(state: GameState, rng: Rng, shuffle = true): ActionResult {
  if (state.status !== 'lobby') return fail('Ván đã bắt đầu');
  if (state.players.length < 2) return fail('Cần ít nhất 2 người chơi');
  if (shuffle) {
    for (let i = state.players.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [state.players[i], state.players[j]] = [state.players[j], state.players[i]];
    }
  }
  for (const p of state.players) {
    Object.assign(p, { money: START_MONEY, position: 0, inJail: false, jailTurns: 0, jailCards: 0, bankrupt: false });
  }
  Object.assign(state, {
    status: 'playing',
    owners: {},
    currentIdx: 0,
    phase: 'roll',
    dice: null,
    rolledDoubles: false,
    doublesCount: 0,
    round: 1,
    lastCard: null,
    winnerId: null,
  });
  log(state, `Ván bắt đầu! ${state.players[0].name} đi trước.`);
  return ok();
}

// ---------- Tiện ích ----------

export function getPlayer(state: GameState, id: string): Player | undefined {
  return state.players.find((p) => p.id === id);
}

export function currentPlayer(state: GameState): Player {
  return state.players[state.currentIdx];
}

function log(state: GameState, text: string): void {
  state.log.push({ id: ++state.seq, text });
  if (state.log.length > 80) state.log.splice(0, state.log.length - 80);
}

export function addChat(state: GameState, playerId: string, text: string): void {
  const p = getPlayer(state, playerId);
  if (!p) return;
  state.chat.push({ id: ++state.seq, playerId, name: p.name, text: text.slice(0, 200) });
  if (state.chat.length > 50) state.chat.splice(0, state.chat.length - 50);
}

export function ownsGroup(state: GameState, playerId: string, group: ColorGroup): boolean {
  return GROUP_TILES[group].every((id) => state.owners[id]?.ownerId === playerId);
}

export function calcRent(state: GameState, tileId: number, diceSum: number): number {
  const tile = BOARD[tileId];
  const own = state.owners[tileId];
  if (!own) return 0;
  if (tile.type === 'property') {
    const rent = tile.rent!;
    if (own.houses > 0) return rent[own.houses];
    return ownsGroup(state, own.ownerId, tile.group!) ? rent[0] * 2 : rent[0];
  }
  if (tile.type === 'airport') {
    const n = AIRPORTS.filter((id) => state.owners[id]?.ownerId === own.ownerId).length;
    return 25 * 2 ** (n - 1);
  }
  if (tile.type === 'utility') {
    const n = UTILITIES.filter((id) => state.owners[id]?.ownerId === own.ownerId).length;
    return diceSum * (n >= 2 ? 10 : 4);
  }
  return 0;
}

export function netWorth(state: GameState, playerId: string): number {
  const p = getPlayer(state, playerId);
  if (!p || p.bankrupt) return 0;
  let total = p.money;
  for (const [id, own] of Object.entries(state.owners)) {
    if (own.ownerId !== playerId) continue;
    const tile = BOARD[Number(id)];
    total += (tile.price ?? 0) + own.houses * (tile.houseCost ?? 0);
  }
  return total;
}

/** Trả về lý do không xây được, hoặc null nếu xây được. */
export function canBuild(state: GameState, playerId: string, tileId: number): string | null {
  const tile = BOARD[tileId];
  const own = state.owners[tileId];
  const p = getPlayer(state, playerId);
  if (!tile || tile.type !== 'property' || !own || !p) return 'Không phải đất của bạn';
  if (own.ownerId !== playerId) return 'Không phải đất của bạn';
  if (!ownsGroup(state, playerId, tile.group!)) return 'Cần sở hữu đủ nhóm màu';
  if (own.houses >= 5) return 'Đã có khách sạn';
  const minHouses = Math.min(...GROUP_TILES[tile.group!].map((id) => state.owners[id].houses));
  if (own.houses > minHouses) return 'Phải xây đều các ô trong nhóm';
  if (p.money < tile.houseCost!) return 'Không đủ tiền';
  return null;
}

export function canSellHouse(state: GameState, playerId: string, tileId: number): string | null {
  const tile = BOARD[tileId];
  const own = state.owners[tileId];
  if (!tile || tile.type !== 'property' || !own || own.ownerId !== playerId) return 'Không phải đất của bạn';
  if (own.houses === 0) return 'Chưa có nhà';
  const maxHouses = Math.max(...GROUP_TILES[tile.group!].map((id) => state.owners[id]?.houses ?? 0));
  if (own.houses < maxHouses) return 'Phải bán đều các ô trong nhóm';
  return null;
}

// ---------- Di chuyển & tiền ----------

function moveBy(state: GameState, p: Player, steps: number): void {
  const from = p.position;
  p.position = (((from + steps) % 40) + 40) % 40;
  if (steps > 0 && p.position < from) {
    p.money += PASS_START_BONUS;
    log(state, `${p.name} qua Xuất phát, nhận ${PASS_START_BONUS}.`);
  }
}

function moveTo(state: GameState, p: Player, target: number): void {
  if (target <= p.position) {
    p.money += PASS_START_BONUS;
    log(state, `${p.name} qua Xuất phát, nhận ${PASS_START_BONUS}.`);
  }
  p.position = target;
}

function sendToJail(state: GameState, p: Player): void {
  p.position = JAIL_INDEX;
  p.inJail = true;
  p.jailTurns = 0;
  state.rolledDoubles = false;
  state.phase = 'end-turn';
  log(state, `${p.name} vào tù!`);
}

/** Bán nhà (nửa giá) cho tới khi đủ `amount` hoặc hết nhà. */
function liquidate(state: GameState, p: Player, amount: number): void {
  let sold = 0;
  while (p.money < amount) {
    let best: number | null = null;
    for (const [id, own] of Object.entries(state.owners)) {
      if (own.ownerId === p.id && own.houses > 0 && (best === null || own.houses > state.owners[best].houses)) {
        best = Number(id);
      }
    }
    if (best === null) break;
    state.owners[best].houses--;
    p.money += Math.floor(BOARD[best].houseCost! / 2);
    sold++;
  }
  if (sold > 0) log(state, `${p.name} buộc phải bán ${sold} nhà để trả nợ.`);
}

function pay(state: GameState, from: Player, to: Player | null, amount: number): void {
  if (amount <= 0 || from.bankrupt) return;
  if (from.money < amount) liquidate(state, from, amount);
  const paid = Math.min(amount, Math.max(0, from.money));
  from.money -= paid;
  if (to) to.money += paid;
  if (paid < amount) bankrupt(state, from, to);
}

function bankrupt(state: GameState, p: Player, creditor: Player | null): void {
  p.bankrupt = true;
  p.money = 0;
  p.inJail = false;
  for (const [id, own] of Object.entries(state.owners)) {
    if (own.ownerId !== p.id) continue;
    if (creditor) state.owners[Number(id)] = { ownerId: creditor.id, houses: 0 };
    else delete state.owners[Number(id)];
  }
  log(state, `💥 ${p.name} phá sản!${creditor ? ` Toàn bộ đất về tay ${creditor.name}.` : ''}`);
  const alive = state.players.filter((x) => !x.bankrupt);
  if (alive.length <= 1) endGame(state, alive[0]?.id ?? null);
}

function endGame(state: GameState, winnerId: string | null): void {
  state.status = 'ended';
  state.winnerId = winnerId;
  state.turnDeadline = null;
  const w = winnerId ? getPlayer(state, winnerId) : null;
  log(state, w ? `🏆 ${w.name} chiến thắng!` : 'Ván kết thúc.');
}

function endByWorth(state: GameState): void {
  const ranked = state.players
    .filter((p) => !p.bankrupt)
    .sort((a, b) => netWorth(state, b.id) - netWorth(state, a.id));
  log(state, `Hết ${state.maxRounds} vòng, tính tổng tài sản.`);
  endGame(state, ranked[0]?.id ?? null);
}

// ---------- Ô đất & thẻ ----------

function resolveLanding(state: GameState, p: Player, diceSum: number, rng: Rng, depth = 0): void {
  if (depth > 3 || p.bankrupt) return;
  const tile = BOARD[p.position];
  switch (tile.type) {
    case 'property':
    case 'airport':
    case 'utility': {
      const own = state.owners[tile.id];
      if (!own) {
        state.phase = 'buy';
        return;
      }
      if (own.ownerId === p.id) return;
      const owner = getPlayer(state, own.ownerId);
      if (!owner || owner.bankrupt) return;
      const rent = calcRent(state, tile.id, diceSum);
      log(state, `${p.name} trả ${rent} tiền thuê ${tile.name} cho ${owner.name}.`);
      pay(state, p, owner, rent);
      return;
    }
    case 'tax':
      log(state, `${p.name} nộp ${tile.name} ${tile.tax}.`);
      pay(state, p, null, tile.tax!);
      return;
    case 'chance':
    case 'community': {
      const deck = tile.type === 'chance' ? CHANCE : COMMUNITY;
      const card = deck[Math.floor(rng() * deck.length)];
      state.lastCard = { deck: tile.type, text: card.text, playerId: p.id };
      log(state, `${p.name} rút thẻ ${tile.name}: ${card.text}`);
      applyCard(state, p, card, diceSum, rng, depth);
      return;
    }
    case 'gotojail':
      sendToJail(state, p);
      return;
    default:
      return;
  }
}

function applyCard(state: GameState, p: Player, card: Card, diceSum: number, rng: Rng, depth: number): void {
  const e = card.effect;
  switch (e.kind) {
    case 'money':
      if (e.amount >= 0) p.money += e.amount;
      else pay(state, p, null, -e.amount);
      return;
    case 'moveTo':
      moveTo(state, p, e.tile);
      resolveLanding(state, p, diceSum, rng, depth + 1);
      return;
    case 'moveBy':
      moveBy(state, p, e.steps);
      resolveLanding(state, p, diceSum, rng, depth + 1);
      return;
    case 'nearestAirport': {
      const target = AIRPORTS.find((id) => id > p.position) ?? AIRPORTS[0];
      moveTo(state, p, target);
      resolveLanding(state, p, diceSum, rng, depth + 1);
      return;
    }
    case 'jail':
      sendToJail(state, p);
      return;
    case 'jailCard':
      p.jailCards++;
      return;
    case 'eachPlayer': {
      const others = state.players.filter((o) => o.id !== p.id && !o.bankrupt);
      for (const o of others) {
        if (e.amount > 0) pay(state, o, p, e.amount);
        else if (!p.bankrupt) pay(state, p, o, -e.amount);
      }
      return;
    }
    case 'repairs': {
      let total = 0;
      for (const own of Object.values(state.owners)) {
        if (own.ownerId !== p.id) continue;
        total += own.houses === 5 ? e.perHotel : own.houses * e.perHouse;
      }
      if (total > 0) {
        log(state, `${p.name} trả ${total} tiền sửa chữa.`);
        pay(state, p, null, total);
      }
      return;
    }
  }
}

// ---------- Lượt chơi ----------

/** Sau khi xử lý xong ô đất: quyết định pha tiếp theo. */
function finishStep(state: GameState, p: Player): void {
  if (state.status !== 'playing') return;
  if (p.bankrupt) {
    nextTurn(state);
    return;
  }
  if (state.phase === 'buy') return;
  state.phase = state.rolledDoubles && !p.inJail ? 'roll' : 'end-turn';
}

function nextTurn(state: GameState): void {
  state.doublesCount = 0;
  state.rolledDoubles = false;
  state.phase = 'roll';
  const n = state.players.length;
  let i = state.currentIdx;
  for (let k = 0; k < n; k++) {
    i = (i + 1) % n;
    if (i === 0) state.round++;
    if (!state.players[i].bankrupt) break;
  }
  if (state.round > state.maxRounds) {
    endByWorth(state);
    return;
  }
  state.currentIdx = i;
}

const rollDie = (rng: Rng) => 1 + Math.floor(rng() * 6);

export function applyAction(state: GameState, playerId: string, action: GameAction, rng: Rng): ActionResult {
  if (state.status !== 'playing') return fail('Ván chưa bắt đầu');
  const p = getPlayer(state, playerId);
  if (!p || p.bankrupt) return fail('Bạn không còn trong ván');
  if (currentPlayer(state).id !== p.id) return fail('Chưa tới lượt bạn');

  switch (action.type) {
    case 'ROLL': {
      if (state.phase !== 'roll') return fail('Không thể gieo lúc này');
      const d1 = rollDie(rng);
      const d2 = rollDie(rng);
      const sum = d1 + d2;
      const dbl = d1 === d2;
      state.dice = [d1, d2];
      state.lastCard = null;
      log(state, `${p.name} gieo ${d1} + ${d2} = ${sum}${dbl ? ' (đôi!)' : ''}`);

      if (p.inJail) {
        state.rolledDoubles = false;
        if (dbl) {
          p.inJail = false;
          p.jailTurns = 0;
          log(state, `${p.name} gieo ra đôi, được ra tù.`);
        } else {
          p.jailTurns++;
          if (p.jailTurns < 3) {
            state.phase = 'end-turn';
            return ok();
          }
          log(state, `${p.name} ở tù 3 lượt, nộp phạt ${JAIL_FINE} để ra.`);
          pay(state, p, null, JAIL_FINE);
          if (p.bankrupt) {
            finishStep(state, p);
            return ok();
          }
          p.inJail = false;
          p.jailTurns = 0;
        }
      } else {
        state.rolledDoubles = dbl;
        if (dbl && ++state.doublesCount >= 3) {
          log(state, `${p.name} gieo đôi 3 lần liền!`);
          sendToJail(state, p);
          return ok();
        }
      }
      moveBy(state, p, sum);
      resolveLanding(state, p, sum, rng);
      finishStep(state, p);
      return ok();
    }

    case 'BUY': {
      if (state.phase !== 'buy') return fail('Không có gì để mua');
      const tile = BOARD[p.position];
      if (!isOwnable(tile) || state.owners[tile.id]) return fail('Ô này không mua được');
      if (p.money < tile.price!) return fail('Không đủ tiền');
      p.money -= tile.price!;
      state.owners[tile.id] = { ownerId: p.id, houses: 0 };
      log(state, `${p.name} mua ${tile.name} giá ${tile.price}.`);
      state.phase = 'roll'; // tạm, finishStep sẽ quyết định
      finishStep(state, p);
      return ok();
    }

    case 'SKIP_BUY': {
      if (state.phase !== 'buy') return fail('Không có gì để bỏ qua');
      log(state, `${p.name} không mua ${BOARD[p.position].name}.`);
      state.phase = 'roll';
      finishStep(state, p);
      return ok();
    }

    case 'BUILD': {
      if (state.phase === 'buy') return fail('Hãy quyết định mua đất trước');
      const err = canBuild(state, p.id, action.tileId);
      if (err) return fail(err);
      const tile = BOARD[action.tileId];
      p.money -= tile.houseCost!;
      const own = state.owners[action.tileId];
      own.houses++;
      log(state, `${p.name} xây ${own.houses === 5 ? 'khách sạn' : `nhà thứ ${own.houses}`} ở ${tile.name}.`);
      return ok();
    }

    case 'SELL_HOUSE': {
      if (state.phase === 'buy') return fail('Hãy quyết định mua đất trước');
      const err = canSellHouse(state, p.id, action.tileId);
      if (err) return fail(err);
      const tile = BOARD[action.tileId];
      state.owners[action.tileId].houses--;
      const refund = Math.floor(tile.houseCost! / 2);
      p.money += refund;
      log(state, `${p.name} bán 1 nhà ở ${tile.name}, thu ${refund}.`);
      return ok();
    }

    case 'PAY_JAIL': {
      if (state.phase !== 'roll' || !p.inJail) return fail('Bạn không ở tù');
      if (p.money < JAIL_FINE) return fail('Không đủ tiền');
      p.money -= JAIL_FINE;
      p.inJail = false;
      p.jailTurns = 0;
      log(state, `${p.name} nộp ${JAIL_FINE} để ra tù.`);
      return ok();
    }

    case 'USE_JAIL_CARD': {
      if (state.phase !== 'roll' || !p.inJail) return fail('Bạn không ở tù');
      if (p.jailCards <= 0) return fail('Bạn không có thẻ ra tù');
      p.jailCards--;
      p.inJail = false;
      p.jailTurns = 0;
      log(state, `${p.name} dùng thẻ ra tù.`);
      return ok();
    }

    case 'END_TURN': {
      if (state.phase !== 'end-turn') return fail('Chưa thể kết thúc lượt');
      nextTurn(state);
      return ok();
    }
  }
}
