/**
 * `runParityCapture` — `forge parity capture [--name <name>]` (`PLAN-M16.md` P6, `13` F-TEST-9, Q294
 * Amendment A8). This is ORCHESTRATION, not new oracle logic: every real primitive this module wires
 * together — loading/validating a declaration (`declaration.ts`), resolving `reference.ref` to a sha
 * (`reference-ref.ts`/`reference-commit.ts`), observing the reference in a scratch worktree
 * (`observe.ts`), the stability probe and normalisation (`compare.ts`/`stability.ts`/`normalize.ts`),
 * and the capture's own on-disk shape and content-addressed name (`capture.ts`/`digest.ts`) — already
 * exists from M16 P2/P3/P4, landed and gauntleted. This module's own job: load the named
 * declaration(s), refuse one that cannot be trusted as an oracle (expired, structurally invalid, a
 * `reference.ref` that does not resolve to a real, stable commit), observe the reference side
 * `stability.runs` times, decide whether every run agrees, and write the resulting content-addressed
 * capture through the atomic, refuse-on-overwrite writer — never overwriting an existing capture,
 * never silently multiplying one.
 *
 * **Not this module's job** (see this piece's own report for the full boundary): `forge parity check`
 * (P7) — nothing here reads a capture back for comparison against a live candidate; no `ParityEvidence`
 * record of any kind.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M16.md P6
 * @see process/SPEC-QUESTIONS.md Q294 Amendment A8
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Clock } from '@forge/core';
import { SYSTEM_CLOCK } from '@forge/core';
import { ForgeError, isForgeError, type ErrorDetailsFor } from '@forge/core/errors';
import {
  ProjectPaths,
  listDirSorted,
  pathExists,
  readTextFile,
  writeNewFileAtomic,
} from '@forge/core/fs';

import {
  captureFileName,
  parseCapture,
  serialiseCapture,
  type FileObservationContent,
  type LibraryObservation,
  type ParityCapture,
  type ParityCaptureCaseEntry,
  type ProcessObservation,
  type SurfaceObservation,
} from './capture.ts';
import { recoverOrphanedParityDir } from './candidate-isolation.ts';
import { normalizeAndCheckStability, type ObservedRoot } from './compare.ts';
import {
  assertParityDeclarationValid,
  loadParityDeclarationText,
  type VetCommand,
} from './declaration.ts';
import type { ParityCase, ParityDeclaration, SurfaceKind } from './declaration-types.ts';
import { SURFACE_KINDS } from './declaration-types.ts';
import {
  assertNoConflictingContentDiscardingRules,
  assertNoReplaceRuleOnRootRewrittenSurface,
  assertNoRepeatedRuleKindInScope,
  assertParityDeclarationPatternsSafe,
} from './replace-lint.ts';
import { computeParityDeclarationDigest, type DigestFile } from './digest.ts';
import { isExpired } from './expiry.ts';
import { observeParityDeclaration } from './observe.ts';
import type { RawExit, RawFileEntryContent, RawSurfaceObservation } from './observe-types.ts';
import { probeSourcePaths } from './overlay.ts';
import { resolveReferenceCommit, type FormatValidReferenceRef } from './reference-commit.ts';
import { classifyReferenceRefFormat } from './reference-ref.ts';
import { selectCapture, type CaptureSelectionKey } from './selection.ts';

const DECLARATIONS_DIR = '.forge/parity';
const CAPTURES_DIR = '.forge/parity/captures';
const DECLARATION_SUFFIX = '.parity.yaml';

/** The real FORGE session marker, exactly the shape `GateCommandContext.marker`/`AdrCommandContext.marker`
 * already give a command that needs to tell an engine-spawned session from a person's own shell (`10`
 * §10.3 rule 6) — read once by the CLI dispatcher from `realEnvSnapshot()` and passed down here, never
 * read ambiently from `process.env` inside this module (`QUALITY-BAR.md` R10). */
export interface ParityCaptureMarker {
  readonly runId: string;
  readonly stepId?: string;
  readonly agentId?: string;
}

/** `runParityCapture`'s own inputs. `vet` defaults to the engine's real `vetStoredCommand` (via
 * `declaration.ts`'s own default) and is this module's one test seam, matching `loadParityDeclaration`'s
 * own `VetCommand` parameter. */
