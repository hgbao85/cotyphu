// The board and the cards: data only, no browser. Money is in thousands of đồng.
// Design record: design/game-brief.md (Features, Your systems).
import type { Card, DeckKind, Group, Tile } from './types';

export const GROUPS: Group[] = [ // Bắc: hồng đào, đỏ son, đỏ mận · Trung: vàng chanh, vàng nghệ, cam · Nam: xanh lá, xanh ngọc
  { name: 'Bắc · Vùng cao', color: '#f0a0a8' },
  { name: 'Bắc · Non nước', color: '#d8403a' },
  { name: 'Bắc · Đồng bằng', color: '#8e2747' },
  { name: 'Trung · Xứ Thanh Nghệ', color: '#e6cf3f' },
  { name: 'Trung · Cố đô & phố cổ', color: '#f0a400' },
  { name: 'Trung · Biển & cao nguyên', color: '#e8671c' },
  { name: 'Nam · Miền Tây & biển', color: '#3a9d4a' },
  { name: 'Nam · Đảo ngọc & phố lớn', color: '#14a39a' },
];
const P = (n: string, g: number, p: number, lm: string, lk: string, sp: string): Tile => ({ t: 'prop', n, g, p, lm, lk, sp });
/** The 40 tiles, clockwise from Xuất Phát (bottom right). */
export const TILES: Tile[] = [
  { t: 'go', n: 'Xuất Phát' },
  P('Hà Giang', 0, 600, 'Cột cờ Lũng Cú', 'cotco', 'Thắng cố'),
  { t: 'kv', n: 'Khí Vận' },
  P('Cao Bằng', 0, 600, 'Thác Bản Giốc', 'thac', 'Hạt dẻ Trùng Khánh'),
  { t: 'tax', n: 'Thuế Tài Sản', kind: 'prop' },
  { t: 'port', n: 'Cảng Hải Phòng', icon: 'ship', p: 2000 },
  P('Lào Cai', 1, 1000, 'Đỉnh Fansipan', 'nui', 'Cá hồi Sa Pa'),
  { t: 'co', n: 'Cơ Hội' },
  P('Hạ Long', 1, 1000, 'Hòn Trống Mái', 'dao', 'Chả mực'),
  P('Ninh Bình', 1, 1200, 'Chùa Bái Đính', 'baidinh', 'Cơm cháy, dê núi'),
  { t: 'jail', n: 'Nhà Tù' },
  P('Bắc Ninh', 2, 1400, 'Chùa Phật Tích', 'phattich', 'Bánh phu thê'),
  P('Nam Định', 2, 1400, 'Tháp Phổ Minh', 'thap', 'Phở bò Nam Định'),
  { t: 'util', n: 'Công ty Điện', icon: 'bulb', p: 2000 },
  P('Hà Nội', 2, 1600, 'Chùa Một Cột', 'chua', 'Phở, bún chả'),
  { t: 'port', n: 'Ga Hà Nội', icon: 'train', p: 2000 },
  P('Thanh Hóa', 3, 1800, 'Thành nhà Hồ', 'thanhnhaho', 'Nem chua'),
  { t: 'kv', n: 'Khí Vận' },
  P('Nghệ An', 3, 1800, 'Hải đăng Cửa Lò', 'haidang', 'Cháo lươn'),
  P('Quảng Bình', 3, 2000, 'Núi Phong Nha', 'phongnha', 'Khoai deo'),
  { t: 'free', n: 'Bến Đỗ Tự Do' },
  P('Huế', 4, 2200, 'Ngọ Môn', 'cong', 'Bún bò Huế'),
  { t: 'co', n: 'Cơ Hội' },
  P('Hội An', 4, 2200, 'Chùa Cầu', 'chuacau', 'Cao lầu'),
  P('Đà Nẵng', 4, 2400, 'Cầu Rồng', 'cau', 'Mì Quảng'),
  { t: 'port', n: 'Cảng Cam Ranh', icon: 'ship', p: 2000 },
  P('Quy Nhơn', 5, 2600, 'Tháp Đôi', 'thapdoi', 'Bánh xèo tôm nhảy'),
  { t: 'util', n: 'Công ty Nước', icon: 'drop', p: 2000 },
  P('Nha Trang', 5, 2600, 'Tháp Bà Ponagar', 'ponagar', 'Bún chả cá'),
  P('Đà Lạt', 5, 2800, 'Ga Đà Lạt', 'gadalat', 'Dâu tây, bánh tráng nướng'),
  { t: 'gojail', n: 'Đi Tù' },
  P('Long An', 6, 3000, 'Tháp cổ Bình Tả', 'binhta', 'Lạp xưởng Cần Đước'),
  P('Cần Thơ', 6, 3000, 'Cầu Cần Thơ', 'caucantho', 'Bánh tét lá cẩm'),
  { t: 'kv', n: 'Khí Vận' },
  P('Vũng Tàu', 6, 3200, 'Hải đăng Vũng Tàu', 'vungtau', 'Bánh khọt'),
  { t: 'port', n: 'Sân bay Tân Sơn Nhất', b: 'Tân Sơn Nhất', icon: 'plane', p: 2000 },
  { t: 'co', n: 'Cơ Hội' },
  P('Phú Quốc', 7, 3500, 'Đảo Hòn Thơm', 'honthom', 'Nước mắm, gỏi cá trích'),
  { t: 'tax', n: 'Thuế Thu Nhập', b: 'Thuế Thu Nhập', kind: 'income' },
  P('TP. Hồ Chí Minh', 7, 4000, 'Chợ Bến Thành', 'thapdh', 'Cơm tấm'),
];
/** A tile someone can buy. */
export const OWNABLE = (t: Tile): boolean => t.t === 'prop' || t.t === 'port' || t.t === 'util';
export const LEVEL_NAMES = ['Đất trống', 'Nhà 1', 'Nhà 2', 'Nhà 3', 'Nhà 4', 'Khách sạn', 'Landmark'];
export const LEVEL_SHORT = ['', 'N1', 'N2', 'N3', 'N4', 'KS', 'LM'];
export const MAX_LEVEL = 6;
export const PLAYER_COLORS = ['#d62828', '#2b6cd6', '#f2c200', '#7b3fc4'];
/** The twelve animals of the Vietnamese zodiac, each a piece with its own colour. A player's colour is
 * their animal's. */
