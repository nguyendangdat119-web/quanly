# Quản lý · Dark Feminine & Hmind

Trang quản lý doanh thu, đơn hàng, thành viên và học viên của 2 web, chạy trên
GitHub Pages (không cần tên miền).

```
GitHub Pages (trang này)  ──POST tên + key──▶  Google Apps Script (Web App)
                                                  │  đọc
                                                  ▼
                                           Google Sheet (5 trang tính)
                                                  ▲  mỗi 15 phút
hmindenglish.com/api/public/export  ──────────────┘  (Bearer EXPORT_KEY)
  = server quanly (hmind/admin/api): đọc DB Dark Feminine (chỉ đọc) + DB Hmind
```

- Repo này **công khai** và **không chứa bí mật**: không có key, không có dữ liệu.
  Dữ liệu chỉ nằm trong Google Sheet của bạn; Apps Script chỉ trả dữ liệu khi
  đúng tên đăng nhập + key (sai 10 lần → khoá 15 phút).
- Key đăng nhập chỉ lưu dạng SHA-256 trong Apps Script.
- Trên trình duyệt, tên + key chỉ giữ trong tab đang mở (sessionStorage),
  đóng tab là phải đăng nhập lại.

## Cài Google Sheet + Apps Script (làm 1 lần, ~5 phút)

1. Mở <https://sheets.new> (tạo Google Sheet mới), đặt tên ví dụ `Quản lý DF + Hmind`.
2. Menu **Tiện ích mở rộng → Apps Script**.
3. Xoá hết code mẫu trong `Code.gs`, dán toàn bộ file **`Code.gs` bản đã điền sẵn
   key** (được gửi riêng, không có trong repo này). Bấm 💾 Lưu.
4. Ở thanh trên chọn hàm **`setup`** → bấm **Chạy** → **Xem xét quyền** → chọn
   tài khoản Google → **Nâng cao → Đi tới … (không an toàn)** → **Cho phép**.
   (Cảnh báo này hiện vì script do chính bạn viết, chưa qua Google duyệt.)
   Chạy xong, quay lại Sheet sẽ thấy các trang `DF - Đơn hàng`, `Hmind - …`, `Đồng bộ`.
5. **Triển khai → Tùy chọn triển khai mới** → bánh răng ⚙ chọn **Ứng dụng web**:
   - Thực thi dưới dạng: **Tôi**
   - Người có quyền truy cập: **Bất kỳ ai**
   → **Triển khai** → copy **URL ứng dụng web** (dạng `https://script.google.com/macros/s/…/exec`).
6. Mở trang quản lý, đăng nhập lần đầu sẽ hỏi URL này — dán vào (trình duyệt nhớ lại).
   Hoặc dán vào `config.js` (`window.QL_API_URL`) để máy nào cũng dùng được.

Sửa code Apps Script sau này: **Triển khai → Quản lý các bản triển khai → ✏ →
Phiên bản: Bản mới → Triển khai** (giữ nguyên URL).

## Đổi key đăng nhập

Tính SHA-256 của key mới (ví dụ `node -e "console.log(require('crypto').createHash('sha256').update('KEY_MOI').digest('hex'))"`),
thay `LOGIN_KEY_SHA256` trong Apps Script, rồi triển khai bản mới như trên.

## Đổi EXPORT_KEY (key giữa Sheet và server)

`gh secret set QL_EXPORT_KEY` trong repo `hmind`, chạy lại workflow
**Deploy quanly**, rồi sửa `FEED_KEY` trong Apps Script cho khớp.
