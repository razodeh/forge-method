/**
 * The worker-thread ENTRY POINT `normalize-budget.ts` spawns to apply a case's `normalize` rules
 * under a wall-clock budget it can enforce by force-terminating this whole thread (`specs/22` M17
 * P14, `13` F-TEST-9: "run... under a single stated wall-clock budget..., exceeding which makes the
 * case `error`, a typed refusal, never a hang"). Never imported by anything other than
 * `normalize-budget.ts`'s own `new Worker(...)` call — this file's only job is to unwrap
 * `workerData`, call the real, already-tested {@link applyNormalizeRulesToText}, and write the
 * result back into shared memory; it carries no logic of its own worth testing in isolation
 * (`normalize-budget.test.ts` proves the whole mechanism, budget included, end to end, through the
 * one real public entry point).
 *
 * **Why shared memory, never `postMessage`/a `MessagePort`.** Confirmed directly, not assumed: a
 * `postMessage`d result is NOT guaranteed visible to `receiveMessageOnPort` on the calling thread by
 * the moment `Atomics.wait` there observes this worker's own `Atomics.notify` — delivering a posted
 * message across threads goes through the EVENT LOOP (Node's own IPC/libuv plumbing), which a thread
 * blocked inside a synchronous `Atomics.wait` never runs, so the message can sit undelivered
 * indefinitely even after the signal the two were meant to pair with has already fired. Plain
 * `SharedArrayBuffer` memory has no such dependency: a byte this worker writes is visible to the
 * calling thread the instant `Atomics.wait` returns there, with nothing else needing to run in
 * between. The result is therefore written directly into {@link NormalizeWorkerData.resultBuffer}
 * BEFORE the `sync` flag is stored, so the calling thread never observes "done" before the bytes it
 * is about to read are actually there.
 *
 * **Why `process.on('uncaughtException', ...)`, not `normalize-budget.ts`'s own `worker.on('error',
 * ...)`, is what detects a crash promptly.** Confirmed directly, by the identical "reproduce before
 * trusting" discipline this whole piece follows: a worker that throws BEFORE reaching this file's
 * own `Atomics.store` leaves `sync` at `0` forever, so `normalize-budget.ts`'s own `Atomics.wait`
 * blocks for the FULL budget before returning `'timed-out'` — a crash misdiagnosed as a hang, not
 * merely a slow report of one. The reason: `Worker`'s `'error'` event is delivered to the PARENT
 * through the event loop, which the parent's own call stack (blocked inside `Atomics.wait`, even
 * across many short, repeatedly-polled waits — proven directly, not assumed, by instrumenting a
 * polling loop and observing the handler never fires until the loop itself returns) does not get a
 * turn to run until `applyNormalizeRulesToTextBounded` itself returns. `process.on('uncaughtException'
 * ...)`, registered HERE, inside the worker's own realm, runs SYNCHRONOUSLY at the point of the
 * uncaught throw, before the thread dies — it can therefore still reach the one mechanism that
 * crosses threads without the event loop, the SAME `Atomics.store`/`notify` pair the success path
 * uses, which `normalize-budget.ts`'s own `Atomics.wait` observes within a handful of milliseconds
 * (confirmed directly: ~14ms, against a 5000ms budget, in a standalone repro before this file reached
 * its current form). Registered as literally the first statement, before anything else in this file
 * can throw first.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M17.md P14
 */
import { workerData } from 'node:worker_threads';

import { applyNormalizeRulesToText } from './normalize.ts';
import {
  SYNC_CRASHED,
  type NormalizeWorkerData,
  type NormalizeWorkerMessage,
} from './normalize-worker-protocol.ts';

const data = workerData as NormalizeWorkerData;

// Registered FIRST, before any other statement in this file can throw first (see this file's own
// header for the full account of why this, not the parent's `worker.on('error', ...)`, is what
// detects a crash promptly). `try`/`catch` around the signalling itself: if `data.sync` is somehow
// not the `Int32Array` it is supposed to be, there is truly nothing left this thread can do except
// exit and let the parent's own wall-clock budget be the backstop that still bounds it.
process.on('uncaughtException', () => {
  try {
    Atomics.store(data.sync, 0, SYNC_CRASHED);
    Atomics.notify(data.sync, 0);
  } catch {
    // See above: the parent's own budget still bounds this case, just without an early signal.
  } finally {
    process.exit(1);
  }
});

let message: NormalizeWorkerMessage;
try {
  message = { ok: true, outcome: applyNormalizeRulesToText(data.text, data.rules, data.scope) };
} catch (cause) {
  message = { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
}

const header = new Int32Array(data.resultBuffer, 0, 2);
const payloadCapacity = data.resultBuffer.byteLength - 8;
const payloadBytes = new TextEncoder().encode(JSON.stringify(message));
if (payloadBytes.byteLength > payloadCapacity) {
  header[1] = -1; // too large to fit -- `normalize-budget.ts` turns this into its own typed refusal.
} else {
  new Uint8Array(data.resultBuffer, 8, payloadCapacity).set(payloadBytes);
  header[1] = payloadBytes.byteLength;
}

// The write above is PURE memory, visible to the calling thread the instant it observes this store
// (both threads share the one process's address space) -- unlike `postMessage`, nothing else needs
// to run in between for it to be there.
Atomics.store(data.sync, 0, 1);
Atomics.notify(data.sync, 0);
