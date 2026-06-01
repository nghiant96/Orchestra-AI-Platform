import { commitGitChanges, generateCommitMessage, generatePRDescription, stageGitFiles } from "../core/git-workflow.js";
import { runCommand } from "../utils/api.js";
export function generateWorkItemCommitMessage(workItem, appliedFiles, summary) {
    return generateCommitMessage(workItem.title, appliedFiles, workItem.externalTask, {
        summary,
        ok: true
    });
}
export function generateWorkItemPRBody(workItem, branchName, appliedFiles, options = {}) {
    const runResult = buildSyntheticRunResult(workItem, appliedFiles, options.reviewNotes);
    const title = workItem.externalTask?.title ? `[codex] ${workItem.externalTask.title}` : `[codex] ${workItem.title}`;
    const body = generatePRDescription(workItem.title, appliedFiles, runResult, workItem.externalTask);
    return {
        title,
        body,
        head: branchName,
        base: options.base ?? "main",
        draft: options.draft ?? true,
        payload: {
            title,
            body,
            head: branchName,
            base: options.base ?? "main",
            draft: options.draft ?? true,
            externalTask: workItem.externalTask?.url ?? null
        }
    };
}
export async function commitWorkItemChanges(repoRoot, workItem, appliedFiles, options = {}) {
    const message = generateWorkItemCommitMessage(workItem, appliedFiles, workItem.assessment?.reason);
    await stageGitFiles(repoRoot, appliedFiles);
    await commitGitChanges(repoRoot, message);
    if (options.push) {
        await runCommand({ command: "git", args: ["push", "-u", "origin", "HEAD"], cwd: repoRoot });
    }
    return {
        subject: message.split("\n", 1)[0] ?? `work: ${workItem.title}`,
        message,
        filesChanged: [...appliedFiles],
        pushed: Boolean(options.push)
    };
}
export function previewGhPR(prPlan, repoRoot) {
    const draftFlag = prPlan.draft ? " --draft" : "";
    const command = `gh pr create --title "${prPlan.title}" --head "${prPlan.head}" --base "${prPlan.base}"${draftFlag}`;
    return {
        preview: `Preview PR creation in ${repoRoot}`,
        command
    };
}
function buildSyntheticRunResult(workItem, appliedFiles, reviewNotes) {
    return {
        ok: true,
        result: {
            summary: reviewNotes || workItem.assessment?.reason || workItem.title
        },
        plan: {
            notes: reviewNotes ? [reviewNotes] : [],
            writeTargets: appliedFiles.map((file) => ({ path: file, reason: "Applied file" }))
        },
        latestToolResults: [],
        missingTests: [],
        execution: null,
        artifacts: null
    };
}
