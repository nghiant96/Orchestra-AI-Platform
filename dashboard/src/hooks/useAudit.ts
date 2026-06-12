import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AuditEvent } from '../types/index.js';
import { apiJson } from '../utils/api';

const SOLO_ACTIONS = ['solo.undo', 'solo.continue', 'solo.commit'] as const;

export const useAudit = (limit = 100) => {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAudit = useCallback(() => {
    apiJson<{ ok?: boolean; version?: number; events?: AuditEvent[] }>(`/audit?limit=${limit}&t=${Date.now()}`)
      .then((data) => {
        setEvents(Array.isArray(data.events) ? data.events : []);
        setError(null);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to fetch audit trail:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch audit trail');
        setLoading(false);
      });
  }, [limit]);

  useEffect(() => {
    fetchAudit();
    const interval = setInterval(fetchAudit, 15000);
    return () => clearInterval(interval);
  }, [fetchAudit]);

  const soloEvents = useMemo(() => {
    return events.filter((event) => SOLO_ACTIONS.includes(event.action as (typeof SOLO_ACTIONS)[number]));
  }, [events]);

  const soloActionCounts = useMemo(() => {
    return soloEvents.reduce<Record<'undo' | 'continue' | 'commit', number>>((counts, event) => {
      if (event.action === 'solo.undo') counts.undo += 1;
      if (event.action === 'solo.continue') counts.continue += 1;
      if (event.action === 'solo.commit') counts.commit += 1;
      return counts;
    }, { undo: 0, continue: 0, commit: 0 });
  }, [soloEvents]);

  return {
    events,
    soloEvents,
    loading,
    error,
    totalSoloEvents: soloEvents.length,
    soloActionCounts,
    fetchAudit
  };
};
