/**
 * `forge debug <symptom|--from-failure <runId>>` — real `Defect` artifact scaffolding (`13` §13's own
 * intake normalisation) before real dispatch to `debug`.
 *
 * @see specs/03 §3.2.5
 * @see specs/13 §13
 */
import { readArtifact } from '@forge/core/artifacts';
import { FakePlatformAdapter } from '@forge/testkit';
import { afterEach, describe, expect, it } from 'vitest';

import { debugFromFailure, debugSymptom } from '../../../src/commands/loop/debug.ts';
import { refactorTarget } from '../../../src/commands/loop/refactor.ts';
import {
  REPORTS_ROOT,
  cleanupAll,
  createTestProject,
  fixtureAdapter,
  testRunDeps,
} from './helpers.ts';

afterEach(cleanupAll);

describe('debugSymptom', () => {
  it('scaffolds a real, schema-valid Defect from a bare symptom and dispatches to debug', async () => {
    const project = await createTestProject();
    const result = await debugSymptom(testRunDeps(project), 'checkout crashes on empty cart', {
      reportsRoot: REPORTS_ROOT,
      dryRun: true,
      host: 'test-host',
    });
    expect(result.kind).toBe('dry-run');
    if (result.kind !== 'dry-run' || !result.plan.success) throw new Error('unreachable');
    // The real, allocated DEF-### id reached the workflow's own compiled `produces` glob.
    const producesGlob = result.plan.nodes[0]?.produces[0];
    expect(producesGlob).toMatch(/^DEF-\d+\.txt$/);

    const defectId = producesGlob?.replace(/\.txt$/, '') ?? '';
    const doc = await readArtifact(project.paths, `${REPORTS_ROOT}/defects/${defectId}.md`);
    expect(doc.get(['observed'])).toBe('checkout crashes on empty cart');
    expect(doc.get(['severity'])).toBe('Sev3');
  });

  it('completes a real run once dispatched', async () => {
    const project = await createTestProject();
    const dryRun = await debugSymptom(testRunDeps(project), 'symptom text', {
      reportsRoot: REPORTS_ROOT,
      dryRun: true,
      host: 'test-host',
    });
    if (dryRun.kind !== 'dry-run' || !dryRun.plan.success) throw new Error('unreachable');
    const dryRunNode = dryRun.plan.nodes[0];
    if (dryRunNode === undefined) throw new Error('unreachable');
    const expectedFile = dryRunNode.produces[0]!;

    const deps = testRunDeps(project, fixtureAdapter(expectedFile));
    const result = await debugSymptom(deps, 'symptom text', {
      reportsRoot: REPORTS_ROOT,
      host: 'test-host',
    });
    expect(result.kind).toBe('run');
    if (result.kind !== 'run') throw new Error('unreachable');
    expect(result.runState.runStatus).toBe('completed');
  });

  it('allocates a distinct real id for each successive call, never reusing one', async () => {
    const project = await createTestProject();
    const first = await debugSymptom(testRunDeps(project), 'first symptom', {
      reportsRoot: REPORTS_ROOT,
      dryRun: true,
      host: 'test-host',
    });
    const second = await debugSymptom(testRunDeps(project), 'second symptom', {
      reportsRoot: REPORTS_ROOT,
      dryRun: true,
      host: 'test-host',
    });
    if (first.kind !== 'dry-run' || second.kind !== 'dry-run') throw new Error('unreachable');
    if (!first.plan.success || !second.plan.success) throw new Error('unreachable');
    expect(first.plan.nodes[0]?.produces[0]).not.toBe(second.plan.nodes[0]?.produces[0]);
  });
});

describe('debugFromFailure', () => {
  it('derives observed/affected from a real failed run’s own event log', async () => {
    const project = await createTestProject();
    // A real run that genuinely fails: a real injected session failure for this step.
    const failingAdapter = new FakePlatformAdapter();
    failingAdapter.injectFailure(() => true, 'error');
    const failingDeps = testRunDeps(project, failingAdapter);
    const failingRun = await refactorTarget(failingDeps, 't', 'g', { host: 'test-host' });
    if (failingRun.kind !== 'run') throw new Error('unreachable');

    const result = await debugFromFailure(testRunDeps(project), failingRun.runId, {
      reportsRoot: REPORTS_ROOT,
      dryRun: true,
      host: 'test-host',
    });
    if (result.kind !== 'dry-run' || !result.plan.success) throw new Error('unreachable');
    const resultNode = result.plan.nodes[0];
    if (resultNode === undefined) throw new Error('unreachable');
    const producesGlob = resultNode.produces[0]!;
    const defectId = producesGlob.replace(/\.txt$/, '');
    const doc = await readArtifact(project.paths, `${REPORTS_ROOT}/defects/${defectId}.md`);
    expect(doc.get(['affected'])).toEqual(['refactor:only']);
  });

  it('throws RUN-057 when the named run has no failed step at all', async () => {
    const project = await createTestProject();
    const deps = testRunDeps(project, fixtureAdapter('t-g.txt'));
    const cleanRun = await refactorTarget(deps, 't', 'g', { host: 'test-host' });
    if (cleanRun.kind !== 'run') throw new Error('unreachable');
    await expect(
      debugFromFailure(testRunDeps(project), cleanRun.runId, {
        reportsRoot: REPORTS_ROOT,
        dryRun: true,
        host: 'test-host',
      }),
    ).rejects.toMatchObject({ code: 'RUN-057' });
  });
});
