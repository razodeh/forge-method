/**
 * Types for `@forge/engine/rca` — F-DEBUG-1's own ten-phase RCA loop, real control flow.
 *
 * @see specs/13 §13.2 F-DEBUG-1
 * @see specs/13 §13.2 F-DEBUG-2
 * @see PLAN-M8.md P8
 */
import type { SessionResult } from '@forge/adapter-kit';
import type { Clock } from '@forge/core';

import type { CommandRefusal, ConfinedCommandResult } from '../dispatch/confined-command.ts';

/** `13` §13.2 step 1's own worked field list — the parts of a real `Defect` artifact (`@forge/schemas`)
 * `runRcaLoop` actually needs. Not the full `Defect` type itself: the loop only ever *reads* these
 * fields, and depending on the full artifact type would pull this decoupled, `@forge/cli`-forbidden
 * package into a boundary edge it does not need (`@forge/engine` cannot depend on `@forge/cli`, and
 * `Defect` itself lives in `@forge/schemas`, already a real dependency, but a hand-picked subset keeps
 * this engine's own real input contract explicit rather than "whatever `Defect` happens to have"). */
export interface DefectContext {
  readonly defectId: string;
  readonly observed: string;
  readonly expected: string;
  readonly severity: 'Sev1' | 'Sev2' | 'Sev3' | 'Sev4';
  /** Failing test id, stack trace, log excerpt, trace id, screenshot path — `13` §13.2 step 1's own
   * worked evidence list, verbatim from the source `Defect.evidence`. */
  readonly evidence: readonly string[];
}

/** One real request to `RcaLoopDeps.runSession` — the shape `@forge/engine/interaction`'s own private
 * `runParticipantSession` already establishes (`role`, `prompt`, an optional structured-output
 * schema), reused here as a plain, decoupled function signature rather than that function itself
 * (which needs a full `ExecuteStepContext` this package's own `rca` subpath has no reason to import —
 * `PLAN-M8.md` P9 is the piece that wires a real adapter-backed implementation matching this shape). */
export interface RcaSessionRequest {
  /** Which of the ten phases this session call is for — a real caller (P9) uses this to pick the
   * real system prompt/tooling for that phase; a fake in a test uses it to script a scenario. */
  readonly phase: 'isolate' | 'hypothesise' | 'falsify' | 'diagnose' | 'fix' | 'prevent';
  /** The phase's own instructions: trusted text the loop wrote. It never contains model output or defect
   * text; those travel in `untrusted`, and this text says where to find them. */
  readonly prompt: string;
  /** Data this phase reasons over that did not come from FORGE: the defect's own words, and whatever an
   * earlier session reported (a reproduction command, a scope, a hypothesis, a root cause). It may have
   * been produced by a session that read hostile files, so a caller must deliver it fenced as untrusted
   * data (`20` §20.5) in the user turn, never compile it into a system prompt (`PLAN-M13.md` P27). */
  readonly untrusted?: readonly RcaUntrustedInput[] | undefined;
}

/** One labelled piece of untrusted data for an `RcaSessionRequest`. The `label` is FORGE's own fixed name for
 * the slot (the phase prompt refers to it) and is safe to render; `text` is the data. */
export interface RcaUntrustedInput {
  readonly label: string;
  readonly text: string;
}

/** `RcaLoopDeps.runSession`'s own real type — one non-committing agent turn for a given phase,
 * returning the tool's own real `SessionResult` (`session.structured` is read as whichever plain
 * JSON shape that phase expects, tolerant of a missing/malformed report — `loop.ts`'s own
 * `structuredOrUndefined` doc comment has the fuller reasoning). A real caller (`PLAN-M8.md` P9)
 * backs this with a real adapter-driven session; a test injects a fake.
 *
 * A rejection is a failed attempt, except one marked as a prompt-assembly refusal (`markRefusal`, a refusal
 * before dispatch): that ends the loop (`callSession`, `loop.ts`). An implementation must deliver
 * every `request.untrusted` input to the model as fenced data, since the instruction text points at them. */
export type RunRcaSession = (request: RcaSessionRequest) => Promise<SessionResult>;

/** Where a command's text came from. `proposed`: a model wrote it (a reproduction command); it must pass the agent's
 * tool grant before it runs (`PLAN-M13.md` P28, `20` §20.1). `engine`: FORGE wrote it (`forge test run`, the revert
 * check that wraps an already-vetted proposed command); it is not vetted, but it still runs in the scrubbed
 * environment. */
export type RcaCommandOrigin = 'proposed' | 'engine';

/** A proposed command that was not run, typed: `RUN-095` and the reason category (`CommandRefusal`). */
export interface RcaCommandRefusal extends CommandRefusal {
  readonly code: 'RUN-095';
  /** `ForgeError`'s rendered message for the code, the text a human reads. */
  readonly message: string;
}

/** What `RunRcaShell` returns: the exit code and output of a command that ran, or, when `refusal` is set, the
 * record that it did not (exit code `126`, empty output, nothing executed). A caller must check `refusal` before it
 * reads `exitCode`: a refused command's non-zero exit is not a failing reproduction. `timedOut` and
 * `outputLimitExceeded` mean the command was killed by a limit: its exit code says nothing about the defect either. */
export type RcaShellResult = ConfinedCommandResult & { readonly refusal?: RcaCommandRefusal };