export interface RunParityCaptureOptions {
  readonly projectRoot: string;
  /** Omitted means every declaration (`13` F-TEST-9). */
  readonly name?: string;
  /** Defaults to `SYSTEM_CLOCK`; a test injects its own (`QUALITY-BAR.md` R10). */
  readonly clock?: Clock;
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
  /** Present whenever `FORGE_RUN_ID` is set in the real environment, whatever it names — presence
   * alone is the whole test (`13` F-TEST-9: "refuses whenever the FORGE session marker `FORGE_RUN_ID`
   * is present, whichever run it names"). */
  readonly marker?: ParityCaptureMarker;
  readonly vet?: VetCommand;
}

/** One declaration's own outcome in the `--json` envelope's `captures` list: its name, and the
 * content-addressed file that now backs it — whether this invocation wrote that file or found it
 * already there, byte-identical (`13` F-TEST-9's own capture bullet: "capturing identical behaviour
 * again is a no-op"). The exact field list is this piece's own DECISION over the plan's own Mandate
 * text, `{v:1, captured, unchanged, captures:[…]}` — see this piece's report. */
export interface ParityCaptureResultEntry {
  readonly name: string;
  readonly file: string;
}

/** `runParityCapture`'s own plain result — the CLI dispatcher (`bin.ts`) adds the envelope's `v: 1`
 * when printing `--json`, mirroring `gateCheck`/`gateApprove`'s own "the command returns plain data;
 * the dispatcher adds the envelope" split. */
export interface RunParityCaptureResult {
  readonly captured: number;
  readonly unchanged: number;
  readonly captures: readonly ParityCaptureResultEntry[];
}

/** `<os>-<arch>` as THIS runtime reports it (`13` F-TEST-9: "`platform` is... `<os>-<arch>` as the
 * harness's own runtime reports them"). Read directly from `process.platform`/`process.arch`, not
 * injected: this is a hardware/OS fact the harness is specifically defined to report honestly, the
 * identical ambient read `observe.ts`'s own win32 guard already makes for the identical reason
 * (`QUALITY-BAR.md` R10 bans a *determinism hazard* such as the clock or randomness, not a real,
 * stable fact about the host the spec defines the stored value to BE). */
function platformId(): string {
  return `${process.platform}-${process.arch}`;
}

function sortedUnique(values: Iterable<string>): readonly string[] {
  return [...new Set(values)].sort();
}

/** Reads one byte source under `projectRoot`'s own `.forge/parity/` for the declaration digest —
 * functionally identical to `observe.ts`'s own private `readOverlaySourceBytes` (same `RUN-128` on
 * any failure: "the overlay source... could not be read", `13` F-TEST-9), reimplemented here because
 * that function is not exported (see this piece's own report — a DECISION, not an oversight). */
async function readDigestFileBytes(projectRoot: string, relativePath: string): Promise<Uint8Array> {
  try {
    return await readFile(path.join(projectRoot, relativePath));
  } catch (cause) {
    throw new ForgeError('RUN-128', { path: relativePath }, { cause });
  }
}

/** Every overlay source (`inputs[].from`, any surface) and every `library` surface's probe path
 * (`overlay.ts`'s own `probeSourcePaths`, applied to that surface's `run` and `setup` lines — the
 * identical convention `observe.ts`'s own private `librarySurfaceProbePaths` uses, reimplemented here
 * for the same reason `readDigestFileBytes` is), deduplicated and read, in sorted order
 * (`QUALITY-BAR.md` R10) — the two file lists `computeParityDeclarationDigest` binds the digest to
 * (`digest.ts`: "content hashes of the files it overlays... bytes of the probes it names").
 */
async function gatherDigestFiles(
  projectRoot: string,
  declaration: ParityDeclaration,
): Promise<{ readonly overlays: readonly DigestFile[]; readonly probes: readonly DigestFile[] }> {
  const overlayPaths = new Set<string>();
  const probePaths = new Set<string>();
  for (const kind of SURFACE_KINDS) {
    const surface = declaration.surfaces[kind];
    if (surface === undefined) continue;
    for (const parityCase of surface.cases) {
      for (const input of parityCase.inputs ?? []) overlayPaths.add(input.from);
    }
    if (kind === 'library') {
      for (const probePath of probeSourcePaths(surface.run)) probePaths.add(probePath);
      for (const setupLine of surface.setup ?? []) {
        for (const probePath of probeSourcePaths(setupLine)) probePaths.add(probePath);
      }
    }
  }
  const overlays = await Promise.all(
    sortedUnique(overlayPaths).map(async (relativePath): Promise<DigestFile> => ({
      path: relativePath,
      bytes: await readDigestFileBytes(projectRoot, relativePath),
    })),
  );
  const probes = await Promise.all(
    sortedUnique(probePaths).map(async (relativePath): Promise<DigestFile> => ({
      path: relativePath,
      bytes: await readDigestFileBytes(projectRoot, relativePath),
    })),
  );
  return { overlays, probes };
}

