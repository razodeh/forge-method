/**
 * `approveGate` — the decision `forge gate approve <id>` records (`10` §10.3 rule 1): a gate is approved only
 * when every deterministic check passed, or the failing ones are covered by a valid, unexpired waiver, and only
 * by someone the gate's `approval:` block names.
 *
 * Before `PLAN-M13.md` P41 the command appended `GateApproved` without evaluating anything, so `forge gate
 * approve G-Verify` on a gate with a failing check recorded an approval the spec forbids (rule 1: "a gate with
 * any failing deterministic check cannot be approved — only waived"). It now runs through the same
 * `evaluateGate` + `applyWaiver` + `isApproved` machinery `forge gate check` uses (the caller supplies the
 * evaluation; this module decides) and returns the evaluation summary the event carries as the audit trail
 * (rule 4: every evaluation leaves "the exact command output", here as digests so the event log stays small).
 *
 * **Who may approve.** The spec names it in two places and this enforces exactly those:
 *  - `10` §10.3 `approval.roles` ("who may approve") and `quorum`. A person at the CLI is `human`. Every shipped
 *    gate says `roles: [human], quorum: 1`. A gate that names only agent roles cannot be approved by `human`
 *    here, and a quorum above 1 cannot be met, because this command records one approval and nothing that
 *    tells two approvers apart (refused, not assumed).
 *  - `05` §5.9 `gates.may_approve` (immutable, `15` §15.2) and `03` §3.6 (`alwaysHuman` gates are never
 *    approved by an agent). `may_approve` was read by no run-time code through M13 (`SPEC-QUESTIONS.md`
 *    Q220): the CLI had no way to know which agent, if any, typed the command, so `forge gate approve`
 *    always passed `{ kind: 'human' }`. `PLAN-M14.md` P15 closes that: `gate-commands.ts`'s own
 *    `resolveApprover` reads the real FORGE session marker (`@forge/core/session-marker`, `FORGE_RUN_ID`/
 *    `FORGE_AGENT_ID`, an honest-session signal, not a security boundary — a hostile shell can still unset
 *    or forge it) and, for an honest agent session naming this run, builds the `agent` approver below from
 *    the project's own resolved roster. A caller that already knows who is approving (an engine-dispatched
 *    approval, a future authenticated channel) still passes one directly and the marker is never consulted.
 *    Either way, the `agent` approver requires all three of: not `alwaysHuman`, the agent's role in
 *    `approval.roles`, and the gate in the agent's `may_approve`. Which agents SHOULD hold `may_approve` for
 *    which gates (Q220: `pm`/`po` for the gates whose evidence they now write) is the owner's decision and is not
 *    made here: this reads the declared list and enforces it.
 *
 * Advisory checks are listed in the summary as not run, and never block: rule 2. `openQuestionsPolicy` is
 * carried into the summary; nothing produces open questions from an advisory check yet (`types.ts`), so
 * "blocking open questions must be resolved" is `G-Product`'s deterministic `blocking-open-questions` check,
 * not something this decides.
 *
 * **Same-run conflict of interest (`PLAN-M14.md` P19, `SPEC-QUESTIONS.md` Q232 decision 8).** Even an
 * agent approver `approverRefusal` above would otherwise clear (a real role, a real `may_approve` entry,
 * not `alwaysHuman`) is refused (`GATE-511`, nothing appended) when `ApproveGateInput.producedEvidenceFor`
 * — the gate ids this run's own event log shows the approving agent produced evidence for, computed by the
 * caller (`gate-commands.ts`'s own `agentProducedEvidenceForGate`, over `readEvents(projectRoot, runId)`,
 * never a different run) — names this gate: `05` §5.2's separation-of-duties rule and `10` §10.3 rule 6
 * read together, an agent cannot mark its own work done. A human approver is never refused this way
 * (`--owner` stays the person's own word regardless, `10` §10.3), and `gates.may_approve` is otherwise
 * unchanged (rule 8's other half: `pm`/`po` keep it). A sibling invariant to `20` §20.10 S6 ("a tainted
 * step cannot approve a gate") — that one is `@forge/engine/security`'s own `assertGateApprovalAllowed`,
 * a *different*, already-shipped mechanism (external-content taint, not same-run evidence) this piece
 * does not touch; the two invariants are cited together because both restrict who may approve a gate,
 * not because they share an implementation.
 *
 * @see specs/10 §10.3
 * @see specs/05 §5.2
 * @see specs/05 §5.9
 * @see specs/03 §3.6
 * @see specs/20 §20.10 S6
 * @see PLAN-M13.md P41
 * @see PLAN-M14.md P15
 * @see PLAN-M14.md P19
 */
