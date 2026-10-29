/**
 * `loadDisclosures`/`appendDisclosure`/`resolveDisclosure`/`listDisclosureLedger` — `specs/22` M15
 * P10, against a real, throwaway project directory.
 *
 * @see specs/22 M15 P10
 * @see PLAN-M15.md P10
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ProjectPaths, type Clock } from '@forge/core';
import { pathExists } from '@forge/core/fs';
import { disclosuresFileSchema } from '@forge/schemas';
import { appendEvent } from '@forge/telemetry/events';
import { afterEach, describe, expect, it } from 'vitest';
import * as YAML from 'yaml';

import { appendExemption } from '../../src/commands/loop/test/exemptions.ts';
import {
  appendDisclosure,
  loadDisclosures,
  listDisclosureLedger,
  resolveDisclosure,
} from '../../src/commands/kb-disclosures.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function freshProject(): Promise<ProjectPaths> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-disclosures-'));
  dirs.push(dir);
  return new ProjectPaths(dir);
}

function fakeClock(now = '2026-09-30T12:00:00.000Z'): Clock {
  return { now: () => now };
}

describe('loadDisclosures', () => {
  it('reads [] for a project that has never recorded a disclosure', async () => {
    const paths = await freshProject();
    expect((await loadDisclosures(paths, 'kb')).disclosures).toEqual([]);
  });

  it('reads back exactly what appendDisclosure wrote', async () => {
    const paths = await freshProject();
    await appendDisclosure(paths, 'kb', fakeClock(), {
      kind: 'trade-off',
      summary: 'coverage is project-wide, not scoped to the story the bundle is for',
      owner: 'architect',
      sources: [{ kind: 'decision', ref: 'ADR-0011' }],
    });

    const { disclosures } = await loadDisclosures(paths, 'kb');

    expect(disclosures).toHaveLength(1);
    expect(disclosures[0]).toMatchObject({
      kind: 'trade-off',
      summary: 'coverage is project-wide, not scoped to the story the bundle is for',
      owner: 'architect',
      resolved: false,
    });
    expect(disclosures[0]?.id).toMatch(/^DISC-\d{3}$/);
  });
});

describe('appendDisclosure', () => {
  it('allocates sequential ids scoped to the collection file, not the shared project IdAllocator', async () => {
    const paths = await freshProject();
    const first = await appendDisclosure(paths, 'kb', fakeClock(), {
      kind: 'known-gap',
      summary: 'a',
      owner: 'alice',
      sources: [{ kind: 'human', ref: 'elicitation 2026-01-05' }],
    });
    const second = await appendDisclosure(paths, 'kb', fakeClock(), {
      kind: 'known-gap',
      summary: 'b',
      owner: 'alice',
      sources: [{ kind: 'human', ref: 'elicitation 2026-01-05' }],
    });
    expect(first).toBe('DISC-001');
    expect(second).toBe('DISC-002');
  });
});

describe('resolveDisclosure — append-only (mutation evidence: allowing deletion must fail this test)', () => {
  it('marks the entry resolved in place; the array never shrinks and the other entry is untouched', async () => {
    const paths = await freshProject();
    await appendDisclosure(paths, 'kb', fakeClock(), {
      kind: 'trade-off',
      summary: 'first',
      owner: 'alice',
      sources: [{ kind: 'human', ref: 'x' }],
    });
    await appendDisclosure(paths, 'kb', fakeClock(), {
      kind: 'known-gap',
      summary: 'second',
      owner: 'bob',
      sources: [{ kind: 'human', ref: 'y' }],
    });
    const { disclosures: before } = await loadDisclosures(paths, 'kb');
    expect(before).toHaveLength(2);

    await resolveDisclosure(paths, 'kb', fakeClock(), {
      id: 'DISC-001',
      reason: 'scoped the AC coverage check to the story',
      by: 'architect',
    });

    const { disclosures: after } = await loadDisclosures(paths, 'kb');
    // The real, load-bearing assertion: resolving never removes an entry. A version of
    // `resolveDisclosure` that filtered instead of mapped would shrink this array to 1.
    expect(after).toHaveLength(2);
    expect(after.find((d) => d.id === 'DISC-001')).toMatchObject({
      resolved: true,
      resolution: { reason: 'scoped the AC coverage check to the story', by: 'architect' },
    });
    // The untouched sibling entry survives byte-for-byte, not merely "some entry with id DISC-002".
    expect(after.find((d) => d.id === 'DISC-002')).toMatchObject({
      resolved: false,
      summary: 'second',
      owner: 'bob',
    });
  });

  it('refuses (KB-018 not-found) resolving an id nothing in the ledger has', async () => {
    const paths = await freshProject();
    await expect(
      resolveDisclosure(paths, 'kb', fakeClock(), { id: 'DISC-999', reason: 'r', by: 'a' }),
    ).rejects.toMatchObject({ code: 'KB-018', details: { reason: 'not-found' } });
  });

  it('refuses (KB-018 already-resolved) resolving the same disclosure twice -- a resolution is a one-way door', async () => {
    const paths = await freshProject();
    await appendDisclosure(paths, 'kb', fakeClock(), {
      kind: 'trade-off',
      summary: 'x',
      owner: 'alice',
      sources: [{ kind: 'human', ref: 'x' }],
    });
    await resolveDisclosure(paths, 'kb', fakeClock(), {
      id: 'DISC-001',
      reason: 'r1',
      by: 'alice',
    });
    await expect(
      resolveDisclosure(paths, 'kb', fakeClock(), { id: 'DISC-001', reason: 'r2', by: 'bob' }),
    ).rejects.toMatchObject({ code: 'KB-018', details: { reason: 'already-resolved' } });
    // The FIRST resolution's own reason/owner survive -- the refused second call wrote nothing.
    const { disclosures: after } = await loadDisclosures(paths, 'kb');
    expect(after[0]?.resolution).toMatchObject({ reason: 'r1', by: 'alice' });
  });
});

/** Hand-writes a `kb/disclosures.md` whose own `disclosures` array has one real, valid row and one
 * schema-invalid row (missing `owner`, a required field) -- simulating a hand-edit, a partial edit, or a
 * future schema migration with no matching data migration, none of which a real `appendDisclosure` call
 * could ever produce on its own. */
