// Pages over the canvas: the rules and the game's history, plain HTML so they scroll on a phone.
import { tune } from '../config';
import { CARDS, EVENTS, LEVEL_NAMES, TILES } from '../game/data';
import { money, rentPct } from '../game/rules';

// ---- The rules, for players to read ----------------------------------------------------------
// Plain HTML over the canvas, so it scrolls on a phone. Every number comes from data/config.json and
// the board, so the page stays true when a value is tuned.
function rulesHtml(): string {
  const pct = (v: number): string => `${Math.round(v * 100)}%`;
  const lands = TILES.filter(t => t.t === 'prop').map(t => t.p!);
  const ports = TILES.filter(t => t.t === 'port'), utils = TILES.filter(t => t.t === 'util');
  const portRents = [1, 2, 3, 4].map(n => money(tune.port_rent * Math.pow(2, n - 1) * tune.rent_scale)).join(' / ');
  const levels = [0, 1, 2, 3, 4, 5, 6].map(l => `${LEVEL_NAMES[l]} ${pct(rentPct(l) * tune.rent_scale)}`).join(', ');
  const sec = (title: string, items: string[]): string => `<h3>${title}</h3><ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>`;
  return [
    sec('Chuẩn bị', [
      '2 đến 4 người chơi. Mỗi chỗ ngồi là Người, Máy (Dễ, Vừa, Khó) hoặc Bạn online.',
      'Quân cờ là 12 con giáp, mỗi con một màu. Bấm vào con vật ở màn tạo ván để đổi; mỗi con chỉ một người dùng.',
      `Kiểu ván: ${tune.max_rounds} vòng, ${tune.max_rounds_long} vòng (hết vòng thì ai giàu nhất thắng), hoặc chơi tới khi phá sản.`,
      `Mỗi người bắt đầu với ${money(tune.start_cash)} ở ô Xuất Phát.`,
      ...(tune.order_roll ? ['Đầu ván mỗi người tung xúc xắc một lần: <b>ai cao nhất đi trước, thấp nhất đi cuối</b>. Hòa điểm thì những người hòa tung lại.'] : []),
    ]),
    sec('Mỗi lượt', [
      'Giữ nút (hoặc Space) để lắc xúc xắc, thả ra để ném.',
      'Đổ đôi: được đổ tiếp. Đôi 3 lần liền: vào tù.',
      `Đi qua hoặc dừng ở Xuất Phát: nhận lương ${money(tune.salary)}.`,
    ]),
    sec('Vòng đầu (mỗi người, tới khi qua Xuất Phát lần đầu)', [
      'Chưa được mua đất: dẫm vào đất trống chỉ được xem.',
      'Được miễn cả 2 ô thuế.',
      'Tiền thuê đất người khác và tiền phạt trên thẻ vẫn phải trả.',
    ]),
    sec('Đất', [
      `${lands.length} tỉnh thành, 8 nhóm màu theo miền. Giá đất từ ${money(Math.min(...lands))} tới ${money(Math.max(...lands))}.`,
      'Dẫm vào đất trống thì được mua. Không có đấu giá, không đổi đất, không mua lại đất của người khác.',
      '<b>Dẫm lại đất của mình</b> thì được xây thêm 1 cấp: Nhà 1 → Nhà 4 → Khách sạn → Landmark của tỉnh.',
      `Giá xây mỗi cấp: nhà ${pct(tune.house_cost_pct)}, khách sạn ${pct(tune.hotel_cost_pct)}, Landmark ${pct(tune.landmark_cost_pct)} giá đất.`,
      `Tiền thuê theo giá đất: ${levels}.`,
      `Gom đủ cả nhóm màu (không ô nào đang cầm cố): tiền thuê × ${tune.full_group_mult}.`,
    ]),
    sec('Bến cảng, sân bay và công ty', [
      `${ports.length} bến, giá ${money(ports[0].p!)} mỗi ô. Tiền thuê theo số bến chủ có, không tính bến đang cầm cố: ${portRents}.`,
      `${utils.length} công ty, giá ${money(utils[0].p!)} mỗi ô. Tiền thuê = tổng xúc xắc × ${money(tune.util_mult_one * tune.rent_scale)} (có 1 công ty) hoặc × ${money(tune.util_mult_two * tune.rent_scale)} (có cả 2, không tính công ty đang cầm cố).`,
      'Bến và công ty không xây được.',
    ]),
    sec('Thuế và hũ tiền', [
      `Thuế Tài Sản: trả ${pct(tune.prop_tax_pct)} tiền mặt đang có, tối đa ${money(tune.prop_tax_flat)}.`,
      `Thuế Thu Nhập: trả ${money(tune.income_tax)}.`,
      'Tiền của 2 ô thuế dồn vào <b>hũ giữa bàn</b>. Dừng ở Bến Đỗ Tự Do thì lấy cả hũ.',
    ]),
    sec('Thẻ Cơ Hội và Khí Vận', [
      `Cơ Hội ${CARDS.co.length} thẻ, Khí Vận ${CARDS.kv.length} thẻ. Cơ Hội thiên về di chuyển, Khí Vận thiên về tiền.`,
      'Thẻ hiếm giữ lại dùng sau: <b>Thẻ Miễn Thuê</b> (khỏi trả tiền thuê một lần) và <b>Thẻ Đổ Lại</b> (sắp dẫm vào đất người khác thì đổ xúc xắc lại). Dùng xong thẻ về lại bộ.',
      `Mỗi thẻ được hoặc mất tối đa ${money(tune.card_max)}. Tiền phạt trên thẻ trả cho ngân hàng.`,
      'Rút hết bộ thì xáo lại. Thẻ Ra Tù đang có người giữ thì không bị xáo vào.',
    ]),
    sec('Nhà tù', [
      'Vào tù khi: dẫm ô Đi Tù, đổ đôi 3 lần liền, hoặc rút thẻ Vào tù.',
      'Không nộp tiền để ra tù. Mỗi lượt ở tù được lắc 1 lần, tối đa 3 lượt:',
      '· Lắc ra đôi: ra tù, đi theo số vừa lắc, rồi được lắc tiếp.',
      '· Dùng Thẻ Ra Tù: ra ngay ở bất kỳ lượt nào.',
      '· Lắc trượt cả 3 lượt: tới lượt thứ 4 mới được ra.',
      'Rút thẻ Vào tù: lần qua Xuất Phát kế tiếp mất lương. Chỉ ra tù bằng Thẻ Ra Tù mới gỡ được.',
    ]),
    ...(tune.event_every ? [sec('Sự kiện', [
      `Cứ ${tune.event_every} vòng lại có một sự kiện cho cả bàn, kéo dài ${tune.event_rounds} vòng. Ví dụ:`,
      ...EVENTS.map(e => `<b>${e.name}</b>: ${e.txt}.`),
    ])] : []),
    sec('Chơi 2 đội', [
      'Chọn "Đội" ở Kiểu ván, rồi chọn đội cho từng chỗ ngồi. Cần đủ 4 người, mỗi đội đúng 2 người.',
      'Dẫm vào đất của đồng đội thì không mất tiền thuê.',
      'Gom đủ nhóm màu tính chung cả đội: hai người góp đủ các ô của một nhóm thì cả hai cùng được tiền thuê × ' + tune.full_group_mult + '.',
      'Tới khi phá sản: đội nào còn người trụ lại thì thắng. Theo vòng: đội có tổng tài sản lớn hơn thắng.',
    ]),
    sec('Thiếu tiền và phá sản', [
      `Bán bớt 1 cấp nhà: hoàn ${pct(tune.sell_pct)} giá xây cấp đó.`,
      `Cầm cố đất (phải bán hết nhà trên ô trước): nhận ${pct(tune.mortgage_pct)} giá đất. Đất cầm cố không thu tiền thuê, và không được tính để gom đủ nhóm, đủ bến hay đủ công ty. Chuộc lại: ${pct(tune.unmortgage_pct)} giá đất.`,
      'Bán và cầm cố hết mà vẫn không đủ trả: phá sản, bị loại. Đất trả về ngân hàng.',
    ]),
    sec('Kết thúc', [
      'Tới khi phá sản: người cuối cùng còn trụ lại thắng.',
      `${tune.max_rounds} hoặc ${tune.max_rounds_long} vòng: hết vòng cuối thì ai có tổng tài sản lớn nhất thắng (tiền mặt + giá đất, đất cầm cố tính nửa giá, + tiền đã xây).`,
    ]),
    sec('Chơi online', [
      'Tạo phòng để nhận mã, bạn bè vào phòng bằng mã. Chủ phòng luôn ngồi ghế đầu tiên. Bạn bè tự bấm con vật của mình để chọn quân.',
      'Trong ván, bấm mã phòng ở góc trên để rời phòng (bạn bè), giải tán phòng (chủ phòng) hoặc bỏ phiếu chơi lại.',
      `Bỏ phiếu chơi lại: cần tất cả người chơi thật đồng ý trong ${tune.vote_time} giây.`,
      `Nút Biểu cảm: gửi câu có sẵn, hoặc Nhắn tin để gõ một câu (tối đa ${tune.chat_max_len} ký tự, cách nhau ít nhất ${tune.chat_gap} giây). Tin hiện trên quân của bạn và trong Lịch sử ván.`,
      'Rớt mạng: máy đi thay lúc vắng. Mở lại trang, bấm "Vào lại phòng" (trong 30 phút) để về đúng ghế. Người đã rời vào lại cùng tên thì lấy lại ghế.',
      'Chủ phòng tải lại trang: bấm "Vào lại phòng" là ván chơi tiếp.',
    ]),
    sec('Mẹo', [
      'Bấm vào một ô bất kỳ trên bàn cờ để xem thông tin ô đó.',
      'Nút loa (hay nút Cài đặt ở màn tạo ván): chỉnh âm lượng, bật tắt hiệu ứng. Phím M: tắt hay bật tiếng.',
      'Nút Lịch sử: xem lại mọi diễn biến của ván, theo vòng.',
      'Chơi online: nút Biểu cảm gửi một câu nhanh, hiện trên quân của bạn cho cả phòng thấy.',
    ]),
  ].join('');
}
let rulesPanel: HTMLDivElement | null = null;
/** Opens or closes the rules page. */
export function showRules(on: boolean) {
  if (on) showPage('Luật chơi', rulesHtml()); else hidePage();
}
/** Opens the reading page over the game with a title and its HTML. */
function showPage(title: string, html: string) {
  pagePanel();
  (rulesPanel!.querySelector('h2') as HTMLElement).textContent = title;
  (rulesPanel!.querySelector('.ru-body') as HTMLElement).innerHTML = html;
  rulesPanel!.style.display = 'flex';
  (rulesPanel!.querySelector('.ru-body') as HTMLElement).scrollTop = 0;
}
/** Opens the reading page with a title and HTML, and gives back its body so the caller can wire up
 * the controls in it (the settings panel). */
