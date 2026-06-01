import { useState, useEffect, useCallback, useMemo } from "react";
import type { WorkerInfo } from "../types/index.js";
import { apiFetch, apiJson } from "../utils/api";

export function useWorkers() {
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actioningWorkerId, setActioningWorkerId] = useState<string | null>(null);

  const fetchWorkers = useCallback(() => {
    const url = `/workers?t=${Date.now()}`;
    apiJson<{ ok: boolean; workers?: WorkerInfo[] }>(url)
      .then((data) => {
        setWorkers(data.workers || []);
        setError(null);
        setLoading(false);
      })
      .catch((error) => {
        console.error("fetchWorkers failed:", error);
        setError(error instanceof Error ? error.message : "Failed to load workers");
        setLoading(false);
      });
  }, []);

  const setWorkerStatus = useCallback(async (workerId: string, action: "disable" | "enable" | "drain") => {
    setActioningWorkerId(workerId);
    setError(null);
    try {
      const response = await apiFetch(`/workers/${workerId}/${action}`, { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(String(payload?.error || `HTTP ${response.status}`));
      }
      await fetchWorkers();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} worker`);
    } finally {
      setActioningWorkerId(null);
    }
  }, [fetchWorkers]);

  useEffect(() => {
    fetchWorkers();
    const interval = setInterval(fetchWorkers, 5000);
    return () => clearInterval(interval);
  }, [fetchWorkers]);

  const stats = useMemo(() => {
    const safe = Array.isArray(workers) ? workers : [];
    return {
      total: safe.length,
      online: safe.filter((w) => w.status === "online" || w.status === "idle" || w.status === "busy").length,
      idle: safe.filter((w) => w.status === "idle").length,
      busy: safe.filter((w) => w.status === "busy").length,
      offline: safe.filter((w) => w.status === "offline" || w.status === "disabled" || w.status === "draining").length,
    };
  }, [workers]);

  return { workers, loading, error, stats, fetchWorkers, setWorkerStatus, actioningWorkerId };
}
