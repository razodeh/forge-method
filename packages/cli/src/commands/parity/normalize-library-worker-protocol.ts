/**
 * The shared wire protocol between `normalize-library-budget.ts` (the caller, on the main/calling
 * thread) and `normalize-library-worker.ts` (the worker-thread entry point) — the structural
 * (`library` surface) counterpart to `normalize-worker-protocol.ts`, split into its own file for the
 * IDENTICAL reason that file's own doc comment states: so `normalize-library-budget.ts` can import
 * this file's constants and types as plain VALUES without that import also executing
 * `normalize-library-worker.ts`'s own top-level code (its `process.on('uncaughtException', ...)`
 * registration and its unwrapped `workerData` access, both of which assume a real worker-thread
 * realm that the calling thread does not have).
 *
 * **`specs/22` M17 P14 follow-up (`process/SPEC-QUESTIONS.md` Q317 Decision 8, a critic finding
 * against this piece's own first version): `redact-json-pointers`' own regex ran on `library`'s
 * normalisation path synchronously, with no wall-clock budget at all.** `normalize-worker-protocol
 * .ts`'s sibling pair already gives `process`/`file`/`http`'s TEXT-shaped path a worker-thread-
 * bounded budget; `library`'s own STRUCTURAL path (`compare.ts`'s `normalizeLibraryOrThrow`) never
 * had one, because nothing on it ran a regex before `redact-json-pointers` existed. A critic proved
 * this live: a flat, ADJACENT-group pattern (`(a*)(a*)...(a*)b`, 20 groups — a shape
 * `isPathologicalReplacePattern`'s own file header already discloses its lint cannot catch, since
 * that lint only flags NESTED quantifiers) passes `CFG-511` cleanly and then exhibits real,
 * measured exponential blowup against `applyReplace` directly (128ms at input length 8, 11.7s at
 * length 14, killed before length 16 finished) — with nothing on `library`'s own path able to stop
 * it short of the whole process hanging. This file, `normalize-library-worker.ts` and
 * `normalize-library-budget.ts` give `library`'s own normalisation the IDENTICAL worker-thread,
 * forcibly-terminated bound the text path already has, reusing the exact same `Atomics`/
 * `SharedArrayBuffer` mechanism and `DEFAULT_NORMALIZE_BUDGET_MS` — never a second, independently
 * invented bound. Deliberately a SEPARATE pair of files from `normalize-worker(-protocol).ts`, not a
 * generalisation of it: `NormalizeWorkerData.text` is a `string`, this file's own `value` is
 * `unknown` (a parsed `CanonicalValue` tree) — different enough shapes that a shared generic type
 * would cost more clarity than the small, mechanical duplication of this file's own structure saves,
 * the identical "duplication over a clever shared abstraction" judgment `replace-lint.ts`'s own file
 * header makes repeatedly for ITS OWN near-identical sibling checks.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M17.md P14
 * @see process/SPEC-QUESTIONS.md Q317 Decision 8
 */
import type { NormalizeRule } from './declaration-types.ts';
import type { applyNormalizeRulesToLibraryValue } from './normalize.ts';

/** Identical VALUE (not shared constant — this file never imports from `normalize-worker-protocol
 * .ts`, keeping the two protocol pairs fully independent) to that file's own `SYNC_CRASHED`, for the
 * identical reason: `sync[0]`'s own "this worker thread crashed" value, distinct from `0` (pending)
 * and `1` (done normally, read the result from `resultBuffer`). */
export const SYNC_CRASHED = 2;

/** The exact shape `normalize-library-budget.ts` posts into `workerData` — kept in one place so the
 * two files cannot silently drift apart on what a worker invocation needs, mirroring
 * `NormalizeWorkerData`'s own doc comment for `resultBuffer`'s layout, with ONE real difference: the
 * payload at bytes 8 onward is a `node:v8` `serialize()` buffer, never UTF-8-encoded JSON text — see
 * {@link NormalizeLibraryWorkerMessage}'s own doc comment for why. */
export interface NormalizeLibraryWorkerData {
  readonly value: unknown;
  readonly rules: readonly NormalizeRule[];
  readonly sync: Int32Array;
  readonly resultBuffer: SharedArrayBuffer;
}

/**
 * What the worker writes at `resultBuffer`'s own payload — a successful rule application, or the
 * stringified form of whatever `applyNormalizeRulesToLibraryValue` itself threw (never expected in
 * practice: that function's own contract is "never throws", {@link NormalizeLibraryOutcome} carries
 * every failure as data — this is a second, independent safety net, the identical role
 * `NormalizeWorkerMessage`'s own doc comment states for its text-shaped sibling).
 *
 * **Serialised with `node:v8`'s `serialize`/`deserialize`, NEVER `JSON.stringify`/`JSON.parse` —
 * confirmed as a real, live bug this exact choice fixes, not a preventive guess.** `outcome.value`
 * (the `ok: true` arm) is an arbitrary `unknown` descended from a `library` probe's own return
 * value, which can legitimately be, or contain, `NaN`/`Infinity`/`-Infinity` — and
 * `JSON.stringify` silently turns every one of those into `null` (`canonical-json.ts`'s own file
 * header already states this as the exact reason ITS OWN `toCanonicalJson` refuses to use
 * `JSON.stringify` either). An earlier version of this file used `JSON.stringify` for this
 * message, and a real, pre-existing test broke as a direct result: a candidate value of `NaN`,
 * meant to reach `compare.ts`'s own `observationsEqual` (which calls `toCanonicalJson` and is
 * SUPPOSED to throw a `TypeError` for exactly this, converted upstream into a typed `RUN-130`
 * `error` verdict) silently arrived as `null` instead, because the worker boundary itself had
 * already coerced it — the verdict changed from `error` to `mismatch`, a correctness regression in
 * the oracle itself, confirmed by running the real pre-existing test, not merely reasoned about.
 * `v8.serialize`/`v8.deserialize` use V8's own structured-clone-compatible format (the identical
 * mechanism Node already uses internally for `workerData` and `postMessage`), which preserves
 * `NaN`/`Infinity`/`-Infinity`/`undefined` exactly — confirmed directly before this fix, not
 * assumed. Both ends of this one shared-memory channel run in the SAME Node process (the calling
 * thread and its own worker), so there is no cross-version/cross-build format concern a `v8.serialize`
 * payload could otherwise carry if it ever crossed a process boundary — it never does here.
 */
export type NormalizeLibraryWorkerMessage =
  | { readonly ok: true; readonly outcome: ReturnType<typeof applyNormalizeRulesToLibraryValue> }
  | { readonly ok: false; readonly message: string };
