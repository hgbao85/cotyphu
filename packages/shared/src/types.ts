export type TileType =
  | 'start'
  | 'property'
  | 'airport'
  | 'utility'
  | 'chance'
  | 'community'
  | 'tax'
  | 'jail'
  | 'parking'
  | 'gotojail';

export type ColorGroup = 'brown' | 'sky' | 'pink' | 'orange' | 'red' | 'yellow' | 'green' | 'blue';

export interface Tile {
  id: number;
  name: string;
  type: TileType;
  group?: ColorGroup;
  price?: number;
  houseCost?: number;
  /** [không nhà, 1 nhà, 2 nhà, 3 nhà, 4 nhà, khách sạn] */
  rent?: number[];
  tax?: number;
}

export interface Player {
  id: string;
  name: string;
  color: string;
  isBot: boolean;
  connected: boolean;
  money: number;
  position: number;
  inJail: boolean;
  jailTurns: number;
  jailCards: number;
  bankrupt: boolean;
}

export interface Ownership {
  ownerId: string;
  /** 0–4 nhà, 5 = khách sạn */
  houses: number;
}

export type Phase = 'roll' | 'buy' | 'end-turn';

export interface LogEntry {
  id: number;
  text: string;
}

export interface ChatMessage {
  id: number;
  playerId: string;
  name: string;
  text: string;
}

export interface CardInfo {
  deck: 'chance' | 'community';
  text: string;
  playerId: string;
}

export interface GameState {
  code: string;
  status: 'lobby' | 'playing' | 'ended';
  hostId: string;
  players: Player[];
  owners: Record<number, Ownership>;
  currentIdx: number;
  phase: Phase;
  dice: [number, number] | null;
  rolledDoubles: boolean;
  doublesCount: number;
  round: number;
  maxRounds: number;
  log: LogEntry[];
  chat: ChatMessage[];
  lastCard: CardInfo | null;
  winnerId: string | null;
  /** epoch ms (giờ server) khi lượt hiện tại hết hạn; null nếu bot/không giới hạn */
  turnDeadline: number | null;
  seq: number;
}

export type GameAction =
  | { type: 'ROLL' }
  | { type: 'BUY' }
  | { type: 'SKIP_BUY' }
  | { type: 'BUILD'; tileId: number }
  | { type: 'SELL_HOUSE'; tileId: number }
  | { type: 'PAY_JAIL' }
  | { type: 'USE_JAIL_CARD' }
  | { type: 'END_TURN' };

export type ActionResult = { ok: true } | { ok: false; error: string };
