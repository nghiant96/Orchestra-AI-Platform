import { motion } from 'framer-motion';
import { 
  FolderOpen, 
  Clock, 
  Zap, 
  ChevronRight 
} from 'lucide-react';
import { StatusBadge } from '../ui/StatusBadge';
import type { Job } from '../../types';

interface JobItemProps {
  job: Job;
  index: number;
  onClick: (id: string) => void;
}

export const JobItem = ({ job, index, onClick }: JobItemProps) => {
  return (
    <motion.div 
      layout
      initial={{ opacity: 0, scale: 0.98, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ delay: index * 0.03 }}
      className="group bg-white rounded-3xl border border-slate-200 shadow-sm hover:shadow-xl hover:shadow-indigo-500/5 transition-all duration-300 overflow-hidden cursor-pointer"
      onClick={() => onClick(job.jobId)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onClick(job.jobId);
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
                {new Date(job.createdAt).toLocaleString()}
              </div>
              {job.dryRun && (
                <div className="flex items-center gap-1.5 text-amber-500">
                  <Zap size={12} />
                  Dry Run
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="p-3 bg-slate-50 rounded-2xl group-hover:bg-indigo-600 group-hover:text-white transition-all duration-300">
               <ChevronRight size={20} />
            </div>
            {job.execution?.totalDurationMs && (
              <span className="text-[10px] font-bold text-slate-400">
                {(job.execution.totalDurationMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
};
