import { FileCode } from 'lucide-react';
import type { Job, TaskContract } from '../types/index.js';
import { cn } from '../utils/cn';

export const JobPlanSection = ({ job }: { job: Job }) => {
  const plan = job.execution?.pendingPlan;
  if (!plan) {
    return null;
  }

  return (
    <section className="rounded-3xl border-2 border-amber-200 bg-white p-6 shadow-sm animate-in zoom-in-95 duration-300">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-tight text-amber-600">
        <FileCode size={18} />
        Proposed Execution Plan
      </h3>

      <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        <PlanFileList title="Files to Read" files={plan.readFiles} tone="slate" />
        <PlanFileList title="Files to Modify" files={plan.writeTargets} tone="amber" />
      </div>

      {plan.notes.length > 0 && (
        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
          <p className="mb-2 text-center text-[10px] font-black uppercase tracking-widest text-slate-400">Implementation Notes</p>
          <ul className="space-y-1.5">
            {plan.notes.map((note, index) => (
              <li key={index} className="flex gap-2 text-xs font-medium text-slate-600">
                <span className="text-amber-400">•</span>
                {note}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(plan.contracts?.length ?? 0) > 0 && (
        <TaskContractList contracts={plan.contracts ?? []} />
      )}
    </section>
  );
};

function PlanFileList({ title, files, tone }: { title: string; files: string[]; tone: 'slate' | 'amber' }) {
  return (
    <div className="space-y-3">
      <p className={cn(
        "text-[10px] font-black uppercase tracking-widest",
        tone === 'amber' ? "text-amber-500" : "text-slate-400"
      )}>
        {title}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {files.map((file) => (
          <span
            key={file}
            className={cn(
              "rounded border px-2 py-0.5 font-mono text-[10px]",
              tone === 'amber'
                ? "border-amber-200 bg-amber-50 font-bold text-amber-700"
                : "border-slate-200 bg-slate-100 text-slate-600"
            )}
          >
            {file}
          </span>
        ))}
        {files.length === 0 && <span className="text-[10px] italic text-slate-400">None</span>}
      </div>
    </div>
  );
}

function TaskContractList({ contracts }: { contracts: TaskContract[] }) {
  return (
    <div className="mt-4 rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
      <p className="mb-3 text-center text-[10px] font-black uppercase tracking-widest text-indigo-500">Task Contract</p>
      <div className="space-y-2">
        {contracts.map((contract) => (
          <div key={contract.id} className="rounded-xl border border-indigo-100 bg-white p-3">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-xs font-black text-slate-800">{contract.description}</span>
              <ContractBadge tone="slate">{contract.severity}</ContractBadge>
              <ContractBadge tone="indigo">{contract.checkStrategy}</ContractBadge>
              <ContractBadge tone={contractStatusTone(contract.status)}>{contract.status}</ContractBadge>
            </div>
            {contract.suggestedFix && (
              <p className="text-[11px] font-medium text-slate-500">{contract.suggestedFix}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ContractBadge({ tone, children }: { tone: 'slate' | 'indigo' | 'emerald' | 'rose' | 'amber'; children: string }) {
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[9px] font-black uppercase", contractBadgeClasses[tone])}>
      {children}
    </span>
  );
}

function contractStatusTone(status: TaskContract['status']): 'slate' | 'emerald' | 'rose' | 'amber' {
  if (status === 'passed') return 'emerald';
  if (status === 'failed') return 'rose';
  if (status === 'pending') return 'amber';
  return 'slate';
}

const contractBadgeClasses = {
  slate: 'bg-slate-100 text-slate-500',
  indigo: 'bg-indigo-50 text-indigo-500',
  emerald: 'bg-emerald-50 text-emerald-600',
  rose: 'bg-rose-50 text-rose-600',
  amber: 'bg-amber-50 text-amber-600'
};
