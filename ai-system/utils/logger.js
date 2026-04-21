import { maskSecrets } from "./string.js";

function log(prefix, message, writer = console.log) {
  writer(`${prefix} ${maskSecrets(message)}`);
}

export function createLogger({ verbose = true } = {}) {
  return {
    step(message) {
      log("[step]", message);
    },
    info(message) {
      if (verbose) {
        log("[info]", message);
      }
    },
    warn(message) {
      log("[warn]", message, console.warn);
    },
    error(message) {
      log("[error]", message, console.error);
    },
    success(message) {
      log("[ok]", message);
    }
  };
}
