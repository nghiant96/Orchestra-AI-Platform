import type { MouseEvent } from 'react';
import { motion } from 'framer-motion';
import { FolderOpen, Clock, Files, XCircle, RefreshCw, Eye } from 'lucide-react';
import { cn } from '../utils/cn';
import type { Job } from '../types';
import { StatusBadge } from './StatusBadge';

interface JobItemProps {
  job: Job;
  index: number;
  onSelect: (jobId: string) => void;
  onCancel: (e: MouseEvent, jobId: string) => void;
  onRerun: (e: MouseEvent, job: Job) => void;
}

export const JobItem = ({ job, index, onSelect, onCancel, onRerun }: JobItemProps) => {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.98, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ delay: index * 0.03 }}
      className="group bg-white rounded-3xl border border-slate-200 shadow-sm hover:shadow-xl hover:shadow-indigo-500/5 transition-all duration-300 overflow-hidden cursor-pointer"
      onClick={() => onSelect(job.jobId)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onSelect(job.jobId);
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
                onClick={(e) => onCancel(e, job.jobId)}
                className="group/btn text-[10px] font-black uppercase tracking-widest text-rose-600 bg-white hover:bg-rose-600 hover:text-white px-4 py-2.5 rounded-xl border border-rose-200 hover:border-rose-600 transition-all flex items-center gap-2"
              >
                <XCircle size={14} />
                Abort
              </button>
            ) : (
              <button
                onClick={(e) => onRerun(e, job)}
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
  );
};
