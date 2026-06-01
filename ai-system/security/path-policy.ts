import path from "node:path";
import fs from "node:fs/promises";

export interface PathPolicyResult {
  allowed: boolean;
  reason?: string;
  realpath?: string;
}

export async function validatePath(
  candidate: string,
  allowedRoots: string[],
  options: { allowSymlinkEscape?: boolean } = {}
): Promise<PathPolicyResult> {
  if (allowedRoots.length === 0) {
    return { allowed: true };
  }

  let resolvedCandidate: string;
  try {
    resolvedCandidate = await fs.realpath(candidate);
  } catch {
    try {
      resolvedCandidate = path.resolve(candidate);
    } catch {
      return { allowed: false, reason: "Cannot resolve path" };
    }
  }

  for (const root of allowedRoots) {
    let resolvedRoot: string;
    try {
      resolvedRoot = await fs.realpath(root);
    } catch {
      resolvedRoot = path.resolve(root);
    }

    if (resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
      return { allowed: true, realpath: resolvedCandidate };
    }
  }

  return { allowed: false, reason: "Path is outside allowed workspace roots", realpath: resolvedCandidate };
}

export async function isPathAllowed(candidate: string, allowedRoots: string[]): Promise<boolean> {
  const result = await validatePath(candidate, allowedRoots);
  return result.allowed;
}

export function isForbiddenPath(filePath: string): boolean {
  const normalized = path.normalize(filePath).toLowerCase();
  const forbidden = [
    ".env",
    ".env.local",
    ".env.production",
    ".env.development",
    ".secrets",
    "credentials.json",
    "service-account.json",
    "id_rsa",
    "id_ed25519",
    ".npmrc",
    ".git-credentials",
    "keychain",
    "signing",
    "keystore",
    ".p12",
  ];
  const forbiddenFragments = ["signing", "keystore"];

  const segments = normalized.split(path.sep);
  for (const segment of segments) {
    for (const forbiddenName of forbidden) {
      if (segment === forbiddenName) {
        return true;
      }
    }
    for (const fragment of forbiddenFragments) {
      if (segment.includes(fragment)) {
        return true;
      }
    }
  }

  if (normalized.includes(`${path.sep}.ssh${path.sep}`)) return true;
  if (normalized.includes(`${path.sep}.aws${path.sep}`)) return true;
  if (normalized.includes(`${path.sep}.config${path.sep}gcloud${path.sep}`)) return true;

  return false;
}
