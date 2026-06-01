import type { RiskClass } from "../types.js";

export type WorkflowProfileId = "default" | "fast-fix" | "balanced" | "superpowers" | "strict-review";

export interface WorkflowEvidenceTemplate {
  id: string;
  text: string;
  required: boolean;
}

export interface WorkflowApprovalGates {
  requirePlanArtifact: boolean;
  requirePlanApproval: boolean;
  requireDeliveryApproval: boolean;
}

export interface WorkflowProfile {
  id: WorkflowProfileId;
  label: string;
  description: string;
  riskFloor: RiskClass;
  approval: WorkflowApprovalGates;
  promptBlock?: string;
  evidenceChecklist: WorkflowEvidenceTemplate[];
}
