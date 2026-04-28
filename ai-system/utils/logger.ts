import blessed from "blessed";
import { maskSecrets } from "./string.js";
import type { DashboardSnapshot, ExecutionProviderMetric, ExecutionStage, ExecutionTransitionStatus, Logger } from "../types.js";

export interface LoggerHandle {
  logger: Logger;
  dispose(): void;
}

function log(prefix: string, message: string, writer: (message: string) => void = console.log) {
  writer(`${prefix} ${maskSecrets(message)}`);
}

export function createLogger({ verbose = true }: { verbose?: boolean } = {}): Logger {
  return {
    step(message: string) {
      log("[step]", message);
    },
    info(message: string) {
      if (verbose) {
        log("[info]", message);
      }
    },
    warn(message: string) {
      log("[warn]", message, console.warn);
    },
    error(message: string) {
      log("[error]", message, console.error);
    },
    success(message: string) {
      log("[ok]", message);
    }
  };
}

export function shouldUseDashboard({
  enableDashboard = true,
  outputJson = false,
  stdinIsTTY = Boolean(process.stdin.isTTY),
  stdoutIsTTY = Boolean(process.stdout.isTTY),
  term = process.env.TERM || "",
  disabled = process.env.AI_SYSTEM_DISABLE_TUI === "true"
}: {
  enableDashboard?: boolean;
  outputJson?: boolean;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  term?: string;
  disabled?: boolean;
} = {}): boolean {
  if (!enableDashboard || outputJson || disabled) {
    return false;
  }
  if (!stdinIsTTY || !stdoutIsTTY) {
    return false;
  }
  if (term.toLowerCase() === "dumb") {
    return false;
  }
  return true;
}

export function createCliLogger({
  verbose = true,
  enableDashboard = true,
  outputJson = false
}: {
  verbose?: boolean;
  enableDashboard?: boolean;
  outputJson?: boolean;
} = {}): LoggerHandle {
  if (!shouldUseDashboard({ enableDashboard, outputJson })) {
    return {
      logger: createLogger({ verbose }),
      dispose() {}
    };
  }

  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: true,
    dockBorders: true,
    title: "AI Coding System"
  });
  const header = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: "100%",
    height: 3,
    tags: true,
    border: "line",
    label: " Status ",
    content: "Initializing..."
  });
  const metrics = blessed.box({
    parent: screen,
    top: 3,
    left: 0,
    width: "100%",
    height: 4,
    tags: true,
    border: "line",
    label: " Token & Cost ",
    content: "steps=0 info=0 warn=0 error=0 success=0 tokens=0 cost=0.000"
  });
  const stateTree = blessed.box({
    parent: screen,
    top: 7,
    left: 0,
    width: "50%",
    height: 9,
    tags: false,
    border: "line",
    label: " Agent State ",
    content: "Waiting for state-machine transitions..."
  });
  const diffPanel = blessed.box({
    parent: screen,
    top: 7,
    left: "50%",
    width: "50%",
    height: 9,
    tags: false,
    border: "line",
    label: " Latest Diff / Artifact ",
    content: "No generated diff yet."
  });
  const logs = blessed.log({
    parent: screen,
    top: 16,
    left: 0,
    width: "100%",
    bottom: 0,
    tags: false,
    border: "line",
    label: " Recent Activity ",
    scrollback: 200,
    alwaysScroll: true,
    keys: false,
    vi: false,
    mouse: true
  });

  const counts = { step: 0, info: 0, warn: 0, error: 0, success: 0 };
  const stageStatuses = new Map<ExecutionStage, ExecutionTransitionStatus>();
  let providerMetrics: ExecutionProviderMetric[] = [];
  let latestBudget: DashboardSnapshot["budget"] = null;
  let latestDiffLines: string[] = [];
  let latestArtifactPath: string | null = null;
  let currentStatus = "Idle";
  let disposed = false;

  const render = () => {
    header.setContent(maskSecrets(currentStatus));
    metrics.setContent(maskSecrets(formatDashboardMetrics(counts, providerMetrics, latestBudget)));
    stateTree.setContent(maskSecrets(formatStateTree(stageStatuses)));
    diffPanel.setContent(maskSecrets(formatDiffPanel(latestDiffLines, latestArtifactPath)));
    screen.render();
  };

  const append = (prefix: string, message: string) => {
    logs.log(`${prefix} ${maskSecrets(message)}`);
    render();
  };

  const logger: Logger = {
    step(message: string) {
      counts.step += 1;
      currentStatus = message;
      append("[step]", message);
    },
    info(message: string) {
      if (!verbose) {
        return;
      }
      counts.info += 1;
      append("[info]", message);
    },
    warn(message: string) {
      counts.warn += 1;
      currentStatus = `Warning: ${message}`;
      append("[warn]", message);
    },
    error(message: string) {
      counts.error += 1;
      currentStatus = `Error: ${message}`;
      append("[error]", message);
    },
    success(message: string) {
      counts.success += 1;
      currentStatus = message;
      append("[ok]", message);
    },
    dashboard(snapshot: DashboardSnapshot) {
      if (snapshot.message) {
        currentStatus = snapshot.message;
      }
      if (snapshot.transition) {
        stageStatuses.set(snapshot.transition.stage, snapshot.transition.status);
      }
      if (snapshot.providerMetrics) {
        providerMetrics = snapshot.providerMetrics;
      }
      if (Object.prototype.hasOwnProperty.call(snapshot, "budget")) {
        latestBudget = snapshot.budget ?? null;
      }
      if (snapshot.diffSummaries) {
        latestDiffLines = snapshot.diffSummaries.map(
          (entry) =>
            `${entry.path}: +${entry.addedLines} -${entry.removedLines} ~${entry.changedLineEstimate} (${entry.beforeLineCount}->${entry.afterLineCount})`
        );
      }
      if (snapshot.artifactPath !== undefined) {
        latestArtifactPath = snapshot.artifactPath ?? null;
      }
      render();
    }
  };

  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    screen.destroy();
  };

  screen.key(["q", "C-c"], () => {
    dispose();
  });
  render();

  return { logger, dispose };
}

