/**
 * `revalidateArtifacts` — `06` §6.10 step 3: re-read and re-validate every artifact a reconstructed
 * `RunState` says a resumed run has produced, surfacing anything `validateArtifact` (`@forge/core`, M1)
 * now rejects as a `ReconciliationIssue`. `types.ts`'s own doc comment on `ReconciliationIssue` has the
 * fuller reasoning for why "hand-edit mismatch" is read as "fails `validateArtifact`" rather than a
 * genuine content-diff, given nothing in this codebase remembers a prior version to diff against.
 *
 * Synchronous, deliberately (`PLAN-M5.md`'s own literal Surface signature has no `Promise<>`): every
 * dependency this needs — `ProjectPaths.resolveWithin`, `ArtifactDocument.parse`, `validateArtifact` — is
 * itself synchronous, and `node:fs`'s own `readFileSync` completes this without introducing the one
 * async dependency (`@forge/core`'s own `readArtifact`, `io.ts`) that would otherwise force this into a
 * `Promise`.
 *
 * @see specs/06 §6.10
 * @see PLAN-M5.md P19
 */
import { readFileSync } from 'node:fs';

import { ArtifactDocument, ForgeError, ProjectPaths, validateArtifact } from '@forge/core';

import type { ReconciliationIssue, RunState } from './types.ts';

function describeArtifactFailure(cause: unknown): string {
  if (cause instanceof ForgeError) return cause.message;
  // `String(cause)` is a defensive fallback with no real path to it: every failure this function's own
  // caller (revalidateOne) can actually catch here -- readFileSync's own Node fs errors,
  // ProjectPaths.resolveWithin's own CFG-003/CFG-004 ForgeErrors, ArtifactDocument.parse's own
  // CFG-005/006/007 ForgeErrors -- is always a real Error already. Kept rather than asserted away, the
  // same "provably unreachable given noUncheckedIndexedAccess/a closed real call surface, documented
  // and accepted as permanently sub-100%-covered" precedent this build already established elsewhere
  // (e.g. buildCommitMessage's own `?? node.id` in @forge/engine/dispatch).
  return cause instanceof Error ? cause.message : String(cause);
}

/** One artifact's own check: missing/unreadable, structurally malformed (`ArtifactDocument.parse`
 * itself throws), or schema/section-invalid (`validateArtifact` returns `valid: false`) all collapse to
 * the identical `ReconciliationIssue` shape — a resumed run's own caller needs to know *that* an
 * artifact needs attention, not which of these three specific ways `@forge/core` detected it. */
function revalidateOne(paths: ProjectPaths, relativePath: string): ReconciliationIssue | undefined {
  try {
    const absolute = paths.resolveWithin(relativePath);
    const source = readFileSync(absolute, 'utf8');
    const doc = ArtifactDocument.parse(source, relativePath);
    const outcome = validateArtifact(doc);
    if (outcome.valid) return undefined;
    return {
      path: relativePath,
      reason: outcome.errors.map((error) => error.message).join('; '),
    };
  } catch (cause) {
    return { path: relativePath, reason: describeArtifactFailure(cause) };
  }
}

export function revalidateArtifacts(
  runState: RunState,
  projectRoot: string,
): readonly ReconciliationIssue[] {
  const paths = new ProjectPaths(projectRoot);
  const issues: ReconciliationIssue[] = [];
  // `RunState.artifactPaths` is a Set, not an array with a stable index -- iterated in its own
  // insertion order (a real JS Set guarantee), which is itself the order the underlying events were
  // replayed in (`reconstructRunState`'s own single forward pass), the closest thing to a deterministic
  // order this function can offer without sorting paths lexically and losing that provenance instead.
  for (const relativePath of runState.artifactPaths) {
    const issue = revalidateOne(paths, relativePath);
    if (issue !== undefined) issues.push(issue);
  }
  return issues;
}
