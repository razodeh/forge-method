/**
 * `loadDisclosures`/`appendDisclosure`/`resolveDisclosure`/`listDisclosureLedger` — `specs/22` M15
 * P10, against a real, throwaway project directory.
 *
 * @see specs/22 M15 P10
 * @see PLAN-M15.md P10
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { ProjectPaths, type Clock } from '@forge/core';
import { appendEvent } from '@forge/telemetry/events';
import { afterEach, describe, expect, it } from 'vitest';

import { TS_NODE_FLAG } from '../../../../scripts/lib/node-ts-flag.mjs';
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

const execFileAsync = promisify(execFile);

/** `appendDisclosure`'s own module path, resolved as a real filesystem path -- the worker script
 * below needs an absolute import, not a relative one (the identical reason `exemptions.test.ts`'s own
 * worker does). */
const DISCLOSURES_MODULE_PATH = fileURLToPath(
  new URL('../../src/commands/kb-disclosures.ts', import.meta.url),
);

/** The repo root, not the system tmpdir -- the identical reasoning `exemptions.test.ts`'s own
 * `REPO_ROOT` doc comment already gives (a bare `@forge/core` import needs the real,
 * pnpm-workspace-linked `node_modules/`; `.forge-test-scratch/` is outside `node_modules/` and
 * already `.gitignore`d). */
const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

async function writeConcurrencyWorker(workerPath: string): Promise<void> {
  const source = `
import { existsSync } from 'node:fs';
import { ProjectPaths } from '@forge/core/fs';
import { appendDisclosure } from ${JSON.stringify(DISCLOSURES_MODULE_PATH)};

const [, , dir, index, gatePath] = process.argv;
const paths = new ProjectPaths(dir);
const deadline = Date.now() + 10_000;
while (!existsSync(gatePath)) {
  if (Date.now() > deadline) throw new Error('gate file never appeared');
}
const id = await appendDisclosure(paths, 'kb', { now: () => new Date().toISOString() }, {
  kind: 'known-gap',
  summary: \`race \${index}\`,
  owner: 'alice',
  sources: [{ kind: 'human', ref: 'race' }],
});
process.stdout.write(JSON.stringify({ index, id }));
`;
  await writeFile(workerPath, source, 'utf8');
}

