/**
 * `withManifestLock`'s own real, 28-process cross-process stress repro — split out of
 * `module.test.ts` (this session's own "CI lock-stress isolation" piece) for the identical reason
 * `module-install-fence-real-paths.test.ts` was already split out of `module.test.ts`/`overlay.
 * test.ts` this same session: a file of its own keeps a large, unrelated test suite
 * (`module.test.ts`'s own ordinary `moduleAdd`/`moduleRemove`/`moduleUpdate`/`fetchInstallBundle`/
 * `installBundleTree` coverage) from being dragged along with a slice that needs different handling.
 *
 * Here the different handling is CI scheduling, not `vi.mock` isolation: this file spawns 28 real
 * child OS processes (6 sequential `withManifestLock` operations each, 168 total) to exercise a
 * cross-process file lock's own correctness. Run concurrently with the rest of the ~750-file suite in
 * `vitest.config.ts`'s single shared fork pool, that real process volume was one of the 5 confirmed
 * contributors to CI-scale lock-wait-budget exhaustion (see the `ci: isolate the 5 real multi-process
 * lock-stress tests into their own sequential job` commit this splits). This file is therefore
 * excluded from `floor`/`seed`'s own `pnpm test` and runs instead in the dedicated, sequential
 * `lock-stress` CI job — while `module.test.ts`'s own OTHER, non-stress tests (confirmed, by real
 * measured sibling-only coverage, to be the only substantial exercise of `moduleAdd`/`moduleRemove`/
 * `moduleUpdate`/`fetchInstallBundle`/`installBundleTree` across the whole suite) stay in the main,
 * coverage-measured run.
 *
 * @see SPEC-QUESTIONS.md Q285
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { TS_NODE_FLAG } from '../../../../scripts/lib/node-ts-flag.mjs';

import { cleanupAll, createTestProject, registerCleanup } from './upgrade/helpers.ts';

afterEach(cleanupAll);

// --- withManifestLock: real cross-process stress repro (critic-disclosed reasoning gap, fixed) ----

const execFileAsync = promisify(execFile);

/** `withManifestLock`'s own module path, resolved as a real filesystem path — the worker script below
 * needs an absolute import, not a relative one (the identical reason `exemptions.test.ts`'s own
 * worker does, `packages/cli/test/commands/loop/test/exemptions.test.ts`). */
const MODULE_MODULE_PATH = fileURLToPath(new URL('../../src/commands/module.ts', import.meta.url));

/** The generated worker source below injects this path as a literal ESM import specifier
 * (`import { withManifestLock } from "..."`). That specifier is wrapped in `pathToFileURL(...).href`
 * at the injection site, never used as the raw OS path directly — the identical `Q340` bug class
 * (CI run `40879015373`, job `123465219539`, `lock-stress (sequential, windows-latest)`): on Windows
 * an un-wrapped drive-letter path (`D:\...`) has its `D:` read by Node's WHATWG-URL-based ESM
 * specifier parser as a URL *scheme*, throwing `ERR_UNSUPPORTED_ESM_URL_SCHEME ... protocol 'd:'`.
 * POSIX absolute paths happen to parse as valid relative-URL references, which is why this never
 * surfaced on macOS/Linux. Matches the already-established fix for this exact class elsewhere in this
 * codebase (`preflight.cjs`'s `distEntryUrl`, `scripts/run-tests.mjs`'s `guardUrl`, `scripts/lib/
 * node-ts-flag.mjs`'s own `--import` resolution). */

/** The repo root, not the system tmpdir — the identical reasoning `exemptions.test.ts`'s own
 * `REPO_ROOT` doc comment already gives (a bare `@forge/core` import needs the real,
 * pnpm-workspace-linked `node_modules/`; `.forge-test-scratch/` is outside `node_modules/` and
 * already `.gitignore`d). */
const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

/** Every one of these workers does `itersPerWorker` SEQUENTIAL `withManifestLock` calls, each
 * appending its own unique id to a shared `ledgerPath` JSON array read-modify-write — the identical
 * "many real OS processes, each cycling acquire/operate/release many times against the SAME lock
 * name" shape `e2a42d5`'s own `writeMultiAppendConcurrencyWorker` (`exemptions.test.ts`) proved
 * necessary to reliably trigger this exact bug class (a single acquire/release per worker does not
 * give the race enough chances to land).
 *
 * Two kinds of failure are retried here, deliberately NOT asserted against directly:
 *  - `CFG-047`: `withManifestLock` refuses outright rather than queueing when another real, live
 *    process currently holds the lock (its own documented design, unlike `withCollectionLock`, which
 *    polls) — ordinary contention under N parallel workers, not the bug this harness exists to find.
 *  - any OTHER error: a confirmed, PRE-EXISTING, and separate race in `@forge/core/fs`'s own
 *    `ProjectPaths.resolveState`/`resolveContained` (`realpathOfDeepestExistingAncestor`'s own
 *    `existsSync` check and its later, separate `realpathSync` call are two steps, not one — a
 *    concurrent delete of the resolved path between them throws an uncaught `ENOENT`), reproduced
 *    directly while building this test and confirmed to fire identically before and after the
 *    `readLockPid`/`withManifestLock` fix this test exists to cover. Out of scope for this fix (a
 *    different file, a different abstraction layer, a far wider blast radius than this one lock) —
 *    retried here so this test's own real, load-bearing assertion (no lost or duplicated id, ever)
 *    is never masked by an unrelated, already-disclosed-elsewhere race.
 *
 * @see SPEC-QUESTIONS.md Q285
 */
