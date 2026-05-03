import { useState, type ComponentType } from 'react';
import { motion } from 'framer-motion';
import {
    XCircle,
    ListChecks,
    GitBranch,
    ShieldCheck,
    Play,
    SearchCode,
    GitPullRequest,
    History,
} from 'lucide-react';
import type { WorkItem } from '../../types';
import { cn } from '../../utils/cn';
import { AssessmentTab } from './AssessmentTab';
import { GraphTab } from './GraphTab';
import { ChecklistTab } from './ChecklistTab';
import { RunsTab } from './RunsTab';
import { BranchTab } from './BranchTab';
import { ChecksTab } from './ChecksTab';
import { ActionsTab } from './ActionsTab';
import { riskColors, statusColors } from './constants';

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

const tabs: { key: DetailTab; label: string; icon: ComponentType<{ size?: number; className?: string }> }[] = [
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
    onRetry,
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

                    <div className="flex gap-1 overflow-x-auto">
                        {tabs.map(({ key, label, icon: Icon }) => (
                            <button
                                key={key}
                                onClick={() => setActiveTab(key)}
                                className={cn(
                                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors whitespace-nowrap',
                                    activeTab === key
                                        ? 'bg-indigo-600 text-white'
                                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200',
                                )}
                            >
                                <Icon size={12} />
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    {activeTab === 'assessment' && <AssessmentTab assessment={assessment} />}
                    {activeTab === 'graph' && <GraphTab graph={graph} />}
                    {activeTab === 'checklist' && <ChecklistTab checklist={checklist} />}
                    {activeTab === 'runs' && <RunsTab linkedRuns={workItem.linkedRuns} />}
                    {activeTab === 'branch' && <BranchTab workItem={workItem} />}
                    {activeTab === 'checks' && <ChecksTab checks={workItem.checks} pullRequest={workItem.pullRequest} />}
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
