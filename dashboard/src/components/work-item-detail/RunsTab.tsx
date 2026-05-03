import { FileCode, History } from 'lucide-react';

interface RunsTabProps {
    linkedRuns: string[];
}

export function RunsTab({ linkedRuns }: RunsTabProps) {
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
            {linkedRuns.map((runId) => (
                <div key={runId} className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex items-center gap-3">
                    <FileCode size={14} className="text-indigo-400 flex-shrink-0" />
                    <span className="text-xs font-mono text-slate-600 truncate">{runId}</span>
                </div>
            ))}
        </div>
    );
}
