/**
 * `realClaudeCliRunner` — the one real `execa`-backed seam every probe in this package goes through.
 *
 * @see PLAN-M7.md P1
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { realClaudeCliRunner } from '../src/process.ts';

describe('realClaudeCliRunner', () => {
  let scratchDirs: string[] = [];
  afterEach(async () => {
    for (const dir of scratchDirs) await rm(dir, { recursive: true, force: true });
    scratchDirs = [];
  });

  it('runs the real claude binary when this environment has one, and never throws either way', async () => {
    // A fresh critic round caught an earlier draft hardcoding `exitCode: 0` here — this repo's own CI
    // never installs a `claude` binary (only the unrelated `@anthropic-ai/claude-agent-sdk` library is
    // a package.json dependency anywhere), so that assertion passed only on a machine that happens to
    // have `claude` on PATH, exactly the portability gap `version.test.ts`/`auth.test.ts`'s own "real
    // environment integration" blocks (and `packages/cli/test/commands/doctor/environment.test.ts`'s
    // own `checkPackageManager` precedent) deliberately avoid. Structural-only, matching those.
    const result = await realClaudeCliRunner(['--version'], process.env as Record<string, string>);
    expect(typeof result.exitCode).toBe('number');
    if (result.exitCode === 0) expect(result.stdout.length).toBeGreaterThan(0);
  });

  it('never throws when the binary cannot be found at all -- a real spawn failure becomes exitCode: -1', async () => {
    const emptyPathDir = await mkdtemp(
      path.join(tmpdir(), 'forge-adapter-claude-code-runner-empty-path-'),
    );
    scratchDirs.push(emptyPathDir);
    const result = await realClaudeCliRunner(['--version'], { PATH: emptyPathDir });
    expect(result).toEqual({ exitCode: -1, stdout: '' });
  });
});
