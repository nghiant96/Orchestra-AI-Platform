import { useState, useEffect, type FormEvent } from 'react';
import { 
  motion 
} from 'framer-motion';
import { 
  RefreshCw, 
  Settings, 
  ShieldCheck, 
  Zap, 
  Cpu, 
  BarChart3, 
  Database, 
  FileJson,
  Globe
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { StatCard } from '../ui/StatCard';
import type { SystemConfig } from '../../types';

interface ConfigViewProps {
  config: SystemConfig | null;
  onUpdate: () => void;
}

type ProviderFormMap = Record<string, { model?: string }>;

interface ConfigFormData {
  max_iterations?: number;
  profile: string;
  providers: ProviderFormMap;
}

export const ConfigView = ({ config, onUpdate }: ConfigViewProps) => {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState<ConfigFormData>({
    profile: '',
    providers: {}
  });

  useEffect(() => {
    if (config && !editing) {
      const nextData = {
        max_iterations: config.rules.max_iterations,
        profile: config.profile || '',
        providers: {
          planner: { model: config.rules.providers?.planner?.model || '' },
          reviewer: { model: config.rules.providers?.reviewer?.model || '' },
          generator: { model: config.rules.providers?.generator?.model || '' },
          fixer: { model: config.rules.providers?.fixer?.model || '' }
        }
      };
      
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormData(prev => {
        const isSame = JSON.stringify(prev) === JSON.stringify(nextData);
        return isSame ? prev : nextData;
      });
    }
  }, [config, editing]);

  if (!config) {
    return (
      <div className="bg-white rounded-3xl p-20 text-center border border-slate-200">
        <RefreshCw size={40} className="mx-auto text-slate-300 animate-spin mb-4" />
        <h3 className="text-slate-400 font-bold uppercase tracking-widest text-xs">Loading Configuration...</h3>
      </div>
    );
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      if (res.ok) {
        setEditing(false);
        onUpdate();
      } else {
        const err = await res.json();
        alert(`Error saving config: ${err.error}`);
      }
    } catch {
      alert('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const providers = Object.entries(config.rules.providers || {});

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8 pb-20"
    >
      <div className="flex items-center justify-between px-2">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
            <Settings className="text-indigo-500" />
            System Control
          </h1>
          <p className="text-slate-500 font-medium text-sm mt-1">Manage AI agents, budgets and infrastructure.</p>
        </div>
        <button 
          onClick={() => setEditing(!editing)}
          className={cn(
            "px-6 py-2.5 rounded-2xl font-black text-xs uppercase tracking-widest transition-all shadow-lg shadow-indigo-100",
            editing ? "bg-rose-500 text-white hover:bg-rose-600" : "bg-slate-900 text-white hover:bg-slate-800"
          )}
        >
          {editing ? 'Cancel Changes' : 'Configure System'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-4 space-y-6">
          <StatCard 
            title="Active Profile"
            value={config.profile || 'Default'}
            icon={ShieldCheck}
            color="bg-emerald-50 text-emerald-600"
            subvalue={config.globalProfile ? `Base: ${config.globalProfile}` : 'No global base'}
          />
          <StatCard 
            title="Max Iterations"
            value={config.rules.max_iterations || 3}
            icon={Zap}
            color="bg-amber-50 text-amber-600"
            subvalue="Loop limit per task"
          />
          <StatCard 
            title="AI Orchestrator"
            value="Active"
            icon={Cpu}
            color="bg-indigo-50 text-indigo-600"
            subvalue={`Running v${config.rules.routing?.enabled !== false ? 'Hybrid' : 'Fixed'}`}
          />
        </div>

        <div className="lg:col-span-8 space-y-8">
          <section className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
            <h2 className="text-xl font-black mb-6 flex items-center gap-3 text-slate-900">
              <Cpu className="text-indigo-500" />
              AI Providers
            </h2>
            <div className="space-y-4">
              {providers.map(([role, setup]: [string, { type?: string, model?: string }]) => (
                <div key={role} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100 group hover:border-indigo-200 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="bg-white p-2 rounded-xl border border-slate-200 shadow-sm font-bold text-[10px] uppercase text-slate-400 group-hover:text-indigo-500 transition-colors">
                      {role}
                    </div>
                    <div>
                      <p className="text-xs font-black text-slate-900 uppercase tracking-tight">{setup.type || 'N/A'}</p>
                      <p className="text-[10px] text-slate-400 font-mono">{setup.model || 'Default Model'}</p>
                    </div>
                  </div>
                  <Globe size={16} className="text-slate-200" />
                </div>
              ))}
            </div>
          </section>

          <section className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
            <h2 className="text-xl font-black mb-6 flex items-center gap-3">
              <BarChart3 className="text-blue-500" />
              Execution Budgets
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Max Cost Units</p>
                <p className="text-lg font-bold text-slate-900">{config.rules.execution?.budgets?.max_cost_units || 'No Limit'}</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Max Duration</p>
                <p className="text-lg font-bold text-slate-900">
                  {config.rules.execution?.budgets?.max_duration_ms 
                    ? `${(config.rules.execution.budgets.max_duration_ms / 60000).toFixed(0)} min` 
                    : 'No Limit'}
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>

      <section className="bg-slate-900 rounded-3xl p-8 border border-slate-800 shadow-xl overflow-hidden relative">
        <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
          <FileJson size={120} />
        </div>
        <h2 className="text-xl font-black mb-6 flex items-center gap-3 text-white">
          <Database className="text-indigo-400" />
          Raw Registry
        </h2>
        <div className="bg-slate-800/50 rounded-2xl p-6 overflow-x-auto">
          <pre className="text-xs text-indigo-300 font-mono leading-relaxed">
            {JSON.stringify(config.rules, null, 2)}
          </pre>
        </div>
      </section>

      {editing && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        >
          <motion.div 
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            className="bg-white rounded-[32px] shadow-2xl w-full max-w-xl p-10 relative overflow-hidden"
          >
             <div className="absolute top-0 right-0 p-10 opacity-5 pointer-events-none">
                <Settings size={120} />
             </div>
             
             <h2 className="text-2xl font-black text-slate-900 mb-2 uppercase tracking-tight">System Configuration</h2>
             <p className="text-slate-500 text-sm font-medium mb-8">Override core rules for the current workspace.</p>
             
             <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Profile Name</label>
                    <input 
                      type="text"
                      value={formData.profile}
                      onChange={(e) => setFormData({...formData, profile: e.target.value})}
                      className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Max Iterations</label>
                    <input 
                      type="number"
                      value={formData.max_iterations || 3}
                      onChange={(e) => setFormData({...formData, max_iterations: parseInt(e.target.value)})}
                      className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-4 pt-4 border-t border-slate-100">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Model Routing</p>
                  {['planner', 'reviewer', 'generator', 'fixer'].map(role => (
                    <div key={role} className="flex items-center gap-4">
                      <div className="w-24 text-[10px] font-black text-slate-500 uppercase">{role}</div>
                      <input 
                        type="text"
                        placeholder="Model name"
                        value={formData.providers[role]?.model || ''}
                        onChange={(e) => {
                          const providers = { ...formData.providers };
                          providers[role] = { ...providers[role], model: e.target.value };
                          setFormData({...formData, providers});
                        }}
                        className="flex-1 bg-slate-50 border border-slate-100 rounded-xl px-4 py-2 text-xs font-bold outline-none focus:bg-white focus:border-indigo-200 transition-all"
                      />
                    </div>
                  ))}
                </div>

                <div className="flex gap-4 pt-6">
                  <button 
                    type="button"
                    onClick={() => setEditing(false)}
                    className="flex-1 px-6 py-4 rounded-2xl font-black text-xs uppercase tracking-widest text-slate-500 hover:bg-slate-50 transition-all"
                  >
                    Discard
                  </button>
                  <button 
                    type="submit"
                    disabled={saving}
                    className="flex-[2] bg-indigo-600 text-white px-6 py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 flex items-center justify-center gap-2"
                  >
                    {saving ? <RefreshCw size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                    Apply Settings
                  </button>
                </div>
             </form>
          </motion.div>
        </motion.div>
      )}
    </motion.div>
  );
};
