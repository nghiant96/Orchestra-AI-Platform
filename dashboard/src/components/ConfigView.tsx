import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  RefreshCw,
  Settings,
  ShieldCheck,
  Globe,
  Layers,
  Zap,
  Cpu,
  BarChart3,
  Database,
  FileJson,
  Layout
} from 'lucide-react';
import { cn } from '../utils/cn';
import type { SystemConfig, ConfigFormData } from '../types';
import { StatCard } from './StatCard';

interface ConfigViewProps {
  config: SystemConfig | null;
  onUpdate: () => void;
}

function createConfigFormData(config: SystemConfig): ConfigFormData {
  return {
    max_iterations: config.rules.max_iterations,
    max_daily_cost_units: config.rules.execution?.budgets?.max_daily_cost_units,
    max_single_run_cost_units: config.rules.execution?.budgets?.max_single_run_cost_units,
    profile: config.profile || '',
    providers: {
      planner: { model: config.rules.providers?.planner?.model || '' },
      reviewer: { model: config.rules.providers?.reviewer?.model || '' },
      generator: { model: config.rules.providers?.generator?.model || '' },
      fixer: { model: config.rules.providers?.fixer?.model || '' }
    }
  };
}

export const ConfigView = ({ config, onUpdate }: ConfigViewProps) => {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState<ConfigFormData>({
    profile: '',
    providers: {}
  });

  if (!config) {
    return (
      <div className="bg-white rounded-3xl p-20 text-center border border-slate-200">
        <RefreshCw size={40} className="mx-auto text-slate-300 animate-spin mb-4" />
        <p className="text-slate-500 font-medium">Loading system configuration...</p>
      </div>
    );
  }

  const handleSave = async () => {
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

  const startEditing = () => {
    setFormData(createConfigFormData(config));
    setEditing(true);
  };

  const providers = Object.entries(config.rules.providers || {});

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8 pb-20"
    >
      <div className="flex justify-between items-center px-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">System Registry</h2>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Global & Local Orchestration Rules</p>
        </div>
        <div className="flex gap-3">
          {editing ? (
            <>
              <button
                onClick={() => setEditing(false)}
                className="px-6 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-50 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 flex items-center gap-2"
              >
                {saving ? <RefreshCw size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                Apply Changes
              </button>
            </>
          ) : (
            <button
              onClick={startEditing}
              className="px-6 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-indigo-600 hover:border-indigo-600 transition-all flex items-center gap-2"
            >
              <Settings size={14} />
              Configure System
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition-all group">
          <div className="p-3 rounded-xl bg-blue-50 text-blue-600">
            <Globe size={24} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate">Active Profile</p>
            {editing ? (
              <select
                value={formData.profile}
                onChange={(e) => setFormData({...formData, profile: e.target.value})}
                className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-sm font-bold text-indigo-600 outline-none"
              >
                <option value="fast">Fast</option>
                <option value="balanced">Balanced</option>
                <option value="safe">Safe</option>
                <option value="hybrid">Hybrid</option>
              </select>
            ) : (
              <p className="text-xl font-bold text-slate-900 truncate uppercase">{config.profile || 'Default'}</p>
            )}
          </div>
        </div>
        <StatCard title="Global Profile" value={config.globalProfile || 'None'} icon={Layers} color="bg-indigo-50 text-indigo-600" />
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4 hover:shadow-md transition-all group">
          <div className="p-3 rounded-xl bg-amber-50 text-amber-600">
            <Zap size={24} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate">Max Iterations</p>
            {editing ? (
              <input
                type="number"
                value={formData.max_iterations}
                onChange={(e) => setFormData({...formData, max_iterations: parseInt(e.target.value)})}
                className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-sm font-bold text-indigo-600 outline-none"
              />
            ) : (
              <p className="text-xl font-bold text-slate-900 truncate">{config.rules.max_iterations}</p>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm lg:col-span-2">
          <h2 className="text-xl font-black mb-6 flex items-center gap-3">
            <Layout className="text-violet-500" />
            Discovered Plugins
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(!config.plugins || config.plugins.length === 0) ? (
              <div className="md:col-span-2 p-10 text-center bg-slate-50 rounded-3xl border border-dashed border-slate-200">
                <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">No local plugins discovered</p>
                <p className="text-[10px] text-slate-400 mt-1 font-medium">Place plugins in .ai-system/plugins/ to extend the system.</p>
              </div>
            ) : (
              config.plugins.map(plugin => (
                <div key={plugin.name} className="p-5 bg-white border border-slate-100 rounded-2xl shadow-sm hover:shadow-md transition-all flex items-start gap-4">
                  <div className={cn(
                    "p-2.5 rounded-xl shrink-0",
                    plugin.enabled ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
                  )}>
                    <Zap size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <h3 className="text-sm font-black text-slate-900 uppercase truncate">{plugin.name}</h3>
                      <span className="text-[10px] font-mono font-bold bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">v{plugin.version}</span>
                    </div>
                    <p className="text-[11px] text-slate-500 font-medium line-clamp-2 leading-relaxed mb-3">
                      {plugin.description || "No description provided."}
                    </p>
                    <div className="flex items-center gap-3">
                       <span className={cn(
                         "text-[8px] font-black uppercase px-1.5 py-0.5 rounded border",
                         plugin.enabled ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-rose-50 text-rose-600 border-rose-100"
                       )}>
                         {plugin.enabled ? "Active" : "Error"}
                       </span>
                       {plugin.error && <span className="text-[8px] text-rose-400 font-bold truncate max-w-[150px]">{plugin.error}</span>}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
          <h2 className="text-xl font-black mb-6 flex items-center gap-3 text-slate-900">
            <Cpu className="text-indigo-500" />
            AI Providers
          </h2>
          <div className="space-y-4">
            {providers.map(([role, setup]) => (
              <div key={role} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100 group hover:border-indigo-200 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="bg-white p-2 rounded-xl border border-slate-200 shadow-sm font-bold text-[10px] uppercase text-slate-400 group-hover:text-indigo-500 transition-colors">
                    {role}
                  </div>
                  <span className="text-sm font-black text-slate-800">{setup.type || 'N/A'}</span>
                </div>
                {editing ? (
                  <input
                    type="text"
                    value={formData.providers?.[role]?.model || ''}
                    placeholder="Model name..."
                    onChange={(e) => {
                      const newProviders = { ...formData.providers };
                      newProviders[role] = { ...newProviders[role], model: e.target.value };
                      setFormData({ ...formData, providers: newProviders });
                    }}
                    className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-[11px] font-mono font-bold text-indigo-600 outline-none w-40 shadow-inner"
                  />
                ) : (
                  setup.model && <span className="text-[10px] font-mono bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded font-bold">{setup.model}</span>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
          <h2 className="text-xl font-black mb-6 flex items-center gap-3">
            <ShieldCheck className="text-emerald-500" />
            System Rules
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Max Files</p>
              <p className="text-lg font-bold text-slate-900">{config.rules.max_files}</p>
            </div>
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Context Limit</p>
              <p className="text-lg font-bold text-slate-900">{((config.rules.max_context_bytes || 0) / 1024).toFixed(0)} KB</p>
            </div>
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Memory Backend</p>
              <p className="text-lg font-bold text-slate-900 capitalize">{config.rules.memory?.backend || 'Local'}</p>
            </div>
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Vector Search</p>
              <p className="text-lg font-bold text-slate-900">{config.rules.vector_search?.enabled ? 'Active' : 'Disabled'}</p>
            </div>
          </div>
        </section>

        <section className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
          <h2 className="text-xl font-black mb-6 flex items-center gap-3">
            <BarChart3 className="text-blue-500" />
            Execution Budgets
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Max Cost (Single Run)</p>
              {editing ? (
                <input
                  type="number"
                  step="0.01"
                  value={formData.max_single_run_cost_units}
                  onChange={(e) => setFormData({...formData, max_single_run_cost_units: parseFloat(e.target.value)})}
                  className="w-full mt-1 bg-white border border-slate-200 rounded-lg px-2 py-1 text-sm font-bold text-indigo-600 outline-none"
                />
              ) : (
                <p className="text-lg font-bold text-slate-900">{config.rules.execution?.budgets?.max_single_run_cost_units || config.rules.execution?.budgets?.max_cost_units || 'No Limit'}</p>
              )}
            </div>
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Max Cost (Daily)</p>
              {editing ? (
                <input
                  type="number"
                  step="0.1"
                  value={formData.max_daily_cost_units}
                  onChange={(e) => setFormData({...formData, max_daily_cost_units: parseFloat(e.target.value)})}
                  className="w-full mt-1 bg-white border border-slate-200 rounded-lg px-2 py-1 text-sm font-bold text-indigo-600 outline-none"
                />
              ) : (
                <p className="text-lg font-bold text-slate-900">{config.rules.execution?.budgets?.max_daily_cost_units || 'No Limit'}</p>
              )}
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

        <section className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
          <h2 className="text-xl font-black mb-6 flex items-center gap-3">
            <RefreshCw className="text-amber-500" />
            Routing Configuration
          </h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
               <span className="text-xs font-bold text-slate-400 uppercase">Routing Enabled</span>
               <span className={cn(
                 "text-xs font-black uppercase tracking-widest px-2 py-0.5 rounded",
                 config.rules.routing?.enabled !== false ? "bg-emerald-100 text-emerald-600" : "bg-slate-200 text-slate-500"
               )}>
                 {config.rules.routing?.enabled !== false ? 'Enabled' : 'Disabled'}
               </span>
            </div>
            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
               <span className="text-xs font-bold text-slate-400 uppercase">Adaptive Routing</span>
               <span className={cn(
                 "text-xs font-black uppercase tracking-widest px-2 py-0.5 rounded",
                 config.rules.routing?.adaptive?.enabled ? "bg-indigo-100 text-indigo-600" : "bg-slate-200 text-slate-500"
               )}>
                 {config.rules.routing?.adaptive?.enabled ? 'Active' : 'Inactive'}
               </span>
            </div>
          </div>
        </section>
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
    </motion.div>
  );
};
