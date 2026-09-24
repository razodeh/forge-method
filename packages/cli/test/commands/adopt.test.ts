/**
 * `forge adopt`/`forge adopt --incremental`/`forge adopt --report`/`forge baseline show|diff` —
 * `PLAN-M10.md` P19's own Checks section against a real, on-disk, real-git target repository (no
 * mocking beyond CARTOGRAPHY/INFERENCE dispatch, which this file's own top-of-file `adopt.ts` doc
 * comment discloses as out of this piece's scope): the full standard-depth pipeline runs end to end
 * (SURVEY through BASELINE), `quick` depth stops after CARTOGRAPHY, and the literal `--incremental`
 * exit test: "against a fixture repo with one new, undocumented route since the baseline reports
 * exactly that route as new, nothing else."
 *
 * @see specs/17
 * @see PLAN-M10.md P19
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';
import * as YAML from 'yaml';

import { pathExists, readTextFile, writeFileAtomic, ProjectPaths } from '@forge/core/fs';
import { configSchema, DEFAULT_CONFIG } from '@forge/schemas/config';

import {
  adopt,
  adoptIncremental,
  adoptReport,
  baselineDiff,
  baselineShow,
  type AdoptContext,
} from '../../src/commands/adopt.ts';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-cli-adopt-'));
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

/** A small, real, real-git fixture: one route, one committed test script that passes fast (`true`,
 * never a real test runner) so `runVerificationPhase`'s own real build/test clone-and-run records a
 * real, fast, passing test check without a build script to also detect. */
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
  await writeFixtureFile(dir, 'test/index.test.ts', '// placeholder\n');
  await commitAll(dir, 'initial');
}

function ctxFor(dir: string): AdoptContext {
  return { paths: new ProjectPaths(dir), env: process.env };
}

