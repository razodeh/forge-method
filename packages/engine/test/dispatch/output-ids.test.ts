/**
 * `dispatch/output-ids.ts` — the supervisor-reserved, collision-free id queue every declared KB output
 * reserves through, and the `REVIEW-NNN` queue (`PLAN-M13.md` P17) was generalised into
 * (`PLAN-M14.md` P8).
 *
 * @see specs/18 §18.8
 * @see specs/06 §6.4, §6.7
 * @see PLAN-M14.md P8
 * @see SPEC-QUESTIONS.md Q232 decision 2
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { ForgeError, isForgeError } from '@forge/core/errors';
import { describe, expect, it } from 'vitest';

import {
  directoryIdScan,
  registerIdScan,
  reserveDeclaredKbOutputIds,
  reserveIds,
  type ScanTarget,
} from '../../src/dispatch/output-ids.ts';
import { toAgentId } from '../../src/plan/index.ts';
import { createTestContext, node } from './helpers.ts';

// Not in helpers.ts: node:os's tmpdir is R10-restricted in production code, and the test-file
// exemption in eslint.config.js only covers files literally named *.test.ts.
async function createTempRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `forge-output-ids-${prefix}-`));
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

const NO_NUMBERS: ScanTarget = { numbersIn: () => Promise.resolve([]) };

function fixedScanTarget(numbers: Readonly<Record<string, readonly number[]>>): ScanTarget {
  return { numbersIn: (root) => Promise.resolve(numbers[root] ?? []) };
}

/** A minimal, valid `kb/risks.md` register file with `entries` (already-indented YAML list items)
 * spliced into its `risks:` array. */
const RISKS = (entries: string): string =>
  [
    '---',
    'type: Risk',
    'schemaVersion: 1',
    'title: Risk register',
    'status: active',
    'created: 2026-01-01',
    'updated: 2026-01-01',
    'revision: 1',
    'author: architect',
    'changelog: []',
    'risks:',
    entries,
    '---',
    '',
    'Risk register.',
    '',
  ].join('\n');

