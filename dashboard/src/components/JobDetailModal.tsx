import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  XCircle,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  Terminal,
  Activity,
  Clock,
  Zap,
  AlertCircle,
  BarChart3,
  Cpu,
  Files,
  FileCode,
  ChevronRight,
  FolderOpen
} from 'lucide-react';
import { ResponsiveContainer, BarChart, CartesianGrid, XAxis, YAxis, Tooltip, Bar, Cell } from 'recharts';
import { cn } from '../utils/cn';
import type { Job } from '../types';
import { StatusBadge } from './StatusBadge';
import { FileDiffView } from './FileDiffView';
import { StreamingConsole } from './StreamingConsole';

interface JobDetailModalProps {
  job: Job;
  onClose: () => void;
  onRefresh: () => void;
}

export const JobDetailModal = ({ job, onClose, onRefresh }: JobDetailModalProps) => {
  const [activeTab, setActiveTab] = useState<'timeline' | 'analytics' | 'diagnostics' | 'files' | 'console'>('timeline');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [actioning, setActioning] = useState(false);

  const handleApproval = async (approve: boolean) => {
    setActioning(true);
    try {
      const res = await fetch(`/jobs/${job.jobId}/${approve ? 'approve' : 'reject'}`, { method: 'POST' });
      if (res.ok) {
        onRefresh();
      }
    } catch {
      console.error('Approval failed');
    } finally {
      setActioning(false);
    }
  };

  const transitions = job.execution?.transitions || [];
  const metrics = job.execution?.providerMetrics || [];
  const toolResults = job.latestToolResults || [];
  const diffSummaries = job.diffSummaries || [];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="p-6 border-b border-slate-100 bg-slate-50/50">
          <div className="flex justify-between items-start mb-4">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h2 id="modal-title" className="text-xl font-bold text-slate-900">Job Intelligence</h2>
                <StatusBadge status={job.status} />
              </div>
              <p className="text-xs font-mono text-slate-400 uppercase tracking-widest">ID: {job.jobId}</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-400 hover:text-slate-600"
              aria-label="Close modal"
            >
              <XCircle size={24} />
            </button>
          </div>

          <div className="flex gap-1 p-1 bg-slate-200/50 rounded-xl w-fit">
            {(['timeline', 'analytics', 'diagnostics', 'files', 'console'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-tight transition-all",
                  activeTab === tab ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                )}
              >
                {tab === 'files' ? 'File Changes' : tab}
              </button>
            ))}
          </div>
        </div>

        {job.status === 'waiting_for_approval' && (
          <div className="mx-6 mt-6 p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-center justify-between">
            <div className="flex items-center gap-3 text-amber-800">
              <div className="bg-amber-100 p-2 rounded-xl">
                <AlertTriangle size={20} />
              </div>
              <div>
                <p className="text-sm font-black uppercase tracking-tight">Human intervention required</p>
                <p className="text-xs font-medium opacity-80">The system is waiting for you to review and approve the next stage.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => handleApproval(false)}
                disabled={actioning}
                className="px-4 py-2 bg-white border border-rose-200 text-rose-600 rounded-xl text-xs font-bold hover:bg-rose-50 transition-all"
              >
                Reject & Stop
              </button>
              <button
                onClick={() => handleApproval(true)}
                disabled={actioning}
                className="px-6 py-2 bg-amber-500 text-white rounded-xl text-xs font-bold hover:bg-amber-600 transition-all shadow-md shadow-amber-200 flex items-center gap-2"
              >
                {actioning ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                Approve Plan
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6">
          <AnimatePresence mode="wait">
            {activeTab === 'timeline' && (
              <motion.div
                key="timeline"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="space-y-8"
              >
                <section>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <Terminal size={14} />
                    Prompt Configuration
                  </h3>
                  <div className="bg-slate-900 rounded-2xl p-5 text-indigo-200 font-mono text-xs leading-relaxed border border-slate-800 shadow-inner">
                    {job.task}
                  </div>
                </section>

                <section>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <Activity size={14} />
                    Status Stream
                  </h3>
                  <div className="space-y-4">
                    {transitions.length === 0 ? (
                      <div className="text-center py-10 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                        <Clock size={32} className="mx-auto text-slate-300 mb-3" />
                        <p className="text-sm text-slate-400 font-medium">No transitions recorded.</p>
                      </div>
                    ) : (
                      transitions.map((t, i) => (
                        <div key={i} className="flex gap-4 group">
                          <div className="flex flex-col items-center">
                            <div className={cn(
                              "w-8 h-8 rounded-full flex items-center justify-center shrink-0 border-2 z-10",
                              t.status === 'entered' ? "bg-indigo-50 border-indigo-200 text-indigo-600" :
                              t.status === 'completed' ? "bg-emerald-50 border-emerald-200 text-emerald-600" :
                              t.status === 'failed' ? "bg-rose-50 border-rose-200 text-rose-600" :
                              "bg-slate-50 border-slate-200 text-slate-400"
                            )}>
                              {t.status === 'entered' ? <Zap size={14} className="animate-pulse" /> :
                               t.status === 'completed' ? <CheckCircle size={14} /> :
                               t.status === 'failed' ? <AlertCircle size={14} /> :
                               <Clock size={14} />}
                            </div>
                            {i < transitions.length - 1 && (
                              <div className="w-0.5 flex-1 bg-slate-100 my-1 group-last:hidden" />
                            )}
                          </div>
                          <div className="pb-6 flex-1">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-bold text-slate-900 uppercase tracking-tight">{t.stage.replace(/-/g, ' ')}</span>
                              <span className="text-[10px] font-mono text-slate-400">{new Date(t.timestamp).toLocaleTimeString()}</span>
                            </div>
                            <p className="text-xs text-slate-500 font-medium leading-relaxed">{t.detail || `Stage ${t.status}`}</p>
                          </div>
                        </div>
                      )).reverse()
                    )}
                  </div>
                </section>
              </motion.div>
            )}

            {activeTab === 'analytics' && (
              <motion.div
                key="analytics"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="space-y-8"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-indigo-50/50 rounded-2xl p-5 border border-indigo-100">
                    <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-1">Total Duration</p>
                    <p className="text-2xl font-black text-indigo-700">
                      {job.execution?.totalDurationMs ? `${(job.execution.totalDurationMs / 1000).toFixed(1)}s` : 'N/A'}
                    </p>
                  </div>
                  <div className="bg-emerald-50/50 rounded-2xl p-5 border border-emerald-100">
                    <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest mb-1">Estimated Cost</p>
                    <p className="text-2xl font-black text-emerald-700">
                      {job.execution?.budget?.totalCostUnits ? `${job.execution.budget.totalCostUnits.toFixed(2)} units` : '0.00 units'}
                    </p>
                  </div>
                </div>

                {metrics.length > 0 && (
                  <section className="bg-white rounded-3xl border border-slate-100 p-6 shadow-sm">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                      <BarChart3 size={14} />
                      Cost Distribution (Units)
                    </h3>
                    <div className="h-[250px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={metrics.map(m => ({
                          name: m.role.toUpperCase(),
                          cost: Number(m.estimatedCostUnits.toFixed(3)),
                          fullRole: m.role
                        }))}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis
                            dataKey="name"
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
                          />
                          <YAxis
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
                          />
                          <Tooltip
                            cursor={{ fill: '#f8fafc' }}
                            content={({ active, payload }) => {
                              if (active && payload && payload.length) {
                                return (
                                  <div className="bg-slate-900 text-white p-3 rounded-xl shadow-xl border border-slate-800 text-[10px] font-bold">
                                    <p className="uppercase tracking-widest mb-1 text-slate-400">{payload[0].payload.fullRole}</p>
                                    <p className="text-indigo-400 text-sm">{payload[0].value} units</p>
                                  </div>
                                );
                              }
                              return null;
                            }}
                          />
                          <Bar dataKey="cost" radius={[6, 6, 0, 0]} barSize={40}>
                            {metrics.map((_, index) => (
                              <Cell key={`cell-${index}`} fill={['#6366f1', '#10b981', '#f59e0b', '#ec4899'][index % 4]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </section>
                )}

                <section>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <Cpu size={14} />
                    Provider Breakdown
                  </h3>
                  <div className="space-y-3">
                    {metrics.length === 0 ? (
                      <p className="text-center py-6 text-slate-400 text-xs italic">No metric data available for this run.</p>
                    ) : (
                      metrics.map((m, i) => (
                        <div key={i} className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center justify-between shadow-sm">
                          <div className="flex items-center gap-3">
                            <div className="bg-slate-100 p-2 rounded-xl text-slate-600">
                              <Cpu size={18} />
                            </div>
                            <div>
                              <p className="text-xs font-bold text-slate-900 uppercase tracking-tight">{m.role}</p>
                              <p className="text-[10px] text-slate-400 font-medium">{m.provider}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-bold text-slate-700">{(m.totalDurationMs / 1000).toFixed(1)}s</p>
                            <p className="text-[10px] text-indigo-500 font-bold uppercase tracking-tighter">{m.estimatedCostUnits.toFixed(2)} units</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </motion.div>
            )}

            {activeTab === 'diagnostics' && (
              <motion.div
                key="diagnostics"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="space-y-6"
              >
                <section>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <AlertTriangle size={14} />
                    Tool Execution Results
                  </h3>
                  <div className="space-y-4">
                    {toolResults.length === 0 ? (
                      <p className="text-center py-6 text-slate-400 text-xs italic">No tool logs available.</p>
                    ) : (
                      toolResults.map((tr, i) => (
                        <div key={i} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                          <div className={cn(
                            "px-4 py-3 flex items-center justify-between",
                            tr.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                          )}>
                            <div className="flex items-center gap-2">
                              {tr.ok ? <CheckCircle size={14} /> : <XCircle size={14} />}
                              <span className="text-xs font-bold uppercase tracking-tight">{tr.name}</span>
                            </div>
                            <span className="text-[10px] font-bold opacity-60">{(tr.durationMs / 1000).toFixed(1)}s</span>
                          </div>
                          {(tr.stdout || tr.stderr) && (
                            <div className="p-4 bg-slate-900 text-[10px] font-mono leading-relaxed overflow-x-auto max-h-60">
                              {tr.stderr && <div className="text-rose-400 mb-2">{tr.stderr}</div>}
                              {tr.stdout && <div className="text-slate-300">{tr.stdout}</div>}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </motion.div>
            )}

            {activeTab === 'files' && (
              <motion.div
                key="files"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="h-full"
              >
                {selectedFile ? (
                  <FileDiffView
                    jobId={job.jobId}
                    path={selectedFile}
                    onClose={() => setSelectedFile(null)}
                  />
                ) : (
                  <div className="space-y-6">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                      <Files size={14} />
                      Changed Files
                    </h3>
                    <div className="space-y-3">
                      {diffSummaries.length === 0 ? (
                        <div className="text-center py-10 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                          <FileCode size={32} className="mx-auto text-slate-300 mb-3" />
                          <p className="text-sm text-slate-400 font-medium">No file changes recorded.</p>
                        </div>
                      ) : (
                        diffSummaries.map((ds, i) => (
                          <div
                            key={i}
                            onClick={() => setSelectedFile(ds.path)}
                            className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm group hover:border-indigo-500/50 hover:shadow-md transition-all cursor-pointer"
                          >
                            <div className="flex items-center justify-between gap-4">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="bg-slate-100 p-2 rounded-xl text-slate-600 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors">
                                  <FileCode size={18} />
                                </div>
                                <div className="min-w-0">
                                  <p className="text-sm font-bold text-slate-900 truncate">{ds.path}</p>
                                  <p className="text-[10px] text-slate-400 font-medium">{ds.beforeLineCount} lines &rarr; {ds.afterLineCount} lines</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-3 shrink-0">
                                <div className="flex items-center gap-2">
                                  {ds.addedLines > 0 && (
                                    <span className="bg-emerald-50 text-emerald-600 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-100">
                                      +{ds.addedLines}
                                    </span>
                                  )}
                                  {ds.removedLines > 0 && (
                                    <span className="bg-rose-50 text-rose-600 text-[10px] font-bold px-2 py-0.5 rounded-full border border-rose-100">
                                      -{ds.removedLines}
                                    </span>
                                  )}
                                  {ds.addedLines === 0 && ds.removedLines === 0 && ds.changedLineEstimate > 0 && (
                                    <span className="bg-amber-50 text-amber-600 text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-100">
                                      ~{ds.changedLineEstimate}
                                    </span>
                                  )}
                                </div>
                                <ChevronRight size={16} className="text-slate-300 group-hover:text-indigo-500 transition-colors" />
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'console' && (
              <motion.div
                key="console"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="h-full"
              >
                <StreamingConsole jobId={job.jobId} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 transition-all shadow-sm"
          >
            Dismiss
          </button>
          {job.artifactPath && (
             <button className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 flex items-center gap-2">
               <FolderOpen size={16} />
               Explore Artifacts
             </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};
