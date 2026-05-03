import { SearchCode } from 'lucide-react';
import type { WorkItem } from '../../types';
import { cn } from '../../utils/cn';
import { riskColors } from './constants';

interface AssessmentTabProps {
    assessment?: WorkItem['assessment'];
}

export function AssessmentTab({ assessment }: AssessmentTabProps) {
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
                <InfoCard label="Risk" value={assessment.risk} color={riskColors[assessment.risk] || riskColors.low} />
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

function InfoCard({ label, value, color }: { label: string; value: string; color: string }) {
    return (
        <div className={cn('rounded-xl p-3', color)}>
            <p className="text-[10px] font-black uppercase tracking-widest opacity-70 mb-0.5">{label}</p>
            <p className="text-sm font-bold">{value}</p>
        </div>
    );
}
