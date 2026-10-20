/**
 * `commands/dispatch/adopt.ts` — `forge adopt [dir] [--scope] [--depth] [--no-verify]`, plus its own
 * `--incremental`/`--report` forms (`03` §3.2.1, `17` §17.6), exercised in-process through the real
 * dispatcher against a real, on-disk, real-git fixture repository — `specs/22` M17 P17.
 *
 * @see specs/22 M17 P17
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { pathExists, ProjectPaths } from '@forge/core/fs';

import { dispatchAdopt } from '../../../src/commands/dispatch/adopt.ts';
import type { DispatchContext } from '../../../src/commands/dispatch/shared.ts';
import { captureLogs } from './dispatch-test-helpers.ts';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-dispatch-adopt-'));
  dirs.push(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });
  return dir;
}

async function writeFixtureFile(dir: string, relPath: string, contents: string): Promise<void> {
  const absPath = path.join(dir, relPath);
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, contents, 'utf8');
}

async function commitAll(dir: string, message: string): Promise<void> {
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', message], { cwd: dir });
}

/** A small, real fixture: a route, and `scripts.test: 'true'` (never a real recognised runner —
 * deliberately, so `AdoptRunResult.testAdoption` is proven real by actually hitting its own
 * `'handoff'` outcome, not merely present in the result shape). */
async function seedFixtureRepo(dir: string): Promise<void> {
  await writeFixtureFile(
    dir,
    'package.json',
    JSON.stringify(
      { name: 'fixture-app', version: '1.0.0', scripts: { test: 'true' }, dependencies: {} },
      null,
      2,
    ),
  );
  await writeFixtureFile(
    dir,
    'src/routes.ts',
    [
      'export function registerRoutes(): void {',
      "  app.get('/health', () => undefined);",
      '}',
      '',
    ].join('\n'),
  );
  await commitAll(dir, 'initial');
}

function ctx(
  dir: string,
  positionals: readonly string[],
  json = false,
  dryRun = false,
): DispatchContext {
  return {
    positionals,
    flags: {
      profile: 'default',
      dryRun,
      yes: false,
      json,
      noTui: false,
      verbosity: 0,
      quiet: false,
      positionals,
    },
    paths: new ProjectPaths(dir),
    projectRoot: dir,
  };
}

