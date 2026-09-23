/**
 * RCA reproductions live under a defect-scoped test glob the claims include and the briefs name
 * (`PLAN-M14.md` P13, `SPEC-QUESTIONS.md` Q232 decision 5, Q216).
 *
 * Two things, both against the real shipped files -- never a hand-typed copy that could drift:
 *
 * - **Compiled.** `debug`/`quick-fix`'s real workflow source, compiled with a real `defectId` input,
 *   carries the two new `produces` globs with the placeholder resolved and the glob's own brace groups
 *   intact; a representative file matching each glob is also recognised by `isTestPath`
 *   (`@forge/engine/dispatch`, `PLAN-M14.md` P5's own validator) -- cross-checked directly against it,
 *   not eyeballed. `build-stage`'s `rca` escalation is checked at parse level only (`compilePlan` never
 *   compiles `onFailure`), with the literal `DEF-*` prefix the brief's own missing `defectId` forces.
 * - **Enforced.** A real `forge run` of the real, unmodified `debug` workflow, with a scripted `run-rca`
 *   session that writes a reproduction test inside the new claim, an RCA record and a Defect edit
 *   (all inside the claim), plus a plain source file and a same-directory test NOT named for this
 *   defect (both outside it -- the second proves the claim is scoped to the defect id, not to "any test
 *   file"). `strict` (`PLAN-M14.md` P3) reverts exactly the two out-of-claim files and fails the step;
 *   the event trace is the same interface `output-claim.test.ts`/`empty-claim.test.ts` already use to
 *   prove "kept" vs "reverted" for this exact mechanism, plus a direct read of the lane's own retained
 *   worktree (`execution.retainLaneWorktrees: 'always'`) for the reproduction test specifically.
 *
 * @see specs/13 §13.2
 * @see PLAN-M14.md P13
 * @see SPEC-QUESTIONS.md Q216, Q232 decision 5
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import { minimatch } from 'minimatch';
import type { SessionRequest } from '@forge/adapter-kit';
import { FakePlatformAdapter } from '@forge/testkit';
import { isTestPath } from '@forge/engine/dispatch';
import { parseWorkflow } from '@forge/engine/workflow';
import { readEvents, type ForgeEvent } from '@forge/telemetry/events';
import { afterEach, describe, expect, it } from 'vitest';

import { dryRunWorkflow, runWorkflow } from '../../../src/commands/run/run.ts';
import { writeFixtureAgent } from '../loop/helpers.ts';
import { WORKFLOWS_ROOT, cleanupAll, createTestProject, testRunDeps } from './helpers.ts';

afterEach(cleanupAll);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const templatesRoot = path.join(repoRoot, 'packages', 'templates', 'templates', 'workflows');

async function readWorkflowTemplate(id: string): Promise<string> {
  return readFile(path.join(templatesRoot, `${id}.workflow.yaml`), 'utf8');
}

/** No `: ExpressionContext` annotation, deliberately (`test/workflows.test.ts`'s own `FIXTURE_CONTEXT`
 * does the same, for the identical reason): `resolveTemplate` reads a workflow-level `inputs` reference
 * like `{{defectId}}` against a bare own-property on the context root, which is runtime-valid but would
 * fail an inline object literal's excess-property check against `ExpressionContext`'s own named fields.
 * Passed as an already-typed variable, structural typing accepts it wherever `ExpressionContext` is
 * required. The empty `vars` is one real `ExpressionContext` field (unused at runtime): every field of
 * `ExpressionContext` is optional, so TypeScript's own weak-type check refuses an object with zero
 * properties in common with it, and `defectId` alone is not one. */
const DEFECT_CONTEXT = { defectId: 'DEF-012', vars: {} };

/** The two new globs (`PLAN-M14.md` P13), for one defect-id-shaped token -- `{{defectId}}` already
 * resolved for `debug`/`quick-fix`, or the literal `DEF-*` prefix `build-stage`'s escalation uses. */
function reproductionGlobs(token: string): readonly [string, string] {
  return [
    `**/*${token}*.{test,spec}.{js,jsx,ts,tsx,cjs,mjs,cts,mts}`,
    `**/{test,tests,__tests__,e2e}/**/*${token}*`,
  ];
}

