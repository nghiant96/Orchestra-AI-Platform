import fs from "node:fs/promises";
import path from "node:path";
import type {
  ArtifactSummary,
  ContextFile,
  ExecutionTransition,
  ExecutionSummary,
  FileGenerationResult,
  IterationResult,
  Logger,
  ContextSelectionCandidate,
  PlanResult,
  ProviderSummary,
  RoutingDecision,
  ToolExecutionResult,
  VectorSearchMatch,
  RunStatus,
  RulesConfig
} from "../types.js";
import { buildExecutionSummary } from "./execution-summary.js";
import { summarizeIssueCounts } from "./reviewer.js";
import { readJsonIfExists, createRunDirectoryName } from "./artifact-utils.js";
import type {
  ArtifactState,
  ApplyEventRecord,
  RecentRunSummary
} from "./artifact-types.ts";

export function createArtifactState(repoRoot: string, rules: RulesConfig): ArtifactState {
  const config = rules.artifacts ?? {};
  return {
    enabled: config.enabled !== false,
    repoRoot,
    baseDir: path.join(repoRoot, config.data_dir ?? ".ai-system-artifacts"),
    runDir: null,
    latestIterationPath: null,
    stepPaths: {}
  };
}

export function restoreArtifactState(
  repoRoot: string,
  rules: RulesConfig,
  savedArtifacts: ArtifactSummary | null | undefined,
  statePath: string
): ArtifactState {
  const state = createArtifactState(repoRoot, rules);
  const runPath = savedArtifacts?.runPath ? path.resolve(savedArtifacts.runPath) : path.dirname(path.resolve(statePath));

  state.runDir = runPath;
  state.latestIterationPath = savedArtifacts?.latestIterationPath ? path.resolve(savedArtifacts.latestIterationPath) : null;
  state.stepPaths = normalizeStepPaths(savedArtifacts?.stepPaths ?? {}, runPath);
  ensureArtifactVisibilityPaths(state);
  return state;
}

export async function persistPlanArtifacts(
  state: ArtifactState,
  payload: {
    task: string;
    rawPlan: unknown;
    plan: PlanResult;
    vectorMatches?: VectorSearchMatch[];
    rankedCandidates?: ContextSelectionCandidate[];
    provider: string;
    durationMs?: number;
    externalTask?: import("../types.js").ExternalTaskRef;
    refactorAnalysis?: import("../types.js").RefactorAnalysis;
  },
  logger?: Logger
): Promise<string | null> {
  if (!state.enabled) {
    return null;
  }

  const stepPath = await ensureArtifactStepDirectory(state, "01-plan");
  ensureArtifactVisibilityPaths(state);
  const manifest = {
    savedAt: new Date().toISOString(),
    provider: payload.provider,
    task: payload.task,
    rawPlan: payload.rawPlan,
    normalizedPlan: payload.plan,
    vectorMatches: payload.vectorMatches ?? [],
    rankedCandidates: payload.rankedCandidates ?? [],
    externalTask: payload.externalTask,
    refactorAnalysis: payload.refactorAnalysis
  };
  await fs.writeFile(path.join(stepPath, "plan.json"), JSON.stringify(manifest, null, 2), "utf8");
  state.stepPaths.plan = stepPath;
  await appendArtifactTimeline(state, {
    step: "01-plan",
    status: "saved",
    message: "Planner checkpoint persisted.",
    task: payload.task,
    provider: payload.provider,
    artifactPath: stepPath,
    durationMs: payload.durationMs
  });
  await writeArtifactIndex(state, {
    latestStep: "01-plan",
    latestTask: payload.task,
    latestProvider: payload.provider,
    latestVectorMatches: payload.vectorMatches ?? [],
    latestContextRanking: payload.rankedCandidates ?? [],
    externalTask: payload.externalTask
  });
  logger?.info(`Saved planner checkpoint at ${stepPath}`);
  return stepPath;
}

