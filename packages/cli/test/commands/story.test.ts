/**
 * `forge story verify <storyId>` (`10` §10.6 step 6, `09` §9.5 and §9.8, `PLAN-M13.md` P22, Q213): evaluate a story's
 * `done` DoD profile, deterministically, and never read an unverifiable check as a pass.
 *
 * The test-command runner is a seam (`StoryVerifyContext.runTests`); most cases substitute it with a function that
 * records what it was asked and returns a `TestRunResult`, so a case controls exactly what the "tool" said. One
 * case at the end runs the real `testRun` against real vitest to prove the wiring end to end.
 *
 * @see specs/09 §9.5, §9.8
 * @see specs/10 §10.6
 * @see PLAN-M13.md P22
 */
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ArtifactDocument, writeArtifact } from '@forge/core/artifacts';
import { renderArtifactPath } from '@forge/schemas/registry';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readArtifactTemplate } from '../../src/commands/shared.ts';
import { writeFlakyState } from '../../src/commands/loop/test/flaky.ts';
import { writeNormalizedReport } from '../../src/commands/loop/test/reporter.ts';
import type { TestOutcome } from '../../src/commands/loop/test/reporter.ts';
import type { TestCommands, TestRunResult } from '../../src/commands/loop/test/run.ts';
import {
  renderStoryVerify,
  storyVerify,
  type StoryVerifyContext,
  type StoryVerifyOutcome,
  type StoryVerifyReport,
  type TestRunner,
} from '../../src/commands/story.ts';
import { KB_ROOT, SPECS_ROOT, cleanupAll, createTestProject, type TestProject } from './helpers.ts';

afterEach(cleanupAll);

async function writeStory(
  project: TestProject,
  overrides: {
    readonly id?: string;
    readonly acceptance?: readonly string[];
    readonly dod_profile?: string;
  } = {},
): Promise<string> {
  const id = overrides.id ?? 'STORY-001';
  const pathResult = renderArtifactPath('Story', { id, slug: 'fixture' });
  if (!pathResult.success) throw new Error(`unreachable: ${pathResult.missingVariable}`);
  const doc = ArtifactDocument.parse(
    await readArtifactTemplate('Story'),
    `docs/forge/${pathResult.path}`,
  );
  doc.set(['id'], id);
  doc.set(['title'], 'Fixture story');
  doc.set(['epic'], 'EPIC-001');
  doc.set(['capability'], 'CAP-001');
  doc.set(['status'], 'in-progress');
  doc.set(['size'], 'M');
  doc.set(['owner_role'], 'backend');
  doc.set(['files_expected'], ['src/fixture/**']);
  doc.set(['context_refs'], []);
  doc.set(
    ['acceptance'],
    (overrides.acceptance ?? ['AC-001-1']).map((acId) => ({
      id: acId,
      given: 'a real precondition',
      when: 'a real action',
      then: 'a real, observable result',
      kind: 'functional',
    })),
  );
  doc.set(['tests'], []);
  doc.set(['dod_profile'], overrides.dod_profile ?? 'backend-default');
  await writeArtifact(project.paths, doc);
  return id;
}

async function writeProfiles(project: TestProject, yaml: string): Promise<void> {
  const file = path.join(project.dir, KB_ROOT, 'engineering/dod-profiles.yaml');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, yaml, 'utf8');
}

const profileWithDone = (...done: readonly string[]): string =>
  `profiles:\n  backend-default:\n    ready: []\n    done:\n${done.map((entry) => `      - ${entry}`).join('\n')}\n`;

interface Call {
  readonly rule: string | undefined;
  readonly layers: readonly string[];
}

const persisted: boolean[] = [];
beforeEach(() => {
  persisted.length = 0;
});

/** A runner that records each call and answers from `answer`. */
function recorder(answer: (call: Call) => TestRunResult): {
  readonly runner: TestRunner;
  readonly calls: Call[];
} {
  const calls: Call[] = [];
  const runner: TestRunner = (ctx, options) => {
    // Recorded so a test can assert the shared report and flake history are never written to.
    persisted.push(ctx.persistState !== false);
    const call = { rule: options.rule, layers: Object.keys(ctx.testCommands) };
    calls.push(call);
    return Promise.resolve(answer(call));
  };
  return { runner, calls };
}

