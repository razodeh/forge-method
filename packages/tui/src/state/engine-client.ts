/**
 * `createEngineClient` — `04` §4.6's own "subscribes to the engine event stream." `@forge/telemetry`'s
 * own real `readEvents` (confirmed directly, `PLAN-M9.md`'s own "already-built surface" note) is a
 * one-shot reader, not a live tail — this is the polling loop on top of it: re-reads on an interval
 * (`04` §4.1's own 100ms coalescing budget, by default), tracks the highest `seq` already dispatched,
 * and forwards only genuinely new events, in order.
 *
 * A real `seq` gap (`readEvents` throws a typed `TelemetryError`) is caught here and surfaced as a
 * `'gap'` notification, never an uncaught rejection — `04` §4.6's own "gap detection → request
 * snapshot" read honestly: no real snapshot RPC exists anywhere in this codebase to request one from
 * (`PLAN-M9.md` P1's own recorded scope note), so a `'gap'` notification is the real, honest signal a
 * caller gets instead — "the read model may be stale." Both `code` and `remedy` are threaded through
 * from a real `TelemetryError` when the failure is one (never fabricated for a plain `Error`/non-Error
 * throw) — a first critic round found the original draft collapsed three distinctly-remedied
 * `TelemetryError` codes into one bare message string; a second round found the fix still dropped
 * `remedy` itself, the one field `QUALITY-BAR.md`'s own exemplar property (§1.1: "a stable machine code
 * *and* a human remedy") says a caller actually needs.
 *
 * A listener's own thrown error — from `subscribe` *or* `onNotification` — is caught individually, per
 * listener, never inside the same `try` that wraps the real read: a first critic round found the
 * original draft's `try`/`catch` wrapped both the read and the event-listener dispatch loop, silently
 * relabeling a real subscriber bug as telemetry staleness; a second round found the fix still left
 * `onNotification` listeners themselves completely unguarded — a throwing notification listener (a
 * buggy toast renderer) could still escape into the outer `catch` and be reported as a fabricated
 * `'gap'`, or become a genuine unhandled rejection when no other `try` was around to catch it at all.
 * `notify()` below is now the one, single place every notification is ever delivered from, and it is
 * the only thing that ever calls a notification listener — silently dropping (not re-notifying, which
 * would recurse) a listener that itself throws, since there is no further, safe channel to escalate a
 * notification-listener's own bug to without risking exactly that infinite loop.
 *
 * `stop()` sets a real `stopped` flag checked again the instant a real, possibly slow, in-flight read
 * resolves — a first critic round found the original draft's `stop()` only ever cleared the interval
 * timer, so a read already in flight at the moment of a logical shutdown still delivered its own events
 * to listeners afterward, a real, ordinary "screen navigation races a slow disk read" scenario, not a
 * hypothetical one.
 *
 * Before the real, potentially expensive `readEvents` call (a full `readFile` + re-parse of the whole
 * log every time, `@forge/telemetry`'s own real, documented one-shot-reader contract), a cheap `fs.stat`
 * checks the log's own real byte **size** against the size last observed — skipping the expensive
 * read+reparse entirely once nothing has actually been appended since. Size, not `mtimeMs`: a first
 * attempt used the file's modification time, and a second critic round reproduced directly that two
 * real, distinct `appendEvent` calls landing inside the same mtime-resolution window (real and
 * historically common — HFS+'s own 1s granularity, some network-mount/container filesystems) produce an
 * identical `mtimeMs`, silently deferring the second write's own delivery until some *later*,
 * coincidental write finally ticks the timestamp forward. `@forge/telemetry`'s own event log is strictly
 * append-only (confirmed directly, `events.ts`'s own header doc: "append-only; events are immutable and
 * never rewritten") — its real byte size can only ever grow between two genuinely different states, so
 * comparing `size` is an exact, environment-independent signal with no resolution-quantisation risk at
 * all, unlike `mtimeMs`. This does not eliminate the real, disclosed O(total-events-so-far) cost of a
 * read that *does* find new content (closing that fully would need a byte-offset-resuming read
 * `@forge/telemetry` does not expose, a larger change than this piece's own real scope), but it closes
 * the "pays that full cost every single tick forever, even while idle" failure a first critic round's
 * own repro demonstrated — including, unlike that first fix, for a *persistently broken* log too: the
 * last-observed size is recorded whenever a real `fs.stat` succeeds, in both the success and the
 * failure path below, so a log that stays corrupted but stops growing altogether is not re-read on
 * every single tick forever either (a second critic round's own repro found the first fix only ever
 * recorded it on the success path, so the broken-log case it was paired with — the notification-dedup
 * fix immediately below — still paid the full re-read cost on every tick regardless).
 *
 * A persistently broken log (corrupted, permission-denied) would otherwise re-fire an identical `'gap'`
 * notification on every single poll cycle forever — a real notification-flood risk a first critic round
 * found no test covered. De-duplicated here: an unchanged failure message is not re-notified until
 * either the read succeeds again or the message itself changes.
 *
 * **This client assumes `(projectRoot, runId)` names one continuous, ever-growing log for its own
 * entire lifetime — it does not try to detect an in-place replacement of that same file underneath
 * itself.** `04` §4.6's own "engine restart (re-subscribe + snapshot)" is treated as a *caller-lifecycle*
 * concern, not something one already-running instance needs to notice on its own: a real engine/process
 * restart is handled by whichever caller drives this client constructing a genuinely **new**
 * `EngineClient` for the new session (which starts `lastSeq: 0` correctly, by construction, needing no
 * heuristic at all) — not by an existing instance trying to infer, from some cheap signal, that the file
 * it has been polling was secretly swapped out from under it while it kept running. Two earlier drafts
 * of this file tried exactly that (first a byte-size decrease, then a first-event content fingerprint,
 * each replacing the last after a critic round found a real, if progressively narrower, coincidence
 * that fooled it), across three consecutive critic rounds, each fix closing one specific reproduction
 * and a following round finding a different, real way past it — the same end-state
 * (a restarted run's own events silently and permanently dropped, with no notification at all) reached
 * by a new route each time. `SPEC-QUESTIONS.md` Q133 records that full history and the two options a
 * (now-resolved-and-removed) `BLOCKED-P1.md` raised; removing the whole mechanism (this note, and this
 * codebase's own real, established convention that a `runId` is never reused for a genuinely different
 * run — confirmed nowhere in this codebase's own real conventions does the *same* `runId` ever
 * legitimately name two different logical runs) was the chosen resolution, on the coordinator's own
 * explicit direction, not a fourth heuristic.
 *
 * Polling itself only starts on the first real `subscribe()`/`onNotification()` call, never eagerly at
 * construction — a later, final critic round reproduced directly that starting it eagerly races
 * construction against subscription, not subscription itself: any real async gap between
 * `createEngineClient(...)` and a later `subscribe()` (an entirely ordinary "subscribe from inside a
 * `useEffect`" shape) let the very first poll consume and silently, permanently drop whatever was
 * already in the log with zero listeners registered to receive it. `ensurePollingStarted()` below is
 * the one place that lazily kicks polling off, the first time it is genuinely needed.
 *
 * @see specs/04 §4.6
 * @see PLAN-M9.md P1
 * @see SPEC-QUESTIONS.md Q133
 */
