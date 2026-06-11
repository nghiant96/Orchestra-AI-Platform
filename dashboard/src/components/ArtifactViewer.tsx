import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, FileJson, FolderOpen, ShieldCheck } from "lucide-react";
import { apiJson } from "../utils/api";
import type { Job } from "../types/index.js";

interface ManifestResponse {
  ok: boolean;
  manifest?: JobManifest;
  error?: string;
}

interface ArtifactContentResponse {
  ok: boolean;
  artifactName?: string;
  content?: string;
  error?: string;
}

interface LoadedArtifact {
  name: string;
  content: string;
}

interface JobManifest {
  version?: number;
  jobId?: string;
  mode?: string;
  executionMode?: string;
  status?: string;
  task?: {
    title?: string;
    prompt?: string;
    createdAt?: string;
  };
  repo?: {
    root?: string;
    gitCommitBefore?: string;
    gitCommitAfter?: string;
    branch?: string;
    worktreePath?: string;
  };
  provider?: {
    id?: string;
    command?: string;
  };
  artifacts?: Record<string, string>;
  summary?: {
    changedFileCount?: number;
    guardStatus?: string;
    verificationStatus?: string;
  };
}

const FALLBACK_ARTIFACT_NAMES = [
  "context/context-pack.json",
  "context/context-pack.md",
  "context/pre-context-pack.json",
  "context/pre-context-pack.md",
  "context/repo-conventions.json",
  "diff/diff.patch",
  "diff/diff-stat.txt",
  "diff/changed-files.json",
  "guards/diff-boundary-check.json",
  "guards/naming-check.json",
  "verification/verification.json"
];