import { createHash } from 'node:crypto';

import { ForgeError } from '@forge/core/errors';

import { sanitizedCheckText } from './report.ts';
import type { GateDefinition, GateEvaluationResult, Waiver } from './types.ts';
import { applyWaiver, isApproved } from './waiver.ts';

/** The artifact *type name* an `evidence:`/`gateEvidence` reference names, reading `10` §10.1's own
 * `Type(*)`/`Type(id)` grammar (`plan/dependencies.ts`'s own `ARTIFACT_REFERENCE` reads the identical
 * grammar for a different mini-DSL) as the text before the first `(` — never a wildcard match: `(*)` is
 * read as "the type", not "any id of it", because nothing in this reference shape carries a *specific* id
 * to match against here (`document.ts`'s own worked-example entries are bare type names or `Type(*)`,
 * never `Type(id)` in practice, but the grammar is read the same way either way). A bare type name with no
 * `(` at all (`10` §10.3's own `- artifact: ArchitectureSpec`) is returned unchanged. */
export function evidenceArtifactType(ref: string): string {
  const openParen = ref.indexOf('(');
  return openParen === -1 ? ref : ref.slice(0, openParen);
}

/** `specs/22` M15 P8: unlike `evidenceArtifactType` above (which this piece's own conflict-of-interest
 * check still uses, type name only), RESOLVING a reference against committed artifacts needs the
 * `(*)`/`(id)` suffix too — the one piece of this grammar nothing before P8 ever read. `'*'` (bare, or
 * an explicit `(*)`) means "at least one committed, non-superseded artifact of this type"; a specific
 * id means exactly that id. */
export function parseEvidenceRef(ref: string): { readonly type: string; readonly id: string } {
  // The type name is always `evidenceArtifactType`'s own reading -- the IDENTICAL extraction
  // `GATE-511`'s own same-run conflict-of-interest check already uses for the same raw string, so the
  // two checks can never disagree about what type a given reference names. A gauntlet critic round
  // found an earlier version of this function used a stricter, independent regex instead
  // (`/^([^()]+)\(([^()]*)\)$/`) that silently misparsed anything not perfectly well-formed (an
  // unbalanced paren, trailing garbage) as a literal, never-matching type name — e.g. `ADR(ADR-0011`
  // (missing the closing paren) read as the type `"ADR(ADR-0011"` here but `"ADR"` under
  // `evidenceArtifactType`, two different readings of the one string within the same module.
  const type = evidenceArtifactType(ref);
  // The id/wildcard portion, read only from a GENUINELY well-formed `Type(...)` suffix immediately
  // after that same type name — anything else (no parens at all, an unterminated one, trailing text
  // after the closing paren) falls back to `'*'` (wildcard: "any committed, non-superseded artifact
  // of this type") rather than a stricter reading that could never match — the safer failure
  // direction for a malformed reference nothing has rejected at gate-load time (`document.ts`'s own
  // `readEvidence` validates only that `artifact` is a non-blank string, not its internal grammar).
  const suffix = ref.slice(type.length);
  const match = /^\(([^()]*)\)$/.exec(suffix);
  return { type, id: match?.[1] ?? '*' };
}

/** One `evidence:` entry, resolved against committed artifacts by the caller (`gate-commands.ts`'s own
 * `resolveGateEvidence`, a real directory scan — this module reads only the result, never touches disk
 * itself, the identical "no ambient I/O in a pure decision function" stance `producedEvidenceFor`
 * already takes). `ids`: every committed, non-superseded, type-matching artifact id found — for a
 * `Type(*)`/bare reference, every one found; for `Type(id)`, that one id if it resolved. `problem`,
 * when present, is why resolution failed (`RUN-112`'s own two real reasons); `supersededId` names which
 * specific id was found-but-superseded, for a precise remedy. */
export interface ResolvedEvidenceRef {
  readonly ref: string;
  readonly ids: readonly string[];
  readonly problem?: 'missing' | 'superseded' | undefined;
  readonly supersededId?: string | undefined;
}

/** `RUN-112`: refuses on the FIRST unresolved evidence reference, in declaration order — a gate
 * declaring several, several of which are unresolved, names the first rather than every one at once
 * (the identical "name one real reason, not a bag of them" shape `GATE-507`'s own `failing` already
 * takes for several failing checks). Called both by `approveGate` below (so this module's own exported,
 * independently-callable decision function never approves a gate with unresolved evidence even for a
 * caller that bypasses `forge gate approve`'s own CLI wrapper) and directly by `gate-commands.ts`'s own
 * `gateWaive` (which never calls `approveGate` at all — see this module's own top-of-file doc comment,
 * "Same-run conflict of interest", for the identical reason `GATE-511` also has two real call sites). */
