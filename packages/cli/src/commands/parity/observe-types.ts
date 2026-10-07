/**
 * The raw, un-normalised observation types this piece (`PLAN-M16.md` P3) produces — the contract P4
 * (normalise/compare), P6 (`forge parity capture`) and P7 (`forge parity check`) all consume. Nothing
 * here decides a verdict, and nothing here is normalised: `observe.ts`'s own entry point hands a
 * caller exactly what a case's real run produced, once, and the caller (P4) is the one that calls it
 * `stability.runs` times and compares the results.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M16.md P3
 * @see process/SPEC-QUESTIONS.md Q294 Decision 7
 */
import type { ForgeError } from '@forge/core/errors';

import type { CanonicalValue } from './canonical-json.ts';
import type { SurfaceKind } from './declaration-types.ts';

/**
 * One stream's raw content, side by side with its lossy-decoded string: `bytes` is exactly what the
 * process wrote (via `runConfinedCommand`'s own `preserveRawOutput` option — no final-newline
 * stripping, no replacement-character decoding already done to it before this module ever sees it);
 * `text` is the identical lossy decode `runConfinedCommand`'s own DEFAULT callers already get. Both
 * are kept because a caller that wants to refuse a lossy UTF-8 decode needs the BYTES to decide that
 * correctly (`text` already contains U+FFFD for either a real one or a decoding error, and the two
 * are indistinguishable once collapsed into a string — `13` F-TEST-9, Q294 Decision 7).
 */
export interface RawStream {
  readonly bytes: Uint8Array;
  readonly text: string;
}

/** How a process ended: a numeric exit code, or the signal that ended it when there was no code
 * (`13` F-TEST-9: "or, where a signal ended the process... that signal"). Never both. */
export type RawExit =
  | { readonly kind: 'code'; readonly code: number }
  | { readonly kind: 'signal'; readonly signal: string };

/**
 * A `process` surface's raw observation: each stream the surface's own `streams` list observes
 * (absent entirely when unlisted — `13` F-TEST-9: "an unlisted stream is unobserved", the identical
 * optional shape `capture.ts`'s own `ProcessObservation` already gives the stored form), and the
 * real exit. A `library` surface's embedded process observation (see {@link RawLibraryObservation})
 * always has both: load time refuses a `streams` key on a `library` surface at all
 * (`declaration.ts`'s own `readSurface`), so there is never a subset to apply there.
 */
export interface RawProcessObservation {
  readonly surface: 'process';
  readonly stdout?: RawStream;
  readonly stderr?: RawStream;
  readonly exit: RawExit;
}

/**
 * One declared `file` output's raw content: `text` mode keeps the bytes AND the lossy decode (the
 * identical reason {@link RawStream} keeps both); `bytes` mode keeps only the sha256, per `13`
 * F-TEST-9 ("only its sha256 is observed and stored, never its content") — there is no raw/decoded
 * split to make for a mode that never reads the content at all.
 *
 * `absent` is this piece's own DECISION, not a transcription: the spec names what a `file` surface
 * stores for an output that exists, and says nothing about a case that simply never writes one of its
 * own declared outputs at all (a real, ordinary possibility — an error path that produces no file, for
 * one). Refusing the case outright for a missing file would be inventing a failure the spec never
 * names; silently treating it as empty content would conflate "wrote zero bytes" with "wrote
 * nothing at all", two genuinely different, comparable facts. `absent` keeps the real fact, on
 * either mode, and lets P4 decide whether two sides agreeing on absence is a `match`.
 */
export type RawFileEntryContent =
  | { readonly mode: 'text'; readonly bytes: Uint8Array; readonly text: string }
  | { readonly mode: 'bytes'; readonly sha256: string }
  | { readonly mode: 'absent' };

/** One declared `file` output's path and its raw content (see {@link RawFileEntryContent} for the
 * three content shapes — `text`, `bytes` or `absent`). */
export interface RawFileEntry {
  readonly path: string;
  readonly content: RawFileEntryContent;
}

