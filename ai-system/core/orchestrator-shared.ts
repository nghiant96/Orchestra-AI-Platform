import type { ConfirmationHandler, Logger } from "../types.js";

export interface OrchestratorHost {
  repoRoot: string;
  logger: Logger;
  configPath: string | null;
  confirmationHandler?: ConfirmationHandler;
}
