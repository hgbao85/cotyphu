# Máy Dễ của Cờ Tỷ Phú, 19/11/2026

Người chơi phản ánh: chơi thấy xui, đấu máy Dễ thua 3 ván liền. Mỗi file là một trận máy tự đánh, 2 người, 200 ván,
chạy bằng `node tools/balance/self-play.mjs <tên> 200 <ghế> <kiểu> <file> 150 '<giá trị thử>'`.

| File | Ghế | Kiểu ván | Giá trị thử | Máy Dễ thắng |
| --- | --- | --- | --- | --- |
| E1-vua-de-30 | Vừa, Dễ | 30 vòng | (cũ: mua 0,75, xây 0,7) | 52% |
| E2-vua-de-ps | Vừa, Dễ | tới khi phá sản | (cũ) | 46% |
| E3-kho-de-30 | Khó, Dễ | 30 vòng | (cũ) | 53% |
| E4-kho-de-ps | Khó, Dễ | tới khi phá sản | (cũ) | 35% |
| X1 / X2 / X3 | Vừa, Dễ | 30 vòng | mua 0,4 / 0,2 / 0 | 47% / 42% / 33% |
| X4 | Vừa, Dễ | tới khi phá sản | mua 0,4 | 38% |
| Y1 / Y2 | Vừa, Dễ | 30 vòng / phá sản | mua 0,3, xây 0,2 | 44% / 7% |
| Y3 / Y4 | Khó, Dễ | 30 vòng / phá sản | mua 0,3, xây 0,2 | 44% / 4% |
| Z1 / Z2 | Vừa, Dễ | 30 vòng / phá sản | **mua 0,5, xây 0,4 (chọn)** | 47% / 32% |
| Z3 | Khó, Dễ | phá sản | mua 0,5, xây 0,4 | 18% |
| Z4 | Vừa, Dễ | phá sản | mua 0,6, xây 0,5 | 45% |

Ván "tới khi phá sản" dừng đếm ở vòng 150 (khoảng 85% số ván xong trước đó). Sai số khoảng ±7 điểm %.

Xúc xắc đã kiểm: 3 triệu lần đổ bằng `src/game/rng.ts`, mỗi mặt 16,66–16,69%, đôi 16,67%, khi bình phương 4,73
(ngưỡng 5% là 11,07). Người và máy đổ bằng cùng một hàm, lực lắc chỉ đổi hình lăn, không đổi số.
