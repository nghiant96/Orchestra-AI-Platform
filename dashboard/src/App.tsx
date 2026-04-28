import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  FolderOpen,
  LayoutDashboard,
  Activity,
  History,
  Search,
  Settings,
  MoreVertical,
  Cpu,
  ShieldCheck,
  Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

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
    queued: 'bg-slate-100 text-slate-600 border-slate-200',
    running: 'bg-indigo-50 text-indigo-600 border-indigo-200 shadow-[0_0_10px_rgba(79,70,229,0.1)]',
    completed: 'bg-emerald-50 text-emerald-600 border-emerald-200',
    failed: 'bg-rose-50 text-rose-600 border-rose-200',
    cancel_requested: 'bg-amber-50 text-amber-600 border-amber-200',
    cancelled: 'bg-slate-100 text-slate-500 border-slate-200'
  };

  const icons = {
    queued: <Clock size={12} />,
    running: <Zap size={12} className="animate-pulse" />,
    completed: <CheckCircle size={12} />,
    failed: <AlertCircle size={12} />,
    cancel_requested: <AlertCircle size={12} />,
    cancelled: <XCircle size={12} />
  };

  return (
    <div className={cn(
      "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider border uppercase transition-all duration-300",
      styles[status]
    )}>
      {icons[status]}
      {status.replace('_', ' ')}
    </div>
  );
};

const StatCard = ({ title, value, icon: Icon, color }: { title: string, value: number, icon: any, color: string }) => (
  <motion.div 
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition-all group"
  >
    <div className={cn("p-3 rounded-xl transition-colors", color)}>
      <Icon size={24} className="group-hover:scale-110 transition-transform" />
    </div>
    <div>
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{title}</p>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
    </div>
  </motion.div>
);

