import readline from "node:readline/promises";
import path from "node:path";
import type { ConfigInspection } from "../core/config-workflow.js";
import type { SetupToolName } from "./types.js";
import { printSetupCheck } from "./formatters.js";

export async function runSetupWizard({
  cwd,
  configPath,
  explicitGlobalConfigPath,
  ignoreProjectConfig
}: {
  cwd: string;
  configPath: string | null;
  explicitGlobalConfigPath: string | null;
  ignoreProjectConfig: boolean;
}): Promise<void> {
  const workflow = await import("../core/config-workflow.js");
  const inspection = await workflow.inspectProjectConfiguration({
    repoRoot: cwd,
    explicitConfigPath: configPath,
    explicitGlobalConfigPath,
    ignoreProjectConfig
  });
  const envValues = await workflow.readEnvValues(cwd);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const providerChoices = ["auto", "codex-cli", "gemini-cli", "claude-cli"];

  try {
    console.log("");
    console.log("Setup");
    console.log(`- repo: ${cwd}`);
    console.log(
      `- config: ${explicitGlobalConfigPath ?? inspection.configPath ?? path.join(cwd, ".ai-system.json")}${explicitGlobalConfigPath ? " (global)" : ""}`
    );
    console.log(
      `- current providers: planner=${inspection.effectiveRules.providers.planner.type}, reviewer=${inspection.effectiveRules.providers.reviewer.type}, generator=${inspection.effectiveRules.providers.generator.type}, fixer=${inspection.effectiveRules.providers.fixer.type}`
    );
    console.log(`- current routing: ${inspection.effectiveRules.routing?.enabled !== false}`);
    console.log(`- current memory: ${inspection.effectiveRules.memory?.backend ?? "(unset)"}`);

    const plannerProvider = await promptForChoice({
      rl,
      label: "Planner provider",
      choices: providerChoices,
      defaultValue: currentSetupProviderChoice(inspection, "planner"),
      descriptions: providerChoiceDescriptions()
    });

    const reviewerProvider = await promptForChoice({
      rl,
      label: "Reviewer provider",
      choices: providerChoices,
      defaultValue: currentSetupProviderChoice(inspection, "reviewer"),
      descriptions: providerChoiceDescriptions()
    });

    const generatorProvider = await promptForChoice({
      rl,
      label: "Generator provider",
      choices: providerChoices,
      defaultValue: currentSetupProviderChoice(inspection, "generator"),
      descriptions: providerChoiceDescriptions()
    });

    const fixerProvider = await promptForChoice({
      rl,
      label: "Fixer provider",
      choices: providerChoices,
      defaultValue: currentSetupProviderChoice(inspection, "fixer"),
      descriptions: providerChoiceDescriptions()
    });

    const hasAutoRole = [plannerProvider, reviewerProvider, generatorProvider, fixerProvider].includes("auto");

    const routingAnswer = await promptForChoice({
      rl,
      label: "Enable dynamic routing",
      choices: ["yes", "no"],
      defaultValue: hasAutoRole ? "yes" : inspection.effectiveRules.routing?.enabled !== false ? "yes" : "no"
    });
    const routingEnabled = hasAutoRole ? true : routingAnswer === "yes";

    const memoryBackend = await promptForChoice({
      rl,
      label: "Memory backend",
      choices: ["local-file", "openmemory"],
      defaultValue:
        inspection.effectiveRules.memory?.backend === "openmemory" || inspection.effectiveRules.memory?.backend === "local-file"
          ? inspection.effectiveRules.memory.backend
          : "openmemory"
    });

    let openMemoryBaseUrl = envValues.AI_SYSTEM_OPENMEMORY_BASE_URL || "http://127.0.0.1:9080";
    let openMemoryApiKey: string | undefined;

    if (memoryBackend === "openmemory") {
      openMemoryBaseUrl = await promptForInput({
        rl,
        label: "OpenMemory base URL",
        defaultValue: openMemoryBaseUrl
      });

      const apiKeyInput = await promptForInput({
        rl,
        label: "OpenMemory API key",
        defaultValue: envValues.AI_SYSTEM_OPENMEMORY_API_KEY ? "(keep existing)" : "",
        allowEmpty: true
      });
      if (apiKeyInput !== "" && apiKeyInput !== "(keep existing)") {
        openMemoryApiKey = apiKeyInput;
      }
    }

    const toolSelections = {
      lint: await promptForToolSetup(rl, inspection, "lint"),
      typecheck: await promptForToolSetup(rl, inspection, "typecheck"),
      build: await promptForToolSetup(rl, inspection, "build"),
      test: await promptForToolSetup(rl, inspection, "test")
    };

    console.log("");
    console.log("Apply");
    console.log(`- planner: ${plannerProvider}`);
    console.log(`- reviewer: ${reviewerProvider}`);
    console.log(`- generator: ${generatorProvider}`);
    console.log(`- fixer: ${fixerProvider}`);
    console.log(`- dynamic routing: ${routingEnabled}${hasAutoRole && routingAnswer === "no" ? " (forced on because at least one role is auto)" : ""}`);
    console.log(`- memory backend: ${memoryBackend}`);
    if (memoryBackend === "openmemory") {
      console.log(`- OpenMemory base URL: ${openMemoryBaseUrl}`);
      console.log(`- OpenMemory API key: ${openMemoryApiKey ? "(updated)" : envValues.AI_SYSTEM_OPENMEMORY_API_KEY ? "(keep existing)" : "(empty)"}`);
    }
    console.log("- tools:");
    for (const [toolName, selection] of Object.entries(toolSelections)) {
      console.log(
        `  - ${toolName}: mode=${selection.mode}${selection.script ? `, script=${selection.script}` : ""}${selection.appendChangedFiles ? ", changed-files=true" : ""}`
      );
    }

    const confirmation = await promptForInput({
      rl,
      label: "Continue",
      defaultValue: "yes"
    });

    if (!["y", "yes"].includes(confirmation.trim().toLowerCase())) {
      console.log("Setup cancelled.");
      return;
    }

    await workflow.applySetupChoices({
      repoRoot: cwd,
      explicitConfigPath: configPath,
      explicitGlobalConfigPath,
      choices: {
        providers: {
          planner: plannerProvider,
          reviewer: reviewerProvider,
          generator: generatorProvider,
          fixer: fixerProvider
        },
        routingEnabled,
        memoryBackend,
        openMemoryBaseUrl,
        openMemoryApiKey,
        tools: toolSelections
      }
    });

    const result = await workflow.runSetupCheck({
      repoRoot: cwd,
      explicitConfigPath: configPath,
      explicitGlobalConfigPath,
      ignoreProjectConfig
    });

    console.log("");
    console.log("Setup Saved");
    printSetupCheck(result);
  } finally {
    rl.close();
  }
}