describe('reserveIds', () => {
  it("reserves above the highest number visible across every root: the project root, the integration worktree, a ready sibling lane and the step's own lane", async () => {
    const key = `roots-${Math.random().toString(36).slice(2)}`;
    const target = fixedScanTarget({
      projectRoot: [3],
      integration: [7],
      sibling: [2],
      ownLane: [9],
    });
    const reservation = await reserveIds({
      projectRoot: `/tmp/${key}`,
      runId: 'run-1',
      stepId: 'wf:step',
      idPrefix: 'ADR',
      idWidth: 4,
      count: 1,
      roots: ['projectRoot', 'integration', 'sibling', 'ownLane'],
      target,
    });
    expect(reservation.ids).toEqual(['ADR-0010']);
  });

  it('reserves a contiguous block of `count` ids for a `many`-shaped output', async () => {
    const key = `many-${Math.random().toString(36).slice(2)}`;
    const reservation = await reserveIds({
      projectRoot: `/tmp/${key}`,
      runId: 'run-1',
      stepId: 'wf:step',
      idPrefix: 'ADR',
      idWidth: 4,
      count: 25,
      roots: [],
      target: NO_NUMBERS,
    });
    expect(reservation.ids).toHaveLength(25);
    expect(reservation.ids[0]).toBe('ADR-0001');
    expect(reservation.ids[24]).toBe('ADR-0025');
  });

  it('three concurrent reservations of the same id space get disjoint ranges before any lane exists', async () => {
    const key = `concurrent-${Math.random().toString(36).slice(2)}`;
    const base = {
      projectRoot: `/tmp/${key}`,
      runId: 'run-1',
      idPrefix: 'ADR',
      idWidth: 4,
      count: 1,
      roots: [],
      target: NO_NUMBERS,
    };
    const [a, b, c] = await Promise.all([
      reserveIds({ ...base, stepId: 'wf:a' }),
      reserveIds({ ...base, stepId: 'wf:b' }),
      reserveIds({ ...base, stepId: 'wf:c' }),
    ]);
    const ids = [a.ids[0], b.ids[0], c.ids[0]];
    expect(new Set(ids).size).toBe(3);
    expect([...ids].sort()).toEqual(['ADR-0001', 'ADR-0002', 'ADR-0003']);
  });

  it('a re-run of a discarded attempt (released before it ever got a lane) gets the same base back', async () => {
    const key = `rerun-${Math.random().toString(36).slice(2)}`;
    const base = {
      projectRoot: `/tmp/${key}`,
      runId: 'run-1',
      stepId: 'wf:step',
      idPrefix: 'ADR',
      idWidth: 4,
      count: 1,
      roots: [],
      target: NO_NUMBERS,
    };
    const first = await reserveIds(base);
    expect(first.ids).toEqual(['ADR-0001']);
    first.release();
    const second = await reserveIds(base);
    expect(second.ids).toEqual(['ADR-0001']);
  });

  it('a step allocating again supersedes its own earlier reservation even without an explicit release', async () => {
    const key = `supersede-${Math.random().toString(36).slice(2)}`;
    const base = {
      projectRoot: `/tmp/${key}`,
      runId: 'run-1',
      stepId: 'wf:step',
      idPrefix: 'ADR',
      idWidth: 4,
      count: 1,
      roots: [],
      target: NO_NUMBERS,
    };
    const first = await reserveIds(base);
    const second = await reserveIds(base);
    expect(first.ids).toEqual(['ADR-0001']);
    expect(second.ids).toEqual(['ADR-0001']);
  });

  it("a PENDING reservation (no lane yet) is never dropped by liveness -- the exact pre-lane collision P17's existsSync check would cause if reused naively", async () => {
    const key = `pending-${Math.random().toString(36).slice(2)}`;
    const base = {
      projectRoot: `/tmp/${key}`,
      runId: 'run-1',
      idPrefix: 'ADR',
      idWidth: 4,
      count: 1,
      roots: [],
      target: NO_NUMBERS,
    };
    // Step A reserves first, before any lane exists for it (no `lanePath`): pending.
    const stepA = await reserveIds({ ...base, stepId: 'wf:a' });
    expect(stepA.ids).toEqual(['ADR-0001']);
    // Step B reserves next, in the SAME (project, run, idPrefix) id space, also before any lane. If a
    // pending reservation were pruned by liveness (no lane path to check, so a naive implementation would
    // either crash or read it as dead), step B would collide with step A's own still-live reservation.
    const stepB = await reserveIds({ ...base, stepId: 'wf:b' });
    expect(stepB.ids).toEqual(['ADR-0002']);
  });

  it('a bound reservation lapses once its lane worktree is removed from disk', async () => {
    const key = `lapse-${Math.random().toString(36).slice(2)}`;
    const laneDir = await mkdtemp(path.join(tmpdir(), 'forge-output-ids-lane-'));
    const base = {
      projectRoot: `/tmp/${key}`,
      runId: 'run-1',
      idPrefix: 'ADR',
      idWidth: 4,
      count: 1,
      roots: [],
      target: NO_NUMBERS,
    };
    const first = await reserveIds({ ...base, stepId: 'wf:a', lanePath: laneDir });
    expect(first.ids).toEqual(['ADR-0001']);
    // The lane is still on disk: a sibling reservation in the same id space must not reuse its number.
    const whileAlive = await reserveIds({ ...base, stepId: 'wf:b' });
    expect(whileAlive.ids).toEqual(['ADR-0002']);
    whileAlive.release(); // the sibling ends without ever getting a lane -- isolates the case under test.
    await rm(laneDir, { recursive: true, force: true });
    // Once the lane worktree is gone, its reservation is forgotten: a fresh reservation gets ADR-0001 back
    // (nothing else in this id space is live).
    const afterRemoval = await reserveIds({ ...base, stepId: 'wf:c' });
    expect(afterRemoval.ids).toEqual(['ADR-0001']);
  });

  it('explicitly binding a pending reservation makes it subject to the same lane-liveness rule', async () => {
    const key = `bind-${Math.random().toString(36).slice(2)}`;
    const laneDir = await mkdtemp(path.join(tmpdir(), 'forge-output-ids-bind-'));
    const base = {
      projectRoot: `/tmp/${key}`,
      runId: 'run-1',
      idPrefix: 'ADR',
      idWidth: 4,
      count: 1,
      roots: [],
      target: NO_NUMBERS,
    };
    const pending = await reserveIds({ ...base, stepId: 'wf:a' });
    pending.bind(laneDir);
    await rm(laneDir, { recursive: true, force: true });
    const after = await reserveIds({ ...base, stepId: 'wf:b' });
    // The bound-then-removed lane's reservation is gone: the next one starts back at 0001.
    expect(after.ids).toEqual(['ADR-0001']);
  });

  it('refuses with a typed RUN-109 before exhausting the id width, naming the prefix and width', async () => {
    const key = `exhausted-${Math.random().toString(36).slice(2)}`;
    await expect(
      reserveIds({
        projectRoot: `/tmp/${key}`,
        runId: 'run-1',
        stepId: 'wf:step',
        idPrefix: 'ADR',
        idWidth: 1,
        count: 1,
        roots: ['saturated'],
        target: fixedScanTarget({ saturated: [9] }),
      }),
    ).rejects.toSatisfy((cause: unknown) => {
      expect(isForgeError(cause)).toBe(true);
      expect(cause).toBeInstanceOf(ForgeError);
      expect((cause as ForgeError).code).toBe('RUN-109');
      expect((cause as ForgeError).message).toContain('ADR-N');
      expect((cause as ForgeError).details).toMatchObject({
        stepId: 'wf:step',
        idPrefix: 'ADR',
        idWidth: 1,
      });
      return true;
    });
  });

  it('a block reservation that would spill past the id width is refused entirely, not partially granted', async () => {
    const key = `block-exhausted-${Math.random().toString(36).slice(2)}`;
    await expect(
      reserveIds({
        projectRoot: `/tmp/${key}`,
        runId: 'run-1',
        stepId: 'wf:step',
        idPrefix: 'ADR',
        idWidth: 1,
        count: 25,
        roots: [],
        target: NO_NUMBERS,
      }),
    ).rejects.toThrow(/all 9 ADR-N numbers are in use/);
  });

  it('independent id spaces (different idPrefix) never wait on or collide with each other', async () => {
    const key = `independent-${Math.random().toString(36).slice(2)}`;
    const [adr, runbook] = await Promise.all([
      reserveIds({
        projectRoot: `/tmp/${key}`,
        runId: 'run-1',
        stepId: 'wf:step',
        idPrefix: 'ADR',
        idWidth: 4,
        count: 1,
        roots: [],
        target: NO_NUMBERS,
      }),
      reserveIds({
        projectRoot: `/tmp/${key}`,
        runId: 'run-1',
        stepId: 'wf:step',
        idPrefix: 'RUN',
        idWidth: 3,
        count: 1,
        roots: [],
        target: NO_NUMBERS,
      }),
    ]);
    expect(adr.ids).toEqual(['ADR-0001']);
    expect(runbook.ids).toEqual(['RUN-001']);
  });
});

