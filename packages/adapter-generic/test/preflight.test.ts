/**
 * `probeBinaryVersion`/`runGenericPreflight` proven against an injected `GenericBinaryRunner`, never a
 * real spawn — `07` §7.3's own normative mandate ("MUST run `<binary> --version`, parse it, and compare
 * against a `minimumVersion` constant"). Includes a round-1 critic finding: the original version read
 * only `stdout`, misreporting a correctly-installed binary that prints its version to `stderr` as
 * `ADP-GENERIC-BINARY-NOT-FOUND`.
 *
 * @see specs/07 §7.3
 * @see specs/07 §7.5
 * @see PLAN-M11.md P7
 */
import { describe, expect, it } from 'vitest';

import {
  probeBinaryVersion,
  runGenericPreflight,
  type GenericBinaryRunner,
} from '../src/preflight.ts';
import { adapterYamlConfigSchema, type AdapterYamlConfig } from '../src/config/schema.ts';

function buildConfig(
  overrides: Partial<{ minimumVersion: string; versionRegex: string }> = {},
): AdapterYamlConfig {
  return adapterYamlConfigSchema.parse({
    id: 'fixture-tool',
    displayName: 'Fixture Tool',
    binary: 'fixture-tool',
    minimumVersion: overrides.minimumVersion ?? '1.4.0',
    versionRegex: overrides.versionRegex ?? 'v?(\\d+\\.\\d+\\.\\d+)',
    capabilities: {
      streaming: true,
      sessionResume: false,
      structuredOutput: false,
      toolAllowlist: true,
      cwdIsolation: true,
      costReporting: 'none',
    },
    invoke: { args: [], stdin: 'none' },
    events: { format: 'ndjson', map: [] },
    result: { successExitCodes: [0], finalTextFrom: 'lastAssistantText' },
    files: { changeDetection: 'git-status' },
  });
}

function runnerReturning(exitCode: number, stdout: string, stderr = ''): GenericBinaryRunner {
  return () => Promise.resolve({ exitCode, stdout, stderr });
}

describe('probeBinaryVersion', () => {
  it('succeeds when the version is at or above the minimum', async () => {
    const probe = await probeBinaryVersion(
      buildConfig(),
      {},
      '/tmp',
      runnerReturning(0, 'v1.4.0\n'),
    );
    expect(probe).toEqual({ ok: true, version: '1.4.0' });
  });

  it('fails when the installed version is below the minimum, but still reports it', async () => {
    const probe = await probeBinaryVersion(
      buildConfig(),
      {},
      '/tmp',
      runnerReturning(0, 'v1.3.9\n'),
    );
    expect(probe).toEqual({ ok: false, version: '1.3.9' });
  });

  it('reads the version from stderr when stdout is empty (round-1 critic finding)', async () => {
    const probe = await probeBinaryVersion(
      buildConfig(),
      {},
      '/tmp',
      runnerReturning(0, '', 'v2.0.0\n'),
    );
    expect(probe).toEqual({ ok: true, version: '2.0.0' });
  });

  it('prefers stdout over stderr when both carry a match', async () => {
    const probe = await probeBinaryVersion(
      buildConfig(),
      {},
      '/tmp',
      runnerReturning(0, 'v1.4.0\n', 'v9.9.9\n'),
    );
    expect(probe.version).toBe('1.4.0');
  });

  it('fails (no version) on a non-zero exit', async () => {
    const probe = await probeBinaryVersion(buildConfig(), {}, '/tmp', runnerReturning(1, ''));
    expect(probe).toEqual({ ok: false });
  });

  it('fails (no version) when neither stream matches versionRegex', async () => {
    const probe = await probeBinaryVersion(
      buildConfig(),
      {},
      '/tmp',
      runnerReturning(0, 'no version here'),
    );
    expect(probe).toEqual({ ok: false });
  });

  it('fails cleanly on an unparseable versionRegex, never throws', async () => {
    const probe = await probeBinaryVersion(
      buildConfig({ versionRegex: '(unterminated' }),
      {},
      '/tmp',
      runnerReturning(0, 'v1.4.0'),
    );
    expect(probe).toEqual({ ok: false });
  });
});

describe('runGenericPreflight', () => {
  it('reports ADP-GENERIC-BINARY-NOT-FOUND with no version', async () => {
    const result = await runGenericPreflight(
      { projectRoot: '/tmp', env: {} },
      buildConfig(),
      runnerReturning(1, ''),
    );
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.code).toBe('ADP-GENERIC-BINARY-NOT-FOUND');
  });

  it('reports ADP-GENERIC-BINARY-OUTDATED naming the real installed version', async () => {
    const result = await runGenericPreflight(
      { projectRoot: '/tmp', env: {} },
      buildConfig(),
      runnerReturning(0, 'v1.0.0\n'),
    );
    expect(result.ok).toBe(false);
    expect(result.version).toBe('1.0.0');
    expect(result.issues[0]?.code).toBe('ADP-GENERIC-BINARY-OUTDATED');
    expect(result.issues[0]?.message).toContain('1.0.0');
  });

  it('reports ok with no issues for a compatible binary', async () => {
    const result = await runGenericPreflight(
      { projectRoot: '/tmp', env: {} },
      buildConfig(),
      runnerReturning(0, 'v1.4.0\n'),
    );
    expect(result).toEqual({ ok: true, version: '1.4.0', issues: [] });
  });
});
