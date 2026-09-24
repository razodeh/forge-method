/**
 * `checkDeclaredOutputs` — the output contract check (`PLAN-M13.md` P7): after an agent step's session
 * ends ok, every entry of the step's declared `outputs` must exist at its `18` §18.7 registry location,
 * among the files the session produced (added or changed on the lane branch), and validate against its
 * artifact schema. These tests drive the checker against a stub of the two read-only VCS questions it
 * asks (which files the lane branch changed against its base, and a file's content at a revision), so
 * every case is a precise statement about the contract; `output-contract.test.ts` proves the same
 * behaviour end to end through `executeStep` and a real git lane.
 *
 * @see specs/05 §5.5
 * @see specs/18 §18.6, §18.7
 * @see PLAN-M13.md P7
 */
import { describe, expect, it } from 'vitest';

import {
  checkDeclaredOutputs,
  outputGlob,
  PROTECTED_CLAIM_EXCLUSION,
  resolveProduces,
} from '../../src/dispatch/outputs.ts';
import type { DocRoots, LaneHandle, VcsFacade } from '../../src/dispatch/types.ts';
import { toAgentId, type StepNode } from '../../src/plan/index.ts';
import {
  adrText,
  assumptionEntry,
  diagramSidecarText,
  environmentEntry,
  openQuestionEntry,
  registerFileText,
  riskEntry,
  runbookText,
  waiverEntry,
  waiversFileText,
  epicMissingGoalText,
  epicText,
  handoffsFileText,
  risksFileText,
  sessionRecordText,
} from './artifact-fixtures.ts';
import { node } from './helpers.ts';

const ROOTS: DocRoots = {
  kb: 'docs/forge/kb',
  specs: 'docs/forge/specs',
  plans: 'docs/forge/plans',
  sessions: 'docs/forge/sessions',
  reports: 'docs/forge/reports',
};

const LANE: LaneHandle = { laneId: 'lane-1', path: '/nowhere/lane', branch: 'forge/lane-1' };

interface Tree {
  /** Files in the lane branch's HEAD commit, by repo-relative path. */
  readonly head: Readonly<Record<string, string>>;
  /** Files at the base revision (the same map shape). */
  readonly base?: Readonly<Record<string, string>>;
  /** Paths the branch changed against the base. Defaults to every path in `head` that differs from `base`. */
  readonly committed?: readonly string[];
  readonly uncommitted?: readonly string[];
}

function stubVcs(tree: Tree): Pick<VcsFacade, 'changedFiles' | 'readAtRevision'> {
  const base = tree.base ?? {};
  const committed =
    tree.committed ??
    [...new Set([...Object.keys(tree.head), ...Object.keys(base)])].filter(
      (file) => tree.head[file] !== base[file],
    );
  return {
    changedFiles: () => Promise.resolve({ committed, uncommitted: tree.uncommitted ?? [] }),
    readAtRevision: (_lane, revision, file) =>
      Promise.resolve((revision === 'HEAD' ? tree.head : base)[file]),
  };
}

function check(
  tree: Tree,
  outputs: StepNode['outputs'],
  extra: {
    readonly claimReverted?: readonly string[];
    readonly writeForbidden?: boolean;
    readonly roots?: DocRoots;
    /** `PLAN-M14.md` P10: the step's own KB-output reservation, keyed by declared output `type`. */
    readonly reservedIds?: ReadonlyMap<string, readonly string[]>;
    /** `PLAN-M14.md` P10: content this lane already held, committed, before this attempt's own session
     * ran -- keyed by repo-relative path. */
    readonly priorAttemptContent?: ReadonlyMap<string, string>;
  } = {},
) {
  return checkDeclaredOutputs({
    node: node({
      id: 'wf:step',
      kind: 'agent',
      agent: toAgentId('em'),
      outputs,
    }),
    vcs: stubVcs(tree),
    lane: LANE,
    baseSha: 'BASE',
    docRoots: extra.roots ?? ROOTS,
    claimReverted: extra.claimReverted ?? [],
    writeForbidden: extra.writeForbidden ?? false,
    reservedIds: extra.reservedIds,
    priorAttemptContent: extra.priorAttemptContent,
  });
}

const EPIC_PATH = 'docs/forge/specs/epics/EPIC-001.md';

describe('outputGlob (18 §18.7 path templates under the configured roots)', () => {
  it('roots each template at the configured section directory and turns placeholders into wildcards', () => {
    expect(outputGlob('Epic', ROOTS)).toBe('docs/forge/specs/epics/EPIC-*.md');
    expect(outputGlob('Story', ROOTS)).toBe('docs/forge/specs/stories/STORY-*.md');
    expect(outputGlob('Vision', ROOTS)).toBe('docs/forge/specs/vision.md');
    expect(outputGlob('SessionRecord', ROOTS)).toBe('docs/forge/sessions/SESSION-*.md');
    expect(outputGlob('ADR', ROOTS)).toBe('docs/forge/kb/decisions/ADR-*.md');
    expect(outputGlob('Risk', ROOTS)).toBe('docs/forge/kb/risks.md');
    expect(outputGlob('HandoffRecord', ROOTS)).toBe('docs/forge/reports/handoffs.md');
    expect(outputGlob('InterfaceContract', ROOTS)).toBe('docs/forge/specs/interfaces/*.yaml');
    expect(outputGlob('GateReport', ROOTS)).toBe('docs/forge/reports/gates/*-*.md');
  });

  // `PLAN-M14.md` P33: `outputGlob` is now built on `registryTail` (`@forge/schemas`); every result below
  // was pinned BEFORE that refactor and stays byte-identical -- the remaining 13 registry types the assertion
  // above did not already cover, so all 22 are pinned here between the two tests.
  it('is byte-identical to before the registryTail refactor, for every registry type (P33)', () => {
    expect(outputGlob('Capability', ROOTS)).toBe('docs/forge/specs/capabilities/CAP-*.md');
    expect(outputGlob('NFR', ROOTS)).toBe('docs/forge/specs/nfr/NFR-*.md');
    expect(outputGlob('Task', ROOTS)).toBe('docs/forge/specs/tasks/TASK-*.md');
    expect(outputGlob('DataModel', ROOTS)).toBe('docs/forge/specs/data/DM-*.md');
    expect(outputGlob('Diagram', ROOTS)).toBe('docs/forge/kb/*/views/*.mmd');
    expect(outputGlob('Assumption', ROOTS)).toBe('docs/forge/kb/assumptions.md');
    expect(outputGlob('OpenQuestion', ROOTS)).toBe('docs/forge/kb/open-questions.md');
    expect(outputGlob('Waiver', ROOTS)).toBe('docs/forge/reports/waivers.md');
    expect(outputGlob('RCA', ROOTS)).toBe('docs/forge/sessions/rca/RCA-*.md');
    expect(outputGlob('Defect', ROOTS)).toBe('docs/forge/reports/defects/DEF-*.md');
    expect(outputGlob('Environment', ROOTS)).toBe('docs/forge/kb/delivery/environments.md');
    expect(outputGlob('Runbook', ROOTS)).toBe('docs/forge/kb/ops/runbooks/RUN-*.md');
    expect(outputGlob('ReviewReport', ROOTS)).toBe('docs/forge/sessions/reviews/REVIEW-*.md');
  });

  it('honours a project that relocated its docs (paths.specs etc.)', () => {
    expect(outputGlob('Epic', { ...ROOTS, specs: 'documentation/specs' })).toBe(
      'documentation/specs/epics/EPIC-*.md',
    );
  });

  it('escapes glob metacharacters in a configured root so a hostile or odd root cannot widen the match', () => {
    expect(outputGlob('Epic', { ...ROOTS, specs: 'a[b]/**/x' })).not.toContain('**');
  });
});

