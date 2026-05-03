import { ChevronRight, GitBranch } from 'lucide-react';
import type { WorkItem } from '../../types';
import { cn } from '../../utils/cn';

interface GraphTabProps {
    graph?: WorkItem['graph'];
}

export function GraphTab({ graph }: GraphTabProps) {
    if (!graph || graph.nodes.length === 0) {
        return (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                <GitBranch size={32} className="mx-auto text-slate-300 mb-3" />
                <p className="text-sm text-slate-500 font-bold">No execution graph</p>
                <p className="text-xs text-slate-400 mt-1">Assess the work item first to generate a task graph</p>
            </div>
        );
    }

    const nodeStatusColors: Record<string, string> = {
        pending: 'bg-slate-100 text-slate-500',
        ready: 'bg-blue-50 text-blue-600',
        running: 'bg-indigo-50 text-indigo-600',
        done: 'bg-emerald-50 text-emerald-600',
        failed: 'bg-rose-50 text-rose-600',
        skipped: 'bg-slate-50 text-slate-400',
    };

    return (
        <div className="space-y-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                {graph.nodes.length} nodes · {graph.edges.length} edges
            </p>
            {graph.nodes.map((node, index) => (
                <div key={node.id} className="rounded-2xl border border-slate-200 bg-white p-4 flex items-start gap-3">
                    <span className="flex-shrink-0 w-7 h-7 rounded-full bg-slate-100 text-slate-500 font-bold text-xs flex items-center justify-center">
                        {index + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-bold text-sm text-slate-900">{node.title}</p>
                            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-widest', nodeStatusColors[node.status] || nodeStatusColors.pending)}>
                                {node.status}
                            </span>
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{node.kind}</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">{node.goal}</p>
                        {node.dependsOn.length > 0 && (
                            <div className="flex items-center gap-1 mt-2">
                                <ChevronRight size={10} className="text-slate-300" />
                                <span className="text-[10px] text-slate-400">depends on: {node.dependsOn.join(', ')}</span>
                            </div>
                        )}
                        {node.assignedRunId && (
                            <p className="text-[10px] font-mono text-indigo-500 mt-1">run: {node.assignedRunId}</p>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}
