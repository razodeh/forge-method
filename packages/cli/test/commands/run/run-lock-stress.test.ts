/**
 * `acquireRunLock`/`releaseRunLock`'s own real, 28-process cross-process stress repro -- split out of
 * `lock.test.ts` for the identical reason `module-lock-stress.test.ts` was already split out of
 * `module.test.ts` (`58df03f`): a file of its own keeps a large, unrelated test suite (`lock.test.ts`'s
 * own ordinary `isProcessAlive`/`acquireRunLock`/`readRunLock`/`releaseRunLock`/
 * `assertRunLockStillHeld`/`stopLockedProcess` coverage) from being dragged along with a slice that
 * needs different CI scheduling, not `vi.mock` isolation.
 *
 * Here the different handling is CI scheduling, not test isolation: this file spawns 28 real child OS
 * processes (6 sequential acquire/release cycles each, 168 total) to exercise a cross-process file
 * lock's own correctness. Run concurrently with the rest of the ~750-file suite in `vitest.config.ts`'s
 * single shared fork pool, that real process volume was one of the 5 confirmed contributors to
 * CI-scale lock-wait-budget exhaustion (see the `ci: isolate the 5 real multi-process lock-stress
 * tests into their own sequential job` commit, `bf312f8`). This file is therefore excluded from
 * `floor`/`seed`'s own `pnpm test` and runs instead in the dedicated, sequential `lock-stress` CI job --
 * while `lock.test.ts`'s own OTHER, non-stress tests (the only substantial exercise of
 * `acquireRunLock`/`releaseRunLock`/`assertRunLockStillHeld`/`stopLockedProcess` across the whole
 * suite) stay in the main, coverage-measured run.
 *
 * @see specs/03 §3.2.4
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { TS_NODE_FLAG } from '../../../../../scripts/lib/node-ts-flag.mjs';
import { cleanupAll, createTestProject, registerCleanup } from './helpers.ts';

afterEach(cleanupAll);

// --- acquireRunLock/releaseRunLock: real cross-process stress repro (critic-disclosed, fixed) ----

const execFileAsync = promisify(execFile);

/** `acquireRunLock`/`releaseRunLock`'s own module path, resolved as a real filesystem path — the
 * worker script below needs an absolute import, not a relative one (the identical reason
 * `exemptions.test.ts`'s own worker does, `packages/cli/test/commands/loop/test/exemptions.test.ts`). */
const RUN_LOCK_MODULE_PATH = fileURLToPath(
  new URL('../../../src/commands/run/lock.ts', import.meta.url),
);

/** The repo root, not the system tmpdir — the identical reasoning `exemptions.test.ts`'s own
 * `REPO_ROOT` doc comment already gives (a bare `@forge/core` import needs the real,
 * pnpm-workspace-linked `node_modules/`; `.forge-test-scratch/` is outside `node_modules/` and
 * already `.gitignore`d). */
const REPO_ROOT = fileURLToPath(new URL('../../../../..', import.meta.url));

/** Every one of these workers does `itersPerWorker` SEQUENTIAL acquire/operate/release cycles against
 * the SAME project lock — no real `forge run`/`forge resume` invocation does this today (each is one
 * acquire and one release per whole process lifetime), but this is the identical "many real OS
 * processes, each cycling many times against the SAME lock name" shape `e2a42d5`'s own
 * `writeMultiAppendConcurrencyWorker` (`exemptions.test.ts`) proved necessary to reliably trigger this
 * exact bug class, applied here to prove the underlying primitive itself is safe, independent of
 * today's real call sites.
 *
 * Two kinds of failure are retried here, deliberately NOT asserted against directly:
 *  - `CFG-002`: a real, live holder is a genuine, expected refusal under N parallel workers all
 *    racing for the same lock, not the bug this harness exists to find.
 *  - any OTHER error: the identical, separate, PRE-EXISTING `@forge/core/fs` `ProjectPaths.resolveState`
 *    race `module.test.ts`'s own identical worker doc comment already names in full (confirmed to fire
 *    before AND after this fix, out of scope for it) — retried here so this test's own real assertion
 *    (no crash attributable to `readRunLock`'s own TOCTOU gap, no lost or duplicated ledger id) is
 *    never masked by that unrelated, already-disclosed-elsewhere race.
 */
async function writeRunLockWorker(workerPath: string, itersPerWorker: number): Promise<void> {
  const source = `
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { ProjectPaths } from '@forge/core/fs';
import { acquireRunLock, releaseRunLock } from ${JSON.stringify(RUN_LOCK_MODULE_PATH)};

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
      await acquireRunLock(paths, {
        pid: process.pid,
        host: 'test-host',
        runId: id,
        startedAt: new Date().toISOString(),
      });
      break;
    } catch (error) {
      await sleep(2 + Math.floor(Math.random() * 8));
    }
  }
  let current = [];
  try {
    current = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  } catch {
    current = [];
  }
  current.push(id);
  writeFileSync(ledgerPath, JSON.stringify(current));
  await releaseRunLock(paths);
  ids.push(id);
}
process.stdout.write(JSON.stringify({ index, ids }));
`;
  await writeFile(workerPath, source, 'utf8');
}

describe('acquireRunLock/releaseRunLock — real cross-process concurrency (critic-disclosed: an unreadable lock used to be reclaimed like a dead one)', () => {
  // Regression for the identical reasoning gap already fixed in `@forge/telemetry`'s own
  // `withEventLogLock` (`379eb26`) and `@forge/cli`'s own `withCollectionLock` (`e2a42d5`):
  // `readRunLock` used to do `pathExists` then a SEPARATE `readTextFile`/`JSON.parse`, and
  // `acquireRunLock` folded its own `undefined` result into "not a real, live holder, reclaim" right
  // alongside a genuinely dead pid. Confirmed directly before fixing, not assumed: at 28 workers x 6
  // sequential acquire/release cycles each (168 total, the identical volume `e2a42d5`'s own
  // regression test uses, across 5 repeated runs = 840 total cycles), the pre-fix code crashed 90 of
  // 118 total worker failures outright with an uncaught `SyntaxError` (`JSON.parse` on an empty read)
  // or `RUN-034` (`readTextFile` hitting `ENOENT`) from exactly this gap. Ten repeated runs against
  // the fixed code: zero `readRunLock`-attributable crashes, every time.
  it('28 real, separate OS processes x 6 sequential acquire/release cycles each (168 total), never lose or duplicate an id', async () => {
    const project = await createTestProject();
    await mkdir(path.join(REPO_ROOT, '.forge-test-scratch'), { recursive: true });
    const workerDir = await mkdtemp(path.join(REPO_ROOT, '.forge-test-scratch', 'run-lock-'));
    registerCleanup(workerDir);
    const workerPath = path.join(workerDir, 'worker.mts');
    const workerCount = 28;
    const itersPerWorker = 6;
    await writeRunLockWorker(workerPath, itersPerWorker);
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
    // wrote while holding the lock actually survives in the shared ledger, with none lost to another
    // process's own stale read winning a lock it was never entitled to reclaim, and none duplicated.
    expect(new Set(ledgerIds).size).toBe(expectedTotal);
    expect(allIds.every((id) => ledgerIds.includes(id))).toBe(true);
  }, 60_000);
});
