import fs from "node:fs/promises";
import path from "node:path";
import type {
  ArtifactSummary,
  ContextFile,
  FileGenerationResult,
  IterationResult,
  Logger,
  MemoryStats,
  OrchestratorResult,
  PlanResult,
  ProviderSummary,
  ReviewIssue,
  RoutingDecision,
  RunStatus,
  RulesConfig
} from "../types.js";
import { summarizeIssueCounts } from "./reviewer.js";

export interface ArtifactState {
  enabled: boolean;
  repoRoot: string;
  baseDir: string;
  runDir: string | null;
  latestIterationPath: string | null;
  stepPaths: Record<string, string>;
}

export interface PersistedRunState {
  status?: string;
  task?: string;
  dryRun?: boolean;
  plan: PlanResult;
  result?: FileGenerationResult | null;
  iterations?: IterationResult[];
  skippedContextFiles?: string[];
  finalIssues?: ReviewIssue[];
  latestReviewSummary?: string;
  pauseAfterGenerate?: boolean;
  memory?: Partial<MemoryStats>;
  artifacts?: ArtifactSummary | null;
}

export function buildStoppedResult({
  status,
  dryRun,
  repoRoot,
  configPath,
  plan,
  result = null,
  iterations = [],
  skippedContextFiles = [],
  finalIssues = [],
  providers,
  memoryStats,
  artifactState
}: {
  status: Extract<RunStatus, "paused_after_plan" | "paused_after_generate">;
  dryRun: boolean;
  repoRoot: string;
  configPath: string | null;
  plan: PlanResult;
  result?: FileGenerationResult | null;
  iterations?: IterationResult[];
  skippedContextFiles?: string[];
  finalIssues?: ReviewIssue[];
  providers: ProviderSummary;
  memoryStats: MemoryStats;
  artifactState: ArtifactState;
}): OrchestratorResult {
  return {
    ok: false,
    status,
    dryRun,
    repoRoot,
    configPath,
    plan,
    result,
    iterations,
    issueCounts: summarizeIssueCounts(finalIssues),
    skippedContextFiles,
    finalIssues,
    providers,
    memory: memoryStats,
    artifacts: finalizeArtifactState(artifactState, result, false),
    wroteFiles: false
  };
}

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
    provider: string;
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
    normalizedPlan: payload.plan
  };
  await fs.writeFile(path.join(stepPath, "plan.json"), JSON.stringify(manifest, null, 2), "utf8");
  state.stepPaths.plan = stepPath;
  await appendArtifactTimeline(state, {
    step: "01-plan",
    status: "saved",
    message: "Planner checkpoint persisted.",
    task: payload.task,
    provider: payload.provider,
    artifactPath: stepPath
  });
  await writeArtifactIndex(state, {
    latestStep: "01-plan",
    latestTask: payload.task,
    latestProvider: payload.provider
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
  payload: { readFiles: string[]; skippedFiles: string[]; contexts: ContextFile[] },
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
    preReviewIssues: unknown;
    reviewSummary: string;
    issues: ReviewIssue[];
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
  await fs.mkdir(filesRoot, { recursive: true });

  for (const file of payload.candidateFiles) {
    const targetPath = path.join(filesRoot, file.path);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, file.content, "utf8");
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
      notes: payload.plan.notes
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
    preReviewIssues: payload.preReviewIssues,
    reviewSummary: payload.reviewSummary,
    issues: payload.issues
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
    finalIssues?: ReviewIssue[];
    issueCounts?: Record<string, number>;
    providers: ProviderSummary;
    memory: MemoryStats;
    artifacts?: ArtifactSummary | null;
    wroteFiles?: boolean;
    pauseAfterPlan?: boolean;
    pauseAfterGenerate?: boolean;
    latestReviewSummary?: string;
  },
  logger?: Logger
): Promise<string | null> {
  if (!state.enabled || !state.runDir) {
    return null;
  }

  const statePath = path.join(state.runDir, "run-state.json");
  ensureArtifactVisibilityPaths(state);
  state.stepPaths.runState = statePath;
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
    artifacts: payload.artifacts ?? finalizeArtifactState(state, payload.result, payload.ok === true),
    wroteFiles: payload.wroteFiles ?? false,
    pauseAfterPlan: payload.pauseAfterPlan ?? false,
    pauseAfterGenerate: payload.pauseAfterGenerate ?? false,
    latestReviewSummary: payload.latestReviewSummary ?? ""
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
      wroteFiles: serializable.wroteFiles
    }
  });
  await writeArtifactIndex(state, {
    latestStep: "run-state",
    latestStatus: serializable.status,
    latestTask: payload.task,
    latestFiles: serializable.artifacts?.latestFiles ?? []
  });
  logger?.info(`Saved resumable run state at ${statePath}`);
  return statePath;
}

