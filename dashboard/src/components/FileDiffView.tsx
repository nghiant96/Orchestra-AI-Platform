import { useState, useEffect } from 'react';
import { XCircle, FileJson } from 'lucide-react';
import { cn } from '../utils/cn';

interface FileDiffViewProps {
  jobId: string;
  path: string;
  onClose: () => void;
}

export const FileDiffView = ({ jobId, path, onClose }: FileDiffViewProps) => {
  const [original, setOriginal] = useState<string | null>(null);
  const [generated, setGenerated] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchContents = async () => {
      try {
        const [origRes, genRes] = await Promise.all([
          fetch(`/jobs/${jobId}/files/content?path=${encodeURIComponent(path)}&type=original`),
          fetch(`/jobs/${jobId}/files/content?path=${encodeURIComponent(path)}&type=generated`)
        ]);

        const origData = origRes.ok ? await origRes.json() : { ok: true, content: '' };
        const genData = await genRes.json();

        if (origData.ok) setOriginal(origData.content || '');
        if (genData.ok) setGenerated(genData.content);
        if (!genData.ok) setError(genData.error || 'Failed to load generated content');
      } catch {
        setError('Failed to fetch file contents');
      } finally {
        setLoading(false);
      }
    };
    fetchContents();
  }, [jobId, path]);

  if (loading) return <div className="py-20 text-center text-slate-400 animate-pulse font-bold uppercase tracking-widest text-xs">Decrypting Code...</div>;
  if (error) return <div className="py-20 text-center text-rose-500 font-bold text-xs uppercase tracking-widest bg-rose-50 rounded-2xl border border-rose-100">{error}</div>;

  const originalLines = original ? original.split(/\r?\n/) : [];
  const generatedLines = generated ? generated.split(/\r?\n/) : [];

  // Basic LCS-based Diff algorithm
  const computeDiff = (oldLines: string[], newLines: string[]) => {
    const n = oldLines.length;
    const m = newLines.length;
    const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));

    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        if (oldLines[i - 1] === newLines[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    const diff: { type: 'added' | 'removed' | 'unchanged', value: string, oldIdx?: number, newIdx?: number }[] = [];
    let i = n, j = m;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        diff.unshift({ type: 'unchanged', value: oldLines[i - 1], oldIdx: i, newIdx: j });
        i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        diff.unshift({ type: 'added', value: newLines[j - 1], newIdx: j });
        j--;
      } else {
        diff.unshift({ type: 'removed', value: oldLines[i - 1], oldIdx: i });
        i--;
      }
    }
    return diff;
  };

  const diff = computeDiff(originalLines, generatedLines);

  return (
    <div className="flex flex-col h-full bg-slate-900 overflow-hidden rounded-2xl border border-slate-800 shadow-2xl">
      <div className="flex items-center justify-between p-4 bg-slate-800/50 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-500/20 p-2 rounded-lg text-indigo-400">
            <FileJson size={18} />
          </div>
          <div>
            <h3 className="text-white font-bold text-sm tracking-tight">{path.split('/').pop()}</h3>
            <p className="text-slate-500 text-[10px] font-mono truncate max-w-md">{path}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white transition-colors"
        >
          <XCircle size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 font-mono text-[11px] leading-relaxed custom-scrollbar">
        <div className="min-w-full inline-block">
          {diff.map((line, idx) => (
            <div
              key={idx}
              className={cn(
                "flex group border-l-2",
                line.type === 'added' ? "bg-emerald-500/10 border-emerald-500/50" :
                line.type === 'removed' ? "bg-rose-500/10 border-rose-500/50" :
                "bg-transparent border-transparent"
              )}
            >
              <div className="w-10 shrink-0 text-right pr-3 py-0.5 text-slate-600 select-none border-r border-slate-800/50 font-bold">
                {line.oldIdx || ''}
              </div>
              <div className="w-10 shrink-0 text-right pr-3 py-0.5 text-slate-600 select-none border-r border-slate-800/50 font-bold">
                {line.newIdx || ''}
              </div>
              <div className="w-6 shrink-0 text-center py-0.5 select-none font-black text-xs">
                {line.type === 'added' ? <span className="text-emerald-500">+</span> :
                 line.type === 'removed' ? <span className="text-rose-500">-</span> :
                 <span className="text-slate-800"> </span>}
              </div>
              <pre className={cn(
                "flex-1 px-4 py-0.5 whitespace-pre",
                line.type === 'added' ? "text-emerald-400 font-bold" :
                line.type === 'removed' ? "text-rose-400 line-through opacity-70" :
                "text-slate-400"
              )}>
                {line.value || ' '}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
