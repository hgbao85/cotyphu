export type CardEffect =
  | { kind: 'money'; amount: number }
  | { kind: 'moveTo'; tile: number }
  | { kind: 'moveBy'; steps: number }
  | { kind: 'jail' }
  | { kind: 'jailCard' }
  /** amount > 0: nhận từ mỗi người; amount < 0: trả cho mỗi người */
  | { kind: 'eachPlayer'; amount: number }
  | { kind: 'repairs'; perHouse: number; perHotel: number }
  | { kind: 'nearestAirport' };

export interface Card {
  text: string;
  effect: CardEffect;
}

export const CHANCE: Card[] = [
  { text: 'Đi thẳng về Xuất phát, nhận 200.', effect: { kind: 'moveTo', tile: 0 } },
  { text: 'Bay ra Hà Nội công tác.', effect: { kind: 'moveTo', tile: 37 } },
  { text: 'Đi du lịch Hội An.', effect: { kind: 'moveTo', tile: 21 } },
  { text: 'Ra sân bay gần nhất.', effect: { kind: 'nearestAirport' } },
  { text: 'Quên ví, quay lại 3 bước.', effect: { kind: 'moveBy', steps: -3 } },
  { text: 'Vượt đèn đỏ. Vào tù!', effect: { kind: 'jail' } },
  { text: 'Trúng vé số, nhận 150.', effect: { kind: 'money', amount: 150 } },
  { text: 'Nhận cổ tức, 50.', effect: { kind: 'money', amount: 50 } },
  { text: 'Phạt chạy quá tốc độ, nộp 15.', effect: { kind: 'money', amount: -15 } },
  { text: 'Sửa sang nhà cửa: 25 mỗi nhà, 100 mỗi khách sạn.', effect: { kind: 'repairs', perHouse: 25, perHotel: 100 } },
  { text: 'Được bầu làm trưởng thôn, khao mỗi người 50.', effect: { kind: 'eachPlayer', amount: -50 } },
  { text: 'Thẻ ra tù miễn phí. Giữ lại dùng sau.', effect: { kind: 'jailCard' } },
];

export const COMMUNITY: Card[] = [
  { text: 'Đi thẳng về Xuất phát, nhận 200.', effect: { kind: 'moveTo', tile: 0 } },
  { text: 'Ngân hàng tính nhầm có lợi cho bạn, nhận 200.', effect: { kind: 'money', amount: 200 } },
  { text: 'Tiền khám bệnh, nộp 50.', effect: { kind: 'money', amount: -50 } },
  { text: 'Bán đồ cũ, nhận 50.', effect: { kind: 'money', amount: 50 } },
  { text: 'Thẻ ra tù miễn phí. Giữ lại dùng sau.', effect: { kind: 'jailCard' } },
  { text: 'Bị bắt quả tang trốn thuế. Vào tù!', effect: { kind: 'jail' } },
  { text: 'Sinh nhật bạn! Mỗi người mừng bạn 10.', effect: { kind: 'eachPlayer', amount: 10 } },
  { text: 'Hoàn thuế thu nhập, nhận 20.', effect: { kind: 'money', amount: 20 } },
  { text: 'Đóng học phí, nộp 100.', effect: { kind: 'money', amount: -100 } },
  { text: 'Lãi tiết kiệm, nhận 100.', effect: { kind: 'money', amount: 100 } },
  { text: 'Sửa đường trước nhà: 40 mỗi nhà, 115 mỗi khách sạn.', effect: { kind: 'repairs', perHouse: 40, perHotel: 115 } },
  { text: 'Thắng giải ca hát, nhận 10.', effect: { kind: 'money', amount: 10 } },
];
