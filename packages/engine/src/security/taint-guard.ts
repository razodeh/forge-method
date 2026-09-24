/**
 * `20` §20.10 S6's own adversarial-test obligation table names three per-step runtime actions a
 * tainted step (one whose context includes untrusted MCP/fetched/brownfield content, `@forge/agents`'s
 * own `markExternalContent`) may never perform: approve a gate, escalate a tool grant, or target a
 * production environment. This module's own three guard functions below are exactly those three, no
 * more. `15` §15.5.4 (verbatim) and `20` §20.5 point 3 each name a LONGER list of consequences for the
 * identical `taint: external` marker: `15` §15.5.4 adds "write ADRs without human confirmation" as a
 * fourth (S6's own three, plus this one, are ALL four `15` §15.5.4 names); `20` §20.5 point 3 restates
 * those four and adds "perform destructive operations" as a fifth. **This module does not implement
 * every consequence either spec names, only S6's own three** -- read the list above precisely as S6's
 * own scope, not the fuller spec text's. The ADR-writing consequence is real and enforced, just not
 * here: a tainted step's own session may write a produced ADR only as `status: proposed`
 * (`dispatch/outputs.ts`'s `taintedAdrStatusProblem`, stated up front in the prompt by `assemble.ts`'s
 * block [6], `TAINTED_ADR_STATUS_NOTE`), and the engine's own DECIDE write-back
 * (`interaction/session.ts`'s `writeAdrBack`) pins the identical rule when its own decider node is
 * tainted -- `PLAN-M14.md` P31, which also gives `forge adr accept|reject|supersede` a real refusal
 * under the P4 session marker, since moving an ADR past `proposed` is a person's own act. The fifth
 * consequence, "destructive operations," remains genuinely unimplemented and out of scope here, for the
 * identical "no live call site to wire a guard into without inventing new, disproportionate runtime
 * behaviour" reason this file's own "Grant escalation"/"Production targeting" sections below already
 * give for their own two guards (`20` §20.3's own destructive-operations flow is a separate, existing
 * mechanism this module does not touch).
 *
 * `PLAN-M11.md` P10's own direct investigation (before writing any test, per this piece's own mandate)
 * found no `taint` concept anywhere in `@forge/engine`'s step/plan/dispatch model at all — not merely
 * untested, genuinely absent — for all three surfaces:
 *
 * - **Gate approval** has a real, already-wired per-step runtime mechanism (`runGateStep`, `dispatch/
 *   steps.ts`): a `gate`-kind `StepNode` unconditionally emitted `GateApproved` once its deterministic
 *   checks passed, with zero notion of whether the step that reached that point was ever tainted. This
 *   is the one surface of the three this module's own guard is wired into a real production *call
 *   site* for — see `StepNode.taint`'s own doc comment (`plan/types.ts`) and `runGateStep`'s own use of
 *   `assertGateApprovalAllowed` below. **Read that precisely, not more broadly than it says: the call
 *   site is real, but nothing in this codebase's real compile/dispatch pipeline populates `taint` on any
 *   real `StepNode` yet** (`markExternalContent`, `20` §20.5's own taint-marking function, has zero
 *   production callers of its own — confirmed by grep, and disclosed above). Until some future piece
 *   wires taint detection into plan compilation or dispatch, `assertGateApprovalAllowed` is consulted
 *   on every real gate step and correctly returns "allowed" every time, because every real `node.taint`
 *   is `undefined`. This closes the *enforcement* half of the gap (the check exists, is correct, and
 *   fires the moment a real taint signal exists) — it does not, and cannot by itself, close the
 *   *signal* half (nothing produces that signal today). A gauntlet critic reviewing this piece read an
 *   earlier draft of this doc comment as implying S6 gate-approval is enforced in production today; it
 *   is not, and this paragraph exists specifically so a future reader does not make the same reading.
 *   **Updated by `PLAN-M14.md` P27, which a later gauntlet critic caught this paragraph going stale
 *   for:** "nothing... populates `taint` on any real `StepNode` yet" is no longer true in general —
 *   `compilePlan` (`plan/compile.ts`) now copies an authored `AgentStep.taint` onto its compiled node
 *   for real, and `restrictGrantForTaint` below (a different real consumer this same file documents,
 *   not `assertGateApprovalAllowed`) fires for real on five real, shipped `StepNode`s (`adopt`'s
 *   `reverse-derive-specs`/`gap-analysis`, `migrate`'s `plan-migration`/`expand`/`contract`) — see
 *   `plan/types.ts`'s own `StepNode.taint` doc comment for the current, accurate picture. The
 *   *gate-approval* claim immediately above specifically still holds, unchanged by P27: nothing in
 *   this codebase propagates an upstream agent step's own taint onto a dependent `gate` step's own
 *   compiled node (a `gate` step can never author `taint` itself, `workflow/schema.ts`), so
 *   `assertGateApprovalAllowed` still only ever sees a real, non-`undefined` taint when a caller
 *   constructs one by hand (a test, today) — this one surface's own "enforcement exists, the signal
 *   does not" framing is still accurate.
 * - **A second, taint-blind path to `GateApproved` exists and is out of this piece's scope, disclosed
 *   rather than silently ignored**: `forge gate approve <id>` (`@forge/cli`'s own `packages/cli/src/
 *   commands/run/gate-commands.ts`, `gateApprove`) emits a real `GateApproved` event directly, with no
 *   taint concept and no `StepNode` (since `PLAN-M13.md` P41 it does evaluate the gate first and refuses unless the
 *   checks pass or a waiver covers them, but it still cannot tell an agent that ran it from a person). Judged a legitimately separate,
 *   spec-external channel rather than a bypass of *this* invariant: `20` §20.5 point 3 and `15` §15.5.4
 *   both say "a tainted **step** cannot approve a gate" — a human operator typing this command has
 *   reviewed the gate themselves and is not a step the run dispatched, the identical class of
 *   human-override `gateWaive`'s own real waiver mechanism already is for gate rule 1. Not fixed (there
 *   is no step, and therefore no taint, for this command to consult), and not silently assumed covered.
 * - **Grant escalation** has no live runtime call site at all: the only escalation mechanism this
 *   codebase implements, `.forge/config.yaml`'s own `security.toolCeilingEscalations` (`15` §15.3.2),
 *   is applied once, at *compile* time, before any step exists to be tainted — a running step has no
 *   action that widens its own already-compiled grant. Inventing one now, only to have something for a
 *   taint check to guard, would itself be new, disproportionate runtime behaviour this milestone's own
 *   mandate explicitly warns against (the identical judgement `PLAN-M11.md` P9 already made for S4's
 *   `isHostAllowed`, which likewise has zero production callers).
 * - **Production targeting** has exactly one real, typed "which environment" call site in this
 *   codebase, `forge deploy <env>` (`@forge/cli`'s own `packages/cli/src/commands/loop/deploy.ts`) — but
 *   it is a top-level, human-invoked CLI verb outside `@forge/engine`'s own step-dispatch model entirely
 *   (it *compiles and runs a workflow*, it is not itself a step a running workflow can dispatch), and no
 *   per-step "this step is the one targeting environment X" fact exists anywhere in `StepNode`/
 *   `ExecuteStepContext` for a guard to attach to — `CompileEnv`'s own same-named `env` field is
 *   internal compile-recursion bookkeeping, unrelated to a workflow-authored `{{env}}` expression
 *   value. Threading a generic "environment" concept through `compilePlan`/`StepNode` broadly enough to
 *   attach a real guard would mean inventing engine-wide semantics `20`/`15` do not specify (which step
 *   in an arbitrary workflow "targets" its own run's environment — all of them? only ones whose `run`
 *   field happens to template `{{env}}`?) — a materially larger, riskier change than this piece's own
 *   proportionate scope.
 *
 * `assertGrantEscalationAllowed`/`assertProductionTargetAllowed` are still real, exported, and directly
 * tested here (with a genuine positive/negative control each, `20` §20.10 S6's own test) — any future
 * caller that *does* gain a real runtime escalation or environment-targeting action has a structural
 * primitive to consult from day one, rather than each needing to invent its own taint check. Disclosed
 * here, and in `SPEC-QUESTIONS.md`, exactly as plainly as P9 disclosed S4's own zero-callers fact, not
 * silently assumed to already be wired in.
 *
 * @see specs/15 §15.3.2
 * @see specs/15 §15.5.4
 * @see specs/20 §20.5 point 3
 * @see specs/20 §20.10 S6
 * @see PLAN-M11.md P9
 * @see PLAN-M11.md P10
 * @see PLAN-M14.md P31
 */
