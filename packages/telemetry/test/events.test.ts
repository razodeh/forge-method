/**
 * `appendEvent`/`readEvents` — `PLAN-M5.md` P6's own Checks section, verbatim.
 *
 * @see specs/18 §18.4
 * @see specs/18 §18.10
 * @see specs/20 §20.10 S3
 * @see PLAN-M5.md P6
 */
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import fsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { TS_NODE_FLAG } from '../../../scripts/lib/node-ts-flag.mjs';
import { TelemetryError } from '../src/errors.ts';
import {
  appendEvent,
  errorCode,
  errorMessage,
  eventLogPath,
  readEvents,
  type ForgeEvent,
  type NewForgeEvent,
} from '../src/events.ts';

/** Permission-based failures behave differently for root (bypasses permission checks entirely) and on
 * Windows (no POSIX permission bits) — the same guard `@forge/vcs`'s own permission tests use. */
const canTestPermissionFailures = process.platform !== 'win32' && process.getuid?.() !== 0;

async function createTempProjectRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'forge-telemetry-events-'));
}

function eventLogFilePath(projectRoot: string, runId: string): string {
  return path.join(projectRoot, '.forge', 'state', 'runs', runId, 'events.ndjson');
}

/** Writes a hand-crafted event log file directly, bypassing `appendEvent` — for constructing corrupt or
 * gapped state `appendEvent` itself would never produce. Creates the parent directory first, since
 * (unlike `appendEvent`) a raw `writeFile` does not. */
