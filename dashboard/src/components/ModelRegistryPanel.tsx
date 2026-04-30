import { useState } from 'react';
import { Layers, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface ModelRegistryPanelProps {
  modelAliases: string[];
  setModelAliases: (aliases: string[]) => void;
}

export const ModelRegistryPanel = ({ modelAliases, setModelAliases }: ModelRegistryPanelProps) => {
  const [newAlias, setNewAlias] = useState('');

  const persistAliases = (aliases: string[]) => {
    setModelAliases(aliases);
    localStorage.setItem('orchestra_model_aliases', JSON.stringify(aliases));
  };

  const addAlias = () => {
    const trimmed = newAlias.trim();
    if (trimmed && !modelAliases.includes(trimmed)) {
      persistAliases([trimmed, ...modelAliases]);
      setNewAlias('');
      toast.success(`Added model: ${trimmed}`);
    }
  };

  const removeAlias = (alias: string) => {
    persistAliases(modelAliases.filter(item => item !== alias));
  };

  return (
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
  );
};
