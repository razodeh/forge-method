/**
 * `withCollectionLock`'s own write-time fencing — a REAL, instrumented regression test for the
 * confirmed, previously-unknown race the investigation this fix closes found: under dense,
 * synchronous create/delete churn against the identical lock-file path, two concurrent `wx`-flagged
 * exclusive creates can BOTH report success, with neither ever seeing `EEXIST`. That specific OS-level
 * anomaly is itself NOT reliably reproducible in an ordinary, deterministic unit test (the investigation
 * confirmed it needs many real OS processes doing dense synchronous metadata churn, not a shape a
 * single-process `vitest` test can recreate on demand) — so this file proves the two things that
 * actually matter, the way the investigation itself recommends: (1) a direct demonstration of the BAD
 * OUTCOME the anomaly causes when nothing re-checks ownership before a write commits (the exact
 * vulnerability class, triggered deterministically by injecting the anomaly's own observable
 * post-condition — the lock file naming a different pid mid-`operation` — rather than its rare root
 * cause), and (2) that `verifyFence`/`withCollectionLock`'s new write-time check closes it: the stale
 * write never lands, and a full, fresh re-acquire-and-recompute produces the correct, non-corrupted
 * result instead.
 *
 * @see SPEC-QUESTIONS.md Q285
 * @see GAUNTLET-LOG.md ## M15 P6
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { ProjectPaths, type Clock } from '@forge/core';
import { ForgeError } from '@forge/core/errors';
import { afterEach, describe, expect, it } from 'vitest';

import { LockFenceLostError, withCollectionLock } from '../../src/commands/collection-lock.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function freshProject(): Promise<ProjectPaths> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-collection-lock-'));
  dirs.push(dir);
  return new ProjectPaths(dir);
}

function fakeClock(now = '2026-10-28T00:00:00.000Z'): Clock {
  return { now: () => now };
}

function onExhausted(maxAttempts: number): ForgeError {
  return new ForgeError('GATE-515', { testId: '', reason: 'lock-exhausted', max: maxAttempts });
}

/** A real, genuinely-dead pid — spawned then confirmed exited — standing in for "the other process
 * that won the double-create race has since finished and released," the same real shape a genuine
 * winner of that race would eventually leave behind. Using a real, once-live, now-dead pid (not a
 * fabricated number like `999999`) keeps this test honest about what `isProcessAlive` actually sees. */
async function realDeadPid(): Promise<number> {
  const child = spawn('node', ['-e', 'process.exit(0)']);
  const pid = child.pid;
  if (pid === undefined) throw new Error('child process has no pid');
  await new Promise((resolve) => child.on('exit', resolve));
  return pid;
}

