import { useState, useEffect, useCallback } from 'react';
import type { ApprovalPolicyDecision } from '../types/index.js';
import { apiJson } from '../utils/api';

export interface SystemHealth {
  ok: boolean;
  status: string;
  version: string;
  cwd: string;
  allowedWorkdirs: string[];
  queue: {
    concurrency: number;
    activeCount: number;
    queuedCount: number;
    totalRecent: number;
    paused?: boolean;
    approvalMode?: 'manual' | 'auto';
    skipApproval?: boolean;
    approvalPolicy?: ApprovalPolicyDecision;
  };
  memory: {
    uptime: number;
  };
}

export const useHealth = () => {
  const [health, setHealth] = useState<SystemHealth | null>(null);

  const fetchHealth = useCallback(() => {
    apiJson<SystemHealth>(`/health?t=${Date.now()}`)
      .then((data) => setHealth(data))
      .catch((err) => {
        console.error('Failed to fetch health:', err);
        setHealth(null);
      });
  }, []);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 10000); // Check every 10s
    return () => clearInterval(interval);
  }, [fetchHealth]);

  return { health, fetchHealth };
};