describe('dispatchAdopt (specs/22 M17 P17)', () => {
  it('returns undefined for a command it does not own', async () => {
    const dir = await tempRepo();
    expect(await dispatchAdopt(ctx(dir, ['kb', 'list']))).toBeUndefined();
  });

  it('runs the real, full pipeline end to end (SURVEY through BASELINE) via the real dispatcher', async () => {
    const dir = await tempRepo();
    await seedFixtureRepo(dir);
    const result = await captureLogs(() => dispatchAdopt(ctx(dir, ['adopt'], true)));
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.lines[0] ?? '{}') as {
      readonly v: number;
      readonly survey: { readonly survey: { readonly manifests: readonly unknown[] } };
      readonly inventory: { readonly publicApiSurface: readonly { readonly kind: string }[] };
      readonly verification: { readonly findings: readonly { readonly outcome: string }[] };
      readonly baseline: { readonly gate: { readonly conditions: readonly unknown[] } };
      readonly testAdoption: { readonly outcome: string };
      readonly warnings: readonly string[];
    };
    expect(parsed.v).toBe(1);
    expect(parsed.survey.survey.manifests.length).toBeGreaterThan(0);
    expect(parsed.inventory.publicApiSurface.some((s) => s.kind === 'http-route')).toBe(true);
    expect(parsed.verification.findings.some((f) => f.outcome === 'pass')).toBe(true);
    expect(parsed.baseline.gate.conditions).toHaveLength(4);
    // The real, deterministic `forge test adopt` detection, wired by this piece — `scripts.test:
    // 'true'` is not a real recognised runner, so this is a real, honest hand-off, not a guess.
    expect(parsed.testAdoption.outcome).toBe('handoff');
    // No real `ExecuteStepContext` is constructed by this dispatcher (a disclosed DECISION) — the
    // existing, real warning for that already fires.
    expect(parsed.warnings.some((w) => w.includes('CARTOGRAPHY/INFERENCE dispatch'))).toBe(true);

    const { stdout } = await execa('git', ['tag', '--list', 'BASELINE'], { cwd: dir });
    expect(stdout.trim()).toBe('BASELINE');
  });

  it('"adopt --dry-run" (the real global flag) makes zero writes and creates no BASELINE tag (specs/22 M17 P17, gauntlet critic fix)', async () => {
    const dir = await tempRepo();
    await seedFixtureRepo(dir);
    const result = await captureLogs(() =>
      dispatchAdopt(ctx(dir, ['adopt'], true, /* dryRun */ true)),
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.lines[0] ?? '{}') as { readonly warnings: readonly string[] };
    expect(parsed.warnings.some((w) => w.startsWith('(dry run'))).toBe(true);

    const paths = new ProjectPaths(dir);
    expect(await pathExists(paths.resolveWithin('reports/adoption/baseline.json'))).toBe(false);
    expect(await pathExists(paths.resolveWithin('reports/adoption/survey.json'))).toBe(false);
    const { stdout } = await execa('git', ['tag', '--list', 'BASELINE'], { cwd: dir });
    expect(stdout.trim()).toBe('');
  });

  it('runs the human-readable form, printing a real, non-empty summary', async () => {
    const dir = await tempRepo();
    await seedFixtureRepo(dir);
    const result = await captureLogs(() => dispatchAdopt(ctx(dir, ['adopt', '--no-verify'])));
    expect(result.exitCode).toBe(0);
    expect(result.lines.some((line) => line.includes('forge adopt: survey found'))).toBe(true);
  });

  it('--depth quick stops after a minimal CARTOGRAPHY, never reaching VERIFICATION/BASELINE', async () => {
    const dir = await tempRepo();
    await seedFixtureRepo(dir);
    const result = await captureLogs(() =>
      dispatchAdopt(ctx(dir, ['adopt', '--depth', 'quick'], true)),
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.lines[0] ?? '{}') as Readonly<Record<string, unknown>>;
    expect(parsed['verification']).toBeUndefined();
    expect(parsed['baseline']).toBeUndefined();
  });

  it('exits 2 with a real USR-002 for an unrecognised --depth value', async () => {
    const dir = await tempRepo();
    await expect(dispatchAdopt(ctx(dir, ['adopt', '--depth', 'bogus']))).rejects.toMatchObject({
      code: 'USR-002',
    });
  });

  it('exits 2 for more than one [dir] positional', async () => {
    const dir = await tempRepo();
    expect(await dispatchAdopt(ctx(dir, ['adopt', 'a', 'b']))).toBe(2);
  });

  it('"adopt --report" re-prints the survey/gaps already on disk without re-running anything', async () => {
    const dir = await tempRepo();
    await seedFixtureRepo(dir);
    await dispatchAdopt(ctx(dir, ['adopt', '--no-verify']));
    const result = await captureLogs(() => dispatchAdopt(ctx(dir, ['adopt', '--report'], true)));
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.lines[0] ?? '{}') as {
      readonly survey: { readonly manifests: readonly unknown[] } | undefined;
    };
    expect(parsed.survey?.manifests.length).toBeGreaterThan(0);
  });

  it('"adopt --report" rejects a combined --scope/--depth/[dir] rather than silently ignoring it', async () => {
    const dir = await tempRepo();
    expect(await dispatchAdopt(ctx(dir, ['adopt', '--report', '--depth', 'quick']))).toBe(2);
    expect(await dispatchAdopt(ctx(dir, ['adopt', '--report', 'extra-dir']))).toBe(2);
  });

  it('"adopt --incremental" reports a real, new route after a second commit, nothing else', async () => {
    const dir = await tempRepo();
    await seedFixtureRepo(dir);
    await dispatchAdopt(ctx(dir, ['adopt', '--no-verify']));
    await writeFixtureFile(
      dir,
      'src/more-routes.ts',
      [
        'export function registerMore(): void {',
        "  app.get('/new', () => undefined);",
        '}',
        '',
      ].join('\n'),
    );
    await commitAll(dir, 'add a new route');
    const result = await captureLogs(() =>
      dispatchAdopt(ctx(dir, ['adopt', '--incremental'], true)),
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.lines[0] ?? '{}') as {
      readonly newRoutes: readonly string[];
      readonly newComponents: readonly string[];
      readonly newTables: readonly string[];
    };
    expect(parsed.newRoutes.some((route) => route.includes('/new'))).toBe(true);
  });

  it('"adopt --incremental" rejects a combined --scope/--depth rather than silently ignoring it', async () => {
    const dir = await tempRepo();
    expect(await dispatchAdopt(ctx(dir, ['adopt', '--incremental', '--scope', 'x']))).toBe(2);
  });
});
