import crypto from "node:crypto";
export function createApprovalArtifactBinding(artifact, artifactType = "unknown", createdAt = new Date().toISOString()) {
    const artifactHash = hashArtifact(artifact);
    return {
        artifactId: `${artifactType}-${artifactHash.slice(0, 16)}`,
        artifactHash,
        artifactType,
        createdAt
    };
}
export function normalizeApprovalProof(value) {
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const raw = value;
    return {
        approvedBy: typeof raw.approvedBy === "string" ? raw.approvedBy : undefined,
        approvalSource: typeof raw.approvalSource === "string" ? raw.approvalSource : undefined,
        userConfirmationId: typeof raw.userConfirmationId === "string" ? raw.userConfirmationId : undefined,
        artifactId: typeof raw.artifactId === "string" ? raw.artifactId : undefined,
        artifactHash: typeof raw.artifactHash === "string" ? raw.artifactHash : undefined
    };
}
export function validateApprovalProof(binding, proof, options = {}) {
    if (!options.requireProof && !proof) {
        return { ok: true };
    }
    if (!proof?.approvedBy || !proof.approvalSource || !proof.userConfirmationId || !proof.artifactId || !proof.artifactHash) {
        return { ok: false, statusCode: 400, error: "Approval proof requires approvedBy, approvalSource, userConfirmationId, artifactId, and artifactHash" };
    }
    if (proof.artifactId !== binding.artifactId || proof.artifactHash !== binding.artifactHash) {
        return { ok: false, statusCode: 409, error: "Approval artifact proof is stale or does not match the pending artifact" };
    }
    return { ok: true, proof: proof };
}
export function hashArtifact(value) {
    return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}
function stableStringify(value) {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(",")}]`;
    }
    const record = value;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}