async function writeCorruptDisclosuresFile(paths: ProjectPaths): Promise<void> {
  const text = [
    '---',
    'type: Disclosure',
    'schemaVersion: 1',
    'title: Disclosure register',
    'status: active',
    'created: 2026-09-30',
    'updated: 2026-09-30',
    'revision: 1',
    'author: alice',
    'changelog:',
    '  - revision: 1',
    '    date: 2026-09-30',
    '    by: alice',
    '    summary: seeded for a corruption test',
    'disclosures:',
    '  - id: DISC-001',
    '    kind: trade-off',
    '    summary: a real, valid, unresolved disclosure',
    '    owner: alice',
    '    sources:',
    '      - kind: human',
    '        ref: x',
    '    resolved: false',
    '  - id: DISC-002',
    '    kind: known-gap',
    '    summary: missing its own required owner field',
    '    sources:',
    '      - kind: human',
    '        ref: y',
    '    resolved: false',
    '---',
    '',
  ].join('\n');
  await writeFile(paths.resolveWithin('kb/disclosures.md'), text, 'utf8');
}

describe('a corrupt kb/disclosures.md (one valid row, one schema-invalid row)', () => {
  it('loadDisclosures reads the valid row and reports the corrupt one, never silently returning [] for the whole file', async () => {
    const paths = await freshProject();
    await mkdir(paths.resolveWithin('kb'), { recursive: true });
    await writeCorruptDisclosuresFile(paths);

    const { disclosures, corruptCount } = await loadDisclosures(paths, 'kb');

    expect(disclosures).toHaveLength(1);
    expect(disclosures[0]?.id).toBe('DISC-001');
    expect(corruptCount).toBe(1);
  });

  it('appendDisclosure REFUSES (KB-018 corrupt) rather than silently dropping the bad row on the next write', async () => {
    const paths = await freshProject();
    await mkdir(paths.resolveWithin('kb'), { recursive: true });
    await writeCorruptDisclosuresFile(paths);

    await expect(
      appendDisclosure(paths, 'kb', fakeClock(), {
        kind: 'trade-off',
        summary: 'a third disclosure',
        owner: 'bob',
        sources: [{ kind: 'human', ref: 'z' }],
      }),
    ).rejects.toMatchObject({ code: 'KB-018', details: { id: 'DISC-002', reason: 'corrupt' } });

    // Mutation evidence: the bad row must still be sitting in the file afterward, byte-for-byte --
    // an earlier version of this write path would have silently dropped it right here instead of
    // refusing. Read the raw file directly (not through loadDisclosures, which is lenient by design)
    // to prove nothing was rewritten at all.
    const { readFile } = await import('node:fs/promises');
    const stillThere = await readFile(paths.resolveWithin('kb/disclosures.md'), 'utf8');
    expect(stillThere).toContain('DISC-002');
    expect(stillThere).not.toContain('a third disclosure');
  });

  it('resolveDisclosure also REFUSES (KB-018 corrupt) rather than silently dropping the bad row', async () => {
    const paths = await freshProject();
    await mkdir(paths.resolveWithin('kb'), { recursive: true });
    await writeCorruptDisclosuresFile(paths);

    await expect(
      resolveDisclosure(paths, 'kb', fakeClock(), { id: 'DISC-001', reason: 'r', by: 'alice' }),
    ).rejects.toMatchObject({ code: 'KB-018', details: { id: 'DISC-002', reason: 'corrupt' } });
  });
});

