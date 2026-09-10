/**
 * The event log: `18` §18.4's `ForgeEvent` shape and catalogue, plus the write-ahead-log discipline the
 * whole resumability guarantee rests on — an event is written and `fsync`'d *before* the side-effect it
 * authorises is attempted (`18` §18.10). `.forge/state/runs/<runId>/events.ndjson` is append-only;
 * events are immutable and never rewritten (`18` §18.4's own rule) — corrections are new events, not
 * edits to old ones.
 *
 * @see specs/18 §18.4
 * @see specs/18 §18.10
 * @see specs/20 §20.4
 * @see PLAN-M5.md P6
 */
import fsp from 'node:fs/promises';
import path from 'node:path';

import { TelemetryError } from './errors.ts';
import { redactPayload } from './redact.ts';

/** `18` §18.4's own event catalogue table, one string-literal union, grouped exactly as the spec groups
 * them. */
export type EventType =
  // Run
  | 'RunPlanned'
  | 'RunStarted'
  | 'RunPaused'
  | 'RunResumed'
  | 'RunCompleted'
  | 'RunAborted'
  | 'RunFailed'
  // Step
  | 'StepScheduled'
  | 'StepStarted'
  | 'StepProgress'
  | 'StepSucceeded'
  | 'StepFailed'
  | 'StepRetried'
  | 'StepSkipped'
  | 'StepEscalated'
  // Lane
  | 'LaneCreated'
  | 'LaneCommitted'
  | 'LaneReady'
  | 'LaneAbandoned'
  | 'LaneRemoved'
  // Adapter
  | 'SessionStarted'
  | 'SessionEvent'
  | 'SessionEnded'
  | 'AdapterError'
  | 'AdapterRetry'
  // Artifact
  | 'ArtifactCreated'
  | 'ArtifactUpdated'
  | 'ArtifactValidated'
  | 'ArtifactRejected'
  // KB
  | 'KbWritten'
  | 'KbProposed'
  | 'KbProposalResolved'
  | 'KbContradictionDetected'
  // Gate
  | 'GateEvaluated'
  | 'GateApproved'
  | 'GateRejected'
  | 'GateWaived'
  // Merge
  | 'MergeQueued'
  | 'MergeStarted'
  | 'MergeConflict'
  | 'MergeCompleted'
  | 'MergeReverted'
  // Human
  | 'ElicitationRequested'
  | 'ElicitationAnswered'
  | 'AssumptionRecorded'
  | 'InterjectionSent'
  // Cost
  | 'UsageRecorded'
  | 'BudgetWarning'
  | 'BudgetBreached'
  // Security
  | 'PolicyViolation'
  | 'SecretRedacted'
  | 'InjectionAttemptBlocked'
  | 'EscalationActive'
  // Custom
  | 'CheckRun'
  | 'DiagramGenerated'
  | 'DriftDetected';

export interface ForgeEvent {
  readonly v: 1;
  /** Monotonic within the run, gapless. Assigned by `appendEvent` — never supplied by a caller. */
  readonly seq: number;
  /** ISO-8601 with ms. Supplied by the caller, not generated here: this package has no injected clock
   * of its own, and reading the wall clock directly inside a shared library is exactly what this
   * project's own determinism discipline (an injected clock, not an ambient global) exists to avoid. A
   * future `@forge/engine` caller supplies it from its own clock. */
  readonly ts: string;
  readonly runId: string;
  readonly type: EventType;
  readonly stepId?: string;
  readonly laneId?: string;
  readonly agentId?: string;
  readonly idempotencyKey?: string;
  readonly payload: unknown;
  readonly causedBy?: number;
}

/** What a caller supplies to `appendEvent` — everything `ForgeEvent` has except the two fields this
 * function itself assigns. */
export type NewForgeEvent = Omit<ForgeEvent, 'v' | 'seq'>;

export interface AppendEventOptions {
  /** Matched against payload *key names* — `redactPayload`'s own doc comment has the full reasoning. */
  readonly redactPatterns?: readonly RegExp[];
  readonly knownSecrets?: readonly string[];
}

