import { Pause, Play, Trash2, ShieldAlert } from 'lucide-react';
import type { SystemHealth } from '../hooks/useHealth';
import { toast } from 'sonner';
import { cn } from '../utils/cn';

interface OperationsControlProps {
  health: SystemHealth | null;
  onRefresh: () => void;
}

export const OperationsControl = ({ health, onRefresh }: OperationsControlProps) => {
  const handleTogglePause = async () => {
    const isPaused = health?.queue.paused;
    const res = await fetch(`/queue/${isPaused ? 'resume' : 'pause'}`, { method: 'POST' });
    if (res.ok) {
      toast.success(`System queue ${isPaused ? 'resumed' : 'paused'}`);
      onRefresh();
    } else {
      toast.error("Failed to update queue state");
    }
  };

  const handleClearFinished = async () => {
    if (!confirm("Are you sure you want to clear all finished, failed, and cancelled job records?")) return;
    const res = await fetch('/queue/clear-finished', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      toast.success(`Cleared ${data.deletedCount} job records`);
      onRefresh();
    }
  };

  return (
    <section className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm lg:col-span-2">
      <h2 className="text-xl font-black mb-6 flex items-center gap-3">
        <ShieldAlert className="text-rose-500" />
        Operations Control
      </h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Global Queue State</p>
              <h3 className="text-lg font-black text-slate-900 mt-1">
                {health?.queue.paused ? "PAUSED" : "ACTIVE"}
              </h3>
            </div>
            <button
              onClick={handleTogglePause}
              className={cn(
                "p-4 rounded-2xl shadow-lg transition-all active:scale-95",
                health?.queue.paused 
                  ? "bg-emerald-500 text-white shadow-emerald-200 hover:bg-emerald-600" 
                  : "bg-amber-500 text-white shadow-amber-200 hover:bg-amber-600"
              )}
            >
              {health?.queue.paused ? <Play size={24} /> : <Pause size={24} />}
            </button>
          </div>
          <p className="text-[10px] text-slate-500 leading-relaxed font-medium">
            {health?.queue.paused 
              ? "The system is not processing any new jobs. Tasks will remain in 'queued' state." 
              : "The system is actively monitoring and processing the task queue."}
          </p>
        </div>

        <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Maintenance</p>
              <h3 className="text-lg font-black text-slate-900 mt-1">Cleanup Records</h3>
            </div>
            <button
              onClick={handleClearFinished}
              className="p-4 bg-white text-rose-500 rounded-2xl shadow-md hover:bg-rose-50 border border-rose-100 transition-all active:scale-95"
            >
              <Trash2 size={24} />
            </button>
          </div>
          <p className="text-[10px] text-slate-500 leading-relaxed font-medium">
            Remove all completed, failed, and cancelled job files from the server to free up space. 
            <span className="text-rose-500 font-bold ml-1">This action cannot be undone.</span>
          </p>
        </div>
      </div>
    </section>
  );
};