function providerChoiceDescriptions(): Record<string, string> {
  return {
    auto: "Let the system decide this role dynamically from the task and routing rules.",
    "codex-cli": "Best fit when you want Codex to own code generation inside this project.",
    "gemini-cli": "Useful for planning or review when you want Gemini CLI in the loop.",
    "claude-cli": "Useful for review or planning when Claude CLI is available on the machine."
  };
}

async function promptForToolSetup(
  rl: readline.Interface,
  inspection: ConfigInspection,
  toolName: SetupToolName
): Promise<{ mode: "auto" | "disabled" | "script"; script?: string; appendChangedFiles?: boolean }> {
  const currentConfig = inspection.projectConfig?.tools?.commands?.[toolName];
  const currentSummary = inspection.toolSummaries.find((entry) => entry.name === toolName);

  const mode = await promptForChoice({
    rl,
    label: `${toolName} check mode`,
    choices: ["auto", "disabled", "script"],
    defaultValue: currentToolMode(currentConfig),
    descriptions: {
      auto: `Use auto-detected project behavior for ${toolName}.`,
      disabled: `Do not run ${toolName} during the generation loop.`,
      script: `Pin ${toolName} to a specific package script.`
    }
  });

  if (mode === "disabled") {
    return { mode };
  }

  let script: string | undefined;
  if (mode === "script") {
    script = await promptForInput({
      rl,
      label: `${toolName} script name`,
      defaultValue: currentToolScriptName(currentConfig, toolName)
    });
  }

  const currentScoped = currentSummary?.scopedToChangedFiles === true || (currentConfig as any)?.append_changed_files === true;
  const appendChangedFiles = await promptForChoice({
    rl,
    label: `${toolName} changed-file scoping`,
    choices: ["yes", "no"],
    defaultValue: currentScoped ? "yes" : "no",
    descriptions: {
      yes: `Append changed files to the ${toolName} command when possible.`,
      no: `Run ${toolName} without passing changed file paths.`
    }
  });

  return {
    mode,
    ...(script ? { script } : {}),
    appendChangedFiles: appendChangedFiles === "yes"
  };
}

function currentSetupProviderChoice(
  inspection: ConfigInspection,
  role: "planner" | "reviewer" | "generator" | "fixer"
): string {
  const configuredType = inspection.projectConfig?.providers?.[role]?.type;
  return typeof configuredType === "string" && configuredType.trim() !== "" ? configuredType : "auto";
}

function currentToolMode(currentConfig: unknown): "auto" | "disabled" | "script" {
  if (!currentConfig || typeof currentConfig !== "object" || Array.isArray(currentConfig)) {
    return "auto";
  }

  const candidate = currentConfig as Record<string, unknown>;
  if (candidate.enabled === false) {
    return "disabled";
  }
  if (typeof candidate.script === "string" && candidate.script.trim() !== "") {
    return "script";
  }
  return "auto";
}

function currentToolScriptName(currentConfig: unknown, toolName: SetupToolName): string {
  if (!currentConfig || typeof currentConfig !== "object" || Array.isArray(currentConfig)) {
    return toolName;
  }
  const candidate = currentConfig as Record<string, unknown>;
  return typeof candidate.script === "string" && candidate.script.trim() !== "" ? candidate.script : toolName;
}

async function promptForChoice({
  rl,
  label,
  choices,
  defaultValue,
  descriptions
}: {
  rl: readline.Interface;
  label: string;
  choices: string[];
  defaultValue: string;
  descriptions?: Record<string, string>;
}): Promise<any> {
  console.log("");
  console.log(label);
  for (const choice of choices) {
    console.log(`- ${choice}${descriptions?.[choice] ? `: ${descriptions[choice]}` : ""}`);
  }
  const value = await promptForInput({ rl, label, defaultValue });
  const normalized = value.trim();
  if (!choices.includes(normalized)) {
    throw new Error(`Unsupported ${label.toLowerCase()} "${normalized}". Expected one of: ${choices.join(", ")}.`);
  }
  return normalized;
}

async function promptForInput({
  rl,
  label,
  defaultValue,
  allowEmpty = false
}: {
  rl: readline.Interface;
  label: string;
  defaultValue?: string;
  allowEmpty?: boolean;
}): Promise<string> {
  while (true) {
    const suffix = typeof defaultValue === "string" && defaultValue !== "" ? ` [${defaultValue}]` : "";
    const answer = (await rl.question(`${label}${suffix}: `)).trim();
    if (answer) {
      return answer;
    }
    if (typeof defaultValue === "string") {
      return defaultValue;
    }
    if (allowEmpty) {
      return "";
    }
  }
}
