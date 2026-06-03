# Orchestra AI Platform - Realistic Assessment and Roadmap

> Muc tieu: mo ta dung hien trang he thong, chi ra gap con lai, va xac dinh thu tu nang cap de dat product-ready.

Tai lieu nay supersede cach doc `orchestra-review.md` va `ORCHESTRA_AI_PLATFORM_UPDATE_PLAN.md` khi can mot ban dinh huong thuc te hon.  
Nguyen tac:
- Phan `As-is` chi ghi nhung gi code va README hien tai dang chung minh duoc.
- Phan `Roadmap` la thu tu nang cap de di den product-ready, khong danh dong voi hien tai.

---

## 1. Executive Summary

Orchestra hien tai khong con la mot prototype don thu: no da co control plane, job queue file-backed, worker lease flow, checkpoint/complete/fail contract, worker worktree isolation, audit log, dashboard, va preview cho Hermes/Superpowers.

Nhung no van chua phai product-ready. Nut that chinh la:
- persistence van file-backed;
- worker/distributed model con dang preview;
- process supervision cho provider CLI con mong;
- workspace engine va Hermes van la roadmap hon la he thong san xuat;
- de vung tin cay va quan tri van con thieu nhieu thu co ban cho scale noi bo.

Ket luan thuc te:
- San pham hien tai phu hop cho dogfood noi bo va thuc nghiem co kiem soat.
- Chua phu hop de giao cho team chay production khong giam sat.

---

## 2. As-Is Reality

### 2.1. Cai da co that

He thong hien tai co nhung contract thuc te sau:

- `ai` CLI orchestration co luong plan/context/generate/check/review/fix/write.
- HTTP control plane va dashboard.
- File-backed job queue co enqueue/list/cancel/delete/claim/start/complete/fail/renewLease/saveCheckpoint/recover.
- Worker register / heartbeat / claim / start / complete / fail / recover flow.
- Lease-based execution de tranh duplicate claim.
- Stale lease recovery, bao gom requeue neu chua mutate filesystem va stalled neu da co mutation checkpoint.
- Canonical realpath validation cho workspace roots cua worker.
- Isolated git worktree cho worker execution.
- Token roles cho server, worker, Hermes.
- Audit log va artifact tracking.
- Workspace engine preview va work item / branch / PR surface.

### 2.2. Cai con dang preview

- `ORCHESTRA_EXECUTION_BACKEND=hybrid` hien dang bi coi la worker-only de tranh xung dot.
- Provider-backed worker execution moi o muc alpha.
- Hermes/Superpowers con la preview layer, chua phai AI PM engine day du.
- Workspace engine chua co task graph/evidence engine day du.
- Queue persistence chua co durable DB store.

### 2.3. Cai khong nen coi la "da san sang"

Neu doc dung theo code hien tai, nhung phan sau chua du co so de goi la product-ready:

- Khong co SQLite/Postgres store that.
- Khong co migration runner that.
- Khong co browser smoke test cho dashboard.
- Khong co worker process supervisor that cho provider CLI.
- Khong co load balancing/discovery cho multi-worker scale.
- Khong co bo chuan observability day du cho SLA noi bo.

---

## 3. What Is Strong

### 3.1. Architecture direction

Huong kien truc hien tai la dung:

- control plane tach khoi execution plane;
- local worker chiu trach nhiem claim/execute/heartbeat;
- provider CLI duoc dong goi qua worktree isolated;
- artifacts va log duoc persist de debug va review;
- stale lease co quy trinh khang dinh.

### 3.2. Safety posture

Day la phan da co gia tri:

- canonical path validation chong symlink escape;
- token role separation;
- dry-run + no-mutation rules trong worker preview;
- lease-bound completion/failure de tranh ghost writes;
- worktree isolation de giam risk len main checkout.

### 3.3. Product direction

To hop nay co mo hinh san pham ro:

- Orchestra la control plane;
- worker la execution node;
- Hermes la AI PM / planner;
- dashboard la human control panel;
- work items la don vi quang ly dong.

---

## 4. Main Gaps Before Product-Ready

### Gap 1: Durability

File-backed queue va artifact state co the dung cho alpha, nhung khong phai nen tang cuoi cung cho team multi-user, multi-worker.

Risk:
- restart race;
- lock edge cases;
- cleanup va recovery khong on dinh;
- state format phat sinh nhanh hon kha nang versioning.

### Gap 2: Worker correctness at scale

Hien tai da co lease flow, nhung van thieu:

- worker process supervision that;
- explicit worker health semantics;
- better backoff/retry policy;
- clear scale-out assignment policy;
- durable handling cho job tren crash/timeout.

### Gap 3: Operational readiness

Chua du cho van hanh that:

- browser-level smoke test;
- metrics/alerts that;
- rate limiting / abuse protection;
- structured auth/permission audit;
- clear rollback/migration story.

### Gap 4: Product domain completeness

Workspace Engine va Hermes dang dung o muc preview.
Neu muon goi day la product-ready, can:

