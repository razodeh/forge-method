/**
 * `runVcsStep` — the one place a `VcsError` (or any failure of a git-backed operation) becomes step-failure
 * DATA instead of an exception. Shared by the step handlers (`steps.ts`) and the lane-integration code
 * (`integrate.ts`), which is why it lives in its own module: `steps.ts` imports `integrate.ts` and the reverse
 * import would be a cycle.
 *
 * @see PLAN-M5.md P15
 */
import { ForgeError } from '@forge/core/errors';

import type { StepFailureInfo } from './types.ts';

/** `VcsError` cannot itself become a `ForgeError` (`vcs ← schemas` only, no `core` edge — its own doc
 * comment names `@forge/engine` as the one place that wraps it) — caught here, at the one place every lane-
 * lifecycle operation in this module goes through, rather than at each of the half-dozen call sites that
 * could throw one. Returns the *data* shape a handler folds into its own `StepOutcome`, not a thrown
 * `ForgeError` itself: a lane failing to create, or a commit failing, is a normal runtime outcome a
 * scheduler should be able to see and (per `06` §6.8, P16) potentially retry, not a reason to crash the
 * whole dispatch pipeline. */
export async function runVcsStep<T>(
  stepId: string,
  operation: () => Promise<T>,
): Promise<
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: StepFailureInfo }
> {
  try {
    return { ok: true, value: await operation() };
  } catch (cause) {
    const vcsCode = isErrorWithCode(cause) ? cause.code : 'UNKNOWN';
    const vcsMessage = cause instanceof Error ? cause.message : String(cause);
    // Wrapped so a caller inspecting `failure.code`/`.message` sees the real underlying VcsError's own
    // values, not this ForgeError's own generic RUN-037 message — the ForgeError itself (with its own
    // registered remedy) is retained on `failure.cause`, so nothing is lost for a reader who does want
    // it, only not surfaced as the primary failure text here.
    const forgeError = new ForgeError('RUN-037', { stepId, vcsCode, vcsMessage }, { cause });
    return {
      ok: false,
      failure: { source: 'vcs', code: vcsCode, message: vcsMessage, cause: forgeError },
    };
  }
}

function isErrorWithCode(value: unknown): value is { readonly code: string } {
  return (
    typeof value === 'object' && value !== null && 'code' in value && typeof value.code === 'string'
  );
}