describe('compiled: debug:run-rca and quick-fix:reproduce carry the defect-scoped test glob', () => {
  it.each([
    ['debug', 'run-rca'],
    ['quick-fix', 'reproduce'],
  ])(
    '%s:%s produces both new globs with {{defectId}} resolved, brace groups intact',
    async (workflowId, stepId) => {
      const source = await readWorkflowTemplate(workflowId);
      const dryRun = dryRunWorkflow(source, DEFECT_CONTEXT);
      if (!dryRun.plan.success) {
        throw new Error(`${workflowId} failed to compile: ${JSON.stringify(dryRun.plan.issues)}`);
      }
      const node = dryRun.plan.nodes.find(
        (candidate) => candidate.id === `${workflowId}:${stepId}`,
      );
      expect(node, `no such compiled step: ${workflowId}:${stepId}`).toBeDefined();
      for (const glob of reproductionGlobs('DEF-012')) {
        expect(node?.produces, `${workflowId}:${stepId} produces`).toContain(glob);
      }
      // The pre-existing Defect-report claim survives the edit: this piece only adds, never narrows.
      expect(node?.produces).toContain('docs/forge/reports/defects/**');
    },
  );

  it("each compiled glob accepts a representative reproduction-test file, and isTestPath (P5's own validator) agrees -- cross-checked directly, not eyeballed", async () => {
    const source = await readWorkflowTemplate('debug');
    const dryRun = dryRunWorkflow(source, DEFECT_CONTEXT);
    if (!dryRun.plan.success) throw new Error('debug failed to compile');
    const node = dryRun.plan.nodes.find((candidate) => candidate.id === 'debug:run-rca');
    expect(node).toBeDefined();
    const [extensionGlob, directoryGlob] = reproductionGlobs('DEF-012');
    const examples: ReadonlyMap<string, string> = new Map([
      [extensionGlob, 'src/repro-DEF-012.test.ts'],
      [directoryGlob, 'tests/regression/DEF-012.test.ts'],
    ]);
    for (const [glob, file] of examples) {
      expect(node?.produces, glob).toContain(glob);
      expect(minimatch(file, glob, { dot: true }), `${file} should match ${glob}`).toBe(true);
      expect(isTestPath(file), `isTestPath(${file})`).toBe(true);
    }
    // A file that merely sits near a test directory but carries neither the defect id nor a test
    // extension is outside both globs -- the claim is scoped to the defect, not to "anything nearby".
    expect(minimatch('tests/regression/other.test.ts', extensionGlob, { dot: true })).toBe(false);
    expect(minimatch('tests/regression/other.test.ts', directoryGlob, { dot: true })).toBe(false);
  });

  it("build-stage's rca escalation names the same shape at parse level, with a DEF-* prefix (no defectId is ever compiled for onFailure)", async () => {
    const source = await readWorkflowTemplate('build-stage');
    const parsed = parseWorkflow(source);
    if (!parsed.success) throw new Error('build-stage failed to parse');
    const escalation = parsed.workflow.onFailure?.escalations?.[0]?.do;
    expect(escalation?.kind).toBe('agent');
    if (escalation?.kind !== 'agent') throw new Error('expected an agent escalation');
    const produces =
      typeof escalation.produces === 'string' ? [escalation.produces] : (escalation.produces ?? []);
    // The glob's own embedded token is `DEF-` (the wrapping `*` on each side already provide the
    // wildcard `DEF-*` reads as informally) -- `reproductionGlobs('DEF-')` is `**/*DEF-*...`, matching
    // the shipped file exactly; `reproductionGlobs('DEF-*')` would double the trailing wildcard.
    const [extensionGlob, directoryGlob] = reproductionGlobs('DEF-');
    expect(produces).toContain(extensionGlob);
    expect(produces).toContain(directoryGlob);
    // Pre-existing entries untouched.
    expect(produces).toContain('docs/forge/sessions/rca/RCA-*.md');
    expect(produces).toContain('docs/forge/reports/defects/DEF-*.md');

    const example = 'tests/regression/DEF-012.test.ts';
    expect(minimatch(example, extensionGlob, { dot: true })).toBe(true);
    expect(minimatch(example, directoryGlob, { dot: true })).toBe(true);
    expect(isTestPath(example)).toBe(true);
    // Prefix-scoped, not defect-scoped (Discloses: no `defectId` is available at this point): a
    // DIFFERENT defect's reproduction also matches, because the escalation cannot know which defect the
    // failure it diagnoses will turn out to be.
    expect(minimatch('tests/regression/DEF-999.test.ts', extensionGlob, { dot: true })).toBe(true);
  });
});

