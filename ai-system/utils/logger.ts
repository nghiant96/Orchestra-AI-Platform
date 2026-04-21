import { maskSecrets } from "./string.js";
import type { Logger } from "../types.js";

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
