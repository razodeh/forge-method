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
    remedy: 'Add at least one entry to `sources` naming the decision, human, or code it comes from.',
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
    message: (d: { entryId: string }) => `No KB entry with id ${show(d.entryId)} exists to propose against.`,
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
    remedy: 'Choose a different destination path, or propose a change to the existing entry instead.',
  },
  // `08` §8.9: the KB is meant to be hand-editable — a gauntlet critic found a first version of
  // `KbWriter.propose` silently picked whichever of several same-id files matched first, with no
  // signal anything was ambiguous, when a copy-paste or a bad merge left two files claiming one id.
  'KB-011': {
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { entryId: string }) =>
      `More than one KB entry claims id ${show(d.entryId)}: refusing to guess which one to propose against.`,
    remedy: 'Fix the duplicate id by hand — rename or supersede one of the two conflicting entries.',
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
    message: (d: { budgetTokens: number }) => `budgetTokens is ${show(d.budgetTokens)}, not a real number.`,
    // Deliberately doesn't say "non-negative" — a negative budget is accepted (it just yields an
    // empty `retrieved`, failing safe); only NaN itself is rejected, so the remedy names exactly that.
    remedy: 'Pass a budget that is a real number, not NaN (Infinity is fine and means "no limit").',
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
