/**
 * `10` §10.3's own gate YAML shape, generically: a gate definition, its two check kinds, the runner seam a
 * caller supplies, and the results this piece produces.
 *
 * `GateDefinition` models `id`, `checks` and `openQuestionsPolicy` (what `evaluateGate`/`applyWaiver`/
 * `buildGateReport` read) and, since `PLAN-M13.md` P41, the `approval` block and `autonomyOverride` that
 * `approveGate` enforces. `name`, `phase`, `evidence` and `onReject` of the worked-example YAML are still not
 * modelled (nothing reads them); `parseGateDocument` (`document.ts`) accepts them and drops them.
 *
 * @see specs/10 §10.3
 * @see PLAN-M5.md P14
 */

/** `run`'s own declared command is caller-interpreted (a real `execa` wrapper via `CheckRunner`, a scripted
 * stub in tests) — this piece only ever reads `id`/`failOn`, and (see `evaluate.ts`) the *name* of `parser`
 * just enough to confirm it names a supported strategy, never anything else about how `run` itself gets
 * executed. `parser` is optional in `10` §10.3's own worked example (`kb:lint`'s own entry has none) — the
 * spec pack's only two named values, `forge-json` (`10` §10.3) and `json` (`15`, a third-party custom
 * check's own example), describe the identical strategy ("parse `stdout` as JSON, use its own top-level
 * fields as the `failOn` evaluation context") from two different authoring contexts, not two different
 * behaviours — nothing anywhere names a third, differently-behaved parser, so an absent `parser` is treated
 * exactly like an explicit `forge-json`/`json`, and any other value is refused rather than silently
 * JSON-parsed anyway (see `evaluate.ts`'s own reasoning).
 *
 * `failOn` referencing a field the parsed output does not have (a typo in the check's own config, a renamed
 * field, or a refusal envelope where a verdict was expected) FAILS the check (`evaluate.ts`, `PLAN-M13.md`
 * P35): a gate fails closed, so a check that cannot positively show success has failed. This is a gate rule
 * only; `@forge/engine/expr`'s own `resolvePath` still reads a missing path as `undefined` (`10` §10.1, P9),
 * which is right for a workflow `when:` and is left alone. */
export interface DeterministicCheck {
  readonly id: string;
  readonly run: string;
  readonly parser?: string;
  readonly failOn: string;
}

/** `10` §10.3's own worked example (`architect-review`, `agent: critic`) — an LLM-dispatched check, not a
 * command/output pair, and so structurally unable to go through `CheckRunner` at all. This piece never
 * executes an advisory check itself (that means dispatching a real agent session, entirely outside
 * `@forge/engine/gates`'s own dependency graph) — `evaluateGate` only ever carries a gate's own declared
 * advisory checks through into its result untouched, so a caller (or report reader) can see they exist,
 * per rule 2's own "advisory checks never fail a gate; they create OQ-### entries" — the OQ-creation half is
 * exactly the "needs infrastructure this piece doesn't have" gap `06` §6.2's own "phase" concept (`Q73`)
 * already named once for a different piece: nothing in this milestone's own Surface yet turns an advisory
 * check's own agent response into an `OpenQuestion` entry. */
export interface AdvisoryCheck {
  readonly id: string;
  readonly agent: string;
  readonly brief: string;
}

/** `checks.deterministic` having zero entries (`10` §10.3's own catalogue implies every real gate has at
 * least one; `15` §15.10 I4: "a gate cannot be defined with zero deterministic checks") is refused where a
 * gate *document* is read (`parseGateDocument`, `document.ts`: `GATE-506` naming the file and key) and by
 * `@forge/extensions`' `checkGateHasChecks` (`GATE-502`) at compile time, so it never reaches `evaluateGate`
 * from a real project. `evaluateGate` itself still evaluates a hand-built definition with an empty
 * deterministic list to a vacuous pass (the tests of the engine build such gates on purpose); a caller that
 * builds a definition some other way owns that check (`PLAN-M13.md` P41). */
