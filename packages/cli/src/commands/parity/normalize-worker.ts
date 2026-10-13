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
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M17.md P14
 */
import { workerData } from 'node:worker_threads';

import { applyNormalizeRulesToText, type NormalizeTargetScope } from './normalize.ts';
import type { NormalizeRule } from './declaration-types.ts';

/** The exact shape `normalize-budget.ts` posts into `workerData` — kept in one place so the two
 * files cannot silently drift apart on what a worker invocation needs.
 *
 * `resultBuffer` layout (all offsets in bytes, all integers little-endian via `Int32Array`, the
 * platform-native order both threads share since they are the same process): byte 0 is the `sync`
 * flag `Atomics.wait`/`notify` watch (0 pending, 1 done — a DIFFERENT SharedArrayBuffer from the one
 * `sync` itself names, carried alongside it rather than packed into this one, only so this worker's
 * own write-then-store ordering, below, is visually obvious from the two separate names); bytes 4-7
 * hold the UTF-8 payload's own byte length, or `-1` for "the real payload would not fit" (an
 * `applyNormalizeRulesToTextBounded`-decided refusal, never attempted here); bytes 8 onward hold the
 * UTF-8-encoded JSON payload itself, up to `resultBuffer.byteLength - 8` bytes. */
export interface NormalizeWorkerData {
  readonly text: string;
  readonly rules: readonly NormalizeRule[];
  readonly scope: NormalizeTargetScope;
  readonly sync: Int32Array;
  readonly resultBuffer: SharedArrayBuffer;
}

/** What this worker writes at `resultBuffer`'s own JSON payload — a successful rule application, or
 * the stringified form of whatever `applyNormalizeRulesToText` itself threw (never expected in
 * practice: that function's own contract is "never throws", {@link NormalizeTextOutcome} carries
 * every failure as data — this exists only so a genuine, unexpected bug in this worker is reported
 * as data too, rather than this worker thread dying silently with the caller left relying on the
 * wall-clock budget alone to notice). */
export type NormalizeWorkerMessage =
  | { readonly ok: true; readonly outcome: ReturnType<typeof applyNormalizeRulesToText> }
  | { readonly ok: false; readonly message: string };

const data = workerData as NormalizeWorkerData;

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
