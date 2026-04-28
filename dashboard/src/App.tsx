import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  RefreshCw, 
  XCircle, 
  CheckCircle, 
  Clock, 
  AlertCircle,
  Plus,
  Terminal,
  FolderOpen,
  LayoutDashboard,
  Activity,
  History,
  Search,
  Settings,
  Cpu,
  ShieldCheck,
  Zap,
  Eye,
  type LucideIcon,
  BarChart3,
  SearchCode,
  Globe,
  Database,
  Layers,
  FileJson,
  FileCode,
  Files,
  AlertTriangle,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type ViewMode = 'activity' | 'config';

interface ExecutionTransition {
  stage: string;
  status: string;
  timestamp: string;
  detail?: string;
  iteration?: number;
}

interface ProviderMetric {
  provider: string;
  role: string;
  totalDurationMs: number;
  estimatedCostUnits: number;
}

interface ToolResult {
  name: string;
  kind: string;
  ok: boolean;
  skipped: boolean;
  issueCount: number;
  durationMs: number;
  stdout?: string;
  stderr?: string;
  summary: string;
  command?: string;
}

interface DiffSummary {
  path: string;
  beforeLineCount: number;
  afterLineCount: number;
  addedLines: number;
  removedLines: number;
  changedLineEstimate: number;
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
  diffSummaries?: DiffSummary[];
  latestToolResults?: ToolResult[];
  execution?: {
    transitions?: ExecutionTransition[];
    providerMetrics?: ProviderMetric[];
    totalDurationMs?: number;
    budget?: {
      maxDurationMs: number | null;
      maxCostUnits: number | null;
      totalDurationMs: number;
      totalCostUnits: number;
      exceeded: 'duration' | 'cost' | null;
    } | null;
  };
}

