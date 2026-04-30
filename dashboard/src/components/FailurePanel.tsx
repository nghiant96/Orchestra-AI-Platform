import { AlertCircle, Lightbulb, RefreshCw, XCircle, Zap } from 'lucide-react';
import type { FailureMetadata, RetryHint } from '../types/index.js';

interface FailurePanelProps {
  failure: FailureMetadata;
  retryHint?: RetryHint | null;
}

export const FailurePanel = ({ failure, retryHint }: FailurePanelProps) => {
  const getIcon = (cls: string) => {
    switch (cls) {
      case 'budget_exceeded':
      case 'cost-budget-exceeded':
      case 'duration-budget-exceeded': return <XCircle className="text-rose-500" size={20} />;
      case 'provider_timeout':
      case 'provider-timeout': return <RefreshCw className="text-amber-500" size={20} />;
      default: return <AlertCircle className="text-rose-500" size={20} />;
    }
  };

  return (
    <div className="bg-rose-50 border border-rose-100 rounded-3xl p-6 mb-8 overflow-hidden relative group">
      <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none group-hover:scale-110 transition-transform">
        <XCircle size={80} />
      </div>
      
      <div className="flex items-start gap-4">
        <div className="bg-white p-3 rounded-2xl shadow-sm border border-rose-100 shrink-0">
          {getIcon(failure.class)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-black text-rose-400 uppercase tracking-widest">{failure.class.replace(/[_-]/g, ' ')}</span>
            {failure.retryable && (
              <span className="bg-emerald-100 text-emerald-600 text-[8px] font-black px-1.5 py-0.5 rounded uppercase">Retryable</span>
            )}
          </div>
          <h3 className="text-lg font-black text-slate-900 leading-tight mb-2">{failure.message}</h3>
          {failure.detail && (
            <p className="text-xs font-medium text-slate-500 leading-relaxed">{failure.detail}</p>
          )}
          
          {failure.suggestion && (
            <div className="flex items-start gap-2 mt-4 bg-white/60 p-4 rounded-2xl border border-rose-100/50">
              <Lightbulb size={16} className="text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs font-bold text-slate-600 leading-relaxed">
                <span className="text-slate-900">Suggestion:</span> {failure.suggestion}
              </p>
            </div>
          )}

          {retryHint && (
            <div className="mt-3 rounded-2xl border border-indigo-100 bg-white/70 p-4">
              <div className="mb-2 flex items-center gap-2">
                <Zap size={15} className="text-indigo-500" />
                <p className="text-[10px] font-black uppercase tracking-widest text-indigo-500">Retry checkpoint</p>
              </div>
              <div className="grid grid-cols-1 gap-2 text-xs font-bold text-slate-600 sm:grid-cols-[auto_1fr]">
                <span className="text-slate-400">Stage</span>
                <span>{retryHint.stage.replace(/-/g, ' ')}</span>
                {retryHint.iteration !== undefined && (
                  <>
                    <span className="text-slate-400">Iteration</span>
                    <span>{retryHint.iteration}</span>
                  </>
                )}
                <span className="text-slate-400">Reason</span>
                <span>{retryHint.reason}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
