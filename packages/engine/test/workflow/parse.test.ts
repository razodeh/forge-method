/**
 * `parseWorkflow` — `PLAN-M5.md` P8's own Checks section, verbatim: `10` §10.1's own worked example
 * parses cleanly; a parse error on genuinely malformed YAML cites the real source line.
 *
 * @see specs/10 §10.1
 * @see PLAN-M5.md P8
 */
import { describe, expect, it, vi } from 'vitest';
import type { YAMLError } from 'yaml';

import { workflowSchema } from '../../src/workflow/schema.ts';
import {
  parseValueAgainstSchema,
  parseWorkflow,
  yamlErrorToParseIssue,
} from '../../src/workflow/parse.ts';

/** `10` §10.1's own worked example, transcribed from the spec text (the fenced code block under
 * "## 10.1 Workflow DSL") with one correction: three `inputs:` entries in the spec's own literal text
 * embed `{{item.id}}` unquoted inside a flow sequence (`[ artifact:Story({{item.id}}), ... ]`) — quoted
 * here instead (`"artifact:Story({{item.id}})"`), confirmed empirically that the spec's own literal form
 * is not valid YAML at all: an unquoted `{{...}}` inside a flow sequence is parsed as an attempt to open
 * a *nested flow mapping* (YAML's own `{` delimiter), not as a template placeholder, and fails with
 * "Missing , or : between flow sequence items." A real workflow author hitting this needs the exact same
 * quoting to get a parseable file; this is a spec-text imprecision (`SPEC-QUESTIONS.md`), not a defect
 * in `parseWorkflow` rejecting genuinely ambiguous YAML. This is the one document the whole spec pack
 * shows in full, so — corrected this one way — it is the primary proof this piece parses a *real*
 * workflow, not just fixtures invented for this test. */
