import type { FormEvent } from 'react';
import { motion } from 'framer-motion';
import { Plus, FolderOpen, RefreshCw, Zap } from 'lucide-react';
import { cn } from '../utils/cn';

interface TaskFormProps {
  handleSubmit: (e: FormEvent) => void;
  task: string;
  setTask: (task: string) => void;
  cwd: string;
  setCwd: (cwd: string) => void;
  dryRun: boolean;
  setDryRun: (dryRun: boolean) => void;
  submitting: boolean;
}

export const TaskForm = ({
  handleSubmit,
  task,
  setTask,
  cwd,
  setCwd,
  dryRun,
  setDryRun,
  submitting
}: TaskFormProps) => {
  return (
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
  );
};
