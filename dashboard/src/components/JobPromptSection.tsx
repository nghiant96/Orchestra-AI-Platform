import { Terminal } from 'lucide-react';

interface JobPromptSectionProps {
  task: string;
}

export const JobPromptSection = ({ task }: JobPromptSectionProps) => (
  <section>
    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
      <Terminal size={14} />
      Prompt Configuration
    </h3>
    <div className="bg-slate-900 rounded-2xl p-5 text-indigo-200 font-mono text-xs leading-relaxed border border-slate-800 shadow-inner">
      {task}
    </div>
  </section>
);