const CLEAN: TestRunResult = { failed: 0, errors: 0 };
/** A layer that ran and in which one test passed: the only clean answer a test layer can give. */
const LAYER_OK: TestRunResult = {
  failed: 0,
  errors: 0,
  outcomes: [{ name: 'a test', acId: undefined, status: 'pass' }],
};

function ctxFor(
  project: TestProject,
  testCommands: TestCommands = {},
  runTests?: TestRunner,
): StoryVerifyContext {
  return {
    paths: project.paths,
    projectRoot: project.dir,
    specsRoot: SPECS_ROOT,
    kbRoot: KB_ROOT,
    testCommands,
    ...(runTests !== undefined ? { runTests } : {}),
  };
}

async function verify(
  project: TestProject,
  testCommands: TestCommands = {},
  runTests?: TestRunner,
  storyId = 'STORY-001',
): Promise<StoryVerifyReport> {
  const outcome = await storyVerify(ctxFor(project, testCommands, runTests), storyId);
  if (outcome.kind !== 'verified')
    throw new Error(`expected a verified outcome, got ${outcome.kind}`);
  return outcome.report;
}

const statusOf = (report: StoryVerifyReport, check: string): string | undefined =>
  report.checks.find((entry) => entry.check === check)?.status;

const pass = (acId: string, name = `${acId} works`): TestOutcome => ({
  name,
  acId,
  status: 'pass',
});

describe('storyVerify: finding the story and its profile', () => {
  it('reports no-story for an id nothing defines', async () => {
    const project = await createTestProject();
    expect((await storyVerify(ctxFor(project), 'STORY-404')).kind).toBe('no-story');
  });

  it('reports not-a-story (with the reasons) for a document that has that id but is not a valid Story', async () => {
    const project = await createTestProject();
    await mkdir(path.join(project.dir, SPECS_ROOT, 'stories'), { recursive: true });
    await writeFile(
      path.join(project.dir, SPECS_ROOT, 'stories/STORY-009.md'),
      '---\nid: STORY-009\ntype: Story\n---\n\nBody.\n',
      'utf8',
    );
    const outcome = await storyVerify(ctxFor(project), 'STORY-009');
    expect(outcome.kind).toBe('not-a-story');
    if (outcome.kind === 'not-a-story') expect(outcome.problems.length).toBeGreaterThan(0);
  });

  it('a missing profiles file is one unverifiable (profile) check, never a pass', async () => {
    const project = await createTestProject();
    await writeStory(project);
    const report = await verify(project);
    expect(report.passed).toBe(false);
    expect(report.errors).toBe(1);
    expect(report.checks).toEqual([
      expect.objectContaining({ check: '(profile)', status: 'unverifiable' }),
    ]);
  });

  it('a malformed profiles file is the same, not a crash', async () => {
    const project = await createTestProject();
    await writeStory(project);
    await writeProfiles(project, 'profiles: [this is not a map');
    const report = await verify(project);
    expect(report.passed).toBe(false);
    expect(statusOf(report, '(profile)')).toBe('unverifiable');
  });

  it('a story naming a profile the file does not define is unverifiable', async () => {
    const project = await createTestProject();
    await writeStory(project, { dod_profile: 'data-default' });
    await writeProfiles(project, profileWithDone('story.acceptance.length > 0'));
    const report = await verify(project);
    expect(report.passed).toBe(false);
    expect(report.checks[0]?.message).toContain('data-default');
  });

  it('a profile whose done list is empty verified nothing: unverifiable, exit 1, never a vacuous pass', async () => {
    const project = await createTestProject();
    await writeStory(project);
    await writeProfiles(project, 'profiles:\n  backend-default:\n    ready: []\n    done: []\n');
    const report = await verify(project);
    expect(report.passed).toBe(false);
    expect(statusOf(report, '(profile)')).toBe('unverifiable');
    expect(report.checks[0]?.message).toContain('nothing was verified');
    expect(renderStoryVerify({ kind: 'verified', report }, false).exitCode).toBe(1);
  });

  it('a story naming an inherited Object property as its profile (constructor) is unverifiable, not a crash', async () => {
    const project = await createTestProject();
    await writeStory(project, { dod_profile: 'constructor' });
    await writeProfiles(project, profileWithDone("'story.acceptance.length > 0'"));
    const report = await verify(project);
    expect(report.passed).toBe(false);
    expect(statusOf(report, '(profile)')).toBe('unverifiable');
  });

  it('two documents claiming the same id cannot be verified: not-a-story, naming the collision', async () => {
    const project = await createTestProject();
    await writeStory(project);
    await mkdir(path.join(project.dir, SPECS_ROOT, 'stories'), { recursive: true });
    const first = path.join(project.dir, SPECS_ROOT, 'stories');
    await writeFile(
      path.join(first, 'duplicate.md'),
      '---\nid: STORY-001\ntype: Story\n---\n\nBody.\n',
      'utf8',
    );
    const outcome = await storyVerify(ctxFor(project), 'STORY-001');
    expect(outcome.kind).toBe('not-a-story');
    if (outcome.kind === 'not-a-story')
      expect(outcome.problems.join(' ')).toContain('share this id');
  });
});

