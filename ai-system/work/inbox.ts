import type { ExternalTaskRef } from "../types.js";
import { parseExternalTask, normalizeExternalTaskToPrompt } from "../core/external-task.js";
import type { WorkStore } from "./work-store.js";

export async function importExternalTaskToWorkItem(store: WorkStore, input: string) {
  const ref = parseExternalTask(input);
  if (!ref) return null;
  const existing = await findExistingExternalWorkItem(store, ref);
  if (existing) return existing;
  return store.create({
    title: ref.title || `${ref.kind} #${ref.number}`,
    description: normalizeExternalTaskToPrompt(ref),
    source: ref.kind === "issue" ? "github_issue" : "github_pr",
    type: ref.kind === "issue" ? "feature" : "review",
    expectedOutput: ref.kind === "pull_request" ? "report" : "branch",
    externalTask: ref,
    projectId: ref.repo,
    linkedRuns: []
  } as any);
}

async function findExistingExternalWorkItem(store: WorkStore, ref: ExternalTaskRef) {
  const items = await store.list();
  return items.find((item) => item.externalTask?.provider === ref.provider && item.externalTask?.url === ref.url) ?? null;
}