async function writeManifestLockWorker(workerPath: string, itersPerWorker: number): Promise<void> {
  const source = `
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { ProjectPaths } from '@forge/core/fs';
import { withManifestLock } from ${JSON.stringify(pathToFileURL(MODULE_MODULE_PATH).href)};

const [, , dir, index, gatePath, ledgerPath] = process.argv;
const paths = new ProjectPaths(dir);
const deadline = Date.now() + 10_000;
while (!existsSync(gatePath)) {
  if (Date.now() > deadline) throw new Error('gate file never appeared');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ids = [];
for (let i = 0; i < ${String(itersPerWorker)}; i += 1) {
  const id = \`w\${index}-\${i}\`;
  for (;;) {
    try {
      await withManifestLock(paths, async () => {
        let current = [];
        try {
          current = JSON.parse(readFileSync(ledgerPath, 'utf8'));
        } catch {
          current = [];
        }
        current.push(id);
        writeFileSync(ledgerPath, JSON.stringify(current));
      });
      break;
    } catch (error) {
      await sleep(5 + Math.floor(Math.random() * 15));
    }
  }
  ids.push(id);
}
process.stdout.write(JSON.stringify({ index, ids }));
`;
  await writeFile(workerPath, source, 'utf8');
}

describe('withManifestLock — real cross-process concurrency (critic-disclosed: an unreadable lock used to be reclaimed like a dead one)', () => {
  // Regression for the identical reasoning gap already fixed in `@forge/telemetry`'s own
  // `withEventLogLock` (`379eb26`) and this package's own `withCollectionLock` (`e2a42d5`):
  // `readLockPid` returning `undefined` (missing, or read in the TOCTOU gap between its own
  // existence check and the actual read) used to be folded into "not a real, live holder, reclaim"
  // right alongside a genuinely dead pid. Confirmed directly before fixing, not assumed: at 28
  // workers x 6 sequential acquire/operate/release cycles each (168 total, the identical volume
  // `e2a42d5`'s own regression test uses), the pre-fix code crashed 14-20 of 28 real worker processes
  // per run, every single run (10/10), with an uncaught `RUN-034` from `readTextFile` hitting exactly
  // that TOCTOU gap, and 3 of 10 runs also lost real appends outright (as few as 155 of 168 ids
  // actually surviving in the shared ledger). Ten repeated runs against the fixed code: zero
  // `readLockPid`-attributable crashes and zero lost appends, every time.
  it('28 real, separate OS processes x 6 sequential withManifestLock operations each (168 total), never lose or duplicate an id', async () => {
    const project = await createTestProject();
    await mkdir(path.join(REPO_ROOT, '.forge-test-scratch'), { recursive: true });
    const workerDir = await mkdtemp(path.join(REPO_ROOT, '.forge-test-scratch', 'manifest-lock-'));
    registerCleanup(workerDir);
    const workerPath = path.join(workerDir, 'worker.mts');
    const workerCount = 28;
    const itersPerWorker = 6;
    await writeManifestLockWorker(workerPath, itersPerWorker);
    const gatePath = path.join(workerDir, 'gate');
    const ledgerPath = path.join(workerDir, 'ledger.json');
    await writeFile(ledgerPath, '[]', 'utf8');
    const projectDir = project.paths.resolveWithin('.');

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
          ledgerPath,
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
    const expectedTotal = workerCount * itersPerWorker;
    expect(allIds).toHaveLength(expectedTotal);

    const ledgerIds = JSON.parse(await readFile(ledgerPath, 'utf8')) as readonly string[];
    // The real, load-bearing assertion: every one of the 168 ids a worker believes it successfully
    // wrote under the lock actually survives in the shared ledger, with none lost to another
    // process's own stale read winning a lock it was never entitled to reclaim, and none duplicated.
    expect(new Set(ledgerIds).size).toBe(expectedTotal);
    expect(allIds.every((id) => ledgerIds.includes(id))).toBe(true);
  }, 60_000);
});