export async function persistRoutingArtifacts(
  state: ArtifactState,
  payload: {
    stage: RoutingDecision["stage"];
    task: string;
    decision: RoutingDecision;
    durationMs?: number;
  },
  logger?: Logger
): Promise<string | null> {
  if (!state.enabled) {
    return null;
  }

  const stepPath = await ensureArtifactStepDirectory(state, "00-routing");
  ensureArtifactVisibilityPaths(state);
  const filePath = path.join(stepPath, `${payload.stage}.json`);
  await fs.writeFile(
    filePath,
    JSON.stringify(
      {
        savedAt: new Date().toISOString(),
        stage: payload.stage,
        task: payload.task,
        decision: payload.decision
      },
      null,
      2
    ),
    "utf8"
  );
  state.stepPaths[`routing-${payload.stage}`] = filePath;
  await appendArtifactTimeline(state, {
    step: `routing-${payload.stage}`,
    status: "saved",
    message: `Routing decision persisted for ${payload.stage}.`,
    task: payload.task,
    artifactPath: filePath,
    durationMs: payload.durationMs,
    metadata: {
      profile: payload.decision.profile,
      appliedRoles: payload.decision.appliedRoles
    }
  });
  await writeArtifactIndex(state, {
    latestStep: `routing-${payload.stage}`,
    latestTask: payload.task
  });
  logger?.info(`Saved ${payload.stage} routing decision at ${filePath}`);
  return filePath;
}

export async function persistContextArtifacts(
  state: ArtifactState,
  payload: { readFiles: string[]; skippedFiles: string[]; contexts: ContextFile[]; durationMs?: number },
  logger?: Logger
): Promise<string | null> {
  if (!state.enabled) {
    return null;
  }

  const stepPath = await ensureArtifactStepDirectory(state, "02-context");
  ensureArtifactVisibilityPaths(state);
  const filesRoot = path.join(stepPath, "files");
  await fs.mkdir(filesRoot, { recursive: true });

  for (const context of payload.contexts) {
    const targetPath = path.join(filesRoot, context.path);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, context.content, "utf8");
  }

  const manifest = {
    savedAt: new Date().toISOString(),
    readFiles: payload.readFiles,
    skippedFiles: payload.skippedFiles,
    savedFiles: payload.contexts.map((context) => context.path)
  };
  await fs.writeFile(path.join(stepPath, "context.json"), JSON.stringify(manifest, null, 2), "utf8");
  state.stepPaths.context = stepPath;
  await appendArtifactTimeline(state, {
    step: "02-context",
    status: "saved",
    message: `Context checkpoint persisted with ${payload.contexts.length} file(s).`,
    artifactPath: stepPath,
    durationMs: payload.durationMs,
    metadata: {
      readFiles: payload.readFiles,
      skippedFiles: payload.skippedFiles
    }
  });
  await writeArtifactIndex(state, {
    latestStep: "02-context"
  });
  logger?.info(`Saved context checkpoint at ${stepPath}`);
  return stepPath;
}

export async function persistIterationArtifacts(
  state: ArtifactState,
  payload: {
    iteration: number;
    task: string;
    dryRun: boolean;
    plan: PlanResult;
    provider: string;
    resultSummary: string;
    candidateFiles: Array<{ path: string; content: string; action?: string }>;
    originalFiles: Array<{ path: string; content?: string | null }>;
    diffSummaries: unknown;
    toolResults?: ToolExecutionResult[];
    preReviewIssues: unknown;
    reviewSummary: string;
    issues: import("../types.js").ReviewIssue[];
    durationMs?: number;
  },
  logger?: Logger
): Promise<{ iterationPath: string; manifestPath: string } | null> {
  if (!state.enabled) {
    return null;
  }

  if (!state.runDir) {
    state.runDir = path.join(state.baseDir, createRunDirectoryName());
  }
  ensureArtifactVisibilityPaths(state);

  const iterationPath = path.join(state.runDir, `iteration-${payload.iteration}`);
  const filesRoot = path.join(iterationPath, "files");
  const originalFilesRoot = path.join(iterationPath, "files-original");
  await fs.mkdir(filesRoot, { recursive: true });
  await fs.mkdir(originalFilesRoot, { recursive: true });

  for (const file of payload.candidateFiles) {
    const targetPath = path.join(filesRoot, file.path);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, file.content, "utf8");
  }

  for (const file of payload.originalFiles) {
    if (file.content !== null && file.content !== undefined) {
      const targetPath = path.join(originalFilesRoot, file.path);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, file.content, "utf8");
    }
  }

  const manifest = {
    iteration: payload.iteration,
    task: payload.task,
    dryRun: payload.dryRun,
    savedAt: new Date().toISOString(),
    provider: payload.provider,
    plan: {
      prompt: payload.plan.prompt,
      readFiles: payload.plan.readFiles,
      writeTargets: payload.plan.writeTargets,
      notes: payload.plan.notes,
      contracts: payload.plan.contracts ?? []
    },
    resultSummary: payload.resultSummary,
    candidateFiles: payload.candidateFiles.map((file) => ({
      path: file.path,
      action: file.action
    })),
    originalFiles: payload.originalFiles.map((file) => ({
      path: file.path,
      existed: file.content !== null
    })),
    diffSummaries: payload.diffSummaries,
    toolResults: payload.toolResults ?? [],
    preReviewIssues: payload.preReviewIssues,
    reviewSummary: payload.reviewSummary,
    issues: payload.issues,
    durationMs: payload.durationMs ?? 0
  };

  const manifestPath = path.join(iterationPath, "manifest.json");
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  state.latestIterationPath = iterationPath;
  state.stepPaths[`iteration-${payload.iteration}`] = iterationPath;
  await appendArtifactTimeline(state, {
    step: `iteration-${payload.iteration}`,
    status: "saved",
    message: `Iteration ${payload.iteration} artifacts persisted.`,
    task: payload.task,
    provider: payload.provider,
    iteration: payload.iteration,
    artifactPath: iterationPath,
    durationMs: payload.durationMs,
    metadata: {
      candidateFiles: payload.candidateFiles.map((file) => file.path),
      issueCount: payload.issues.length
    }
  });
  await writeArtifactIndex(state, {
    latestStep: `iteration-${payload.iteration}`,
    latestTask: payload.task,
    latestProvider: payload.provider,
    latestFiles: payload.candidateFiles.map((file) => file.path)
  });
  logger?.info(`Saved candidate artifacts for manual review at ${iterationPath}`);
  return { iterationPath, manifestPath };
}

