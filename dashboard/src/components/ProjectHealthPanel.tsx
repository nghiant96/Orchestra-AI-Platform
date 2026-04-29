import { AlertCircle, CheckCircle2, Clock, ShieldCheck } from 'lucide-react';
import type { SystemHealth } from '../hooks/useHealth.js';
import type { Job, ToolResult } from '../types/index.js';
import { cn } from '../utils/cn';

const baselineChecks = ['typecheck', 'lint', 'test', 'build', 'audit'] as const;

export const ProjectHealthPanel = ({ health, jobs }: { health: SystemHealth | null; jobs: Job[] }) => {
  const latestChecks = collectLatestChecks(jobs);
  const knownChecks = baselineChecks.filter((name) => latestChecks[name]);
  const failedChecks = knownChecks.filter((name) => latestChecks[name]?.ok === false);
  const status = !health?.ok ? 'offline' : failedChecks.length > 0 ? 'attention' : knownChecks.length > 0 ? 'healthy' : 'unknown';

  return (
    <section className="mb-8 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-3 text-lg font-black uppercase tracking-tight text-slate-900">
            <ShieldCheck size={21} className={cn(
              status === 'healthy' ? 'text-emerald-500' :
              status === 'attention' ? 'text-rose-500' :
              status === 'offline' ? 'text-rose-500' :
              'text-slate-400'
            )} />
            Project Health
          </h2>
          <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-slate-400">
            Latest known queue and baseline check state
          </p>
        </div>
        <span className={cn(
          "w-fit rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest",
          status === 'healthy' ? "bg-emerald-50 text-emerald-600" :
          status === 'attention' ? "bg-rose-50 text-rose-600" :
          status === 'offline' ? "bg-rose-50 text-rose-600" :
          "bg-slate-100 text-slate-500"
        )}>
          {status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-9">
        <HealthTile label="Engine" value={health?.status || 'offline'} ok={Boolean(health?.ok)} />
        <HealthTile label="Queue" value={`${health?.queue.activeCount ?? 0} active`} ok={(health?.queue.activeCount ?? 0) >= 0} />
        <HealthTile label="Approval" value={health?.queue.approvalMode === 'auto' ? 'auto' : 'manual'} ok={health?.queue.approvalMode !== undefined} />
        <HealthTile label="Policy" value={health?.queue.approvalPolicy?.riskClass || 'unknown'} ok={health?.queue.approvalPolicy !== undefined} />
        {baselineChecks.map((name) => (
          <CheckTile key={name} name={name} result={latestChecks[name]} />
        ))}
      </div>
    </section>
  );
};

function HealthTile({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <div className="mt-2 flex items-center gap-2">
        {ok ? <CheckCircle2 size={14} className="text-emerald-500" /> : <AlertCircle size={14} className="text-rose-500" />}
        <p className="truncate text-xs font-black uppercase text-slate-700">{value}</p>
      </div>
    </div>
  );
}

function CheckTile({ name, result }: { name: string; result?: ToolResult }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{name}</p>
      <div className="mt-2 flex items-center gap-2">
        {!result ? (
          <>
            <Clock size={14} className="text-slate-400" />
            <p className="text-xs font-black uppercase text-slate-400">unknown</p>
          </>
        ) : result.ok ? (
          <>
            <CheckCircle2 size={14} className="text-emerald-500" />
            <p className="text-xs font-black uppercase text-emerald-600">pass</p>
          </>
        ) : (
          <>
            <AlertCircle size={14} className="text-rose-500" />
            <p className="text-xs font-black uppercase text-rose-600">fail</p>
          </>
        )}
      </div>
    </div>
  );
}

function collectLatestChecks(jobs: Job[]): Partial<Record<(typeof baselineChecks)[number], ToolResult>> {
  const checks: Partial<Record<(typeof baselineChecks)[number], ToolResult>> = {};
  const sortedJobs = [...jobs].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  for (const job of sortedJobs) {
    for (const result of job.latestToolResults ?? []) {
      const key = matchBaselineCheck(result.name);
      if (key && !checks[key]) {
        checks[key] = result;
      }
    }
  }

  return checks;
}

function matchBaselineCheck(name: string): (typeof baselineChecks)[number] | null {
  const normalized = name.toLowerCase();
  if (normalized.includes('typecheck') || normalized.includes('tsc')) return 'typecheck';
  if (normalized.includes('lint') || normalized.includes('eslint')) return 'lint';
  if (normalized.includes('test')) return 'test';
  if (normalized.includes('build')) return 'build';
  if (normalized.includes('audit')) return 'audit';
  return null;
}
