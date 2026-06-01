import { FileCode, History } from 'lucide-react';
import type { WorkItem } from '../../types';
import { cn } from '../../utils/cn';

interface RunsTabProps {
    linkedRuns: string[];
    linkedJobs?: WorkItem['linkedJobs'];
}

export function RunsTab({ linkedRuns, linkedJobs }: RunsTabProps) {
    if (linkedRuns.length === 0) {
        return (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                <History size={32} className="mx-auto text-slate-300 mb-3" />
                <p className="text-sm text-slate-500 font-bold">No linked runs</p>
                <p className="text-xs text-slate-400 mt-1">Runs will appear here once the work item is executed</p>
            </div>
        );
    }

    return (
        <div className="space-y-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">
                {linkedRuns.length} linked run{linkedRuns.length !== 1 ? 's' : ''}
            </p>
            {linkedRuns.map((runId) => {
                const linkedJob = linkedJobs?.find((job) => job.jobId === runId);
                return (
                    <div key={runId} className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex items-start gap-3">
                        <FileCode size={14} className="text-indigo-400 flex-shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-mono text-slate-600 truncate">{runId}</span>
                                {linkedJob?.status && (
                                    <span className={cn(
                                        'rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-widest',
                                        linkedJob.status === 'completed' ? 'bg-emerald-50 text-emerald-600' :
                                            linkedJob.status === 'failed' ? 'bg-rose-50 text-rose-600' :
                                                linkedJob.status === 'stalled' ? 'bg-amber-50 text-amber-600' :
                                                    'bg-slate-100 text-slate-500'
                                    )}>
                                        {linkedJob.status}
                                    </span>
                                )}
                            </div>
                            {linkedJob?.lease?.leaseId && (
                                <p className="mt-1 text-[10px] text-slate-400 font-mono">
                                    lease {linkedJob.lease.leaseId} · worker {linkedJob.workerId || linkedJob.lease.workerId}
                                </p>
                            )}
                            {linkedJob?.artifactPath && (
                                <p className="mt-1 text-[10px] text-slate-400 truncate" title={linkedJob.artifactPath}>
                                    artifact {linkedJob.artifactPath}
                                </p>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