export async function persistRunState(
  state: ArtifactState,
  payload: {
    ok?: boolean;
    status?: string;
    task: string;
    dryRun: boolean;
    repoRoot: string;
    configPath: string | null;
    plan: PlanResult;
    result: FileGenerationResult | null;
    iterations?: IterationResult[];
    skippedContextFiles?: string[];
    finalIssues?: import("../types.js").ReviewIssue[];
    issueCounts?: Record<string, number>;
    providers: ProviderSummary;
    memory: import("../types.js").MemoryStats;
    artifacts?: ArtifactSummary | null;
    wroteFiles?: boolean;
    diffSummaries?: import("../types.js").DiffSummary[];
    pauseAfterPlan?: boolean;
    pauseAfterGenerate?: boolean;
    latestReviewSummary?: string;
    latestToolResults?: ToolExecutionResult[];
    latestVectorMatches?: VectorSearchMatch[];
    latestContextRanking?: ContextSelectionCandidate[];
    execution?: ExecutionSummary | null;
    approvalPolicy?: import("../types.js").ApprovalPolicyDecision | null;
    executionSteps?: import("../types.js").ExecutionStepSummary[];
    executionTransitions?: ExecutionTransition[];
    externalTask?: import("../types.js").ExternalTaskRef;
    externalUpdatePreviews?: import("../types.js").ExternalTaskUpdatePreview[];
    refactorAnalysis?: import("../types.js").RefactorAnalysis;
  },
  logger?: Logger
): Promise<string | null> {
  if (!state.enabled || !state.runDir) {
    return null;
  }

  const statePath = path.join(state.runDir, "run-state.json");
  ensureArtifactVisibilityPaths(state);
  state.stepPaths.runState = statePath;
  const existingIndex = state.stepPaths.index
    ? await readJsonIfExists<RecentRunSummary["artifactIndex"]>(state.stepPaths.index)
    : null;
  const explicitVectorMatches = payload.latestVectorMatches;
  const explicitContextRanking = payload.latestContextRanking;
  const artifactVectorMatches =
    Array.isArray(payload.artifacts?.latestVectorMatches) && payload.artifacts.latestVectorMatches.length > 0
      ? payload.artifacts.latestVectorMatches
      : undefined;
  const artifactContextRanking =
    Array.isArray(payload.artifacts?.latestContextRanking) && payload.artifacts.latestContextRanking.length > 0
      ? payload.artifacts.latestContextRanking
      : undefined;
  const effectiveVectorMatches = explicitVectorMatches ?? artifactVectorMatches ?? existingIndex?.latestVectorMatches ?? [];
  const effectiveContextRanking =
    explicitContextRanking ?? artifactContextRanking ?? existingIndex?.latestContextRanking ?? [];
  const serializable = {
    version: 1,
    status: payload.status ?? (payload.ok ? "completed" : "failed"),
    task: payload.task,
    dryRun: payload.dryRun,
    repoRoot: payload.repoRoot,
    configPath: payload.configPath,
    plan: payload.plan,
    result: payload.result,
    iterations: payload.iterations ?? [],
    skippedContextFiles: payload.skippedContextFiles ?? [],
    finalIssues: payload.finalIssues ?? [],
    issueCounts: payload.issueCounts ?? summarizeIssueCounts(payload.finalIssues ?? []),
    providers: payload.providers,
    memory: payload.memory,
    artifacts:
      payload.artifacts ??
      finalizeArtifactState(
        state,
        payload.result,
        payload.ok === true,
        payload.latestToolResults ?? [],
        payload.latestVectorMatches ?? [],
        payload.latestContextRanking ?? [],
        payload.execution ??
          buildExecutionSummary({
            status: (payload.status ?? (payload.ok ? "completed" : "failed")) as RunStatus,
            steps: payload.executionSteps ?? [],
            transitions: payload.executionTransitions ?? [],
            providers: payload.providers,
            finalIssues: payload.finalIssues ?? [],
            latestToolResults: payload.latestToolResults ?? [],
            iterations: payload.iterations ?? []
          })
      ),
    wroteFiles: payload.wroteFiles ?? false,
    diffSummaries: payload.diffSummaries,
    pauseAfterPlan: payload.pauseAfterPlan ?? false,
    pauseAfterGenerate: payload.pauseAfterGenerate ?? false,
    latestReviewSummary: payload.latestReviewSummary ?? "",
    latestToolResults: payload.latestToolResults ?? [],
    latestVectorMatches: effectiveVectorMatches,
    latestContextRanking: effectiveContextRanking,
    approvalPolicy: payload.approvalPolicy ?? null,
    externalTask: payload.externalTask,
    externalUpdatePreviews: payload.externalUpdatePreviews,
    refactorAnalysis: payload.refactorAnalysis,
    execution:
      payload.execution ??
      buildExecutionSummary({
        status: (payload.status ?? (payload.ok ? "completed" : "failed")) as RunStatus,
        steps: payload.executionSteps ?? [],
        transitions: payload.executionTransitions ?? [],
        providers: payload.providers,
        finalIssues: payload.finalIssues ?? [],
        latestToolResults: payload.latestToolResults ?? [],
        iterations: payload.iterations ?? []
      })
  };

  await fs.writeFile(statePath, JSON.stringify(serializable, null, 2), "utf8");
  await appendArtifactTimeline(state, {
    step: "run-state",
    status: serializable.status,
    message: `Run state persisted with status ${serializable.status}.`,
    task: payload.task,
    artifactPath: statePath,
    metadata: {
      iterations: serializable.iterations.length,
      wroteFiles: serializable.wroteFiles,
      failureClass: serializable.execution?.failure?.class ?? null,
          totalDurationMs: serializable.execution?.totalDurationMs ?? 0,
          latestToolResults: (serializable.latestToolResults ?? []).map((entry) => ({
            name: entry.name,
            ok: entry.ok,
            skipped: entry.skipped
          })),
          latestVectorMatches: (serializable.latestVectorMatches ?? []).map((entry) => ({
            path: entry.path,
            score: entry.score,
            startLine: entry.startLine,
            endLine: entry.endLine
          })),
          latestContextRanking: (serializable.latestContextRanking ?? []).map((entry) => ({
            path: entry.path,
            score: entry.score,
            sources: entry.sources
          }))
        }
      });
  await writeArtifactIndex(state, {
    latestStep: "run-state",
    latestStatus: serializable.status,
    latestTask: payload.task,
    latestFiles: serializable.artifacts?.latestFiles ?? [],
    diffSummaries: payload.diffSummaries,
    latestToolResults: serializable.latestToolResults ?? [],
    latestVectorMatches: effectiveVectorMatches,
    latestContextRanking: effectiveContextRanking,
    execution: serializable.execution ?? null,
    approvalPolicy: serializable.approvalPolicy,
    externalTask: serializable.externalTask
  });
  logger?.info(`Saved resumable run state at ${statePath}`);
  return statePath;
}

