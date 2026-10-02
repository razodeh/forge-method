/**
 * `assembleAndWriteEvidenceBundle` — `specs/22` M15 P7, against a real, throwaway project directory.
 * `evidenceBundleSchema` itself (and `evidence-bundle.ts`'s own doc comment) explain where each field
 * comes from; this file proves the real assembly, against real on-disk state and a real event log —
 * never a mock of `@forge/telemetry`/`@forge/schemas`.
 *
 * Every seeded `ArtifactCreated`/`UsageRecorded` event here uses `compileStepId('implement-story',
 * stepId)` — the real, bare, two-argument form a real `implement-story` run actually emits
 * (`implement-story` is never a fanout target or a subworkflow anywhere in this codebase, so it always
 * runs standalone, one story per `forge run`; `compileStepId`'s own `evidence-bundle.ts` doc comment
 * has the full reasoning, including a gauntlet round that caught an earlier version of both the
 * production code and this file making the identical wrong three-argument assumption together).
 *
 * @see specs/18-persistence-config-and-schemas.md §18.7
 * @see PLAN-M15.md P7
 * @see SPEC-QUESTIONS.md Q286
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ProjectPaths, writeNewFileAtomic, type Clock } from '@forge/core';
import { compileStepId } from '@forge/engine/plan';
import { evidenceBundleSchema } from '@forge/schemas';
import { appendEvent } from '@forge/telemetry/events';
import { afterEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';

import {
  assembleAndWriteEvidenceBundle,
  type AssembleEvidenceBundleInput,
  type EvidenceBundleCoverage,
  type EvidenceBundleVerify,
} from '../../../../src/commands/loop/test/evidence-bundle.ts';
import { appendExemption, qualifiedTestId } from '../../../../src/commands/loop/test/exemptions.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function freshProject(): Promise<{
  readonly paths: ProjectPaths;
  readonly projectRoot: string;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-evidence-bundle-'));
  dirs.push(dir);
  return { paths: new ProjectPaths(dir), projectRoot: dir };
}

function fakeClock(): Clock {
  return { now: () => '2026-09-30T12:00:00.000Z' };
}

function passingVerify(): EvidenceBundleVerify {
  return {
    phase: 'done',
    passed: true,
    errors: 0,
    checks: [{ check: 'unit tests pass', status: 'pass', message: 'ok' }],
  };
}

function cleanCoverage(): EvidenceBundleCoverage {
  return { acCoveragePercent: 100, ratchetRegressions: 0 };
}

/** Seeds a real `ArtifactCreated`/`ReviewReport` event for `runId`'s own event log, at the exact
 * compiled step id a real `review` step of an `implement-story` run uses — the bare, unqualified
 * `implement-story:review` (no per-story suffix: `runId` alone already scopes a real run to the one
 * story it concerns). */
async function writeReviewEvent(
  projectRoot: string,
  runId: string,
  verdict: 'blocked' | 'incomplete' | 'concerns' | 'clear' | undefined,
  id = 'REVIEW-001',
): Promise<void> {
  await appendEvent(projectRoot, runId, {
    ts: '2026-09-30T12:00:00.000Z',
    runId,
    type: 'ArtifactCreated',
    stepId: compileStepId('implement-story', 'review'),
    agentId: 'reviewer',
    payload: {
      type: 'ReviewReport',
      id,
      laneFile: `sessions/reviews/${id}.md`,
      ...(verdict === undefined ? {} : { verdict }),
      perspectives: [],
    },
  });
}

async function writeUsageEvent(
  projectRoot: string,
  runId: string,
  stepId: string,
  costUsd: number,
): Promise<void> {
  await appendEvent(projectRoot, runId, {
    ts: '2026-09-30T12:00:00.000Z',
    runId,
    type: 'UsageRecorded',
    stepId,
    agentId: 'implementer',
    payload: {
      model: 'fixture-model',
      platform: 'fixture',
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      costUsd,
      estimated: true,
      durationMs: 10,
    },
  });
}

function baseInput(
  paths: ProjectPaths,
  projectRoot: string,
  storyId: string,
  runId: string | undefined,
): AssembleEvidenceBundleInput {
  return {
    paths,
    projectRoot,
    reportsRoot: 'docs/forge/reports',
    storyId,
    runId,
    verify: passingVerify(),
    coverage: cleanCoverage(),
    clock: fakeClock(),
  };
}

