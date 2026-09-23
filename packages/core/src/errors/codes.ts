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
  'ENV-006': {
    // `forge test run --rule smoke|contract` (`PLAN-M13.md` P25): a deterministic gate check with no command to run
    // must fail, not pass, and must say which key is missing. The gate reads the JSON envelope; this is its reason.
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { field: string; reason: string }) =>
      `No usable test command at ${show(d.field)}: ${show(d.reason)}.`,
    remedy:
      'Set the command in `.forge/config.yaml` (or with `forge config set <key> "<command>"`) to the single shell command that runs that layer and exits non-zero on failure, then run the check again. A gate check with no command to run fails, or takes a recorded Waiver.',
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
  // `@forge/extensions/install`'s own git-channel overlay/module fetch (`19` §19.5, `PLAN-M11.md`
  // P1). `@forge/vcs`'s own `fetchGitOverlay` throws a `VcsError` (that package has no `core` edge,
  // per `git.ts`'s own doc comment), so `fetchGitOverlayBundle` -- the one orchestration function
  // every git-channel caller goes through -- wraps it here, the identical `vcsCode`/`vcsMessage`
  // wrapping shape `RUN-037` already establishes for `@forge/engine`'s own lane-lifecycle wrapping,
  // reused rather than re-invented: both exist so a caller inspecting the *wrapped* error's own
  // details sees the real underlying `VcsError`'s code/message directly, with the full `ForgeError`
  // (and its own registered remedy) still reachable via `cause` for a reader who wants it.
  'VCS-008': {
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { spec: string; vcsCode: string; vcsMessage: string }) =>
      `Fetching ${show(d.spec)} failed (${show(d.vcsCode)}): ${show(d.vcsMessage)}`,
    remedy:
      'Check the git spec is a real, reachable git+<url>#<tag-or-sha> and that the ref exists, ' +
      'then retry.',
  },
  // `fetchLocalOverlay`'s own local-channel sibling of `VCS-008` above: `computeContentChecksum`
  // (`@forge/vcs`) throws only `VcsError` (that package has no `core` edge), so the local channel
  // wraps it here too, the identical `vcsCode`/`vcsMessage` shape, for a `stat`/`readFile` failure
  // (a permission error, a rejected symlink, a TOCTOU race) while checksumming an otherwise-valid
  // local directory -- distinct from `CFG-026`/`CFG-027` above, which are about the source path or
  // its manifest, not about reading its content for the checksum.
  'VCS-009': {
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { path: string; vcsCode: string; vcsMessage: string }) =>
      `Computing the checksum of ${show(d.path)} failed (${show(d.vcsCode)}): ${show(d.vcsMessage)}`,
    remedy: 'Fix the underlying file access problem named above, then retry.',
  },
  'VCS-010': {
    // `forge run`'s `20` §20.2 point 5 refusal ("the user's uncommitted work is sacred"): raised by the CLI
    // from `@forge/vcs`'s `VcsError('VCS-DIRTY-TREE')`, which cannot itself be a `ForgeError` (`vcs` has no
    // `core` edge), so it used to reach the terminal as an uncaught exception with a Node stack trace
    // (`PLAN-M13.md` P12, `Q208` finding 6). Exit 5: the missing prerequisite is a clean working tree.
    severity: 'error',
    exitCode: EXIT_CODES.prerequisiteMissing,
    message: (d: { count: number; files: string }) =>
      `The working tree has ${show(d.count)} uncommitted change(s): ${show(d.files)}.`,
    remedy:
      'Run `git stash`, or commit your changes, then run the command again. FORGE never discards uncommitted work.',
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
  // `PLAN-M10.md` P16: CARTOGRAPHY/INFERENCE's own "every output starts at confidence: low|medium"
  // rule, enforced structurally at the one real choke point every KB write passes through — a caller
  // (`@forge/engine/adopt`'s own INFERENCE write path) passes a `confidenceCeiling` and `KbWriter.write`
  // refuses a value that ranks above it, rather than trusting every future call site to simply never
  // pass a higher one.
  'KB-016': {
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { entryId: string; confidence: string; ceiling: string }) =>
      `${show(d.entryId)} has confidence ${show(d.confidence)}, which exceeds this write path's own ceiling of ${show(d.ceiling)}.`,
    remedy:
      "Reduce the entry's confidence to the allowed ceiling, or use a write path with no ceiling if the higher value is genuinely earned.",
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
  'BUD-003': {
    // Admission control (`06` §6.3, `20` §20.8) refused the last ready step: its reservation does not fit in
    // what remains of the run cap (or the daily cap). The run ended with nothing started for this reason,
    // which used to be recorded nowhere (`PLAN-M13.md` P12, `Q208` finding 1). Exit 4, like `BUD-002`.
    severity: 'fatal',
    exitCode: EXIT_CODES.budgetExceeded,
    message: (d: { stepId: string; cap: string; reservation: string; spent: string }) =>
      `Step ${show(d.stepId)} was not started: ${show(d.spent)} already spent plus its ${show(d.reservation)} reservation would reach the ${show(d.cap)}.`,
    remedy:
      'Raise `budget.perRunUsd` (or `budget.dailyUsd` for a daily cap) in .forge/config.yaml, or lower the step reservation: the step limits.maxCostUsd or the agent limits.max_cost_usd (budget.perStepUsdDefault applies only to a step whose agent declares none). Then run `forge resume`.',
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
      `Step ${show(d.stepId)} has kind ${show(d.kind)}, which the engine does not run.`,
    remedy:
      'Remove the subworkflow step from the workflow you are running, or replace it with the steps of the workflow it names: nested workflows are not built yet. (elicit and session steps are supported; any other kind reporting this is missing a field its own kind requires.)',
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
  'RUN-058': {
    // `@forge/cli`'s own `readNormalizedReport` (`09` §9.5, `PLAN-M8.md` P3): `docs/forge/reports/
    // test-results.json` is written only by this package's own `writeNormalizedReport` -- a fresh
    // critic round found the read side had no shape check at all (an uncommented `as` cast straight
    // into the caller's hands), so a hand-edited, truncated, or future-schema-version file would
    // either throw an untyped `SyntaxError` or silently hand back a value that only claims to be a
    // `NormalizedTestReport`.
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { path: string; detail: string }) =>
      `${show(d.path)} is not a real test-results report: ${show(d.detail)}.`,
    remedy: 'Re-run `forge test run` to regenerate it, rather than hand-editing this file.',
  },
  'RUN-059': {
    // `@forge/cli`'s own `readFlakyState` (F-TEST-6, `PLAN-M8.md` P7): `docs/forge/reports/
    // flaky.json` is written only by this package's own `writeFlakyState`, matching RUN-058's own
    // identical `test-results.json` precedent — but a fresh critic round found reusing RUN-058
    // outright for this file too was actively misleading: RUN-058's own message names "a
    // test-results report" specifically, and its own remedy ("re-run `forge test run` to regenerate
    // it") is actively wrong here since `run.ts`'s own default rule deliberately never persists over
    // a present-but-unusable `flaky.json` (doing so would silently destroy every real quarantine
    // latch) — re-running `forge test run` reports the identical failure again, forever, rather than
    // "regenerating" anything. A real, disclosed remedy instead: fix the file's own shape by hand, or
    // delete it to start over from a real, empty rolling-window state (a real, disclosed escape
    // hatch — `flaky.json` has no other one, `SPEC-QUESTIONS.md` Q128).
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { path: string; detail: string }) =>
      `${show(d.path)} is not a real flake-tracking state file: ${show(d.detail)}.`,
    remedy:
      'Fix this file’s own JSON shape by hand, or delete it to reset flake tracking to empty — ' +
      're-running `forge test run` will not regenerate it while it stays unusable.',
  },
  'RUN-060': {
    // `@forge/engine/rca`'s own `runRcaLoop` (F-DEBUG-1, `PLAN-M8.md` P8): three real, structural
    // requirements F-DEBUG-1's own normative text states as hard gates, not shoulds — refused with
    // this one shared code (disambiguated by `detail`), never a thrown, untyped crash: (1) INTAKE
    // cannot state a real "expected X, observed Y" pair (step 1's own explicit "refuse to proceed on
    // a symptom that cannot be stated" this way); (2) HYPOTHESISE proposed fewer than the real,
    // enforced minimum of three distinct hypotheses (step 4's own explicit "at least three... a
    // single hypothesis becomes a conclusion"); (3) PREVENT reached RECORD for a Sev1/Sev2 defect with
    // zero real prevention actions (step 9's own explicit "closing one without a prevention action is
    // refused").
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { phase: string; detail: string }) =>
      `RCA loop refused at ${show(d.phase)}: ${show(d.detail)}.`,
    remedy:
      'Fix the underlying input/session response rather than retrying unchanged — this is a real, ' +
      'structural requirement of the RCA loop itself (specs/13 F-DEBUG-1).',
  },
  // `@forge/sessions`'s own `SessionPhaseMachine` (`16` §16.3, `PLAN-M10.md` P9): a pure facilitation
  // state machine with no adapter of its own to dispatch through, so a refusal it needs to surface is
  // a `ForgeError` value embedded in a `PhaseDirective`, never a thrown exception -- the caller
  // (`PLAN-M10.md` P10, later) decides whether that reaches a human or aborts the run.
  'RUN-061': {
    // `16` §16.3 step 1's own literal rule: "A session whose question cannot be stated in one
    // sentence is refused; that is itself the finding."
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { question: string }) =>
      `FRAME refuses ${show(d.question)}: a session's question must be statable in one sentence.`,
    remedy: 'Edit the question down to one sentence, then frame the session again.',
  },
  'RUN-062': {
    // `16` §16.7 point 2: "critic participates in CONVERGE with a mandate to produce falsifiable
    // objections... rejected by the facilitator" when absent. Distinct from `RUN-060`'s RCA-specific
    // three-way gate -- this is CONVERGE's own single structural precondition for leaving the phase.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { sessionType: string }) =>
      `A ${show(d.sessionType)} session cannot leave CONVERGE: a critic participant is present but recorded no objection.`,
    remedy: 'Add at least one critic-sourced objection before advancing this session to DECIDE.',
  },
  'RUN-063': {
    // A programmer-error guard, not a domain refusal (unlike RUN-061/RUN-062 above): the caller
    // invoked a phase transition out of the fixed FRAME → DIVERGE → CONVERGE → DECIDE → RECORD order
    // `16` §16.3 states as the one anatomy every session runs.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { expected: string; actual: string }) =>
      `Expected the session to be at phase ${show(d.expected)}, but it is at ${show(d.actual)}.`,
    remedy: 'Fix the caller to drive FRAME, DIVERGE, CONVERGE, DECIDE, RECORD strictly in order.',
  },
  'RUN-064': {
    // `16` §16.5's own literal write-back rule: "will not mark a session complete until every
    // decision has an artifact reference and every action has an owner... sessions with zero
    // decisions and zero actions are recorded as inconclusive with a stated reason."
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { sessionType: string }) =>
      `A ${show(d.sessionType)} session cannot be recorded: it has a decision with no artifact reference or an action with no owner, and is not explicitly marked inconclusive with a reason.`,
    remedy:
      'Add the missing artifact reference or owner, or mark the session inconclusive with a ' +
      'non-empty reason before assembling its record.',
  },
  'RUN-065': {
    // `@forge/sessions`'s own technique loader (`16` §16.4, `PLAN-M10.md` P9): a caller asked for a
    // technique id no `modules/*/techniques/*.technique.yaml` file declares -- a real, ordinary
    // caller-input error, distinct from a shipped technique file itself failing to parse (an
    // authoring bug in this repo's own content, thrown as a plain `Error` the same way
    // `loadAgentRegistry` already does for the identical distinction).
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { techniqueId: string }) =>
      `No technique ${show(d.techniqueId)} is registered under any module's techniques/ directory.`,
    remedy:
      'Check the technique id against modules/*/techniques/*.technique.yaml, or add a new one.',
  },
  'RUN-066': {
    // `@forge/sessions`'s own `assembleSessionRecord` (`16` §16.5, `PLAN-M10.md` P9): the assembled
    // candidate failed the real, already-shipped `sessionRecordSchema` (`@forge/schemas`) -- a
    // gauntlet critic round found the first version let a bare, unwrapped `ZodError` escape here
    // instead, the same "schema-valid or reject, with a named code" pattern `CFG-008` already uses
    // for `validateArtifact` (`packages/core/src/artifacts/validate.ts`), applied to this one
    // caller-supplied assembly instead of a file read from disk.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { sessionType: string; issues: string }) =>
      `The assembled ${show(d.sessionType)} session record fails its own schema: ${show(d.issues)}.`,
    remedy: 'Fix the caller-supplied session metadata (id, dates, revision, ...) named above.',
  },
  'RUN-067': {
    // `@forge/sessions`'s own `SessionPhaseMachine.start` (`16` §16.8's own literal bound: "Max
    // participants: 5 agents + human").
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { agentCount: number }) =>
      `A session cannot start with ${show(d.agentCount)} agent participants -- \`16\` §16.8's own bound is 5 agents plus the human.`,
    remedy:
      'Reduce the session to 5 or fewer agent participants (the human does not count against it).',
  },
  // `@forge/engine/interaction`'s own `runSessionStep` (`16` §16.6, `PLAN-M10.md` P10): two real,
  // ordinary-authoring-input failure modes this piece found genuinely distinct from `RUN-039`'s own
  // "this kind is not dispatched at all" meaning -- `kind: 'session'` *is* dispatched now, so reusing
  // `RUN-039`'s own registered remedy ("remove elicit/session/subworkflow steps... until a later
  // milestone") would tell an author to delete a step over an ordinary typo, actively wrong rather
  // than merely generic.
  'RUN-068': {
    // A `sessionType` naming something outside `16` §16.2's own closed ten-value table -- the
    // ordinary shape of a hand-typo'd workflow YAML, not a programmer error in this codebase.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { stepId: string; sessionType: string }) =>
      `Step ${show(d.stepId)} names sessionType ${show(d.sessionType)}, which is not one of \`16\` §16.2's own ten real session types.`,
    remedy:
      'Fix the sessionType against the real ten-value table in specs/16 §16.2 (brainstorm, ' +
      'design-review, tradeoff, premortem, retro, war-room, estimation, standup, ' +
      'discovery-interview, story-refinement).',
  },
  'RUN-069': {
    // `allocateSessionId`'s own real, three-digit `SESSION-###` ceiling (`sessionRecordSchema`'s own
    // id pattern) -- every one of the 1000 real ids already taken. Adversarial/very-low-probability in
    // practice (a later, real session-id allocator is the actual fix, not a wider guess here), but
    // distinct in kind from `RUN-068` above, so given its own code rather than folded into it.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { stepId: string }) =>
      `No free SESSION-### id remains for step ${show(d.stepId)} -- all 1000 real three-digit ids are already taken.`,
    remedy:
      'Free an id by archiving or renumbering existing docs/forge/sessions/ records, or wait for a ' +
      'later FORGE release with a real, non-hash-based session-id allocator.',
  },
  // `@forge/cli/commands/loop/session.ts`'s own `sessionShow`/`sessionResume`/`sessionExport`
  // (`PLAN-M10.md` P13): both real, ordinary-input failure modes reading back a session record this
  // milestone's own `runSessionStep` already wrote under `docs/forge/sessions/`.
  'RUN-070': {
    // No real `SESSION-<id>*.md` file under `docs/forge/sessions/` -- a typo'd id, or one from a
    // different project root than the one `--project`/`cwd` currently points at.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { id: string }) =>
      `No session record found for ${show(d.id)} under docs/forge/sessions/.`,
    remedy: 'Run `forge session list` to see the real, currently persisted session ids.',
  },
  'RUN-071': {
    // `forge session resume <id>` against a record whose own `status` is not `truncated` -- `16`
    // §16.6's own "resume" verb has no real meaning for a session that already reached a genuine
    // `complete`/`inconclusive` end; `runSessionStep`'s own `resumeFrom` parameter exists specifically
    // to continue a *truncated* session's own real, unfinished work (see that function's own doc
    // comment, `@forge/engine/interaction/session.ts`), not to re-open a session that already finished.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { id: string; status: string }) =>
      `Session ${show(d.id)} has status ${show(d.status)}, not \`truncated\` -- only a truncated session can be resumed.`,
    remedy: "Check `forge session show`'s status field -- only a truncated session can be resumed.",
  },
  'RUN-072': {
    // `runSessionStep`'s own `resumeFrom` guard (`@forge/engine/interaction/session.ts`): a fresh
    // critic round found a truncated record whose own DECIDE phase had already genuinely run (a real
    // decision, and a real KB/ADR/Risk write-back, already exist) could still be resumed -- re-entering
    // CONVERGE and running DECIDE a second time, appending a second, divergent decision and a second
    // write-back on top of the first rather than continuing anything real.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { stepId: string }) =>
      `Session ${show(d.stepId)} already has a real decision recorded -- nothing left to resume.`,
    remedy:
      'Address this as its own real, final outcome via `forge session show` rather than resuming it ' +
      '-- start a fresh session for any follow-up work instead.',
  },
  'RUN-073': {
    // `@forge/cli/commands/loop/session.ts`'s own `parseSessionRecordText`: a real file exists for
    // `id`, but its own front matter is missing, unparseable YAML, or fails `sessionRecordSchema` --
    // data corruption or a hand-edit, distinct in kind from `RUN-070`'s own "no file at all" meaning. A
    // fresh critic round found this case had been folded into `RUN-070` outright, whose own remedy
    // ("run `forge session list`") is actively unhelpful here: `sessionList` silently skips any file
    // that fails to parse, so following that remedy hides the corruption rather than surfacing it.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { id: string }) =>
      `The session record for ${show(d.id)} exists but is not a real, valid SessionRecord.`,
    remedy:
      'Check the file directly under docs/forge/sessions/ -- its front matter is missing, ' +
      'unparseable, or no longer matches the real SessionRecord schema (`forge session list` will ' +
      'not surface it either, since it skips any file that fails to parse).',
  },
  'RUN-074': {
    // `forge session resume <id>` against a real, truncated record with no real `.state/{id}.json`
    // sidecar (`loadSessionState`, `@forge/engine/interaction/session.ts`) -- a session record
    // predating this piece's own sidecar mechanism, or one whose sidecar was manually removed/
    // corrupted. Distinct from `RUN-070`/`RUN-073`: the record itself is real and valid, only the
    // separate internal state this command needs to actually resume from is missing.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { id: string }) =>
      `No real, usable prior state survives for session ${show(d.id)} -- it cannot be resumed.`,
    remedy:
      'Create a fresh session for any follow-up work instead -- this record has no resumable ' +
      'state (it may predate the resume feature, or its internal state file was removed).',
  },
  'RUN-075': {
    // `20` §20.10 S7 (`PLAN-M11.md` P11): `forge deploy <env>`'s own real, wired call into
    // `@forge/engine/security`'s new `requireDestructiveConfirmation` -- a real destructive-operation
    // confirmation gate refused, whether because no confirmation was supplied at all, a wrong one was
    // typed, or this project's own `security.destructiveOps: 'deny'` policy forecloses the operation
    // outright with no override. `d.reason` is the decision's own already-specific message (naming the
    // operation/environment/resource and the exact mismatch), not re-derived here.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { reason: string }) => `Destructive operation refused: ${show(d.reason)}.`,
    remedy:
      'Provide the exact typed confirmation this operation requires (environment/resource), or ask a ' +
      'human operator with the authority to type it -- no autonomy setting can bypass this gate.',
  },
  // `PLAN-M11.md` P13: `forge audit`'s own CLI report layer is `@forge/telemetry`'s own `TelemetryError`
  // (`errors.ts`'s own doc comment: "`@forge/engine`... is where a caught `TelemetryError` is wrapped
  // into a real `ForgeError`") -- `@forge/cli` is the identical kind of caller one layer over, for a
  // report that spans every run rather than one step, so `RUN-038`'s own `stepId`-shaped payload does
  // not fit; this is the step-less equivalent a gauntlet critic round's own second finding asked for.
  'RUN-076': {
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { telemetryCode: string; telemetryMessage: string }) =>
      `forge audit failed a telemetry operation (${show(d.telemetryCode)}): ${show(d.telemetryMessage)}`,
    remedy:
      "Check the underlying telemetry error's own remedy (chained as this error's cause) for the specific next action.",
  },
  'RUN-077': {
    // `@forge/agents/resolve`'s own `resolveStepToolGrant` (`PLAN-M13.md` P4): a project overlay's
    // requested tool grant for a step's agent exceeds that agent's own declared ceiling, with no
    // covering, unexpired `security.toolCeilingEscalations` entry -- distinct from `CFG-507` (I7's
    // own whole-resolved-set re-assertion of the identical underlying `checkToolCeiling`, at module
    // install/compile time): this fires per real dispatched step, at run time, not at install time, so
    // it carries its own code rather than reusing one whose own `usage` exit code and message read as
    // a `forge extensions compile`-time finding.
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { agentId: string; detail: string }) =>
      `Agent ${show(d.agentId)}'s resolved tool grant exceeds its ceiling: ${show(d.detail)}.`,
    remedy:
      'Reduce the requested grant to within the ceiling, or add a matching, unexpired escalation.',
  },
  'RUN-078': {
    // `@forge/agents/resolve`'s own `resolveStepModel` (`PLAN-M13.md` P4, `05` §5.8): an agent's
    // effective model tier (its own declared `model.tier`, or a project's `models.overrides` entry for
    // its id) has no resolvable model for the adapter dispatching it -- either the effective tier
    // itself is not a real tier (a bad `models.overrides` value; `05` §5.8's own worked example is
    // role id -> tier name, but nothing schema-validates it against the real three-tier set), or
    // `models.tiers.<tier>` simply has no entry (or only a blank one) for this adapter.
    severity: 'error',
    exitCode: EXIT_CODES.prerequisiteMissing,
    message: (d: { agentId: string; detail: string }) =>
      `Agent ${show(d.agentId)} has no resolvable model: ${show(d.detail)}.`,
    remedy:
      'Fix models.overrides to name frugal, balanced or max, and add a models.tiers entry for that tier and adapter in .forge/config.yaml.',
  },
  'RUN-079': {
    // `@forge/agents/prompt`'s `resolveContentReference` (`PLAN-M13.md` P1): a well-formed brief/prompt
    // reference whose file does not exist under `.forge/briefs/` or `.forge/prompts/`. Distinct from
    // RUN-034's generic "the disk said no" (whose remedy points at permissions and disk space): the
    // real fix here is to create or regenerate the file, and `forge run` does not force a
    // `validate --all` first, so a dispatch could otherwise print a misleading remedy.
    severity: 'error',
    exitCode: EXIT_CODES.prerequisiteMissing,
    message: (d: { reference: string }) =>
      `No brief or prompt content exists for ${show(d.reference)} under .forge/.`,
    remedy:
      'Create that file with real text, or re-run `forge init` to regenerate the shipped content, then run `forge workflow validate --all` or `forge agent validate --all`.',
  },
  'RUN-080': {
    // `@forge/engine/dispatch`'s prompt assembly (`PLAN-M13.md` P5, `05` §5.3, `07` §7.2): the adapter
    // reports `systemPromptControl: 'none'`, so it has no way to carry the compiled nine-block system
    // prompt at all. Refusing is the fail-closed reading of `07` §7.2's "adapters MUST fail closed"
    // (the engine refuses to run the step rather than run it without its operating contract and
    // constraints); silently dropping the prompt, or moving it into the user turn where it loses its
    // system-prompt authority, would each be a quieter way of running a weaker step.
    severity: 'error',
    exitCode: EXIT_CODES.prerequisiteMissing,
    message: (d: { adapterId: string; stepId: string }) =>
      `Adapter ${show(d.adapterId)} cannot carry a system prompt, so step ${show(d.stepId)} was not dispatched.`,
    remedy:
      'Choose an adapter that reports systemPromptControl append or replace, or extend the adapter so its invoke template can carry the system prompt.',
  },
  'RUN-081': {
    // `@forge/engine/dispatch`'s prompt assembly (`PLAN-M13.md` P5): a session's task text (an interaction
    // turn's task, a session phase's question) is blank. Compiling it would leave block [4] of the system
    // prompt empty -- the silently-weaker prompt assembly exists to prevent -- so the session is refused.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { stepId: string }) =>
      `Step ${show(d.stepId)} has no task text, so there is nothing to put in the prompt's step brief.`,
    remedy:
      'Provide the question or task text for the session (for example the --question flag), or give the step a real brief, then retry.',
  },
  'RUN-082': {
    // `@forge/cli`'s own `forge plan run-plan <stageId>` (`03` §3.2.3, `PLAN-M13.md` P10): no Epic in the project
    // declares this stage, so there is no stage to compile a run plan for. Distinct from an *empty* stage
    // (an epic exists, it has no stories), which is a valid, empty plan.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { stageId: string }) => `No stage ${show(d.stageId)}: no Epic declares it.`,
    remedy:
      'Run `forge plan stage <id>` first to write the stage’s epics and stories, or pass the stage id an existing Epic’s `stage` field names.',
  },
  'RUN-083': {
    // `@forge/engine/dispatch`'s output contract check (`PLAN-M13.md` P7, `05` §5.5): after an agent step's
    // session ended ok, a declared `outputs` entry was not found at its `18` §18.7 registry location among
    // the files the session produced, or did not validate against its artifact schema. A `validation`-class
    // step failure (`06` §6.8): the step fails instead of being reported as succeeded. `detail` names every
    // unmet output, the expected path glob and the check that failed.
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { stepId: string; detail: string }) =>
      `Step ${show(d.stepId)} did not produce its declared outputs: ${show(d.detail)}`,
    remedy:
      'Write each declared output to the expected path with valid front matter (the `.forge/templates/<Type>.md` scaffold shows the shape), or correct the step’s `outputs:` declaration, then run the workflow again.',
  },
  'RUN-084': {
    // The same output-contract failure as `RUN-083`, when the cause is the agent's own tool grant: the step
    // declares outputs but the agent it is assigned to has `tools.write: false`, so it could not have
    // written any file. Not an exemption (the check still ran and still fails the step): a distinct code so
    // the remedy points at the real fix, which no amount of re-running the same step will supply.
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { stepId: string; agentId: string; detail: string }) =>
      `Step ${show(d.stepId)} cannot produce its declared outputs: agent ${show(d.agentId)} has tools.write: false. ${show(d.detail)}`,
    remedy:
      'Set `tools.write: true` on this agent’s definition, assign the step to an agent that can write, or remove the step’s declared `outputs`.',
  },
  'RUN-085': {
    // A run ended `failed` (`RunFailed`); the log names why (`PLAN-M13.md` P12, `Q208` finding 1). Printed by
    // `forge run`/`forge resume` in place of a bare `status=failed`.
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { summary: string }) => `The run failed: ${show(d.summary)}.`,
    remedy:
      'Run `forge logs` to read each failed step and fix what it names, then start the workflow again with `forge run`: `forge resume` continues steps that were interrupted or never started, not steps that failed.',
  },
  'RUN-086': {
    // The launcher shim (`@forge/cli` `launcher-shim.ts`, `PLAN-M13.md` P12) could not be created. The run goes
    // ahead without it (a warning, exit unchanged): only `command` steps that call `forge` are affected.
    severity: 'warning',
    exitCode: EXIT_CODES.failure,
    message: (d: { reason: string }) =>
      `Could not create the launcher that lets command steps run \`forge\`: ${show(d.reason)}.`,
    remedy:
      'Set a writable TMPDIR (or free disk space), or add `forge` to PATH, then run the workflow again: command steps that call `forge` fail until one of those is true.',
  },
  'RUN-087': {
    // `forge debug` (`PLAN-M13.md` P27, `13` §13.2): the loop ends in a fix applied in its lane, so the
    // diagnostician's resolved tool grant must allow writes. Refused before any session or lane exists, with
    // the grant named, instead of after a paid diagnosis that could not be acted on. Distinct from `RUN-084`
    // (a workflow step that declares outputs), whose remedy talks about steps and `outputs:`.
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { agentId: string; detail: string }) =>
      `\`forge debug\` cannot apply a fix: agent ${show(d.agentId)} has a resolved tool grant without write access. ${show(d.detail)}`,
    remedy:
      'Set `tools.write: true` in the diagnostician’s agent definition (`.forge/agents/diagnostician.yaml`; the shipped definition declares it), then run `forge debug` again.',
  },
  'RUN-088': {
    // `forge run <workflow> --input <name>=<value>` (`03` §3.2.4, `PLAN-M13.md` P21): a pair that is not
    // `name=value`, a name that cannot be an input (a reserved context root), a value the input's declared
    // type refuses, or the same input given two different values (twice, or through `--stage`/`--story`).
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { input: string; reason: string }) =>
      `Cannot use run input ${show(d.input)}: ${show(d.reason)}.`,
    remedy:
      'Pass each run input as `--input <name>=<value>` (repeat the flag for more than one): the name is a plain identifier such as `stageId`, and the value matches the input’s declared type. The message names the rule broken: a value a shell command reads may only be a plain token, and an owner role is set in the Story document, not here. The workflow file’s `inputs:` block lists what it declares.',
  },
  'RUN-089': {
    // `PLAN-M13.md` P21: the workflow cannot be planned because a run input it needs was not supplied (a
    // declared `required: true` input, or a placeholder its steps read at the top of the context). Named here
    // instead of the compiler's own list of unresolved placeholders.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { workflowId: string; missing: string }) =>
      `Workflow ${show(d.workflowId)} needs run input(s) that were not supplied: ${show(d.missing)}.`,
    remedy:
      'Pass each with `--input <name>=<value>` (for example `--input stageId=mvp`); `--stage <id>` also supplies `stageId` and `--story <id>` also supplies `storyId`. A story’s `ownerRole` is read from the Story document when `--story` names one.',
  },
  'RUN-090': {
    // `PLAN-M13.md` P21: `forge run <workflow> --stage <id>` for a workflow that runs over the stage's stories, when
    // the stage cannot be run as it stands: its Epics and Stories contradict each other (a dependency cycle, an
    // unknown dependency, a listed story with no document, a story failing its schema...), a story is blocked, or
    // no story is left to build. The same findings `forge plan run-plan` prints.
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { stageId: string; findings: string }) =>
      `Stage ${show(d.stageId)} cannot be run: ${show(d.findings)}`,
    remedy:
      'Run `forge plan run-plan <stage>` to see every finding, fix the Epic or Story documents it names (`forge spec validate` checks their schemas; a blocked story needs its `blocked_by` resolved), then run the workflow again.',
  },
  'RUN-091': {
    // `PLAN-M13.md` P21, `10` §10.6 "Enforced separations": the story's owner role is `sdet` or `reviewer`, so the
    // workflow would run two of its agent steps (the tests and the implementation, or the review and the
    // implementation) under one role. The stage plan reports the same thing for `build-stage` (`RUN-090`).
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { workflowId: string; role: string; steps: string }) =>
      `Workflow ${show(d.workflowId)} would run ${show(d.steps)} under the one role ${show(d.role)}, so the agent that writes the failing tests or reviews the work would also implement it.`,
    remedy:
      'Set the story’s `owner_role` to an implementing role (not `sdet` or `reviewer`) in its Story document, then run the workflow again.',
  },
  'RUN-092': {
    // `PLAN-M13.md` P21: `forge run implement-story --story <id>` / `forge implement <id>` for a Story that is not
    // ready to implement: already delivered (`done`/`verified`) or blocked (`status: blocked` or a `blocked_by`
    // entry). The stage path reports the same through the plan (`RUN-090`).
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { storyId: string; state: string }) =>
      `Story ${show(d.storyId)} cannot be implemented: it is ${show(d.state)}.`,
    remedy:
      'Resolve what blocks the story (its `blocked_by` entries), or choose a story that is not delivered, then run the workflow again.',
  },
  'RUN-095': {
    // `PLAN-M13.md` P28, `20` §20.1 (exec allowlist, hard denylist, `network: none`), `20` §20.10 S2/S4: a shell command a
    // model proposed (`forge debug`'s REPRODUCE/PROVE reproduction) did not pass the diagnostician's resolved tool
    // grant, so it was not run. Never thrown out of the loop: it is recorded in the RCA evidence as a refused command.
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { phase: string; reason: string; detail: string }) =>
      `A command proposed during ${show(d.phase)} was refused and not run (${show(d.reason)}): ${show(d.detail)}`,
    remedy:
      'Edit the proposed command to one the agent’s `tools.exec` patterns allow, without chaining (`;`, `&&`, `|`, redirection), expansion (`$VAR`, `$(...)`, backticks, `~`, globs that reach secrets), a path outside the project, a network call, a secret file or a git subcommand that is not read-only. Only a refusal for `not-in-grant` (or `network`, when the grant’s `network` is `full`) can be lifted by editing the diagnostician’s `tools.exec` in `.forge/agents/diagnostician.yaml`; FORGE never widens it for you.',
  },
  'RUN-096': {
    // `PLAN-M13.md` P28, `20` §20.2 (deny list, claim enforcement), `20` §20.4 (pre-commit secret scan), `20` §20.5 point 5
    // (output scanning): the diff a `forge debug` FIX attempt produced touched a protected path, added a symlink or
    // contained a secret-shaped value, so the attempt was refused before PROVE ran or anything was committed.
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { phase: string; reason: string; detail: string }) =>
      `The ${show(d.phase)} diff was refused and not committed (${show(d.reason)}): ${show(d.detail)}`,
    remedy:
      'Fix the change so it touches ordinary source and test files only: not `.git/`, `.forge/`, `.env*`, secret files, CI or hook configuration, the project’s document roots, or a symlink, and it must not add a secret. Then run `forge debug` again, or make the change by hand.',
  },
  'RUN-101': {
    // `PLAN-M13.md` P20: an `elicit` step needs a human's answer and the run has no way to get it. A failed step, never
    // a silent default, and never a wait with nobody there.
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { stepId: string; question: string; reason: string }) =>
      `Step ${show(d.stepId)} asks question ${show(d.question)} and no answer was given: ${show(d.reason)}`,
    remedy:
      'Run the workflow in a terminal so it can ask, or supply the answers in a file: `forge run <workflow> --answers /tmp/answers.json` (or `forge resume --answers /tmp/answers.json`), a JSON or YAML object of question name to answer. Keep the file outside the project: an untracked file inside it makes the next run refuse (`VCS-DIRTY-TREE`). The step is asked again from its first question.',
  },
  'RUN-102': {
    // `PLAN-M13.md` P20: an answer that breaks its question's own rules (blank, longer than the cap, not one of the listed choices).
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { stepId: string; question: string; reason: string }) =>
      `The answer to question ${show(d.question)} of step ${show(d.stepId)} was refused: ${show(d.reason)}`,
    remedy:
      'Provide an answer that is not blank, is at most 4000 characters, contains no credential or secret, and, when the question lists choices, is exactly one of them; then run again (`forge resume --answers <file>` continues the run).',
  },
  'RUN-103': {
    // `PLAN-M13.md` P20: the `--answers` file itself.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { path: string; reason: string }) =>
      `The answers file ${show(d.path)} cannot be used: ${show(d.reason)}`,
    remedy:
      'Pass a JSON or YAML file holding one object whose keys are question names and whose values are the answers as text (quote a number or true/false so it keeps its exact spelling), for example {"ideaSummary": "A booking app", "greenfield": "greenfield"}.',
  },
  'RUN-104': {
    // `PLAN-M14.md` P3, `SPEC-QUESTIONS.md` Q232 decision 1 (Q212's own P31 residual, now resolved): `06`
    // §6.7 said a `strict` claim policy "fail[s] the step" over an out-of-claim write; the code, until
    // this piece, only ever reverted it (`PLAN-M13.md` P14). `enforceClaim` still reverts every offending
    // path exactly as before, and that revert (and its own `LaneCommitted {reason:'claim-revert'}`) has
    // already landed by the time this is raised -- nothing here changes what survives on the lane branch,
    // only whether the step itself is reported as having gone wrong. `warn` never raises this (`06`
    // §6.7's own unchanged `guided` default): an out-of-claim write there stays a bare `PolicyViolation`
    // event with the step otherwise succeeding.
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { stepId: string; policy: string; detail: string }) =>
      `Step ${show(d.stepId)} wrote outside its claim under ${show(d.policy)} enforcement: ${show(d.detail)}`,
    remedy:
      'Add each reverted path to the step’s `produces` (or, for a registry artifact, declare it in `outputs`), or make the session write only what the step already claims. `forge logs` names the step and shows the reverted paths; the `PolicyViolation` event carries the complete, unbounded list.',
  },
  'RUN-107': {
    // `PLAN-M14.md` P9, `SPEC-QUESTIONS.md` Q221 disclosed item (d) / Q232 decision 18: the integration
    // branch used to accumulate across runs with no path back to `main`'s own newer commits, so a lane
    // branched from it stopped seeing what a human (or a later `deliver` step) committed there directly.
    // `syncIntegrationBranchToTrunk` (`context.ts`) fast-forwards it to `main` at the start of every
    // `forge run`, before anything else for the run exists -- but a genuinely diverged branch (neither
    // tip is an ancestor of the other) cannot be fast-forwarded without either discarding real commits
    // (`git reset --hard`, never done) or creating a real, unattended merge commit (`git merge main`,
    // also never done): both are refused instead. `forge resume` and `forge merge` never raise this --
    // neither one re-syncs the branch at all.
    severity: 'error',
    exitCode: EXIT_CODES.failure,
    message: (d: { branch: string; integrationTip: string; trunkTip: string }) =>
      `Integration branch ${show(d.branch)} (at ${show(d.integrationTip)}) has diverged from main (at ${show(d.trunkTip)}) and cannot be fast-forwarded.`,
    remedy:
      'Merge `main` into the branch by hand in the integration worktree (under `.forge/state/worktrees/`) and push the resolution, or delete the branch once its work has been delivered so the next run creates it fresh from `main`.',
  },
  'RUN-097': {
    // `PLAN-M13.md` P36, `09` §9.3, `10` §10.6: the story's `owner_role` names an agent that does not produce code (an
    // authoring or judging role, or one the project does not have). `implement-story` runs its plan, implementation,
    // refactor and documentation steps as that owner with its own write grant, so the owner must be an implementation role.
    // `RUN-091` is the narrower refusal for the two roles whose separation `10` §10.6 enforces (`sdet`, `reviewer`).
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { storyId: string; detail: string }) =>
      `Story ${show(d.storyId)} cannot be implemented: ${show(d.detail)}`,
    remedy:
      'Set the story’s `owner_role` to an implementation role (an agent that declares a `Code` output, such as `backend` or `frontend`; `forge agent list` shows the roster) in its Story document, then run the workflow again. `forge spec validate` reports the same problem for every story.',
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
  // `@forge/extensions/module`'s own L1 module compilation (`19` §19.1, `PLAN-M10.md` P2). Next free
  // `CFG-*` slot after `CFG-020`, in the same "config/manifest validity" scope: a `module.yaml` is a
  // manifest like `config.yaml`/`.forge/manifest.yaml` above it, and `requires`/`conflicts`/
  // `forgeVersion` are all manifest-content facts, not a new prefix's worth of concern.
  'CFG-021': {
    // A `module.yaml` that fails schema validation outright (malformed YAML, or a shape
    // `moduleSchema` rejects) -- distinct from `CFG-022`-`CFG-024` below, which are all schema-valid
    // manifests that fail a cross-module or cross-version check instead.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { path: string; detail: string }) =>
      `Module manifest at ${show(d.path)} is invalid: ${show(d.detail)}`,
    remedy: 'Fix the module.yaml schema violation named above, then re-parse.',
  },
  'CFG-022': {
    // `19` §19.1's own `requires: [ fm-core ]` worked example: a module naming a `requires` entry
    // that is not itself installed in the same project.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { moduleId: string; requires: string }) =>
      `Module ${show(d.moduleId)} requires ${show(d.requires)}, which is not installed.`,
    remedy: 'Install the missing module, or remove it from requires.',
  },
  'CFG-023': {
    // `19` §19.1's own "conflicts between two modules" line -- a module naming a `conflicts` entry
    // that IS installed in the same project. Distinct from the *other* sense of "conflict" `19`
    // §19.1 also uses (two modules both `provides`-ing the same id), which is never an error: that
    // one resolves by install order and is reported as an informational diff line, not this code.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { moduleId: string; conflictsWith: string }) =>
      `Module ${show(d.moduleId)} conflicts with the installed module ${show(d.conflictsWith)}.`,
    remedy: 'Remove one of the two conflicting modules.',
  },
  'CFG-024': {
    // A module's own `forgeVersion` range (e.g. `">=1.0 <2"`) not satisfied by the running FORGE
    // version.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { moduleId: string; forgeVersion: string; required: string }) =>
      `Module ${show(d.moduleId)} requires forge ${show(d.required)}, but the running version is ${show(d.forgeVersion)}.`,
    remedy:
      "Upgrade FORGE to satisfy the module's forgeVersion range, or install a compatible module version.",
  },
  'CFG-025': {
    // A critic round on `PLAN-M10.md` P2 found `resolveInstalledModules` built a manifest path as
    // `modulesDir/<installOrder-entry>/module.yaml` with no check on the entry itself -- a real
    // path-traversal hole for an installed-module id like `"../../etc"`. Every real module id is
    // lower-kebab-case (`moduleSchema`'s own `moduleIdSchema`/`MODULE_ID_PATTERN`), which cannot
    // contain `.`, `/`, or a drive letter at all, so rejecting anything else here before it is ever
    // joined into a path closes the hole at the one point the untrusted string is still just a string.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { moduleId: string }) =>
      `${show(d.moduleId)} is not a valid module id (must be lower-kebab-case).`,
    remedy:
      "Fix the project manifest's installed-module list to name only real, lower-kebab-case module ids.",
  },
  // `@forge/extensions/install`'s own overlay/module bundle fetch (`19` §19.5, `PLAN-M11.md` P1).
  // Next free `CFG-*` slot after `CFG-025`, same "manifest validity" scope: whether a fetched
  // bundle's own local path is real, and whether it actually contains an installable manifest, are
  // both facts about the manifest a caller is about to parse, not a new prefix's worth of concern.
  'CFG-026': {
    // A local overlay/module source path (`forge overlay add ./acme-standards`) that does not exist,
    // or exists but is not a directory -- distinct from `CFG-027` below, which is a real, existing
    // directory that simply has no manifest in it.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { path: string }) => `${show(d.path)} does not exist or is not a directory.`,
    remedy: 'Provide a real, existing directory path for a local overlay/module source.',
  },
  'CFG-027': {
    // `19` §19.5 step 2: "Parse overlay.yaml / module.yaml" -- a fetched bundle (local path or git
    // channel alike) whose root has neither file is not an installable overlay or module at all.
    // Shared across both channels: the caller passes whichever description of the source (a local
    // path, or a `git+...#ref` spec) is meaningful to the person reading the error.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { source: string }) =>
      `${show(d.source)} does not contain a real overlay.yaml or module.yaml.`,
    remedy:
      'Point the install source at a directory containing a real overlay.yaml or module.yaml.',
  },
  'CFG-028': {
    // `findManifestKind` (`packages/extensions/src/install/manifest.ts`): a `stat` failure on a
    // candidate manifest filename that is *not* "the file does not exist" -- a permission error, most
    // realistically. Distinct from `CFG-027`: that code means "no manifest is here at all"; this one
    // means "a manifest might be here, but it could not even be checked."
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { path: string }) => `Could not check whether ${show(d.path)} is a real file.`,
    remedy:
      'Check the file and its containing directory are readable by the current user, then retry.',
  },
  // `@forge/extensions/install/fetch-npm.ts`'s own npm channel (`19` §19.5, `PLAN-M11.md` P2). Next
  // free `CFG-*` slot after `CFG-028`, same "fetching/validating an installable bundle" scope as
  // `CFG-026`-`CFG-028` above.
  'CFG-029': {
    // `parseNpmOverlaySpec`: `spec` is not a valid `npm:@scope/name` or `npm:@scope/name@version`
    // per `19` §19.5's own literal format.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { spec: string }) => `${show(d.spec)} is not a valid npm overlay/module spec.`,
    remedy: 'Provide a spec in the literal format npm:@scope/name or npm:@scope/name@version.',
  },
  'CFG-030': {
    // The real `npm pack <spec> --json` invocation itself failed (a non-zero exit, an unreachable
    // registry, a package/version that does not exist there, or malformed JSON on stdout) -- wraps
    // whatever the npm CLI reported rather than leaking a raw `execa` `ExecaError`/`SyntaxError` past
    // this function's own documented "throws only `ForgeError`" contract.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { spec: string; detail: string }) =>
      `\`npm pack ${show(d.spec)}\` failed: ${show(d.detail)}`,
    remedy:
      'Check the package name/version exists at the configured registry, and that the registry is reachable.',
  },
  'CFG-031': {
    // The tarball `npm pack` wrote to disk does not hash to the `integrity` value its own `--json`
    // output reported for it -- a corrupted write, a TOCTOU race, or genuine tampering between the
    // pack step and this check. A real, structural re-verification of the actual on-disk bytes, not
    // merely trusting the pack step succeeded (`PLAN-M11.md` P2's own literal Checks line).
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { spec: string; expected: string }) =>
      `The tarball packed for ${show(d.spec)} does not match its own reported integrity (${show(d.expected)}).`,
    remedy: 'Delete the local npm cache and retry; report this as a FORGE bug if it recurs.',
  },
  'CFG-032': {
    // `tar-extract.ts`: an entry this extractor refuses to write -- a symlink, hard link, device,
    // FIFO, an unsupported GNU-longname/pax extension, or a path that would resolve outside the
    // extraction directory ("tar slip"). Fail-closed: refused outright rather than attempting a
    // containment-checked write for a shape this piece's own budget does not cover, the identical
    // stance `@forge/vcs`'s own `VCS-OVERLAY-SYMLINK-REJECTED` already takes for the git/local
    // channels (`PLAN-M11.md` P1).
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { entry: string; reason: string }) =>
      `Refusing to extract tar entry ${show(d.entry)}: ${show(d.reason)}.`,
    remedy:
      'Fix or replace the package producing this tarball shape; report this as a FORGE bug if the ' +
      'package looks legitimate.',
  },
  'CFG-033': {
    // The decompressed content of a fetched npm tarball exceeded this extractor's own hard cap --
    // a decompression-bomb guard (a small, highly-compressed `.tgz` expanding to an unreasonable
    // size), enforced by counting bytes as they stream out of `zlib`, not merely capping the
    // compressed file size, which a bomb makes trivially small.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { limit: number }) =>
      `The npm tarball's decompressed content exceeds the ${show(d.limit)}-byte limit.`,
    remedy:
      'Reduce the bundle to a reasonable size, or report this as a FORGE bug if it is genuinely ' +
      'this large.',
  },
  'CFG-034': {
    // `tar-extract.ts`: the archive itself is structurally broken -- truncated mid-block, not a
    // valid gzip stream, or an entry declaring more content than the archive actually has. Distinct
    // from `CFG-030`, whose message/remedy are specific to `npm pack` itself failing or producing
    // unusable JSON -- a critic round found the first draft reused `CFG-030` for this genuinely
    // different failure, rendering a registry-focused remedy ("check the registry is reachable") for
    // a local, already-downloaded file that is simply corrupt.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { detail: string }) =>
      `The npm tarball is corrupted or truncated: ${show(d.detail)}`,
    remedy: 'Delete the local npm cache and retry; report this as a FORGE bug if it recurs.',
  },
  'CFG-035': {
    // `tar-extract.ts`: a real local filesystem failure while extracting -- a full disk, a
    // permission error on the extraction directory, or a crafted tarball whose entries conflict
    // (e.g. a file entry followed by a directory entry at the same path). Distinct from `CFG-034`:
    // a second critic round found the first draft's catch-all folded this class into `CFG-034`'s own
    // "corrupted or truncated" message too, giving the exact same "wrong remedy for an unrelated
    // failure" defect `CFG-030`/`CFG-034` were already split apart to fix, one layer further down.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { detail: string }) => `Extracting the npm tarball failed: ${show(d.detail)}`,
    remedy: 'Check the extraction directory has free space and is writable, then retry.',
  },
  'CFG-036': {
    // `packages/extensions/src/install/consent.ts` (`19` §19.5 step 3, `15` §15.11):
    // `describeRequestedCapabilities`'s own overlay case validates the consent-relevant subset of a
    // parsed `overlay.yaml` document (`requestsCapabilities`/`provides.mcp`) against a deliberately
    // partial schema -- no full `overlay.yaml` validator exists anywhere in this codebase yet (see
    // `PLAN-M11.md` P3's own recorded scope note). A document that fails even this partial shape
    // (e.g. a `requestsCapabilities` entry that is not one of `network`/`exec`/`mcp-write`, or the
    // wrong value type for one) cannot be safely described to a user deciding whether to consent, so
    // it is refused here rather than rendering a silently incomplete or fabricated capability list.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { detail: string }) =>
      `This overlay's requested capabilities could not be parsed: ${show(d.detail)}`,
    remedy:
      'Fix the requestsCapabilities/provides.mcp fields in overlay.yaml to match the documented ' +
      'shape (15 §15.11), then retry.',
  },
  // `@forge/extensions/install/safety-scan.ts`'s own pre-install static safety scan (`19` §19.5 step
  // 4, `15` §15.10 I9, `20` §20.6, `PLAN-M11.md` P4). Next free `CFG-*` slot after `CFG-036` (this
  // milestone's own concurrent `P3` claimed that one first) — last gate in the same "fetching/
  // validating an installable bundle" sequence as `CFG-026`-`CFG-036` above, run just before step 5's
  // `.forge/` install.
  'CFG-037': {
    // A fetched-but-not-yet-installed bundle's own skill or template bodies contain instruction-
    // shaped content, a secret-shaped literal, or prose asking for a wider grant than the bundle's
    // own declared module ceiling — `findings` is always non-empty when this throws, one line per
    // location and reason, so a bundle with several problems reports all of them at once rather than
    // stopping at the first.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { bundlePath: string; findings: readonly string[] }) =>
      // `d.findings` goes through `show` per-entry, and the whole join is skipped for a non-array
      // value, rather than a bare `d.findings.map(...)` — the identical "every template renders
      // `<missing>`, never a raw crash, for a detail object missing a key" contract every other row
      // in this table gets from `show` alone, which a plain array has no single scalar rendering for.
      `The static safety scan refused ${show(d.bundlePath)}:\n${
        Array.isArray(d.findings)
          ? d.findings.map((f) => `  - ${show(f)}`).join('\n')
          : show(d.findings)
      }`,
    remedy:
      'Remove the flagged content (or, for a grant-widening finding, either narrow the prose or ' +
      "widen the module's own declared ceiling) and retry. Nothing was installed.",
  },
  'CFG-038': {
    // `safety-scan.ts`: a skill, template, or prompt file the pre-install scan would otherwise read
    // in full exceeds its own size cap -- a critic round found the local and git install channels
    // apply no byte-size limit of their own, so without this check a single oversized file in an
    // otherwise-ordinary bundle would be read entirely into memory before consent or install ever
    // run. Refused outright (never silently skipped), matching this same scan's own fail-closed
    // stance on every other unscannable-content case.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { location: string; size: number; limit: number }) =>
      `${show(d.location)} is ${show(d.size)} bytes, over the safety scan's own ${show(d.limit)}-byte limit.`,
    remedy: 'Reduce the file to a reasonable size, or exclude it from the bundle, and retry.',
  },
  // `PLAN-M11.md` P5's own real `forge module add/remove/update`/`forge overlay add` lifecycle —
  // next free `CFG-*` slot after `CFG-038`, same "fetching/validating/installing a bundle" scope as
  // `CFG-026`-`CFG-038` above, extended to the install/remove/update decisions those codes never
  // needed a fetched-but-not-yet-parsed bundle for.
  'CFG-039': {
    // `moduleRemove`'s own real dependent-module guard (`19` §19.1's `requires` field, checked in the
    // opposite direction from `resolveInstalledModules`' own `CFG-022`): another still-installed
    // module's own `requires` names the module a caller is trying to remove.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { id: string; requiredBy: string }) =>
      `Module ${show(d.id)} cannot be removed while ${show(d.requiredBy)} still requires it.`,
    remedy: 'Remove the dependent module(s) first, then retry.',
  },
  'CFG-040': {
    // `19` §19.5 step 3's own "nothing is installed on refusal" — `promptForConsent` resolved
    // `false` (an explicit "no," a non-interactive refusal, or an unanswered prompt), so the install
    // pipeline stops here, before step 4's safety scan or step 5's install ever run.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { id: string }) =>
      `Installing ${show(d.id)} was refused: consent was not granted at the capability screen.`,
    remedy: 'Approve the capability consent screen to proceed, or point at a different source.',
  },
  // `CFG-041` is deliberately unused, not a numbering mistake: it was reserved for an "unsupported
  // install source scheme" refusal, but `module.ts`'s own `fetchInstallBundle` dispatcher has no such
  // outcome to report — its three branches (`git+`, `npm:`, and a local-path fallthrough) are
  // exhaustive by construction, so every `source` string reaches one of P1/P2's own three real
  // channels rather than a fourth "unrecognised" case. Left visibly reserved here (rather than
  // silently skipped) so a future reader does not wonder whether a slot went missing.
  'CFG-042': {
    // `moduleAdd`/`overlayAdd` refuse an id already present in the manifest — `forge module update`/
    // `forge overlay update` is the real path for changing an already-installed entry's version, not
    // a second `add` silently reinstalling over it.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { id: string; kind: 'module' | 'overlay' }) =>
      `${show(d.kind)} ${show(d.id)} is already installed.`,
    remedy: 'Run the matching "update" command to change its version, or remove it first.',
  },
  'CFG-043': {
    // A fetched bundle's own manifest kind (`overlay.yaml` vs `module.yaml`, `findManifestKind`'s own
    // real distinction) does not match the command that fetched it — `forge module add` fetching a
    // bundle that only has an `overlay.yaml`, or the reverse.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { source: string; expectedKind: string; actualKind: string }) =>
      `${show(d.source)} contains a ${show(d.actualKind)}, not the expected ${show(d.expectedKind)}.`,
    remedy: 'Point this command at a source that actually contains a bundle of the expected kind.',
  },
  'CFG-044': {
    // A fetched module bundle's own `module.yaml` declares an `id` different from the one the caller
    // named (`forge module add <id> <source>`) — refused rather than silently installed under
    // whichever id the caller happened to type, which would let a manifest row's own `id` key and a
    // module's own self-declared identity permanently disagree.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { expectedId: string; actualId: string }) =>
      `The fetched bundle declares id ${show(d.actualId)}, not the requested ${show(d.expectedId)}.`,
    remedy:
      "Fix the id argument to match the bundle's own declared id, or point at the intended source.",
  },
  'CFG-045': {
    // `forge module remove`/`forge module update` refuse a manifest row with no recorded install
    // `source` -- a built-in module (`fm-core` etc., or the synthetic `@forge/templates` row), whose
    // whole-roster install/uninstall is `forge init`/`forge upgrade`'s own established mechanism
    // (`module.ts`'s own top-of-file doc comment), not this per-module lifecycle's.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { id: string }) =>
      `${show(d.id)} is a built-in module, not managed by forge module add/remove/update.`,
    remedy:
      "Choose a different module id, or change the project's requested module roster and run " +
      'forge upgrade instead.',
  },
  'CFG-046': {
    // `overlayAdd`'s own minimal `overlay.yaml` validation (`15` §15.11's worked example) -- no full
    // schema exists anywhere in this codebase yet (`install/consent.ts`'s own doc comment records
    // that as a deliberate, disclosed gap for its own narrower consent-screen purpose); this is the
    // install-path's own, equally minimal, equally disclosed check.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { source: string; detail: string }) =>
      `${show(d.source)}'s overlay.yaml is invalid: ${show(d.detail)}.`,
    remedy: 'Fix the overlay.yaml to match the documented schema and retry.',
  },
  'CFG-047': {
    // `module.ts`'s own `withManifestLock` (`PLAN-M11.md` P5, a critic-round fix): another real,
    // still-alive process already holds this project's install lock -- the identical "a live holder
    // is a real, named refusal, never a silent wait or a silently clobbered manifest" stance
    // `run/lock.ts`'s own `CFG-002` already takes for the run-supervisor lock, applied here to a
    // second, distinct lock (`.forge/state/module-install.lock`) so a `forge run` in progress and a
    // `forge module add` in progress never contend with each other's lock file.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: () => 'Another forge module/overlay install is already in progress for this project.',
    remedy: 'Wait for the other install to finish, then retry.',
  },
  'CFG-048': {
    // `moduleUpdate`'s own real existence check (a round-2 critic-round fix): the manifest still
    // records this module as per-item-managed (`source` present), but its own installed
    // `.forge/modules/<id>/module.yaml` is missing -- a corrupted or partial prior install, or
    // hand-tampering, rather than the "never installed at all" `KB-015` already covers.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { id: string }) =>
      `${show(d.id)} is recorded as installed, but its own .forge/modules/${show(d.id)}/module.yaml is missing.`,
    remedy: 'Run forge module remove, then forge module add again, to reinstall it cleanly.',
  },
  'CFG-049': {
    // `installBundleTree`'s own real path-overlap guard (a round-2 critic-round fix): the local
    // channel installs directly from the caller's own source directory (no temp copy), so a source
    // that sits inside -- or contains -- the very install destination this call is about to replace
    // would have `rm`/`cp` delete or recurse into content still being read.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { destination: string; source: string }) =>
      `${show(d.source)} overlaps its own install destination ${show(d.destination)}.`,
    remedy: 'Point the source at a directory outside the install destination and retry.',
  },
  'CFG-050': {
    // `runModuleConformance`'s own provides-vs-content re-validation (`19` §19.1/§19.3,
    // `PLAN-M11.md` P6): a module's own `module.yaml` `provides` block names an agent/workflow/
    // framework/gate/check/skill/artifactType/catalog/technique id with no real, matching file (or
    // directory, for a skill) anywhere under the module's own source tree -- "a template that cannot
    // produce a valid artifact is broken at authoring time" (`19` §19.3), extended to "a module that
    // claims content it does not ship is broken at install time." Blocks `forge module add`/`forge
    // module update` before any write to `.forge/`, the identical "every gate throws before the
    // filesystem write" discipline `module.ts`'s own top-of-file doc comment already establishes for
    // every other install-time gate.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { moduleId: string; detail: string }) =>
      `${show(d.moduleId)}'s own provides declaration does not match its real content: ${show(d.detail)}.`,
    remedy:
      'Add the missing agent/workflow/framework/gate/check/skill/artifactType/catalog/technique ' +
      "file under the module's own directory (matching its own declared id), or remove the entry " +
      'from provides if it was never really shipped.',
  },
  'CFG-051': {
    // `runModuleConformance`'s own `tests/*.test.ts` run (`19` §19.1's "module conformance tests",
    // `PLAN-M11.md` P6): at least one of the module's own hand-written conformance tests failed
    // against `@forge/testkit`'s real `FakePlatformAdapter` -- the module's own content does not
    // satisfy the contracts it claims to, by its own declared test suite (or the run itself timed out
    // or produced no report — treated identically, since a module whose own declared tests cannot
    // even run is exactly as unconformant as one whose tests run and fail). Blocks install/update the
    // same way `CFG-050` does, before any write to `.forge/`.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { moduleId: string; detail: string }) =>
      `${show(d.moduleId)}'s own conformance tests failed: ${show(d.detail)}.`,
    remedy:
      "Fix the module's own failing test(s) under its tests/ directory (or the content they " +
      'exercise), then retry the install.',
  },
  'CFG-052': {
    // `runModuleConformance`'s own per-file byte cap on a `provides`-referenced file it is about to
    // parse in full (`PLAN-M11.md` P6) -- the identical resource-exhaustion shape `CFG-038` already
    // covers for `scanBundleForSafety`'s own skill/template/prompt bodies, reusing that same numeric
    // cap but a distinct code and message: this fires from provides re-validation, not the safety
    // scan, and a message claiming "the safety scan's own limit" for a finding that scan never
    // produced would be actively misleading.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { location: string; size: number; limit: number }) =>
      `${show(d.location)} is ${show(d.size)} bytes, over module conformance's own ${show(d.limit)}-byte parse limit.`,
    remedy: 'Reduce the file to a reasonable size, or remove it from the module, and retry.',
  },
  'CFG-053': {
    // `@forge/agents/prompt`'s `resolveContentReference` (`PLAN-M13.md` P1): a workflow step's `brief:` or
    // an agent's `prompt.system`/`prompt.briefs.*` value that is not exactly `briefs/<name>.md` /
    // `prompts/<name>.md`. Distinct from CFG-003 (a path escaping the project root): `config.local.yaml`
    // or `briefs/x.txt` never leave the project, they simply are not a brief/prompt reference at all,
    // and a message claiming an escape would misdirect the fix.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { reference: string }) =>
      `${show(d.reference)} is not a brief or prompt reference: expected briefs/<name>.md or prompts/<name>.md.`,
    remedy:
      'Set the brief:/prompt: value to briefs/<name>.md or prompts/<name>.md, one directory deep, and run `forge workflow validate --all` or `forge agent validate --all` to confirm.',
  },
  'CFG-054': {
    // `.forge/config.yaml`'s `security.toolCeilingEscalations` is schema-typed `unknown[]`
    // (`SPEC-QUESTIONS.md` Q196); `@forge/engine/dispatch`'s prompt assembly (`PLAN-M13.md` P5) validates
    // each entry into the real `Escalation` shape before any step's tool grant is resolved from it.
    // A malformed entry is refused outright rather than skipped: skipping would quietly ignore a grant a
    // human believes is in force, and trusting an unvalidated shape would let a typo widen a grant.
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { index: number; detail: string }) =>
      `security.toolCeilingEscalations[${show(d.index)}] is not a valid escalation: ${show(d.detail)}.`,
    remedy:
      'Provide agent, grant, reason, approvedBy, approvedAt and expires on each entry (see 15 §15.3.2), or remove it, then retry.',
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
  // A gate document that cannot be read as written (`PLAN-M13.md` P41): an unknown key (a misspelled `checks:`
  // would otherwise be an empty gate, which passes vacuously), a wrong-typed value, or no deterministic check
  // at all (`15` §15.10 I4). Exit `usage`: the file is wrong, not the project's state.
  'GATE-506': {
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { file: string; key: string; detail: string; more?: number }) =>
      `Gate file ${show(d.file)} is invalid at ${show(d.key)}: ${show(d.detail)}` +
      (typeof d.more === 'number' && d.more > 0
        ? ` (${String(d.more)} more problem(s) follow it)`
        : '.'),
    remedy:
      'Fix the named key in the gate file (specs/10 §10.3 shows the gate document shape), then run ' +
      '`forge workflow validate --all` to list every remaining problem.',
  },
  // `forge gate approve` on a gate whose deterministic checks do not all pass and that no valid, unexpired waiver
  // covers (`10` §10.3 rule 1). Exit `gateFailed`, the code `forge gate check` uses for the same evaluation.
  'GATE-507': {
    severity: 'error',
    exitCode: EXIT_CODES.gateFailed,
    message: (d: { gateId: string; failing: string }) =>
      `Gate ${show(d.gateId)} cannot be approved: ${show(d.failing)} failed and no valid, unexpired waiver covers it.`,
    remedy:
      'Fix the failing checks and re-run `forge gate check <gate>`, or record a waiver with `forge gate waive ' +
      '<gate> --reason <text> --owner <name> --expires <iso-date>` and approve again.',
  },
  // `forge gate approve` by someone the gate's `approval:` block does not name, or a quorum this command cannot
  // verify (`10` §10.3's `approval`, `05` §5.9's `gates.may_approve`).
  'GATE-508': {
    severity: 'error',
    exitCode: EXIT_CODES.gateFailed,
    message: (d: { gateId: string; approver: string; detail: string }) =>
      `${show(d.approver)} may not approve gate ${show(d.gateId)}: ${show(d.detail)}.`,
    remedy:
      "Choose an approver the gate's `approval.roles` names to approve it, or change the gate's `approval` " +
      'block where the specs allow it.',
  },
  // `forge gate waive` on a gate whose checks all pass: nothing to excuse, and a standing waiver would cover
  // whatever fails later (`PLAN-M13.md` P41, `10` §10.3 rule 1).
  'GATE-509': {
    severity: 'error',
    exitCode: EXIT_CODES.usage,
    message: (d: { gateId: string }) =>
      `Gate ${show(d.gateId)} has no failing deterministic check, so there is nothing to waive.`,
    remedy:
      'Run `forge gate check <gate>` to see which checks fail, and waive the gate only while one of them does.',
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