describe('appendDisclosure — real cross-process concurrency', () => {
  it('20 real, separate OS processes, released together, all survive with 20 distinct ids', async () => {
    const paths = await freshProject();
    await mkdir(path.join(REPO_ROOT, '.forge-test-scratch'), { recursive: true });
    const workerDir = await mkdtemp(path.join(REPO_ROOT, '.forge-test-scratch', 'disc-race-'));
    dirs.push(workerDir);
    const workerPath = path.join(workerDir, 'worker.mts');
    await writeConcurrencyWorker(workerPath);
    const gatePath = path.join(workerDir, 'gate');
    const projectDir = paths.resolveWithin('.');

    const workerCount = 20;
    const launches = Array.from({ length: workerCount }, (_unused, index) =>
      execFileAsync(
        process.execPath,
        [
          TS_NODE_FLAG,
          '--disable-warning=ExperimentalWarning',
          workerPath,
          projectDir,
          String(index),
          gatePath,
        ],
        { cwd: workerDir },
      ),
    );
    await writeFile(gatePath, 'go', 'utf8');
    const results = await Promise.all(launches);

    const parsedResults = results.map(
      ({ stdout }) => JSON.parse(stdout) as { readonly index: number; readonly id: string },
    );
    expect(parsedResults).toHaveLength(workerCount);
    const ids = parsedResults.map((result) => result.id);
    expect(new Set(ids).size).toBe(workerCount);
    expect((await loadDisclosures(paths, 'kb')).disclosures).toHaveLength(workerCount);
  }, 30_000);

  /** The identical shape `writeConcurrencyWorker` above uses, but each worker does
   * `appendsPerWorker` SEQUENTIAL `appendDisclosure` calls after release, not just one — the exact
   * volume `exemptions.test.ts`'s own `writeMultiAppendConcurrencyWorker` (`e2a42d5`) found necessary
   * to reliably reproduce `withCollectionLock`'s own disclosed "intermittent loss reappearing
   * starting around 25-30" ceiling: 1 append per worker, even at 20-30 workers, does not reliably
   * trigger the real bug (an indeterminate lock age folded into "assume stale, reclaim immediately"
   * rather than "unknown, wait and retry") — each worker needs several of its OWN immediately-
   * repeated acquire/release cycles for another process's own read to land in that gap often enough
   * to matter. */
  async function writeMultiAppendConcurrencyWorker(
    workerPath: string,
    appendsPerWorker: number,
  ): Promise<void> {
    const source = `
import { existsSync } from 'node:fs';
import { ProjectPaths } from '@forge/core/fs';
import { appendDisclosure } from ${JSON.stringify(DISCLOSURES_MODULE_PATH)};

const [, , dir, index, gatePath] = process.argv;
const paths = new ProjectPaths(dir);
const deadline = Date.now() + 10_000;
while (!existsSync(gatePath)) {
  if (Date.now() > deadline) throw new Error('gate file never appeared');
}
const ids = [];
for (let i = 0; i < ${String(appendsPerWorker)}; i += 1) {
  const id = await appendDisclosure(paths, 'kb', { now: () => new Date().toISOString() }, {
    kind: 'known-gap',
    summary: \`race worker-\${index}-append-\${i}\`,
    owner: 'alice',
    sources: [{ kind: 'human', ref: 'race' }],
  });
  ids.push(id);
}
process.stdout.write(JSON.stringify({ index, ids }));
`;
    await writeFile(workerPath, source, 'utf8');
  }

  // Regression for a CONFIRMED, previously-shipping data-loss bug in `withCollectionLock`
  // (`../../src/commands/collection-lock.ts`, `e2a42d5`): the empty-lock reclaim's age check treated
  // `ageMs === undefined` (a `stat` failure, most commonly ENOENT from the true owner releasing one
  // lock and creating a brand-new one for its own next write fast enough to beat a concurrent `stat`)
  // as "assume stale, reclaim immediately," stealing the lock out from under its still-live true
  // owner mid-write. `appendDisclosure` shares this exact lock primitive via `kb-disclosures.ts`'s
  // own `withDisclosuresLock` -> `withCollectionLock(paths, clock, 'disclosures.lock', ...)`, but
  // until now this file's own real multi-process coverage stopped at the 20-way/1-append shape above
  // -- the identical volume `exemptions.test.ts`'s own regression test (right next to the production
  // fix, `e2a42d5`) found necessary to reliably trigger this exact bug class. The production fix
  // already landed as part of `collection-lock.ts`'s own shared-module fix; this closes the
  // coverage gap for `appendDisclosure` specifically rather than leaving it proven only by analogy to
  // `appendExemption`'s own sibling test.
  it('28 real, separate OS processes x 6 sequential appends each (168 total), released together, never lose or duplicate an id', async () => {
    const paths = await freshProject();
    await mkdir(path.join(REPO_ROOT, '.forge-test-scratch'), { recursive: true });
    const workerDir = await mkdtemp(
      path.join(REPO_ROOT, '.forge-test-scratch', 'disc-race-multi-'),
    );
    dirs.push(workerDir);
    const workerPath = path.join(workerDir, 'worker.mts');
    const workerCount = 28;
    const appendsPerWorker = 6;
    await writeMultiAppendConcurrencyWorker(workerPath, appendsPerWorker);
    const gatePath = path.join(workerDir, 'gate');
    const projectDir = paths.resolveWithin('.');

    const launches = Array.from({ length: workerCount }, (_unused, index) =>
      execFileAsync(
        process.execPath,
        [
          TS_NODE_FLAG,
          '--disable-warning=ExperimentalWarning',
          workerPath,
          projectDir,
          String(index),
          gatePath,
        ],
        { cwd: workerDir },
      ),
    );
    // Every worker is now spawned and spinning on the gate file -- release them all at once.
    await writeFile(gatePath, 'go', 'utf8');
    const results = await Promise.all(launches);

    const parsedResults = results.map(
      ({ stdout }) => JSON.parse(stdout) as { readonly index: number; readonly ids: string[] },
    );
    expect(parsedResults).toHaveLength(workerCount);
    const allIds = parsedResults.flatMap((result) => result.ids);
    const expectedTotal = workerCount * appendsPerWorker;
    expect(allIds).toHaveLength(expectedTotal);
    // The real, load-bearing assertion: every one of the 168 concurrent, separate-process
    // declarations survived with a distinct id -- not silently lost or overwritten by another
    // process's own read-modify-write winning a lock it was never entitled to reclaim.
    expect(new Set(allIds).size).toBe(expectedTotal);
    expect((await loadDisclosures(paths, 'kb')).disclosures).toHaveLength(expectedTotal);
  }, 60_000);
});

