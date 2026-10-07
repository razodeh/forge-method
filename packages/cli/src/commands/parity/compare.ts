/**
 * The per-case comparison: normalise, run the stability probe, and decide one of the five case-level
 * verdicts by `13` F-TEST-9's total precedence (`error`, `unclean`, `unstable`, `mismatch`, `match`).
 * Ties `normalize.ts` (the declared rules), `stability.ts` (the probe) and the `unclean` fact a
 * caller supplies (observing the candidate's tree is `P3`'s job, not this piece's) into the one
 * decision P7 needs per case.
 *
 * **Deliberately never returns the observed text.** `13` F-TEST-9's information boundary ("an
 * envelope and a `ParityEvidence` record carry no observed text, only where a difference is") is
 * enforced at the TYPE level, not by caller discipline: {@link CaseComparisonResult} has no field
 * that could hold observed content, so a caller cannot accidentally serialise one into `--json`
 * output. A human-mode mismatch excerpt is a SEPARATE function, {@link buildMismatchExcerpt}, that a
 * CLI renderer calls explicitly, passing the two raw texts it already has in hand — reaching it is
 * never a side effect of asking for a verdict.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M16.md P4
 */
import { ForgeError, isForgeError } from '@forge/core/errors';

import type { CanonicalValue } from './canonical-json.ts';
import { toCanonicalJson } from './canonical-json.ts';
import type {
  FileObservation,
  FileObservationContent,
  HttpObservation,
  LibraryObservation,
  ProcessObservation,
  SurfaceObservation,
} from './capture.ts';
import type { NormalizeRule, ProcessStream, SurfaceKind } from './declaration-types.ts';
import type { ObservedRoot } from './normalize.ts';
import {
  applyNormalizeRulesToText,
  removeJsonPointer,
  reorderPointersForSafeRemoval,
  rewriteRootPaths,
} from './normalize.ts';
import type { StabilityOutcome } from './stability.ts';
import { decideStability } from './stability.ts';

export type { ObservedRoot } from './normalize.ts';

/** Where a `mismatch` was found: which surface, and, for `process`/`library`, which stream, for
 * `file`, which declared output path, or, for `http`, which part of the response
 * (`status`/`headers`/`body`). Never the text itself (`13` F-TEST-9's information boundary). */
export interface MismatchLocation {
  readonly surface: SurfaceKind;
  readonly stream?: ProcessStream;
  readonly file?: string;
  readonly httpPart?: 'status' | 'headers' | 'body';
}

/** One case's comparison outcome — one of the five case-level verdicts `13` F-TEST-9 names, each
 * carrying only what that verdict is defined to carry; `mismatch`'s own `location` is structural
 * ("where"), never the observed content ("what"). */
export type CaseComparisonResult =
  | { readonly verdict: 'error'; readonly reason: string }
  | { readonly verdict: 'unclean' }
  | { readonly verdict: 'unstable' }
  | { readonly verdict: 'mismatch'; readonly location: MismatchLocation }
  | { readonly verdict: 'match' };

/** What {@link decideCaseVerdict} needs to decide one case. */
export interface CaseComparisonInput {
  /** Which surface this case belongs to — a case belongs to exactly one (`13` F-TEST-9). */
  readonly surface: SurfaceKind;
  /** This case's own zero-based index within its surface's `cases` list (`declaration-types.ts`'s
   * own case-identity note) — carried only for a `RUN-130` failure's own message. */
  readonly caseIndex: number;
  /** This case's own `normalize` list, in the declaration's own order. */
  readonly rules: readonly NormalizeRule[];
  /** The selected capture's own entry for this case — ALREADY normalised (a capture stores "the
   * reference's observed, NORMALISED behaviour", `13` F-TEST-9), never re-normalised here. */
  readonly referenceNormalized: SurfaceObservation;
  /** Every one of the candidate's `stability.runs` runs, RAW (not yet normalised) — this function
   * normalises each one itself, since the stability probe must see what normalisation does to every
   * run individually before it can ask whether they agree. */
  readonly candidateRawRuns: readonly SurfaceObservation[];
  /** The candidate tree's own address, as given and resolved — the always-on root-path-to-token
   * rewrite (`13` F-TEST-9's Normalisation bullet) runs against THIS root for every one of
   * `candidateRawRuns`, before any declared rule. The reference side's identical rewrite already
   * happened once, at capture time, against the reference's own root, and is baked into
   * `referenceNormalized` — it is not re-applied here. */
  readonly candidateRoot: ObservedRoot;
  /** Whether observing the candidate changed its tree, or this case wrote outside its declared
   * outputs — an observation-time fact `P3` decides, handed in rather than re-derived here. */
  readonly unclean: boolean;
}