describe('directoryIdScan', () => {
  it('finds the highest id among per-file entries directly under the directory', async () => {
    const root = await createTempRepo('dir-scan');
    const dir = path.join(root, 'docs/forge/kb/decisions');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'ADR-0003-first.md'), '---\nid: ADR-0003\n---\nx\n');
    await writeFile(path.join(dir, 'ADR-0007-second.md'), '---\nid: ADR-0007\n---\nx\n');
    await writeFile(path.join(dir, 'not-an-adr.md'), 'x\n');
    const numbers = await directoryIdScan('docs/forge/kb/decisions', 'ADR', 4).numbersIn(root);
    expect([...numbers].sort((a, b) => a - b)).toEqual([3, 7]);
  });

  it('a root with no such directory (or an absent one) claims nothing', async () => {
    const root = await createTempRepo('dir-scan-absent');
    const numbers = await directoryIdScan('docs/forge/kb/decisions', 'ADR', 4).numbersIn(root);
    expect(numbers).toEqual([]);
  });

  it('a symlinked docs directory is skipped, not followed -- it cannot be made to read outside the tree', async () => {
    const root = await createTempRepo('dir-scan-symlink');
    const outside = await mkdtemp(path.join(tmpdir(), 'forge-output-ids-outside-'));
    await writeFile(path.join(outside, 'ADR-0099-elsewhere.md'), '---\nid: ADR-0099\n---\nx\n');
    await mkdir(path.join(root, 'docs/forge/kb'), { recursive: true });
    await symlink(outside, path.join(root, 'docs/forge/kb/decisions'), 'dir');
    const numbers = await directoryIdScan('docs/forge/kb/decisions', 'ADR', 4).numbersIn(root);
    expect(numbers).toEqual([]);
  });
});

