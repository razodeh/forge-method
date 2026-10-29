/**
 * `appendDisclosure`/`resolveDisclosure`'s own real, multi-process cross-process stress repros --
 * split out of `kb-disclosures.test.ts` for the identical reason `module-lock-stress.test.ts` was
 * already split out of `module.test.ts` (`58df03f`): a file of its own keeps a large, unrelated test
 * suite (`kb-disclosures.test.ts`'s own ordinary `loadDisclosures`/`appendDisclosure`/
 * `resolveDisclosure`/`listDisclosureLedger` command-logic coverage) from being dragged along with a
 * slice that needs different CI scheduling, not `vi.mock` isolation.
 *
 * This file spawns real child OS processes -- 20 for the first test, 28 x 6 sequential appends (168
 * total) for the second, and 10 for the third -- to exercise `kb-disclosures.ts`'s own cross-process
 * file lock correctness. Run concurrently with the rest of the suite in `vitest.config.ts`'s single
 * shared fork pool, that real process volume was one of the 5 confirmed contributors to CI-scale
 * lock-wait-budget exhaustion (see the `ci: isolate the 5 real multi-process lock-stress tests into
 * their own sequential job` commit, `bf312f8`). This file is therefore excluded from `floor`/`seed`'s
 * own `pnpm test` and runs instead in the dedicated, sequential `lock-stress` CI job -- while
 * `kb-disclosures.test.ts`'s own OTHER, non-stress tests (the only substantial exercise of
 * `loadDisclosures`/`appendDisclosure`/`resolveDisclosure`/`listDisclosureLedger` across the whole
 * suite) stay in the main, coverage-measured run.
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
import { afterEach, describe, expect, it } from 'vitest';

import { TS_NODE_FLAG } from '../../../../scripts/lib/node-ts-flag.mjs';
import { appendDisclosure, loadDisclosures } from '../../src/commands/kb-disclosures.ts';

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
   * to matter.
   *
   * `maxLockAttempts` (round 3): each worker's own `appendDisclosure` call passes this straight
   * through as its optional 5th argument -- this test's own caller passes `400` (not the restored
   * `200`/5s production default) specifically because this exact test, run as part of the gauntlet's
   * own specified 4-file combined acceptance command, is the one `collection-lock.ts`'s own
   * `DEFAULT_MAX_LOCK_ATTEMPTS` doc comment names as empirically needing the wider budget to survive
   * ~84-real-process combined-suite scheduling contention -- see that doc comment for the full
   * reproduction. */
  async function writeMultiAppendConcurrencyWorker(
    workerPath: string,
    appendsPerWorker: number,
    maxLockAttempts: number,
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
  }, ${String(maxLockAttempts)});
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
    // `400`, not the restored `200`/5s production default -- this is the exact test `collection-
    // lock.ts`'s own `DEFAULT_MAX_LOCK_ATTEMPTS` doc comment names as needing the wider budget to
    // survive real OS-scheduling contention under the gauntlet's own 4-file combined acceptance
    // command (up to ~84 competing processes at once). See that doc comment for the full repro.
    const maxLockAttempts = 400;
    await writeMultiAppendConcurrencyWorker(workerPath, appendsPerWorker, maxLockAttempts);
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
