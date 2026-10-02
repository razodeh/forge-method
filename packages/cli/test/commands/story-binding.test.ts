/**
 * `resolveCheckId`'s own `test:binding` branch (`specs/22` M15 P5: "`forge story verify` runs it on the
 * same path") — `checkBinding` calls `runBindingCheck` (M15 P3) NATIVELY, in-process, scoped to the one
 * story `forge story verify` is evaluating. Real git fixtures throughout (the same shape M15 P3/P4's own
 * `binding.test.ts`/`bin-binding.test.ts` already establish): `runBindingCheck` genuinely needs a real
 * git history (a scratch lane worktree, `HEAD~1`), not something `StoryVerifyContext.runTests`'s own
 * mocking seam reaches at all — `checkBinding` bypasses that seam entirely, by design (its own doc
 * comment in `story.ts`).
 *
 * @see specs/22 M15 P5
 * @see PLAN-M15.md P5
 */
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { ProjectPaths } from '@forge/core/fs';
import { afterEach, describe, expect, it } from 'vitest';

import { appendExemption } from '../../src/commands/loop/test/exemptions.ts';
import { storyVerify, type StoryVerifyContext } from '../../src/commands/story.ts';

function resolveRealVitestEntry(): string {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve('vitest/package.json');
  const packageJson = require(packageJsonPath) as {
    readonly bin?: Readonly<Record<string, string>>;
  };
  const binRelative = packageJson.bin?.['vitest'];
  if (binRelative === undefined)
    throw new Error('vitest/package.json has no real "vitest" bin entry.');
  return path.join(path.dirname(packageJsonPath), binRelative);
}

const TEST_COMMAND = `${process.execPath} ${resolveRealVitestEntry()} run --root .`;

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function storyFixture(filesExpected: readonly string[]): string {
  return `---
id: STORY-001
type: Story
schemaVersion: 1
title: Fixture story
epic: EPIC-001
capability: CAP-001
storyType: feature
size: S
status: ready
owner_role: developer
depends_on: []
blocked_by: []
interfaces: []
data: []
files_expected:
${filesExpected.map((file) => `  - ${file}`).join('\n')}
context_refs: []
acceptance:
  - id: AC-001-1
    given: two numbers
    when: add is called
    then: the sum is returned
    kind: functional
tests: []
dod_profile: backend-default
created: 2026-01-01
updated: 2026-01-01
revision: 1
author: architect
changelog: []
---

Fixture story body.
`;
}

const PROFILE_YAML = `profiles:
  backend-default:
    ready: []
    verify:
      - { check: test:binding }
    done: []
`;

/** A real git project: a base commit (the story, the DoD profile, no implementation yet) and — unless
 * `implAtBase` — a second, later commit adding the implementation and its own test, so `HEAD~1`
 * genuinely lacks it (the exact fixture shape `bin-binding.test.ts`'s own `freshProject` already
 * establishes for M15 P4). */
async function freshProject(
  options: {
    readonly filesExpected?: readonly string[];
    readonly testBody?: string;
    readonly skipImpl?: boolean;
  } = {},
): Promise<{ readonly dir: string; readonly ctx: StoryVerifyContext }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-story-binding-'));
  dirs.push(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });

  await writeFile(path.join(dir, 'package.json'), '{"name":"fixture","private":true}\n', 'utf8');
  await mkdir(path.join(dir, 'docs/forge/specs/stories'), { recursive: true });
  await writeFile(
    path.join(dir, 'docs/forge/specs/stories/STORY-001-fixture.md'),
    storyFixture(options.filesExpected ?? ['impl.js', 'impl.test.js']),
    'utf8',
  );
  await mkdir(path.join(dir, 'docs/forge/kb/engineering'), { recursive: true });
  await writeFile(
    path.join(dir, 'docs/forge/kb/engineering/dod-profiles.yaml'),
    PROFILE_YAML,
    'utf8',
  );

  await execa('git', ['add', '-A'], { cwd: dir });
  await execa(
    'git',
    ['commit', '--quiet', '-m', 'base: story and profile exist, no implementation yet'],
    {
      cwd: dir,
    },
  );
  if (!options.skipImpl) {
    await writeFile(
      path.join(dir, 'impl.js'),
      'export function add(a, b) { return a + b; }\n',
      'utf8',
    );
    await writeFile(
      path.join(dir, 'impl.test.js'),
      options.testBody ??
        "import { test, expect } from 'vitest';\nimport { add } from './impl.js';\ntest('adds', () => { expect(add(1, 2)).toBe(3); });\n",
      'utf8',
    );
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'the story: implement add()'], { cwd: dir });
  }

  const ctx: StoryVerifyContext = {
    paths: new ProjectPaths(dir),
    projectRoot: dir,
    specsRoot: 'docs/forge/specs',
    kbRoot: 'docs/forge/kb',
    reportsRoot: 'docs/forge/reports',
    testCommands: { unit: TEST_COMMAND },
  };
  return { dir, ctx };
}