describe('assembleAndWriteEvidenceBundle — the required kinds (PLAN-M15.md P7 "Tests first"/"Mutation evidence")', () => {
  it('a completed story yields a bundle referencing every required evidence kind', async () => {
    const { paths, projectRoot } = await freshProject();
    const runId = 'run-1';
    await writeReviewEvent(projectRoot, runId, 'clear');

    const written = await assembleAndWriteEvidenceBundle(
      baseInput(paths, projectRoot, 'STORY-014', runId),
    );

    expect(written.id).toMatch(/^EVID-\d{3}$/);
    const text = await readFile(paths.resolveWithin(written.path), 'utf8');
    const frontMatterText = text.split('---\n')[1] ?? '';
    const parsed = evidenceBundleSchema.safeParse(YAML.parse(frontMatterText));
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.story).toBe('STORY-014');
    expect(parsed.data.verify.checks).toHaveLength(1);
    expect(parsed.data.reviews).toEqual([{ id: 'REVIEW-001', verdict: 'clear' }]);
  });

  it('a missing kind is a typed failure naming which: zero reviews refuses with GATE-516 missing-review', async () => {
    const { paths, projectRoot } = await freshProject();
    await expect(
      assembleAndWriteEvidenceBundle(baseInput(paths, projectRoot, 'STORY-014', undefined)),
    ).rejects.toMatchObject({
      code: 'GATE-516',
      details: { storyId: 'STORY-014', reason: 'missing-review' },
    });
  });

  it('mutation evidence: omit the review verdict -- the required-kind test fails', async () => {
    const { paths, projectRoot } = await freshProject();
    const runId = 'run-1';
    await writeReviewEvent(projectRoot, runId, undefined);

    await expect(
      assembleAndWriteEvidenceBundle(baseInput(paths, projectRoot, 'STORY-014', runId)),
    ).rejects.toMatchObject({
      code: 'GATE-516',
      details: { storyId: 'STORY-014', reason: 'missing-review' },
    });
  });

  it("an 'incomplete' verdict refuses too, not only undefined -- the real engine lands neither at a merge (resolveSwarmReviewLanding treats incomplete and blocked identically)", async () => {
    const { paths, projectRoot } = await freshProject();
    const runId = 'run-1';
    await writeReviewEvent(projectRoot, runId, 'incomplete');

    await expect(
      assembleAndWriteEvidenceBundle(baseInput(paths, projectRoot, 'STORY-014', runId)),
    ).rejects.toMatchObject({
      code: 'GATE-516',
      details: { storyId: 'STORY-014', reason: 'missing-review' },
    });
  });

  it("a 'blocked' verdict refuses too -- defensive: the review step itself already fails on blocked, so this should rarely reach assembly, but the check does not rely on that", async () => {
    const { paths, projectRoot } = await freshProject();
    const runId = 'run-1';
    await writeReviewEvent(projectRoot, runId, 'blocked');

    await expect(
      assembleAndWriteEvidenceBundle(baseInput(paths, projectRoot, 'STORY-014', runId)),
    ).rejects.toMatchObject({
      code: 'GATE-516',
      details: { storyId: 'STORY-014', reason: 'missing-review' },
    });
  });

  it("a 'concerns' verdict is accepted (landable, same as clear)", async () => {
    const { paths, projectRoot } = await freshProject();
    const runId = 'run-1';
    await writeReviewEvent(projectRoot, runId, 'concerns');

    const written = await assembleAndWriteEvidenceBundle(
      baseInput(paths, projectRoot, 'STORY-014', runId),
    );
    expect(written.id).toMatch(/^EVID-\d{3}$/);
  });

  it('a malformed (null) event payload at the review step is skipped, not an uncaught crash -- degrades to the ordinary missing-review refusal', async () => {
    const { paths, projectRoot } = await freshProject();
    const runId = 'run-1';
    await appendEvent(projectRoot, runId, {
      ts: '2026-09-30T12:00:00.000Z',
      runId,
      type: 'ArtifactCreated',
      stepId: compileStepId('implement-story', 'review'),
      agentId: 'reviewer',
      payload: null,
    });

    await expect(
      assembleAndWriteEvidenceBundle(baseInput(paths, projectRoot, 'STORY-014', runId)),
    ).rejects.toMatchObject({
      code: 'GATE-516',
      details: { storyId: 'STORY-014', reason: 'missing-review' },
    });
  });

  it('a missing kind is a typed failure naming which: zero verify checks refuses with GATE-516 missing-verify', async () => {
    const { paths, projectRoot } = await freshProject();
    const runId = 'run-1';
    await writeReviewEvent(projectRoot, runId, 'clear');

    await expect(
      assembleAndWriteEvidenceBundle({
        ...baseInput(paths, projectRoot, 'STORY-014', runId),
        verify: { phase: 'done', passed: false, errors: 0, checks: [] },
      }),
    ).rejects.toMatchObject({
      code: 'GATE-516',
      details: { storyId: 'STORY-014', reason: 'missing-verify' },
    });
  });
});