/** `runId` reaches this function from a caller, not from anything this package itself generates or
 * validates — confirmed empirically that an unvalidated `runId` containing `..` segments (e.g.
 * `"../../../../ESCAPED-dir"`) makes `path.join` resolve *outside* `projectRoot` entirely, a direct
 * violation of `20` §20.2 point 1 ("Every write is resolved... and must land inside the project root...
 * Escapes are denied and logged") and invariant S1. Rejecting any `runId` containing a path separator
 * (either `/` or `\`, since `02` §2.1 makes Windows first-class) or equal to `.`/`..` closes this at the
 * one place every caller of this module already goes through, rather than trying to catch it after the
 * fact by resolving and checking containment. Also rejects the empty string: confirmed empirically that
 * `path.join` collapses an empty segment away entirely, so `eventLogPath(root, '')` resolves to
 * `runs/events.ndjson` — one level shallower than every real run — letting two unrelated callers that
 * both (mistakenly) pass `''` silently share one file and interleave their sequence numbers, rather than
 * failing loudly. */
function assertSafeRunId(runId: string): void {
  if (
    runId === '' ||
    runId.includes('/') ||
    runId.includes('\\') ||
    runId === '.' ||
    runId === '..'
  ) {
    throw new TelemetryError({
      code: 'TELEMETRY-INVALID-RUN-ID',
      message: `runId "${runId}" is not a valid single path segment — it must not be empty, must not contain "/" or "\\", and must not be "." or "..".`,
      remedy: 'Use a plain run identifier with no path separators, such as a ULID.',
    });
  }
}

function eventLogPath(projectRoot: string, runId: string): string {
  assertSafeRunId(runId);
  return path.join(projectRoot, '.forge', 'state', 'runs', runId, 'events.ndjson');
}

/** Exported so the "not a code-bearing object" branch is directly testable — every real
 * `fsp.readFile` failure this module actually catches produces a code-bearing `ErrnoException`, making
 * that branch otherwise unreachable through this module's own real behaviour, the same situation
 * `@forge/vcs`'s own identically-shaped helper was in. */
export function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

/** Same reasoning and the same reused-not-duplicated shape as `errorCode` above: every real
 * `fsp.readFile` failure this module catches is already a real `Error`, making the fallback branch
 * unreachable through this module's own real behaviour otherwise — exported for the same direct-testing
 * reason. Shared by both of this module's "wrap a genuine read failure" call sites so the property can't
 * drift out of sync between them. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A write-ahead-log line is only durable once its own trailing `\n` has actually been written —
 * `appendLineWithFsync` always writes `` `${JSON.stringify(event)}\n` `` as a single call, `fsync`'d
 * before `appendEvent` ever resolves, so a fully-completed append's own line always ends in `\n`.
 * Confirmed empirically (a real crash-shape, not a hypothetical one) that a crash *during* a write —
 * before that write's own promise ever resolved, so its caller never saw a successful append — can leave
 * a torn, incomplete final line with no trailing newline on disk; naively treating that dangling
 * fragment as a real line let it corrupt every append after it, since the next append's own line would
 * be glued directly onto it with no separator. Content that does not end in `\n` therefore has its last
 * segment dropped entirely: it was never durable in the first place, since nothing (including this
 * module's own reader) ever observed a successful return for it. */
function splitCompleteLines(content: string): readonly string[] {
  const lines = content.split('\n').filter((line) => line !== '');
  return content.endsWith('\n') ? lines : lines.slice(0, -1);
}

/** Per-`(projectRoot, runId)` serialisation: two `appendEvent` calls racing for the same run must not
 * both read the same "last seq" and assign the same (or a gapped) value. Chained onto the previous
 * operation's own settlement — never its rejection — so one failed append does not permanently wedge
 * every later append for the same run. Deliberately has no cleanup for a run whose queue has gone idle:
 * each map entry is one string key and one settled promise, and even a long-lived supervisor process
 * touching thousands of distinct runs over its lifetime stays a bounded, negligible cost — not worth the
 * real risk of a cleanup race deleting a queue entry a new call has just enqueued onto. */
const runQueues = new Map<string, Promise<unknown>>();