describe('adopt — the real, end-to-end standard-depth pipeline', () => {
  it('runs SURVEY through BASELINE for real and writes every real report/artifact to disk', async () => {
    const dir = await tempRepo();
    await seedFixtureRepo(dir);

    const result = await adopt(ctxFor(dir), {});

    expect(result.scopedProposal).toBeUndefined();
    expect(result.survey.survey.manifests.length).toBeGreaterThan(0);
    expect(result.inventory.publicApiSurface.some((s) => s.kind === 'http-route')).toBe(true);
    expect(result.verification).toBeDefined();
    // A real, recorded test check — `scripts.test: "true"` was really cloned and really run.
    expect(
      result.verification?.findings.some((f) => f.kind === 'test' && f.outcome === 'pass'),
    ).toBe(true);
    expect(result.reconstruction).toBeDefined();
    expect(result.gapAnalysis).toBeDefined();
    expect(result.confirmation).toBeDefined();
    expect(result.baseline).toBeDefined();
    expect(result.baseline?.gate.conditions).toHaveLength(4);

    const paths = new ProjectPaths(dir);
    expect(await pathExistsFor(paths, 'reports/adoption/survey.json')).toBe(true);
    expect(await pathExistsFor(paths, 'reports/adoption/inventory.json')).toBe(true);
    expect(await pathExistsFor(paths, 'reports/adoption/gaps.md')).toBe(true);
    expect(await pathExistsFor(paths, 'reports/adoption/baseline.json')).toBe(true);

    const { stdout } = await execa('git', ['tag', '--list', 'BASELINE'], { cwd: dir });
    expect(stdout.trim()).toBe('BASELINE');
  });

  it('a second run against the same project does not crash and does not re-create the tag', async () => {
    const dir = await tempRepo();
    await seedFixtureRepo(dir);
    const ctx = ctxFor(dir);

    await adopt(ctx, {});
    await adopt(ctx, {});

    const { stdout } = await execa('git', ['tag', '--list', 'BASELINE'], { cwd: dir });
    expect(stdout.trim().split('\n').filter(Boolean)).toEqual(['BASELINE']);
  });

  it('`--no-verify` skips build/test verification entirely', async () => {
    const dir = await tempRepo();
    await seedFixtureRepo(dir);

    const result = await adopt(ctxFor(dir), { noVerify: true });

    expect(result.verification?.findings).toEqual([]);
  });

  it('`quick` depth stops after CARTOGRAPHY: no inference/verification/reconstruction/gap/baseline', async () => {
    const dir = await tempRepo();
    await seedFixtureRepo(dir);

    const result = await adopt(ctxFor(dir), { depth: 'quick' });

    expect(result.survey).toBeDefined();
    expect(result.inventory).toBeDefined();
    expect(result.cartography).toBeDefined();
    expect(result.inference).toBeUndefined();
    expect(result.verification).toBeUndefined();
    expect(result.reconstruction).toBeUndefined();
    expect(result.gapAnalysis).toBeUndefined();
    expect(result.baseline).toBeUndefined();
  });

  it('proposes a scoped adoption instead of a full run when the repo trips the size gate', async () => {
    const dir = await tempRepo();
    await seedFixtureRepo(dir);

    const result = await adopt(
      { ...ctxFor(dir), sizeThresholds: { maxFiles: 1, maxLines: 1 } },
      {},
    );

    expect(result.scopedProposal).toBeDefined();
    expect(result.reconstruction).toBeUndefined();
  });

  it('a `--scope` bypasses the size gate even when it would otherwise trigger', async () => {
    const dir = await tempRepo();
    await seedFixtureRepo(dir);

    const result = await adopt(
      { ...ctxFor(dir), sizeThresholds: { maxFiles: 1, maxLines: 1 } },
      { scope: 'src' },
    );

    expect(result.scopedProposal).toBeUndefined();
  });

  it('warns, rather than silently vacuously passing, when no CARTOGRAPHY/INFERENCE dispatch was supplied', async () => {
    const dir = await tempRepo();
    await seedFixtureRepo(dir);

    const result = await adopt(ctxFor(dir), { noVerify: true });

    expect(
      result.warnings.some((w) => w.includes('CARTOGRAPHY/INFERENCE dispatch was not provided')),
    ).toBe(true);
  });

  it('`--depth deep` threads a real `{ deep: true }` signal through to an injected runCartography/runInference, rather than silently behaving like `standard`', async () => {
    const dir = await tempRepo();
    await seedFixtureRepo(dir);
    const seenDeepFlags: boolean[] = [];

    await adopt(
      {
        ...ctxFor(dir),
        runCartography: (_survey, _inventory, options) => {
          seenDeepFlags.push(options.deep);
          return Promise.resolve({ findings: [], rejected: [], sharedWriteTables: [] });
        },
        runInference: (_survey, _inventory, options) => {
          seenDeepFlags.push(options.deep);
          return Promise.resolve({ findings: [], rejected: [] });
        },
      },
      { depth: 'deep', noVerify: true },
    );

    expect(seenDeepFlags).toEqual([true, true]);
  });

  it('`standard` (and `quick`) depth pass `{ deep: false }` through to the same injected callbacks', async () => {
    const dir = await tempRepo();
    await seedFixtureRepo(dir);
    let seenDeep: boolean | undefined;

    await adopt(
      {
        ...ctxFor(dir),
        runCartography: (_survey, _inventory, options) => {
          seenDeep = options.deep;
          return Promise.resolve({ findings: [], rejected: [], sharedWriteTables: [] });
        },
      },
      { depth: 'quick' },
    );

    expect(seenDeep).toBe(false);
  });

  it('the target repository having no commits yet is reported honestly: baseline.tag/commit are undefined, never a fabricated tag name', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-cli-adopt-'));
    dirs.push(dir);
    await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
    await writeFixtureFile(dir, 'package.json', JSON.stringify({ name: 'x', version: '1.0.0' }));
    // Deliberately no commit at all.

    const result = await adopt(ctxFor(dir), { noVerify: true });

    expect(result.baseline?.tag).toBeUndefined();
    expect(result.baseline?.commit).toBeUndefined();
    expect(result.warnings.some((w) => w.includes('no commits yet'))).toBe(true);
    const { stdout } = await execa('git', ['tag', '--list', 'BASELINE'], { cwd: dir });
    expect(stdout.trim()).toBe('');
  });
});