/** A `file` surface's raw observation: every declared output this case observed, by path, in the
 * order the declaration lists them. */
export interface RawFileObservation {
  readonly surface: 'file';
  readonly files: readonly RawFileEntry[];
}

/**
 * The library probe protocol's own "return" shape, `{"ok":true,"value":...}` (`13` F-TEST-9).
 *
 * `value`'s type is {@link CanonicalValue} (P2's own type), not `unknown`: by the time a
 * {@link RawLibraryResult} exists at all, `library-protocol.ts`'s own round-trip check has already
 * confirmed the parsed value re-serialises to the identical bytes it was parsed from, which is exactly
 * what proves it lies inside the plain-JSON universe `CanonicalValue` describes (no `function`,
 * `symbol`, `bigint`, `NaN`/`Infinity`, or `undefined` round-trips through `JSON.stringify`
 * unchanged) — reusing the type lets P4 consume this value with no further narrowing of its own.
 */
export interface RawLibraryResult {
  readonly ok: true;
  readonly value: CanonicalValue;
}

/** The library probe protocol's own "thrown error" shape, `{"ok":false,"error":{name,message}}`
 * (`13` F-TEST-9) — never a `stack`, which the protocol excludes by design because it carries host
 * paths (`library-protocol.ts`'s own closed-schema check refuses one if present). */
export interface RawLibraryError {
  readonly ok: false;
  readonly error: { readonly name: string; readonly message: string };
}

/**
 * A `library` surface's raw observation: the protocol's own one JSON object (`result`, `13`
 * F-TEST-9's library probe protocol) alongside the full raw `process` observation it rode in on
 * (`process` — the probe's own `expect`ed exit code, and its raw stdout/stderr, are still
 * meaningful: a probe that happens to also print something unexpected on stderr, or exits non-zero
 * after printing valid JSON, is a fact P4/P6 may need, and this is the one place that fact is
 * captured, never silently dropped because `result` alone looked complete).
 */
export interface RawLibraryObservation {
  readonly surface: 'library';
  readonly process: RawProcessObservation;
  readonly result: RawLibraryResult | RawLibraryError;
}

/**
 * An `http` surface's raw observation (`specs/22` M16 P8, `13` F-TEST-9: "`http` observes a
 * request/response pair"): the response status, the SELECTED response headers only (the case's own
 * `request.responseHeaders` — `declaration-types.ts`'s own `HttpRequestSpec` doc comment has the full
 * DECISION on why this is opt-in, never "every header"), and the body — kept both as raw bytes and as
 * a lossy decode (the identical {@link RawStream} shape `RawProcessObservation`'s own
 * stdout/stderr already use, and for the identical reason: a caller that wants to refuse a lossy UTF-8
 * body decode needs the BYTES to decide that correctly).
 *
 * `headers` carries only the names the case's own `request.responseHeaders` selected, each already
 * lower-cased at load (`declaration.ts`'s own `readHttpResponseHeaders`); a selected name the real
 * response never sent is simply absent as a KEY here, never a present key with an empty or sentinel
 * value — so "the header was never sent" and "the header was sent as empty text" stay two genuinely
 * different, comparable facts, the identical reasoning `RawFileEntryContent`'s own `absent` mode
 * states for a `file` surface's own missing output.
 */
export interface RawHttpObservation {
  readonly surface: 'http';
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: RawStream;
}

/** The raw observation of one case, discriminated by surface. */
export type RawSurfaceObservation =
  RawProcessObservation | RawFileObservation | RawLibraryObservation | RawHttpObservation;

/** One path's state in a tree-cleanliness snapshot (`13` F-TEST-9's unclean-detection bullet):
 * `status` is the raw two-character code `git status --porcelain=v1` printed for it, and `content`
 * is `absent`/`dir`/`link:<target>` for anything that is not a regular file, or the sha256 of a
 * regular file's bytes. */
export interface TreeSnapshotEntry {
  readonly path: string;
  readonly status: string;
  readonly content: string;
}