export interface GateDefinition {
  readonly id: string;
  readonly checks: {
    readonly deterministic: readonly DeterministicCheck[];
    readonly advisory: readonly AdvisoryCheck[];
  };
  readonly openQuestionsPolicy: 'block' | 'warn';
  /** `10` §10.3's `approval:` block, when the gate document carries one (`document.ts` reads it). Absent on a
   * hand-built definition, which `approveGate` reads as the spec's default: a human, one approver. */
  readonly approval?: GateApprovalPolicy;
  /** `10` §10.3's `autonomyOverride` (`null` or `'alwaysHuman'`; `03` §3.6 also names the three levels). `null`
   * and absent mean "no override". */
  readonly autonomyOverride?: string | null;
  /** `10` §10.3's `evidence:` block, when the gate document carries one (`document.ts` reads and validates
   * it — `PLAN-M13.md` P41's own loader used to drop it after checking its shape; `PLAN-M14.md` P19 is the
   * first piece that needs the parsed values, not only their shape). Absent or empty: this gate names no
   * evidence, so an agent approver can never be refused `GATE-511` for it (`approve.ts`). */
  readonly evidence?: readonly GateEvidenceRef[] | undefined;
}

/** `10` §10.3's `approval:` block: who may approve (`roles`, `human` or an agent role) and how many distinct
 * approvers it takes (`quorum`). `required` says whether approval is asked at all at `guided`/`supervised`. */
export interface GateApprovalPolicy {
  readonly required: boolean;
  readonly roles: readonly string[];
  readonly quorum: number;
}

/** One `evidence:` entry (`10` §10.3's worked example: `- artifact: ArchitectureSpec`, `- artifact: ADR(*)`):
 * the artifact type this gate treats as evidence of the work it gates, optionally in the `Type(*)`/`Type(id)`
 * form the `inputs`/`outputs` mini-DSL elsewhere in `10` §10.1 also uses. `PLAN-M14.md` P19 is this field's
 * first real reader (`approve.ts`'s own `evidenceArtifactType`, matching an `ArtifactCreated.payload.type`
 * against it, name only — the `(*)`/`(id)` suffix is never treated as a wildcard match, `document.ts`'s own
 * doc comment on why). */
export interface GateEvidenceRef {
  readonly artifact: string;
}

/** The caller-supplied seam for actually running a declared command — a real `execa` wrapper in
 * production, a scripted stub returning canned `{ stdout, exitCode }` pairs in tests, matching `06` §6.3's
 * own `CheckRunner`-shaped seam (`Scheduler`'s constructor taking a plain `resourceClassOf` function, P12)
 * for "this piece has no opinion on the real mechanism, only on how to interpret its result."
 *
 * A `CheckRunner` whose own returned `Promise` never settles hangs `evaluateGate` forever — deliberately:
 * this piece owns no clock and no timer of its own (`21` §21.1's own determinism mandate, applied the same
 * way `@forge/engine/scheduler`/`backpressure` already do — no ambient wall-clock reads anywhere in this
 * package), so it has no principled value to time a real command out *at* on its own. Command-level timeout
 * is exactly `06` §6.3's own `StepNodeLimits.wallClockMs`/`RUN-033` concern, already named at the *step*
 * level by an earlier piece (P10) — a real `CheckRunner` implementation is where that budget belongs
 * enforced, the same "this piece has no opinion on the real mechanism" stance the rest of this doc comment
 * already takes. */
export type CheckRunner = (
  check: DeterministicCheck,
  cwd: string,
) => Promise<{ readonly stdout: string; readonly exitCode: number; readonly stderr?: string }>;

/** One deterministic check's own outcome, always recorded — passing or failing — so `buildGateReport`'s
 * own audit trail (rule 4: "the exact command output") can show every check that ran, not only the ones
 * that failed. `reason` is populated only when `passed` is `false` for a reason *other than* `failOn`
 * itself genuinely evaluating true against cleanly-parsed output — an unparseable `stdout`, an unsupported
 * `parser`, an invalid `failOn` expression, the check runner itself throwing, a refusal in the output
 * (`ok: false` or a top-level `error`), a path `failOn` reads that is missing or of the wrong type, or a
 * non-zero exit beside a `failOn` that did not trigger, all conservatively fail the check (never silently
 * pass it, never crash the whole gate evaluation) and say why in plain text. */
export interface DeterministicCheckResult {
  readonly checkId: string;
  readonly run: string;
  readonly passed: boolean;
  readonly stdout: string;
  readonly exitCode: number;
  /** What the command wrote on stderr, sanitised (terminal escapes and control bytes stripped, secret shapes
   * redacted) and capped at `MAX_CHECK_STDERR_CHARS`, so a crash or a refusal that printed only to stderr
   * leaves its cause in the audit trail (`10` §10.3 rule 4: "the exact command output"). Absent when the
   * runner reported none, and when the command wrote nothing to it. */
  readonly stderr?: string;
  readonly reason?: string;
}

