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
  Database,
  FileJson,
  Layout,
  Eye,
  EyeOff,
  Shield,
  Lock,
  Unlock,
  Gauge,
  Activity,
  Trash2
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../utils/cn';
import type { SystemConfig, ConfigFormData } from '../types';
import { StatCard } from './StatCard';
import { OperationsControl } from './OperationsControl';
import type { SystemHealth } from '../hooks/useHealth';
import {
  ApprovalPolicyPanel,
  BudgetPolicyPanel,
  MemoryPolicyPanel,
  RoutingPolicyPanel,
  ToolPolicyPanel
} from './ConfigPolicyPanels';

interface ConfigViewProps {
  config: SystemConfig | null;
  onUpdate: () => void;
  health: SystemHealth | null;
  onRefreshHealth: () => void;
}

function createConfigFormData(config: SystemConfig): ConfigFormData {
  return {
    max_iterations: config.rules.max_iterations,
    max_daily_cost_units: config.rules.execution?.budgets?.max_daily_cost_units,
    max_single_run_cost_units: config.rules.execution?.budgets?.max_single_run_cost_units,
    skip_approval: config.rules.skip_approval,
    profile: config.profile || '',
    providers: {
      planner: { model: config.rules.providers?.planner?.model || '' },
      reviewer: { model: config.rules.providers?.reviewer?.model || '' },
      generator: { model: config.rules.providers?.generator?.model || '' },
      fixer: { model: config.rules.providers?.fixer?.model || '' }
    }
  };
}

