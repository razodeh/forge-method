/**
 * `loadExemptions`/`appendExemption`/`applyExemptions`/`describeExemptionProblems` — `specs/22` M15
 * P6, against a real, throwaway project directory.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-8
 * @see PLAN-M15.md P6
 */
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { ProjectPaths, type Clock } from '@forge/core';
import { exemptionsFileSchema } from '@forge/schemas';
import { afterEach, describe, expect, it } from 'vitest';
import * as YAML from 'yaml';

import { TS_NODE_FLAG } from '../../../../../../scripts/lib/node-ts-flag.mjs';
import {
  applyExemptions,
  appendExemption,
  describeExemptionProblems,
  loadExemptions,
  qualifiedTestId,
} from '../../../../src/commands/loop/test/exemptions.ts';
import type { Exemption } from '@forge/schemas';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function freshProject(): Promise<{
  readonly paths: ProjectPaths;
  readonly projectRoot: string;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-exemptions-'));
  dirs.push(dir);
  return { paths: new ProjectPaths(dir), projectRoot: dir };
}

function fakeClock(now = '2026-09-30T12:00:00.000Z'): Clock {
  return { now: () => now };
}

describe('qualifiedTestId', () => {
  it('joins the story and the test name the identical way discover mode already does', () => {
    expect(qualifiedTestId('STORY-001', 'adds')).toBe('STORY-001: adds');
  });
});

describe('loadExemptions', () => {
  it('reads [] for a project that has never run `forge test exempt`', async () => {
    const { paths } = await freshProject();
    const result = await loadExemptions(paths, 'docs/forge/reports');
    expect(result.exemptions).toEqual([]);
    expect(result.corruptCount).toBe(0);
  });

  it('reads back exactly what appendExemption wrote', async () => {
    const { paths, projectRoot } = await freshProject();
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
      { projectRoot, runId: undefined },
    );

    const { exemptions, corruptCount } = await loadExemptions(paths, 'docs/forge/reports');

    expect(corruptCount).toBe(0);
    expect(exemptions).toHaveLength(1);
    expect(exemptions[0]).toMatchObject({
      testId: 'STORY-001: timing-guard',
      reason: 'a real wall-clock timing guard, never mutation-bindable',
      owner: 'alice',
      expiry: '2026-12-01',
    });
    expect(exemptions[0]?.id).toMatch(/^EXEMPT-\d{3}$/);
  });

  it('tolerates a schema-invalid row: the valid sibling survives and the corruption is counted, never silently zeroing the whole read (specs/22 M15 P10, round-2 gauntlet critic)', async () => {
    const { paths } = await freshProject();
    const reportsDir = paths.resolveWithin('docs/forge/reports');
    await mkdir(reportsDir, { recursive: true });
    const seed = {
      type: 'Exemption' as const,
      schemaVersion: 1,
      title: 'Exemption register',
      status: 'active',
      created: '2026-09-30',
      updated: '2026-09-30',
      revision: 1,
      author: 'alice',
      changelog: [],
      exemptions: [
        {
          id: 'EXEMPT-001',
          testId: 'STORY-001: real-test',
          reason: 'a real, valid exemption',
          owner: 'alice',
          expiry: '2026-12-01',
        },
        // Missing `reason`/`expiry` -- schema-invalid.
        { id: 'EXEMPT-002', testId: 'STORY-001: other-test', owner: 'bob' },
      ],
    };
    await writeFile(
      path.join(reportsDir, 'exemptions.md'),
      `---\n${YAML.stringify(seed)}---\n`,
      'utf8',
    );

    const { exemptions, corruptCount } = await loadExemptions(paths, 'docs/forge/reports');

    expect(corruptCount).toBe(1);
    expect(exemptions).toHaveLength(1);
    expect(exemptions[0]?.id).toBe('EXEMPT-001');
  });
});