describe("nextDisclosureId — id-exhausted ceiling (specs/22 M15 P10, mirrors nextExemptionId's own GATE-515 id-exhausted test)", () => {
  it('refuses once idWidth digits are full (KB-018 id-exhausted), rather than silently wrapping or colliding', async () => {
    // Seeds 999 entries by writing the fixture directly (not via 999 real appendDisclosure calls,
    // each its own lock-acquire + full read-modify-write -- correct but needlessly slow for a fixture
    // this function's own real work never has to build) -- only the real 1000th call under test goes
    // through appendDisclosure itself.
    const paths = await freshProject();
    await mkdir(paths.resolveWithin('kb'), { recursive: true });
    const disclosures = Array.from({ length: 999 }, (_unused, index) => ({
      id: `DISC-${String(index + 1).padStart(3, '0')}`,
      kind: 'known-gap' as const,
      summary: 'r',
      owner: 'alice',
      sources: [{ kind: 'human' as const, ref: 'x' }],
      resolved: false,
    }));
    const seed = {
      type: 'Disclosure' as const,
      schemaVersion: 1,
      title: 'Disclosure register',
      status: 'active',
      created: '2026-09-30',
      updated: '2026-09-30',
      revision: 1,
      author: 'alice',
      changelog: [],
      disclosures,
    };
    expect(disclosuresFileSchema.safeParse(seed).success).toBe(true);
    await writeFile(
      paths.resolveWithin('kb/disclosures.md'),
      `---\n${YAML.stringify(seed)}---\n`,
      'utf8',
    );
    expect((await loadDisclosures(paths, 'kb')).disclosures).toHaveLength(999);

    await expect(
      appendDisclosure(paths, 'kb', fakeClock(), {
        kind: 'known-gap',
        summary: 'the 1000th disclosure',
        owner: 'alice',
        sources: [{ kind: 'human', ref: 'x' }],
      }),
    ).rejects.toMatchObject({ code: 'KB-018', details: { reason: 'id-exhausted' } });

    // Refused, not a corrupting partial write: the 999 already-recorded entries are untouched.
    expect((await loadDisclosures(paths, 'kb')).disclosures).toHaveLength(999);
  });
});