/** Context a `RUN-130` failure needs beyond what the failing rule application already knows. */
interface NormalizeContext {
  readonly surface: SurfaceKind;
  readonly index: number;
}

function normalizeTextOrThrow(
  text: string,
  rules: readonly NormalizeRule[],
  scope: { readonly stream?: ProcessStream; readonly file?: string },
  context: NormalizeContext,
  root: ObservedRoot,
): string {
  // The root-path-to-token rewrite runs BEFORE any declared rule (`13` F-TEST-9's Normalisation
  // bullet; `normalize.ts`'s own `rewriteRootPaths` doc comment) — unconditional, never listed in a
  // declaration's own `normalize` array, and never itself subject to the erase-everything guard
  // (replacing a root-path substring with a non-empty token cannot erase a non-empty text to nothing).
  const outcome = applyNormalizeRulesToText(rewriteRootPaths(text, root), rules, scope);
  if (outcome.ok) return outcome.text;
  const { rule, detail } =
    outcome.kind === 'rule-failed'
      ? { rule: outcome.failure.rule, detail: outcome.failure.detail }
      : {
          rule: outcome.rule,
          detail: 'would erase the entire (non-empty) observation, which is refused',
        };
  throw new ForgeError('RUN-130', { surface: context.surface, index: context.index, rule, detail });
}

/**
 * `ignore-json-pointers` is the one normalise rule with a defined meaning against `library`'s own
 * STRUCTURED result (`capture.ts`'s `LibraryObservation.result.value` is already a parsed
 * `CanonicalValue`, never raw text): it removes the named pointers directly, with no parse/serialise
 * round trip needed. The other six rules — line-endings, strip-ansi, trim-trailing-whitespace,
 * sort-lines, json-canonical, and, in particular, `replace` — have no text to run against here and
 * are no-ops; a thrown error's `name`/`message` are likewise untouched.
 *
 * **Disclosed with its real consequence, not just as "untested."** An explicit, reviewed REDACTION
 * rule on a `library` case — `{rule: 'replace', pattern: 'tok-[A-Z0-9]+', replacement: 'REDACTED'}`,
 * say — has ZERO effect here: two candidate results differing only by which token they embed still
 * read `mismatch` (the comparison in `observationsEqual` sees the raw, un-redacted values), and, more
 * to the point, the UNREDACTED value is exactly what a future capture-writer (P6) would store in the
 * content-addressed, human-reviewable, NEVER-pruned capture file (`13` F-TEST-9: "Captures are never
 * pruned") — the reviewer who wrote the redaction rule, trusting the declaration they reviewed, would
 * not see the value land there unredacted unless they separately audited the capture's own bytes.
 * This is not a defect this piece's own code could have avoided: P2's already-landed `capture.ts`
 * gives `LibraryObservation` no raw-text field at all (`result` is only `{ok, value}` or `{ok,
 * error}`, both already-parsed/structured), so there is structurally nothing for a text-shaped rule
 * to apply to on this surface — confirmed by reading that type, not assumed. Neither this module's own
 * test table nor this piece's brief exercises the `library` surface's normalise combinatorics at all;
 * whether this needs a load-time refusal in P2's `declaration.ts` (refusing a `replace`/`line-endings`
 * /etc. rule declared on a `library` case outright, rather than silently accepting and then ignoring
 * it) is the orchestrator's own call when writing this piece's `Q` entry, not a code fix made here.
 */
