import type { RiskClass, RiskSignal, RulesConfig } from "../types.js";
import { resolveApprovalPolicy } from "../core/risk-policy.js";
import type { TaskAssessment, WorkItem } from "./work-item.js";

export function assessWorkItem(workItem: Pick<WorkItem, "title" | "description" | "projectId" | "type" | "source" | "expectedOutput" | "risk">, rules: RulesConfig): TaskAssessment {
  const taskText = [workItem.title, workItem.description, workItem.type, workItem.source, workItem.expectedOutput].filter(Boolean).join(" ");
  const approval = resolveApprovalPolicy(taskText, rules);
  const signals = approval.signals.map((signal) => ({
    name: signal.name,
    severity: signal.severity,
    reason: signal.reason
  })) as RiskSignal[];

  const complexity = determineComplexity(approval.riskClass, signals, taskText);
  const modelTier = complexity === "small" ? 0 : complexity === "medium" ? 1 : 2;
  const tokenBudget = complexity === "small" ? 250 : complexity === "medium" ? 1000 : 2500;
  const modelCallReason = modelTier === 0 ? "Deterministic fast path" : `Risk class ${approval.riskClass} requires model-assisted assessment`;

  return {
    complexity,
    risk: approval.riskClass,
    confidence: approval.riskClass === "low" ? 0.9 : approval.riskClass === "medium" ? 0.75 : 0.6,
    affectedAreas: inferAffectedAreas(taskText, signals),
    requiresBranch: approval.riskClass !== "low" || workItem.expectedOutput === "branch" || workItem.expectedOutput === "pull_request",
    requiresHumanApproval: approval.approvalMode === "manual",
    requiresFullTestSuite: approval.riskClass !== "low",
    tokenBudget,
    modelTier,
    modelCallReason,
    reason: approval.reason,
    signals
  };
}

function determineComplexity(risk: RiskClass, signals: RiskSignal[], taskText: string): "small" | "medium" | "large" {
  if (risk === "blocked" || signals.some((signal) => signal.severity === "high")) return "large";
  if (risk === "high") return "large";
  if (taskText.length > 180 || signals.some((signal) => signal.severity === "medium")) return "medium";
  return "small";
}

function inferAffectedAreas(taskText: string, signals: RiskSignal[]): string[] {
  const areas = new Set<string>();
  const normalized = taskText.toLowerCase();
  if (normalized.includes("auth") || normalized.includes("login")) areas.add("authentication");
  if (normalized.includes("api") || normalized.includes("endpoint")) areas.add("api");
  if (normalized.includes("test") || normalized.includes("spec")) areas.add("tests");
  if (normalized.includes("dashboard") || normalized.includes("ui") || normalized.includes("frontend")) areas.add("dashboard");
  for (const signal of signals) {
    if (signal.name === "dependency-change") areas.add("dependencies");
    if (signal.name === "critical-path") areas.add("core-workflow");
    if (signal.name === "contract-or-config") areas.add("contracts");
  }
  return [...areas];
}