describe('storyVerify: expressions and unknown ids', () => {
  it('evaluates a plain expression against the story: true passes, false fails', async () => {
    const project = await createTestProject();
    await writeStory(project);
    await writeProfiles(
      project,
      profileWithDone("'story.acceptance.length > 0'", "'story.files_expected.length > 5'"),
    );
    const report = await verify(project);
    expect(statusOf(report, 'story.acceptance.length > 0')).toBe('pass');
    expect(statusOf(report, 'story.files_expected.length > 5')).toBe('fail');
    expect(report.errors).toBe(1);
    expect(report.passed).toBe(false);
  });

  it('an id with no deterministic implementation is unverifiable (a distinct status), not passing', async () => {
    const project = await createTestProject();
    await writeStory(project);
    await writeProfiles(
      project,
      profileWithDone(
        '{ check: review:blocking-findings == 0 }',
        '{ check: security:secrets-scan }',
        '{ check: docs:public-api-documented }',
        '{ check: kb:no-new-contradictions }',
        '{ check: a-project-invented-check }',
      ),
    );
    const report = await verify(project);
    expect(report.checks.map((entry) => entry.status)).toEqual(Array(5).fill('unverifiable'));
    expect(report.passed).toBe(false);
    expect(report.errors).toBe(5);
    expect(report.checks[0]?.message).toContain('no deterministic implementation');
  });

  it('an expression entry and a check entry with the same text are judged separately', async () => {
    const project = await createTestProject();
    await writeStory(project);
    await writeProfiles(
      project,
      profileWithDone("'story.acceptance.length > 0'", "{ check: 'story.acceptance.length > 0' }"),
    );
    const report = await verify(project);
    expect(report.checks.map((entry) => entry.status)).toEqual(['pass', 'unverifiable']);
  });

  it('never throws when the runner does: that check is unverifiable and the rest still run', async () => {
    const project = await createTestProject();
    await writeStory(project);
    await writeProfiles(
      project,
      profileWithDone('{ check: build:lint }', "'story.acceptance.length > 0'"),
    );
    const runner: TestRunner = () => Promise.reject(new Error('spawn ENOENT'));
    const report = await verify(project, { lint: 'eslint .' }, runner);
    expect(statusOf(report, 'build:lint')).toBe('unverifiable');
    expect(report.checks[0]?.message).toContain('spawn ENOENT');
    expect(statusOf(report, 'story.acceptance.length > 0')).toBe('pass');
  });
});

