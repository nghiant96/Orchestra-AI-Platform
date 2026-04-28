import type { ConfigInspection, SetupCheckResult } from "../../core/config-workflow.js";
import { formatDisplayJson } from "./shared.js";

export function printConfigShow(inspection: ConfigInspection): void {
  console.log("");
  console.log("Config");
  console.log(`- repo: ${inspection.repoRoot}`);
  console.log(`- global config: ${inspection.globalConfigPath ?? "(none)"}`);
  console.log(`- config: ${inspection.configPath ?? "(none, using internal defaults)"}`);
  console.log(`- global profile: ${inspection.globalProfile ?? "(none)"}`);
  console.log(`- profile: ${inspection.profile ?? "(none)"}`);
  console.log(
    `- effective providers: planner=${inspection.effectiveRules.providers.planner.type}, reviewer=${inspection.effectiveRules.providers.reviewer.type}, generator=${inspection.effectiveRules.providers.generator.type}, fixer=${inspection.effectiveRules.providers.fixer.type}`
  );
  console.log(
    `- routing: enabled=${inspection.effectiveRules.routing?.enabled !== false}, default_profile=${inspection.effectiveRules.routing?.default_profile ?? "(unset)"}, planning_profile=${inspection.routing.profile}`
  );
  console.log(
    `- memory: enabled=${inspection.effectiveRules.memory?.enabled !== false}, backend=${inspection.effectiveRules.memory?.backend ?? "(unset)"}`
  );
  console.log(
    `- vector search: enabled=${inspection.effectiveRules.vector_search?.enabled === true}, data_dir=${inspection.effectiveRules.vector_search?.data_dir ?? "(unset)"}, max_results=${inspection.effectiveRules.vector_search?.max_results ?? "(unset)"}, parser_mode=${inspection.effectiveRules.vector_search?.parsers?.mode ?? "auto"}`
  );
  console.log(
    `- tools: enabled=${inspection.effectiveRules.tools?.enabled !== false}, json_validation=${inspection.effectiveRules.tools?.json_validation !== false}`
  );
  console.log(
    `- prompts: directory=${inspection.effectiveRules.prompts?.directory || "(built-in)"}, examples_directory=${inspection.effectiveRules.prompts?.examples_directory || "(built-in)"}`
  );
  console.log(`- env overrides: ${inspection.activeEnvOverrides.length}`);
  if (inspection.projectConfig) {
    console.log("- project config:");
    console.log(formatDisplayJson(inspection.projectConfig));
  }
  if (inspection.toolSummaries.length > 0) {
    console.log("- effective tool commands:");
    for (const tool of inspection.toolSummaries) {
      console.log(
        `  - ${tool.name}: enabled=${tool.enabled}, source=${tool.source}, scope=${tool.scope ?? "full"}, sandbox=${tool.sandboxMode ?? "inherit"}, image=${tool.sandboxImage ?? "(default)"}, scoped_changed_files=${tool.scopedToChangedFiles === true}, cwd=${tool.workingDirectory ?? "."}, command=${tool.command ?? "(none)"}${tool.args && tool.args.length > 0 ? ` ${tool.args.join(" ")}` : ""}`
      );
    }
  }
}

export function printConfigUseResult(
  preset: string,
  configPath: string,
  inspection: ConfigInspection
): void {
  console.log("");
  console.log("Config Updated");
  console.log(`- config: ${configPath}`);
  console.log(`- profile: ${preset}`);
  console.log(
    `- effective providers: planner=${inspection.effectiveRules.providers.planner.type}, reviewer=${inspection.effectiveRules.providers.reviewer.type}, generator=${inspection.effectiveRules.providers.generator.type}, fixer=${inspection.effectiveRules.providers.fixer.type}`
  );
  console.log(`- routing: enabled=${inspection.effectiveRules.routing?.enabled !== false}`);
  console.log("- next step: keep provider/routing behavior in `.ai-system.json`; keep secrets in `.env`.");
}