async function writeRawEventLog(
  projectRoot: string,
  runId: string,
  content: string,
): Promise<void> {
  const filePath = eventLogFilePath(projectRoot, runId);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

function baseEvent(overrides: Partial<NewForgeEvent> = {}): NewForgeEvent {
  return {
    ts: '2026-01-01T00:00:00.000Z',
    runId: 'run-1',
    type: 'RunStarted',
    payload: {},
    ...overrides,
  };
}

async function collectEvents(projectRoot: string, runId: string): Promise<ForgeEvent[]> {
  const events: ForgeEvent[] = [];
  for await (const event of readEvents(projectRoot, runId)) {
    events.push(event);
  }
  return events;
}

describe('appendEvent', () => {
  it('assigns seq 1 to the first event of a new run', async () => {
    const projectRoot = await createTempProjectRoot();

    const result = await appendEvent(projectRoot, 'run-1', baseEvent());

    expect(result.seq).toBe(1);
    expect(result.v).toBe(1);
  });

  it('assigns sequential seq to successive events', async () => {
    const projectRoot = await createTempProjectRoot();

    const first = await appendEvent(projectRoot, 'run-1', baseEvent());
    const second = await appendEvent(projectRoot, 'run-1', baseEvent({ type: 'RunCompleted' }));

    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
  });

  it('redacts a pattern-matched key before the bytes ever hit disk, not just in the returned value', async () => {
    const projectRoot = await createTempProjectRoot();

    await appendEvent(
      projectRoot,
      'run-1',
      baseEvent({ payload: { apiKey: 'sk-abc123', safe: 'unchanged' } }),
      { redactPatterns: [/api[_-]?key/i] },
    );

    const raw = await readFile(eventLogFilePath(projectRoot, 'run-1'), 'utf8');
    expect(raw).not.toContain('sk-abc123');
    const parsed: unknown = JSON.parse(raw.trim());
    expect(parsed).toMatchObject({ payload: { apiKey: '[REDACTED]', safe: 'unchanged' } });
  });

  it('redacts a known-secret value before the bytes ever hit disk', async () => {
    const projectRoot = await createTempProjectRoot();

    await appendEvent(projectRoot, 'run-1', baseEvent({ payload: { token: 'sk-abc123' } }), {
      knownSecrets: ['sk-abc123'],
    });

    const raw = await readFile(eventLogFilePath(projectRoot, 'run-1'), 'utf8');
    expect(raw).not.toContain('sk-abc123');
  });

  it('rejects a circular payload with a TelemetryError, not an unhandled RangeError, and does not corrupt the run for a later, valid append', async () => {
    const projectRoot = await createTempProjectRoot();
    const runId = 'run-circular-payload';
    const circular: Record<string, unknown> = { name: 'story-014' };
    circular['self'] = circular;

    let caught: unknown;
    try {
      await appendEvent(projectRoot, runId, baseEvent({ runId, payload: circular }));
    } catch (error) {
      caught = error;
    }

    if (!(caught instanceof TelemetryError)) {
      throw new Error(
        `expected appendEvent to reject with a TelemetryError, got ${String(caught)}`,
      );
    }
    expect(caught.code).toBe('TELEMETRY-PAYLOAD-CIRCULAR');

    // The rejected attempt never got far enough to touch the seq cache or the file: a later, valid
    // append for the same run correctly starts fresh at seq 1, not stuck or corrupted.
    const first = await appendEvent(projectRoot, runId, baseEvent({ runId }));
    expect(first.seq).toBe(1);
  });

  it('assigns gapless, monotonic seq under real concurrency, not just sequential awaits', async () => {
    const projectRoot = await createTempProjectRoot();
    const runId = 'run-concurrent';

    const results = await Promise.all(
      Array.from({ length: 25 }, (_unused, i) =>
        appendEvent(projectRoot, runId, baseEvent({ payload: { i } })),
      ),
    );

    const seqs = results.map((r) => r.seq).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 25 }, (_unused, i) => i + 1));

    const readBack = await collectEvents(projectRoot, runId);
    expect(readBack.map((e) => e.seq)).toEqual(Array.from({ length: 25 }, (_unused, i) => i + 1));
  });

  it('serialises independently per run: two different runIds append concurrently without interfering', async () => {
    const projectRoot = await createTempProjectRoot();

    const [runAResults, runBResults] = await Promise.all([
      Promise.all(
        Array.from({ length: 10 }, () =>
          appendEvent(projectRoot, 'run-a', baseEvent({ runId: 'run-a' })),
        ),
      ),
      Promise.all(
        Array.from({ length: 10 }, () =>
          appendEvent(projectRoot, 'run-b', baseEvent({ runId: 'run-b' })),
        ),
      ),
    ]);

    expect(runAResults.map((r) => r.seq).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 10 }, (_unused, i) => i + 1),
    );
    expect(runBResults.map((r) => r.seq).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 10 }, (_unused, i) => i + 1),
    );
  });

  it('does not collide the per-run cache key for two different (projectRoot, runId) pairs that would concatenate identically if it were space-joined', async () => {
    const parent = await createTempProjectRoot();
    // Under a naive `${projectRoot} ${runId}` join, "<parent>/a b" + "c" and "<parent>/a" + "b c" would
    // both produce the identical string "<parent>/a b c" — a real, not hypothetical, risk given a
    // filesystem path can ordinarily contain a space (e.g. "/Users/Jane Doe/project").
    const projectRootA = path.join(parent, 'a b');
    const projectRootC = path.join(parent, 'a');

    const resultA = await appendEvent(projectRootA, 'c', baseEvent({ runId: 'c' }));
    const resultC = await appendEvent(projectRootC, 'b c', baseEvent({ runId: 'b c' }));

    // Both must independently be the first event of their own, genuinely distinct run — a collided
    // cache key would make the second call incorrectly see the first's own seq 1 and continue as seq 2.
    expect(resultA.seq).toBe(1);
    expect(resultC.seq).toBe(1);
  });

  it(
    'always determines the next seq from the real, current file on disk, never from an in-process ' +
      'cache of its own last write — specs/22 M15 P14 found the cache this test used to assert ' +
      '(an earlier version of this test) unsafe the instant a second real process can also append ' +
      'to the same run (a real duplicate seq, reproduced live): deleting the file out from under this ' +
      'process must be read as "no prior events", exactly as a genuinely fresh process would, not as ' +
      '"my own cached seq is still correct"',
    async () => {
      const projectRoot = await createTempProjectRoot();
      const runId = 'run-cache-check';

      const first = await appendEvent(projectRoot, runId, baseEvent({ runId }));
      expect(first.seq).toBe(1);

      await rm(eventLogFilePath(projectRoot, runId));

      const second = await appendEvent(projectRoot, runId, baseEvent({ runId }));
      expect(second.seq).toBe(1);
    },
  );

  it('a real SIGKILL of the writing process immediately after it signals success does not lose the appended event — see the direct structural proof of the fsync-await ordering below for the specific "fsync itself" guarantee this alone cannot isolate', async () => {
    // What this test actually proves, and what it does not: a killed *process* never evicts the
    // OS's own page cache, which this same-machine parent process's own reread draws from — so this
    // is a real, meaningful proof that the write reaches the OS at all before appendEvent resolves,
    // but confirmed empirically (via three separate mutations — a fire-and-forget sync, sync removed
    // entirely, an unawaited write) that it cannot, by construction, distinguish "genuinely fsync'd"
    // from "merely written to the OS's own buffer" — only a real machine/VM crash or power loss could
    // do that, which isn't practically testable here. The test directly below this one exists
    // specifically to close that gap: it proves the `await handle.sync()` ordering structurally,
    // which is exactly what those three mutations broke.
    const projectRoot = await createTempProjectRoot();
    const runId = 'run-fsync-kill';
    const fixturePath = fileURLToPath(new URL('./fixtures/append-and-hang.ts', import.meta.url));

    await new Promise<void>((resolve, reject) => {
      const child = spawn('node', [TS_NODE_FLAG, fixturePath, projectRoot, runId]);
      let stderr = '';
      let killed = false;
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.stdout.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('APPENDED') && !killed) {
          killed = true;
          child.kill('SIGKILL');
        }
      });
      child.on('error', reject);
      child.on('exit', (code, signal) => {
        if (killed) {
          resolve();
        } else {
          reject(
            new Error(
              `fixture process exited before signaling completion: code ${String(code)}, signal ${String(signal)}, stderr: ${stderr}`,
            ),
          );
        }
      });
    });

    const events = await collectEvents(projectRoot, runId);
    expect(events).toHaveLength(1);
    expect(events[0]?.seq).toBe(1);
    expect(events[0]?.payload).toEqual({ marker: 'fsync-durability-check' });
  }, 15_000);

  it('structurally proves appendEvent awaits fsync itself, not merely calling it fire-and-forget', async () => {
    // FileHandle isn't exported from node:fs/promises, so its prototype is reached via a throwaway
    // probe instance instead — confirmed empirically that every handle shares the same prototype
    // object, so patching it here affects the real handle appendLineWithFsync opens internally too.
    const projectRoot = await createTempProjectRoot();
    const probeFile = path.join(projectRoot, 'probe.txt');
    await writeFile(probeFile, 'x');
    const probeHandle = await open(probeFile, 'r');
    // `Object.getPrototypeOf` is typed `any` in TS's own lib; FileHandle's own real shape is trusted
    // here since it's the actual prototype of a real, just-opened handle, not a guess.
    const proto = Object.getPrototypeOf(probeHandle) as { sync: () => Promise<void> };
    await probeHandle.close();

    let resolveSync: (() => void) | undefined;
    let resolveSyncCalled: (() => void) | undefined;
    const syncCalled = new Promise<void>((resolve) => {
      resolveSyncCalled = resolve;
    });
    const syncSpy = vi.spyOn(proto, 'sync').mockImplementation(() => {
      resolveSyncCalled?.();
      return new Promise<void>((resolve) => {
        resolveSync = resolve;
      });
    });

    try {
      let appendResolved = false;
      const appendPromise = appendEvent(projectRoot, 'run-1', baseEvent()).then(() => {
        appendResolved = true;
      });

      await syncCalled;
      // Still pending while sync()'s own promise is: if appendLineWithFsync only *called* sync()
      // without awaiting it (the fire-and-forget mutation the previous test's own docstring names),
      // appendResolved would already be true here.
      expect(appendResolved).toBe(false);

      resolveSync?.();
      await appendPromise;
      expect(appendResolved).toBe(true);
    } finally {
      syncSpy.mockRestore();
    }
  });

  it('rolls back a write whose subsequent fsync failed, so the file on disk matches what the caller was actually told', async () => {
    const projectRoot = await createTempProjectRoot();
    const runId = 'run-sync-failure';
    const probeFile = path.join(projectRoot, 'probe.txt');
    await writeFile(probeFile, 'x');
    const probeHandle = await open(probeFile, 'r');
    const proto = Object.getPrototypeOf(probeHandle) as { sync: () => Promise<void> };
    await probeHandle.close();

    const first = await appendEvent(projectRoot, runId, baseEvent({ runId }));
    expect(first.seq).toBe(1);
    const sizeAfterFirst = (await readFile(eventLogFilePath(projectRoot, runId), 'utf8')).length;

    const syncSpy = vi
      .spyOn(proto, 'sync')
      .mockImplementationOnce(() => Promise.reject(new Error('simulated fsync failure')));

    let caught: unknown;
    try {
      await appendEvent(projectRoot, runId, baseEvent({ runId }));
    } catch (error) {
      caught = error;
    } finally {
      syncSpy.mockRestore();
    }

    if (!(caught instanceof TelemetryError)) {
      throw new Error(
        `expected appendEvent to reject with a TelemetryError, got ${String(caught)}`,
      );
    }
    expect(caught.code).toBe('TELEMETRY-EVENT-LOG-WRITE-FAILED');
    expect(caught.message).toContain('simulated fsync failure');

    const rawAfterFailure = await readFile(eventLogFilePath(projectRoot, runId), 'utf8');
    // The failed write's own bytes must not remain on disk: rolled back to exactly the pre-write size,
    // not left as a visible-but-unconfirmed append.
    expect(rawAfterFailure.length).toBe(sizeAfterFirst);

    // A later, successful append still continues from the correct seq, proving the failed attempt did
    // not also corrupt the in-memory last-seq cache.
    const second = await appendEvent(projectRoot, runId, baseEvent({ runId }));
    expect(second.seq).toBe(2);
  });

  it("still surfaces the original fsync failure, not the rollback attempt's own failure, when both fail", async () => {
    const projectRoot = await createTempProjectRoot();
    const runId = 'run-sync-and-truncate-failure';
    const probeFile = path.join(projectRoot, 'probe.txt');
    await writeFile(probeFile, 'x');
    const probeHandle = await open(probeFile, 'r');
    const proto = Object.getPrototypeOf(probeHandle) as {
      sync: () => Promise<void>;
      truncate: (len?: number) => Promise<void>;
    };
    await probeHandle.close();

    const first = await appendEvent(projectRoot, runId, baseEvent({ runId }));
    expect(first.seq).toBe(1);

    const syncSpy = vi
      .spyOn(proto, 'sync')
      .mockImplementationOnce(() => Promise.reject(new Error('simulated fsync failure')));
    const truncateSpy = vi
      .spyOn(proto, 'truncate')
      .mockImplementationOnce(() => Promise.reject(new Error('simulated truncate failure')));

    let caught: unknown;
    try {
      await appendEvent(projectRoot, runId, baseEvent({ runId }));
    } catch (error) {
      caught = error;
    } finally {
      syncSpy.mockRestore();
      truncateSpy.mockRestore();
    }

    // The rollback's own best-effort .catch(() => undefined) swallows the truncate failure entirely --
    // what a caller actually sees must still be the original, more important diagnostic (why the write
    // was rejected in the first place), never silently replaced by a failure in the cleanup attempt.
    if (!(caught instanceof TelemetryError)) {
      throw new Error(
        `expected appendEvent to reject with a TelemetryError, got ${String(caught)}`,
      );
    }
    expect(caught.code).toBe('TELEMETRY-EVENT-LOG-WRITE-FAILED');
    expect(caught.message).toContain('simulated fsync failure');

    // The double failure leaves a fully well-formed, newline-terminated "phantom" line for this seq
    // physically on disk (only the fsync confirmation and the rollback failed -- the write itself, with
    // its own trailing newline, landed) -- confirmed by reading the raw file directly.
    const rawAfterDoubleFailure = await readFile(eventLogFilePath(projectRoot, runId), 'utf8');
    expect(rawAfterDoubleFailure).toContain('"seq":2');

    // The real regression this once caused: a later, successful append must not reuse this same seq and
    // collide with the phantom already on disk. Trusting a stale in-memory cache after the failed
    // attempt did exactly that; the cache must be invalidated so this call re-derives the truth from disk.
    const second = await appendEvent(projectRoot, runId, baseEvent({ runId }));
    expect(second.seq).toBe(3);

    // And the run's history must stay fully, cleanly readable -- no seq-gap error from two on-disk lines
    // both claiming the same sequence number.
    const events = await collectEvents(projectRoot, runId);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
  });
});