describe('storyVerify: build and test checks', () => {
  it('build:lint and build:typecheck run the configured commands as test-run rules and map the answer', async () => {
    const project = await createTestProject();
    await writeStory(project);
    await writeProfiles(
      project,
      profileWithDone('{ check: build:typecheck }', '{ check: build:lint }'),
    );
    const { runner, calls } = recorder((call) =>
      call.rule === 'lint' ? { failed: 0, errors: 3 } : CLEAN,
    );
    const report = await verify(project, { typecheck: 'tsc', lint: 'eslint .' }, runner);
    expect(calls.map((call) => call.rule)).toEqual(['typecheck', 'lint']);
    expect(statusOf(report, 'build:typecheck')).toBe('pass');
    expect(statusOf(report, 'build:lint')).toBe('fail');
    expect(report.checks[1]?.message).toContain('3 diagnostics');
  });

  it('a check whose command is not configured is unverifiable and never calls the runner', async () => {
    const project = await createTestProject();
    await writeStory(project);
    await writeProfiles(
      project,
      profileWithDone('{ check: build:lint }', '{ check: test:unit --scope story }'),
    );
    const { runner, calls } = recorder(() => CLEAN);
    const report = await verify(project, {}, runner);
    expect(calls).toEqual([]);
    expect(report.checks.map((entry) => entry.status)).toEqual(['unverifiable', 'unverifiable']);
    expect(report.checks[0]?.message).toContain('execution.testCommands.lint');
  });

  it('test:<layer> runs only that layer, with the whole layer command, and says so when scoped', async () => {
    const project = await createTestProject();
    await writeStory(project);
    await writeProfiles(
      project,
      profileWithDone('{ check: test:unit --scope story }', '{ check: test:integration }'),
    );
    const { runner, calls } = recorder(() => LAYER_OK);
    const report = await verify(
      project,
      { unit: 'vitest unit', integration: 'vitest int', e2e: 'vitest e2e' },
      runner,
    );
    expect(calls).toEqual([
      { rule: undefined, layers: ['unit'] },
      { rule: undefined, layers: ['integration'] },
    ]);
    expect(report.passed).toBe(true);
    expect(report.checks[0]?.message).toContain('the whole layer ran');
    expect(report.checks[1]?.message).not.toContain('the whole layer ran');
    // Verifying a story must never write the project-wide report or flake history.
    expect(persisted.length).toBeGreaterThan(0);
    expect(persisted.every((persist) => !persist)).toBe(true);
  });

  it('a layer that fails is fail, and a layer that could not run is unverifiable: different statuses', async () => {
    const project = await createTestProject();
    await writeStory(project);
    await writeProfiles(project, profileWithDone('{ check: test:unit }', '{ check: test:e2e }'));
    const { runner } = recorder((call) =>
      call.layers[0] === 'unit'
        ? { failed: 2, errors: 0, outcomes: [{ name: 'a', acId: undefined, status: 'fail' }] }
        : {
            failed: 1,
            errors: 0,
            problems: ['testCommands.e2e ("x") ran but matched zero tests.'],
          },
    );
    const report = await verify(project, { unit: 'u', e2e: 'e' }, runner);
    expect(statusOf(report, 'test:unit')).toBe('fail');
    expect(statusOf(report, 'test:e2e')).toBe('unverifiable');
    expect(report.checks[1]?.message).toContain('matched zero tests');
  });

  it('a layer in which no test passed (all skipped, or none reported) verified nothing: unverifiable, not a pass', async () => {
    const project = await createTestProject();
    await writeStory(project);
    await writeProfiles(project, profileWithDone('{ check: test:unit }', '{ check: test:e2e }'));
    const { runner } = recorder((call) => ({
      ...CLEAN,
      outcomes:
        call.layers[0] === 'unit' ? [{ name: 'skipped one', acId: undefined, status: 'skip' }] : [],
    }));
    const report = await verify(project, { unit: 'u', e2e: 'e' }, runner);
    expect(statusOf(report, 'test:unit')).toBe('unverifiable');
    expect(statusOf(report, 'test:e2e')).toBe('unverifiable');
    expect(report.checks[0]?.message).toContain('no test passed');
    expect(report.passed).toBe(false);
  });

  it('a failing test names itself in the report (self-verify attaches output the implementer can act on)', async () => {
    const project = await createTestProject();
    await writeStory(project);
    await writeProfiles(project, profileWithDone('{ check: test:unit }'));
    const outcomes: TestOutcome[] = Array.from({ length: 7 }, (_, index) => ({
      name: `case ${String(index)} fails`,
      acId: undefined,
      status: 'fail',
    }));
    const { runner } = recorder(() => ({ failed: 7, errors: 0, outcomes }));
    const report = await verify(project, { unit: 'u' }, runner);
    const message = report.checks[0]?.message ?? '';
    expect(report.checks[0]?.status).toBe('fail');
    expect(message).toContain('7 failing');
    expect(message).toContain('case 0 fails');
    expect(message).toContain('case 4 fails');
    expect(message).not.toContain('case 5 fails');
    expect(message).toContain('and 2 more');
  });

  it('a failing test already quarantined as flaky is excluded from the layer (F-TEST-6) and the message says so', async () => {
    const project = await createTestProject();
    await writeStory(project);
    await writeProfiles(project, profileWithDone('{ check: test:unit }'));
    const { runner } = recorder(() => ({
      ...CLEAN,
      outcomes: [pass('AC-001-1'), { name: 'flaky one', acId: undefined, status: 'fail' }],
    }));
    const report = await verify(project, { unit: 'u' }, runner);
    expect(report.checks[0]?.status).toBe('pass');
    expect(report.checks[0]?.message).toContain('1 failing quarantined test excluded');
  });

  it('test:nfr is unverifiable: the default test run deliberately excludes the nightly NFR layer', async () => {
    const project = await createTestProject();
    await writeStory(project);
    await writeProfiles(project, profileWithDone('{ check: test:nfr }'));
    const { runner, calls } = recorder(() => CLEAN);
    const report = await verify(project, { nfr: 'k6 run' }, runner);
    expect(calls).toEqual([]);
    expect(statusOf(report, 'test:nfr')).toBe('unverifiable');
  });

  it('answers a repeated check id once', async () => {
    const project = await createTestProject();
    await writeStory(project);
    await writeProfiles(project, profileWithDone('{ check: test:unit }', '{ check: test:unit }'));
    const { runner, calls } = recorder(() => CLEAN);
    const report = await verify(project, { unit: 'u' }, runner);
    expect(calls).toHaveLength(1);
    expect(report.checks).toHaveLength(2);
  });
});

