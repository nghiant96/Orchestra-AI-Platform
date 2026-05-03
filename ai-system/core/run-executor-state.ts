import { ExecutionStateMachine } from "./execution-state-machine.js";
import { persistExecutionTransition, type ArtifactState } from "./artifacts.js";
import type { Logger, RulesConfig } from "../types.js";
import { createProvider } from "../providers/registry.js";
import { PlannerAgent } from "../agents/planner.js";
import { GeneratorAgent } from "../agents/generator.js";
import { FixerAgent } from "../agents/fixer.js";
import { ReviewerAgent } from "../agents/reviewer.js";
import { createMemoryAdapter } from "../memory/registry.js";
import { summarizeProviders } from "./run-executor-utils.js";
import type { RuntimeDependencies } from "./run-executor-types.js";

export function createExecutionStateMachine(
  artifactState: ArtifactState,
  summary?: import("../types.js").ExecutionSummary | null,
  logger?: Logger
): ExecutionStateMachine {
  return new ExecutionStateMachine({
    summary,
    onTransition: async (transition) => {
      logger?.dashboard?.({
        transition,
        message: transition.detail ? `${transition.stage}: ${transition.detail}` : `${transition.stage}: ${transition.status}`,
        artifactPath: artifactState.runDir
      });
      await persistExecutionTransition(artifactState, transition);
    }
  });
}

export function createRuntimeDependencies(repoRoot: string, rules: RulesConfig, logger: Logger): RuntimeDependencies {
  const plannerProvider = createProvider("planner", rules, logger);
  const reviewerProvider = createProvider("reviewer", rules, logger);
  const generatorProvider = createProvider("generator", rules, logger);
  const fixerProvider = createProvider("fixer", rules, logger);

  return {
    plannerProvider,
    reviewerProvider,
    generatorProvider,
    fixerProvider,
    planner: new PlannerAgent({ provider: plannerProvider, rules }),
    reviewer: new ReviewerAgent({ provider: reviewerProvider, rules }),
    generator: new GeneratorAgent({ provider: generatorProvider, rules }),
    fixer: new FixerAgent({ provider: fixerProvider, rules }),
    memory: createMemoryAdapter({ repoRoot, rules, logger }),
    providerSummary: summarizeProviders({ plannerProvider, reviewerProvider, generatorProvider, fixerProvider })
  };
}
