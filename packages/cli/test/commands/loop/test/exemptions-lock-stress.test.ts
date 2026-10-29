/**
 * `appendExemption`'s own real, multi-process cross-process stress repros -- split out of
 * `exemptions.test.ts` for the identical reason `module-lock-stress.test.ts` was already split out of
 * `module.test.ts` (`58df03f`): a file of its own keeps a large, unrelated test suite
 * (`exemptions.test.ts`'s own ordinary `loadExemptions`/`appendExemption`/`applyExemptions`/
 * `describeExemptionProblems` command-logic coverage) from being dragged along with a slice that needs
 * different CI scheduling, not `vi.mock` isolation.
 *
 * This file spawns real child OS processes -- 20 for the first test, 28 x 6 sequential appends (168
 * total) for the second -- to exercise `appendExemption`'s own cross-process file lock correctness.
 * Run concurrently with the rest of the suite in `vitest.config.ts`'s single shared fork pool, that
 * real process volume was one of the 5 confirmed contributors to CI-scale lock-wait-budget exhaustion
 * (see the `ci: isolate the 5 real multi-process lock-stress tests into their own sequential job`
 * commit, `bf312f8`; also confirmed live via a real `GATE-515 lock-exhausted` CI failure, run
 * 40678754407, cited in this suite's own 28-worker test below). This file is therefore excluded from
 * `floor`/`seed`'s own `pnpm test` and runs instead in the dedicated, sequential `lock-stress` CI job --
 * while `exemptions.test.ts`'s own OTHER, non-stress tests (the only substantial exercise of
 * `loadExemptions`/`appendExemption`/`applyExemptions`/`describeExemptionProblems` across the whole
 * suite) stay in the main, coverage-measured run.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-8
 * @see PLAN-M15.md P6
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { ProjectPaths } from '@forge/core';
import { afterEach, describe, expect, it } from 'vitest';

import { TS_NODE_FLAG } from '../../../../../../scripts/lib/node-ts-flag.mjs';
import { loadExemptions } from '../../../../src/commands/loop/test/exemptions.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs
      .splice(0)
      // `maxRetries`/`retryDelay`: a real CI failure on `next` (run 40813893964, job 123250350362,
      // `lock-stress (sequential, windows-latest)`) hit `EBUSY: resource busy or locked, rmdir
      // '...race-multi-yt23yY'` here -- a spawned worker's own OS process can have exited (its
      // `execFile` promise resolved) while Windows has not yet fully released every handle it held
      // somewhere under this directory; unlike POSIX, Windows cannot remove a file/dir while ANY
      // handle to it is still open, even briefly. `fs.rm`'s own documented `maxRetries`/`retryDelay`
      // option exists for exactly this transient-handle-release class of error (`EBUSY`/`ENOTEMPTY`/
      // `EPERM`/`EMFILE`/`ENFILE`) and is a no-op on POSIX, where this race does not occur.
      .map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })),
  );
});

async function freshProject(): Promise<{
  readonly paths: ProjectPaths;
  readonly projectRoot: string;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-exemptions-'));
  dirs.push(dir);
  return { paths: new ProjectPaths(dir), projectRoot: dir };
}

const execFileAsync = promisify(execFile);

/** `appendExemption`'s own module path, resolved as a real filesystem path -- the worker script below
 * needs an absolute import, not a relative one. */
const EXEMPTIONS_MODULE_PATH = fileURLToPath(
  new URL('../../../../src/commands/loop/test/exemptions.ts', import.meta.url),
);

/** The generated worker sources below inject this path as a literal ESM import specifier (2 sites).
 * Each is wrapped in `pathToFileURL(...).href` at the injection site, never used as the raw OS path
 * directly — the identical `Q340` bug class (CI run `40879015373`, job `123465219539`, `lock-stress
 * (sequential, windows-latest)`): on Windows an un-wrapped drive-letter path (`D:\...`) has its `D:`
 * read by Node's WHATWG-URL-based ESM specifier parser as a URL *scheme*, throwing
 * `ERR_UNSUPPORTED_ESM_URL_SCHEME ... protocol 'd:'`. POSIX absolute paths happen to parse as valid
 * relative-URL references, which is why this never surfaced on macOS/Linux. Matches the already-
 * established fix for this exact class elsewhere in this codebase (`preflight.cjs`'s `distEntryUrl`,
 * `scripts/run-tests.mjs`'s `guardUrl`, `scripts/lib/node-ts-flag.mjs`'s own `--import` resolution). */