export function ArtifactViewer({ job, activeTab }: { job: Job; activeTab: string }) {
  const [artifactState, setArtifactState] = useState<{ jobId: string; manifest: JobManifest | null; artifacts: LoadedArtifact[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!job.artifactPath) {
      return;
    }

    void (async () => {
      const manifestResponse = await apiJson<ManifestResponse>(`/jobs/${job.jobId}/manifest`);
      const manifest = manifestResponse.ok ? manifestResponse.manifest ?? null : null;
      const artifactNames = [
        ...new Set([
          ...FALLBACK_ARTIFACT_NAMES,
          ...Object.values(manifest?.artifacts ?? {})
        ])
      ];

      const artifacts = await Promise.all(
        artifactNames.map(async (name) => {
          const result = await apiJson<ArtifactContentResponse>(`/jobs/${job.jobId}/artifacts/content?name=${encodeURIComponent(name)}`);
          return result.ok && result.content ? { name, content: result.content } : null;
        })
      );

      if (cancelled) return;
      setArtifactState({
        jobId: job.jobId,
        manifest,
        artifacts: artifacts.filter((value): value is LoadedArtifact => Boolean(value))
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [job.artifactPath, job.jobId]);

  const manifest = artifactState?.jobId === job.jobId ? artifactState.manifest : null;
  const artifacts = useMemo(
    () => artifactState?.jobId === job.jobId ? artifactState.artifacts : [],
    [artifactState, job.jobId]
  );
  const artifactMap = useMemo(() => new Map(artifacts.map((artifact) => [artifact.name, artifact.content])), [artifacts]);
  const contextPack = parseArtifactJson(artifactMap.get("context/context-pack.json"));
  const preContextPack = parseArtifactJson(artifactMap.get("context/pre-context-pack.json"));
  const boundaryCheck = parseArtifactJson(artifactMap.get("guards/diff-boundary-check.json"));
  const namingCheck = parseArtifactJson(artifactMap.get("guards/naming-check.json"));
  const verification = parseArtifactJson(artifactMap.get("verification/verification.json"));
  const changedFiles = parseArtifactJson(artifactMap.get("diff/changed-files.json"));

  if (!job.artifactPath && !job.approvalArtifact) {
    return null;
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400">
        <FolderOpen size={14} />
        Evidence
      </h3>
      <div className="space-y-3 text-xs">
        <EvidenceSummary job={job} manifest={manifest} />
        {activeTab === "overview" && (
          <div className="grid gap-3">
            <EvidenceBlock title="Manifest" icon={<FileJson size={14} />} tone="indigo">
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-xl bg-white/80 p-3 font-mono text-[10px] leading-relaxed text-slate-700">
                {formatJson(manifest)}
              </pre>
            </EvidenceBlock>
            <EvidenceBlock title="Approval Binding" icon={<ShieldCheck size={14} />} tone="amber">
              {job.approvalArtifact ? (
                <div className="grid gap-1 font-mono text-amber-900">
                  <span>{job.approvalArtifact.artifactId}</span>
                  <span className="break-all">sha256:{job.approvalArtifact.artifactHash}</span>
                  <span>{job.approvalArtifact.artifactType} · {job.approvalArtifact.createdAt}</span>
                </div>
              ) : (
                <p className="text-amber-900">No approval artifact recorded.</p>
              )}
            </EvidenceBlock>
          </div>
        )}

        {activeTab === "phases" && (
          <EvidenceBlock title="Phase Evidence" icon={<FileJson size={14} />} tone="slate">
            <div className="space-y-2">
              {job.execution?.transitions?.length ? job.execution.transitions.map((transition, index) => (
                <div key={`${transition.stage}-${index}`} className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                  <p className="font-black uppercase tracking-wider text-slate-500">{transition.stage}</p>
                  <p className="mt-1 text-slate-700">{transition.status}</p>
                  <p className="text-[10px] text-slate-400">{transition.timestamp}</p>
                </div>
              )) : <p className="text-slate-400">No phase data captured yet.</p>}
            </div>
          </EvidenceBlock>
        )}

        {activeTab === "context-pack" && (
          <div className="grid gap-3">
            <EvidenceBlock title="Pre-Context Pack" icon={<FileJson size={14} />} tone="indigo">
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-xl bg-white/80 p-3 font-mono text-[10px] leading-relaxed text-slate-700">
                {formatJson(preContextPack)}
              </pre>
            </EvidenceBlock>
            <EvidenceBlock title="Context Pack" icon={<FileJson size={14} />} tone="indigo">
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-xl bg-white/80 p-3 font-mono text-[10px] leading-relaxed text-slate-700">
                {formatJson(contextPack)}
              </pre>
            </EvidenceBlock>
          </div>
        )}

        {activeTab === "diff" && (
          <div className="grid gap-3">
            <GuardArtifactSummary title="Changed Files" payload={changedFiles} okPath="ok" emptyText="No changed-file summary yet." />
            <EvidenceBlock title="Diff Patch" icon={<FileJson size={14} />} tone="slate">
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-950 p-3 font-mono text-[10px] leading-relaxed text-slate-100">
                {artifactMap.get("diff/diff.patch") ?? "No diff patch available."}
              </pre>
            </EvidenceBlock>
            <EvidenceBlock title="Diff Stat" icon={<FileJson size={14} />} tone="slate">
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 font-mono text-[10px] leading-relaxed text-slate-700">
                {artifactMap.get("diff/diff-stat.txt") ?? "No diff stat available."}
              </pre>
            </EvidenceBlock>
          </div>
        )}

        {activeTab === "guards" && (
          <div className="grid gap-3">
            <GuardArtifactSummary title="Diff Boundary" payload={boundaryCheck} okPath="ok" emptyText="No boundary check artifact yet." />
            <GuardArtifactSummary title="Naming Guard" payload={namingCheck} okPath="ok" emptyText="No naming check artifact yet." />
          </div>
        )}

        {activeTab === "verification" && (
          <EvidenceBlock title="Verification" icon={<CheckCircle2 size={14} />} tone="emerald">
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-white/80 p-3 font-mono text-[10px] leading-relaxed text-slate-700">
              {formatJson(verification)}
            </pre>
          </EvidenceBlock>
        )}

        {activeTab === "artifacts" && (
          <EvidenceBlock title="Artifact References" icon={<FileJson size={14} />} tone="slate">
            <div className="grid gap-2 font-mono text-slate-700">
              {manifest?.artifacts ? Object.entries(manifest.artifacts).map(([key, value]) => (
                <div key={key} className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                  <p className="font-black uppercase tracking-wider text-slate-500">{key}</p>
                  <p className="break-all">{value}</p>
                </div>
              )) : (
                artifacts.length > 0
                  ? artifacts.map((artifact) => (
                    <div key={artifact.name} className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                      <p className="font-black uppercase tracking-wider text-slate-500">{artifact.name}</p>
                      <p className="break-all">Loaded artifact content</p>
                    </div>
                  ))
                  : <p className="text-slate-400">No manifest artifact references available.</p>
              )}
            </div>
          </EvidenceBlock>
        )}

        {job.approvalArtifact && activeTab !== "overview" && (
          <EvidenceBlock title="Approval Binding" icon={<ShieldCheck size={14} />} tone="amber">
            <div className="grid gap-1 font-mono text-amber-900">
              <span>{job.approvalArtifact.artifactId}</span>
              <span className="break-all">sha256:{job.approvalArtifact.artifactHash}</span>
              <span>{job.approvalArtifact.artifactType} · {job.approvalArtifact.createdAt}</span>
            </div>
          </EvidenceBlock>
        )}
      </div>
    </section>
  );
}

function EvidenceSummary({ job, manifest }: { job: Job; manifest: JobManifest | null }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
      <p className="mb-1 flex items-center gap-2 font-black uppercase tracking-wider text-slate-500">
        <FileJson size={14} />
        Run Artifact
      </p>
      <div className="grid gap-1 font-mono text-slate-700">
        <span className="break-all">{job.artifactPath ?? "(none)"}</span>
        {manifest?.status && <span>Status: {manifest.status}</span>}
        {manifest?.summary && (
          <span>
            Summary: {manifest.summary.changedFileCount ?? 0} file(s), guard={manifest.summary.guardStatus ?? "unknown"}, verification={manifest.summary.verificationStatus ?? "unknown"}
          </span>
        )}
      </div>
    </div>
  );
}

function EvidenceBlock({
  title,
  icon,
  tone,
  children
}: {
  title: string;
  icon: ReactNode;
  tone: "slate" | "indigo" | "emerald" | "amber";
  children: ReactNode;
}) {
  const palette = {
    slate: "border-slate-100 bg-slate-50 text-slate-500",
    indigo: "border-indigo-100 bg-indigo-50 text-indigo-700",
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-700",
    amber: "border-amber-100 bg-amber-50 text-amber-700"
  }[tone];

  return (
    <div className={`rounded-2xl border p-4 ${palette}`}>
      <p className="mb-2 flex items-center gap-2 font-black uppercase tracking-wider">
        {icon}
        {title}
      </p>
      {children}
    </div>
  );
}

function GuardArtifactSummary({
  title,
  payload,
  okPath,
  emptyText
}: {
  title: string;
  payload: Record<string, unknown> | null;
  okPath: "ok" | "status";
  emptyText: string;
}) {
  if (!payload) {
    return (
      <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-slate-400">
        <p className="font-black uppercase tracking-wider">{title}</p>
        <p className="mt-1">{emptyText}</p>
      </div>
    );
  }

  const ok = okPath === "ok" ? payload.ok !== false : payload.status !== "failed";
  const findings = Array.isArray(payload.findings) ? payload.findings : [];
  const failedChecks = Array.isArray(payload.failedChecks) ? payload.failedChecks : [];
  const issueCount = findings.length + failedChecks.length;

  return (
    <div className={`rounded-2xl border p-4 ${ok ? "border-emerald-100 bg-emerald-50" : "border-rose-100 bg-rose-50"}`}>
      <p className={`mb-1 flex items-center gap-2 font-black uppercase tracking-wider ${ok ? "text-emerald-700" : "text-rose-700"}`}>
        {ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
        {title}
      </p>
      <p className={ok ? "text-emerald-900" : "text-rose-900"}>
        {ok ? "No blocking issues." : "Needs attention."}
        {issueCount > 0 ? ` ${issueCount} issue(s) recorded.` : ""}
      </p>
    </div>
  );
}

function parseArtifactJson(value: string | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function formatJson(value: unknown): string {
  if (!value) {
    return "No data available.";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "Unable to format artifact.";
  }
}
