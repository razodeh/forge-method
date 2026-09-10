/**
 * `evaluateDodProfile` — checks one story against one DoD profile's `ready` or `done` list. Pure: no
 * I/O, no knowledge of what a `check: id` means beyond calling the caller-supplied `resolveCheck` (see
 * `types.ts`'s own `DodContext` doc comment for why resolution is not this module's job).
 *
 * @see specs/09 §9.8
 * @see PLAN-M8.md P1
 */
import { evaluateCondition } from '../expr.ts';
import type { DodCheck, DodContext, DodProfileFile, DodViolation } from './types.ts';

function checkLabel(check: DodCheck): string {
  return typeof check === 'string' ? check : check.check;
}

/** A `{ check: id }` entry with no real answer from `resolveCheck` fails closed (a real, reported
 * violation) — the identical "provably unreachable given an earlier validation pass still fails safe
 * rather than throws" stance `@forge/methods/expr`'s own `evaluateCondition` already takes, applied
 * here to "a caller's `resolveCheck` genuinely does not recognise this id" instead. */
function checkPasses(
  check: DodCheck,
  context: DodContext,
  resolveCheck: (id: string) => boolean,
): boolean {
  // A fresh object literal built from `context.story` here (rather than passing `context` itself)
  // satisfies `evaluateCondition`'s own `Record<string, unknown>` parameter without a cast — `DodContext`
  // has no index signature of its own, deliberately (`types.ts`'s own doc comment), and TS only infers
  // one for a literal at the call site, not for a pre-typed variable.
  if (typeof check === 'string') return evaluateCondition(check, { story: context.story });
  return resolveCheck(check.check);
}

export function evaluateDodProfile(
  profileFile: DodProfileFile,
  profileId: string,
  phase: 'ready' | 'done',
  context: DodContext,
  resolveCheck: (id: string) => boolean,
): readonly DodViolation[] {
  const profile = profileFile.profiles[profileId];
  if (profile === undefined) {
    return [
      {
        profileId,
        phase,
        check: '(profile)',
        message: `no such DoD profile "${profileId}".`,
      },
    ];
  }

  const violations: DodViolation[] = [];
  for (const check of profile[phase]) {
    if (checkPasses(check, context, resolveCheck)) continue;
    const label = checkLabel(check);
    violations.push({
      profileId,
      phase,
      check: label,
      message:
        typeof check === 'string' ? `expression "${label}" failed.` : `check "${label}" failed.`,
    });
  }
  return violations;
}
