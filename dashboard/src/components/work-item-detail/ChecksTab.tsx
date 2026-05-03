import { AlertTriangle, Clock, ExternalLink, ShieldCheck } from 'lucide-react';
import type { WorkItem } from '../../types';
import { cn } from '../../utils/cn';

interface ChecksTabProps {
    checks?: WorkItem['checks'];
    pullRequest?: WorkItem['pullRequest'];
}

export function ChecksTab({ checks, pullRequest }: ChecksTabProps) {
    if (!checks || checks.length === 0) {
        return (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                <ShieldCheck size={32} className="mx-auto text-slate-300 mb-3" />
                <p className="text-sm text-slate-500 font-bold">No CI checks yet</p>
                <p className="text-xs text-slate-400 mt-1">
                    {pullRequest ? 'Checks will appear once PR CI completes' : 'Checks available after PR is created'}
                </p>
            </div>
        );
    }

    const passed = checks.filter((c) => c.status === 'completed' && (c.conclusion === 'success' || c.conclusion === 'neutral')).length;
    const failed = checks.filter((c) => c.conclusion === 'failure' || c.conclusion === 'timed_out').length;
    const pending = checks.filter((c) => c.status === 'queued' || c.status === 'in_progress').length;

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3 text-center">
                    <p className="text-2xl font-black text-emerald-600">{passed}</p>
                    <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500 mt-0.5">Passed</p>
                </div>
                <div className="rounded-xl bg-rose-50 border border-rose-100 p-3 text-center">
                    <p className="text-2xl font-black text-rose-600">{failed}</p>
                    <p className="text-[10px] font-black uppercase tracking-widest text-rose-500 mt-0.5">Failed</p>
                </div>
                <div className="rounded-xl bg-amber-50 border border-amber-100 p-3 text-center">
                    <p className="text-2xl font-black text-amber-600">{pending}</p>
                    <p className="text-[10px] font-black uppercase tracking-widest text-amber-500 mt-0.5">Pending</p>
                </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        {failed > 0 ? (
                            <AlertTriangle size={18} className="text-rose-500" />
                        ) : pending > 0 ? (
                            <Clock size={18} className="text-amber-500" />
                        ) : (
                            <ShieldCheck size={18} className="text-emerald-500" />
                        )}
                        <div>
                            <p className="text-sm font-bold text-slate-700">
                                {failed > 0 ? 'Checks Failed' : pending > 0 ? 'Checks In Progress' : 'All Checks Passed'}
                            </p>
                            <p className="text-xs text-slate-500">
                                {checks.length} check{checks.length !== 1 ? 's' : ''} total
                            </p>
                        </div>
                    </div>
                    {pullRequest?.html_url && (
                        <a
                            href={pullRequest.html_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-xs font-bold text-indigo-500 hover:text-indigo-600 transition-colors"
                        >
                            <ExternalLink size={12} />
                            View on GitHub
                        </a>
                    )}
                </div>
                {failed > 0 && (
                    <div className="mt-3 p-3 rounded-xl bg-rose-100/50 border border-rose-200">
                        <p className="text-[10px] font-black uppercase tracking-widest text-rose-600 mb-1">Required checks failed</p>
                        <p className="text-xs text-rose-700">Merge blocked until all required checks pass.</p>
                    </div>
                )}
            </div>

            <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Check Details</p>
                {checks.map((check, index) => {
                    const isSuccess = check.conclusion === 'success' || check.conclusion === 'neutral';
                    const isFailure = check.conclusion === 'failure' || check.conclusion === 'timed_out';
                    const isPending = check.status === 'queued' || check.status === 'in_progress';

                    return (
                        <div
                            key={check.id || index}
                            className={cn(
                                'rounded-xl border p-3 flex items-center gap-3',
                                isSuccess ? 'border-emerald-100 bg-emerald-50/30' :
                                    isFailure ? 'border-rose-100 bg-rose-50/30' :
                                        isPending ? 'border-amber-100 bg-amber-50/30' :
                                            'border-slate-100 bg-white'
                            )}
                        >
                            <div className={cn(
                                'w-8 h-8 rounded-full flex items-center justify-center',
                                isSuccess ? 'bg-emerald-100 text-emerald-600' :
                                    isFailure ? 'bg-rose-100 text-rose-600' :
                                        isPending ? 'bg-amber-100 text-amber-600 animate-pulse' :
                                            'bg-slate-100 text-slate-400'
                            )}>
                                {isSuccess ? <ShieldCheck size={14} /> :
                                    isFailure ? <AlertTriangle size={14} /> :
                                        isPending ? <Clock size={14} /> :
                                            <ShieldCheck size={14} />}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-slate-700 truncate">{check.name || 'Check'}</p>
                                <p className="text-[10px] text-slate-500 font-mono">
                                    {check.conclusion || check.status}
                                    {check.completed_at && ` · ${new Date(check.completed_at).toLocaleString()}`}
                                </p>
                            </div>
                            {check.html_url && (
                                <a
                                    href={check.html_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[10px] font-bold text-indigo-500 hover:underline whitespace-nowrap"
                                >
                                    Details
                                </a>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
