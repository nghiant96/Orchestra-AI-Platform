export const superpowersWorkflowProfile = {
    id: "superpowers",
    label: "Superpowers",
    description: "Hermes Superpowers methodology with explicit plan, evidence, review, and lesson hooks.",
    riskFloor: "high",
    approval: {
        requirePlanArtifact: true,
        requirePlanApproval: true,
        requireDeliveryApproval: true
    },
    promptBlock: [
        "Workflow profile: superpowers.",
        "Follow the Hermes Superpowers method:",
        "1. Produce a concrete plan artifact before mutation.",
        "2. Wait for plan approval when approval policy requires it.",
        "3. Preserve approval and security gates; routing or execution mode must not bypass them.",
        "4. Capture evidence for changed files, checks, review findings, and delivery readiness.",
        "5. Require final delivery approval before treating the work as ready."
    ].join("\n"),
    evidenceChecklist: [
        {
            id: "workflow-superpowers-plan-artifact",
            text: "Plan artifact exists and is referenced by id/hash.",
            required: true
        },
        {
            id: "workflow-superpowers-plan-approval",
            text: "Plan approval is recorded with approver, source, confirmation id, and artifact hash.",
            required: true
        },
        {
            id: "workflow-superpowers-changed-files",
            text: "Changed files and final diff summary are recorded.",
            required: true
        },
        {
            id: "workflow-superpowers-verification",
            text: "Relevant checks, commands, or manual verification evidence are recorded.",
            required: true
        },
        {
            id: "workflow-superpowers-delivery-approval",
            text: "Delivery approval is recorded against final evidence before handoff.",
            required: true
        },
        {
            id: "workflow-superpowers-lesson",
            text: "Reusable lesson is available for completed or failed work.",
            required: false
        }
    ]
};
