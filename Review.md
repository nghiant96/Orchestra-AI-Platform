# AI-CODING-SYSTEM: Technical Review & Completion Roadmap

**Ngày đánh giá:** 23/04/2026
**Trạng thái hệ thống:** 3.5/5 (Beta / Internal Tool)
**Mục tiêu:** Chuyển đổi từ một Orchestrator local mạnh mẽ thành một Autonomous Software Engineering Agent hoàn chỉnh.

---

## 1. Tổng quan hệ thống (System Overview)
Hệ thống là một công cụ điều phối AI (Orchestrator) tập trung vào tính **Minh bạch (Observability)** và **Độ tin cậy (Reliability)** thông qua vòng lặp **"Lập kế hoạch -> Thực thi -> Kiểm chứng"**.

- **Core Logic:** Nằm tại `ai-system/core/orchestrator.ts`.
- **Triết lý:** Verified Execution - Code không chỉ được sinh ra mà còn được kiểm tra bằng các công cụ thực tế (Lint/Test) trước khi áp dụng.

---

## 2. Điểm mạnh (Technical Strengths)
- **Artifact & Resume System:** Khả năng lưu trữ trạng thái chạy (`run-state.json`) và Resume tại bất kỳ thời điểm nào. Đây là "xương sống" cho các task chạy lâu (Long-running tasks).
- **Dynamic Routing Logic:** Khả năng chọn model thông minh dựa trên rủi ro của file (ví dụ: `auth/`, `db/` sẽ dùng Claude thay vì Gemini Flash).
- **Zero-Config Tooling:** Tự động phát hiện môi trường (pnpm/yarn/npm) và các script trong `package.json` để thực thi kiểm tra code.
- **Explainability:** Các lệnh `ai explain-routing` và `ai runs latest` giúp người dùng hiểu tại sao hệ thống đưa ra quyết định đó.

---

## 3. Điểm yếu & Hạn chế (Weaknesses & Constraints)
- **Local Execution Risk:** Việc chạy lint/test trực tiếp trên máy local có thể gây side-effect hoặc xung đột môi trường.
- **Context Management:** Việc chọn file đưa vào context vẫn còn đơn giản, dễ dẫn đến hiện tượng "tràn ngữ cảnh" (context stuffing) hoặc thiếu file quan trọng nếu Planner dự đoán sai.
- **Node.js Bias:** Hiện tại các tính năng tự động hóa đang tối ưu sâu cho hệ sinh thái TypeScript/Node.js.
- **Serial Bottleneck:** Các bước thực hiện tuần tự khiến thời gian xử lý các task lớn bị kéo dài.

---

## 4. Lộ trình hoàn thiện (Roadmap to 1.0)

### Phase A: Sandboxing & Safety (Hoàn thành)
- [x] **Docker Integration:** Chạy `tool-executor` trong một container riêng biệt. Hỗ trợ `tools.sandbox.mode = "docker"`.
- [x] **Dry-run Enhancement:** Cải thiện chế độ review để người dùng thấy rõ tác động trước khi `apply` bằng cách chạy tool check trong thư mục tạm.

### Phase B: RAG & Context Intelligence (Hoàn thành cơ bản)
- [ ] **Vector Search:** Tích hợp Vector DB (Ollama/Embeddings) để tìm kiếm code liên quan theo logic thay vì chỉ theo tên file.
- [x] **Dependency Graph:** Đã xây dựng bản đồ phụ thuộc để tự động đưa các file liên quan vào context (imports/importedBy).

### Phase C: DX & UI/UX
- [ ] **Interactive CLI:** Sử dụng giao diện Terminal tương tác (như `ink`) để xem Diff và chọn lọc thay đổi.
- [ ] **Streaming Progress:** Hiển thị kết quả AI đang sinh ra theo thời gian thực (Streaming).

### Phase D: Ecosystem Expansion
- [ ] **Multi-language Support:** Bổ sung auto-detect cho Python (Pytest/Ruff), Go, Rust.
- [ ] **Local LLM Support:** Tối ưu hóa cho việc chạy với các Model local (Ollama/vLLM) để đảm bảo bảo mật dữ liệu tuyệt đối.

---

## 5. Các câu hỏi thảo luận cho Codex
1. **Optimization:** Làm thế nào để song song hóa việc sinh code cho nhiều file mà không làm mất tính nhất quán (Consistency)?
2. **Context:** Thuật toán nào hiệu quả nhất để chọn ra "Top K" đoạn code quan trọng nhất cho một Task cụ thể mà không cần đưa cả file vào?
3. **Refactoring:** Có nên tách `Orchestrator` ra thành các `State Machines` nhỏ hơn để quản lý các trạng thái phức tạp tốt hơn không?

---
*Tài liệu này được tạo ra bởi Gemini CLI để phục vụ quá trình phát triển hệ thống AI-CODING-SYSTEM.*