export const ANIMALS: { name: string; color: string }[] = [
  { name: 'Chuột', color: '#8d96a8' }, { name: 'Trâu', color: '#d62828' }, { name: 'Hổ', color: '#f28c1e' },
  { name: 'Mèo', color: '#2b6cd6' }, { name: 'Rồng', color: '#1f9e5a' }, { name: 'Rắn', color: '#8cc63f' },
  { name: 'Ngựa', color: '#8b5a2b' }, { name: 'Dê', color: '#2bb3b1' }, { name: 'Khỉ', color: '#f2c200' },
  { name: 'Gà', color: '#b0306a' }, { name: 'Chó', color: '#7b3fc4' }, { name: 'Heo', color: '#f49ab0' },
];
/** The animals the four seats start with: Trâu, Mèo, Khỉ, Chó (red, blue, yellow, purple). */
export const DEFAULT_ANIMALS = [1, 3, 8, 10];
export const AI_LEVELS = ['Dễ', 'Vừa', 'Khó'];

/**
 * The round events: every few rounds (config event_every) one is drawn for the whole table and lasts
 * event_rounds rounds. kind says what it changes: salary (× v), rent of colour groups or one province
 * (× v), ports and airports (× v), building (cost × v), or the two tax tiles (none paid).
 * Design record: design/game-brief.md (After play: sự kiện theo vòng).
 */
interface RoundEvent { name: string; txt: string; kind: 'salary' | 'rentGroups' | 'rentTile' | 'ports' | 'build' | 'noTax'; v: number; groups?: number[]; tile?: string }
export const EVENTS: RoundEvent[] = [
  { name: 'Tết Nguyên Đán', txt: 'Lương qua Xuất Phát × 2', kind: 'salary', v: 2 },
  { name: 'Bão miền Trung', txt: 'Đất miền Trung thu nửa tiền thuê', kind: 'rentGroups', v: 0.5, groups: [3, 4, 5] },
  { name: 'Pháo hoa Đà Nẵng', txt: 'Tiền thuê Đà Nẵng × 2', kind: 'rentTile', v: 2, tile: 'Đà Nẵng' },
  { name: 'Festival Huế', txt: 'Tiền thuê Huế × 2', kind: 'rentTile', v: 2, tile: 'Huế' },
  { name: 'Festival hoa Đà Lạt', txt: 'Tiền thuê Đà Lạt × 2', kind: 'rentTile', v: 2, tile: 'Đà Lạt' },
  { name: 'Giỗ Tổ Hùng Vương', txt: 'Đất miền Bắc thu tiền thuê × 1,5', kind: 'rentGroups', v: 1.5, groups: [0, 1, 2] },
  { name: 'Mùa nước nổi', txt: 'Đất miền Tây & biển thu tiền thuê × 1,5', kind: 'rentGroups', v: 1.5, groups: [6] },
  { name: 'Mùa du lịch hè', txt: 'Bến cảng, sân bay thu tiền thuê × 2', kind: 'ports', v: 2 },
  { name: 'Kích cầu xây dựng', txt: 'Giá xây nhà giảm một nửa', kind: 'build', v: 0.5 },
  { name: 'Giảm thuế', txt: 'Miễn cả 2 ô thuế', kind: 'noTax', v: 0 },
];

