import { balancedWorkflowProfile, defaultWorkflowProfile, fastFixWorkflowProfile, strictReviewWorkflowProfile } from "./profiles/default.js";
import { superpowersWorkflowProfile } from "./profiles/superpowers.js";
const riskRank = {
    low: 1,
    medium: 2,
    high: 3,
    blocked: 4
};
export const workflowProfiles = {
    default: defaultWorkflowProfile,
    "fast-fix": fastFixWorkflowProfile,
    balanced: balancedWorkflowProfile,
    superpowers: superpowersWorkflowProfile,
    "strict-review": strictReviewWorkflowProfile
};
export function parseWorkflowProfileId(value) {
    return typeof value === "string" && value in workflowProfiles
        ? value
        : undefined;
}
export function resolveWorkflowProfile(value) {
    return workflowProfiles[parseWorkflowProfileId(value) ?? "default"];
}
export function listWorkflowProfiles() {
    return Object.values(workflowProfiles);
}
export function applyWorkflowProfileToTask(task, value) {
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
export function tightenApprovalPolicyForProfile(policy, value) {
    const profile = resolveWorkflowProfile(value);
    if (profile.id === "default") {
        return policy;
    }
    const raisedRiskClass = maxRisk(policy.riskClass, profile.riskFloor);
    const workflowSignal = {
        name: `workflow-profile-${profile.id}`,
        severity: profile.riskFloor,
        reason: `${profile.label} workflow requires at least ${profile.riskFloor} risk handling.`
    };
    const signals = policy.signals.some((signal) => signal.name === workflowSignal.name)
        ? policy.signals
        : [...policy.signals, workflowSignal];
    const requiresManual = policy.approvalMode === "manual" ||
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
        pauseAfterGenerate: policy.pauseAfterGenerate ||
            profile.approval.requireDeliveryApproval ||
            profile.id === "superpowers" ||
            profile.id === "strict-review",
        reason: appendWorkflowReason(policy.reason, profile)
    };
}
export function buildWorkflowEvidenceChecklist(value) {
    const profile = resolveWorkflowProfile(value);
    return profile.evidenceChecklist.map((item) => ({
        id: item.id,
        text: item.text,
        required: item.required,
        status: "todo",
        evidence: {
            type: "artifact",
            ref: profile.id,
            metadata: {
                workflowProfile: profile.id,
                generatedBy: "workflow-profile"
            }
        }
    }));
}
export function mergeWorkflowEvidenceChecklist(items, value) {
    const additions = buildWorkflowEvidenceChecklist(value);
    if (additions.length === 0) {
        return items;
    }
    const existingIds = new Set(items.map((item) => item.id));
    return [...items, ...additions.filter((item) => !existingIds.has(item.id))];
}
function maxRisk(left, right) {
    return riskRank[right] > riskRank[left] ? right : left;
}
function appendWorkflowReason(reason, profile) {
    const suffix = ` Workflow profile '${profile.id}' can tighten but not weaken risk, approval, or security gates.`;
    return reason.includes(`Workflow profile '${profile.id}'`) ? reason : `${reason}${suffix}`;
}
