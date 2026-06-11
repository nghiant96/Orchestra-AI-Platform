import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FileJson, FolderOpen, ShieldCheck } from "lucide-react";
import { apiJson } from "../utils/api";
import type { Job } from "../types/index.js";

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

const WORKER_ARTIFACTS = [
  "context/context-pack.md",
  "guards/diff-boundary-check.json",
  "guards/naming-check.json",
  "context/repo-conventions.json",
  "verification/verification.json"
];

export function ArtifactViewer({ job }: { job: Job }) {
  const [artifactState, setArtifactState] = useState<{ jobId: string; artifacts: LoadedArtifact[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!job.artifactPath) {
      return;
    }

    void Promise.allSettled(
      WORKER_ARTIFACTS.map(async (name) => {
        const result = await apiJson<ArtifactContentResponse>(`/jobs/${job.jobId}/artifacts/content?name=${encodeURIComponent(name)}`);
        return result.ok && result.content ? { name, content: result.content } : null;
      })
    ).then((results) => {
      if (cancelled) return;
      setArtifactState({
        jobId: job.jobId,
        artifacts: results
          .map((result) => result.status === "fulfilled" ? result.value : null)
          .filter((value): value is LoadedArtifact => Boolean(value))
      });
    });

    return () => {
      cancelled = true;
    };
  }, [job.artifactPath, job.jobId]);

  const artifacts = useMemo(
    () => artifactState?.jobId === job.jobId ? artifactState.artifacts : [],
    [artifactState, job.jobId]
  );
  const artifactMap = useMemo(() => new Map(artifacts.map((artifact) => [artifact.name, artifact.content])), [artifacts]);
  const contextPack = artifactMap.get("context/context-pack.md");
  const boundaryCheck = parseArtifactJson(artifactMap.get("guards/diff-boundary-check.json"));
  const namingCheck = parseArtifactJson(artifactMap.get("guards/naming-check.json"));
  const verification = parseArtifactJson(artifactMap.get("verification/verification.json"));

  if (!job.artifactPath && !job.approvalArtifact) {
    return null;
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400">
        <FolderOpen size={14} />
        Artifact References
      </h3>
      <div className="space-y-3 text-xs">
        {job.artifactPath && (
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="mb-1 flex items-center gap-2 font-black uppercase tracking-wider text-slate-500">
              <FileJson size={14} />
              Run Artifact
            </p>
            <p className="break-all font-mono text-slate-700">{job.artifactPath}</p>
          </div>
        )}
        {artifacts.length > 0 && (
          <div className="grid gap-3">
            <GuardArtifactSummary
              title="Diff Boundary"
              payload={boundaryCheck}
              okPath="ok"
              emptyText="No boundary check artifact yet."
            />
            <GuardArtifactSummary
              title="Naming Guard"
              payload={namingCheck}
              okPath="ok"
              emptyText="No naming check artifact yet."
            />
            <GuardArtifactSummary
              title="Verification"
              payload={verification}
              okPath="status"
              emptyText="No verification artifact yet."
            />
            {contextPack && (
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
                <p className="mb-2 flex items-center gap-2 font-black uppercase tracking-wider text-indigo-700">
                  <FileJson size={14} />
                  Context Pack
                </p>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-white/80 p-3 font-mono text-[10px] leading-relaxed text-slate-700">
                  {contextPack}
                </pre>
              </div>
            )}
          </div>
        )}
        {job.approvalArtifact && (
          <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
            <p className="mb-1 flex items-center gap-2 font-black uppercase tracking-wider text-amber-700">
              <ShieldCheck size={14} />
              Approval Binding
            </p>
            <div className="grid gap-1 font-mono text-amber-900">
              <span>{job.approvalArtifact.artifactId}</span>
              <span className="break-all">sha256:{job.approvalArtifact.artifactHash}</span>
              <span>{job.approvalArtifact.artifactType} · {job.approvalArtifact.createdAt}</span>
            </div>
          </div>
        )}
      </div>
    </section>
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