/** Unlike `writeConcurrencyWorker` above (every process appends its OWN new disclosure), every one of
 * these workers calls `resolveDisclosure` on the IDENTICAL, pre-existing id -- the race
 * `resolveDisclosure`'s own `already-resolved` guard exists to prevent two separate processes from both
 * reading `resolved: false` before either one writes. */
async function writeResolveRaceWorker(workerPath: string): Promise<void> {
  const source = `
import { existsSync } from 'node:fs';
import { ProjectPaths } from '@forge/core/fs';
import { resolveDisclosure } from ${JSON.stringify(DISCLOSURES_MODULE_PATH)};

const [, , dir, index, gatePath, id] = process.argv;
const paths = new ProjectPaths(dir);
const deadline = Date.now() + 10_000;
while (!existsSync(gatePath)) {
  if (Date.now() > deadline) throw new Error('gate file never appeared');
}
try {
  await resolveDisclosure(paths, 'kb', { now: () => new Date().toISOString() }, {
    id,
    reason: \`resolved by worker \${index}\`,
    by: \`worker-\${index}\`,
  });
  process.stdout.write(JSON.stringify({ index, outcome: 'resolved' }));
} catch (error) {
  process.stdout.write(JSON.stringify({ index, outcome: 'refused', code: error?.code }));
}
`;
  await writeFile(workerPath, source, 'utf8');
}

describe('resolveDisclosure — real cross-process concurrency on the SAME id', () => {
  it("10 real, separate OS processes all racing to resolve the identical id: exactly one wins, the rest get a clean KB-018 already-resolved, and the winner's own reason survives untouched", async () => {
    const paths = await freshProject();
    const id = await appendDisclosure(paths, 'kb', fakeClock(), {
      kind: 'trade-off',
      summary: 'contested',
      owner: 'alice',
      sources: [{ kind: 'human', ref: 'x' }],
    });
    await mkdir(path.join(REPO_ROOT, '.forge-test-scratch'), { recursive: true });
    const workerDir = await mkdtemp(
      path.join(REPO_ROOT, '.forge-test-scratch', 'disc-resolve-race-'),
    );
    dirs.push(workerDir);
    const workerPath = path.join(workerDir, 'worker.mts');
    await writeResolveRaceWorker(workerPath);
    const gatePath = path.join(workerDir, 'gate');
    const projectDir = paths.resolveWithin('.');

    const workerCount = 10;
    const launches = Array.from({ length: workerCount }, (_unused, index) =>
      execFileAsync(
        process.execPath,
        [
          TS_NODE_FLAG,
          '--disable-warning=ExperimentalWarning',
          workerPath,
          projectDir,
          String(index),
          gatePath,
          id,
        ],
        { cwd: workerDir },
      ),
    );
    await writeFile(gatePath, 'go', 'utf8');
    const results = await Promise.all(launches);

    const parsedResults = results.map(
      ({ stdout }) =>
        JSON.parse(stdout) as {
          readonly index: number;
          readonly outcome: string;
          readonly code?: string;
        },
    );
    const resolvedCount = parsedResults.filter((result) => result.outcome === 'resolved').length;
    const refusedCount = parsedResults.filter((result) => result.outcome === 'refused').length;
    // Exactly one process wins the race; every other one gets a clean, typed refusal -- never two
    // "winners," never an uncaught crash, never a silent no-op.
    expect(resolvedCount).toBe(1);
    expect(refusedCount).toBe(workerCount - 1);
    expect(
      parsedResults
        .filter((result) => result.outcome === 'refused')
        .every((result) => result.code === 'KB-018'),
    ).toBe(true);

    const { disclosures } = await loadDisclosures(paths, 'kb');
    const final = disclosures.find((disclosure) => disclosure.id === id);
    expect(final?.resolved).toBe(true);
    // The surviving resolution is the ONE winner's own reason -- never a later-arriving write silently
    // overwriting an earlier one (which the `already-resolved` guard, if racy, could otherwise allow).
    const winnerIndex = parsedResults.find((result) => result.outcome === 'resolved')?.index;
    expect(final?.resolution?.reason).toBe(`resolved by worker ${String(winnerIndex)}`);
  }, 30_000);
});
