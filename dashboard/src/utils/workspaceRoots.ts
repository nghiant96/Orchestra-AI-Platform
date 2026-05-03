export function normalizeWorkspacePath(path: string): string {
  if (!path) return '';
  if (path === '/') return '/';
  return path.replace(/\/+$/, '');
}

export function isWorkspacePathWithinRoot(path: string, root: string): boolean {
  const normalizedPath = normalizeWorkspacePath(path);
  const normalizedRoot = normalizeWorkspacePath(root);
  if (!normalizedPath || !normalizedRoot) return false;
  return (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(`${normalizedRoot}/`)
  );
}

export function resolveSafeWorkspacePath(
  preferredPath: string,
  allowedWorkdirs: string[],
  fallbackPath: string,
): string {
  const normalizedPreferredPath = normalizeWorkspacePath(preferredPath);
  const normalizedFallbackPath = normalizeWorkspacePath(fallbackPath);
  const normalizedAllowedRoots = allowedWorkdirs
    .map(normalizeWorkspacePath)
    .filter(Boolean);

  if (!normalizedAllowedRoots.length) {
    return normalizedPreferredPath || normalizedFallbackPath;
  }

  if (normalizedPreferredPath) {
    const allowedMatch = normalizedAllowedRoots.find((root) =>
      isWorkspacePathWithinRoot(normalizedPreferredPath, root),
    );
    if (allowedMatch) {
      return normalizedPreferredPath;
    }
  }

  if (normalizedFallbackPath) {
    const fallbackMatch = normalizedAllowedRoots.find((root) =>
      isWorkspacePathWithinRoot(normalizedFallbackPath, root),
    );
    if (fallbackMatch) {
      return normalizedFallbackPath;
    }
  }

  return normalizedAllowedRoots[0] || normalizedFallbackPath || normalizedPreferredPath;
}
