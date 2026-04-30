import { Activity, AlertCircle, CheckCircle, Clock, Zap } from 'lucide-react';
import { cn } from '../utils/cn';
import type { ExecutionTransition } from '../types';

interface JobTimelineSectionProps {
  transitions: ExecutionTransition[];
}

export const JobTimelineSection = ({ transitions }: JobTimelineSectionProps) => (
  <section>
    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
      <Activity size={14} />
      Status Stream
    </h3>
    <div className="space-y-4">
      {transitions.length === 0 ? (
        <div className="text-center py-10 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
          <Clock size={32} className="mx-auto text-slate-300 mb-3" />
          <p className="text-sm text-slate-400 font-medium">No transitions recorded.</p>
        </div>
      ) : (
        transitions.map((transition, index) => (
          <div key={index} className="flex gap-4 group">
            <div className="flex flex-col items-center">
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center shrink-0 border-2 z-10",
                transition.status === 'entered' ? "bg-indigo-50 border-indigo-200 text-indigo-600" :
                transition.status === 'completed' ? "bg-emerald-50 border-emerald-200 text-emerald-600" :
                transition.status === 'failed' ? "bg-rose-50 border-rose-200 text-rose-600" :
                "bg-slate-50 border-slate-200 text-slate-400"
              )}>
                {transition.status === 'entered' ? <Zap size={14} className="animate-pulse" /> :
                 transition.status === 'completed' ? <CheckCircle size={14} /> :
                 transition.status === 'failed' ? <AlertCircle size={14} /> :
                 <Clock size={14} />}
              </div>
              {index < transitions.length - 1 && (
                <div className="w-0.5 flex-1 bg-slate-100 my-1 group-last:hidden" />
              )}
            </div>
            <div className="pb-6 flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-bold text-slate-900 uppercase tracking-tight">{transition.stage.replace(/-/g, ' ')}</span>
                <span className="text-[10px] font-mono text-slate-400">{new Date(transition.timestamp).toLocaleTimeString()}</span>
              </div>
              <p className="text-xs text-slate-500 font-medium leading-relaxed">{transition.detail || `Stage ${transition.status}`}</p>
            </div>
          </div>
        )).reverse()
      )}
    </div>
  </section>
);
