/**
 * `forge evidence prune [--apply] [--keep <n>] [--json]` (`process/plans/PLAN-M16.md` P14, `18` §18.7,
 * `03` §3.2.5), invoked as a real subprocess: proves the CLI dispatch wiring itself (`bin.ts`'s new
 * `evidence` noun, `--apply`/`--keep` flag parsing, the `--json` envelope, the plain-text exit path)
 * — concerns `prune.test.ts`'s/`plan.test.ts`'s own direct, in-process calls of `runEvidencePrune`/
 * `computeProtection` cannot exercise (nothing there ever goes through `bin.ts`'s own argument parsing
 * or console output), the identical split `bin-parity-capture.test.ts` already establishes for its own
 * sibling M16 command.
 *
 * @see specs/03-cli-and-installer.md §3.2.5
 * @see specs/18-persistence-config-and-schemas.md §18.7
 * @see process/plans/PLAN-M16.md P14
 */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

const LAUNCHER = fileURLToPath(new URL('../bin/forge.mjs', import.meta.url));

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface Result {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

function forge(
  args: readonly string[],
  cwd: string,
  envOverlay: Readonly<Record<string, string>> = {},
): Result {
  try {
    const stdout = execFileSync(process.execPath, [LAUNCHER, ...args], {
      encoding: 'utf8',
      cwd,
      timeout: 60_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...envOverlay },
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status: number | null; stdout: string; stderr: string };
    return { status: e.status ?? 1, stdout: e.stdout, stderr: e.stderr };
  }
}

function mutationFrontMatter(id: string, story: string): Record<string, unknown> {
  return {
    id,
    type: 'MutationEvidence',
    schemaVersion: 1,
    title: `forge test binding — ${story}`,
    status: 'recorded',
    created: '2026-10-01',
    updated: '2026-10-01',
    revision: 1,
    author: 'engine',
    run: 'run-001',
    changelog: [],
    story,
    mutationKind: 'revert-implementation',
    revertedRange: { fromSha: 'a'.repeat(40), toSha: 'b'.repeat(40) },
    namedTests: ['adds'],
    failedUnderMutation: ['adds'],
    restoreVerified: true,
    toolVersions: { node: '20.0.0' },
    ranAt: '2026-10-01T00:00:00.000Z',
  };
}

/** A real project directory holding `count` real, schema-valid `MutationEvidence` records (`forge
 * evidence prune` needs no git repository at all — unlike `gateApprove`/`gateWaive`'s own evidence
 * resolution, nothing here reads `git ls-tree`). */
async function freshProjectWithRecords(count: number): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-p14-bin-prune-'));
  dirs.push(dir);
  const mutationDir = path.join(dir, 'docs/forge/reports/mutation');
  await mkdir(mutationDir, { recursive: true });
  for (let index = 1; index <= count; index += 1) {
    const id = `MUT-${String(index).padStart(3, '0')}`;
    const text = `---\n${YAML.stringify(mutationFrontMatter(id, 'STORY-001'))}---\n\n<fixture>\n`;
    await writeFile(path.join(mutationDir, `${id}.md`), text, 'utf8');
  }
  return dir;
}

function lastJsonLine(stdout: string): unknown {
  const lines = stdout.split('\n').filter((line) => line.trim().length > 0);
  return JSON.parse(lines[lines.length - 1] ?? '{}');
}

describe('forge evidence prune — real CLI dispatch (specs/22 M16 P14)', () => {
  it('"evidence" with no real subcommand is a usage refusal naming "prune"', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url));
    const result = forge(['evidence'], dir);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('prune');
  });

  it('a dry run (no --apply) prints a human summary and exits 0, writing nothing', async () => {
    const dir = await freshProjectWithRecords(7);
    const result = forge(['evidence', 'prune', '--keep', '5'], dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('forge evidence prune');
    expect(result.stdout).toContain('would remove');
    expect(
      await rm(path.join(dir, 'docs/forge/reports/mutation/MUT-001.md'), { force: false }).then(
        () => true,
        () => false,
      ),
    ).toBe(true);
  });

  it('--json prints one {"v":1,...} envelope naming kept/removed/pending', async () => {
    const dir = await freshProjectWithRecords(7);
    const result = forge(['evidence', 'prune', '--keep', '5', '--json'], dir);
    expect(result.status).toBe(0);
    const envelope = lastJsonLine(result.stdout) as {
      readonly v: number;
      readonly applied: boolean;
      readonly kept: readonly unknown[];
      readonly removed: readonly { readonly id: string }[];
    };
    expect(envelope.v).toBe(1);
    expect(envelope.applied).toBe(false);
    expect(envelope.kept).toHaveLength(5);
    expect(envelope.removed.map((entry) => entry.id).sort()).toEqual(['MUT-001', 'MUT-002']);
  });

  it('--apply really removes records on disk, through the real CLI', async () => {
    const dir = await freshProjectWithRecords(7);
    const result = forge(['evidence', 'prune', '--apply', '--keep', '5', '--json'], dir);
    expect(result.status).toBe(0);
    const envelope = lastJsonLine(result.stdout) as { readonly applied: boolean };
    expect(envelope.applied).toBe(true);
    await expect(
      rm(path.join(dir, 'docs/forge/reports/mutation/MUT-001.md'), { force: false }),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      rm(path.join(dir, 'docs/forge/reports/mutation/MUT-007.md'), { force: false }),
    ).resolves.toBeUndefined();
  });

  it('a non-numeric --keep is refused (usage exit code), through the real CLI, before anything is touched', async () => {
    const dir = await freshProjectWithRecords(3);
    const result = forge(['evidence', 'prune', '--apply', '--keep', 'nope'], dir);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('not a positive integer count of records to keep');
    await expect(
      rm(path.join(dir, 'docs/forge/reports/mutation/MUT-001.md'), { force: false }),
    ).resolves.toBeUndefined();
  });

  it('THE CONTRACT: `removed` names the same candidate ids whether `applied` is false or true — only `applied` tells a consumer whether they are a forecast ("would remove") or something that already happened on disk ("did remove"); `removed`\'s own shape never signals which', async () => {
    const dir = await freshProjectWithRecords(7);
    const dryRun = forge(['evidence', 'prune', '--keep', '5', '--json'], dir);
    const applied = forge(['evidence', 'prune', '--apply', '--keep', '5', '--json'], dir);
    const dryEnvelope = lastJsonLine(dryRun.stdout) as {
      readonly applied: boolean;
      readonly removed: readonly { readonly id: string }[];
    };
    const appliedEnvelope = lastJsonLine(applied.stdout) as {
      readonly applied: boolean;
      readonly removed: readonly { readonly id: string }[];
    };
    // Same ids, same shape, in `removed` either way — a consumer that reads `removed` alone, without
    // also checking `applied`, cannot tell a forecast from a fact.
    expect(dryEnvelope.removed.map((entry) => entry.id).sort()).toEqual(['MUT-001', 'MUT-002']);
    expect(appliedEnvelope.removed.map((entry) => entry.id).sort()).toEqual(['MUT-001', 'MUT-002']);
    expect(dryEnvelope.applied).toBe(false);
    expect(appliedEnvelope.applied).toBe(true);
    // The real, load-bearing difference is on disk, not in `removed`'s own shape: the dry run (run
    // first, before the real `--apply` call above) left every record exactly where it was; `--apply`
    // actually removed them.
    await expect(
      rm(path.join(dir, 'docs/forge/reports/mutation/MUT-001.md'), { force: false }),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
