# The values' notes

What `prototypes/ty-phu-dat-viet/config.js` said beside its values, kept here because `data/config.json`
holds no comments. The values themselves are in `data/config.json`.

- `seed`: every gameplay random call reads rng(), seeded from this (or ?seed= in the address)

---- Money (k đồng) ----
- `start_cash`: tiền khởi đầu mỗi người
- `salary`: lương khi qua Xuất Phát
- `income_tax`: ô Thuế Thu Nhập: trả cố định
- `prop_tax_pct`: ô Thuế Tài Sản: phần trăm tiền mặt đang có...
- `prop_tax_flat`: ...hoặc số tiền cố định này (người chơi chọn)
- `card_max`: tiền trên một thẻ Cơ Hội / Khí Vận tối đa
- `first_lap_count`: mỗi người: phải qua Xuất Phát bấy nhiêu lần mới được mua đất và phải đóng thuế
- `pot_start`: hũ tiền giữa bàn lúc bắt đầu ván
- `pot_share`: phần thuế/tiền phạt rơi vào hũ (1 = tất cả)

---- Rent: fraction of the land price at each level (nhẹ nhàng) ----
- `rent_scale`: nhân toàn bộ tiền thuê
- `rent_l0`: đất trống
- `rent_l1`: Nhà 1
- `rent_l2`: Nhà 2
- `rent_l3`: Nhà 3
- `rent_l4`: Nhà 4
- `rent_l5`: Khách sạn
- `rent_l6`: Landmark
- `full_group_mult`: gom đủ nhóm màu: thuê × này
- `port_rent`: 1 bến cảng/sân bay; gấp đôi mỗi bến thêm
- `util_mult_one`: 1 công ty: tổng xúc xắc × này
- `util_mult_two`: 2 công ty: tổng xúc xắc × này

---- Building: cost of each level as a fraction of the land price ----
- `house_cost_pct`: Nhà 1..4
- `hotel_cost_pct`: Khách sạn
- `landmark_cost_pct`: Landmark
- `sell_pct`: bán 1 cấp: hoàn lại phần này giá xây
- `mortgage_pct`: cầm cố: nhận phần này giá đất
- `unmortgage_pct`: chuộc: trả phần này giá đất

---- Game length ----
- `max_rounds`: kiểu ván 30 vòng

---- AI (k đồng and seconds) ----
- `ai_delay`: máy nghĩ bao lâu mỗi quyết định (s)
- `ai_reserve_mid`: máy Vừa giữ lại ít nhất
- `ai_reserve_hard`: máy Khó giữ lại ít nhất
- `ai_easy_buy_chance`: máy Dễ mua đất với xác suất này
- `ai_mid_mistake`: máy Vừa quyết sai với xác suất này

---- Motion (seconds) ----
- `dice_time`: xúc xắc lăn bao lâu
- `shake_full_time`: giữ lắc bao lâu thì đầy lực ném (s)
- `shake_max_time`: giữ quá lâu thì tự ném (s)
- `hop_time`: quân cờ nhảy một ô
- vote_time: online, how long a vote for a new game stays open (seconds)
- order_roll: 1 = each game opens with everyone throwing the dice; the lowest total goes first (0 = seat order)
- order_show_time: how long a throw for the order stays on screen before the next player throws (seconds)