- work item lifecycle that;
- task graph that;
- evidence checklist that;
- approvals tied to artifacts and diffs;
- repo registry va workspace routing ro rang;
- AI PM workflow khong lam loang control plane.

---

## 5. Recommended Next Step

Neu muc tieu la "step tiep theo" thuc dung nhat, thi khong nen nhay thang vao Hermes PM hoac Postgres ngay.

Uu tien dung:

1. Lam cho worker/queue state that dung.
2. Chuyen persistence sang store durable.
3. Hoan chinh operational guardrails.
4. Sau do moi mo rong workspace/Hermes.

Day la thu tu it rui ro nhat.

---

## 6. Product-Ready Roadmap

### Phase P0 - Stabilize Current Worker Platform

Muc tieu:
- giu nguyen API/CLI hien co;
- lam cho queue, lease, checkpoint, recovery that de tin cay hon;
- chot semantics cua preview mode.

Cong viec:
- Document `in-process`, `worker`, va `hybrid` semantics ro rang.
- Giu `hybrid` o worker-only cho den khi co internal-worker leasing that su.
- Tang do tin cay cua stale lease recovery.
- Hoan chinh worker shutdown va teardown safety.
- Bo sung integration tests cho claim/start/checkpoint/complete/fail/recover.
- Da hoa terminal state contract cho worker job.

Acceptance:
- khong duplicate claim;
- khong mat terminal payload;
- stale lease duoc requeue hoac stalled dung;
- worker preview chay on dinh trong smoke flow.

### Phase P1 - Durable Store

Muc tieu:
- thay file-backed queue bang store co migration va versioning ro rang.

Cong viec:
- Tao `OrchestraStore` abstraction.
- Dua jobs/workers/audit/artifacts/work items vao SQLite.
- Them schema migrations va versioning.
- Giu backward compatibility voi file-backed mode neu can transition an toan.
- Chu y idempotent write va recovery.

Acceptance:
- server restart khong mat state;
- queue survive restart;
- migrate idempotent;
- worker claim van atomic.

### Phase P2 - Operational Readiness

Muc tieu:
- san sang cho team noi bo su dung hang ngay.

Cong viec:
- dashboard smoke test browser-level;
- rate limiting cho write APIs;
- auth/role audit ro rang;
- worker health dashboard that su;
- log retention va artifact retention ro rang;
- metrics cho queue latency, failure rate, worker health.

Acceptance:
- dashboard UI co smoke coverage;
- API co guardrails co ban;
- operator thay duoc health va recovery state;
- co signal de debug incidents.

### Phase P3 - Workspace Engine v1

Muc tieu:
- bien work item thanh don vi thuc su de AI PM quan ly.

Cong viec:
- chot WorkItem domain model;
- task graph that;
- evidence checklist that;
- branch/PR/CI state ro rang;
- work item events va linked job timeline;
- explicit handoff flow.

Acceptance:
- work item co lifecycle ro;
- artifact/diff/proof gan voi approval;
- dashboard the hien duoc run history va evidence;
- co duong dan handoff sang PR.

### Phase P4 - Hermes Integration

Muc tieu:
- Hermes tro thanh AI PM, khong canh tranh voi Orchestra control plane.

Cong viec:
- MCP contract ro rang;
- token-role permission that;
- read/write tools co guardrails;
- lesson export / review loop;
- repo registry va workspace routing that.

Acceptance:
- Hermes chi lam planning/coordination;
- Orchestra giu execution + audit + recovery;
- MCP write tools khong vuot permission.

### Phase P5 - Scale Out

Muc tieu:
- dua he thong tu internal tool len scale team.

Cong viec:
- Postgres backend neu SQLite bat dau ngan;
- worker discovery/assignment policy that;
- load balancing theo workspace/capability;
- stronger process supervision;
- multi-host worker ops.

Acceptance:
- the load khong lam vo queue semantics;
- worker pool on dinh voi multiple machines;
- operations co the quan ly duoc at scale.

---

## 7. Definition of Product-Ready

Orchestra chi nen goi la product-ready khi cac dieu sau dung:

- state durable qua restart;
- worker claim/lease/recover khong mat du lieu;
- dashboard co smoke test;
- auth va permission co audit that;
- work item flow co evidence va handoff ro rang;
- provider CLI failures duoc supervision dung;
- observability du de van hanh noi bo;
- roadmap Hermes khong lam lam control plane.

---

## 8. Practical Recommendation

Neu chi duoc chon mot buoc tiep theo, toi de xuat:

1. Chot P0 va P1 truoc.
2. Chua dau tu manh vao Hermes PM cho den khi store durable xong.
3. Rewrite lai dashboard/ops docs sau khi store va worker semantics da on dinh.

Ly do:
- dau tu vao product surface khi nen tang con file-backed se lam tang risk;
- dashboard, Hermes, va workspace graph deu phu thuoc vao state reliability;
- durabilty la dieu kien tien quyet cho scale.

