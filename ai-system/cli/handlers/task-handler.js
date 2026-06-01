import readline from "node:readline";
import { applyProviderPreset } from "../presets.js";
import { handleInteractiveCommand, buildPrompt } from "../interactive.js";
import { createCliLogger } from "../../utils/logger.js";
import { printResult, printInteractiveBanner } from "../formatters.js";
import { parseExternalTask, normalizeExternalTaskToPrompt } from "../../core/external-task.js";
export async function runTask({ cwd, dryRun, interactive, pauseAfterPlan, pauseAfterGenerate, configPath, providerPreset, resumeTarget, retryStage, workflowMode, outputJson = false, task }) {
    applyProviderPreset(providerPreset);
    const { Orchestrator } = await import("../../core/orchestrator.js");
    const loggerHandle = createCliLogger({ outputJson });
    const orchestrator = new Orchestrator({
        repoRoot: cwd,
        logger: loggerHandle.logger,
        configPath
    });
    let effectiveTask = task;
    let externalTask = null;
    let effectiveWorkflowMode = workflowMode;
    const parsed = parseExternalTask(task);
    if (parsed) {
        externalTask = parsed;
        effectiveTask = normalizeExternalTaskToPrompt(parsed);
        if (parsed.kind === "pull_request" && !workflowMode) {
            effectiveWorkflowMode = "review";
        }
    }
    try {
        if (resumeTarget) {
            return (await orchestrator.resume(resumeTarget, { stage: retryStage }));
        }
        return (await orchestrator.run(effectiveTask, {
            dryRun,
            interactive,
            pauseAfterPlan,
            pauseAfterGenerate,
            externalTask,
            workflowMode: effectiveWorkflowMode
        }));
    }
    finally {
        loggerHandle.dispose();
    }
}
export async function runInteractiveSession(initialState) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const state = { ...initialState };
    printInteractiveBanner(state);
    const ask = () => {
        rl.question(buildPrompt(state), async (line) => {
            const trimmed = line.trim();
            if (!trimmed) {
                ask();
                return;
            }
            try {
                const cmdResult = await handleInteractiveCommand(trimmed, state);
                if (cmdResult === "exit") {
                    rl.close();
                    return;
                }
                if (cmdResult === "handled") {
                    ask();
                    return;
                }
                const taskResult = await runTask({
                    cwd: state.cwd,
                    dryRun: state.dryRun,
                    interactive: state.interactive,
                    pauseAfterPlan: state.pauseAfterPlan,
                    pauseAfterGenerate: state.pauseAfterGenerate,
                    configPath: state.configPath,
                    providerPreset: state.providerPreset,
                    resumeTarget: state.resumeTarget,
                    retryStage: null,
                    workflowMode: "standard",
                    outputJson: false,
                    reviewStaged: false,
                    reviewBase: null,
                    reviewFailingChecks: false,
                    reviewFiles: [],
                    force: false,
                    task: trimmed
                });
                printResult(taskResult);
                if (state.resumeTarget) {
                    state.resumeTarget = null;
                }
            }
            catch (error) {
                const normalized = error;
                console.error(`[error] ${normalized.message}`);
            }
            ask();
        });
    };
    ask();
    return new Promise((resolve) => {
        rl.on("close", () => {
            console.log("");
            resolve();
        });
    });
}