/** A cleanliness snapshot of the tree being observed (`13` F-TEST-9: "`HEAD`, plus... for every path
 * that `git status --porcelain=v1 -z --no-renames --untracked-files=all` lists, its status code and a
 * digest of its bytes"). `entries` is sorted by `path` (`QUALITY-BAR.md` R10). */
export interface TreeSnapshot {
  readonly headSha: string;
  readonly entries: readonly TreeSnapshotEntry[];
}

/** Why a case's observation could not be completed — plain data a caller can act on (`13` F-TEST-9's
 * own `error` verdict names most of these; this piece reports the FACT, never the verdict word
 * itself, which is P4's to assign — see this piece's own report). Each variant's `error` is a real,
 * registered `ForgeError` (`QUALITY-BAR.md` R2), never a bare message. */
export interface CaseObservationFailure {
  readonly error: ForgeError;
}

/** The result of observing ONE case: either a successful raw observation (plus whether the tree
 * stayed clean around it, `13` F-TEST-9's `unclean` fact — this piece exposes the fact, P4 decides
 * the verdict), or a typed failure. Exactly one of `observation`/`failure` is present. */
export type ParityCaseObservationOutcome =
  | {
      readonly outcome: 'observed';
      readonly observation: RawSurfaceObservation;
      readonly clean: boolean;
      readonly before: TreeSnapshot;
      readonly after: TreeSnapshot;
    }
  | { readonly outcome: 'failed'; readonly failure: CaseObservationFailure };

/** One case's address within a declaration: its surface and its zero-based index within that
 * surface's own `cases` list (`declaration-types.ts`'s own case-identity note). */
export interface ParityCaseAddress {
  readonly surface: SurfaceKind;
  readonly caseIndex: number;
}

/** One case's full result, addressed. The unit {@link observeParityDeclaration} (`observe.ts`)
 * returns a list of, in a fixed, sorted order (surface kind, then case index — `QUALITY-BAR.md` R10). */
export interface ParityCaseResult extends ParityCaseAddress {
  readonly result: ParityCaseObservationOutcome;
}

/** Which tree a declaration's surfaces are observed against: the reference (a scratch worktree,
 * `setup` run first) or the candidate (in place, no `setup` — `13` F-TEST-9). */
export type ObservationSide = 'reference' | 'candidate';

/**
 * The address of the ONE tree a single {@link observeParityDeclaration} call observed, both as
 * given and resolved — the raw input the always-on first step of P4's own normalisation pipeline
 * needs (`13` F-TEST-9's Normalisation bullet: "the harness rewrites each observed tree's root
 * path, both as given and as its real path, to a fixed token, so where a tree happens to live is
 * not a behaviour difference"). This piece supplies the two strings; P4 owns the rewrite itself
 * (performing it here would normalise the "raw" observation this piece's own Mandate forbids
 * touching).
 *
 * `asGiven` is the exact path string every case's command actually ran with as its cwd — for
 * `side: 'candidate'` that is `options.projectRoot` itself, unresolved; for `side: 'reference'`
 * that is the scratch worktree's own path, as `@forge/vcs`'s `createLaneWorktree` returns it
 * (already realpath-resolved AT its OWN top, `lanes.ts`'s own `resolveCwd`, but constructed by
 * joining a lane-id segment onto that, so it is a real, concrete path a case's command sees — never
 * a second, independent resolution this piece invents). `real` is `fs.realpath(asGiven)`: the
 * identical resolution a symlinked `TMPDIR` (macOS: `/var` → `/private/var`) already made load-
 * bearing elsewhere in this codebase's own worktree-identity handling, confirmed by this piece's
 * own test to differ from `asGiven` exactly when a symlink is in play, never silently left
 * unresolved.
 */
export interface ObservedRoot {
  readonly asGiven: string;
  readonly real: string;
}

/** The full result of one {@link observeParityDeclaration} call: which tree was observed (for P4's
 * own normalisation rewrite), and every case's own result. */
export interface ParityDeclarationObservation {
  readonly root: ObservedRoot;
  readonly cases: readonly ParityCaseResult[];
}
