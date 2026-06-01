import { runOrchestrator } from "./orchestrator-run.js";
import { resumeOrchestrator } from "./orchestrator-resume.js";
export class Orchestrator {
    repoRoot;
    logger;
    configPath;
    confirmationHandler;
    constructor({ repoRoot, logger, configPath = null, confirmationHandler }) {
        this.repoRoot = repoRoot;
        this.logger = logger;
        this.configPath = configPath;
        this.confirmationHandler = confirmationHandler;
    }
    asHost() {
        return {
            repoRoot: this.repoRoot,
            logger: this.logger,
            configPath: this.configPath,
            confirmationHandler: this.confirmationHandler
        };
    }
    async run(task, { dryRun = false, interactive = false, pauseAfterPlan = false, pauseAfterGenerate = false, approvalPolicy = null, externalTask = null, workflowMode = "standard", signal } = {}) {
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
    async resume(resumeTarget, options = {}) {
        return await resumeOrchestrator(this.asHost(), resumeTarget, options);
    }
}