describe('storyVerify: spec:ac-coverage is per story', () => {
  it("passes when every one of this story's criteria has a passing bound test in the layers just run", async () => {
    const project = await createTestProject();
    await writeStory(project, { acceptance: ['AC-001-1', 'AC-001-2'] });
    await writeProfiles(
      project,
      profileWithDone(
        '{ check: test:unit }',
        '{ check: test:integration }',
        '{ check: spec:ac-coverage --story }',
      ),
    );
    // One criterion is proven by each layer: the check must see BOTH, not only the last layer's report.
    const { runner } = recorder((call) => ({
      ...CLEAN,
      outcomes: [call.layers[0] === 'unit' ? pass('AC-001-1') : pass('AC-001-2')],
    }));
    const report = await verify(project, { unit: 'u', integration: 'i' }, runner);
    expect(statusOf(report, 'spec:ac-coverage --story')).toBe('pass');
    expect(report.passed).toBe(true);
  });

  it('fails naming each criterion with no passing bound test, and ignores other stories criteria', async () => {
    const project = await createTestProject();
    await writeStory(project, { acceptance: ['AC-001-1', 'AC-001-2'] });
    await writeProfiles(
      project,
      profileWithDone('{ check: test:unit }', '{ check: spec:ac-coverage }'),
    );
    const { runner } = recorder(() => ({
      ...CLEAN,
      outcomes: [
        pass('AC-001-1'),
        { name: 'AC-001-2 broken', acId: 'AC-001-2', status: 'fail' },
        pass('AC-999-9'),
      ],
    }));
    const report = await verify(project, { unit: 'u' }, runner);
    const coverage = report.checks.find((entry) => entry.check === 'spec:ac-coverage');
    expect(coverage?.status).toBe('fail');
    expect(coverage?.message).toContain('AC-001-2');
    expect(coverage?.message).not.toContain('AC-001-1');
  });

  it('a story with no acceptance criteria fails the check', async () => {
    const project = await createTestProject();
    await writeStory(project, { acceptance: [] });
    await writeProfiles(project, profileWithDone('{ check: spec:ac-coverage }'));
    const report = await verify(project);
    expect(statusOf(report, 'spec:ac-coverage')).toBe('fail');
  });

  it('with no test layer in the profile it is unverifiable, even when an old report on disk says everything passed', async () => {
    const project = await createTestProject();
    await writeStory(project, { acceptance: ['AC-001-1'] });
    await writeProfiles(project, profileWithDone('{ check: spec:ac-coverage }'));
    await writeNormalizedReport(project.paths, { outcomes: [pass('AC-001-1')] });
    const report = await verify(project);
    expect(statusOf(report, 'spec:ac-coverage')).toBe('unverifiable');
    expect(report.passed).toBe(false);
  });

  it('does not depend on the order of the profile: coverage listed BEFORE its layer still sees that layer, and a stale report is ignored', async () => {
    const project = await createTestProject();
    await writeStory(project, { acceptance: ['AC-001-1'] });
    await writeProfiles(
      project,
      profileWithDone('{ check: spec:ac-coverage }', '{ check: test:unit }'),
    );
    // A stale on-disk report claims AC-001-1 passes; the layer just run has no test bound to it.
    await writeNormalizedReport(project.paths, { outcomes: [pass('AC-001-1')] });
    const { runner } = recorder(() => ({ ...CLEAN, outcomes: [pass('AC-002-1')] }));
    const report = await verify(project, { unit: 'u' }, runner);
    expect(statusOf(report, 'spec:ac-coverage')).toBe('fail');
    expect(statusOf(report, 'test:unit')).toBe('pass');
    expect(report.passed).toBe(false);
  });

  it('a criterion with one passing and one failing bound test is not covered', async () => {
    const project = await createTestProject();
    await writeStory(project, { acceptance: ['AC-001-1'] });
    await writeProfiles(
      project,
      profileWithDone('{ check: test:unit }', '{ check: spec:ac-coverage }'),
    );
    // A failing test can be quarantined (excluded from `failed`), so the layer passes; coverage must still not.
    const { runner } = recorder(() => ({
      ...CLEAN,
      outcomes: [
        pass('AC-001-1', 'AC-001-1 a'),
        { name: 'AC-001-1 b', acId: 'AC-001-1', status: 'fail' },
      ],
    }));
    const report = await verify(project, { unit: 'u' }, runner);
    expect(statusOf(report, 'test:unit')).toBe('pass');
    expect(statusOf(report, 'spec:ac-coverage')).toBe('fail');
    expect(report.checks[1]?.message).toContain('a bound test fails for AC-001-1');
  });

  it('a layer that returned problems (zero tests, unreadable state) makes coverage unverifiable, whatever its outcomes', async () => {
    const project = await createTestProject();
    await writeStory(project, { acceptance: ['AC-001-1'] });
    await writeProfiles(
      project,
      profileWithDone('{ check: test:unit }', '{ check: spec:ac-coverage }'),
    );
    // Not fail-open: the layer is not a pass either. Coverage is unverifiable, not "pass" on the outcomes it did see.
    const withPassing = recorder(() => ({
      failed: 1,
      errors: 0,
      outcomes: [pass('AC-001-1')],
      problems: ['could not read docs/forge/reports/flaky.json: unreadable'],
    }));
    const report = await verify(project, { unit: 'u' }, withPassing.runner);
    expect(statusOf(report, 'test:unit')).toBe('unverifiable');
    expect(statusOf(report, 'spec:ac-coverage')).toBe('unverifiable');
    expect(report.passed).toBe(false);

    const withNothing = recorder(() => ({
      failed: 1,
      errors: 0,
      problems: ['testCommands.unit ("u") ran but matched or collected zero tests.'],
    }));
    const nothing = await verify(project, { unit: 'u' }, withNothing.runner);
    expect(statusOf(nothing, 'spec:ac-coverage')).toBe('unverifiable');
  });

  it('a failing bound test is still a fail even when the layer also returned problems', async () => {
    const project = await createTestProject();
    await writeStory(project, { acceptance: ['AC-001-1'] });
    await writeProfiles(
      project,
      profileWithDone('{ check: test:unit }', '{ check: spec:ac-coverage }'),
    );
    const { runner } = recorder(() => ({
      failed: 1,
      errors: 0,
      outcomes: [{ name: 'AC-001-1 broken', acId: 'AC-001-1', status: 'fail' }],
      problems: ['could not write docs/forge/reports/flaky.json: read-only'],
    }));
    const report = await verify(project, { unit: 'u' }, runner);
    expect(statusOf(report, 'spec:ac-coverage')).toBe('fail');
  });

  it('when the only layer could not run at all, coverage is unverifiable rather than judged on nothing', async () => {
    const project = await createTestProject();
    await writeStory(project, { acceptance: ['AC-001-1'] });
    await writeProfiles(
      project,
      profileWithDone('{ check: test:unit }', '{ check: spec:ac-coverage }'),
    );
    const runner: TestRunner = () => Promise.reject(new Error('spawn ENOENT'));
    const report = await verify(project, { unit: 'u' }, runner);
    expect(statusOf(report, 'test:unit')).toBe('unverifiable');
    expect(statusOf(report, 'spec:ac-coverage')).toBe('unverifiable');
  });
});

