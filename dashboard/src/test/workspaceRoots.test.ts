import { describe, expect, it } from 'vitest';
import {
  isWorkspacePathWithinRoot,
  resolveSafeWorkspacePath,
} from '../utils/workspaceRoots';

describe('workspaceRoots', () => {
  it('accepts paths within an allowed root', () => {
    expect(isWorkspacePathWithinRoot('/Users/me/project/src', '/Users/me/project')).toBe(true);
    expect(isWorkspacePathWithinRoot('/Users/me/project', '/Users/me/project')).toBe(true);
    expect(isWorkspacePathWithinRoot('/Users/me/other', '/Users/me/project')).toBe(false);
  });

  it('falls back to an allowed workspace when the preferred path is outside roots', () => {
    expect(
      resolveSafeWorkspacePath('/tmp/stale', ['/Users/me/project'], '/Users/me/project'),
    ).toBe('/Users/me/project');
  });

  it('keeps a valid preferred path inside the allowed roots', () => {
    expect(
      resolveSafeWorkspacePath('/Users/me/project/packages/app', ['/Users/me/project'], '/Users/me/other'),
    ).toBe('/Users/me/project/packages/app');
  });
});
