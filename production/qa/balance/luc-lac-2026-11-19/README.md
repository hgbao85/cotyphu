# Lực lắc quyết định xúc xắc, 19/11/2026

Yêu cầu: lắc mạnh thì xúc xắc ra số lớn, lắc nhẹ ra số nhỏ (trước đó lực chỉ đổi hình lăn). Chọn mức "vừa phải":
`dice_power_tilt` = 0,183, nên lắc hết lực thì mặt 6 ra 25,1% và mặt 1 ra 10,0%; lắc nhẹ thì ngược lại; lắc ở giữa thì
công bằng như cũ (`src/game/dice.ts`). Máy Dễ và Vừa lắc lực ngẫu nhiên như trước; máy Khó canh lực như người.

Máy Khó đấu máy Vừa, 2 người, 200 ván mỗi trận (Cờ Tỷ Phú):

| File | Kiểu ván | Lực | Máy Khó thắng |
| --- | --- | --- | --- |
| K1 | tới khi phá sản | có (0,183), Khó canh lực | 72% |
| K2 | tới khi phá sản | không (0) | 61% |
| K3 | 30 vòng | có (0,183), Khó canh lực | 63% |
| K4 | 30 vòng | không (0) | 57% |

Canh lực đáng giá khoảng 6 đến 11 điểm % tỉ lệ thắng: người chơi biết canh lực được lợi chừng đó trước máy Dễ và Vừa.

## Thêm thanh lực chạy lên xuống và vùng đẹp

Sau đó, theo yêu cầu thứ hai: thanh lực chạy lên xuống khi giữ, mỗi lần lắc có một vùng đẹp 10–15% nằm trong
20–80% thanh; thả trúng vùng thì 50% số lần game tung thêm một lần và giữ lần có lợi hơn (`dice_zone_luck`).
Máy trúng vùng theo cấp: Dễ 10%, Vừa 30%, Khó 70% lúc đo M1–M4, sau hạ còn 50% (`ai_zone_hit_*`). Máy Khó vẫn canh lực như trên.

| File | Ghế | Kiểu ván | Thử | Kết quả |
| --- | --- | --- | --- | --- |
| M1 | Vừa, Dễ | tới khi phá sản | | Vừa 70%, Dễ 30% |
| M2 | Khó, Dễ | tới khi phá sản | | Khó 97%, Dễ 3% |
| M3 | Khó, Vừa | 30 vòng | | Khó 60%, Vừa 40% |
| M4 | Khó, Vừa | tới khi phá sản | | Khó 83%, Vừa 17% |
| N1 | Khó, Vừa | tới khi phá sản | Khó trúng vùng 50% | Khó 85%, Vừa 15% |
| N2 | Khó, Dễ | tới khi phá sản | Khó trúng vùng 50% | Khó 93%, Dễ 7% |
| N3 | Khó, Vừa | 30 vòng | Khó trúng vùng 50% | Khó 60%, Vừa 40% |

Tỉ lệ trúng vùng của máy Khó gần như không đổi kết quả: sức mạnh của Khó đến từ việc canh lực (nó tính chính xác
ô sẽ dừng), không từ vùng đẹp. Theo yêu cầu, hạ xuống 0,5 (số liệu N1–N3).

## Máy Khó canh lực kém chính xác (`ai_hard_aim_miss`, `ai_hard_aim_spread`)

Khó đấu Vừa, tới khi phá sản, 200 ván:

| File | Thử | Khó thắng |
| --- | --- | --- |
| P1 | không canh 30%, lệch ±30% thanh (chọn) | 75% |
| P2 | không canh 50%, lệch ±30% | 73% |
| P3 | không canh 50%, lệch ±50% | 73% |
| P4 | không bao giờ canh | 76% |
| Q1 | như P1, Khó trúng vùng 35% | 71% |
| Q2 | như P1, Khó trúng vùng 20% | 59% |
| Q3 | không có vùng đẹp (dice_zone_luck 0) | 64% |
| Q4 | không có lực lắc lẫn vùng đẹp | 64% |

Canh lực chỉ thêm vài điểm; phần lớn lợi thế còn lại của Khó là trúng vùng nhiều hơn Vừa (50% so với 30%).
Theo yêu cầu, hạ máy Khó về trúng vùng 30% (bằng Vừa); kết quả đo lại ở R1–R2 bên dưới.

## Mức chốt: Khó trúng vùng 30%, canh lệch (0,3 / 0,3)

Tới khi phá sản, 200 ván:

| File | Ghế | Kết quả |
| --- | --- | --- |
| R1 | Khó, Vừa | Khó 68%, Vừa 32% |
| R2 | Khó, Dễ | Khó 89%, Dễ 11% |
| R3 | Vừa, Dễ | Vừa 70%, Dễ 30% |
