/**
 * Outputs are the claim (`PLAN-M13.md` P14, `06` §6.7 as amended, `SPEC-QUESTIONS.md` Q212): the claim
 * `enforceClaim` holds an `agent` step to is its `produces` globs UNION the registry paths of its declared
 * `outputs`, and a step that declares `outputs` is enforced `strict` at every autonomy level. Before this,
 * `strict` (`supervised`, `autonomous`, any adopted project) reverted a step's own declared output because
 * almost no shipped step lists it in `produces`, and the output contract check then failed the step for the
 * absence of what enforcement had just deleted (Q209).
 *
 * Written from that spec text, against a real git lane, the real claim enforcement and the real event log;
 * only the model session is faked (`FakePlatformAdapter` writes the files the scenario says it wrote).
 *
 * @see specs/05 §5.5
 * @see specs/06 §6.4, §6.7
 * @see PLAN-M13.md P14
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { minimatch } from 'minimatch';
import { ARTIFACT_TYPES, renderArtifactPath } from '@forge/schemas/registry';
import { FakePlatformAdapter } from '@forge/testkit';
import { readEvents, type ForgeEvent } from '@forge/telemetry/events';
import { describe, expect, it } from 'vitest';

import { assembleAgentSession } from '../../src/dispatch/assemble.ts';
import { executeStep } from '../../src/dispatch/execute.ts';
import { createVcsFacade } from '../../src/dispatch/facades.ts';
import {
  outputClaimGlobs,
  outputGlob,
  resolveStepClaim,
  verifyDeclaredOutputs,
} from '../../src/dispatch/outputs.ts';
import { runLaneLifecycle } from '../../src/dispatch/steps.ts';
import { NEVER_WRITABLE_GLOBS } from '../../src/rca/fix-scan.ts';
import type {
  DocRoots,
  ExecuteStepContext,
  LaneHandle,
  StepOutcome,
} from '../../src/dispatch/types.ts';
import { toAgentId, type StepNode } from '../../src/plan/index.ts';
import { diagramSidecarText, epicText } from './artifact-fixtures.ts';
import { createFixtureAssembly, createTestContext, fixtureAgent, node } from './helpers.ts';

const DEFAULT_ROOTS: DocRoots = {
  kb: 'docs/forge/kb',
  specs: 'docs/forge/specs',
  plans: 'docs/forge/plans',
  sessions: 'docs/forge/sessions',
  reports: 'docs/forge/reports',
};
const EPIC_PATH = 'docs/forge/specs/epics/EPIC-001.md';
const STRAY = 'src/stray.ts';

async function createTempRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `forge-claim-${prefix}-`));
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

/** The files the lane branch holds at its head (`HEAD` of the lane worktree). */
async function treeAt(lanePath: string | undefined): Promise<string[]> {
  if (lanePath === undefined) throw new Error('the step never created a lane');
  return (await execa('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: lanePath })).stdout
    .split('\n')
    .filter((line) => line !== '');
}

interface Scenario {
  readonly outputs?: StepNode['outputs'];
  readonly produces?: readonly string[];
  readonly writes: readonly { readonly relativePath: string; readonly content: string }[];
  /** What the project's autonomy/adoption resolved (`resolveClaimPolicy`) to: the DEFAULT policy. */
  readonly claimPolicy: 'strict' | 'warn';
  readonly docRoots?: DocRoots;
}

async function run(scenario: Scenario) {
  const projectRoot = await createTempRepo('scenario');
  const adapter = new FakePlatformAdapter();
  adapter.script(() => true, { text: ['done'], writeFiles: [...scenario.writes] });
  const runId = 'run-claim';
  // The lane is captured at creation: a failed step is not registered, and its branch is still the record of
  // what survived claim enforcement.
  const real = createVcsFacade(projectRoot, runId);
  let created: LaneHandle | undefined;
  const ctx = createTestContext({
    projectRoot,
    adapter,
    runId,
    vcs: {
      ...real,
      createLane: async (stepId, base) => {
        created = await real.createLane(stepId, base);
        return created;
      },
    },
    claimPolicy: scenario.claimPolicy,
    ...(scenario.docRoots === undefined ? {} : { docRoots: scenario.docRoots }),
    assembly: createFixtureAssembly(projectRoot, {
      loadAgent: (agentId) =>
        Promise.resolve(
          fixtureAgent(agentId, {
            tools: {
              read: true,
              write: true,
              network: false,
              git_commit: 'lane',
              deploy: false,
            },
          }),
        ),
    }),
  });
  const stepNode = node({
    id: 'wf:step',
    kind: 'agent',
    agent: toAgentId('po'),
    brief: 'do the work',
    outputs: scenario.outputs ?? [],
    produces: scenario.produces ?? [],
  });
  const outcome = await executeStep(stepNode, ctx);
  const events: ForgeEvent[] = [];
  for await (const event of readEvents(projectRoot, runId)) events.push(event);
  const committed = await treeAt(created?.path);
  return { outcome, events, ctx, committed, projectRoot };
}

function revertCommits(events: readonly ForgeEvent[]): number {
  return events.filter(
    (event) =>
      event.type === 'LaneCommitted' &&
      (event.payload as { reason?: string } | undefined)?.reason === 'claim-revert',
  ).length;
}

interface ViolationPayload {
  readonly kind: string;
  readonly policy: string;
  /** Whether this violation also failed the step (`PLAN-M14.md` P3): `true` only when `policy` is
   * `'strict'` -- `warn` never fails the step. */
  readonly stepFailed: boolean;
  readonly paths: string[];
  readonly totalOutOfClaim: number;
  readonly totalReverted: number;
}

function violations(events: readonly ForgeEvent[]): ViolationPayload[] {
  return events
    .filter((event) => event.type === 'PolicyViolation')
    .map((event) => event.payload as ViolationPayload);
}

function failureOf(outcome: StepOutcome): NonNullable<StepOutcome['failure']> {
  expect(outcome.status).toBe('failed');
  if (outcome.failure === undefined) throw new Error('a failed outcome carries a failure');
  return outcome.failure;
}

/** The two claim policies a project's autonomy and adoption can resolve to (`resolveClaimPolicy`):
 * `strict` for `supervised`, `autonomous` and any adopted project; `warn` for `guided` non-adopted. */
const DEFAULT_POLICIES = [
  ['autonomous / supervised / adopted (strict default)', 'strict'],
  ['guided, not adopted (warn default)', 'warn'],
] as const;

describe('a step that declares outputs: its own output is inside its claim', () => {
  for (const [label, claimPolicy] of DEFAULT_POLICIES) {
    it(`keeps exactly the declared output and reverts nothing under ${label}, with no \`produces\` at all`, async () => {
      const { outcome, events, committed } = await run({
        outputs: [{ type: 'Epic' }],
        writes: [{ relativePath: EPIC_PATH, content: epicText() }],
        claimPolicy,
      });
      expect(outcome.status).toBe('succeeded');
      expect(committed).toContain(EPIC_PATH);
      expect(revertCommits(events)).toBe(0);
      expect(events.map((event) => event.type)).toContain('LaneReady');
    });

    it(`enforces strict under ${label}: a write outside outputs and produces is reverted, and (PLAN-M14.md P3) fails the step`, async () => {
      const { outcome, events, committed } = await run({
        outputs: [{ type: 'Epic' }],
        writes: [
          { relativePath: EPIC_PATH, content: epicText() },
          { relativePath: STRAY, content: 'export const leak = 1;\n' },
        ],
        claimPolicy,
      });
      // `06` §6.7 as amended (`SPEC-QUESTIONS.md` Q232 decision 1): a step that declares `outputs` is
      // always enforced `strict` (`resolveStepClaim`), so both `DEFAULT_POLICIES` labels land here --
      // the out-of-claim write is reverted exactly as P14 already proved, and now also fails the step.
      expect(outcome.status).toBe('failed');
      expect(outcome.failure).toMatchObject({ source: 'claim', code: 'RUN-104' });
      expect(committed).toContain(EPIC_PATH);
      expect(committed).not.toContain(STRAY);
      expect(revertCommits(events)).toBe(1);
      // The trace still records exactly what was discarded, `stepFailed` now naming the consequence.
      expect(violations(events)).toEqual([
        {
          kind: 'out-of-claim-write',
          policy: 'strict',
          stepFailed: true,
          paths: [STRAY],
          totalOutOfClaim: 1,
          totalReverted: 1,
        },
      ]);
    });

    it(`a \`produces\` glob is still part of the claim under ${label}: the union, not a replacement; an out-of-claim write beyond it still fails the step`, async () => {
      const { outcome, committed } = await run({
        outputs: [{ type: 'Epic' }],
        produces: ['src/**'],
        writes: [
          { relativePath: EPIC_PATH, content: epicText() },
          { relativePath: STRAY, content: 'export const declared = 1;\n' },
          { relativePath: 'other/x.txt', content: 'x\n' },
        ],
        claimPolicy,
      });
      // `other/x.txt` is neither a declared output nor covered by `produces`: still out of claim, so this
      // now fails too (`PLAN-M14.md` P3) even though both EPIC_PATH and STRAY are legitimately kept.
      expect(outcome.status).toBe('failed');
      expect(outcome.failure).toMatchObject({ source: 'claim', code: 'RUN-104' });
      expect(committed).toContain(EPIC_PATH);
      expect(committed).toContain(STRAY);
      expect(committed).not.toContain('other/x.txt');
    });
  }

  it('a session that writes only outside the claim loses everything and the step fails -- now at the claim itself (PLAN-M14.md P3), before the output check ever runs', async () => {
    const { outcome, committed } = await run({
      outputs: [{ type: 'Epic' }],
      writes: [{ relativePath: STRAY, content: 'x\n' }],
      // A step declaring `outputs` is always enforced `strict` (`resolveStepClaim`), whatever the
      // project's own default policy passed here -- the very point `06` §6.7's own forced-strict rule
      // makes: nothing legitimate was ever at risk of being lost, so the step fails loudly instead.
      claimPolicy: 'warn',
    });
    expect(failureOf(outcome)).toMatchObject({ source: 'claim', code: 'RUN-104' });
    expect(failureOf(outcome).message).toContain(STRAY);
    expect(committed).toEqual([]);
  });

  it('the same registry glob the output check uses defines the claim, so a relocated docs root is followed', async () => {
    const relocated: DocRoots = {
      kb: 'documentation/kb',
      specs: 'documentation/specs',
      plans: 'documentation/plans',
      sessions: 'documentation/sessions',
      reports: 'documentation/reports',
    };
    const followed = await run({
      outputs: [{ type: 'Epic' }],
      writes: [{ relativePath: 'documentation/specs/epics/EPIC-001.md', content: epicText() }],
      claimPolicy: 'strict',
      docRoots: relocated,
    });
    expect(followed.outcome.status).toBe('succeeded');
    expect(followed.committed).toContain('documentation/specs/epics/EPIC-001.md');
    // The old layout's path is no longer the registry path: it is out of claim, reverted, and (PLAN-M14.md
    // P3) fails the step directly -- the output check never even runs, since the claim violation returns
    // first.
    const stale = await run({
      outputs: [{ type: 'Epic' }],
      writes: [{ relativePath: EPIC_PATH, content: epicText() }],
      claimPolicy: 'strict',
      docRoots: relocated,
    });
    expect(failureOf(stale.outcome)).toMatchObject({ source: 'claim', code: 'RUN-104' });
    expect(stale.committed).toEqual([]);
  });

  it('a register output (HandoffRecord: one shared file) and a many-cardinality output are inside the claim', () => {
    const claim = resolveStepClaim(
      node({
        id: 'wf:s',
        kind: 'agent',
        outputs: [{ type: 'HandoffRecord' }, { type: 'Story', cardinality: 'many' }],
      }),
      DEFAULT_ROOTS,
      'warn',
    );
    expect(claim.globs).toEqual([
      'docs/forge/reports/handoffs.md',
      'docs/forge/specs/stories/STORY-*.md',
    ]);
  });
});

describe('produces itself follows a relocated docs root too, not only the registry half of the claim (M14 P6, Q232 decision 3, Q216)', () => {
  it('a `produces` glob written against the default layout is claimed at the configured root; the literal default-layout path is out of claim and reverted (fails the step, P3)', async () => {
    const relocatedKb = { ...DEFAULT_ROOTS, kb: 'knowledge' };
    const followed = await run({
      produces: ['docs/forge/kb/glossary.md'],
      writes: [{ relativePath: 'knowledge/glossary.md', content: '# Glossary\n' }],
      claimPolicy: 'strict',
      docRoots: relocatedKb,
    });
    expect(followed.outcome.status).toBe('succeeded');
    expect(followed.committed).toContain('knowledge/glossary.md');
    const stale = await run({
      produces: ['docs/forge/kb/glossary.md'],
      writes: [{ relativePath: 'docs/forge/kb/glossary.md', content: '# Glossary\n' }],
      claimPolicy: 'strict',
      docRoots: relocatedKb,
    });
    expect(failureOf(stale.outcome)).toMatchObject({ source: 'claim', code: 'RUN-104' });
    expect(stale.committed).toEqual([]);
  });

  it('a `!docs/forge/<section>/x/**` exclusion follows the relocated root too: a write under the excluded, relocated path is still reverted although the rest of the relocated root is claimed', async () => {
    const relocatedKb = { ...DEFAULT_ROOTS, kb: 'knowledge' };
    const { outcome, committed } = await run({
      produces: ['docs/forge/kb/**', '!docs/forge/kb/x/**'],
      writes: [
        { relativePath: 'knowledge/glossary.md', content: '# Glossary\n' },
        { relativePath: 'knowledge/x/secret.md', content: 'x\n' },
      ],
      claimPolicy: 'strict',
      docRoots: relocatedKb,
    });
    expect(failureOf(outcome)).toMatchObject({ source: 'claim', code: 'RUN-104' });
    expect(committed).toContain('knowledge/glossary.md');
    expect(committed).not.toContain('knowledge/x/secret.md');
  });

  it('a produces glob whose leading segment is a default root plus a DIFFERENT trailing segment (docs/forge/kbx) is left alone: the segment-boundary counter-example', async () => {
    const { outcome, committed } = await run({
      produces: ['docs/forge/kbx/**'],
      writes: [{ relativePath: 'docs/forge/kbx/y.md', content: 'x\n' }],
      claimPolicy: 'strict',
      docRoots: { ...DEFAULT_ROOTS, kb: 'knowledge' },
    });
    expect(outcome.status).toBe('succeeded');
    expect(committed).toContain('docs/forge/kbx/y.md');
  });

  it('a configured root that starts with `!` or `#` is read literally by the real claim matcher for a `produces`-derived glob too, not just the registry half', async () => {
    for (const marker of ['!', '#']) {
      const root = `${marker}weird`;
      const { outcome, committed } = await run({
        produces: ['docs/forge/specs/x.md'],
        writes: [
          { relativePath: `${root}/x.md`, content: 'x\n' },
          // Under an unescaped `!…` glob every OTHER path would wrongly count as inside the claim.
          { relativePath: STRAY, content: 'x\n' },
        ],
        claimPolicy: 'strict',
        docRoots: { ...DEFAULT_ROOTS, specs: root },
      });
      expect(outcome.status).toBe('failed');
      expect(outcome.failure).toMatchObject({ source: 'claim', code: 'RUN-104' });
      expect(committed).toContain(`${root}/x.md`);
      expect(committed).not.toContain(STRAY);
    }
  });

  it('a configured root that escapes the repository drops the rewritten produces entry from the claim: it contributes nothing, the rest of the claim is unaffected', () => {
    for (const escaping of ['../out', '/abs', '..']) {
      const claim = resolveStepClaim(
        { kind: 'agent', outputs: [], produces: ['docs/forge/specs/x.md', 'src/**'] },
        { ...DEFAULT_ROOTS, specs: escaping },
        'warn',
      );
      expect(claim.globs).toEqual(['src/**']);
    }
  });

  it('...end to end: a stray write is reverted and fails the step under strict, exactly as if the escaping entry had never been declared', async () => {
    const { outcome, committed } = await run({
      produces: ['docs/forge/specs/x.md', 'src/**'],
      writes: [
        { relativePath: 'src/ok.ts', content: 'export const ok = 1;\n' },
        { relativePath: 'lib/stray.ts', content: 'export const stray = 1;\n' },
      ],
      claimPolicy: 'strict',
      docRoots: { ...DEFAULT_ROOTS, specs: '../out' },
    });
    expect(failureOf(outcome)).toMatchObject({ source: 'claim', code: 'RUN-104' });
    expect(committed).toContain('src/ok.ts');
    expect(committed).not.toContain('lib/stray.ts');
  });

  it('is the identity transform for every shipped default-layout produces glob: DEFAULT_ROOTS resolves to itself (no rewrite, no drop, no escape)', () => {
    for (const produces of [
      ['docs/forge/kb/glossary.md'],
      ['docs/forge/specs/**'],
      ['docs/forge/plans/stages.md'],
      ['docs/forge/sessions/SESSION-*.md'],
      ['docs/forge/reports/handoffs.md'],
      ['src/**', '!docs/forge/kb/x/**'],
    ]) {
      expect(
        resolveStepClaim({ kind: 'agent', outputs: [], produces }, DEFAULT_ROOTS, 'warn').globs,
      ).toEqual(produces.filter((glob) => !glob.startsWith('!')));
    }
  });
});

describe('block [5] (compile-prompt.ts renderOutputContractBlock) renders the RESOLVED produces under a relocated layout, traced end to end through assembleAgentSession (PLAN-M14.md P6)', () => {
  async function assembledTextFor(
    produces: readonly string[],
    docRoots: DocRoots,
  ): Promise<string> {
    const projectRoot = await createTempRepo('block5');
    const ctx = createTestContext({
      projectRoot,
      docRoots,
      assembly: createFixtureAssembly(projectRoot, {
        loadAgent: (agentId) =>
          Promise.resolve(
            fixtureAgent(agentId, {
              tools: { read: true, write: true, network: false, git_commit: 'lane', deploy: false },
            }),
          ),
      }),
    });
    const stepNode = node({
      id: 'wf:glossary',
      kind: 'agent',
      agent: toAgentId('po'),
      brief: 'do the work',
      produces,
    });
    const assembled = await assembleAgentSession({ node: stepNode, ctx });
    return assembled.compiled.text;
  }

  it('a relocated kb root: block [5] names the configured path, never the shipped default the session would actually be reverted for writing to', async () => {
    const text = await assembledTextFor(['docs/forge/kb/glossary.md'], {
      ...DEFAULT_ROOTS,
      kb: 'knowledge',
    });
    const block5 = text.slice(text.indexOf('## [5]'), text.indexOf('## [6]'));
    expect(block5).toContain('knowledge/glossary.md');
    expect(block5).not.toContain('docs/forge/kb/glossary.md');
  });

  it('an exclusion follows the relocation too: block [5] still says "Never write" at the configured path', async () => {
    const text = await assembledTextFor(['docs/forge/kb/**', '!docs/forge/kb/x/**'], {
      ...DEFAULT_ROOTS,
      kb: 'knowledge',
    });
    const block5 = text.slice(text.indexOf('## [5]'), text.indexOf('## [6]'));
    expect(block5).toContain("Files: only the paths in this step's claim: `knowledge/**`");
    expect(block5).toContain("Never write (outside this step's claim): `knowledge/x/**`");
    expect(block5).not.toContain('docs/forge/kb');
  });

  it('under the shipped default layout, block [5] is unchanged: the shipped default path itself', async () => {
    const text = await assembledTextFor(['docs/forge/kb/glossary.md'], DEFAULT_ROOTS);
    const block5 = text.slice(text.indexOf('## [5]'), text.indexOf('## [6]'));
    expect(block5).toContain('docs/forge/kb/glossary.md');
  });

  it('a `!`/`#`-leading configured root: block [5] shows the LITERAL path, never the internal matcher-escaped spelling (fresh critic round M1)', async () => {
    for (const [marker, root] of [
      ['!', '!weird'],
      ['#', '#x'],
    ] as const) {
      const text = await assembledTextFor(['docs/forge/specs/x.md'], {
        ...DEFAULT_ROOTS,
        specs: root,
      });
      const block5 = text.slice(text.indexOf('## [5]'), text.indexOf('## [6]'));
      // The real, writable directory is `!weird` (or `#x`) with no backslash -- that is what a `git
      // diff` would list, and what the agent must be told, not the matcher-internal `\!weird` spelling
      // `enforceClaim`'s own real minimatch call needs to read it literally.
      expect(block5, marker).toContain(`\`${root}/x.md\``);
      expect(block5, marker).not.toContain('\\');
    }
  });
});

describe('the skill activation filter (pack-for-step.ts matchesStepFileClaim) matches the RESOLVED produces too, not the raw one (PLAN-M14.md P6)', () => {
  const SKILL_BODY_MARKER = 'THIS-IS-THE-FIXTURE-SKILL-BODY-M14-P6';

  /** A synthetic skill shadowing the real `changelog-writing` id: `templatesPackageRoot` in this test
   * harness is the fixture project root (`createFixtureAssembly`), not the real `@forge/templates`
   * package, so writing a `SKILL.md` at the same relative path `SKILL_INDEX` names loads THIS file
   * instead of the shipped one -- the one way to exercise `activation: auto`'s own `applies_to.paths`
   * upgrade with a caller-chosen glob, since no shipped skill uses `applies_to.paths` today. */
  async function withFixtureSkill(projectRoot: string, appliesToPath: string): Promise<void> {
    const dir = path.join(projectRoot, 'templates', 'skills', 'changelog-writing');
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'SKILL.md'),
      [
        '---',
        'id: changelog-writing',
        'name: Fixture skill',
        'version: 1.0.0',
        'description: A fixture skill for the M14 P6 skill-activation-filter test.',
        'when_to_use: Only in this test.',
        'applies_to:',
        `  paths: ["${appliesToPath}"]`,
        'activation: auto',
        'budget_tokens: 700',
        '---',
        '',
        SKILL_BODY_MARKER,
        '',
      ].join('\n'),
    );
  }

  async function skillsBlockFor(produces: readonly string[], docRoots: DocRoots): Promise<string> {
    const projectRoot = await createTempRepo('skill-filter');
    await withFixtureSkill(projectRoot, 'knowledge/**');
    const ctx = createTestContext({
      projectRoot,
      docRoots,
      assembly: createFixtureAssembly(projectRoot, {
        loadAgent: (agentId) =>
          Promise.resolve(
            fixtureAgent(agentId, {
              skills: ['changelog-writing'],
              tools: { read: true, write: true, network: false, git_commit: 'lane', deploy: false },
            }),
          ),
      }),
    });
    const stepNode = node({
      id: 'wf:glossary',
      kind: 'agent',
      agent: toAgentId('po'),
      brief: 'do the work',
      produces,
    });
    const assembled = await assembleAgentSession({ node: stepNode, ctx });
    const text = assembled.compiled.text;
    return text.slice(text.indexOf('## [8]'), text.indexOf('## [9]'));
  }

  it('under a relocated kb root, a skill scoped to the CONFIGURED path (knowledge/**) is upgraded to a body: the filter saw the resolved produces, not the stale default', async () => {
    const block8 = await skillsBlockFor(['docs/forge/kb/glossary.md'], {
      ...DEFAULT_ROOTS,
      kb: 'knowledge',
    });
    expect(block8).toContain(SKILL_BODY_MARKER);
  });

  it('under the shipped default layout, the same skill (scoped to knowledge/**, not docs/forge/kb/**) is NOT upgraded: metadata only', async () => {
    const block8 = await skillsBlockFor(['docs/forge/kb/glossary.md'], DEFAULT_ROOTS);
    expect(block8).not.toContain(SKILL_BODY_MARKER);
    expect(block8).toContain('changelog-writing');
  });
});

