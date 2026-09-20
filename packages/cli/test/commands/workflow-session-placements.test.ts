/**
 * `PLAN-M10.md` P14 — `16` §16.6's own built-in workflow-step session placements, wired into
 * `@forge/methods`'s own already-real lifecycle workflows (in practice, `@forge/templates`'s own
 * `WORKFLOW_INDEX` — the real, editable workflow content source, `readWorkflowFiles`' own single
 * caller everywhere else in this package).
 *
 * Loads each of the 7 named stage workflows' own real, shipped YAML (via `readWorkflowFiles`, the same
 * function `content.test.ts` already trusts to read real `@forge/templates` content), parses it with
 * `@forge/engine/workflow`'s own `parseWorkflow`, and compiles it with `@forge/engine/plan`'s own
 * `compilePlan` — proving each placement is not just present in the authored YAML but survives real
 * structural validation and plan compilation, landing in the *compiled* node list at the position `16`
 * §16.6's own placement table names.
 *
 * @see specs/16 §16.6
 * @see PLAN-M10.md P14
 */
import { describe, expect, it } from 'vitest';

import { compilePlan, type StepNode } from '@forge/engine/plan';
import { parseWorkflow, type WorkflowStep } from '@forge/engine/workflow';
import { checkWorkflowStepRemoval, type WorkflowStepSummary } from '@forge/extensions';

import { readWorkflowFiles } from '../../src/init/content.ts';

function toSummary(step: WorkflowStep): WorkflowStepSummary {
  return {
    id: step.id ?? '',
    kind: step.kind,
    ...(step.kind === 'session' ? { sessionType: step.sessionType } : {}),
  };
}

interface CompiledStage {
  readonly workflowId: string;
  readonly nodes: readonly StepNode[];
}

// `plan-stage`/`build-stage` reference real inputs/vars (`{{stageId}}`, `{{vars.integration_branch}}`)
// and a real `stage.stories` fanout collection this test's own placements do not touch at all — a
// minimal, real, well-formed context lets those pre-existing steps resolve so `compilePlan` can reach
// this piece's own new session steps' own dependency positions, not a shape invented to dodge a real
// compile failure this piece caused.
const STAGE_CONTEXT = {
  stageId: 'mvp',
  vars: { integration_branch: 'forge/integration/mvp' },
  stage: {
    stories: [
      {
        id: 's1',
        owner_role: 'backend',
        test_paths: 'test/s1.test.ts',
        files_expected: 'src/s1.ts',
      },
    ],
  },
};

async function loadCompiledStage(fileSuffix: string): Promise<CompiledStage> {
  const files = await readWorkflowFiles();
  const file = files.find((f) => f.relPath.endsWith(fileSuffix));
  if (file === undefined) throw new Error(`fixture gap: no workflow file ends with ${fileSuffix}`);
  const parsed = parseWorkflow(file.content);
  if (!parsed.success) {
    throw new Error(`${fileSuffix} does not parse: ${JSON.stringify(parsed.issues)}`);
  }
  const compiled = compilePlan(parsed.workflow, STAGE_CONTEXT);
  if (!compiled.success) {
    throw new Error(`${fileSuffix} does not compile: ${JSON.stringify(compiled.issues)}`);
  }
  return { workflowId: parsed.workflow.id, nodes: compiled.nodes };
}

function node(stage: CompiledStage, id: string): StepNode {
  const fullId = `${stage.workflowId}:${id}`;
  const found = stage.nodes.find((n) => n.id === fullId);
  if (found === undefined) {
    throw new Error(
      `expected a compiled node "${fullId}", got ids: ${stage.nodes.map((n) => n.id).join(', ')}`,
    );
  }
  return found;
}

function dependsOnStep(n: StepNode, workflowId: string, stepId: string): boolean {
  return n.dependsOn.includes(`${workflowId}:${stepId}`);
}