/** Every `.forge/parity/<name>.parity.yaml` declaration name under `projectRoot`, sorted
 * (`QUALITY-BAR.md` R10). `[]`, never a thrown `RUN-034`, when `.forge/parity/` does not exist at all
 * yet — an ordinary, expected state for a project with no declarations authored (`listDirSorted`
 * itself throws on a missing directory; this is this module's own DECISION to treat "no directory" and
 * "an empty directory" identically, both meaning "nothing to capture"). */
async function listDeclarationNames(paths: ProjectPaths): Promise<readonly string[]> {
  const dir = paths.resolveWithin(DECLARATIONS_DIR);
  if (!(await pathExists(dir))) return [];
  const entries = await listDirSorted(dir);
  return entries
    .filter((entry) => entry.endsWith(DECLARATION_SUFFIX))
    .map((entry) => entry.slice(0, -DECLARATION_SUFFIX.length));
}

/** Every existing capture under `.forge/parity/captures/`, parsed (`[]` when the directory does not
 * exist yet, the identical "no directory means nothing captured yet" reading `listDeclarationNames`
 * takes). A capture file that fails `parseCapture` (corrupt, or not canonical) is skipped for THIS
 * command's own selection purposes rather than refusing the whole invocation over it — a DECISION
 * (see this piece's report): a pre-existing, already-broken capture is `invalid` regardless of
 * anything this command does with it, and `forge parity capture`'s own job is writing a new, correct
 * one, never auditing the rest of the corpus (that is `forge parity check`'s, P7, separately).
 *
 * **Exported as of M16 P7**, a narrow, additive exception to "do not edit a landed piece's own
 * file" (that piece's own brief, section 2): `forge parity check` (`check-command.ts`) needs this
 * identical "list and parse every capture file" logic to build its own `selectCapture` candidate
 * list, and P2's own `capture.ts` already owns the real per-file parser (`parseCapture`) this
 * function is a directory-listing wrapper over — reimplementing that wrapper a third time, rather
 * than reusing the one P6 already wrote, is exactly the duplication `PLAN-M16.md` P7's own brief
 * names this export to avoid. No other change to this file. */
export async function listExistingCaptures(paths: ProjectPaths): Promise<readonly ParityCapture[]> {
  const dir = paths.resolveWithin(CAPTURES_DIR);
  if (!(await pathExists(dir))) return [];
  const entries = await listDirSorted(dir);
  const captures: ParityCapture[] = [];
  for (const fileName of entries) {
    if (!fileName.endsWith('.json')) continue;
    const text = await readTextFile(paths.resolveWithin(`${CAPTURES_DIR}/${fileName}`));
    const parsed = parseCapture(text, fileName);
    if (parsed.capture !== undefined) captures.push(parsed.capture);
  }
  return captures;
}

/** Narrows `format` (already known to be format-valid, since it was computed from a declaration that
 * already passed `loadParityDeclarationText`'s own `classifyReferenceRefFormat` check) to
 * `FormatValidReferenceRef` — `resolveReferenceCommit`'s own required input shape. The `invalid`
 * branch is unreachable by construction (the same class of "already checked, re-derived for a typed
 * parameter" case `observe.ts`'s own `composeArgs` re-check documents as unreachable), and is reported
 * the identical way: a thrown internal error, never a silent cast. */
function toFormatValidReferenceRef(
  format: Awaited<ReturnType<typeof classifyReferenceRefFormat>>,
): FormatValidReferenceRef {
  if (format.kind === 'invalid') {
    throw new Error(
      `unreachable: reference.ref's format was already accepted by loadParityDeclarationText, but ` +
        `re-classifying it here returned "invalid" (${format.reason}). This can only mean the ref text ` +
        `changed between the two calls, which this module never does.`,
    );
  }
  return format;
}

function caseKey(surface: SurfaceKind, index: number): string {
  return `${surface}:${String(index)}`;
}

function toStoredExit(exit: RawExit): ProcessObservation['exit'] {
  return exit.kind === 'code'
    ? { kind: 'code', code: exit.code }
    : { kind: 'signal', signal: exit.signal };
}

