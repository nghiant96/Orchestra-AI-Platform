import { AlertTriangle, TrendingUp, ShieldAlert } from 'lucide-react';
import { cn } from '../utils/cn';

interface BudgetWarningProps {
  totalCost: number;
  maxCost: number | null;
  exceeded: boolean;
}

export const BudgetWarning = ({ totalCost, maxCost, exceeded }: BudgetWarningProps) => {
  if (!maxCost && !exceeded) return null;

  return (
    <div className={cn(
      "p-4 rounded-2xl border flex items-start gap-4 mb-6 transition-all animate-in fade-in slide-in-from-top-2",
      exceeded 
        ? "bg-rose-50 border-rose-100 text-rose-800" 
        : "bg-amber-50 border-amber-100 text-amber-800"
    )}>
      <div className={cn(
        "p-2 rounded-xl shrink-0",
        exceeded ? "bg-rose-100 text-rose-600" : "bg-amber-100 text-amber-600"
      )}>
        {exceeded ? <ShieldAlert size={20} /> : <TrendingUp size={20} />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-black uppercase tracking-tight mb-1">
          {exceeded ? "Budget Threshold Exceeded" : "Budget Attention Required"}
        </p>
        <p className="text-[11px] font-medium opacity-90 leading-relaxed">
          The estimated cost for this run is <span className="font-bold">{totalCost.toFixed(3)} units</span>. 
          {maxCost && (
            <> Your configured limit is <span className="font-bold">{maxCost.toFixed(3)} units</span>.</>
          )}
        </p>
        {exceeded && (
          <div className="mt-3 flex items-center gap-2 text-[10px] font-bold bg-white/50 w-fit px-2 py-1 rounded-lg border border-rose-100">
            <AlertTriangle size={12} />
            Generation will require manual override to proceed.
          </div>
        )}
      </div>
    </div>
  );
};
