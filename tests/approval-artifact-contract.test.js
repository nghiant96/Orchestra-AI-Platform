import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createApprovalArtifactBinding, validateApprovalProof } from "../ai-system/approvals/approval-proof.js";
describe("approval artifact contract", () => {
    test("accepts proof bound to the immutable artifact hash", () => {
        const binding = createApprovalArtifactBinding({ writeTargets: ["a.ts"], notes: ["ok"] }, "plan");
        const result = validateApprovalProof(binding, {
            approvedBy: "user-1",
            approvalSource: "dashboard",
            userConfirmationId: "confirm-1",
            artifactId: binding.artifactId,
            artifactHash: binding.artifactHash
        }, { requireProof: true });
        assert.equal(result.ok, true);
    });
    test("rejects missing or stale proof", () => {
        const binding = createApprovalArtifactBinding({ writeTargets: ["a.ts"] }, "plan");
        const missing = validateApprovalProof(binding, undefined, { requireProof: true });
        assert.equal(missing.ok, false);
        assert.equal(missing.statusCode, 400);
        const stale = validateApprovalProof(binding, {
            approvedBy: "user-1",
            approvalSource: "mcp",
            userConfirmationId: "confirm-1",
            artifactId: binding.artifactId,
            artifactHash: "different"
        }, { requireProof: true });
        assert.equal(stale.ok, false);
        assert.equal(stale.statusCode, 409);
    });
});
