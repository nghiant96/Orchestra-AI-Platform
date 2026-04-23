import type {
  ExecutionStage,
  ExecutionStepStatus,
  ExecutionStepSummary,
  ExecutionSummary,
  ExecutionTransition,
  ExecutionTransitionStatus
} from "../types.js";

type TransitionListener = (transition: ExecutionTransition) => Promise<void> | void;

function createTransition(
  stage: ExecutionStage,
  status: ExecutionTransitionStatus,
  detail?: string,
  durationMs?: number,
  iteration?: number,
  metadata?: Record<string, unknown>
): ExecutionTransition {
  return {
    stage,
    status,
    timestamp: new Date().toISOString(),
    ...(typeof durationMs === "number" ? { durationMs: Math.max(0, Math.round(durationMs)) } : {}),
    ...(detail ? { detail } : {}),
    ...(typeof iteration === "number" ? { iteration } : {}),
    ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {})
  };
}

function isTerminalTransitionStatus(status: ExecutionTransitionStatus): status is ExecutionStepStatus | "cancelled" {
  return status !== "entered";
}

function normalizeStepStatus(status: ExecutionTransitionStatus): ExecutionStepStatus {
  if (status === "cancelled") {
    return "paused";
  }
  if (status === "entered") {
    return "completed";
  }
  return status;
}

function deriveStepsFromTransitions(transitions: ExecutionTransition[]): ExecutionStepSummary[] {
  return transitions
    .filter((transition) => isTerminalTransitionStatus(transition.status))
    .map((transition) => ({
      name:
        typeof transition.iteration === "number" && transition.stage.startsWith("iteration-")
          ? `${transition.stage}-${transition.iteration}`
          : transition.stage,
      durationMs: transition.durationMs ?? 0,
      status: normalizeStepStatus(transition.status),
      ...(transition.detail ? { detail: transition.detail } : {})
    }));
}

function deriveCurrentStage(transitions: ExecutionTransition[]): ExecutionStage | null {
  let currentStage: ExecutionStage | null = null;
  for (const transition of transitions) {
    if (transition.status === "entered") {
      currentStage = transition.stage;
      continue;
    }
    if (currentStage === transition.stage) {
      currentStage = null;
    }
  }
  return currentStage;
}

export class ExecutionStateMachine {
  private transitions: ExecutionTransition[];
  private steps: ExecutionStepSummary[];
  private currentStage: ExecutionStage | null;
  private readonly onTransition?: TransitionListener;

  constructor({
    summary,
    onTransition
  }: {
    summary?: ExecutionSummary | null;
    onTransition?: TransitionListener;
  } = {}) {
    const existingTransitions = Array.isArray(summary?.transitions) ? summary.transitions.map((entry) => ({ ...entry })) : [];
    this.transitions = existingTransitions;
    this.steps =
      Array.isArray(summary?.steps) && summary.steps.length > 0
        ? summary.steps.map((entry) => ({ ...entry }))
        : deriveStepsFromTransitions(existingTransitions);
    this.currentStage = summary?.currentStage ?? deriveCurrentStage(existingTransitions);
    this.onTransition = onTransition;
  }

  getCurrentStage(): ExecutionStage | null {
    return this.currentStage;
  }

  getTransitions(): ExecutionTransition[] {
    return this.transitions.map((entry) => ({ ...entry }));
  }

  getSteps(): ExecutionStepSummary[] {
    return this.steps.map((entry) => ({ ...entry }));
  }

  async enterStage(
    stage: ExecutionStage,
    {
      detail,
      iteration,
      metadata
    }: { detail?: string; iteration?: number; metadata?: Record<string, unknown> } = {}
  ): Promise<void> {
    if (this.currentStage && this.currentStage !== stage) {
      throw new Error(`Cannot enter stage ${stage} while ${this.currentStage} is still active.`);
    }
    if (this.currentStage === stage) {
      return;
    }
    const transition = createTransition(stage, "entered", detail, undefined, iteration, metadata);
    this.transitions.push(transition);
    this.currentStage = stage;
    await this.onTransition?.(transition);
  }

  async finishStage(
    stage: ExecutionStage,
    status: Exclude<ExecutionTransitionStatus, "entered">,
    {
      durationMs,
      detail,
      iteration,
      metadata
    }: { durationMs?: number; detail?: string; iteration?: number; metadata?: Record<string, unknown> } = {}
  ): Promise<void> {
    if (this.currentStage && this.currentStage !== stage) {
      throw new Error(`Cannot finish stage ${stage} while ${this.currentStage} is active.`);
    }
    const transition = createTransition(stage, status, detail, durationMs, iteration, metadata);
    this.transitions.push(transition);
    this.steps.push({
      name: typeof iteration === "number" && stage.startsWith("iteration-") ? `${stage}-${iteration}` : stage,
      durationMs: transition.durationMs ?? 0,
      status: normalizeStepStatus(status),
      ...(detail ? { detail } : {})
    });
    this.currentStage = null;
    await this.onTransition?.(transition);
  }

  async completeStage(
    stage: ExecutionStage,
    options: { durationMs?: number; detail?: string; iteration?: number; metadata?: Record<string, unknown> } = {}
  ): Promise<void> {
    await this.finishStage(stage, "completed", options);
  }

  async failStage(
    stage: ExecutionStage,
    options: { durationMs?: number; detail?: string; iteration?: number; metadata?: Record<string, unknown> } = {}
  ): Promise<void> {
    await this.finishStage(stage, "failed", options);
  }

  async pauseStage(
    stage: ExecutionStage,
    options: { durationMs?: number; detail?: string; iteration?: number; metadata?: Record<string, unknown> } = {}
  ): Promise<void> {
    await this.finishStage(stage, "paused", options);
  }

  async skipStage(
    stage: ExecutionStage,
    options: { durationMs?: number; detail?: string; iteration?: number; metadata?: Record<string, unknown> } = {}
  ): Promise<void> {
    await this.finishStage(stage, "skipped", options);
  }

  async cancelStage(
    stage: ExecutionStage,
    options: { durationMs?: number; detail?: string; iteration?: number; metadata?: Record<string, unknown> } = {}
  ): Promise<void> {
    await this.finishStage(stage, "cancelled", options);
  }

  async runStage<T>(
    stage: ExecutionStage,
    action: () => Promise<T>,
    {
      detail,
      iteration,
      metadata
    }: { detail?: string; iteration?: number; metadata?: Record<string, unknown> } = {}
  ): Promise<{ result: T; durationMs: number }> {
    await this.enterStage(stage, { detail, iteration, metadata });
    const startedAt = Date.now();
    try {
      const result = await action();
      const durationMs = Date.now() - startedAt;
      await this.completeStage(stage, { durationMs, detail, iteration, metadata });
      return { result, durationMs };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const normalized = error as Error;
      await this.failStage(stage, {
        durationMs,
        detail: normalized.message,
        iteration,
        metadata
      });
      throw error;
    }
  }
}
