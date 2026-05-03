import { useState } from 'react';
import { motion } from 'framer-motion';
import {
    XCircle,
    BadgeCheck,
    CircleDashed,
    AlertTriangle,
    ListChecks,
    GitBranch,
    FileCode,
    ShieldCheck,
    Play,
    Ban,
    RefreshCw,
    SearchCode,
    ChevronRight,
    GitPullRequest,
    History,
    Clock,
    ExternalLink
} from 'lucide-react';
import type { WorkItem } from '../types';
import { cn } from '../utils/cn';

type DetailTab = 'assessment' | 'graph' | 'checklist' | 'runs' | 'branch' | 'checks' | 'actions';

interface WorkItemDetailModalProps {
    workItem: WorkItem;
    onClose: () => void;
    onRefresh: () => void;
    onAssess?: (workItem: WorkItem) => Promise<void>;
    onRun?: (workItem: WorkItem) => Promise<void>;
    onCancel?: (workItem: WorkItem) => Promise<void>;
    onRetry?: (workItem: WorkItem) => Promise<void>;
}

const statusColors: Record<string, string> = {
    created: 'bg-slate-100 text-slate-600',
    assessing: 'bg-yellow-50 text-yellow-600',
    planning: 'bg-orange-50 text-orange-600',
    executing: 'bg-blue-50 text-blue-600',
    running_checks: 'bg-cyan-50 text-cyan-600',
    reviewing: 'bg-purple-50 text-purple-600',
    ready_for_review: 'bg-violet-50 text-violet-600',
    done: 'bg-emerald-50 text-emerald-600',
    failed: 'bg-rose-50 text-rose-600',
    cancelled: 'bg-slate-100 text-slate-500',
};

const riskColors: Record<string, string> = {
    low: 'bg-emerald-50 text-emerald-600',
    medium: 'bg-yellow-50 text-yellow-600',
    high: 'bg-orange-50 text-orange-600',
    blocked: 'bg-rose-50 text-rose-600',
};

const tabs: { key: DetailTab; label: string; icon: React.FC<{ size?: number; className?: string }> }[] = [
    { key: 'assessment', label: 'Assessment', icon: SearchCode },
    { key: 'graph', label: 'Task Graph', icon: GitBranch },
    { key: 'checklist', label: 'Checklist', icon: ListChecks },
    { key: 'runs', label: 'Linked Runs', icon: History },
    { key: 'branch', label: 'Branch/PR', icon: GitPullRequest },
    { key: 'checks', label: 'CI/Checks', icon: ShieldCheck },
    { key: 'actions', label: 'Actions', icon: Play },
];