describe('forge story verify — test:binding (specs/22 M15 P5)', () => {
  it('passes for a genuinely binding test, writing no MutationEvidence', async () => {
    const { dir, ctx } = await freshProject();

    const outcome = await storyVerify(ctx, 'STORY-001');

    expect(outcome.kind).toBe('verified');
    if (outcome.kind !== 'verified') throw new Error('unreachable');
    const check = outcome.report.checks.find((c) => c.check === 'test:binding');
    expect(check?.status).toBe('pass');
    await expect(readdir(path.join(dir, 'docs/forge/reports/mutation'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  }, 30_000);

  it('fails, naming the non-binding test, for a test that never depends on the implementation', async () => {
    const { ctx } = await freshProject({
      filesExpected: ['impl.js', 'tautology.test.js'],
      skipImpl: true,
    });
    await writeFile(
      path.join(ctx.projectRoot, 'impl.js'),
      'export function add(a, b) { return a + b; }\n',
      'utf8',
    );
    await writeFile(
      path.join(ctx.projectRoot, 'tautology.test.js'),
      "import { test, expect } from 'vitest';\ntest('tautology', () => { expect(true).toBe(true); });\n",
      'utf8',
    );
    await execa('git', ['add', '-A'], { cwd: ctx.projectRoot });
    await execa('git', ['commit', '--quiet', '-m', 'the story: a genuinely unrelated test file'], {
      cwd: ctx.projectRoot,
    });

    const outcome = await storyVerify(ctx, 'STORY-001');

    expect(outcome.kind).toBe('verified');
    if (outcome.kind !== 'verified') throw new Error('unreachable');
    const check = outcome.report.checks.find((c) => c.check === 'test:binding');
    expect(check?.status).toBe('fail');
    expect(check?.message).toContain('tautology');
  }, 30_000);

  // `checkBinding`'s own exemption wiring (`specs/22` M15 P6: "checked on every later `forge test
  // binding`/`forge story verify` run") -- a round-3 gauntlet critic found this path, though
  // confirmed correct by direct, independent reproduction, had ZERO test coverage anywhere in this
  // piece's own diff (`bin-exempt.test.ts` only ever exercises `forge test binding`, never `forge
  // story verify`): a future change to `checkBinding`'s own `loadExemptions` call, its `reportsRoot`
  // resolution, or the qualified-key matching could silently break this entry point while every
  // other shipped test stayed green.
  it('passes when a declared exemption covers the non-binding test', async () => {
    const { ctx } = await freshProject({
      filesExpected: ['impl.js', 'tautology.test.js'],
      skipImpl: true,
    });
    await writeFile(
      path.join(ctx.projectRoot, 'impl.js'),
      'export function add(a, b) { return a + b; }\n',
      'utf8',
    );
    await writeFile(
      path.join(ctx.projectRoot, 'tautology.test.js'),
      "import { test, expect } from 'vitest';\ntest('tautology', () => { expect(true).toBe(true); });\n",
      'utf8',
    );
    await execa('git', ['add', '-A'], { cwd: ctx.projectRoot });
    await execa('git', ['commit', '--quiet', '-m', 'the story: a genuinely unrelated test file'], {
      cwd: ctx.projectRoot,
    });
    await appendExemption(
      ctx.paths,
      ctx.reportsRoot,
      { now: () => new Date().toISOString() },
      {
        testId: 'STORY-001: tautology',
        reason: 'A pure tautology, never touches impl.js.',
        owner: 'alice',
        expiry: '2099-01-01',
      },
      { projectRoot: ctx.projectRoot, runId: undefined },
    );
    // `checkBinding` reverts to `HEAD~1`, like `forge test binding` itself -- amended onto the
    // implementation commit (not a separate commit on top of it) so `HEAD~1` still resolves to the
    // true pre-implementation base, the identical reason `bin-exempt.test.ts`'s own
    // `amendOntoImplementation` helper exists.
    await execa('git', ['add', '-A'], { cwd: ctx.projectRoot });
    await execa('git', ['commit', '--amend', '--no-edit', '--quiet'], { cwd: ctx.projectRoot });

    const outcome = await storyVerify(ctx, 'STORY-001');

    expect(outcome.kind).toBe('verified');
    if (outcome.kind !== 'verified') throw new Error('unreachable');
    const check = outcome.report.checks.find((c) => c.check === 'test:binding');
    expect(check?.status).toBe('pass');
  }, 30_000);

  it('fails, naming the exemption, its owner and its expiry, when the declared exemption is expired', async () => {
    const { ctx } = await freshProject({
      filesExpected: ['impl.js', 'tautology.test.js'],
      skipImpl: true,
    });
    await writeFile(
      path.join(ctx.projectRoot, 'impl.js'),
      'export function add(a, b) { return a + b; }\n',
      'utf8',
    );
    await writeFile(
      path.join(ctx.projectRoot, 'tautology.test.js'),
      "import { test, expect } from 'vitest';\ntest('tautology', () => { expect(true).toBe(true); });\n",
      'utf8',
    );
    await execa('git', ['add', '-A'], { cwd: ctx.projectRoot });
    await execa('git', ['commit', '--quiet', '-m', 'the story: a genuinely unrelated test file'], {
      cwd: ctx.projectRoot,
    });
    await appendExemption(
      ctx.paths,
      ctx.reportsRoot,
      { now: () => new Date().toISOString() },
      {
        testId: 'STORY-001: tautology',
        reason: 'A pure tautology, never touches impl.js.',
        owner: 'alice',
        expiry: '2020-01-01',
      },
      { projectRoot: ctx.projectRoot, runId: undefined },
    );
    await execa('git', ['add', '-A'], { cwd: ctx.projectRoot });
    await execa('git', ['commit', '--amend', '--no-edit', '--quiet'], { cwd: ctx.projectRoot });

    const outcome = await storyVerify(ctx, 'STORY-001');

    expect(outcome.kind).toBe('verified');
    if (outcome.kind !== 'verified') throw new Error('unreachable');
    const check = outcome.report.checks.find((c) => c.check === 'test:binding');
    expect(check?.status).toBe('fail');
    expect(check?.message).toContain('STORY-001: tautology');
    expect(check?.message).toContain('alice');
    expect(check?.message).toContain('expired');
  }, 30_000);

  it('is unverifiable, not a crash, for a story whose files_expected names no test path', async () => {
    const { ctx } = await freshProject({ filesExpected: ['impl.js'] });

    const outcome = await storyVerify(ctx, 'STORY-001');

    expect(outcome.kind).toBe('verified');
    if (outcome.kind !== 'verified') throw new Error('unreachable');
    const check = outcome.report.checks.find((c) => c.check === 'test:binding');
    expect(check?.status).toBe('unverifiable');
  }, 30_000);

  it('is unverifiable when no execution.testCommands.unit is configured', async () => {
    const { ctx } = await freshProject();
    const unconfigured: StoryVerifyContext = { ...ctx, testCommands: {} };

    const outcome = await storyVerify(unconfigured, 'STORY-001');

    expect(outcome.kind).toBe('verified');
    if (outcome.kind !== 'verified') throw new Error('unreachable');
    const check = outcome.report.checks.find((c) => c.check === 'test:binding');
    expect(check?.status).toBe('unverifiable');
    expect(check?.message).toContain('execution.testCommands.unit');
  }, 30_000);

  it('is fail, never a silent pass, when the scratch worktree is not fully restored after the check', async () => {
    // A real, non-mocked way to force `restoreVerified: false` through `runBindingCheck`'s own normal
    // 'completed' path -- a round-2 gauntlet critic (M15 P5) found and verified it live: `resetLaneWorktree`
    // (`git reset --hard` + `git clean -fd`) restores every TRACKED path, but `git clean -fd` (no `-x`)
    // skips a gitignored one. A test that increments a gitignored counter file on every real invocation,
    // and asserts the count it read was below 2, passes on the baseline run (count 0) and the mutated run
    // (count 1, unaffected by `files_expected` naming no real implementation path to revert -- irrelevant
    // here, only the invocation count matters) but FAILS on the third, restore-verification run (count 2)
    // -- the file survived the reset `checkBinding`'s own doc comment says a real restore-verification
    // failure looks like, with zero mocking.
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-story-binding-restore-'));
    dirs.push(dir);
    await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });
    await execa(
      'git',
      ['commit', '--quiet', '--allow-empty', '-m', 'base: empty, HEAD~1 for the real commit'],
      {
        cwd: dir,
      },
    );
    await writeFile(path.join(dir, 'package.json'), '{"name":"fixture","private":true}\n', 'utf8');
    await writeFile(path.join(dir, '.gitignore'), '.sentinel-count\n', 'utf8');
    await mkdir(path.join(dir, 'docs/forge/specs/stories'), { recursive: true });
    await writeFile(
      path.join(dir, 'docs/forge/specs/stories/STORY-001-fixture.md'),
      storyFixture(['sentinel.test.js']),
      'utf8',
    );
    await mkdir(path.join(dir, 'docs/forge/kb/engineering'), { recursive: true });
    await writeFile(
      path.join(dir, 'docs/forge/kb/engineering/dod-profiles.yaml'),
      PROFILE_YAML,
      'utf8',
    );
    await writeFile(
      path.join(dir, 'sentinel.test.js'),
      "import { existsSync, readFileSync, writeFileSync } from 'node:fs';\n" +
        "import { test, expect } from 'vitest';\n" +
        "const COUNT_PATH = './.sentinel-count';\n" +
        'let count = 0;\n' +
        "if (existsSync(COUNT_PATH)) count = Number(readFileSync(COUNT_PATH, 'utf8'));\n" +
        'writeFileSync(COUNT_PATH, String(count + 1));\n' +
        "test('sentinel', () => { expect(count).toBeLessThan(2); });\n",
      'utf8',
    );
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa(
      'git',
      ['commit', '--quiet', '-m', 'the story: a test whose 3rd invocation in one worktree fails'],
      { cwd: dir },
    );
    const ctx: StoryVerifyContext = {
      paths: new ProjectPaths(dir),
      projectRoot: dir,
      specsRoot: 'docs/forge/specs',
      kbRoot: 'docs/forge/kb',
      reportsRoot: 'docs/forge/reports',
      testCommands: { unit: TEST_COMMAND },
    };

    const outcome = await storyVerify(ctx, 'STORY-001');

    expect(outcome.kind).toBe('verified');
    if (outcome.kind !== 'verified') throw new Error('unreachable');
    const check = outcome.report.checks.find((c) => c.check === 'test:binding');
    expect(check?.status).toBe('fail');
    expect(check?.message).toContain('not fully restored');
  }, 30_000);

  it('is unverifiable, never a stale pass/fail, against a dirty working tree', async () => {
    // A round-1 gauntlet critic (M15 P5) reproduced live that, without this guard, an uncommitted edit
    // to the story's own test is silently invisible: `runBindingCheck`'s own scratch lane is built from
    // committed HEAD, so the verdict described stale, already-committed code, not what was really on
    // disk the moment `forge story verify` ran.
    const { ctx } = await freshProject();
    // Overwrite the already-committed, genuinely-binding test with a tautology -- UNCOMMITTED.
    await writeFile(
      path.join(ctx.projectRoot, 'impl.test.js'),
      "import { test, expect } from 'vitest';\ntest('tautology', () => { expect(true).toBe(true); });\n",
      'utf8',
    );

    const outcome = await storyVerify(ctx, 'STORY-001');

    expect(outcome.kind).toBe('verified');
    if (outcome.kind !== 'verified') throw new Error('unreachable');
    const check = outcome.report.checks.find((c) => c.check === 'test:binding');
    expect(check?.status).toBe('unverifiable');
    expect(check?.message).toContain('uncommitted change');
  }, 30_000);

  it("is unverifiable when the story's own baseline already fails before any mutation", async () => {
    const { ctx } = await freshProject({
      testBody:
        "import { test, expect } from 'vitest';\nimport { add } from './impl.js';\ntest('adds', () => { expect(add(1, 2)).toBe(999); });\n",
    });

    const outcome = await storyVerify(ctx, 'STORY-001');

    expect(outcome.kind).toBe('verified');
    if (outcome.kind !== 'verified') throw new Error('unreachable');
    const check = outcome.report.checks.find((c) => c.check === 'test:binding');
    expect(check?.status).toBe('unverifiable');
    expect(check?.message).toContain('already failing before any mutation');
  }, 30_000);

  it('is unverifiable when no js/python test ecosystem can be detected', async () => {
    const { ctx, dir } = await freshProject();
    await rm(path.join(dir, 'package.json'));
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'remove package.json'], { cwd: dir });

    const outcome = await storyVerify(ctx, 'STORY-001');

    expect(outcome.kind).toBe('verified');
    if (outcome.kind !== 'verified') throw new Error('unreachable');
    const check = outcome.report.checks.find((c) => c.check === 'test:binding');
    expect(check?.status).toBe('unverifiable');
    expect(check?.message).toContain('could not detect a js/python test ecosystem');
  }, 30_000);
});

