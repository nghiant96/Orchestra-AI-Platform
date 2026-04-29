import { Clock, GitBranch, Lock, ShieldAlert, Unlock, WalletCards } from 'lucide-react';
import type { Job } from '../types/index.js';
import { cn } from '../utils/cn';

export const JobSummarySection = ({ job }: { job: Job }) => {
  const approvalMode = job.approvalMode ?? (job.status === 'waiting_for_approval' ? 'manual' : 'manual');

  return (
    <section className="space-y-3">
      {job.approvalPolicy && (
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-indigo-500">Policy Decision</p>
              <p className="mt-1 text-sm font-bold text-slate-800">{job.approvalPolicy.reason}</p>
            </div>
            <span className="w-fit rounded-full bg-white px-2.5 py-1 text-[10px] font-black uppercase text-indigo-600">
              {job.approvalPolicy.riskClass} risk
            </span>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
      <SummaryTile
        label="Approval Mode"
        value={approvalMode === 'auto' ? 'Auto Run' : 'Manual Review'}
        icon={approvalMode === 'auto' ? Unlock : Lock}
        tone={approvalMode === 'auto' ? 'amber' : 'indigo'}
      />
      <SummaryTile
        label="Run Mode"
        value={job.dryRun ? 'Dry Run' : 'Write Enabled'}
        icon={GitBranch}
        tone={job.dryRun ? 'slate' : 'rose'}
      />
      <SummaryTile
        label="Duration"
        value={job.execution?.totalDurationMs ? `${(job.execution.totalDurationMs / 1000).toFixed(1)}s` : 'Pending'}
        icon={Clock}
        tone="emerald"
      />
      <SummaryTile
        label="Cost"
        value={job.execution?.budget?.totalCostUnits ? `${job.execution.budget.totalCostUnits.toFixed(2)} units` : '0.00 units'}
        icon={WalletCards}
        tone="blue"
      />
      <SummaryTile
        label="Risk Score"
        value={job.approvalPolicy ? String(job.approvalPolicy.riskScore) : 'Unknown'}
        icon={ShieldAlert}
        tone={job.approvalPolicy?.riskClass === 'high' || job.approvalPolicy?.riskClass === 'blocked' ? 'rose' : 'slate'}
      />
      </div>
    </section>
  );
};

type TileTone = 'amber' | 'indigo' | 'slate' | 'rose' | 'emerald' | 'blue';

function SummaryTile({
  label,
  value,
  icon: Icon,
  tone
}: {
  label: string;
  value: string;
  icon: typeof Lock;
  tone: TileTone;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={cn("rounded-xl p-2", tileToneClasses[tone])}>
          <Icon size={18} />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
          <p className="truncate text-sm font-black text-slate-900">{value}</p>
        </div>
      </div>
    </div>
  );
}

const tileToneClasses: Record<TileTone, string> = {
  amber: 'bg-amber-50 text-amber-600',
  indigo: 'bg-indigo-50 text-indigo-600',
  slate: 'bg-slate-100 text-slate-600',
  rose: 'bg-rose-50 text-rose-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  blue: 'bg-blue-50 text-blue-600'
};