describe('a step that declares neither outputs nor produces: no write grant (P36), so the policy has nothing to enforce', () => {
  for (const claimPolicy of ['strict', 'warn'] as const) {
    it(`under ${claimPolicy}: the session is refused the write, nothing is committed and nothing needs reverting`, async () => {
      const { outcome, committed, events } = await run({
        writes: [{ relativePath: STRAY, content: 'x\n' }],
        claimPolicy,
      });
      expect(outcome.status).toBe('succeeded');
      expect(committed).not.toContain(STRAY);
      expect(revertCommits(events)).toBe(0);
      expect(violations(events)).toEqual([]);
    });
  }

  it('a step with only `produces` keeps the default policy: warn keeps an out-of-claim write, strict reverts it', async () => {
    const warn = await run({
      produces: ['docs/**'],
      writes: [{ relativePath: STRAY, content: 'x\n' }],
      claimPolicy: 'warn',
    });
    expect(warn.committed).toContain(STRAY);
    const strict = await run({
      produces: ['docs/**'],
      writes: [{ relativePath: STRAY, content: 'x\n' }],
      claimPolicy: 'strict',
    });
    expect(strict.committed).not.toContain(STRAY);
  });

  it('resolveStepClaim leaves such a step (and a command step declaring outputs, which the check ignores) on the default policy', () => {
    const none = node({ id: 'wf:a', kind: 'agent', produces: ['src/**'] });
    expect(resolveStepClaim(none, DEFAULT_ROOTS, 'warn')).toEqual({
      globs: ['src/**'],
      exclude: NEVER_WRITABLE_GLOBS,
      protectedSet: false,
      policy: 'warn',
    });
    expect(resolveStepClaim(none, DEFAULT_ROOTS, 'strict').policy).toBe('strict');
    const command = node({
      id: 'wf:c',
      kind: 'command',
      run: 'true',
      produces: ['src/**'],
      outputs: [{ type: 'Epic' }],
    });
    expect(resolveStepClaim(command, DEFAULT_ROOTS, 'warn')).toEqual({
      globs: ['src/**'],
      exclude: [],
      protectedSet: false,
      policy: 'warn',
    });
  });
});