export function printDoctor(
  inspection: ConfigInspection,
  presets: Array<{ name: string; summary: string }>
): void {
  console.log("");
  console.log("Doctor");
  console.log(`- repo: ${inspection.repoRoot}`);
  console.log(`- global config: ${inspection.globalConfigPath ?? "(none)"}`);
  console.log(`- config: ${inspection.configPath ?? "(none)"}`);
  console.log(`- global profile: ${inspection.globalProfile ?? "(none)"}`);
  console.log(`- profile: ${inspection.profile ?? "(none)"}`);
  console.log(
    `- effective providers: planner=${inspection.effectiveRules.providers.planner.type}, reviewer=${inspection.effectiveRules.providers.reviewer.type}, generator=${inspection.effectiveRules.providers.generator.type}, fixer=${inspection.effectiveRules.providers.fixer.type}`
  );
  console.log(
    `- routing decision: stage=${inspection.routing.stage}, enabled=${inspection.routing.enabled}, profile=${inspection.routing.profile}, reason=${inspection.routing.reason}`
  );
  console.log(
    `- memory: enabled=${inspection.effectiveRules.memory?.enabled !== false}, backend=${inspection.effectiveRules.memory?.backend ?? "(unset)"}`
  );
  console.log(
    `- vector search: enabled=${inspection.effectiveRules.vector_search?.enabled === true}, data_dir=${inspection.effectiveRules.vector_search?.data_dir ?? "(unset)"}, max_results=${inspection.effectiveRules.vector_search?.max_results ?? "(unset)"}, parser_mode=${inspection.effectiveRules.vector_search?.parsers?.mode ?? "auto"}`
  );
  console.log(
    `- run budgets: duration=${inspection.effectiveRules.execution?.budgets?.max_duration_ms ?? "(disabled)"}ms, cost=${inspection.effectiveRules.execution?.budgets?.max_cost_units ?? "(disabled)"}`
  );
  console.log(
    `- prompts: directory=${inspection.effectiveRules.prompts?.directory || "(built-in)"}, examples_directory=${inspection.effectiveRules.prompts?.examples_directory || "(built-in)"}`
  );
  if (inspection.toolSummaries.length > 0) {
    console.log("- effective tool commands:");
    for (const tool of inspection.toolSummaries) {
      console.log(
        `  - ${tool.name}: ${tool.summary} [source=${tool.source}, scope=${tool.scope ?? "full"}, sandbox=${tool.sandboxMode ?? "inherit"}, image=${tool.sandboxImage ?? "(default)"}, scoped_changed_files=${tool.scopedToChangedFiles === true}]`
      );
    }
  }

  if (inspection.activeEnvOverrides.length > 0) {
    console.log("- active env overrides:");
    for (const entry of inspection.activeEnvOverrides) {
      console.log(`  - ${entry.key}=${entry.value} (${entry.category})`);
    }
  } else {
    console.log("- active env overrides: (none)");
  }

  console.log("- preset catalog:");
  for (const preset of presets) {
    console.log(`  - ${preset.name}: ${preset.summary}`);
  }

  if (inspection.recommendations.length > 0) {
    console.log("- recommendations:");
    for (const recommendation of inspection.recommendations) {
      console.log(`  - ${recommendation}`);
    }
  }
}

export function printSetupCheck(result: SetupCheckResult): void {
  console.log("");
  console.log("Setup Check");
  console.log(`- repo: ${result.inspection.repoRoot}`);
  console.log(`- config: ${result.configPath ?? "(none)"}`);
  console.log(`- env: ${result.envPath}`);
  console.log(`- profile: ${result.inspection.profile ?? "(none)"}`);
  console.log(
    `- effective providers: planner=${result.inspection.effectiveRules.providers.planner.type}, reviewer=${result.inspection.effectiveRules.providers.reviewer.type}, generator=${result.inspection.effectiveRules.providers.generator.type}, fixer=${result.inspection.effectiveRules.providers.fixer.type}`
  );
  console.log(`- codex CLI: ${result.cliAvailability.codex ? "ok" : "missing"}`);
  console.log(`- gemini CLI: ${result.cliAvailability.gemini ? "ok" : "missing"}`);
  console.log(`- claude CLI: ${result.cliAvailability.claude ? "ok" : "missing"}`);

  if (result.openmemory.enabled) {
    console.log(`- OpenMemory base URL: ${result.openmemory.baseUrl ?? "(missing)"}`);
    console.log(`- OpenMemory API key: ${result.openmemory.hasApiKey ? "present" : "missing"}`);
    console.log(`- OpenMemory health: ${formatProbeResult(result.openmemory.health)}`);
    console.log(`- OpenMemory query: ${formatProbeResult(result.openmemory.query)}`);
    console.log(`- OpenMemory add: ${formatProbeResult(result.openmemory.add)}`);
  } else {
    console.log("- OpenMemory: disabled");
  }
}

export function formatProbeResult(result: { ok: boolean; status: number | null; message: string }): string {
  const status = result.status === null ? "n/a" : String(result.status);
  return `${result.ok ? "ok" : "failed"} (status=${status}) ${result.message}`;
}
