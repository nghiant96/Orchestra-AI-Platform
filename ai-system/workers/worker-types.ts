export type WorkerStatus = "online" | "idle" | "busy" | "draining" | "disabled" | "offline";

export interface WorkerCapabilities {
  xcode?: boolean;
  androidSdk?: boolean;
  docker?: boolean;
  codex?: boolean;
  claude?: boolean;
  antigravity?: boolean;
  node?: boolean;
  pnpm?: boolean;
}

export interface Worker {
  id: string;
  name: string;
  version: string;
  os: string;
  arch: string;
  labels: string[];
  capabilities: WorkerCapabilities;
  workspaceRoots: string[];
  status: WorkerStatus;
  currentJobId?: string;
  lastHeartbeatAt: string;
  freeDiskGb?: number;
  cpuLoad?: number;
  sessionToken?: string;
  createdAt: string;
}
