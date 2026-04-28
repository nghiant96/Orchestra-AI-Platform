import { useState, useEffect, useCallback } from 'react';
import type { Job } from '../types/index.js';

export const useJobs = (pollIntervalMs = 10000) => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<Job['status'] | 'all'>('all');

  const fetchJobs = useCallback(() => {
    fetch('/jobs')
      .then(res => res.json())
      .then(data => {
        setJobs(data.jobs || []);
        setLoading(false);
      })
      .catch(error => {
        console.error('Failed to fetch jobs:', error);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, pollIntervalMs);
    return () => clearInterval(interval);
  }, [fetchJobs, pollIntervalMs]);

  const filteredJobs = jobs.filter(job => 
    statusFilter === 'all' ? true : job.status === statusFilter
  );

  return {
    jobs,
    loading,
    statusFilter,
    setStatusFilter,
    filteredJobs,
    refresh: fetchJobs
  };
};
