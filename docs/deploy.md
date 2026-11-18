# Đưa Sự Thảy lên Internet (Render, và Vercel cho trang game)

Game và máy chủ phòng chơi chạy chung một dịch vụ web trên Render. Cấu hình nằm sẵn trong
`render.yaml` ở gốc repo: Render tự cài, build (`npm ci && npm run build`) và chạy
(`npm start` → `server/server.mjs`).

## Lần đầu (khoảng 5 phút)

1. Vào <https://render.com>, bấm **Get Started**, đăng nhập bằng **GitHub**.
2. Cho Render quyền đọc repo `cotyphu` (có thể chọn "Only select repositories" rồi chọn đúng repo này).
3. Trong Render Dashboard: **New +** → **Blueprint**.
4. Chọn repo `cotyphu`. Render đọc `render.yaml` và hiện dịch vụ `ty-phu-dat-viet` (gói **Free**, vùng **Singapore**).
5. Bấm **Apply** (hoặc **Deploy Blueprint**). Chờ build khoảng 2–4 phút, tới khi trạng thái là **Live**.
6. Địa chỉ game có dạng `https://ty-phu-dat-viet.onrender.com` (Render có thể thêm vài ký tự nếu tên đã có người dùng). Gửi địa chỉ này cho bạn bè.

## Cách chơi online

- Một người mở game → **Chơi online** → nhập tên → **Tạo phòng mới** → đọc **mã phòng** cho bạn bè.
- Bạn bè mở cùng địa chỉ → **Chơi online** → nhập tên và mã phòng → **Vào phòng**.
- Chủ phòng bấm **Bắt đầu**. Chủ phòng nên giữ trang game mở trong suốt ván: luật chơi chạy trên máy chủ phòng.

## Cần biết

- **Gói Free ngủ sau 15 phút không ai dùng.** Lần mở đầu tiên sau đó chờ 30–60 giây để nó thức dậy; khi đang chơi thì không ngủ.
- **Mỗi lần push lên `main`, Render tự build và cập nhật** (khoảng 2–4 phút). Ván đang chơi lúc đó sẽ bị ngắt.
- Chủ phòng **tải lại trang** thì ván đang chơi mất. Rớt mạng rồi nối lại thì không sao.
- Kiểm tra máy chủ còn sống: mở `https://<địa chỉ của bạn>/health`, thấy chữ `ok` là được.

## Chạy thử trên máy (không cần Render)

```bash
npm run build
npm start
```

Mở <http://localhost:8787>. Máy khác cùng Wi-Fi mở `http://<IPv4 của máy này>:8787`.

## Trang game trên Vercel, phòng online vẫn ở Render

Vercel không giữ được kết nối WebSocket nên không chạy được máy chủ phòng. Cách dùng hai nơi:

| Phần | Ở đâu | Vì sao |
| --- | --- | --- |
| Trang game (`dist/`) | Vercel | Không bao giờ ngủ: mở ngay, có màn chờ riêng của game |
| Máy chủ phòng (`server/server.mjs`, `/ws`) | Render (`render.yaml`) | Giữ kết nối WebSocket |

- Bản build trên Vercel (`VERCEL=1`) tự trỏ phòng online về Render (`vite.config.ts`, `ROOM_SERVER`). Muốn trỏ chỗ khác thì đặt biến môi trường `ROOM_SERVER` trên Vercel. Build ở nơi khác (kể cả Render) vẫn dùng chính địa chỉ trang như trước.
- Khi trang mở, game gọi `/health` của Render để đánh thức máy chủ phòng. Bấm "Chơi online" lúc máy chủ chưa dậy thì game hiện số đếm 30 giây thay cho trang chờ của Render.

### Lần đầu trên Vercel (khoảng 5 phút)

1. Vào <https://vercel.com>, đăng nhập bằng **GitHub** (tài khoản sở hữu repo này).
2. **Add New…** → **Project** → chọn repo `cotyphu` → **Import**. Vercel đọc `vercel.json` (build `npm run build`, thư mục `dist`); để nguyên các mục khác.
3. Bấm **Deploy**. Từ đó mỗi lần push lên `main`, Vercel tự build lại.
4. Lấy địa chỉ Vercel đưa (ví dụ `su-thay.vercel.app`) và sửa trong `index.html` hai thẻ `og:url` và `og:image`, để ảnh xem trước khi chia sẻ link lấy từ trang không ngủ.
5. Gửi địa chỉ Vercel cho bạn bè thay cho địa chỉ Render.

