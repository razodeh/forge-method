/**
 * `forge report` — a pure projection of M15 P11's own real telemetry into the milestone scorecard.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Clock } from '@forge/core';
import { appendEvent, type NewForgeEvent } from '@forge/telemetry/events';

import {
  buildReport,
  readBaseline,
  writeBaseline,
  type ReportCommandContext,
} from '../../src/commands/report.ts';
import { cleanupAll, createTestProject } from './upgrade/helpers.ts';

afterEach(cleanupAll);

function fakeClock(now = '2026-09-30T12:00:00.000Z'): Clock {
  return { now: () => now };
}

function contextFor(dir: string, paths: ReportCommandContext['paths']): ReportCommandContext {
  return {
    paths,
    projectRoot: dir,
    reportsRoot: 'docs/forge/reports',
    clock: fakeClock(),
  };
}

function bindingEvent(
  overrides: Partial<NewForgeEvent> = {},
  payloadOverrides: Record<string, unknown> = {},
): NewForgeEvent {
  return {
    ts: '2026-01-01T00:00:00.000Z',
    runId: 'run-1',
    type: 'CheckRun',
    payload: {
      kind: 'binding',
      storyId: 'STORY-001',
      testsNamed: 3,
      bound: 3,
      nonBinding: 0,
      exempted: 0,
      ...payloadOverrides,
    },
    ...overrides,
  };
}

describe('buildReport — metric 1, binding pass rate / non-binding count per story', () => {
  it('reports real zeroes, never throws, for a project with no real runs at all', async () => {
    const project = await createTestProject();
    const ctx = contextFor(project.dir, project.paths);

    const report = await buildReport(ctx);

    expect(report.binding).toEqual({ stories: [], passingCount: 0, totalCount: 0, passRate: 0 });
  });

  it('yields exact numbers for a single real CheckRun{kind:"binding"} occurrence', async () => {
    const project = await createTestProject();
    await appendEvent(project.dir, 'run-1', bindingEvent());

    const report = await buildReport(contextFor(project.dir, project.paths));

    expect(report.binding).toEqual({
      stories: [
        {
          storyId: 'STORY-001',
          testsNamed: 3,
          bound: 3,
          nonBinding: 0,
          exempted: 0,
          passing: true,
        },
      ],
      passingCount: 1,
      totalCount: 1,
      passRate: 1,
    });
  });

  it('a story with uncovered non-binding tests is not passing', async () => {
    const project = await createTestProject();
    await appendEvent(
      project.dir,
      'run-1',
      bindingEvent({}, { testsNamed: 3, bound: 2, nonBinding: 1, exempted: 0 }),
    );

    const report = await buildReport(contextFor(project.dir, project.paths));

    expect(report.binding.passingCount).toBe(0);
    expect(report.binding.stories[0]?.passing).toBe(false);
  });

  it('a non-binding test fully covered by a currently-valid exemption still counts as passing', async () => {
    const project = await createTestProject();
    await appendEvent(
      project.dir,
      'run-1',
      bindingEvent({}, { testsNamed: 3, bound: 2, nonBinding: 1, exempted: 1 }),
    );

    const report = await buildReport(contextFor(project.dir, project.paths));

    expect(report.binding.stories[0]?.passing).toBe(true);
  });

  it(
    "computes the pass rate over STORIES, not over every real occurrence — the Mandate's own named " +
      'mutation: a story checked twice (fail, then pass) across two separate real runs is one story, ' +
      'passing, not 50% — this is the exact property that must fail if the rate were computed over ' +
      'attempts instead',
    async () => {
      const project = await createTestProject();
      // Run 1: fails.
      await appendEvent(
        project.dir,
        'run-1',
        bindingEvent(
          { runId: 'run-1', ts: '2026-01-01T00:00:00.000Z' },
          { testsNamed: 3, bound: 2, nonBinding: 1, exempted: 0 },
        ),
      );
      // Run 2, later: the SAME story, now passing.
      await appendEvent(
        project.dir,
        'run-2',
        bindingEvent(
          { runId: 'run-2', ts: '2026-01-02T00:00:00.000Z' },
          { testsNamed: 3, bound: 3, nonBinding: 0, exempted: 0 },
        ),
      );

      const report = await buildReport(contextFor(project.dir, project.paths));

      // One story, currently passing -- a per-ATTEMPT rate would report 1/2 (50%); the correct,
      // per-STORY rate is 1/1 (100%), since only the latest real occurrence reflects current state.
      expect(report.binding.totalCount).toBe(1);
      expect(report.binding.passingCount).toBe(1);
      expect(report.binding.passRate).toBe(1);
    },
  );

  it('two distinct stories are reported separately, sorted by storyId', async () => {
    const project = await createTestProject();
    await appendEvent(project.dir, 'run-1', bindingEvent({}, { storyId: 'STORY-002' }));
    await appendEvent(project.dir, 'run-1', bindingEvent({}, { storyId: 'STORY-001' }));

    const report = await buildReport(contextFor(project.dir, project.paths));

    expect(report.binding.stories.map((story) => story.storyId)).toEqual([
      'STORY-001',
      'STORY-002',
    ]);
  });
});

describe('buildReport — metric 2, critic rounds consumed / stop-and-disclose occurrences', () => {
  it('counts every real StepProgress{kind:"critic-round"} occurrence, across every run, with no dedup', async () => {
    const project = await createTestProject();
    const progress = (runId: string, round: number): NewForgeEvent => ({
      ts: '2026-01-01T00:00:00.000Z',
      runId,
      type: 'StepProgress',
      payload: {
        kind: 'critic-round',
        round,
        reportId: 'REVIEW-001',
        verdict: 'blocked',
        blockingCount: 1,
      },
    });
    await appendEvent(project.dir, 'run-1', progress('run-1', 1));
    await appendEvent(project.dir, 'run-1', progress('run-1', 2));
    await appendEvent(project.dir, 'run-2', progress('run-2', 1));

    const report = await buildReport(contextFor(project.dir, project.paths));

    expect(report.criticLoop.roundsConsumed).toBe(3);
  });

  it('counts every real terminal RUN-113 StepFailed occurrence, across every run', async () => {
    const project = await createTestProject();
    const stopAndDisclose = (runId: string): NewForgeEvent => ({
      ts: '2026-01-01T00:00:00.000Z',
      runId,
      type: 'StepFailed',
      payload: {
        source: 'output',
        code: 'RUN-113',
        message: 'exhausted',
        cause: { code: 'RUN-113', details: { stepId: 'review', file: 'x', rounds: 3, count: 1 } },
      },
    });
    await appendEvent(project.dir, 'run-1', stopAndDisclose('run-1'));
    await appendEvent(project.dir, 'run-2', stopAndDisclose('run-2'));

    const report = await buildReport(contextFor(project.dir, project.paths));

    expect(report.criticLoop.stopAndDiscloseCount).toBe(2);
  });

  it('a real, ordinary StepFailed with a DIFFERENT code is not counted as a stop-and-disclose', async () => {
    const project = await createTestProject();
    await appendEvent(project.dir, 'run-1', {
      ts: '2026-01-01T00:00:00.000Z',
      runId: 'run-1',
      type: 'StepFailed',
      payload: { source: 'command', code: 'RUN-001', message: 'ordinary failure' },
    });

    const report = await buildReport(contextFor(project.dir, project.paths));

    expect(report.criticLoop.stopAndDiscloseCount).toBe(0);
  });
});

describe('buildReport — metric 3, gate failures before first pass, per (runId, gateId)', () => {
  function gateEvent(
    type: 'GateRejected' | 'GateApproved' | 'GateWaived',
    runId: string,
    gateId: string,
  ): NewForgeEvent {
    return { ts: '2026-01-01T00:00:00.000Z', runId, type, payload: { gateId } };
  }

  it('a gate approved on its first evaluation is a clean first pass with zero rejections', async () => {
    const project = await createTestProject();
    await appendEvent(project.dir, 'run-1', gateEvent('GateApproved', 'run-1', 'G-Verify'));

    const report = await buildReport(contextFor(project.dir, project.paths));

    expect(report.gates).toMatchObject({
      pairsEvaluated: 1,
      pairsWithCleanFirstPass: 1,
      totalRejectionsBeforeFirstPass: 0,
    });
  });

  it('two real rejections before a real approval, within the same run, are both counted', async () => {
    const project = await createTestProject();
    await appendEvent(project.dir, 'run-1', gateEvent('GateRejected', 'run-1', 'G-Verify'));
    await appendEvent(project.dir, 'run-1', gateEvent('GateRejected', 'run-1', 'G-Verify'));
    await appendEvent(project.dir, 'run-1', gateEvent('GateApproved', 'run-1', 'G-Verify'));

    const report = await buildReport(contextFor(project.dir, project.paths));

    expect(report.gates).toMatchObject({
      pairsEvaluated: 1,
      pairsWithCleanFirstPass: 0,
      totalRejectionsBeforeFirstPass: 2,
    });
  });

  it('a real GateWaived also counts as reaching first pass', async () => {
    const project = await createTestProject();
    await appendEvent(project.dir, 'run-1', gateEvent('GateRejected', 'run-1', 'G-Verify'));
    await appendEvent(project.dir, 'run-1', gateEvent('GateWaived', 'run-1', 'G-Verify'));

    const report = await buildReport(contextFor(project.dir, project.paths));

    expect(report.gates).toMatchObject({
      pairsWithCleanFirstPass: 0,
      totalRejectionsBeforeFirstPass: 1,
    });
  });

  it('the SAME gate id re-evaluated in a DIFFERENT real run is a separate pair, not conflated', async () => {
    const project = await createTestProject();
    await appendEvent(project.dir, 'run-1', gateEvent('GateRejected', 'run-1', 'G-Verify'));
    await appendEvent(project.dir, 'run-1', gateEvent('GateApproved', 'run-1', 'G-Verify'));
    await appendEvent(project.dir, 'run-2', gateEvent('GateApproved', 'run-2', 'G-Verify'));

    const report = await buildReport(contextFor(project.dir, project.paths));

    expect(report.gates).toMatchObject({
      pairsEvaluated: 2,
      pairsWithCleanFirstPass: 1,
      totalRejectionsBeforeFirstPass: 1,
    });
  });
});

describe('buildReport — metric 4, exemptions opened / expired', () => {
  it('counts every real CheckRun{kind:"exemption-declared"} occurrence, no dedup', async () => {
    const project = await createTestProject();
    const declared = (id: string): NewForgeEvent => ({
      ts: '2026-01-01T00:00:00.000Z',
      runId: 'run-1',
      type: 'CheckRun',
      payload: {
        kind: 'exemption-declared',
        exemptionId: id,
        testId: 'T1',
        owner: 'alice',
        expiry: '2026-12-31',
      },
    });
    await appendEvent(project.dir, 'run-1', declared('EXEMPT-001'));
    await appendEvent(project.dir, 'run-1', declared('EXEMPT-002'));

    const report = await buildReport(contextFor(project.dir, project.paths));

    expect(report.exemptions.opened).toBe(2);
  });

  it('a distinct exemption id discovered expired by TWO separate real checks is counted ONCE', async () => {
    const project = await createTestProject();
    await appendEvent(
      project.dir,
      'run-1',
      bindingEvent({ runId: 'run-1' }, { expiredExemptionIds: ['EXEMPT-001'] }),
    );
    await appendEvent(
      project.dir,
      'run-2',
      bindingEvent(
        { runId: 'run-2', ts: '2026-01-02T00:00:00.000Z' },
        { expiredExemptionIds: ['EXEMPT-001'] },
      ),
    );

    const report = await buildReport(contextFor(project.dir, project.paths));

    expect(report.exemptions.expiredIds).toEqual(['EXEMPT-001']);
  });

  it('two DIFFERENT exemption ids discovered expired are both named', async () => {
    const project = await createTestProject();
    await appendEvent(
      project.dir,
      'run-1',
      bindingEvent({}, { expiredExemptionIds: ['EXEMPT-002', 'EXEMPT-001'] }),
    );

    const report = await buildReport(contextFor(project.dir, project.paths));

    expect(report.exemptions.expiredIds).toEqual(['EXEMPT-001', 'EXEMPT-002']);
  });
});

describe('buildReport — metric 5, real cost per delivered story', () => {
  function usageEvent(runId: string, storyId: string | undefined, costUsd: number): NewForgeEvent {
    return {
      ts: '2026-01-01T00:00:00.000Z',
      runId,
      type: 'UsageRecorded',
      stepId: 'build-stage:implement:some-item',
      agentId: 'engineer',
      payload: {
        model: 'm',
        platform: 'anthropic',
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        costUsd,
        estimated: false,
        durationMs: 1,
        ...(storyId === undefined ? {} : { storyId }),
      },
    };
  }

  it('sums real cost across EVERY real attempt for one story — including a wasted retry, not just the last', async () => {
    const project = await createTestProject();
    await appendEvent(project.dir, 'run-1', usageEvent('run-1', 'STORY-001', 2));
    await appendEvent(project.dir, 'run-1', usageEvent('run-1', 'STORY-001', 3)); // a retry, both real spend

    const report = await buildReport(contextFor(project.dir, project.paths));

    expect(report.cost.byStory).toEqual([{ storyId: 'STORY-001', totalUsd: 5 }]);
    expect(report.cost.totalUsd).toBe(5);
  });

  it('a real UsageRecorded event with no storyId at all (freeze-contracts, standup, ...) is not counted toward any story', async () => {
    const project = await createTestProject();
    await appendEvent(project.dir, 'run-1', usageEvent('run-1', undefined, 10));

    const report = await buildReport(contextFor(project.dir, project.paths));

    expect(report.cost.byStory).toEqual([]);
    expect(report.cost.totalUsd).toBe(0);
  });

  it('sums across two DIFFERENT real runs for the same story', async () => {
    const project = await createTestProject();
    await appendEvent(project.dir, 'run-1', usageEvent('run-1', 'STORY-001', 1));
    await appendEvent(project.dir, 'run-2', usageEvent('run-2', 'STORY-001', 1));

    const report = await buildReport(contextFor(project.dir, project.paths));

    expect(report.cost.byStory).toEqual([{ storyId: 'STORY-001', totalUsd: 2 }]);
  });
});

describe('buildReport — metric 6, KB reads preceding a decision artifact', () => {
  function kbRead(runId: string, stepId: string): NewForgeEvent {
    return {
      ts: '2026-01-01T00:00:00.000Z',
      runId,
      stepId,
      type: 'SessionEvent',
      payload: { kind: 'kb-read', source: 'static', ids: ['kb:glossary.md'] },
    };
  }
  function artifactCreated(runId: string, stepId: string): NewForgeEvent {
    return {
      ts: '2026-01-01T00:00:01.000Z',
      runId,
      stepId,
      type: 'ArtifactCreated',
      payload: {
        type: 'ReviewReport',
        id: 'REVIEW-001',
        laneFile: 'x',
        verdict: 'clear',
        perspectives: [],
      },
    };
  }

  it('an artifact preceded, in the SAME step and run, by a real KB read counts as preceded', async () => {
    const project = await createTestProject();
    await appendEvent(project.dir, 'run-1', kbRead('run-1', 'review'));
    await appendEvent(project.dir, 'run-1', artifactCreated('run-1', 'review'));

    const report = await buildReport(contextFor(project.dir, project.paths));

    expect(report.kbReads).toEqual({ artifactsCreated: 1, precededByKbRead: 1, rate: 1 });
  });

  it('an artifact with NO preceding KB read in its own step does not count as preceded', async () => {
    const project = await createTestProject();
    await appendEvent(project.dir, 'run-1', artifactCreated('run-1', 'review'));

    const report = await buildReport(contextFor(project.dir, project.paths));

    expect(report.kbReads).toEqual({ artifactsCreated: 1, precededByKbRead: 0, rate: 0 });
  });

  it('a KB read in a DIFFERENT run does not count toward an artifact in this run, even with the same stepId', async () => {
    const project = await createTestProject();
    await appendEvent(project.dir, 'run-1', kbRead('run-1', 'review'));
    await appendEvent(project.dir, 'run-2', artifactCreated('run-2', 'review'));

    const report = await buildReport(contextFor(project.dir, project.paths));

    expect(report.kbReads).toEqual({ artifactsCreated: 1, precededByKbRead: 0, rate: 0 });
  });

  it('a KB read AFTER the artifact (same run, same step) does not count as preceding it', async () => {
    const project = await createTestProject();
    await appendEvent(project.dir, 'run-1', artifactCreated('run-1', 'review'));
    await appendEvent(project.dir, 'run-1', kbRead('run-1', 'review'));

    const report = await buildReport(contextFor(project.dir, project.paths));

    expect(report.kbReads.precededByKbRead).toBe(0);
  });
});

describe('buildReport — forward compatibility: an unrecognised kind/code is skipped, never miscounted, never fatal', () => {
  it(
    'a CheckRun with a future, unrecognised "kind" does not crash the read and does not get counted ' +
      'as either known kind — every OTHER real, recognised event in the same log is still counted correctly',
    async () => {
      const project = await createTestProject();
      // Deliberately carries every field a real `binding` payload has (so a projector that forgot
      // to check `kind` at all — and relied on field shape alone — would still misread this as one),
      // differing ONLY in `kind` itself.
      await appendEvent(
        project.dir,
        'run-1',
        bindingEvent(
          {},
          { kind: 'some-future-kind-this-piece-does-not-know-about', storyId: 'STORY-999' },
        ),
      );
      await appendEvent(project.dir, 'run-1', bindingEvent());

      const report = await buildReport(contextFor(project.dir, project.paths));

      expect(report.binding.totalCount).toBe(1);
      expect(report.binding.stories[0]?.storyId).toBe('STORY-001');
      expect(report.exemptions.opened).toBe(0);
    },
  );

  it('a wholly unrecognised EventType string does not crash the read', async () => {
    const project = await createTestProject();
    await appendEvent(project.dir, 'run-1', {
      ts: '2026-01-01T00:00:00.000Z',
      runId: 'run-1',
      // A future EventType this piece's own union does not list yet -- readEvents itself does zero
      // schema/type validation (events.ts's own parseEventLine only checks `typeof type === 'string'`).
      type: 'SomeFutureEventType' as never,
      payload: {},
    });
    await appendEvent(project.dir, 'run-1', bindingEvent());

    const report = await buildReport(contextFor(project.dir, project.paths));

    expect(report.binding.totalCount).toBe(1);
  });

  it('a StepProgress with a different, real kind ("fix-round" say) is never counted as a critic round', async () => {
    const project = await createTestProject();
    await appendEvent(project.dir, 'run-1', {
      ts: '2026-01-01T00:00:00.000Z',
      runId: 'run-1',
      stepId: 'review',
      type: 'StepProgress',
      payload: { kind: 'some-other-real-progress-kind', detail: 'not a critic round' },
    });
    await appendEvent(project.dir, 'run-1', {
      ts: '2026-01-01T00:00:01.000Z',
      runId: 'run-1',
      stepId: 'review',
      type: 'StepProgress',
      payload: { kind: 'critic-round', round: 1, reportId: 'REVIEW-001', verdict: 'clear' },
    });

    const report = await buildReport(contextFor(project.dir, project.paths));

    expect(report.criticLoop.roundsConsumed).toBe(1);
  });

  it('a CheckRun{kind:"binding"} (a real, different, already-recognised kind) is never counted as an exemption declaration', async () => {
    const project = await createTestProject();
    await appendEvent(project.dir, 'run-1', bindingEvent());
    await appendEvent(project.dir, 'run-1', {
      ts: '2026-01-01T00:00:01.000Z',
      runId: 'run-1',
      type: 'CheckRun',
      payload: {
        kind: 'exemption-declared',
        exemptionId: 'EX-001',
        testId: 'STORY-001#t1',
        owner: 'alice',
        expiry: '2026-12-31',
      },
    });

    const report = await buildReport(contextFor(project.dir, project.paths));

    expect(report.exemptions.opened).toBe(1);
    expect(report.binding.totalCount).toBe(1);
  });

  it(
    'a real, already-shipped SessionEvent{kind:"context-request"} (M14 P44 context expansion) in the ' +
      'SAME step and run as a real artifact is never miscounted as a KB read preceding it -- the one ' +
      'live collision this metric must never conflate, since SessionEvent already carries two real, ' +
      'independently-shipped payload shapes on the identical EventType',
    async () => {
      const project = await createTestProject();
      await appendEvent(project.dir, 'run-1', {
        ts: '2026-01-01T00:00:00.000Z',
        runId: 'run-1',
        stepId: 'review',
        type: 'SessionEvent',
        payload: { kind: 'context-request', query: 'ADR-003', served: true },
      });
      await appendEvent(project.dir, 'run-1', {
        ts: '2026-01-01T00:00:01.000Z',
        runId: 'run-1',
        stepId: 'review',
        type: 'ArtifactCreated',
        payload: {
          type: 'ReviewReport',
          id: 'REVIEW-001',
          laneFile: 'x',
          verdict: 'clear',
          perspectives: [],
        },
      });

      const report = await buildReport(contextFor(project.dir, project.paths));

      expect(report.kbReads).toEqual({ artifactsCreated: 1, precededByKbRead: 0, rate: 0 });
    },
  );
});

describe('buildReport — --since filters', () => {
  it('excludes an event strictly before the cutoff, includes one exactly at it', async () => {
    const project = await createTestProject();
    await appendEvent(
      project.dir,
      'run-1',
      bindingEvent({ ts: '2025-12-31T23:59:59.999Z', runId: 'run-1' }, { storyId: 'STORY-OLD' }),
    );
    await appendEvent(
      project.dir,
      'run-1',
      bindingEvent({ ts: '2026-01-01T00:00:00.000Z', runId: 'run-1' }, { storyId: 'STORY-NEW' }),
    );

    const report = await buildReport(contextFor(project.dir, project.paths), {
      since: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(report.binding.stories.map((s) => s.storyId)).toEqual(['STORY-NEW']);
  });

  it('a project filtered down to nothing reports real zeroes, not a crash', async () => {
    const project = await createTestProject();
    await appendEvent(project.dir, 'run-1', bindingEvent());

    const report = await buildReport(contextFor(project.dir, project.paths), {
      since: new Date('2099-01-01T00:00:00.000Z'),
    });

    expect(report.binding.totalCount).toBe(0);
  });

  it('filters ALL SIX metrics, not just binding -- a single old event per metric is excluded uniformly', async () => {
    const project = await createTestProject();
    const dir = project.dir;
    const OLD = '2025-12-31T23:59:59.999Z';
    const CUTOFF = '2026-01-01T00:00:00.000Z';
    await appendEvent(
      dir,
      'run-1',
      bindingEvent({ ts: OLD, runId: 'run-1' }, { storyId: 'STORY-OLD' }),
    );
    await appendEvent(dir, 'run-1', {
      ts: OLD,
      runId: 'run-1',
      stepId: 'review',
      type: 'StepProgress',
      payload: { kind: 'critic-round', round: 1, reportId: 'REVIEW-OLD', verdict: 'clear' },
    });
    await appendEvent(dir, 'run-1', {
      ts: OLD,
      runId: 'run-1',
      type: 'GateRejected',
      payload: { gateId: 'G-OLD', reason: 'x' },
    });
    await appendEvent(dir, 'run-1', {
      ts: OLD,
      runId: 'run-1',
      type: 'CheckRun',
      payload: {
        kind: 'exemption-declared',
        exemptionId: 'EX-OLD',
        testId: 'STORY-OLD#t1',
        owner: 'alice',
        expiry: '2026-12-31',
      },
    });
    await appendEvent(dir, 'run-1', {
      ts: OLD,
      runId: 'run-1',
      stepId: 'build',
      type: 'UsageRecorded',
      payload: {
        stepId: 'build',
        agentId: 'engineer',
        model: 'x',
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 5,
        estimated: true,
        durationMs: 1,
        storyId: 'STORY-OLD',
      },
    });
    await appendEvent(dir, 'run-1', {
      ts: OLD,
      runId: 'run-1',
      stepId: 'review-old',
      type: 'SessionEvent',
      payload: { kind: 'kb-read', source: 'static', ids: ['kb:glossary.md'] },
    });
    await appendEvent(dir, 'run-1', {
      ts: OLD,
      runId: 'run-1',
      stepId: 'review-old',
      type: 'ArtifactCreated',
      payload: {
        type: 'ReviewReport',
        id: 'REVIEW-OLD',
        laneFile: 'x',
        verdict: 'clear',
        perspectives: [],
      },
    });

    const unfiltered = await buildReport(contextFor(dir, project.paths));
    const filtered = await buildReport(contextFor(dir, project.paths), {
      since: new Date(CUTOFF),
    });

    expect(unfiltered.binding.totalCount).toBe(1);
    expect(unfiltered.criticLoop.roundsConsumed).toBe(1);
    expect(unfiltered.gates.totalRejectionsBeforeFirstPass).toBe(1);
    expect(unfiltered.exemptions.opened).toBe(1);
    expect(unfiltered.cost.totalUsd).toBe(5);
    expect(unfiltered.kbReads.artifactsCreated).toBe(1);

    expect(filtered.binding.totalCount).toBe(0);
    expect(filtered.criticLoop.roundsConsumed).toBe(0);
    expect(filtered.gates.totalRejectionsBeforeFirstPass).toBe(0);
    expect(filtered.exemptions.opened).toBe(0);
    expect(filtered.cost.totalUsd).toBe(0);
    expect(filtered.kbReads.artifactsCreated).toBe(0);
  });
});

describe('writeBaseline / readBaseline — round-trip and real commit provenance', () => {
  it('round-trips: what writeBaseline writes is exactly what readBaseline reads back', async () => {
    const project = await createTestProject();
    await appendEvent(project.dir, 'run-1', bindingEvent());
    const ctx = contextFor(project.dir, project.paths);

    const written = await writeBaseline(ctx);
    const read = await readBaseline(ctx);

    expect(read).toEqual(written);
  });

  it('readBaseline returns undefined when no baseline has ever been captured', async () => {
    const project = await createTestProject();

    const read = await readBaseline(contextFor(project.dir, project.paths));

    expect(read).toBeUndefined();
  });

  it('names the real HEAD commit sha when the project genuinely has one', async () => {
    const project = await createTestProject();
    execFileSync('git', ['add', '-A'], { cwd: project.dir });
    execFileSync('git', ['commit', '-m', 'fixture commit', '--no-gpg-sign'], { cwd: project.dir });
    const realSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: project.dir,
      encoding: 'utf8',
    }).trim();

    const written = await writeBaseline(contextFor(project.dir, project.paths));

    expect(written.commit).toBe(realSha);
  });

  it('reports commit: null for a project with no commits yet, never a placeholder string', async () => {
    const project = await createTestProject();

    const written = await writeBaseline(contextFor(project.dir, project.paths));

    expect(written.commit).toBeNull();
  });

  it('a second --baseline capture OVERWRITES the first, in place, at the same well-known path', async () => {
    const project = await createTestProject();
    await appendEvent(project.dir, 'run-1', bindingEvent({}, { storyId: 'STORY-FIRST' }));
    const ctx = contextFor(project.dir, project.paths);
    await writeBaseline(ctx);

    await appendEvent(project.dir, 'run-1', bindingEvent({}, { storyId: 'STORY-SECOND' }));
    const second = await writeBaseline(ctx);
    const read = await readBaseline(ctx);

    expect(read?.scorecard.binding.stories.map((s) => s.storyId).sort()).toEqual([
      'STORY-FIRST',
      'STORY-SECOND',
    ]);
    expect(read).toEqual(second);
  });

  it('a baseline is always the current, UNFILTERED scorecard, never --since-scoped', async () => {
    const project = await createTestProject();
    await appendEvent(project.dir, 'run-1', bindingEvent({ ts: '2020-01-01T00:00:00.000Z' }));

    const written = await writeBaseline(contextFor(project.dir, project.paths));

    expect(written.scorecard.binding.totalCount).toBe(1);
  });

  async function writeRawBaselineFile(dir: string, content: string): Promise<void> {
    const target = path.join(dir, 'docs/forge/reports/baseline.md');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }

  it('readBaseline throws USR-004, never silently returns undefined, for a file with no YAML front-matter fence at all', async () => {
    const project = await createTestProject();
    await writeRawBaselineFile(project.dir, '# just some prose, no front matter at all\n');

    await expect(readBaseline(contextFor(project.dir, project.paths))).rejects.toMatchObject({
      code: 'USR-004',
    });
  });

  it('readBaseline throws USR-004 for syntactically broken YAML inside an otherwise real-looking fence', async () => {
    const project = await createTestProject();
    await writeRawBaselineFile(
      project.dir,
      '---\nv: 1\n  capturedAt: [this is not valid yaml\n---\n',
    );

    await expect(readBaseline(contextFor(project.dir, project.paths))).rejects.toMatchObject({
      code: 'USR-004',
    });
  });

  it('readBaseline throws USR-004 for syntactically VALID YAML that is the wrong shape (a hand edit, or a future schema change)', async () => {
    const project = await createTestProject();
    await writeRawBaselineFile(
      project.dir,
      '---\nv: 1\ncapturedAt: "2026-01-01T00:00:00.000Z"\ncommit: null\nscorecard: "not an object at all"\n---\n',
    );

    await expect(readBaseline(contextFor(project.dir, project.paths))).rejects.toMatchObject({
      code: 'USR-004',
    });
  });

  it('a genuinely well-formed baseline (the real writeBaseline output) still round-trips cleanly through the new validation', async () => {
    const project = await createTestProject();
    await appendEvent(project.dir, 'run-1', bindingEvent());
    const ctx = contextFor(project.dir, project.paths);
    await writeBaseline(ctx);

    await expect(readBaseline(ctx)).resolves.toBeDefined();
  });
});