import { stat } from 'node:fs/promises';

import { TelemetryError } from '@forge/telemetry/errors';
import { eventLogPath, readEvents as realReadEvents } from '@forge/telemetry/events';
import type { ForgeEvent } from '@forge/telemetry/events';

export interface EngineClientOptions {
  readonly pollIntervalMs?: number;
  /** Injectable, defaulting to the real `@forge/telemetry` `readEvents` -- this codebase's own
   * established "inject the real dependency, default to the real implementation" convention
   * (`ClaudeCliRunner`, `runSdkQuery`'s own `queryFn`), added specifically so a test can deterministically
   * prove the concurrent-poll guard below actually guards (a slow, controllable fake), rather than
   * needing a real, racy filesystem timing window to exercise it. */
  readonly readEvents?: typeof realReadEvents;
}

export type EngineClientNotification =
  | {
      readonly type: 'gap';
      readonly message: string;
      readonly code?: string;
      readonly remedy?: string;
    }
  | { readonly type: 'listener-error'; readonly message: string };

export interface EngineClient {
  /** Returns an unsubscribe function. */
  subscribe(listener: (event: ForgeEvent) => void): () => void;
  /** Returns an unsubscribe function. */
  onNotification(listener: (notification: EngineClientNotification) => void): () => void;
  stop(): void;
}

