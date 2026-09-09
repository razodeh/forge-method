/**
 * `runPreflight` — `07` §7.2's own `preflight(ctx)`, made real: turns P1's `probeCliVersion`/
 * `probeAuthAvailability` into typed `PreflightIssue`s naming the exact remedy.
 *
 * @see specs/07 §7.2
 * @see specs/07 §7.3
 * @see PLAN-M7.md P4
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { claudeCodeAdapterConfigSchema } from '../src/config.ts';
import { runPreflight } from '../src/preflight.ts';

describe('runPreflight', () => {
  let scratchDirs: string[] = [];
  afterEach(async () => {
    for (const dir of scratchDirs) await rm(dir, { recursive: true, force: true });
    scratchDirs = [];
  });

  async function emptyPathDir(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-adapter-claude-code-preflight-'));
    scratchDirs.push(dir);
    return dir;
  }

  it('bare mode, no claude binary, no ANTHROPIC_API_KEY: ok:false with two distinct, correctly-worded issues', async () => {
    const dir = await emptyPathDir();
    const result = await runPreflight(
      { projectRoot: dir, env: { PATH: dir } },
      claudeCodeAdapterConfigSchema.parse({ bare: true }),
    );
    expect(result.ok).toBe(false);
    expect(result.version).toBeUndefined();
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain('ADP-CLAUDE-CODE-NOT-FOUND');
    expect(codes).toContain('ADP-CLAUDE-CODE-NO-API-KEY');
    expect(result.issues).toHaveLength(2);
    for (const issue of result.issues) {
      expect(issue.message.length).toBeGreaterThan(0);
      expect(issue.remedy.length).toBeGreaterThan(0);
    }
  });

  it('non-bare mode: the credential issue names the broader ADP-CLAUDE-CODE-NO-CREDENTIAL remedy, not the bare-only one', async () => {
    const dir = await emptyPathDir();
    const result = await runPreflight(
      { projectRoot: dir, env: { PATH: dir } },
      claudeCodeAdapterConfigSchema.parse({ bare: false }),
    );
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain('ADP-CLAUDE-CODE-NO-CREDENTIAL');
    expect(codes).not.toContain('ADP-CLAUDE-CODE-NO-API-KEY');
  });

  it('bare mode with ANTHROPIC_API_KEY set: the credential issue disappears, even though the binary is still missing', async () => {
    const dir = await emptyPathDir();
    const result = await runPreflight(
      { projectRoot: dir, env: { PATH: dir, ANTHROPIC_API_KEY: 'sk-ant-fixture' } },
      claudeCodeAdapterConfigSchema.parse({ bare: true }),
    );
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toEqual(['ADP-CLAUDE-CODE-NOT-FOUND']);
  });

  it('against this real environment, returns a structurally honest PreflightResult (never throws)', async () => {
    // runPreflight has no runner-injection seam of its own (it always calls probeCliVersion/
    // probeAuthAvailability with their real default runner, mirroring version.test.ts's/auth.test.ts's
    // own "real environment integration" blocks) -- this environment's own real claude install may or
    // may not be below MINIMUM_CLAUDE_CLI_VERSION and may or may not be authenticated, so only the
    // shape is asserted, not a specific outcome (the P1 critic's own already-recorded lesson: a
    // hardcoded expectation here would break in CI, where no claude binary is installed at all).
    const result = await runPreflight(
      { projectRoot: process.cwd(), env: process.env as Record<string, string> },
      claudeCodeAdapterConfigSchema.parse({}),
    );
    expect(typeof result.ok).toBe('boolean');
    expect(Array.isArray(result.issues)).toBe(true);
  });
});