import type { ToolGrant } from '@forge/adapter-kit';

/** The one taint value `20` §20.5 point 3 / `15` §15.5.4 ever name — a plain optional literal on
 * `StepNode`/callers here, not a wider enum a future taint kind would need to be added to in lockstep
 * with every consumer. */
export type StepTaint = 'external' | undefined;

export interface TaintRefused {
  readonly refused: true;
  readonly reason: string;
}

export interface TaintAllowed {
  readonly refused: false;
}

export type TaintDecision = TaintRefused | TaintAllowed;

const ALLOWED: TaintAllowed = { refused: false };

const SPEC_CITATION = '20 §20.5 point 3; 15 §15.5.4';

/** `runGateStep`'s own real, structural consumer — see this module's own doc comment for why gate
 * approval is the one of the three named surfaces with a real per-step runtime call site today. */
export function assertGateApprovalAllowed(taint: StepTaint): TaintDecision {
  if (taint === 'external') {
    return {
      refused: true,
      reason: `a tainted step (taint: external) cannot approve a gate (${SPEC_CITATION})`,
    };
  }
  return ALLOWED;
}

/** No production call site invokes this today — see this module's own doc comment, "Grant escalation,"
 * for why: `.forge/config.yaml`'s own `security.toolCeilingEscalations` is the only escalation
 * mechanism this codebase implements, and it is compile-time-only. Real and tested regardless, so a
 * future runtime escalation action has a structural guard to consult from day one. */
