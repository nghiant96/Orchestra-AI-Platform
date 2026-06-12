import { AlertCircle, ArrowRight, CheckCircle2, Clock3, History, RotateCcw } from 'lucide-react';
import type { AuditEvent } from '../types/index.js';
import { cn } from '../utils/cn';

interface AuditTrailPanelProps {
  events: AuditEvent[];
  loading?: boolean;
  title?: string;
  description?: string;
  maxItems?: number;
  showDetails?: boolean;
  jobIds?: string[];
}

const actionMeta: Record<string, { label: string; icon: typeof RotateCcw; tone: string; badge: string }> = {
  'solo.undo': {
    label: 'Undo',
    icon: RotateCcw,
    tone: 'text-amber-600',
    badge: 'bg-amber-50 text-amber-700 border-amber-100'
  },
  'solo.continue': {
    label: 'Continue',
    icon: ArrowRight,
    tone: 'text-indigo-600',
    badge: 'bg-indigo-50 text-indigo-700 border-indigo-100'
  },
  'solo.commit': {
    label: 'Commit',
    icon: CheckCircle2,
    tone: 'text-emerald-600',
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-100'
  }
};

export const AuditTrailPanel = ({
  events,
  loading = false,
  title = 'Solo Audit Trail',
  description = 'Recent undo, continue, and commit events from Solo Mode.',
  maxItems = 8,
  showDetails = true,
  jobIds
}: AuditTrailPanelProps) => {
  const soloEvents = events.filter((event) => event.action.startsWith('solo.'));
  const relatedJobIds = new Set((jobIds || []).map((jobId) => jobId.trim()).filter(Boolean));
  const scopedEvents = relatedJobIds.size > 0
    ? soloEvents.filter((event) => isRelatedToJob(event, relatedJobIds))
    : soloEvents;
  const visibleEvents = scopedEvents.slice(0, maxItems);
  const counts = scopedEvents.reduce<Record<'solo.undo' | 'solo.continue' | 'solo.commit', number>>((acc, event) => {
    if (event.action === 'solo.undo') acc['solo.undo'] += 1;
    if (event.action === 'solo.continue') acc['solo.continue'] += 1;
    if (event.action === 'solo.commit') acc['solo.commit'] += 1;
    return acc;
  }, { 'solo.undo': 0, 'solo.continue': 0, 'solo.commit': 0 });

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-3 text-lg font-black uppercase tracking-tight text-slate-900">
            <History size={21} className="text-indigo-500" />
            {title}
          </h2>
          <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-slate-400">
            {description}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {(['solo.undo', 'solo.continue', 'solo.commit'] as const).map((action) => (
            <span
              key={action}
              className={cn(
                'rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest',
                actionMeta[action].badge
              )}
              >
              {actionMeta[action].label} {counts[action]}
            </span>
          ))}
          <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
            {scopedEvents.length} total
          </span>
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center">
          <p className="text-xs font-black uppercase tracking-widest text-slate-400">Loading audit history...</p>
        </div>
      ) : visibleEvents.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-300 shadow-sm">
            <AlertCircle size={20} />
          </div>
          <h3 className="text-sm font-black uppercase tracking-tight text-slate-700">No solo audit events yet</h3>
          <p className="mt-1 text-xs font-medium text-slate-400">
            {relatedJobIds.size > 0
              ? 'The selected job scope has no solo audit events yet.'
              : 'Undo, continue, and commit actions will appear here once Solo Mode is used.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleEvents.map((event) => {
            const meta = actionMeta[event.action] || {
              label: event.action,
              icon: Clock3,
              tone: 'text-slate-500',
              badge: 'bg-slate-50 text-slate-600 border-slate-200'
            };
            const Icon = meta.icon;

            return (
              <article key={event.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn(
                        'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest',
                        meta.badge
                      )}>
                        <Icon size={12} />
                        {meta.label}
                      </span>
                      <span className="rounded-full bg-white px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                        {event.actor.role} · {event.actor.id}
                      </span>
                      {event.jobId ? (
                        <span className="rounded-full bg-white px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                          {event.jobId}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm font-black uppercase tracking-tight text-slate-900">
                      {event.details?.summary ? String(event.details.summary) : event.action}
                    </p>
                    {showDetails ? (
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono text-slate-500">
                        <span>{event.cwd || 'cwd unknown'}</span>
                        <span>{formatTimestamp(event.timestamp)}</span>
                        <span>{event.id}</span>
                      </div>
                    ) : null}
                  </div>
                  <div className="min-w-0 lg:max-w-[320px]">
                    {showDetails && event.details ? (
                      <pre className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-3 text-[10px] leading-relaxed text-slate-600">
                        {formatDetails(event.details)}
                      </pre>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function isRelatedToJob(event: AuditEvent, jobIds: Set<string>): boolean {
  const details = event.details;
  if (event.jobId && jobIds.has(event.jobId)) {
    return true;
  }

  const sourceJobId = typeof details?.sourceJobId === 'string' ? details.sourceJobId : null;
  const targetJobId = typeof details?.targetJobId === 'string' ? details.targetJobId : null;

  return Boolean((sourceJobId && jobIds.has(sourceJobId)) || (targetJobId && jobIds.has(targetJobId)));
}

function formatDetails(details: Record<string, unknown>): string {
  return Object.entries(details)
    .map(([key, value]) => `${key}: ${stringifyDetailValue(value)}`)
    .join('\n');
}

function stringifyDetailValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}
