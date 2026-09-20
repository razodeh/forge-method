/**
 * `@forge/templates`'s 20 built-in workflows (`10` §10.5), per `PLAN-M6.md` T1's own Checks section.
 *
 * Lives at the repository root, not inside `packages/templates/test/` or `packages/engine/test/`: this
 * is the one check in the whole piece that needs both `@forge/engine/workflow`/`@forge/engine/plan`
 * (the already-built DSL parser/compiler) and `@forge/templates` (`WORKFLOW_INDEX`), and `02` §2.2 gives
 * `@forge/templates` zero `@forge/*` dependencies while `@forge/engine` has no edge to `@forge/templates`
 * either — neither package can import the other, in `src/` or in `test/` (the boundary ESLint rules
 * apply to `packages/**` with no test exemption). The repository root is not covered by that glob, the
 * same reason `test/templates.test.ts` already lives here for the identical cross-package-check reason.
 *
 * @see specs/10 §10.1, §10.5, §10.6
 * @see PLAN-M6.md T1
 * @see SPEC-QUESTIONS.md Q88
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { compileRunPlan } from '@forge/engine/plan';
import { parseWorkflow } from '@forge/engine/workflow';
import { WORKFLOW_INDEX, type WorkflowId } from '@forge/templates';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templatesPackageRoot = path.join(repoRoot, 'packages', 'templates');

function readWorkflowSource(id: WorkflowId): string {
  return readFileSync(path.join(templatesPackageRoot, WORKFLOW_INDEX[id]), 'utf8');
}

/** One shared fixture context every one of the 20 workflows compiles against -- a representative,
 * non-empty value for every `fanout.over` target and every workflow-level `inputs` field any of them
 * reference, matching `PLAN-M6.md` T1's own Checks text ("a representative fixture context"), not a
 * per-workflow bespoke context each of which would prove less about real interoperability. */
// No `: ExpressionContext` annotation here, deliberately: `resolvePath` (`@forge/engine/expr/evaluate.ts`)
// walks a template's dotted path generically against whatever own properties the context object actually
// has at runtime -- it is not restricted to `ExpressionContext`'s own seven named fields (`item`/`stage`/
// `run`/`config`/`kb`/`failures`/`vars`, "the fixed helper set" `10` §10.1 names) -- so a bare workflow-
// level `inputs` reference like `{{storyId}}` genuinely resolves against a `storyId` own-property placed
// directly on the context root, exactly as several of the 20 workflows below need. An explicit
// `ExpressionContext` annotation here would trigger TypeScript's excess-property check on this object
// literal and reject those extra root keys, even though they are runtime-valid; leaving the type inferred
// keeps the literal honest about what it actually contains, and structural typing still makes it a valid
// `ExpressionContext` wherever one is required below (excess-property checks apply only to a literal
// assigned or passed directly into a typed position, not to an already-typed variable).
const FIXTURE_CONTEXT = {
  // `{{...}}` placeholders resolve to a scalar (string/number/boolean) only, never an array --
  // `test_paths`/`files_expected` are each a single glob string, matching how build-stage's own
  // worked example uses them: wrapped in a literal `[ ... ]` YAML array at the *field* level
  // (`produces: [ "{{item.test_paths}}" ]`) where a single templated string is one array entry, or
  // bare (`produces: "{{item.files_expected}}"`) where the templated value is the whole field.
  stage: {
    stories: [
      {
        id: 'story-1',
        owner_role: 'backend',
        test_paths: 'test/story-1.test.ts',
        files_expected: 'src/story-1.ts',
      },
    ],
  },
  run: {
    findings: [{ id: 'defect-1' }],
    testPaths: 'test/story-1.test.ts',
    filesExpected: 'src/story-1.ts',
  },
  // `vars:` (build-stage's own `integration_branch`) is a workflow-authored convenience namespace
  // `compileRunPlan` does not resolve on its own -- confirmed directly against compile.ts, which never
  // reads `Workflow.vars` at all -- so a caller supplies the already-resolved value here, the same as
  // it supplies every other context field this fixture provides.
  vars: { integration_branch: 'forge/integration/stage-1' },
  // Bare workflow-level `inputs` fields referenced by one or more of the 20 workflows below, all
  // resolved from this one shared context the same way `stageId` already is in `10` §10.1's own
  // worked `build-stage` example (`vars.integration_branch: "forge/integration/{{stageId}}"`).
  stageId: 'stage-1',
  storyId: 'story-1',
  ownerRole: 'backend',
  defectId: 'defect-1',
  migrationGoal: 'expand the users table',
  changeSummary: 'add a new field',
  goal: 'extract a shared helper',
};