function toStoredLibraryResult(
  result: Extract<RawSurfaceObservation, { readonly surface: 'library' }>['result'],
): LibraryObservation['result'] {
  return result.ok
    ? { ok: true, value: result.value }
    : { ok: false, error: { name: result.error.name, message: result.error.message } };
}

/** Converts one raw declared `file` output's content (`observe-types.ts`'s own `RawFileEntryContent`)
 * to the capture's own stored shape (`capture.ts`'s `FileObservationContent`). The caller
 * (`assertNoAbsentFileContent`, run on every raw run before this is ever reached) has already refused
 * an `absent` entry with `RUN-138`: the committed capture format (P2's own `capture.ts`, not this
 * piece's to change) has no way to represent "this output never existed" at all, distinctly from an
 * empty one, so `absent` reaching this function would be this module's own bug, not a user-facing
 * case — reported the same "unreachable, thrown" way as `toFormatValidReferenceRef` above. */
function toStoredFileContent(content: RawFileEntryContent): FileObservationContent {
  if (content.mode === 'text') return { mode: 'text', text: content.text };
  if (content.mode === 'bytes') return { mode: 'bytes', sha256: content.sha256 };
  throw new Error(
    'unreachable: an "absent" declared output reached toStoredFileContent; ' +
      'assertNoAbsentFileContent should have refused it (RUN-138) first.',
  );
}

function toStoredObservation(raw: RawSurfaceObservation): SurfaceObservation {
  if (raw.surface === 'process') {
    return {
      surface: 'process',
      ...(raw.stdout === undefined ? {} : { stdout: raw.stdout.text }),
      ...(raw.stderr === undefined ? {} : { stderr: raw.stderr.text }),
      exit: toStoredExit(raw.exit),
    };
  }
  if (raw.surface === 'library') {
    return { surface: 'library', result: toStoredLibraryResult(raw.result) };
  }
  if (raw.surface === 'http') {
    return { surface: 'http', status: raw.status, headers: raw.headers, body: raw.body.text };
  }
  return {
    surface: 'file',
    files: raw.files.map((entry) => ({
      path: entry.path,
      content: toStoredFileContent(entry.content),
    })),
  };
}

/** `13` F-TEST-9: "a reference that did not do what was expected is not an oracle either" — capture
 * refuses a case whose reference run exits with a code other than its declared `expect` (default 0,
 * `declaration-types.ts`'s own `ExpectedExit` doc comment: a number means that exit code, `'empty'`
 * means only "do not refuse this case for being empty", never a different default exit code), and a
 * case whose entire observation is empty unless it declares `expect: empty`.
 *
 * **Scope, a DECISION (see this piece's report).** The exit-code check applies to `process` and
 * `library` surfaces, whose raw observation type actually carries an exit fact
 * (`declaration-types.ts`'s own `ExpectedExit` doc comment names exactly these two); a `file` surface's
 * raw observation (`observe-types.ts`'s `RawFileObservation`) carries no exit code at all, so an
 * `expect` declared on a `file` case's exit meaning is silently unenforceable here and is not — see
 * this piece's own disclosed gap. The empty-observation check applies to `process` surfaces only
 * (every observed stream being the empty string): `library`'s own protocol always emits exactly one
 * non-empty JSON object on stdout (so the check could never fire there), and "empty" has no
 * unambiguous meaning for a `file` surface's declared outputs once a genuinely absent one is already
 * refused on its own, more specific terms (`RUN-138`, below).
 */
function assertCaseBehavedAsDeclared(
  file: string,
  surface: SurfaceKind,
  index: number,
  parityCase: ParityCase,
  raw: RawSurfaceObservation,
): void {
  const expect = parityCase.expect;
  const expectedExitCode = typeof expect === 'number' ? expect : 0;
  const exit: RawExit | undefined =
    raw.surface === 'process' ? raw.exit : raw.surface === 'library' ? raw.process.exit : undefined;
  if (exit !== undefined) {
    if (exit.kind === 'signal') {
      throw new ForgeError('RUN-137', {
        file,
        surface,
        index,
        detail: `the reference run ended by signal "${exit.signal}", not its declared "expect" exit ${String(expectedExitCode)}`,
      });
    }
    if (exit.code !== expectedExitCode) {
      throw new ForgeError('RUN-137', {
        file,
        surface,
        index,
        detail: `the reference run exited ${String(exit.code)}, not its declared "expect" exit ${String(expectedExitCode)}`,
      });
    }
  }
  if (raw.surface === 'process' && expect !== 'empty') {
    const stdoutEmpty = raw.stdout === undefined || raw.stdout.text === '';
    const stderrEmpty = raw.stderr === undefined || raw.stderr.text === '';
    if (stdoutEmpty && stderrEmpty) {
      throw new ForgeError('RUN-137', {
        file,
        surface,
        index,
        detail:
          'the reference run produced an entirely empty observation (no stdout or stderr) and the ' +
          'case does not declare "expect: empty"',
      });
    }
  }
}

