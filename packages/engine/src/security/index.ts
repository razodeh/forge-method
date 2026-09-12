/**
 * `@forge/engine/security` — `20` §20.10's own S6/S7 primitives, made reachable outside this package
 * (`taint-guard.ts`'s own S6 guards were previously only ever imported by relative path from within
 * `@forge/engine` itself; `destructive-confirmation.ts`'s own S7 gate needs a real external caller —
 * `@forge/cli`'s own `deployEnvironment` — which cannot reach a `src/`-relative path across a package
 * boundary).
 *
 * @see specs/20 §20.5 point 3
 * @see specs/20 §20.10 S6
 * @see specs/20 §20.10 S7
 * @see specs/15 §15.5.4
 * @see PLAN-M11.md P10
 * @see PLAN-M11.md P11
 */
export {
  assertGateApprovalAllowed,
  assertGrantEscalationAllowed,
  assertProductionTargetAllowed,
  type StepTaint,
  type TaintAllowed,
  type TaintDecision,
  type TaintRefused,
} from './taint-guard.ts';
export {
  destructiveConfirmationPhrase,
  requireDestructiveConfirmation,
  type DestructiveConfirmationDecision,
  type DestructiveConfirmationRequest,
  type DestructiveOpsPolicy,
} from './destructive-confirmation.ts';
