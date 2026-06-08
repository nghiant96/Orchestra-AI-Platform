import fs from "node:fs/promises";
import path from "node:path";
import type { DiffSummary, ToolExecutionResult } from "../types.js";

export type WorkerTaskPhaseKind = "setup" | "implementation" | "verification";

export interface WorkerTaskPhase {
  id: string;
  index: number;
  kind: WorkerTaskPhaseKind;
  title: string;
  goal: string;
  prompt: string;
}

export interface WorkerTaskPhaseStatus {
  id: string;
  index: number;
  kind: WorkerTaskPhaseKind;
  title: string;
  goal: string;
  status: "pending" | "running" | "completed" | "failed";
  startedAt?: string;
  completedAt?: string;
  summary?: string;
  changedFiles?: string[];
  diffSummaries?: DiffSummary[];
  latestToolResults?: ToolExecutionResult[];
  artifactPath?: string | null;
  error?: string;
}

export interface WorkerTaskPhaseState {
  version: 1;
  jobId: string;
  task: string;
  generatedAt: string;
  updatedAt: string;
  currentPhaseId: string | null;
  phases: WorkerTaskPhaseStatus[];
}

export interface WorkerTaskPhasePlan {
  task: string;
  generatedAt: string;
  phases: WorkerTaskPhase[];
}

export type WorkerContextPackMode = "off" | "auto" | "required";

export function buildWorkerTaskPhasePlan(task: string, options: {
  contextPackMode?: WorkerContextPackMode;
  workflowProfile?: string;
} = {}): WorkerTaskPhasePlan {
  const trimmed = task.trim();
  const clauses = extractTaskClauses(trimmed);
  const implementationClauses = clauses.length > 1 ? clauses : (trimmed.length > 180 ? splitLongTask(trimmed) : [trimmed]);
  const implementationPhaseTexts = implementationClauses.length > 1 ? implementationClauses : [trimmed];
  const phases: WorkerTaskPhase[] = [];

  const needsSetupPhase = shouldCreateSetupPhase({
    task: trimmed,
    implementationPhaseCount: implementationPhaseTexts.length,
    contextPackMode: options.contextPackMode ?? resolveWorkerContextPackMode(),
    workflowProfile: options.workflowProfile || process.env.ORCHESTRA_WORKFLOW_PROFILE || process.env.AI_SYSTEM_WORKFLOW_PROFILE
  });
  if (needsSetupPhase) {
    phases.push(createPhase({
      index: phases.length,
      kind: "setup",
      title: "Plan and inspect the change surface",
      goal: "Read the repository, identify the files and implementation boundaries, and prepare a concise execution plan before making invasive edits.",
      task: trimmed,
      details: [
        "Focus on understanding the current architecture and the smallest safe surface area.",
        "Do not overfit the plan; the goal is to make the later implementation phases narrower and safer."
      ]
    }));
  }

  implementationPhaseTexts.forEach((phaseText, index) => {
    phases.push(createPhase({
      index: phases.length,
      kind: "implementation",
      title: `Implement task slice ${index + 1}`,
      goal: phaseText,
      task: trimmed,
      details: [
        "Limit the work to this slice of the task.",
        "Prefer the smallest coherent change set that moves this slice to completion."
      ]
    }));
  });

  phases.push(createPhase({
    index: phases.length,
    kind: "verification",
    title: "Verify and polish the result",
    goal: "Run or tighten the most relevant checks for the changes made in the earlier phases, then fix any obvious issues that would block mergeability.",
    task: trimmed,
    details: [
      "Keep the verification targeted to the changed surface area.",
      "If there are small polish issues, fix them now rather than deferring them."
    ]
  }));

  const plan = {
    task: trimmed,
    generatedAt: new Date().toISOString(),
    phases
  };

  return finalizePlan(plan);
}

export function resolveWorkerContextPackMode(value = process.env.ORCHESTRA_CONTEXT_PACK_MODE): WorkerContextPackMode {
  const normalized = value?.trim().toLowerCase();
  return normalized === "off" || normalized === "required" || normalized === "auto" ? normalized : "auto";
}

export function shouldCreateSetupPhase(input: {
  task: string;
  implementationPhaseCount: number;
  contextPackMode?: WorkerContextPackMode;
  workflowProfile?: string;
}): boolean {
  const mode = input.contextPackMode ?? "auto";
  if (mode === "off") return false;
  if (mode === "required") return true;

  const task = input.task.trim();
  return (
    task.length > 220 ||
    input.implementationPhaseCount > 2 ||
    isStrictWorkflowProfile(input.workflowProfile) ||
    isHighRiskContextPackTask(task)
  );
}