function enqueueForRun<T>(key: string, operation: () => Promise<T>): Promise<T> {
  // previousTail is always already "settled-safe" by construction: the only two things this can ever
  // be are Promise.resolve() (the first call for this key) or a previous call's own settledTail below
  // (already wrapped) — never a promise that can itself reject. Wrapping it a second time here would be
  // redundant, not merely extra-safe.
  const previousTail = runQueues.get(key) ?? Promise.resolve();
  const thisOperation = previousTail.then(operation);
  const settledTail = thisOperation.then(
    () => undefined,
    () => undefined,
  );
  runQueues.set(key, settledTail);
  return thisOperation;
}

/** The last `seq` written for `(projectRoot, runId)`, or `0` if nothing has been written yet — cached
 * per process lifetime once determined, since every *subsequent* call within the same process already
 * knows the answer from its own last successful append (updated only after that append's fsync
 * genuinely completes, never optimistically before). The cache is deliberately not trusted across a
 * process boundary: the first call for a given run in a fresh process (the realistic shape of a
 * crash-resume) always reads the file to find the true last seq, since nothing in memory could know it
 * yet. */
const lastSeqCache = new Map<string, number>();

function parseEventLine(line: string, runId: string): ForgeEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (cause) {
    throw new TelemetryError(
      {
        code: 'TELEMETRY-EVENT-LOG-CORRUPT',
        message: `A line in the event log for run "${runId}" is not valid JSON.`,
        remedy: 'The event log may be truncated or corrupted. Run `forge doctor` to investigate.',
      },
      { cause },
    );
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('v' in parsed) ||
    parsed.v !== 1 ||
    !('seq' in parsed) ||
    typeof parsed.seq !== 'number' ||
    !Number.isInteger(parsed.seq) ||
    parsed.seq < 1 ||
    !('ts' in parsed) ||
    typeof parsed.ts !== 'string' ||
    !('runId' in parsed) ||
    typeof parsed.runId !== 'string' ||
    !('type' in parsed) ||
    typeof parsed.type !== 'string'
  ) {
    // payload is deliberately not checked: it is `unknown` by design, and a caller-supplied `undefined`
    // payload is serialised by `JSON.stringify` as an absent key entirely, not a present-but-invalid one
    // — requiring it to exist would reject a legitimate event for a reason with nothing to do with
    // corruption.
    throw new TelemetryError({
      code: 'TELEMETRY-EVENT-LOG-CORRUPT',
      message: `A line in the event log for run "${runId}" is not a well-formed event (missing or mistyped "v"/"seq"/"ts"/"runId"/"type").`,
      remedy: 'The event log may be truncated or corrupted. Run `forge doctor` to investigate.',
    });
  }
  // The shape check above narrows every field this function itself validates; the remaining optional
  // ForgeEvent fields (stepId/laneId/agentId/idempotencyKey/causedBy) and payload are trusted as written
  // by this same module's own appendEvent, the only writer of this file.
  return parsed as ForgeEvent;
}

/** If `content` (the full current contents of the run's event log) has a torn trailing write — content
 * present but not ending in `\n` — rewrites the file to contain only the last *complete* line, fsync'd
 * the same way any other write to this file is. Run before this run's own next append ever gets a
 * chance to glue its own new line directly onto the dangling fragment with no separator (confirmed
 * empirically to otherwise corrupt every event after it, not just the torn one). A no-op, not called at
 * all, when the content already ends cleanly. */
