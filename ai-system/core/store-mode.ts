export type OrchestraStoreMode = "file" | "sqlite" | "postgres";

export function resolveStoreMode(): OrchestraStoreMode {
  const value = (process.env.ORCHESTRA_STORE || "").toLowerCase();
  if (value === "sqlite" || value === "postgres" || value === "file") {
    return value;
  }

  if (process.env.AI_SYSTEM_SERVER_MODE === "true") {
    return "sqlite";
  }

  return "file";
}