/** The repo root -- NOT the system tmpdir: a bare `@forge/core` import only resolves from somewhere
 * Node's own ESM resolver can walk up from and find the real, pnpm-workspace-linked `node_modules/`
 * (a round-1 gauntlet critic's own fix attempt hit `ERR_MODULE_NOT_FOUND` from a system-tmpdir worker
 * for exactly this reason) -- and NOT inside `node_modules/` itself either (Node refuses to strip
 * types for a file under there: `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, confirmed directly).
 * `.forge-test-scratch/`, repo-root-nested but outside `node_modules/`, satisfies both and is its own
 * dedicated `.gitignore` entry, so a worker script here can never show up as untracked debris even if
 * a test crashes before its own cleanup runs. */
const REPO_ROOT = fileURLToPath(new URL('../../../../../..', import.meta.url));

/** A real, separate `node` process, launched via `TS_NODE_FLAG` -- the identical Node-version-aware
 * mechanism `bin/forge.mjs` itself launches with (`Q340`) -- that calls `appendExemption` directly
 * and waits on a shared `gatePath` file
 * before doing so, tightening every worker's own race window as far as possible without a native
 * barrier primitive. `bin-exempt.test.ts`'s own "5 real processes" test goes through the full CLI
 * (a real mutation-based binding check first), which a round-1 gauntlet critic's own repro did NOT:
 * that check's own several-second, timing-variable duration naturally staggers each process's actual
 * write far enough apart that the race this test exists to prove rarely manifests even WITHOUT the
 * fix -- confirmed directly: the full-CLI test still passed with `withExemptionsLock` temporarily
 * disabled. This test calls `appendExemption` directly, skipping the expensive check entirely, so the
 * N processes' own writes land as close together in real wall-clock time as `node` startup and module
 * resolution allow -- the shape both independent round-1 AND round-2 critics' own reproductions
 * actually used.
 *
 * `workerCount` below (20) is deliberately NOT pushed to the extreme scale (50-100) rounds 2 and 3
 * used to find the residual risk `withExemptionsLock`'s own doc comment discloses -- this test proves
 * the fix at a real, repeatedly-confirmed-reliable concurrency level (30/30 clean runs at 10/15/20
 * real processes across the round-3 fix-and-reverify pass, after the round-3 critics' own repros
 * found the FIRST round-2 fix attempt was not yet reliable even at 25), not an extreme one this
 * specific lock primitive is disclosed as NOT proven correct at. */
async function writeConcurrencyWorker(workerPath: string): Promise<void> {
  const source = `
import { existsSync } from 'node:fs';
import { ProjectPaths } from '@forge/core/fs';
import { appendExemption } from ${JSON.stringify(pathToFileURL(EXEMPTIONS_MODULE_PATH).href)};

const [, , dir, index, gatePath] = process.argv;
const paths = new ProjectPaths(dir);
const deadline = Date.now() + 10_000;
while (!existsSync(gatePath)) {
  if (Date.now() > deadline) throw new Error('gate file never appeared');
}
const id = await appendExemption(paths, 'docs/forge/reports', { now: () => new Date().toISOString() }, {
  testId: \`race: test-\${index}\`,
  reason: 'r',
  owner: 'alice',
  expiry: '2026-12-01',
}, { projectRoot: dir, runId: undefined });
process.stdout.write(JSON.stringify({ index, id }));
`;
  await writeFile(workerPath, source, 'utf8');
}

/** The identical shape `writeConcurrencyWorker` above uses, but each worker does
 * `appendsPerWorker` SEQUENTIAL `appendExemption` calls after release, not just one -- the volume a
 * gauntlet critic independently found necessary to reliably reproduce `withCollectionLock`'s own
 * disclosed-but-previously-uninvestigated "intermittent loss reappearing starting around 25-30"
 * ceiling (this module's own top doc comment, `SPEC-QUESTIONS.md` Q285): 1 append per worker, even at
 * 20-30 workers, does not reliably trigger the real bug this was tracing to (an indeterminate lock-
 * age, most commonly ENOENT from the true owner releasing one lock and creating its own NEXT one fast
 * enough to beat a concurrent `stat`, previously treated as "assume stale, reclaim immediately" rather
 * than "unknown, wait and retry") -- each worker needs several of its OWN immediately-repeated
 * acquire/release cycles for another process's `stat` to land in that gap often enough to matter. The
 * driving regression test below (28 workers x 6 appends = 168 total) reproduced real, repeatable data
 * loss against the pre-fix code (6 of 10 runs corrupted, 129-163 distinct ids returned/written out of
 * 168 expected) and zero corruption across 10 repeated runs after the fix -- confirmed directly, not
 * assumed, before this test was written. */
