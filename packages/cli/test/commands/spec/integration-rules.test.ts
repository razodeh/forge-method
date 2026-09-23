/**
 * `forge spec validate --rule version-skew` and `--rule migration-order-violations` (`G-Integration`,
 * `PLAN-M13.md` P26, Q228).
 *
 * The specs name the two conditions but not where either is declared, so the declarations are P26's
 * (`<kb>/architecture/version-skew.yaml`, `<kb>/data/migrations.yaml`; Q228). Every fixture is a real file: contracts are
 * plain YAML with the front matter keys at the top level, declarations are YAML. A passing and a failing fixture for
 * every clause, and malformed-input cases: a missing, empty, non-mapping, oversized or mistyped file is a violation.
 *
 * @see specs/10 §10.3
 * @see specs/12 F-DATA-6
 * @see specs/14 §14.4
 * @see PLAN-M13.md P26
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';
import { FakePlatformAdapter } from '@forge/testkit';
import { readEvents, type ForgeEvent } from '@forge/telemetry/events';
import { afterEach, describe, expect, it } from 'vitest';

import type { SpecCommandContext } from '../../../src/commands/spec.ts';
import { runWorkflow } from '../../../src/commands/run/run.ts';
import {
  specValidateRule,
  VALIDATE_RULE_IDS,
  type ValidateRuleId,
} from '../../../src/commands/spec/validate-rules.ts';
import {
  KB_ROOT,
  SPECS_ROOT,
  cleanupAll,
  createTestProject,
  type TestProject,
} from '../helpers.ts';
import { writeFixtureAgent } from '../loop/helpers.ts';
import {
  WORKFLOWS_ROOT,
  FIXTURE_GATE_ID,
  cleanupAll as cleanupRunAll,
  createTestProject as createRunTestProject,
  fixtureExpressionContext,
  testRunDeps,
  type TestProject as RunTestProject,
} from '../run/helpers.ts';

afterEach(cleanupAll);

const ctx = (project: TestProject): SpecCommandContext => ({
  paths: project.paths,
  specsRoot: SPECS_ROOT,
  kbRoot: KB_ROOT,
});

async function put(project: TestProject, relative: string, text: string): Promise<void> {
  const target = path.join(project.dir, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, text, 'utf8');
}

async function run(project: TestProject, rule: ValidateRuleId) {
  return (await specValidateRule(ctx(project), rule)).violations;
}

const SKEW = `${KB_ROOT}/architecture/version-skew.yaml`;
const MIGRATIONS = `${KB_ROOT}/data/migrations.yaml`;

async function contract(project: TestProject, id: string): Promise<void> {
  await put(
    project,
    `${SPECS_ROOT}/interfaces/${id.toLowerCase()}.yaml`,
    `id: ${id}
type: InterfaceContract
schemaVersion: 1
title: Orders API
status: draft
created: 2026-01-15
updated: 2026-01-15
revision: 1
author: architect
changelog: []
openapi: 3.1.0
`,
  );
}

describe('version-skew', () => {
  const RULE: ValidateRuleId = 'version-skew';

  it('is a rule the CLI accepts', () => {
    expect(VALIDATE_RULE_IDS).toContain(RULE);
  });

  it('passes a declared policy with every contract declared and every consumer within it', async () => {
    const project = await createTestProject();
    await contract(project, 'INT-001');
    await contract(project, 'INT-002');
    await put(
      project,
      SKEW,
      `policy:
  max_skew: 1
contracts:
  INT-001:
    current: 3
    supported: [2, 3]
    consumers:
      - { name: web, version: 3 }
      - { name: worker, version: 2 }
  INT-002:
    current: 1
    consumers: []
`,
    );
    expect(await run(project, RULE)).toEqual([]);
  });

  it('passes an explicit "none": a policy and no contracts, in a project with no contract', async () => {
    const project = await createTestProject();
    await put(
      project,
      SKEW,
      'policy:\n  max_skew: 0\ncontracts: {}\nnone_reason: no cross-service interfaces yet\n',
    );
    expect(await run(project, RULE)).toEqual([]);
  });

  it('an empty contracts declaration needs a none_reason, and max_skew above 10 is refused', async () => {
    const project = await createTestProject();
    await put(project, SKEW, 'policy: { max_skew: 1 }\ncontracts: {}\n');
    const found = await run(project, RULE);
    expect(found[0]?.message).toContain('none_reason');
    expect(found[0]?.remedy).toContain('policy.max_skew');
    await put(
      project,
      SKEW,
      'policy: { max_skew: 11 }\ncontracts: {}\nnone_reason: no interfaces yet\n',
    );
    expect((await run(project, RULE))[0]?.message).toContain('max_skew');
  });

  it('fails when nothing is declared: a MISSING file is not a statement', async () => {
    const found = await run(await createTestProject(), RULE);
    expect(found).toHaveLength(1);
    expect(found[0]?.subject).toBe(SKEW);
    expect(found[0]?.message).toContain('is not declared');
    expect(found[0]?.remedy).toMatch(/^Create /);
  });

  it.each([
    ['an empty file', ''],
    ['a list, not a mapping', '- 1\n- 2\n'],
    ['YAML that does not parse', 'policy: [unclosed\n'],
    [
      'a policy with no max_skew',
      'policy: {}\ncontracts: {}\nnone_reason: no cross-service interfaces yet\n',
    ],
    [
      'a fractional max_skew',
      'policy: { max_skew: 1.5 }\ncontracts: {}\nnone_reason: no cross-service interfaces yet\n',
    ],
    [
      'a negative max_skew',
      'policy: { max_skew: -1 }\ncontracts: {}\nnone_reason: no cross-service interfaces yet\n',
    ],
    [
      'a max_skew given as text',
      'policy: { max_skew: "1" }\ncontracts: {}\nnone_reason: no cross-service interfaces yet\n',
    ],
    ['an unknown key (a typo)', 'policy: { max_skew: 1 }\ncontracts: {}\nmax-skew: 1\n'],
    ['no contracts key at all', 'policy: { max_skew: 1 }\n'],
  ])('fails %s with a violation naming the file', async (_label, text) => {
    const project = await createTestProject();
    await put(project, SKEW, text);
    const found = await run(project, RULE);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]?.subject).toBe(SKEW);
    expect(found[0]?.remedy).toBeTruthy();
  });

  it('fails a file over the size ceiling', async () => {
    const project = await createTestProject();
    await put(
      project,
      SKEW,
      `policy: { max_skew: 1 }\ncontracts: {}\nnone_reason: x\n# ${'x'.repeat(1_100_000)}\n`,
    );
    expect((await run(project, RULE))[0]?.message).toContain('byte limit');
  });

  it('fails a contract that has no declared version', async () => {
    const project = await createTestProject();
    await contract(project, 'INT-001');
    await put(
      project,
      SKEW,
      'policy: { max_skew: 1 }\ncontracts: {}\nnone_reason: no cross-service interfaces yet\n',
    );
    const found = await run(project, RULE);
    expect(found).toHaveLength(1);
    expect(found[0]?.subject).toBe('INT-001');
    expect(found[0]?.message).toContain('no declared version');
  });

  it('fails a declared id that no contract defines', async () => {
    const project = await createTestProject();
    await put(
      project,
      SKEW,
      'policy: { max_skew: 1 }\ncontracts:\n  INT-009: { current: 1, consumers: [] }\n',
    );
    expect((await run(project, RULE))[0]?.message).toContain('which no interface contract defines');
  });

  it('fails a contract file that is not a valid contract: its version cannot be checked', async () => {
    const project = await createTestProject();
    await put(project, `${SPECS_ROOT}/interfaces/raw.yaml`, 'openapi: 3.1.0\n');
    await put(
      project,
      SKEW,
      'policy: { max_skew: 1 }\ncontracts: {}\nnone_reason: no cross-service interfaces yet\n',
    );
    expect((await run(project, RULE))[0]?.subject).toBe(`${SPECS_ROOT}/interfaces/raw.yaml`);
  });

  describe('per contract', () => {
    async function declared(entry: string, maxSkew = 1): Promise<readonly string[]> {
      const project = await createTestProject();
      await contract(project, 'INT-001');
      await put(
        project,
        SKEW,
        `policy: { max_skew: ${String(maxSkew)} }\ncontracts:\n  INT-001:\n${entry}\n`,
      );
      return (await run(project, RULE)).map((violation) => violation.message);
    }

    it('fails a consumer further behind than the policy allows, and passes one exactly at the limit', async () => {
      expect(
        await declared('    current: 4\n    consumers:\n      - { name: web, version: 3 }'),
      ).toEqual([]);
      const found = await declared(
        '    current: 4\n    consumers:\n      - { name: web, version: 2 }',
      );
      expect(found).toHaveLength(1);
      expect(found[0]).toContain('2 behind the current 4; the policy allows 1');
    });

    it('a zero max_skew allows only the current version', async () => {
      expect(
        await declared('    current: 2\n    consumers:\n      - { name: web, version: 2 }', 0),
      ).toEqual([]);
      expect(
        (await declared('    current: 2\n    consumers:\n      - { name: web, version: 1 }', 0))
          .length,
      ).toBe(1);
    });

    it('fails a consumer on a version that does not exist yet', async () => {
      const found = await declared(
        '    current: 2\n    consumers:\n      - { name: web, version: 3 }',
      );
      expect(found[0]).toContain('does not exist yet');
    });

    it('fails a consumer on a version the provider does not list as supported', async () => {
      const found = await declared(
        '    current: 4\n    supported: [2, 4]\n    consumers:\n      - { name: web, version: 3 }',
        2,
      );
      expect(found[0]).toContain('does not list as supported');
    });

    it('fails a consumer listed twice, and a name that is blank', async () => {
      const twice = await declared(
        '    current: 1\n    consumers:\n      - { name: web, version: 1 }\n      - { name: web, version: 1 }',
      );
      expect(twice[0]).toContain('listed more than once');
      const project = await createTestProject();
      await contract(project, 'INT-001');
      await put(
        project,
        SKEW,
        "policy: { max_skew: 1 }\ncontracts:\n  INT-001:\n    current: 1\n    consumers:\n      - { name: '', version: 1 }\n",
      );
      expect((await run(project, RULE)).length).toBeGreaterThan(0);
    });

    it.each([
      ['not ascending', '[3, 2]', 'strictly ascending'],
      ['with a repeat', '[2, 2, 3]', 'strictly ascending'],
      ['not ending at current', '[1, 2]', 'does not end at the current version 3'],
      ['wider than the policy', '[1, 2, 3]', 'over the policy maximum of 1'],
    ])('fails a supported list that is %s', async (_label, supported, expected) => {
      const found = await declared(
        `    current: 3\n    supported: ${supported}\n    consumers: []`,
      );
      expect(found.join(' ')).toContain(expected);
    });

    it('fails a current version that is not a positive integer', async () => {
      for (const current of ['0', '-1', '1.5', '"2"']) {
        const found = await declared(`    current: ${current}\n    consumers: []`);
        expect(found.length, current).toBeGreaterThan(0);
      }
    });
  });

  it('is deterministic and sorted', async () => {
    const project = await createTestProject();
    await contract(project, 'INT-002');
    await contract(project, 'INT-001');
    await put(
      project,
      SKEW,
      'policy: { max_skew: 1 }\ncontracts: {}\nnone_reason: no cross-service interfaces yet\n',
    );
    const first = JSON.stringify(await run(project, RULE));
    expect(JSON.stringify(await run(project, RULE))).toBe(first);
    expect((await run(project, RULE)).map((v) => v.subject)).toEqual(['INT-001', 'INT-002']);
  });
});

describe('migration-order-violations', () => {
  const RULE: ValidateRuleId = 'migration-order-violations';

  async function declared(yaml: string): Promise<readonly string[]> {
    const project = await createTestProject();
    await put(project, MIGRATIONS, yaml);
    return (await run(project, RULE)).map((violation) => violation.message);
  }

  const GOOD = `migrations:
  - { id: M-001, phase: expand, release: 1 }
  - { id: M-002, phase: migrate, release: 2, after: [M-001], expands: M-001 }
  - { id: M-003, phase: contract, release: 3, after: [M-002], expands: M-001 }
`;

  it('is a rule the CLI accepts', () => {
    expect(VALIDATE_RULE_IDS).toContain(RULE);
  });

  it('passes an ordered expand, migrate, contract sequence in separate releases', async () => {
    expect(await declared(GOOD)).toEqual([]);
  });

  it('passes an explicit "none" and an expand with no contract yet', async () => {
    expect(await declared('migrations: []\nnone_reason: the service has no database\n')).toEqual(
      [],
    );
    expect(await declared('migrations:\n  - { id: M-001, phase: expand, release: 1 }\n')).toEqual(
      [],
    );
  });

  it.each(['x', 'TODO', 'n/a', 'none', 'short'])(
    'a stand-in none_reason (%s) is refused',
    async (word) => {
      const found = await declared(`migrations: []\nnone_reason: ${word}\n`);
      expect(found.join(' ')).toContain('none_reason');
    },
  );

  it('an empty migrations list needs a none_reason', async () => {
    const found = await declared('migrations: []\n');
    expect(found.join(' ')).toContain('none_reason');
  });

  it('fails when nothing is declared: a MISSING file is not a statement', async () => {
    const found = await run(await createTestProject(), RULE);
    expect(found).toHaveLength(1);
    expect(found[0]?.subject).toBe(MIGRATIONS);
    expect(found[0]?.remedy).toMatch(/^Create /);
  });

  it.each([
    ['an empty file', ''],
    ['a list, not a mapping', '- 1\n'],
    ['YAML that does not parse', 'migrations: [unclosed\n'],
    ['migrations that is not a list', 'migrations: nope\n'],
    ['an unknown phase', 'migrations:\n  - { id: M-001, phase: drop, release: 1 }\n'],
    ['a release of zero', 'migrations:\n  - { id: M-001, phase: expand, release: 0 }\n'],
    ['a release given as text', 'migrations:\n  - { id: M-001, phase: expand, release: "1" }\n'],
    [
      'an id that is not an identifier',
      'migrations:\n  - { id: "M 1; rm", phase: expand, release: 1 }\n',
    ],
    ['an unknown key', 'migrations:\n  - { id: M-001, phase: expand, release: 1, note: x }\n'],
    ['a top-level typo', 'migration: []\n'],
  ])('fails %s with a violation naming the file', async (_label, yaml) => {
    const project = await createTestProject();
    await put(project, MIGRATIONS, yaml);
    const found = await run(project, RULE);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]?.subject).toBe(MIGRATIONS);
  });

  it('fails a duplicate id', async () => {
    const found = await declared(
      'migrations:\n  - { id: M-001, phase: expand, release: 1 }\n  - { id: M-001, phase: expand, release: 2 }\n',
    );
    expect(found).toEqual(['M-001 is declared more than once.']);
  });

  it('fails a reference to a migration that is not declared, or is listed later, or is itself', async () => {
    expect((await declared(GOOD.replace('after: [M-001]', 'after: [M-009]')))[0]).toContain(
      'which is not declared',
    );
    const later = await declared(`migrations:
  - { id: M-001, phase: expand, release: 1, after: [M-002] }
  - { id: M-002, phase: expand, release: 1 }
`);
    expect(later[0]).toContain('listed after it');
    const self = await declared(
      'migrations:\n  - { id: M-001, phase: expand, release: 1, after: [M-001] }\n',
    );
    expect(self[0]).toContain('itself');
  });

  it('fails a release that goes backwards down the list, and a migration that ships before one it comes after', async () => {
    const backwards = await declared(`migrations:
  - { id: M-001, phase: expand, release: 3 }
  - { id: M-002, phase: expand, release: 2 }
`);
    expect(backwards[0]).toContain(
      'ships in release 2 but is listed after a migration that ships in release 3',
    );
    const before = await declared(`migrations:
  - { id: M-001, phase: expand, release: 3 }
  - { id: M-002, phase: expand, release: 2, after: [M-001] }
`);
    expect(before.join(' ')).toContain('comes after M-001, which ships later, in release 3');
    // the same release is fine
    expect(
      await declared(`migrations:
  - { id: M-001, phase: expand, release: 3 }
  - { id: M-002, phase: expand, release: 3, after: [M-001] }
`),
    ).toEqual([]);
  });

  it('fails a contract in the same release as its expand, or as a migrate step (the destructive change must be a separate release)', async () => {
    const sameAsExpand = await declared(`migrations:
  - { id: M-001, phase: expand, release: 1 }
  - { id: M-003, phase: contract, release: 1, expands: M-001 }
`);
    expect(sameAsExpand.join(' ')).toContain('separate, later release');
    const sameAsMigrate = await declared(`migrations:
  - { id: M-001, phase: expand, release: 1 }
  - { id: M-002, phase: migrate, release: 2, expands: M-001 }
  - { id: M-003, phase: contract, release: 2, expands: M-001 }
`);
    expect(sameAsMigrate.join(' ')).toContain('same release as or before M-002');
  });

  it('fails a contract listed before a migrate step of the same expand', async () => {
    const found = await declared(`migrations:
  - { id: M-001, phase: expand, release: 1 }
  - { id: M-003, phase: contract, release: 3, expands: M-001 }
  - { id: M-002, phase: migrate, release: 3, expands: M-001 }
`);
    expect(found.join(' ')).toContain('is listed before M-002');
  });

  it('fails a migrate or contract that names no expand, an expand that names one, and an expands that is not an expand', async () => {
    expect(
      (await declared('migrations:\n  - { id: M-001, phase: contract, release: 2 }\n'))[0],
    ).toContain('does not say which expand migration');
    expect(
      (
        await declared(
          'migrations:\n  - { id: M-001, phase: expand, release: 1, expands: M-001 }\n',
        )
      )[0],
    ).toContain('only a migrate or contract migration belongs');
    const wrong = await declared(`migrations:
  - { id: M-001, phase: expand, release: 1 }
  - { id: M-002, phase: migrate, release: 2, expands: M-001 }
  - { id: M-003, phase: contract, release: 3, expands: M-002 }
`);
    expect(wrong[0]).toContain('which is a migrate migration, not an expand');
  });

  it('two independent expand-contract chains do not interfere', async () => {
    expect(
      await declared(`migrations:
  - { id: A-1, phase: expand, release: 1 }
  - { id: B-1, phase: expand, release: 1 }
  - { id: A-2, phase: contract, release: 2, expands: A-1 }
  - { id: B-2, phase: contract, release: 3, expands: B-1 }
`),
    ).toEqual([]);
  });

  it('is deterministic and sorted', async () => {
    const project = await createTestProject();
    await put(
      project,
      MIGRATIONS,
      `migrations:\n  - { id: Z-1, phase: contract, release: 2 }\n  - { id: A-1, phase: contract, release: 2 }\n`,
    );
    const first = JSON.stringify(await run(project, RULE));
    expect(JSON.stringify(await run(project, RULE))).toBe(first);
    expect((await run(project, RULE)).map((v) => v.subject)).toEqual(['A-1', 'Z-1']);
  });
});

/**
 * `PLAN-M14.md` P21's own "real runWorkflow" case: the two declaration files these rules read are
 * genuinely inside the writing step's claim, through a real `runWorkflow`, a real lane commit and a
 * real `FakePlatformAdapter` session -- not merely a produces-list assertion. `build-stage:freeze-contracts`
 * and `shape-solution:model-data`'s own real `produces` (`PLAN-M14.md` P21) are mirrored here rather than
 * run through the full shipped workflows, which would need every other stage step to succeed too; the
 * claim shape under test is identical (`freeze-contracts`'s own `outputs` + `produces`,
 * `model-data`'s own `produces`).
 *
 * @see PLAN-M14.md P21
 * @see PLAN-M14.md P3
 */