export const WorkItemDetailModal = ({
    workItem,
    onClose,
    onRefresh,
    onAssess,
    onRun,
    onCancel,
    onRetry
}: WorkItemDetailModalProps) => {
    const [activeTab, setActiveTab] = useState<DetailTab>('assessment');
    const [actioning, setActioning] = useState(false);

    const handleAction = async (fn?: (workItem: WorkItem) => Promise<void>) => {
        if (!fn) return;
        setActioning(true);
        try {
            await fn(workItem);
            onRefresh();
        } catch (error) {
            console.error('Action failed:', error);
        } finally {
            setActioning(false);
        }
    };

    const assessment = workItem.assessment;
    const graph = workItem.graph;
    const checklist = workItem.checklist;

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
            onClick={onClose}
        >
            <motion.div
                initial={{ scale: 0.95, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 20 }}
                className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
            >
                {/* Header */}
                <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                    <div className="flex justify-between items-start mb-4">
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-3 mb-1">
                                <h2 className="text-xl font-bold text-slate-900 truncate">{workItem.title}</h2>
                                <span className={cn('rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest', statusColors[workItem.status] || statusColors.created)}>
                                    {workItem.status}
                                </span>
                                <span className={cn('rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest', riskColors[workItem.risk] || riskColors.low)}>
                                    {workItem.risk}
                                </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                                <span className="font-mono uppercase tracking-widest">{workItem.id}</span>
                                <span>·</span>
                                <span className="font-black uppercase tracking-widest">{workItem.type}</span>
                                <span>·</span>
                                <span>{workItem.source}</span>
                                <span>·</span>
                                <span>runs {workItem.linkedRuns.length}</span>
                            </div>
                            {workItem.description && (
                                <p className="mt-2 text-sm text-slate-600 line-clamp-2">{workItem.description}</p>
                            )}
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 rounded-xl hover:bg-slate-100 transition-colors ml-4"
                            aria-label="Close"
                        >
                            <XCircle size={20} className="text-slate-400" />
                        </button>
                    </div>

                    {/* Tabs */}
                    <div className="flex gap-1 overflow-x-auto">
                        {tabs.map(({ key, label, icon: Icon }) => (
                            <button
                                key={key}
                                onClick={() => setActiveTab(key)}
                                className={cn(
                                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors whitespace-nowrap',
                                    activeTab === key
                                        ? 'bg-indigo-600 text-white'
                                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                                )}
                            >
                                <Icon size={12} />
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-6">
                    {activeTab === 'assessment' && (
                        <AssessmentTab assessment={assessment} />
                    )}
                    {activeTab === 'graph' && (
                        <GraphTab graph={graph} />
                    )}
                    {activeTab === 'checklist' && (
                        <ChecklistTab checklist={checklist} />
                    )}
                    {activeTab === 'runs' && (
                        <RunsTab linkedRuns={workItem.linkedRuns} />
                    )}
                    {activeTab === 'branch' && (
                        <BranchTab workItem={workItem} />
                    )}
                    {activeTab === 'checks' && (
                        <ChecksTab checks={workItem.checks} pullRequest={workItem.pullRequest} />
                    )}
                    {activeTab === 'actions' && (
                        <ActionsTab
                            workItem={workItem}
                            actioning={actioning}
                            onAssess={onAssess}
                            onRun={onRun}
                            onCancel={onCancel}
                            onRetry={onRetry}
                            handleAction={handleAction}
                        />
                    )}
                </div>
            </motion.div>
        </motion.div>
    );
};

function AssessmentTab({ assessment }: { assessment?: WorkItem['assessment'] }) {
    if (!assessment) {
        return (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                <SearchCode size={32} className="mx-auto text-slate-300 mb-3" />
                <p className="text-sm text-slate-500 font-bold">No assessment yet</p>
                <p className="text-xs text-slate-400 mt-1">Run "Assess" to analyze this work item</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
                <InfoCard label="Complexity" value={assessment.complexity} color="bg-blue-50 text-blue-600" />
                <InfoCard label="Risk" value={assessment.risk} color={cn(riskColors[assessment.risk] || riskColors.low)} />
                <InfoCard label="Confidence" value={`${Math.round(assessment.confidence * 100)}%`} color="bg-indigo-50 text-indigo-600" />
                <InfoCard label="Model Tier" value={assessment.modelTier !== undefined ? `Tier ${assessment.modelTier}` : 'N/A'} color="bg-violet-50 text-violet-600" />
                <InfoCard label="Requires Branch" value={assessment.requiresBranch ? 'Yes' : 'No'} color={assessment.requiresBranch ? 'bg-amber-50 text-amber-600' : 'bg-slate-50 text-slate-500'} />
                <InfoCard label="Needs Approval" value={assessment.requiresHumanApproval ? 'Yes' : 'No'} color={assessment.requiresHumanApproval ? 'bg-orange-50 text-orange-600' : 'bg-slate-50 text-slate-500'} />
                <InfoCard label="Full Test Suite" value={assessment.requiresFullTestSuite ? 'Yes' : 'No'} color={assessment.requiresFullTestSuite ? 'bg-cyan-50 text-cyan-600' : 'bg-slate-50 text-slate-500'} />
                {assessment.tokenBudget !== undefined && (
                    <InfoCard label="Token Budget" value={assessment.tokenBudget.toLocaleString()} color="bg-teal-50 text-teal-600" />
                )}
            </div>

            {assessment.modelCallReason && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Model Call Reason</p>
                    <p className="text-sm text-slate-700">{assessment.modelCallReason}</p>
                </div>
            )}

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Reason</p>
                <p className="text-sm text-slate-700">{assessment.reason}</p>
            </div>

            {assessment.affectedAreas.length > 0 && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Affected Areas</p>
                    <div className="flex flex-wrap gap-1.5">
                        {assessment.affectedAreas.map((area) => (
                            <span key={area} className="rounded-lg bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                                {area}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function GraphTab({ graph }: { graph?: WorkItem['graph'] }) {
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

function ChecklistTab({ checklist }: { checklist?: WorkItem['checklist'] }) {
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

function RunsTab({ linkedRuns }: { linkedRuns: string[] }) {
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

function BranchTab({ workItem }: { workItem: WorkItem }) {
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

function ChecksTab({ checks, pullRequest }: { checks?: WorkItem['checks']; pullRequest?: WorkItem['pullRequest'] }) {
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
            {/* Summary bar */}
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

            {/* Overall status */}
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

            {/* Detailed check list */}
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
                                        isPending ? 'bg-amber-100 text-amber-600 bg-amber-100 animate-pulse' :
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

function ActionsTab({
    workItem,
    actioning,
    onAssess,
    onRun,
    onCancel,
    onRetry,
    handleAction
}: {
    workItem: WorkItem;
    actioning: boolean;
    onAssess?: (workItem: WorkItem) => Promise<void>;
    onRun?: (workItem: WorkItem) => Promise<void>;
    onCancel?: (workItem: WorkItem) => Promise<void>;
    onRetry?: (workItem: WorkItem) => Promise<void>;
    handleAction: (fn?: (workItem: WorkItem) => Promise<void>) => Promise<void>;
}) {
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
                            : 'border-slate-100 bg-slate-50 text-slate-400 cursor-not-allowed'
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
                            : 'border-slate-100 bg-slate-50 text-slate-400 cursor-not-allowed'
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
                            : 'border-slate-100 bg-slate-50 text-slate-400 cursor-not-allowed'
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
                            : 'border-slate-100 bg-slate-50 text-slate-400 cursor-not-allowed'
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

function InfoCard({ label, value, color }: { label: string; value: string; color: string }) {
    return (
        <div className={cn('rounded-xl p-3', color.replace('text-', 'bg-').replace('bg-', 'bg-').includes('bg-') ? color.replace(/text-\w+/, (m) => m.replace('text-', 'bg-') + '/70') : 'bg-slate-50')}>
            <p className="text-[10px] font-black uppercase tracking-widest opacity-70 mb-0.5">{label}</p>
            <p className="text-sm font-bold">{value}</p>
        </div>
    );
}