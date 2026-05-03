import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import type { Job } from '../types/index.js';
import { apiFetch, apiJson } from '../utils/api';

export const useJobs = (projectPath?: string) => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<Job['status'] | 'all'>('all');

  const fetchJobs = useCallback(() => {
    const url = projectPath 
      ? `/jobs?cwd=${encodeURIComponent(projectPath)}&t=${Date.now()}` 
      : `/jobs?t=${Date.now()}`;
      
    apiJson<{ jobs?: Job[] } | Job[]>(url)
      .then(data => {
        // Đảm bảo lấy được mảng jobs dù cấu trúc data như thế nào
        const jobsArray = Array.isArray(data) ? data : (data.jobs || []);
        setJobs(jobsArray);
        setLoading(false);
      })
      .catch(error => {
        console.error('fetchJobs failed:', error);
        setLoading(false);
      });
  }, [projectPath]);

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 3000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  const stats = useMemo(() => {
    const safeJobs = Array.isArray(jobs) ? jobs : [];
    return {
      total: safeJobs.length,
      running: safeJobs.filter(j => j?.status === 'running').length,
      completed: safeJobs.filter(j => j?.status === 'completed').length,
      failed: safeJobs.filter(j => j?.status === 'failed').length
    };
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    const safeJobs = Array.isArray(jobs) ? jobs : [];
    return safeJobs.filter(j => {
      if (!j) return false;
      const taskText = j.task || '';
      const matchesSearch = taskText.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === 'all' || j.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [jobs, searchTerm, statusFilter]);

  const submitTask = async (task: string, cwd: string, dryRun: boolean) => {
    if (!task) return { ok: false, error: 'Task is required' };

    setSubmitting(true);
    try {
      const response = await apiFetch('/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, cwd, dryRun })
      });

      if (response.ok) {
        fetchJobs();
        return { ok: true };
      } else {
        const errorData = await response.json();
        return { ok: false, error: errorData.error };
      }
    } catch (error) {
      console.error('Failed to submit job:', error);
      return { ok: false, error: 'Failed to connect to the server' };
    } finally {
      setSubmitting(false);
    }
  };

  const cancelJob = async (jobId: string) => {
    try {
      const response = await apiFetch(`/jobs/${jobId}/cancel`, { method: 'POST' });
      if (response.ok) {
        fetchJobs();
        toast.info(`Job cancellation requested`);
        return true;
      }
    } catch (error) {
      console.error('Failed to cancel job:', error);
      toast.error("Failed to cancel job");
    }
    return false;
  };

  const resumeJob = async (jobId: string) => {
    try {
      const response = await apiFetch(`/jobs/${jobId}/resume`, { method: 'POST' });
      if (response.ok) {
        fetchJobs();
        toast.success(`Job resumed from last checkpoint`);
        return true;
      } else {
        const err = await response.json();
        toast.error(`Resume failed: ${err.error}`);
      }
    } catch (error) {
      console.error('Failed to resume job:', error);
      toast.error("Network error while resuming job");
    }
    return false;
  };

  return {
    jobs,
    loading,
    submitting,
    searchTerm,
    setSearchTerm,
    statusFilter,
    setStatusFilter,
    stats,
    filteredJobs,
    fetchJobs,
    submitTask,
    cancelJob,
    resumeJob
  };
};