describe('assembleAndWriteEvidenceBundle — the other kinds, each legitimately empty, never refused', () => {
  it('two concurrent stories, each its own real forge run, get distinct bundle ids', async () => {
    // `implement-story` always runs standalone, one story per `forge run` -- two concurrent stories
    // are two concurrent runs, each with its own `runId` and its own event log, not two stories
    // sharing one. This is the realistic shape; a single run's event log never holds two stories'
    // worth of events in the real system.
    const { paths, projectRoot } = await freshProject();
    await writeReviewEvent(projectRoot, 'run-a', 'clear');
    await writeReviewEvent(projectRoot, 'run-b', 'clear');

    const first = await assembleAndWriteEvidenceBundle(
      baseInput(paths, projectRoot, 'STORY-A', 'run-a'),
    );
    const second = await assembleAndWriteEvidenceBundle(
      baseInput(paths, projectRoot, 'STORY-B', 'run-b'),
    );

    expect(first.id).not.toBe(second.id);
    expect(first.path).not.toBe(second.path);
  });

  it('writes under a RECONFIGURED reportsRoot, not only the shipped default -- the real write the claim-matching test in test/command-steps-in-claim.test.ts assumes but does not itself produce', async () => {
    // `test/command-steps-in-claim.test.ts`'s own "lands inside its own claim under a RECONFIGURED
    // paths.reports" test proves the CLAIM side (the compiled `produces` glob) rewrites correctly, but
    // asserts against a hand-typed fixture path, not a path `assembleAndWriteEvidenceBundle` itself
    // actually produced -- this is the other half: the real function, called with a non-default
    // `reportsRoot`, writes exactly where that test assumes it does.
    const { paths, projectRoot } = await freshProject();
    const runId = 'run-1';
    await writeReviewEvent(projectRoot, runId, 'clear');

    const written = await assembleAndWriteEvidenceBundle({
      ...baseInput(paths, projectRoot, 'STORY-014', runId),
      reportsRoot: 'evidence-reports',
    });

    expect(written.path).toBe(`evidence-reports/evidence/${written.id}-STORY-014.md`);
    const text = await readFile(paths.resolveWithin(written.path), 'utf8');
    const parsed = evidenceBundleSchema.safeParse(YAML.parse(text.split('---\n')[1] ?? ''));
    expect(parsed.success).toBe(true);
  });

  it('the write itself refuses (RUN-114) a path that already exists, never silently overwriting -- the exact primitive assembleAndWriteEvidenceBundle calls', async () => {
    // EvidenceBundle's own id is globally sequential (the allocator never reuses one), so two REAL
    // calls to `assembleAndWriteEvidenceBundle` never naturally collide on the same path -- the
    // identical reasoning `MutationEvidence`'s own RUN-114 test does not apply here, since that
    // type's path is keyed on `{story}-{ts}`, not an incrementing id. What this test instead proves
    // is that the exact path a real assembly just used is, itself, refused by `writeNewFileAtomic`
    // (`RUN-114`) on a second write -- the one safety property `assembleAndWriteEvidenceBundle`
    // actually depends on, proven at the real path it really computed, not a hypothetical one.
    const { paths, projectRoot } = await freshProject();
    const runId = 'run-1';
    await writeReviewEvent(projectRoot, runId, 'clear');
    const written = await assembleAndWriteEvidenceBundle(
      baseInput(paths, projectRoot, 'STORY-014', runId),
    );

    await expect(
      writeNewFileAtomic(paths.resolveWithin(written.path), 'already here'),
    ).rejects.toMatchObject({ code: 'RUN-114' });
  });

  it('includes every MutationEvidence id already on disk for this story (front matter story field, not filename prefix)', async () => {
    const { paths, projectRoot } = await freshProject();
    const runId = 'run-1';
    await writeReviewEvent(projectRoot, runId, 'clear');
    await mkdir(paths.resolveWithin('docs/forge/reports/mutation'), { recursive: true });
    await writeFile(
      paths.resolveWithin('docs/forge/reports/mutation/STORY-014-2026-09-30T10-00-00.000Z.md'),
      `---\n${YAML.stringify({ id: 'MUT-001', story: 'STORY-014', type: 'MutationEvidence' })}---\n\nbody\n`,
    );
    await writeFile(
      paths.resolveWithin('docs/forge/reports/mutation/STORY-OTHER-2026-09-30T10-00-00.000Z.md'),
      `---\n${YAML.stringify({ id: 'MUT-002', story: 'STORY-OTHER', type: 'MutationEvidence' })}---\n\nbody\n`,
    );

    const written = await assembleAndWriteEvidenceBundle(
      baseInput(paths, projectRoot, 'STORY-014', runId),
    );
    const text = await readFile(paths.resolveWithin(written.path), 'utf8');
    const parsed = evidenceBundleSchema.safeParse(YAML.parse(text.split('---\n')[1] ?? ''));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.bindingEvidence).toEqual(['MUT-001']);
  });

  it('ignores a non-MutationEvidence file sitting in reports/mutation/', async () => {
    const { paths, projectRoot } = await freshProject();
    const runId = 'run-1';
    await writeReviewEvent(projectRoot, runId, 'clear');
    await mkdir(paths.resolveWithin('docs/forge/reports/mutation'), { recursive: true });
    await writeFile(
      paths.resolveWithin('docs/forge/reports/mutation/STORY-014-2026-09-30T10-00-00.000Z.md'),
      `---\n${YAML.stringify({ id: 'EVID-500', story: 'STORY-014', type: 'EvidenceBundle' })}---\n\nbody\n`,
    );

    const written = await assembleAndWriteEvidenceBundle(
      baseInput(paths, projectRoot, 'STORY-014', runId),
    );
    const text = await readFile(paths.resolveWithin(written.path), 'utf8');
    const parsed = evidenceBundleSchema.safeParse(YAML.parse(text.split('---\n')[1] ?? ''));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.bindingEvidence).toEqual([]);
  });

  it('includes nothing when reports/mutation/ does not exist (this story never ran forge test binding)', async () => {
    const { paths, projectRoot } = await freshProject();
    const runId = 'run-1';
    await writeReviewEvent(projectRoot, runId, 'clear');

    const written = await assembleAndWriteEvidenceBundle(
      baseInput(paths, projectRoot, 'STORY-014', runId),
    );
    const text = await readFile(paths.resolveWithin(written.path), 'utf8');
    const parsed = evidenceBundleSchema.safeParse(YAML.parse(text.split('---\n')[1] ?? ''));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.bindingEvidence).toEqual([]);
  });

  it('includes the single most recent GateReport per gate, project-wide, never scoped to this story', async () => {
    const { paths, projectRoot } = await freshProject();
    const runId = 'run-1';
    await writeReviewEvent(projectRoot, runId, 'clear');
    await mkdir(paths.resolveWithin('docs/forge/reports/gates'), { recursive: true });
    await writeFile(
      paths.resolveWithin('docs/forge/reports/gates/G-Verify-2026-09-30T08-00-00.000Z.md'),
      `---\n${YAML.stringify({ id: 'GATE-001', gate: 'G-Verify', outcome: 'failed', evaluatedAt: '2026-09-30T08:00:00.000Z', type: 'GateReport' })}---\n\nbody\n`,
    );
    await writeFile(
      paths.resolveWithin('docs/forge/reports/gates/G-Verify-2026-09-30T11-00-00.000Z.md'),
      `---\n${YAML.stringify({ id: 'GATE-002', gate: 'G-Verify', outcome: 'passed', evaluatedAt: '2026-09-30T11:00:00.000Z', type: 'GateReport' })}---\n\nbody\n`,
    );

    const written = await assembleAndWriteEvidenceBundle(
      baseInput(paths, projectRoot, 'STORY-014', runId),
    );
    const text = await readFile(paths.resolveWithin(written.path), 'utf8');
    const parsed = evidenceBundleSchema.safeParse(YAML.parse(text.split('---\n')[1] ?? ''));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.gates).toEqual([{ id: 'GATE-002', gate: 'G-Verify', outcome: 'passed' }]);
    }
  });

  it('ignores a non-GateReport file sitting in reports/gates/', async () => {
    const { paths, projectRoot } = await freshProject();
    const runId = 'run-1';
    await writeReviewEvent(projectRoot, runId, 'clear');
    await mkdir(paths.resolveWithin('docs/forge/reports/gates'), { recursive: true });
    await writeFile(
      paths.resolveWithin('docs/forge/reports/gates/G-Verify-2026-09-30T08-00-00.000Z.md'),
      `---\n${YAML.stringify({ id: 'EVID-501', gate: 'G-Verify', outcome: 'passed', evaluatedAt: '2026-09-30T08:00:00.000Z', type: 'EvidenceBundle' })}---\n\nbody\n`,
    );

    const written = await assembleAndWriteEvidenceBundle(
      baseInput(paths, projectRoot, 'STORY-014', runId),
    );
    const text = await readFile(paths.resolveWithin(written.path), 'utf8');
    const parsed = evidenceBundleSchema.safeParse(YAML.parse(text.split('---\n')[1] ?? ''));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.gates).toEqual([]);
  });

  it('includes only exemptions qualified under this story, by id', async () => {
    const { paths, projectRoot } = await freshProject();
    const runId = 'run-1';
    await writeReviewEvent(projectRoot, runId, 'clear');
    const clock = fakeClock();
    const mine = await appendExemption(
      paths,
      'docs/forge/reports',
      clock,
      {
        testId: qualifiedTestId('STORY-014', 'flaky under mutation'),
        reason: 'genuinely cannot be mutation-bound',
        owner: 'alice',
        expiry: '2099-01-01',
      },
      { projectRoot, runId: undefined },
    );
    await appendExemption(
      paths,
      'docs/forge/reports',
      clock,
      {
        testId: qualifiedTestId('STORY-OTHER', 'a different story'),
        reason: 'genuinely cannot be mutation-bound',
        owner: 'bob',
        expiry: '2099-01-01',
      },
      { projectRoot, runId: undefined },
    );

    const written = await assembleAndWriteEvidenceBundle(
      baseInput(paths, projectRoot, 'STORY-014', runId),
    );
    const text = await readFile(paths.resolveWithin(written.path), 'utf8');
    const parsed = evidenceBundleSchema.safeParse(YAML.parse(text.split('---\n')[1] ?? ''));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.exemptions).toEqual([mine]);
  });

  it('computes cost from attributedSpend summed across every real step id this run recorded', async () => {
    const { paths, projectRoot } = await freshProject();
    const runId = 'run-1';
    await writeReviewEvent(projectRoot, runId, 'clear');
    await writeUsageEvent(projectRoot, runId, compileStepId('implement-story', 'plan'), 1.5);
    await writeUsageEvent(projectRoot, runId, compileStepId('implement-story', 'green'), 2.25);

    const written = await assembleAndWriteEvidenceBundle(
      baseInput(paths, projectRoot, 'STORY-014', runId),
    );
    const text = await readFile(paths.resolveWithin(written.path), 'utf8');
    const parsed = evidenceBundleSchema.safeParse(YAML.parse(text.split('---\n')[1] ?? ''));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.cost.totalUsd).toBeCloseTo(3.75);
      expect(parsed.data.cost.estimated).toBe(true);
    }
  });

  it("a DIFFERENT run's own spend, even on an identically-named step, is never summed into this run's cost", async () => {
    // `attributedSpend` scopes by compiled step id WITHIN the entries this one run's own event log
    // produced (`projectLedger(readEvents(projectRoot, runId))` reads only `runId`'s own log file) --
    // this proves a second run's spend on the identical `implement-story:plan` step id never leaks in,
    // the real isolation this piece actually depends on (per-run event logs), not a per-story itemKey.
    const { paths, projectRoot } = await freshProject();
    await writeReviewEvent(projectRoot, 'run-1', 'clear');
    await writeUsageEvent(projectRoot, 'run-1', compileStepId('implement-story', 'plan'), 1.5);
    await writeUsageEvent(projectRoot, 'run-2', compileStepId('implement-story', 'plan'), 100);

    const written = await assembleAndWriteEvidenceBundle(
      baseInput(paths, projectRoot, 'STORY-014', 'run-1'),
    );
    const text = await readFile(paths.resolveWithin(written.path), 'utf8');
    const parsed = evidenceBundleSchema.safeParse(YAML.parse(text.split('---\n')[1] ?? ''));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.cost.totalUsd).toBeCloseTo(1.5);
  });

  it('no FORGE_RUN_ID means no event log to find a review in -- refused with GATE-516 missing-review, never a bare crash', async () => {
    // `runId === undefined` makes `reviews`/`cost` both unknowable (neither has any state to read
    // outside a real run's own event log) -- `findReviewsThisRun` reports `[]`, which is itself the
    // required-kind refusal already proven above. This test exists to document that consequence
    // explicitly, not to re-prove the refusal mechanism.
    const { paths, projectRoot } = await freshProject();
    await expect(
      assembleAndWriteEvidenceBundle(baseInput(paths, projectRoot, 'STORY-014', undefined)),
    ).rejects.toMatchObject({ code: 'GATE-516', details: { reason: 'missing-review' } });
  });
});
