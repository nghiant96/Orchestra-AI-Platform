import { compilePrompt, loadPromptExamplesForTask, loadPromptTemplate } from "../utils/prompt-loader.js";
import type {
  AgentDependencies,
  DiffSummary,
  GeneratedFile,
  JsonSchema,
  PlanResult,
  ReviewIssue,
  ReviewResult
} from "../types.js";

export class ReviewerAgent {
  provider: AgentDependencies["provider"];
  rules: AgentDependencies["rules"];

  constructor({ provider, rules }: AgentDependencies) {
    this.provider = provider;
    this.rules = rules;
  }

  async reviewCode(
    task: string,
    plan: PlanResult | null,
    isStrict: boolean,
    originalFiles: Array<{ path: string; content?: string | null }>,
    candidateFiles: GeneratedFile[],
    validationIssues: ReviewIssue[],
    diffSummaries: DiffSummary[],
    cwd: string,
    memoryContext = "",
    blastRadius?: import("../core/blast-radius.js").BlastRadiusContext
  ): Promise<ReviewResult> {
    const promptOptions = { repoRoot: cwd, rules: this.rules };
    const template = await loadPromptTemplate("reviewer", promptOptions);
    const examples = await loadPromptExamplesForTask(task, [
      ...originalFiles.map((file) => file.path),
      ...candidateFiles.map((file) => file.path)
    ], promptOptions);

    let systemPrompt = compilePrompt(template, { examples });
    if (isStrict) {
      systemPrompt += "\n\nThis is a HIGH-RISK task. You MUST perform a STRICT REVIEW. Explicitly verify all contracts and security requirements defined in the plan. Any deviation from the plan or missing security/dependency checks MUST be flagged as high or medium severity blocking issues.";
    }

    systemPrompt += "\n\nStaff-Level Review Instructions:\n1. Findings First: Lead with concrete technical observations.\n2. Severity/Risk Ordering: Prioritize blocking issues (high/medium) and high-risk behavioral gaps.\n3. File/Line Grounding: Reference specific line numbers when possible.\n4. Behavioral Risk: For each finding, explain the potential behavioral or operational risk.\n5. Refactor Batching: For refactor tasks, ensure mechanical and behavioral changes are separated. Reject broad 'mixed' batches that combine many unrelated logic changes.";

    const prompt = JSON.stringify(
      {
        task,
        plan,
        isStrict,
        originalFiles,
        candidateFiles,
        validationIssues,
        diffSummaries,
        memoryContext,
        blastRadius
      },
      null,
      2
    );

    const rawResult = await this.provider.runJson({
      cwd,
      label: "reviewer output",
      systemPrompt,
      prompt,
      schema: REVIEW_SCHEMA,
      timeoutMs: this.rules.request_timeout_ms,
      retries: this.rules.request_retries,
      baseDelayMs: this.rules.retry_base_delay_ms
    }) as ReviewResult;

    return this.validateOutput(rawResult, originalFiles, candidateFiles);
  }

  private validateOutput(
    result: ReviewResult,
    originalFiles: Array<{ path: string }>,
    candidateFiles: GeneratedFile[]
  ): ReviewResult {
    const validPaths = new Set([
      ...originalFiles.map((f) => f.path),
      ...candidateFiles.map((f) => f.path)
    ]);

    const droppedIssues: ReviewIssue[] = [];
    const filteredIssues = result.issues.filter((issue) => {
      if (!issue.path) return true; // Global issues are ok
      const isValid = validPaths.has(issue.path);
      if (!isValid) {
        droppedIssues.push(issue);
      }
      return isValid;
    });
    const validationNotes: ReviewIssue[] =
      droppedIssues.length === 0
        ? []
        : [
            {
              severity: "low",
              category: "validation",
              path: "",
              description: `Reviewer returned ${droppedIssues.length} issue(s) for paths outside review scope: ${[
                ...new Set(droppedIssues.map((issue) => issue.path).filter(Boolean))
              ].join(", ")}.`,
              suggestedFix: "Use only original or candidate file paths in review issues."
            }
          ];

    return {
      ...result,
      issues: [...filteredIssues, ...validationNotes]
    };
  }
}

export const REVIEW_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          severity: { type: "string", enum: ["high", "medium", "low"] },
          category: { type: "string" },
          path: { type: "string" },
          line: { type: "number" },
          description: { type: "string" },
          risk: { type: "string" },
          suggestedFix: { type: "string" }
        },
        required: ["severity", "category", "path", "description", "suggestedFix"]
      }
    }
  },
  required: ["summary", "issues"]
};
