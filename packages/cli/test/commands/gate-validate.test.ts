/**
 * `gateValidateAll` -- `specs/22` M13 acceptance for gate-embedded `brief:` references
 * (`SPEC-QUESTIONS.md` Q197 item 2 disclosed nothing validated them; the P2c piece closes that).
 *
 * Every gate's `checks.advisory[].brief` must resolve, through `@forge/agents/prompt`'s
 * `resolveContentReference` (the loader dispatch uses), to a real, non-empty `.forge/briefs/*.md`.
 * A fresh `forge init` must produce zero findings (the ten shipped `critique-*` briefs exist), and each
 * way a reference can be unusable must produce one itemized finding naming the gate and check.
 *
 * @see specs/22 M13
 * @see specs/10 §10.3
 */
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as YAML from 'yaml';
import { FakePlatformAdapter } from '@forge/testkit';
import { ProjectPaths, writeFileAtomic } from '@forge/core/fs';

import { gateValidateAll } from '../../src/commands/workflow.ts';
import { loadGateRegistry } from '../../src/commands/run/gates.ts';
import { runInit } from '../../src/init/run-init.ts';
import { cleanupAll, createTestProject, registerCleanup } from './upgrade/helpers.ts';

const REAL_MODULES_DIR = fileURLToPath(new URL('../../../../modules/', import.meta.url));

afterEach(cleanupAll);

const LAUNCHER = fileURLToPath(new URL('../../bin/forge.mjs', import.meta.url));

/** `expect.stringContaining` is typed `any`; the assertion is a string match, so say so. */
const like = (text: string): string => expect.stringContaining(text) as string;

type Project = Awaited<ReturnType<typeof createTestProject>>;

function ctxFor(project: Project) {
  return { paths: project.paths, checksRoot: '.forge/checks', agentsRoot: '.forge/agents' };
}

/** The fixture project's own roster only ships the `tester` agent, but every shipped gate's advisory
 * check runs `critic` (`modules/fm-core`), so the negative tests add a stub `critic` agent file: an
 * `unknown-agent` finding is asserted on its own, not smeared over every other test. */
let template: Project | undefined;
let templateDir: string | undefined;

beforeAll(async () => {
  const made = await createTestProject();
  await writeFileAtomic(made.paths.resolveWithin('.forge/agents/critic.yaml'), 'id: critic\n');
  // `createTestProject`'s own directory is registered for cleanup after *each* test, so the shared
  // template is a private copy that only `afterAll` removes.
  templateDir = await mkdtemp(path.join(tmpdir(), 'forge-gate-validate-template-'));
  await cp(made.dir, templateDir, { recursive: true });
  template = { ...made, dir: templateDir, paths: new ProjectPaths(templateDir) };
}, 300_000);

afterAll(async () => {
  if (templateDir !== undefined) await rm(templateDir, { recursive: true, force: true });
});

/** A fresh, independently mutable copy of the one real `forge init` project: `runInit` takes seconds
 * under load, so it runs once and every test copies the result. */
async function createProject(): Promise<Project> {
  if (template === undefined) throw new Error('template project missing');
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-gate-validate-copy-'));
  registerCleanup(dir);
  await cp(template.dir, dir, { recursive: true });
  return { ...template, dir, paths: new ProjectPaths(dir) };
}

/** The ten gates and the advisory check id + brief each ships, read from the shipped gate YAMLs. */
const SHIPPED_GATE_BRIEFS: readonly (readonly [string, string, string])[] = [
  ['G-Deliver', 'delivery-review', 'briefs/critique-delivery-readiness.md'],
  ['G-Design', 'architect-review', 'briefs/critique-architecture.md'],
  ['G-Foundation', 'foundation-review', 'briefs/critique-project-foundation.md'],
  ['G-Integration', 'integration-review', 'briefs/critique-integration.md'],
  ['G-Operate', 'operate-review', 'briefs/critique-operational-readiness.md'],
  ['G-Problem', 'problem-framing-review', 'briefs/critique-problem-framing.md'],
  ['G-Product', 'product-review', 'briefs/critique-product-definition.md'],
  ['G-Ready', 'stage-plan-review', 'briefs/critique-stage-plan.md'],
  ['G-Stable', 'stability-review', 'briefs/critique-stabilization.md'],
  ['G-Verify', 'verification-review', 'briefs/critique-verification.md'],
];