describe('16 §16.6 P1 Discovery — discover.workflow.yaml', () => {
  it('contains discovery-interview and brainstorm, both feeding frame-problem', async () => {
    const stage = await loadCompiledStage('discover.workflow.yaml');
    const interview = node(stage, 'discovery-interview');
    const brainstorm = node(stage, 'problem-brainstorm');
    const frame = node(stage, 'frame-problem');

    expect(interview.sessionType).toBe('discovery-interview');
    expect(brainstorm.sessionType).toBe('brainstorm');
    expect(dependsOnStep(brainstorm, 'discover', 'discovery-interview')).toBe(true);
    expect(dependsOnStep(frame, 'discover', 'discovery-interview')).toBe(true);
    expect(dependsOnStep(frame, 'discover', 'problem-brainstorm')).toBe(true);
  });
});

describe('16 §16.6 P2 Product Definition — define-product.workflow.yaml', () => {
  it('contains a capability brainstorm before write-prd and a story-refinement gating product-gate', async () => {
    const stage = await loadCompiledStage('define-product.workflow.yaml');
    const brainstorm = node(stage, 'capability-brainstorm');
    const prd = node(stage, 'write-prd');
    const refinement = node(stage, 'story-refinement');
    const gate = node(stage, 'product-gate');

    expect(brainstorm.sessionType).toBe('brainstorm');
    expect(refinement.sessionType).toBe('story-refinement');
    expect(dependsOnStep(prd, 'define-product', 'capability-brainstorm')).toBe(true);
    expect(dependsOnStep(refinement, 'define-product', 'write-prd')).toBe(true);
    expect(dependsOnStep(gate, 'define-product', 'story-refinement')).toBe(true);
  });
});

describe('16 §16.6 P3 Solution Shaping — shape-solution.workflow.yaml', () => {
  it('contains tradeoff/design-review/premortem, with design-review (only) gating design-gate', async () => {
    const stage = await loadCompiledStage('shape-solution.workflow.yaml');
    const tradeoff = node(stage, 'tradeoff-review');
    const designReview = node(stage, 'design-review');
    const premortem = node(stage, 'premortem');
    const gate = node(stage, 'design-gate');

    expect(tradeoff.sessionType).toBe('tradeoff');
    expect(designReview.sessionType).toBe('design-review');
    expect(premortem.sessionType).toBe('premortem');

    // design-review sits before G-Design (16 §16.6's own explicit text).
    expect(dependsOnStep(gate, 'shape-solution', 'design-review')).toBe(true);
    expect(dependsOnStep(designReview, 'shape-solution', 'tradeoff-review')).toBe(true);

    // premortem is a real, triggered (L3+) placement — not wired to block the gate, so it can never
    // deadlock a run at a level where it should not fire (no per-step conditional-inclusion mechanism
    // exists yet; see SessionStep.when's own doc comment).
    expect(premortem.when).toBe("level == 'L3' || level == 'L4'");
    expect(dependsOnStep(gate, 'shape-solution', 'premortem')).toBe(false);
  });
});

describe('16 §16.6 P5 Planning — plan-stage.workflow.yaml', () => {
  it('contains estimation then story-refinement, both before the test plan', async () => {
    const stage = await loadCompiledStage('plan-stage.workflow.yaml');
    const estimation = node(stage, 'estimation');
    const refinement = node(stage, 'story-refinement');
    const testPlan = node(stage, 'write-test-plan');

    expect(estimation.sessionType).toBe('estimation');
    expect(refinement.sessionType).toBe('story-refinement');
    expect(dependsOnStep(refinement, 'plan-stage', 'estimation')).toBe(true);
    expect(dependsOnStep(testPlan, 'plan-stage', 'story-refinement')).toBe(true);
  });
});

