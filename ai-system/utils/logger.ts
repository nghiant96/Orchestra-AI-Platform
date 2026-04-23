import blessed from "blessed";
import { maskSecrets } from "./string.js";
import type { Logger } from "../types.js";

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
  const counters = blessed.box({
    parent: screen,
    top: 3,
    left: 0,
    width: "100%",
    height: 3,
    tags: true,
    border: "line",
    label: " Counters ",
    content: "steps=0 info=0 warn=0 error=0 success=0"
  });
  const logs = blessed.log({
    parent: screen,
    top: 6,
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
  let currentStatus = "Idle";
  let disposed = false;

  const render = () => {
    header.setContent(maskSecrets(currentStatus));
    counters.setContent(
      `steps=${counts.step} info=${counts.info} warn=${counts.warn} error=${counts.error} success=${counts.success}`
    );
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
