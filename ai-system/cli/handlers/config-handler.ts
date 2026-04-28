import * as workflow from "../../core/config-workflow.js";
import { runSetupWizard } from "../setup.js";
import {
  printDoctor,
  printConfigShow,
  printConfigUseResult,
  printSetupCheck,
  outputJsonResult
} from "../formatters.js";
import type { CliCommand, TaskRunOptions } from "../types.js";

export async function handleConfigCommand(
  command: CliCommand,
  options: TaskRunOptions & {
    globalConfig: boolean;
    explicitGlobalConfigPath: string | null;
    ignoreProjectConfig: boolean;
    outputJson: boolean;
    savePath: string | null;
  }
): Promise<boolean> {
  const {
    cwd,
    configPath,
    globalConfig,
    explicitGlobalConfigPath,
    ignoreProjectConfig,
    outputJson,
    savePath
  } = options;

  switch (command.kind) {
    case "doctor": {
      const inspection = await workflow.inspectProjectConfiguration({
        repoRoot: cwd,
        explicitConfigPath: configPath,
        explicitGlobalConfigPath,
        ignoreProjectConfig,
        task: "ping"
      });
      const presets = workflow.getPresetCatalog();

      if (outputJson) {
        await outputJsonResult({ inspection, presets }, savePath);
        return true;
      }
      printDoctor(inspection, presets);
      return true;
    }
    case "config-show": {
      const inspection = await workflow.inspectProjectConfiguration({
        repoRoot: cwd,
        explicitConfigPath: configPath,
        explicitGlobalConfigPath,
        ignoreProjectConfig
      });
      if (outputJson) {
        await outputJsonResult(inspection, savePath);
        return true;
      }
      printConfigShow(inspection);
      return true;
    }
    case "config-use": {
      const normalizedPreset = workflow
        .getPresetCatalog()
        .find((preset) => preset.name === command.preset.toLowerCase());
      if (!normalizedPreset) {
        const supported = workflow.getPresetCatalog()
          .map((preset) => preset.name)
          .join(", ");
        throw new Error(`Unsupported preset "${command.preset}". Supported presets: ${supported}.`);
      }

      const result = await workflow.writeProjectPreset({
        repoRoot: cwd,
        explicitConfigPath: configPath,
        explicitGlobalConfigPath,
        preset: normalizedPreset.name
      });
      const targetConfigPath = result.configPath;

      const inspection = await workflow.inspectProjectConfiguration({
        repoRoot: cwd,
        explicitConfigPath: globalConfig ? null : result.configPath,
        explicitGlobalConfigPath,
        ignoreProjectConfig
      });

      if (outputJson) {
        await outputJsonResult({ preset: command.preset, configPath: targetConfigPath, inspection }, savePath);
        return true;
      }
      printConfigUseResult(command.preset, targetConfigPath, inspection);
      return true;
    }
    case "setup": {
      await runSetupWizard({ cwd, configPath, explicitGlobalConfigPath, ignoreProjectConfig });
      return true;
    }
    case "setup-check": {
      const result = await workflow.runSetupCheck({
        repoRoot: cwd,
        explicitConfigPath: configPath,
        explicitGlobalConfigPath,
        ignoreProjectConfig
      });
      printSetupCheck(result);
      return true;
    }
    default:
      return false;
  }
}