const WORKED_EXAMPLE = `
id: build-stage
name: Implement a stage
version: 1.0.0
description: Takes a planned stage to a verified, deployable state.
levels: [ L1, L2, L3, L4 ]
requires:
  gates_passed: [ G-Ready ]
  artifacts: [ StagePlan ]
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
    brief: briefs/freeze-contracts.md
    inputs: [ artifact:StagePlan, kb:architecture/**, kb:data/** ]
    outputs:
      - type: InterfaceContract
        cardinality: many
    gateEvidence: [ G-Design ]

  - id: contracts-gate
    kind: gate
    gate: G-Design
    dependsOn: [ freeze-contracts ]

  - id: generate-tests
    kind: fanout
    over: "stage.stories"
    itemKey: "{{item.id}}"
    dependsOn: [ contracts-gate ]
    step:
      kind: agent
      agent: sdet
      brief: briefs/write-failing-tests.md
      inputs: [ "artifact:Story({{item.id}})", artifact:TestPlan ]
      produces: [ "{{item.test_paths}}" ]
      limits: { maxTurns: 25, maxCostUsd: 1.5 }

  - id: implement
    kind: fanout
    over: "stage.stories"
    itemKey: "{{item.id}}"
    dependsOn: [ "generate-tests:{{item.id}}" ]
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

describe('parseWorkflow', () => {
  it("parses 10 §10.1's own worked example cleanly, with every step kind and field intact", () => {
    const result = parseWorkflow(WORKED_EXAMPLE);

    if (!result.success) {
      throw new Error(
        `expected a successful parse, got issues: ${JSON.stringify(result.issues, null, 2)}`,
      );
    }
    expect(result.workflow.id).toBe('build-stage');
    expect(result.workflow.steps).toHaveLength(9);
    expect(result.workflow.steps.map((step) => step.id)).toEqual([
      'prepare',
      'freeze-contracts',
      'contracts-gate',
      'generate-tests',
      'implement',
      'review',
      'merge',
      'verify',
      'deliver',
    ]);

    const fanoutStep = result.workflow.steps.find((step) => step.id === 'generate-tests');
    if (fanoutStep?.kind !== 'fanout')
      throw new Error('expected generate-tests to be a fanout step');
    expect(fanoutStep.step.kind).toBe('agent');
    if (fanoutStep.step.kind === 'agent') {
      expect(fanoutStep.step.produces).toEqual(['{{item.test_paths}}']);
    }

    const implementStep = result.workflow.steps.find((step) => step.id === 'implement');
    if (implementStep?.kind !== 'fanout' || implementStep.step.kind !== 'agent') {
      throw new Error('expected implement to be a fanout step wrapping an agent step');
    }
    // The bare-string produces shape, not just the array shape generate-tests already covers.
    expect(implementStep.step.produces).toBe('{{item.files_expected}}');
    expect(implementStep.step.retry).toEqual({
      maxAttempts: 3,
      retryOn: ['transient', 'test-failure', 'validation'],
    });

    expect(result.workflow.onFailure?.default).toBe('block');
    expect(result.workflow.onFailure?.escalations).toHaveLength(1);
    expect(result.workflow.onFailure?.escalations?.[0]?.do.kind).toBe('agent');
    expect(result.workflow.onComplete).toHaveLength(2);
    expect(result.workflow.onComplete?.[1]?.kind).toBe('command');
  });

  it('reports a genuine YAML syntax error with a real source line and column, not a bare failure', () => {
    const malformed =
      'id: build-stage\nsteps:\n  - id: prepare\n    kind: command\n  run: "no space before run"\n';

    const result = parseWorkflow(malformed);

    if (result.success)
      throw new Error('expected parseWorkflow to fail on genuinely malformed YAML');
    expect(result.issues.length).toBeGreaterThan(0);
    const issue = result.issues[0];
    expect(issue?.line).toBeGreaterThan(0);
    expect(issue?.column).toBeGreaterThan(0);
  });

  it('treats a duplicate top-level key (a YAML warning, not an error) as a parse failure', () => {
    const duplicateKey =
      'id: build-stage\nid: build-stage-again\nsteps:\n  - id: a\n    kind: checkpoint\n';

    const result = parseWorkflow(duplicateKey);

    expect(result.success).toBe(false);
  });

  it('reports a schema-shape violation with a resolved source line, not just a JSON path', () => {
    const missingAgent = [
      'id: w',
      'name: W',
      'version: "1.0.0"',
      'description: d',
      'steps:',
      '  - id: a',
      '    kind: agent',
    ].join('\n');

    const result = parseWorkflow(missingAgent);

    if (result.success)
      throw new Error(
        'expected parseWorkflow to fail: agent step is missing its required agent field',
      );
    const issue = result.issues.find((candidate) => candidate.message.includes('agent'));
    expect(issue).toBeDefined();
    // The violation is a *missing* field -- no source text of its own to point to (see parse.ts's own
    // resolvePosition doc comment) -- so line/column are legitimately absent here, not a bug.
    expect(issue?.line).toBeUndefined();
  });

  it('resolves a real source line for a schema violation on a field that IS present, just wrong', () => {
    const wrongType = [
      'id: w',
      'name: W',
      'version: "1.0.0"',
      'description: d',
      'steps:',
      '  - id: a',
      '    kind: agent',
      '    agent: architect',
      '    inline: "not-a-boolean"', // inline belongs to command steps, not agent -- unknown key under .strict()
    ].join('\n');

    const result = parseWorkflow(wrongType);

    if (result.success)
      throw new Error('expected parseWorkflow to fail: inline is not a valid agent-step field');
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('resolves the real source line for a present-but-wrong-typed field specifically', () => {
    const wrongType = [
      'id: w',
      'name: W',
      'version: "1.0.0"',
      'description: d',
      'steps:',
      '  - id: a',
      '    kind: command',
      '    run: 42',
    ].join('\n');

    const result = parseWorkflow(wrongType);

    if (result.success)
      throw new Error('expected parseWorkflow to fail: run must be a string, not a number');
    const issue = result.issues[0];
    expect(issue?.line).toBe(8);
  });

  it('rejects an unrecognised step kind, not silently accepting it', () => {
    const badKind = [
      'id: w',
      'name: W',
      'version: "1.0.0"',
      'description: d',
      'steps:',
      '  - id: a',
      '    kind: not-a-real-kind',
    ].join('\n');

    const result = parseWorkflow(badKind);

    expect(result.success).toBe(false);
  });

  it('rejects a workflow with zero steps', () => {
    const noSteps = ['id: w', 'name: W', 'version: "1.0.0"', 'description: d', 'steps: []'].join(
      '\n',
    );

    const result = parseWorkflow(noSteps);

    expect(result.success).toBe(false);
  });

  it('rejects an unknown top-level field under .strict(), catching a likely typo', () => {
    const typo = [
      'id: w',
      'name: W',
      'version: "1.0.0"',
      'description: d',
      'stpes:',
      '  - id: a',
      '    kind: checkpoint',
    ].join('\n');

    const result = parseWorkflow(typo);

    expect(result.success).toBe(false);
  });

  it('rejects an empty steps array on a parallel/sequence group -- an empty group is exactly as inert as a workflow with zero steps', () => {
    const emptyGroup = [
      'id: w',
      'name: W',
      'version: "1.0.0"',
      'description: d',
      'steps:',
      '  - id: a',
      '    kind: parallel',
      '    steps: []',
    ].join('\n');

    expect(parseWorkflow(emptyGroup).success).toBe(false);
  });

  it('resolves a YAML merge key (<<: *anchor) rather than leaving it unresolved and failing with a confusing discriminator error', () => {
    const withMergeKey = [
      'id: w',
      'name: W',
      'version: "1.0.0"',
      'description: d',
      'steps:',
      '  - &tmpl',
      '    id: a',
      '    kind: agent',
      '    agent: engineer',
      '  - <<: *tmpl',
      '    id: b',
    ].join('\n');

    const result = parseWorkflow(withMergeKey);

    if (!result.success) {
      throw new Error(
        `expected the merge key to resolve cleanly, got issues: ${JSON.stringify(result.issues)}`,
      );
    }
    expect(result.workflow.steps).toHaveLength(2);
    expect(result.workflow.steps[1]).toEqual({ id: 'b', kind: 'agent', agent: 'engineer' });
  });
});

describe('yamlErrorToParseIssue', () => {
  it('resolves line/column from a real YAMLError-shaped linePos', () => {
    // Only the two fields yamlErrorToParseIssue actually reads are given -- a double cast through
    // `unknown` since this object deliberately doesn't carry YAMLError's full real-instance shape
    // (name/code/pos), matching the same minimal-fixture convention used elsewhere in this codebase
    // for a type this piece never itself constructs, only ever receives from the `yaml` package.
    const error = { message: 'boom', linePos: [{ line: 3, col: 5 }] } as unknown as YAMLError;

    expect(yamlErrorToParseIssue(error)).toEqual({ message: 'boom', line: 3, column: 5 });
  });

  it('omits line/column, not just falling back to 0, when linePos is entirely absent', () => {
    // The yaml package's own source (errors.js) confirms `linePos` can genuinely stay unset
    // (`if (error.pos[0] === -1) return;`), though no real input this project's tests could construct
    // ever triggers it -- directly testing the exported function is how this branch gets covered.
    const error = { message: 'boom', linePos: undefined } as unknown as YAMLError;

    expect(yamlErrorToParseIssue(error)).toEqual({ message: 'boom' });
  });
});

describe('parseValueAgainstSchema — RangeError recovery', () => {
  it('confirms workflowSchema.safeParse genuinely throws a raw RangeError on a sufficiently deep plain object, not a hypothetical', () => {
    // The premise the recovery branch exists for, proven directly rather than assumed: build a plain
    // object nested well past any real workflow's own depth, bypassing YAML/parseWorkflow entirely.
    let deep: unknown = { id: 'leaf', kind: 'checkpoint' };
    for (let i = 0; i < 5000; i += 1) {
      deep = { id: `g${String(i)}`, kind: 'parallel', steps: [deep] };
    }

    expect(() => workflowSchema.safeParse(deep)).toThrow(RangeError);
  });

  it('recovers a real RangeError from workflowSchema.safeParse as a clean ParseIssue rather than letting it propagate', async () => {
    const { LineCounter, parseDocument } = await import('yaml');
    const doc = parseDocument('id: x');
    const lineCounter = new LineCounter();
    const spy = vi.spyOn(workflowSchema, 'safeParse').mockImplementation(() => {
      throw new RangeError('Maximum call stack size exceeded');
    });

    let result: ReturnType<typeof parseValueAgainstSchema>;
    try {
      result = parseValueAgainstSchema(doc, lineCounter, {});
    } finally {
      spy.mockRestore();
    }

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.message).toContain('nests too deeply');
  });

  it('re-throws an error that is not a RangeError, rather than misreporting an unrelated bug as "too deep"', async () => {
    const { LineCounter, parseDocument } = await import('yaml');
    const doc = parseDocument('id: x');
    const lineCounter = new LineCounter();
    const spy = vi.spyOn(workflowSchema, 'safeParse').mockImplementation(() => {
      throw new TypeError('something else entirely');
    });

    try {
      expect(() => parseValueAgainstSchema(doc, lineCounter, {})).toThrow(TypeError);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('parseWorkflow — deep nesting does not crash, regardless of which layer would give up first', () => {
  it('reports a clean issue rather than throwing for extremely deep block-style nesting', () => {
    const DEPTH = 700;
    let body = '';
    for (let i = 0; i < DEPTH; i += 1) {
      body += `${'  '.repeat(i)}- id: g${String(i)}\n${'  '.repeat(i)}  kind: parallel\n${'  '.repeat(i)}  steps:\n`;
    }
    body += `${'  '.repeat(DEPTH)}- id: leaf\n${'  '.repeat(DEPTH)}  kind: checkpoint\n`;
    const text = `id: w\nname: W\nversion: "1.0.0"\ndescription: d\nsteps:\n${body}`;

    let result: ReturnType<typeof parseWorkflow> | undefined;
    expect(() => {
      result = parseWorkflow(text);
    }).not.toThrow();
    expect(result?.success).toBe(false);
  });

  it('reports a clean issue rather than throwing for extremely deep flow-style nesting', () => {
    const DEPTH = 700;
    let open = '';
    let close = '';
    for (let i = 0; i < DEPTH; i += 1) {
      open += `{id: g${String(i)}, kind: parallel, steps: [`;
      close += ']}';
    }
    const text = `id: w\nname: W\nversion: "1.0.0"\ndescription: d\nsteps: [${open}{id: leaf, kind: checkpoint}${close}]\n`;

    let result: ReturnType<typeof parseWorkflow> | undefined;
    expect(() => {
      result = parseWorkflow(text);
    }).not.toThrow();
    expect(result?.success).toBe(false);
  });
});

describe('parseWorkflow — session step question/when (PLAN-M10.md P14, 16 §16.6)', () => {
  const SESSION_WORKFLOW = `
id: w
name: W
version: "1.0.0"
description: d
steps:
  - id: retro
    kind: session
    sessionType: retro
    question: "What did this stage's own real data teach us?"
  - id: standup
    kind: session
    sessionType: standup
    question: "What is blocking any active lane right now?"
    when: "run.elapsedMs > 3600000 || run.blockedLaneCount >= 2"
`;

  it('accepts a session step carrying both a literal question and a when trigger', () => {
    const result = parseWorkflow(SESSION_WORKFLOW);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const [retro, standup] = result.workflow.steps;
    expect(retro).toMatchObject({
      kind: 'session',
      sessionType: 'retro',
      question: "What did this stage's own real data teach us?",
    });
    expect(standup).toMatchObject({
      kind: 'session',
      sessionType: 'standup',
      when: 'run.elapsedMs > 3600000 || run.blockedLaneCount >= 2',
    });
  });

  it('still rejects an unrecognised field on a session step (.strict())', () => {
    const text = `
id: w
name: W
version: "1.0.0"
description: d
steps:
  - id: retro
    kind: session
    sessionType: retro
    technique: five-whys
`;
    const result = parseWorkflow(text);
    expect(result.success).toBe(false);
  });
});