describe('assertSafeRunId — via appendEvent and readEvents', () => {
  it.each(['../escape', 'a/b', 'a\\b', '.', '..'])(
    'rejects a runId of %s as a path-traversal risk, before appendEvent touches the filesystem',
    async (runId) => {
      const projectRoot = await createTempProjectRoot();

      let caught: unknown;
      try {
        await appendEvent(projectRoot, runId, baseEvent({ runId }));
      } catch (error) {
        caught = error;
      }

      if (!(caught instanceof TelemetryError)) {
        throw new Error(
          `expected appendEvent to reject with a TelemetryError, got ${String(caught)}`,
        );
      }
      expect(caught.code).toBe('TELEMETRY-INVALID-RUN-ID');
    },
  );

  it('rejects an empty-string runId, rather than silently sharing one file across every caller that passes one', async () => {
    const projectRoot = await createTempProjectRoot();

    let caught: unknown;
    try {
      await appendEvent(projectRoot, '', baseEvent({ runId: '' }));
    } catch (error) {
      caught = error;
    }

    if (!(caught instanceof TelemetryError)) {
      throw new Error(
        `expected appendEvent to reject with a TelemetryError, got ${String(caught)}`,
      );
    }
    expect(caught.code).toBe('TELEMETRY-INVALID-RUN-ID');
  });

  it('rejects the same unsafe runId in readEvents, before attempting to read any file', async () => {
    const projectRoot = await createTempProjectRoot();

    let caught: unknown;
    try {
      await collectEvents(projectRoot, '../escape');
    } catch (error) {
      caught = error;
    }

    if (!(caught instanceof TelemetryError)) {
      throw new Error(`expected readEvents to reject with a TelemetryError, got ${String(caught)}`);
    }
    expect(caught.code).toBe('TELEMETRY-INVALID-RUN-ID');
  });

  it('does not create anything outside the project root for a path-traversal runId', async () => {
    const projectRoot = await createTempProjectRoot();
    const escapedPath = path.join(projectRoot, '..', 'forge-telemetry-escape-check.ndjson');

    try {
      await appendEvent(projectRoot, '../forge-telemetry-escape-check.ndjson', baseEvent());
    } catch {
      // Expected: assertSafeRunId rejects before any fs write is attempted.
    }

    await expect(readFile(escapedPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('readEvents', () => {
  it('round-trips appended events, including optional fields, structurally intact', async () => {
    const projectRoot = await createTempProjectRoot();
    const written = await appendEvent(projectRoot, 'run-1', {
      ts: '2026-01-01T00:00:00.000Z',
      runId: 'run-1',
      type: 'StepStarted',
      stepId: 'story-014:implement',
      laneId: 'run-1-abc123',
      agentId: 'engineer',
      idempotencyKey: 'idem-1',
      payload: { detail: 'starting' },
      causedBy: 0,
    });

    const events = await collectEvents(projectRoot, 'run-1');

    expect(events).toEqual([written]);
  });

  it('yields nothing, not an error, for a run with no event log yet', async () => {
    const projectRoot = await createTempProjectRoot();

    const events = await collectEvents(projectRoot, 'run-never-started');

    expect(events).toEqual([]);
  });

  it('throws a TelemetryError naming a seq gap between two otherwise well-formed events', async () => {
    const projectRoot = await createTempProjectRoot();
    await writeRawEventLog(
      projectRoot,
      'run-1',
      `${JSON.stringify({ v: 1, seq: 1, ts: 't', runId: 'run-1', type: 'RunStarted', payload: {} })}\n` +
        `${JSON.stringify({ v: 1, seq: 3, ts: 't', runId: 'run-1', type: 'RunCompleted', payload: {} })}\n`,
    );

    let caught: unknown;
    try {
      await collectEvents(projectRoot, 'run-1');
    } catch (error) {
      caught = error;
    }

    if (!(caught instanceof TelemetryError)) {
      throw new Error(`expected readEvents to reject with a TelemetryError, got ${String(caught)}`);
    }
    expect(caught.code).toBe('TELEMETRY-EVENT-LOG-SEQ-GAP');
    expect(caught.message).toContain('expected 2');
    expect(caught.message).toContain('found 3');
  });

  it('throws a TelemetryError when the very first event does not start at seq 1', async () => {
    const projectRoot = await createTempProjectRoot();
    await writeRawEventLog(
      projectRoot,
      'run-1',
      `${JSON.stringify({ v: 1, seq: 2, ts: 't', runId: 'run-1', type: 'RunStarted', payload: {} })}\n`,
    );

    let caught: unknown;
    try {
      await collectEvents(projectRoot, 'run-1');
    } catch (error) {
      caught = error;
    }

    if (!(caught instanceof TelemetryError)) {
      throw new Error(`expected readEvents to reject with a TelemetryError, got ${String(caught)}`);
    }
    expect(caught.code).toBe('TELEMETRY-EVENT-LOG-SEQ-GAP');
  });

  it('throws a TelemetryError for a line that is not valid JSON', async () => {
    const projectRoot = await createTempProjectRoot();
    await writeRawEventLog(projectRoot, 'run-1', 'not { valid json at all\n');

    let caught: unknown;
    try {
      await collectEvents(projectRoot, 'run-1');
    } catch (error) {
      caught = error;
    }

    if (!(caught instanceof TelemetryError)) {
      throw new Error(`expected readEvents to reject with a TelemetryError, got ${String(caught)}`);
    }
    expect(caught.code).toBe('TELEMETRY-EVENT-LOG-CORRUPT');
  });

  it('throws a TelemetryError for a well-formed JSON line that is missing seq', async () => {
    const projectRoot = await createTempProjectRoot();
    await writeRawEventLog(
      projectRoot,
      'run-1',
      `${JSON.stringify({ v: 1, ts: 't', runId: 'run-1', type: 'RunStarted', payload: {} })}\n`,
    );

    let caught: unknown;
    try {
      await collectEvents(projectRoot, 'run-1');
    } catch (error) {
      caught = error;
    }

    if (!(caught instanceof TelemetryError)) {
      throw new Error(`expected readEvents to reject with a TelemetryError, got ${String(caught)}`);
    }
    expect(caught.code).toBe('TELEMETRY-EVENT-LOG-CORRUPT');
  });

  it.each([1.5, -1, 0])(
    'throws a TelemetryError for a well-formed JSON line whose seq is %s, not a positive integer',
    async (seq) => {
      const projectRoot = await createTempProjectRoot();
      await writeRawEventLog(
        projectRoot,
        'run-1',
        `${JSON.stringify({ v: 1, seq, ts: 't', runId: 'run-1', type: 'RunStarted', payload: {} })}\n`,
      );

      let caught: unknown;
      try {
        await collectEvents(projectRoot, 'run-1');
      } catch (error) {
        caught = error;
      }

      if (!(caught instanceof TelemetryError)) {
        throw new Error(
          `expected readEvents to reject with a TelemetryError, got ${String(caught)}`,
        );
      }
      expect(caught.code).toBe('TELEMETRY-EVENT-LOG-CORRUPT');
    },
  );

  // `canTestPermissionFailures` (top of file): chmod 0o000 has no Windows ACL equivalent, and root
  // ignores POSIX permission bits entirely — see `packages/vcs/test/git.test.ts`'s identical
  // precedent for the same class of mechanism.
  it.skipIf(!canTestPermissionFailures)(
    'propagates a genuine, non-ENOENT read failure as a TelemetryError, not silently treated as "no log yet"',
    async () => {
      const projectRoot = await createTempProjectRoot();
      const runId = 'run-unreadable-read';
      await writeRawEventLog(
        projectRoot,
        runId,
        `${JSON.stringify({ v: 1, seq: 1, ts: 't', runId, type: 'RunStarted', payload: {} })}\n`,
      );
      const filePath = eventLogFilePath(projectRoot, runId);
      await chmod(filePath, 0o000);

      let caught: unknown;
      try {
        await collectEvents(projectRoot, runId);
      } catch (error) {
        caught = error;
      } finally {
        await chmod(filePath, 0o600);
      }

      if (!(caught instanceof TelemetryError)) {
        throw new Error(
          `expected readEvents to reject with a TelemetryError, got ${String(caught)}`,
        );
      }
      expect(caught.code).toBe('TELEMETRY-EVENT-LOG-READ-FAILED');
    },
  );
});

describe('appendEvent — resilience', () => {
  // `canTestPermissionFailures` (top of file): chmod 0o400 has no Windows ACL equivalent, and root
  // ignores POSIX permission bits entirely — see `packages/vcs/test/git.test.ts`'s identical
  // precedent for the same class of mechanism.
  it.skipIf(!canTestPermissionFailures)(
    'a failed append (after successfully determining the next seq from a pre-existing file) does not wedge the per-run queue for a later, successful append',
    async () => {
      const projectRoot = await createTempProjectRoot();
      const runId = 'run-queue-resilience';
      await writeRawEventLog(
        projectRoot,
        runId,
        `${JSON.stringify({ v: 1, seq: 1, ts: 't', runId, type: 'RunStarted', payload: {} })}\n`,
      );
      const filePath = eventLogFilePath(projectRoot, runId);
      // Read-only: determineLastSeq can still read the file to find the existing seq 1, but the actual
      // append (opening the same file for write) fails — a real, non-hypothetical append failure.
      await chmod(filePath, 0o400);

      let firstCaught: unknown;
      try {
        await appendEvent(projectRoot, runId, baseEvent({ runId }));
      } catch (error) {
        firstCaught = error;
      }
      if (!(firstCaught instanceof TelemetryError)) {
        throw new Error(
          `expected appendEvent to reject with a TelemetryError, got ${String(firstCaught)}`,
        );
      }
      // A real, non-ENOENT open() failure in the write path itself (not the read-side, already covered
      // above) — confirmed wrapped into this module's own typed error, not left as a bare Node EACCES.
      expect(firstCaught.code).toBe('TELEMETRY-EVENT-LOG-WRITE-FAILED');

      await chmod(filePath, 0o600);
      const second = await appendEvent(projectRoot, runId, baseEvent({ runId }));
      // Correctly continues from the pre-existing file's own seq 1 (proving the first, failed attempt
      // never corrupted the cache), not stuck or restarted.
      expect(second.seq).toBe(2);
    },
  );

  // `canTestPermissionFailures` (top of file): chmod 0o000 has no Windows ACL equivalent, and root
  // ignores POSIX permission bits entirely — see `packages/vcs/test/git.test.ts`'s identical
  // precedent for the same class of mechanism.
  it.skipIf(!canTestPermissionFailures)(
    'determineLastSeq propagates a genuine, non-ENOENT read failure as a TelemetryError',
    async () => {
      const projectRoot = await createTempProjectRoot();
      const runId = 'run-unreadable-append';
      await writeRawEventLog(
        projectRoot,
        runId,
        `${JSON.stringify({ v: 1, seq: 1, ts: 't', runId, type: 'RunStarted', payload: {} })}\n`,
      );
      const filePath = eventLogFilePath(projectRoot, runId);
      await chmod(filePath, 0o000);

      let caught: unknown;
      try {
        await appendEvent(projectRoot, runId, baseEvent({ runId }));
      } catch (error) {
        caught = error;
      } finally {
        await chmod(filePath, 0o600);
      }

      if (!(caught instanceof TelemetryError)) {
        throw new Error(
          `expected appendEvent to reject with a TelemetryError, got ${String(caught)}`,
        );
      }
      expect(caught.code).toBe('TELEMETRY-EVENT-LOG-READ-FAILED');
    },
  );

  // `canTestPermissionFailures` (top of file): chmod 0o500 has no Windows ACL equivalent, and root
  // ignores POSIX permission bits entirely — see `packages/vcs/test/git.test.ts`'s identical
  // precedent for the same class of mechanism.
  it.skipIf(!canTestPermissionFailures)(
    "a failed mkdir for a brand-new run's own directory is wrapped as a TelemetryError, not left as a bare Node error",
    async () => {
      const projectRoot = await createTempProjectRoot();
      const runsDir = path.join(projectRoot, '.forge', 'state', 'runs');
      await mkdir(runsDir, { recursive: true });
      // No write permission on the parent: creating this brand-new run's own subdirectory underneath it
      // fails, a distinct code path from the "open an existing file" failure covered above.
      await chmod(runsDir, 0o500);

      let caught: unknown;
      try {
        await appendEvent(projectRoot, 'run-brand-new', baseEvent({ runId: 'run-brand-new' }));
      } catch (error) {
        caught = error;
      } finally {
        await chmod(runsDir, 0o700);
      }

      if (!(caught instanceof TelemetryError)) {
        throw new Error(
          `expected appendEvent to reject with a TelemetryError, got ${String(caught)}`,
        );
      }
      expect(caught.code).toBe('TELEMETRY-EVENT-LOG-WRITE-FAILED');
    },
  );

  it(
    '10 real, separate OS processes appending concurrently to the SAME run never produce a ' +
      "duplicate or gapped seq — specs/22 M15 P14's own real live run found exactly this race live " +
      '(two different events both claiming seq 44), reproducing the exact shape that found it: a ' +
      'spawned command-step-like subprocess writing telemetry at close to the same real moment another ' +
      "process writes for the same run, not a single process's own in-memory Promise.all",
    async () => {
      const projectRoot = await createTempProjectRoot();
      const runId = 'run-cross-process-concurrency';
      const fixturePath = fileURLToPath(new URL('./fixtures/append-many.ts', import.meta.url));
      const processCount = 10;
      const eventsPerProcess = 5;

      const runs = Array.from(
        { length: processCount },
        (_unused, index) =>
          new Promise<void>((resolve, reject) => {
            const child = spawn('node', [
              TS_NODE_FLAG,
              fixturePath,
              projectRoot,
              runId,
              String(eventsPerProcess),
              `proc-${String(index)}`,
            ]);
            let stderr = '';
            child.stderr.on('data', (chunk: Buffer) => {
              stderr += chunk.toString();
            });
            child.on('error', reject);
            child.on('exit', (code) => {
              if (code === 0) resolve();
              else
                reject(
                  new Error(`fixture process ${String(index)} exited ${String(code)}: ${stderr}`),
                );
            });
          }),
      );
      await Promise.all(runs);

      const events: ForgeEvent[] = [];
      for await (const event of readEvents(projectRoot, runId)) events.push(event);
      const seqs = events.map((event) => event.seq).sort((a, b) => a - b);
      const expectedTotal = processCount * eventsPerProcess;

      // Every real event actually landed (no silent loss — the opposite failure mode a naive fix
      // could introduce) ...
      expect(events).toHaveLength(expectedTotal);
      // ... each at its own distinct, real seq ...
      expect(new Set(seqs).size).toBe(expectedTotal);
      // ... forming the real, gapless 1..N run `readEvents` itself would otherwise throw on.
      expect(seqs).toEqual(Array.from({ length: expectedTotal }, (_unused, i) => i + 1));
    },
  );

  it(
    '16 real, separate OS processes racing hard for the SAME lock never produce a duplicate seq via ' +
      "a live owner's own empty-lock reclaim window -- a real CI failure on `next` " +
      "(`TelemetryError: ... has a seq gap: expected 20, found 19`) traced to `withEventLogLock`'s " +
      'own empty-lock age check: a losing process can observe EEXIST with empty content (a winning ' +
      "process's own just-created, not-yet-written lock for ITS OWN next event, not abandonment) and " +
      'then have its *own* `fsp.stat` of that same path genuinely reject ENOENT a moment later -- the ' +
      "winner's full create+write+close+release cycle is fast enough on a real disk to beat it -- at " +
      'which point the previous code treated "age could not be determined" the same as "definitely ' +
      'stale" and force-deleted the still-live winner\'s brand-new lock, letting the loser acquire ' +
      'while the winner was still mid-write and both compute the same seq. Reproduced directly this ' +
      'way (confirmed via timestamped instrumentation across many real runs); fixed by only ever ' +
      'reclaiming on a real, measured age over the threshold, never on "unknown". Higher concurrency ' +
      'and more rounds than the sibling test above -- more lock handoffs means more real chances to ' +
      "hit this exact window -- run repeatedly (not just once) to build real confidence this isn't " +
      'merely passing by luck.',
    async () => {
      const projectRoot = await createTempProjectRoot();
      const runId = 'run-cross-process-lock-handoff';
      const fixturePath = fileURLToPath(new URL('./fixtures/append-many.ts', import.meta.url));
      const processCount = 16;
      const eventsPerProcess = 8;

      const runs = Array.from(
        { length: processCount },
        (_unused, index) =>
          new Promise<void>((resolve, reject) => {
            const child = spawn('node', [
              TS_NODE_FLAG,
              fixturePath,
              projectRoot,
              runId,
              String(eventsPerProcess),
              `proc-${String(index)}`,
            ]);
            let stderr = '';
            child.stderr.on('data', (chunk: Buffer) => {
              stderr += chunk.toString();
            });
            child.on('error', reject);
            child.on('exit', (code) => {
              if (code === 0) resolve();
              else
                reject(
                  new Error(`fixture process ${String(index)} exited ${String(code)}: ${stderr}`),
                );
            });
          }),
      );
      await Promise.all(runs);

      const events: ForgeEvent[] = [];
      for await (const event of readEvents(projectRoot, runId)) events.push(event);
      const seqs = events.map((event) => event.seq).sort((a, b) => a - b);
      const expectedTotal = processCount * eventsPerProcess;

      // Same three real assertions as the sibling test: nothing lost, nothing duplicated, no gap --
      // `readEvents` above having thrown at all (rather than reaching these `expect`s) would itself
      // already be the real failure shape this guards against.
      expect(events).toHaveLength(expectedTotal);
      expect(new Set(seqs).size).toBe(expectedTotal);
      expect(seqs).toEqual(Array.from({ length: expectedTotal }, (_unused, i) => i + 1));
    },
  );
});

describe('errorCode', () => {
  it('returns the code of a code-bearing object', () => {
    expect(errorCode({ code: 'ENOENT' })).toBe('ENOENT');
    expect(errorCode(Object.assign(new Error('x'), { code: 'EACCES' }))).toBe('EACCES');
  });

  it('returns undefined for a value that is not a code-bearing object', () => {
    expect(errorCode(new Error('plain error, no code'))).toBeUndefined();
    expect(errorCode('a string')).toBeUndefined();
    expect(errorCode(null)).toBeUndefined();
    expect(errorCode(undefined)).toBeUndefined();
    expect(errorCode(42)).toBeUndefined();
  });
});

describe('errorMessage', () => {
  it('returns the message of a real Error', () => {
    expect(errorMessage(new Error('something broke'))).toBe('something broke');
  });

  it('stringifies a value that is not an Error', () => {
    expect(errorMessage('a plain string')).toBe('a plain string');
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage(null)).toBe('null');
    expect(errorMessage(undefined)).toBe('undefined');
  });
});

describe('determineLastSeq — via appendEvent', () => {
  it('treats a pre-existing but empty event log file as "no prior events", not corruption', async () => {
    const projectRoot = await createTempProjectRoot();
    const runId = 'run-empty-log';
    await writeRawEventLog(projectRoot, runId, '');

    const result = await appendEvent(projectRoot, runId, baseEvent({ runId }));

    expect(result.seq).toBe(1);
  });
});

describe('torn trailing write recovery', () => {
  it('readEvents silently skips a torn (no trailing newline) final line without throwing, and does not itself rewrite the file on disk', async () => {
    const projectRoot = await createTempProjectRoot();
    const runId = 'run-torn-read-only';
    const completeLine = JSON.stringify({
      v: 1,
      seq: 1,
      ts: 't',
      runId,
      type: 'RunStarted',
      payload: {},
    });
    // No trailing \n -- the shape a crash mid-write leaves behind: never observed as a successful
    // append by anything, including this same module's own reader.
    const tornFragment = '{"v":1,"seq":2,"ts":"t"';
    await writeRawEventLog(projectRoot, runId, `${completeLine}\n${tornFragment}`);

    const events = await collectEvents(projectRoot, runId);

    expect(events).toHaveLength(1);
    expect(events[0]?.seq).toBe(1);
    // readEvents itself never writes -- only appendEvent's own determineLastSeq path truncates a torn
    // write, so the fragment is still physically present until this run's next append.
    const raw = await readFile(eventLogFilePath(projectRoot, runId), 'utf8');
    expect(raw).toContain(tornFragment);
  });

  it('discards a torn final line on the next append, rather than gluing the new line onto the dangling fragment', async () => {
    const projectRoot = await createTempProjectRoot();
    const runId = 'run-torn-write';
    const completeLine = JSON.stringify({
      v: 1,
      seq: 1,
      ts: 't',
      runId,
      type: 'RunStarted',
      payload: {},
    });
    const tornFragment = `{"v":1,"seq":2,"ts":"t","runId":"${runId}","type":"RunCom`;
    await writeRawEventLog(projectRoot, runId, `${completeLine}\n${tornFragment}`);

    const appended = await appendEvent(projectRoot, runId, baseEvent({ runId }));

    // The torn fragment's own dangling "seq: 2" is discarded entirely, not trusted as a real prior
    // event -- the freshly appended event correctly becomes seq 2 itself, not seq 3.
    expect(appended.seq).toBe(2);

    const events = await collectEvents(projectRoot, runId);
    expect(events.map((e) => e.seq)).toEqual([1, 2]);

    const raw = await readFile(eventLogFilePath(projectRoot, runId), 'utf8');
    expect(raw).not.toContain('RunCom');
  });

  // `canTestPermissionFailures` (top of file): chmod 0o400 has no Windows ACL equivalent, and root
  // ignores POSIX permission bits entirely — see `packages/vcs/test/git.test.ts`'s identical
  // precedent for the same class of mechanism.
  it.skipIf(!canTestPermissionFailures)(
    'wraps a failure to recover a torn trailing write as a TelemetryError, not a bare Node error',
    async () => {
      const projectRoot = await createTempProjectRoot();
      const runId = 'run-torn-write-unrecoverable';
      const completeLine = JSON.stringify({
        v: 1,
        seq: 1,
        ts: 't',
        runId,
        type: 'RunStarted',
        payload: {},
      });
      const tornFragment = `{"v":1,"seq":2,"ts":"t","runId":"${runId}","type":"RunCom`;
      await writeRawEventLog(projectRoot, runId, `${completeLine}\n${tornFragment}`);
      const filePath = eventLogFilePath(projectRoot, runId);
      // Read-only: determineLastSeq can still read the file to find the torn fragment, but
      // truncateTornTrailingWrite's own attempt to rewrite the file with it removed fails.
      await chmod(filePath, 0o400);

      let caught: unknown;
      try {
        await appendEvent(projectRoot, runId, baseEvent({ runId }));
      } catch (error) {
        caught = error;
      } finally {
        await chmod(filePath, 0o600);
      }

      if (!(caught instanceof TelemetryError)) {
        throw new Error(
          `expected appendEvent to reject with a TelemetryError, got ${String(caught)}`,
        );
      }
      expect(caught.code).toBe('TELEMETRY-EVENT-LOG-WRITE-FAILED');
    },
  );
});

/**
 * `appendEvent`'s own repair-write fencing (fix 3, a round-2 critic finding): `determineLastSeq`'s own
 * `truncateTornTrailingWrite` repair -- a real, unfenced `fsp.open(filePath, 'w')` truncate-and-rewrite
 * of `events.ndjson` -- used to run entirely before `appendEvent`'s own main `verifyFence()` call,
 * leaving a narrower but real gap in the same category `module.ts`'s own `installBundleTree`/`rm` gap
 * was (fix 2): a real write to the lock-protected file the fencing mechanism did not reach. Unlike
 * `withCollectionLock`/`withManifestLock`, `verifyFence` is never exposed to this repair path's own
 * caller (it is internal to `truncateTornTrailingWrite` itself, not threaded through a public
 * `operation` callback a test could choose to skip calling it from) -- so, unlike
 * `collection-lock.test.ts`'s own "WITHOUT the fence" counterfactual (a real call that simply omits
 * calling the exposed `verifyFence`), the first test below instead demonstrates the exact underlying
 * write MECHANISM in isolation (`fsp.open(path, 'w')`, computed from a stale read -- byte-identical in
 * shape to `truncateTornTrailingWrite`'s own repair write): proof that an unfenced version of this
 * exact operation would discard content written after the stale read it was computed from. The second
 * test then drives the REAL, fixed `appendEvent`/`withEventLogLock` machinery through the identical
 * scenario (anomaly-injected via a `fsp.readFile` spy, since nothing else can interleave a real
 * concurrent writer deterministically into this one function's own internal awaits) and proves the fix
 * closes it: the rival's event survives, and this process's own event is correctly computed AFTER it.
 */
describe('appendEvent — the torn-trailing-write repair has its own write-time fence (fix 3)', () => {
  it('demonstrates the exact vulnerability class: an unfenced truncate-rewrite computed from a stale read discards content a concurrent legitimate writer committed afterward (the identical fs.open(path, "w") mechanism truncateTornTrailingWrite uses internally)', async () => {
    const projectRoot = await createTempProjectRoot();
    const runId = 'run-fence-vuln-class';
    const completeLine = JSON.stringify({
      v: 1,
      seq: 1,
      ts: 't',
      runId,
      type: 'RunStarted',
      payload: {},
    });
    const tornFragment = `{"v":1,"seq":2,"ts":"t","runId":"${runId}","type":"RunCom`;
    const filePath = eventLogPath(projectRoot, runId);
    await writeRawEventLog(projectRoot, runId, `${completeLine}\n${tornFragment}`);

    // The stale read a repair-write computes its own "clean" replacement content from.
    const staleContent = await readFile(filePath, 'utf8');
    const staleCleanContent = staleContent.slice(0, staleContent.lastIndexOf('\n') + 1);

    // Meanwhile, a legitimate rival holder of events.lock finishes its own real repair-then-append in
    // between -- exactly what `verifyFence` exists to detect before the repair write below ever
    // commits.
    const rivalEvent = JSON.stringify({
      v: 1,
      seq: 2,
      ts: 't2',
      runId,
      type: 'RunCompleted',
      payload: {},
    });
    await writeFile(filePath, `${staleCleanContent}${rivalEvent}\n`);

    // THE EXACT, UNFENCED MECHANISM `truncateTornTrailingWrite` used before this fix: a plain
    // `fsp.open(path, 'w')` truncate-and-rewrite, committing content computed from the now-stale
    // `staleCleanContent` alone.
    const handle = await open(filePath, 'w');
    await handle.writeFile(staleCleanContent);
    await handle.close();

    // THE BUG, DIRECTLY DEMONSTRATED: the rival's own, already-committed event is gone.
    const after = await readFile(filePath, 'utf8');
    expect(after).not.toContain('RunCompleted');
  });

  it('WITH the fix, driven through the real appendEvent/withEventLogLock machinery: the identical scenario never loses the rival event -- the fence check aborts the stale repair before it commits, and a fresh retry correctly finds nothing left to repair before appending its own new event after it', async () => {
    const projectRoot = await createTempProjectRoot();
    const runId = 'run-fence-fixed';
    const completeLine = JSON.stringify({
      v: 1,
      seq: 1,
      ts: 't',
      runId,
      type: 'RunStarted',
      payload: {},
    });
    const tornFragment = `{"v":1,"seq":2,"ts":"t","runId":"${runId}","type":"RunCom`;
    await writeRawEventLog(projectRoot, runId, `${completeLine}\n${tornFragment}`);

    const filePath = eventLogPath(projectRoot, runId);
    const lockPath = path.join(path.dirname(filePath), 'events.lock');

    const child = spawn('node', ['-e', 'process.exit(0)']);
    const rivalPid = child.pid;
    if (rivalPid === undefined) throw new Error('expected a real pid');
    await new Promise((resolve) => child.on('exit', resolve));

    let injected = false;
    const originalReadFile = fsp.readFile.bind(fsp);
    const spy = vi.spyOn(fsp, 'readFile');
    spy.mockImplementation((async (...args: unknown[]) => {
      const [target] = args as [string];
      if (!injected && target === filePath) {
        injected = true;
        // THE INJECTED ANOMALY: a rival process's own independently-successful lock create lands
        // exactly as this process is about to decide whether a torn-trailing-write repair is
        // needed -- and that rival performs its own full, legitimate repair-then-append of the
        // SAME shared file before releasing, the identical scenario the isolated repro above shows
        // is vulnerable.
        await writeFile(lockPath, String(rivalPid));
        const staleContent = await originalReadFile(filePath, 'utf8');
        const staleCleanContent = staleContent.slice(0, staleContent.lastIndexOf('\n') + 1);
        const rivalEvent = JSON.stringify({
          v: 1,
          seq: 2,
          ts: 't2',
          runId,
          type: 'RunCompleted',
          payload: {},
        });
        await writeFile(filePath, `${staleCleanContent}${rivalEvent}\n`);
      }
      return (originalReadFile as (...a: unknown[]) => unknown)(...args);
    }) as typeof fsp.readFile);

    let appended: ForgeEvent;
    try {
      appended = await appendEvent(projectRoot, runId, baseEvent({ runId }));
    } finally {
      spy.mockRestore();
    }

    // THE FIX, DIRECTLY DEMONSTRATED: the rival's own event survives, and this process's own event is
    // correctly computed AFTER it (seq 3, never the stale seq 2 this process would have assigned had
    // it trusted the read it took before the rival's event landed).
    expect(appended.seq).toBe(3);
    const events = await collectEvents(projectRoot, runId);
    expect(events.map((event) => ({ seq: event.seq, type: event.type }))).toEqual([
      { seq: 1, type: 'RunStarted' },
      { seq: 2, type: 'RunCompleted' },
      { seq: 3, type: 'RunStarted' },
    ]);
  });
});

describe('eventLogPath', () => {
  it('returns the real, documented .forge/state/runs/<runId>/events.ndjson path', () => {
    expect(eventLogPath('/a/project', 'run-1')).toBe(
      path.join('/a/project', '.forge', 'state', 'runs', 'run-1', 'events.ndjson'),
    );
  });

  it('rejects an unsafe runId the identical way appendEvent/readEvents already do', () => {
    expect(() => eventLogPath('/a/project', '../escape')).toThrow(TelemetryError);
  });
});