describe('resolveProduces (M14 P6, SPEC-QUESTIONS.md Q232 decision 3: docs/forge/<section>/ prefixes follow the configured roots)', () => {
  const RELOCATED: DocRoots = {
    kb: 'knowledge',
    specs: 'spec',
    plans: 'p',
    sessions: 's',
    reports: 'r',
  };

  it('rewrites a produces glob whose leading segments equal a default root, one case per section', () => {
    expect(resolveProduces(['docs/forge/kb/glossary.md'], RELOCATED)).toEqual([
      'knowledge/glossary.md',
    ]);
    expect(resolveProduces(['docs/forge/specs/epics/EPIC-*.md'], RELOCATED)).toEqual([
      'spec/epics/EPIC-*.md',
    ]);
    expect(resolveProduces(['docs/forge/plans/stages.md'], RELOCATED)).toEqual(['p/stages.md']);
    expect(resolveProduces(['docs/forge/sessions/SESSION-*.md'], RELOCATED)).toEqual([
      's/SESSION-*.md',
    ]);
    expect(resolveProduces(['docs/forge/reports/handoffs.md'], RELOCATED)).toEqual([
      'r/handoffs.md',
    ]);
  });

  it('a bare default root (no trailing segment) becomes the configured root, with no trailing slash', () => {
    expect(resolveProduces(['docs/forge/kb'], RELOCATED)).toEqual(['knowledge']);
  });

  it('leaves a same-prefixed sibling segment untouched: docs/forge/kbx is not docs/forge/kb (the segment-boundary counter-example)', () => {
    expect(resolveProduces(['docs/forge/kbx/y'], RELOCATED)).toEqual(['docs/forge/kbx/y']);
  });

  it('is the identity transform under the shipped default layout, for a variety of produces shapes', () => {
    for (const glob of [
      'docs/forge/kb/glossary.md',
      'docs/forge/specs/**',
      'docs/forge/plans/stages.md',
      'docs/forge/sessions/SESSION-*.md',
      'docs/forge/reports/handoffs.md',
      'src/**',
      '!docs/forge/kb/x/**',
      'docs/forge/kbx/y',
    ]) {
      expect(resolveProduces([glob], ROOTS), glob).toEqual([glob]);
    }
  });

  it('a `!` exclusion is rewritten too, its `!` kept, and expands to a claim exclusion (resolveStepClaim.exclude)', () => {
    expect(resolveProduces(['!docs/forge/kb/x/**'], RELOCATED)).toEqual(['!knowledge/x/**']);
  });

  it('`!@protected` is untouched: it names no docs-root prefix of its own', () => {
    expect(resolveProduces([PROTECTED_CLAIM_EXCLUSION], RELOCATED)).toEqual([
      PROTECTED_CLAIM_EXCLUSION,
    ]);
  });

  it('a configured root that starts with `!` or `#` is escaped so the real claim matcher reads it literally, never as negation or a comment', () => {
    expect(resolveProduces(['docs/forge/specs/x.md'], { ...ROOTS, specs: '!weird' })).toEqual([
      '\\!weird/x.md',
    ]);
    expect(resolveProduces(['docs/forge/specs/x.md'], { ...ROOTS, specs: '#x' })).toEqual([
      '\\#x/x.md',
    ]);
  });

  it('a configured root that climbs out of the repository or is absolute drops the rewritten entry, rather than admitting a path outside the project', () => {
    for (const escaping of ['../out', '/abs', '..']) {
      expect(resolveProduces(['docs/forge/specs/x.md'], { ...ROOTS, specs: escaping })).toEqual([]);
    }
  });

  it('a configured root that only escapes the repository AFTER normalization is still dropped (a fresh critic round: the raw string alone does not start with `/` or `../`)', () => {
    // `posix.normalize('a/../../elsewhere')` collapses to `'../elsewhere'`, which does climb out -- but
    // the raw string itself starts with neither `/` nor `../` nor equals `..`, so a check on the raw
    // configured string (rather than the normalized one) would have missed this.
    expect(
      resolveProduces(['docs/forge/specs/x.md'], { ...ROOTS, specs: 'a/../../elsewhere' }),
    ).toEqual([]);
    expect(
      resolveProduces(['docs/forge/specs/x.md'], { ...ROOTS, specs: 'a/b/../../../elsewhere' }),
    ).toEqual([]);
  });

  it('a bare-root entry whose configured root itself normalizes to the project root (".") is dropped, not turned into an empty-string glob that matches nothing usefully', () => {
    expect(resolveProduces(['docs/forge/kb'], { ...ROOTS, kb: '.' })).toEqual([]);
    expect(resolveProduces(['docs/forge/kb'], { ...ROOTS, kb: './' })).toEqual([]);
    // A non-bare entry under the same root is unaffected: the tail still has real content.
    expect(resolveProduces(['docs/forge/kb/glossary.md'], { ...ROOTS, kb: '.' })).toEqual([
      'glossary.md',
    ]);
  });
});

describe('a declared output that is present and valid', () => {
  it('passes for a one-cardinality output', async () => {
    expect(await check({ head: { [EPIC_PATH]: epicText() } }, [{ type: 'Epic' }])).toBeUndefined();
  });

  it('passes trivially for a step that declares no outputs (nothing to verify)', async () => {
    expect(await check({ head: {} }, [])).toBeUndefined();
  });

  it('matches by the registry glob when the template carries an {id} nobody can know in advance', async () => {
    const path = 'docs/forge/specs/epics/EPIC-042.md';
    expect(
      await check({ head: { [path]: epicText('EPIC-042') } }, [{ type: 'Epic' }]),
    ).toBeUndefined();
  });
});

