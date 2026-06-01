export function resolveExecutionBackend() {
    const value = (process.env.ORCHESTRA_EXECUTION_BACKEND || "in-process").toLowerCase();
    if (value === "worker" || value === "hybrid" || value === "in-process")
        return value;
    return "in-process";
}