// `specs/22` M15 P11 metrics 1 and 4b: `checkBinding`'s own real telemetry, gated on `ctx.runId`.
describe('forge story verify — test:binding telemetry (specs/22 M15 P11)', () => {
  it('emits CheckRun {kind: "binding"} with the real pass-rate numbers when ctx.runId names a real run', async () => {
    const { ctx, dir } = await freshProject();

    await storyVerify({ ...ctx, runId: 'run-story-verify' }, 'STORY-001');

    const { readEvents } = await import('@forge/telemetry/events');
    const events = [];
    for await (const event of readEvents(dir, 'run-story-verify')) events.push(event);
    const checkRuns = events.filter((event) => event.type === 'CheckRun');
    expect(checkRuns).toHaveLength(1);
    expect(checkRuns[0]?.payload).toMatchObject({
      kind: 'binding',
      storyId: 'STORY-001',
      testsNamed: 1,
      bound: 1,
      nonBinding: 0,
      exempted: 0,
    });
    expect(checkRuns[0]?.payload).not.toHaveProperty('expiredExemptionIds');
  }, 30_000);

  it('emits no CheckRun event at all when ctx.runId is unset -- no real run, no event log to write into', async () => {
    const { ctx } = await freshProject();

    await storyVerify(ctx, 'STORY-001');

    const { pathExists } = await import('@forge/core/fs');
    expect(await pathExists(ctx.paths.resolveState('runs'))).toBe(false);
  }, 30_000);

  it('bundles expiredExemptionIds onto the same event when this check discovers a stale exemption (metric 4b)', async () => {
    const { ctx, dir } = await freshProject({
      filesExpected: ['impl.js', 'tautology.test.js'],
      skipImpl: true,
    });
    await writeFile(
      path.join(dir, 'impl.js'),
      'export function add(a, b) { return a + b; }\n',
      'utf8',
    );
    await writeFile(
      path.join(dir, 'tautology.test.js'),
      "import { test, expect } from 'vitest';\ntest('tautology', () => { expect(true).toBe(true); });\n",
      'utf8',
    );
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'the story: a genuinely unrelated test file'], {
      cwd: dir,
    });
    await appendExemption(
      ctx.paths,
      ctx.reportsRoot,
      { now: () => new Date().toISOString() },
      {
        testId: 'STORY-001: tautology',
        reason: 'A pure tautology, never touches impl.js.',
        owner: 'alice',
        expiry: '2020-01-01',
      },
      { projectRoot: dir, runId: undefined },
    );
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--amend', '--no-edit', '--quiet'], { cwd: dir });

    await storyVerify({ ...ctx, runId: 'run-expired' }, 'STORY-001');

    const { readEvents } = await import('@forge/telemetry/events');
    const events = [];
    for await (const event of readEvents(dir, 'run-expired')) events.push(event);
    const checkRuns = events.filter((event) => event.type === 'CheckRun');
    expect(checkRuns).toHaveLength(1);
    expect(checkRuns[0]?.payload).toMatchObject({
      kind: 'binding',
      storyId: 'STORY-001',
    });
    const payload = checkRuns[0]?.payload as { readonly expiredExemptionIds?: readonly string[] };
    expect(payload.expiredExemptionIds).toEqual(['EXEMPT-001']);
  }, 30_000);
});
