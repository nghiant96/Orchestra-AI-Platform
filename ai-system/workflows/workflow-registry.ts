import type { ApprovalPolicyDecision, RiskClass, RiskSignal } from "../types.js";
import type { ChecklistItem } from "../work/work-item.js";
import {
  balancedWorkflowProfile,
  defaultWorkflowProfile,
  fastFixWorkflowProfile,
  strictReviewWorkflowProfile
} from "./profiles/default.js";
import { superpowersWorkflowProfile } from "./profiles/superpowers.js";
import type { WorkflowProfile, WorkflowProfileId } from "./workflow-profile.js";

const riskRank: Record<RiskClass, number> = {
  low: 1,
  medium: 2,
  high: 3,
  blocked: 4
};

export const workflowProfiles: Record<WorkflowProfileId, WorkflowProfile> = {
  default: defaultWorkflowProfile,
  "fast-fix": fastFixWorkflowProfile,
  balanced: balancedWorkflowProfile,
  superpowers: superpowersWorkflowProfile,
  "strict-review": strictReviewWorkflowProfile
};

export function parseWorkflowProfileId(value: unknown): WorkflowProfileId | undefined {
  return typeof value === "string" && value in workflowProfiles
    ? value as WorkflowProfileId
    : undefined;
}

export function resolveWorkflowProfile(value: unknown): WorkflowProfile {
  return workflowProfiles[parseWorkflowProfileId(value) ?? "default"];
}

export function listWorkflowProfiles(): WorkflowProfile[] {
  return Object.values(workflowProfiles);
}

export function applyWorkflowProfileToTask(task: string, value: unknown): string {
  const profile = resolveWorkflowProfile(value);
  if (!profile.promptBlock || task.includes("=== Orchestra Workflow Profile ===")) {
    return task;
  }
  return [
    task,
    "",
    "=== Orchestra Workflow Profile ===",
    profile.promptBlock,
    profile.evidenceChecklist.length > 0
      ? [
          "Evidence checklist:",
          ...profile.evidenceChecklist.map((item) => `- ${item.text}${item.required ? " (required)" : ""}`)
        ].join("\n")
      : ""
  ].filter(Boolean).join("\n");
}

export function tightenApprovalPolicyForProfile(
  policy: ApprovalPolicyDecision,
  value: unknown
): ApprovalPolicyDecision {
  const profile = resolveWorkflowProfile(value);
  if (profile.id === "default") {
    return policy;
  }

  const raisedRiskClass = maxRisk(policy.riskClass, profile.riskFloor);
  const workflowSignal: RiskSignal = {
    name: `workflow-profile-${profile.id}`,
    severity: profile.riskFloor,
    reason: `${profile.label} workflow requires at least ${profile.riskFloor} risk handling.`
  };
  const signals = policy.signals.some((signal) => signal.name === workflowSignal.name)
    ? policy.signals
    : [...policy.signals, workflowSignal];
  const requiresManual =
    policy.approvalMode === "manual" ||
    profile.approval.requirePlanApproval ||
    profile.approval.requireDeliveryApproval ||
    raisedRiskClass !== "low";

  return {
    ...policy,
    riskClass: raisedRiskClass,
    riskScore: Math.max(policy.riskScore, riskRank[raisedRiskClass] * 2),
    signals,
    approvalMode: requiresManual ? "manual" : policy.approvalMode,
    interactive: requiresManual ? true : policy.interactive,
    pauseAfterPlan: requiresManual || profile.approval.requirePlanApproval ? true : policy.pauseAfterPlan,
    pauseAfterGenerate:
      policy.pauseAfterGenerate ||
      profile.approval.requireDeliveryApproval ||
      profile.id === "superpowers" ||
      profile.id === "strict-review",
    reason: appendWorkflowReason(policy.reason, profile)
  };
}

export function buildWorkflowEvidenceChecklist(value: unknown): ChecklistItem[] {
  const profile = resolveWorkflowProfile(value);
  return profile.evidenceChecklist.map((item) => ({
    id: item.id,
    text: item.text,
    required: item.required,
    status: "todo" as const,
    evidence: {
      type: "artifact" as const,
      ref: profile.id,
      metadata: {
        workflowProfile: profile.id,
        generatedBy: "workflow-profile"
      }
    }
  }));
}

export function mergeWorkflowEvidenceChecklist(items: ChecklistItem[], value: unknown): ChecklistItem[] {
  const additions = buildWorkflowEvidenceChecklist(value);
  if (additions.length === 0) {
    return items;
  }
  const existingIds = new Set(items.map((item) => item.id));
  return [...items, ...additions.filter((item) => !existingIds.has(item.id))];
}

function maxRisk(left: RiskClass, right: RiskClass): RiskClass {
  return riskRank[right] > riskRank[left] ? right : left;
}

function appendWorkflowReason(reason: string, profile: WorkflowProfile): string {
  const suffix = ` Workflow profile '${profile.id}' can tighten but not weaken risk, approval, or security gates.`;
  return reason.includes(`Workflow profile '${profile.id}'`) ? reason : `${reason}${suffix}`;
}
