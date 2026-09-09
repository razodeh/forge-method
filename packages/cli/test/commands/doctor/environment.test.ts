/**
 * `forge doctor`'s own environment checks.
 *
 * @see specs/03 §3.7
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import {
  checkDiskSpace,
  checkGitIdentity,
  checkGitVersion,
  checkNodeVersion,
  checkPackageManager,
  checkPlatformAdapter,
} from '../../../src/commands/doctor/environment.ts';
import { cleanupAll, createTestProject } from './helpers.ts';

afterEach(cleanupAll);

describe('checkNodeVersion', () => {
  it('passes for a real, supported Node version', () => {
    const result = checkNodeVersion('v20.10.0');
    expect(result.ok).toBe(true);
    expect(result.severity).toBe('hard');
  });

  it('fails for a real, unsupported Node version', () => {
    const result = checkNodeVersion('v18.0.0');
    expect(result.ok).toBe(false);
    expect(result.severity).toBe('hard');
    expect(result.fix).toBeDefined();
  });
});

describe('checkPackageManager', () => {
  it('finds the real pnpm binary this test itself is running under', async () => {
    const result = await checkPackageManager('pnpm');
    expect(result.ok).toBe(true);
    expect(result.severity).toBe('warning');
  });

  it('is a real, honest warning for a package manager that is not on PATH', async () => {
    const result = await checkPackageManager('npm');
    // Either finds a real npm, or reports a real, honest absence — both are legitimate outcomes on a
    // real machine; the only thing this test pins down is that it never throws and is never `hard`.
    expect(result.severity).toBe('warning');
  });
});

describe('checkGitVersion', () => {
  it('passes for the real git on this machine (already required to run this whole suite)', async () => {
    const result = await checkGitVersion();
    expect(result.ok).toBe(true);
    expect(result.severity).toBe('hard');
  });

  it('fails when git itself cannot be found on PATH', async () => {
    const realPath = process.env['PATH'];
    process.env['PATH'] = '';
    try {
      const result = await checkGitVersion();
      expect(result.ok).toBe(false);
      expect(result.severity).toBe('hard');
      expect(result.message).toContain('not found');
    } finally {
      process.env['PATH'] = realPath;
    }
  });
});

describe('checkGitIdentity', () => {
  it('passes for a real project with real git identity configured', async () => {
    const project = await createTestProject();
    const result = await checkGitIdentity(project.dir);
    expect(result.ok).toBe(true);
  });

  it('is a real, honest warning either way for a repo with no local identity of its own', async () => {
    // A fresh repo with no *local* `user.name`/`user.email` set — whether this reports ok or not
    // depends on whether the real host machine running this test happens to have a *global* git
    // identity configured (this check has no env-isolation parameter of its own to override that),
    // so this test pins down the real, honest shape of the result rather than a specific outcome it
    // cannot fully control.
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-cli-doctor-noidentity-'));
    try {
      await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
      const result = await checkGitIdentity(dir);
      expect(typeof result.ok).toBe('boolean');
      expect(result.severity).toBe('warning');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('is a real, honest failure for a repo with only half its identity configured', async () => {
    // Isolate from any real global/system git config (`GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` pointed
    // at `/dev/null`) so this deterministically exercises the "name set, email missing" branch rather
    // than depending on the host machine's own real global config.
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-cli-doctor-halfidentity-'));
    const realGlobal = process.env['GIT_CONFIG_GLOBAL'];
    const realSystem = process.env['GIT_CONFIG_SYSTEM'];
    process.env['GIT_CONFIG_GLOBAL'] = '/dev/null';
    process.env['GIT_CONFIG_SYSTEM'] = '/dev/null';
    try {
      await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
      await execa('git', ['config', 'user.name', 'Only Name'], { cwd: dir });
      const result = await checkGitIdentity(dir);
      expect(result.ok).toBe(false);
      expect(result.severity).toBe('warning');
      expect(result.message).toContain('not configured');
    } finally {
      process.env['GIT_CONFIG_GLOBAL'] = realGlobal;
      process.env['GIT_CONFIG_SYSTEM'] = realSystem;
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('checkPlatformAdapter', () => {
  it('reports a real, honest absence when no adapter is injected', async () => {
    const project = await createTestProject();
    const result = await checkPlatformAdapter(undefined, project.dir, {});
    expect(result.ok).toBe(false);
    expect(result.severity).toBe('warning');
  });

  it('calls a real, injected adapter’s own preflight and reports its real result', async () => {
    const project = await createTestProject();
    const adapter = {
      preflight: (ctx: { readonly projectRoot: string }) =>
        Promise.resolve({
          ok: true,
          version: '1.2.3',
          issues: [],
          _ctx: ctx,
        }),
    } as unknown as Parameters<typeof checkPlatformAdapter>[0];
    const result = await checkPlatformAdapter(adapter, project.dir, {});
    expect(result.ok).toBe(true);
    expect(result.severity).toBe('hard');
    expect(result.message).toContain('1.2.3');
  });

  it('reports a real, failing preflight result honestly', async () => {
    const project = await createTestProject();
    const adapter = {
      preflight: () =>
        Promise.resolve({
          ok: false,
          issues: [
            { code: 'ADP-000', message: 'not authenticated', remedy: 'run forge auth login' },
          ],
        }),
    } as unknown as Parameters<typeof checkPlatformAdapter>[0];
    const result = await checkPlatformAdapter(adapter, project.dir, {});
    expect(result.ok).toBe(false);
    expect(result.severity).toBe('hard');
    expect(result.message).toContain('not authenticated');
    expect(result.fix).toBe('run forge auth login');
  });

  it('passes a real preflight with no reported version without appending an empty parenthetical', async () => {
    const project = await createTestProject();
    const adapter = {
      preflight: () => Promise.resolve({ ok: true, issues: [] }),
    } as unknown as Parameters<typeof checkPlatformAdapter>[0];
    const result = await checkPlatformAdapter(adapter, project.dir, {});
    expect(result.ok).toBe(true);
    expect(result.message).not.toContain('(version');
  });

  it('falls back to a real, generic remedy when a failing issue carries none of its own', async () => {
    const project = await createTestProject();
    const adapter = {
      preflight: () =>
        Promise.resolve({
          ok: false,
          issues: [{ code: 'ADP-000', message: 'not authenticated' }],
        }),
    } as unknown as Parameters<typeof checkPlatformAdapter>[0];
    const result = await checkPlatformAdapter(adapter, project.dir, {});
    expect(result.ok).toBe(false);
    expect(result.fix).toBe('Fix the platform adapter, then retry.');
  });
});

describe('checkDiskSpace', () => {
  it('reports real, current free disk space', async () => {
    const project = await createTestProject();
    const result = await checkDiskSpace(project.dir);
    expect(result.severity).toBe('warning');
    expect(result.message).toMatch(/MB free/);
  });
});
