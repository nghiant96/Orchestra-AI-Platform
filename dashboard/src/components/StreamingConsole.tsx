import { useState, useEffect, useRef } from 'react';
import { Terminal } from 'lucide-react';
import { cn } from '../utils/cn';

interface StreamingConsoleProps {
  jobId: string;
}

export const StreamingConsole = ({ jobId }: StreamingConsoleProps) => {
  const [logs, setLogs] = useState<{ level: string, message: string, timestamp: string, jobId?: string }[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const eventSource = new EventSource('/logs');

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (!data.jobId || data.jobId === jobId) {
        setLogs(prev => [...prev, data].slice(-200));
      }
    };

    return () => eventSource.close();
  }, [jobId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="flex flex-col h-full bg-slate-900 rounded-2xl overflow-hidden border border-slate-800 shadow-2xl">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-900/50">
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
          <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
        </div>
        <span className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest">Live Execution Stream</span>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 font-mono text-[11px] space-y-1 custom-scrollbar">
        {logs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-600 gap-3">
            <Terminal size={24} className="opacity-20" />
            <p className="animate-pulse uppercase tracking-widest font-bold">Awaiting stream connection...</p>
          </div>
        ) : (
          logs.map((log, i) => (
            <div key={i} className="flex gap-3 group">
              <span className="text-slate-600 shrink-0 select-none opacity-40 group-hover:opacity-100 transition-opacity">
                [{new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}]
              </span>
              <span className={cn(
                "font-bold shrink-0 w-12 uppercase",
                log.level === 'step' ? "text-indigo-400" :
                log.level === 'error' ? "text-rose-400" :
                log.level === 'warn' ? "text-amber-400" :
                log.level === 'ok' ? "text-emerald-400" :
                "text-slate-400"
              )}>
                {log.level}
              </span>
              <span className="text-slate-300 break-all leading-relaxed">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