describe('what the derived claim is made of', () => {
  it('is exactly the registry glob the output check uses, per output, deduplicated', () => {
    const outputs: StepNode['outputs'] = [
      { type: 'Epic' },
      { type: 'Epic', cardinality: 'many' },
      { type: 'ADR' },
    ];
    expect(outputClaimGlobs(outputs, DEFAULT_ROOTS)).toEqual([
      outputGlob('Epic', DEFAULT_ROOTS),
      outputGlob('ADR', DEFAULT_ROOTS),
    ]);
  });

  it('a Diagram output brings its `.mmd.yaml` sidecar, which the output check requires too', () => {
    expect(outputClaimGlobs([{ type: 'Diagram' }], DEFAULT_ROOTS)).toEqual([
      'docs/forge/kb/*/views/*.mmd',
      'docs/forge/kb/*/views/*.mmd.yaml',
    ]);
  });

  it('an unregistered output type contributes nothing (the check fails it loudly)', () => {
    expect(outputClaimGlobs([{ type: 'NoSuchType' }], DEFAULT_ROOTS)).toEqual([]);
  });

  it('refuses a configured root that climbs out of the repository or is absolute: no claim glob for it', () => {
    for (const bad of ['../elsewhere', '..', '/etc', 'C:/x']) {
      expect(outputClaimGlobs([{ type: 'Epic' }], { ...DEFAULT_ROOTS, specs: bad })).toEqual([]);
    }
    // Only the escaping output is dropped; a sibling with a sane root keeps its glob.
    expect(
      outputClaimGlobs([{ type: 'Epic' }, { type: 'ADR' }], { ...DEFAULT_ROOTS, specs: '../x' }),
    ).toEqual(['docs/forge/kb/decisions/ADR-*.md']);
  });

  it('a step whose docs root escapes the repository writes nothing legitimate: the output fails, the stray write is reverted', async () => {
    const { outcome, committed } = await run({
      outputs: [{ type: 'Epic' }],
      writes: [
        { relativePath: EPIC_PATH, content: epicText() },
        { relativePath: 'escape/epics/EPIC-001.md', content: epicText() },
      ],
      claimPolicy: 'strict',
      docRoots: { ...DEFAULT_ROOTS, specs: '../escape' },
    });
    expect(failureOf(outcome).code).toBe('RUN-083');
    expect(committed).toEqual([]);
  });

  it('a root that starts with `!` or `#` is read literally by the claim matcher (no negation, no comment); the stray still fails the step (PLAN-M14.md P3)', async () => {
    for (const marker of ['!', '#']) {
      const root = `${marker}docs`;
      const { outcome, committed } = await run({
        outputs: [{ type: 'Epic' }],
        writes: [
          { relativePath: `${root}/epics/EPIC-001.md`, content: epicText() },
          // Under an unescaped `!…` glob every OTHER path would count as inside the claim.
          { relativePath: STRAY, content: 'x\n' },
        ],
        claimPolicy: 'strict',
        docRoots: { ...DEFAULT_ROOTS, specs: root },
      });
      expect(outcome.status).toBe('failed');
      expect(outcome.failure).toMatchObject({ source: 'claim', code: 'RUN-104' });
      expect(committed).toContain(`${root}/epics/EPIC-001.md`);
      expect(committed).not.toContain(STRAY);
    }
  });
});

