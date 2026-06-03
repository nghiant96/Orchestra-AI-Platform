export function resolveStoreMode() {
    const value = (process.env.ORCHESTRA_STORE || "file").toLowerCase();
    if (value === "sqlite" || value === "postgres" || value === "file") {
        return value;
    }
    return "file";
}
