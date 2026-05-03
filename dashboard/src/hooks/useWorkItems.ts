import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WorkItem } from '../types/index.js';

function parseExternalUrl(url: string): { title: string; source: 'github_issue' | 'github_pr' } | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') return null;
    const match = /^\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)/.exec(parsed.pathname);
    if (!match) return null;
    const [, owner, repo, kind, number] = match;
    return {
      title: `${owner}/${repo}#${number}`,
      source: kind === 'pull' ? 'github_pr' : 'github_issue',
    };
  } catch {
    return null;
  }
}

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

  const action = useCallback(async (id: string, verb: string, body?: unknown) => {
    const url = `/work-items/${encodeURIComponent(id)}/${verb}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null) as Record<string, unknown> | null;
      throw new Error(String(data?.error || `Action ${verb} failed`));
    }
    return res.json();
  }, []);

  const assess = useCallback(async (item: WorkItem) => {
    await action(item.id, 'assess');
    fetchWorkItems();
  }, [action, fetchWorkItems]);

  const run = useCallback(async (item: WorkItem) => {
    await action(item.id, 'run');
    fetchWorkItems();
  }, [action, fetchWorkItems]);

  const cancel = useCallback(async (item: WorkItem) => {
    await action(item.id, 'cancel');
    fetchWorkItems();
  }, [action, fetchWorkItems]);

  const retry = useCallback(async (item: WorkItem) => {
    await action(item.id, 'retry');
    fetchWorkItems();
  }, [action, fetchWorkItems]);

  const importWorkItem = useCallback(async (externalUrl: string) => {
    const parsed = parseExternalUrl(externalUrl);
    if (!parsed) {
      throw new Error('Invalid GitHub issue or PR URL');
    }
    const res = await fetch('/work-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: parsed.title,
        description: externalUrl,
        source: parsed.source,
        type: parsed.source === 'github_pr' ? 'review' : 'bugfix',
        expectedOutput: parsed.source === 'github_pr' ? 'pull_request' : 'patch',
        cwd: projectPath,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error || 'Import failed');
    }
    fetchWorkItems();
    return data;
  }, [projectPath, fetchWorkItems]);

  const stats = useMemo(() => ({
    total: workItems.length,
    active: workItems.filter((item: WorkItem) => ['assessing', 'planning', 'executing', 'running_checks', 'reviewing', 'ready_for_review'].includes(item.status)).length,
    done: workItems.filter((item: WorkItem) => item.status === 'done').length,
    failed: workItems.filter((item: WorkItem) => item.status === 'failed').length
  }), [workItems]);

  return { workItems, loading, fetchWorkItems, stats, assess, run, cancel, retry, importWorkItem };
};