describe('the claim of every registry type covers a concrete path of that type', () => {
  const RELOCATED: DocRoots = {
    kb: 'documentation/kb',
    specs: 'documentation/specs',
    plans: 'documentation/plans',
    sessions: 'documentation/sessions',
    reports: 'documentation/reports',
  };

  /** A path the way the registry template spells it, built without `outputGlob`: placeholders filled with
   * plausible values, the first segment mapped onto the configured root. */
  function concretePath(type: (typeof ARTIFACT_TYPES)[number], roots: DocRoots): string {
    const rendered = renderArtifactPath(type.id, {
      id: `${type.idPrefix}-${'1'.padStart(type.idWidth, '0')}`,
      slug: 'a-slug',
      name: 'billing',
      section: 'delivery',
      gate: 'G-Deliver',
      ts: '20260920T101500',
    });
    if (!rendered.success) throw new Error(`cannot render ${type.id}: ${rendered.missingVariable}`);
    const [first = '', ...rest] = rendered.path.split('/');
    const root = {
      specs: roots.specs,
      kb: roots.kb,
      sessions: roots.sessions,
      reports: roots.reports,
    }[first as 'specs'] as string | undefined;
    return root === undefined ? `${roots.kb}/${rendered.path}` : [root, ...rest].join('/');
  }

  for (const [label, roots] of [
    ['the default layout', DEFAULT_ROOTS],
    ['a relocated layout', RELOCATED],
  ] as const) {
    it(`under ${label}: a file at the registry path of every registry type is inside the claim of a step declaring it`, () => {
      for (const type of ARTIFACT_TYPES) {
        const claim = resolveStepClaim(
          node({ id: 'wf:s', kind: 'agent', outputs: [{ type: type.id }] }),
          roots,
          'warn',
        );
        const sample = concretePath(type, roots);
        expect(
          claim.globs.some((glob) => minimatch(sample, glob, { dot: true })),
          `${type.id}: ${sample} is outside ${claim.globs.join(', ')}`,
        ).toBe(true);
        expect(claim.policy).toBe('strict');
      }
    });
  }
});