describe('readDisclosuresCandidate — a corrupt row with no readable id of its own', () => {
  it('names the row by its index (KB-018 corrupt), when the corrupt row itself has no string id to name', async () => {
    const paths = await freshProject();
    await mkdir(paths.resolveWithin('kb'), { recursive: true });
    // The second row has no `id` field at all -- a hand-edit or partial migration this strict, no
    // less genuine than writeCorruptDisclosuresFile's own missing-`owner` row above, just missing a
    // different required field. Index 1 (0-indexed, second row), not DISC-002: there is no id on this
    // row at all for the error to name.
    const text = [
      '---',
      'type: Disclosure',
      'schemaVersion: 1',
      'title: Disclosure register',
      'status: active',
      'created: 2026-09-30',
      'updated: 2026-09-30',
      'revision: 1',
      'author: alice',
      'changelog:',
      '  - revision: 1',
      '    date: 2026-09-30',
      '    by: alice',
      '    summary: seeded for a corruption test',
      'disclosures:',
      '  - id: DISC-001',
      '    kind: trade-off',
      '    summary: a real, valid, unresolved disclosure',
      '    owner: alice',
      '    sources:',
      '      - kind: human',
      '        ref: x',
      '    resolved: false',
      '  - kind: known-gap',
      '    summary: no id field at all -- the index-based fallback must name this row',
      '    owner: bob',
      '    sources:',
      '      - kind: human',
      '        ref: y',
      '    resolved: false',
      '---',
      '',
    ].join('\n');
    await writeFile(paths.resolveWithin('kb/disclosures.md'), text, 'utf8');

    await expect(
      appendDisclosure(paths, 'kb', fakeClock(), {
        kind: 'trade-off',
        summary: 'a third disclosure',
        owner: 'carol',
        sources: [{ kind: 'human', ref: 'z' }],
      }),
    ).rejects.toMatchObject({ code: 'KB-018', details: { id: 'index 1', reason: 'corrupt' } });
  });
});

describe('writeDisclosuresCandidate — write-time schema-reject paranoia check', () => {
  it('throws when the write candidate itself would be schema-invalid, even though no on-disk row is corrupt', async () => {
    // AppendDisclosureInput's own type never enforces `owner`'s min(1) at the call boundary (it is a
    // plain `string`, not a runtime-checked one) -- an empty owner sails through `readDisclosuresCandidate`
    // (nothing on disk is corrupt; this is a brand-new project) and only the final, write-time
    // `disclosuresFileSchema.safeParse` right before the real `writeFileAtomic` commit catches it. This is
    // exactly the paranoia check's own job: proving the whole candidate document is still schema-valid
    // immediately before it is durably written, not trusting every caller to have validated its own input.
    const paths = await freshProject();
    const attempt = appendDisclosure(paths, 'kb', fakeClock(), {
      kind: 'trade-off',
      summary: 'x',
      owner: '',
      sources: [{ kind: 'human', ref: 'x' }],
    });
    await expect(attempt).rejects.toThrow(RangeError);
    await expect(attempt).rejects.toThrow(/disclosuresFileSchema rejected a disclosures\.md write/);

    // Refused outright: nothing was ever written -- not even a partial file.
    expect(await pathExists(paths.resolveWithin('kb/disclosures.md'))).toBe(false);
  });
});

