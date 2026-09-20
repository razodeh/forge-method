/**
 * `forge init` reports its model-tier findings on the real command line — `PLAN-M13.md` P5b
 * (`SPEC-QUESTIONS.md` Q204). The unit tests prove what `backfillTierMap`/`formatUnmappedTierWarnings`
 * return; this file proves `bin.ts` actually prints them (and only in plain mode), through a real
 * subprocess, so deleting the reporting block or dropping its `--json` gate fails a test.
 *
 * Re-init is the path used because it needs no live platform CLI (no `preflight()` runs), and it is
 * where a recorded adapter can be unavailable or a tier entry misshapen — the two cases that must be
 * *said* rather than silently skipped.
 *
 * @see specs/03 §3.3
 * @see specs/03 §3.5
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';
import { KNOWN_ADAPTER_MODULES } from '@forge/adapter-kit/registry';

const LAUNCHER = fileURLToPath(new URL('../bin/forge.mjs', import.meta.url));

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function projectWithConfig(configYaml: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-cli-bin-init-tiers-'));
  dirs.push(dir);
  await mkdir(path.join(dir, '.forge'), { recursive: true });
  await writeFile(path.join(dir, '.forge/config.yaml'), configYaml, 'utf8');
  return dir;
}

function reinit(dir: string, extra: readonly string[] = []): { status: number; stdout: string } {
  try {
    const stdout = execFileSync(
      process.execPath,
      [LAUNCHER, 'init', dir, '--name', 'Tier Report', '--yes', ...extra],
      { encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'], env: process.env },
    );
    return { status: 0, stdout };
  } catch (error) {
    const failure = error as { status: number | null; stdout: string };
    return { status: failure.status ?? 1, stdout: failure.stdout };
  }
}

describe('forge init prints its model-tier findings', () => {
  it('says so, exiting 0, when the recorded platform has no adapter available to check its tiers', async () => {
    const dir = await projectWithConfig('platform:\n  primary: not-an-installed-adapter\n');
    const { status, stdout } = reinit(dir);
    expect(status).toBe(0);
    expect(stdout).toContain('forge init: warning:');
    expect(stdout).toContain('"not-an-installed-adapter"');
  });

  it('with --json, stdout is still exactly one JSON line carrying the notes (the plain-text warning is gated off)', async () => {
    const dir = await projectWithConfig('platform:\n  primary: not-an-installed-adapter\n');
    const { status, stdout } = reinit(dir, ['--json', '--on-conflict', 'keep-mine']);
    expect(status).toBe(0);
    const lines = stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? '') as {
      result: { kind: string; modelTierNotes: string[] };
    };
    expect(parsed.result.kind).toBe('reinitialized');
    expect(parsed.result.modelTierNotes).toHaveLength(1);
    expect(stdout).not.toContain('forge init: warning:');
  });

  it('names still-unmapped tiers with the remedy, and leaves the misshapen entry alone', async () => {
    const adapterId = KNOWN_ADAPTER_MODULES[0]?.id;
    if (adapterId === undefined) throw new Error('no adapter module is registered');
    const configPath = (d: string): string => path.join(d, '.forge/config.yaml');
    const original = `platform:\n  primary: ${adapterId}\nmodels:\n  tiers:\n    frugal: just-a-string\n`;
    const dir = await projectWithConfig(original);
    const { status, stdout } = reinit(dir);
    expect(status).toBe(0);
    expect(stdout).toContain('model tier(s) frugal');
    expect(stdout).toContain('RUN-078');
    expect(stdout).toContain(`models.tiers.<tier>.${adapterId}`);
    // The other two tiers were filled; the misshapen one was not touched.
    const after = await readFile(configPath(dir), 'utf8');
    expect(after).toContain('frugal: just-a-string');
    expect(after).toContain('balanced:');
  });

  it('prints nothing about tiers when every tier is mapped', async () => {
    const adapterId = KNOWN_ADAPTER_MODULES[0]?.id;
    if (adapterId === undefined) throw new Error('no adapter module is registered');
    const dir = await projectWithConfig(`platform:\n  primary: ${adapterId}\n`);
    const { status, stdout } = reinit(dir);
    expect(status).toBe(0);
    expect(stdout).not.toContain('model tier(s)');
    expect(stdout).not.toContain('forge init: warning:');
  });
});
