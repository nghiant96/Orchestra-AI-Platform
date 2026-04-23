# AI-CODING-SYSTEM: Comprehensive Project Review & Upgrade Proposal (V2)

**Ngày đánh giá:** 23/04/2026
**Trạng thái hiện tại:** Đã hoàn thành Phase A, B, D của Roadmap V2. Hệ thống đã có Docker Sandboxing, Semantic Search và Adaptive Routing.

---

## 1. Đánh giá kỹ thuật (Technical Assessment)

### Thành tựu đã đạt được:
- **Phase A (Safety):** Chế độ `tools.sandbox.mode = "docker"` hoạt động tốt, tách biệt môi trường thực thi tool.
- **Phase B (Intelligence):** `VectorIndex` và `DependencyGraph` đã phối hợp để mở rộng ngữ cảnh (Context Expansion), giúp AI hiểu sâu hơn về mối quan hệ giữa các file.
- **Phase D (Routing):** `provider-router.ts` đã có logic `Adaptive Routing` dựa trên lịch sử chạy (lookback runs), tự động điều chỉnh Model/Provider dựa trên hiệu suất thực tế.

### Các điểm cần cải thiện (Bottlenecks):
- **Kiến trúc tuần tự:** `Orchestrator` và `run-executor` hiện đang xử lý logic theo dạng "mì ống" (procedural), gây khó khăn cho việc quản lý trạng thái phức tạp hoặc resume/retry tại các điểm lỗi nhỏ.
- **Độ chính xác của Context:** Chunking trong `VectorIndex` dựa trên Regex, có thể bị nhiễu bởi các comment hoặc cú pháp lạ.
- **Thiếu kiểm soát chi phí:** Hệ thống chưa tính toán Token cost để tối ưu hóa chi phí sử dụng LLM.
- **UX/UI:** CLI in ra quá nhiều text, thiếu sự trực quan về tiến trình của các Agent.

---

## 2. Đề xuất nâng cấp (Upgrade Roadmap)

### Mục tiêu 1: Refactoring Orchestrator (State Machine)
- Chuyển đổi luồng thực thi trong `run-executor.ts` sang mô hình **State Machine**.
- Định nghĩa rõ các trạng thái: `INITIALIZING`, `PLANNING`, `GENERATING`, `REVIEWING`, `FIXING`, `SUCCESS`, `FAILURE`.
- Cho phép Agent có thể "rollback" trạng thái hoặc "partial retry" mà không cần chạy lại từ đầu.

### Mục tiêu 2: AST-based Chunking (Vector Index)
- Thay thế Regex trong `vector-index.ts` bằng một parser AST (như `tree-sitter` hoặc `typescript` compiler API).
- Đảm bảo mỗi chunk code luôn là một đơn vị logic hoàn chỉnh (ví dụ: nguyên một function hoặc class).

### Mục tiêu 3: Adaptive Routing với Cost-Weighting
- Bổ sung bảng giá token vào cấu hình provider.
- Cập nhật logic `chooseProfile` trong `provider-router.ts` để cân bằng giữa: **Hiệu suất (Success rate)**, **Tốc độ (Latency)** và **Chi phí (Cost)**.

### Mục tiêu 4: TUI & Visibility
- Sử dụng `ink` hoặc `blessed` để xây dựng giao diện Terminal trực quan hơn.
- Hiển thị Progress Bar khi Indexing và Dashboard hiển thị "Agent Thinking Status".

---

## 3. Chỉ dẫn cho Codex
1. **Kiểm tra file `ai-system/core/orchestrator.ts`**: Tìm cách module hóa phương thức `run` và `resume`.
2. **Nâng cấp `ai-system/core/vector-index.ts`**: Chuyển đổi logic `detectSymbolStarts` sang sử dụng parser chuyên dụng.
3. **Cập nhật `ai-system/core/provider-router.ts`**: Thêm tham số `cost` vào `AdaptiveProviderStat`.

---
*Tài liệu này được tạo ra để định hướng cho Codex thực hiện các nâng cấp chiến lược cho hệ thống.*
