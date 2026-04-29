import { AlertTriangle, CheckCircle, PauseCircle, RefreshCw, RotateCcw, XCircle, Zap } from 'lucide-react';
import type { Job } from '../types/index.js';
import { cn } from '../utils/cn';

interface JobActionPanelProps {
  job: Job;
  actioning: boolean;
  onApprove: () => void;
  onReject: () => void;
  onRetry?: (job: Job) => void;
  onResume?: (job: Job) => void;
  onCancel?: (job: Job) => void;
}

const canCancel = (status: Job['status']) => status === 'queued' || status === 'running' || status === 'waiting_for_approval';
const canRetry = (status: Job['status']) => status === 'completed' || status === 'failed' || status === 'cancelled';
const canResume = (job: Job) => job.status === 'failed' && Boolean(job.execution?.retryHint);

export const JobActionPanel = ({ job, actioning, onApprove, onReject, onRetry, onResume, onCancel }: JobActionPanelProps) => {
  if (job.status === 'waiting_for_approval') {
    return (
      <div className="mx-6 mt-6 space-y-4">
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex flex-col gap-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 text-amber-800">
            <div className="bg-amber-100 p-2 rounded-xl">
              <AlertTriangle size={20} />
            </div>
            <div>
              <p className="text-sm font-black uppercase tracking-tight">Human intervention required</p>
              <p className="text-xs font-medium opacity-80">Review the pending plan before continuing this job.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={onReject}
              disabled={actioning}
              className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-rose-200 text-rose-600 rounded-xl text-xs font-bold hover:bg-rose-50 transition-all disabled:cursor-not-allowed disabled:opacity-60"
            >
              <XCircle size={14} />
              Reject
            </button>
            <button
              onClick={onApprove}
              disabled={actioning}
              className={cn(
                "inline-flex items-center gap-2 px-6 py-2 rounded-xl text-xs font-bold transition-all shadow-md disabled:cursor-not-allowed disabled:opacity-60",
                job.execution?.budget?.exceeded === 'cost'
                  ? "bg-rose-600 text-white hover:bg-rose-700 shadow-rose-100"
                  : "bg-amber-500 text-white hover:bg-amber-600 shadow-amber-200"
              )}
            >
              {actioning ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle size={14} />}
              {job.execution?.budget?.exceeded === 'cost' ? "Override & Approve" : "Approve Plan"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const showPanel = canCancel(job.status) || canRetry(job.status);
  if (!showPanel) {
    return null;
  }

  return (
    <div className="mx-6 mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-slate-400">Available Actions</p>
          <p className="mt-1 text-sm font-bold text-slate-800">{getActionSummary(job)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canCancel(job.status) && onCancel && (
            <button
              onClick={() => onCancel(job)}
              disabled={actioning}
              className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2 text-xs font-bold text-rose-600 transition-all hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <PauseCircle size={14} />
              Cancel
            </button>
          )}
          {canRetry(job.status) && onRetry && (
            <button
              onClick={() => onRetry(job)}
              disabled={actioning}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 shadow-sm transition-all hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RotateCcw size={14} />
              Retry Task
            </button>
          )}
          {job.status === 'failed' && (
            <button
              onClick={() => onResume?.(job)}
              disabled={actioning || !onResume || !canResume(job)}
              title={!canResume(job) ? 'Resume is unavailable because this job has no retry checkpoint.' : undefined}
              className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-xs font-bold text-indigo-600 shadow-sm transition-all hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Zap size={14} />
              Resume from Checkpoint
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

function getActionSummary(job: Job): string {
  if (job.status === 'queued') {
    return 'This job has not started yet. It can be cancelled before execution begins.';
  }
  if (job.status === 'running') {
    return 'This job is running. Cancellation will request an abort from the active runner.';
  }
  if (job.status === 'failed') {
    return job.execution?.retryHint
      ? `Resume is available from ${job.execution.retryHint.stage.replace(/-/g, ' ')}.`
      : 'No retry checkpoint was recorded. Clone the task to run it again.';
  }
  if (job.status === 'cancelled') {
    return 'This job was cancelled. Clone the task to run it again.';
  }
  return 'Clone this task to run it again with the same prompt and workspace.';
}