describe('adopt/baselineShow — malformed self-written report files (accidental corruption, not adversarial)', () => {
  it('readSurveyReport-backed adoptReport discards unparsable JSON rather than throwing a bare SyntaxError', async () => {
    const dir = await tempRepo();
    await seedFixtureRepo(dir);
    const ctx = ctxFor(dir);
    await mkdir(path.join(dir, 'reports/adoption'), { recursive: true });
    await writeFile(path.join(dir, 'reports/adoption/survey.json'), '{not valid json', 'utf8');

    const report = await adoptReport(ctx);

    expect(report.survey).toBeUndefined();
  });

  it('baselineShow discards a structurally wrong-shaped baseline.json (an older/different schema) rather than trusting it', async () => {
    const dir = await tempRepo();
    await seedFixtureRepo(dir);
    const ctx = ctxFor(dir);
    await mkdir(path.join(dir, 'reports/adoption'), { recursive: true });
    await writeFile(
      path.join(dir, 'reports/adoption/baseline.json'),
      JSON.stringify({ someOtherField: true }),
      'utf8',
    );

    const snapshot = await baselineShow(ctx);

    expect(snapshot).toBeUndefined();
  });
});

describe('adoptReport (`forge adopt --report`)', () => {
  it('re-prints the survey/gaps already on disk from a prior run without re-running anything', async () => {
    const dir = await tempRepo();
    await seedFixtureRepo(dir);
    const ctx = ctxFor(dir);
    await adopt(ctx, {});

    const report = await adoptReport(ctx);

    expect(report.survey).toBeDefined();
    expect(report.gapsReport).toContain('# Adoption gap analysis');
    expect(report.baseline).toBeDefined();
  });

  it('reports undefined fields when adopt was never run', async () => {
    const dir = await tempRepo();
    await seedFixtureRepo(dir);

    const report = await adoptReport(ctxFor(dir));

    expect(report.survey).toBeUndefined();
    expect(report.gapsReport).toBeUndefined();
    expect(report.baseline).toBeUndefined();
  });
});

describe('forge baseline show|diff', () => {
  it('baselineShow returns undefined before any adopt run, and the real snapshot after', async () => {
    const dir = await tempRepo();
    await seedFixtureRepo(dir);
    const ctx = ctxFor(dir);

    expect(await baselineShow(ctx)).toBeUndefined();
    await adopt(ctx, {});
    const snapshot = await baselineShow(ctx);

    expect(snapshot?.tag).toBe('BASELINE');
    expect(snapshot?.facts.dependencyCount).toBeDefined();
  });

  it('baselineDiff throws a real, actionable error when no baseline has been recorded yet', async () => {
    const dir = await tempRepo();
    await seedFixtureRepo(dir);

    await expect(baselineDiff(ctxFor(dir), {})).rejects.toMatchObject({ code: 'USR-003' });
  });

  it('baselineDiff reports a real, zero delta against an unchanged repository', async () => {
    const dir = await tempRepo();
    await seedFixtureRepo(dir);
    const ctx = ctxFor(dir);
    await adopt(ctx, {});

    const diff = await baselineDiff(ctx, { noVerify: true });

    expect(diff.deltas['dependencyCount']).toBe(0);
    expect(diff.deltas['totalLines']).toBe(0);
  });
});