export function finalizeArtifactState(
  state: ArtifactState,
  currentResult: FileGenerationResult | null,
  ok: boolean,
  latestToolResults: ToolExecutionResult[] = [],
  latestVectorMatches: VectorSearchMatch[] = [],
  latestContextRanking: ContextSelectionCandidate[] = [],
  execution: ExecutionSummary | null = null
): ArtifactSummary | null {
  if (!state.enabled || !state.runDir) {
    return null;
  }

  return {
    enabled: true,
    ok,
    runPath: state.runDir,
    latestIterationPath: state.latestIterationPath,
    stepPaths: state.stepPaths,
    latestFiles: currentResult?.files?.map((file) => file.path) ?? [],
    latestToolResults,
    latestVectorMatches,
    latestContextRanking,
    execution
  };
}

export async function persistExecutionTransition(state: ArtifactState, transition: ExecutionTransition): Promise<void> {
  if (!state.enabled) {
    return;
  }

  if (!state.runDir) {
    state.runDir = path.join(state.baseDir, createRunDirectoryName());
    await fs.mkdir(state.runDir, { recursive: true });
    ensureArtifactVisibilityPaths(state);
  }

  await appendArtifactTimeline(state, {
    step: `execution-${transition.stage}`,
    status: transition.status,
    message: transition.detail
      ? `Execution stage ${transition.stage} ${transition.status}: ${transition.detail}`
      : `Execution stage ${transition.stage} ${transition.status}.`,
    iteration: transition.iteration,
    durationMs: transition.durationMs,
    metadata: transition.metadata
  });
}