describe('withCollectionLock — write-time fencing closes the confirmed double-create race', () => {
  it(
    'WITHOUT a write-time fence check: a lock file reassigned to a different process mid-operation ' +
      'lets a stale write silently overwrite a concurrent write (the exact confirmed data-loss shape)',
    async () => {
      const paths = await freshProject();
      const dataPath = paths.resolveState('shared.json');
      const otherPid = await realDeadPid();

      // Seed the shared "collection" file the way a real operation's own read-modify-write would find
      // it before any writer has ever touched it.
      await withCollectionLock(paths, fakeClock(), 'test.lock', onExhausted, () => {
        writeFileSync(dataPath, JSON.stringify(['seed']));
        return Promise.resolve();
      });

      // One full withCollectionLock call whose own `operation` deliberately does NOT call
      // `verifyFence` before its write -- reproducing, on purpose, exactly the vulnerable shape this
      // fix closes (every real production caller DOES call it now; this is the counterfactual).
      await withCollectionLock(paths, fakeClock(), 'test.lock', onExhausted, () => {
        const before = JSON.parse(readFileSync(dataPath, 'utf8')) as string[];

        // THE INJECTED ANOMALY: between this process's own read above and its write below, the
        // confirmed real race fires -- another process's own independently-successful `wx` create
        // lands, that other process performs its own full, legitimate read-modify-write of the
        // SAME shared file (adding its own entry), and then releases. This process's own in-flight
        // `operation` has no way to observe any of that through its own already-completed read.
        const resolved = paths.resolveState('test.lock');
        writeFileSync(resolved, String(otherPid));
        const concurrentWrite = [...before, 'concurrent-writer-entry'];
        writeFileSync(dataPath, JSON.stringify(concurrentWrite));
        writeFileSync(resolved, String(process.pid)); // the other process "hands back" the lock file

        // No `verifyFence()` call here -- the pre-fix shape. This process now commits its OWN
        // candidate, computed from the STALE `before` read, clobbering the concurrent writer's
        // entry outright.
        const staleCandidate = [...before, 'this-process-entry'];
        writeFileSync(dataPath, JSON.stringify(staleCandidate));
        return Promise.resolve();
      });

      const final = JSON.parse(readFileSync(dataPath, 'utf8')) as string[];
      // THE BUG, DIRECTLY DEMONSTRATED: the concurrent writer's own entry is gone. This is the exact
      // "20 distinct ids expected, 16 observed" shape the real CI failure this fix closes showed.
      expect(final).not.toContain('concurrent-writer-entry');
      expect(final).toContain('this-process-entry');
    },
  );

  it(
    'WITH write-time fencing: the identical injected anomaly is detected, the stale write never ' +
      'lands, and a full re-acquire-and-recompute preserves BOTH writers instead of losing one',
    async () => {
      const paths = await freshProject();
      const dataPath = paths.resolveState('shared.json');
      const otherPid = await realDeadPid();

      await withCollectionLock(paths, fakeClock(), 'test.lock', onExhausted, () => {
        writeFileSync(dataPath, JSON.stringify(['seed']));
        return Promise.resolve();
      });

      let callCount = 0;
      const result = await withCollectionLock(
        paths,
        fakeClock(),
        'test.lock',
        onExhausted,
        async (verifyFence) => {
          callCount += 1;
          const before = JSON.parse(readFileSync(dataPath, 'utf8')) as string[];

          if (callCount === 1) {
            // THE IDENTICAL INJECTED ANOMALY as the test above: the lock file is reassigned to a
            // different, real pid mid-operation, and a concurrent writer's own legitimate entry
            // lands in the shared file, before this process's own write would otherwise commit.
            const resolved = paths.resolveState('test.lock');
            writeFileSync(resolved, String(otherPid));
            const concurrentWrite = [...before, 'concurrent-writer-entry'];
            writeFileSync(dataPath, JSON.stringify(concurrentWrite));

            // THE FIX: `verifyFence` is called immediately before the real write would commit, and
            // it must throw -- this process can no longer prove it holds the lock.
            await expect(verifyFence()).rejects.toThrow(LockFenceLostError);

            // The lock file still names `otherPid`, not this process -- release it now (standing in
            // for that other, real process genuinely finishing and releasing on its own), so the
            // retry below's own fresh acquire can win it honestly.
            await rm(resolved, { force: true });

            // Propagate the SAME error `verifyFence` itself threw -- this is exactly what a real
            // caller does (never swallows a fence loss, never retries just the write).
            throw new LockFenceLostError('test.lock');
          }

          // SECOND call (the full re-acquire this fix exists to force): must see the CONCURRENT
          // writer's entry that landed during the first attempt -- proof this is a genuinely fresh
          // read, not a replay of stale data.
          expect(before).toContain('concurrent-writer-entry');
          await verifyFence();
          const candidate = [...before, 'this-process-entry'];
          writeFileSync(dataPath, JSON.stringify(candidate));
          return 'committed';
        },
      );

      expect(result).toBe('committed');
      expect(callCount).toBe(2);
      const final = JSON.parse(readFileSync(dataPath, 'utf8')) as string[];
      // THE FIX, DIRECTLY DEMONSTRATED: neither writer's entry is lost -- the exact outcome the
      // pre-fix test immediately above proves does NOT hold without this mechanism.
      expect(final).toContain('concurrent-writer-entry');
      expect(final).toContain('this-process-entry');
    },
  );

  it('verifyFence passes silently when nothing has disturbed the lock (the ordinary, overwhelmingly common case)', async () => {
    const paths = await freshProject();
    let fenceCalls = 0;
    const result = await withCollectionLock(
      paths,
      fakeClock(),
      'test.lock',
      onExhausted,
      async (verifyFence) => {
        await verifyFence();
        fenceCalls += 1;
        return 'ok';
      },
    );
    expect(result).toBe('ok');
    expect(fenceCalls).toBe(1);
  });

  it('a genuine, unrelated operation failure still releases the lock normally (fencing never changes ordinary error handling)', async () => {
    const paths = await freshProject();
    await expect(
      withCollectionLock(paths, fakeClock(), 'test.lock', onExhausted, () => {
        throw new RangeError('unrelated failure');
      }),
    ).rejects.toThrow(RangeError);

    // The lock must have been released despite the failure -- a second call must acquire cleanly and
    // quickly, not wait out a lock this process itself failed to release.
    const result = await withCollectionLock(paths, fakeClock(), 'test.lock', onExhausted, () =>
      Promise.resolve('reacquired'),
    );
    expect(result).toBe('reacquired');
  });
});
