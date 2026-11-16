// The game's state and its entities. No browser here.

/** Objects the game builds field by field and kind by kind (popups, debts, animations, UI buttons):
 * typing them one by one is still to do. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Loose = any;

export type TileKind = 'go' | 'prop' | 'kv' | 'co' | 'port' | 'util' | 'tax' | 'jail' | 'free' | 'gojail';
export type DeckKind = 'co' | 'kv';

/** One of the 40 board tiles. Province tiles have a group, price and landmark. */
export interface Tile {
  t: TileKind;
  /** The name shown on cards and in the log. */
  n: string;
  /** A shorter name for the board, when the full one does not fit. */
  b?: string;
  /** The colour group (province tiles). */
  g?: number;
  /** The price in thousands of đồng (ownable tiles). */
  p?: number;
  /** The landmark's name and its 3D model kind (province tiles). */
  lm?: string;
  lk?: string;
  /** The tile's icon (ports and utilities). */
  icon?: string;
  /** A tax tile's kind. */
  kind?: 'income' | 'prop';
}

export interface Group {
  name: string;
  color: string;
}

export type CardAct = 'move' | 'nearport' | 'back' | 'jail' | 'free' | 'money' | 'repair' | 'freebuild' | 'payeach' | 'collect' | 'fly';

export interface Card {
  txt: string;
  act: CardAct;
  /** A money amount (k đồng), or a step count for 'back'. */
  v?: number;
  /** The tile a 'move' card sends you to. */
  to?: number;
}

/** human: plays on this screen · remote: a friend online · ai: the computer · off: empty. */
export type SeatKind = 'human' | 'remote' | 'ai' | 'off';

export interface Seat {
  kind: SeatKind;
  /** The AI level: 0 Dễ, 1 Vừa, 2 Khó. */
  lv?: number;
  /** A remote seat: the friend's id in the room, and the name they typed. */
  peer?: number;
  name?: string;
}

export interface Player {
  /** The seat: it picks the colour, the token and the place on a tile. */
  id: number;
  kind: SeatKind;
  lv: number;
  color: string;
  token: number;
  name: string;
  /** Cash in thousands of đồng. */
  cash: number;
  pos: number;
  /** How many times they have passed Xuất Phát. */
  laps: number;
  inJail: boolean;
  jailTries: number;
  /** Thẻ Ra Tù held, by the deck each came from. */
  freeCards: DeckKind[];
  bankrupt: boolean;
  doubles: number;
  /** A jail card docks the next salary until a Thẻ Ra Tù clears it. */
  noSalary?: boolean;
  lastRoll?: number;
  /** A friend playing online: their id in the room, and whether they are disconnected now. */
  peer?: number;
  offline?: boolean;
}

/** The state of one game: everything the rules read and change. */
export interface GameState {
  t: number;
  score: number;
  gained: string;
  players: Player[];
  cur: number;
  round: number;
  mode: 'bankrupt' | 'rounds';
  /** Per tile: the owner's player index or -1, the building level 0-6, mortgaged or not. */
  owner: number[];
  level: number[];
  mort: boolean[];
  phase: string;
  timer: number;
  dice: number[];
  diceT: number;
  diceDur?: number;
  throwPower?: number;
  diceSpin?: Loose[];
  diceShow?: Loose;
  shaking?: Loose;
  rolledDouble: boolean;
  moveLeft: number;
  moveDir: number;
  hopT: number;
  hopFast?: boolean;
  popup: Loose;
  debt: Loose;
  pick: number;
  log: string[];
  floaters: Loose[];
  decks: Record<DeckKind, number[]>;
  used: Record<DeckKind, number[]>;
  flash: { tile: number; t: number };
  ranking: Loose[] | null;
  turns: number;
  pot: number;
  reason?: string;
  /** Online: a vote for a new game: who asked, the time it has run, and each voter's answer. */
  vote?: Loose;
}