describe('real runWorkflow: the declaration files stay inside the writing step’s own claim (PLAN-M14.md P21)', () => {
  afterEach(cleanupRunAll);

  const FREEZE_WORKFLOW_ID = 'p21-freeze-wf';
  const FREEZE_STEP_ID = `${FREEZE_WORKFLOW_ID}:freeze-contracts`;
  const FREEZE_GATE_STEP_ID = `${FREEZE_WORKFLOW_ID}:verify`;
  const CONTRACT_PATH = 'docs/forge/specs/interfaces/orders-api.yaml';
  const SKEW_PATH = `${KB_ROOT}/architecture/version-skew.yaml`;
  const SKEW_WRONG_EXT_PATH = `${KB_ROOT}/architecture/version-skew.yml`;
  /** A real, schema-valid `InterfaceContract` (the same shape `contract()` above writes under
   * `specs/interfaces/`) -- the engine's own output-contract check validates the full record, not only
   * that the file exists. */
  const CONTRACT_CONTENT = `id: INT-001
type: InterfaceContract
schemaVersion: 1
title: Orders API
status: draft
created: 2026-01-15
updated: 2026-01-15
revision: 1
author: architect
changelog: []
openapi: 3.1.0
`;

  const FREEZE_WORKFLOW = `
id: ${FREEZE_WORKFLOW_ID}
name: P21 freeze-contracts claim
version: 1.0.0
description: Mirrors build-stage's freeze-contracts claim -- InterfaceContract outputs plus version-skew.yaml in produces.
steps:
  - id: freeze-contracts
    kind: agent
    agent: architect
    brief: briefs/implement.md
    outputs: [ { type: InterfaceContract, cardinality: many } ]
    produces: [ '${SKEW_PATH}' ]
  - id: verify
    kind: gate
    gate: ${FIXTURE_GATE_ID}
    dependsOn: [ freeze-contracts ]
`;

  const MODEL_DATA_WORKFLOW_ID = 'p21-model-data-wf';
  const MODEL_DATA_STEP_ID = `${MODEL_DATA_WORKFLOW_ID}:model-data`;
  const MIGRATIONS_PATH = `${KB_ROOT}/data/migrations.yaml`;

  const MODEL_DATA_WORKFLOW = `
id: ${MODEL_DATA_WORKFLOW_ID}
name: P21 model-data claim
version: 1.0.0
description: Mirrors shape-solution's model-data claim -- migrations.yaml in produces.
steps:
  - id: model-data
    kind: agent
    agent: data-architect
    brief: briefs/implement.md
    produces: [ '${MIGRATIONS_PATH}' ]
`;

  async function projectWith(workflowId: string, workflow: string): Promise<RunTestProject> {
    const base = await createRunTestProject();
    await writeFixtureAgent(base.dir, 'architect', 'Architect', { write: true });
    await writeFixtureAgent(base.dir, 'data-architect', 'Data architect', { write: true });
    await writeFile(path.join(base.dir, WORKFLOWS_ROOT, `${workflowId}.workflow.yaml`), workflow);
    await execa('git', ['add', '-A'], { cwd: base.dir });
    await execa('git', ['commit', '--quiet', '-m', 'p21 declaration workflow'], { cwd: base.dir });
    return {
      ...base,
      config: { ...base.config, execution: { ...base.config.execution, autonomy: 'autonomous' } },
    };
  }

  async function runReal(workflowId: string, project: RunTestProject, adapter: FakePlatformAdapter, runId: string) {
    const result = await runWorkflow(testRunDeps(project, adapter), {
      workflowId,
      expressionContext: fixtureExpressionContext(),
      runId,
      host: 'test-host',
    });
    if (result.kind !== 'run') throw new Error('expected a real run');
    const events: ForgeEvent[] = [];
    for await (const event of readEvents(project.dir, runId)) events.push(event);
    return { result, events };
  }

  function typesFor(events: readonly ForgeEvent[], stepId: string): string[] {
    return events.filter((event) => event.stepId === stepId).map((event) => event.type);
  }

  function revertsFor(events: readonly ForgeEvent[], stepId: string) {
    return events.filter(
      (event) =>
        event.type === 'LaneCommitted' &&
        event.stepId === stepId &&
        (event.payload as { reason?: string } | undefined)?.reason === 'claim-revert',
    );
  }

  it('an architect session writing a contract AND version-skew.yaml keeps both', async () => {
    const project = await projectWith(FREEZE_WORKFLOW_ID, FREEZE_WORKFLOW);
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, {
      text: ['froze a contract and declared version skew'],
      writeFiles: [
        { relativePath: CONTRACT_PATH, content: CONTRACT_CONTENT },
        {
          relativePath: SKEW_PATH,
          content: 'policy:\n  max_skew: 1\ncontracts: {}\nnone_reason: none frozen yet\n',
        },
      ],
    });
    const { result, events } = await runReal(FREEZE_WORKFLOW_ID, project, adapter, 'run-p21-freeze-ok');
    expect(result.runState.runStatus).toBe('completed');
    expect(typesFor(events, FREEZE_STEP_ID)).toContain('StepSucceeded');
    expect(typesFor(events, FREEZE_GATE_STEP_ID)).toContain('GateApproved');
    expect(revertsFor(events, FREEZE_STEP_ID)).toEqual([]);
  });

  it('a data-architect session keeps migrations.yaml', async () => {
    const project = await projectWith(MODEL_DATA_WORKFLOW_ID, MODEL_DATA_WORKFLOW);
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, {
      text: ['wrote the initial migrations declaration'],
      writeFiles: [
        { relativePath: MIGRATIONS_PATH, content: 'migrations: []\nnone_reason: none planned yet\n' },
      ],
    });
    const { result, events } = await runReal(
      MODEL_DATA_WORKFLOW_ID,
      project,
      adapter,
      'run-p21-model-data-ok',
    );
    expect(result.runState.runStatus).toBe('completed');
    expect(typesFor(events, MODEL_DATA_STEP_ID)).toContain('StepSucceeded');
    expect(revertsFor(events, MODEL_DATA_STEP_ID)).toEqual([]);
  });

  it('a version-skew.yml write (wrong extension) is reverted and fails the step (PLAN-M14.md P3)', async () => {
    const project = await projectWith(FREEZE_WORKFLOW_ID, FREEZE_WORKFLOW);
    const adapter = new FakePlatformAdapter();
    adapter.script(() => true, {
      text: ['declared version skew at the wrong extension'],
      writeFiles: [
        { relativePath: CONTRACT_PATH, content: CONTRACT_CONTENT },
        {
          relativePath: SKEW_WRONG_EXT_PATH,
          content: 'policy:\n  max_skew: 1\ncontracts: {}\nnone_reason: none frozen yet\n',
        },
      ],
    });
    const { result, events } = await runReal(
      FREEZE_WORKFLOW_ID,
      project,
      adapter,
      'run-p21-freeze-wrong-ext',
    );
    expect(result.runState.runStatus).toBe('failed');
    const revert = revertsFor(events, FREEZE_STEP_ID)[0];
    expect(revert).toBeDefined();
    const violation = events.find(
      (event) => event.type === 'PolicyViolation' && event.stepId === FREEZE_STEP_ID,
    );
    expect(violation?.payload).toMatchObject({
      kind: 'out-of-claim-write',
      policy: 'strict',
      stepFailed: true,
      paths: [SKEW_WRONG_EXT_PATH],
      totalReverted: 1,
    });
    const failed = events.find(
      (event) => event.type === 'StepFailed' && event.stepId === FREEZE_STEP_ID,
    );
    expect(JSON.stringify(failed?.payload)).toContain('RUN-104');
    expect(typesFor(events, FREEZE_GATE_STEP_ID)).toEqual([]);
  });
});
