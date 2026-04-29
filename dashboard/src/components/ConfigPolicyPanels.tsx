import type { Dispatch, SetStateAction } from 'react';
import { BarChart3, CheckCircle2, Layers, RefreshCw, ShieldCheck, Wrench } from 'lucide-react';
import type { ConfigFormData, SystemConfig } from '../types/index.js';
import { cn } from '../utils/cn';

interface ConfigPolicyPanelProps {
  config: SystemConfig;
  editing: boolean;
  formData: ConfigFormData;
  setFormData: Dispatch<SetStateAction<ConfigFormData>>;
}

export const ApprovalPolicyPanel = ({ config, editing, formData, setFormData }: ConfigPolicyPanelProps) => (
  <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
    <h2 className="mb-6 flex items-center gap-3 text-xl font-black">
      <ShieldCheck className="text-emerald-500" />
      Approval Policy
    </h2>
    <div className="grid grid-cols-2 gap-4">
      <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
        <p className="mb-1 text-[10px] font-bold uppercase text-slate-400">Skip Approval</p>
        {editing ? (
          <button
            type="button"
            onClick={() => setFormData({ ...formData, skip_approval: !formData.skip_approval })}
            className={cn(
              "mt-1 flex w-fit items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold transition-all",
              formData.skip_approval ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-600"
            )}
          >
            <CheckCircle2 size={14} />
            {formData.skip_approval ? "ENABLED" : "DISABLED"}
          </button>
        ) : (
          <p className={cn("text-lg font-bold", config.rules.skip_approval ? "text-emerald-600" : "text-slate-900")}>
            {config.rules.skip_approval ? 'Active' : 'Disabled'}
          </p>
        )}
      </div>
      <MetricTile label="Max Files" value={String(config.rules.max_files ?? 'No Limit')} />
      <MetricTile label="Context Limit" value={`${((config.rules.max_context_bytes || 0) / 1024).toFixed(0)} KB`} />
      <MetricTile label="Mode" value={config.rules.skip_approval ? 'Auto Run' : 'Manual Review'} />
    </div>
  </section>
);

export const BudgetPolicyPanel = ({ config, editing, formData, setFormData }: ConfigPolicyPanelProps) => (
  <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
    <h2 className="mb-6 flex items-center gap-3 text-xl font-black">
      <BarChart3 className="text-blue-500" />
      Execution Budgets
    </h2>
    <div className="grid grid-cols-2 gap-4">
      <EditableNumberTile
        label="Max Cost (Single Run)"
        value={formData.max_single_run_cost_units}
        display={String(config.rules.execution?.budgets?.max_single_run_cost_units || config.rules.execution?.budgets?.max_cost_units || 'No Limit')}
        editing={editing}
        step="0.01"
        onChange={(value) => setFormData({ ...formData, max_single_run_cost_units: value })}
      />
      <EditableNumberTile
        label="Max Cost (Daily)"
        value={formData.max_daily_cost_units}
        display={String(config.rules.execution?.budgets?.max_daily_cost_units || 'No Limit')}
        editing={editing}
        step="0.1"
        onChange={(value) => setFormData({ ...formData, max_daily_cost_units: value })}
      />
      <MetricTile
        label="Max Duration"
        value={config.rules.execution?.budgets?.max_duration_ms
          ? `${(config.rules.execution.budgets.max_duration_ms / 60000).toFixed(0)} min`
          : 'No Limit'}
      />
    </div>
  </section>
);

export const RoutingPolicyPanel = ({ config }: { config: SystemConfig }) => (
  <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
    <h2 className="mb-6 flex items-center gap-3 text-xl font-black">
      <RefreshCw className="text-amber-500" />
      Routing Configuration
    </h2>
    <div className="space-y-4">
      <StatusRow label="Routing Enabled" active={config.rules.routing?.enabled !== false} activeText="Enabled" inactiveText="Disabled" />
      <StatusRow label="Adaptive Routing" active={Boolean(config.rules.routing?.adaptive?.enabled)} activeText="Active" inactiveText="Inactive" />
    </div>
  </section>
);

export const MemoryPolicyPanel = ({ config }: { config: SystemConfig }) => (
  <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
    <h2 className="mb-6 flex items-center gap-3 text-xl font-black">
      <Layers className="text-indigo-500" />
      Memory & Context
    </h2>
    <div className="grid grid-cols-2 gap-4">
      <MetricTile label="Memory Backend" value={config.rules.memory?.backend || 'Local'} />
      <MetricTile label="Vector Search" value={config.rules.vector_search?.enabled ? 'Enabled' : 'Disabled'} />
    </div>
  </section>
);

export const ToolPolicyPanel = ({ config }: { config: SystemConfig }) => (
  <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
    <h2 className="mb-6 flex items-center gap-3 text-xl font-black">
      <Wrench className="text-slate-500" />
      Tool Policy
    </h2>
    <div className="grid grid-cols-2 gap-4">
      <MetricTile label="JSON Validation" value={config.rules.tools?.json_validation === false ? 'Disabled' : 'Enabled'} />
      <MetricTile label="Tool Checks" value={config.rules.tools?.enabled === false ? 'Disabled' : 'Enabled'} />
    </div>
  </section>
);

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
      <p className="mb-1 text-[10px] font-bold uppercase text-slate-400">{label}</p>
      <p className="text-lg font-bold capitalize text-slate-900">{value}</p>
    </div>
  );
}

function EditableNumberTile({
  label,
  value,
  display,
  editing,
  step,
  onChange
}: {
  label: string;
  value?: number;
  display: string;
  editing: boolean;
  step: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
      <p className="mb-1 text-[10px] font-bold uppercase text-slate-400">{label}</p>
      {editing ? (
        <input
          type="number"
          step={step}
          value={value ?? ''}
          onChange={(event) => onChange(parseFloat(event.target.value))}
          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm font-bold text-indigo-600 outline-none"
        />
      ) : (
        <p className="text-lg font-bold text-slate-900">{display}</p>
      )}
    </div>
  );
}

function StatusRow({ label, active, activeText, inactiveText }: { label: string; active: boolean; activeText: string; inactiveText: string }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 p-4">
      <span className="text-xs font-bold uppercase text-slate-400">{label}</span>
      <span className={cn(
        "rounded px-2 py-0.5 text-xs font-black uppercase tracking-widest",
        active ? "bg-emerald-100 text-emerald-600" : "bg-slate-200 text-slate-500"
      )}>
        {active ? activeText : inactiveText}
      </span>
    </div>
  );
}
