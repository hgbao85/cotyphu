// PROTOTYPE - NOT FOR PRODUCTION
// Question: một ván cờ tỷ phú đất Việt với luật xây khi dẫm lại ô có vui từ đầu tới cuối không?
// Date: 2026-11-16
// Every tuning value lives here, each with value, min, max and step. The game reads them live
// through tune.<name> (index.html); the tweak panel, an add-on, writes them back here.
// Money is in thousands of đồng (k): 15000 = 15.000.000 đ.
window.CONFIG = {
  seed: 1, // every gameplay random call reads rng(), seeded from this (or ?seed= in the address)
  volume: { value: 0.5, min: 0, max: 1, step: 0.05 },

  // ---- Money (k đồng) ----
  start_cash: { value: 2000, min: 500, max: 40000, step: 500 },   // tiền khởi đầu mỗi người
  salary: { value: 2000, min: 0, max: 5000, step: 100 },            // lương khi qua Xuất Phát
  income_tax: { value: 1000, min: 0, max: 5000, step: 100 },        // ô Thuế Thu Nhập: trả cố định
  prop_tax_pct: { value: 0.1, min: 0, max: 0.5, step: 0.01 },       // ô Thuế Tài Sản: phần trăm tổng tài sản...
  prop_tax_flat: { value: 2000, min: 0, max: 10000, step: 100 },    // ...hoặc số tiền cố định này (người chơi chọn)
  jail_fine: { value: 500, min: 0, max: 3000, step: 50 },           // tiền nộp phạt ra tù
  card_max: { value: 1500, min: 0, max: 5000, step: 100 },         // tiền trên một thẻ Cơ Hội / Khí Vận tối đa
  first_lap_count: { value: 1, min: 0, max: 5, step: 1 },          // mỗi người: phải qua Xuất Phát bấy nhiêu lần mới được mua đất và phải đóng thuế
  pot_start: { value: 0, min: 0, max: 5000, step: 100 },           // hũ tiền giữa bàn lúc bắt đầu ván
  pot_share: { value: 1, min: 0, max: 1, step: 0.05 },              // phần thuế/tiền phạt rơi vào hũ (1 = tất cả)

  // ---- Rent: fraction of the land price at each level (nhẹ nhàng) ----
  rent_scale: { value: 1, min: 0.3, max: 3, step: 0.05 },           // nhân toàn bộ tiền thuê
  rent_l0: { value: 0.07, min: 0, max: 0.5, step: 0.01 },           // đất trống
  rent_l1: { value: 0.22, min: 0, max: 1, step: 0.01 },             // Nhà 1
  rent_l2: { value: 0.42, min: 0, max: 2, step: 0.01 },             // Nhà 2
  rent_l3: { value: 0.65, min: 0, max: 3, step: 0.01 },             // Nhà 3
  rent_l4: { value: 0.85, min: 0, max: 3, step: 0.01 },             // Nhà 4
  rent_l5: { value: 1.1, min: 0, max: 4, step: 0.05 },              // Khách sạn
  rent_l6: { value: 1.5, min: 0, max: 5, step: 0.05 },              // Landmark
  full_group_mult: { value: 2, min: 1, max: 4, step: 0.5 },         // gom đủ nhóm màu: thuê × này
  port_rent: { value: 250, min: 0, max: 1000, step: 10 },           // 1 bến cảng/sân bay; gấp đôi mỗi bến thêm
  util_mult_one: { value: 40, min: 0, max: 200, step: 5 },          // 1 công ty: tổng xúc xắc × này
  util_mult_two: { value: 100, min: 0, max: 400, step: 5 },         // 2 công ty: tổng xúc xắc × này

  // ---- Building: cost of each level as a fraction of the land price ----
  house_cost_pct: { value: 0.5, min: 0.1, max: 2, step: 0.05 },     // Nhà 1..4
  hotel_cost_pct: { value: 0.6, min: 0.1, max: 2, step: 0.05 },     // Khách sạn
  landmark_cost_pct: { value: 0.8, min: 0.1, max: 3, step: 0.05 },  // Landmark
  sell_pct: { value: 0.5, min: 0.1, max: 1, step: 0.05 },           // bán 1 cấp: hoàn lại phần này giá xây
  mortgage_pct: { value: 0.5, min: 0.1, max: 1, step: 0.05 },       // cầm cố: nhận phần này giá đất
  unmortgage_pct: { value: 0.55, min: 0.1, max: 1.5, step: 0.05 },  // chuộc: trả phần này giá đất

  // ---- Game length ----
  max_rounds: { value: 30, min: 5, max: 100, step: 1 },             // kiểu ván 30 vòng

  // ---- AI (k đồng and seconds) ----
  ai_delay: { value: 0.7, min: 0.1, max: 3, step: 0.1 },            // máy nghĩ bao lâu mỗi quyết định (s)
  ai_reserve_mid: { value: 1200, min: 0, max: 6000, step: 100 },    // máy Vừa giữ lại ít nhất
  ai_reserve_hard: { value: 800, min: 0, max: 6000, step: 100 },    // máy Khó giữ lại ít nhất
  ai_easy_buy_chance: { value: 0.75, min: 0, max: 1, step: 0.05 },  // máy Dễ mua đất với xác suất này
  ai_mid_mistake: { value: 0.1, min: 0, max: 0.5, step: 0.01 },     // máy Vừa quyết sai với xác suất này

  // ---- Motion (seconds) ----
  dice_time: { value: 1.1, min: 0.3, max: 3, step: 0.05 },          // xúc xắc lăn bao lâu
  shake_full_time: { value: 1.2, min: 0.3, max: 3, step: 0.1 },     // giữ lắc bao lâu thì đầy lực ném (s)
  shake_max_time: { value: 4, min: 1, max: 10, step: 0.5 },         // giữ quá lâu thì tự ném (s)
  hop_time: { value: 0.17, min: 0.05, max: 0.6, step: 0.01 },       // quân cờ nhảy một ô
};