async function rewriteGateBrief(
  project: Project,
  gateId: string,
  from: string,
  to: string | null,
): Promise<void> {
  const rel = `.forge/checks/${gateId}.gate.yaml`;
  const abs = project.paths.resolveWithin(rel);
  const text = await readFile(abs, 'utf8');
  const line = `      brief: ${from}\n`;
  expect(text, 'fixture precondition: the gate carries its shipped brief line').toContain(line);
  await writeFileAtomic(abs, text.replace(line, to === null ? '' : `      brief: ${to}\n`));
}

/** One well-formed deterministic check, for fixtures about something else: a gate with none is itself an error
 * (`no-deterministic-checks`, `PLAN-M13.md` P41), so a fixture gate that only means to be wrong about its
 * advisory checks carries this. */
const ONE_CHECK =
  "  deterministic:\n    - id: d\n      run: 'echo {}'\n      failOn: 'errors > 0'\n";

describe('gateValidateAll', () => {
  it('reports zero findings on a fresh init against the real module roster, and is not vacuous: all ten shipped gates carry a brief', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-gate-validate-'));
    registerCleanup(dir);
    await runInit(
      dir,
      { name: 'Gate Check', yes: true, level: 'L0' },
      { candidateAdapters: [new FakePlatformAdapter()], env: {}, modulesDir: REAL_MODULES_DIR },
    );
    const paths = new ProjectPaths(dir);
    const registry = await loadGateRegistry(paths, '.forge/checks');
    const shipped = [...registry.values()].flatMap((gate) =>
      gate.checks.advisory.map((check) => [gate.id, check.id, check.brief] as const),
    );
    expect([...shipped].sort()).toEqual([...SHIPPED_GATE_BRIEFS].sort());
    const results = await gateValidateAll({
      paths,
      checksRoot: '.forge/checks',
      agentsRoot: '.forge/agents',
    });
    expect([...results.entries()]).toEqual([]);
  });

  it.each(SHIPPED_GATE_BRIEFS)(
    "reports one itemized unknown-brief finding when %s's brief file is missing",
    async (gateId, checkId, brief) => {
      const project = await createProject();
      await rm(project.paths.resolveWithin(`.forge/${brief}`));
      const results = await gateValidateAll(ctxFor(project));
      expect([...results.keys()]).toEqual([gateId]);
      expect(results.get(gateId)).toEqual([
        {
          code: 'unknown-brief',
          severity: 'error',
          message: `Advisory check "${checkId}" of gate "${gateId}" references unknown brief "${brief}" (RUN-079: the loader cannot resolve it to non-blank text).`,
          checkId,
        },
      ]);
    },
  );

  it('reports an empty or whitespace-only brief file as unknown-brief', async () => {
    const project = await createProject();
    await writeFileAtomic(
      project.paths.resolveWithin('.forge/briefs/critique-verification.md'),
      '',
    );
    await writeFileAtomic(
      project.paths.resolveWithin('.forge/briefs/critique-stage-plan.md'),
      '  \n\n\t\n',
    );
    const results = await gateValidateAll(ctxFor(project));
    expect([...results.keys()].sort()).toEqual(['G-Ready', 'G-Verify']);
    expect(results.get('G-Verify')?.map((issue) => issue.code)).toEqual(['unknown-brief']);
    expect(results.get('G-Ready')?.map((issue) => issue.code)).toEqual(['unknown-brief']);
  });

  it('reports a header-only brief (the forge:generated line and nothing else) as unknown-brief', async () => {
    const project = await createProject();
    const abs = project.paths.resolveWithin('.forge/briefs/critique-integration.md');
    const text = await readFile(abs, 'utf8');
    const header = text.split('\n')[0] ?? '';
    expect(header).toContain('forge:generated');
    await writeFileAtomic(abs, `${header}\n`);
    const results = await gateValidateAll(ctxFor(project));
    expect(results.get('G-Integration')?.map((issue) => issue.code)).toEqual(['unknown-brief']);
  });

  it('reports a directory standing where a brief file should be as unknown-brief, not a crash', async () => {
    const project = await createProject();
    const abs = project.paths.resolveWithin('.forge/briefs/critique-architecture.md');
    await rm(abs);
    await mkdir(abs);
    const results = await gateValidateAll(ctxFor(project));
    expect(results.get('G-Design')?.map((issue) => issue.code)).toEqual(['unknown-brief']);
  });

  it.each([
    'briefs/../config.yaml',
    '../.env',
    '/etc/passwd',
    'briefs/nested/x.md',
    'briefs\\..\\config.yaml',
    'prompts/critic.system.md',
    'briefs/critique-architecture.txt',
  ])('reports the hostile or malformed reference %s as malformed-brief-reference', async (bad) => {
    const project = await createProject();
    await rewriteGateBrief(project, 'G-Design', 'briefs/critique-architecture.md', bad);
    const results = await gateValidateAll(ctxFor(project));
    expect([...results.keys()]).toEqual(['G-Design']);
    expect(results.get('G-Design')).toEqual([
      {
        code: 'malformed-brief-reference',
        severity: 'error',
        message: `Advisory check "architect-review" of gate "G-Design" has malformed brief reference ${JSON.stringify(bad)}; expected "briefs/<name>.md".`,
        checkId: 'architect-review',
      },
    ]);
  });

  it('never reads the file a traversal reference points at', async () => {
    const project = await createProject();
    // A real, non-empty file outside `.forge/briefs/`: were the reference resolved by path it would be
    // accepted as "real content". The shape check must refuse it first.
    await writeFile(`${project.dir}/secret.md`, 'do not send this to a model\n');
    await rewriteGateBrief(project, 'G-Verify', 'briefs/critique-verification.md', '../secret.md');
    const results = await gateValidateAll(ctxFor(project));
    expect(results.get('G-Verify')?.map((issue) => issue.code)).toEqual([
      'malformed-brief-reference',
    ]);
  });

  it('reports an advisory check with no brief at all as missing-brief', async () => {
    const project = await createProject();
    await rewriteGateBrief(project, 'G-Problem', 'briefs/critique-problem-framing.md', null);
    const results = await gateValidateAll(ctxFor(project));
    expect(results.get('G-Problem')).toEqual([
      {
        code: 'missing-brief',
        severity: 'error',
        message: 'Advisory check "problem-framing-review" of gate "G-Problem" declares no brief.',
        checkId: 'problem-framing-review',
      },
    ]);
  });

  it('reports every bad check of one gate and keeps other gates isolated', async () => {
    const project = await createProject();
    const abs = project.paths.resolveWithin('.forge/checks/G-Design.gate.yaml');
    const text = await readFile(abs, 'utf8');
    const extra = `    - id: second-review\n      agent: critic\n      brief: briefs/does-not-exist.md\n`;
    await writeFileAtomic(abs, text.replace('  advisory:\n', `  advisory:\n${extra}`));
    await rm(project.paths.resolveWithin('.forge/briefs/critique-verification.md'));
    const results = await gateValidateAll(ctxFor(project));
    expect([...results.keys()].sort()).toEqual(['G-Design', 'G-Verify']);
    expect(results.get('G-Design')?.map((issue) => issue.checkId)).toEqual(['second-review']);
  });

  it.each([
    ['a number', '      brief: 42\n'],
    ['an empty string', "      brief: ''\n"],
    ['null', '      brief: null\n'],
  ])('reports a non-string brief (%s) as missing-brief, not a crash', async (_label, line) => {
    const project = await createProject();
    await rewriteGateBrief(project, 'G-Ready', 'briefs/critique-stage-plan.md', null);
    const abs = project.paths.resolveWithin('.forge/checks/G-Ready.gate.yaml');
    const text = await readFile(abs, 'utf8');
    await writeFileAtomic(
      abs,
      text.replace('      agent: critic\n', `      agent: critic\n${line}`),
    );
    const results = await gateValidateAll(ctxFor(project));
    expect(results.get('G-Ready')?.map((issue) => issue.code)).toEqual(['missing-brief']);
  });

  it('reports a symlink that escapes the project as unknown-brief, and never resolves it', async () => {
    const project = await createProject();
    const outside = await mkdtemp(path.join(tmpdir(), 'forge-gate-outside-'));
    registerCleanup(outside);
    await writeFile(path.join(outside, 'secret.md'), 'do not send this to a model\n');
    const abs = project.paths.resolveWithin('.forge/briefs/critique-verification.md');
    await rm(abs);
    await symlink(path.join(outside, 'secret.md'), abs);
    const results = await gateValidateAll(ctxFor(project));
    expect(results.get('G-Verify')?.map((issue) => issue.code)).toEqual(['unknown-brief']);
  });

  it('reports an advisory check whose agent does not exist as unknown-agent', async () => {
    const project = await createProject();
    await rm(project.paths.resolveWithin('.forge/agents/critic.yaml'));
    const results = await gateValidateAll(ctxFor(project));
    expect([...results.keys()].sort()).toEqual(SHIPPED_GATE_BRIEFS.map(([gate]) => gate).sort());
    expect(results.get('G-Design')).toEqual([
      {
        code: 'unknown-agent',
        severity: 'error',
        message:
          'Advisory check "architect-review" of gate "G-Design" references unknown agent "critic".',
        checkId: 'architect-review',
      },
    ]);
  });

  it('reports a second gate file that repeats a gate id, which loadGateRegistry would silently drop', async () => {
    const project = await createProject();
    const original = await readFile(
      project.paths.resolveWithin('.forge/checks/G-Design.gate.yaml'),
      'utf8',
    );
    await writeFileAtomic(
      project.paths.resolveWithin('.forge/checks/G-Design-copy.gate.yaml'),
      original,
    );
    const results = await gateValidateAll(ctxFor(project));
    expect(results.get('G-Design')).toEqual([
      {
        code: 'duplicate-gate-id',
        severity: 'error',
        message:
          'Gate id "G-Design" is defined by both "G-Design-copy.gate.yaml" and "G-Design.gate.yaml"; only one definition can take effect.',
      },
    ]);
  });

  it('reports a repeated advisory check id within one gate', async () => {
    const project = await createProject();
    const abs = project.paths.resolveWithin('.forge/checks/G-Design.gate.yaml');
    const text = await readFile(abs, 'utf8');
    const dup = `    - id: architect-review\n      agent: critic\n      brief: briefs/critique-architecture.md\n`;
    await writeFileAtomic(abs, text.replace('  advisory:\n', `  advisory:\n${dup}`));
    const results = await gateValidateAll(ctxFor(project));
    expect(results.get('G-Design')?.map((issue) => issue.code)).toEqual(['duplicate-check-id']);
  });

  it.each([
    ['unparseable YAML', 'id: [unclosed\n', 'is not parseable YAML'],
    ['an empty document', '', 'has no string "id"'],
    ['a list document', '- a\n- b\n', 'has no string "id"'],
    ['a numeric id', 'id: 7\n', 'has no string "id"'],
  ])(
    'reports %s as invalid-gate-file keyed by the file stem, not a crash',
    async (_l, content, reason) => {
      const project = await createProject();
      await writeFileAtomic(
        project.paths.resolveWithin('.forge/checks/G-Broken.gate.yaml'),
        content,
      );
      const results = await gateValidateAll(ctxFor(project));
      expect(results.get('G-Broken')).toEqual([
        {
          code: 'invalid-gate-file',
          severity: 'error',
          message: `Gate file "G-Broken.gate.yaml" ${reason}.`,
        },
      ]);
      expect([...results.keys()]).toEqual(['G-Broken']);
    },
  );

  it('reports an advisory check with no agent as unknown-agent naming the omission', async () => {
    const project = await createProject();
    const abs = project.paths.resolveWithin('.forge/checks/G-Design.gate.yaml');
    const text = await readFile(abs, 'utf8');
    await writeFileAtomic(abs, text.replace('      agent: critic\n', ''));
    const results = await gateValidateAll(ctxFor(project));
    expect(results.get('G-Design')).toEqual([
      {
        code: 'unknown-agent',
        severity: 'error',
        message: 'Advisory check "architect-review" of gate "G-Design" declares no agent.',
        checkId: 'architect-review',
      },
    ]);
  });

  it('reports a "checks" that is not a mapping, and keys a gate by its id, not its file stem', async () => {
    const project = await createProject();
    await writeFileAtomic(
      project.paths.resolveWithin('.forge/checks/G-Y.gate.yaml'),
      'id: G-Y\nchecks: nope\n',
    );
    await writeFileAtomic(
      project.paths.resolveWithin('.forge/checks/stem.gate.yaml'),
      `id: G-Other\nchecks:\n${ONE_CHECK}  advisory:\n    - id: r\n      agent: critic\n      brief: briefs/missing.md\n`,
    );
    const results = await gateValidateAll(ctxFor(project));
    expect(results.get('G-Y')?.map((issue) => issue.message)).toEqual([
      'Gate "G-Y" has a "checks" that is not a mapping.',
    ]);
    expect(results.get('G-Other')?.map((issue) => issue.code)).toEqual(['unknown-brief']);
    expect(results.has('stem')).toBe(false);
  });

  it('reports every advisory check as unknown-agent when the agents directory is missing', async () => {
    const project = await createProject();
    await rm(project.paths.resolveWithin('.forge/agents'), { recursive: true, force: true });
    const results = await gateValidateAll(ctxFor(project));
    expect([...results.values()].flat().map((issue) => issue.code)).toEqual(
      SHIPPED_GATE_BRIEFS.map(() => 'unknown-agent'),
    );
  });

  it.each([
    [
      'a non-list advisory',
      `id: G-X\nchecks:\n${ONE_CHECK}  advisory: nope\n`,
      'Gate "G-X" has a "checks.advisory" that is not a list.',
    ],
    [
      'an advisory entry with no id',
      `id: G-X\nchecks:\n${ONE_CHECK}  advisory:\n    - agent: critic\n`,
      'Gate "G-X" has an advisory check with no string "id".',
    ],
    [
      'a null advisory entry',
      `id: G-X\nchecks:\n${ONE_CHECK}  advisory:\n    -\n`,
      'Gate "G-X" has an advisory check with no string "id".',
    ],
  ])('reports %s as invalid-gate-file, not a crash', async (_l, content, message) => {
    const project = await createProject();
    await writeFileAtomic(project.paths.resolveWithin('.forge/checks/G-X.gate.yaml'), content);
    const results = await gateValidateAll(ctxFor(project));
    expect(results.get('G-X')).toEqual([{ code: 'invalid-gate-file', severity: 'error', message }]);
  });

  // `PLAN-M13.md` P41: the same strict document validator `loadGateRegistry` refuses a gate with (GATE-506), reported
  // here for every gate at once. A misspelled `checks:` is an empty gate, and an empty gate passes vacuously.
  it.each([
    [
      'a misspelled checks key',
      'id: G-X\nchekcs:\n  deterministic: []\n',
      ['unknown-gate-key', 'no-deterministic-checks'],
      'unknown key "chekcs" (did you mean "checks"?)',
    ],
    [
      'a misspelled deterministic key',
      `id: G-X\nchecks:\n  determinstic:\n    - id: a\n      run: x\n      failOn: "!ok"\n`,
      ['unknown-gate-key', 'no-deterministic-checks'],
      'did you mean "deterministic"?',
    ],
    [
      'an advisory-only gate',
      'id: G-X\nchecks:\n  advisory:\n    - id: r\n      agent: critic\n      brief: briefs/critique-architecture.md\n',
      ['no-deterministic-checks'],
      'no deterministic check',
    ],
    [
      'an unknown key inside an advisory check',
      `id: G-X\nchecks:\n${ONE_CHECK}  advisory:\n    - id: r\n      agnet: critic\n      brief: briefs/critique-architecture.md\n`,
      ['unknown-gate-key', 'unknown-agent'],
      'did you mean "agent"?',
    ],
    [
      'a check with no failOn',
      'id: G-X\nchecks:\n  deterministic:\n    - id: a\n      run: x\n',
      ['invalid-gate-value'],
      'checks.deterministic[0].failOn',
    ],
  ])('reports %s', async (_label, content, codes, fragment) => {
    const project = await createProject();
    await writeFileAtomic(project.paths.resolveWithin('.forge/checks/G-X.gate.yaml'), content);
    const issues = (await gateValidateAll(ctxFor(project))).get('G-X') ?? [];
    expect(issues.map((issue) => issue.code).sort()).toEqual([...codes].sort());
    expect(issues.map((issue) => issue.message).join('\n')).toContain(fragment);
    expect(issues.map((issue) => issue.message).join('\n')).toContain('G-X.gate.yaml');
  });

  it('reports the same problem loadGateRegistry throws for (one validator, two callers)', async () => {
    const project = await createProject();
    await writeFileAtomic(
      project.paths.resolveWithin('.forge/checks/G-X.gate.yaml'),
      'id: G-X\nchekcs:\n  deterministic: []\n',
    );
    const [issue] = (await gateValidateAll(ctxFor(project))).get('G-X') ?? [];
    const thrown = await loadGateRegistry(project.paths, '.forge/checks').catch((e: unknown) => e);
    expect(thrown).toMatchObject({ code: 'GATE-506' });
    expect((thrown as Error).message).toContain('chekcs');
    expect(issue?.message).toContain('chekcs');
  });

  it('reports nothing for a project with no checks directory', async () => {
    const project = await createProject();
    await rm(project.paths.resolveWithin('.forge/checks'), { recursive: true, force: true });
    expect([...(await gateValidateAll(ctxFor(project))).entries()]).toEqual([]);
  });
});