/** `13` F-TEST-9's `file` surface stores an output's text or (in `bytes` mode) its sha256 alone — the
 * committed capture format has no third shape for "this declared output never existed" at all
 * (`observe-types.ts`'s own `RawFileEntryContent` DECISION note: "absent" is a real, distinct fact,
 * never conflated with "wrote zero bytes"). A DECISION, not a transcription (see this piece's own
 * report): since the capture format genuinely cannot represent it, this refuses the case outright
 * rather than silently storing something dishonest (an empty string or hash, which would read as a
 * real, comparable "wrote nothing" fact the reference never produced).
 */
function assertNoAbsentFileContent(
  file: string,
  surface: SurfaceKind,
  index: number,
  raw: RawSurfaceObservation,
): void {
  if (raw.surface !== 'file') return;
  for (const entry of raw.files) {
    if (entry.content.mode === 'absent') {
      throw new ForgeError('RUN-138', { file, surface, index, path: entry.path });
    }
  }
}

/** The largest `stability.runs` any declared surface asks for, or 0 when the declaration has no
 * surface at all (an empty `cases: []` capture then results — `nothing-compared` is explicitly
 * deferred to `forge parity check`/P7, `declaration.ts`'s own doc comment; see this piece's own
 * disclosed gap). */
function maxStabilityRuns(declaration: ParityDeclaration): number {
  const runs = SURFACE_KINDS.map((kind) => declaration.surfaces[kind]?.stability.runs).filter(
    (value): value is number => value !== undefined,
  );
  return runs.length === 0 ? 0 : Math.max(...runs);
}

interface CaptureOneDeclarationArgs {
  readonly paths: ProjectPaths;
  readonly projectRoot: string;
  readonly file: string;
  readonly name: string;
  readonly clock: Clock;
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
  readonly vet: VetCommand | undefined;
  readonly existingCaptures: readonly ParityCapture[];
}

type CaptureOneDeclarationOutcome =
  | { readonly kind: 'captured'; readonly name: string; readonly file: string }
  | { readonly kind: 'unchanged'; readonly name: string; readonly file: string };

/** The full per-declaration pipeline: load, validate, check expiry, resolve the reference, observe it
 * `stability.runs` times per surface, decide each case's stable normalised value, and write (or
 * no-op, or refuse) the resulting capture. See this module's own file header for the full boundary and
 * this piece's report for every refusal's own code. */
