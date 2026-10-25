/**
 * The worker-thread ENTRY POINT `normalize-library-budget.ts` spawns to apply a `library` case's
 * `normalize` rules under a wall-clock budget it can enforce by force-terminating this whole thread
 * — the structural (`library` surface) counterpart to `normalize-worker.ts`, built the identical
 * way, for the identical reason (`normalize-library-worker-protocol.ts`'s own doc comment has the
 * full account of why `library` needed this at all). Never imported by anything other than
 * `normalize-library-budget.ts`'s own `new Worker(...)` call — this file's only job is to unwrap
 * `workerData`, call the real, already-tested {@link applyNormalizeRulesToLibraryValue}, and write
 * the result back into shared memory; it carries no logic of its own worth testing in isolation
 * (`normalize-library-budget.test.ts` proves the whole mechanism, budget included, end to end,
 * through the one real public entry point — the identical division of labour
 * `normalize-budget.test.ts` already uses for the text-shaped sibling).
 *
 * See `normalize-worker.ts`'s own file header for the full, independently-confirmed account of why
 * shared memory (never `postMessage`/a `MessagePort`) and why `process.on('uncaughtException', ...)`
 * here (never the parent's own `worker.on('error', ...)`) are what make this bound actually work —
 * every one of those reasons applies identically here, unrelated to whether the payload crossing the
 * boundary is `text: string` or `value: unknown`.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M17.md P14
 * @see process/SPEC-QUESTIONS.md Q317 Decision 8
 */
import { serialize } from 'node:v8';
import { workerData } from 'node:worker_threads';

import { applyNormalizeRulesToLibraryValue } from './normalize.ts';
import {
  SYNC_CRASHED,
  type NormalizeLibraryWorkerData,
  type NormalizeLibraryWorkerMessage,
} from './normalize-library-worker-protocol.ts';

const data = workerData as NormalizeLibraryWorkerData;

// Registered FIRST, before any other statement in this file can throw first — the identical
// ordering `normalize-worker.ts`'s own header explains in full (the parent's own `Atomics.wait`
// would otherwise block for the WHOLE budget before noticing a crash this early).
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

let message: NormalizeLibraryWorkerMessage;
try {
  message = { ok: true, outcome: applyNormalizeRulesToLibraryValue(data.value, data.rules) };
} catch (cause) {
  message = { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
}

const header = new Int32Array(data.resultBuffer, 0, 2);
const payloadCapacity = data.resultBuffer.byteLength - 8;
// `node:v8`'s `serialize`, never `JSON.stringify` -- see `NormalizeLibraryWorkerMessage`'s own doc
// comment for the real, confirmed bug this avoids (JSON silently turns NaN/Infinity into null).
const payloadBytes = serialize(message);
if (payloadBytes.byteLength > payloadCapacity) {
  header[1] = -1; // too large to fit -- `normalize-library-budget.ts` turns this into its own typed refusal.
} else {
  new Uint8Array(data.resultBuffer, 8, payloadCapacity).set(payloadBytes);
  header[1] = payloadBytes.byteLength;
}

// Pure memory, visible to the calling thread the instant it observes this store (both threads share
// the one process's address space) -- unlike `postMessage`, nothing else needs to run in between.
Atomics.store(data.sync, 0, 1);
Atomics.notify(data.sync, 0);
