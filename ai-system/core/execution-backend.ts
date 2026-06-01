export type ExecutionBackend = "in-process" | "worker" | "hybrid";

export function resolveExecutionBackend(): ExecutionBackend {
  const value = (process.env.ORCHESTRA_EXECUTION_BACKEND || "in-process").toLowerCase();
  // Hybrid is accepted for forward compatibility, but the server treats it as
  // worker-only today so a job never has both an in-process and external owner.
  if (value === "worker" || value === "hybrid" || value === "in-process") return value;
  return "in-process";
}
