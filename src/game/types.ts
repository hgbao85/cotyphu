// The game's state and its entities. No browser here.

/** Objects the game builds field by field and kind by kind (popups, debts, animations, UI buttons):
 * typing them one by one is still to do. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Loose = any;

type TileKind = 'go' | 'prop' | 'kv' | 'co' | 'port' | 'util' | 'tax' | 'jail' | 'free' | 'gojail';
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
  /** A province's đặc sản, the dish it is known for, shown on its card. */
  sp?: string;
  /** The tile's icon (ports and utilities). */
  icon?: string;
  /** A tax tile's kind. */
  kind?: 'income' | 'prop';
}

export interface Group {
  name: string;
  color: string;
}

type CardAct = 'move' | 'nearport' | 'back' | 'jail' | 'free' | 'money' | 'repair' | 'freebuild' | 'payeach' | 'collect' | 'fly' | 'norent' | 'reroll';
/** A rare card a player keeps for later: Thẻ Miễn Thuê (skip one rent) or Thẻ Đổ Lại (throw again). */
export type KeepAct = 'norent' | 'reroll';

export interface Card {
  txt: string;
  act: CardAct;
  /** A money amount (k đồng), or a step count for 'back'. */
  v?: number;
  /** The tile a 'move' card sends you to. */
  to?: number;
}

/** human: plays on this screen · remote: a friend online · ai: the computer · off: empty. */
type SeatKind = 'human' | 'remote' | 'ai' | 'off';

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
  /** In a team game, the player's team: 0 (seats 1 and 3) or 1 (seats 2 and 4). */
  team?: number;
  /** Rare cards kept for later, with the deck each goes back to when used. */
  keep?: { act: KeepAct; deck: DeckKind }[];
  bankrupt: boolean;
  doubles: number;
  /** A jail card docks the next salary until a Thẻ Ra Tù clears it. */
  noSalary?: boolean;
  lastRoll?: number;
  /** A friend playing online: their id in the room, and whether they are disconnected now. */
  peer?: number;
  offline?: boolean;
  /** A friend's seat the computer took over when they left: they can come back to it. */
  wasRemote?: boolean;
  /** The throw that set this player's place in the order of play. */
  orderRoll?: number;
  /** The face their animal makes for a moment: happy on getting money, sad on paying it (state.t when). */
  face?: { k: 'happy' | 'sad'; at: number };
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
  /** A limited game's last round (30 or 50); absent in games saved before there was a choice. */
  maxRounds?: number;
  /** A 2-against-2 game: partners pay each other no rent and win together. */
  teams?: boolean;
  /** Rent paid and received by seat, and rent collected by tile: the end-of-game summary. */
  stats?: { paid: number[]; got: number[]; tile: Record<number, number> };
  /** The round event in play: which one (EVENTS), its last round, and seconds since it began (for its banner). */
  event?: { i: number; until: number; t: number };
  /** Every log line of the game with its round, "V3: ...", for the history page (kept on the host). */
  history?: string[];
  /** Bubbles over the pieces online: seat, which emote (or a typed line in text, i -1), its age in seconds, a unique id. */
  emotes?: { seat: number; i: number; t: number; id: string; text?: string }[];
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
  /** The sweet zone of the throw to come, shown on the power gauge before the button is held (src/game/dice.ts). */
  zone?: { a: number; b: number };
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
  /** Coins flying with a payment: from a seat to a seat, -1 the jar in the middle (state.t when it left). */
  flights?: { from: number; to: number; at: number }[];
  decks: Record<DeckKind, number[]>;
  used: Record<DeckKind, number[]>;
  flash: { tile: number; t: number };
  ranking: Loose[] | null;
  turns: number;
  pot: number;
  reason?: string;
  /** Online: a vote for a new game: who asked, the time it has run, and each voter's answer. */
  vote?: Loose;
  /** Choosing who goes first: each player's throw, null until they throw. */
  ordering?: boolean;
  order?: (number | null)[];
  /** The throws for the order before this one, per player: a tie is settled by throwing again, compared in turn. */
  orderPast?: number[][];
}
