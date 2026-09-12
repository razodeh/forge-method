/**
 * `runBuildAndTestChecks`/`runVerificationPhase` — `17` §17.2 phase 5's own real, sandboxed half
 * (`PLAN-M10.md` P17): a genuinely broken build command produces a real, measured failure and adoption
 * continues past it; a genuinely passing build/test suite is promoted to `confidence: verified` with the
 * real command stored; a real timeout kills a hanging command rather than hanging the whole run; and a
 * CARTOGRAPHY claim VERIFICATION can structurally disprove is downgraded, never left unchanged.
 *
 * @see specs/17 §17.2
 * @see PLAN-M10.md P17
 */
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { CartographyFinding, InferenceFinding, Inventory, Survey } from '@forge/kb/adopt';
import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { runBuildAndTestChecks, runVerificationPhase } from '../../src/adopt/verification.ts';

const FIXED_CLOCK = { now: (): string => '2026-09-12T00:00:00.000Z' };

let dir: string | undefined;

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

/** A real, committed git repository (so `git clone` in `runBuildAndTestChecks` has real history to
 * copy) whose `package.json` declares the given `build`/`test` script bodies. Matches
 * `packages/engine/test/e2e/crash-resume.test.ts`'s own `createTempRepo` pattern. */
async function repoWithScripts(scripts: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'forge-adopt-verify-fixture-'));
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '1.0.0', scripts }, null, 2),
  );
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: root });
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  await execa('git', ['config', 'user.name', 'Test'], { cwd: root });
  await execa('git', ['add', '.'], { cwd: root });
  await execa('git', ['commit', '--quiet', '-m', 'init'], { cwd: root });
  return root;
}

function surveyWithManifest(): Survey {
  return {
    size: { totalFiles: 1, totalLines: 1, byLanguage: [] },
    manifests: [{ toolchain: 'node', path: 'package.json' }],
    entryPoints: [],
    deployableUnits: [],
    datastores: [],
    testSetup: { testDirs: [], frameworks: [], ciTestCommands: [] },
    ci: [],
    gitProfile: {
      hasCommits: true,
      ageDays: 1,
      commitCount: 1,
      contributorCount: 1,
      churnHotspots: [],
      filesChangedTogether: [],
    },
    existingDocs: [],
    health: { todoFixmeCount: 0, lintConfigPresent: false, typeCheckConfigPresent: false },
  };
}

function emptyInventory(): Inventory {
  return {
    dependencyGraph: { nodes: [], cycles: [] },
    publicApiSurface: [],
    dataSurface: [],
    configSurface: [],
    externalDependencies: [],
  };
}

