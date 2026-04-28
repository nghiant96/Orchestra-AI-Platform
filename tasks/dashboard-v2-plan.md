# Kế hoạch Nâng cấp Dashboard V2

## Bối cảnh & Mục tiêu
Dashboard hiện tại cung cấp một cái nhìn cơ bản về tiến trình thực thi của AI. Mục tiêu là phát triển nó thành một trung tâm điều phối toàn diện, nơi người dùng không chỉ xem trạng thái theo thời gian thực mà còn có thể phân tích sâu về hiệu suất (chi phí, thời gian, kết quả công cụ), kiểm tra các thay đổi mã nguồn và quản lý cấu hình hệ thống, tất cả thông qua một giao diện tương tác cao.

## Phạm vi & Tác động
- **Backend (ai-system/server-app.ts, ai-system/core/artifacts.ts):** API `/jobs` sẽ được làm phong phú thêm để bao gồm dữ liệu chi tiết từ các bản ghi (artifacts) như: số liệu sử dụng của các model (cost/token), ngân sách thực thi, kết quả công cụ (tool results) và tóm tắt các thay đổi file (diff summaries). Một API mới `/config` (hoặc mở rộng `/health`) sẽ được thêm vào để hiển thị cấu hình hệ thống hiện tại.
- **Frontend (dashboard/src/App.tsx & các components mới):** Cấu trúc nguyên khối của `App.tsx` sẽ được chia nhỏ và tổ chức lại để hỗ trợ nhiều giao diện (Hoạt động, Cài đặt/Sức khỏe hệ thống). Modal Chi tiết Công việc (Job Detail Modal) sẽ được nâng cấp thành giao diện nhiều tab.

## Giải pháp Đề xuất

### 1. Mở rộng Dữ liệu Backend
- Nâng cấp phản hồi của `GET /jobs` và `GET /jobs/:id` để đảm bảo `RunListEntry` ánh xạ và bao gồm:
  - `diffSummaries` (số dòng thêm/bớt trên mỗi file).
  - `providerMetrics` (chi phí dự kiến và lượng token sử dụng).
  - `latestToolResults` (stdout/stderr cho các bước lint/typecheck bị lỗi).
- Xây dựng API `GET /config` để phục vụ cấu hình `rules.json` hiện hành (ví dụ: các provider đang kích hoạt, ngân sách, trạng thái tìm kiếm vector).

### 2. Tái cấu trúc UI & Điều hướng
- Thêm thanh điều hướng chính (navigation bar hoặc sidebar) để chuyển đổi giữa:
  - **Overview / Activity:** Dòng thời gian công việc chính và form tạo tác vụ mới.
  - **System Health & Config:** Giao diện mới hiển thị thiết lập của các AI provider, model mặc định và ngân sách hệ thống.

### 3. Quản lý Tác vụ Nâng cao (Advanced Job Management)
- Thêm các thẻ lọc nhanh (filter pills) phía trên dòng thời gian (ví dụ: All, Running, Completed, Failed).
- Thêm nút hành động **Re-run (Chạy lại)** trên các thẻ công việc. Nút này sẽ tự động điền lại câu lệnh (prompt) và thư mục làm việc vào form "New Task".

### 4. Phân tích Thực thi Chuyên sâu & Modal
- Nâng cấp `JobDetailModal` bao gồm nhiều tab:
  - **Timeline:** Các bước thực thi như hiện tại.
  - **Analytics:** Biểu đồ hoặc số liệu thống kê hiển thị thời lượng, chi phí ước tính ($), và lượng token sử dụng cho từng tác nhân (Planner, Reviewer, Generator).
  - **Diagnostics:** Khu vực chuyên dụng hiển thị toàn bộ stdout/stderr từ các công cụ kiểm tra của repository (ví dụ: chi tiết lỗi lint).
  - **File Changes (Diff Viewer):** Danh sách các file bị thay đổi bởi tác vụ, hiển thị số lượng dòng được thêm/xóa.

### 5. Trình xem Code Diff Tương tác (Interactive Code Diff Viewer)
- Bên trong tab "File Changes", cung cấp một cái nhìn tổng quan nhẹ nhàng về các file đã được chạm tới. (Việc hiển thị diff đầy đủ như Git có thể yêu cầu đọc trực tiếp nội dung file từ backend, do đó phiên bản đầu tiên sẽ tập trung vào tóm tắt diff: +12, -4 cho mỗi file).

## Kế hoạch Thực hiện Từng giai đoạn
1. **Backend Endpoints:** Cập nhật `/jobs` để phục vụ dữ liệu phân tích, kết quả công cụ và diffs. Tạo `/config`.
2. **UI Navigation & Filtering:** Xây dựng bố cục cấu trúc, các tab và logic lọc công việc.
3. **Rich Modal Development:** Triển khai các tab Analytics (Phân tích) và Diagnostics (Chẩn đoán) trong Job Modal.
4. **System Config View:** Xây dựng trang mới để hiển thị sức khỏe và cài đặt của hệ thống AI.
5. **Testing & Polish:** Xác minh các bản cập nhật theo thời gian thực, xử lý các công việc cũ (không có dữ liệu phân tích) một cách mượt mà và hoàn thiện các hiệu ứng chuyển động (Framer Motion).

## Các bước Kiểm tra (Verification)
- Gửi một tác vụ mới từ UI và xác minh rằng modal hiển thị đầy đủ kết quả công cụ, chi phí AI và các bước thực thi theo thời gian thực.
- Xác minh chức năng lọc hiển thị/ẩn chính xác các công việc dựa trên trạng thái.
- Đảm bảo API `/config` ẩn đi các dữ liệu nhạy cảm (như API keys) trước khi trả về.
