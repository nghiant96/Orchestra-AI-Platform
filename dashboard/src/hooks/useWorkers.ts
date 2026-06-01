import { useState, useEffect, useCallback, useMemo } from "react";
import type { WorkerInfo } from "../types/index.js";
import { apiJson } from "../utils/api";

export function useWorkers() {
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchWorkers = useCallback(() => {
    const url = `/workers?t=${Date.now()}`;
    apiJson<{ ok: boolean; workers?: WorkerInfo[] }>(url)
      .then((data) => {
        setWorkers(data.workers || []);
        setLoading(false);
      })
      .catch((error) => {
        console.error("fetchWorkers failed:", error);
        setLoading(false);
      });
  }, []);

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

  return { workers, loading, stats, fetchWorkers };
}
