# YÊU CẦU ĐIỀU CHỈNH KIẾN TRÚC CUSTOMER LAYERS & VERCEL BUILD

## 1. Mục tiêu

Điều chỉnh cấu trúc hiện tại để hỗ trợ nhiều khách hàng sử dụng chung một Git repository, nhưng mỗi khách hàng có CMS SPA và Website SSR được build/deploy độc lập trên Vercel.

Không tạo source code riêng cho từng khách hàng.

Không chỉnh sửa thủ công `extends` trong `tm-cms/nuxt.config.ts` hoặc `tm-web/nuxt.config.ts` khi chuyển đổi khách hàng.

Customer Layer phải được chọn tự động dựa trên `TM_CUSTOMER_ID` ở build-time.

## 2. Rà soát kiến trúc hiện tại

Trước khi sửa code:

- Kiểm tra toàn bộ workspace.
- Xác định vị trí CMS, Web, Shared Packages và Customer Layers.
- Kiểm tra `nuxt.config.ts` của hai ứng dụng.
- Kiểm tra thứ tự ưu tiên Nuxt Layers.
- Kiểm tra những file Host Application đang ghi đè layer.
- Kiểm tra PNPM workspace và các đường dẫn tương đối.
- Kiểm tra khả năng truy cập thư mục `tm-shared` khi Vercel sử dụng Root Directory riêng.

Không được giả định cấu trúc hiện tại giống tài liệu nếu chưa kiểm tra thực tế.

## 3. Xây dựng Customer Layer Registry

Tạo registry tập trung cho Customer Layers.

Ví dụ:

- `sentuan` → CMS: `sentuan-cms`, Web: `sentuan-web`.
- `bagpost` → CMS: `bag-post-cms`, Web: `bag-post-web`.

Registry phải kiểm tra bằng schema, có kiểu dữ liệu rõ ràng và không cho phép truyền đường dẫn tùy ý.

## 4. Dynamic Layer Resolver

Cập nhật `tm-cms/nuxt.config.ts` và `tm-web/nuxt.config.ts`.

Hai ứng dụng phải:

- Đọc `TM_CUSTOMER_ID`.
- Resolve đúng Customer Layer.
- Giữ nguyên CMS là SPA.
- Giữ nguyên Web là SSR.
- Không cần sửa cấu hình source mỗi lần đổi khách hàng.
- Dừng build khi không tìm thấy customer hoặc layer.
- Resolve đường dẫn layer bằng absolute path đáng tin cậy.

Thứ tự extends phải bảo đảm Customer Layer có quyền override Base Layer. Lưu ý phần tử đầu tiên trong `extends` có độ ưu tiên cao hơn phần tử tiếp theo; file thuộc Host Project luôn có ưu tiên cao nhất.

Không đặt branding mặc định ở Host Application nếu muốn Customer Layer ghi đè.

## 5. Chuẩn hóa Base Layers

CMS:

- Core Base.
- Config Base.
- API Base.
- CMS Base.

Website:

- Core Base.
- Config Base.
- API Base.
- Web Base.

Mỗi ứng dụng chỉ sử dụng đúng hệ Base Layer tương ứng.

Customer CMS Layer không được kế thừa Web Base.

Customer Web Layer không được kế thừa CMS Base.

## 6. Chuẩn hóa Customer Build Engine

Tạo build validation script dùng chung.

Yêu cầu:

- Validate `TM_CUSTOMER_ID`.
- Validate app type.
- Validate Customer Layer.
- Validate branding assets.
- Validate PWA configuration của CMS.
- Validate SEO/site configuration của Web.
- Validate environment variables.
- Không log secrets.
- Không tự fallback về khách hàng khác nếu ID không hợp lệ.

Các lệnh build:

- CMS: `pnpm run build:vercel`.
- Web: `pnpm run build:vercel`.

Customer ID được lấy từ environment variables của từng Vercel Project.

## 7. Vercel Deployment Strategy

Tất cả Vercel Projects kết nối cùng Git repository chính.

Mỗi deployment target có một Vercel Project riêng:

- `tm-cms-sentuan`
- `tm-web-sentuan`
- `tm-cms-bagpost`
- `tm-web-bagpost`

Cấu hình mỗi Project:

- Root Directory đúng ứng dụng.
- Cho phép Include source files outside Root Directory.
- PNPM Workspace.
- Nuxt Framework Preset.
- Build Command tương ứng ứng dụng.
- Environment Variables riêng cho từng khách hàng.
- Domain riêng.
- Production/Preview/Development environment riêng.

Không tạo thêm repository riêng cho từng khách hàng.

## 8. Branding và Assets

Mỗi khách hàng có bộ branding riêng:

- Logo.
- Favicon.
- PWA icons.
- Loading screen.
- Theme tokens.
- Application metadata.
- SEO metadata.
- Navigation.
- Feature configuration.

Không copy asset khách hàng vào Host Application.

Không dùng CSS riêng lẻ cho từng module.

## 9. Bảo mật

- Không đưa database URI vào public runtime config.
- Không đưa secrets vào Customer Layer.
- Không đưa TM Hub secret vào frontend.
- `TM_CUSTOMER_ID` chỉ là build identity, không phải authorization credential.
- Backend vẫn phải xác thực tenant và app context.
- Website SSR chỉ sử dụng quyền đọc dữ liệu phù hợp.
- Không cho phép người dùng tùy ý thay đổi Customer ID để truy cập database khác.

## 10. Kiểm thử bắt buộc

Thực hiện tối thiểu:

1. Build CMS Sen Tuấn.
2. Build CMS Bag Post.
3. Build Web Sen Tuấn.
4. Build Web Bag Post.
5. Kiểm tra file `app.config.ts` của đúng khách hàng.
6. Kiểm tra favicon và PWA assets.
7. Kiểm tra SPA/SSR mode.
8. Kiểm tra Customer Layer override Base Layer.
9. Kiểm tra host application không che mất customer overrides.
10. Kiểm tra không có branding của khách hàng khác trong build output.
11. Kiểm tra 2 builds không bị ghi đè file hoặc cache của nhau.
12. Typecheck, lint và production build.

## 11. Yêu cầu báo cáo

Báo cáo:

- Cấu trúc hiện tại trước và sau chỉnh sửa.
- Các file đã tạo/sửa.
- Thứ tự kế thừa layers.
- Cách lựa chọn customer.
- Cách cấu hình từng Vercel Project.
- Kết quả kiểm thử từng customer/app combination.
- Các vấn đề chưa giải quyết.

Không tự ý viết lại toàn bộ ứng dụng. Ưu tiên sửa kiến trúc hiện tại theo hướng ít thay đổi, ổn định và có thể mở rộng.