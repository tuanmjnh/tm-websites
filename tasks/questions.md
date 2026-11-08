# Câu hỏi & vướng mắc cần bạn quyết

> Trả lời ngắn theo mã: `Q1: a`, `Q2: 1) ...` là đủ. Câu nào không trả lời, tôi sẽ tiếp tục theo **mặc định** ghi ở cột cuối và ghi rõ trong queue.
>
> Cập nhật: 2026-11-06. Bối cảnh: đang ở P1 (IAM) → P2 (nền nghiệp vụ MongoDB) của [roadmap](../docs/v2/07-delivery-roadmap.md).

## A. Chặn tiến độ ngay (cần trả lời trước P3)

| ID | Câu hỏi | Mặc định nếu không trả lời | Ảnh hưởng |
| --- | --- | --- | --- |
| Q1 | MongoDB thật dùng ở đâu? Hiện máy local có MongoDB 8.2.3 ở `127.0.0.1:27017` nhưng chưa có URI/database cho production. Bạn cung cấp `TM_MONGO_URI` cho dev và production ở đâu (file nào / Vercel env)? | Chỉ test local, production để trống → `/api/health` báo `database: unconfigured` | P3 trở đi |
| Q2 | `default`, `thanhtung`, `hoangvi` chưa có database trong registry. Đặt tên gì (`tm_default`, `tm_thanh_tung`, `tm_hoang_vi`)? | Để trống, các khách này chưa bật module nghiệp vụ | P3 |
| Q3 | `sentuan` = `sen-tuan`, `bagpost` = `bag-post`. Giữ tên cũ (tương thích dữ liệu legacy) hay đổi sang `tm_<customer>`? | Giữ nguyên (an toàn cho migration) | P3/P10 |
| Q4 | Có dữ liệu legacy MongoDB thật để chạy migration dry-run không (snapshot/fixture), và có được phép đọc không? | Không migrate; chỉ tạo dữ liệu mới | P10 |
| Q5 | Bản ghi content/config/media hiện đang nằm trong TM Hub. Có được phép export rồi import sang MongoDB không, hay phải giữ Hub là nguồn trong giai đoạn chuyển tiếp? | Giữ Hub (transitional), chỉ đọc; không ghi/xoá | P3 |

## B. IAM / bảo mật (đang chặn "Verified" của P1)

| ID | Câu hỏi | Mặc định nếu không trả lời | Ảnh hưởng |
| --- | --- | --- | --- |
| Q6 | Hiện chưa có cách xác nhận session còn hiệu lực (revoke) từ Hub; doc gọi đây là blocker cross-repo. Bạn cho phép sửa `tm-hub` để thêm contract đó, hay chấp nhận access token TTL ngắn + không thu hồi tức thời? | Không sửa Hub; giữ nguyên và ghi rõ "chưa thu hồi tức thời" | P1 |
| Q7 | TTL mong muốn: access token / refresh token / cookie (hiện cookie 7 ngày cho cả hai)? | Giữ 7 ngày | P1 |
| Q8 | CSRF: chấp nhận kiểm tra `Origin` + `SameSite=Lax` (đã làm), hay bắt buộc double-submit token? | Giữ Origin + SameSite | P1/P3 |
| Q9 | `TM_AUTH_MODE=mock` chỉ dùng khi dev — tôi đã chặn ở production (fail 503). Xác nhận không có kịch bản nào cần mock ở production? | Chặn như hiện tại | P1 |
| Q10 | Passkey/OAuth: bản gốc chỉ có mật khẩu; Hub có passkey. Có làm UI passkey ở CMS trong đợt này không? | Không, để sau P9 | P1/P9 |

## C. Kiến trúc & hạ tầng

| ID | Câu hỏi | Mặc định nếu không trả lời | Ảnh hưởng |
| --- | --- | --- | --- |
| Q11 | Có được tạo package server-only dùng chung `@tm/flow-server` (Mongoose schema factory + invariants + commands) không? Hiện `mongoose` mới chỉ là dependency của host. **Đã làm P2.b trong `tm-cms/server/models/` theo mặc định này** — nếu bạn duyệt tạo package, tôi sẽ chuyển nguyên khối sang, không đổi hành vi. | Chưa tạo; logic đặt trong `tm-cms/server` cho tới khi bạn duyệt | P2/P3 |
| Q12 | Cache invalidation bền vững (publish → Web) chạy bằng gì: cron Vercel, Redis/BullMQ, hay job trong Mongo? Máy local chưa có Redis nên mail/import queue của Hub đang tắt. | Tạm dùng purge endpoint hiện có; chưa thêm hạ tầng | P3/WEB-09 |
| Q13 | Media đi tiếp bằng Cloudinary (Hub đang thiếu credential) hay chuyển sang R2/S3? | Giữ Cloudinary, chờ credential | MED-01 |
| Q14 | Deploy: ai cấp Vercel token + domain cho từng customer? Có cần tôi chuẩn bị `vercel.json`/CI trước không? | Không deploy; chỉ build local | P10 |
| Q15 | AI Workspace: bỏ hẳn khỏi scope (v2 đang coi là optional, không thay thế parity) hay vẫn làm sau P5? | Bỏ khỏi scope hiện tại | — |
| Q16 | Retention: giữ bao nhiêu bản snapshot/nội dung và bao lâu `audit_logs`? Đã có lệnh `pnpm prune:retention` (dry-run mặc định, `--apply` mới xoá) với mặc định tạm 50 bản/nội dung và 365 ngày audit — cần con số chính thức. | Chưa chốt; mặc định tạm, không chạy tự động | P2.c |

## D. Việc tôi đã tự quyết trong lượt này (bạn chỉ cần bác nếu sai)

1. **Proxy Hub**: chặn toàn bộ `/api/v1/auth/**` (403) để token không thể lọt ra browser; các path nghiệp vụ tạm giữ nguyên cho tới khi từng domain migrate.
2. **App binding**: session trả về `appId` khác cấu hình → 403 `APP_MISMATCH`; thiếu `TM_TENANT_ID` → 503, không tự bịa tenant.
3. **DB binding**: tên database do registry quyết định; `TM_MONGO_DB` chỉ được lặp lại đúng tên đó, lệch → 503 `DATABASE_BINDING_MISMATCH`.
4. **Health endpoint** `GET /api/health`: chỉ trả `status/hub/database`, không lộ URI/tenant/credential.
5. **Chưa** tạo package `@tm/flow-server`, **chưa** ghi/xoá dữ liệu Hub, **chưa** migrate dữ liệu, **chưa** commit.

## E. Điều kiện môi trường đã quan sát

- `tm-hub` local `:4000` chạy được, `db: ok`; Redis không chạy → mail/import queue của Hub offline (không chặn).
- MongoDB 8.2.3 local `:27017` chạy được; test hai database cách ly đã PASS thật.
- CMS dev `:4005` đang chạy với `TM_HUB_URL=http://localhost:4000`, `TM_MONGO_URI=mongodb://127.0.0.1:27017`, `TM_MONGO_DB=sen-tuan` → `/api/health` = `ok/configured/ok`.
- Customer `default` chưa có `dataSources.mongo` → health sẽ là `database: unconfigured` cho tới khi Q2 được trả lời.
