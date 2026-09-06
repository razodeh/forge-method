/**
 * `checkSelfReview` (I1), `checkTestImplementationSeparation` (I2) — `15` §15.10's
 * separation-of-duties invariants.
 *
 * @see specs/15 §15.10
 * @see PLAN-M2.md P8
 */
import { minimatch } from 'minimatch';

import { violation } from './violation.ts';
import type {
  InvariantViolation,
  OutputReviewAssignment,
  TestImplementationAssignment,
} from './types.ts';

/**
 * `05` §5's own line: "An overlay that would let an agent review, test or diagnose its own output
 * fails compile." Checked directly on already-resolved identities: `producerAgent` and
 * `reviewerAgent` are the same agent iff the assignment is a self-review.
 */
export function checkSelfReview(
  assignments: readonly OutputReviewAssignment[],
): readonly InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  for (const assignment of assignments) {
    if (assignment.producerAgent !== assignment.reviewerAgent) continue;
    violations.push(violation('I1', 'CFG-501', { role: assignment.reviewerRole }));
  }
  return violations;
}

/**
 * `10` §10.6: "the agent that writes tests is never the agent that makes them pass... Test files are
 * outside the implementer's file claim." Two independent triggers, checked per story: the same agent
 * authoring and implementing, or the implementer's `file_ownership` overlapping a real test path.
 *
 * `file_ownership` entries are globs (`15` §15.3.1's own worked example: `file_ownership: [
 * "src/api/**" ]`), not literal paths, so this is real glob-vs-literal-path *membership* — a solved,
 * single-pattern-matching problem (`minimatch`) — not the harder glob-vs-glob *intersection* problem
 * `PLAN-M2.md` P3's `checkSplitFileOwnership` leaves unaddressed for lack of a spec-given algorithm.
 * That precedent does not excuse skipping this check: a test path either matches a claimed glob or it
 * does not, with no ambiguity to invent a rule for.
 */
export function checkTestImplementationSeparation(
  assignments: readonly TestImplementationAssignment[],
): readonly InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  for (const assignment of assignments) {
    if (assignment.testAuthorAgent === assignment.implementerAgent) {
      violations.push(
        violation('I2', 'CFG-502', {
          detail: `story "${assignment.storyId}": the same agent (${assignment.implementerAgent}) both authors its tests and implements it`,
        }),
      );
      continue;
    }
    for (const claimed of assignment.implementerFileOwnership) {
      const coveredTestPath = assignment.testPaths.find((testPath) => minimatch(testPath, claimed));
      if (coveredTestPath === undefined) continue;
      violations.push(
        violation('I2', 'CFG-502', {
          detail: `story "${assignment.storyId}": implementer ${assignment.implementerAgent}'s file_ownership "${claimed}" covers test path "${coveredTestPath}"`,
        }),
      );
    }
  }
  return violations;
}