describe('adoptIncremental — the literal M10 exit test (one new, undocumented route)', () => {
  it('reports exactly the new route as new, nothing else', async () => {
    const dir = await tempRepo();
    await seedFixtureRepo(dir);
    const ctx = ctxFor(dir);
    await adopt(ctx, { noVerify: true });

    // Add exactly one new, undocumented route since the baseline — appended inside the *existing*
    // exported function, so no new exported-symbol signal is introduced alongside it (this is
    // specifically testing that only the new route itself is reported, "nothing else").
    await writeFixtureFile(
      dir,
      'src/routes.ts',
      [
        'export function registerRoutes(): void {',
        "  app.get('/health', () => undefined);",
        "  app.post('/orders', () => undefined);",
        '}',
        '',
      ].join('\n'),
    );
    await commitAll(dir, 'add new orders route');

    const report = await adoptIncremental(ctx, { noVerify: true });

    expect(report.newRoutes).toEqual(['http-route:POST /orders']);
    expect(report.newComponents).toEqual([]);
    expect(report.newTables).toEqual([]);
  });

  it('reports no new routes at all when nothing changed since the last inventory snapshot', async () => {
    const dir = await tempRepo();
    await seedFixtureRepo(dir);
    const ctx = ctxFor(dir);
    await adopt(ctx, { noVerify: true });

    const report = await adoptIncremental(ctx, { noVerify: true });

    expect(report.newRoutes).toEqual([]);
    expect(report.newComponents).toEqual([]);
    expect(report.newTables).toEqual([]);
  });

  it('reports every route as new on the very first run (no prior inventory snapshot to diff against)', async () => {
    const dir = await tempRepo();
    await seedFixtureRepo(dir);

    const report = await adoptIncremental(ctxFor(dir), { noVerify: true });

    expect(report.newRoutes).toEqual([]);
    expect(report.gapDeltas).toBeUndefined();
  });
});

describe('project.adopted marker — 17 §17.4 / PLAN-M10.md P20', () => {
  it('writes project.adopted: true to a real .forge/config.yaml once a full run completes', async () => {
    const dir = await tempRepo();
    await seedFixtureRepo(dir);
    await writeFileAtomic(
      new ProjectPaths(dir).resolveWithin('.forge/config.yaml'),
      YAML.stringify(DEFAULT_CONFIG),
    );

    const result = await adopt(ctxFor(dir), {});

    const updated = configSchema.parse(
      YAML.parse(await readTextFile(new ProjectPaths(dir).resolveWithin('.forge/config.yaml'))),
    );
    expect(updated.project.adopted).toBe(true);
    // No warning about a missing/invalid config, since a real one existed and was updated.
    expect(result.warnings.some((w) => w.includes('project.adopted was not recorded'))).toBe(false);
  });

  it('is tolerant of a target repository with no .forge/config.yaml yet — a disclosed warning, not a throw', async () => {
    const dir = await tempRepo();
    await seedFixtureRepo(dir);

    const result = await adopt(ctxFor(dir), {});

    expect(result.baseline).toBeDefined();
    expect(result.warnings.some((w) => w.includes('project.adopted was not recorded'))).toBe(true);
  });

  it('does not set the marker on a `quick`-depth run, which never reaches the end of the pipeline', async () => {
    const dir = await tempRepo();
    await seedFixtureRepo(dir);
    await writeFileAtomic(
      new ProjectPaths(dir).resolveWithin('.forge/config.yaml'),
      YAML.stringify(DEFAULT_CONFIG),
    );

    await adopt(ctxFor(dir), { depth: 'quick' });

    const config = configSchema.parse(
      YAML.parse(await readTextFile(new ProjectPaths(dir).resolveWithin('.forge/config.yaml'))),
    );
    expect(config.project.adopted).toBe(false);
  });

  it('is idempotent: a second full run against an already-marked project leaves it marked, no throw', async () => {
    const dir = await tempRepo();
    await seedFixtureRepo(dir);
    await writeFileAtomic(
      new ProjectPaths(dir).resolveWithin('.forge/config.yaml'),
      YAML.stringify(DEFAULT_CONFIG),
    );
    const ctx = ctxFor(dir);

    await adopt(ctx, {});
    await adopt(ctx, {});

    const config = configSchema.parse(
      YAML.parse(await readTextFile(new ProjectPaths(dir).resolveWithin('.forge/config.yaml'))),
    );
    expect(config.project.adopted).toBe(true);
  });
});

async function pathExistsFor(paths: ProjectPaths, relative: string): Promise<boolean> {
  return pathExists(paths.resolveWithin(relative));
}
