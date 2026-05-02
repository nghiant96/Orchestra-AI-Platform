import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WorkItem } from '../types/index.js';

export const useWorkItems = (projectPath?: string) => {
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchWorkItems = useCallback(() => {
    const url = projectPath
      ? `/work-items?cwd=${encodeURIComponent(projectPath)}&t=${Date.now()}`
      : `/work-items?t=${Date.now()}`;

    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        setWorkItems(Array.isArray(data) ? data : (data.workItems || []));
        setLoading(false);
      })
      .catch((error) => {
        console.error('fetchWorkItems failed:', error);
        setLoading(false);
      });
  }, [projectPath]);

  useEffect(() => {
    fetchWorkItems();
    const interval = setInterval(fetchWorkItems, 5000);
    return () => clearInterval(interval);
  }, [fetchWorkItems]);

  const stats = useMemo(() => ({
    total: workItems.length,
    active: workItems.filter((item) => ['assessing', 'planning', 'executing', 'running_checks', 'reviewing', 'ready_for_review'].includes(item.status)).length,
    done: workItems.filter((item) => item.status === 'done').length,
    failed: workItems.filter((item) => item.status === 'failed').length
  }), [workItems]);

  return { workItems, loading, fetchWorkItems, stats };
};
