export const statusColors: Record<string, string> = {
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

export const riskColors: Record<string, string> = {
    low: 'bg-emerald-50 text-emerald-600',
    medium: 'bg-yellow-50 text-yellow-600',
    high: 'bg-orange-50 text-orange-600',
    blocked: 'bg-rose-50 text-rose-600',
};
