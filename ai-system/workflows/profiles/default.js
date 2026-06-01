export const defaultWorkflowProfile = {
    id: "default",
    label: "Default",
    description: "Current Orchestra behavior with risk-policy approval gates.",
    riskFloor: "low",
    approval: {
        requirePlanArtifact: false,
        requirePlanApproval: false,
        requireDeliveryApproval: false
    },
    evidenceChecklist: []
};
export const fastFixWorkflowProfile = {
    id: "fast-fix",
    label: "Fast Fix",
    description: "Small targeted fixes while preserving risk-policy approvals.",
    riskFloor: "low",
    approval: {
        requirePlanArtifact: false,
        requirePlanApproval: false,
        requireDeliveryApproval: false
    },
    promptBlock: [
        "Workflow profile: fast-fix.",
        "Keep the change narrowly scoped, verify the direct failure path, and avoid unrelated refactors."
    ].join("\n"),
    evidenceChecklist: [
        {
            id: "workflow-fast-fix-scope",
            text: "Scope stayed limited to the failing behavior.",
            required: true
        }
    ]
};
export const balancedWorkflowProfile = {
    id: "balanced",
    label: "Balanced",
    description: "Default implementation flow with explicit evidence capture.",
    riskFloor: "medium",
    approval: {
        requirePlanArtifact: true,
        requirePlanApproval: false,
        requireDeliveryApproval: false
    },
    promptBlock: [
        "Workflow profile: balanced.",
        "Capture a concrete plan, implement the smallest safe slice, and record verification evidence."
    ].join("\n"),
    evidenceChecklist: [
        {
            id: "workflow-balanced-plan",
            text: "Plan artifact or equivalent implementation outline was produced.",
            required: true
        },
        {
            id: "workflow-balanced-verification",
            text: "Verification command or manual evidence is recorded.",
            required: true
        }
    ]
};
export const strictReviewWorkflowProfile = {
    id: "strict-review",
    label: "Strict Review",
    description: "Review-heavy workflow for high-risk changes.",
    riskFloor: "high",
    approval: {
        requirePlanArtifact: true,
        requirePlanApproval: true,
        requireDeliveryApproval: true
    },
    promptBlock: [
        "Workflow profile: strict-review.",
        "Do not bypass approval, security, or verification gates. Treat the plan and delivery evidence as review artifacts."
    ].join("\n"),
    evidenceChecklist: [
        {
            id: "workflow-strict-plan-approval",
            text: "Plan approval is tied to an immutable artifact id/hash.",
            required: true
        },
        {
            id: "workflow-strict-delivery-approval",
            text: "Delivery approval is tied to final evidence.",
            required: true
        },
        {
            id: "workflow-strict-regression",
            text: "Regression verification covers the touched contract or behavior.",
            required: true
        }
    ]
};