function normalizeLibraryOrThrow(
  observation: LibraryObservation,
  rules: readonly NormalizeRule[],
  context: NormalizeContext,
): LibraryObservation {
  if (!observation.result.ok) return observation;
  let working: unknown = observation.result.value;
  for (const rule of rules) {
    if (rule.rule !== 'ignore-json-pointers') continue;
    // Reordered first (round 6's own fix, `normalize.ts`'s own `reorderPointersForSafeRemoval` doc
    // comment has the full account): two or more array-index pointers into the SAME parent array
    // must apply descending, or a later one resolves against the earlier removal's already-shifted
    // array -- this call site shares the identical fix with `normalize.ts`'s own text-path caller
    // rather than risking a second, independently-written (and independently wrong) copy.
    for (const pointer of reorderPointersForSafeRemoval(rule.pointers)) {
      working = removeJsonPointer(working, pointer);
    }
  }
  if (typeof working === 'symbol') {
    // The root pointer (`""`) was applied: the whole value is gone, which this piece treats as the
    // identical erase-everything violation a text target's non-empty-to-empty transition is, for the
    // same reason (`normalize.ts`'s own `removeJsonPointer` doc comment) -- never silently coerced to
    // `null`, which would hide a declaration that excuses its entire result from comparison.
    throw new ForgeError('RUN-130', {
      surface: context.surface,
      index: context.index,
      rule: 'ignore-json-pointers',
      detail: 'would erase the entire (non-empty) observation, which is refused',
    });
  }
  // Sound: `working` descends from the already-validated `CanonicalValue` in `observation.result.value`
  // through only RFC 6902 "remove" steps (`removeJsonPointer`), which can only narrow a value, never
  // introduce one JSON cannot represent -- and the one case that could ("the whole value is gone") was
  // excluded by the `typeof working === 'symbol'` check immediately above.
  return { surface: 'library', result: { ok: true, value: working as CanonicalValue } };
}

function normalizeObservationOrThrow(
  observation: SurfaceObservation,
  rules: readonly NormalizeRule[],
  context: NormalizeContext,
  root: ObservedRoot,
): SurfaceObservation {
  if (observation.surface === 'process') {
    const stdout =
      observation.stdout === undefined
        ? undefined
        : normalizeTextOrThrow(observation.stdout, rules, { stream: 'stdout' }, context, root);
    const stderr =
      observation.stderr === undefined
        ? undefined
        : normalizeTextOrThrow(observation.stderr, rules, { stream: 'stderr' }, context, root);
    return {
      surface: 'process',
      ...(stdout === undefined ? {} : { stdout }),
      ...(stderr === undefined ? {} : { stderr }),
      exit: observation.exit,
    };
  }
  if (observation.surface === 'file') {
    return {
      surface: 'file',
      files: observation.files.map((entry) => ({
        path: entry.path,
        content:
          entry.content.mode === 'bytes'
            ? entry.content
            : {
                mode: 'text' as const,
                text: normalizeTextOrThrow(
                  entry.content.text,
                  rules,
                  { file: entry.path },
                  context,
                  root,
                ),
              },
      })),
    };
  }
  if (observation.surface === 'http') {
    // Normalisation applies to the response BODY only — the one genuinely text-shaped target an
    // `http` observation carries, exactly as a `process` stream or a `file`'s text content is (this
    // module's own report has the full DECISION). `status` is a raw integer with no text to run a
    // rule against; `headers` are compared as exact strings, never normalised — nothing in `13`
    // F-TEST-9 names a header as a normalisation target, and the case's own `request.responseHeaders`
    // is already the deliberate, reviewed control over what a header comparison even sees. An unscoped
    // rule (no `stream`/`file` named) applies to the body; a `stream`- or `file`-scoped rule is simply
    // never in scope here, the identical inert behaviour a `file`-scoped rule already has on a
    // `process` case's own normalisation.
    return {
      surface: 'http',
      status: observation.status,
      headers: observation.headers,
      body: normalizeTextOrThrow(observation.body, rules, {}, context, root),
    };
  }
  // `library`'s own structured value is deliberately out of scope for the root-path rewrite: `13`
  // F-TEST-9's rewrite is a text operation (a root-path SUBSTRING inside a stream or a file's text),
  // and `LibraryObservation.result.value` is already parsed JSON, not text, with no raw-text field
  // anywhere in P2's own `capture.ts` type for a root path to appear in in the first place — the
  // identical, already-disclosed reason the other five text-shaped normalise rules are no-ops here
  // (see `normalizeLibraryOrThrow`'s own doc comment).
  return normalizeLibraryOrThrow(observation, rules, context);
}

