# AI-CODING-SYSTEM: Technical Review & Evolution Roadmap (V3)

**Ngày đánh giá:** 23/04/2026  
**Trạng thái:** 4.2/5 (Hệ thống đã ổn định, Core sạch, bắt đầu giai đoạn Scale-out)  
**Mục tiêu trọng tâm:** Đa ngôn ngữ (Multi-language), Tối ưu chi phí (Cost Control) và Agent Autonomy.

---

## 1. Ghi nhận cải tiến (Chốt sổ V2)
So với các bản Review cũ, hệ thống đã giải quyết triệt để các "mối nguy" cấp độ Critical:
- **Phá vỡ God File:** `cli.ts` đã được tách nhỏ thành các module chuyên biệt trong `ai-system/cli/`. Khả năng bảo trì và test lẻ từng command đã khả thi.
- **Lấp đầy Test Gaps:** Đã có test cho các module "xương sống" như `run-executor.ts`, `provider-router.ts`. Hệ thống đã có lưới an toàn khi refactor.
- **Chuẩn hóa Codebase:** Đã có ESLint, Prettier và cấu hình rõ ràng. Sự nhất quán về style đã được enforce.

---

## 2. Phân tích kiến trúc hiện tại (The Moat)
Hệ thống hiện đang sở hữu những "pháo đài" kỹ thuật mà ít công cụ AI nào có:
- **Verified Execution Pipeline:** Không tin tưởng AI mù quáng; mọi thay đổi phải đi qua Sandbox (Lint/Typecheck/Test) mới được chấp nhận.
- **Artifact-backed Resume:** Khả năng "đóng băng" và "rã đông" phiên chạy (`run-state.json`) giúp xử lý các task cực lớn mà không sợ mất dấu hoặc tốn token chạy lại từ đầu.
- **Deep Context Intelligence:** Sự kết hợp giữa **AST Chunking** (hiểu cấu trúc code) và **Dependency Graph** (hiểu mối quan hệ file) giúp tỷ lệ "chạm" đúng file cần sửa rất cao.

---

## 3. Các điểm nghẽn chiến lược (New Bottlenecks)

### 🔴 B1. Hệ thống đang bị "Giam lỏng" trong Node.js/TS
Toàn bộ logic phân tích ngữ cảnh (AST) và thực thi tool (Executor) hiện đang mặc định là dự án TypeScript. Nếu đưa vào một dự án Python hay Go, hệ thống sẽ bị "mù".
- **Hệ quả:** Khó mở rộng sang các tệp khách hàng/dự án khác ngoài web/node.

### 🟡 B2. Thiếu Quản trị Kinh tế (Cost Management)
Hệ thống hiện tại mới chỉ quan tâm đến "Đúng" và "Nhanh", chưa quan tâm đến "Rẻ". Không có cơ chế track Token/Cost real-time.
- **Hệ quả:** Các task lớn có thể tiêu tốn hàng chục USD mà người dùng không được cảnh báo trước.

### 🟡 B3. Agent Layer còn mỏng (Thin Wrappers)
Các Agents (`planner.ts`, `generator.ts`) hiện chỉ đơn giản là gộp string tạo prompt. Chúng chưa có khả năng tự sửa lỗi (Self-reflection) ở tầng logic trước khi đẩy code xuống Executor.

---

## 4. Lộ trình nâng cấp V3 (Roadmap to 1.0)

### Phase 1: Trừu tượng hóa & Đa ngôn ngữ (P0 - Critical)
- [ ] **Plugin-based AST Parser:** Tạo Interface cho `VectorIndex` để có thể cắm `PythonParser`, `GoParser` (sử dụng Tree-sitter hoặc LSP).
- [ ] **Universal Tool Adapter:** Thay vì hardcode `pnpm/npm`, hãy cấu hình `tools.commands` theo file extension hoặc project type (ví dụ: `.py` -> `pytest`, `.go` -> `go test`).

### Phase 2: Token Metrics & Budgeting (P1 - High)
- [ ] **Cost Tracker:** Thêm module `ai-system/utils/cost-calculator.ts` để ước tính token/price cho từng Provider.
- [ ] **Budget Guard:** Thêm cấu hình `max_cost_per_run`. Nếu ước tính vượt ngưỡng, Agent phải hỏi ý kiến người dùng tại stage Planning.
- [ ] **Cost-aware Routing:** Cập nhật `provider-router` để ưu tiên các model rẻ hơn (như Gemini Flash) cho các task đơn giản hoặc review sơ bộ.

### Phase 3: Prompt Engine & Agent Autonomy (P1 - High)
- [ ] **Externalize Prompts:** Chuyển toàn bộ Prompt string sang file `.md` trong `/prompts` với cơ chế templating (ví dụ: dùng `handlebars`).
- [ ] **Few-shot Library:** Xây dựng thư viện các ví dụ tốt (Good Examples) để nạp vào prompt tùy theo loại task (Refactor, Bug fix, New feature).

### Phase 4: UX Visibility & TUI Dashboard (P2 - Medium)
- [ ] **Interactive Dashboard:** Nâng cấp TUI (Blessed/Ink) để hiển thị: "Cây trạng thái của Agent", "Token đã tiêu thụ", "Live Diff" khi Generator đang làm việc.
- [ ] **Manual Checkpoints:** Cho phép người dùng can thiệp sửa trực tiếp vào `plan.json` hoặc `context.json` trước khi AI thực thi.

---

## 5. Chỉ dẫn cho các Agent thực thi (Codex/Gemini)
1. **Ưu tiên hàng đầu:** Khi sửa code, hãy giữ nguyên tính năng **Resume/Retry** thông qua State Machine. Đừng làm gãy luồng `run-state.json`.
2. **Khi thêm tính năng mới:** Luôn kiểm tra xem nó có làm tăng "Language Bias" không. Hãy ưu tiên viết code theo hướng Adapter/Interface.
3. **Mọi Agent call:** Phải trả về thông tin `usage` (token count) để chuẩn bị cho hệ thống Cost Tracking.

---
*Tài liệu này được tạo ra để định hướng cho giai đoạn hoàn thiện AI-CODING-SYSTEM lên bản 1.0 ổn định.*