function formatDashboardMetrics(
  counts: { step: number; info: number; warn: number; error: number; success: number },
  providerMetrics: ExecutionProviderMetric[],
  budget: DashboardSnapshot["budget"]
): string {
  const totalCost = providerMetrics.reduce((total, metric) => total + Math.max(0, metric.estimatedCostUnits || 0), 0);
  const providerLines =
    providerMetrics.length === 0
      ? "providers: waiting for usage"
      : providerMetrics
          .map((metric) => `${metric.role}/${metric.provider}: cost=${metric.estimatedCostUnits.toFixed(3)}`)
          .join(" | ");
  const budgetLine = budget
    ? `budget: duration=${budget.totalDurationMs}/${budget.maxDurationMs ?? "∞"}ms cost=${budget.totalCostUnits.toFixed(3)}/${budget.maxCostUnits ?? "∞"}`
    : "budget: not configured";
  return [
    `events: steps=${counts.step} info=${counts.info} warn=${counts.warn} error=${counts.error} success=${counts.success} totalCost=${totalCost.toFixed(3)}`,
    providerLines,
    budgetLine
  ].join("\n");
}

function formatStateTree(stageStatuses: Map<ExecutionStage, ExecutionTransitionStatus>): string {
  if (stageStatuses.size === 0) {
    return "Waiting for state-machine transitions...";
  }
  return [...stageStatuses.entries()]
    .slice(-8)
    .map(([stage, status]) => `${status === "entered" ? "▶" : "✓"} ${stage}: ${status}`)
    .join("\n");
}

function formatDiffPanel(diffLines: string[], artifactPath: string | null): string {
  const lines = [
    ...(artifactPath ? [`artifact: ${artifactPath}`] : []),
    ...(diffLines.length > 0 ? diffLines.slice(0, 6) : ["No generated diff yet."])
  ];
  return lines.join("\n");
}