function exitEqual(a: ProcessObservation['exit'], b: ProcessObservation['exit']): boolean {
  if (a.kind === 'code' && b.kind === 'code') return a.code === b.code;
  if (a.kind === 'signal' && b.kind === 'signal') return a.signal === b.signal;
  return false;
}

function fileContentEqual(a: FileObservationContent, b: FileObservationContent): boolean {
  if (a.mode === 'bytes' && b.mode === 'bytes') return a.sha256 === b.sha256;
  if (a.mode === 'text' && b.mode === 'text') return a.text === b.text;
  return false;
}

function fileObservationsEqual(a: FileObservation, b: FileObservation): boolean {
  if (a.files.length !== b.files.length) return false;
  for (let i = 0; i < a.files.length; i += 1) {
    const left = a.files[i];
    const right = b.files[i];
    if (left === undefined || right === undefined) return false; // unreachable: lengths match above
    if (left.path !== right.path || !fileContentEqual(left.content, right.content)) return false;
  }
  return true;
}

/** Whether two `http` observations' SELECTED headers are equal — key presence included, so a header
 * the declaration selected but one side never sent differs from the other side sending it (never
 * conflated with "sent as empty text", the identical reasoning `observe-types.ts`'s own
 * `RawHttpObservation` doc comment states). Compared via sorted-key canonical JSON, the identical
 * order-insensitive primitive {@link observationsEqual}'s own `library` branch already uses, rather
 * than a hand-written key-by-key loop this module would have to keep in sync with it. */
function httpHeadersEqual(
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>,
): boolean {
  return toCanonicalJson(a) === toCanonicalJson(b);
}

function httpObservationsEqual(a: HttpObservation, b: HttpObservation): boolean {
  return a.status === b.status && a.body === b.body && httpHeadersEqual(a.headers, b.headers);
}

/** A library result as a plain {@link CanonicalValue} tree, for `observationsEqual`'s own
 * canonical-JSON-string comparison (order-insensitive by construction, so this is sound to use as a
 * deep-equality primitive regardless of whether `json-canonical` itself ever ran against it). */
function libraryResultAsCanonicalValue(result: LibraryObservation['result']): CanonicalValue {
  return result.ok
    ? { ok: true, value: result.value }
    : { ok: false, error: { name: result.error.name, message: result.error.message } };
}

/**
 * Whether two (already normalised) observations of the SAME surface kind are equal. `process`/`file`
 * compare their text/bytes fields directly (plain string/sha256 equality — the normalised value IS
 * the comparison basis, `13` F-TEST-9: "Equality is decided on the full normalised content"); `library`
 * compares via canonical-JSON string equality, which is sound as a structural deep-equality check
 * regardless of whether `json-canonical` was declared (key order is never semantically significant in
 * a JSON value, so this never treats two differently-key-ordered-but-equal values as a mismatch, nor
 * the reverse).
 */
export function observationsEqual(a: SurfaceObservation, b: SurfaceObservation): boolean {
  if (a.surface !== b.surface) return false;
  if (a.surface === 'process' && b.surface === 'process') {
    return a.stdout === b.stdout && a.stderr === b.stderr && exitEqual(a.exit, b.exit);
  }
  if (a.surface === 'file' && b.surface === 'file') return fileObservationsEqual(a, b);
  if (a.surface === 'http' && b.surface === 'http') return httpObservationsEqual(a, b);
  if (a.surface === 'library' && b.surface === 'library') {
    return (
      toCanonicalJson(libraryResultAsCanonicalValue(a.result)) ===
      toCanonicalJson(libraryResultAsCanonicalValue(b.result))
    );
  }
  return false; // unreachable: `a.surface !== b.surface` already excluded this
}

