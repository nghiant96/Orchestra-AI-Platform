import { useState, useEffect } from 'react';
import { ArrowRight, TrendingDown, TrendingUp, Clock, FileCode } from 'lucide-react';
import type { Job } from '../types';

interface JobComparisonViewProps {
  currentJob: Job;
}

export const JobComparisonView = ({ currentJob }: JobComparisonViewProps) => {
  const [prevJob, setPrevJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);

  // Reset loading when job ID changes
  const [lastJobId, setLastJobId] = useState(currentJob.jobId);
  if (currentJob.jobId !== lastJobId) {
    setLastJobId(currentJob.jobId);
    setLoading(true);
  }

  useEffect(() => {
    let active = true;
    fetch(`/jobs?cwd=${encodeURIComponent(currentJob.cwd)}&t=${Date.now()}`)
      .then(res => res.json())
      .then(data => {
        if (active) {
          const jobs = data.jobs || [];
          // Find the most recent successful job that is NOT the current one
          const lastSuccess = jobs.find((j: Job) => 
            j.jobId !== currentJob.jobId && 
            j.status === 'completed'
          );
          setPrevJob(lastSuccess || null);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [currentJob.cwd, currentJob.jobId]);

  if (loading) return (
    <div className="py-20 text-center flex flex-col items-center justify-center gap-4">
      <div className="w-8 h-8 border-4 border-slate-200 border-t-indigo-500 rounded-full animate-spin" />
      <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">Analyzing past performance...</p>
    </div>
  );

  if (!prevJob) return (
    <div className="py-20 text-center bg-slate-50 rounded-3xl border border-dashed border-slate-200">
      <div className="bg-white w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
        <ArrowRight size={24} className="text-slate-300" />
      </div>
      <h3 className="text-slate-900 font-black text-sm uppercase tracking-tight">No previous successful run</h3>
      <p className="text-slate-400 text-[10px] mt-1 font-medium px-10">We couldn't find a completed run in this workspace to compare against.</p>
    </div>
  );

  const curCost = currentJob.execution?.budget?.totalCostUnits || 0;
  const prevCost = prevJob.execution?.budget?.totalCostUnits || 0;
  const costDiff = curCost - prevCost;
  
  const curTime = (currentJob.execution?.totalDurationMs || 0) / 1000;
  const prevTime = (prevJob.execution?.totalDurationMs || 0) / 1000;
  const timeDiff = curTime - prevTime;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Efficiency Delta</span>
            {costDiff <= 0 ? (
              <span className="flex items-center gap-1 text-emerald-500 font-black text-[10px] uppercase">
                <TrendingDown size={12} />
                Saving Units
              </span>
            ) : (
              <span className="flex items-center gap-1 text-rose-500 font-black text-[10px] uppercase">
                <TrendingUp size={12} />
                Increased Burn
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-black text-slate-900">{curCost.toFixed(3)}</p>
            <p className="text-xs font-bold text-slate-400">vs {prevCost.toFixed(3)} units</p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Latency Shift</span>
            {timeDiff <= 0 ? (
              <span className="flex items-center gap-1 text-emerald-500 font-black text-[10px] uppercase">
                <Clock size={12} />
                Faster Run
              </span>
            ) : (
              <span className="flex items-center gap-1 text-amber-500 font-black text-[10px] uppercase">
                <Clock size={12} />
                Slower Run
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-black text-slate-900">{curTime.toFixed(1)}s</p>
            <p className="text-xs font-bold text-slate-400">vs {prevTime.toFixed(1)}s</p>
          </div>
        </div>
      </div>

      <div className="bg-slate-900 rounded-3xl p-8 border border-slate-800 shadow-xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="bg-indigo-500/20 p-2 rounded-xl text-indigo-400">
            <FileCode size={20} />
          </div>
          <div>
            <h3 className="text-white font-black text-sm uppercase tracking-tight">Scope Comparison</h3>
            <p className="text-slate-500 text-[10px] font-medium">Comparison between current task and last success</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-8">
            <div>
              <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-3">Previous Task</p>
              <p className="text-xs text-slate-300 font-mono leading-relaxed line-clamp-3 opacity-70 italic">"{prevJob.task}"</p>
            </div>
            <div>
              <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-3">Current Task</p>
              <p className="text-xs text-white font-mono leading-relaxed line-clamp-3">"{currentJob.task}"</p>
            </div>
          </div>
          
          <div className="pt-4 border-t border-slate-800 flex justify-between items-center">
             <div className="flex items-center gap-4">
                <div className="text-center">
                   <p className="text-[10px] font-black text-slate-500 uppercase">Files Changed</p>
                   <p className="text-lg font-black text-white">{currentJob.diffSummaries?.length || 0} <span className="text-[10px] text-slate-500 font-bold ml-1">vs {prevJob.diffSummaries?.length || 0}</span></p>
                </div>
                <div className="h-8 w-px bg-slate-800 mx-2" />
                <div className="text-center">
                   <p className="text-[10px] font-black text-slate-500 uppercase">Checks Passed</p>
                   <p className="text-lg font-black text-emerald-400">{currentJob.latestToolResults?.filter(r => r.ok).length || 0} <span className="text-[10px] text-slate-500 font-bold ml-1">/ {currentJob.latestToolResults?.length || 0}</span></p>
                </div>
             </div>
             <div className="text-right">
                <p className="text-[10px] font-black text-slate-500 uppercase">Previous Success ID</p>
                <p className="text-[10px] font-mono text-indigo-400 uppercase">{prevJob.jobId}</p>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};
