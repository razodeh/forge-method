/**
 * `applyMigrations` — runs a resolved `MigrationPlan` against a document, or fails partway through.
 *
 * @see specs/18 §18.9
 * @see PLAN-M1.md P10
 * @see SPEC-QUESTIONS.md Q27
 */
import type {
  ApplyMigrationsResult,
  Migration,
  MigratableDocument,
  MigrationPlan,
} from './types.ts';

/**
 * Freezes a deep clone of `value` before it is ever handed to a migration.
 *
 * Cloning first, not freezing `value` in place: freezing the caller's own document object would be a
 * side effect this function has no business causing — the caller may hold that reference and expect
 * it to remain exactly as mutable (or not) as they left it. `structuredClone` produces the fresh,
 * independent copy; the recursive `Object.freeze` below is what turns a migration's attempt to
 * mutate its input (per `18` §18.9's own, non-conforming illustrative style — see
 * `SPEC-QUESTIONS.md` Q27) into a thrown `TypeError` that `applyMigrations` catches, rather than a
 * silent corruption of shared state.
 */
function frozenClone<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    // Safe: the check above already narrowed `value` to a non-null `object`, so every one of its
    // own keys resolves to a value `deepFreeze` can recurse into regardless of that value's type.
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/**
 * Deep-clones `value` into entirely fresh, unfrozen objects.
 *
 * A migration that only rebuilds the parts of the document it actually changes (ordinary, encouraged
 * style — `up: (doc) => ({ ...doc, body: newBody })`) returns an object whose *untouched* nested
 * values are still the exact frozen references `frozenClone` handed it. Left alone, those frozen
 * fragments would leak into `current` for the next step and, on the last step, into this function's
 * own success result — turning a migration's ordinary output into a write-once landmine for whatever
 * reads it next. Calling this on every step's return value guarantees `current` is always freshly
 * mutable, independent of how much of the document a given migration actually rebuilt.
 */
function freshClone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Runs `plan.steps` in order, calling each step's `up` (direction `'up'`) or `down` (`'down'`).
 *
 * A step whose `types` does not include the document's current `type` is skipped, not applied — per
 * `PLAN-M1.md` P10's Check, "migrating a type not in `migration.types` is a no-op, not a silent
 * corruption." This guards against a plan built for one type ever being run, by caller error, against
 * a document of another.
 *
 * Every step receives a frozen, independent clone of the document as it stood after the previous
 * step — never the caller's own object, and never a reference a later step could see mutated out from
 * under it. What a step returns is immediately re-cloned into fresh, unfrozen memory (`freshClone`)
 * before becoming the next `current`, so a step that only rebuilds part of the document never leaks
 * one of its own frozen input fragments into `current` or, on the last step, into this function's
 * own result.
 */
export function applyMigrations(
  doc: MigratableDocument,
  plan: MigrationPlan,
): ApplyMigrationsResult {
  let current = doc;
  const applied: Migration[] = [];
  const skipped: Migration[] = [];

  for (const step of plan.steps) {
    if (!step.types.includes(current.type)) {
      skipped.push(step);
      continue;
    }

    // Calls `step.up`/`step.down` directly, rather than extracting either into a variable first
    // (`@typescript-eslint/unbound-method` rightly flags a standalone reference to an object method
    // that could rely on `this` — these never do, but calling through the property access keeps
    // that true by construction instead of asserting it).
    try {
      if (plan.direction === 'up') {
        current = freshClone(step.up(frozenClone(current)));
      } else if (step.down !== undefined) {
        current = freshClone(step.down(frozenClone(current)));
      } else {
        // Unreachable for a plan `planMigrations` produced (it already refuses a 'down' plan whose
        // step lacks `down`); reachable only for a plan a caller or test hand-builds directly.
        return {
          success: false,
          failure: {
            migration: step,
            cause: new Error("Migration plan step has no 'down' to run."),
          },
          appliedBeforeFailure: applied,
        };
      }
    } catch (cause) {
      return { success: false, failure: { migration: step, cause }, appliedBeforeFailure: applied };
    }
    applied.push(step);
  }

  return { success: true, document: current, applied, skipped };
}