function mismatchLocationOf(
  surface: SurfaceKind,
  candidate: SurfaceObservation,
  reference: SurfaceObservation,
): MismatchLocation {
  if (candidate.surface === 'process' && reference.surface === 'process') {
    if (candidate.stdout !== reference.stdout) return { surface, stream: 'stdout' };
    if (candidate.stderr !== reference.stderr) return { surface, stream: 'stderr' };
    return { surface }; // the exit differs; neither stream does.
  }
  if (candidate.surface === 'file' && reference.surface === 'file') {
    for (let i = 0; i < candidate.files.length; i += 1) {
      const left = candidate.files[i];
      const right = reference.files[i];
      if (
        left !== undefined &&
        right !== undefined &&
        !fileContentEqual(left.content, right.content)
      ) {
        return { surface, file: left.path };
      }
    }
  }
  if (candidate.surface === 'http' && reference.surface === 'http') {
    if (candidate.status !== reference.status) return { surface, httpPart: 'status' };
    if (!httpHeadersEqual(candidate.headers, reference.headers)) {
      return { surface, httpPart: 'headers' };
    }
    return { surface, httpPart: 'body' }; // the body differs; neither the status nor headers do.
  }
  return { surface };
}

/**
 * Normalises every one of `rawRuns` (against `root`'s own address — the reference's at capture time,
 * the candidate's at check time) and asks whether they agree ({@link decideStability}), via the SAME
 * per-run normalisation {@link decideCaseVerdict} itself uses — shared so a reference's stability (at
 * capture) and a candidate's stability (at check) are provably the identical probe, not two
 * implementations that could quietly drift.
 *
 * @throws {ForgeError} `RUN-130` if any run's own normalisation fails (a rule that cannot be applied,
 * or an erase-everything violation) — propagated to the caller rather than folded into `unstable`,
 * since `13` F-TEST-9's total precedence puts `error` ahead of `unstable`.
 * @throws {TypeError} if a `library` run's own result holds a value `toCanonicalJson` cannot
 * represent (`NaN`, for one) — {@link decideCaseVerdict}'s own caller converts this to a `RUN-130`
 * `error` verdict; a direct caller of this function (P6, for the reference side) must do the same.
 */
export function normalizeAndCheckStability(
  rawRuns: readonly SurfaceObservation[],
  rules: readonly NormalizeRule[],
  context: NormalizeContext,
  root: ObservedRoot,
): StabilityOutcome<SurfaceObservation> {
  const normalizedRuns = rawRuns.map((run) =>
    normalizeObservationOrThrow(run, rules, context, root),
  );
  return decideStability(normalizedRuns, observationsEqual);
}

/** Builds the `RUN-130` `ForgeError` for a comparison-time failure that is not itself a rule
 * application (a `library` value `toCanonicalJson` cannot represent) — shares `RUN-130` with
 * `normalizeTextOrThrow`/`normalizeLibraryOrThrow` because both are "a normalise rule could not be
 * applied to this case's own observation": here the rule is implicit (`json-canonical`-style
 * canonicalisation is *always* attempted for a `library` equality check, never only when declared —
 * see `observationsEqual`'s own doc comment), and `detail` is the identical content-free shape as
 * every other `RUN-130` site. */
function comparisonFailedError(context: NormalizeContext): ForgeError<'RUN-130'> {
  return new ForgeError('RUN-130', {
    surface: context.surface,
    index: context.index,
    rule: '(comparison)',
    detail: 'a library result contains a value that cannot be represented for comparison',
  });
}