export const ConfigView = ({ config, onUpdate, health, onRefreshHealth }: ConfigViewProps) => {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  // Custom model aliases persisted in localStorage to stay up-to-date without hardcoding
  const [modelAliases, setModelAliases] = useState<string[]>(() => {
    const saved = localStorage.getItem('orchestra_model_aliases');
    if (saved) return JSON.parse(saved);
    return [
      'gemini-3.1-pro', 'gemini-3.1-flash', 'gemini-3.1-flash-lite',
      'claude-4-7-opus-latest', 'claude-4-6-sonnet-latest', 'claude-4-5-haiku-latest',
      'gpt-5.5', 'gpt-5.4-thinking', 'gpt-5.3-codex', 'gpt-5.4-mini'
    ];
  });

  const [newAlias, setNewAlias] = useState('');

  const [formData, setFormData] = useState<ConfigFormData>({
    profile: '',
    providers: {}
  });

  const addAlias = () => {
    if (newAlias && !modelAliases.includes(newAlias)) {
      const updated = [newAlias, ...modelAliases];
      setModelAliases(updated);
      localStorage.setItem('orchestra_model_aliases', JSON.stringify(updated));
      setNewAlias('');
      toast.success(`Added model: ${newAlias}`);
    }
  };

  const removeAlias = (alias: string) => {
    const updated = modelAliases.filter(a => a !== alias);
    setModelAliases(updated);
    localStorage.setItem('orchestra_model_aliases', JSON.stringify(updated));
  };

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
      {/* Operational Profile - Summary of setup modes */}
      <section className="bg-slate-900 rounded-3xl p-8 border border-slate-800 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-12 opacity-10 pointer-events-none">
          <Activity size={120} className="text-indigo-400" />
        </div>

        <h2 className="text-xl font-black mb-6 flex items-center gap-3 text-white uppercase tracking-tight">
          <Gauge className="text-indigo-400" />
          Operational Profile
        </h2>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 relative z-10">
          <div className={cn(
            "p-5 rounded-2xl border transition-all flex flex-col items-center justify-center text-center gap-3",
            config.rules.skip_approval ? "bg-amber-500/10 border-amber-500/20 text-amber-400" : "bg-indigo-500/10 border-indigo-500/20 text-indigo-400"
          )}>
            {config.rules.skip_approval ? <Unlock size={24} /> : <Lock size={24} />}
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest mb-1 opacity-60">Approval Mode</p>
              <p className="text-sm font-black uppercase">{config.rules.skip_approval ? "Auto-Pilot" : "Manual Review"}</p>
            </div>
          </div>

          <div className={cn(
            "p-5 rounded-2xl border transition-all flex flex-col items-center justify-center text-center gap-3",
            (config.rules.max_iterations || 0) <= 3 ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-rose-500/10 border-rose-500/20 text-rose-400"
          )}>
            <Shield size={24} />
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest mb-1 opacity-60">Safety Level</p>
              <p className="text-sm font-black uppercase">{(config.rules.max_iterations || 0) <= 3 ? "High Precision" : "Aggressive"}</p>
            </div>
          </div>

          <div className="p-5 rounded-2xl border bg-blue-500/10 border-blue-500/20 text-blue-400 flex flex-col items-center justify-center text-center gap-3">
            <Zap size={24} />
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest mb-1 opacity-60">Cost Guard</p>
              <p className="text-sm font-black uppercase">{config.rules.execution?.budgets?.max_daily_cost_units ? "Active Enforcement" : "Unlimited"}</p>
            </div>
          </div>

          <div className="p-5 rounded-2xl border bg-violet-500/10 border-violet-500/20 text-violet-400 flex flex-col items-center justify-center text-center gap-3">
            <Layers size={24} />
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest mb-1 opacity-60">Intelligence</p>
              <p className="text-sm font-black uppercase">{config.rules.vector_search?.enabled ? "Semantic Context" : "Standard Context"}</p>
            </div>
          </div>
        </div>
      </section>

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
                onChange={(e) => setFormData({ ...formData, profile: e.target.value })}
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
                onChange={(e) => setFormData({ ...formData, max_iterations: parseInt(e.target.value) })}
                className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-sm font-bold text-indigo-600 outline-none"
              />
            ) : (
              <p className="text-xl font-bold text-slate-900 truncate">{config.rules.max_iterations}</p>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <OperationsControl health={health} onRefresh={onRefreshHealth} />

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
                  <div className="flex gap-2">
                    <select
                      value={(() => {
                        const currentModel = formData.providers?.[role]?.model || '';
                        return modelAliases.includes(currentModel) ? currentModel : (currentModel ? 'custom' : '');
                      })()}
                      onChange={(e) => {
                        const val = e.target.value;
                        const newProviders = { ...formData.providers };
                        if (val === 'custom') {
                          const currentModel = formData.providers?.[role]?.model || '';
                          newProviders[role] = { ...newProviders[role], model: modelAliases.includes(currentModel) ? '' : currentModel };
                        } else {
                          newProviders[role] = { ...newProviders[role], model: val };
                        }
                        setFormData({ ...formData, providers: newProviders });
                      }}
                      className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] font-bold text-indigo-600 outline-none shadow-sm"
                    >
                      <option value="">Select Model...</option>
                      {modelAliases.map(alias => (
                        <option key={alias} value={alias}>{alias}</option>
                      ))}
                      <option value="custom">-- Custom Model --</option>
                    </select>

                    {(() => {
                      const currentModel = formData.providers?.[role]?.model || '';
                      return (!modelAliases.includes(currentModel) && currentModel !== '') ||
                        (document.activeElement?.parentElement?.querySelector('select')?.value === 'custom');
                    })() && (
                        <input
                          type="text"
                          value={formData.providers?.[role]?.model || ''}
                          placeholder="Enter model name..."
                          onChange={(e) => {
                            const newProviders = { ...formData.providers };
                            newProviders[role] = { ...newProviders[role], model: e.target.value };
                            setFormData({ ...formData, providers: newProviders });
                          }}
                          autoFocus
                          className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-[11px] font-mono font-bold text-indigo-600 outline-none w-40 shadow-inner"
                        />
                      )}
                  </div>
                ) : (
                  setup.model && <span className="text-[10px] font-mono bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded font-bold">{setup.model}</span>
                )}
              </div>
            ))}
          </div>
        </section>

        <ApprovalPolicyPanel config={config} editing={editing} formData={formData} setFormData={setFormData} />

        <section className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm">
          <h2 className="text-xl font-black mb-6 flex items-center gap-3">
            <Layers className="text-indigo-500" />
            Model Registry
          </h2>
          <div className="space-y-4">
            <div className="flex gap-2">
              <input
                type="text"
                value={newAlias}
                onChange={(e) => setNewAlias(e.target.value)}
                placeholder="Add new model name..."
                className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-xs font-bold outline-none focus:border-indigo-500 transition-all"
                onKeyDown={(e) => e.key === 'Enter' && addAlias()}
              />
              <button
                onClick={addAlias}
                className="px-4 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all"
              >
                Add
              </button>
            </div>
            <div className="max-h-[200px] overflow-y-auto pr-2 custom-scrollbar space-y-2">
              {modelAliases.map(alias => (
                <div key={alias} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100 group">
                  <span className="text-[11px] font-mono font-bold text-slate-600">{alias}</span>
                  <button
                    onClick={() => removeAlias(alias)}
                    className="p-1 text-slate-300 hover:text-rose-500 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>

        <BudgetPolicyPanel config={config} editing={editing} formData={formData} setFormData={setFormData} />
        <RoutingPolicyPanel config={config} />
        <MemoryPolicyPanel config={config} />
        <ToolPolicyPanel config={config} />
      </div>

      {/* Raw Registry with Blur Toggle */}
      <section className="bg-slate-900 rounded-3xl p-8 border border-slate-800 shadow-xl overflow-hidden relative min-h-[400px]">
        <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
          <FileJson size={120} />
        </div>

        <div className="flex justify-between items-center mb-6 relative z-10">
          <h2 className="text-xl font-black flex items-center gap-3 text-white uppercase tracking-tight">
            <Database className="text-indigo-400" />
            Raw Registry
          </h2>
          <button
            onClick={() => setShowRaw(!showRaw)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all border",
              showRaw
                ? "bg-slate-800 border-slate-700 text-slate-300 hover:text-white"
                : "bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-500/20 hover:bg-indigo-700"
            )}
          >
            {showRaw ? <EyeOff size={14} /> : <Eye size={14} />}
            {showRaw ? "Mờ hóa dữ liệu" : "Hiển thị chi tiết"}
          </button>
        </div>

        <div className="relative group rounded-2xl overflow-hidden">
          {!showRaw && (
            <div
              onClick={() => setShowRaw(true)}
              className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-900/40 backdrop-blur-md cursor-pointer hover:bg-slate-900/30 transition-all group"
            >
              <Lock className="text-indigo-400 mb-3 group-hover:scale-110 transition-transform" size={32} />
              <p className="text-xs font-black text-white uppercase tracking-widest">Dữ liệu hệ thống đã được mờ hóa</p>
              <p className="text-[10px] text-slate-400 mt-1 uppercase font-bold">Nhấn để giải mã cấu hình</p>
            </div>
          )}

          <div className={cn(
            "bg-slate-800/50 rounded-2xl p-6 overflow-x-auto transition-all duration-700",
            !showRaw && "grayscale"
          )}>
            <pre className="text-xs text-indigo-300 font-mono leading-relaxed">
              {JSON.stringify(config.rules, null, 2)}
            </pre>
          </div>
        </div>
      </section>
    </motion.div>
  );
};
