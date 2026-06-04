import crypto from "node:crypto";

export type ApprovalArtifactType = "plan" | "checkpoint" | "delivery" | "lesson" | "unknown";

export interface ApprovalArtifactBinding {
  artifactId: string;
  artifactHash: string;
  artifactType: ApprovalArtifactType;
  createdAt: string;
}

export interface ApprovalProof {
  approvedBy: string;
  approvalSource: string;
  userConfirmationId: string;
  artifactId: string;
  artifactHash: string;
}

export function createApprovalArtifactBinding(
  artifact: unknown,
  artifactType: ApprovalArtifactType = "unknown",
  createdAt = new Date().toISOString()
): ApprovalArtifactBinding {
  const artifactHash = hashArtifact(artifact);
  return {
    artifactId: `${artifactType}-${artifactHash.slice(0, 16)}`,
    artifactHash,
    artifactType,
    createdAt
  };
}

export function normalizeApprovalProof(value: unknown): Partial<ApprovalProof> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  return {
    approvedBy: typeof raw.approvedBy === "string" ? raw.approvedBy : undefined,
    approvalSource: typeof raw.approvalSource === "string" ? raw.approvalSource : undefined,
    userConfirmationId: typeof raw.userConfirmationId === "string" ? raw.userConfirmationId : undefined,
    artifactId: typeof raw.artifactId === "string" ? raw.artifactId : undefined,
    artifactHash: typeof raw.artifactHash === "string" ? raw.artifactHash : undefined
  };
}

export function validateApprovalProof(
  binding: ApprovalArtifactBinding,
  proof: Partial<ApprovalProof> | undefined,
  options: { requireProof?: boolean } = {}
): { ok: true; proof?: ApprovalProof } | { ok: false; statusCode: number; error: string } {
  if (!options.requireProof && !proof) {
    return { ok: true };
  }
  if (!proof?.approvedBy || !proof.approvalSource || !proof.userConfirmationId || !proof.artifactId || !proof.artifactHash) {
    return { ok: false, statusCode: 400, error: "Approval proof requires approvedBy, approvalSource, userConfirmationId, artifactId, and artifactHash" };
  }
  if (proof.artifactId !== binding.artifactId || proof.artifactHash !== binding.artifactHash) {
    return { ok: false, statusCode: 409, error: "Approval artifact proof is stale or does not match the pending artifact" };
  }
  return { ok: true, proof: proof as ApprovalProof };
}

export function hashArtifact(value: unknown): string {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (typeof value === "undefined") {
    return "undefined";
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}