async function captureOneDeclaration(
  args: CaptureOneDeclarationArgs,
): Promise<CaptureOneDeclarationOutcome> {
  const { paths, projectRoot, file, name, clock, parentEnv, vet, existingCaptures } = args;

  const yamlText = await readTextFile(
    paths.resolveWithin(`${DECLARATIONS_DIR}/${name}${DECLARATION_SUFFIX}`),
  );
  const loaded = await loadParityDeclarationText(yamlText, file, projectRoot, vet);
  const declaration = assertParityDeclarationValid(loaded, file);
  // `specs/22` M17 P14: these four checks (`CFG-511`/`512`/`513`/`516`) were built and gauntleted by
  // M16 P4 but never wired into either real parity command (this piece's own report has the full
  // account) -- a genuinely dangerous declaration shape was never actually refused by a real
  // `forge parity capture` run. Run in this fixed order so the FIRST hazard found is always the one
  // reported, never a later one that happens to be cheaper to detect.
  assertParityDeclarationPatternsSafe(declaration);
  assertNoConflictingContentDiscardingRules(declaration);
  assertNoRepeatedRuleKindInScope(declaration);
  assertNoReplaceRuleOnRootRewrittenSurface(declaration);

  const today = clock.now().slice(0, 10);
  if (isExpired(declaration.expires, clock)) {
    throw new ForgeError('CFG-515', {
      file,
      detail: `its own "expires" date (${declaration.expires}) has been reached (today is ${today} UTC)`,
    });
  }
  for (const entry of declaration.unobservable) {
    if (isExpired(entry.expiry, clock)) {
      throw new ForgeError('CFG-515', {
        file,
        detail:
          `its "unobservable" entry for surface "${entry.surface}" has reached its own "expiry" ` +
          `(${entry.expiry}) (today is ${today} UTC)`,
      });
    }
  }

  // `specs/22` M17 P14 [#13]: a surface a human declared `unobservable` must not be observed at all
  // -- `13` F-TEST-9: "The surface's cases are not run and have no verdict." Before this fix, capture
  // passed `observeParityDeclaration` the real, unmodified declaration, which has no notion of
  // `unobservable` of its own (it runs every surface a `ParityDeclaration` names) -- so an exempt
  // surface's own case commands ran anyway, spending real process time on exactly what the
  // declaration says cannot be observed, while `forge parity check` (`check-command.ts`'s own
  // `processDeclaration`) already built this identical `observableDeclaration` variant. Mirrored here
  // rather than touching `observe.ts` itself, for the identical reason that module's own doc comment
  // gives.
  const declaredSurfaces = SURFACE_KINDS.filter((kind) => declaration.surfaces[kind] !== undefined);
  const exemptSurfaceSet = new Set(declaration.unobservable.map((entry) => entry.surface));
  const nonExemptSurfaces = declaredSurfaces.filter((kind) => !exemptSurfaceSet.has(kind));
  const observableSurfaces: Partial<
    Record<SurfaceKind, NonNullable<ParityDeclaration['surfaces'][SurfaceKind]>>
  > = {};
  for (const kind of nonExemptSurfaces) {
    const surface = declaration.surfaces[kind];
    if (surface !== undefined) observableSurfaces[kind] = surface;
  }
  const observableDeclaration: ParityDeclaration = { ...declaration, surfaces: observableSurfaces };
  // `specs/22` M17 P14: mirrors `check-command.ts`'s own `nonExemptSurfaces.length === 0` guard
  // ("nothing-compared") -- a real gap a gauntlet round found: without this, a declaration whose
  // every surface is excused silently produced and wrote an empty, trivial capture file with zero
  // diagnostic, while `check` on the identical declaration already loudly refuses it. Checked here,
  // after the identical exempt-surface bookkeeping `check-command.ts` itself computes first.
  if (nonExemptSurfaces.length === 0) {
    throw new ForgeError('CFG-517', { file });
  }

  const { overlays, probes } = await gatherDigestFiles(projectRoot, declaration);
  const digest = computeParityDeclarationDigest(declaration, overlays, probes);

  const refFormat = toFormatValidReferenceRef(
    await classifyReferenceRefFormat(declaration.reference.ref),
  );
  const resolution = await resolveReferenceCommit(projectRoot, refFormat);
  if (resolution.outcome === 'names-a-branch') {
    throw new ForgeError('CFG-514', { file, ref: declaration.reference.ref });
  }
  if (resolution.outcome === 'not-found') {
    throw new ForgeError('RUN-133', { file, ref: declaration.reference.ref });
  }
  const referenceSha = resolution.sha;

  const key: CaptureSelectionKey = { name, digest, referenceSha, platform: platformId() };
  const selection = selectCapture(existingCaptures, key);
  if (selection.outcome === 'ambiguous') {
    const existingPaths = selection.captures
      .map((capture) => captureFileName(serialiseCapture(capture)))
      .sort();
    throw new ForgeError('RUN-135', {
      file,
      path: `${String(existingPaths.length)} existing captures already conflict under this key (${existingPaths.join(', ')})`,
    });
  }

  const runs = maxStabilityRuns(observableDeclaration);
  const rawRunsByCase = new Map<string, RawSurfaceObservation[]>();
  let referenceRoot: ObservedRoot | undefined;

  for (let round = 1; round <= runs; round += 1) {
    const observation = await observeParityDeclaration({
      side: 'reference',
      declaration: observableDeclaration,
      projectRoot,
      referenceSha,
      parentEnv,
    });
    referenceRoot = observation.root;
    for (const caseResult of observation.cases) {
      if (caseResult.result.outcome === 'failed') {
        throw caseResult.result.failure.error;
      }
      const surfaceDeclaration = declaration.surfaces[caseResult.surface];
      if (surfaceDeclaration === undefined) continue; // unreachable: observe only emits declared surfaces.
      if (round > surfaceDeclaration.stability.runs) continue; // this surface's own quota is already met.

      const parityCase = surfaceDeclaration.cases[caseResult.caseIndex];
      if (parityCase === undefined) continue; // unreachable: observe only emits declared cases.

      const raw = caseResult.result.observation;
      assertCaseBehavedAsDeclared(file, caseResult.surface, caseResult.caseIndex, parityCase, raw);
      assertNoAbsentFileContent(file, caseResult.surface, caseResult.caseIndex, raw);

      const key2 = caseKey(caseResult.surface, caseResult.caseIndex);
      const list = rawRunsByCase.get(key2) ?? [];
      list.push(raw);
      rawRunsByCase.set(key2, list);
    }
  }

  const cases: ParityCaptureCaseEntry[] = [];
  for (const kind of nonExemptSurfaces) {
    const surface = declaration.surfaces[kind];
    if (surface === undefined) continue; // unreachable: kind came from declaredSurfaces
    for (let index = 0; index < surface.cases.length; index += 1) {
      const parityCase = surface.cases[index];
      if (parityCase === undefined) continue;
      const rawRuns = rawRunsByCase.get(caseKey(kind, index)) ?? [];
      const storedRuns = rawRuns.map((raw) => toStoredObservation(raw));
      if (referenceRoot === undefined) {
        // unreachable: `rawRuns` is non-empty only once at least one round of `observeParityDeclaration`
        // ran, which always assigns `referenceRoot` first.
        throw new Error('unreachable: a case has raw runs but referenceRoot was never set.');
      }
      const stability = normalizeAndCheckStability(
        storedRuns,
        parityCase.normalize ?? [],
        { surface: kind, index },
        referenceRoot,
      );
      if (!stability.stable) {
        throw new ForgeError('RUN-134', { file, surface: kind, index });
      }
      cases.push({ surface: kind, caseIndex: index, observation: stability.shared });
    }
  }

  const capture: ParityCapture = {
    name,
    digest,
    reference: { ref: declaration.reference.ref, sha: referenceSha },
    platform: platformId(),
    cases,
  };
  const canonicalBytes = serialiseCapture(capture);
  const fileName = captureFileName(canonicalBytes);

  if (selection.outcome === 'selected') {
    const existingBytes = serialiseCapture(selection.capture);
    if (existingBytes === canonicalBytes) {
      return { kind: 'unchanged', name, file: fileName };
    }
    throw new ForgeError('RUN-135', {
      file,
      path: `.forge/parity/captures/${captureFileName(existingBytes)}`,
    });
  }

  await writeNewFileAtomic(paths.resolveWithin(`${CAPTURES_DIR}/${fileName}`), canonicalBytes);
  return { kind: 'captured', name, file: fileName };
}