async function truncateTornTrailingWrite(filePath: string, content: string): Promise<void> {
  if (content === '' || content.endsWith('\n')) return;
  const cleanContent = content.slice(0, content.lastIndexOf('\n') + 1);
  try {
    const handle = await fsp.open(filePath, 'w');
    try {
      await handle.writeFile(cleanContent);
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (cause) {
    // Confirmed empirically (chmod-induced EACCES) that `fsp.open`/`writeFile`/`sync`/`close` all leak a
    // bare Node `Error` otherwise — every other failure path in this module wraps into a typed
    // `TelemetryError`, and this one silently didn't.
    throw new TelemetryError(
      {
        code: 'TELEMETRY-EVENT-LOG-WRITE-FAILED',
        message: `Failed to recover a torn trailing write for the event log at "${filePath}": ${errorMessage(cause)}`,
        remedy:
          'Verify the project root is correct, this process has permission to write .forge/state/, and the disk is not full.',
      },
      { cause },
    );
  }
}

/** Reuses `parseEventLine` rather than duplicating its shape-check — the same "is this a well-formed
 * event" question `readEvents` already asks of every line, asked here of just the last one, so the two
 * can't drift apart into checking slightly different things. */
async function determineLastSeq(
  projectRoot: string,
  runId: string,
  cacheKey: string,
): Promise<number> {
  const cached = lastSeqCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const filePath = eventLogPath(projectRoot, runId);
  let content: string;
  try {
    content = await fsp.readFile(filePath, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return 0;
    throw new TelemetryError(
      {
        code: 'TELEMETRY-EVENT-LOG-READ-FAILED',
        message: `Failed to read the event log for run "${runId}" while determining its last sequence number: ${errorMessage(error)}`,
        remedy:
          'Verify the project root is correct and this process has permission to read .forge/state/.',
      },
      { cause: error },
    );
  }
  await truncateTornTrailingWrite(filePath, content);
  const lines = splitCompleteLines(content);
  const lastLine = lines[lines.length - 1];
  if (lastLine === undefined) return 0;
  return parseEventLine(lastLine, runId).seq;
}

async function appendLineWithFsync(filePath: string, line: string): Promise<void> {
  try {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    const handle = await fsp.open(filePath, 'a');
    try {
      const { size: preWriteSize } = await handle.stat();
      try {
        await handle.appendFile(line);
        // The one guarantee every later resume piece trusts without re-checking (18 §18.10): this must
        // not resolve until the write is durable, not merely handed to the OS's own write buffer.
        await handle.sync();
      } catch (cause) {
        // A real, if rare, failure shape: the write itself lands (bytes visible to any reader, including
        // this same process's own next append) but the following fsync fails (ENOSPC/EIO-on-flush).
        // Without rolling the write back, a caller that correctly treats the rejected promise as "this
        // event never happened" would still find it silently promoted into confirmed history the next
        // time anything reads or appends to this file. Truncating back to the pre-write size — best
        // effort; if the truncate itself also fails, the original cause below is still what matters —
        // keeps the file's own on-disk state matching what every caller was actually told. Note this
        // best-effort truncate can itself fail too (a doubly-degraded disk): appendEvent's own caller-
        // side fix for that (invalidating the last-seq cache on any append failure) is what actually
        // keeps the run's own event log consistent when it does, not anything here.
        await handle.truncate(preWriteSize).catch(() => undefined);
        throw cause;
      }
    } finally {
      await handle.close();
    }
  } catch (cause) {
    // Confirmed empirically (chmod-induced EACCES on the parent directory and on the file itself) that
    // `fsp.mkdir`/`fsp.open`/`close`, and the rethrown cause above, all otherwise leak a bare Node
    // `Error` — every other failure path in this module wraps into a typed `TelemetryError`, and the
    // write path silently didn't.
    throw new TelemetryError(
      {
        code: 'TELEMETRY-EVENT-LOG-WRITE-FAILED',
        message: `Failed to append to the event log at "${filePath}": ${errorMessage(cause)}`,
        remedy:
          'Verify the project root is correct, this process has permission to write .forge/state/, and the disk is not full.',
      },
      { cause },
    );
  }
}

/** Assigns the next gapless `seq`, redacts the payload, serialises, `fsync`s, then appends to
 * `.forge/state/runs/<runId>/events.ndjson` — never resolves before the `fsync` completes. Returns the
 * fully-assigned event (including its new `seq`) so a caller has it without a separate read, e.g. to use
 * as a later event's own `causedBy`. */
export async function appendEvent(
  projectRoot: string,
  runId: string,
  event: NewForgeEvent,
  options: AppendEventOptions = {},
): Promise<ForgeEvent> {
  // NUL-separated, not space- or plain-concatenated: a filesystem path can contain a space (an
  // ordinary path like "/Users/Jane Doe/project"), so a naive join could let two genuinely different
  // (projectRoot, runId) pairs collide on the same cache key — e.g. projectRoot "/a b" + runId "c" and
  // projectRoot "/a" + runId "b c" would otherwise both produce "/a b c". NUL cannot appear in a valid
  // path or a realistic run id, so it cannot collide the same way.
  const cacheKey = `${projectRoot}\0${runId}`;
  return enqueueForRun(cacheKey, async () => {
    const lastSeq = await determineLastSeq(projectRoot, runId, cacheKey);
    const seq = lastSeq + 1;
    const redactedPayload = redactPayload(
      event.payload,
      options.redactPatterns ?? [],
      options.knownSecrets ?? [],
    );
    const fullEvent: ForgeEvent = { ...event, v: 1, seq, payload: redactedPayload };
    try {
      await appendLineWithFsync(eventLogPath(projectRoot, runId), `${JSON.stringify(fullEvent)}\n`);
    } catch (cause) {
      // A failed append's own best-effort rollback (inside appendLineWithFsync) can itself fail — a
      // doubly-degraded disk, confirmed empirically to leave a fully well-formed (newline-terminated)
      // "phantom" line on disk for this seq, indistinguishable on its own from a real committed event.
      // Trusting the cached lastSeq afterwards would let the *next* successful append reuse this seq
      // number, colliding with the phantom already on disk — readEvents then finds two lines both
      // claiming the same seq and the run becomes permanently unreadable past that point. Invalidating
      // the cache forces the next append for this run to re-derive the truth from disk instead: if the
      // rollback actually succeeded (the common case), disk still says lastSeq unchanged, no behaviour
      // change; if it didn't, disk now shows the phantom's own seq as the real last one, and the next
      // append correctly continues past it with no collision.
      lastSeqCache.delete(cacheKey);
      throw cause;
    }
    lastSeqCache.set(cacheKey, seq);
    return fullEvent;
  });
}

/** Streams `.forge/state/runs/<runId>/events.ndjson` back in order. A `seq` gap — including a `seq` of
 * anything other than `1` for the very first event — throws a `TelemetryError` naming the gap (`18`
 * §18.4: "seq gaps indicate corruption and trigger `forge doctor`"; detecting and reporting the fact is
 * this piece's job, `forge doctor` itself is a later milestone). Yields nothing, rather than throwing,
 * for a run with no event log yet — that is a legitimate state (a run that has not started), not
 * corruption. */
export async function* readEvents(projectRoot: string, runId: string): AsyncGenerator<ForgeEvent> {
  // Resolved outside the try below, on its own: eventLogPath's own assertSafeRunId check must not be
  // caught and re-wrapped by the catch clause that follows, which exists only for genuine read failures
  // — confirmed empirically that an inline call here got mis-classified as TELEMETRY-EVENT-LOG-READ-FAILED
  // (with a misleading "check permissions" remedy) instead of surfacing as TELEMETRY-INVALID-RUN-ID.
  const filePath = eventLogPath(projectRoot, runId);
  let content: string;
  try {
    content = await fsp.readFile(filePath, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return;
    throw new TelemetryError(
      {
        code: 'TELEMETRY-EVENT-LOG-READ-FAILED',
        message: `Failed to read the event log for run "${runId}": ${errorMessage(error)}`,
        remedy:
          'Verify the project root is correct and this process has permission to read .forge/state/.',
      },
      { cause: error },
    );
  }

  let expectedSeq = 1;
  for (const line of splitCompleteLines(content)) {
    const event = parseEventLine(line, runId);
    if (event.seq !== expectedSeq) {
      throw new TelemetryError({
        code: 'TELEMETRY-EVENT-LOG-SEQ-GAP',
        message: `Event log for run "${runId}" has a seq gap: expected ${String(expectedSeq)}, found ${String(event.seq)}.`,
        remedy: 'The event log may be corrupted or truncated. Run `forge doctor` to investigate.',
      });
    }
    yield event;
    expectedSeq += 1;
  }
}