/** `passed` is derived from `checks` alone (every deterministic check passing) — `06` §6.2 rule 2's own
 * "advisory checks never fail a gate" made structural, not merely a promise `evaluateGate`'s own
 * implementation happens to keep: nothing about `advisory`'s own presence or content is even consulted.
 * `waiver`/`waiverAppliedAt` both start `undefined`; only `applyWaiver` (below) ever sets either, and only
 * together.
 *
 * A first version of this doc comment claimed "there is no other way for a caller to construct a
 * `GateEvaluationResult` that claims a waiver exists without having actually satisfied `applyWaiver`'s own
 * checks" — a verify round found this false: `GateEvaluationResult`/`Waiver` are plain, publicly-
 * constructible interfaces (the same as every other data shape in this package), so nothing stops a caller
 * from hand-building one with a waiver that looks complete but was never really checked. `waiverAppliedAt`
 * exists specifically to let `isApproved` (`waiver.ts`) tell the difference *without* needing a fresh clock
 * reading of its own: it records the `now` `applyWaiver` actually validated the waiver's own expiry
 * against, so `isApproved` can re-derive "was `expiresAt` genuinely still in the future at the moment this
 * was applied" from data already sealed onto the result, rather than re-asking a clock that has since moved
 * on. This defends against an *honest* reconstruction bug (a future piece reviving a persisted report
 * without correctly carrying this field through) — like every other plain-data type in this package, it
 * cannot stop a caller willing to also fabricate a consistent `waiverAppliedAt` by hand; nothing here uses
 * cryptographic sealing, matching this whole codebase's own non-adversarial-caller threat model. */
export interface GateEvaluationResult {
  readonly gateId: string;
  readonly passed: boolean;
  readonly checks: readonly DeterministicCheckResult[];
  readonly advisory: readonly AdvisoryCheck[];
  readonly openQuestionsPolicy: 'block' | 'warn';
  readonly waiver: Waiver | undefined;
  readonly waiverAppliedAt: number | undefined;
}

/** `10` §10.3's own rule 1: "waivers require a reason, an owner, and an expiry." All three plain strings —
 * `expiresAt` is parsed via `Date.parse` (an ISO-8601 instant, matching this whole registry's own
 * front-matter convention elsewhere in `@forge/schemas` for date-shaped fields), not a bespoke format.
 * `applyWaiver` (`waiver.ts`) always returns a *frozen, independent copy* of whatever `Waiver` it is
 * handed, not the caller's own object reference — a verify round found the earlier version attached the
 * caller's own, still-mutable object directly, so mutating it after a fully legitimate `applyWaiver` call
 * silently rewrote an already-validated result's own audit-trail content, undetectably if the new values
 * happened to still look well-formed. */
export interface Waiver {
  readonly reason: string;
  readonly owner: string;
  readonly expiresAt: string;
}

/** The payload `buildGateReport` computes — deliberately a *different* type from `@forge/schemas`'
 * already-built `GateReport` artifact type (`gate-report.ts`, `SPEC-QUESTIONS.md` Q23), despite the
 * identical name and no import relationship between the two packages to ever collide at compile time.
 * `@forge/schemas`' own `GateReport` is base front matter narrowed to `type: 'GateReport'` — Q23 found
 * `10` §10's own gate rules never specify a field-level shape for the artifact *document*, only that
 * "every gate evaluation writes a GateReport artifact... with the exact command output," so it originally
 * carried no type-specific fields at all; `PLAN-M14.md` P17 later gave it three optional ones (`gate`,
 * `outcome`, `evaluatedAt`), still no substitute for this type — the schema validates front matter shape,
 * this type is the actual evaluation data rule 4's audit trail needs (every check's full result, the
 * waiver, `openQuestionsPolicy`). Splitting it into that schema-conformant front matter plus a rendered
 * Markdown body (this type's own natural audit-trail content) is `renderGateReportFile`'s job (`report.ts`,
 * beside `buildGateReport`, P17) — `buildGateReport` itself stays exactly as it always was: pure, and
 * silent about *when* or *where* anything gets written. */
export interface GateReport {
  readonly gateId: string;
  readonly passed: boolean;
  readonly approved: boolean;
  readonly checks: readonly DeterministicCheckResult[];
  readonly waiver: Waiver | undefined;
  readonly waiverAppliedAt: number | undefined;
  readonly openQuestionsPolicy: 'block' | 'warn';
}