describe('registerIdScan', () => {
  it('finds every entry id inside the single shared register file', async () => {
    const root = await createTempRepo('register-scan');
    await mkdir(path.join(root, 'docs/forge/kb'), { recursive: true });
    await writeFile(
      path.join(root, 'docs/forge/kb/risks.md'),
      RISKS(
        [
          '  - id: RISK-001',
          '    statement: a',
          '    likelihood: low',
          '    impact: low',
          '    mitigation: m',
          '    owner: architect',
          '  - id: RISK-004',
          '    statement: b',
          '    likelihood: low',
          '    impact: low',
          '    mitigation: m',
          '    owner: architect',
        ].join('\n'),
      ),
    );
    const numbers = await registerIdScan('docs/forge/kb/risks.md', 'RISK', 3).numbersIn(root);
    expect([...numbers].sort((a, b) => a - b)).toEqual([1, 4]);
  });

  it('counted across trees: the highest across every root, not just one', async () => {
    const rootA = await createTempRepo('register-scan-a');
    const rootB = await createTempRepo('register-scan-b');
    await mkdir(path.join(rootA, 'docs/forge/kb'), { recursive: true });
    await mkdir(path.join(rootB, 'docs/forge/kb'), { recursive: true });
    await writeFile(
      path.join(rootA, 'docs/forge/kb/risks.md'),
      RISKS(
        '  - id: RISK-002\n    statement: a\n    likelihood: low\n    impact: low\n    mitigation: m\n    owner: architect',
      ),
    );
    await writeFile(
      path.join(rootB, 'docs/forge/kb/risks.md'),
      RISKS(
        '  - id: RISK-009\n    statement: a\n    likelihood: low\n    impact: low\n    mitigation: m\n    owner: architect',
      ),
    );
    const target = registerIdScan('docs/forge/kb/risks.md', 'RISK', 3);
    const numbers = [...(await target.numbersIn(rootA)), ...(await target.numbersIn(rootB))];
    expect(Math.max(...numbers)).toBe(9);
  });

  it('a root with no register file claims nothing', async () => {
    const root = await createTempRepo('register-scan-absent');
    const numbers = await registerIdScan('docs/forge/kb/risks.md', 'RISK', 3).numbersIn(root);
    expect(numbers).toEqual([]);
  });

  it('a symlinked register file is skipped, not followed', async () => {
    const root = await createTempRepo('register-scan-symlink');
    const outside = await mkdtemp(path.join(tmpdir(), 'forge-output-ids-outside-reg-'));
    await writeFile(
      path.join(outside, 'risks.md'),
      RISKS(
        '  - id: RISK-099\n    statement: a\n    likelihood: low\n    impact: low\n    mitigation: m\n    owner: architect',
      ),
    );
    await mkdir(path.join(root, 'docs/forge/kb'), { recursive: true });
    await symlink(
      path.join(outside, 'risks.md'),
      path.join(root, 'docs/forge/kb/risks.md'),
      'file',
    );
    const numbers = await registerIdScan('docs/forge/kb/risks.md', 'RISK', 3).numbersIn(root);
    expect(numbers).toEqual([]);
  });
});