async function writeMultiAppendConcurrencyWorker(
  workerPath: string,
  appendsPerWorker: number,
  maxLockAttempts: number,
): Promise<void> {
  const source = `
import { existsSync } from 'node:fs';
import { ProjectPaths } from '@forge/core/fs';
import { appendExemption } from ${JSON.stringify(pathToFileURL(EXEMPTIONS_MODULE_PATH).href)};

const [, , dir, index, gatePath] = process.argv;
const paths = new ProjectPaths(dir);
const deadline = Date.now() + 10_000;
while (!existsSync(gatePath)) {
  if (Date.now() > deadline) throw new Error('gate file never appeared');
}
const ids = [];
for (let i = 0; i < ${String(appendsPerWorker)}; i += 1) {
  const id = await appendExemption(paths, 'docs/forge/reports', { now: () => new Date().toISOString() }, {
    testId: \`race: worker-\${index}-append-\${i}\`,
    reason: 'r',
    owner: 'alice',
    expiry: '2026-12-01',
  }, { projectRoot: dir, runId: undefined }, ${String(maxLockAttempts)});
  ids.push(id);
}
process.stdout.write(JSON.stringify({ index, ids }));
`;
  await writeFile(workerPath, source, 'utf8');
}

describe('appendExemption — real cross-process concurrency', () => {
  it('20 real, separate OS processes, released together, all survive with 20 distinct ids', async () => {
    const { paths } = await freshProject();
    await mkdir(path.join(REPO_ROOT, '.forge-test-scratch'), { recursive: true });
    const workerDir = await mkdtemp(path.join(REPO_ROOT, '.forge-test-scratch', 'race-'));
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
    // Every worker is now spawned and spinning on the gate file -- release them all at once.
    await writeFile(gatePath, 'go', 'utf8');
    const results = await Promise.all(launches);

    const parsedResults = results.map(
      ({ stdout }) => JSON.parse(stdout) as { readonly index: number; readonly id: string },
    );
    expect(parsedResults).toHaveLength(workerCount);
    const ids = parsedResults.map((result) => result.id);
    // The real, load-bearing assertion: all 10 concurrent, separate-process declarations survived,
    // each with a distinct id -- not silently lost to another process's own read-modify-write.
    expect(new Set(ids).size).toBe(workerCount);
    expect((await loadExemptions(paths, 'docs/forge/reports')).exemptions).toHaveLength(
      workerCount,
    );
  }, 30_000);

  // Regression for a CONFIRMED, previously-shipping data-loss bug in `withCollectionLock`
  // (`../../collection-lock.ts`): the empty-lock reclaim's age check treated `ageMs === undefined`
  // (a `stat` failure, most commonly ENOENT from the true owner releasing one lock and creating a
  // brand-new one for its own next write fast enough to beat a concurrent `stat`) as "assume stale,
  // reclaim immediately," stealing the lock out from under its still-live true owner mid-write. The
  // 20-way/1-append test above does NOT reliably trigger this -- confirmed directly: it stayed clean
  // across repeated runs against the unfixed code, because one append per worker gives each process
  // only a single acquire/release cycle, too few chances for another worker's own `stat` to land in
  // the narrow release-then-recreate gap. 28 workers x 6 sequential appends each (168 total) -- the
  // volume an independent gauntlet critic's own repro found reliably corrupting -- reproduced real
  // data loss directly against the pre-fix code (6 of 10 runs corrupted here, 129-163 distinct ids out
  // of 168 expected) and zero corruption across 10 repeated post-fix runs, before this test was ever
  // written. This is the identical root cause and fix as `@forge/telemetry`'s own `withEventLogLock`
  // regression test (`packages/telemetry/test/events.test.ts`), independently reproduced here against
  // this module's own, separate implementation.
  //
  // `maxLockAttempts` (round 5): passes `400`, not the restored `200`/5s production default -- the
  // exact test `collection-lock.ts`'s own `DEFAULT_MAX_LOCK_ATTEMPTS` doc comment names as needing the
  // wider budget, alongside `kb-disclosures-lock-stress.test.ts`'s own identically-shaped 28-worker
  // stress test (both drive `withCollectionLock` under heavy concurrent-lock stress; this repo's real
  // CI gate now runs all of `lock-stress` sequentially in its own job, one file at a time -- see
  // `.github/workflows/ci.yml`'s own `lock-stress` job comment -- which is exactly why these files were
  // split out of the main, parallel-fork-pool run in the first place).
  it('28 real, separate OS processes x 6 sequential appends each (168 total), released together, never lose or duplicate an id', async () => {
    const { paths } = await freshProject();
    await mkdir(path.join(REPO_ROOT, '.forge-test-scratch'), { recursive: true });
    const workerDir = await mkdtemp(path.join(REPO_ROOT, '.forge-test-scratch', 'race-multi-'));
    dirs.push(workerDir);
    const workerPath = path.join(workerDir, 'worker.mts');
    const workerCount = 28;
    const appendsPerWorker = 6;
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
    expect((await loadExemptions(paths, 'docs/forge/reports')).exemptions).toHaveLength(
      expectedTotal,
    );
  }, 60_000);
});
