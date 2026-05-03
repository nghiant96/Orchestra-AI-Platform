import { GitBranch, GitPullRequest } from 'lucide-react';
import type { WorkItem } from '../../types';

interface BranchTabProps {
    workItem: WorkItem;
}

export function BranchTab({ workItem }: BranchTabProps) {
    if (!workItem.branch && !workItem.pullRequest) {
        return (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                <GitPullRequest size={32} className="mx-auto text-slate-300 mb-3" />
                <p className="text-sm text-slate-500 font-bold">No branch or PR</p>
                <p className="text-xs text-slate-400 mt-1">Branch and PR metadata will appear when execution reaches commit/PR phase</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {workItem.branch && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Branch</p>
                    <div className="flex items-center gap-2">
                        <GitBranch size={16} className="text-indigo-500" />
                        <span className="font-mono text-sm text-slate-700">{workItem.branch}</span>
                    </div>
                </div>
            )}
            {workItem.pullRequest && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Pull Request</p>
                    <div className="flex items-center gap-2">
                        <GitPullRequest size={16} className="text-purple-500" />
                        <span className="font-mono text-sm text-slate-700">
                            #{workItem.pullRequest.number}
                        </span>
                        {workItem.pullRequest.url && (
                            <a href={workItem.pullRequest.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-indigo-500 hover:underline font-bold">
                                View
                            </a>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