describe('a symlink at a declared output path is still refused', () => {
  async function laneWithSymlinks(
    links: readonly string[],
    regular: readonly { readonly path: string; readonly content: string }[] = [],
  ) {
    const projectRoot = await createTempRepo('symlink');
    const ctx = createTestContext({
      projectRoot,
      adapter: new FakePlatformAdapter(),
      claimPolicy: 'strict',
      assembly: createFixtureAssembly(projectRoot, {
        loadAgent: (agentId) => Promise.resolve(fixtureAgent(agentId)),
      }),
    });
    let lanePath = '';
    const stepNode = node({
      id: 'wf:link',
      kind: 'agent',
      agent: toAgentId('po'),
      outputs: [{ type: 'Epic' }],
    });
    const outcome = await runLaneLifecycle(
      stepNode,
      ctx,
      0,
      {
        kind: 'agent',
        session: {
          sessionId: '',
          ok: true,
          finalText: '',
          usage: { inputTokens: 0, outputTokens: 0, turns: 0 },
          durationMs: 0,
          changedFiles: [],
          controlTokens: [],
        },
      },
      async (lane) => {
        lanePath = lane.path;
        for (const file of regular) {
          await mkdir(path.dirname(path.join(lane.path, file.path)), { recursive: true });
          await writeFile(path.join(lane.path, file.path), file.content);
        }
        for (const link of links) {
          await mkdir(path.dirname(path.join(lane.path, link)), { recursive: true });
          await symlink(epicText(), path.join(lane.path, link));
        }
        return { changed: true, commitSubject: 'links', detail: { kind: 'checkpoint' } };
      },
    );
    const committed = (
      await execa('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: lanePath })
    ).stdout
      .split('\n')
      .filter((line) => line !== '');
    return { outcome, ctx, committed };
  }

  it('the symlink sits in the claim (kept by enforcement) and the output contract rejects it as a produced file', async () => {
    const { outcome, committed } = await laneWithSymlinks([EPIC_PATH]);
    expect(failureOf(outcome)).toMatchObject({ source: 'output', code: 'RUN-083' });
    expect(failureOf(outcome).message).toMatch(/symlink|regular file/);
    expect(committed).toContain(EPIC_PATH);
  });

  it('a symlink planted beside a VALID artifact under the same output glob fails the step too (the claim keeps it, the check refuses it)', async () => {
    const { outcome, ctx } = await laneWithSymlinks(
      ['docs/forge/specs/epics/EPIC-002.md'],
      [{ path: EPIC_PATH, content: epicText() }],
    );
    const failure = failureOf(outcome);
    expect(failure).toMatchObject({ source: 'output', code: 'RUN-083' });
    expect(failure.message).toContain('EPIC-002.md is a symlink or submodule');
    expect(ctx.laneRegistry.has('wf:link')).toBe(false);
  });

  it('a symlink outside the claim is reverted like any other out-of-claim path, and (PLAN-M14.md P3) fails the step at the claim itself -- the output check never runs', async () => {
    const { outcome, ctx, committed } = await laneWithSymlinks([
      EPIC_PATH,
      'docs/forge/kb/link.md',
    ]);
    expect(failureOf(outcome)).toMatchObject({ source: 'claim', code: 'RUN-104' });
    expect(ctx.laneRegistry.has('wf:link')).toBe(false);
    expect(committed).not.toContain('docs/forge/kb/link.md');
  });
});

describe('an out-of-claim write leaves a trace: a PolicyViolation event (06 §6.7)', () => {
  it('names nothing when the session stayed inside the claim', async () => {
    const { events } = await run({
      outputs: [{ type: 'Epic' }],
      writes: [{ relativePath: EPIC_PATH, content: epicText() }],
      claimPolicy: 'strict',
    });
    expect(violations(events)).toEqual([]);
  });

  it('under warn (a step with only produces) the write is kept and still flagged, with nothing reverted, and the step still succeeds (unchanged, PLAN-M14.md P3)', async () => {
    const { outcome, events, committed } = await run({
      produces: ['docs/**'],
      writes: [{ relativePath: STRAY, content: 'x\n' }],
      claimPolicy: 'warn',
    });
    expect(outcome.status).toBe('succeeded');
    expect(committed).toContain(STRAY);
    expect(violations(events)).toEqual([
      {
        kind: 'out-of-claim-write',
        policy: 'warn',
        stepFailed: false,
        paths: [STRAY],
        totalOutOfClaim: 1,
        totalReverted: 0,
      },
    ]);
  });

  it('lists at most 50 paths but always records the totals; 51 out-of-claim strays fail the step under strict', async () => {
    const { outcome, events } = await run({
      outputs: [{ type: 'Epic' }],
      writes: [
        { relativePath: EPIC_PATH, content: epicText() },
        ...Array.from({ length: 51 }, (_unused, index) => ({
          relativePath: `src/stray-${String(index).padStart(2, '0')}.ts`,
          content: 'x\n',
        })),
      ],
      claimPolicy: 'strict',
    });
    const [event] = violations(events);
    expect(event?.stepFailed).toBe(true);
    expect(event?.paths).toHaveLength(50);
    expect(event?.totalOutOfClaim).toBe(51);
    expect(event?.totalReverted).toBe(51);
    expect(outcome.status).toBe('failed');
    expect(outcome.failure).toMatchObject({ source: 'claim', code: 'RUN-104' });
  });
});

describe('the claim is the type namespace, so the check refuses what the claim alone would let through', () => {
  interface LaneRun {
    readonly base?: readonly { readonly path: string; readonly content: string }[];
    readonly outputs: StepNode['outputs'];
    readonly work: (lanePath: string) => Promise<void>;
  }

  async function laneRun(input: LaneRun) {
    const projectRoot = await createTempRepo('namespace');
    for (const file of input.base ?? []) {
      await mkdir(path.dirname(path.join(projectRoot, file.path)), { recursive: true });
      await writeFile(path.join(projectRoot, file.path), file.content);
    }
    if ((input.base ?? []).length > 0) {
      await execa('git', ['add', '-A'], { cwd: projectRoot });
      await execa('git', ['commit', '--quiet', '-m', 'base artifacts'], { cwd: projectRoot });
    }
    let lanePath: string | undefined;
    const ctx = createTestContext({
      projectRoot,
      adapter: new FakePlatformAdapter(),
      claimPolicy: 'strict',
      assembly: createFixtureAssembly(projectRoot, {
        loadAgent: (agentId) => Promise.resolve(fixtureAgent(agentId)),
      }),
    });
    const outcome = await runLaneLifecycle(
      node({ id: 'wf:ns', kind: 'agent', agent: toAgentId('po'), outputs: input.outputs }),
      ctx,
      0,
      {
        kind: 'agent',
        session: {
          sessionId: '',
          ok: true,
          finalText: '',
          usage: { inputTokens: 0, outputTokens: 0, turns: 0 },
          durationMs: 0,
          changedFiles: [],
          controlTokens: [],
        },
      },
      async (lane) => {
        lanePath = lane.path;
        await input.work(lane.path);
        return { changed: true, commitSubject: 'work', detail: { kind: 'checkpoint' } };
      },
    );
    return { outcome, tree: await treeAt(lanePath) };
  }

  const EPIC_0 = 'docs/forge/specs/epics/EPIC-000.md';

  it('a valid new artifact does not license deleting an existing one of the same type', async () => {
    const { outcome, tree } = await laneRun({
      base: [{ path: EPIC_0, content: epicText('EPIC-000') }],
      outputs: [{ type: 'Epic' }],
      work: async (lane) => {
        await writeFile(path.join(lane, EPIC_PATH), epicText());
        await rm(path.join(lane, EPIC_0));
      },
    });
    const failure = failureOf(outcome);
    expect(failure.code).toBe('RUN-083');
    expect(failure.message).toContain('EPIC-000.md existed before the session');
    expect(tree).not.toContain(EPIC_0);
  });

  it('updating an existing artifact of the type stays allowed (a `one` output may also touch an older one)', async () => {
    const { outcome } = await laneRun({
      base: [{ path: EPIC_0, content: epicText('EPIC-000') }],
      outputs: [{ type: 'Epic' }],
      work: async (lane) => {
        await writeFile(path.join(lane, EPIC_PATH), epicText());
        await writeFile(path.join(lane, EPIC_0), epicText('EPIC-000', { goal: 'Reworded goal' }));
      },
    });
    expect(outcome.status).toBe('succeeded');
  });

  it('a Diagram sidecar is in the claim and held to the deletion rule: deleting an existing sidecar while adding a new pair fails', async () => {
    const dir = 'docs/forge/kb/delivery/views';
    const pair = async (lane: string, name: string) => {
      await mkdir(path.join(lane, dir), { recursive: true });
      await writeFile(path.join(lane, dir, `${name}.mmd`), 'graph TD; A-->B\n');
      await writeFile(path.join(lane, dir, `${name}.mmd.yaml`), diagramSidecarText());
    };
    const { outcome } = await laneRun({
      base: [
        { path: `${dir}/a.mmd`, content: 'graph TD; A-->B\n' },
        { path: `${dir}/a.mmd.yaml`, content: diagramSidecarText() },
      ],
      outputs: [{ type: 'Diagram' }],
      work: async (lane) => {
        await pair(lane, 'b');
        await rm(path.join(lane, dir, 'a.mmd.yaml'));
      },
    });
    expect(failureOf(outcome).message).toContain('a.mmd.yaml existed before the session');
  });

  it('a Diagram sidecar is in the claim and held to the symlink rule: an orphan symlinked .mmd.yaml fails the step', async () => {
    const dir = 'docs/forge/kb/delivery/views';
    const ok = await laneRun({
      outputs: [{ type: 'Diagram' }],
      work: async (lane) => {
        await mkdir(path.join(lane, dir), { recursive: true });
        await writeFile(path.join(lane, dir, 'a.mmd'), 'graph TD; A-->B\n');
        await writeFile(path.join(lane, dir, 'a.mmd.yaml'), diagramSidecarText());
      },
    });
    expect(ok.outcome.status).toBe('succeeded');
    expect(ok.tree).toContain(`${dir}/a.mmd.yaml`);
    const hostile = await laneRun({
      outputs: [{ type: 'Diagram' }],
      work: async (lane) => {
        await mkdir(path.join(lane, dir), { recursive: true });
        await writeFile(path.join(lane, dir, 'a.mmd'), 'graph TD; A-->B\n');
        await writeFile(path.join(lane, dir, 'a.mmd.yaml'), diagramSidecarText());
        await symlink('../../../../../.env', path.join(lane, dir, 'z.mmd.yaml'));
      },
    });
    expect(failureOf(hostile.outcome).message).toContain('z.mmd.yaml is a symlink or submodule');
  });
});

describe('VcsFacade.changedFiles reports entries that are not regular files', () => {
  it('lists a symlink, a regular file turned symlink, and a submodule entry; never a regular file', async () => {
    const projectRoot = await createTempRepo('modes');
    await writeFile(path.join(projectRoot, 'was-regular.md'), 'text\n');
    await execa('git', ['add', '-A'], { cwd: projectRoot });
    await execa('git', ['commit', '--quiet', '-m', 'base'], { cwd: projectRoot });
    const ctx = createTestContext({ projectRoot, adapter: new FakePlatformAdapter() });
    const baseSha = await ctx.vcs.resolveRevision('main');
    const lane = await ctx.vcs.createLane('wf:modes', 'main');
    await rm(path.join(lane.path, 'was-regular.md'));
    await symlink('target', path.join(lane.path, 'was-regular.md'));
    await symlink('elsewhere', path.join(lane.path, 'new-link.md'));
    await writeFile(path.join(lane.path, 'plain.md'), 'text\n');
    await execa('git', ['add', '-A'], { cwd: lane.path });
    await execa(
      'git',
      ['update-index', '--add', '--cacheinfo', `160000,${baseSha},vendor/module`],
      { cwd: lane.path },
    );
    await execa('git', ['commit', '--quiet', '-m', 'modes'], { cwd: lane.path });
    const { nonRegular, committed } = await ctx.vcs.changedFiles(lane, baseSha);
    expect(nonRegular).toEqual(['new-link.md', 'vendor/module', 'was-regular.md']);
    expect(committed).toContain('plain.md');
  });
});

describe('the existing output contract still applies inside the widened claim', () => {
  it('an invalid artifact at the registry path is kept by the claim and then fails validation, not silently dropped', async () => {
    const { outcome } = await run({
      outputs: [{ type: 'Epic' }],
      writes: [{ relativePath: EPIC_PATH, content: epicText().replace(/^goal: .*\n/m, '') }],
      claimPolicy: 'strict',
    });
    const failure = failureOf(outcome);
    expect(failure.code).toBe('RUN-083');
    expect(failure.message).toContain('goal');
    expect(failure.message).not.toMatch(/reverted/);
  });

  it('verifyDeclaredOutputs uses the same roots as the claim (one derivation)', async () => {
    const projectRoot = await createTempRepo('roots');
    const ctx: ExecuteStepContext = createTestContext({ projectRoot, docRoots: DEFAULT_ROOTS });
    const lane = await ctx.vcs.createLane('wf:x', 'main');
    const baseSha = await ctx.vcs.resolveRevision('main');
    const failure = await verifyDeclaredOutputs(
      node({ id: 'wf:x', kind: 'agent', outputs: [{ type: 'Epic' }] }),
      ctx,
      lane,
      baseSha,
      [],
    );
    expect(failure?.message).toContain(outputGlob('Epic', DEFAULT_ROOTS));
  });
});