export function refuseOnUnresolvedEvidence(
  gateId: string,
  resolvedEvidence: readonly ResolvedEvidenceRef[],
): void {
  for (const entry of resolvedEvidence) {
    if (entry.problem === undefined) continue;
    throw new ForgeError('RUN-112', {
      gateId,
      ref: entry.ref,
      reason: entry.problem,
      ...(entry.supersededId === undefined ? {} : { id: entry.supersededId }),
    });
  }
}

/** Who is approving. `human` is a person at the terminal; `agent` carries the agent's role id and the
 * `gates.may_approve` list of its (immutable) definition. */
export type GateApprover =
  | { readonly kind: 'human' }
  | {
      readonly kind: 'agent';
      readonly agentId: string;
      readonly mayApprove: readonly string[];
    };

/** One deterministic check as the approval audit trail records it: the verdict, and digests of the exact
 * output rather than the output (`stdout` is JSON a `failOn` read; `stderr` is sanitised text). */
export interface ApprovedCheckRecord {
  readonly checkId: string;
  readonly run: string;
  readonly passed: boolean;
  /** `true` for a failing check the recorded waiver covers. */
  readonly waived: boolean;
  readonly exitCode: number;
  readonly stdoutSha256: string;
  readonly stderrSha256?: string;
  readonly reason?: string;
}

