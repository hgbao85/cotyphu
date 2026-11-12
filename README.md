# Cờ Tỷ Phú

Game cờ tỷ phú online nhiều người chơi, bàn cờ là các tỉnh thành Việt Nam.

## Chạy trên máy

```bash
npm install
npm run dev
```

Mở http://localhost:5173. Server game chạy ở cổng 3001, Vite tự chuyển tiếp `/socket.io` sang đó.
Muốn thử nhiều người trên cùng máy: mở thêm tab, dán link mời (`?room=MÃ`).

## Cấu trúc

| Thư mục | Nội dung |
| --- | --- |
| `packages/shared` | Luật chơi (`engine.ts`), bàn cờ (`board.ts`), thẻ Cơ hội/Khí vận (`cards.ts`), bot (`bot.ts`). Không phụ thuộc mạng, test bằng Vitest. |
| `packages/server` | Express + Socket.io. Giữ trạng thái ván, kiểm tra mọi hành động bằng engine, chạy bot, đếm giờ 30s mỗi bước, cho vào lại khi rớt mạng. |
| `packages/client` | React + Vite. Trang chủ, phòng chờ, bàn cờ, chat. |

Server là nơi duy nhất thay đổi trạng thái ván; client chỉ gửi hành động (`ROLL`, `BUY`, `BUILD`…) và hiển thị trạng thái server gửi về.

## Lệnh khác

```bash
npm test          # test luật chơi + mô phỏng 100 ván bot
npm run typecheck
npm run build     # build client vào packages/client/dist
npm start         # server phục vụ luôn client đã build (dùng PORT nếu có)
```

## Luật hiện có

Gieo 2 xúc xắc, qua Xuất phát nhận 200, mua đất/sân bay/công ty, tiền thuê (gấp đôi khi đủ nhóm màu, tăng theo nhà),
xây nhà đều trong nhóm tới khách sạn, thẻ Cơ hội/Khí vận, thuế, tù (gieo đôi / nộp 50 / thẻ ra tù), 3 lần đôi vào tù,
bán nhà tự động khi thiếu tiền, phá sản chuyển đất cho chủ nợ. Ván kết thúc khi còn 1 người hoặc hết 30 vòng (so tổng tài sản).
