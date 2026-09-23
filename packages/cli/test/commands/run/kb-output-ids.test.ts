/**
 * The output check holds a produced KB output to its reserved id range, end to end through a real
 * `forge run` (`PLAN-M14.md` P10, `SPEC-QUESTIONS.md` Q232 decision 2): a two-step fanout that both
 * declare an `ADR` output really does get two DISTINCT reserved ids that both pass the check, and a
 * second run in the same project -- after the first's lanes landed on the (persistent, reused)
 * integration branch, `ensureIntegrationWorktree` -- really does number its own new `ADR` after them
 * ("sequential runs safe by scan", `PLAN-M14.md` P8's own disclosure).
 *
 * `output-contract.test.ts`/`output-claim.test.ts` (`@forge/engine`) already prove the range rule itself
 * (wrong id, out-of-order `many` block, base-is-an-update, register collisions) against a stubbed and a
 * real-but-single-lane VCS; this file's own job is the thing only a full multi-lane `forge run` can prove:
 * that two concurrently-dispatched steps in the SAME id space really do serialise into disjoint ranges
 * that both independently pass, not merely that the code which would do so parses.
 *
 * @see specs/18 §18.8
 * @see specs/08 §8.6
 * @see PLAN-M14.md P8, P10
 * @see SPEC-QUESTIONS.md Q232 decision 2
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';
import { FakePlatformAdapter } from '@forge/testkit';
import { afterEach, describe, expect, it } from 'vitest';

import { integrationBranchFor } from '../../../src/commands/run/context.ts';
import { runWorkflow } from '../../../src/commands/run/run.ts';
import { writeFixtureAgent } from '../loop/helpers.ts';
import {
  WORKFLOWS_ROOT,
  cleanupAll,
  createTestProject,
  fixtureExpressionContext,
  testRunDeps,
  type TestProject,
} from './helpers.ts';

afterEach(cleanupAll);

const FANOUT_WORKFLOW_ID = 'kb-ids-fanout';
const SECOND_WORKFLOW_ID = 'kb-ids-second';
const DECISIONS = 'docs/forge/kb/decisions';

/** A minimal but schema-valid ADR document (`08` §8.4), at `id` -- the same shape
 * `packages/engine/test/dispatch/artifact-fixtures.ts`'s own `adrText` uses, duplicated here rather than
 * imported: this file lives in `@forge/cli`'s own test tree, and reaching into another package's `test/`
 * directory (never published, never a real module boundary) is not a real import path. `sources`
 * included (`PLAN-M14.md` P11: the output check now requires at least one on every produced ADR). */
function adrText(id: string): string {
  return [
    '---',
    `id: ${id}`,
    'type: ADR',
    'schemaVersion: 1',
    'title: A decision',
    'status: accepted',
    'created: 2026-01-15',
    'updated: 2026-01-15',
    'revision: 1',
    'author: architect',
    'changelog: []',
    'category: architecture',
    'deciders: [architect]',
    'date: 2026-01-15',
    'reversibility: medium',
    'blast_radius: []',
    "revisit_trigger: 'n/a'",
    'supersedes: []',
    'superseded_by: null',
    'related: []',
    'diagrams: []',
    "framework: 'n/a'",
    'sources:',
    '  - kind: decision',
    "    ref: 'ADR-0001'",
    '---',
    '',
    '## Context',
    '',
    'x',
    '',
    '## Options considered',
    '',
    'x',
    '',
    '## Decision',
    '',
    'x',
    '',
    '## Diagram',
    '',
    'x',
    '',
    '## Consequences',
    '',
    'x',
    '',
    '## Reversal plan',
    '',
    'x',
    '',
  ].join('\n');
}

const FANOUT_WORKFLOW = `
id: ${FANOUT_WORKFLOW_ID}
name: KB output ids fanout
version: 1.0.0
description: Two independent agent steps each declare an ADR output; a merge lands both.
steps:
  - id: write-adr-a
    kind: agent
    agent: architect
    brief: briefs/implement.md
    produces: [ "docs/forge/**" ]
    outputs: [ { type: ADR } ]
  - id: write-adr-b
    kind: agent
    agent: architect
    brief: briefs/implement.md
    produces: [ "docs/forge/**" ]
    outputs: [ { type: ADR } ]
  - id: land
    kind: merge
    over: "write-adr-a"
    dependsOn: [ write-adr-a, write-adr-b ]
    policy: { conflict: abort }
`;

const SECOND_WORKFLOW = `
id: ${SECOND_WORKFLOW_ID}
name: KB output ids second run
version: 1.0.0
description: A single agent step declares an ADR output, run after the fanout workflow above landed two.
steps:
  - id: write-adr
    kind: agent
    agent: architect
    brief: briefs/implement.md
    produces: [ "docs/forge/**" ]
    outputs: [ { type: ADR } ]
`;

async function kbProject(): Promise<TestProject> {
  const project = await createTestProject();
  await writeFixtureAgent(project.dir, 'architect', 'Architect', { write: true });
  await writeFile(
    path.join(project.dir, WORKFLOWS_ROOT, `${FANOUT_WORKFLOW_ID}.workflow.yaml`),
    FANOUT_WORKFLOW,
  );
  await writeFile(
    path.join(project.dir, WORKFLOWS_ROOT, `${SECOND_WORKFLOW_ID}.workflow.yaml`),
    SECOND_WORKFLOW,
  );
  await execa('git', ['add', '-A'], { cwd: project.dir });
  await execa('git', ['commit', '--quiet', '-m', 'kb output id workflows'], { cwd: project.dir });
  return project;
}

