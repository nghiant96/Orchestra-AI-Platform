import { useState } from 'react';
import { motion } from 'framer-motion';
import { Inbox, ExternalLink, Loader2, CheckCircle2, AlertCircle, Plus, FileCode } from 'lucide-react';
import { cn } from '../utils/cn';

interface InboxPanelProps {
    onImport?: (url: string) => Promise<void>;
    onRefresh?: () => void;
}

const examples = [
    { label: 'GitHub Issue', value: 'https://github.com/owner/repo/issues/123' },
    { label: 'GitHub PR', value: 'https://github.com/owner/repo/pull/456' },
];

export const InboxPanel = ({ onImport, onRefresh }: InboxPanelProps) => {
    const [url, setUrl] = useState('');
    const [importing, setImporting] = useState(false);
    const [lastResult, setLastResult] = useState<{ ok: boolean; message: string } | null>(null);

    const handleImport = async () => {
        const trimmed = url.trim();
        if (!trimmed) return;
        if (!isValidExternalUrl(trimmed)) {
            setLastResult({ ok: false, message: 'Enter a valid GitHub issue or PR URL' });
            return;
        }

        setImporting(true);
        setLastResult(null);
        try {
            if (onImport) {
                await onImport(trimmed);
            }
            setLastResult({ ok: true, message: 'Imported successfully' });
            setUrl('');
            onRefresh?.();
        } catch (error: any) {
            setLastResult({ ok: false, message: error.message || 'Import failed' });
        } finally {
            setImporting(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            void handleImport();
        }
    };

    return (
        <div className="space-y-6">
            <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
                <div className="flex items-center gap-3 mb-5">
                    <div className="w-10 h-10 rounded-2xl bg-violet-50 flex items-center justify-center">
                        <Inbox size={20} className="text-violet-600" />
                    </div>
                    <div>
                        <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">Import External Task</h2>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                            Paste a GitHub issue or PR link
                        </p>
                    </div>
                </div>

                <div className="flex gap-2">
                    <div className="flex-1 relative">
                        <ExternalLink size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="url"
                            placeholder="https://github.com/owner/repo/issues/123"
                            value={url}
                            onChange={(e) => {
                                setUrl(e.target.value);
                                setLastResult(null);
                            }}
                            onKeyDown={handleKeyDown}
                            className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-300 transition-all"
                            disabled={importing}
                        />
                    </div>
                    <button
                        onClick={() => void handleImport()}
                        disabled={!url.trim() || importing}
                        className={cn(
                            'flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all whitespace-nowrap',
                            url.trim() && !importing
                                ? 'bg-violet-600 text-white hover:bg-violet-700 active:scale-95'
                                : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                        )}
                    >
                        {importing ? (
                            <Loader2 size={14} className="animate-spin" />
                        ) : (
                            <Plus size={14} />
                        )}
                        Import
                    </button>
                </div>

                {/* Result feedback */}
                <AnimatePresence>
                    {lastResult && (
                        <motion.div
                            initial={{ opacity: 0, y: -8, height: 0 }}
                            animate={{ opacity: 1, y: 0, height: 'auto' }}
                            exit={{ opacity: 0, y: -8, height: 0 }}
                            className="mt-3"
                        >
                            <div className={cn(
                                'flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold',
                                lastResult.ok
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                                    : 'bg-rose-50 text-rose-700 border border-rose-100'
                            )}>
                                {lastResult.ok ? (
                                    <CheckCircle2 size={14} className="flex-shrink-0" />
                                ) : (
                                    <AlertCircle size={14} className="flex-shrink-0" />
                                )}
                                {lastResult.message}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Examples */}
                <div className="mt-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Examples</p>
                    <div className="flex flex-wrap gap-2">
                        {examples.map((example) => (
                            <button
                                key={example.label}
                                onClick={() => {
                                    setUrl(example.value);
                                    setLastResult(null);
                                }}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-[10px] font-bold text-slate-500 hover:bg-violet-50 hover:text-violet-600 transition-colors uppercase tracking-wider"
                            >
                                <FileCode size={10} />
                                {example.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-3xl border border-dashed border-slate-200 p-6">
                <div className="flex items-start gap-3">
                    <Inbox size={20} className="text-slate-300 flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="text-sm font-bold text-slate-600">How it works</p>
                        <ul className="mt-2 space-y-1.5 text-xs text-slate-500">
                            <li className="flex items-center gap-2">
                                <span className="w-1 h-1 rounded-full bg-violet-400 flex-shrink-0" />
                                Paste a GitHub issue or PR URL above
                            </li>
                            <li className="flex items-center gap-2">
                                <span className="w-1 h-1 rounded-full bg-violet-400 flex-shrink-0" />
                                The system deduplicates — skip if already imported
                            </li>
                            <li className="flex items-center gap-2">
                                <span className="w-1 h-1 rounded-full bg-violet-400 flex-shrink-0" />
                                New work items appear on the Work Board for assessment
                            </li>
                            <li className="flex items-center gap-2">
                                <span className="w-1 h-1 rounded-full bg-violet-400 flex-shrink-0" />
                                Configure a webhook for automatic import (see W9)
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

function AnimatePresence({ children }: { children: React.ReactNode }) {
    // Lightweight inline AnimatePresence since we may not have framer's version
    return <>{children}</>;
}

function isValidExternalUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return (
            (parsed.hostname === 'github.com' || parsed.hostname === 'www.github.com') &&
            /^\/([^/]+)\/([^/]+)\/(issues|pull)\/\d+/.test(parsed.pathname)
        );
    } catch {
        return false;
    }
}