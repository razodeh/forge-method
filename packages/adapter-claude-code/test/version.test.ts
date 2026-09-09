/**
 * `probeCliVersion` — `07` §7.3's own version-probing mandate.
 *
 * @see specs/07 §7.3
 * @see PLAN-M7.md P1
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { realClaudeCliRunner } from '../src/process.ts';
import { MINIMUM_CLAUDE_CLI_VERSION, probeCliVersion } from '../src/version.ts';
import type { ClaudeCliRunner } from '../src/process.ts';

function fixedRunner(exitCode: number, stdout: string): ClaudeCliRunner {
  return () => Promise.resolve({ exitCode, stdout });
}

describe('probeCliVersion — fixture-driven branch coverage', () => {
  it('is ok:true for a version above the minimum', async () => {
    const result = await probeCliVersion({}, fixedRunner(0, '2.5.10 (Claude Code)'));
    expect(result).toEqual({ ok: true, version: '2.5.10' });
  });

  it('is ok:true for a version exactly equal to the minimum', async () => {
    const result = await probeCliVersion(
      {},
      fixedRunner(0, `${MINIMUM_CLAUDE_CLI_VERSION} (Claude Code)`),
    );
    expect(result.ok).toBe(true);
  });

  it('is ok:false (but reports the real parsed version) for a version below the minimum', async () => {
    const result = await probeCliVersion({}, fixedRunner(0, '1.9.9 (Claude Code)'));
    expect(result).toEqual({ ok: false, version: '1.9.9' });
  });

  it('is ok:false with no version when the command exits non-zero', async () => {
    const result = await probeCliVersion({}, fixedRunner(1, ''));
    expect(result).toEqual({ ok: false });
  });

  it('is ok:false with no version when stdout has no parseable version at all', async () => {
    const result = await probeCliVersion({}, fixedRunner(0, 'not a version string'));
    expect(result).toEqual({ ok: false });
  });

  it('compares by numeric value, not lexicographic string order', async () => {
    // Against the real MINIMUM_CLAUDE_CLI_VERSION ("2.0.0"), a lexicographic ("10.0.0" < "2.0.0",
    // since the character "1" sorts before "2") compare would wrongly reject this real, newer major
    // version -- proving the comparison is numeric, not string, needs a double-digit component in the
    // same position a real minimum digit could otherwise shadow.
    const result = await probeCliVersion({}, fixedRunner(0, '10.0.0'));
    expect(result.ok).toBe(true);
  });
});

describe('probeCliVersion — real environment integration', () => {
  let scratchDirs: string[] = [];
  afterEach(async () => {
    for (const dir of scratchDirs) await rm(dir, { recursive: true, force: true });
    scratchDirs = [];
  });

  it('probes the real, installed claude CLI in this environment honestly (never throws)', async () => {
    const result = await probeCliVersion(process.env as Record<string, string>);
    expect(typeof result.ok).toBe('boolean');
    if (result.ok) expect(result.version).toBeDefined();
  });

  it('never throws when claude is not reachable on PATH at all -- real execa spawn failure, real ok:false', async () => {
    const emptyPathDir = await mkdtemp(
      path.join(tmpdir(), 'forge-adapter-claude-code-empty-path-'),
    );
    scratchDirs.push(emptyPathDir);
    const result = await probeCliVersion({ PATH: emptyPathDir }, realClaudeCliRunner);
    expect(result).toEqual({ ok: false });
  });
});
