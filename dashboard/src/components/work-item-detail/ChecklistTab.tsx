import { AlertTriangle, BadgeCheck, CircleDashed, RefreshCw, XCircle, ListChecks } from 'lucide-react';
import type { WorkItem } from '../../types';
import { cn } from '../../utils/cn';

interface ChecklistTabProps {
    checklist?: WorkItem['checklist'];
}

export function ChecklistTab({ checklist }: ChecklistTabProps) {
    if (!checklist || checklist.length === 0) {
        return (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                <ListChecks size={32} className="mx-auto text-slate-300 mb-3" />
                <p className="text-sm text-slate-500 font-bold">No checklist</p>
                <p className="text-xs text-slate-400 mt-1">Assess the work item first to generate a checklist</p>
            </div>
        );
    }

    const statusIcons: Record<string, React.FC<{ size?: number; className?: string }>> = {
        passed: BadgeCheck,
        failed: AlertTriangle,
        done: BadgeCheck,
        todo: CircleDashed,
        doing: RefreshCw,
        waived: XCircle,
    };

    const statusIconColors: Record<string, string> = {
        passed: 'text-emerald-500',
        done: 'text-emerald-500',
        failed: 'text-rose-500',
        todo: 'text-slate-300',
        doing: 'text-blue-500',
        waived: 'text-amber-500',
    };

    const passed = checklist.filter((c) => c.status === 'passed' || c.status === 'done').length;
    const total = checklist.length;

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-3">
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-emerald-500 rounded-full transition-all"
                        style={{ width: `${total > 0 ? (passed / total) * 100 : 0}%` }}
                    />
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    {passed}/{total} done
                </span>
            </div>

            {checklist.map((item) => {
                const Icon = statusIcons[item.status] || CircleDashed;
                return (
                    <div
                        key={item.id}
                        className={cn(
                            'rounded-xl border p-3 flex items-start gap-3',
                            item.status === 'passed' || item.status === 'done'
                                ? 'border-emerald-100 bg-emerald-50/50'
                                : item.status === 'failed'
                                    ? 'border-rose-100 bg-rose-50/50'
                                    : 'border-slate-100 bg-white'
                        )}
                    >
                        <Icon size={16} className={cn('flex-shrink-0 mt-0.5', statusIconColors[item.status] || 'text-slate-300')} />
                        <div className="flex-1 min-w-0">
                            <p className={cn(
                                'text-sm font-medium',
                                item.status === 'passed' || item.status === 'done' ? 'text-emerald-800' :
                                    item.status === 'failed' ? 'text-rose-800' :
                                        'text-slate-700'
                            )}>
                                {item.text}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                                <span className={cn(
                                    'rounded-full px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest',
                                    item.status === 'passed' || item.status === 'done' ? 'bg-emerald-100 text-emerald-600' :
                                        item.status === 'failed' ? 'bg-rose-100 text-rose-600' :
                                            item.status === 'doing' ? 'bg-blue-100 text-blue-600' :
                                                item.status === 'waived' ? 'bg-amber-100 text-amber-600' :
                                                    'bg-slate-100 text-slate-500'
                                )}>
                                    {item.status}
                                </span>
                                {item.required && (
                                    <span className="text-[9px] font-bold uppercase text-rose-400">Required</span>
                                )}
                            </div>
                            {item.evidence && (
                                <div className="mt-1.5 flex items-center gap-1.5">
                                    <span className="rounded-full px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest bg-slate-200 text-slate-500">
                                        {item.evidence.type}
                                    </span>
                                    <code className="text-[10px] text-slate-400 font-mono truncate max-w-[200px]" title={item.evidence.ref}>
                                        {item.evidence.ref}
                                    </code>
                                    {item.evidence.metadata && Object.keys(item.evidence.metadata).length > 0 && (
                                        <span className="text-[8px] text-slate-400">
                                            +{Object.keys(item.evidence.metadata).length} meta
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
