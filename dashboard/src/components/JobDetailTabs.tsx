import { cn } from '../utils/cn';
export type JobDetailTab =
  | 'overview'
  | 'phases'
  | 'context-pack'
  | 'diff'
  | 'guards'
  | 'verification'
  | 'artifacts'
  | 'analytics'
  | 'audit'
  | 'diagnostics'
  | 'files'
  | 'console'
  | 'compare';

const tabs: JobDetailTab[] = [
  'overview',
  'phases',
  'context-pack',
  'diff',
  'guards',
  'verification',
  'artifacts',
  'analytics',
  'audit',
  'diagnostics',
  'files',
  'console',
  'compare'
];

interface JobDetailTabsProps {
  activeTab: JobDetailTab;
  onChange: (tab: JobDetailTab) => void;
}

export const JobDetailTabs = ({ activeTab, onChange }: JobDetailTabsProps) => (
  <div className="flex flex-wrap gap-1 p-1 bg-slate-200/50 rounded-xl w-full">
    {tabs.map(tab => (
      <button
        key={tab}
        onClick={() => onChange(tab)}
        className={cn(
          "px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-tight transition-all",
          activeTab === tab ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
        )}
      >
        {tab === 'context-pack'
          ? 'Context Pack'
          : tab === 'verification'
            ? 'Verification'
            : tab === 'phases'
              ? 'Phases'
              : tab === 'overview'
                ? 'Overview'
                : tab === 'diff'
                  ? 'Diff'
                  : tab === 'guards'
                    ? 'Guards'
                    : tab === 'artifacts'
                      ? 'Artifacts'
                      : tab === 'files'
                        ? 'File Changes'
                        : tab === 'analytics'
                          ? 'Analytics'
                          : tab === 'audit'
                            ? 'Audit Trail'
                          : tab === 'diagnostics'
                            ? 'Diagnostics'
                            : tab === 'console'
                              ? 'Console'
                              : tab === 'compare'
                                ? 'Comparison'
                                : tab}
      </button>
    ))}
  </div>
);