describe('runBuildAndTestChecks', () => {
  it('promotes a genuinely passing build/test suite to a "pass" outcome with the real command stored', async () => {
    dir = await repoWithScripts({
      build: 'node -e "process.exit(0)"',
      test: 'node -e "process.exit(0)"',
    });
    const checks = await runBuildAndTestChecks(dir, surveyWithManifest(), FIXED_CLOCK);
    expect(checks).toHaveLength(2);
    const build = checks.find((c) => c.kind === 'build');
    const test = checks.find((c) => c.kind === 'test');
    expect(build).toMatchObject({ outcome: 'pass', command: 'npm run build' });
    expect(test).toMatchObject({ outcome: 'pass', command: 'npm test' });
    expect(build?.subject).toEqual({ origin: 'repository', statement: 'the build succeeds' });
  }, 30_000);

  it('records a genuinely broken build command as a real, measured failure -- and still runs the test check', async () => {
    dir = await repoWithScripts({
      build: 'node -e "console.error(\'boom\'); process.exit(1)"',
      test: 'node -e "process.exit(0)"',
    });
    const checks = await runBuildAndTestChecks(dir, surveyWithManifest(), FIXED_CLOCK);
    const build = checks.find((c) => c.kind === 'build');
    const test = checks.find((c) => c.kind === 'test');
    expect(build?.outcome).toBe('fail');
    expect(build?.detail).toContain('boom');
    expect(build?.command).toBe('npm run build');
    // The broken build does not abort the batch -- the sibling test check still ran and still passed.
    expect(test?.outcome).toBe('pass');
  }, 30_000);

  it('kills a genuinely hanging command with a real timeout and reports it as inconclusive', async () => {
    dir = await repoWithScripts({ build: 'node -e "setTimeout(() => {}, 60000)"' });
    const checks = await runBuildAndTestChecks(dir, surveyWithManifest(), FIXED_CLOCK, 500);
    const build = checks.find((c) => c.kind === 'build');
    expect(build?.outcome).toBe('inconclusive');
    expect(build?.detail).toContain('did not finish within');
  }, 30_000);

  it('skips a check entirely when no command was detected for it', async () => {
    dir = await repoWithScripts({});
    const checks = await runBuildAndTestChecks(dir, surveyWithManifest(), FIXED_CLOCK);
    expect(checks).toHaveLength(0);
  });

  it('falls back to a CI-detected test command when the target repo has no node manifest at all', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'forge-adopt-verify-no-manifest-'));
    await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
    const survey: Survey = {
      ...surveyWithManifest(),
      manifests: [],
      testSetup: { testDirs: [], frameworks: [], ciTestCommands: ['node -e "process.exit(0)"'] },
    };
    const checks = await runBuildAndTestChecks(dir, survey, FIXED_CLOCK);
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ kind: 'test', outcome: 'pass' });
  }, 30_000);

  it('treats a package.json with no scripts field at all as declaring neither command', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'forge-adopt-verify-no-scripts-'));
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture' }));
    await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });
    await execa('git', ['add', '.'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'init'], { cwd: dir });
    const checks = await runBuildAndTestChecks(dir, surveyWithManifest(), FIXED_CLOCK);
    expect(checks).toHaveLength(0);
  }, 30_000);

  it('reports a real clone failure (not a real git repository) as inconclusive, never throwing, and leaves no orphaned sandbox directory behind', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'forge-adopt-verify-not-a-repo-'));
    // A plain directory with no `.git` at all -- `git clone` on it must fail.
    const checks = await runBuildAndTestChecks(
      dir,
      {
        ...surveyWithManifest(),
        manifests: [],
        testSetup: { testDirs: [], frameworks: [], ciTestCommands: ['echo hi'] },
      },
      FIXED_CLOCK,
    );
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ kind: 'test', outcome: 'inconclusive' });
    expect(checks[0]?.detail).toContain('could not create an isolated clone');

    // The `mkdtemp`'d sandbox directory `createSandboxClone` creates before `git clone` ever runs must
    // not be left behind on disk when the clone itself fails -- a gauntlet critic found a first version
    // leaked it permanently.
    const sandboxBase = path.join(dir, '.forge', 'state', 'adopt-verify');
    await expect(readdir(sandboxBase)).resolves.toEqual([]);
  }, 30_000);

  it('reports a synchronously-invalid timeout as inconclusive rather than crashing', async () => {
    dir = await repoWithScripts({ build: 'node -e "process.exit(0)"' });
    const checks = await runBuildAndTestChecks(dir, surveyWithManifest(), FIXED_CLOCK, -5);
    const build = checks.find((c) => c.kind === 'build');
    expect(build?.outcome).toBe('inconclusive');
    expect(build?.detail).toContain('could not be run');
  }, 30_000);

  it('reports a signal-terminated command honestly, naming the signal rather than fabricating exit code 1', async () => {
    // `shell: true` normally reports a real numeric exit code even for a signal-killed child (the
    // wrapping shell survives and reports its own status) -- sending the signal to the shell process
    // itself (`kill -9 $$`), rather than to a child it spawned, is the one real, reachable way to get a
    // genuinely signal-terminated result back from execa here, confirmed empirically before writing
    // this test.
    dir = await repoWithScripts({ build: 'kill -9 $$' });
    const checks = await runBuildAndTestChecks(dir, surveyWithManifest(), FIXED_CLOCK);
    const build = checks.find((c) => c.kind === 'build');
    expect(build?.outcome).toBe('fail');
    expect(build?.detail).toContain('terminated by signal');
    expect(build?.detail).not.toContain('exited 1');
  }, 30_000);

  it('refuses a manifest path that escapes the target repository via ".." rather than reading outside it', async () => {
    dir = await repoWithScripts({});
    const survey: Survey = {
      ...surveyWithManifest(),
      manifests: [{ toolchain: 'node', path: '../../../etc/passwd' }],
    };
    // No throw, and no build/test command detected from the escaping path -- the escape attempt is
    // refused, not merely logged.
    const checks = await runBuildAndTestChecks(dir, survey, FIXED_CLOCK);
    expect(checks).toHaveLength(0);
  }, 30_000);
});

describe('runVerificationPhase', () => {
  it('assembles structural and command checks together: a passing build is promoted, a disproved cartography claim is downgraded', async () => {
    dir = await repoWithScripts({ build: 'node -e "process.exit(0)"' });
    const survey = surveyWithManifest();
    const inventory = emptyInventory();
    const disprovedFinding: CartographyFinding = {
      kind: 'component',
      statement: 'A fabricated component exists.',
      confidence: 'medium',
      evidence: [{ kind: 'path', path: 'src/does-not-exist.ts' }],
    };
    const conventionFinding: InferenceFinding = {
      kind: 'convention',
      statement: 'Handlers validate input before use.',
      evidence: [],
      confidence: 'medium',
      status: 'draft',
      adherenceRatio: '17 of 21',
    };
    const glossaryFinding: InferenceFinding = {
      kind: 'glossary',
      statement: 'A "widget" is a billable unit.',
      evidence: [],
      confidence: 'low',
      status: 'draft',
    };

    const result = await runVerificationPhase({
      sourceRoot: dir,
      survey,
      inventory,
      cartographyFindings: [disprovedFinding],
      inferenceFindings: [conventionFinding, glossaryFinding],
      clock: FIXED_CLOCK,
    });

    // The convention claim is re-checked (inconclusive -- this piece does not recompute a fresh grep
    // ratio); the glossary claim has no structural test at all and never appears in the result.
    const conventionResult = result.findings.find((f) => f.subject.origin === 'inference');
    expect(conventionResult).toMatchObject({ kind: 'convention', outcome: 'inconclusive' });
    expect(result.findings.some((f) => f.subject.statement === glossaryFinding.statement)).toBe(
      false,
    );

    const buildFinding = result.findings.find((f) => f.kind === 'build');
    expect(buildFinding).toMatchObject({ promotion: 'verified', confidenceAfter: 'verified' });

    const cartographyFinding = result.findings.find((f) => f.subject.origin === 'cartography');
    expect(cartographyFinding).toMatchObject({
      outcome: 'fail',
      promotion: 'downgraded',
      confidenceAfter: 'low',
    });

    // The disproved claim is a real gap for phase 7 -- never silently dropped.
    expect(result.gaps.some((gap) => gap.subject.statement === disprovedFinding.statement)).toBe(
      true,
    );
  }, 30_000);
});
