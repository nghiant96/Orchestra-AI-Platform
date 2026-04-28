import React, { useState, useEffect, useCallback } from 'react';
import { 
  Play, 
  RefreshCw, 
  XCircle, 
  CheckCircle, 
  Clock, 
  AlertCircle,
  Plus,
  Terminal,
  ExternalLink,
  ChevronRight,
  FolderOpen
} from 'lucide-react';

interface Job {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancel_requested' | 'cancelled';
  task: string;
  cwd: string;
  dryRun: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  artifactPath?: string | null;
  resultSummary?: string | null;
  error?: string | null;
}

const StatusBadge = ({ status }: { status: Job['status'] }) => {
  const styles = {
    queued: 'bg-gray-100 text-gray-600 border-gray-200',
    running: 'bg-blue-100 text-blue-600 border-blue-200 animate-pulse',
    completed: 'bg-green-100 text-green-600 border-green-200',
    failed: 'bg-red-100 text-red-600 border-red-200',
    cancel_requested: 'bg-yellow-100 text-yellow-600 border-yellow-200',
    cancelled: 'bg-gray-200 text-gray-500 border-gray-300'
  };

  const icons = {
    queued: <Clock size={14} />,
    running: <RefreshCw size={14} className="animate-spin" />,
    completed: <CheckCircle size={14} />,
    failed: <AlertCircle size={14} />,
    cancel_requested: <AlertCircle size={14} />,
    cancelled: <XCircle size={14} />
  };

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[status]}`}>
      {icons[status]}
      {status.replace('_', ' ').toUpperCase()}
    </span>
  );
};

function App() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [task, setTask] = useState('');
  const [cwd, setCwd] = useState('');
  const [dryRun, setDryRun] = useState(true);

  const fetchJobs = useCallback(async () => {
    try {
      const response = await fetch('/jobs');
      const data = await response.json();
      setJobs(data.jobs || []);
    } catch (error) {
      console.error('Failed to fetch jobs:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 3000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!task) return;

    setSubmitting(true);
    try {
      const response = await fetch('/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, cwd, dryRun })
      });
      
      if (response.ok) {
        setTask('');
        fetchJobs();
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Failed to submit job:', error);
      alert('Failed to connect to the server');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (jobId: string) => {
    try {
      const response = await fetch(`/jobs/${jobId}/cancel`, { method: 'POST' });
      if (response.ok) {
        fetchJobs();
      }
    } catch (error) {
      console.error('Failed to cancel job:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-900">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 p-1.5 rounded-lg">
              <Terminal className="text-white" size={24} />
            </div>
            <h1 className="text-xl font-bold tracking-tight">AI Coding System <span className="text-gray-400 font-normal">Dashboard</span></h1>
          </div>
          <button 
            onClick={() => fetchJobs()}
            className="p-2 text-gray-500 hover:text-indigo-600 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Sidebar: New Job Form */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Plus size={20} className="text-indigo-600" />
                Submit New Task
              </h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Task Description</label>
                  <textarea 
                    value={task}
                    onChange={(e) => setTask(e.target.value)}
                    placeholder="e.g. Refactor the auth flow to use JWT"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all h-32 text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Working Directory (Optional)</label>
                  <div className="relative">
                    <FolderOpen className="absolute left-3 top-2.5 text-gray-400" size={16} />
                    <input 
                      type="text"
                      value={cwd}
                      onChange={(e) => setCwd(e.target.value)}
                      placeholder="Default to server root"
                      className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all text-sm"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2 py-2">
                  <input 
                    type="checkbox"
                    id="dryRun"
                    checked={dryRun}
                    onChange={(e) => setDryRun(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                  />
                  <label htmlFor="dryRun" className="text-sm text-gray-600 cursor-pointer">Dry Run (don't write files)</label>
                </div>
                <button 
                  type="submit"
                  disabled={submitting || !task}
                  className="w-full bg-indigo-600 text-white font-semibold py-2.5 px-4 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                >
                  {submitting ? <RefreshCw size={18} className="animate-spin" /> : <Play size={18} />}
                  Enqueu Job
                </button>
              </form>
            </div>
          </div>

          {/* Main Content: Job History */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                <h2 className="font-semibold text-gray-700">Recent Jobs</h2>
                <span className="text-xs text-gray-500 bg-white px-2 py-1 rounded border border-gray-100 shadow-sm">
                  {jobs.length} total
                </span>
              </div>
              
              <div className="divide-y divide-gray-100">
                {jobs.length === 0 ? (
                  <div className="p-12 text-center text-gray-400">
                    <Clock size={48} className="mx-auto mb-4 opacity-20" />
                    <p>No jobs found. Submit your first task!</p>
                  </div>
                ) : (
                  jobs.map((job) => (
                    <div key={job.jobId} className="p-6 hover:bg-gray-50/80 transition-colors">
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                        <div className="space-y-1 flex-1">
                          <div className="flex items-center gap-3 mb-1">
                            <span className="font-mono text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded uppercase">{job.jobId}</span>
                            <StatusBadge status={job.status} />
                          </div>
                          <h3 className="font-medium text-gray-900 leading-tight">{job.task}</h3>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 mt-2">
                            <span className="flex items-center gap-1">
                              <FolderOpen size={12} />
                              {job.cwd || 'Root'}
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock size={12} />
                              {new Date(job.createdAt).toLocaleString()}
                            </span>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          {(job.status === 'queued' || job.status === 'running') && (
                            <button 
                              onClick={() => handleCancel(job.jobId)}
                              className="text-xs font-semibold text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-md border border-red-200 transition-all flex items-center gap-1"
                            >
                              <XCircle size={14} />
                              Cancel
                            </button>
                          )}
                          {job.artifactPath && (
                            <div className="text-xs font-semibold text-indigo-600 hover:bg-indigo-50 px-3 py-1.5 rounded-md border border-indigo-200 transition-all flex items-center gap-1 cursor-default">
                              <ExternalLink size={14} />
                              Artifacts Ready
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Result / Error Details */}
                      {(job.resultSummary || job.error) && (
                        <div className="mt-4 bg-gray-50 rounded-lg p-3 border border-gray-100">
                          <div className="flex items-start gap-2">
                            <ChevronRight size={16} className="text-gray-400 mt-0.5" />
                            <div className="text-sm">
                              {job.error ? (
                                <span className="text-red-600 font-medium">Error: {job.error}</span>
                              ) : (
                                <span className="text-gray-700 whitespace-pre-wrap">{job.resultSummary}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}

export default App;
