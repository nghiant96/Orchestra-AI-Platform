export type WorkflowMode = "standard" | "implement" | "review" | "fix";

export interface WorkflowFlags {
  dryRun: boolean;
  interactive: boolean;
  pauseAfterPlan: boolean;
  pauseAfterGenerate: boolean;
}

export interface WorkflowExplicitFlags {
  dryRun?: boolean;
  interactive?: boolean;
  pauseAfterPlan?: boolean;
  pauseAfterGenerate?: boolean;
}

export function applyWorkflowModeDefaults(mode: WorkflowMode, explicit: WorkflowExplicitFlags = {}): WorkflowFlags {
  const defaults = workflowModeDefaults(mode);

  return {
    dryRun: explicit.dryRun ?? defaults.dryRun,
    interactive: explicit.interactive ?? defaults.interactive,
    pauseAfterPlan: explicit.pauseAfterPlan ?? defaults.pauseAfterPlan,
    pauseAfterGenerate: explicit.pauseAfterGenerate ?? defaults.pauseAfterGenerate
  };
}

export function workflowModeDefaults(mode: WorkflowMode): WorkflowFlags {
  switch (mode) {
    case "implement":
      return {
        dryRun: false,
        interactive: false,
        pauseAfterPlan: false,
        pauseAfterGenerate: false
      };
    case "review":
      return {
        dryRun: true,
        interactive: true,
        pauseAfterPlan: false,
        pauseAfterGenerate: true
      };
    case "fix":
      return {
        dryRun: false,
        interactive: true,
        pauseAfterPlan: false,
        pauseAfterGenerate: false
      };
    case "standard":
    default:
      return {
        dryRun: false,
        interactive: false,
        pauseAfterPlan: false,
        pauseAfterGenerate: false
      };
  }
}