// `PLAN-M14.md` P20: the identical strict standalone `*.check.yaml` validator `loadGateRegistry`'s own
// check-attachment step refuses a check file for (`GATE-506`), reported here for every check file at
// once instead of stopping at the first — findings are keyed by the check file's own `.forge/`-stripped
// stem (never a real gate id: a check file may name several gates, or none the project actually has).
describe('standalone *.check.yaml findings (appliesTo attachment)', () => {
  async function writeOverrideCheck(project: Project, content: string): Promise<void> {
    await mkdir(project.paths.resolveWithin('.forge/overrides/checks'), { recursive: true });
    await writeFileAtomic(
      project.paths.resolveWithin('.forge/overrides/checks/acme.check.yaml'),
      content,
    );
  }

  it('an unknown key ("gate" instead of "gates") is unknown-check-key, with a did-you-mean', async () => {
    const project = await createProject();
    await writeOverrideCheck(
      project,
      'id: acme:x\nrun: "echo hi"\nfailOn: "a"\nremedy: "r"\nappliesTo: { gate: [G-Design] }\nseverity: error\n',
    );
    const issues = (await gateValidateAll(ctxFor(project))).get('overrides/checks/acme') ?? [];
    expect(issues.map((issue) => issue.code)).toEqual(['unknown-check-key', 'invalid-check-value']);
    expect(issues.map((issue) => issue.message).join('\n')).toContain('did you mean "gates"');
    expect(issues.map((issue) => issue.message).join('\n')).toContain('acme.check.yaml');
  });

  it('a missing remedy is invalid-check-value', async () => {
    const project = await createProject();
    await writeOverrideCheck(
      project,
      'id: acme:x\nrun: "echo hi"\nfailOn: "a"\nappliesTo: { gates: [G-Design] }\nseverity: error\n',
    );
    const issues = (await gateValidateAll(ctxFor(project))).get('overrides/checks/acme') ?? [];
    expect(issues).toEqual([
      { code: 'invalid-check-value', severity: 'error', message: like('remedy') },
    ]);
  });

  it('appliesTo naming a gate this project does not have is unknown-gate-in-appliesTo', async () => {
    const project = await createProject();
    await writeOverrideCheck(
      project,
      'id: acme:x\nrun: "echo hi"\nfailOn: "a"\nremedy: "r"\nappliesTo: { gates: [G-No-Such] }\nseverity: error\n',
    );
    const issues = (await gateValidateAll(ctxFor(project))).get('overrides/checks/acme') ?? [];
    expect(issues).toEqual([
      { code: 'unknown-gate-in-appliesTo', severity: 'error', message: like('G-No-Such') },
    ]);
  });

  it('a well-formed check naming a real gate reports nothing', async () => {
    const project = await createProject();
    await writeOverrideCheck(
      project,
      'id: acme:x\nrun: "echo hi"\nfailOn: "a"\nremedy: "r"\nappliesTo: { gates: [G-Design] }\nseverity: error\n',
    );
    const results = await gateValidateAll(ctxFor(project));
    expect(results.get('overrides/checks/acme')).toBeUndefined();
  });

  it('a genuinely missing checksRoot still reports override-check findings (independent scans)', async () => {
    const project = await createProject();
    await rm(project.paths.resolveWithin('.forge/checks'), { recursive: true, force: true });
    await writeOverrideCheck(
      project,
      'id: acme:x\nrun: "echo hi"\nfailOn: "a"\nremedy: "r"\nappliesTo: { gates: [G-Design] }\nseverity: error\n',
    );
    // With `.forge/checks/` removed there is no real `G-Design` gate at all, so the override check's own
    // `appliesTo` names an unknown gate -- proving the check-file scan runs even though `checksDir`
    // itself does not exist (before this piece's own ordering fix, the whole function returned early on
    // a missing `checksDir`, before ever looking at `.forge/overrides/checks/`).
    const issues = (await gateValidateAll(ctxFor(project))).get('overrides/checks/acme') ?? [];
    expect(issues).toEqual([
      { code: 'unknown-gate-in-appliesTo', severity: 'error', message: like('G-Design') },
    ]);
  });

  // `SPEC-QUESTIONS.md` Q229 D3's stance, extended to check files by `PLAN-M14.md` P20's own Discloses
  // note: before `PLAN-M14.md` P22, a real, shipped module's own check files carried no
  // `appliesTo`/`severity` at all, so `loadGateRegistry` (`gates.test.ts`'s own equivalent case) refused
  // every gate outright the moment one was installed, and `gateValidateAll` was the escape hatch the
  // Discloses note named ("workflow validate --all says which"), reporting the missing fields
  // diagnosably instead of throwing. `PLAN-M14.md` P22 closes that gap for real: a fresh `forge init`
  // project (which ships the real `G-Verify` gate `device-matrix.check.yaml`'s own `appliesTo.gates`
  // names, `10` §10.3's own catalogue) now attaches fm-mobile's check cleanly, with zero findings.
  it('installing a real shipped module (fm-mobile) attaches cleanly, zero findings, now that PLAN-M14.md P22 gives it a real appliesTo/severity', async () => {
    const project = await createProject();
    await writeFileAtomic(
      project.paths.resolveWithin('.forge/manifest.yaml'),
      'version: 1\nmodules:\n  - id: fm-mobile\n    version: "1.0.0"\n    checksum: "x"\n',
    );
    await cp(
      path.join(REAL_MODULES_DIR, 'fm-mobile/checks'),
      project.paths.resolveWithin('.forge/modules/fm-mobile/checks'),
      { recursive: true },
    );
    const results = await gateValidateAll(ctxFor(project));
    expect(results.get('modules/fm-mobile/checks/device-matrix')).toBeUndefined();
  });

  // `PLAN-M14.md` P22's own mutation evidence, the `gateValidateAll` side of the identical proof
  // `gates.test.ts`'s own equivalent case makes for `loadGateRegistry`: a real shipped check file with
  // `appliesTo`/`severity` stripped is reported here diagnosably (never silently, and never a throw),
  // proving the real file is read by structure, not merely "present" once P22 landed.
  it('a real shipped check file with appliesTo/severity stripped is reported diagnosably here too', async () => {
    const project = await createProject();
    await writeFileAtomic(
      project.paths.resolveWithin('.forge/manifest.yaml'),
      'version: 1\nmodules:\n  - id: fm-mobile\n    version: "1.0.0"\n    checksum: "x"\n',
    );
    await mkdir(project.paths.resolveWithin('.forge/modules/fm-mobile/checks'), {
      recursive: true,
    });
    const real = YAML.parse(
      await readFile(
        path.join(REAL_MODULES_DIR, 'fm-mobile/checks/device-matrix.check.yaml'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    const { appliesTo: _appliesTo, severity: _severity, ...withoutEither } = real;
    await writeFileAtomic(
      project.paths.resolveWithin('.forge/modules/fm-mobile/checks/device-matrix.check.yaml'),
      YAML.stringify(withoutEither),
    );
    const results = await gateValidateAll(ctxFor(project));
    const issues = results.get('modules/fm-mobile/checks/device-matrix') ?? [];
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((issue) => issue.code === 'invalid-check-value')).toBe(true);
    expect(issues.map((issue) => issue.message).join('\n')).toContain('appliesTo');
    expect(issues.map((issue) => issue.message).join('\n')).toContain('severity');
  });
});

describe('forge workflow validate --all (real subprocess) surfaces gate brief findings', () => {
  function runValidate(
    dir: string,
    extraArgs: readonly string[] = [],
  ): { status: number; stdout: string; stderr: string } {
    try {
      const stdout = execFileSync(
        process.execPath,
        [LAUNCHER, 'workflow', 'validate', '--all', '-C', dir, ...extraArgs],
        {
          encoding: 'utf8',
          timeout: 60_000,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      return { status: 0, stdout, stderr: '' };
    } catch (error) {
      const failure = error as { status?: number; stdout: string; stderr: string };
      return { status: failure.status ?? 1, stdout: failure.stdout, stderr: failure.stderr };
    }
  }

  it('prints one `gate <id>: unknown-brief` line and fails when a critique brief is removed, and none otherwise', async () => {
    const project = await createProject();
    const before = runValidate(project.dir);
    expect(before.stderr).not.toMatch(/^gate /m);

    await rm(project.paths.resolveWithin('.forge/briefs/critique-architecture.md'));
    const after = runValidate(project.dir);
    expect(after.status).toBe(1);
    expect(after.stderr).toContain(
      'gate G-Design: unknown-brief Advisory check "architect-review" of gate "G-Design" references unknown brief "briefs/critique-architecture.md"',
    );
    expect(after.stderr.match(/^gate /gm)).toHaveLength(1);
  });

  it('does not crash on a malformed gate file: reports it as invalid-gate-file and exits 1', async () => {
    const project = await createProject();
    await writeFileAtomic(
      project.paths.resolveWithin('.forge/checks/G-Broken.gate.yaml'),
      'id: [unclosed\n',
    );
    const result = runValidate(project.dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'gate G-Broken: invalid-gate-file Gate file "G-Broken.gate.yaml" is not parseable YAML.',
    );
    expect(result.stderr).not.toContain('at ');
  });

  it('carries gate findings in a `gates` field of the --json output, next to the unchanged `results`', async () => {
    const project = await createProject();
    const clean = JSON.parse(runValidate(project.dir, ['--json']).stdout) as { gates: unknown };
    expect(clean.gates, 'a fresh init has no gate findings').toEqual({});
    await rm(project.paths.resolveWithin('.forge/briefs/critique-stabilization.md'));
    const result = runValidate(project.dir, ['--json']);
    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout) as {
      v: number;
      results: Record<string, unknown>;
      gates: Record<string, { code: string; checkId: string }[]>;
    };
    expect(parsed.v).toBe(1);
    expect(typeof parsed.results).toBe('object');
    expect(parsed.gates['G-Stable']?.map((issue) => [issue.code, issue.checkId])).toEqual([
      ['unknown-brief', 'stability-review'],
    ]);
    expect(Object.keys(parsed.gates)).toEqual(['G-Stable']);
  });
});