describe('storyVerify: a real test command (real vitest, the real testRun)', () => {
  it('runs the configured unit command and binds a passing test to its criterion', async () => {
    const project = await createTestProject();
    await writeStory(project, { acceptance: ['AC-001-1'] });
    await writeProfiles(
      project,
      profileWithDone('{ check: test:unit }', '{ check: spec:ac-coverage }'),
    );
    const require = createRequire(import.meta.url);
    const vitestPackage = require.resolve('vitest/package.json');
    const bin = (require(vitestPackage) as { bin: Record<string, string> }).bin['vitest'];
    if (bin === undefined) throw new Error('vitest has no bin entry');
    const command = `${process.execPath} ${path.join(path.dirname(vitestPackage), bin)} run --root .`;
    await writeFile(path.join(project.dir, 'package.json'), '{}', 'utf8');
    await writeFile(
      path.join(project.dir, 'sample.test.js'),
      `import { test, expect } from 'vitest'; test('AC-001-1 adds', () => { expect(1 + 1).toBe(2); });`,
      'utf8',
    );

    // State a project already holds for OTHER layers: a whole-project report and a quarantined integration test.
    const integrationOutcome: TestOutcome = {
      name: 'AC-009-1 integration',
      acId: 'AC-009-1',
      status: 'pass',
    };
    await writeNormalizedReport(project.paths, { outcomes: [integrationOutcome] });
    await writeFlakyState(project.paths, {
      v: 1,
      tests: { 'AC-009-1 integration': { outcomes: ['pass', 'fail'], quarantined: true } },
    });
    const before = await Promise.all(
      ['test-results.json', 'flaky.json'].map((name) =>
        readFile(path.join(project.dir, 'docs/forge/reports', name), 'utf8'),
      ),
    );

    const report = await verify(project, { unit: command });
    expect(report.checks.map((entry) => entry.status)).toEqual(['pass', 'pass']);
    expect(report.passed).toBe(true);

    const after = await Promise.all(
      ['test-results.json', 'flaky.json'].map((name) =>
        readFile(path.join(project.dir, 'docs/forge/reports', name), 'utf8'),
      ),
    );
    expect(after, 'story verify rewrote the shared report or flake history').toEqual(before);

    await writeFile(
      path.join(project.dir, 'sample.test.js'),
      `import { test, expect } from 'vitest'; test('AC-001-1 adds', () => { expect(1 + 1).toBe(3); });`,
      'utf8',
    );
    const failing = await verify(project, { unit: command });
    expect(statusOf(failing, 'test:unit')).toBe('fail');
    expect(statusOf(failing, 'spec:ac-coverage')).toBe('fail');
    expect(failing.passed).toBe(false);
  }, 120_000);
});

