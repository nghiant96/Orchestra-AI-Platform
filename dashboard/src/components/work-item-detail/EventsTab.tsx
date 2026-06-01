import { Activity, AlertTriangle, FileCode, GitPullRequest, History, ShieldCheck } from 'lucide-react';
import type { WorkItem } from '../../types';
import { cn } from '../../utils/cn';

type WorkItemEvent = NonNullable<WorkItem['events']>[number];

interface EventsTabProps {
    events?: WorkItem['events'];
}

export function EventsTab({ events }: EventsTabProps) {
    if (!events || events.length === 0) {
        return (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                <History size={32} className="mx-auto text-slate-300 mb-3" />
                <p className="text-sm text-slate-500 font-bold">No work item events yet</p>
                <p className="text-xs text-slate-400 mt-1">Timeline entries will appear as the work item moves through the workflow</p>
            </div>
        );
    }

    return (
        <div className="space-y-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">
                {events.length} timeline event{events.length !== 1 ? 's' : ''}
            </p>
            {events.map((event) => {
                const icon = iconForEvent(event.type);
                return (
                    <div key={event.id} className="rounded-xl border border-slate-200 bg-white p-3 flex items-start gap-3">
                        <div className={cn('w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0', toneForEvent(event.type))}>
                            {icon}
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-bold text-slate-700">{event.title}</p>
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-slate-500">
                                    {event.type}
                                </span>
                            </div>
                            {event.message && <p className="mt-1 text-xs text-slate-500 break-words">{event.message}</p>}
                            <p className="mt-1 text-[10px] font-mono text-slate-400">
                                {new Date(event.timestamp).toLocaleString()}
                                {event.jobId ? ` · ${event.jobId}` : ''}
                                {event.leaseId ? ` · lease ${event.leaseId}` : ''}
                            </p>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function iconForEvent(type: WorkItemEvent['type']) {
    switch (type) {
        case 'status':
            return <Activity size={14} />;
        case 'log':
            return <FileCode size={14} />;
        case 'artifact':
            return <GitPullRequest size={14} />;
        case 'approval':
            return <ShieldCheck size={14} />;
        case 'audit':
            return <History size={14} />;
        case 'run':
        default:
            return <AlertTriangle size={14} />;
    }
}

function toneForEvent(type: WorkItemEvent['type']) {
    switch (type) {
        case 'status':
            return 'bg-blue-50 text-blue-600';
        case 'log':
            return 'bg-slate-100 text-slate-600';
        case 'artifact':
            return 'bg-violet-50 text-violet-600';
        case 'approval':
            return 'bg-emerald-50 text-emerald-600';
        case 'audit':
            return 'bg-amber-50 text-amber-600';
        case 'run':
        default:
            return 'bg-rose-50 text-rose-600';
    }
}
