# Câu hỏi & vướng mắc cần bạn quyết

> Trạng thái: **toàn bộ Q1–Q22 và D1–D5 đã được chốt ngày 2026-11-09** — bảng quyết định ở [mục H](#h-trạng-thái-quyết-định-2026-11-09) và [ADR 0002](../docs/decisions/0002-owner-decisions.md).
> Các bảng A–C giữ nguyên nội dung câu hỏi gốc để tra cứu; đừng hỏi lại. Bốn dữ kiện bên ngoài vẫn `WAITING_INPUT`: production `TM_MONGO_URI`, credential Cloudinary, credential/domain Vercel, snapshot dữ liệu legacy — xem [mục I](#i-waiting_input-dữ-kiện-chưa-được-cung-cấp).
>
> Cập nhật: 2026-11-09. Bối cảnh: P1 (IAM) và P2 (nền nghiệp vụ MongoDB) đã có phần lớn; các slice P2/P3 của CMS và storefront đã chạy trên `main`. Sau khi chốt, phần còn lại của queue không còn phụ thuộc câu hỏi nào ngoài bốn dữ kiện ở mục I.

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

## F. Câu hỏi mới phát sinh sau P2/P3 (2026-11-09)

Đây là những quyết định đang thực sự giữ các slice tiếp theo lại; mỗi câu ghi rõ *nếu bạn không trả lời thì tôi làm gì* và *mở khoá được gì*.

| ID | Câu hỏi | Mặc định nếu không trả lời | Mở khoá |
| --- | --- | --- | --- |
| Q17 | Thanh toán cho WEB-06 dùng cổng nào: chỉ COD/chuyển khoản thủ công, VNPay, MoMo, ZaloPay, hay Stripe? Và đơn hàng lưu ở đâu (Mongo của customer, hay đẩy sang hệ thống khác)? | Chưa làm checkout; chỉ giữ giỏ hàng client-side | WEB-06: bắt buộc tính lại giá ở server, chống đặt trùng, từ chối khi hết hàng — cả ba đều cần biết đơn hàng nằm ở đâu |
| Q18 | Form liên hệ/đăng ký nhận tin (WEB-07) gửi đi đâu: lưu Mongo rồi hiển thị trong CMS, gửi email qua provider (tên provider + địa chỉ nhận), hay bắn webhook sang CRM? | Chưa làm form; chỉ có trang tĩnh | WEB-07: cần đích đến để viết retry/failure handling thay vì làm giả |
| Q19 | Ảnh public của storefront phục vụ từ đâu? CMS hiện lưu file trên đĩa của chính nó, còn Web là deployment riêng, nên cần một origin công khai: Cloudinary (Q13), bucket R2/S3, hay để Web proxy qua CMS? | Chưa đưa media vào projection công khai | MED-01 + logo trong SYS-02 + OG image; cũng là điều kiện để nội dung có ảnh hiển thị thật trên Web |
| Q20 | URL có phân biệt ngôn ngữ không? Hiện storefront dùng cookie (`no_prefix`), nên `/san-pham` và `/products` không cùng một URL và `hreflang` không phát được. Có đổi sang tiền tố `/vi/...`, `/en/...` không? | Giữ `no_prefix`; không phát `hreflang`, canonical theo từng locale đang chọn | WEB-08: hreflang, canonical chuẩn, sitemap đa ngôn ngữ, và redirect khi đổi ngôn ngữ |
| Q21 | Có cần job nền chạy định kỳ (publish theo `publishAt`, prune retention) trên hạ tầng nào: cron của Vercel, worker riêng, hay chấp nhận chạy tay? | Chạy tay như hiện tại (`pnpm prune:retention`), publish theo lịch chưa tự chạy | Q12 + Q16: retention tự động và publish hẹn giờ |
| Q22 | Bản ghi content/config/media legacy trong TM Hub: cho phép export → import một lần rồi Hub chỉ đọc, hay giữ Hub là nguồn trong suốt giai đoạn chuyển tiếp? (cùng Q5, nhưng giờ cần câu trả lời để làm slice import) | Không import; chỉ dữ liệu tạo mới trong Mongo | Q5 + Q2: bật `default`/`thanhtung`/`hoangvi` với dữ liệu thật |

## G. Hiện trạng của các câu cũ (để bạn khỏi trả lời lại cái đã xong)

| ID | Hiện trạng 2026-11-09 |
| --- | --- |
| Q2 | `sentuan` chạy với DB `sen-tuan`; `default`/`thanhtung`/`hoangvi` vẫn chưa có database nên chưa bật được module nghiệp vụ. |
| Q3 | Giữ tên cũ (`sen-tuan`, `bag-post`) theo mặc định; chưa có migration nào đụng tới. |
| Q5 | Chưa import gì từ Hub; xem Q22. |
| Q11 | Theo mặc định: chưa tạo package `@tm/flow-server`, model/service nằm trong `tm-cms/server/`. Muốn chuyển thì nói, hành vi không đổi. |
| Q12 | Đã có purge endpoint dùng chung secret, purge toàn bộ handler cache của storefront khi lưu settings/menu; chưa ký, chưa scoped theo tenant/tag, chưa có job bền vững. Xem Q21. |
| Q13 | Vẫn chờ credential Cloudinary; media đang lưu đĩa local của CMS. Xem Q19. |
| Q14 | Không deploy gì; chỉ build và chạy local. |
| Q16 | `pnpm prune:retention` tồn tại, mặc định dry-run, tạm 50 bản/nội dung và 365 ngày audit — cần con số chính thức. |

## H. Trạng thái quyết định (2026-11-09)

Mỗi câu đã chốt theo **mặc định ghi ở bảng gốc**, và quyết định đó là hành vi mong muốn từ nay. `RESOLVED` = không hỏi lại; `WAITING_INPUT` = đã quyết *không* dựng thứ thay thế, chỉ còn thiếu dữ kiện bên ngoài (mục I).

| ID | Trạng thái | Quyết định đã chốt |
| --- | --- | --- |
| Q1 | **WAITING_INPUT** | Chỉ MongoDB local; production URI chưa cấp nên không cấu hình, không giả định môi trường deploy. |
| Q2 | **WAITING_INPUT** | `default`/`thanhtung`/`hoangvi` chưa có database nên chưa bật module nghiệp vụ; `sentuan` giữ `sen-tuan`. Không tự đặt tên DB. |
| Q3 | RESOLVED | Giữ tên database legacy (`sen-tuan`, `bag-post`), không migration đổi tên. |
| Q4 | **WAITING_INPUT** | Không có snapshot legacy → không có migration dry-run, không viết code migration dựa trên fixture tự tạo. |
| Q5 | RESOLVED (deferred) | Hub tiếp tục là nguồn chuyển tiếp, chỉ đọc; không export/import. Xem Q22. |
| Q6 | RESOLVED | Không sửa `tm-hub`; revoke tức thời nằm ngoài scope, mọi tài liệu phải ghi rõ "chưa thu hồi tức thời". |
| Q7 | RESOLVED | Cookie access/refresh 7 ngày, cookie TOTP 5 phút — khớp code hiện tại. |
| Q8 | RESOLVED | CSRF bằng `Origin` + `SameSite=Lax`, không double-submit token. |
| Q9 | RESOLVED | `TM_AUTH_MODE=mock` bị chặn ở production (`503 AUTH_MODE_FORBIDDEN`); không có kịch bản production cần mock. |
| Q10 | RESOLVED (deferred) | Không làm UI passkey/OAuth trong đợt này; để sau P9. |
| Q11 | RESOLVED | Không tạo `@tm/flow-server`; model/invariant/command ở lại `tm-cms/server/` đúng phạm vi đã duyệt. |
| Q12 | RESOLVED | Không queue bền vững/cron/worker; invalidation vẫn là purge endpoint có secret, publish content dựa vào handler không cache + TTL CDN của sitemap. |
| Q13 | **WAITING_INPUT** | Media đi Cloudinary; chưa có credential nên vẫn dùng adapter local, chưa chọn public origin. |
| Q14 | **WAITING_INPUT** | Không deploy, không chuẩn bị `vercel.json`/CI/domain. Xem mục I. |
| Q15 | RESOLVED | AI Workspace ra khỏi scope v2. |
| Q16 | RESOLVED | Giữ 50 bản snapshot/nội dung và 365 ngày `audit_logs`; lệnh vẫn dry-run trừ khi `--apply`. |
| Q17 | RESOLVED (deferred) | Chưa làm checkout; giỏ hàng client-side, tính lại giá ở server, không lưu đơn. Ba bất biến (reprice, chống trùng, từ chối hết hàng) vẫn là yêu cầu khi mở WEB-06. |
| Q18 | RESOLVED (deferred) | Chưa làm form cho tới khi có đích đến thật; không dựng stub âm thầm bỏ dữ liệu. |
| Q19 | **WAITING_INPUT** | Public media origin chưa chọn (Cloudinary/R2/proxy) → media chưa vào projection công khai, logo chưa resolve. |
| Q20 | RESOLVED | Giữ `no_prefix` (đổi ngôn ngữ bằng cookie), không phát `hreflang`, canonical theo locale đang chọn. |
| Q21 | RESOLVED | Không job nền; `pnpm prune:retention` và publish hẹn giờ vẫn chạy tay. |
| Q22 | RESOLVED (deferred) | Giữ Hub là nguồn chuyển tiếp cho content/config/media legacy; chưa có slice import. |
| Q23 | RESOLVED | Chọn hướng collection mới: CMS ghi `catalog_items`/`catalog_categories`, `pnpm migrate:catalog` migrate dữ liệu legacy (idempotent theo `legacyId`), reader storefront trỏ sang collection mới; legacy `items`/`item_categories` giữ nguyên để rollback. Đã verify 241 item/229 published khớp legacy. |
| D1 | RESOLVED | Chặn `/api/v1/auth/**` ở proxy Hub; path nghiệp vụ giữ nguyên cho tới khi từng domain migrate. |
| D2 | RESOLVED | `appId` lệch → `403 APP_MISMATCH`; thiếu `TM_TENANT_ID` → `503`. |
| D3 | RESOLVED | Tên DB do registry quyết định; `TM_MONGO_DB` lệch → `503 DATABASE_BINDING_MISMATCH`. |
| D4 | RESOLVED | `/api/health` chỉ trả `status/hub/database`. |
| D5 | RESOLVED | Không package dùng chung, không ghi/xoá Hub, không migrate dữ liệu. Phần "không commit" là lịch sử: quyền commit là theo từng yêu cầu, hiện **không** commit/deploy nếu chưa được yêu cầu lại. |

## I. WAITING_INPUT — dữ kiện chưa được cung cấp

| Dữ kiện | Chặn gì | Trong lúc chờ được làm gì |
| --- | --- | --- |
| Production `TM_MONGO_URI` | Mọi việc dữ liệu production, P10 | MongoDB local, database test dùng một lần |
| Credential Cloudinary (hoặc origin media khác) | Media trong projection công khai, logo URL, OG image | Library/upload/attachment với adapter local |
| Vercel token + domain từng customer | Deploy, CI, môi trường từng khách | Build và dev server local |
| Snapshot dữ liệu legacy | Migration dry-run, bật 3 khách còn lại với dữ liệu thật | Chỉ dữ liệu tạo mới |
| — | — | — |