function App() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [task, setTask] = useState('');
  const [cwd, setCwd] = useState('');
  const [dryRun, setDryRun] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

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

  const stats = useMemo(() => ({
    total: jobs.length,
    running: jobs.filter(j => j.status === 'running').length,
    completed: jobs.filter(j => j.status === 'completed').length,
    failed: jobs.filter(j => j.status === 'failed').length
  }), [jobs]);

  const filteredJobs = useMemo(() => 
    jobs.filter(j => j.task.toLowerCase().includes(searchTerm.toLowerCase())),
    [jobs, searchTerm]
  );

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
    <div className="min-h-screen bg-[#F8FAFC] font-sans text-slate-900 antialiased">
      {/* Dynamic Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-indigo-600 to-violet-700 p-2 rounded-xl shadow-lg shadow-indigo-200">
              <Terminal className="text-white" size={22} />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent leading-none">AI Coding System</h1>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Advanced Orchestrator</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center bg-slate-100 rounded-lg px-3 py-1.5 border border-slate-200 gap-2">
              <Search size={14} className="text-slate-400" />
              <input 
                type="text" 
                placeholder="Search jobs..." 
                className="bg-transparent text-xs outline-none w-40 text-slate-600"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <button 
              onClick={() => fetchJobs()}
              className="p-2 text-slate-400 hover:text-indigo-600 transition-colors bg-slate-50 rounded-lg border border-slate-200"
            >
              <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            </button>
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 border-2 border-white shadow-sm" />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard title="Total Jobs" value={stats.total} icon={LayoutDashboard} color="bg-blue-50 text-blue-600" />
          <StatCard title="Active" value={stats.running} icon={Activity} color="bg-indigo-50 text-indigo-600" />
          <StatCard title="Success" value={stats.completed} icon={ShieldCheck} color="bg-emerald-50 text-emerald-600" />
          <StatCard title="Failed" value={stats.failed} icon={AlertCircle} color="bg-rose-50 text-rose-600" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Action Sidebar */}
          <div className="lg:col-span-4">
            <motion.div 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="bg-white rounded-3xl border border-slate-200 shadow-sm p-7 sticky top-24"
            >
              <h2 className="text-xl font-bold mb-6 flex items-center gap-3">
                <div className="p-1.5 bg-indigo-50 rounded-lg text-indigo-600">
                  <Plus size={20} />
                </div>
                New Task
              </h2>
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Instructions</label>
                  <textarea 
                    value={task}
                    onChange={(e) => setTask(e.target.value)}
                    placeholder="Describe what you want to implement or fix..."
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all h-40 text-sm resize-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Workspace</label>
                  <div className="relative group">
                    <FolderOpen className="absolute left-4 top-3 text-slate-400 group-focus-within:text-indigo-500 transition-colors" size={18} />
                    <input 
                      type="text"
                      value={cwd}
                      onChange={(e) => setCwd(e.target.value)}
                      placeholder="Root directory"
                      className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all text-sm"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between px-2 py-1">
                  <span className="text-sm font-semibold text-slate-600">Dry Run Mode</span>
                  <button 
                    type="button"
                    onClick={() => setDryRun(!dryRun)}
                    className={cn(
                      "w-11 h-6 rounded-full transition-colors relative",
                      dryRun ? "bg-indigo-600" : "bg-slate-200"
                    )}
                  >
                    <motion.div 
                      animate={{ x: dryRun ? 22 : 2 }}
                      className="absolute top-1 left-0 w-4 h-4 bg-white rounded-full shadow-sm"
                    />
                  </button>
                </div>
                <button 
                  type="submit"
                  disabled={submitting || !task}
                  className="w-full bg-slate-900 text-white font-bold py-4 px-6 rounded-2xl hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-slate-200 flex items-center justify-center gap-3 group"
                >
                  {submitting ? (
                    <RefreshCw size={20} className="animate-spin" />
                  ) : (
                    <>
                      Execute Pipeline
                      <Zap size={20} className="text-amber-400 group-hover:scale-125 transition-transform" />
                    </>
                  )}
                </button>
              </form>
            </motion.div>
          </div>

          {/* Job Timeline */}
          <div className="lg:col-span-8">
            <div className="space-y-4">
              <div className="flex items-center justify-between px-2 mb-2">
                <h2 className="text-xl font-bold flex items-center gap-3 text-slate-800">
                  <History size={22} className="text-slate-400" />
                  Activity Timeline
                </h2>
                <div className="flex gap-2">
                  <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none mt-0.5">Live Feed</span>
                </div>
              </div>
              
              <AnimatePresence mode="popLayout">
                {filteredJobs.length === 0 ? (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="bg-white rounded-3xl border border-dashed border-slate-300 p-20 text-center"
                  >
                    <div className="bg-slate-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
                      <Cpu size={40} className="text-slate-300" />
                    </div>
                    <h3 className="text-slate-900 font-bold text-lg">No active threads</h3>
                    <p className="text-slate-400 text-sm mt-1">Submit a task to start the orchestration engine.</p>
                  </motion.div>
                ) : (
                  filteredJobs.map((job, index) => (
                    <motion.div 
                      key={job.jobId}
                      layout
                      initial={{ opacity: 0, scale: 0.95, y: 20 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ delay: index * 0.05 }}
                      className="group bg-white rounded-3xl border border-slate-200 shadow-sm hover:shadow-xl hover:shadow-indigo-500/5 transition-all duration-300 overflow-hidden"
                    >
                      <div className="p-6">
                        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
                          <div className="flex-1 space-y-3">
                            <div className="flex items-center gap-3">
                              <span className="font-mono text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-0.5 rounded border border-slate-100 uppercase tracking-tighter">ID: {job.jobId}</span>
                              <StatusBadge status={job.status} />
                            </div>
                            <h3 className="text-lg font-bold text-slate-900 group-hover:text-indigo-600 transition-colors leading-snug">{job.task}</h3>
                            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-semibold text-slate-400">
                              <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1 rounded-lg">
                                <FolderOpen size={14} className="text-slate-400" />
                                {job.cwd || 'System Root'}
                              </div>
                              <div className="flex items-center gap-1.5">
                                <Clock size={14} />
                                {new Date(job.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                <span className="mx-1 opacity-50">•</span>
                                {new Date(job.createdAt).toLocaleDateString()}
                              </div>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2 shrink-0">
                            {(job.status === 'queued' || job.status === 'running') && (
                              <button 
                                onClick={() => handleCancel(job.jobId)}
                                className="group/btn text-xs font-bold text-rose-600 bg-white hover:bg-rose-600 hover:text-white px-4 py-2.5 rounded-xl border border-rose-200 hover:border-rose-600 transition-all flex items-center gap-2"
                              >
                                <XCircle size={16} />
                                Terminate
                              </button>
                            )}
                            {job.artifactPath && (
                              <div className="text-xs font-bold text-indigo-600 bg-indigo-50 px-4 py-2.5 rounded-xl border border-indigo-200 transition-all flex items-center gap-2">
                                <ShieldCheck size={16} />
                                Verified Artifacts
                              </div>
                            )}
                            <button className="p-2.5 text-slate-300 hover:text-slate-600 transition-colors">
                              <MoreVertical size={20} />
                            </button>
                          </div>
                        </div>

                        {/* Expandable Result/Error Panel */}
                        <AnimatePresence>
                          {(job.resultSummary || job.error) && (
                            <motion.div 
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              className="mt-6 pt-6 border-t border-slate-100"
                            >
                              <div className={cn(
                                "rounded-2xl p-4 flex gap-4 transition-colors",
                                job.error ? "bg-rose-50/50" : "bg-slate-50/50"
                              )}>
                                <div className={cn(
                                  "p-2 rounded-xl h-fit",
                                  job.error ? "bg-rose-100 text-rose-600" : "bg-slate-100 text-slate-500"
                                )}>
                                  {job.error ? <AlertCircle size={18} /> : <ChevronRight size={18} />}
                                </div>
                                <div className="flex-1 space-y-1">
                                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Execution Summary</p>
                                  <div className="text-sm">
                                    {job.error ? (
                                      <span className="text-rose-600 font-bold italic leading-relaxed">{job.error}</span>
                                    ) : (
                                      <span className="text-slate-600 whitespace-pre-wrap font-medium leading-relaxed">{job.resultSummary}</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  ))
                )}
              </AnimatePresence>
            </div>
          </div>

        </div>
      </main>
      
      {/* Bottom Status Bar */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-md border-t border-slate-200 py-2 px-6 z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Engine Online
            </div>
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
              Worker ID: {Math.random().toString(36).substring(7)}
            </div>
          </div>
          <div className="flex items-center gap-4">
             <Settings size={14} className="text-slate-400 hover:text-slate-600 cursor-pointer transition-colors" />
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