describe('16 §16.6 P6 Implementation — build-stage.workflow.yaml', () => {
  // `build-stage.workflow.yaml` is `10` §10.1's own worked example (plus this piece's `standup` and the
  // `review` itemKey, Q211). It used to carry a compile gap (`merge`'s per-item `dependsOn`), so this test
  // checked the *parsed* `Workflow` only; it compiles now (`test/build-stage-compiles.test.ts`), and this
  // test still only needs the parsed document to check the standup's placement and trigger.
  it('contains a standup with a real, evaluable elapsed-time/blocked-lane trigger', async () => {
    const files = await readWorkflowFiles();
    const file = files.find((f) => f.relPath.endsWith('build-stage.workflow.yaml'));
    if (file === undefined) throw new Error('fixture gap: no build-stage.workflow.yaml');
    const parsed = parseWorkflow(file.content);
    if (!parsed.success) throw new Error(`does not parse: ${JSON.stringify(parsed.issues)}`);

    const standup = parsed.workflow.steps.find((s) => s.id === 'standup');
    if (standup?.kind !== 'session') {
      throw new Error(`expected a session step named "standup", got: ${JSON.stringify(standup)}`);
    }
    expect(standup.sessionType).toBe('standup');
    expect(standup.when).toBe('run.elapsedMs > 3600000 || run.blockedLaneCount >= 2');
    expect(standup.dependsOn).toContain('contracts-gate');

    // Dependency-terminal: nothing in this workflow depends on it.
    const dependents = parsed.workflow.steps.filter((s) => s.dependsOn?.includes('standup'));
    expect(dependents).toEqual([]);
  });
});

describe('16 §16.6 P8 Stabilization — harden.workflow.yaml', () => {
  it('contains a Sev1-triggered war-room and a five-whys RCA session', async () => {
    const stage = await loadCompiledStage('harden.workflow.yaml');
    const warRoom = node(stage, 'war-room');
    const fiveWhys = node(stage, 'five-whys-rca');

    expect(warRoom.sessionType).toBe('war-room');
    expect(warRoom.when).toBe("defect.severity == 'Sev1'");
    expect(fiveWhys.sessionType).toBe('war-room');
    expect(stage.nodes.some((n) => dependsOnStep(n, 'harden', 'war-room'))).toBe(false);
    expect(stage.nodes.some((n) => dependsOnStep(n, 'harden', 'five-whys-rca'))).toBe(false);
  });
});

describe('16 §16.6 P10 Operate & Learn — operate.workflow.yaml', () => {
  it('contains a mandatory retro after the stage gate', async () => {
    const stage = await loadCompiledStage('operate.workflow.yaml');
    const retro = node(stage, 'retro');
    const gate = node(stage, 'operate-gate');

    expect(retro.sessionType).toBe('retro');
    expect(dependsOnStep(retro, 'operate', 'operate-gate')).toBe(true);
    expect(gate).toBeDefined();
  });

  // `16` §16.6: "not optional." A project overlay naming this real step's own id in `$remove` must
  // fail compile with a named error (`PLAN-M10.md` P14's own Checks text, verbatim) —
  // `checkWorkflowStepRemoval` (`@forge/extensions/workflows`) is the real mechanism this refusal runs
  // through (extended in this piece to a fourth protected shape; see its own doc comment and
  // `SPEC-QUESTIONS.md` Q165), exercised here against the real, shipped `operate.workflow.yaml`
  // content, not a hand-built fixture.
  it('refuses a project overlay that removes the real, shipped mandatory retro step', async () => {
    const files = await readWorkflowFiles();
    const file = files.find((f) => f.relPath.endsWith('operate.workflow.yaml'));
    if (file === undefined) throw new Error('fixture gap: no operate.workflow.yaml');
    const parsed = parseWorkflow(file.content);
    if (!parsed.success) throw new Error(`does not parse: ${JSON.stringify(parsed.issues)}`);

    const summaries = parsed.workflow.steps.map(toSummary);
    const findings = checkWorkflowStepRemoval(summaries, ['retro']);

    expect(findings).toEqual([
      {
        severity: 'error',
        code: 'mandatory-retro-step-removed',
        message:
          'Step "retro" is the mandatory Operate & Learn stage retro and cannot be removed by an overlay.',
      },
    ]);
  });
});
