/**
 * Types for `@forge/cli/doctor` — `03` §3.7's own real checklist, made runnable.
 *
 * @see specs/03 §3.7
 * @see PLAN-M6.md C6
 */

/** `PLAN-M6.md` C6's own literal Surface text gives `DoctorCheck` exactly four fields (`id`/`ok`/
 * `message`/`fix?`) — undersold relative to what `03` §3.7's own "exit code 5 if any hard prerequisite
 * fails, 0 with warnings otherwise" contract actually needs: a way to tell a *hard* failure (git
 * missing, config invalid) from a mere *warning* (a stale lock, an unresolved secret reference) per
 * check, not just pass/fail. `severity` is that missing field, the identical "the plan's own bullet
 * undersells the signature" correction this whole codebase's own `SPEC-QUESTIONS.md` already makes
 * repeatedly for other pieces. Meaningful only when `ok` is `false` — a passing check has nothing to
 * classify. */
export type CheckSeverity = 'hard' | 'warning';

export interface DoctorCheck {
  readonly id: string;
  readonly ok: boolean;
  readonly severity: CheckSeverity;
  readonly message: string;
  readonly fix?: string;
}

/** `v: 1` — the identical versioning precedent `formatJsonEvent`'s own doc comment names for `03`
 * §3.5's `{"v":1,...}` contract, applied to this piece's own, differently-shaped report (a
 * `DoctorReport` is not a `ForgeEvent`; nothing in `03` §3.5 requires it to be, only that real JSON
 * output carries the same real versioning discipline). */
export interface DoctorReport {
  readonly v: 1;
  /** `true` iff no check with `severity: 'hard'` failed — `03` §3.7's own exit-code contract
   * (`5`/`0`) reads directly off this field, not off `checks.every(c => c.ok)` (a report with only
   * warnings is still `ok: true`). */
  readonly ok: boolean;
  readonly checks: readonly DoctorCheck[];
  /** Present only when `DoctorOptions.fix` was `true` — one real, honest outcome per check that
   * failed on the pass immediately *before* the fix attempt ran (`PLAN-M11.md` P14). `checks` above
   * always reflects the *post*-fix state (checks are re-run after fixes are applied), so a caller
   * comparing `fixes` against `checks` can see exactly what changed and what did not. */
  readonly fixes?: readonly DoctorFixResult[];
}

/** One real, honest outcome of `--fix` attempting to remediate a single failed check —
 * `PLAN-M11.md` P14's own "a check with no safe automatic fix continues to only report, honestly,
 * rather than fabricating a false 'fixed' claim" mandate. Every originally-failing check gets exactly
 * one of these, whether or not a safe automatic fix existed for it — `applied: false` here is a real,
 * honest outcome, not an omission. */
export interface DoctorFixResult {
  readonly id: string;
  readonly applied: boolean;
  readonly message: string;
}
