import path from "node:path";
import { loadRules } from "../../core/orchestrator-runtime.js";
import { planWorkItemBranch, prepareWorkItemBranch, deriveWorktreePath } from "../../work/branch-manager.js";
import { WorkStore } from "../../work/work-store.js";
import { createWorktree } from "../../work/worktree-manager.js";
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
    default:
      return false;
  }
}
