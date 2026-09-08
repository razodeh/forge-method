/**
 * Types for `@forge/agents/interaction` — `05` §5.7's seven interaction modes and `05` §5.2's own
 * separation-of-duties rule, enforced at runtime.
 *
 * @see specs/05 §5.2
 * @see specs/05 §5.7
 * @see PLAN-M6.md A6
 */

/** `05` §5.7's own seven-row table, verbatim. */
export type InteractionMode =
  | 'solo'
  | 'pair'
  | 'fan-out'
  | 'panel'
  | 'debate'
  | 'relay'
  | 'swarm-review';

/** `05` §5.2's own four review/verification-shaped roles a separation-of-duties check applies to —
 * narrowed from A1's own load-time *shape* check (which the M6 A1 critic round narrowed further, to
 * `reviewer` alone, since `diagnostician`/`critic` both have real, spec-literal code-shaped outputs a
 * blanket static ban would falsely reject, `SPEC-QUESTIONS.md` Q97). This runtime check is a different
 * question entirely — not "does this role's output type look like code," but "is the specific session
 * instance about to review/test/diagnose the same instance that authored the work" — so all four of
 * `05` §5.2's own named roles apply here, unnarrowed. */
export type SeparationOfDutiesRole = 'reviewer' | 'critic' | 'diagnostician' | 'test-architect';

/** A fresh critic round caught an earlier draft carrying a redundant `authoredStepId` field, always
 * equal to `stepId` by construction (`checkSeparationOfDuties`'s own `authoredBy` map is keyed by the
 * *reviewing* step's own id, not the original authored step's — this function has no way to learn the
 * latter's id at all, so a field documented as naming it could never actually carry that value). Left
 * out rather than shipped as dead, misleading data. */
export interface SeparationViolation {
  readonly runId: string;
  readonly stepId: string;
  readonly role: SeparationOfDutiesRole;
  readonly agentInstanceId: string;
}