describe('storyVerify: real vitest, a layer whose every test is skipped', () => {
  it('is unverifiable, and the verification exits not-passed', async () => {
    const project = await createTestProject();
    await writeStory(project, { acceptance: ['AC-001-1'] });
    await writeProfiles(project, profileWithDone('{ check: test:unit }'));
    const require = createRequire(import.meta.url);
    const vitestPackage = require.resolve('vitest/package.json');
    const bin = (require(vitestPackage) as { bin: Record<string, string> }).bin['vitest'];
    if (bin === undefined) throw new Error('vitest has no bin entry');
    const command = `${process.execPath} ${path.join(path.dirname(vitestPackage), bin)} run --root .`;
    await writeFile(path.join(project.dir, 'package.json'), '{}', 'utf8');
    await writeFile(
      path.join(project.dir, 'sample.test.js'),
      `import { describe, test, expect } from 'vitest'; describe.skip('all skipped', () => { test('AC-001-1 adds', () => { expect(1).toBe(1); }); });`,
      'utf8',
    );
    const report = await verify(project, { unit: command });
    expect(statusOf(report, 'test:unit')).toBe('unverifiable');
    expect(report.passed).toBe(false);
  }, 120_000);
});

describe('renderStoryVerify', () => {
  const verified = (report: StoryVerifyReport): StoryVerifyOutcome => ({
    kind: 'verified',
    report,
  });
  const base: StoryVerifyReport = {
    storyId: 'STORY-001',
    profile: 'backend-default',
    phase: 'done',
    passed: false,
    errors: 2,
    checks: [
      { check: 'build:lint', status: 'pass', message: 'ok' },
      { check: 'x', status: 'fail', message: 'bad' },
      { check: 'y', status: 'unverifiable', message: 'unknown' },
    ],
  };

  it('--json is one {v:1,...} object carrying a bare numeric errors, exit 1 when not passed', () => {
    const rendering = renderStoryVerify(verified(base), true);
    expect(rendering.exitCode).toBe(1);
    expect(JSON.parse(rendering.stdout ?? '')).toEqual({ v: 1, ...base });
  });

  it('exit 0 when passed, exit 2 for a story that cannot be found or read', () => {
    expect(renderStoryVerify(verified({ ...base, passed: true, errors: 0 }), true).exitCode).toBe(
      0,
    );
    expect(renderStoryVerify({ kind: 'no-story', storyId: 'S' }, false)).toMatchObject({
      exitCode: 2,
    });
    expect(
      renderStoryVerify({ kind: 'not-a-story', storyId: 'S', problems: ['x'] }, true).exitCode,
    ).toBe(2);
  });

  it('the text form marks each status and strips control characters from project-authored text', () => {
    const rendering = renderStoryVerify(
      verified({
        ...base,
        checks: [{ check: 'evil\u001b[31mcheck', status: 'fail', message: 'a\u0007b' }],
      }),
      false,
    );
    expect(rendering.stdout).toContain('FAIL');
    // eslint-disable-next-line no-control-regex -- asserting they are gone
    expect(rendering.stdout).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f]/);
  });

  it('--json output is cleaned too: JSON.stringify leaves C1, bidi, zero-width and separator characters raw', () => {
    const hostile = 'a\u009bb\u202ec\u200bd\u2028e\ufefff';
    const rendering = renderStoryVerify(
      verified({
        ...base,
        storyId: hostile,
        profile: hostile,
        checks: [{ check: hostile, status: 'fail', message: hostile }],
      }),
      true,
    );
    expect(rendering.stdout).not.toMatch(
      /[\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/,
    );
    const body = JSON.parse(rendering.stdout ?? '') as { checks: { check: string }[] };
    expect(body.checks[0]?.check).toBe('a b c d e f');
  });

  it('also strips C1 controls and bidirectional overrides, including from the story id in an error line', () => {
    const hostile = 'S\u009b31m\u202eTORY';
    const text = renderStoryVerify(
      verified({
        ...base,
        storyId: hostile,
        checks: [{ check: hostile, status: 'fail', message: hostile }],
      }),
      false,
    );
    expect(text.stdout).not.toMatch(/[\u009b\u202e]/);
    const missing = renderStoryVerify({ kind: 'no-story', storyId: hostile }, false);
    expect(missing.stderr).not.toMatch(/[\u009b\u202e]/);
  });
});
