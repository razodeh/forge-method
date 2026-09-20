/**
 * `resolveClaimPolicy` — `17` §17.4 point 5 ("narrower file claims... ownership globs are tighter
 * than greenfield because unknown coupling is likely; out-of-claim writes default to `strict` even at
 * `guided` autonomy"), layered on top of `06` §6.7's own base per-autonomy default table
 * ("`strict` (default for `autonomous`)... `warn` (default for `guided`)").
 *
 * `06` §6.7 names a default for exactly two of the three `AutonomyLevel` values; `supervised` is left
 * unstated. Resolved here as `strict` — the same, more conservative default `autonomous` already gets
 * — since a `supervised` run already has a human approving every step, and a stricter out-of-claim
 * default costs that workflow nothing it was not already going to review.
 *
 * Before this piece, no code anywhere resolved a claim policy from an autonomy level at all:
 * `packages/cli/src/commands/run/context.ts`'s own `buildRunEngineContext` hard-coded
 * `claimPolicy: 'strict'` unconditionally, silently correct for `autonomous`/`supervised` but wrong
 * for `guided` (which `06` §6.7 defaults to `warn`) — confirmed directly by reading that file and its
 * own test before writing this one. This function is the first real implementation of that mapping;
 * `context.ts` is updated to call it instead of hard-coding a literal.
 *
 * This is the DEFAULT policy. `@forge/engine/dispatch`'s `resolveStepClaim` (`PLAN-M13.md` P14, `06` §6.7 as
 * amended) overrides it to `strict` for an `agent` step that declares `outputs`, at every autonomy level and
 * for adopted and non-adopted projects alike; only a step declaring none keeps what this returns.
 *
 * @see specs/17 §17.4
 * @see specs/06 §6.7
 * @see PLAN-M10.md P20
 */

/** A local, literal-union transcription of `@forge/schemas`'s `execution.autonomy` enum — the
 * identical "second, independent copy to avoid an unwanted dependency edge" precedent
 * `packages/engine/src/plan/types.ts`'s own `AutonomyLevel` already establishes for the same three
 * values, for the same reason: `@forge/kb`'s real boundary-graph edges (`core`, `schemas`, `diagrams`)
 * do permit a `schemas` import, but this package's own `adopt` subsystem otherwise takes no dependency
 * on `@forge/schemas`'s config shape specifically, and a three-value literal union is cheaper to keep
 * in sync by inspection than to add one for. */
export type AdoptAutonomyLevel = 'supervised' | 'guided' | 'autonomous';

export type ClaimPolicy = 'strict' | 'warn';

/**
 * The real out-of-claim write policy for a step, given the project's configured autonomy level and
 * whether the project is a `forge adopt`-adopted brownfield codebase.
 *
 * `adopted` always wins over the autonomy-level default: an adopted project's own unknown coupling
 * risk (`17` §17.4 point 2's own blast-radius rationale) applies regardless of how much a human is
 * otherwise supervising the run, so `guided` — the one level `06` §6.7 defaults to something looser
 * than `strict` — is the only level this override actually changes anything for.
 */
export function resolveClaimPolicy(autonomy: AdoptAutonomyLevel, adopted: boolean): ClaimPolicy {
  if (adopted) return 'strict';
  return autonomy === 'guided' ? 'warn' : 'strict';
}