/** Matched on the PROMPT, not `request.stepId`: `write-adr-a`/`write-adr-b` reserve concurrently through
 * the same `(project, run, "ADR")` FIFO queue (`dispatch/output-ids.ts`), so which of the two physical
 * steps gets `ADR-0001` and which gets `ADR-0002` is not fixed by the workflow's own step order -- only
 * the prompt's own block [5] (`compile-prompt.ts`'s `renderOutputContractBlock`) says which one each step
 * was actually told to use. */
function fanoutAdapter(): FakePlatformAdapter {
  const adapter = new FakePlatformAdapter();
  adapter.script(
    (request) =>
      request.stepId.includes('write-adr') &&
      request.systemPrompt.text.includes('reserved id `ADR-0001`'),
    {
      text: ['wrote adr a'],
      writeFiles: [{ relativePath: `${DECISIONS}/ADR-0001-x.md`, content: adrText('ADR-0001') }],
    },
  );
  adapter.script(
    (request) =>
      request.stepId.includes('write-adr') &&
      request.systemPrompt.text.includes('reserved id `ADR-0002`'),
    {
      text: ['wrote adr b'],
      writeFiles: [{ relativePath: `${DECISIONS}/ADR-0002-x.md`, content: adrText('ADR-0002') }],
    },
  );
  return adapter;
}

describe('forge run: the output check holds a KB output to its reserved id range', () => {
  it('a two-step fanout that both declare an ADR output ends with two distinct ADRs, both passing the range check', async () => {
    const project = await kbProject();
    const result = await runWorkflow(testRunDeps(project, fanoutAdapter()), {
      workflowId: FANOUT_WORKFLOW_ID,
      expressionContext: fixtureExpressionContext(),
      runId: 'run-kb-fanout',
      host: 'test-host',
    });
    if (result.kind !== 'run') throw new Error('expected a real run');
    expect(result.runState.runStatus).toBe('completed');

    // Proves it directly off the merged content, not merely that the run reported success: two DISTINCT
    // ids, each still carrying the id it was actually reserved (not swapped, not both the same).
    const branch = integrationBranchFor(project.config, fixtureExpressionContext());
    const [a, b] = await Promise.all([
      execa('git', ['show', `${branch}:${DECISIONS}/ADR-0001-x.md`], { cwd: project.dir }),
      execa('git', ['show', `${branch}:${DECISIONS}/ADR-0002-x.md`], { cwd: project.dir }),
    ]);
    expect(a.stdout).toContain('id: ADR-0001');
    expect(b.stdout).toContain('id: ADR-0002');
  });

  it('a second run in the same project numbers its own new ADR after the ones the first run merged', async () => {
    const project = await kbProject();
    const first = await runWorkflow(testRunDeps(project, fanoutAdapter()), {
      workflowId: FANOUT_WORKFLOW_ID,
      expressionContext: fixtureExpressionContext(),
      runId: 'run-kb-fanout-then-second',
      host: 'test-host',
    });
    if (first.kind !== 'run') throw new Error('expected a real run');
    expect(first.runState.runStatus).toBe('completed');

    // The fanout's own two ADRs are now on the integration branch (`ensureIntegrationWorktree` reuses the
    // SAME persistent worktree across separate `runWorkflow` calls against this same project): the only id
    // this second run's own reservation can ever compute, with nothing else in the whole project claiming
    // a number, is ADR-0003 -- asserted by driving the real check with it, not by inspecting the scan.
    const secondAdapter = new FakePlatformAdapter();
    secondAdapter.script(() => true, {
      text: ['wrote the next adr'],
      writeFiles: [{ relativePath: `${DECISIONS}/ADR-0003-x.md`, content: adrText('ADR-0003') }],
    });
    const second = await runWorkflow(testRunDeps(project, secondAdapter), {
      workflowId: SECOND_WORKFLOW_ID,
      expressionContext: fixtureExpressionContext(),
      runId: 'run-kb-second',
      host: 'test-host',
    });
    if (second.kind !== 'run') throw new Error('expected a real run');
    expect(second.runState.runStatus).toBe('completed');

    // A wrong guess (any id other than ADR-0003) would instead fail the step RUN-083 -- run once more,
    // deliberately wrong, to prove this is a real, live-enforced check and not a vacuous pass.
    const wrongAdapter = new FakePlatformAdapter();
    wrongAdapter.script(() => true, {
      text: ['wrote the wrong adr'],
      writeFiles: [{ relativePath: `${DECISIONS}/ADR-0099-x.md`, content: adrText('ADR-0099') }],
    });
    const wrong = await runWorkflow(testRunDeps(project, wrongAdapter), {
      workflowId: SECOND_WORKFLOW_ID,
      expressionContext: fixtureExpressionContext(),
      runId: 'run-kb-second-wrong',
      host: 'test-host',
    });
    if (wrong.kind !== 'run') throw new Error('expected a real run');
    expect(wrong.runState.runStatus).toBe('failed');
  });
});
