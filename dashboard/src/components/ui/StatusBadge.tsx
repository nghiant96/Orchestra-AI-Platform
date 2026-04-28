import { 
  Clock, 
  Zap, 
  CheckCircle, 
  AlertCircle, 
  XCircle 
} from 'lucide-react';
import { cn } from '../../utils/cn';
import type { Job } from '../../types';

export const StatusBadge = ({ status }: { status: Job['status'] }) => {
  const styles = {
    queued: 'bg-slate-100 text-slate-600 border-slate-200',
    running: 'bg-indigo-50 text-indigo-600 border-indigo-200 shadow-[0_0_10px_rgba(79,70,229,0.1)]',
    completed: 'bg-emerald-50 text-emerald-600 border-emerald-200',
    failed: 'bg-rose-50 text-rose-600 border-rose-200',
    waiting_for_approval: 'bg-amber-50 text-amber-600 border-amber-200 animate-pulse',
    cancel_requested: 'bg-amber-50 text-amber-600 border-amber-200',
    cancelled: 'bg-slate-100 text-slate-500 border-slate-200'
  };

  const icons = {
    queued: <Clock size={12} />,
    running: <Zap size={12} className="animate-pulse" />,
    completed: <CheckCircle size={12} />,
    failed: <AlertCircle size={12} />,
    waiting_for_approval: <Clock size={12} />,
    cancel_requested: <AlertCircle size={12} />,
    cancelled: <XCircle size={12} />
  };

  return (
    <div className={cn(
      "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider border uppercase transition-all duration-300",
      styles[status]
    )}>
      {icons[status]}
      {status.replace('_', ' ')}
    </div>
  );
};