// Cards: Cơ Hội moves you around; Khí Vận (a red lì xì envelope) is mostly money.
/** The board index of a named tile, for the cards that send a player there. */
const at = (name: string): number => { const i = TILES.findIndex(t => t.n === name); if (i < 0) throw new Error(`no tile ${name}`); return i; };
export const CARDS: Record<DeckKind, Card[]> = {
  co: [
    { txt: 'Đi tới Xuất Phát. Nhận lương!', act: 'move', to: 0 },
    { txt: 'Bay ra Phú Quốc nghỉ dưỡng.', act: 'move', to: at('Phú Quốc') },
    { txt: 'Đi tàu ra Hà Nội ăn phở.', act: 'move', to: at('Hà Nội') },
    { txt: 'Ghé Hội An thả đèn hoa đăng.', act: 'move', to: at('Hội An') },
    { txt: 'Lên Đà Nẵng ngắm Cầu Rồng phun lửa.', act: 'move', to: at('Đà Nẵng') },
    { txt: 'Đi tới bến cảng hoặc sân bay gần nhất.', act: 'nearport' },
    { txt: 'Quên ví ở quán cà phê: lùi lại 3 ô.', act: 'back', v: 3 },
    { txt: 'Vượt đèn đỏ bị bắt! Vào thẳng Nhà Tù. Lần qua Xuất Phát tới không được nhận lương (trừ khi ra tù bằng Thẻ Ra Tù).', act: 'jail' },
    { txt: 'Thẻ Ra Tù Miễn Phí. Giữ lại dùng khi cần.', act: 'free' },
    { txt: 'Thẻ Đổ Lại: giữ lại. Khi sắp dẫm vào đất người khác, dùng để đổ xúc xắc lại.', act: 'reroll' },
    { txt: 'Trúng xổ số kiến thiết: nhận 1.500.000 đ.', act: 'money', v: 1500 },
    { txt: 'Bị phạt vì đỗ xe trên vỉa hè: trả 300.000 đ.', act: 'money', v: -300 },
    { txt: 'Sửa nhà sau bão: trả 100.000 đ cho mỗi cấp xây của bạn (tối đa 1.500.000 đ).', act: 'repair', v: 100 },
    { txt: 'Thưởng Tết to: nhận 1.000.000 đ.', act: 'money', v: 1000 },
    { txt: 'Thợ quen làm giúp: xây thêm 1 cấp miễn phí cho một ô đất của bạn.', act: 'freebuild' },
    { txt: 'Khao cả bàn đi ăn lẩu: trả mỗi người 200.000 đ.', act: 'payeach', v: 200 },
    { txt: 'Vé máy bay giá rẻ: bay tới ô bất kỳ bạn chọn!', act: 'fly' },
  ],
  kv: [
    { txt: 'Lì xì đầu năm: nhận 500.000 đ.', act: 'money', v: 500 },
    { txt: 'Bà ngoại cho tiền tiêu vặt: nhận 1.000.000 đ.', act: 'money', v: 1000 },
    { txt: 'Bán ve chai được 200.000 đ.', act: 'money', v: 200 },
    { txt: 'Đóng tiền học thêm cho con: trả 500.000 đ.', act: 'money', v: -500 },
    { txt: 'Đi khám răng: trả 300.000 đ.', act: 'money', v: -300 },
    { txt: 'Bán được lô cà phê: nhận 1.500.000 đ.', act: 'money', v: 1500 },
    { txt: 'Sinh nhật bạn! Mỗi người mừng bạn 200.000 đ.', act: 'collect', v: 200 },
    { txt: 'Đám cưới bạn thân: mừng 500.000 đ.', act: 'money', v: -500 },
    { txt: 'Về quê ăn Tết: đi tới Xuất Phát nhận lương.', act: 'move', to: 0 },
    { txt: 'Nhậu xong còn lái xe! Vào thẳng Nhà Tù. Lần qua Xuất Phát tới không được nhận lương (trừ khi ra tù bằng Thẻ Ra Tù).', act: 'jail' },
    { txt: 'Thẻ Ra Tù Miễn Phí. Giữ lại dùng khi cần.', act: 'free' },
    { txt: 'Thẻ Miễn Thuê: giữ lại. Dùng để khỏi trả tiền thuê một lần.', act: 'norent' },
    { txt: 'Hoàn thuế cuối năm: nhận 400.000 đ.', act: 'money', v: 400 },
    { txt: 'Phí bảo trì nhà cửa: trả 50.000 đ cho mỗi cấp xây (tối đa 1.500.000 đ).', act: 'repair', v: 50 },
    { txt: 'Tiền điện mùa hè tăng vọt: trả 400.000 đ.', act: 'money', v: -400 },
    { txt: 'Trúng số độc đắc! Nhận 1.500.000 đ.', act: 'money', v: 1500 },
    { txt: 'Được mời làm MC đám cưới: nhận 300.000 đ.', act: 'money', v: 300 },
  ],
};
