import React from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Cpu, HardDrive, Activity, Wifi, WifiOff, Server } from "lucide-react";
import { cn } from "../utils/cn";
import { useWorkers } from "../hooks/useWorkers";
import type { WorkerInfo } from "../types/index.js";

const statusColors: Record<string, string> = {
  online: "bg-emerald-100 text-emerald-700",
  idle: "bg-blue-100 text-blue-700",
  busy: "bg-amber-100 text-amber-700",
  draining: "bg-orange-100 text-orange-700",
  disabled: "bg-slate-200 text-slate-600",
  offline: "bg-rose-100 text-rose-700",
};

const statusIcons: Record<string, React.ReactNode> = {
  online: <Wifi size={14} />,
  idle: <Wifi size={14} />,
  busy: <Activity size={14} />,
  draining: <WifiOff size={14} />,
  disabled: <WifiOff size={14} />,
  offline: <WifiOff size={14} />,
};

function formatLastSeen(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

export function WorkersPage() {
  const { workers, loading, error, stats, setWorkerStatus, actioningWorkerId } = useWorkers();

  if (loading) {
    return (
      <div className="p-20 text-center flex flex-col items-center justify-center gap-4">
        <div className="w-10 h-10 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
        <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">Loading Workers...</p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="space-y-6"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-3">
          <Server size={24} className="text-indigo-500" />
          Workers
        </h2>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard title="Total" value={stats.total} icon={Server} color="bg-slate-50 text-slate-600" />
        <StatCard title="Online" value={stats.online} icon={Wifi} color="bg-emerald-50 text-emerald-600" />
        <StatCard title="Idle" value={stats.idle} icon={Activity} color="bg-blue-50 text-blue-600" />
        <StatCard title="Busy" value={stats.busy} icon={Cpu} color="bg-amber-50 text-amber-600" />
        <StatCard title="Offline" value={stats.offline} icon={WifiOff} color="bg-rose-50 text-rose-600" />
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700 flex items-center gap-3">
          <AlertTriangle size={18} />
          {error}
        </div>
      )}

      {workers.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-20 text-center shadow-sm">
          <Server size={48} className="mx-auto text-slate-300 mb-4" />
          <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">No workers registered</p>
          <p className="text-slate-300 text-sm mt-2">Workers will appear here when they connect to the server.</p>
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Worker</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">OS / Arch</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Labels</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Capabilities</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Current Job</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Last Seen</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Resources</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {workers.map((worker) => (
                  <WorkerRow
                    key={worker.id}
                    worker={worker}
                    actioning={actioningWorkerId === worker.id}
                    onAction={(action) => void setWorkerStatus(worker.id, action)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function WorkerRow({
  worker,
  actioning,
  onAction
}: {
  worker: WorkerInfo;
  actioning: boolean;
  onAction: (action: "disable" | "enable" | "drain") => void;
}) {
  const capabilities = Object.entries(worker.capabilities || {}).filter(([, enabled]) => Boolean(enabled));
  return (
    <tr className="hover:bg-slate-50/50 transition-colors">
      <td className="px-6 py-4">
        <div>
          <p className="font-bold text-slate-800 text-sm">{worker.name}</p>
          <p className="text-[10px] text-slate-400 font-mono">{worker.id}</p>
          <p className="text-[10px] text-slate-300">v{worker.version}</p>
        </div>
      </td>
      <td className="px-6 py-4">
        <span className={cn(
          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
          statusColors[worker.status] || statusColors.offline
        )}>
          {statusIcons[worker.status] || <WifiOff size={14} />}
          {worker.status}
        </span>
      </td>
      <td className="px-6 py-4">
        <span className="text-sm text-slate-600 font-mono">{worker.os}/{worker.arch}</span>
      </td>
      <td className="px-6 py-4">
        <div className="flex flex-wrap gap-1">
          {worker.labels.map((label) => (
            <span key={label} className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[9px] font-bold uppercase tracking-wider">
              {label}
            </span>
          ))}
        </div>
      </td>
      <td className="px-6 py-4">
        <div className="flex flex-wrap gap-1 max-w-[220px]">
          {capabilities.length === 0 ? (
            <span className="text-slate-300 text-xs">—</span>
          ) : capabilities.slice(0, 4).map(([capability]) => (
            <span key={capability} className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 text-[9px] font-bold uppercase tracking-wider">
              {capability}
            </span>
          ))}
          {capabilities.length > 4 && (
            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[9px] font-bold">
              +{capabilities.length - 4}
            </span>
          )}
        </div>
      </td>
      <td className="px-6 py-4">
        {worker.currentJobId ? (
          <span className="font-mono text-xs text-indigo-600">{worker.currentJobId}</span>
        ) : (
          <span className="text-slate-300 text-xs">—</span>
        )}
      </td>
      <td className="px-6 py-4">
        <span className="text-sm text-slate-500">{formatLastSeen(worker.lastHeartbeatAt)}</span>
      </td>
      <td className="px-6 py-4">
        <div className="flex items-center gap-3 text-xs text-slate-500">
          {worker.freeDiskGb !== undefined && (
            <span className="flex items-center gap-1" title="Free Disk">
              <HardDrive size={12} />
              {worker.freeDiskGb.toFixed(0)} GB
            </span>
          )}
          {worker.cpuLoad !== undefined && (
            <span className="flex items-center gap-1" title="CPU Load">
              <Cpu size={12} />
              {(worker.cpuLoad * 100).toFixed(0)}%
            </span>
          )}
        </div>
      </td>
      <td className="px-6 py-4">
        <div className="flex flex-wrap gap-2">
          {worker.status === "disabled" ? (
            <button
              disabled={actioning}
              onClick={() => onAction("enable")}
              className="px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100 text-[10px] font-black uppercase tracking-wider disabled:opacity-50"
            >
              Enable
            </button>
          ) : (
            <button
              disabled={actioning}
              onClick={() => onAction("disable")}
              className="px-3 py-1.5 rounded-xl bg-rose-50 text-rose-700 border border-rose-100 text-[10px] font-black uppercase tracking-wider disabled:opacity-50"
            >
              Disable
            </button>
          )}
          <button
            disabled={actioning || worker.status === "draining" || worker.status === "disabled"}
            onClick={() => onAction("drain")}
            className="px-3 py-1.5 rounded-xl bg-orange-50 text-orange-700 border border-orange-100 text-[10px] font-black uppercase tracking-wider disabled:opacity-50"
          >
            Drain
          </button>
        </div>
      </td>
    </tr>
  );
}

function StatCard({ title, value, icon: Icon, color }: { title: string; value: number; icon: React.ElementType; color: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{title}</p>
          <p className="text-2xl font-black text-slate-900 mt-1">{value}</p>
        </div>
        <div className={cn("p-2 rounded-xl", color)}>
          <Icon size={20} />
        </div>
      </div>
    </div>
  );
}
