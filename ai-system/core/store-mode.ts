export type OrchestraStoreMode = "file" | "sqlite" | "postgres";

export function resolveStoreMode(): OrchestraStoreMode {
  const value = (process.env.ORCHESTRA_STORE || "file").toLowerCase();
  if (value === "sqlite" || value === "postgres" || value === "file") {
    return value;
  }
  return "file";
}