describe('appendExemption', () => {
  it('allocates sequential ids scoped to the collection file, not the shared project IdAllocator', async () => {
    const { paths, projectRoot } = await freshProject();
    const first = await appendExemption(
      paths,
      'docs/forge/reports',
      fakeClock(),
      {
        testId: 'STORY-001: a',
        reason: 'r',
        owner: 'alice',
        expiry: '2026-12-01',
      },
      { projectRoot, runId: undefined },
    );
    const second = await appendExemption(
      paths,
      'docs/forge/reports',
      fakeClock(),
      {
        testId: 'STORY-001: b',
        reason: 'r',
        owner: 'alice',
        expiry: '2026-12-01',
      },
      { projectRoot, runId: undefined },
    );

    expect(first).toBe('EXEMPT-001');
    expect(second).toBe('EXEMPT-002');
  });

  /** `withExemptionsLock`'s own lock file, seeded by hand at the exact real path it uses
   * (`.forge/state/exemptions.lock`) so these tests can drive its three reclaim/wait/exhaust branches
   * DETERMINISTICALLY -- never by racing real processes against each other, the only way any of these
   * three branches were exercised before this (round-3 gauntlet critics, both independent reviewers,
   * found all three genuinely untested: a real-process repro proves the mechanism works under SOME
   * timing, never that a specific branch's own logic is correct in isolation, and a probabilistic
   * real-process test can pass on both correct and reverted-to-buggy code alike). */
  function lockFilePath(paths: ProjectPaths): string {
    return paths.resolveState('exemptions.lock');
  }

  it('reclaims a lock naming a real, genuinely dead pid, without waiting out the retry budget', async () => {
    const { paths, projectRoot } = await freshProject();
    const child = spawn('node', ['-e', 'process.exit(0)']);
    const deadPid = child.pid;
    expect(deadPid).toBeDefined();
    await new Promise((resolve) => child.on('exit', resolve));

    await mkdir(path.dirname(lockFilePath(paths)), { recursive: true });
    await writeFile(lockFilePath(paths), String(deadPid), 'utf8');

    const start = Date.now();
    const id = await appendExemption(
      paths,
      'docs/forge/reports',
      fakeClock(),
      {
        testId: 'STORY-001: a',
        reason: 'r',
        owner: 'alice',
        expiry: '2026-12-01',
      },
      { projectRoot, runId: undefined },
    );
    // Reclaimed near-instantly (well under the ~5s full retry budget), not merely "eventually" --
    // proves the dead-pid branch fires on its own first check, not as a side effect of some other
    // path's own timeout.
    expect(Date.now() - start).toBeLessThan(1000);
    expect(id).toBe('EXEMPT-001');
  });

  it('does NOT reclaim a lock naming a real, currently-alive pid (this process itself)', async () => {
    const { paths, projectRoot } = await freshProject();
    await mkdir(path.dirname(lockFilePath(paths)), { recursive: true });
    await writeFile(lockFilePath(paths), String(process.pid), 'utf8');

    // This process's own pid is, definitionally, always alive -- so the lock can never legitimately
    // clear itself. The correct, honest behaviour is to exhaust the retry budget and refuse via the
    // typed GATE-515 'lock-exhausted' reason, never a bare Error and never a silent, incorrect
    // reclaim-and-proceed. Back to the original `15_000` timeout (round 3): round 2 had widened this
    // to `20_000` only because it also raised `collection-lock.ts`'s own global default to `400`/10s
    // (a test-scheduling-contention fix with an unwanted global production side effect). That default
    // is now restored to its original `200`/5s (see `DEFAULT_MAX_LOCK_ATTEMPTS`'s own doc comment),
    // and this call passes no override, so the real exhaustion here is back to ~5s nominal -- this
    // test's own original margin is restored along with it.
    await expect(
      appendExemption(
        paths,
        'docs/forge/reports',
        fakeClock(),
        {
          testId: 'STORY-001: a',
          reason: 'r',
          owner: 'alice',
          expiry: '2026-12-01',
        },
        { projectRoot, runId: undefined },
      ),
    ).rejects.toMatchObject({ code: 'GATE-515' });
  }, 15_000);

  it('does not reclaim a RECENT empty/unwritten lock file -- waits, then exhausts via GATE-515 lock-exhausted, never a silent reclaim-too-early', async () => {
    const { paths, projectRoot } = await freshProject();
    await mkdir(path.dirname(lockFilePath(paths)), { recursive: true });
    // Empty content: the real, ordinary shape of another process's own `writeFileSync(path, pid, {
    // flag: 'wx' })` call that has created the file but has not (yet) had its content observed by
    // this read -- see `withExemptionsLock`'s own doc comment for the full "ambiguous, not
    // unambiguously stale" reasoning this test exists to pin.
    await writeFile(lockFilePath(paths), '', 'utf8');

    // A clock frozen at the file's own real creation instant: age never advances past
    // `STALE_EMPTY_LOCK_MS`, so the age-gate must never reclaim -- the call can only ever resolve by
    // exhausting its retry budget, never by a premature, incorrect reclaim-and-proceed.
    const frozenNow = new Date().toISOString();
    await expect(
      appendExemption(
        paths,
        'docs/forge/reports',
        fakeClock(frozenNow),
        {
          testId: 'STORY-001: a',
          reason: 'r',
          owner: 'alice',
          expiry: '2026-12-01',
        },
        { projectRoot, runId: undefined },
      ),
    ).rejects.toMatchObject({ code: 'GATE-515' });
    // The empty lock file itself must still be there -- a correct "waited, then gave up" outcome
    // never deletes a lock it could not prove was actually its own to clear.
    const remaining = await readFile(lockFilePath(paths), 'utf8');
    expect(remaining).toBe('');
    // Back to the original `15_000` -- see the identical note on the test just above.
  }, 15_000);

  it('reclaims an OLD empty/unwritten lock file once it is older than STALE_EMPTY_LOCK_MS', async () => {
    const { paths, projectRoot } = await freshProject();
    await mkdir(path.dirname(lockFilePath(paths)), { recursive: true });
    await writeFile(lockFilePath(paths), '', 'utf8');

    // A clock reading far enough past the file's own real creation instant that the age-gate's own
    // threshold has elapsed -- the inverse of the "recent, must not reclaim" test above, proving the
    // SAME mechanism correctly reclaims once it genuinely is old enough, not merely that it always
    // waits.
    const farFuture = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const start = Date.now();
    const id = await appendExemption(
      paths,
      'docs/forge/reports',
      fakeClock(farFuture),
      {
        testId: 'STORY-001: a',
        reason: 'r',
        owner: 'alice',
        expiry: '2026-12-01',
      },
      { projectRoot, runId: undefined },
    );
    expect(Date.now() - start).toBeLessThan(1000);
    expect(id).toBe('EXEMPT-001');
  });

  it('ten concurrent in-process appends never collide on the same id', async () => {
    // In-process only: every call here shares one Node process, so this exercises
    // `withExemptionsLock`'s own serialization but says nothing about the REAL risk -- two separate
    // OS processes racing the same file. This file's own "real cross-process concurrency" describe
    // block below (real, separate `node` processes, released together via a shared gate file) is what
    // actually proves that; this test stays because an in-process regression (e.g. a lock that only
    // serializes some call shapes) is still worth catching cheaply, without the subprocess cost.
    const { paths, projectRoot } = await freshProject();
    const ids = await Promise.all(
      Array.from({ length: 10 }, (_unused, index) =>
        appendExemption(
          paths,
          'docs/forge/reports',
          fakeClock(),
          {
            testId: `STORY-001: test-${String(index)}`,
            reason: 'r',
            owner: 'alice',
            expiry: '2026-12-01',
          },
          { projectRoot, runId: undefined },
        ),
      ),
    );

    expect(new Set(ids).size).toBe(10);
    expect((await loadExemptions(paths, 'docs/forge/reports')).exemptions).toHaveLength(10);
  });

  it('refuses once idWidth digits are full (GATE-515 id-exhausted), rather than silently wrapping or colliding', async () => {
    // Seeds 999 entries by writing the fixture directly (not via 999 real `appendExemption` calls,
    // each its own lock-acquire + full read-modify-write -- correct but needlessly slow for a fixture
    // this function's own real work never has to build) -- only the real 1000th call under test goes
    // through `appendExemption` itself.
    const { paths, projectRoot } = await freshProject();
    const reportsDir = paths.resolveWithin('docs/forge/reports');
    await mkdir(reportsDir, { recursive: true });
    const exemptions = Array.from({ length: 999 }, (_unused, index) => ({
      id: `EXEMPT-${String(index + 1).padStart(3, '0')}`,
      testId: `STORY-001: test-${String(index + 1)}`,
      reason: 'r',
      owner: 'alice',
      expiry: '2026-12-01',
    }));
    const seed = {
      type: 'Exemption' as const,
      schemaVersion: 1,
      title: 'Exemption register',
      status: 'active',
      created: '2026-09-30',
      updated: '2026-09-30',
      revision: 1,
      author: 'alice',
      changelog: [],
      exemptions,
    };
    expect(exemptionsFileSchema.safeParse(seed).success).toBe(true);
    await writeFile(
      path.join(reportsDir, 'exemptions.md'),
      `---\n${YAML.stringify(seed)}---\n`,
      'utf8',
    );
    expect((await loadExemptions(paths, 'docs/forge/reports')).exemptions).toHaveLength(999);

    await expect(
      appendExemption(
        paths,
        'docs/forge/reports',
        fakeClock(),
        {
          testId: 'STORY-001: test-1000',
          reason: 'r',
          owner: 'alice',
          expiry: '2026-12-01',
        },
        { projectRoot, runId: undefined },
      ),
    ).rejects.toMatchObject({ code: 'GATE-515' });
    // Refused, not a corrupting partial write: the 999 already-recorded entries are untouched.
    expect((await loadExemptions(paths, 'docs/forge/reports')).exemptions).toHaveLength(999);
  });

  it('writes a real, schema-valid ExemptionsFile document', async () => {
    const { paths, projectRoot } = await freshProject();
    await appendExemption(
      paths,
      'docs/forge/reports',
      fakeClock(),
      {
        testId: 'STORY-001: a',
        reason: 'r',
        owner: 'alice',
        expiry: '2026-12-01',
      },
      { projectRoot, runId: undefined },
    );

    const text = await readFile(paths.resolveWithin('docs/forge/reports/exemptions.md'), 'utf8');
    const frontMatterText = text.split('---\n')[1] ?? '';
    const YAML = await import('yaml');
    const parsed = exemptionsFileSchema.safeParse(YAML.parse(frontMatterText));
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
  });
});

