# The values' notes

What `prototypes/ty-phu-dat-viet/config.js` said beside its values, kept here because `data/config.json`
holds no comments. The values themselves are in `data/config.json`.

- `seed`: every gameplay random call reads rng(), seeded from this (or ?seed= in the address)

---- Money (k đồng) ----
- `start_cash`: tiền khởi đầu mỗi người
- `salary`: lương khi qua Xuất Phát
- `income_tax`: ô Thuế Thu Nhập: trả cố định
- `prop_tax_pct`: ô Thuế Tài Sản: trả phần trăm này của tiền mặt đang có (làm tròn 10)...
- `prop_tax_flat`: ...nhưng không quá số tiền này (mức trần). Từ 17/11/2026, theo yêu cầu của người chơi: không còn chọn giữa % và số cố định, luôn trả % và lấy số này làm mức tối đa
- `card_max`: tiền trên một thẻ Cơ Hội / Khí Vận tối đa
- `first_lap_count`: mỗi người: phải qua Xuất Phát bấy nhiêu lần mới được mua đất và phải đóng thuế
- `pot_start`: hũ tiền giữa bàn lúc bắt đầu ván
- `pot_share`: phần thuế/tiền phạt rơi vào hũ (1 = tất cả)

---- Rent: fraction of the land price at each level (nhẹ nhàng) ----
- `rent_scale`: nhân toàn bộ tiền thuê. Là 3 (bộ R2) từ 17/11/2026, theo lựa chọn của người thiết kế; trước đó là 5 (R6, 16/11) và 1 (gốc). Ở 1 thì lương lớn hơn tiền thuê rất nhiều và ván "Tới khi phá sản" gần như không kết thúc. Số đo: design/balance/self-play-2026-11-16.md
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
- emote_time: seconds a quick emote's bubble stays over the piece online
- emote_gap: seconds a player waits between two emotes, so nobody floods the table
- piece_scale: how big the zodiac animal pieces stand on the board (read when a piece is built)
- mood_gain: money coming in at once (in thousands of đồng) that makes a piece hop for joy
- mood_loss: money paid at once (in thousands of đồng) that makes a piece shiver
- `ai_hard_danger`, `ai_hard_buy_keep`, `ai_hard_build_keep`, `ai_hard_must_spare`, `ai_hard_unmortgage_spare`, `ai_hard_jail_tiles`: cách máy Khó giữ tiền, mua, xây, chuộc đất và giữ Thẻ Ra Tù. Bộ H1, chọn theo số đo: máy Khó thắng máy Dễ 67% ở kiểu phá sản (design/balance/self-play-2026-11-16.md)
- `max_rounds_long`: vòng cuối của kiểu ván dài (50). `max_rounds` (30) là kiểu ván ngắn. Thêm 18/11/2026 theo yêu cầu: "Tới khi phá sản" quá dài, 20 vòng lại quá nhanh.
- `event_every`: cứ mỗi bao nhiêu vòng thì rút một sự kiện cho cả bàn (0 = tắt). `event_rounds`: sự kiện kéo dài mấy vòng. `event_banner_time`: số giây hiện bảng thông báo lớn khi sự kiện bắt đầu. Danh sách sự kiện: EVENTS trong src/game/data.ts. Thêm 18/11/2026.
- `ai_keep_rent_min`, `ai_keep_rent_share`: máy dùng Thẻ Miễn Thuê hay Thẻ Đổ Lại khi tiền thuê từ ai_keep_rent_min trở lên, hoặc từ ai_keep_rent_share tiền mặt (lấy mức thấp hơn), hoặc lớn hơn tiền đang có. Thêm 18/11/2026.
- `chat_max_len` (100), `chat_gap` (3 giây giữa hai tin của một người), `chat_time` (giây bong bóng tin nhắn còn trên quân): chat khi chơi online. Không lọc từ, theo lựa chọn của người chơi. Thêm 18/11/2026.

---- Cá Ngựa (thêm 19/11/2026) ----
- `ludo_horses`: số ngựa mỗi người (4). Về chuồng đủ bấy nhiêu con thì thắng.
- `ludo_exit_on_one`: 0 = chỉ đổ 6 mới ra quân; 1 = đổ 1 hoặc 6 đều ra được.
- `ludo_bonus_six`: 1 = đổ 6 được đổ thêm một lần.
- `ludo_bonus_kick`: 1 = đá được ngựa người khác thì được đổ thêm.
- `ludo_no_jump`: 1 = không được nhảy qua đầu ngựa khác (luật Việt Nam); 0 = nhảy qua thoải mái.
- `ludo_home_strict`: 1 = lên chuồng kiểu truyền thống: đứng ở cửa chuồng đổ k thì lên bậc k, lên bậc tiếp theo phải đổ đúng số bậc đó; 0 = đi thẳng vào chuồng theo số đổ, không được đi lố.
- `ludo_hop_time`: giây mỗi bước nhảy của ngựa. `ludo_ai_delay`: máy nghĩ bao lâu trước khi lắc / chọn ngựa. `ludo_no_move_time`: giây hiện "Không đi được" trước khi qua lượt.
