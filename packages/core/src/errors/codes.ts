/**
 * The FORGE error code registry.
 *
 * `specs/02` §2.6 fixes the prefixes and `specs/22` M1 makes the rule blunt: an error without an
 * actionable remedy fails review. Declaring codes as data rather than scattering literal strings is
 * what makes that checkable — a test iterates this table and rejects a remedy that does not open
 * with an imperative verb, which no amount of review discipline achieves on its own.
 *
 * Each row's `message` declares the details it needs *as a parameter type*, and `ErrorDetailsFor`
 * reads that back. So `new ForgeError('VCS-007', { branch })` is a compile error rather than an
 * error message reading "Merge conflict in lane `<missing>`". Retrofitting that once a few hundred
 * call sites exist is a breaking change; doing it here costs one type.
 *
 * @see specs/02 §2.6
 */
import { DOCS_BASE_URL } from '../constants.ts';

// Every interpolation goes through `show`, never a bare `${d.key}`: a revived log line may be
// missing a key, and a template that interpolates directly renders the literal string "undefined",
// which reads like a FORGE bug rather than a malformed record.
import { renderValue as show } from './render.ts';

/** Code prefix groups from `specs/02` §2.6. This set is closed. */
export type ErrorCodePrefix =
  'CFG' | 'ENV' | 'ADP' | 'VCS' | 'SPEC' | 'KB' | 'GATE' | 'RUN' | 'BUD' | 'USR';

/** The ten prefixes as data, so a test can assert the registry uses no others. */
export const ERROR_CODE_PREFIXES = [
  'CFG',
  'ENV',
  'ADP',
  'VCS',
  'SPEC',
  'KB',
  'GATE',
  'RUN',
  'BUD',
  'USR',
] as const satisfies readonly ErrorCodePrefix[];

/**
 * How much of the run a failure ends.
 *
 * `fatal` stops the run, `error` fails the step that raised it, `warning` is recorded and continues.
 */
export type ErrorSeverity = 'fatal' | 'error' | 'warning';

/**
 * Process exit codes from `specs/02` §2.6.
 *
 * These are a public interface: CI configuration and shell scripts branch on them, so a value may
 * never be reassigned to a different meaning.
 */
export const EXIT_CODES = {
  success: 0,
  failure: 1,
  usage: 2,
  gateFailed: 3,
  budgetExceeded: 4,
  prerequisiteMissing: 5,
  lockHeld: 6,
  interrupted: 130,
} as const;

/** A process exit code FORGE may terminate with. */
export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

/** Structured context attached to one occurrence of an error. */
export type ErrorDetails = Readonly<Record<string, unknown>>;

/** Everything known about one error code, independent of any particular occurrence. */
export interface ErrorDefinition<TDetails extends ErrorDetails = ErrorDetails> {
  /** How much of the run this ends. */
  readonly severity: ErrorSeverity;
  /** The process exit code this maps to when it reaches the CLI boundary. */
  readonly exitCode: ExitCode;
  /**
   * Renders the failure, including the observed values.
   *
   * The parameter type is this code's declaration of what it requires — see the file header. A
   * message that names the expectation without the observation forces the reader to reproduce the
   * failure to learn anything, which is the most common defect in CLI error output.
   */
  readonly message: (details: TDetails) => string;
  /**
   * The next action, in the imperative.
   *
   * Not a restatement of the message. `specs/22` M1: an error without one fails review.
   */
  readonly remedy: string;
}

/**
 * The registry.
 *
 * The `satisfies` constraint enforces both halves of §2.6: a key must carry a declared prefix, and a
 * row must be complete. `ErrorDefinition<never>` is the constraint rather than
 * `ErrorDefinition<ErrorDetails>` because function parameters are contravariant — a row declaring
 * `(d: { path: string })` is assignable to a bottom parameter type, not to a wider one.
 *
 * The examples in `specs/02` §2.6 appear verbatim by code and meaning, so the spec's own
 * illustrations resolve against the implementation.
 */