export function finalizeArtifactState(
  state: ArtifactState,
  currentResult: FileGenerationResult | null,
  ok: boolean
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
    latestFiles: currentResult?.files?.map((file) => file.path) ?? []
  };
}

export async function resolveResumeStatePath(repoRoot: string, rules: RulesConfig, resumeTarget: string): Promise<string> {
  const target = String(resumeTarget || "").trim();
  if (!target) {
    throw new Error("Missing resume target.");
  }

  if (target === "last") {
    const artifactsDir = path.join(repoRoot, rules.artifacts?.data_dir ?? ".ai-system-artifacts");
    const entries = await fs.readdir(artifactsDir, { withFileTypes: true });
    const runDirs = entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("run-"))
      .map((entry) => path.join(artifactsDir, entry.name))
      .sort((left, right) => right.localeCompare(left));

    for (const runDir of runDirs) {
      const statePath = path.join(runDir, "run-state.json");
      try {
        await fs.access(statePath);
        return statePath;
      } catch {
        continue;
      }
    }

    throw new Error(`No resumable runs found in ${artifactsDir}`);
  }

  const absoluteTarget = path.resolve(target);
  const stat = await fs.stat(absoluteTarget);
  if (stat.isDirectory()) {
    const statePath = path.join(absoluteTarget, "run-state.json");
    await fs.access(statePath);
    return statePath;
  }

  return absoluteTarget;
}

export async function loadSavedContextArtifacts(state: ArtifactState, expectedPaths: string[]): Promise<ContextFile[]> {
  const contextDir = state.stepPaths.context ? path.join(state.stepPaths.context, "files") : null;
  if (!contextDir) {
    return [];
  }

  const contexts: ContextFile[] = [];
  for (const relativePath of expectedPaths) {
    const targetPath = path.join(contextDir, relativePath);
    try {
      const content = await fs.readFile(targetPath, "utf8");
      contexts.push({ path: relativePath, content });
    } catch {
      continue;
    }
  }

  return contexts;
}

function createRunDirectoryName(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const random = Math.random().toString(36).slice(2, 8);
  return `run-${timestamp}-${random}`;
}

async function ensureArtifactStepDirectory(state: ArtifactState, name: string): Promise<string> {
  if (!state.runDir) {
    state.runDir = path.join(state.baseDir, createRunDirectoryName());
  }
  ensureArtifactVisibilityPaths(state);

  const stepPath = path.join(state.runDir, name);
  await fs.mkdir(stepPath, { recursive: true });
  return stepPath;
}

function ensureArtifactVisibilityPaths(state: ArtifactState): void {
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

async function appendArtifactTimeline(
  state: ArtifactState,
  entry: {
    step: string;
    status: string;
    message: string;
    task?: string;
    provider?: string;
    iteration?: number;
    artifactPath?: string | null;
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

async function writeArtifactIndex(
  state: ArtifactState,
  payload: {
    latestStep: string;
    latestStatus?: string;
    latestTask?: string;
    latestProvider?: string;
    latestFiles?: string[];
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

  const index = {
    updatedAt: new Date().toISOString(),
    runPath: state.runDir,
    latestIterationPath: state.latestIterationPath,
    latestStep: payload.latestStep,
    latestStatus: payload.latestStatus ?? null,
    latestTask: payload.latestTask ?? null,
    latestProvider: payload.latestProvider ?? null,
    latestFiles: payload.latestFiles ?? [],
    iterationCount: Object.keys(state.stepPaths).filter((key) => key.startsWith("iteration-")).length,
    stepPaths: state.stepPaths
  };
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2), "utf8");
}

function normalizeStepPaths(stepPaths: Record<string, unknown>, runPath: string): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(stepPaths)) {
    if (typeof value !== "string") {
      continue;
    }
    output[key] = path.isAbsolute(value) ? value : path.join(runPath, value);
  }
  return output;
}
