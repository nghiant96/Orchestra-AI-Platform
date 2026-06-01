import { FileJson, FolderOpen, ShieldCheck } from "lucide-react";
import type { Job } from "../types/index.js";

export function ArtifactViewer({ job }: { job: Job }) {
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
