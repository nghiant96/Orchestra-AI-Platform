import type { RulesConfig } from "../types.js";

export type RiskClass = "low" | "medium" | "high" | "blocked";

export interface RiskSignal {
  name: string;
  severity: RiskClass;
  reason: string;
}

export interface ApprovalPolicyDecision {
  riskClass: RiskClass;
  riskScore: number;
  signals: RiskSignal[];
  approvalMode: "auto" | "manual";
  interactive: boolean;
  pauseAfterPlan: boolean;
  pauseAfterGenerate: boolean;
  reason: string;
}

export function resolveApprovalPolicy(task: string, rules: RulesConfig, targetPaths: string[] = []): ApprovalPolicyDecision {
  const signals = collectRiskSignals(task, targetPaths);
  const riskScore = signals.reduce((score, signal) => score + signalScore(signal.severity), 0);
  const riskClass = classifyRisk(signals, riskScore);
  const skipApproval = (rules as RulesConfig & { skip_approval?: boolean }).skip_approval === true;
  const blocked = riskClass === "blocked";
  const auto = skipApproval && !blocked;

  return {
    riskClass,
    riskScore,
    signals,
    approvalMode: auto ? "auto" : "manual",
    interactive: !auto,
    pauseAfterPlan: !auto,
    pauseAfterGenerate: !auto && riskClass === "high",
    reason: buildPolicyReason(riskClass, skipApproval, signals)
  };
}

function collectRiskSignals(task: string, targetPaths: string[]): RiskSignal[] {
  const normalizedTask = normalize(task);
  const paths = targetPaths.map(normalize);
  const signals: RiskSignal[] = [];

  if (matchesAny(normalizedTask, ["secret", "token", "credential", "permission", "security", "vulnerability"])
    || paths.some((path) => /(\.env|secret|credential|permission|auth)/.test(path))) {
    signals.push({
      name: "security-sensitive",
      severity: "blocked",
      reason: "Task or target paths touch secrets, permissions, or security-sensitive behavior."
    });
  }

  if (matchesAny(normalizedTask, ["auth", "login", "payment", "billing", "migration", "database", "queue", "approval", "orchestrator"])
    || paths.some((path) => /(auth|payment|billing|migration|server-app|orchestrator|job-queue)/.test(path))) {
    signals.push({
      name: "critical-path",
      severity: "high",
      reason: "Task affects authentication, payments, migrations, queue, approval, or orchestration lifecycle."
    });
  }

  if (matchesAny(normalizedTask, ["package", "dependency", "pnpm-lock", "lockfile", "audit"])
    || paths.some((path) => /(package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json)/.test(path))) {
    signals.push({
      name: "dependency-change",
      severity: "high",
      reason: "Dependency or lockfile changes require stricter verification."
    });
  }

  if (matchesAny(normalizedTask, ["api", "schema", "payload", "response", "config"])
    || paths.some((path) => /(api|schema|config|\.ai-system\.json)/.test(path))) {
    signals.push({
      name: "contract-or-config",
      severity: "medium",
      reason: "Task may affect external contracts or operational configuration."
    });
  }

  if (signals.length === 0) {
    signals.push({
      name: "standard-change",
      severity: "low",
      reason: "No high-risk task or path signal matched."
    });
  }

  return signals;
}

function classifyRisk(signals: RiskSignal[], riskScore: number): RiskClass {
  if (signals.some((signal) => signal.severity === "blocked")) return "blocked";
  if (signals.some((signal) => signal.severity === "high") || riskScore >= 6) return "high";
  if (signals.some((signal) => signal.severity === "medium") || riskScore >= 3) return "medium";
  return "low";
}

function signalScore(severity: RiskClass): number {
  if (severity === "blocked") return 10;
  if (severity === "high") return 5;
  if (severity === "medium") return 3;
  return 1;
}

function buildPolicyReason(riskClass: RiskClass, skipApproval: boolean, signals: RiskSignal[]): string {
  const signalNames = signals.map((signal) => signal.name).join(", ");
  if (riskClass === "blocked") {
    return `Manual approval required because blocked risk signals matched: ${signalNames}.`;
  }
  if (skipApproval) {
    return `skip_approval=true permits auto-run for ${riskClass} risk. Matched signals: ${signalNames}.`;
  }
  return `Manual approval is the default for ${riskClass} risk. Matched signals: ${signalNames}.`;
}

function matchesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
