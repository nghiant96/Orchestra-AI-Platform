import type {
  ExecutionStage,
  Logger,
  OrchestratorResult,
  ApprovalPolicyDecision,
  WorkflowMode,
  ExternalTaskRef,
  ExternalTaskUpdatePreview
} from "../types.js";
import { runOrchestrator } from "./orchestrator-run.js";
import { resumeOrchestrator } from "./orchestrator-resume.js";
import type { OrchestratorHost } from "./orchestrator-shared.js";

export class Orchestrator {
  repoRoot: string;
  logger: Logger;
  configPath: string | null;
  confirmationHandler?: import("../types.js").ConfirmationHandler;

  constructor({
    repoRoot,
    logger,
    configPath = null,
    confirmationHandler
  }: {
    repoRoot: string;
    logger: Logger;
    configPath?: string | null;
    confirmationHandler?: import("../types.js").ConfirmationHandler;
  }) {
    this.repoRoot = repoRoot;
    this.logger = logger;
    this.configPath = configPath;
    this.confirmationHandler = confirmationHandler;
  }

  private asHost(): OrchestratorHost {
    return {
      repoRoot: this.repoRoot,
      logger: this.logger,
      configPath: this.configPath,
      confirmationHandler: this.confirmationHandler
    };
  }

  async run(
    task: string,
    {
      dryRun = false,
      interactive = false,
      pauseAfterPlan = false,
      pauseAfterGenerate = false,
      approvalPolicy = null,
      externalTask = null,
      workflowMode = "standard",
      signal
    }: {
      dryRun?: boolean;
      interactive?: boolean;
      pauseAfterPlan?: boolean;
      pauseAfterGenerate?: boolean;
      approvalPolicy?: ApprovalPolicyDecision | null;
      externalTask?: ExternalTaskRef | null;
      workflowMode?: WorkflowMode;
      externalUpdatePreviews?: ExternalTaskUpdatePreview[];
      signal?: AbortSignal;
    } = {}
  ): Promise<OrchestratorResult> {
    return await runOrchestrator(this.asHost(), task, {
      dryRun,
      interactive,
      pauseAfterPlan,
      pauseAfterGenerate,
      approvalPolicy,
      externalTask,
      workflowMode,
      signal
    });
  }

  async resume(
    resumeTarget: string,
    options: { stage?: ExecutionStage | null; signal?: AbortSignal } = {}
  ): Promise<OrchestratorResult> {
    return await resumeOrchestrator(this.asHost(), resumeTarget, options);
  }

}