export const ERROR_CODES = {
  'CFG-001': {
    severity: 'fatal',
    exitCode: EXIT_CODES.usage,
    message: (d: { path: string; line?: number }) =>
      `Invalid configuration in ${show(d.path)} at line ${show(d.line)}.`,
    remedy: 'Run `forge config explain <key>` to see which layer supplied the offending value.',
  },
  'CFG-002': {
    severity: 'fatal',
    exitCode: EXIT_CODES.lockHeld,
    message: (d: { pid: number; host: string }) =>
      `Another FORGE supervisor holds this project: pid ${show(d.pid)} on ${show(d.host)}.`,
    remedy:
      'Stop the other process, or run `forge doctor --reclaim-lock` if it is no longer alive.',
  },
  'ENV-004': {
    severity: 'fatal',
    exitCode: EXIT_CODES.prerequisiteMissing,
    message: (d: { tool: string }) => `Required tool not found on PATH: ${show(d.tool)}.`,
    remedy: 'Install the tool and re-run `forge doctor` to confirm it is discoverable.',
  },
  'ENV-005': {
    // `03` §3.1 step 1: the very first resolution step, checked before anything else (config
    // detection, TUI). `@forge/cli/entry`'s `checkNodeVersion` is the pure check this message
    // renders for; the process-level exit(5) is a thin caller around it, not this package's job.
    severity: 'fatal',
    exitCode: EXIT_CODES.prerequisiteMissing,
    message: (d: { required: string; actual: string }) =>
      `FORGE requires Node.js ${show(d.required)} or newer; found ${show(d.actual)}.`,
    remedy: 'Install a supported Node.js version (nvm install --lts, or nvm use 20) and retry.',
  },
  'ADP-012': {
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { reason: string }) =>
      `Adapter session terminated by the provider: ${show(d.reason)}.`,
    remedy: 'Wait for the rate limit to clear, or set `platform.fallback` to route around it.',
  },
  'VCS-007': {
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { lane: string }) => `Merge conflict in lane ${show(d.lane)}.`,
    remedy: 'Resolve the conflict in the lane worktree, or set `execution.conflictPolicy: human`.',
  },
  'SPEC-021': {
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { artifact: string; expectedParent: string }) =>
      `${show(d.artifact)} has no parent ${show(d.expectedParent)}.`,
    remedy: 'Add the missing parent reference to the artifact front matter, or mark it deprecated.',
  },
  // `09` §9.4: "1 test proves exactly 1 AC; an AC may have many tests" — the reverse cardinality
  // (many-to-one) is legal, so this fires only when a single test names more than one.
  'SPEC-022': {
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { test: string; acs: string }) =>
      `Test ${show(d.test)} proves ${show(d.acs)}; a test must prove exactly one acceptance criterion.`,
    remedy:
      'Split the test into one test per acceptance criterion, or name only the one it proves.',
  },
  // `09` §9.4's `AC belongsTo STORY` edge assumes one home per AC id; `storySchema`'s own duplicate
  // check only sees one story's `acceptance[]` at a time, so a second story reusing an id is only
  // visible once the whole corpus is in one graph — see `PLAN-M1.md` P14, `SPEC-QUESTIONS.md` Q31.
  'SPEC-023': {
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { acId: string; stories: string }) =>
      `Acceptance criterion ${show(d.acId)} is claimed by more than one story: ${show(d.stories)}.`,
    remedy:
      'Rename all but one acceptance criterion so each id is unique across the whole project.',
  },
  'SPEC-024': {
    // `@forge/cli`'s own `forge implement <storyId>` (`03` §3.2.5): distinct from `KB-015`, whose own
    // message ("No KB entry, ADR, diagram or runbook") is factually wrong for a missing Story -- a
    // spec-tree artifact (`docs/forge/specs/**`), not a KB-tree one at all -- a critic round caught an
    // earlier version of this piece reusing `KB-015` for exactly this different situation, which would
    // point a user at `forge kb list`, a command that can never contain the id they are looking for.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { id: string }) => `No Story with id ${show(d.id)}.`,
    remedy: 'Run `forge spec list` to see every real spec-tree artifact id, Story included.',
  },
  'SPEC-025': {
    // `@forge/cli`'s own `forge implement <storyId>`: `ArtifactDocument.parse` only validates that
    // front matter is well-formed YAML, not that it satisfies the `Story` schema's own required
    // fields (`09` §9.3) -- a critic round caught the previous code casting `owner_role` straight
    // through unchecked, so a hand-edited or legacy Story file missing it would silently thread the
    // literal string `"undefined"` into the dispatched workflow instead of failing here, at the one
    // point the real problem is still nameable.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { id: string }) => `Story ${show(d.id)} has no real, valid owner_role.`,
    remedy: 'Set a real owner_role (a real agent role id) on this Story, then retry.',
  },
  'KB-005': {
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { entry: string; conflictsWith: string }) =>
      `Contradictory knowledge: ${show(d.entry)} conflicts with ${show(d.conflictsWith)}.`,
    remedy: 'Supersede one entry explicitly, or record the contradiction as an open question.',
  },
  'KB-010': {
    // The one warning-severity code. It exists because `specs/08` §8.8 makes staleness a reported
    // condition that does not stop a run — not to give the severity union a third member.
    severity: 'warning',
    exitCode: EXIT_CODES.success,
    message: (d: { entry: string; reviewBy: string }) =>
      `Knowledge entry ${show(d.entry)} passed its review date of ${show(d.reviewBy)}.`,
    remedy: 'Re-verify the entry against the code and update its `verified` date, or supersede it.',
  },
  // `08` §8.11.1/§8.11.2: "validated: syntax-checked" — the one failure `@forge/diagrams/parse` can
  // raise. `KB-005`/`KB-010`/`KB-031` are already spec-registered for other `08` rules (contradiction,
  // staleness, transclusion mismatch); this is the next free low slot. See PLAN-M3.md P1.
  'KB-001': {
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { kind: string; detail: string }) =>
      `Diagram of kind ${show(d.kind)} failed to parse: ${show(d.detail)}.`,
    remedy:
      'Fix the Mermaid syntax the parser reports, or open the source in a Mermaid live editor.',
  },
  // `08` §8.11.6: a generator's own input shape is a real contract (PLAN-M3.md P3's Surface), and a
  // caller reaching a generator by name through `runGenerator` has only `unknown` at the type level —
  // this is what turns a mismatched shape into an actionable failure instead of a raw `TypeError`
  // from deep inside the generator's own body.
  'KB-002': {
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { generator: string; detail: string }) =>
      `Generator ${show(d.generator)} received an input that does not match its own shape: ${show(d.detail)}.`,
    remedy:
      'Pass the input shape this generator documents, or call it directly with a typed input.',
  },
  // `08` §8.11.6: "diagrams that can be derived MUST be derived" presupposes the diagram actually
  // names the generator that derives it — a `generated: true` diagram with no `generator`, or one
  // naming a generator this package does not register, cannot be checked for drift at all.
  'KB-003': {
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { diagramId: string; generator: string }) =>
      `Diagram ${show(d.diagramId)} is generated but names no working generator: ${show(d.generator)}.`,
    remedy:
      "Set the diagram's generator field to a real, registered generator name, or set generated: false.",
  },
  // `08` §8.6: "Every write records sources. A write with no source is rejected" — one of
  // `KbWriter`'s own four named invariants, given its own code (not folded into the generic
  // schema-invalid case, KB-006) since the spec text calls it out as its own explicit rule.
  'KB-004': {
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { entryId: string }) =>
      `Write to ${show(d.entryId)} has no sources: provenance is mandatory for every KB write.`,
    remedy:
      'Add at least one entry to `sources` naming the decision, human, or code it comes from.',
  },
  // `08` §8.6: "Schema-valid front matter or reject" — the general KbWriter invariant for every field
  // other than sources (KB-004, its own code because the spec names it specifically).
  'KB-006': {
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { entryId: string; issues: string }) =>
      `Write to ${show(d.entryId)} failed schema validation: ${show(d.issues)}.`,
    remedy: 'Fix the field(s) named above so the entry matches the KB entry schema (08 §8.3).',
  },
  // `08` §8.6: a `KbProposal` naming a `targetId` no KB entry actually has — a typo, or a proposal
  // authored before its target was ever written.
  'KB-007': {
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { entryId: string }) =>
      `No KB entry with id ${show(d.entryId)} exists to propose against.`,
    remedy: 'Check the target id is correct, or write the entry first.',
  },
  // `08` §8.3: a legitimate KB entry need not carry all four body sections (only `## Verification`
  // is ever required, and only when `confidence: 'verified'`) — a proposal can genuinely name one
  // that this particular entry never had.
  'KB-008': {
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { entryId: string; field: string }) =>
      `${show(d.entryId)} has no "## ${show(d.field)}" section to propose a change against.`,
    remedy: 'Choose a section the entry actually has, or write it into the entry first.',
  },
  // `08` §8.6's own write path is direct (not `propose`) precisely when the entry is brand new — a
  // gauntlet critic found a first version of `KbWriter.write` silently overwrote an existing file at
  // the same path, permanently destroying whatever entry was already there with no warning.
  'KB-009': {
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { entryId: string }) =>
      `${show(d.entryId)} already exists: write() only creates a brand-new entry.`,
    remedy:
      'Choose a different destination path, or propose a change to the existing entry instead.',
  },
  // `08` §8.9: the KB is meant to be hand-editable — a gauntlet critic found a first version of
  // `KbWriter.propose` silently picked whichever of several same-id files matched first, with no
  // signal anything was ambiguous, when a copy-paste or a bad merge left two files claiming one id.
  'KB-011': {
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { entryId: string }) =>
      `More than one KB entry claims id ${show(d.entryId)}: refusing to guess which one to propose against.`,
    remedy:
      'Fix the duplicate id by hand — rename or supersede one of the two conflicting entries.',
  },
  // `02` §2.1: `openKbIndex`'s own "never throws for an unavailable native module" is scoped to
  // exactly that — a genuine filesystem obstruction (a plain file sitting where `.forge/state/`
  // should be a directory, or no write permission) is a real environment problem no backend, SQLite
  // or JSON, can work around, and deserves a clear remedy rather than a raw ENOENT/EEXIST/EACCES.
  'KB-012': {
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { path: string; issue: string }) =>
      `Cannot prepare the KB index storage location at ${show(d.path)}: ${show(d.issue)}.`,
    remedy: 'Remove or fix whatever is blocking that path, or check the directory’s permissions.',
  },
  // `05` §5.4 point 2: "Declared inputs: full text of artifacts the step declares as inputs" — a
  // step naming an id that does not resolve to a real, indexable KB document is a real caller
  // mistake (unlike a stale search/graph-expansion hit, which this piece skips silently instead),
  // and the pack cannot honestly claim to include "full text" it does not actually have.
  'KB-013': {
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { entryId: string }) =>
      `Declared input ${show(d.entryId)} does not exist in the KB tree.`,
    remedy: 'Fix the id, or write the entry first if it genuinely does not exist yet.',
  },
  // `05` §5.4: a gauntlet critic found `NaN` silently defeats the token budget entirely — every
  // comparison against `NaN` is `false`, so `usedTokens + tokens > budgetTokens` never breaks the
  // retrieval loop and every candidate gets admitted regardless of size. A negative budget already
  // fails safe (an empty `retrieved`); only `NaN` fails unsafe, so only `NaN` is rejected here.
  'KB-014': {
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { budgetTokens: number }) =>
      `budgetTokens is ${show(d.budgetTokens)}, not a real number.`,
    // Deliberately doesn't say "non-negative" — a negative budget is accepted (it just yields an
    // empty `retrieved`, failing safe); only NaN itself is rejected, so the remedy names exactly that.
    remedy: 'Pass a budget that is a real number, not NaN (Infinity is fine and means "no limit").',
  },
  'KB-015': {
    // `@forge/cli`'s own `kb show`/`kb open` (`03` §3.2.2): distinct from `KB-013` (a *declared*
    // input a context pack expected but the KB tree lacks) -- this is a user-typed id at the CLI
    // that never named anything in the tree at all, a plain usage mistake with a different remedy.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { id: string }) => `No KB entry, ADR, diagram or runbook with id ${show(d.id)}.`,
    remedy: 'Run `forge kb list` to see every real id in the current KB tree.',
  },
  // `08` §8.11.4: "a lint error (`KB-031`)" — a spec-given code, transcribed verbatim, not invented.
  'KB-031': {
    severity: 'error',
    exitCode: EXIT_CODES.gateFailed,
    message: (d: { diagramId: string; src: string }) =>
      `Transcluded diagram ${show(d.diagramId)} no longer matches its source ${show(d.src)}.`,
    remedy: 'Run `forge diagram sync` to refresh the transcluded block, or edit the `.mmd` source.',
  },
  'GATE-102': {
    severity: 'error',
    exitCode: EXIT_CODES.gateFailed,
    message: (d: { observed: unknown; threshold: unknown }) =>
      `Coverage ${show(d.observed)} is below the threshold ${show(d.threshold)}.`,
    remedy: 'Add tests for the uncovered lines. Lowering the threshold is a review failure.',
  },
  'RUN-033': {
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { step: string; budget: unknown }) =>
      `Step ${show(d.step)} exceeded its wall-clock budget of ${show(d.budget)}.`,
    remedy: 'Raise the step budget, or split the step so each part fits inside it.',
  },
  'BUD-002': {
    severity: 'fatal',
    exitCode: EXIT_CODES.budgetExceeded,
    message: (d: { cap: string; spent?: string }) =>
      `Run exceeded its cost cap of ${show(d.cap)} (spent ${show(d.spent)}).`,
    remedy: 'Raise `budget.perRunUsd`, or resume with a narrower scope.',
  },
  'USR-001': {
    // Exit 130 per `specs/02` §2.6, which assigns it to "interrupted". A deliberate gate rejection
    // and a SIGINT therefore share a code, and CI cannot tell them apart. Recorded in
    // `SPEC-QUESTIONS.md` Q15 rather than quietly improved on, because the spec is explicit.
    severity: 'fatal',
    exitCode: EXIT_CODES.interrupted,
    message: (d: { gate: string }) => `Gate ${show(d.gate)} was rejected by the operator.`,
    remedy: 'Address the reported findings and re-run the gate, or record a waiver with an expiry.',
  },
  'USR-002': {
    // `03` §3.2's global-flags table: an enum flag (`--model-tier`, `--autonomy`) given a value
    // outside its declared set, or an int/float flag given a non-numeric value. Raised by
    // `@forge/cli/entry`'s `parseGlobalFlags`, at the CLI boundary before any command runs.
    severity: 'fatal',
    exitCode: EXIT_CODES.usage,
    message: (d: { flag: string; value: string }) =>
      `Invalid value ${show(d.value)} for ${show(d.flag)}.`,
    remedy: 'Run `forge --help` to see the accepted values for this flag.',
  },
  'USR-003': {
    // Distinct from USR-002: not a malformed flag value, but a real, named feature this codebase has
    // no implementation for yet (`kb diff`, `forge adopt`'s brownfield ingestion, `forge discover`'s
    // own workflow-execution dependency) -- refusing loudly, not silently no-op'ing, is what keeps a
    // named-but-unbuilt command from *looking* like it worked.
    severity: 'fatal',
    exitCode: EXIT_CODES.usage,
    message: (d: { feature: string }) => `${show(d.feature)} is not yet supported.`,
    remedy: "Check GAUNTLET-LOG.md or SPEC-QUESTIONS.md for this feature's current status.",
  },
  'CFG-003': {
    // `specs/02` §2.5: every write goes through @forge/core/fs, which enforces containment. A path
    // that resolves outside the project root — by traversal, by being absolute, or by a symlink —
    // is a defect in the caller (an artifact ID, a lane path) presenting FORGE with something it
    // must never touch, so this is CFG- (an invalid request), not a runtime I/O failure.
    severity: 'fatal',
    exitCode: EXIT_CODES.usage,
    message: (d: { path: string; root: string }) =>
      `Path escapes the project root: ${show(d.path)} is not inside ${show(d.root)}.`,
    remedy: 'Pass a path relative to the project root, with no leading "/" and no ".." segments.',
  },
  'CFG-004': {
    // Distinct from CFG-003: this path IS inside the project, but names a directory FORGE must
    // never write to directly — `.git/` (VCS owns it), `.forge/state/` (the event log is
    // append-only and owns its own durability), `node_modules/` (package-manager owned). Case
    // folded before comparison: `specs/02` §2.7 makes Windows and macOS's default filesystem both
    // first-class, and both are case-insensitive, so `.Git/config` and `.git/config` are the same
    // file there — a case-sensitive check would let the deny-list be bypassed by capitalisation on
    // exactly the platforms this project is required to support.
    severity: 'fatal',
    exitCode: EXIT_CODES.usage,
    message: (d: { path: string }) =>
      `Path is in a directory FORGE must not write to: ${show(d.path)}.`,
    remedy:
      'Write through the owning subsystem instead: git operations through @forge/vcs, event-log ' +
      "entries through the run's append-only writer, dependencies through the package manager.",
  },
  'RUN-034': {
    // One code for every filesystem operation this module performs (write, read, mkdir, list),
    // parameterised by `operation` rather than split into a code per verb — the failure a caller
    // cares about is "the disk said no", and the underlying OS error survives as `cause` regardless
    // of which call produced it.
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { operation: string; path: string }) =>
      `Filesystem operation "${show(d.operation)}" failed for ${show(d.path)}.`,
    remedy: 'Check the underlying cause (permissions, disk space, a locked file) and retry.',
  },
  // `06` §6.2's own rule 5 (`PLAN-M5.md` P11's own `detectCycles`, operating on a compiled `StepNode[]`).
  // A lower-level utility, unlike `@forge/engine/plan`'s own `compilePlan`/`expandFanout` (which never
  // throw): `detectCycles` throws this for the one input shape no realistic compiled plan gets remotely
  // close to (`06` §6.2's own worked example is 9 nodes), and `compileRunPlan` — the pipeline orchestrator
  // that actually promises never to throw — catches it and folds it into an ordinary `CompileIssue`.
  'RUN-035': {
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { maxDepth: number }) =>
      `Cycle detection exceeded ${show(d.maxDepth)} levels of dependency chaining; refusing to search further.`,
    remedy:
      'Split the workflow into smaller stages, or reduce how many steps chain through dependsOn in a single run plan.',
  },
  // `06` §6.3 (`PLAN-M5.md` P12's own `Scheduler`). A critic round found two distinct `StepNode` objects
  // sharing the same `id` silently defeats the scheduler's own concurrency-safety tracking: its internal
  // `byId` lookup keeps only the last-declared duplicate, so once the *other* one is marked running, every
  // claim/agent it carried is invisibly dropped from every future tick's own conflict/limit check — a real
  // resource-claim or exclusive-agent violation with no error at all. `@forge/engine/plan`'s own
  // `compileRunPlan` already rejects a duplicate compiled id before a well-formed caller ever reaches this
  // point, so this is defense against a caller bypassing that pipeline (or a future bug in it), not a
  // normal business outcome — thrown eagerly at construction, before any tick's own safety tracking could
  // ever be silently compromised by it.
  'RUN-036': {
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { id: string }) =>
      `Scheduler received more than one step with the id ${show(d.id)}; every step id must be unique.`,
    remedy:
      'Fix the plan compiler or caller supplying these nodes so every compiled step id is unique before constructing a Scheduler.',
  },
  // `PLAN-M5.md` P15's own step-execution dispatch. `@forge/vcs`'s own `VcsError` (its doc comment,
  // verbatim) names `@forge/engine` as the one place that wraps it into a real, registered `ForgeError` —
  // `vcs ← schemas` only, no `core` edge, so `VcsError` cannot become a `ForgeError` itself. One generic
  // code rather than one per `VcsError` code (`VCS-CLAIM-REVERT-FAILED`, `VCS-INVALID-COMMIT-FIELD`, ...):
  // the underlying code/message/remedy are already carried in full via `d.vcsCode`/the message text/`cause`
  // (a real `VcsError`, not discarded), so a second, parallel registry entry per `VcsError` code would only
  // duplicate information already present, not add any.
  'RUN-037': {
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { stepId: string; vcsCode: string; vcsMessage: string }) =>
      `Step ${show(d.stepId)} failed a VCS operation (${show(d.vcsCode)}): ${show(d.vcsMessage)}`,
    remedy:
      "Check the underlying VCS error's own remedy (chained as this error's cause) for the specific next action.",
  },
  // The identical reasoning as RUN-037, one layer over: `@forge/telemetry`'s own `TelemetryError` doc
  // comment names the same "the engine wraps it" contract (`telemetry ← core` for `@forge/core/errors`
  // itself, but `TelemetryError` is this package's own, deliberately separate type, not `ForgeError`).
  'RUN-038': {
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { stepId: string; telemetryCode: string; telemetryMessage: string }) =>
      `Step ${show(d.stepId)} failed a telemetry operation (${show(d.telemetryCode)}): ${show(d.telemetryMessage)}`,
    remedy:
      "Check the underlying telemetry error's own remedy (chained as this error's cause) for the specific next action.",
  },
  // `10` §10.1's own eleven-kind step-kind table names `elicit`/`session`/`subworkflow` as real,
  // schedulable step kinds, but each needs infrastructure this milestone does not build (a real
  // interactive human-input channel; `16`'s own facilitated-session machinery; recursive workflow
  // invocation) — the identical "a step dispatcher that fakes a capability with no real mechanism behind
  // it would be worse than one that visibly has none" standard `SPEC-QUESTIONS.md` Q62 already holds this
  // whole milestone to for agent/role resolution, applied here to three more kinds at once.
  'RUN-039': {
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { stepId: string; kind: string }) =>
      `Step ${show(d.stepId)} has kind ${show(d.kind)}, which this milestone's own dispatcher does not yet support.`,
    remedy:
      'Remove elicit/session/subworkflow steps from any workflow scheduled until a later milestone builds real support for them.',
  },
  'RUN-040': {
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { stepId: string; gateId: string }) =>
      `Step ${show(d.stepId)} names gate ${show(d.gateId)}, which is not registered with this run's own gate evaluator.`,
    remedy: 'Add a GateDefinition for this id to the gate evaluator before executing this step.',
  },
  'RUN-041': {
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { stepId: string; conflict: string }) =>
      `Step ${show(d.stepId)}'s mergePolicy.conflict is ${show(d.conflict)}, not one of "agent", "human", or "abort".`,
    remedy:
      'Fix the workflow\'s own merge step to declare policy.conflict as one of "agent", "human", or "abort".',
  },
  'RUN-042': {
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { stepId: string; status: string }) =>
      `Step ${show(d.stepId)}'s own StepOutcome has status ${show(d.status)}, but this function only classifies a failed outcome's own failure.`,
    remedy: 'Pass a StepOutcome whose status is "failed" to this function instead.',
  },
  'RUN-043': {
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { attemptCount: number }) =>
      `decideRetry was called with an empty attemptHistory (${show(d.attemptCount)} attempts recorded), but needs at least one already-failed attempt to decide anything.`,
    remedy: 'Pass an attemptHistory containing at least the just-failed attempt.',
  },
  'RUN-044': {
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { attemptNumber: number }) =>
      `computeBackoff was called with attemptNumber ${show(d.attemptNumber)}, which is not a positive integer.`,
    remedy:
      'Pass an attemptNumber of 1 or greater — 1 for the first retry, 2 for the second, and so on.',
  },
  'RUN-045': {
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { issues: string }) =>
      `runEngine's own workflow source failed to parse or compile: ${show(d.issues)}.`,
    remedy: 'Fix the workflow source (or its compiled plan) before calling runEngine with it.',
  },
  'RUN-046': {
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { stepId: string; mode: string }) =>
      `Step ${show(d.stepId)}'s own interaction mode is ${show(d.mode)}, which requires at least one declared perspective, but none was given.`,
    remedy:
      "Pass DispatchAgentStepOptions.perspectives (e.g. the workflow step's own mode.perspectives) when dispatching a panel or swarm-review step.",
  },
  'RUN-047': {
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { stepId: string; got: string }) =>
      `emitHandoff was called for step ${show(d.stepId)} with a ${show(d.got)} control token, not FORGE_HANDOFF.`,
    remedy: 'Pass a ParsedControlToken whose own token field is "FORGE_HANDOFF" to emitHandoff.',
  },
  'RUN-048': {
    // `@forge/cli`'s own `forge pause`/`forge abort`/`forge status`/`forge lanes`/`forge logs` (`03`
    // §3.2.4): distinct from `CFG-002` (a *live* process holds the lock, refusing a new run) -- this
    // is the opposite state, no run active at all, so there is nothing to pause/abort/report on.
    severity: 'fatal',
    exitCode: EXIT_CODES.usage,
    message: () => 'No FORGE run is currently active in this project.',
    remedy: 'Run `forge run <workflow>` to start one.',
  },
  'RUN-049': {
    // `@forge/cli`'s own `forge pause`/`forge abort`: the real signal was sent (`SIGTERM`/`SIGKILL`)
    // but the process did not actually die within the real, bounded poll window this command waits.
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { pid: number }) =>
      `Sent the signal, but pid ${show(d.pid)} is still alive after the wait window.`,
    remedy: 'Check the process directly (ps -p <pid>); it may be unkillable or hung in kernel I/O.',
  },
  'RUN-050': {
    // `@forge/cli`'s own `forge gate check/waive <id>` (`03` §3.2.4): distinct from `RUN-040` (a
    // *step* inside a running workflow names an unregistered gate) -- this is a bare CLI invocation
    // with no step in scope at all, so RUN-040's own "Step X names gate Y" message does not fit.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { gateId: string }) =>
      `No gate ${show(d.gateId)} is registered in .forge/checks/.`,
    remedy: 'Run `forge gate list` to see every real, registered gate id.',
  },
  'RUN-051': {
    // `@forge/cli`'s own `forge merge --lane <id>`.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { laneId: string }) =>
      `No lane ${show(d.laneId)} in this run's own reconstructed state.`,
    remedy: 'Run `forge lanes` to see every real lane id for this run.',
  },
  'RUN-052': {
    // `@forge/cli`'s own `buildRunEngineContext` (`03` §3.2.4): `RunEngineContext.model` needs one
    // real, concrete model id "resolved from tier" (`@forge/engine/dispatch`'s own doc comment) --
    // with no tier/role system yet built (M5's own known gap, `SPEC-QUESTIONS.md` Q62 part 2), the
    // real, adapter-reported model list is the only source of truth this piece has for "a real model
    // id" at all, and an adapter reporting none leaves nothing to run a session against.
    severity: 'error',
    exitCode: EXIT_CODES.prerequisiteMissing,
    message: () => 'The platform adapter reports no available models.',
    remedy: 'Configure at least one model on the platform this adapter targets, then retry.',
  },
  'RUN-053': {
    // `@forge/cli`'s own `forge run <workflow>`: distinct from `RUN-045` (a real workflow file that
    // failed to *parse or compile*) -- a critic round caught the previous code reusing `RUN-045`'s
    // own "failed to parse or compile" message for this genuinely different situation (no such file
    // at all), rendering a nonsensical "failed to parse or compile: no such workflow..." message.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { workflowId: string; path: string }) =>
      `No such workflow ${show(d.workflowId)} (looked for ${show(d.path)}).`,
    remedy: 'Run `forge plan list` (or check the workflows directory) for every real workflow id.',
  },
  'RUN-054': {
    // `@forge/cli`'s own `forge resume [runId]`: distinct from `RUN-045` for the identical reason
    // `RUN-053` above is -- a named run this project's own `.forge/state/runs/` has no manifest for
    // at all is not a parse/compile failure, it is a run `forge run` never actually started.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { runId: string }) =>
      `No real manifest for run ${show(d.runId)} -- it was never started by a real "forge run" invocation.`,
    remedy: 'Run `forge status` to see the last real run id, or pass an explicit one that was.',
  },
  'RUN-055': {
    // `@forge/cli`'s own `ensureIntegrationWorktree`: `ENV-004` ("Required tool not found on PATH")
    // is correct only for a genuine missing-binary spawn failure -- a real `git worktree add` that
    // ran and failed (a bad base ref, a path/branch collision, disk-full, real resource exhaustion
    // under heavy load) is a categorically different situation a critic round caught being reported
    // with the identical, actively misleading "install the tool" remedy regardless of real cause.
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { detail: string }) => `git worktree operation failed: ${show(d.detail)}.`,
    remedy: 'Fix the underlying repository state named above, then retry.',
  },
  'RUN-056': {
    // `@forge/cli`'s own `loadProjectAgent` (`forge review`/`forge panel`, `03` §3.2.5/§3.2.6):
    // `.forge/agents/<id>.yaml` is `forge init`'s own real write target (`readResolvedAgents`) -- a
    // missing or corrupt file here means the project's own roster was never written, or was hand-edited
    // into an invalid shape, not a code bug in this piece.
    severity: 'error',
    exitCode: EXIT_CODES.prerequisiteMissing,
    message: (d: { agentId: string; path: string }) =>
      `No usable agent ${show(d.agentId)} at ${show(d.path)}.`,
    remedy: 'Run `forge init` (or `forge agent validate`) to restore a real, valid roster file.',
  },
  'RUN-057': {
    // `@forge/cli`'s own `forge debug --from-failure <runId>` (`03` §3.2.5): the named run's own
    // reconstructed state has no failed step at all to build a real `Defect` from.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { runId: string }) => `Run ${show(d.runId)} has no failed step to debug from.`,
    remedy:
      'Run `forge status` to confirm the run actually failed, or pass a real symptom instead.',
  },
  'CFG-005': {
    // `PLAN-M1.md` P12: `ArtifactDocument.parse` refuses a file with no front matter at all, rather
    // than treating it as a document with empty front matter — every registered artifact type
    // requires `id`/`type`/... (`18` §18.6), so a file missing the block entirely can never validate
    // regardless, and failing at parse time names the actual defect instead of a confusing pile of
    // "required field missing" errors for every field at once.
    severity: 'fatal',
    exitCode: EXIT_CODES.usage,
    message: (d: { path: string }) =>
      `No front matter found in ${show(d.path)}: the file must start with a "---" line.`,
    remedy: 'Add a YAML front-matter block, delimited by "---" lines, to the top of the file.',
  },
  'CFG-006': {
    severity: 'fatal',
    exitCode: EXIT_CODES.usage,
    message: (d: { path: string }) =>
      `Unterminated front matter in ${show(d.path)}: no closing "---" line found.`,
    remedy: 'Add the closing "---" line after the front-matter block.',
  },
  'CFG-007': {
    severity: 'fatal',
    exitCode: EXIT_CODES.usage,
    message: (d: { path: string; issue: string }) =>
      `Front matter in ${show(d.path)} is not valid YAML: ${show(d.issue)}`,
    remedy: 'Fix the YAML syntax between the "---" delimiters.',
  },
  'CFG-008': {
    // Phase 1 of `18` §18.6's two-phase validation: front matter against the type's schema. Distinct
    // from CFG-007 (which fires before a type is even known, for text that is not YAML at all) — this
    // is well-formed YAML that does not satisfy its declared type's fields.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { path: string; issues: string }) =>
      `Front matter in ${show(d.path)} does not match its schema: ${show(d.issues)}`,
    remedy: 'Fix the listed fields, or correct the "type" if the wrong schema is being applied.',
  },
  'CFG-009': {
    // Phase 2 of `18` §18.6's two-phase validation: body structure against the type's
    // `requiredSections`. Fires once per missing section, not once per document, so a document
    // missing three sections is reported as three findings rather than one that a fix might only
    // partially address.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { path: string; section: string }) =>
      `${show(d.path)} is missing its required "## ${show(d.section)}" section.`,
    remedy: 'Add the missing "## " heading and its content to the document body.',
  },
  'CFG-010': {
    // `PLAN-M1.md` P13, per `SPEC-QUESTIONS.md` Q30: the id regex every per-type schema enforces
    // (`registry/front-matter.ts`, `artifacts/entry-id.ts`) requires *exactly* `idWidth` digits, not
    // "at least" — so an allocation past the digit ceiling (the 1000th `Story`) must refuse here,
    // loudly, rather than hand back an id the schema would silently reject on the next validation.
    severity: 'fatal',
    exitCode: EXIT_CODES.usage,
    message: (d: { type: string; idWidth: number }) =>
      `Cannot allocate another ${show(d.type)} id: it would need more than ${show(d.idWidth)} digits.`,
    remedy:
      "Widen the type's idWidth in the registry (a schema change, reviewed like any other), or " +
      'retire older entries for this type.',
  },
  // `15` §15.2: "Unknown operators are a compile error, never ignored," and "arrays require an
  // operator, because silent array replacement is the single most confusing behaviour in every
  // config system ever built." No spec page numbers this code; `PLAN-M2.md` P1 picks the next free
  // `CFG-*` slot. `detail` carries the specific shape violation rather than a fixed enum, since a
  // caller who already knows the exact overlay shape violation is better placed to phrase it than a
  // registry entry can be for every shape this could ever be.
  'CFG-011': {
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { path: string; detail: string }) =>
      `Invalid overlay at ${show(d.path)}: ${show(d.detail)}.`,
    remedy:
      'Replace it with one of $set, $append, $prepend, $remove, $replaceWhere, $clear, or ' +
      '$append_guidance where a plain object is expected.',
  },
  // `15` §15.2's own worked example: "compile emits `CFG-04x overlay target not found`." No spec
  // page fixes the exact number; `PLAN-M2.md` P2 picks the next free `CFG-*` slot, matching P1's
  // `CFG-011`. Fires when a `$replaceWhere` entry's `id` does not resolve against what the layers
  // applied so far actually contain — a project overlay referencing a step, perspective, or option
  // id that was renamed or removed upstream, caught at compile time rather than silently no-op'd.
  'CFG-012': {
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { path: string; id: string }) =>
      `Overlay target not found: ${show(d.path)}'s $replaceWhere names id ${show(d.id)}, which does not exist there.`,
    remedy:
      'Update the overlay to name an id that exists, or remove the stale $replaceWhere entry.',
  },
  // `15` §15.9: presets are addressed by id (`forge preset apply <id>`, `forge preset show <id>`).
  // No spec page numbers a code for naming one that doesn't exist; `PLAN-M2.md` P7 picks the next
  // free `CFG-*` slot, matching P1's `CFG-011` and P2's `CFG-012`'s own precedent for exactly this
  // situation (a referenced id that does not resolve).
  'CFG-013': {
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { id: string }) => `No preset registered with id ${show(d.id)}.`,
    remedy: 'Run `forge preset list` to see the available preset ids.',
  },
  // `10` §10.1's own `{{...}}` template substitution (`PLAN-M5.md` P9's own `resolveTemplate`, built on
  // the sandboxed expression evaluator). No spec page numbers a code for a malformed placeholder; the
  // next free `CFG-*` slot, matching P1/P2/P7's own precedent above for exactly this situation (a
  // reference that does not resolve — here, a template expression rather than an overlay/preset id).
  'CFG-014': {
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { template: string; placeholder: string; parseError: string }) =>
      `Template ${show(d.template)} has an invalid expression in placeholder "{{${show(d.placeholder)}}}": ${show(d.parseError)}.`,
    remedy: 'Fix the expression syntax inside the template placeholder.',
  },
  // Same template-substitution feature as `CFG-014`, the other real failure mode: the placeholder's own
  // expression parses fine but does not produce a directly-substitutable value — either nothing at all
  // (`10` §10.1's own "typed 'undefined path' outcome" for a missing path) or a non-primitive (an object
  // or array a path expression resolved to) — surfaced here rather than silently substituting the
  // literal text "undefined"/"null"/"[object Object]" into what becomes a real branch name, file path,
  // or shell argument downstream.
  'CFG-015': {
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { template: string; placeholder: string }) =>
      `Template ${show(d.template)}'s placeholder "{{${show(d.placeholder)}}}" did not resolve to a string, number, or boolean.`,
    remedy:
      'Check the placeholder path against the context actually supplied at this point in the run, and correct it or the context.',
  },
  // `10` §10.1's sandboxed expression language (`PLAN-M5.md` P9's own `evaluate`). No spec page numbers
  // a code for this; next free `CFG-*` slot after `CFG-015`. Confirmed empirically that an AST built
  // from a perfectly ordinary, non-nested-looking flat `&&`/`||` chain (which parses cleanly — parsing
  // it is iterative, not recursive) still recurses deeply enough at *evaluation* time to blow the real
  // call stack with a raw `RangeError`, contradicting this language's own sandboxed-and-safe premise;
  // this is `evaluate`'s own equivalent of the depth guard `parseExpression` already applies at parse
  // time, for the one failure mode a parse-time guard alone cannot catch.
  'CFG-016': {
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { maxDepth: number }) =>
      `Expression evaluation nests more than ${show(d.maxDepth)} levels deep; refusing to evaluate further.`,
    remedy:
      'Split the expression into smaller pieces, or reduce how many terms are combined with && or || in one condition.',
  },
  // `@forge/cli`'s own `forge upgrade` (`03` §3.4, `PLAN-M6.md` C7). Next free `CFG-*` slot after
  // `CFG-016` — project-state/config-validity is the closest existing prefix's own real scope
  // (`CFG-001`-`CFG-016` already cover config/manifest/front-matter validity broadly), so these three
  // fold into it rather than opening an eleventh, single-command-scoped prefix in the closed
  // `ErrorCodePrefix` union.
  'CFG-017': {
    // No real `.forge/manifest.yaml` at all: `forge upgrade` has nothing to compute a migration path
    // from — the identical "never initialized" situation `checkManifest`/`checkConfigValidity`
    // (`forge doctor`, C6) already name for their own checks, but for a command that needs to *read*
    // the manifest, not merely report on it.
    severity: 'fatal',
    exitCode: EXIT_CODES.prerequisiteMissing,
    message: () => 'No real .forge/manifest.yaml found -- this project has never been initialized.',
    remedy: 'Run `forge init` first.',
  },
  'CFG-018': {
    // `03` §3.4 step 2's own "a downgrade attempt is refused with a real, typed error." `--to
    // <version>` naming a version older than the manifest's own installed version is refused outright
    // rather than attempted -- this piece never reverses a migration chain it did not itself plan for
    // going forward, and the real per-artifact `down` migrations `@forge/schemas/migrations` supports
    // are a distinct, per-document mechanism `forge upgrade` does not expose as a bare version
    // downgrade.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { installed: string; requested: string }) =>
      `Refusing to downgrade from ${show(d.installed)} to ${show(d.requested)}.`,
    remedy:
      'Pass a --to version at or after the installed version, or omit --to to upgrade to latest.',
  },
  'CFG-019': {
    // `@forge/schemas/migrations`' own `planMigrations`/`validateMigrationRegistry` returning a real
    // failure (a registry with a reversible-without-down step, a duplicate step, or a genuine chain
    // gap between two schema versions) for at least one artifact document `forge upgrade` needs to
    // migrate. Distinct from CFG-018: this is a real defect in the migration chain itself, not a
    // refused version direction.
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { path: string; detail: string }) =>
      `Cannot migrate ${show(d.path)}: ${show(d.detail)}`,
    remedy: 'Fix the migration registry (a gap or an invalid reversible/down pairing), then retry.',
  },
  // `@forge/cli`'s own `forge config get/set/list/explain` (`03` §3.2.7, `PLAN-M6.md` C8). Next free
  // `CFG-*` slot after `CFG-019`. Distinct from `CFG-017` (`forge upgrade`'s own missing-manifest
  // check): a project can genuinely have `.forge/manifest.yaml` but no `.forge/config.yaml` (a
  // partially-written init that failed before its own final step -- `writeInitTree`'s own doc comment
  // records `config.yaml` as deliberately written last), so reusing `CFG-017`'s own manifest-specific
  // message here would name the wrong missing file.
  'CFG-020': {
    severity: 'fatal',
    exitCode: EXIT_CODES.prerequisiteMissing,
    message: () => 'No real .forge/config.yaml found -- this project has never been initialized.',
    remedy: 'Run `forge init` first.',
  },
  // `15` §15.10's twelve compile-time invariants (`PLAN-M2.md` P8). I1–I6, I10–I12 use the exact
  // codes the table itself gives; I7–I9's own `SEC-*` codes do not exist in this closed prefix union
  // (`SPEC-QUESTIONS.md` Q40) and are folded under `CFG-507`–`CFG-509` — one slot higher than the
  // first free slots after this table's own `CFG-501`–`CFG-505`, since `CFG-506` is already reserved
  // for a different guardrail (`SPEC-QUESTIONS.md` Q35).
  'CFG-501': {
    // I1: `05` §5's own line: "An overlay that would let an agent review, test or diagnose its own
    // output fails compile."
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { role: string }) =>
      `Role ${show(d.role)} is configured to review, test, or diagnose its own output.`,
    remedy:
      'Choose a different agent for the reviewing, testing, or diagnosing role, or remove the ' +
      'alias or assignment that collapses them into the same instance.',
  },
  'CFG-502': {
    // I2: `10` §10.6: "the agent that writes tests is never the agent that makes them pass... Test
    // files are outside the implementer's file claim."
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { detail: string }) =>
      `Test-authoring and implementation separation violated: ${show(d.detail)}.`,
    remedy:
      'Choose a different agent instance to author tests than the one implementing them, and ' +
      "keep test file paths outside any implementer's file_ownership.",
  },
  'GATE-501': {
    // I3: the configuration-shape half only — "cannot be approved with a failing check" is a
    // run-time gate-approval fact (M5's to enforce); this checks that a gate's own config does not
    // let itself be marked approved while a check it requires is disabled.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { gateId: string; checkId: string }) =>
      `Gate ${show(d.gateId)} would allow approval while its required check ${show(d.checkId)} is disabled.`,
    remedy:
      "Restore the required check, or remove it from the gate's required-check list if it is " +
      'genuinely no longer required.',
  },
  'GATE-502': {
    // I4: "a gate cannot be defined with zero deterministic checks."
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { gateId: string }) =>
      `Gate ${show(d.gateId)} is defined with zero deterministic checks.`,
    remedy: 'Add at least one deterministic check to the gate before it can be compiled.',
  },
  'GATE-503': {
    // I5: "alwaysHuman gates (production delivery, one-way-door ADRs) cannot be downgraded by
    // overlay."
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { gateId: string; autonomy: string }) =>
      `Gate ${show(d.gateId)} is alwaysHuman and cannot be downgraded to ${show(d.autonomy)} by an overlay.`,
    remedy:
      "Remove the overlay's autonomy downgrade for this gate; alwaysHuman gates cannot be " +
      'relaxed by customization.',
  },
  // The run-time half of I3 (`PLAN-M5.md` P14): `GATE-501`'s own comment already names this as "M5's to
  // enforce" -- a gate with a failing deterministic check cannot be approved without a *complete* waiver.
  // A missing/blank `reason`, `owner`, or `expiresAt`, or an `expiresAt` that does not parse as a real
  // instant at all, are the identical "not actually provided" outcome, whichever field is at fault.
  'GATE-504': {
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { gateId: string }) =>
      `Gate ${show(d.gateId)}'s waiver is missing a reason, an owner, or a valid expiry -- all three are required.`,
    remedy: 'Provide a non-blank reason, owner, and a valid expiresAt instant for this waiver.',
  },
  // The run-time half of I3, continued: a *complete*, well-formed waiver that has already lapsed is
  // treated identically to having no waiver at all -- distinct from `GATE-504` (which is about the
  // waiver's own shape, not its content) because the remedy is different: renew with a fresh expiry,
  // not fill in a missing field.
  'GATE-505': {
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { gateId: string; expiresAt: string }) =>
      `Gate ${show(d.gateId)}'s waiver expired at ${show(d.expiresAt)} and can no longer be applied.`,
    remedy:
      'Provide a new waiver with a later expiresAt, or resolve the underlying failing check instead.',
  },
  'SPEC-501': {
    // I6: "traceability edges required by the spec graph cannot be disabled."
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { edgeKind: string }) =>
      `Overlay disables the required spec-graph traceability edge ${show(d.edgeKind)}.`,
    remedy:
      'Remove the overlay directive disabling this edge; required traceability edges cannot be ' +
      'turned off.',
  },
  'CFG-503': {
    // I10: "overlays cannot disable the event log, the cost ledger, or the audit trail."
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { subsystem: string }) =>
      `An overlay disables ${show(d.subsystem)}, which cannot be turned off.`,
    remedy:
      'Remove the overlay directive disabling this subsystem; the event log, cost ledger, and ' +
      'audit trail are not customizable off.',
  },
  'CFG-504': {
    // I11: "a custom agent cannot be created without a mandate, outputs, and file ownership" — the
    // invariant-level re-assertion of `PLAN-M2.md` P3's own `checkCustomAgents`. `detail` is that
    // check's own already-complete, already-reviewed violation message
    // (`Custom agent "x" is missing y, z — there is no unconstrained agent.`) passed straight
    // through, not re-derived into separate fields this code would have to keep in sync by hand.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { detail: string }) => show(d.detail),
    remedy: "Add the missing field(s) to the custom agent's roster.add entry.",
  },
  'CFG-505': {
    // I12: "required roles cannot be disabled at their applicable level" — the invariant-level
    // re-assertion of `PLAN-M2.md` P3's own `checkRequiredRoles`. `detail` is that check's own
    // already-complete violation message, passed straight through for the same reason as `CFG-504`.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { detail: string }) => show(d.detail),
    remedy:
      'Remove the disable directive for this role, or use autonomy settings instead if the goal ' +
      'is to reduce its involvement.',
  },
  // `CFG-506` is deliberately left free here: `SPEC-QUESTIONS.md` Q35 already reserved it for a
  // *different* future guardrail (an overlay deleting a gate step, `PLAN-M2.md` P6/P9's own
  // territory) before this piece ever needed a slot of its own. I7–I9 register one slot higher
  // (`CFG-507`–`CFG-509`) so the two reservations do not collide (`SPEC-QUESTIONS.md` Q40).
  'CFG-507': {
    // I7 (`SEC-501` in `15` §15.10; see `SPEC-QUESTIONS.md` Q40): "tool grants cannot exceed module
    // ceilings without a recorded, expiring escalation" — the whole-resolved-set re-assertion of
    // `PLAN-M2.md` P3's own `checkToolCeiling`. `field`/`detail` are kept separate (not pre-joined
    // into one string) so this template can compose a grammatical sentence around them itself.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { role: string; field: string; detail: string }) =>
      `Role ${show(d.role)}'s "${show(d.field)}" grant exceeds its module ceiling: ${show(d.detail)}.`,
    remedy: 'Create an escalation for this grant, or reduce it to within the module ceiling.',
  },
  'CFG-508': {
    // I8 (`SEC-502` in `15` §15.10; see `SPEC-QUESTIONS.md` Q40): "secrets cannot be placed in
    // prompts, artifacts, skills, or the KB."
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { location: string }) =>
      `A secret-shaped literal was found in resolved content at ${show(d.location)}, not a "\${secret:...}" reference.`,
    remedy:
      'Replace the literal with a "${secret:<name>}" reference and store the real value in the ' +
      'configured secret source.',
  },
  'CFG-509': {
    // I9 (`SEC-503` in `15` §15.10; see `SPEC-QUESTIONS.md` Q40): "skills and MCP results cannot
    // alter the FORGE operating contract, tool grants, or autonomy" — the whole-resolved-set
    // re-assertion of `PLAN-M2.md` P4's own `INJECTION_PATTERNS`.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { location: string }) =>
      `Resolved content at ${show(d.location)} contains instruction-shaped text targeting the operating contract.`,
    remedy:
      "Remove or rewrite the flagged text; skill and MCP content cannot alter FORGE's own " +
      'operating contract.',
  },
} as const satisfies Record<`${ErrorCodePrefix}-${string}`, ErrorDefinition<never>>;