/** `RcaLoopDeps.runShell`'s own real type: one shell command, run against `cwd`. `origin` says who wrote it, and a
 * real implementation must refuse a `proposed` command that does not pass the agent's grant (`RcaShellResult`).
 * REPRODUCE/FIX/PROVE are this loop's only real callers. */
export type RunRcaShell = (
  command: string,
  cwd: string,
  origin: RcaCommandOrigin,
) => Promise<RcaShellResult>;

/** One proposed command that was refused, kept in the evidence so a human sees what the model tried. */
export interface RcaRefusedCommand {
  readonly phase: 'reproduce' | 'prove';
  readonly command: string;
  readonly code: 'RUN-095';
  readonly reason: CommandRefusal['reason'];
  readonly detail: string;
}

/** `runRcaLoop`'s own real dependencies — every one injected so the loop stays unit-testable against
 * a fake, per `PLAN-M8.md` P8's own Surface text. `cwd` is the real project root every `runShell`
 * call runs against (never a lane path of its own — `runParticipantSession`'s own doc comment
 * establishes the identical read-only-session convention this loop's own non-FIX phases follow;
 * `PLAN-M8.md` P9 backs the FIX phase specifically with a real, writable lane). `clock` stamps real
 * ISO timeline entries (`13` §13.2 step 10's own worked `{ first_seen: ... }` shape); `now` is a
 * plain epoch-millis source for wall-clock/cost-budget arithmetic (`bounds.ts`) — kept separate from
 * `clock` because bound checks need cheap numeric subtraction, not ISO-string parsing on every phase
 * boundary. */
export interface RcaLoopDeps {
  readonly runSession: RunRcaSession;
  readonly runShell: RunRcaShell;
  readonly clock: Clock;
  readonly now: () => number;
  readonly cwd: string;
}

/** One hypothesis, settled one way or the other — `rcaSchema`'s own `hypotheses[]` shape, verbatim
 * (`packages/schemas/src/artifacts/rca.ts`). */
export interface RcaHypothesis {
  readonly claim: string;
  readonly refuted_by: string | null;
  readonly status: 'confirmed' | 'refuted';
}

/** `runRcaLoop`'s own successful-diagnosis result — every field `rcaSchema` needs *except* the
 * generic artifact bookkeeping (`id`/`type`/`schemaVersion`/`status`/`created`/`updated`/`revision`/
 * `author`/`run`/`changelog`) every artifact carries regardless of kind — `PLAN-M8.md` P9's own job
 * is allocating an id and filling those in, matching the "engine reports, CLI persists" split
 * `@forge/engine/interaction` already establishes for `swarm-review`. `title` is included (not part
 * of that generic-bookkeeping set) since it is genuinely RCA-specific content the loop itself is best
 * placed to derive, from `symptom`. */
export interface RcaRecordDraft {
  readonly title: string;
  readonly defect: string;
  readonly severity: 'Sev1' | 'Sev2' | 'Sev3' | 'Sev4';
  readonly symptom: string;
  readonly reproduction: string;
  readonly timeline: readonly Readonly<Record<string, string>>[];
  readonly hypotheses: readonly RcaHypothesis[];
  readonly root_cause: string;
  readonly causal_chain: readonly string[];
  readonly fix: string;
  readonly prevention: readonly string[];
  readonly blast_radius: readonly string[];
  readonly kb_writes: readonly string[];
  readonly time_to_diagnose_min: number;
}

/** Evidence gathered so far, for an `escalated`/`needs-more-evidence` outcome — enough for a human or
 * a stronger model (`13` §13.2's own F-DEBUG-2 "escalate to a stronger model, then to a human with the
 * evidence file") to actually pick up where the loop left off, not just a bare "it failed." */
export interface RcaEvidenceBundle {
  readonly defectId: string;
  readonly reproductionAttempts: readonly string[];
  readonly isolatedScope: string | undefined;
  readonly hypotheses: readonly RcaHypothesis[];
  readonly causalChain: readonly string[];
  readonly fixAttempts: readonly string[];
  /** Present only when a proposed command was refused (`PLAN-M13.md` P28). */
  readonly refusedCommands?: readonly RcaRefusedCommand[];
}

/** `runRcaLoop`'s own real return value — a discriminated union, per `PLAN-M8.md` P8's own Surface
 * text: `'needs-more-evidence'`/`'escalated'` are legitimate, useful outcomes (`13` §13.2 step 2's own
 * explicit framing), never thrown as errors. The CLI layer (P9) decides what to *do* with each
 * outcome (write an `RCA-###` artifact, surface an instrumentation plan, page a human); this function
 * only ever reports what happened. */
export type RcaLoopResult =
  | {
      readonly outcome: 'recorded';
      readonly record: RcaRecordDraft;
      /** Present only when a proposed command was refused on the way (`PLAN-M13.md` P28); not part of the RCA document. */
      readonly refusedCommands?: readonly RcaRefusedCommand[];
    }
  | {
      readonly outcome: 'needs-more-evidence';
      readonly instrumentationPlan: readonly string[];
      /** Present only when a proposed command was refused (`PLAN-M13.md` P28). */
      readonly refusedCommands?: readonly RcaRefusedCommand[];
    }
  | {
      readonly outcome: 'escalated';
      readonly reason: string;
      readonly evidence: RcaEvidenceBundle;
    };
