import { ArrowRight, BadgeCheck, CircleDashed, ListChecks, ShieldCheck, AlertTriangle, Clock, GitBranch, GitPullRequest } from 'lucide-react';
import type { WorkItem } from '../types/index.js';
import { cn } from '../utils/cn';

const statusPill = (status: string) => {
  if (status === 'done') return 'bg-emerald-50 text-emerald-600';
  if (status === 'failed') return 'bg-rose-50 text-rose-600';
  if (['executing', 'assessing', 'planning', 'running_checks', 'reviewing'].includes(status)) return 'bg-blue-50 text-blue-600';
  if (status === 'ready_for_review') return 'bg-violet-50 text-violet-600';
  return 'bg-indigo-50 text-indigo-600';
};

export const WorkBoardPanel = ({ workItems, loading, onItemClick }: {
  workItems: WorkItem[];
  loading: boolean;
  onItemClick?: (item: WorkItem) => void;
}) => {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-3 text-lg font-black uppercase tracking-tight text-slate-900">
            <ListChecks size={20} className="text-indigo-500" />
            Work Board
          </h2>
          <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-slate-400">
            Durable work items with assessment, graph, checklist, and run linkage
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
          {loading ? 'Loading' : `${workItems.length} items`}
        </span>
      </div>

      <div className="space-y-3">
        {workItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
            No work items in this project yet.
          </div>
        ) : workItems.map((item) => (
          <article
            key={item.id}
            onClick={() => onItemClick?.(item)}
            className={cn(
              'rounded-2xl border border-slate-200 bg-slate-50 p-4 transition-colors',
              onItemClick && 'cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30'
            )}
            role={onItemClick ? 'button' : undefined}
            tabIndex={onItemClick ? 0 : undefined}
            onKeyDown={onItemClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onItemClick(item); } } : undefined}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-black uppercase tracking-tight text-slate-900">{item.title}</p>
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-widest",
                    statusPill(item.status)
                  )}>
                    {item.status}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-slate-600">{item.description || 'No description'}</p>
                <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                  {item.id} · risk {item.risk} · runs {item.linkedRuns.length}
                </p>
                {/* Checklist progress bar */}
                {item.checklist && item.checklist.length > 0 && (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all"
                        style={{ width: `${Math.round((item.checklist.filter(c => c.status === 'passed' || c.status === 'done').length / item.checklist.length) * 100)}%` }}
                      />
                    </div>
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                      {item.checklist.filter(c => c.status === 'passed' || c.status === 'done').length}/{item.checklist.length}
                    </span>
                  </div>
                )}
                {/* CI status inline */}
                {(item.status === 'watching_ci' || item.status === 'creating_pr' || item.status === 'ready_for_review' || item.status === 'done' || item.status === 'failed') && (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    {(item.status === 'watching_ci' || item.status === 'creating_pr') ? (
                      <Clock size={10} className="text-amber-500" />
                    ) : item.status === 'done' ? (
                      <ShieldCheck size={10} className="text-emerald-500" />
                    ) : item.status === 'failed' ? (
                      <AlertTriangle size={10} className="text-rose-500" />
                    ) : (
                      <ShieldCheck size={10} className="text-emerald-500" />
                    )}
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                      {(item.status === 'watching_ci' || item.status === 'creating_pr') ? 'CI pending...' :
                        item.status === 'done' ? 'All checks passed' :
                          item.status === 'failed' ? 'Checks failed' :
                            'Ready for review'}
                    </span>
                  </div>
                )}
                {/* Branch/PR indicator */}
                {(item.branch || item.pullRequest) && (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    {item.pullRequest ? (
                      <>
                        <GitPullRequest size={10} className="text-purple-500" />
                        <span className="text-[9px] font-mono text-purple-500">#{item.pullRequest.number}</span>
                      </>
                    ) : item.branch ? (
                      <>
                        <GitBranch size={10} className="text-indigo-500" />
                        <span className="text-[9px] font-mono text-indigo-500 truncate max-w-[120px]" title={item.branch}>{item.branch}</span>
                      </>
                    ) : null}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {item.assessment ? <BadgeCheck size={16} className="text-emerald-500" /> : <CircleDashed size={16} className="text-slate-400" />}
                <ArrowRight size={16} className="text-slate-300" />
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
};