describe('reserveDeclaredKbOutputIds', () => {
  function adrNode(overrides: Record<string, unknown> = {}) {
    return node({
      id: 'wf:write-adr',
      kind: 'agent',
      agent: toAgentId('architect'),
      outputs: [{ type: 'ADR' }],
      ...overrides,
    });
  }

  it('reserves one id above the highest ADR visible in the project root for a `cardinality: one` output', async () => {
    const projectRoot = await createTempRepo('kb-adr-one');
    const dir = path.join(projectRoot, 'docs/forge/kb/decisions');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'ADR-0006-x.md'), '---\nid: ADR-0006\n---\nx\n');
    const ctx = createTestContext({ projectRoot, runId: 'run-1' });
    const reservation = await reserveDeclaredKbOutputIds(adrNode(), ctx);
    expect(reservation?.idsByType.get('ADR')).toEqual(['ADR-0007']);
  });

  it('reserves a 25-id block for a `cardinality: many` output', async () => {
    const projectRoot = await createTempRepo('kb-adr-many');
    const ctx = createTestContext({ projectRoot, runId: 'run-1' });
    const reservation = await reserveDeclaredKbOutputIds(
      adrNode({ outputs: [{ type: 'ADR', cardinality: 'many' }] }),
      ctx,
    );
    const ids = reservation?.idsByType.get('ADR');
    expect(ids).toHaveLength(25);
    expect(ids?.[0]).toBe('ADR-0001');
    expect(ids?.[24]).toBe('ADR-0025');
  });

  it('a step declaring the same type twice reserves it once, `many` if either entry says so', async () => {
    const projectRoot = await createTempRepo('kb-adr-dup');
    const ctx = createTestContext({ projectRoot, runId: 'run-1' });
    const reservation = await reserveDeclaredKbOutputIds(
      adrNode({
        outputs: [
          { type: 'ADR', cardinality: 'one' },
          { type: 'ADR', cardinality: 'many' },
        ],
      }),
      ctx,
    );
    expect(reservation?.idsByType.get('ADR')).toHaveLength(25);
  });

  it('a non-KB declared output (its registry pathTemplate does not start kb/) gets no reservation', async () => {
    const projectRoot = await createTempRepo('kb-non-kb');
    const ctx = createTestContext({ projectRoot, runId: 'run-1' });
    const reservation = await reserveDeclaredKbOutputIds(
      adrNode({ outputs: [{ type: 'SessionRecord' }] }),
      ctx,
    );
    expect(reservation).toBeUndefined();
  });

  it('a step declaring no outputs at all gets no reservation (undefined, not an empty map)', async () => {
    const projectRoot = await createTempRepo('kb-none');
    const ctx = createTestContext({ projectRoot, runId: 'run-1' });
    const reservation = await reserveDeclaredKbOutputIds(adrNode({ outputs: [] }), ctx);
    expect(reservation).toBeUndefined();
  });

  it('reserves above the highest entry in a register-type register file (Risk)', async () => {
    const projectRoot = await createTempRepo('kb-risk');
    await mkdir(path.join(projectRoot, 'docs/forge/kb'), { recursive: true });
    await writeFile(
      path.join(projectRoot, 'docs/forge/kb/risks.md'),
      RISKS(
        '  - id: RISK-002\n    statement: a\n    likelihood: low\n    impact: low\n    mitigation: m\n    owner: architect',
      ),
    );
    const ctx = createTestContext({ projectRoot, runId: 'run-1' });
    const reservation = await reserveDeclaredKbOutputIds(
      node({
        id: 'wf:write-risk',
        kind: 'agent',
        agent: toAgentId('architect'),
        outputs: [{ type: 'Risk' }],
      }),
      ctx,
    );
    expect(reservation?.idsByType.get('Risk')).toEqual(['RISK-003']);
  });

  // Each of the next four cases plants the HIGHEST id in exactly one scanned location, with the other
  // three left empty -- so, unlike a single test that plants numbers everywhere at once, dropping any
  // ONE location from the scan changes THAT case's own expected id (proven directly, not by inference).
  it('the project root alone can hold the highest id', async () => {
    const projectRoot = await createTempRepo('kb-scope-root-only');
    const integrationPath = await createTempRepo('kb-scope-root-only-integration');
    const decisions = path.join(projectRoot, 'docs/forge/kb/decisions');
    await mkdir(decisions, { recursive: true });
    await writeFile(path.join(decisions, 'ADR-0009-x.md'), '---\nid: ADR-0009\n---\nx\n');
    const ctx = createTestContext({ projectRoot, runId: 'run-1', integrationPath });
    const reservation = await reserveDeclaredKbOutputIds(adrNode(), ctx);
    expect(reservation?.idsByType.get('ADR')).toEqual(['ADR-0010']);
  });

  it('the integration worktree alone can hold the highest id', async () => {
    const projectRoot = await createTempRepo('kb-scope-integration-only-root');
    const integrationPath = await createTempRepo('kb-scope-integration-only');
    const decisions = path.join(integrationPath, 'docs/forge/kb/decisions');
    await mkdir(decisions, { recursive: true });
    await writeFile(path.join(decisions, 'ADR-0009-x.md'), '---\nid: ADR-0009\n---\nx\n');
    const ctx = createTestContext({ projectRoot, runId: 'run-1', integrationPath });
    const reservation = await reserveDeclaredKbOutputIds(adrNode(), ctx);
    expect(reservation?.idsByType.get('ADR')).toEqual(['ADR-0010']);
  });

  it('a ready sibling lane (ctx.laneRegistry) alone can hold the highest id', async () => {
    const projectRoot = await createTempRepo('kb-scope-sibling-only-root');
    const integrationPath = await createTempRepo('kb-scope-sibling-only-integration');
    const siblingLane = await createTempRepo('kb-scope-sibling-only');
    const decisions = path.join(siblingLane, 'docs/forge/kb/decisions');
    await mkdir(decisions, { recursive: true });
    await writeFile(path.join(decisions, 'ADR-0009-x.md'), '---\nid: ADR-0009\n---\nx\n');
    const laneRegistry = new Map([
      ['wf:other-step', { laneId: 'lane-1', path: siblingLane, branch: 'forge/run-1/other' }],
    ]);
    const ctx = createTestContext({ projectRoot, runId: 'run-1', integrationPath, laneRegistry });
    const reservation = await reserveDeclaredKbOutputIds(adrNode(), ctx);
    expect(reservation?.idsByType.get('ADR')).toEqual(['ADR-0010']);
  });

  it("also scans the step's own existing lane when one is passed (the crash-resume reroll case)", async () => {
    const projectRoot = await createTempRepo('kb-existing-lane');
    const existingLane = await createTempRepo('kb-existing-lane-worktree');
    const decisions = path.join(existingLane, 'docs/forge/kb/decisions');
    await mkdir(decisions, { recursive: true });
    await writeFile(path.join(decisions, 'ADR-0004-x.md'), '---\nid: ADR-0004\n---\nx\n');
    const ctx = createTestContext({ projectRoot, runId: 'run-1' });
    const reservation = await reserveDeclaredKbOutputIds(adrNode(), ctx, existingLane);
    expect(reservation?.idsByType.get('ADR')).toEqual(['ADR-0005']);
  });

  it('an existing-lane reservation is already lane-bound: it lapses once that lane is removed', async () => {
    const projectRoot = await createTempRepo('kb-existing-lane-lapse');
    const existingLane = await createTempRepo('kb-existing-lane-lapse-worktree');
    const ctx = createTestContext({ projectRoot, runId: 'run-1' });
    const first = await reserveDeclaredKbOutputIds(adrNode({ id: 'wf:a' }), ctx, existingLane);
    expect(first?.idsByType.get('ADR')).toEqual(['ADR-0001']);
    await rm(existingLane, { recursive: true, force: true });
    const second = await reserveDeclaredKbOutputIds(adrNode({ id: 'wf:b' }), ctx);
    expect(second?.idsByType.get('ADR')).toEqual(['ADR-0001']);
  });

  it('a discarded attempt released before ever getting a lane frees its base for the retry', async () => {
    const projectRoot = await createTempRepo('kb-discard');
    const ctx = createTestContext({ projectRoot, runId: 'run-1' });
    const first = await reserveDeclaredKbOutputIds(adrNode(), ctx);
    expect(first?.idsByType.get('ADR')).toEqual(['ADR-0001']);
    first?.release();
    const second = await reserveDeclaredKbOutputIds(adrNode(), ctx);
    expect(second?.idsByType.get('ADR')).toEqual(['ADR-0001']);
  });

  it("refuses with a typed RUN-109 before any lane exists when a register type's numeric space is exhausted", async () => {
    const projectRoot = await createTempRepo('kb-risk-exhausted');
    await mkdir(path.join(projectRoot, 'docs/forge/kb'), { recursive: true });
    const entries = Array.from(
      { length: 999 },
      (_, index) =>
        `  - id: RISK-${String(index + 1).padStart(3, '0')}\n    statement: a\n    likelihood: low\n    impact: low\n    mitigation: m\n    owner: architect`,
    ).join('\n');
    await writeFile(path.join(projectRoot, 'docs/forge/kb/risks.md'), RISKS(entries));
    const ctx = createTestContext({ projectRoot, runId: 'run-1' });
    await expect(
      reserveDeclaredKbOutputIds(
        node({
          id: 'wf:write-risk',
          kind: 'agent',
          agent: toAgentId('architect'),
          outputs: [{ type: 'Risk' }],
        }),
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'RUN-109' });
  });

  it('when one of several declared KB outputs exhausts, every reservation this call already made is released', async () => {
    const projectRoot = await createTempRepo('kb-partial-release');
    const ctx = createTestContext({ projectRoot, runId: 'run-1' });
    const decisions = path.join(projectRoot, 'docs/forge/kb/decisions');
    await mkdir(decisions, { recursive: true });
    // ADR reserves fine (ADR-0001); Runbook's own numeric space is exhausted at width 3.
    const runbooksDir = path.join(projectRoot, 'docs/forge/kb/ops/runbooks');
    await mkdir(runbooksDir, { recursive: true });
    await writeFile(path.join(runbooksDir, 'RUN-999-x.md'), '---\nid: RUN-999\n---\nx\n');
    const failing = node({
      id: 'wf:write-both',
      kind: 'agent',
      agent: toAgentId('architect'),
      outputs: [{ type: 'ADR' }, { type: 'Runbook' }],
    });
    await expect(reserveDeclaredKbOutputIds(failing, ctx)).rejects.toMatchObject({
      code: 'RUN-109',
    });
    // ADR's own reservation from the failed call must have been released: a fresh, ADR-only step gets
    // ADR-0001 back, not ADR-0002.
    const after = await reserveDeclaredKbOutputIds(adrNode({ id: 'wf:after' }), ctx);
    expect(after?.idsByType.get('ADR')).toEqual(['ADR-0001']);
  });
});