describe('listDisclosureLedger — an exemption (P6) and a stopped critic loop (P9) each appear automatically', () => {
  it('a real, currently-in-force exemption (reports/exemptions.md) appears as an open, synthesized row, with no Disclosure document written for it', async () => {
    const paths = await freshProject();
    await appendExemption(
      paths,
      'docs/forge/reports',
      fakeClock(),
      {
        testId: 'STORY-001: timing-guard',
        reason: 'a real wall-clock timing guard, never mutation-bindable',
        owner: 'alice',
        expiry: '2026-12-01',
      },
      { projectRoot: paths.resolveWithin('.'), runId: undefined },
    );

    const ledger = await listDisclosureLedger({
      paths,
      projectRoot: paths.resolveWithin('.'),
      kbRoot: 'kb',
      reportsRoot: 'docs/forge/reports',
      now: new Date('2026-09-30T00:00:00.000Z'),
    });

    const exemptionRow = ledger.entries.find((entry) => entry.kind === 'exemption');
    expect(exemptionRow).toMatchObject({ open: true, synthesized: true, owner: 'alice' });
    // Mutation evidence (the Mandate's own line): drop the automatic P6 write path and this test's own
    // appendExemption call above writes nothing to exemptions.md -- the exemption-appears assertion
    // above would then find no such row at all, proving this surfacing genuinely depends on P6's own
    // real write, not a hand-rolled stand-in this test could trivially satisfy on its own.
    expect((await loadDisclosures(paths, 'kb')).disclosures).toEqual([]);
  });

  it('an EXPIRED exemption no longer appears as open', async () => {
    const paths = await freshProject();
    await appendExemption(
      paths,
      'docs/forge/reports',
      fakeClock(),
      { testId: 'STORY-001: timing-guard', reason: 'r', owner: 'alice', expiry: '2026-01-01' },
      { projectRoot: paths.resolveWithin('.'), runId: undefined },
    );
    const ledger = await listDisclosureLedger({
      paths,
      projectRoot: paths.resolveWithin('.'),
      kbRoot: 'kb',
      reportsRoot: 'docs/forge/reports',
      now: new Date('2026-09-30T00:00:00.000Z'),
    });
    const exemptionRow = ledger.entries.find((entry) => entry.kind === 'exemption');
    expect(exemptionRow?.open).toBe(false);
  });

  it('a genuinely-exhausted RUN-113 StepFailed event (P9) appears as an open, synthesized row', async () => {
    const paths = await freshProject();
    const projectRoot = paths.resolveWithin('.');
    const { ForgeError } = await import('@forge/core/errors');
    const cause = new ForgeError('RUN-113', {
      stepId: 'wf:review',
      file: 'docs/forge/reports/reviews/REVIEW-001.md',
      rounds: 3,
      count: 1,
    });
    await appendEvent(projectRoot, 'run-001', {
      runId: 'run-001',
      ts: '2026-09-30T00:00:00.000Z',
      type: 'StepFailed',
      stepId: 'wf:review',
      payload: { source: 'output', code: 'RUN-113', message: cause.message, cause },
    });

    const ledger = await listDisclosureLedger({
      paths,
      projectRoot,
      kbRoot: 'kb',
      reportsRoot: 'docs/forge/reports',
      now: new Date('2026-09-30T00:00:00.000Z'),
    });

    const criticRow = ledger.entries.find((entry) => entry.kind === 'stopped-critic-loop');
    expect(criticRow).toMatchObject({ open: true, synthesized: true });
    expect(criticRow?.summary).toContain('3 round');
    expect(criticRow?.summary).toContain('1 blocking');
  });

  it('a StepFailed event for an ORDINARY failure (not RUN-113) never appears in the ledger', async () => {
    const paths = await freshProject();
    const projectRoot = paths.resolveWithin('.');
    await appendEvent(projectRoot, 'run-001', {
      runId: 'run-001',
      ts: '2026-09-30T00:00:00.000Z',
      type: 'StepFailed',
      stepId: 'wf:review',
      payload: {
        source: 'output',
        code: 'RUN-108',
        message: 'ordinary blocked verdict, never looped',
      },
    });
    const ledger = await listDisclosureLedger({
      paths,
      projectRoot,
      kbRoot: 'kb',
      reportsRoot: 'docs/forge/reports',
      now: new Date('2026-09-30T00:00:00.000Z'),
    });
    expect(ledger.entries.find((entry) => entry.kind === 'stopped-critic-loop')).toBeUndefined();
  });

  it('a real, explicitly-authored Disclosure and both synthesized kinds all appear together in one merged list', async () => {
    const paths = await freshProject();
    const projectRoot = paths.resolveWithin('.');
    await appendDisclosure(paths, 'kb', fakeClock(), {
      kind: 'trade-off',
      summary: 'real one',
      owner: 'alice',
      sources: [{ kind: 'human', ref: 'x' }],
    });
    await appendExemption(
      paths,
      'docs/forge/reports',
      fakeClock(),
      { testId: 'STORY-001: timing-guard', reason: 'r', owner: 'alice', expiry: '2026-12-01' },
      { projectRoot, runId: undefined },
    );
    const { ForgeError } = await import('@forge/core/errors');
    const cause = new ForgeError('RUN-113', {
      stepId: 'wf:review',
      file: 'x.md',
      rounds: 1,
      count: 1,
    });
    await appendEvent(projectRoot, 'run-001', {
      runId: 'run-001',
      ts: '2026-09-30T00:00:00.000Z',
      type: 'StepFailed',
      stepId: 'wf:review',
      payload: { source: 'output', code: 'RUN-113', message: cause.message, cause },
    });

    const ledger = await listDisclosureLedger({
      paths,
      projectRoot,
      kbRoot: 'kb',
      reportsRoot: 'docs/forge/reports',
      now: new Date('2026-09-30T00:00:00.000Z'),
    });
    expect(ledger.entries.map((entry) => entry.kind).sort()).toEqual(
      ['exemption', 'stopped-critic-loop', 'trade-off'].sort(),
    );
    expect(ledger.entries.every((entry) => entry.open)).toBe(true);
  });
});