describe('a declared output that is absent', () => {
  it('fails typed: names the step, the output type, the expected glob and the failed check', async () => {
    const failure = await check({ head: {} }, [{ type: 'Epic' }]);
    expect(failure).toMatchObject({ source: 'output', code: 'RUN-083' });
    const message = failure?.message ?? '';
    expect(message).toContain('wf:step');
    expect(message).toContain('Epic');
    expect(message).toContain('docs/forge/specs/epics/EPIC-*.md');
    expect(message).toMatch(/no file matching/i);
    // Actionable, not just diagnostic.
    expect(message).toMatch(/write .*output|declared outputs/i);
  });

  it('is not satisfied by a file that already existed and was not touched by this session', async () => {
    const tree = { base: { [EPIC_PATH]: epicText() }, head: { [EPIC_PATH]: epicText() } };
    const failure = await check(tree, [{ type: 'Epic' }]);
    expect(failure?.code).toBe('RUN-083');
  });

  it('is satisfied when the session modified an existing artifact', async () => {
    const tree = {
      base: { [EPIC_PATH]: epicText() },
      head: { [EPIC_PATH]: epicText('EPIC-001', { goal: 'A better goal' }) },
    };
    expect(await check(tree, [{ type: 'Epic' }])).toBeUndefined();
  });

  it('is not satisfied by a matching file the session deleted', async () => {
    const failure = await check({ base: { [EPIC_PATH]: epicText() }, head: {} }, [
      { type: 'Epic' },
    ]);
    expect(failure?.code).toBe('RUN-083');
  });

  it('is not satisfied by a file at the wrong location, and the message lists what the session did change', async () => {
    const wrong = 'docs/forge/specs/stories/EPIC-001.md';
    const failure = await check({ head: { [wrong]: epicText() } }, [{ type: 'Epic' }]);
    expect(failure?.code).toBe('RUN-083');
    expect(failure?.message).toContain(wrong);
  });

  it('is not satisfied by an unrelated file the glob only resembles (the id prefix is part of the pattern)', async () => {
    const failure = await check({ head: { 'docs/forge/specs/epics/README.md': 'hi' } }, [
      { type: 'Epic' },
    ]);
    expect(failure?.code).toBe('RUN-083');
  });

  it('says so when the file exists in the worktree but was never committed to the lane branch', async () => {
    const failure = await check({ head: {}, uncommitted: [EPIC_PATH] }, [{ type: 'Epic' }]);
    expect(failure?.code).toBe('RUN-083');
    expect(failure?.message).toMatch(/not committed/i);
  });

  it('says so when claim enforcement reverted what the session wrote', async () => {
    const failure = await check({ head: {} }, [{ type: 'Epic' }], { claimReverted: [EPIC_PATH] });
    expect(failure?.code).toBe('RUN-083');
    expect(failure?.message).toMatch(/reverted/i);
    expect(failure?.message).toMatch(/produces/);
  });

  it('never treats an unknown output type as satisfied', async () => {
    const failure = await check({ head: { 'anything.md': 'x' } }, [{ type: 'NoSuchType' }]);
    expect(failure?.code).toBe('RUN-083');
    expect(failure?.message).toContain('NoSuchType');
  });
});

