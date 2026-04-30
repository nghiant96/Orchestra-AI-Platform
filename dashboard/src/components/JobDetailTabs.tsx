import { cn } from '../utils/cn';

export type JobDetailTab = 'timeline' | 'analytics' | 'diagnostics' | 'files' | 'console' | 'compare';

const tabs: JobDetailTab[] = ['timeline', 'analytics', 'diagnostics', 'files', 'console', 'compare'];

interface JobDetailTabsProps {
  activeTab: JobDetailTab;
  onChange: (tab: JobDetailTab) => void;
}

export const JobDetailTabs = ({ activeTab, onChange }: JobDetailTabsProps) => (
  <div className="flex gap-1 p-1 bg-slate-200/50 rounded-xl w-fit">
    {tabs.map(tab => (
      <button
        key={tab}
        onClick={() => onChange(tab)}
        className={cn(
          "px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-tight transition-all",
          activeTab === tab ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
        )}
      >
        {tab === 'files' ? 'File Changes' : tab === 'compare' ? 'Comparison' : tab}
      </button>
    ))}
  </div>
);
