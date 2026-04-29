import fs from "node:fs/promises";
import path from "node:path";
import type { Logger, PluginInfo, PluginManifest, RulesConfig } from "../types.js";
import { loadJsonIfExists } from "../utils/config.js";

function validatePluginSafety(manifest: PluginManifest): string | null {
  const allTools = Object.values(manifest.tools || {});
  const allAdapters = Object.values(manifest.adapters || {});

  const check = (cmd?: unknown, workingDir?: unknown) => {
    if (cmd !== undefined && typeof cmd !== "string") {
      return "Unsafe command path: expected a string command.";
    }
    if (workingDir !== undefined && typeof workingDir !== "string") {
      return "Unsafe working directory: expected a string working directory.";
    }
    if (cmd && (path.isAbsolute(cmd) || cmd.includes('..'))) {
      return `Unsafe command path: ${cmd}`;
    }
    if (workingDir && (path.isAbsolute(workingDir) || workingDir.includes('..'))) {
      return `Unsafe working directory: ${workingDir}`;
    }
    return null;
  };

  for (const tool of allTools) {
    const err = check(tool.command, tool.working_directory);
    if (err) return err;
  }

  for (const adapter of allAdapters) {
    const err = check(undefined, adapter.working_directory);
    if (err) return err;
    if (adapter.commands) {
      for (const cmd of Object.values(adapter.commands)) {
        if (!cmd || typeof cmd !== "object") continue;
        const cmdErr = check(cmd.command, cmd.working_directory);
        if (cmdErr) return cmdErr;
      }
    }
  }

  return null;
}

export async function discoverPlugins(repoRoot: string, logger?: Logger): Promise<PluginInfo[]> {
  const pluginsDir = path.join(repoRoot, ".ai-system", "plugins");
  const plugins: PluginInfo[] = [];

  try {
    const entries = await fs.readdir(pluginsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      const pluginPath = path.join(pluginsDir, entry.name);
      const manifestPath = path.join(pluginPath, "plugin.json");
      
      try {
        const manifest = await loadJsonIfExists<PluginManifest>(manifestPath);
        if (manifest && manifest.name) {
          const safetyError = validatePluginSafety(manifest);
          if (safetyError) {
            plugins.push({
              ...manifest,
              path: pluginPath,
              enabled: false,
              error: `Safety check failed: ${safetyError}`
            });
            logger?.warn(`Security risk: Plugin ${manifest.name} at ${entry.name} failed safety check.`);
          } else {
            plugins.push({
              ...manifest,
              path: pluginPath,
              enabled: true
            });
          }
        }
      } catch (err) {
        logger?.warn(`Failed to load plugin at ${entry.name}: ${(err as Error).message}`);
        plugins.push({
          name: entry.name,
          version: "0.0.0",
          path: pluginPath,
          enabled: false,
          error: (err as Error).message
        });
      }
    }
  } catch {
    // Directory might not exist, ignore
  }

  return plugins;
}

export function applyPluginsToRules(rules: RulesConfig, plugins: PluginInfo[]): RulesConfig {
  const merged = { ...rules };
  
  for (const plugin of plugins) {
    if (!plugin.enabled) continue;

    // Merge tools
    if (plugin.tools) {
      merged.tools = merged.tools || {};
      merged.tools.commands = { ...merged.tools.commands, ...plugin.tools };
    }

    // Merge adapters
    if (plugin.adapters) {
      merged.tools = merged.tools || {};
      merged.tools.adapters = { ...merged.tools.adapters, ...plugin.adapters };
    }

    // Merge prompt overrides (if needed in future)
  }

  return merged;
}
