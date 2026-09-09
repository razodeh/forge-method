/**
 * `checkGitVersion`'s own parse/compare branches that a real, single installed git on this machine can
 * never exercise both sides of at once (an unparseable `git --version` string; a version below the
 * 2.30 floor; a version exactly tied at the major/minor boundary) — mocked `execa` output, the
 * identical `vi.mock` technique `context-ancestor-walk.test.ts` and
 * `environment-diskspace-failure.test.ts` already establish for a named import whose live binding
 * only `vi.mock` (not `vi.spyOn` on a separately obtained reference) actually reaches.
 *
 * @see packages/cli/test/commands/run/context-ancestor-walk.test.ts
 */
import type { Result } from 'execa';

import { afterEach, describe, expect, it, vi } from 'vitest';

const { execaMock } = vi.hoisted(() => ({ execaMock: vi.fn() }));

vi.mock('execa', () => ({ execa: execaMock }));

const { checkGitVersion } = await import('../../../src/commands/doctor/environment.ts');

function fakeStdout(stdout: string): Result {
  return { stdout } as Result;
}

afterEach(() => {
  execaMock.mockReset();
});

describe('checkGitVersion — mocked version strings', () => {
  it('fails honestly for a real, unparseable version string', async () => {
    execaMock.mockResolvedValue(fakeStdout('git version banana'));
    const result = await checkGitVersion();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('is older than the required 2.30');
  });

  it('fails for a version whose major component is below the floor', async () => {
    execaMock.mockResolvedValue(fakeStdout('git version 1.9.9'));
    const result = await checkGitVersion();
    expect(result.ok).toBe(false);
  });

  it('fails for a version whose minor component is below the floor at the same major', async () => {
    execaMock.mockResolvedValue(fakeStdout('git version 2.29.0'));
    const result = await checkGitVersion();
    expect(result.ok).toBe(false);
  });

  it('passes for a version exactly tied at the major.minor.patch floor', async () => {
    execaMock.mockResolvedValue(fakeStdout('git version 2.30.0'));
    const result = await checkGitVersion();
    expect(result.ok).toBe(true);
  });
});