export function openPage(title: string, html: string): HTMLElement {
  showPage(title, html);
  return rulesPanel!.querySelector('.ru-body') as HTMLElement;
}
function hidePage() { if (rulesPanel) rulesPanel.style.display = 'none'; }
function pagePanel() {
  if (!rulesPanel) {
    const d = document.createElement('div');
    d.id = 'rules';
    d.innerHTML = '<div class="ru-card"><h2>Luật chơi</h2><div class="ru-body"></div><button class="ru-close">Đóng</button></div>';
    document.body.appendChild(d);
    (d.querySelector('.ru-close') as HTMLButtonElement).onclick = () => showRules(false);
    d.addEventListener('pointerdown', e => { if (e.target === d) showRules(false); e.stopPropagation(); }); // a tap outside closes it
    d.addEventListener('keydown', e => e.stopPropagation());
    rulesPanel = d;
  }
}
const rulesOpen = (): boolean => !!rulesPanel && rulesPanel.style.display === 'flex';
addEventListener('keydown', e => { if (!rulesOpen()) return; if (e.code === 'Escape' || e.code === 'Enter') showRules(false); e.stopImmediatePropagation(); }, true); // the game hears no keys while the rules are open

/** The game's history, newest first: every line of the log, with its round. */
export function showHistory(list: string[]) {
  const rows = [...list].reverse().map(l => { const m = /^V(\d+): (.*)$/.exec(l); return m ? `<li><b>Vòng ${m[1]}</b> · ${esc(m[2])}</li>` : `<li>${esc(l)}</li>`; });
  showPage('Lịch sử ván', rows.length ? `<ul>${rows.join('')}</ul>` : '<p>Chưa có gì.</p>');
}
function esc(t: string): string {
  return t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}
