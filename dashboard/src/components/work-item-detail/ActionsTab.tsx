import { Ban, Play, RefreshCw, SearchCode, ShieldCheck } from 'lucide-react';
import type { WorkItem } from '../../types';
import { cn } from '../../utils/cn';

interface ActionsTabProps {
    workItem: WorkItem;
    actioning: boolean;
    onAssess?: (workItem: WorkItem) => Promise<void>;
    onRun?: (workItem: WorkItem) => Promise<void>;
    onCancel?: (workItem: WorkItem) => Promise<void>;
    onRetry?: (workItem: WorkItem) => Promise<void>;
    handleAction: (fn?: (workItem: WorkItem) => Promise<void>) => Promise<void>;
}

export function ActionsTab({
    workItem,
    actioning,
    onAssess,
    onRun,
    onCancel,
    onRetry,
    handleAction,
}: ActionsTabProps) {
    const canAssess = ['created', 'assessing'].includes(workItem.status);
    const canRun = ['created', 'ready', 'assessed'].includes(workItem.status) || workItem.status === 'failed';
    const canCancel = !['done', 'cancelled'].includes(workItem.status);
    const canRetry = workItem.status === 'failed';

    return (
        <div className="space-y-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Work Item Actions</p>

            {onAssess && (
                <button
                    onClick={() => handleAction(onAssess)}
                    disabled={!canAssess || actioning}
                    className={cn(
                        'w-full flex items-center gap-3 p-4 rounded-2xl border font-bold text-sm transition-all',
                        canAssess && !actioning
                            ? 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                            : 'border-slate-100 bg-slate-50 text-slate-400 cursor-not-allowed',
                    )}
                >
                    <SearchCode size={18} className={actioning ? 'animate-spin' : ''} />
                    <div className="text-left">
                        <p>Assess Work Item</p>
                        <p className="text-[10px] font-normal mt-0.5">Analyze task and determine complexity, risk, and execution plan</p>
                    </div>
                    {actioning && <span className="ml-auto text-[10px]">Processing...</span>}
                </button>
            )}

            {onRun && (
                <button
                    onClick={() => handleAction(onRun)}
                    disabled={canRun ? actioning : true}
                    className={cn(
                        'w-full flex items-center gap-3 p-4 rounded-2xl border font-bold text-sm transition-all',
                        canRun && !actioning
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            : 'border-slate-100 bg-slate-50 text-slate-400 cursor-not-allowed',
                    )}
                >
                    <Play size={18} className={actioning ? 'animate-spin' : ''} />
                    <div className="text-left">
                        <p>Run Work Item</p>
                        <p className="text-[10px] font-normal mt-0.5">Execute the next graph node through the orchestrator</p>
                    </div>
                </button>
            )}

            {onRetry && (
                <button
                    onClick={() => handleAction(onRetry)}
                    disabled={!canRetry || actioning}
                    className={cn(
                        'w-full flex items-center gap-3 p-4 rounded-2xl border font-bold text-sm transition-all',
                        canRetry && !actioning
                            ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                            : 'border-slate-100 bg-slate-50 text-slate-400 cursor-not-allowed',
                    )}
                >
                    <RefreshCw size={18} className={actioning ? 'animate-spin' : ''} />
                    <div className="text-left">
                        <p>Retry Work Item</p>
                        <p className="text-[10px] font-normal mt-0.5">Retry the failed node</p>
                    </div>
                </button>
            )}

            {onCancel && (
                <button
                    onClick={() => handleAction(onCancel)}
                    disabled={!canCancel || actioning}
                    className={cn(
                        'w-full flex items-center gap-3 p-4 rounded-2xl border font-bold text-sm transition-all',
                        canCancel && !actioning
                            ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                            : 'border-slate-100 bg-slate-50 text-slate-400 cursor-not-allowed',
                    )}
                >
                    <Ban size={18} />
                    <div className="text-left">
                        <p>Cancel Work Item</p>
                        <p className="text-[10px] font-normal mt-0.5">Cancel this work item and stop any running execution</p>
                    </div>
                </button>
            )}

            {!onAssess && !onRun && !onCancel && !onRetry && (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
                    <ShieldCheck size={32} className="mx-auto text-slate-300 mb-3" />
                    <p className="text-sm text-slate-500 font-bold">Actions unavailable</p>
                    <p className="text-xs text-slate-400 mt-1">Connect to the server to enable actions</p>
                </div>
            )}
        </div>
    );
}