/**
 * Re-throws `cause` with `partial` (this invocation's own progress so far — every declaration
 * already captured or found unchanged, before the one that just failed) folded into its `details`,
 * so a caller that catches a mid-run refusal can tell "nothing happened yet" from "N declarations
 * already landed" without a separate `.forge/parity/captures/` listing — round 2's own finding: the
 * design (fail-fast, already-written captures stay written) was already correct, but a thrown error
 * naming only the failing declaration gave a catcher no way to learn that fact.
 *
 * The rendered `message` is provably unchanged: every code's own template reads only its own named
 * fields (`codes.ts`), never an unlisted one, so adding `partial` changes nothing a human reads,
 * only what a catcher can read back programmatically via `.details.partial`. The original error is
 * preserved as `cause`, never discarded. Anything that is not a `ForgeError` (a programming-error
 * `Error`, one of this module's own "unreachable" throws) is returned unchanged — `partial` is a
 * detail of a CODED refusal, not of a crash.
 */
function withPartialProgress(cause: unknown, partial: RunParityCaptureResult): unknown {
  if (!isForgeError(cause)) return cause;
  const details = { ...cause.details, partial };
  // Sound for the identical reason `ForgeError.fromJSON` (`@forge/core/errors/forge-error.ts`) casts
  // the same way when reviving a generically-typed `(code, details)` pair: `cause.code` is already a
  // real, declared `ForgeErrorCode` (branded, so `isForgeError` above already proved it), and
  // `details` carries every field the original error's own details did, `partial` only added on top.
  // Via `unknown` first (as `fromJSON`'s own identical cast does not need to: there, the static type
  // going in is already the wide `object`, not this function's own narrower `ErrorDetails &
  // {partial}`, which is why only this call site needs the extra step) — `tsc` itself refuses the
  // direct cast as "insufficient overlap" against the 200+-member details union, a compiler
  // limitation on a cast this module's own narrowed, runtime-proven inputs make sound regardless.
  return new ForgeError(cause.code, details as unknown as ErrorDetailsFor<typeof cause.code>, {
    cause,
  });
}