interface SystemConfig {
  rules: any;
  profile: string | null;
  globalProfile: string | null;
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

const StatCard = ({ title, value, icon: Icon, color, subvalue }: { title: string, value: string | number, icon: LucideIcon, color: string, subvalue?: string }) => (
  <motion.div 
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition-all group"
  >
    <div className={cn("p-3 rounded-xl transition-colors", color)}>
      <Icon size={24} className="group-hover:scale-110 transition-transform" />
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate">{title}</p>
      <p className="text-xl font-bold text-slate-900 truncate">{value}</p>
      {subvalue && <p className="text-[10px] text-slate-500 font-medium truncate mt-0.5">{subvalue}</p>}
    </div>
  </motion.div>
);

const JobDetailModal = ({ job, onClose }: { job: Job, onClose: () => void }) => {
  const [activeTab, setActiveTab] = useState<'timeline' | 'analytics' | 'diagnostics' | 'files'>('timeline');
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
            {(['timeline', 'analytics', 'diagnostics', 'files'] as const).map(tab => (
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
                className="space-y-6"
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

                <section>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <BarChart3 size={14} />
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
                className="space-y-6"
              >
                <section>
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
                        <div key={i} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm group">
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
                            <div className="flex items-center gap-2 shrink-0">
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
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>
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

const ConfigView = ({ config }: { config: SystemConfig | null }) => {
  if (!config) {
    return (
      <div className="bg-white rounded-3xl p-20 text-center border border-slate-200">
        <RefreshCw size={40} className="mx-auto text-slate-300 animate-spin mb-4" />
        <p className="text-slate-500 font-medium">Loading system configuration...</p>
      </div>
    );
  }

  const providers = Object.entries(config.rules.providers || {});

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8"
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard title="Active Profile" value={config.profile || 'Default'} icon={Globe} color="bg-blue-50 text-blue-600" />
        <StatCard title="Global Profile" value={config.globalProfile || 'None'} icon={Layers} color="bg-indigo-50 text-indigo-600" />
        <StatCard title="Max Iterations" value={config.rules.max_iterations} icon={Zap} color="bg-amber-50 text-amber-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
          <h2 className="text-xl font-black mb-6 flex items-center gap-3">
            <Cpu className="text-indigo-500" />
            AI Providers
          </h2>
          <div className="space-y-4">
            {providers.map(([role, setup]: [string, any]) => (
              <div key={role} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="bg-white p-2 rounded-xl border border-slate-200 shadow-sm font-bold text-xs uppercase text-slate-500">
                    {role}
                  </div>
                  <span className="text-sm font-black text-slate-800">{setup.type}</span>
                </div>
                {setup.model && <span className="text-[10px] font-mono bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded font-bold">{setup.model}</span>}
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
          <h2 className="text-xl font-black mb-6 flex items-center gap-3">
            <ShieldCheck className="text-emerald-500" />
            System Rules
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Max Files</p>
              <p className="text-lg font-bold text-slate-900">{config.rules.max_files}</p>
            </div>
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Context Limit</p>
              <p className="text-lg font-bold text-slate-900">{(config.rules.max_context_bytes / 1024).toFixed(0)} KB</p>
            </div>
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Memory Backend</p>
              <p className="text-lg font-bold text-slate-900 capitalize">{config.rules.memory?.backend || 'Local'}</p>
            </div>
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Vector Search</p>
              <p className="text-lg font-bold text-slate-900">{config.rules.vector_search?.enabled ? 'Active' : 'Disabled'}</p>
            </div>
          </div>
        </section>

        <section className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
          <h2 className="text-xl font-black mb-6 flex items-center gap-3">
            <BarChart3 className="text-blue-500" />
            Execution Budgets
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Max Cost Units</p>
              <p className="text-lg font-bold text-slate-900">{config.rules.execution?.budgets?.max_cost_units || 'No Limit'}</p>
            </div>
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Max Duration</p>
              <p className="text-lg font-bold text-slate-900">
                {config.rules.execution?.budgets?.max_duration_ms 
                  ? `${(config.rules.execution.budgets.max_duration_ms / 60000).toFixed(0)} min` 
                  : 'No Limit'}
              </p>
            </div>
          </div>
        </section>

        <section className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
          <h2 className="text-xl font-black mb-6 flex items-center gap-3">
            <RefreshCw className="text-amber-500" />
            Routing Configuration
          </h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
               <span className="text-xs font-bold text-slate-400 uppercase">Routing Enabled</span>
               <span className={cn(
                 "text-xs font-black uppercase tracking-widest px-2 py-0.5 rounded",
                 config.rules.routing?.enabled !== false ? "bg-emerald-100 text-emerald-600" : "bg-slate-200 text-slate-500"
               )}>
                 {config.rules.routing?.enabled !== false ? 'Enabled' : 'Disabled'}
               </span>
            </div>
            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
               <span className="text-xs font-bold text-slate-400 uppercase">Adaptive Routing</span>
               <span className={cn(
                 "text-xs font-black uppercase tracking-widest px-2 py-0.5 rounded",
                 config.rules.routing?.adaptive?.enabled ? "bg-indigo-100 text-indigo-600" : "bg-slate-200 text-slate-500"
               )}>
                 {config.rules.routing?.adaptive?.enabled ? 'Active' : 'Inactive'}
               </span>
            </div>
          </div>
        </section>
      </div>

      <section className="bg-slate-900 rounded-3xl p-8 border border-slate-800 shadow-xl overflow-hidden relative">
        <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
          <FileJson size={120} />
        </div>
        <h2 className="text-xl font-black mb-6 flex items-center gap-3 text-white">
          <Database className="text-indigo-400" />
          Raw Registry
        </h2>
        <div className="bg-slate-800/50 rounded-2xl p-6 overflow-x-auto">
          <pre className="text-xs text-indigo-300 font-mono leading-relaxed">
            {JSON.stringify(config.rules, null, 2)}
          </pre>
        </div>
      </section>
    </motion.div>
  );
};

function App() {
  const [view, setView] = useState<ViewMode>('activity');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [task, setTask] = useState('');
  const [cwd, setCwd] = useState('');
  const [dryRun, setDryRun] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [config, setConfig] = useState<SystemConfig | null>(null);
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

  const fetchConfig = useCallback(() => {
    fetch('/config')
      .then(res => res.json())
      .then(data => setConfig(data))
      .catch(err => console.error('Failed to fetch config:', err));
  }, []);

  useEffect(() => {
    fetchJobs();
    fetchConfig();
    const interval = setInterval(fetchJobs, 3000);
    return () => clearInterval(interval);
  }, [fetchJobs, fetchConfig]);

  const stats = useMemo(() => ({
    total: jobs.length,
    running: jobs.filter(j => j.status === 'running').length,
    completed: jobs.filter(j => j.status === 'completed').length,
    failed: jobs.filter(j => j.status === 'failed').length
  }), [jobs]);

  const filteredJobs = useMemo(() => 
    jobs.filter(j => {
      const matchesSearch = j.task.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === 'all' || j.status === statusFilter;
      return matchesSearch && matchesStatus;
    }),
    [jobs, searchTerm, statusFilter]
  );

  const selectedJob = useMemo(() => 
    jobs.find(j => j.jobId === selectedJobId),
    [jobs, selectedJobId]
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

  const handleCancel = async (e: React.MouseEvent, jobId: string) => {
    e.stopPropagation();
    try {
      const response = await fetch(`/jobs/${jobId}/cancel`, { method: 'POST' });
      if (response.ok) {
        fetchJobs();
      }
    } catch (error) {
      console.error('Failed to cancel job:', error);
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
      {/* Navigation */}
      <nav className="bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex justify-between items-center">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-3">
              <div className="bg-gradient-to-br from-indigo-600 to-violet-700 p-2 rounded-xl shadow-lg shadow-indigo-200">
                <Terminal className="text-white" size={22} />
              </div>
              <div className="hidden sm:block">
                <h1 className="text-lg font-black tracking-tight bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent leading-none">ORCHESTRA</h1>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">AI Coding System</p>
              </div>
            </div>
            
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
              <button 
                onClick={() => setView('activity')}
                className={cn(
                  "px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2",
                  view === 'activity' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-400 hover:text-slate-600"
                )}
              >
                <Activity size={14} />
                Activity
              </button>
              <button 
                onClick={() => setView('config')}
                className={cn(
                  "px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2",
                  view === 'config' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-400 hover:text-slate-600"
                )}
              >
                <Settings size={14} />
                Config
              </button>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center bg-slate-100 rounded-lg px-3 py-1.5 border border-slate-200 gap-2">
              <Search size={14} className="text-slate-400" />
              <input 
                type="text" 
                placeholder="Search engine..." 
                className="bg-transparent text-xs outline-none w-40 text-slate-600 font-medium"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <button 
              onClick={() => fetchJobs()}
              className="p-2 text-slate-400 hover:text-indigo-600 transition-colors bg-slate-50 rounded-lg border border-slate-200"
              aria-label="Refresh jobs"
            >
              <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            </button>
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 border-2 border-white shadow-sm cursor-pointer" />
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <AnimatePresence mode="wait">
          {view === 'activity' ? (
            <motion.div 
              key="activity"
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
                  <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-7 sticky top-24">
                    <h2 className="text-xl font-black mb-6 flex items-center gap-3">
                      <div className="p-1.5 bg-indigo-50 rounded-lg text-indigo-600">
                        <Plus size={20} />
                      </div>
                      Create Task
                    </h2>
                    <form onSubmit={handleSubmit} className="space-y-5">
                      <div>
                        <label htmlFor="task-input" className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Instructions</label>
                        <textarea 
                          id="task-input"
                          value={task}
                          onChange={(e) => setTask(e.target.value)}
                          placeholder="Describe the feature or bug fix..."
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all h-40 text-sm resize-none font-medium"
                          required
                        />
                      </div>
                      <div>
                        <label htmlFor="cwd-input" className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Workspace</label>
                        <div className="relative group">
                          <FolderOpen className="absolute left-4 top-3 text-slate-400 group-focus-within:text-indigo-500 transition-colors" size={18} />
                          <input 
                            id="cwd-input"
                            type="text"
                            value={cwd}
                            onChange={(e) => setCwd(e.target.value)}
                            placeholder="Project root path"
                            className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all text-sm font-medium"
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-between px-2 py-1">
                        <span className="text-xs font-black text-slate-500 uppercase tracking-tight">Dry Run Mode</span>
                        <button 
                          type="button"
                          onClick={() => setDryRun(!dryRun)}
                          aria-label={`Toggle dry run: ${dryRun ? 'on' : 'off'}`}
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
                        className="w-full bg-slate-900 text-white font-black py-4 px-6 rounded-2xl hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-slate-200 flex items-center justify-center gap-3 group uppercase tracking-widest text-xs"
                      >
                        {submitting ? (
                          <RefreshCw size={18} className="animate-spin" />
                        ) : (
                          <>
                            Run Pipeline
                            <Zap size={18} className="text-amber-400 group-hover:scale-125 transition-transform" />
                          </>
                        )}
                      </button>
                    </form>
                  </div>
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
                    
                    <AnimatePresence mode="popLayout">
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
                          <motion.div 
                            key={job.jobId}
                            layout
                            initial={{ opacity: 0, scale: 0.98, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.98 }}
                            transition={{ delay: index * 0.03 }}
                            className="group bg-white rounded-3xl border border-slate-200 shadow-sm hover:shadow-xl hover:shadow-indigo-500/5 transition-all duration-300 overflow-hidden cursor-pointer"
                            onClick={() => setSelectedJobId(job.jobId)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                setSelectedJobId(job.jobId);
                              }
                            }}
                          >
                            <div className="p-6">
                              <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
                                <div className="flex-1 min-w-0 space-y-4">
                                  <div className="flex items-center gap-3">
                                    <span className="font-mono text-[10px] font-black text-indigo-500 bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-100 uppercase tracking-tighter">
                                      {job.jobId.startsWith('run-') ? 'CLI' : 'QUEUED'}: {job.jobId.substring(0, 12)}...
                                    </span>
                                    <StatusBadge status={job.status} />
                                  </div>
                                  <h3 className="text-lg font-black text-slate-900 group-hover:text-indigo-600 transition-colors leading-tight truncate">
                                    {job.task}
                                  </h3>
                                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                    <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-100">
                                      <FolderOpen size={12} className="text-slate-400" />
                                      {job.cwd ? (job.cwd.split(/[/\\]/).pop() || 'Workspace') : 'Workspace'}
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      <Clock size={12} />
                                      {new Date(job.createdAt).toLocaleTimeString()}
                                      <span className="mx-1 opacity-30">•</span>
                                      {new Date(job.createdAt).toLocaleDateString()}
                                    </div>
                                    {job.diffSummaries && job.diffSummaries.length > 0 && (
                                      <div className="flex items-center gap-1.5 bg-emerald-50 text-emerald-600 px-2.5 py-1 rounded-lg border border-emerald-100">
                                        <Files size={12} />
                                        {job.diffSummaries.length} files changed
                                      </div>
                                    )}
                                  </div>
                                </div>
                                
                                <div className="flex items-center gap-2 shrink-0">
                                  {(job.status === 'queued' || job.status === 'running') ? (
                                    <button 
                                      onClick={(e) => handleCancel(e, job.jobId)}
                                      className="group/btn text-[10px] font-black uppercase tracking-widest text-rose-600 bg-white hover:bg-rose-600 hover:text-white px-4 py-2.5 rounded-xl border border-rose-200 hover:border-rose-600 transition-all flex items-center gap-2"
                                    >
                                      <XCircle size={14} />
                                      Abort
                                    </button>
                                  ) : (
                                    <button 
                                      onClick={(e) => handleRerun(e, job)}
                                      className="group/btn text-[10px] font-black uppercase tracking-widest text-indigo-600 bg-white hover:bg-indigo-600 hover:text-white px-4 py-2.5 rounded-xl border border-indigo-200 hover:border-indigo-600 transition-all flex items-center gap-2"
                                    >
                                      <RefreshCw size={14} />
                                      Clone
                                    </button>
                                  )}
                                  <div className="p-2.5 text-slate-300 group-hover:text-indigo-600 transition-colors">
                                    <Eye size={22} />
                                  </div>
                                </div>
                              </div>
                              
                              {/* Preview Info */}
                              {job.execution?.budget && (
                                <div className="mt-6 pt-6 border-t border-slate-50 flex items-center gap-8 overflow-hidden">
                                  <div className="flex-1">
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Cost Utilization</p>
                                    <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                      <motion.div 
                                        initial={{ width: 0 }}
                                        animate={{ width: `${Math.min(100, (job.execution.budget.totalCostUnits / (job.execution.budget.maxCostUnits || 100)) * 100)}%` }}
                                        className={cn(
                                          "h-full rounded-full transition-all",
                                          job.execution.budget.exceeded === 'cost' ? "bg-rose-500" : "bg-indigo-500"
                                        )}
                                      />
                                    </div>
                                  </div>
                                  <div className="shrink-0 text-right">
                                     <p className="text-xs font-black text-slate-900">{job.execution.budget.totalCostUnits.toFixed(2)}</p>
                                     <p className="text-[10px] font-bold text-slate-400">UNITS</p>
                                  </div>
                                </div>
                              )}
                            </div>
                          </motion.div>
                        ))
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : (
            <ConfigView config={config} />
          )}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {selectedJob && (
          <JobDetailModal job={selectedJob} onClose={() => setSelectedJobId(null)} />
        )}
      </AnimatePresence>
      
      {/* Footer Navigation */}
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