export async function loadWorkerTaskPhaseState(artifactDir: string): Promise<WorkerTaskPhaseState | null> {
  try {
    const raw = await fs.readFile(path.join(artifactDir, "phase-state.json"), "utf8");
    const parsed = JSON.parse(raw) as WorkerTaskPhaseState;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.phases)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function saveWorkerTaskPhaseState(artifactDir: string, state: WorkerTaskPhaseState): Promise<void> {
  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(path.join(artifactDir, "phase-state.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function createWorkerTaskPhaseState(jobId: string, plan: WorkerTaskPhasePlan): WorkerTaskPhaseState {
  return {
    version: 1,
    jobId,
    task: plan.task,
    generatedAt: plan.generatedAt,
    updatedAt: new Date().toISOString(),
    currentPhaseId: null,
    phases: plan.phases.map((phase) => ({
      id: phase.id,
      index: phase.index,
      kind: phase.kind,
      title: phase.title,
      goal: phase.goal,
      status: "pending"
    }))
  };
}

export function ensureWorkerTaskPhaseState(
  jobId: string,
  task: string,
  existing: WorkerTaskPhaseState | null,
  options: {
    contextPackMode?: WorkerContextPackMode;
    workflowProfile?: string;
  } = {}
): { plan: WorkerTaskPhasePlan; state: WorkerTaskPhaseState } {
  if (existing) {
    const plan = finalizePlan({
      task: existing.task,
      generatedAt: existing.generatedAt,
      phases: existing.phases.map((phase) => ({
        id: phase.id,
        index: phase.index,
        kind: phase.kind,
        title: phase.title,
        goal: phase.goal,
        prompt: ""
      }))
    });
    return { plan, state: existing };
  }

  const plan = buildWorkerTaskPhasePlan(task, options);
  const state = createWorkerTaskPhaseState(jobId, plan);
  return {
    plan,
    state
  };
}

export function buildPhasePrompt(input: {
  task: string;
  totalPhases: number;
  phase: WorkerTaskPhaseStatus | WorkerTaskPhase;
}): string {
  const completedPhaseCount = input.phase.index;
  const phaseCount = input.totalPhases;
  const phaseGoal = input.phase.goal.trim();

  const lines = [
    `You are executing phase ${input.phase.index + 1}/${phaseCount} of an Orchestra worker job.`,
    `Phase title: ${input.phase.title}`,
    `Phase kind: ${input.phase.kind}`,
    "",
    "Work only on this phase.",
    completedPhaseCount > 0
      ? "Earlier phases may already have modified the worktree. Continue from the current state instead of restarting the whole task."
      : "This is the first phase. Make the smallest safe change set that fits this slice.",
    "",
    `Original task: ${input.task}`,
    `Phase goal: ${phaseGoal}`,
    "",
    "Rules:",
    "- Do not drift into later phases unless they are required to complete this slice.",
    "- Keep the repository in a coherent state when you finish.",
    "- Prefer targeted edits and deterministic verification."
  ];

  if (input.phase.kind === "setup") {
    lines.push(
      "",
      "Setup phase required output:",
      "At the end of this phase, produce a JSON block named ORCHESTRA_CONTEXT_PACK.",
      "The block must be valid JSON and include these fields:",
      "- summary",
      "- relevantFiles: array of { path, reason, status, role }",
      "- allowedDiffBoundary: array of file paths or glob-like patterns",
      "- doNotTouch: array of file paths or glob-like patterns",
      "- conventions",
      "- implementationPlan",
      "- verificationCommands",
      "- assumptions",
      "- missingContextWarnings",
      "- confidence: low, medium, or high",
      "",
      "Use this exact shape:",
      "ORCHESTRA_CONTEXT_PACK:",
      "{",
      "  \"summary\": \"...\",",
      "  \"relevantFiles\": [",
      "    { \"path\": \"src/example.ts\", \"reason\": \"Why this file matters\", \"status\": \"existing\", \"role\": \"unknown\" }",
      "  ],",
      "  \"allowedDiffBoundary\": [\"src/**\", \"tests/**\"],",
      "  \"doNotTouch\": [],",
      "  \"conventions\": { \"notes\": [] },",
      "  \"implementationPlan\": [],",
      "  \"verificationCommands\": [],",
      "  \"assumptions\": [],",
      "  \"missingContextWarnings\": [],",
      "  \"confidence\": \"medium\"",
      "}"
    );
  }

  return lines.join("\n");
}

export function updateWorkerTaskPhaseStateForStart(state: WorkerTaskPhaseState, phaseId: string): WorkerTaskPhaseState {
  const updatedAt = new Date().toISOString();
  return {
    ...state,
    updatedAt,
    currentPhaseId: phaseId,
    phases: state.phases.map((phase) => phase.id === phaseId
      ? {
          ...phase,
          status: "running",
          startedAt: phase.startedAt ?? updatedAt,
          error: undefined
        }
      : phase)
  };
}

export function updateWorkerTaskPhaseStateForCompletion(
  state: WorkerTaskPhaseState,
  phaseId: string,
  result: {
    summary: string;
    changedFiles: string[];
    diffSummaries?: DiffSummary[];
    latestToolResults?: ToolExecutionResult[];
    artifactPath?: string | null;
  }
): WorkerTaskPhaseState {
  const now = new Date().toISOString();
  return {
    ...state,
    updatedAt: now,
    currentPhaseId: null,
    phases: state.phases.map((phase) => phase.id === phaseId
      ? {
          ...phase,
          status: "completed",
          completedAt: now,
          summary: result.summary,
          changedFiles: result.changedFiles,
          diffSummaries: result.diffSummaries,
          latestToolResults: result.latestToolResults,
          artifactPath: result.artifactPath,
          error: undefined
        }
      : phase)
  };
}

export function updateWorkerTaskPhaseStateForFailure(
  state: WorkerTaskPhaseState,
  phaseId: string,
  error: string
): WorkerTaskPhaseState {
  const now = new Date().toISOString();
  return {
    ...state,
    updatedAt: now,
    currentPhaseId: phaseId,
    phases: state.phases.map((phase) => phase.id === phaseId
      ? {
          ...phase,
          status: "failed",
          error,
          completedAt: now
        }
      : phase)
  };
}

export function getWorkerTaskPhaseResumeIndex(state: WorkerTaskPhaseState): number {
  const runningIndex = state.phases.findIndex((phase) => phase.status === "running");
  if (runningIndex >= 0) {
    return runningIndex;
  }
  const firstIncomplete = state.phases.findIndex((phase) => phase.status !== "completed");
  return firstIncomplete >= 0 ? firstIncomplete : state.phases.length;
}

function createPhase(input: {
  index: number;
  kind: WorkerTaskPhaseKind;
  title: string;
  goal: string;
  task: string;
  details: string[];
}): WorkerTaskPhase {
  return {
    id: `${input.kind}-${String(input.index + 1).padStart(2, "0")}-${slugify(input.title)}`,
    index: input.index,
    kind: input.kind,
    title: input.title,
    goal: [input.goal, ...input.details].join("\n"),
    prompt: ""
  };
}

function finalizePlan(plan: WorkerTaskPhasePlan): WorkerTaskPhasePlan {
  return {
    ...plan,
    phases: plan.phases.map((phase) => ({
      ...phase,
      prompt: buildPhasePrompt({
        task: plan.task,
        totalPhases: plan.phases.length,
        phase
      })
    }))
  };
}

function extractTaskClauses(task: string): string[] {
  const normalized = task.replace(/\r\n/g, "\n");
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^[-*]\s+$/.test(line));

  const bulletClauses = lines
    .filter((line) => /^[-*]\s+/.test(line) || /^\d+[.)]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+|^\d+[.)]\s+/, "").trim())
    .filter(Boolean);

  if (bulletClauses.length >= 2) {
    return bulletClauses;
  }

  const splitClauses = normalized
    .split(/(?:\n+|(?:\s+(?:and|và|then|sau đó|after đó|after that|also)\s+))/i)
    .map((part) => part.replace(/^[,;:\-\u2022\s]+|[,;:\-\u2022\s]+$/g, "").trim())
    .filter((part) => part.length > 24);

  if (splitClauses.length >= 2) {
    return splitClauses;
  }

  return [task];
}

function splitLongTask(task: string): string[] {
  const sentences = task
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (sentences.length >= 2) {
    return sentences;
  }

  const midpoint = Math.max(1, Math.floor(task.length / 2));
  return [task.slice(0, midpoint).trim(), task.slice(midpoint).trim()].filter(Boolean);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "phase";
}

function isStrictWorkflowProfile(value: string | undefined): boolean {
  return /^(strict|superpowers|safe)$/i.test(value?.trim() ?? "");
}

function isHighRiskContextPackTask(task: string): boolean {
  return /\b(integrate|integration|sdk|api|refactor|migration|migrate|auth|permission|payment|billing|security|backend|frontend|database|schema|worker|queue|route|endpoint|webhook)\b/i.test(task);
}
