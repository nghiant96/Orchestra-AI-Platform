import type {
  FileGenerationResult,
  IterationResult,
  JsonProvider,
  MemoryAdapter,
  ProviderSummary,
  ReviewIssue
} from "../types.js";
import { PlannerAgent } from "../agents/planner.js";
import { GeneratorAgent } from "../agents/generator.js";
import { FixerAgent } from "../agents/fixer.js";
import { ReviewerAgent } from "../agents/reviewer.js";
import { ExecutionStateMachine } from "./execution-state-machine.js";

export interface RuntimeDependencies {
  plannerProvider: JsonProvider;
  reviewerProvider: JsonProvider;
  generatorProvider: JsonProvider;
  fixerProvider: JsonProvider;
  planner: PlannerAgent;
  reviewer: ReviewerAgent;
  generator: GeneratorAgent;
  fixer: FixerAgent;
  memory: MemoryAdapter;
  providerSummary: ProviderSummary;
}

export interface LoopExecutionState {
  currentResult: FileGenerationResult | null;
  acceptedIssues: ReviewIssue[];
  latestReviewSummary: string;
  iterationResults: IterationResult[];
  diffSummaries?: import("../types.js").DiffSummary[];
  latestToolResults: import("../types.js").ToolExecutionResult[];
  executionMachine: ExecutionStateMachine;
}
