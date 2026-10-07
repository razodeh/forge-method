/**
 * `emitParityCheckTelemetry` — `specs/22` M16 P15: the parity half of this milestone's telemetry,
 * riding M15 P11's own already-shipped, already-gauntleted `CheckRun` machinery
 * (`../loop/test/check-telemetry.ts`, this piece's own direct precedent for shape, tone and the
 * `FORGE_RUN_ID`-gated stance — read in full before changing this file). It is the SAME event type,
 * the SAME `kind:`-tagged untyped-payload pattern, the SAME "emit only when `runId` is defined, after
 * the real work already durably committed" discipline that file's own two emitters already establish.
 *
 * **Placement (a DECISION, reported in full).** This file sits beside the parity verbs
 * (`check-command.ts`, `capture-command.ts`, …, all in this directory) rather than inside
 * `../loop/test/check-telemetry.ts` itself: that file's own `loop/test/` home is specific to the
 * `forge test`/`forge test exempt` CLI noun, not a general "every `CheckRun` emitter lives here"
 * module — each noun's own emitter sits beside its own verb's implementation, the identical
 * convention `check-command.ts`/`capture-command.ts` already establish for the parity noun itself.
 * Reaching into an unrelated noun's own directory for this would read as ownership this piece does not
 * have; a second, equivalently-placed file is the more honest shape.
 *
 * **Payload.** `kind: 'parity'` carries the count per verdict, the total, the evidence id (`null` for
 * a `--no-record` run) and the declaration names — never an observation (`18` §18.4, Q294 Decisions 5
 * and 10, Amendment A13): the identical "a measurement, not the thing measured" line this whole
 * telemetry system draws everywhere else.
 *
 * **Call-site discipline (a DECISION, reported in full).** Called from `runParityCheck` itself
 * (`check-command.ts`), at its own tail, strictly AFTER a real `ParityEvidence` record has already
 * been written (when `--no-record` is absent) — mirroring `emitExemptionDeclaredTelemetry`'s own
 * "only after the real write commits" discipline (`../loop/test/exemptions.ts`'s `appendExemption`
 * fires its own telemetry immediately after its own file write), not `emitBindingCheckTelemetry`'s
 * own looser "after the check's own result is known, which may be before a separate evidence-writing
 * call" stance: unlike the binding case, `runParityCheck` is the ONE function that both decides AND
 * records this invocation's own result (the write happens inside it, not in a separate sibling
 * function a caller invokes afterwards), so firing telemetry at its own tail is firing it after both
 * are already real, with no second call site to order against.
 *
 * @see specs/18 §18.4
 * @see specs/22 M16 P15
 * @see process/SPEC-QUESTIONS.md Q294 Decision 5
 * @see process/SPEC-QUESTIONS.md Q294 Decision 10
 * @see process/plans/PLAN-M16.md P15
 */
import type { Clock } from '@forge/core';
import { SECRET_PATTERNS } from '@forge/extensions/skills';
import { appendEvent } from '@forge/telemetry/events';

import type { CaseVerdict, DeclarationStopVerdict } from './counting.ts';

/** The count of declarations, this invocation, landing at each of `13` F-TEST-9's nine verdicts
 * (`counting.ts`'s own {@link DeclarationStopVerdict}/{@link CaseVerdict}) — every key always present
 * (`0`, never omitted, for a verdict none of this invocation's declarations reached), so a reader
 * never has to treat a missing key as zero itself. A `Record` over the two real verdict unions
 * `counting.ts` already exports, rather than nine hand-listed fields, so this type can never silently
 * drift from the spec's own closed, total-order set of nine. */
export type ParityVerdictCounts = Readonly<Record<DeclarationStopVerdict | CaseVerdict, number>>;

export interface ParityCheckTelemetryInput {
  readonly projectRoot: string;
  readonly runId: string | undefined;
  readonly clock: Clock;
  /** Every declaration this invocation actually counted (`RunParityCheckResult.declarations.length`)
   * — `0` for a `no-declarations` check, never omitted: Q294 Decision 4's own "a check with no
   * declaration at all counts one failing" makes a genuinely-run, zero-declaration check a real
   * occurrence this piece's own Mandate wants a before-picture of, not a non-event. */
  readonly total: number;
  readonly verdictCounts: ParityVerdictCounts;
  /** `null` for a `--no-record` run — which, per Q294 Decision 5, every in-run (gate) evaluation
   * genuinely is, since a gate check's own project root can never be named (see this piece's own
   * report for the real file:line proof). */
  readonly evidenceId: string | null;
  /** Every declaration this invocation named — never an observation: a declaration's own NAME, not
   * what it observed. */
  readonly declarationNames: readonly string[];
}

/** `specs/22` M16 P15. Called once per real `forge parity check` invocation, from `runParityCheck`
 * itself, after its own `ParityEvidence` write (if any) has already committed. */
export async function emitParityCheckTelemetry(input: ParityCheckTelemetryInput): Promise<void> {
  if (input.runId === undefined) return;
  await appendEvent(
    input.projectRoot,
    input.runId,
    {
      type: 'CheckRun',
      runId: input.runId,
      ts: input.clock.now(),
      payload: {
        kind: 'parity',
        total: input.total,
        verdictCounts: input.verdictCounts,
        evidenceId: input.evidenceId,
        declarationNames: input.declarationNames,
      },
    },
    { valuePatterns: SECRET_PATTERNS },
  );
}