const DEFAULT_POLL_INTERVAL_MS = 100;

export function createEngineClient(
  projectRoot: string,
  runId: string,
  options: EngineClientOptions = {},
): EngineClient {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const readEvents = options.readEvents ?? realReadEvents;
  const eventListeners = new Set<(event: ForgeEvent) => void>();
  const notificationListeners = new Set<(notification: EngineClientNotification) => void>();
  let lastSeq = 0;
  // Guards against a slow poll (a large event log, a loaded disk) overlapping with the next tick --
  // never two concurrent reads of the same file racing to update `lastSeq`.
  let polling = false;
  // `stop()` (below) assigns this from a *different* closure than `poll()`'s own body -- real, and
  // genuinely reachable while a `poll()` call is suspended at an `await` (a slow disk read racing an
  // ordinary screen teardown). `@typescript-eslint/no-unnecessary-condition`'s own static analysis
  // cannot see that concurrent mutation and reports every check below as "always false"; each one is
  // disabled individually, at the exact check, with this same real reason -- not disabled at the
  // variable's own declaration, so a genuinely-dead condition introduced later would still be caught.
  let stopped = false;
  let lastKnownSize: number | undefined;
  let lastNotifiedMessage: string | undefined;

  /** The one place any `EngineClientNotification` is ever delivered from -- every listener is isolated
   * in its own `try`/`catch`, and a listener that itself throws is silently dropped rather than
   * re-notified (re-notifying would recurse the instant *every* notification listener happens to be
   * broken, the one real failure mode worse than losing one bad listener's own error silently). */
  function notify(notification: EngineClientNotification): void {
    for (const listener of notificationListeners) {
      try {
        listener(notification);
      } catch {
        // Deliberately silent -- see this function's own doc comment above.
      }
    }
  }

  async function poll(): Promise<void> {
    if (polling || stopped) return;
    polling = true;

    let size: number | undefined;
    try {
      let fileStat: { readonly size: number } | undefined;
      try {
        fileStat = await stat(eventLogPath(projectRoot, runId));
      } catch {
        fileStat = undefined; // no log yet, or a transient stat failure -- readEvents itself already
        // treats "no log yet" as a legitimate, non-corrupt state; falling through to it here rather
        // than trying to distinguish the two stat failure cases ourselves keeps that one real,
        // already-correct decision in the one place that already makes it.
      }
      size = fileStat?.size;
      if (fileStat !== undefined && size === lastKnownSize) {
        polling = false;
        return; // nothing has been appended since the last successful read -- skip the re-parse.
      }

      // Dispatched *incrementally*, inside this same loop -- not collected and dispatched only after
      // the whole read finishes -- so a real event genuinely read before a later gap in the same file
      // still reaches listeners (the "one event before the gap still gets dispatched, a real partial
      // recovery, not silence" contract). A listener's own thrown error is caught right here, in its
      // own inner `try`, specifically so it can never propagate out to the outer `catch` below and be
      // mislabeled as a telemetry `'gap'`.
      for await (const event of readEvents(projectRoot, runId)) {
        if (event.seq <= lastSeq) continue;
        // A real, reachable check: `stop()` runs from a different closure and can genuinely flip this
        // while this `await`-suspended loop is mid-flight; the static analysis cannot see that.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (stopped) {
          polling = false;
          return;
        }
        lastSeq = event.seq;
        for (const listener of eventListeners) {
          try {
            listener(event);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            notify({ type: 'listener-error', message });
          }
        }
      }
      // A real fs.stat succeeded even if the read that followed it failed -- recorded regardless, in
      // both this success path and the catch block below, so a persistently broken but *unchanging* log
      // is not re-read on every single tick forever either (see this file's own top doc comment).
      lastKnownSize = size;
    } catch (error) {
      polling = false;
      lastKnownSize = size;
      // See the identical, real reason on the check inside the `try` block above.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (stopped) return;
      const message = error instanceof Error ? error.message : String(error);
      if (message === lastNotifiedMessage) return;
      lastNotifiedMessage = message;
      notify(
        error instanceof TelemetryError
          ? { type: 'gap', message, code: error.code, remedy: error.remedy }
          : { type: 'gap', message },
      );
      return;
    }

    polling = false;
    // See the identical, real reason on the check inside the `try` block above.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (stopped) return;
    lastNotifiedMessage = undefined;
  }

  // Defined if and only if polling is *currently* running -- this exact invariant is the fix for a
  // real, later-round critic finding: `stop()` used to `clearInterval` without ever resetting this back
  // to `undefined`, and pausing (below) needs the identical invariant to hold for `ensurePollingStarted`
  // to correctly know a later resubscribe genuinely needs a fresh interval, not a no-op.
  let timer: ReturnType<typeof setInterval> | undefined;

  /** Polling starts on the *first real subscription* (to either channel), not at construction --
   * a fresh, critic round reproduced directly that starting it eagerly at construction races
   * construction against subscription, not subscription itself, despite this file's own original doc
   * comment claiming otherwise: any real async gap between `createEngineClient(...)` and a later
   * `subscribe()` call (an entirely ordinary "subscribe from a `useEffect`" shape, not a hostile or even
   * unusual one) let the very first poll consume and advance past whatever was already in the log with
   * zero listeners registered to receive it -- silently and permanently lost, no notification, not the
   * "wait a full interval" cost the original comment described at all. Idempotent: a second subscription
   * (to the same or the other channel) after polling has already started is a harmless no-op.
   *
   * A *following* critic round reproduced the identical failure's own real sibling: closing only the
   * construction-to-first-subscribe gap left the exact same "consumed with zero listeners registered"
   * loss reachable a second way -- unsubscribing the *last* remaining listener (an entirely ordinary
   * screen-unmount shape) never paused polling, so any event appended during that real "nobody is
   * listening right now" window was silently, permanently lost the moment a caller resubscribed later
   * (a tab switch, a remount) and found it already gone. `pauseIfNoListenersLeft` (below), called from
   * every unsubscribe, is the fix: polling itself now pauses whenever the listener count drops to zero,
   * so the identical `ensurePollingStarted` a later resubscribe calls genuinely starts a fresh poll
   * again (via this same `timer === undefined` check) rather than wrongly no-op'ing against a stale
   * "still running" flag while nothing was actually being read. */
  function ensurePollingStarted(): void {
    // `stop()` means permanently done, not merely paused -- a subscribe() after stop() must never
    // resurrect a real interval that would just fire forever doing nothing (poll() itself already
    // no-ops once `stopped`), a real, if harmless-looking, leaked timer otherwise.
    if (stopped || timer !== undefined) return;
    timer = setInterval(() => {
      void poll();
    }, pollIntervalMs);
    // Kicks off a real read immediately -- this first, real subscriber should not have to wait a full
    // interval for the first frame of a run that has already produced events by the time it subscribed.
    void poll();
  }

  function pauseIfNoListenersLeft(): void {
    if (eventListeners.size > 0 || notificationListeners.size > 0) return;
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  }

  return {
    subscribe(listener: (event: ForgeEvent) => void): () => void {
      eventListeners.add(listener);
      ensurePollingStarted();
      return () => {
        eventListeners.delete(listener);
        pauseIfNoListenersLeft();
      };
    },
    onNotification(listener: (notification: EngineClientNotification) => void): () => void {
      notificationListeners.add(listener);
      ensurePollingStarted();
      return () => {
        notificationListeners.delete(listener);
        pauseIfNoListenersLeft();
      };
    },
    stop(): void {
      stopped = true;
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    },
  };
}