describe('a declared output that is present but invalid', () => {
  it('fails typed, naming the file and the schema violation', async () => {
    const failure = await check({ head: { [EPIC_PATH]: epicMissingGoalText() } }, [
      { type: 'Epic' },
    ]);
    expect(failure).toMatchObject({ source: 'output', code: 'RUN-083' });
    expect(failure?.message).toContain(EPIC_PATH);
    expect(failure?.message).toMatch(/failed validation/i);
    expect(failure?.message).toContain('goal');
  });

  it('fails a file with no front matter at all', async () => {
    const failure = await check({ head: { [EPIC_PATH]: '# just prose\n' } }, [{ type: 'Epic' }]);
    expect(failure?.code).toBe('RUN-083');
    expect(failure?.message).toContain(EPIC_PATH);
  });

  it('fails a file whose declared type is not the output type, even if it validates as its own type', async () => {
    const failure = await check(
      { head: { 'docs/forge/sessions/SESSION-001.md': sessionRecordText('retro') } },
      [{ type: 'ReviewReport' }],
    );
    // Wrong location for the type too: the message must name the expected glob, not pass.
    expect(failure?.code).toBe('RUN-083');
    const wrongType = await check(
      { head: { 'docs/forge/specs/epics/EPIC-001.md': sessionRecordText('retro') } },
      [{ type: 'Epic' }],
    );
    expect(wrongType?.code).toBe('RUN-083');
    expect(wrongType?.message).toMatch(/type/i);
  });

  it('fails a required-section violation the way `forge spec validate` would', async () => {
    const noSections = sessionRecordText('retro').replace(/## Frame[\s\S]*?(?=## Diverge)/, '');
    const failure = await check({ head: { 'docs/forge/sessions/SESSION-001.md': noSections } }, [
      { type: 'SessionRecord' },
    ]);
    expect(failure?.code).toBe('RUN-083');
    expect(failure?.message).toContain('Frame');
  });
});

describe('cardinality: many', () => {
  const two = {
    'docs/forge/specs/epics/EPIC-001.md': epicText('EPIC-001'),
    'docs/forge/specs/epics/EPIC-002.md': epicText('EPIC-002'),
  };

  it('passes with two valid files', async () => {
    expect(await check({ head: two }, [{ type: 'Epic', cardinality: 'many' }])).toBeUndefined();
  });

  it('fails when the session produced none', async () => {
    const failure = await check({ head: {} }, [{ type: 'Epic', cardinality: 'many' }]);
    expect(failure?.code).toBe('RUN-083');
    expect(failure?.message).toMatch(/many/);
  });

  it('validates every produced file: one invalid file among valid ones fails the step and is named', async () => {
    const failure = await check(
      {
        head: {
          ...two,
          'docs/forge/specs/epics/EPIC-003.md': epicMissingGoalText('EPIC-003'),
        },
      },
      [{ type: 'Epic', cardinality: 'many' }],
    );
    expect(failure?.code).toBe('RUN-083');
    expect(failure?.message).toContain('EPIC-003.md');
    expect(failure?.message).not.toContain('EPIC-001.md failed');
  });

  it('a one-cardinality output validates every matching file too (an extra valid file is not an error)', async () => {
    expect(await check({ head: two }, [{ type: 'Epic' }])).toBeUndefined();
    const failure = await check(
      { head: { ...two, 'docs/forge/specs/epics/EPIC-009.md': epicMissingGoalText('EPIC-009') } },
      [{ type: 'Epic' }],
    );
    expect(failure?.code).toBe('RUN-083');
  });
});

describe('subtype narrows the output', () => {
  const RETRO = 'docs/forge/sessions/SESSION-001.md';

  it('accepts a SessionRecord whose sessionType is the subtype`s canonical form (retrospective -> retro)', async () => {
    expect(
      await check({ head: { [RETRO]: sessionRecordText('retro') } }, [
        { type: 'SessionRecord', subtype: 'retrospective' },
      ]),
    ).toBeUndefined();
  });

  it('fails a SessionRecord of a different sessionType and names the subtype', async () => {
    const failure = await check({ head: { [RETRO]: sessionRecordText('brainstorm') } }, [
      { type: 'SessionRecord', subtype: 'retrospective' },
    ]);
    expect(failure?.code).toBe('RUN-083');
    expect(failure?.message).toContain('retrospective');
    expect(failure?.message).toMatch(/subtype/);
  });

  it('for a register type (HandoffRecord) requires a produced entry that carries the subtype', async () => {
    const file = 'docs/forge/reports/handoffs.md';
    const good = handoffsFileText({ id: 'HO-0001', step: 'write-test-plan -> derive-run-plan' });
    expect(
      await check({ head: { [file]: good } }, [{ type: 'HandoffRecord', subtype: 'test-plan' }]),
    ).toBeUndefined();
    const failure = await check({ head: { [file]: good } }, [
      { type: 'HandoffRecord', subtype: 'threat-model' },
    ]);
    expect(failure?.code).toBe('RUN-083');
    expect(failure?.message).toContain('threat-model');
  });

  it('a subtype that only pre-existing entries carry does not count: only entries this session added or changed do', async () => {
    const file = 'docs/forge/reports/handoffs.md';
    const before = handoffsFileText({ id: 'HO-0001', step: 'write-test-plan -> derive-run-plan' });
    const after = handoffsFileText(
      { id: 'HO-0001', step: 'write-test-plan -> derive-run-plan' },
      { id: 'HO-0002', step: 'threat-model -> design-review' },
    );
    const failure = await check({ base: { [file]: before }, head: { [file]: after } }, [
      { type: 'HandoffRecord', subtype: 'test-plan' },
    ]);
    expect(failure?.code).toBe('RUN-083');
    expect(
      await check({ base: { [file]: before }, head: { [file]: after } }, [
        { type: 'HandoffRecord', subtype: 'threat-model' },
      ]),
    ).toBeUndefined();
  });

  it('a register whose front matter is itself one entry (the template form) is one entry, its nested arrays are data', async () => {
    const file = 'docs/forge/reports/handoffs.md';
    const single = [
      '---',
      'id: HO-0007',
      'from: test-architect',
      'to: sdet',
      'step: write-test-plan -> derive-run-plan',
      "timestamp: '2026-01-15T10:00:00Z'",
      'delivered: [plan]',
      'open_questions: []',
      'assumptions:',
      '  - id: ASM-001',
      '    text: assumed',
      '    confidence: low',
      '    validate_by: 2026-06-01',
      'constraints_for_receiver: []',
      'acceptance_for_receiver: []',
      '---',
      '',
    ].join('\n');
    expect(
      await check({ head: { [file]: single } }, [{ type: 'HandoffRecord', subtype: 'test-plan' }]),
    ).toBeUndefined();
  });

  it('does not accept prose that merely contains the subtype words (step or constraints), only a segment that names it', async () => {
    const file = 'docs/forge/reports/handoffs.md';
    const wrongStep = handoffsFileText({ id: 'HO-0001', step: 'not-a-test-plan-at-all' });
    const failure = await check({ head: { [file]: wrongStep } }, [
      { type: 'HandoffRecord', subtype: 'test-plan' },
    ]);
    expect(failure?.code).toBe('RUN-083');
    const inConstraint = handoffsFileText({ id: 'HO-0001', step: 'other-step' }).replace(
      'constraints_for_receiver: []',
      'constraints_for_receiver: [do not touch the test-plan]',
    );
    const second = await check({ head: { [file]: inConstraint } }, [
      { type: 'HandoffRecord', subtype: 'test-plan' },
    ]);
    expect(second?.code).toBe('RUN-083');
    const delivered = handoffsFileText({ id: 'HO-0001', step: 'other-step' }).replace(
      'delivered: [plan]',
      'delivered: ["subtype: test-plan", plan]',
    );
    expect(
      await check({ head: { [file]: delivered } }, [
        { type: 'HandoffRecord', subtype: 'test-plan' },
      ]),
    ).toBeUndefined();
  });

  it('a register file whose front matter type is another type does not satisfy the output', async () => {
    const file = 'docs/forge/reports/handoffs.md';
    const wrong = handoffsFileText({ id: 'HO-0001', step: 'x' }).replace(
      'type: HandoffRecord',
      'type: Risk',
    );
    const failure = await check({ head: { [file]: wrong } }, [{ type: 'HandoffRecord' }]);
    expect(failure?.code).toBe('RUN-083');
    expect(failure?.message).toContain('type');
  });

  it('matches the subtype as a whole token, not as a substring of a longer word', async () => {
    const file = 'docs/forge/reports/handoffs.md';
    const text = handoffsFileText({ id: 'HO-0001', step: 'contest-plans -> x' });
    const failure = await check({ head: { [file]: text } }, [
      { type: 'HandoffRecord', subtype: 'test-plan' },
    ]);
    expect(failure?.code).toBe('RUN-083');
  });
});

describe('register (collection) types', () => {
  const RISKS = 'docs/forge/kb/risks.md';

  it('accepts a register whose produced entries validate', async () => {
    expect(
      await check({ head: { [RISKS]: risksFileText('RISK-001') } }, [
        { type: 'Risk', cardinality: 'many' },
      ]),
    ).toBeUndefined();
  });

  it('fails a register the session touched without adding or changing any entry', async () => {
    const same = risksFileText('RISK-001');
    const failure = await check(
      { base: { [RISKS]: same }, head: { [RISKS]: `${same}\n` }, committed: [RISKS] },
      [{ type: 'Risk', cardinality: 'many' }],
    );
    expect(failure?.code).toBe('RUN-083');
    expect(failure?.message).toMatch(/entr/i);
  });

  it('fails a register with a schema-invalid entry, naming the entry problem', async () => {
    const bad = risksFileText('RISK-001').replace('    statement: It could break\n', '');
    const failure = await check({ head: { [RISKS]: bad } }, [{ type: 'Risk' }]);
    expect(failure?.code).toBe('RUN-083');
    expect(failure?.message).toContain(RISKS);
    expect(failure?.message).toContain('statement');
  });

  it('passes for an entry appended to a register that already had others', async () => {
    const before = risksFileText('RISK-001');
    const after = risksFileText('RISK-001', 'RISK-002');
    expect(
      await check({ base: { [RISKS]: before }, head: { [RISKS]: after } }, [{ type: 'Risk' }]),
    ).toBeUndefined();
  });
});

/**
 * `PLAN-M14.md` P10, `SPEC-QUESTIONS.md` Q232 decision 2: the KB id-range rule, at the stub level (fast,
 * one precise statement per case) rather than only through a real git lane (`output-contract.test.ts`'s
 * own, slower, end-to-end proof of the same rules) -- matching this file's own established division of
 * labour (this module's own doc comment, above).
 *
 * @see specs/18 §18.8
 * @see specs/08 §8.6
 */
describe('the output check holds a produced KB output to its reserved id range (PLAN-M14.md P10)', () => {
  const ADR_DECISIONS = 'docs/forge/kb/decisions';
  const RISKS = 'docs/forge/kb/risks.md';

  it('a produced ADR at exactly its reserved id passes', async () => {
    expect(
      await check(
        { head: { [`${ADR_DECISIONS}/ADR-0007-x.md`]: adrText('ADR-0007') } },
        [{ type: 'ADR' }],
        { reservedIds: new Map([['ADR', ['ADR-0007']]]) },
      ),
    ).toBeUndefined();
  });

  it('a produced ADR at a different id than the one reserved fails, naming both', async () => {
    const failure = await check(
      { head: { [`${ADR_DECISIONS}/ADR-0009-x.md`]: adrText('ADR-0009') } },
      [{ type: 'ADR' }],
      { reservedIds: new Map([['ADR', ['ADR-0007']]]) },
    );
    expect(failure?.code).toBe('RUN-083');
    expect(failure?.message).toContain('ADR-0009');
    expect(failure?.message).toContain('ADR-0007');
  });

  it('cardinality many: the reserved block used in order from its own base passes; a gap fails', async () => {
    const reservedIds = new Map([['ADR', ['ADR-0007', 'ADR-0008', 'ADR-0009']]]);
    expect(
      await check(
        {
          head: {
            [`${ADR_DECISIONS}/ADR-0007-a.md`]: adrText('ADR-0007'),
            [`${ADR_DECISIONS}/ADR-0008-b.md`]: adrText('ADR-0008'),
          },
        },
        [{ type: 'ADR', cardinality: 'many' }],
        { reservedIds },
      ),
    ).toBeUndefined();
    const gap = await check(
      {
        head: {
          [`${ADR_DECISIONS}/ADR-0007-a.md`]: adrText('ADR-0007'),
          [`${ADR_DECISIONS}/ADR-0009-b.md`]: adrText('ADR-0009'),
        },
      },
      [{ type: 'ADR', cardinality: 'many' }],
      { reservedIds },
    );
    expect(gap?.code).toBe('RUN-083');
  });

  it('two different files declaring the SAME new id fail even though each alone would be in range', async () => {
    const failure = await check(
      {
        head: {
          [`${ADR_DECISIONS}/ADR-0007-a.md`]: adrText('ADR-0007'),
          [`${ADR_DECISIONS}/ADR-0007-b.md`]: adrText('ADR-0007'),
        },
      },
      [{ type: 'ADR', cardinality: 'many' }],
      { reservedIds: new Map([['ADR', ['ADR-0007', 'ADR-0008']]]) },
    );
    expect(failure?.code).toBe('RUN-083');
    expect(failure?.message).toContain('ADR-0007');
    expect(failure?.message).toContain('more than once');
  });

  it('a register file with two NEW entries sharing one id fails -- the same rule the per-file branch applies', async () => {
    const failure = await check(
      { head: { [RISKS]: risksFileText('RISK-005', 'RISK-005') } },
      [{ type: 'Risk' }],
      { reservedIds: new Map([['Risk', ['RISK-005', 'RISK-006']]]) },
    );
    expect(failure?.code).toBe('RUN-083');
    expect(failure?.message).toContain('RISK-005');
    expect(failure?.message).toContain('more than once');
  });

  it("an id already the artifact's own at the base revision is an update, exempt regardless of the reservation", async () => {
    expect(
      await check(
        {
          base: { [`${ADR_DECISIONS}/ADR-0007-x.md`]: adrText('ADR-0007', 'Old title') },
          head: { [`${ADR_DECISIONS}/ADR-0007-x.md`]: adrText('ADR-0007', 'New title') },
        },
        [{ type: 'ADR' }],
        { reservedIds: new Map([['ADR', ['ADR-0008']]]) },
      ),
    ).toBeUndefined();
  });

  it('an id swapped at an already-existing path is NOT exempt: it must still lie in the reservation', async () => {
    const failure = await check(
      {
        base: { [`${ADR_DECISIONS}/ADR-0007-x.md`]: adrText('ADR-0007') },
        head: { [`${ADR_DECISIONS}/ADR-0007-x.md`]: adrText('ADR-0009') },
      },
      [{ type: 'ADR' }],
      { reservedIds: new Map([['ADR', ['ADR-0008']]]) },
    );
    expect(failure?.code).toBe('RUN-083');
    expect(failure?.message).toContain('ADR-0009');
  });

  it('an id already committed to this lane by an earlier attempt of this step (priorAttemptContent) is exempt', async () => {
    const priorText = adrText('ADR-0004', 'Leftover from a crashed attempt');
    expect(
      await check(
        {
          head: {
            [`${ADR_DECISIONS}/ADR-0004-x.md`]: priorText,
            [`${ADR_DECISIONS}/ADR-0005-y.md`]: adrText('ADR-0005'),
          },
        },
        [{ type: 'ADR' }],
        {
          reservedIds: new Map([['ADR', ['ADR-0005']]]),
          priorAttemptContent: new Map([[`${ADR_DECISIONS}/ADR-0004-x.md`, priorText]]),
        },
      ),
    ).toBeUndefined();
  });

  it('a fabricated reservation for a non-KB type (Epic) is simply ignored', async () => {
    expect(
      await check({ head: { [EPIC_PATH]: epicText() } }, [{ type: 'Epic' }], {
        reservedIds: new Map([['Epic', ['EPIC-9999']]]),
      }),
    ).toBeUndefined();
  });
});

/**
 * `PLAN-M14.md` P11, `08` §8.6's KbWriter invariant "Every write records `sources`. A write with no
 * source is rejected": the output check applies this to every produced KB document and every new or
 * changed register entry, for the six KB-located types (`ADR`, `Runbook`, `Risk`, `Assumption`,
 * `OpenQuestion`, `Environment`) -- the schema itself leaves `sources` optional (P11's own Mandate), so
 * only the check enforces it.
 *
 * @see specs/08 §8.6
 * @see PLAN-M14.md P11
 */
describe('the output check requires sources on a produced KB document or new/changed register entry (PLAN-M14.md P11)', () => {
  const ADR_DECISIONS = 'docs/forge/kb/decisions';
  const RUNBOOKS = 'docs/forge/kb/ops/runbooks';
  const RISKS = 'docs/forge/kb/risks.md';

  it('a produced ADR with a source passes; without one fails RUN-083 naming the file and the rule', async () => {
    expect(
      await check({ head: { [`${ADR_DECISIONS}/ADR-0007-x.md`]: adrText('ADR-0007') } }, [
        { type: 'ADR' },
      ]),
    ).toBeUndefined();
    const failure = await check(
      { head: { [`${ADR_DECISIONS}/ADR-0007-x.md`]: adrText('ADR-0007', 'x', []) } },
      [{ type: 'ADR' }],
    );
    expect(failure?.code).toBe('RUN-083');
    expect(failure?.message).toContain('ADR-0007-x.md');
    expect(failure?.message).toContain('no sources');
    expect(failure?.message).toContain('08 §8.6');
  });

  it('a produced Runbook with a source passes; without one fails, naming the rule', async () => {
    expect(
      await check({ head: { [`${RUNBOOKS}/RUN-001-x.md`]: runbookText('RUN-001') } }, [
        { type: 'Runbook' },
      ]),
    ).toBeUndefined();
    const failure = await check(
      { head: { [`${RUNBOOKS}/RUN-001-x.md`]: runbookText('RUN-001', 'x', []) } },
      [{ type: 'Runbook' }],
    );
    expect(failure?.code).toBe('RUN-083');
    expect(failure?.message).toContain('no sources');
  });

  it('a new register entry without sources fails, naming it; the same entry with a source passes', async () => {
    expect(
      await check({ head: { [RISKS]: risksFileText('RISK-001') } }, [{ type: 'Risk' }]),
    ).toBeUndefined();
    const withoutSource = await check(
      { head: { [RISKS]: registerFileText('Risk', 'risks', [riskEntry('RISK-001', [])]) } },
      [{ type: 'Risk' }],
    );
    expect(withoutSource?.code).toBe('RUN-083');
    expect(withoutSource?.message).toContain('RISK-001');
    expect(withoutSource?.message).toContain('no sources');
  });

  it('a changed register entry without sources fails; an untouched sibling entry without sources does not block it', async () => {
    // Simulates a pre-P11 register: RISK-001 has no sources and is left untouched; the session only
    // adds RISK-002, also without sources -- RISK-002 is what fails, not the untouched RISK-001.
    const noSourceEntry = riskEntry('RISK-001', []);
    const base = registerFileText('Risk', 'risks', [noSourceEntry]);
    const head = registerFileText('Risk', 'risks', [noSourceEntry, riskEntry('RISK-002', [])]);
    const failure = await check({ base: { [RISKS]: base }, head: { [RISKS]: head } }, [
      { type: 'Risk' },
    ]);
    expect(failure?.code).toBe('RUN-083');
    expect(failure?.message).toContain('RISK-002');
    expect(failure?.message).not.toContain('RISK-001');
  });

  it('Assumption: a new register entry without sources fails', async () => {
    const failure = await check(
      {
        head: {
          'docs/forge/kb/assumptions.md': registerFileText('Assumption', 'assumptions', [
            assumptionEntry('ASM-001', []),
          ]),
        },
      },
      [{ type: 'Assumption' }],
    );
    expect(failure?.code).toBe('RUN-083');
    expect(failure?.message).toContain('ASM-001');
    expect(failure?.message).toContain('no sources');
  });

  it('OpenQuestion: a new register entry without sources fails', async () => {
    const failure = await check(
      {
        head: {
          'docs/forge/kb/open-questions.md': registerFileText('OpenQuestion', 'open_questions', [
            openQuestionEntry('OQ-001', []),
          ]),
        },
      },
      [{ type: 'OpenQuestion' }],
    );
    expect(failure?.code).toBe('RUN-083');
    expect(failure?.message).toContain('OQ-001');
    expect(failure?.message).toContain('no sources');
  });

  it('Environment: a new register entry without sources fails', async () => {
    const failure = await check(
      {
        head: {
          'docs/forge/kb/delivery/environments.md': registerFileText(
            'Environment',
            'environments',
            [environmentEntry('ENV-001', [])],
          ),
        },
      },
      [{ type: 'Environment' }],
    );
    expect(failure?.code).toBe('RUN-083');
    expect(failure?.message).toContain('ENV-001');
    expect(failure?.message).toContain('no sources');
  });

  it('Epic (not KB-located) is not held to the sources rule: no sources field at all still passes', async () => {
    expect(await check({ head: { [EPIC_PATH]: epicText() } }, [{ type: 'Epic' }])).toBeUndefined();
  });
});

/**
 * `PLAN-M14.md` P11, `08` §8.6's KbWriter invariant "never reused (deleted entries become
 * `deprecated`, files retained)": a register entry id present at the base revision must still be
 * present at HEAD, whatever else the session changed about the file -- the piece's own title, "a
 * register entry may be deprecated, never removed."
 *
 * @see specs/08 §8.6
 * @see PLAN-M14.md P11
 */
describe('a register entry may be deprecated, never removed (PLAN-M14.md P11)', () => {
  const RISKS = 'docs/forge/kb/risks.md';
  const OQ = 'docs/forge/kb/open-questions.md';

  it('a base entry absent at HEAD fails, naming it', async () => {
    const base = risksFileText('RISK-001', 'RISK-002');
    const head = risksFileText('RISK-002', 'RISK-003'); // RISK-001 silently dropped
    const failure = await check({ base: { [RISKS]: base }, head: { [RISKS]: head } }, [
      { type: 'Risk' },
    ]);
    expect(failure?.code).toBe('RUN-083');
    expect(failure?.message).toContain('RISK-001');
    expect(failure?.message).toContain('08 §8.6');
  });

  it('an id changed in place fails: the old id is now absent at HEAD, exactly as wrong as deleting it', async () => {
    const base = risksFileText('RISK-001');
    const head = registerFileText('Risk', 'risks', [riskEntry('RISK-099')]);
    const failure = await check({ base: { [RISKS]: base }, head: { [RISKS]: head } }, [
      { type: 'Risk' },
    ]);
    expect(failure?.code).toBe('RUN-083');
    expect(failure?.message).toContain('RISK-001');
  });

  it('every base entry still present, even untouched, passes -- retaining and adding both work', async () => {
    const base = risksFileText('RISK-001');
    const head = risksFileText('RISK-001', 'RISK-002');
    expect(
      await check({ base: { [RISKS]: base }, head: { [RISKS]: head } }, [{ type: 'Risk' }]),
    ).toBeUndefined();
  });

  it('OpenQuestion status: resolved passes -- retiring an entry by changing its status, not removing it', async () => {
    const base = registerFileText('OpenQuestion', 'open_questions', [openQuestionEntry('OQ-001')]);
    const head = registerFileText('OpenQuestion', 'open_questions', [
      openQuestionEntry('OQ-001').replace('status: open', 'status: resolved'),
    ]);
    expect(
      await check({ base: { [OQ]: base }, head: { [OQ]: head } }, [{ type: 'OpenQuestion' }]),
    ).toBeUndefined();
  });

  it('Epic (not a register type) is not held to the retained-entry rule', async () => {
    const base = epicText('EPIC-001');
    const head = epicText('EPIC-001', { goal: 'Ship a different thing' });
    expect(
      await check({ base: { [EPIC_PATH]: base }, head: { [EPIC_PATH]: head } }, [{ type: 'Epic' }]),
    ).toBeUndefined();
  });
});

describe('the write-forbidden agent (the grant is the cause)', () => {
  it('uses the grant-specific code and remedy, still a typed output failure', async () => {
    const failure = await check(
      { head: {} },
      [{ type: 'SessionRecord', subtype: 'retrospective' }],
      {
        writeForbidden: true,
      },
    );
    expect(failure).toMatchObject({ source: 'output', code: 'RUN-084' });
    expect(failure?.message).toContain('wf:step');
    expect(failure?.message).toContain('em');
    expect(failure?.message).toMatch(/write: false/);
    expect(failure?.message).toContain('docs/forge/sessions/SESSION-*.md');
    // The remedy names the real ways out.
    expect(failure?.message).toMatch(/write access|an agent that can write|remove the step/i);
  });

  it('is not exempt: the same agent that DID produce a valid file passes (the check never depends on the grant)', async () => {
    expect(
      await check({ head: { [EPIC_PATH]: epicText() } }, [{ type: 'Epic' }], {
        writeForbidden: true,
      }),
    ).toBeUndefined();
  });

  it('a write-forbidden agent whose file is present but invalid gets the generic code (the grant is not the cause)', async () => {
    const failure = await check(
      { head: { [EPIC_PATH]: epicMissingGoalText() } },
      [{ type: 'Epic' }],
      {
        writeForbidden: true,
      },
    );
    expect(failure?.code).toBe('RUN-083');
  });

  it('a write-capable agent that wrote nothing gets the generic code, not the grant message', async () => {
    const failure = await check({ head: {} }, [{ type: 'Epic' }], { writeForbidden: false });
    expect(failure?.code).toBe('RUN-083');
    expect(failure?.message).not.toMatch(/write: false/);
  });
});

describe('several outputs on one step', () => {
  it('reports every unmet output in one failure, not just the first', async () => {
    const failure = await check({ head: {} }, [
      { type: 'Epic' },
      { type: 'SessionRecord', subtype: 'retrospective' },
    ]);
    expect(failure?.message).toContain('Epic');
    expect(failure?.message).toContain('SessionRecord');
  });

  it('passes only when all are met', async () => {
    const head = {
      [EPIC_PATH]: epicText(),
      'docs/forge/sessions/SESSION-001.md': sessionRecordText('retro'),
    };
    expect(
      await check({ head }, [
        { type: 'Epic' },
        { type: 'SessionRecord', subtype: 'retrospective' },
      ]),
    ).toBeUndefined();
  });
});

describe('InterfaceContract (a YAML file whose top level carries the front matter keys)', () => {
  const PATH = 'docs/forge/specs/interfaces/orders-api.yaml';
  const yamlContract = (extra = ''): string =>
    [
      'id: INT-001',
      'type: InterfaceContract',
      'schemaVersion: 1',
      'title: Orders API',
      'status: draft',
      'created: 2026-01-15',
      'updated: 2026-01-15',
      'revision: 1',
      'author: architect',
      'changelog: []',
      'openapi: 3.1.0',
      'paths: {}',
      extra,
    ].join('\n');

  it('validates the base keys of a plain-YAML contract and ignores the OpenAPI body keys', async () => {
    expect(
      await check({ head: { [PATH]: yamlContract() } }, [
        { type: 'InterfaceContract', cardinality: 'many' },
      ]),
    ).toBeUndefined();
  });

  it('fails a contract whose base keys are invalid', async () => {
    const bad = yamlContract().replace('id: INT-001', 'id: nope');
    const failure = await check({ head: { [PATH]: bad } }, [{ type: 'InterfaceContract' }]);
    expect(failure?.code).toBe('RUN-083');
    expect(failure?.message).toContain('id');
  });
});

describe('robustness of the message and the roots', () => {
  it('caps the failure message when many files are invalid', async () => {
    const head: Record<string, string> = {};
    for (let index = 0; index < 60; index += 1) {
      const id = `EPIC-${String(index).padStart(3, '0')}`;
      head[`docs/forge/specs/epics/${id}.md`] = epicMissingGoalText(id);
    }
    const failure = await check({ head }, [{ type: 'Epic', cardinality: 'many' }]);
    expect(failure?.code).toBe('RUN-083');
    expect(failure?.message.length).toBeLessThan(6000);
    expect(failure?.message).toMatch(/more problem/);
  });

  it('normalises a configured root written ./docs/specs/', async () => {
    const roots = { ...ROOTS, specs: './documentation/specs/' };
    expect(outputGlob('Epic', roots)).toBe('documentation/specs/epics/EPIC-*.md');
    expect(
      await check(
        { head: { 'documentation/specs/epics/EPIC-001.md': epicText() } },
        [{ type: 'Epic' }],
        {
          roots,
        },
      ),
    ).toBeUndefined();
  });

  it('treats a leading ! or # in a root literally, never as negation or a comment', async () => {
    const roots = { ...ROOTS, specs: '!odd/specs' };
    const failure = await check(
      { head: { 'docs/forge/specs/epics/EPIC-001.md': epicText() } },
      [{ type: 'Epic' }],
      { roots },
    );
    expect(failure?.code).toBe('RUN-083');
  });

  it('a Diagram needs its sidecar produced by the session and a non-empty source', async () => {
    const mmd = 'docs/forge/kb/architecture/views/ctx.mmd';
    const noSidecar = await check({ head: { [mmd]: 'graph TD;A-->B' } }, [{ type: 'Diagram' }]);
    expect(noSidecar?.code).toBe('RUN-083');
    expect(noSidecar?.message).toContain('sidecar');
    const empty = await check({ head: { [mmd]: '  ' } }, [{ type: 'Diagram' }]);
    expect(empty?.message).toContain('empty');
  });
});

describe('the other register types and the register file rules', () => {
  const CASES = [
    ['Assumption', 'docs/forge/kb/assumptions.md', 'assumptions', assumptionEntry('ASM-001')],
    [
      'OpenQuestion',
      'docs/forge/kb/open-questions.md',
      'open_questions',
      openQuestionEntry('OQ-001'),
    ],
    [
      'Environment',
      'docs/forge/kb/delivery/environments.md',
      'environments',
      environmentEntry('ENV-001'),
    ],
  ] as const;

  it.each(CASES)(
    '%s: a produced valid entry passes, an entry under the wrong key does not',
    async (type, file, key, entry) => {
      expect(
        await check({ head: { [file]: registerFileText(type, key, [entry]) } }, [{ type }]),
      ).toBeUndefined();
      const wrongKey = await check({ head: { [file]: registerFileText(type, 'stuff', [entry]) } }, [
        { type },
      ]);
      expect(wrongKey?.code).toBe('RUN-083');
    },
  );

  const WAIVERS = 'docs/forge/reports/waivers.md';
  const HANDOFFS = 'docs/forge/reports/handoffs.md';

  it('Waiver: a valid entry passes; an entry missing its expiry fails and names the entry', async () => {
    expect(
      await check({ head: { [WAIVERS]: waiversFileText(waiverEntry('WAIVER-001')) } }, [
        { type: 'Waiver' },
      ]),
    ).toBeUndefined();
    const bad = waiversFileText(waiverEntry('WAIVER-001').replace('\n    expiry: 2026-12-31', ''));
    const failure = await check({ head: { [WAIVERS]: bad } }, [{ type: 'Waiver' }]);
    expect(failure?.code).toBe('RUN-083');
    expect(failure?.message).toContain('WAIVER-001');
    expect(failure?.message).toContain('expiry');
  });

  it('HandoffRecord: a file with no entry at all, or an invalid entry, fails', async () => {
    const none = await check({ head: { [HANDOFFS]: '---\ntype: HandoffRecord\n---\n' } }, [
      { type: 'HandoffRecord' },
    ]);
    expect(none?.code).toBe('RUN-083');
    expect(none?.message).toMatch(/no HandoffRecord entry/);
    const invalid = handoffsFileText({ id: 'HO-0001', step: 'x' }).replace('    to: sdet\n', '');
    const failure = await check({ head: { [HANDOFFS]: invalid } }, [{ type: 'HandoffRecord' }]);
    expect(failure?.code).toBe('RUN-083');
    expect(failure?.message).toContain('HO-0001');
  });

  it('re-ordering an entry`s keys is not a change (only content is)', async () => {
    const before = risksFileText('RISK-001');
    const reordered = before.replace(
      '    statement: It could break\n    likelihood: low\n',
      '    likelihood: low\n    statement: It could break\n',
    );
    const failure = await check(
      { base: { 'docs/forge/kb/risks.md': before }, head: { 'docs/forge/kb/risks.md': reordered } },
      [{ type: 'Risk' }],
    );
    expect(failure?.code).toBe('RUN-083');
  });

  it('a Diagram passes with a produced valid sidecar, fails with an invalid one or one the session did not produce', async () => {
    const mmd = 'docs/forge/kb/architecture/views/ctx.mmd';
    const sidecar = `${mmd}.yaml`;
    expect(
      await check({ head: { [mmd]: 'graph TD;A-->B', [sidecar]: diagramSidecarText() } }, [
        { type: 'Diagram' },
      ]),
    ).toBeUndefined();
    const invalid = await check(
      {
        head: {
          [mmd]: 'graph TD;A-->B',
          [sidecar]: diagramSidecarText().replace('caption: A caption\n', ''),
        },
      },
      [{ type: 'Diagram' }],
    );
    expect(invalid?.code).toBe('RUN-083');
    expect(invalid?.message).toContain('caption');
    const broken = await check({ head: { [mmd]: 'graph TD;A-->B', [sidecar]: ': : :\n\t-' } }, [
      { type: 'Diagram' },
    ]);
    expect(broken?.code).toBe('RUN-083');
    const stale = await check(
      {
        base: { [sidecar]: diagramSidecarText() },
        head: { [mmd]: 'graph TD;A-->B', [sidecar]: diagramSidecarText() },
        committed: [mmd],
      },
      [{ type: 'Diagram' }],
    );
    expect(stale?.message).toContain('sidecar');
  });
});

describe('InterfaceContract file shapes', () => {
  const PATH = 'docs/forge/specs/interfaces/orders-api.yaml';
  const body = [
    'id: INT-001',
    'type: InterfaceContract',
    'schemaVersion: 1',
    'title: Orders',
    'status: draft',
    'created: 2026-01-15',
    'updated: 2026-01-15',
    'revision: 1',
    'author: architect',
    'changelog: []',
    'openapi: 3.1.0',
  ].join('\n');

  it('accepts plain YAML that opens with the document-start marker, with or without a BOM', async () => {
    expect(
      await check({ head: { [PATH]: `---\n${body}\n` } }, [{ type: 'InterfaceContract' }]),
    ).toBeUndefined();
    expect(
      await check({ head: { [PATH]: `\uFEFF---\n${body}\n` } }, [{ type: 'InterfaceContract' }]),
    ).toBeUndefined();
  });

  it('accepts the front matter form, and rejects a front matter form whose fields are invalid', async () => {
    const framed = `---\n${body.replace('\nopenapi: 3.1.0', '')}\n---\n\nprose\n`;
    expect(
      await check({ head: { [PATH]: framed } }, [{ type: 'InterfaceContract' }]),
    ).toBeUndefined();
    const bad = await check({ head: { [PATH]: framed.replace('id: INT-001', 'id: nope') } }, [
      { type: 'InterfaceContract' },
    ]);
    expect(bad?.code).toBe('RUN-083');
  });

  it('rejects a YAML file that is not a mapping', async () => {
    const failure = await check({ head: { [PATH]: '- a\n- b\n' } }, [
      { type: 'InterfaceContract' },
    ]);
    expect(failure?.code).toBe('RUN-083');
  });
});

describe('the failure message is safe to print and log', () => {
  it('replaces control characters from agent-controlled text (file names) and keeps message and remedy apart', async () => {
    const hostile = 'docs/forge/specs/epics/EPIC-001\u001b[31m.md';
    const failure = await check({ head: { [hostile]: epicMissingGoalText() } }, [{ type: 'Epic' }]);
    expect(
      Array.from(failure?.message ?? '', (char) => char.charCodeAt(0)).every((code) => code >= 32),
    ).toBe(true);
    expect(failure?.message).toContain('-- Remedy:');
  });

  it('a `#` at the start of a configured root is literal', async () => {
    const roots = { ...ROOTS, specs: '#specs' };
    expect(
      await check({ head: { '#specs/epics/EPIC-001.md': epicText() } }, [{ type: 'Epic' }], {
        roots,
      }),
    ).toBeUndefined();
  });
});

describe('subtype text is only searched where the convention puts it', () => {
  const file = 'docs/forge/reports/handoffs.md';
  const withDelivered = (delivered: string): string =>
    handoffsFileText({ id: 'HO-0001', step: 'other-step' }).replace('delivered: [plan]', delivered);

  it('free prose in a delivered item does not satisfy the subtype; a `subtype:` item does', async () => {
    const prose = await check(
      { head: { [file]: withDelivered('delivered: ["no test-plan was written"]') } },
      [{ type: 'HandoffRecord', subtype: 'test-plan' }],
    );
    expect(prose?.code).toBe('RUN-083');
    expect(
      await check({ head: { [file]: withDelivered('delivered: ["subtype: test-plan"]') } }, [
        { type: 'HandoffRecord', subtype: 'test-plan' },
      ]),
    ).toBeUndefined();
  });

  it('is linear-time on a huge run of dashes inside agent-controlled text', async () => {
    const hostile = `x${'-'.repeat(300_000)}y`;
    const started = Date.now();
    const failure = await check(
      { head: { [file]: withDelivered(`delivered: ["subtype: ${hostile}"]`) } },
      [{ type: 'HandoffRecord', subtype: 'test-plan' }],
    );
    expect(failure?.code).toBe('RUN-083');
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('what the message says about a matching file that is not a regular file at head', () => {
  it('names a deleted output as present in the diff but holding no regular file, not as "committed"', async () => {
    const failure = await check({ base: { [EPIC_PATH]: epicText() }, head: {} }, [
      { type: 'Epic' },
    ]);
    expect(failure?.message).toMatch(/hold no regular file at its head/);
  });

  it('strips bidirectional-override and zero-width characters from agent-controlled text', async () => {
    const hostile = 'docs/forge/specs/epics/EPIC-001\u202e\u200b.md';
    const failure = await check({ head: { [hostile]: epicMissingGoalText() } }, [{ type: 'Epic' }]);
    expect(failure?.message).not.toContain('\u202e');
    expect(failure?.message).not.toContain('\u200b');
  });
});
