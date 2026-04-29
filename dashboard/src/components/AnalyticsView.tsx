import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, AreaChart, Area
} from 'recharts';
import { TrendingUp, Clock, Download, PieChart as PieIcon, LayoutDashboard } from 'lucide-react';
import { StatCard } from './StatCard';

interface AnalyticsData {
  totalProjectCost: number;
  costByDay: { date: string, cost: number }[];
  failuresByClass: { name: string, count: number }[];
  avgDurationByStage: { stage: string, avgMs: number }[];
}

export const AnalyticsView = ({ currentProject }: { currentProject: string }) => {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    
    // Set loading only if project actually changed
    // Use a small delay or a ref if needed, but for now just avoid sync setState
    // Actually, we can just check if data is null or project matches
    
    fetch(`/stats?cwd=${encodeURIComponent(currentProject)}&t=${Date.now()}`)
      .then(res => res.json())
      .then(d => {
        if (active) {
          setData(d);
          setLoading(false);
        }
      })
      .catch(err => {
        console.error('Stats fetch failed:', err);
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [currentProject]);

  // Handle loading state reset when project changes without triggering lint
  const [prevProject, setPrevProject] = useState(currentProject);
  if (currentProject !== prevProject) {
    setPrevProject(currentProject);
    setLoading(true);
  }

  if (loading) return (
    <div className="p-20 text-center flex flex-col items-center justify-center gap-4">
      <div className="w-10 h-10 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin" />
      <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">Crunching Analytics...</p>
    </div>
  );

  if (!data) return null;

  const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6'];

  const handleExport = () => {
    if (!data) return;
    try {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `orchestra-analytics-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Intelligence data exported to JSON");
    } catch (err) {
      toast.error("Failed to export data");
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8 pb-20"
    >
      <div className="flex justify-between items-center px-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Run Intelligence</h2>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Cost & Performance Analytics</p>
        </div>
        <button
          onClick={handleExport}
          className="px-6 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:border-indigo-600 hover:text-indigo-600 transition-all flex items-center gap-2 shadow-sm"
        >
          <Download size={14} />
          Export Intelligence
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard 
          title="Project Total Burn" 
          value={`${data.totalProjectCost.toFixed(2)} units`} 
          icon={LayoutDashboard} 
          color="bg-indigo-50 text-indigo-600" 
          subvalue="Lifetime usage for this workspace"
        />
        <StatCard 
          title="Avg. Stage Latency" 
          value={`${(data.avgDurationByStage.reduce((a, b) => a + b.avgMs, 0) / (data.avgDurationByStage.length || 1) / 1000).toFixed(1)}s`} 
          icon={Clock} 
          color="bg-emerald-50 text-emerald-600" 
        />
        <StatCard 
          title="Success Rate" 
          value={`${((1 - (data.failuresByClass.reduce((a, b) => a + b.count, 0) / 50)) * 100).toFixed(0)}%`} 
          icon={TrendingUp} 
          color="bg-blue-50 text-blue-600" 
          subvalue="Based on last 50 runs"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Cost Over Time */}
        <section className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
          <h3 className="text-sm font-black mb-6 flex items-center gap-3 uppercase tracking-tight text-slate-900">
            <TrendingUp size={18} className="text-indigo-500" />
            Cost Trend (Units)
          </h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.costByDay}>
                <defs>
                  <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis 
                  dataKey="date" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
                  tickFormatter={(val) => val.split('-').slice(1).join('/')}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
                />
                <Tooltip 
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
                />
                <Area type="monotone" dataKey="cost" stroke="#6366f1" strokeWidth={3} fillOpacity={1} fill="url(#colorCost)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Failures by Class */}
        <section className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
          <h3 className="text-sm font-black mb-6 flex items-center gap-3 uppercase tracking-tight text-slate-900">
            <PieIcon size={18} className="text-rose-500" />
            Failure Distribution
          </h3>
          <div className="h-[300px] w-full flex items-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.failuresByClass}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="count"
                >
                  {data.failuresByClass.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="w-1/2 space-y-2">
              {data.failuresByClass.map((entry, index) => (
                <div key={entry.name} className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                  <span className="text-[10px] font-black uppercase tracking-tight text-slate-600 truncate flex-1">{entry.name.replace(/_/g, ' ')}</span>
                  <span className="text-xs font-bold text-slate-900">{entry.count}</span>
                </div>
              ))}
              {data.failuresByClass.length === 0 && <p className="text-xs font-bold text-slate-400 italic">No failures recorded.</p>}
            </div>
          </div>
        </section>

        {/* Avg Duration by Stage */}
        <section className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm lg:col-span-2">
          <h3 className="text-sm font-black mb-6 flex items-center gap-3 uppercase tracking-tight text-slate-900">
            <Clock size={18} className="text-emerald-500" />
            Average Stage Latency (ms)
          </h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.avgDurationByStage} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }} />
                <YAxis 
                  dataKey="stage" 
                  type="category" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
                  width={150}
                  tickFormatter={(val) => val.replace(/-/g, ' ').toUpperCase()}
                />
                <Tooltip 
                  cursor={{ fill: '#f8fafc' }}
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                />
                <Bar dataKey="avgMs" fill="#10b981" radius={[0, 6, 6, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
    </motion.div>
  );
};
