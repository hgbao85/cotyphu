# Đưa Tỷ Phú Đất Việt lên Internet (Render)

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
