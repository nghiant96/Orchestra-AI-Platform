# System Upgrade Plan - PROGRESS UPDATE

**Ngày lập:** 28/04/2026  
**Trạng thái:** Milestone 1 (100% Hoàn tất) | Milestone 2 (80% Hoàn tất)

---

## 1. Mục tiêu giai đoạn tiếp theo

Hệ thống đã chuyển đổi thành công từ một Dashboard demo sang một **Orchestration Platform** mạnh mẽ. Chúng ta đã có:
- **Control Center (V4):** Đã modular hóa, hỗ trợ Code Splitting, Analytics chuyên sâu.
- **Multi-project Awareness:** Đã có thể quản lý nhiều Workspace tập trung.
- **Cost & Error Governance:** Đã phân loại lỗi thông minh và kiểm soát ngân sách theo model thực tế.
- **Hardened Execution:** Cancellation triệt để, concurrency per workspace, retention policy.

---

## 2. Current Baseline (Updated)

### ✅ Đã hoàn tất (New)
- **Dashboard V4 Core:** Tách bundle thành công (Lazy load), Routing mượt mà, Footer hiển thị Health thực tế của Server.
- **Error Taxonomy:** Hệ thống đã tự động phân loại lỗi (Timeout, Budget, Tool...) và đưa ra gợi ý sửa lỗi trực quan.
- **Advanced Analytics:** Biểu đồ Cost Trend, Failure Distribution và Stage Latency đã sẵn sàng.
- **Project Orchestration:** Chuyển đổi linh hoạt giữa các dự án (Workspace) và đồng bộ CWD tự động.
- **Cost Governance:** Bảng giá thực tế theo Model và cơ chế "Budget Warning" trước khi chạy tốn kém.
- **Queue Hardening:** Concurrency per workspace, AbortSignal propagation triệt để, Job retention (100 jobs).

### ⚠️ Rủi ro/Tồn tại
- **Adaptive Routing:** Chưa có signal phản hồi từ chi phí thực tế vào router.
- **Plugin System:** Đang ở giai đoạn thiết kế (Milestone 3).
- **Cross-language:** Python đã có V2, Go/Rust cần thêm adapter sâu hơn.

---

## 3. Upgrade Themes Status

## Theme A: Dashboard V4 - Production Control Center (P0) - [90% DONE]
- [x] Tách dashboard bundle bằng route-level/code splitting (Suspense/Lazy).
- [x] Thêm Jobs board với queue states và filtering theo Workspace/Status.
- [x] Chi tiết Job với Timeline và Analytics tích hợp.
- [x] Approval UI với Budget Warning cảnh báo chi phí.
- [x] Trạng thái Empty/Loading/Error chuẩn (ViewLoading, 404 Route).
- [x] **Còn lại:** Run comparison view (So sánh 2 lần chạy).

## Theme B: Queue And Multi-Project Orchestration (P0) - [100% DONE]
- [x] Project Registry: Danh sách Workspace từ `allowedWorkdirs`.
- [x] Server Health Detail: Active/Queued jobs, CWD, Version, Memory.
- [x] Workspace Scoping: Lọc Job và Artifacts theo từng dự án.
- [x] Queue Scheduler: Concurrency per workspace (1 job/project).
- [x] Job Heartbeat: Tự động cleanup hung jobs khi server restart.
- [x] Cancel Propagation: Giết triệt để subprocess bằng AbortSignal.
- [x] Job Retention: Tự động dọn dẹp, giữ 100 jobs gần nhất.

## Theme D: Observability, Cost Governance And Reporting (P1) - [100% DONE]
- [x] Hệ thống tính toán chi phí theo Model (GPT-4o, Claude, Gemini...).
- [x] Dashboard Charts: Cost over time, Failures by class, Avg duration by stage.
- [x] Budget Warning: Cảnh báo trước khi sinh mã.
- [x] Workspace Budget Config: Max daily/single-run cost.
- [x] JSON Export cho run analytics.
- [x] Daily Budget Enforcement: Chặn chạy job nếu hết ngân sách ngày.
- [x] CLI Cost Report: Hiển thị chi phí trong `ai runs latest/show`.

## Theme E: Error Classification And Recovery Hardening (P1) - [90% DONE]
- [x] Error Taxonomy chuẩn (FailureMetadata).
- [x] Dashboard Failure Panel: Hiển thị root cause và Suggestion.
- [x] Artifact validation trước khi Resume (Integrity check for run-state.json).
**Trạng thái:** Milestone 1 (100% Hoàn tất) | Milestone 2 (100% Hoàn tất) | Milestone 3 (100% Hoàn tất)

---

## 3. Upgrade Themes Status

## Theme F: Plugin And Tool Extensibility (P2) - [100% DONE]
- [x] Plugin Manifest Schema: Cấu trúc plugin.json chuẩn.
- [x] Plugin Discovery: Tự động tìm plugin trong .ai-system/plugins/.
- [x] Dynamic Tool Registration: Plugin có thể đăng ký thêm công cụ kiểm tra mới.
- [x] Dashboard Plugin Visibility: Xem danh sách và trạng thái plugin trên UI.
- [x] Example Plugin: Strict Reviewer (security-audit).
- [x] Sandbox/Path safety validation cho plugin commands.

---

## 4. Suggested Next Steps

### Milestone 3: Extensibility And Governance - [IN PROGRESS]
- [x] Theme F: Plugin manifest và discovery engine.
- [x] Theme D: Workspace/team budget policy (Daily Enforcement).
- [x] Theme A: Dashboard analytics trend views.

---

** Engineering Gate Check:** 
- Lint: ✅ | Build: ✅ | Test: ✅ | Routing: ✅ | Analytics: ✅ | Cancellation: ✅ | Python V2: ✅ | Plugins: ✅