// `specs/22` M15 P11 metric 4a: "exemptions opened" -- real telemetry, real `appendEvent`, against the
// real event log (never the `ctx.telemetry` facade: this is CLI-layer code, with no `ExecuteStepContext`
// of its own, the identical reason `gate-commands.ts`'s own `emitGateEvent` calls `appendEvent` directly).
describe('appendExemption telemetry (specs/22 M15 P11)', () => {
  it('emits a CheckRun {kind: "exemption-declared"} event when a real FORGE_RUN_ID is in progress', async () => {
    const { paths, projectRoot } = await freshProject();
    const id = await appendExemption(
      paths,
      'docs/forge/reports',
      fakeClock(),
      { testId: 'STORY-001: a', reason: 'r', owner: 'alice', expiry: '2026-12-01' },
      { projectRoot, runId: 'run-exempt' },
    );

    const { readEvents } = await import('@forge/telemetry/events');
    const events = [];
    for await (const event of readEvents(projectRoot, 'run-exempt')) events.push(event);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'CheckRun',
      runId: 'run-exempt',
      payload: {
        kind: 'exemption-declared',
        exemptionId: id,
        testId: 'STORY-001: a',
        owner: 'alice',
        expiry: '2026-12-01',
      },
    });
  });

  it('emits nothing at all for a standalone invocation with no real FORGE_RUN_ID -- there is no event log to write into', async () => {
    const { paths, projectRoot } = await freshProject();
    await appendExemption(
      paths,
      'docs/forge/reports',
      fakeClock(),
      { testId: 'STORY-001: a', reason: 'r', owner: 'alice', expiry: '2026-12-01' },
      { projectRoot, runId: undefined },
    );

    const { pathExists } = await import('@forge/core/fs');
    // No run directory was ever created for this project at all -- not merely an empty one.
    expect(await pathExists(paths.resolveState('runs'))).toBe(false);
  });

  // Mutation evidence: a refused declaration (GATE-515 id-exhausted here) must not leave a phantom
  // "exemption-declared" event for an exemption that was never actually durable.
  it('emits nothing when the declaration itself is refused (GATE-515 id-exhausted)', async () => {
    const { paths, projectRoot } = await freshProject();
    const reportsDir = paths.resolveWithin('docs/forge/reports');
    await mkdir(reportsDir, { recursive: true });
    const exemptions999 = Array.from({ length: 999 }, (_unused, index) => ({
      id: `EXEMPT-${String(index + 1).padStart(3, '0')}`,
      testId: `STORY-001: test-${String(index + 1)}`,
      reason: 'r',
      owner: 'alice',
      expiry: '2026-12-01',
    }));
    const seed = {
      type: 'Exemption' as const,
      schemaVersion: 1,
      title: 'Exemption register',
      status: 'active',
      created: '2026-09-30',
      updated: '2026-09-30',
      revision: 1,
      author: 'alice',
      changelog: [],
      exemptions: exemptions999,
    };
    await writeFile(
      path.join(reportsDir, 'exemptions.md'),
      `---\n${YAML.stringify(seed)}---\n`,
      'utf8',
    );

    await expect(
      appendExemption(
        paths,
        'docs/forge/reports',
        fakeClock(),
        { testId: 'STORY-001: test-1000', reason: 'r', owner: 'alice', expiry: '2026-12-01' },
        { projectRoot, runId: 'run-refused' },
      ),
    ).rejects.toMatchObject({ code: 'GATE-515' });

    const { readEvents } = await import('@forge/telemetry/events');
    const events = [];
    for await (const event of readEvents(projectRoot, 'run-refused')) events.push(event);
    expect(events).toEqual([]);
  });
});