/**
 * Decides one case's verdict: normalise and probe the candidate's stability, then apply `13`
 * F-TEST-9's total precedence (`error` > `unclean` > `unstable` > `mismatch` > `match`) over that
 * outcome and the `unclean` fact the caller supplies. `error` is decided first and unconditionally
 * (a rule that could not be applied to EITHER side's normalisation is a failure regardless of whether
 * the tree was also left dirty), after which `unclean` outranks `unstable`, which outranks the actual
 * content comparison.
 *
 * The whole flow — stability, the final equality check, and locating a mismatch — runs inside ONE
 * `try`/`catch`: a `library` observation whose value `toCanonicalJson` cannot represent (`NaN`, for
 * one) throws a bare `TypeError` from `observationsEqual`'s own canonical-JSON comparison, not a
 * `ForgeError`, since `observationsEqual` has no case/surface context of its own to build one with —
 * this function is the one place that DOES have that context, so it is the one place that converts
 * such a `TypeError` into the identical `RUN-130` `error` verdict every other normalise-time failure
 * already produces, rather than letting a raw crash escape past all nine of `13` F-TEST-9's verdicts.
 * A `RangeError` (from {@link decideStability}'s own "at least one run" precondition — a caller
 * passing zero candidate runs, never something a well-formed `stability.runs` 2-10 declaration
 * triggers) is deliberately NOT caught here: that is a programming error in the caller, not a
 * case-level outcome, and must keep propagating.
 */
export function decideCaseVerdict(input: CaseComparisonInput): CaseComparisonResult {
  const context: NormalizeContext = { surface: input.surface, index: input.caseIndex };
  try {
    const stability = normalizeAndCheckStability(
      input.candidateRawRuns,
      input.rules,
      context,
      input.candidateRoot,
    );
    if (!stability.stable) return input.unclean ? { verdict: 'unclean' } : { verdict: 'unstable' };
    if (input.unclean) return { verdict: 'unclean' };
    if (observationsEqual(stability.shared, input.referenceNormalized)) return { verdict: 'match' };
    return {
      verdict: 'mismatch',
      location: mismatchLocationOf(input.surface, stability.shared, input.referenceNormalized),
    };
  } catch (cause) {
    if (isForgeError(cause)) return { verdict: 'error', reason: cause.message };
    if (cause instanceof TypeError)
      return { verdict: 'error', reason: comparisonFailedError(context).message };
    throw cause;
  }
}

/** The first differing line, display-only, under `capBytes` — this piece's own worked boundary for
 * `13` F-TEST-9's "a mismatch report shows the first differing line with surrounding context under a
 * byte cap, labelled as display only and printed only without `--json`". A CLI renderer (P7's own
 * job) calls this explicitly, with the two raw normalised texts it already has in hand for human-mode
 * output; it is never reachable from {@link decideCaseVerdict}'s own result, which carries no text at
 * all (see this module's own file header). */
export interface MismatchExcerpt {
  /** 1-based line number of the first differing line. */
  readonly line: number;
  /** The line immediately before the first difference, present on both sides by definition (if
   * `line > 1`) — the "surrounding context" `13` F-TEST-9 asks for. */
  readonly context?: string;
  readonly reference: string;
  readonly candidate: string;
}

function capExcerpt(text: string, capBytes: number): string {
  return text.length <= capBytes ? text : `${text.slice(0, capBytes)}…`;
}

/**
 * Builds a display-only excerpt of the first line at which `referenceText` and `candidateText`
 * differ, each side capped at `capBytes` characters. Returns `undefined` when the two texts are
 * equal (nothing to excerpt) — a caller that already knows the case is a `mismatch` never sees that
 * branch in practice, but the type says so honestly rather than asserting it away.
 */
export function buildMismatchExcerpt(
  referenceText: string,
  candidateText: string,
  capBytes: number,
): MismatchExcerpt | undefined {
  const referenceLines = referenceText.split('\n');
  const candidateLines = candidateText.split('\n');
  const lineCount = Math.max(referenceLines.length, candidateLines.length);
  for (let i = 0; i < lineCount; i += 1) {
    const referenceLine = referenceLines[i] ?? '';
    const candidateLine = candidateLines[i] ?? '';
    if (referenceLine !== candidateLine) {
      const beforeLine = i === 0 ? undefined : referenceLines[i - 1];
      return {
        line: i + 1,
        ...(beforeLine === undefined ? {} : { context: capExcerpt(beforeLine, capBytes) }),
        reference: capExcerpt(referenceLine, capBytes),
        candidate: capExcerpt(candidateLine, capBytes),
      };
    }
  }
  return undefined;
}
