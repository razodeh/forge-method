/**
 * The shared wire protocol between `normalize-budget.ts` (the caller, running on the main/calling
 * thread) and `normalize-worker.ts` (the worker-thread entry point) — split into its OWN file, with
 * no top-level executable statement of any kind, specifically so `normalize-budget.ts` can import
 * its constants and types as plain VALUES (not only `import type`) without that import also
 * triggering `normalize-worker.ts`'s own top-level code.
 *
 * **Why this split exists, confirmed as a real bug, not a preventive guess.** An earlier version of
 * this codebase had `normalize-budget.ts` import `SYNC_CRASHED` (a real, runtime constant, not a
 * type) directly from `normalize-worker.ts`. Since `import type` erases at compile time but a plain
 * `import` does not, that single non-type import forced Node to load and EXECUTE the whole worker
 * file as an ordinary module the moment `normalize-budget.ts` itself was imported — including the
 * file's own top-level `process.on('uncaughtException', ...)` registration and its unwrapped
 * `data.resultBuffer` access, which assumes it is running inside a real worker thread with real
 * `workerData`. On the calling thread, `workerData` is `null` (`node:worker_threads`'s own
 * documented value outside a worker), so simply importing `normalize-budget.ts` crashed with
 * `TypeError: Cannot read properties of null (reading 'resultBuffer')` before a single test in this
 * whole suite could even run. This file is the fix: nothing in it can ever execute as a side effect
 * of being imported, because it contains no executable statement at all, only `const`/`type`.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M17.md P14
 */
import type { NormalizeTargetScope, applyNormalizeRulesToText } from './normalize.ts';
import type { NormalizeRule } from './declaration-types.ts';

/** `sync[0]`'s own "this worker thread crashed" value — distinct from `0` (pending) and `1` (done
 * normally, read the result from `resultBuffer`) so `normalize-budget.ts` can tell "the rules
 * finished" from "this thread died before they could" without inspecting anything else. */
export const SYNC_CRASHED = 2;

/** The exact shape `normalize-budget.ts` posts into `workerData` — kept in one place so the two
 * files cannot silently drift apart on what a worker invocation needs.
 *
 * `resultBuffer` layout (all offsets in bytes, all integers little-endian via `Int32Array`, the
 * platform-native order both threads share since they are the same process): byte 0 is the `sync`
 * flag `Atomics.wait`/`notify` watch (0 pending, 1 done normally — check bytes 4-7, 2 crashed — see
 * {@link SYNC_CRASHED}'s own doc comment; a DIFFERENT `SharedArrayBuffer` from the one `sync` itself
 * names, carried alongside it rather than packed into this one, only so `normalize-worker.ts`'s own
 * write-then-store ordering is visually obvious from the two separate names); bytes 4-7 hold the
 * UTF-8 payload's own byte length, or `-1` for "the real payload would not fit" (an
 * `applyNormalizeRulesToTextBounded`-decided refusal, never attempted by the worker itself); bytes 8
 * onward hold the UTF-8-encoded JSON payload itself, up to `resultBuffer.byteLength - 8` bytes. */
export interface NormalizeWorkerData {
  readonly text: string;
  readonly rules: readonly NormalizeRule[];
  readonly scope: NormalizeTargetScope;
  readonly sync: Int32Array;
  readonly resultBuffer: SharedArrayBuffer;
}

/** What the worker writes at `resultBuffer`'s own JSON payload — a successful rule application, or
 * the stringified form of whatever `applyNormalizeRulesToText` itself threw (never expected in
 * practice: that function's own contract is "never throws", {@link NormalizeTextOutcome} carries
 * every failure as data — this is a second, independent safety net alongside `normalize-worker.ts`'s
 * own top-level `process.on('uncaughtException', ...)` handler, for a throw that file's own try/catch
 * can still catch synchronously rather than needing the crash path at all). */
export type NormalizeWorkerMessage =
  | { readonly ok: true; readonly outcome: ReturnType<typeof applyNormalizeRulesToText> }
  | { readonly ok: false; readonly message: string };
