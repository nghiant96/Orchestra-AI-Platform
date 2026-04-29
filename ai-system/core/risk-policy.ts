import type { ApprovalPolicyDecision, RiskClass, RiskSignal, RulesConfig } from "../types.js";

export interface RiskPolicyContext {
  changedPathCount?: number;
  generatedFileCount?: number;
  diffLineEstimate?: number;
}

export function resolveApprovalPolicy(
  task: string,
  rules: RulesConfig,
  targetPaths: string[] = [],
  context: RiskPolicyContext = {}
): ApprovalPolicyDecision {
  const signals = collectRiskSignals(task, targetPaths, context);
  const riskScore = signals.reduce((score, signal) => score + signalScore(signal.severity), 0);
  const riskClass = classifyRisk(signals, riskScore);
  const skipApproval = (rules as RulesConfig & { skip_approval?: boolean }).skip_approval === true;
  const blocked = riskClass === "blocked";
  const auto = (skipApproval || riskClass === "low") && !blocked;

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

function collectRiskSignals(task: string, targetPaths: string[], context: RiskPolicyContext): RiskSignal[] {
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

  if ((context.diffLineEstimate ?? 0) >= 250) {
    signals.push({
      name: "large-diff",
      severity: "high",
      reason: "Estimated changed line count is large enough to require stricter review."
    });
  }

  if ((context.generatedFileCount ?? 0) >= 8 || (context.changedPathCount ?? targetPaths.length) >= 8) {
    signals.push({
      name: "broad-file-scope",
      severity: "medium",
      reason: "The task touches many files, increasing review and regression risk."
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
  if (riskClass === "low") {
    return `Low-risk policy permits auto-run with standard checks. Matched signals: ${signalNames}.`;
  }
  return `Manual approval is the default for ${riskClass} risk. Matched signals: ${signalNames}.`;
}

function matchesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}
