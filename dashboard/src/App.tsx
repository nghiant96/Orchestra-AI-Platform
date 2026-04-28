import React, { useState, useMemo } from 'react';
import { Routes, Route } from 'react-router-dom';
import {
  LayoutDashboard,
  Activity,
  History,
  ShieldCheck,
  AlertCircle,
  SearchCode,
  Info,
  Settings
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Job } from './types';
import { cn } from './utils/cn';
import { StatCard } from './components/StatCard';
import { JobDetailModal } from './components/JobDetailModal';
import { ConfigView } from './components/ConfigView';
import { Navbar } from './components/Navbar';
import { TaskForm } from './components/TaskForm';
import { JobItem } from './components/JobItem';
import { useJobs } from './hooks/useJobs';
import { useConfig } from './hooks/useConfig';

function App() {
  const {
    loading: jobsLoading,
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
    jobs
  } = useJobs();

  const {
    config,
    fetchConfig,
  } = useConfig();

  const [task, setTask] = useState('');
  const [cwd, setCwd] = useState('');
  const [dryRun, setDryRun] = useState(true);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const selectedJob = useMemo(() =>
    jobs.find(j => j.jobId === selectedJobId),
    [jobs, selectedJobId]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await submitTask(task, cwd, dryRun);
    if (result.ok) {
      setTask('');
    } else {
      alert(`Error: ${result.error}`);
    }
  };

  const handleRerun = (e: React.MouseEvent, job: Job) => {
    e.stopPropagation();
    setTask(job.task);
    setCwd(job.cwd);
    setDryRun(job.dryRun);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans text-slate-900 antialiased pb-20">
      <Navbar
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        fetchJobs={fetchJobs}
        loading={jobsLoading}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Routes>
          <Route path="/" element={
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
            >
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <StatCard title="Total Workload" value={stats.total} icon={LayoutDashboard} color="bg-blue-50 text-blue-600" />
                <StatCard title="Active Threads" value={stats.running} icon={Activity} color="bg-indigo-50 text-indigo-600" />
                <StatCard title="Successful Runs" value={stats.completed} icon={ShieldCheck} color="bg-emerald-50 text-emerald-600" />
                <StatCard title="Pipeline Failures" value={stats.failed} icon={AlertCircle} color="bg-rose-50 text-rose-600" />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                <div className="lg:col-span-4">
                  <TaskForm
                    handleSubmit={handleSubmit}
                    task={task}
                    setTask={setTask}
                    cwd={cwd}
                    setCwd={setCwd}
                    dryRun={dryRun}
                    setDryRun={setDryRun}
                    submitting={submitting}
                  />
                </div>

                <div className="lg:col-span-8">
                  <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-2 mb-4">
                      <h2 className="text-xl font-black flex items-center gap-3 text-slate-900 uppercase tracking-tight">
                        <History size={22} className="text-indigo-500" />
                        Event Feed
                      </h2>
                      <div className="flex gap-1.5 p-1 bg-slate-200/50 rounded-xl">
                        {(['all', 'running', 'completed', 'failed'] as const).map(filter => (
                          <button
                            key={filter}
                            onClick={() => setStatusFilter(filter)}
                            className={cn(
                              "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                              statusFilter === filter ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                            )}
                          >
                            {filter}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-4">
                      {filteredJobs.length === 0 ? (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="bg-white rounded-3xl border border-dashed border-slate-300 p-20 text-center"
                        >
                          <div className="bg-slate-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
                            <SearchCode size={40} className="text-slate-300" />
                          </div>
                          <h3 className="text-slate-900 font-black text-lg uppercase tracking-tight">No events found</h3>
                          <p className="text-slate-400 text-sm mt-1 font-medium">Try adjusting your filters or search term.</p>
                        </motion.div>
                      ) : (
                        filteredJobs.map((job, index) => (
                          <JobItem
                            key={job.jobId}
                            job={job}
                            index={index}
                            onSelect={setSelectedJobId}
                            onCancel={(e, id) => { e.stopPropagation(); cancelJob(id); }}
                            onRerun={handleRerun}
                          />
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          } />
          <Route path="/config" element={
            <ConfigView config={config} onUpdate={fetchConfig} />
          } />
          <Route path="*" element={
            <div className="p-20 text-center">
              <h2 className="text-2xl font-bold">404 - Page Not Found</h2>
              <p className="text-slate-500">The current URL does not match any route.</p>
              <pre className="mt-4 bg-slate-100 p-4 rounded text-xs">{window.location.hash || window.location.pathname}</pre>
            </div>
          } />
        </Routes>
      </main>

      <AnimatePresence>
        {selectedJob && (
          <JobDetailModal job={selectedJob} onClose={() => setSelectedJobId(null)} onRefresh={fetchJobs} />
        )}
      </AnimatePresence>

      <footer className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-lg border-t border-slate-200 py-3 px-6 z-40">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Engine Online
            </div>
            <div className="hidden sm:flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-indigo-500" />
              Instance: ORCH-DASH-1
            </div>
          </div>
          <div className="flex items-center gap-6">
             <div className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">
               <Info size={14} className="text-indigo-400" />
               Build 2.0.0
             </div>
             <Settings size={16} className="text-slate-400 hover:text-slate-600 cursor-pointer transition-colors" />
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