const execFileAsync = promisify(execFile);

/** `appendExemption`'s own module path, resolved as a real filesystem path -- the worker script below
 * needs an absolute import, not a relative one. */
const EXEMPTIONS_MODULE_PATH = fileURLToPath(
  new URL('../../../../src/commands/loop/test/exemptions.ts', import.meta.url),
);

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
import { appendExemption } from ${JSON.stringify(EXEMPTIONS_MODULE_PATH)};

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
): Promise<void> {
  const source = `
import { existsSync } from 'node:fs';
import { ProjectPaths } from '@forge/core/fs';
import { appendExemption } from ${JSON.stringify(EXEMPTIONS_MODULE_PATH)};

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
  }, { projectRoot: dir, runId: undefined });
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
  it('28 real, separate OS processes x 6 sequential appends each (168 total), released together, never lose or duplicate an id', async () => {
    const { paths } = await freshProject();
    await mkdir(path.join(REPO_ROOT, '.forge-test-scratch'), { recursive: true });
    const workerDir = await mkdtemp(path.join(REPO_ROOT, '.forge-test-scratch', 'race-multi-'));
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
    expect((await loadExemptions(paths, 'docs/forge/reports')).exemptions).toHaveLength(
      expectedTotal,
    );
  }, 60_000);
});

function exemption(overrides: Partial<Exemption> = {}): Exemption {
  return {
    id: 'EXEMPT-001',
    testId: 'STORY-001: timing-guard',
    reason: 'r',
    owner: 'alice',
    expiry: '2026-12-01',
    ...overrides,
  };
}

describe('applyExemptions', () => {
  it('suppresses exactly one matching, valid exemption and no other', () => {
    const result = applyExemptions(
      'STORY-001',
      ['timing-guard', 'adds'],
      [exemption()],
      '2026-09-30',
    );
    expect(result.nonBinding).toEqual(['adds']);
    expect(result.staleExemptions).toEqual([]);
    expect(result.expiredExemptions).toEqual([]);
  });

  it('a stale exemption (its own testId matches nothing in rawNonBinding) suppresses nothing, and is named', () => {
    const result = applyExemptions('STORY-001', ['adds'], [exemption()], '2026-09-30');
    expect(result.nonBinding).toEqual(['adds']);
    expect(result.staleExemptions).toEqual([exemption()]);
    expect(result.expiredExemptions).toEqual([]);
  });

  it('an expired exemption suppresses nothing, even though its testId matches, and is named', () => {
    const result = applyExemptions(
      'STORY-001',
      ['timing-guard'],
      [exemption({ expiry: '2026-01-01' })],
      '2026-09-30',
    );
    expect(result.nonBinding).toEqual(['timing-guard']);
    expect(result.expiredExemptions).toEqual([exemption({ expiry: '2026-01-01' })]);
    expect(result.staleExemptions).toEqual([]);
  });

  it('an exemption expiring on exactly today is already expired, not still valid for one more day', () => {
    const result = applyExemptions(
      'STORY-001',
      ['timing-guard'],
      [exemption({ expiry: '2026-09-30' })],
      '2026-09-30',
    );
    expect(result.nonBinding).toEqual(['timing-guard']);
    expect(result.expiredExemptions).toHaveLength(1);
  });

  it("never matches a different story's own exemption, even for the identical bare test name", () => {
    const result = applyExemptions(
      'STORY-002',
      ['timing-guard'],
      [exemption({ testId: 'STORY-001: timing-guard' })],
      '2026-09-30',
    );
    expect(result.nonBinding).toEqual(['timing-guard']);
    expect(result.staleExemptions).toEqual([]);
    expect(result.expiredExemptions).toEqual([]);
  });
});

describe('describeExemptionProblems', () => {
  it('names a stale exemption by its own testId and id', () => {
    const problems = describeExemptionProblems({
      nonBinding: [],
      staleExemptions: [exemption()],
      expiredExemptions: [],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('STORY-001: timing-guard');
    expect(problems[0]).toContain('EXEMPT-001');
    expect(problems[0]).toContain('stale');
  });

  it('names an expired exemption by its own testId, id, owner and expiry', () => {
    const problems = describeExemptionProblems({
      nonBinding: [],
      staleExemptions: [],
      expiredExemptions: [exemption({ expiry: '2026-01-01' })],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('STORY-001: timing-guard');
    expect(problems[0]).toContain('alice');
    expect(problems[0]).toContain('2026-01-01');
  });

  it('is empty when nothing is stale or expired', () => {
    expect(
      describeExemptionProblems({ nonBinding: [], staleExemptions: [], expiredExemptions: [] }),
    ).toEqual([]);
  });
});