export function assertGrantEscalationAllowed(taint: StepTaint): TaintDecision {
  if (taint === 'external') {
    return {
      refused: true,
      reason: `a tainted step (taint: external) cannot escalate a tool grant (${SPEC_CITATION})`,
    };
  }
  return ALLOWED;
}

/** `15` §15.5.1's own worked example spells `production` in full; `prod` is accepted too, matching how
 * every other real environment-shaped string this codebase already normalises informally (`forge
 * deploy prod` reads the same as `forge deploy production` to a human operator) — a guard that only
 * recognised one spelling would be trivially bypassed by the other. No production call site invokes
 * this today — see this module's own doc comment, "Production targeting," for the full reasoning. */
const PRODUCTION_ENVIRONMENTS: ReadonlySet<string> = new Set(['production', 'prod']);

export function assertProductionTargetAllowed(
  taint: StepTaint,
  environment: string,
): TaintDecision {
  if (taint === 'external' && PRODUCTION_ENVIRONMENTS.has(environment)) {
    return {
      refused: true,
      reason:
        `a tainted step (taint: external) cannot target the production environment ` +
        `${JSON.stringify(environment)} (${SPEC_CITATION})`,
    };
  }
  return ALLOWED;
}

/** What a tainted step's session is allowed to do (`PLAN-M13.md` P28, `SPEC-QUESTIONS.md` Q222). */
export interface TaintedGrantOptions {
  /** Whether the step has somewhere it may write: a claim (`produces`, a declared output) or a caller that confines
   * writes itself (`forge debug`'s FIX scan). A tainted step with none keeps no write access at all. */
  readonly mayWrite: boolean;
}

/**
 * `20` §20.5 points 3 and 4 ("capability restriction is the control", "a tainted step has no dangerous
 * capabilities to abuse"): the grant a tainted step's session actually gets. `read` stays (a step must read its
 * inputs). `exec` is removed entirely (a permitted `git` or `rg` still has flags that write or execute, so a
 * narrower list is not enough), `network` is `none` with its host list dropped, and the adapter-specific `extra`
 * tools (an MCP server's, the escape hatch `07` §7.2 names) are dropped. `write` survives only when the step has a
 * claim to write inside (`mayWrite`): the claim itself is enforced after the session (`06` §6.7), so a tainted
 * step that needs to write a document can, and one that only reports keeps no write access it did not need.
 * Untainted steps get their grant back unchanged.
 *
 * Pure and idempotent; it never widens a grant.
 */
export function restrictGrantForTaint(
  grant: ToolGrant,
  taint: StepTaint,
  options: TaintedGrantOptions,
): ToolGrant {
  if (taint !== 'external') return grant;
  return { read: grant.read, write: grant.write && options.mayWrite, exec: false, network: 'none' };
}