export async function persistApplyEvent(
  runPath: string,
  payload: Omit<ApplyEventRecord, "savedAt" | "runPath">,
  logger?: Logger
): Promise<string> {
  const timestamp = new Date().toISOString();
  const runDir = path.resolve(runPath);
  const eventsDir = path.join(runDir, "apply-events");
  const eventFileName = `apply-${timestamp.replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}.json`;
  const eventPath = path.join(eventsDir, eventFileName);
  const timelinePath = path.join(runDir, "timeline.jsonl");
  const indexPath = path.join(runDir, "artifact-index.json");
  const existingIndex = (await readJsonIfExists<RecentRunSummary["artifactIndex"]>(indexPath)) ?? null;
  const record: ApplyEventRecord = {
    ...payload,
    version: 1,
    savedAt: timestamp,
    runPath: runDir
  };

  await fs.mkdir(eventsDir, { recursive: true });
  await fs.writeFile(eventPath, JSON.stringify(record, null, 2), "utf8");
  await fs.appendFile(
    timelinePath,
    `${JSON.stringify({
      timestamp,
      step: "apply-event",
      status: payload.dryRun ? "dry-run" : "applied",
      message: payload.dryRun
        ? `Recorded dry-run apply event for ${payload.appliedFiles.length} file(s).`
        : `Recorded apply event for ${payload.appliedFiles.length} file(s).`,
      task: payload.task,
      artifactPath: eventPath,
      metadata: {
        force: payload.force,
        wroteFiles: payload.wroteFiles,
        appliedFiles: payload.appliedFiles,
        issueCounts: payload.issueCounts
      }
    })}\n`,
    "utf8"
  );

  const stepPaths = {
    ...(existingIndex?.stepPaths ?? {}),
    latestApplyEvent: eventPath,
    timeline: existingIndex?.stepPaths?.timeline ?? timelinePath,
    index: existingIndex?.stepPaths?.index ?? indexPath
  };
  const nextIndex = {
    updatedAt: timestamp,
    runPath: runDir,
    latestIterationPath: existingIndex?.latestIterationPath ?? payload.iterationPath,
    latestStep: "apply-event",
    latestStatus: existingIndex?.latestStatus ?? null,
    latestTask: payload.task || (existingIndex?.latestTask ?? null),
    latestProvider: existingIndex?.latestProvider ?? null,
    latestFiles: payload.appliedFiles,
    latestToolResults: existingIndex?.latestToolResults ?? [],
    execution: existingIndex?.execution ?? null,
    iterationCount:
      existingIndex?.iterationCount ?? Object.keys(stepPaths).filter((key) => key.startsWith("iteration-")).length,
    stepPaths,
    latestApplyEventPath: eventPath,
    lastAppliedAt: timestamp,
    applyEventCount: (existingIndex?.applyEventCount ?? 0) + 1
  };
  await fs.writeFile(indexPath, JSON.stringify(nextIndex, null, 2), "utf8");
  logger?.info(`Saved apply event at ${eventPath}`);
  return eventPath;
}