/** What a `GateApproved` event carries about the evaluation that justified it. */
export interface GateApprovalSummary {
  readonly gateId: string;
  /** `checks`: every deterministic check passed. `waiver`: at least one failed and the waiver covers the gate. */
  readonly basis: 'checks' | 'waiver';
  readonly checksPassed: number;
  /** Every failing check, waived or not. */
  readonly checksFailed: number;
  /** The failing checks the recorded waiver covers (all of `checksFailed`: a waiver covers the gate). */
  readonly checksWaived: number;
  readonly checks: readonly ApprovedCheckRecord[];
  readonly waiver?: Waiver;
  readonly advisory: readonly { readonly id: string; readonly agent: string }[];
  /** Advisory checks are never run by the evaluator (`evaluate.ts`): recorded so nobody reads an empty list as
   * "the advisory review found nothing". */
  readonly advisoryRun: false;
  readonly openQuestionsPolicy: 'block' | 'warn';
  readonly approver: string;
  /** `specs/22` M15 P8: every artifact id `resolvedEvidence` actually found, flattened across every
   * declared `evidence:` entry — "a human approves a claim with proof attached rather than a name"
   * (`PLAN-M15.md` P8's own Mandate), so the ids a real approval was recorded against are themselves
   * part of the recorded summary, not just the fact that resolution succeeded. `[]` for a gate that
   * declares no evidence at all (most gates today) or declares some but, since `refuseOnUnresolvedEvidence`
   * already ran above with nothing thrown, every entry resolved to at least one id — this field is only
   * ever `[]` in the first, no-evidence-declared case. */
  readonly evidence: readonly string[];
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function describeApprover(approver: GateApprover): string {
  return approver.kind === 'human' ? 'human' : `agent ${approver.agentId}`;
}

/** The audit-trail record of every deterministic check in `evaluated`: verdict plus digests of the exact
 * output. `waived` marks the failing ones a waiver covers. Shared by an approval and a waiver, so the two events
 * describe one evaluation the same way.
 *
 * `PLAN-M14.md` P17: the digests are of `sanitizedCheckText`'s output (`report.ts`) — the SAME sanitised,
 * capped text a written `GateReport` fences `stdout`/`stderr` as — not the raw check result, so a reader
 * can sha256 the fenced block in the report file this run also wrote and get back exactly these digests
 * ("the digests verify against it"). Typed over `Pick<GateEvaluationResult, 'checks'>` rather than the
 * full interface: this function has only ever read `.checks`, and the narrower type lets `runGateStep`
 * (`dispatch/steps.ts`) reuse it directly on a `GateReport` (no `advisory`/`openQuestionsPolicy` of its
 * own) for the in-run `GateEvaluated` payload's own per-check digests, without a second, duplicate
 * digesting function. */
export function recordChecks(
  evaluated: Pick<GateEvaluationResult, 'checks'>,
  waived: boolean,
): readonly ApprovedCheckRecord[] {
  return evaluated.checks.map((check) => ({
    checkId: check.checkId,
    run: check.run,
    passed: check.passed,
    waived: waived && !check.passed,
    exitCode: check.exitCode,
    stdoutSha256: sha256(sanitizedCheckText(check.stdout)),
    ...(check.stderr === undefined
      ? {}
      : { stderrSha256: sha256(sanitizedCheckText(check.stderr)) }),
    ...(check.reason === undefined ? {} : { reason: check.reason }),
  }));
}

/** Why `approver` may not approve `definition`, or `undefined` when it may. */
export function approverRefusal(
  definition: GateDefinition,
  approver: GateApprover,
): string | undefined {
  const roles = definition.approval?.roles ?? ['human'];
  const quorum = definition.approval?.quorum ?? 1;
  if (!Number.isInteger(quorum) || quorum < 1) {
    return `the gate's approval.quorum (${String(quorum)}) is not a whole number of at least 1`;
  }
  if (quorum > 1) {
    return `the gate needs ${String(quorum)} distinct approvers (approval.quorum) and this command records one approval and cannot tell approvers apart`;
  }
  if (approver.kind === 'human') {
    return roles.includes('human')
      ? undefined
      : `the gate's approval.roles are [${roles.join(', ')}], which do not include \`human\``;
  }
  if (approver.agentId === 'human') {
    return '`human` is the person at the terminal, not an agent id';
  }
  if (definition.autonomyOverride === 'alwaysHuman') {
    return 'the gate is alwaysHuman: only a person approves it (03 §3.6)';
  }
  if (!roles.includes(approver.agentId)) {
    return `the gate's approval.roles are [${roles.join(', ')}], which do not include ${approver.agentId}`;
  }
  if (!approver.mayApprove.includes(definition.id)) {
    return `${approver.agentId}'s gates.may_approve does not list ${definition.id} (05 §5.9)`;
  }
  return undefined;
}

export interface ApproveGateInput {
  readonly definition: GateDefinition;
  /** The fresh evaluation of the gate (`evaluateGate`), NOT yet carrying a waiver. */
  readonly evaluated: GateEvaluationResult;
  /** A recorded waiver to apply, if any. An expired or malformed one is refused by `applyWaiver` (`GATE-504`,
   * `GATE-505`); a caller that holds several picks the newest that is still valid. */
  readonly waiver?: Waiver | undefined;
  /** The checks that were failing when `waiver` was granted (`GateWaived`'s recorded evaluation). A waiver excuses
   * THOSE checks: it covers this approval only if every check failing now is among them, so a waiver granted for
   * one failure (or while the gate was green) is not a blank cheque for a check that regressed later. Absent means
   * the waiver recorded none, and it covers nothing. */
  readonly waivedCheckIds?: readonly string[] | undefined;
  readonly approver: GateApprover;
  /** `PLAN-M14.md` P19: the gate ids this run's event log shows the approving agent produced evidence
   * for (see this module's own doc comment, "Same-run conflict of interest"). Caller-computed — this
   * module reads only whether `definition.id` is a member, never the event log itself. Absent or not
   * containing `definition.id`: no conflict, the ordinary rules above decide alone. Only ever consulted
   * for `approver.kind === 'agent'`: a human approver ignores it, whatever it contains. */
  readonly producedEvidenceFor?: readonly string[] | undefined;
  /** `specs/22` M15 P8: `definition.evidence`, each entry resolved against committed artifacts by the
   * caller (`gate-commands.ts`'s own `resolveGateEvidence`) — see `ResolvedEvidenceRef`'s own doc
   * comment. Absent/empty: no evidence declared, nothing to check (most gates today). */
  readonly resolvedEvidence?: readonly ResolvedEvidenceRef[] | undefined;
  /** Epoch milliseconds, injected (`21` §21.1: no ambient clock in the engine). */
  readonly now: number;
}

/** Decides the approval and returns what its event records.
 * @throws {ForgeError} `GATE-502` for a definition with no deterministic check; `GATE-508` when the approver may not approve this gate; `GATE-511` when an agent
 * approver produced evidence for this gate in this run; `GATE-507` when a deterministic
 * check failed and no valid waiver covers it; `GATE-504`/`GATE-505` for a waiver that is malformed or lapsed. */
export function approveGate(input: ApproveGateInput): GateApprovalSummary {
  const { definition, evaluated, approver } = input;
  // `15` §15.10 I4 again, at the last door: a definition with no deterministic check "passes" (`evaluateGate` is
  // `every`), and approving it on that basis would approve nothing. The document loader refuses one already.
  if (definition.checks.deterministic.length === 0) {
    throw new ForgeError('GATE-502', { gateId: definition.id });
  }
  const refusal = approverRefusal(definition, approver);
  if (refusal !== undefined) {
    throw new ForgeError('GATE-508', {
      gateId: definition.id,
      approver: describeApprover(approver),
      detail: refusal,
    });
  }
  // `PLAN-M14.md` P19: checked right after the ordinary authorisation refusal above and before any
  // check-result reasoning below — role/quorum/`alwaysHuman`/`may_approve` are prerequisites (only an
  // approver those already clear can even reach a conflict-of-interest question), and whether the checks
  // themselves pass is irrelevant to it (a clean gate is refused this way exactly as a failing one is).
  // Never for a human approver, whatever `producedEvidenceFor` contains (see this module's own doc
  // comment, "Same-run conflict of interest").
  if (approver.kind === 'agent' && (input.producedEvidenceFor ?? []).includes(definition.id)) {
    throw new ForgeError('GATE-511', { gateId: definition.id, agentId: approver.agentId });
  }
  // `specs/22` M15 P8: checked right after the same-run conflict-of-interest refusal above, for the
  // identical reason it sits right after the authorisation refusal — a prerequisite the checks
  // themselves have no bearing on. `RUN-112`'s own doc comment (`refuseOnUnresolvedEvidence`) has the
  // full reasoning for why this module throws it directly rather than deferring to the caller.
  refuseOnUnresolvedEvidence(definition.id, input.resolvedEvidence ?? []);

  // A waiver is consulted only when a check failed: a gate that passed needs none, and a stale one lying around
  // must not turn a clean approval into a `GATE-505`.
  // "Passed" is re-derived from the per-check verdicts rather than trusted from the evaluation's own flag, and a
  // definition's every check must have a verdict (an evaluation missing one has not shown it passed).
  const allPassed = evaluated.checks.every((check) => check.passed);
  if (evaluated.gateId !== definition.id) {
    throw new ForgeError('GATE-507', {
      gateId: definition.id,
      failing: `the evaluation, which is of gate ${evaluated.gateId}`,
    });
  }
  // A check with no verdict never ran, and a waiver excuses a failure, not an absence: refused with or without one.
  const missing = definition.checks.deterministic
    .filter((declared) => !evaluated.checks.some((check) => check.checkId === declared.id))
    .map((declared) => declared.id);
  if (missing.length > 0) {
    throw new ForgeError('GATE-507', {
      gateId: definition.id,
      failing: `check ${missing.join(', ')} (no verdict: it was never evaluated, and a waiver cannot excuse a check that did not run)`,
    });
  }
  const consistent = { ...evaluated, passed: allPassed };
  const uncovered = allPassed
    ? []
    : evaluated.checks
        .filter((check) => !check.passed)
        .map((check) => check.checkId)
        .filter((id) => !(input.waivedCheckIds ?? []).includes(id));
  if (uncovered.length > 0 && input.waiver !== undefined) {
    throw new ForgeError('GATE-507', {
      gateId: definition.id,
      failing: `check ${uncovered.join(', ')} (the waiver on record excused other checks, not this one)`,
    });
  }
  const decided =
    input.waiver === undefined || allPassed
      ? consistent
      : applyWaiver(consistent, input.waiver, input.now);
  if (!isApproved(decided)) {
    const failing = evaluated.checks.filter((check) => !check.passed).map((check) => check.checkId);
    throw new ForgeError('GATE-507', {
      gateId: definition.id,
      failing: failing.length === 0 ? 'the gate' : `check ${failing.join(', ')}`,
    });
  }

  const waived = !allPassed;
  const checks = recordChecks(evaluated, waived);
  return {
    gateId: definition.id,
    basis: waived ? 'waiver' : 'checks',
    checksPassed: checks.filter((check) => check.passed).length,
    checksFailed: checks.filter((check) => !check.passed).length,
    checksWaived: checks.filter((check) => check.waived).length,
    checks,
    ...(waived && decided.waiver !== undefined ? { waiver: decided.waiver } : {}),
    advisory: evaluated.advisory.map((check) => ({ id: check.id, agent: check.agent })),
    advisoryRun: false,
    openQuestionsPolicy: definition.openQuestionsPolicy,
    approver: describeApprover(approver),
    evidence: (input.resolvedEvidence ?? []).flatMap((entry) => entry.ids),
  };
}