describe('the 20 built-in workflows (10 §10.5) all parse and compile cleanly', () => {
  it.each(Object.keys(WORKFLOW_INDEX) as WorkflowId[])('%s parses via parseWorkflow', (id) => {
    const result = parseWorkflow(readWorkflowSource(id));
    if (!result.success) {
      throw new Error(`${id} failed to parse: ${JSON.stringify(result.issues, null, 2)}`);
    }
    expect(result.workflow.id).toBe(id);
  });

  // Every one of the 20, `build-stage` included (`PLAN-M13.md` P13, `SPEC-QUESTIONS.md` Q211: it used to be
  // excluded here for a `merge`-over-fanout gap that is now closed in the compiler and the `review` keying).
  // `test/build-stage-compiles.test.ts` pins the exact graph it compiles to.
  const COMPILABLE_WORKFLOW_IDS = Object.keys(WORKFLOW_INDEX) as WorkflowId[];

  it.each(COMPILABLE_WORKFLOW_IDS)(
    '%s compiles via compileRunPlan against the shared fixture context',
    (id) => {
      const parsed = parseWorkflow(readWorkflowSource(id));
      if (!parsed.success) throw new Error(`${id} failed to parse`);
      const compiled = compileRunPlan(parsed.workflow, FIXTURE_CONTEXT);
      if (!compiled.success) {
        throw new Error(`${id} failed to compile: ${JSON.stringify(compiled.issues, null, 2)}`);
      }
      expect(compiled.nodes.length).toBeGreaterThan(0);
    },
  );

  // A `merge` over a collection now folds its per-item `dependsOn` (Q211). The other shipped `merge` steps have
  // an `over` that is not a collection (a run input, a step id) and must keep the single resolution they had.
  it('the other shipped merge steps compile to exactly the dependencies they always had', () => {
    const compileMerges = (source: string, context: object): Record<string, readonly string[]> => {
      const parsed = parseWorkflow(source);
      if (!parsed.success) throw new Error('does not parse');
      const compiled = compileRunPlan(parsed.workflow, context);
      if (!compiled.success) throw new Error(JSON.stringify(compiled.issues));
      return Object.fromEntries(
        compiled.nodes.filter((n) => n.kind === 'merge').map((n) => [n.id, n.dependsOn]),
      );
    };
    expect(compileMerges(readWorkflowSource('implement-story'), FIXTURE_CONTEXT)).toEqual({
      'implement-story:merge': ['implement-story:commit'],
    });
    expect(
      compileMerges(
        readFileSync(
          path.join(repoRoot, 'modules', 'fm-mobile', 'workflows', 'store-release.workflow.yaml'),
          'utf8',
        ),
        { ...FIXTURE_CONTEXT, buildTarget: 'ios' },
      ),
    ).toEqual({
      'store-release:merge-release-build': ['store-release:prepare-release-build'],
      'store-release:merge-submission': ['store-release:prepare-store-submission'],
    });
  });

  it("WORKFLOW_INDEX names exactly the 20 ids 10 §10.5's own table lists, no more and no fewer", () => {
    const ids = Object.keys(WORKFLOW_INDEX).sort();
    expect(ids).toEqual(
      [
        'adopt',
        'build-stage',
        'debug',
        'define-product',
        'deliver-stage',
        'discover',
        'harden',
        'implement-story',
        'initialize-project',
        'intake',
        'migrate',
        'operate',
        'plan-stage',
        'plan-stages',
        'quick-fix',
        'refactor',
        'replan',
        'retro',
        'shape-solution',
        'verify-stage',
      ].sort(),
    );
  });

  // `PLAN-M10.md` P14 (`16` §16.6) added one real, deliberate step beyond `10` §10.1's own literal
  // worked example: a `standup` session step, P6 Implementation's own named built-in placement ("on
  // long runs, triggered by elapsed time or blocked-lane count"). `10`'s own worked example predates
  // `16` §16.6 and was never meant to be a ceiling on real, later-milestone content — this test's own
  // job is "the shipped file has not silently drifted from what a spec-literate author would expect,"
  // not "the shipped file may never grow past the single worked example `10` happens to show." `worked`
  // below is therefore the worked example *plus* that one real addition, at the exact dependency
  // position `packages/templates/templates/workflows/build-stage.workflow.yaml`'s own comment documents
  // (`dependsOn: [contracts-gate]`, dependency-terminal) — still a real, structural fidelity check on
  // everything else in the file, not a license to let the comparison silently stop mattering.
  //
  // `PLAN-M13.md` P13 added two more deliberate differences. `dependsOn: [ prepare ]` on `freeze-contracts`: the
  // worked example leaves `prepare` unordered against everything (Q211). And `itemKey: "{{item.id}}"` on the `review` fanout.
  // The worked example omits it, which made `review` compile to positional ids (`review:0`) that `merge`'s own
  // `dependsOn: [ "review:{{item.id}}" ]` cannot name, so the file did not compile (Q211).
  it("build-stage matches 10 §10.1's own worked example, plus 16 §16.6's standup addition, the review itemKey and freeze-contracts after prepare (Q211)", () => {
    const worked = `
id: build-stage
name: Implement a stage
version: 1.0.0
description: Takes a planned stage to a verified, deployable state.
levels: [ L1, L2, L3, L4 ]           # which scale levels this applies to
requires:
  gates_passed: [ G-Ready ]
  artifacts: [ Epic, Story ]
inputs:
  - name: stageId
    type: string
    required: true

vars:
  integration_branch: "forge/integration/{{stageId}}"

steps:
  - id: prepare
    kind: command
    run: "git switch -c {{vars.integration_branch}} || git switch {{vars.integration_branch}}"
    inline: true

  - id: freeze-contracts
    kind: agent
    agent: architect
    dependsOn: [ prepare ]
    brief: briefs/freeze-contracts.md
    inputs: [ artifact:Epic(*), artifact:Story(*), kb:architecture/**, kb:data/** ]
    outputs:
      - type: InterfaceContract
        cardinality: many
    gateEvidence: [ G-Design ]

  - id: contracts-gate
    kind: gate
    gate: G-Design
    dependsOn: [ freeze-contracts ]

  - id: standup
    kind: session
    sessionType: standup
    dependsOn: [ contracts-gate ]
    when: "run.elapsedMs > 3600000 || run.blockedLaneCount >= 2"
    question: "What is blocking any active lane right now, and does anything need re-planning?"

  - id: generate-tests
    kind: fanout
    over: "stage.stories"
    itemKey: "{{item.id}}"
    dependsOn: [ contracts-gate ]
    step:
      kind: agent
      agent: sdet
      brief: briefs/write-failing-tests.md
      inputs: [ "artifact:Story({{item.id}})", artifact:HandoffRecord ]
      produces: [ "{{item.test_paths}}" ]
      limits: { maxTurns: 25, maxCostUsd: 1.5 }

  - id: implement
    kind: fanout
    over: "stage.stories"
    itemKey: "{{item.id}}"
    dependsOn: [ "generate-tests:{{item.id}}" ]     # per-item dependency
    step:
      kind: agent
      agent: "{{item.owner_role}}"
      brief: briefs/implement-story.md
      inputs: [ "artifact:Story({{item.id}})", artifact:InterfaceContract(*), kb:engineering/standards ]
      produces: "{{item.files_expected}}"
      retry: { maxAttempts: 3, retryOn: [ transient, test-failure, validation ] }
      onFailure: escalate

  - id: review
    kind: fanout
    over: "stage.stories"
    itemKey: "{{item.id}}"
    dependsOn: [ "implement:{{item.id}}" ]
    step:
      kind: agent
      agent: reviewer
      mode: swarm-review
      perspectives: [ design, security, testing, performance ]
      inputs: [ diff:lane, "artifact:Story({{item.id}})" ]
      outputs: [ { type: ReviewReport } ]

  - id: merge
    kind: merge
    over: "stage.stories"
    dependsOn: [ "review:{{item.id}}" ]
    policy: { conflict: agent, preChecks: fast, postChecks: full }

  - id: verify
    kind: gate
    gate: G-Verify
    dependsOn: [ merge ]

  - id: deliver
    kind: subworkflow
    workflow: deliver-stage
    dependsOn: [ verify ]

onFailure:
  default: block
  escalations:
    - when: "failures.test-failure > 2"
      do: { kind: agent, agent: diagnostician, brief: briefs/rca.md }

onComplete:
  - kind: agent
    agent: em
    brief: briefs/stage-retro.md
    outputs: [ { type: SessionRecord, subtype: retrospective } ]
  - kind: command
    run: "forge kb sync && forge spec matrix"
    inline: true
`;
    // Compared as parsed structures, not raw text, and `worked` above already quotes the same three
    // flow-sequence entries the spec's own literal fenced block leaves unquoted ("artifact:Story(
    // {{item.id}})" etc, inside `[ ... ]`) -- confirmed directly here (the unquoted original throws
    // "Missing , or : between flow sequence items"), and `@forge/engine/workflow`'s own P8 test suite
    // (`parse.test.ts`) already documents the identical spec-text imprecision: an unquoted `{{...}}`
    // inside a flow sequence is invalid YAML (parsed as an attempt to open a nested flow mapping), not
    // a template placeholder. Structural equality proves the shipped file's *content* is unchanged from
    // the spec's own intent; byte-for-byte equality of the raw text would just reproduce that defect.
    const workedResult = parseWorkflow(worked);
    const shippedResult = parseWorkflow(readWorkflowSource('build-stage'));
    if (!workedResult.success) throw new Error('the worked example itself failed to parse');
    if (!shippedResult.success)
      throw new Error('the shipped build-stage.workflow.yaml failed to parse');
    expect(shippedResult.workflow).toEqual(workedResult.workflow);
  });

  it('implement-story matches 10 §10.6\'s own nine real DSL steps (of its ten normative steps -- "context" is automatic packing, not a step)', () => {
    const parsed = parseWorkflow(readWorkflowSource('implement-story'));
    if (!parsed.success) throw new Error('implement-story failed to parse');
    expect(parsed.workflow.steps.map((step) => step.id)).toEqual([
      'plan',
      'red',
      'green',
      'refactor',
      'self-verify',
      'review',
      'document',
      'commit',
      'merge',
    ]);
  });

  it("every workflow references a gate id from 10 §10.3's own ten-row catalogue where it names one at all", () => {
    const knownGates = new Set([
      'G-Problem',
      'G-Product',
      'G-Design',
      'G-Foundation',
      'G-Ready',
      'G-Verify',
      'G-Stable',
      'G-Integration',
      'G-Deliver',
      'G-Operate',
    ]);
    for (const id of Object.keys(WORKFLOW_INDEX) as WorkflowId[]) {
      const parsed = parseWorkflow(readWorkflowSource(id));
      if (!parsed.success) throw new Error(`${id} failed to parse`);
      for (const step of parsed.workflow.steps) {
        if (step.kind === 'gate') expect(knownGates.has(step.gate)).toBe(true);
      }
    }
  });
});