export async function ensureArtifactStepDirectory(state: ArtifactState, name: string): Promise<string> {
  if (!state.runDir) {
    state.runDir = path.join(state.baseDir, createRunDirectoryName());
  }
  ensureArtifactVisibilityPaths(state);

  const stepPath = path.join(state.runDir, name);
  await fs.mkdir(stepPath, { recursive: true });
  return stepPath;
}

export function ensureArtifactVisibilityPaths(state: ArtifactState): void {
  if (!state.runDir) {
    return;
  }

  if (!state.stepPaths.timeline) {
    state.stepPaths.timeline = path.join(state.runDir, "timeline.jsonl");
  }
  if (!state.stepPaths.index) {
    state.stepPaths.index = path.join(state.runDir, "artifact-index.json");
  }
}

export async function appendArtifactTimeline(
  state: ArtifactState,
  entry: {
    step: string;
    status: string;
    message: string;
    task?: string;
    provider?: string;
    iteration?: number;
    artifactPath?: string | null;
    durationMs?: number;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  if (!state.enabled || !state.runDir) {
    return;
  }

  ensureArtifactVisibilityPaths(state);
  const timelinePath = state.stepPaths.timeline;
  if (!timelinePath) {
    return;
  }

  const record = {
    timestamp: new Date().toISOString(),
    ...entry
  };
  await fs.appendFile(timelinePath, `${JSON.stringify(record)}\n`, "utf8");
}

export async function writeArtifactIndex(
  state: ArtifactState,
  payload: {
    latestStep: string;
    latestStatus?: string;
    latestTask?: string;
    latestProvider?: string;
    latestFiles?: string[];
    diffSummaries?: import("../types.js").DiffSummary[];
    latestToolResults?: ToolExecutionResult[];
    latestVectorMatches?: VectorSearchMatch[];
    latestContextRanking?: ContextSelectionCandidate[];
    execution?: ExecutionSummary | null;
    approvalPolicy?: import("../types.js").ApprovalPolicyDecision | null;
    externalTask?: import("../types.js").ExternalTaskRef;
    externalUpdatePreviews?: import("../types.js").ExternalTaskUpdatePreview[];
    refactorAnalysis?: import("../types.js").RefactorAnalysis;
  }
): Promise<void> {
  if (!state.enabled || !state.runDir) {
    return;
  }

  ensureArtifactVisibilityPaths(state);
  const indexPath = state.stepPaths.index;
  if (!indexPath) {
    return;
  }

  const existingIndex = (await readJsonIfExists<RecentRunSummary["artifactIndex"]>(indexPath)) ?? null;

  const index = {
    version: 1,
    updatedAt: new Date().toISOString(),
    runPath: state.runDir,
    latestIterationPath: state.latestIterationPath,
    latestStep: payload.latestStep,
    latestStatus: payload.latestStatus ?? null,
    latestTask: payload.latestTask ?? null,
    latestProvider: payload.latestProvider ?? null,
    latestFiles: payload.latestFiles ?? [],
    diffSummaries: payload.diffSummaries ?? existingIndex?.diffSummaries ?? [],
    latestToolResults: payload.latestToolResults ?? [],
    latestVectorMatches: payload.latestVectorMatches ?? existingIndex?.latestVectorMatches ?? [],
    latestContextRanking: payload.latestContextRanking ?? existingIndex?.latestContextRanking ?? [],
    execution: payload.execution ?? null,
    approvalPolicy: payload.approvalPolicy ?? existingIndex?.approvalPolicy ?? null,
    externalTask: payload.externalTask ?? existingIndex?.externalTask ?? null,
    externalUpdatePreviews: payload.externalUpdatePreviews ?? existingIndex?.externalUpdatePreviews ?? [],
    refactorAnalysis: payload.refactorAnalysis ?? existingIndex?.refactorAnalysis ?? null,
    iterationCount: Object.keys(state.stepPaths).filter((key) => key.startsWith("iteration-")).length,
    stepPaths: state.stepPaths
  };
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2), "utf8");
}

export function normalizeStepPaths(stepPaths: Record<string, unknown>, runPath: string): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(stepPaths)) {
    if (typeof value !== "string") {
      continue;
    }
    output[key] = path.isAbsolute(value) ? value : path.join(runPath, value);
  }
  return output;
}
