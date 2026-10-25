/**
 * `formatZodIssues` — the shared rendering of a `z.ZodError`'s `issues` into one human-readable
 * line, for a `ForgeError` detail built from a schema failure.
 *
 * `${issue.path.join('.') || '(root)'}: ${issue.message}`, one line per issue, joined `'; '` — this
 * exact shape is, independently, `extensions/src/module/parse.ts`'s and `extensions/src/install/
 * consent.ts`'s own local `formatZodIssues`, `CFG-008`'s inline version in `artifacts/validate.ts`,
 * and roughly a dozen further call sites across the codebase (`SPEC-QUESTIONS.md` Q325) — the same
 * convention arrived at independently everywhere, never imported from one place. This file is now
 * that one place for the two call sites migrated to it here (`CFG-021`'s `parseModule`, `CFG-036`'s
 * `describeRequestedCapabilities`); the remaining inline occurrences are unchanged, a pre-existing
 * duplication this fix does not attempt to clear in one pass.
 *
 * **The `z.union` branch (`SPEC-QUESTIONS.md` Q325).** Before this branch, a `ZodInvalidUnionIssue`
 * fell through to the generic `${path}: ${message}` line like any other issue — but zod's own
 * `message` for `invalid_union` is a fixed, generic `"Invalid input"` (confirmed directly against
 * the real installed zod `3.25.76`), naming neither which shapes were allowed nor why the value
 * satisfied none of them. (`z.discriminatedUnion` does not need this branch: a bad discriminator
 * value renders zod's own distinct, already-specific `invalid_union_discriminator` message, and a
 * matched-discriminator branch's own field errors surface directly, never wrapped in
 * `invalid_union` at all.) Q325 disclosed the `z.union` gap as latent rather than fixing it,
 * reasoning no schema feeding this convention used `z.union` yet — but `consent.ts`'s own
 * `overlayCapabilityEntrySchema` already is a live `z.union` in this exact convention (missed by
 * Q325's own research): a `requestsCapabilities` entry with an unrecognised key, e.g. `{ bogus: 1 }`,
 * already rendered the unhelpful `"requestsCapabilities.0: Invalid input"` through the unfixed
 * convention, a real gap, not merely a hypothetical one. Fixed by naming every union member's own
 * failure, never guessing which member the author "meant" — picking a single "closest" member would
 * be exactly the kind of classifier `SPEC-QUESTIONS.md` Q325's own DECISION 2 (the `uncovered` hunk
 * reason) rejects elsewhere: claiming to discern something nothing at this point in the pipeline can
 * actually discern. Every candidate's own sub-issues are rendered through this same function
 * (recursively), so a union nested inside another union still names each leaf failure.
 *
 * @see SPEC-QUESTIONS.md Q325
 */
import type { ZodIssue } from 'zod';

function formatZodIssue(issue: ZodIssue): string {
  const where = issue.path.join('.') || '(root)';
  if (issue.code === 'invalid_union') {
    const shapes = issue.unionErrors
      .map((error, index) => `shape ${String(index + 1)} (${formatZodIssues(error.issues)})`)
      .join('; ');
    const shapeCount = String(issue.unionErrors.length);
    return `${where}: value did not match any of the ${shapeCount} allowed shapes -- ${shapes}`;
  }
  return `${where}: ${issue.message}`;
}

/** Renders `issues` (a `z.ZodError`'s own `.issues`) into one line, suitable for a `ForgeError`
 * detail. Never throws, and never produces an empty string for a non-empty `issues` array. */
export function formatZodIssues(issues: readonly ZodIssue[]): string {
  return issues.map(formatZodIssue).join('; ');
}
