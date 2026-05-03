import path from "node:path";
import { loadRules } from "../../core/orchestrator-runtime.js";
import { aggregateProjectStats } from "../../core/server-analytics.js";
import { importExternalTaskToWorkItem } from "../../work/inbox.js";
import { planWorkItemBranch, prepareWorkItemBranch, deriveWorktreePath } from "../../work/branch-manager.js";
import { watchCiForWorkItem, proposeCiRepairTask } from "../../work/ci.js";
import { scheduleWorkItems } from "../../work/scheduler.js";
import { WorkStore } from "../../work/work-store.js";
import { createWorktree, removeWorktree } from "../../work/worktree-manager.js";
import { commitWorkItemChanges, generateWorkItemPRBody, previewGhPR } from "../../work/commit-pr.js";
import { outputJsonResult } from "../formatters.js";
import { printWorkItem, printWorkItemList } from "../formatters/work.js";
import type { CliCommand, TaskRunOptions } from "../types.js";

export async function handleWorkCommand(
  command: CliCommand,
  options: TaskRunOptions & {
    explicitGlobalConfigPath: string | null;
    ignoreProjectConfig: boolean;
    outputJson: boolean;
    savePath: string | null;
  }
): Promise<boolean> {
  const {
    cwd,
    configPath,
    explicitGlobalConfigPath,
    ignoreProjectConfig,
    outputJson,
    savePath
  } = options;

  switch (command.kind) {
    case "work-create": {
      const { rules } = await loadRules(cwd, configPath, explicitGlobalConfigPath, ignoreProjectConfig);
      const store = new WorkStore(cwd, rules);
      const projectId = path.basename(cwd);
      const workItem = await store.create({
        title: command.title,
        projectId
      });
      if (outputJson) {
        await outputJsonResult(workItem, savePath);
        return true;
      }
      console.log(`Created work item: ${workItem.id}`);
      printWorkItem(workItem);
      return true;
    }
    case "work-list": {
      const { rules } = await loadRules(cwd, configPath, explicitGlobalConfigPath, ignoreProjectConfig);
      const store = new WorkStore(cwd, rules);
      const workItems = await store.list();
      if (outputJson) {
        await outputJsonResult(workItems, savePath);
        return true;
      }
      printWorkItemList(workItems);
      return true;
    }
    case "work-show": {
      const { rules } = await loadRules(cwd, configPath, explicitGlobalConfigPath, ignoreProjectConfig);
      const store = new WorkStore(cwd, rules);
      const workItem = await store.load(command.target);
      if (!workItem) {
        throw new Error(`Work item not found: ${command.target}`);
      }
      if (outputJson) {
        await outputJsonResult(workItem, savePath);
        return true;
      }
      printWorkItem(workItem);
      return true;
    }
    case "work-branch": {
      const { rules } = await loadRules(cwd, configPath, explicitGlobalConfigPath, ignoreProjectConfig);
      const store = new WorkStore(cwd, rules);
      const workItem = await store.load(command.target);
      if (!workItem) throw new Error(`Work item not found: ${command.target}`);
      const branch = await prepareWorkItemBranch(cwd, workItem, workItem.id, workItem.externalTask);
      const updated = { ...workItem, branch: branch.branchName, updatedAt: new Date().toISOString() };
      await store.save(updated);
      if (outputJson) {
        await outputJsonResult(updated, savePath);
        return true;
      }
      printWorkItem(updated);
      return true;
    }
    case "work-worktree-create": {
      const { rules } = await loadRules(cwd, configPath, explicitGlobalConfigPath, ignoreProjectConfig);
      const store = new WorkStore(cwd, rules);
      const workItem = await store.load(command.target);
      if (!workItem) throw new Error(`Work item not found: ${command.target}`);
      const branchName = workItem.branch || planWorkItemBranch(workItem, workItem.id, workItem.externalTask).branchName;
      const worktreePath = deriveWorktreePath(cwd, workItem.id);
      await createWorktree(cwd, branchName, worktreePath);
      const updated = { ...workItem, branch: branchName, worktreePath, updatedAt: new Date().toISOString() };
      await store.save(updated);
      if (outputJson) {
        await outputJsonResult(updated, savePath);
        return true;
      }
      printWorkItem(updated);
      return true;
    }
    case "work-worktree-remove": {
      const { rules } = await loadRules(cwd, configPath, explicitGlobalConfigPath, ignoreProjectConfig);
      const store = new WorkStore(cwd, rules);
      const workItem = await store.load(command.target);
      if (!workItem) throw new Error(`Work item not found: ${command.target}`);
      if (!workItem.worktreePath) {
        throw new Error(`Work item ${command.target} does not have a worktree path.`);
      }
      await removeWorktree(cwd, workItem.worktreePath);
      const updated = { ...workItem, worktreePath: undefined, updatedAt: new Date().toISOString() };
      await store.save(updated);
      if (outputJson) {
        await outputJsonResult(updated, savePath);
        return true;
      }
      printWorkItem(updated);
      return true;
    }
    case "work-commit": {
      const { rules } = await loadRules(cwd, configPath, explicitGlobalConfigPath, ignoreProjectConfig);
      const store = new WorkStore(cwd, rules);
      const workItem = await store.load(command.target);
      if (!workItem) throw new Error(`Work item not found: ${command.target}`);
      if (!workItem.appliedFiles || workItem.appliedFiles.length === 0) {
        throw new Error(`Work item ${command.target} has no applied files. Run the implementation first.`);
      }
      const commitPlan = await commitWorkItemChanges(cwd, workItem, workItem.appliedFiles, {
        push: command.push
      });
      if (outputJson) {
        await outputJsonResult({ workItem: { id: workItem.id, title: workItem.title }, commit: commitPlan }, savePath);
        return true;
      }
      console.log(`Committed: ${commitPlan.subject}`);
      for (const f of commitPlan.filesChanged) {
        console.log(`  M ${f}`);
      }
      if (command.push) {
        console.log(`Pushed to origin/${workItem.branch || "(current branch)"}`);
      }
      return true;
    }
    case "work-pr": {
      const { rules } = await loadRules(cwd, configPath, explicitGlobalConfigPath, ignoreProjectConfig);
      const store = new WorkStore(cwd, rules);
      const workItem = await store.load(command.target);
      if (!workItem) throw new Error(`Work item not found: ${command.target}`);
      const branchName = workItem.branch || planWorkItemBranch(workItem, workItem.id, workItem.externalTask).branchName;
      const appliedFiles = workItem.appliedFiles || [];
      const prPlan = generateWorkItemPRBody(workItem, branchName, appliedFiles, {
        draft: command.draft,
        reviewNotes: workItem.assessment ? `Risk: ${workItem.assessment.risk}, Complexity: ${workItem.assessment.complexity}` : undefined
      });
      if (command.dryRunPr) {
        const preview = previewGhPR(prPlan, cwd);
        if (outputJson) {
          await outputJsonResult({ workItem: { id: workItem.id, title: workItem.title }, prPlan, preview }, savePath);
          return true;
        }
        console.log(`DRY RUN: ${preview.preview}`);
        console.log(`\n${prPlan.body}`);
        return true;
      }
      if (outputJson) {
        await outputJsonResult({ workItem: { id: workItem.id, title: workItem.title }, prPlan }, savePath);
        return true;
      }
      console.log(`PR Title: ${prPlan.title}`);
      console.log(`Branch: ${prPlan.head} → ${prPlan.base}`);
      console.log(`Draft: ${prPlan.draft ? "yes" : "no"}`);
      console.log(`\n${prPlan.body}`);
      return true;
    }
    case "work-from-issue":
    case "work-from-pr": {
      const { rules } = await loadRules(cwd, configPath, explicitGlobalConfigPath, ignoreProjectConfig);
      const store = new WorkStore(cwd, rules);
      const workItem = await importExternalTaskToWorkItem(store, command.url);
      if (!workItem) throw new Error(`Unsupported external task URL: ${command.url}`);
      if (outputJson) {
        await outputJsonResult(workItem, savePath);
        return true;
      }
      printWorkItem(workItem);
      return true;
    }
    case "work-inbox-sync": {
      const { rules } = await loadRules(cwd, configPath, explicitGlobalConfigPath, ignoreProjectConfig);
      const store = new WorkStore(cwd, rules);
      const workItems = await store.list();
      const inbox = workItems.filter((item) => item.externalTask && !item.pullRequest);
      if (outputJson) {
        await outputJsonResult({ items: inbox, count: inbox.length }, savePath);
        return true;
      }
      printWorkItemList(inbox);
      return true;
    }
    case "work-ci-watch": {
      const { rules } = await loadRules(cwd, configPath, explicitGlobalConfigPath, ignoreProjectConfig);
      const store = new WorkStore(cwd, rules);
      const workItem = await store.load(command.target);
      if (!workItem) throw new Error(`Work item not found: ${command.target}`);
      const report = await watchCiForWorkItem(workItem, cwd);
      const updated = { ...workItem, ci: { ...(workItem.ci ?? {}), ...report, lastCheckedAt: new Date().toISOString() }, updatedAt: new Date().toISOString() };
      await store.save(updated);
      if (outputJson) {
        await outputJsonResult(updated, savePath);
        return true;
      }
      console.log(report.summary);
      return true;
    }
    case "work-ci-fix": {
      const { rules } = await loadRules(cwd, configPath, explicitGlobalConfigPath, ignoreProjectConfig);
      const store = new WorkStore(cwd, rules);
      const workItem = await store.load(command.target);
      if (!workItem) throw new Error(`Work item not found: ${command.target}`);
      const report = await watchCiForWorkItem(workItem, cwd);
      const task = proposeCiRepairTask(workItem, report);
      const updated = { ...workItem, description: `${workItem.description}\n\nCI repair task: ${task}`, status: "running_checks" as const, ci: { ...(workItem.ci ?? {}), ...report, repairAttempts: (workItem.ci?.repairAttempts ?? 0) + 1, lastCheckedAt: new Date().toISOString() }, updatedAt: new Date().toISOString() };
      await store.save(updated);
      if (outputJson) {
        await outputJsonResult(updated, savePath);
        return true;
      }
      console.log(task);
      return true;
    }
    case "work-schedule": {
      const { rules } = await loadRules(cwd, configPath, explicitGlobalConfigPath, ignoreProjectConfig);
      const store = new WorkStore(cwd, rules);
      const workItems = await store.list();
      const plan = scheduleWorkItems(workItems);
      if (outputJson) {
        await outputJsonResult(plan, savePath);
        return true;
      }
      console.log(`Ready: ${plan.ready.length}, Blocked: ${plan.blocked.length}`);
      return true;
    }
    case "work-metrics": {
      const { rules } = await loadRules(cwd, configPath, explicitGlobalConfigPath, ignoreProjectConfig);
      const metrics = await aggregateProjectStats(cwd, rules);
      if (outputJson) {
        await outputJsonResult(metrics, savePath);
        return true;
      }
      console.log(`Runs: ${metrics.totalRuns}, Cost: ${metrics.totalProjectCost}`);
      return true;
    }
    default:
      return false;
  }
}
