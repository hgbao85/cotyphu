import type { ColorGroup, Tile } from './types';

export const GROUP_COLORS: Record<ColorGroup, string> = {
  brown: '#8d5a3b',
  sky: '#4cb8e6',
  pink: '#d9488f',
  orange: '#f08a24',
  red: '#d7263d',
  yellow: '#e8c22c',
  green: '#2a9d5c',
  blue: '#2347a1',
};

export const GROUP_NAMES: Record<ColorGroup, string> = {
  brown: 'Mũi Cà Mau',
  sky: 'Miền Tây',
  pink: 'Tây Nguyên',
  orange: 'Nam Trung Bộ',
  red: 'Miền Trung',
  yellow: 'Đông Bắc',
  green: 'Đông Nam Bộ',
  blue: 'Đô thị lớn',
};

function rentTable(price: number): number[] {
  const base = Math.max(2, Math.round(price / 10));
  return [base, base * 5, base * 15, base * 40, base * 55, base * 70];
}

function prop(id: number, name: string, group: ColorGroup, price: number, houseCost: number): Tile {
  return { id, name, type: 'property', group, price, houseCost, rent: rentTable(price) };
}

const airport = (id: number, name: string): Tile => ({ id, name, type: 'airport', price: 200 });
const utility = (id: number, name: string): Tile => ({ id, name, type: 'utility', price: 150 });
const chance = (id: number): Tile => ({ id, name: 'Cơ hội', type: 'chance' });
const community = (id: number): Tile => ({ id, name: 'Khí vận', type: 'community' });

export const BOARD: Tile[] = [
  { id: 0, name: 'Xuất phát', type: 'start' },
  prop(1, 'Cà Mau', 'brown', 60, 50),
  community(2),
  prop(3, 'Bạc Liêu', 'brown', 60, 50),
  { id: 4, name: 'Thuế thu nhập', type: 'tax', tax: 200 },
  airport(5, 'Sân bay Tân Sơn Nhất'),
  prop(6, 'Sóc Trăng', 'sky', 100, 50),
  chance(7),
  prop(8, 'Trà Vinh', 'sky', 100, 50),
  prop(9, 'Vĩnh Long', 'sky', 120, 50),
  { id: 10, name: 'Nhà tù', type: 'jail' },
  prop(11, 'Buôn Ma Thuột', 'pink', 140, 100),
  utility(12, 'Công ty Điện'),
  prop(13, 'Pleiku', 'pink', 140, 100),
  prop(14, 'Kon Tum', 'pink', 160, 100),
  airport(15, 'Sân bay Phú Bài'),
  prop(16, 'Quy Nhơn', 'orange', 180, 100),
  community(17),
  prop(18, 'Nha Trang', 'orange', 180, 100),
  prop(19, 'Phan Thiết', 'orange', 200, 100),
  { id: 20, name: 'Công viên', type: 'parking' },
  prop(21, 'Hội An', 'red', 220, 150),
  chance(22),
  prop(23, 'Huế', 'red', 220, 150),
  prop(24, 'Đà Nẵng', 'red', 240, 150),
  airport(25, 'Sân bay Cam Ranh'),
  prop(26, 'Hạ Long', 'yellow', 260, 150),
  prop(27, 'Sa Pa', 'yellow', 260, 150),
  utility(28, 'Công ty Nước'),
  prop(29, 'Hải Phòng', 'yellow', 280, 150),
  { id: 30, name: 'Vào tù', type: 'gotojail' },
  prop(31, 'Cần Thơ', 'green', 300, 200),
  prop(32, 'Biên Hòa', 'green', 300, 200),
  community(33),
  prop(34, 'Vũng Tàu', 'green', 320, 200),
  airport(35, 'Sân bay Nội Bài'),
  chance(36),
  prop(37, 'Hà Nội', 'blue', 350, 200),
  { id: 38, name: 'Thuế xa xỉ', type: 'tax', tax: 100 },
  prop(39, 'TP. Hồ Chí Minh', 'blue', 400, 200),
];

export const JAIL_INDEX = 10;
export const AIRPORTS = BOARD.filter((t) => t.type === 'airport').map((t) => t.id);
export const UTILITIES = BOARD.filter((t) => t.type === 'utility').map((t) => t.id);

export const GROUP_TILES = BOARD.reduce(
  (acc, t) => {
    if (t.group) (acc[t.group] ??= []).push(t.id);
    return acc;
  },
  {} as Record<ColorGroup, number[]>,
);

export const isOwnable = (t: Tile) => t.type === 'property' || t.type === 'airport' || t.type === 'utility';