/**
 * `forge parity capture`'s own public entry point. See this module's own file header for the full
 * contract and boundary.
 *
 * @throws {ForgeError} `RUN-136` if `options.marker` is present (`FORGE_RUN_ID` was set), before any
 * declaration is even listed.
 * @throws {ForgeError} `RUN-132` if `options.name` is given and matches no declaration.
 * @throws {ForgeError} `CFG-510` (reused from `declaration.ts`) if a selected declaration is
 * structurally invalid or vetting refuses one of its commands.
 * @throws {ForgeError} `CFG-514` if `reference.ref` names a real branch.
 * @throws {ForgeError} `CFG-515` if the declaration, or one of its `unobservable` entries, has expired.
 * @throws {ForgeError} `RUN-133` if `reference.ref` is well-formed but resolves to no real commit.
 * @throws {ForgeError} `RUN-134` if a case's reference observation is unstable across its own
 * `stability.runs` repetitions.
 * @throws {ForgeError} `RUN-135` if a capture under the same selection key already exists and differs
 * (or the existing captures under that key are already mutually ambiguous).
 * @throws {ForgeError} `RUN-137` if a case's reference run did not behave as its own `expect` declares.
 * @throws {ForgeError} `RUN-138` if a declared `file` output never materialises in the reference
 * observation (a capture cannot represent an absent file distinctly from an empty one).
 *
 * When `options.name` is omitted (or names more than the one declaration that fails) and an earlier
 * declaration, in sorted-name order, was already captured or found unchanged before a later one
 * refuses, every thrown error above carries that progress on `.details.partial` (this function's own
 * `RunParityCaptureResult` shape, `{captured, unchanged, captures}`) — see
 * {@link withPartialProgress}. Processing is fail-fast, not transactional: a capture already written
 * for an earlier declaration is never undone by a later one's refusal.
 */
export async function runParityCapture(
  options: RunParityCaptureOptions,
): Promise<RunParityCaptureResult> {
  // `specs/22` M17 P14: recovers a `.forge/parity/` a prior, now-dead invocation left renamed away
  // (a `SIGKILL`, a host power loss) -- `candidate-isolation.ts`'s own `recoverOrphanedParityDir` doc
  // comment has the full account of why this is decidable with no process-liveness check. Runs first,
  // unconditionally, before even the `FORGE_RUN_ID` refusal below: recovery is cheap, idempotent and
  // safe regardless of what this invocation goes on to do.
  await recoverOrphanedParityDir(options.projectRoot);
  if (options.marker !== undefined) {
    throw new ForgeError('RUN-136', { runId: options.marker.runId });
  }

  const paths = new ProjectPaths(options.projectRoot);
  const clock = options.clock ?? SYSTEM_CLOCK;
  const existingNames = await listDeclarationNames(paths);

  let selectedNames: readonly string[];
  if (options.name === undefined) {
    selectedNames = existingNames;
  } else {
    if (!existingNames.includes(options.name)) {
      throw new ForgeError('RUN-132', {
        name: options.name,
        detail:
          existingNames.length === 0
            ? 'no declarations exist under ".forge/parity/" yet'
            : `existing declarations: ${existingNames.join(', ')}`,
      });
    }
    selectedNames = [options.name];
  }

  const existingCaptures = await listExistingCaptures(paths);
  const entries: ParityCaptureResultEntry[] = [];
  let captured = 0;
  let unchanged = 0;

  for (const name of selectedNames) {
    let outcome: CaptureOneDeclarationOutcome;
    try {
      outcome = await captureOneDeclaration({
        paths,
        projectRoot: options.projectRoot,
        file: `${DECLARATIONS_DIR}/${name}${DECLARATION_SUFFIX}`,
        name,
        clock,
        parentEnv: options.parentEnv,
        vet: options.vet,
        existingCaptures,
      });
    } catch (cause) {
      throw withPartialProgress(cause, { captured, unchanged, captures: entries });
    }
    if (outcome.kind === 'captured') captured += 1;
    else unchanged += 1;
    entries.push({ name: outcome.name, file: outcome.file });
  }

  return { captured, unchanged, captures: entries };
}