/** Every error code FORGE can raise. */
export type ForgeErrorCode = keyof typeof ERROR_CODES;

/**
 * The details a given code requires, read back from its message template.
 *
 * This is what makes a missing or misnamed key a compile error rather than a `<missing>` in the
 * message a user reads.
 */
export type ErrorDetailsFor<TCode extends ForgeErrorCode> = Parameters<
  (typeof ERROR_CODES)[TCode]['message']
>[0];

/** A code's definition, with its identity and documentation link attached. */
export interface ResolvedErrorDefinition {
  readonly code: ForgeErrorCode;
  readonly severity: ErrorSeverity;
  readonly exitCode: ExitCode;
  readonly message: (details: never) => string;
  readonly remedy: string;
  readonly docsUrl: string;
}

/**
 * The documentation link for a code.
 *
 * Derived rather than stored per row; see `SPEC-QUESTIONS.md` Q4.
 */
export function docsUrlFor(code: ForgeErrorCode): string {
  return `${DOCS_BASE_URL}/errors/${code}`;
}

/** Whether `value` is a declared error code. */
export function isForgeErrorCode(value: unknown): value is ForgeErrorCode {
  return typeof value === 'string' && Object.hasOwn(ERROR_CODES, value);
}

/**
 * Looks up a code's definition.
 *
 * The single lookup path, deliberately. Reading `ERROR_CODES[code]` directly elsewhere skips this
 * guard, which is how `exitCodeFor` once returned `undefined` — typed as `ExitCode` — for a value
 * that had already passed `isForgeError`.
 *
 * @throws {RangeError} if the code is not declared. That is a programming error in FORGE itself, not
 * a user-facing failure, so it is deliberately not a `ForgeError`: raising one would need a code for
 * "your error code does not exist", which is a loop.
 */
export function errorDefinition(code: ForgeErrorCode): ResolvedErrorDefinition {
  if (!isForgeErrorCode(code)) {
    throw new RangeError(
      `Unknown error code: ${String(code)}. Add it to ERROR_CODES in @forge/core/errors.`,
    );
  }
  return { ...ERROR_CODES[code], code, docsUrl: docsUrlFor(code) };
}