const REPRO_TEST = 'tests/regression/DEF-012.test.ts';
const RCA_DOC = 'docs/forge/sessions/rca/RCA-001.md';
const DEFECT_EDIT = 'docs/forge/reports/defects/DEF-012.md';
const OUT_OF_SCOPE_SRC = 'src/x.ts';
/** Sits under a conventional test directory but is not named with THIS defect's id -- proves the claim
 * is scoped to the defect, not to "any test file". */
const OUT_OF_SCOPE_TEST = 'tests/regression/other.test.ts';

const RCA_FIXTURE = `---
id: RCA-001
type: RCA
schemaVersion: 1
title: DEF-012 root cause
status: complete
created: 2026-01-15
updated: 2026-01-15
revision: 1
author: diagnostician
changelog: []
defect: DEF-012
severity: Sev3
symptom: the observed failure
reproduction: ${REPRO_TEST}
timeline: []
hypotheses: []
root_cause: the confirmed root cause
causal_chain: []
fix: what changed to resolve the root cause
prevention: []
blast_radius: []
kb_writes: []
time_to_diagnose_min: 12
---

A short narrative summary.
`;

describe("enforced: a real 'debug' run keeps the reproduction test and reverts an out-of-scope write", () => {
  it('run-rca (strict) commits the reproduction test, the RCA record and the Defect edit; reverts a plain source file and a same-directory test not named for this defect, and fails the step (PLAN-M14.md P3)', async () => {
    const project = await createTestProject();
    await writeFixtureAgent(project.dir, 'diagnostician', 'Diagnostician', {
      write: true,
      code: true,
    });
    const debugSource = await readWorkflowTemplate('debug');
    await writeFile(path.join(project.dir, WORKFLOWS_ROOT, 'debug.workflow.yaml'), debugSource);
    await mkdir(path.join(project.dir, '.forge', 'briefs'), { recursive: true });
    await writeFile(
      path.join(project.dir, '.forge', 'briefs', 'run-rca-framework.md'),
      'Diagnose DEF-012 and record the RCA.\n',
    );
    await execa('git', ['add', '-A'], { cwd: project.dir });
    await execa('git', ['commit', '--quiet', '-m', 'debug workflow fixture'], { cwd: project.dir });

    const requests: SessionRequest[] = [];
    const adapter = new FakePlatformAdapter();
    adapter.script(
      (request) => {
        requests.push(request);
        return true;
      },
      {
        text: ['diagnosed DEF-012'],
        writeFiles: [
          {
            relativePath: REPRO_TEST,
            content: "test('DEF-012 reproduces', () => { throw new Error('x'); });\n",
          },
          { relativePath: RCA_DOC, content: RCA_FIXTURE },
          {
            relativePath: DEFECT_EDIT,
            content: '## Reproduction\n\nRun `node repro.js`; observed a crash.\n',
          },
          { relativePath: OUT_OF_SCOPE_SRC, content: 'export const x = 1;\n' },
          { relativePath: OUT_OF_SCOPE_TEST, content: "test('unrelated', () => {});\n" },
        ],
      },
    );

    const runId = 'run-debug-p13';
    const result = await runWorkflow(testRunDeps(project, adapter), {
      workflowId: 'debug',
      expressionContext: DEFECT_CONTEXT,
      runId,
      host: 'test-host',
    });
    if (result.kind !== 'run') throw new Error('expected a real run');
    expect(requests).toHaveLength(1);
    expect(requests[0]?.tools.write).toBe(true);

    const events: ForgeEvent[] = [];
    for await (const event of readEvents(project.dir, runId)) events.push(event);

    const violation = events.find(
      (event) => event.type === 'PolicyViolation' && event.stepId === 'debug:run-rca',
    );
    expect(violation).toBeDefined();
    expect(violation?.payload).toMatchObject({
      kind: 'out-of-claim-write',
      policy: 'strict',
      stepFailed: true,
      totalOutOfClaim: 2,
      totalReverted: 2,
    });
    const outOfClaimPaths = [
      ...((violation?.payload as { paths?: readonly string[] } | undefined)?.paths ?? []),
    ].sort();
    expect(outOfClaimPaths).toEqual([OUT_OF_SCOPE_SRC, OUT_OF_SCOPE_TEST].sort());

    const failed = events.find(
      (event) => event.type === 'StepFailed' && event.stepId === 'debug:run-rca',
    );
    expect(failed).toBeDefined();
    expect(JSON.stringify(failed?.payload)).toContain('RUN-104');
    expect(result.runState.runStatus).toBe('failed');

    // Nothing downstream of `run-rca` (`fix`, `prove-fix`, `record`) ever dispatches: the whole chain is
    // blocked behind the one failed step.
    expect(events.some((event) => event.stepId === 'debug:fix')).toBe(false);

    // The claim-revert commit is real, and reverted exactly the two out-of-claim paths -- not the three
    // in-claim ones -- proven by reading the lane's own retained worktree directly
    // (`execution.retainLaneWorktrees: 'always'`, `createTestProject`'s own config), the real files a real
    // `enforceClaim` left on disk, not an inference from the event log alone.
    const revertCommit = events.find(
      (event) =>
        event.type === 'LaneCommitted' &&
        event.stepId === 'debug:run-rca' &&
        (event.payload as { reason?: string } | undefined)?.reason === 'claim-revert',
    );
    expect(revertCommit).toBeDefined();
    const laneId = violation?.laneId;
    expect(laneId).toBeDefined();
    const worktree = path.join(project.dir, '.forge', 'state', 'worktrees', laneId ?? '');

    async function existsInLane(relativePath: string): Promise<boolean> {
      try {
        await readFile(path.join(worktree, relativePath), 'utf8');
        return true;
      } catch {
        return false;
      }
    }

    expect(await existsInLane(REPRO_TEST)).toBe(true);
    expect(await existsInLane(RCA_DOC)).toBe(true);
    expect(await existsInLane(DEFECT_EDIT)).toBe(true);
    expect(await existsInLane(OUT_OF_SCOPE_SRC)).toBe(false);
    expect(await existsInLane(OUT_OF_SCOPE_TEST)).toBe(false);
  });

  it('a session that writes only the reproduction test, the RCA record and the Defect edit triggers no violation at all', async () => {
    const project = await createTestProject();
    await writeFixtureAgent(project.dir, 'diagnostician', 'Diagnostician', {
      write: true,
      code: true,
    });
    const debugSource = await readWorkflowTemplate('debug');
    await writeFile(path.join(project.dir, WORKFLOWS_ROOT, 'debug.workflow.yaml'), debugSource);
    await mkdir(path.join(project.dir, '.forge', 'briefs'), { recursive: true });
    await writeFile(
      path.join(project.dir, '.forge', 'briefs', 'run-rca-framework.md'),
      'Diagnose DEF-012 and record the RCA.\n',
    );
    await execa('git', ['add', '-A'], { cwd: project.dir });
    await execa('git', ['commit', '--quiet', '-m', 'debug workflow fixture'], { cwd: project.dir });

    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, {
      text: ['diagnosed DEF-012'],
      writeFiles: [
        {
          relativePath: REPRO_TEST,
          content: "test('DEF-012 reproduces', () => { throw new Error('x'); });\n",
        },
        { relativePath: RCA_DOC, content: RCA_FIXTURE },
        {
          relativePath: DEFECT_EDIT,
          content: '## Reproduction\n\nRun `node repro.js`; observed a crash.\n',
        },
      ],
    });

    const runId = 'run-debug-p13-clean';
    const result = await runWorkflow(testRunDeps(project, adapter), {
      workflowId: 'debug',
      expressionContext: DEFECT_CONTEXT,
      runId,
      host: 'test-host',
    });
    if (result.kind !== 'run') throw new Error('expected a real run');

    const events: ForgeEvent[] = [];
    for await (const event of readEvents(project.dir, runId)) events.push(event);
    expect(events.some((event) => event.type === 'PolicyViolation')).toBe(false);
    const succeeded = events.find(
      (event) => event.type === 'StepSucceeded' && event.stepId === 'debug:run-rca',
    );
    expect(succeeded).toBeDefined();
  });
});
