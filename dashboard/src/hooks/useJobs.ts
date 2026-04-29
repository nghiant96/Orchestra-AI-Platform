import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Job } from '../types';

export const useJobs = () => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<Job['status'] | 'all'>('all');

  const fetchJobs = useCallback(() => {
    fetch(`/jobs?t=${Date.now()}`)
      .then(res => res.json())
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
  }, []);

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 3000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  const stats = useMemo(() => ({
    total: jobs.length,
    running: jobs.filter(j => j.status === 'running').length,
    completed: jobs.filter(j => j.status === 'completed').length,
    failed: jobs.filter(j => j.status === 'failed').length
  }), [jobs]);

  const filteredJobs = useMemo(() =>
    jobs.filter(j => {
      const taskText = j.task || '';
      const matchesSearch = taskText.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === 'all' || j.status === statusFilter;
      return matchesSearch && matchesStatus;
    }),
    [jobs, searchTerm, statusFilter]
  );

  const submitTask = async (task: string, cwd: string, dryRun: boolean) => {
    if (!task) return { ok: false, error: 'Task is required' };

    setSubmitting(true);
    try {
      const response = await fetch('/jobs', {
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
      const response = await fetch(`/jobs/${jobId}/cancel`, { method: 'POST' });
      if (response.ok) {
        fetchJobs();
        return true;
      }
    } catch (error) {
      console.error('Failed to cancel job:', error);
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
    cancelJob
  };
};
