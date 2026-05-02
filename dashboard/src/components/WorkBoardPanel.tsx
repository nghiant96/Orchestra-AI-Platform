import { ArrowRight, BadgeCheck, CircleDashed, ListChecks } from 'lucide-react';
import type { WorkItem } from '../types/index.js';
import { cn } from '../utils/cn';

export const WorkBoardPanel = ({ workItems, loading }: { workItems: WorkItem[]; loading: boolean }) => {
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
          <article key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-black uppercase tracking-tight text-slate-900">{item.title}</p>
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-widest",
                    item.status === 'done' ? "bg-emerald-50 text-emerald-600" :
                    item.status === 'failed' ? "bg-rose-50 text-rose-600" :
                    "bg-indigo-50 text-indigo-600"
                  )}>
                    {item.status}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-slate-600">{item.description || 'No description'}</p>
                <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                  {item.id} · risk {item.risk} · runs {item.linkedRuns.length}
                </p>
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
