/**
 * `runParityCheck` — `forge parity check [--name <name>] [--trusted <ref>] [--story <id>]
 * [--no-record]` (`specs/22` M16 P7, `13` F-TEST-9, `process/SPEC-QUESTIONS.md` Q294 Decisions 3-5,
 * Amendments A3/A4/A9). This is the piece that makes the whole parity oracle real end to end: before
 * anything else, the brand-new trust-anchor comparison (`trust-anchor.ts`, this piece's own); then,
 * per selected declaration, select its capture (P2's `selection.ts`), observe the CANDIDATE in place
 * (P3's `observeParityDeclaration`, `side: 'candidate'`), normalise and compare against the selected
 * capture (P4's `compare.ts`/`counting.ts`), and roll every declaration's result into one overall
 * verdict via `countParityResults` — never re-deriving that algebra here. Unless `--no-record`,
 * writes exactly one `ParityEvidence` record for the whole invocation, mirroring M15's own
 * `assembleAndWriteMutationEvidence` (`loop/test/binding-evidence.ts`): allocate an id via
 * `getSharedIdAllocator`, build the Zod-validated object, write it with `writeNewFileAtomic`.
 *
 * **Not this module's job**: `forge parity capture` (P6, landed); the per-hunk mutation engine
 * (P12/P13, a different chain); the `http` surface (P8); `G-Parity`'s own wiring into a workflow (P9).
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M16.md P7
 * @see process/SPEC-QUESTIONS.md Q294
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Clock } from '@forge/core';
import { SYSTEM_CLOCK } from '@forge/core';
import { ForgeError } from '@forge/core/errors';
import {
  ProjectPaths,
  listDirSorted,
  pathExists,
  readTextFile,
  writeNewFileAtomic,
} from '@forge/core/fs';
import { documentProblems } from '@forge/engine/dispatch';
import { definitionForType, renderArtifactPath } from '@forge/schemas';
import YAML from 'yaml';

import { getSharedIdAllocator } from '../shared.ts';
import { listExistingCaptures } from './capture-command.ts';
import {
  serialiseCapture,
  type FileObservationContent,
  type LibraryObservation,
  type ParityCapture,
  type ParityCaptureCaseEntry,
  type ProcessObservation,
  type SurfaceObservation,
} from './capture.ts';
import { emitParityCheckTelemetry, type ParityVerdictCounts } from './check-telemetry.ts';
import { decideCaseVerdict, normalizeAndCheckStability, type MismatchLocation } from './compare.ts';
import {
  countParityResults,
  CASE_VERDICT_PRECEDENCE,
  type CaseVerdict,
  type DeclarationResult,
  type DeclarationStopVerdict,
} from './counting.ts';
import { loadParityDeclarationText, type VetCommand } from './declaration.ts';
import type { ParityDeclaration, SurfaceKind } from './declaration-types.ts';
import { SURFACE_KINDS } from './declaration-types.ts';
import { computeParityDeclarationDigest, type DigestFile } from './digest.ts';
import { isExpired } from './expiry.ts';
import { observeParityDeclaration } from './observe.ts';
import type { RawExit, RawFileEntryContent, RawSurfaceObservation } from './observe-types.ts';
import { probeSourcePaths } from './overlay.ts';
import { resolveReferenceCommit } from './reference-commit.ts';
import { classifyReferenceRefFormat } from './reference-ref.ts';
import { selectCapture, type CaptureSelectionKey } from './selection.ts';
import { snapshotDigest, takeTreeSnapshot } from './tree-snapshot.ts';
import { compareTrustAnchor, resolveTrustedRef } from './trust-anchor.ts';

const DECLARATIONS_DIR = '.forge/parity';
const DECLARATION_SUFFIX = '.parity.yaml';
const PARITY_EVIDENCE_TYPE = definitionForType('ParityEvidence');

function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** `<os>-<arch>` as THIS runtime reports it, the identical ambient read `capture-command.ts`'s own
 * private `platformId` makes for the identical reason (`QUALITY-BAR.md` R10 bans a determinism
 * hazard, not a stable fact about the host the spec defines the stored value to BE) — reimplemented
 * here rather than imported since `capture-command.ts` does not export it and this piece's own brief
 * authorises exporting only `listExistingCaptures` from that module. */
function platformId(): string {
  return `${process.platform}-${process.arch}`;
}

/** `forge parity check`'s own inputs. `vet`/`clock` mirror `RunParityCaptureOptions`'s identical test
 * seams. `reportsRoot` is never read from config inside this module (`QUALITY-BAR.md` R10): the CLI
 * dispatcher reads `readConfig(paths).paths.reports` once and passes it down, the identical split
 * `assembleAndWriteMutationEvidence`'s own `WriteMutationEvidenceInput.reportsRoot` already uses. */
export interface RunParityCheckOptions {
  readonly projectRoot: string;
  /** Omitted means every declaration (`13` F-TEST-9). */
  readonly name?: string;
  /** The trust anchor (`trust-anchor.ts`): a full commit sha or a `refs/`-qualified name. Omitted
   * means no comparison is made at all (`trusted: null` in the written record) — never a fallback to
   * any other ref (`PLAN-M16.md` P7's own Mandate: "do not add a fallback to it"). */
  readonly trusted?: string;
  /** The record's own `story` and retention subject; without it the subject is the shared literal
   * `project` (Q294 Decision 5). */
  readonly story?: string;
  readonly noRecord?: boolean;
  /** Where `docs/forge/reports/` lives for THIS project (`readConfig(paths).paths.reports`, read
   * once by the CLI dispatcher — never inside this module, `QUALITY-BAR.md` R10). Required only when
   * a record will actually be written: omitted under `--no-record`, a caller need not have a valid
   * project config at all to run the check, which matters most for exactly the one caller that
   * always passes `--no-record` — `G-Parity`'s own gate check (`10` §10.3 rule 8) — never forcing a
   * config read neither it nor a `--no-record` human invocation needs. */
  readonly reportsRoot?: string;
  readonly clock?: Clock;
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
  readonly vet?: VetCommand;
  /** `specs/22` M16 P15: `process.env[FORGE_RUN_ID]` at the CLI boundary (`bin.ts`'s own dispatcher,
   * the identical `realEnvSnapshot()[FORGE_RUN_ID]` read every other telemetry-gated command already
   * takes) — `undefined` for a hand run outside any real `forge run` with no ambient marker at all.
   * Telemetry only: never used to name, gate or select anything about the check itself.
   *
   * **Corrected, round-2 gauntlet fix.** This piece's own original report claimed a
   * `CheckRun{kind:'parity'}` event "can never be emitted from an in-run `G-Parity` gate evaluation."
   * Two independent critics, via two different real repros, confirmed that claim is false. There are
   * two real paths that put a non-`undefined` value here, with two different real consequences:
   *
   * 1. **A genuine in-run `G-Parity` gate evaluation.** `runGateStep`
   *    (`@forge/engine/dispatch/steps.ts:1222`) evaluates every gate with `ctx.integrationPath` as the
   *    check's own `cwd`, never `ctx.projectRoot` (`createGateEvaluator`, `dispatch/facades.ts`) — but
   *    `ctx.commandEnv` (built by `commandEnvFor`, `run/launcher-shim.ts`) DOES carry the real run's own
   *    `FORGE_RUN_ID`, exactly as it does for every other shell command that run spawns (`run.ts`'s own
   *    comment at its `createLauncherShimOrWarn` call: "every shell command this run spawns -- command
   *    steps, GATE CHECKS, merge checks -- carries the FORGE run marker"). So `runId` here is routinely
   *    DEFINED for this path on any run whose launcher shim was created successfully — not merely
   *    possible on some rare run. The write still happens; what makes it harmless is `input.projectRoot`
   *    for it, which is `ctx.integrationPath`: the resulting event lands in the INTEGRATION WORKTREE's
   *    own `.forge/state/runs/`, a real file `forge report` never reads (it reads the real project's own
   *    log), not a prevented write. Fixing this for real means threading real-project-root awareness
   *    through the shared `runGateStep`/`createGateEvaluator` dispatch code, well past this piece's own
   *    surface — a disclosed, pre-existing, shared-dispatch-architecture gap, NOT fixed here. The
   *    identical mechanism likely also affects the pre-existing M15 `emitBindingCheckTelemetry` via
   *    `G-Verify`'s own real gate wiring — flagged by a critic, not confirmed or chased, left for a
   *    future piece to investigate.
   * 2. **A standalone, ad hoc `forge gate check <id>` (or `approve`/`waive`) invocation whose gate
   *    happens to shell out to `forge parity check`.** `gate-commands.ts`'s `evaluateFresh` runs with
   *    `ctx.projectRoot` — the REAL project root, unlike path 1 above. Before this fix, if the CALLING
   *    shell already had an ambient `FORGE_RUN_ID` (left over from an earlier `forge run` in the same
   *    terminal, or inherited from an `agent` step's own spawned shell), `commandEnvFor` only avoided
   *    ADDING the marker for this ad hoc path; it never stripped an already-ambient one, and `execa`'s
   *    own default `extendEnv: true` (`runShellCommand`, `@forge/engine/dispatch/shell.ts`) merges
   *    `{...process.env, ...env}`, so the ambient value survived into the nested check's own env
   *    regardless. A critic confirmed end to end, with a real scratch project and a real ambient
   *    `FORGE_RUN_ID`, that the nested `forge parity check` subprocess then read it as ITS OWN `runId`
   *    and wrote a real, MISATTRIBUTED `CheckRun{kind:'parity'}` event into the REAL project's own event
   *    log, under a run that never actually evaluated this check at all. **Closed by this fix**:
   *    `commandEnvFor` now strips an already-ambient `FORGE_RUN_ID` for real when its own caller passes
   *    no `runId` — see that function's own doc comment for the mechanism and the real subprocess proof.
   */
  readonly runId?: string | undefined;
}

/** One declaration's own outcome in the `--json` envelope, in the exact field order `13` F-TEST-9's
 * own check-print bullet names (`Q294` Amendment A9): `reason` only where `verdict` is not `match`. */
export interface RunParityCheckDeclarationResult {
  readonly name: string;
  readonly verdict: DeclarationStopVerdict | CaseVerdict;
  readonly reason?: string;
  readonly passing: number;
  readonly failing: number;
}

/** `forge parity check`'s own plain result (the CLI dispatcher adds the envelope's `v: 1`, the
 * identical "the command returns data; the dispatcher adds the envelope" split every other command in
 * this barrel uses) — every refusal (`--name` matches nothing, `--trusted` malformed or unresolvable)
 * is a thrown `ForgeError`, never a field of this type (`Q294` Amendment A9: "a refusal is `ok:
 * false`" is the GENERIC `{v:1,ok:false,error:{...}}` shape every `forge` command's own top-level
 * handler already renders for a thrown `ForgeError` — see this piece's own report for why that is the
 * right split rather than a bespoke refusal shape here). */
export interface RunParityCheckResult {
  readonly ok: true;
  readonly verdict: DeclarationStopVerdict | CaseVerdict;
  /** The check's OWN reason where the check itself stopped before any declaration's result could
   * count: `'no-declarations'`, or `oracle-changed: <path> (<reason>), ...` naming each differing
   * path. Absent for every other overall verdict — a per-declaration cause belongs in that
   * declaration's own `reason`, never duplicated here (`Q294` Amendment A9). */
  readonly reason?: string;
  readonly failing: number;
  readonly passing: number;
  readonly evidenceId: string | null;
  readonly declarations: readonly RunParityCheckDeclarationResult[];
}

/** `13` F-TEST-9's check contract: "it exits 0 or 1 (0 success, 1 failure)... failing is 0 only when
 * passing is at least 1" — the WHOLE exit-code rule in one place, deliberately separate from
 * {@link runParityCheck} itself (which never throws for an ordinary verdict, only for a genuine
 * refusal) so a caller can derive the exit code from a plain data value without re-deriving it from
 * `failing`/`passing` by hand at each call site (`bin.ts`'s own dispatcher, and this module's own
 * tests). */
export function parityCheckExitCode(result: RunParityCheckResult): 0 | 1 {
  return result.failing === 0 ? 0 : 1;
}

/** Every `.forge/parity/<name>.parity.yaml` declaration name under `projectRoot`, sorted
 * (`QUALITY-BAR.md` R10) — the identical "no directory means nothing declared yet" reading
 * `capture-command.ts`'s own private `listDeclarationNames` takes, reimplemented here for the same
 * reason `gatherDigestFiles` below is (this piece's brief authorises exporting only
 * `listExistingCaptures`, not every other private helper of that module). */
async function listDeclarationNames(paths: ProjectPaths): Promise<readonly string[]> {
  const dir = paths.resolveWithin(DECLARATIONS_DIR);
  if (!(await pathExists(dir))) return [];
  const entries = await listDirSorted(dir);
  return entries
    .filter((entry) => entry.endsWith(DECLARATION_SUFFIX))
    .map((entry) => entry.slice(0, -DECLARATION_SUFFIX.length));
}

/** Reads one byte source under `projectRoot`'s own `.forge/parity/` for the declaration digest —
 * functionally identical to `capture-command.ts`'s own private `readDigestFileBytes` (same `RUN-128`
 * on any failure), reimplemented here for the same reason `listDeclarationNames` above is. */
async function readDigestFileBytes(projectRoot: string, relativePath: string): Promise<Uint8Array> {
  try {
    return await readFile(path.join(projectRoot, relativePath));
  } catch (cause) {
    throw new ForgeError('RUN-128', { path: relativePath }, { cause });
  }
}

function sortedUnique(values: Iterable<string>): readonly string[] {
  return [...new Set(values)].sort();
}

/** Every overlay source and every `library` surface's probe path, the identical join
 * `computeParityDeclarationDigest` binds the digest to — mirrors `capture-command.ts`'s own private
 * `gatherDigestFiles` exactly (not exported there; this piece's brief authorises only
 * `listExistingCaptures`). */
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

/** The sha256 of a fixed, reserved marker string — never a real file's content by the same trust
 * sha256 content-addressing already rests on everywhere else in this package (`capture.ts`'s own
 * `captureFileName`, for one). Stands in for a declared `file` output the CANDIDATE never wrote at
 * all (`observe-types.ts`'s own `RawFileEntryContent` `'absent'` mode — a real, reachable fact on the
 * candidate side, unlike the reference side, which `capture-command.ts`'s own `RUN-138` refuses
 * outright before a capture is ever written, so a selected capture's own `FileObservationContent` is
 * NEVER `absent` — see this piece's own report, "the file-absence sentinel", for the full account of
 * why `compare.ts`'s own type, correctly, has no `'absent'` member to carry this through directly).
 */
const ABSENT_FILE_SENTINEL_SHA256 = sha256Hex('forge-parity/M16-P7-absent-file-sentinel/v1');

function toCandidateFileContent(content: RawFileEntryContent): FileObservationContent {
  if (content.mode === 'text') return { mode: 'text', text: content.text };
  if (content.mode === 'bytes') return { mode: 'bytes', sha256: content.sha256 };
  return { mode: 'bytes', sha256: ABSENT_FILE_SENTINEL_SHA256 };
}

function toCandidateObservation(raw: RawSurfaceObservation): SurfaceObservation {
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
      content: toCandidateFileContent(entry.content),
    })),
  };
}

/** The largest `stability.runs` any NON-EXEMPT declared surface asks for, or 0 when there is none
 * (unreachable here: a declaration with no surface that is not exempt already stops at
 * `nothing-compared` before this is ever called). Mirrors `capture-command.ts`'s own private
 * `maxStabilityRuns`, scoped to `nonExemptSurfaces` rather than every declared surface, since an
 * exempt surface's own `stability.runs` governs nothing this module ever runs. */
function maxStabilityRuns(
  declaration: ParityDeclaration,
  nonExemptSurfaces: readonly SurfaceKind[],
): number {
  const runs = nonExemptSurfaces
    .map((kind) => declaration.surfaces[kind]?.stability.runs)
    .filter((value): value is number => value !== undefined);
  return runs.length === 0 ? 0 : Math.max(...runs);
}

/** The git object the trust anchor was (or was not) checked against, plus the differing-paths text
 * when it was and disagreed — shared shape for the before- and after-case comparisons. */
interface AnchorFinding {
  readonly sha: string | null;
  readonly reason?: string;
}

async function checkTrustAnchor(
  projectRoot: string,
  trustedSha: string | undefined,
): Promise<AnchorFinding> {
  if (trustedSha === undefined) return { sha: null };
  const comparison = await compareTrustAnchor(projectRoot, trustedSha);
  if (comparison.outcome === 'clean') return { sha: trustedSha };
  const detail = comparison.differences.map((d) => `${d.path} (${d.reason})`).join(', ');
  return { sha: trustedSha, reason: `oracle-changed: ${detail}` };
}

/** The fields a {@link RunParityCheckResult}'s written `ParityEvidence` record needs for one
 * declaration, beyond its own verdict/reason/counts — every one of these is schema-REQUIRED
 * (`parity-evidence.ts`'s own `declarationEntrySchema` makes none of `digest`/`reference`/`platform`/
 * `captureDigest` optional) even for a declaration stopped before any of them could be genuinely
 * computed, so {@link UNKNOWN_RECORD_FIELDS} fills in a well-formed, honestly-labelled placeholder
 * rather than leaving the schema's own regex unsatisfied — see this piece's own report, "DECISIONS",
 * for why a sentinel is the right call here and not a schema change (out of scope) or a crash. */
interface DeclarationRecordFields {
  readonly digest: string;
  readonly referenceRef: string;
  readonly referenceSha: string;
  readonly platform: string;
  readonly captureDigest: string;
}

const UNKNOWN_RECORD_FIELDS: DeclarationRecordFields = {
  digest: '0'.repeat(64),
  referenceRef: '(unresolved)',
  referenceSha: '0'.repeat(40),
  platform: platformId(),
  captureDigest: '0'.repeat(64),
};

interface RecordCaseEntry {
  readonly surface: SurfaceKind;
  readonly caseIndex: number;
  readonly verdict: CaseVerdict;
  readonly contentHash?: string;
}

interface ProcessedDeclaration {
  readonly name: string;
  readonly result: DeclarationResult;
  readonly reason?: string;
  readonly fields: DeclarationRecordFields;
  readonly cases: readonly RecordCaseEntry[];
  readonly exemptCount: number;
}

function stopped(
  name: string,
  verdict: DeclarationStopVerdict,
  reason: string,
  fields: Partial<DeclarationRecordFields> = {},
  exemptCount = 0,
): ProcessedDeclaration {
  return {
    name,
    result: { kind: 'stopped', verdict },
    reason,
    fields: { ...UNKNOWN_RECORD_FIELDS, ...fields },
    cases: [],
    exemptCount,
  };
}

function describeMismatchLocation(location: MismatchLocation): string {
  if (location.stream !== undefined) return `its "${location.stream}" stream`;
  if (location.file !== undefined) return `its declared output "${location.file}"`;
  return 'its exit';
}

function describeCaseVerdict(entry: RecordCaseEntry): string {
  if (entry.verdict === 'mismatch') {
    return `surface "${entry.surface}" case ${String(entry.caseIndex)} differs`;
  }
  return `surface "${entry.surface}" case ${String(entry.caseIndex)} is "${entry.verdict}"`;
}

/** The declaration-level `reason` text: the first (by `13` F-TEST-9's own total precedence, then by
 * the declaration's own surface/case order) non-`match` case, named by surface and case index —
 * never the observed content (`13` F-TEST-9's information boundary; {@link describeCaseVerdict} and
 * {@link describeMismatchLocation} both carry only structural facts). `undefined` when every case
 * matched. */
function declarationReasonFromCases(
  cases: readonly RecordCaseEntry[],
  locations: ReadonlyMap<string, MismatchLocation>,
): string | undefined {
  for (const verdict of CASE_VERDICT_PRECEDENCE) {
    if (verdict === 'match') continue;
    const entry = cases.find((c) => c.verdict === verdict);
    if (entry === undefined) continue;
    const location = locations.get(caseKey(entry.surface, entry.caseIndex));
    const locationText =
      entry.verdict === 'mismatch' && location !== undefined
        ? ` on ${describeMismatchLocation(location)}`
        : '';
    return `${describeCaseVerdict(entry)}${locationText}`;
  }
  return undefined;
}

interface ProcessDeclarationArgs {
  readonly paths: ProjectPaths;
  readonly projectRoot: string;
  readonly name: string;
  readonly clock: Clock;
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
  readonly vet: VetCommand | undefined;
  readonly existingCaptures: readonly ParityCapture[];
}

/** The full per-declaration pipeline: load, validate, check expiry, compute the digest, resolve the
 * reference, select a capture, confirm the capture holds every expected case, then observe the
 * CANDIDATE `stability.runs` times per non-exempt surface and decide each case's verdict — mirroring
 * `capture-command.ts`'s own `captureOneDeclaration` pipeline order exactly (expiry before digest,
 * digest before reference resolution) so the two pieces' choices about what a stopped declaration DID
 * or did not get far enough to compute line up, rather than this piece inventing its own order. Never
 * throws for an ordinary declaration-level problem (`13` F-TEST-9's `invalid`/`expired`/`missing`/
 * `ambiguous` are all returned as data, exactly as {@link ProcessedDeclaration} and
 * `declaration.ts`'s own `ParityDeclarationValidation` already are) — a genuine programming error
 * (an "unreachable" case) still throws, since that is a bug in this module, not a fact about the
 * declaration.
 */
async function processDeclaration(args: ProcessDeclarationArgs): Promise<ProcessedDeclaration> {
  const { paths, projectRoot, name, clock, parentEnv, vet, existingCaptures } = args;
  const file = `${DECLARATIONS_DIR}/${name}${DECLARATION_SUFFIX}`;

  const yamlText = await readTextFile(paths.resolveWithin(file));
  const loaded = await loadParityDeclarationText(yamlText, file, projectRoot, vet);
  if (loaded.declaration === undefined) {
    const first = loaded.problems[0];
    const more = loaded.problems.length - 1;
    return stopped(
      name,
      'invalid',
      `${first?.message ?? 'the declaration could not be read'}${more > 0 ? ` (and ${String(more)} more problem(s))` : ''}`,
    );
  }
  const declaration = loaded.declaration;

  const today = clock.now().slice(0, 10);
  if (isExpired(declaration.expires, clock)) {
    return stopped(
      name,
      'expired',
      `its own "expires" date (${declaration.expires}) has been reached (today is ${today} UTC)`,
    );
  }
  for (const entry of declaration.unobservable) {
    if (isExpired(entry.expiry, clock)) {
      return stopped(
        name,
        'expired',
        `its "unobservable" entry for surface "${entry.surface}" has reached its own "expiry" ` +
          `(${entry.expiry}) (today is ${today} UTC)`,
      );
    }
  }

  const declaredSurfaces = SURFACE_KINDS.filter((kind) => declaration.surfaces[kind] !== undefined);
  const exemptSurfaceSet = new Set(declaration.unobservable.map((entry) => entry.surface));
  const nonExemptSurfaces = declaredSurfaces.filter((kind) => !exemptSurfaceSet.has(kind));
  const exemptSurfaceCount = declaredSurfaces.length - nonExemptSurfaces.length;
  if (nonExemptSurfaces.length === 0) {
    return stopped(
      name,
      'invalid',
      'it has no surface that is not exempt ("unobservable") -- nothing-compared',
      {},
      exemptSurfaceCount,
    );
  }

  let digest: string;
  try {
    const { overlays, probes } = await gatherDigestFiles(projectRoot, declaration);
    digest = computeParityDeclarationDigest(declaration, overlays, probes);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return stopped(
      name,
      'invalid',
      `an overlaid file or probe this declaration names could not be read while computing its ` +
        `digest: ${detail}`,
      {},
      exemptSurfaceCount,
    );
  }

  const refFormat = await classifyReferenceRefFormat(declaration.reference.ref);
  if (refFormat.kind === 'invalid') {
    // Unreachable for a declaration `loadParityDeclarationText` already accepted: its own format
    // check already ran this identical classification and would have refused it there first.
    return stopped(name, 'invalid', refFormat.reason, { digest }, exemptSurfaceCount);
  }
  const resolution = await resolveReferenceCommit(projectRoot, refFormat);
  if (resolution.outcome === 'names-a-branch') {
    return stopped(
      name,
      'invalid',
      `its reference.ref ("${declaration.reference.ref}") names a branch, which moves like HEAD ` +
        'and cannot be a stable reference',
      { digest, referenceRef: declaration.reference.ref },
      exemptSurfaceCount,
    );
  }
  if (resolution.outcome === 'not-found') {
    return stopped(
      name,
      'missing',
      `its reference.ref ("${declaration.reference.ref}") does not resolve to a commit in this ` +
        'repository',
      { digest, referenceRef: declaration.reference.ref },
      exemptSurfaceCount,
    );
  }
  const referenceSha = resolution.sha;
  const platform = platformId();
  const knownFields: DeclarationRecordFields = {
    digest,
    referenceRef: declaration.reference.ref,
    referenceSha,
    platform,
    captureDigest: UNKNOWN_RECORD_FIELDS.captureDigest,
  };

  const key: CaptureSelectionKey = { name, digest, referenceSha, platform };
  const selection = selectCapture(existingCaptures, key);
  if (selection.outcome === 'missing') {
    return stopped(
      name,
      'missing',
      `no capture exists for platform "${platform}" (declaration digest ${digest}, reference sha ` +
        `${referenceSha})`,
      knownFields,
      exemptSurfaceCount,
    );
  }
  if (selection.outcome === 'ambiguous') {
    return stopped(
      name,
      'ambiguous',
      `${String(selection.captures.length)} differing captures share this selection key`,
      knownFields,
      exemptSurfaceCount,
    );
  }
  const capture = selection.capture;
  const captureDigest = sha256Hex(serialiseCapture(capture));
  const fieldsWithCapture: DeclarationRecordFields = { ...knownFields, captureDigest };

  const captureCaseMap = new Map<string, ParityCaptureCaseEntry>();
  for (const entry of capture.cases)
    captureCaseMap.set(caseKey(entry.surface, entry.caseIndex), entry);
  for (const kind of nonExemptSurfaces) {
    const surface = declaration.surfaces[kind];
    if (surface === undefined) continue; // unreachable: kind came from declaredSurfaces
    for (let index = 0; index < surface.cases.length; index += 1) {
      if (!captureCaseMap.has(caseKey(kind, index))) {
        return stopped(
          name,
          'missing',
          `the selected capture has no entry for surface "${kind}" case ${String(index)}`,
          fieldsWithCapture,
          exemptSurfaceCount,
        );
      }
    }
  }

  // Observe the CANDIDATE, `stability.runs` times per surface, over a declaration variant that
  // carries only the non-exempt surfaces: `observeParityDeclaration` has no notion of `unobservable`
  // of its own (it runs every surface a `ParityDeclaration` names), so passing it the real,
  // unmodified declaration would run -- and spend real process time on -- an exempt surface's own
  // cases, which `13` F-TEST-9 says plainly "are not run and have no verdict". A local, in-memory
  // variant keeps that contract true without this piece touching `observe.ts` itself.
  const observableSurfaces: Partial<
    Record<SurfaceKind, NonNullable<ParityDeclaration['surfaces'][SurfaceKind]>>
  > = {};
  for (const kind of nonExemptSurfaces) {
    const surface = declaration.surfaces[kind];
    // `kind` comes from `nonExemptSurfaces`, itself filtered from `declaredSurfaces`, whose own
    // filter already proved `declaration.surfaces[kind] !== undefined` for every member -- this
    // `if` only re-narrows the type for `tsc`'s own benefit at the assignment below, never a real
    // runtime possibility this function treats as reachable.
    if (surface !== undefined) observableSurfaces[kind] = surface;
  }
  const observableDeclaration: ParityDeclaration = { ...declaration, surfaces: observableSurfaces };

  const runs = maxStabilityRuns(declaration, nonExemptSurfaces);
  const rawRunsByCase = new Map<string, RawSurfaceObservation[]>();
  const failedByCase = new Map<string, string>();
  const uncleanByCase = new Set<string>();
  let candidateRoot: Awaited<ReturnType<typeof observeParityDeclaration>>['root'] | undefined;

  for (let round = 1; round <= runs; round += 1) {
    const observation = await observeParityDeclaration({
      side: 'candidate',
      declaration: observableDeclaration,
      projectRoot,
      parentEnv,
    });
    candidateRoot = observation.root;
    for (const caseResult of observation.cases) {
      const surfaceDeclaration = declaration.surfaces[caseResult.surface];
      if (surfaceDeclaration === undefined) continue; // unreachable: observe only emits declared surfaces.
      if (round > surfaceDeclaration.stability.runs) continue; // this surface's own quota already met.
      const key2 = caseKey(caseResult.surface, caseResult.caseIndex);
      if (caseResult.result.outcome === 'failed') {
        failedByCase.set(key2, caseResult.result.failure.error.message);
        continue;
      }
      if (!caseResult.result.clean) uncleanByCase.add(key2);
      const list = rawRunsByCase.get(key2) ?? [];
      list.push(caseResult.result.observation);
      rawRunsByCase.set(key2, list);
    }
  }

  const cases: RecordCaseEntry[] = [];
  const mismatchLocations = new Map<string, MismatchLocation>();
  for (const kind of nonExemptSurfaces) {
    const surface = declaration.surfaces[kind];
    if (surface === undefined) continue; // unreachable
    for (let index = 0; index < surface.cases.length; index += 1) {
      const parityCase = surface.cases[index];
      if (parityCase === undefined) continue; // unreachable
      const key2 = caseKey(kind, index);
      const failure = failedByCase.get(key2);
      if (failure !== undefined) {
        cases.push({ surface: kind, caseIndex: index, verdict: 'error' });
        continue;
      }
      const rawRuns = rawRunsByCase.get(key2) ?? [];
      if (rawRuns.length === 0 || candidateRoot === undefined) {
        // Defensive: every case that was not marked failed above has at least one raw run once the
        // observation loop above has run at least once (runs >= 1, since a non-exempt surface with
        // no case is already `invalid` at load, per `declaration.ts`).
        cases.push({ surface: kind, caseIndex: index, verdict: 'error' });
        continue;
      }
      const storedRuns = rawRuns.map(toCandidateObservation);
      const captureEntry = captureCaseMap.get(key2);
      if (captureEntry === undefined) {
        // Unreachable: the capture-completeness check above already returned for this declaration
        // if any expected entry were missing.
        throw new Error(`unreachable: capture has no entry for ${key2} despite the earlier check`);
      }
      const comparison = decideCaseVerdict({
        surface: kind,
        caseIndex: index,
        rules: parityCase.normalize ?? [],
        referenceNormalized: captureEntry.observation,
        candidateRawRuns: storedRuns,
        candidateRoot,
        unclean: uncleanByCase.has(key2),
      });
      let contentHash: string | undefined;
      if (comparison.verdict === 'match' || comparison.verdict === 'mismatch') {
        try {
          const stability = normalizeAndCheckStability(
            storedRuns,
            parityCase.normalize ?? [],
            { surface: kind, index },
            candidateRoot,
          );
          if (stability.stable) {
            contentHash = sha256Hex(JSON.stringify(canonicalForHash(stability.shared)));
          }
        } catch {
          // `decideCaseVerdict` already computed the real verdict independently above; a
          // content hash is optional (`parity-evidence.ts`'s own schema) and simply omitted when it
          // cannot be derived the same way `decideCaseVerdict` itself would have reported `error`.
        }
      }
      if (comparison.verdict === 'mismatch') {
        mismatchLocations.set(key2, comparison.location);
      }
      cases.push({
        surface: kind,
        caseIndex: index,
        verdict: comparison.verdict,
        ...(contentHash === undefined ? {} : { contentHash }),
      });
    }
  }

  const reason = declarationReasonFromCases(cases, mismatchLocations);
  const resultCases: readonly ('exempt' | CaseVerdict)[] = [
    ...declaredSurfaces.filter((kind) => exemptSurfaceSet.has(kind)).map(() => 'exempt' as const),
    ...cases.map((entry) => entry.verdict),
  ];
  return {
    name,
    result: { kind: 'ran', cases: resultCases },
    ...(reason === undefined ? {} : { reason }),
    fields: fieldsWithCapture,
    cases,
    exemptCount: exemptSurfaceCount,
  };
}

/** A library result, or a process/file observation's own stable value, as a plain JSON-serialisable
 * tree for {@link processDeclaration}'s own OPTIONAL content-hash computation — never stored or
 * printed itself (`JSON.stringify` of this is hashed, immediately, and discarded). */
function canonicalForHash(value: SurfaceObservation): unknown {
  return value;
}

function toOracleChanged(declaration: ProcessedDeclaration, reason: string): ProcessedDeclaration {
  return {
    name: declaration.name,
    result: { kind: 'stopped', verdict: 'invalid' },
    reason,
    fields: declaration.fields,
    cases: [],
    exemptCount: 0,
  };
}

function compareByName(a: { readonly name: string }, b: { readonly name: string }): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** `specs/22` M16 P15: tallies how many of THIS invocation's own declarations landed at each of `13`
 * F-TEST-9's nine verdicts -- a frequency count over verdicts `envelopeDeclarations` (built from
 * `countParityResults`'s own output, above) already decided, never a second opinion about what a
 * declaration's own verdict IS. */
function tallyParityVerdicts(
  declarations: readonly RunParityCheckDeclarationResult[],
): ParityVerdictCounts {
  const counts: Record<DeclarationStopVerdict | CaseVerdict, number> = {
    invalid: 0,
    expired: 0,
    missing: 0,
    ambiguous: 0,
    error: 0,
    unclean: 0,
    unstable: 0,
    mismatch: 0,
    match: 0,
  };
  for (const declaration of declarations) counts[declaration.verdict] += 1;
  return counts;
}

/**
 * `forge parity check`'s own public entry point. See this module's own file header for the full
 * contract and boundary.
 *
 * @throws {ForgeError} `RUN-140` if `options.name` is given and matches no declaration.
 * @throws {ForgeError} `RUN-141` if `options.trusted` is given and is not a full commit sha or an
 * accepted `refs/` name, or does not resolve ({@link resolveTrustedRef}).
 * @throws {ForgeError} `RUN-142` if the check would otherwise print 0 passing and 0 failing from one
 * or more declarations that DID run (`13` F-TEST-9: "a check that would print no passing and no
 * failing case is refused"; unreachable from a well-formed input, per `counting.ts`'s own invariant,
 * kept as a real refusal rather than assumed unreachable).
 */
export async function runParityCheck(
  options: RunParityCheckOptions,
): Promise<RunParityCheckResult> {
  const paths = new ProjectPaths(options.projectRoot);
  const clock = options.clock ?? SYSTEM_CLOCK;

  const existingNames = await listDeclarationNames(paths);
  let selectedNames: readonly string[];
  if (options.name === undefined) {
    selectedNames = existingNames;
  } else {
    if (!existingNames.includes(options.name)) {
      throw new ForgeError('RUN-140', {
        name: options.name,
        detail:
          existingNames.length === 0
            ? 'no declarations exist under ".forge/parity/" yet'
            : `existing declarations: ${existingNames.join(', ')}`,
      });
    }
    selectedNames = [options.name];
  }

  let trustedSha: string | undefined;
  if (options.trusted !== undefined) {
    const resolution = await resolveTrustedRef(options.projectRoot, options.trusted);
    if (resolution.outcome === 'refused') {
      throw new ForgeError('RUN-141', { ref: options.trusted, detail: resolution.reason });
    }
    trustedSha = resolution.sha;
  }

  // The headline snapshot the written record's own `headSha`/`dirty`/`deltaDigest` describe: taken
  // ONCE, before any declaration is even loaded (`13` F-TEST-9: "a dirty flag and a digest of its
  // working-tree delta" -- the candidate's state going INTO this invocation, not a per-declaration or
  // per-case fact, which the per-case `unclean` verdict already covers separately).
  const candidateSnapshot = await takeTreeSnapshot(options.projectRoot);

  const before = await checkTrustAnchor(options.projectRoot, trustedSha);

  let processed: ProcessedDeclaration[];
  if (before.reason !== undefined) {
    // `reason` (a plain `const`, its own type already narrowed to `string` by the `if` above) is
    // read inside the closure below instead of `before.reason` directly: `tsc` cannot carry the
    // narrowing on a captured object's PROPERTY into an arrow function, but a captured `const`
    // BINDING keeps the type it was given at its own declaration, which needs neither an `as` nor a
    // `!` to restate.
    const reason = before.reason;
    processed = selectedNames.map((name) => stopped(name, 'invalid', reason));
  } else {
    processed = [];
    const existingCaptures = await listExistingCaptures(paths);
    for (const name of [...selectedNames].sort()) {
      processed.push(
        await processDeclaration({
          paths,
          projectRoot: options.projectRoot,
          name,
          clock,
          parentEnv: options.parentEnv,
          vet: options.vet,
          existingCaptures,
        }),
      );
    }
  }

  // The SECOND comparison, against the SAME resolved commit, made once this invocation has finished
  // observing (`13` F-TEST-9: "and, when a case ran, again after the last"). Run unconditionally
  // whenever `--trusted` was given and the FIRST comparison was clean -- a deliberate WIDENING past
  // the spec's own "when a case ran" condition, never a narrowing: re-checking when nothing ran can
  // only ever ADD a genuine `oracle-changed` finding (one real race the first check could not have
  // seen), never suppress one the stricter reading would have reported (this piece's own report has
  // the full reasoning as a DECISION).
  let after: AnchorFinding = { sha: before.sha };
  if (before.reason === undefined && trustedSha !== undefined) {
    after = await checkTrustAnchor(options.projectRoot, trustedSha);
  }
  if (after.reason !== undefined) {
    // Same reasoning as `reason` above: capture the narrowed binding, not the object property.
    const reason = after.reason;
    processed = processed.map((declaration) => toOracleChanged(declaration, reason));
  }

  processed.sort(compareByName);
  const counted = countParityResults(processed.map((declaration) => declaration.result));
  if (!counted.ok) {
    throw new ForgeError('RUN-142', undefined);
  }

  const envelopeDeclarations: RunParityCheckDeclarationResult[] = processed.map(
    (declaration, index) => {
      const count = counted.declarations[index];
      if (count === undefined) {
        // Unreachable: `counted.declarations` is `processed.map(...)`'s own 1:1 image.
        throw new Error(`unreachable: no counted entry for declaration "${declaration.name}"`);
      }
      return {
        name: declaration.name,
        verdict: count.verdict,
        ...(count.verdict === 'match' ? {} : { reason: declaration.reason ?? count.verdict }),
        passing: count.passing,
        failing: count.failing,
      };
    },
  );

  const topLevelReason: string | undefined =
    after.reason ??
    before.reason ??
    (counted.reason === 'no-declarations' ? 'no-declarations' : undefined);

  let evidenceId: string | null = null;
  if (options.noRecord !== true) {
    if (options.reportsRoot === undefined) {
      // A caller contract violation, never a user-facing refusal: every real caller either passes
      // `noRecord: true` (needing no `reportsRoot` at all) or already has a real project config to
      // read it from (`bin.ts`'s own dispatcher calls `readConfig` exactly when it reaches this
      // branch) -- see this module's own `RunParityCheckOptions.reportsRoot` doc comment.
      throw new Error(
        'runParityCheck: reportsRoot is required unless noRecord is true (the caller must supply ' +
          'readConfig(paths).paths.reports, or pass noRecord: true to skip writing a record).',
      );
    }
    const written = await writeParityEvidenceRecord({
      paths,
      reportsRoot: options.reportsRoot,
      clock,
      story: options.story,
      trusted: after.sha,
      headSha: candidateSnapshot.headSha,
      dirty: candidateSnapshot.entries.length > 0,
      deltaDigest: snapshotDigest(candidateSnapshot),
      verdict: counted.verdict,
      reason: topLevelReason,
      declarations: processed,
    });
    evidenceId = written.id;
  }

  // `specs/22` M16 P15: fired here, at this function's own tail, strictly AFTER the real
  // `ParityEvidence` write above has already committed (when one happens at all) -- mirroring
  // `appendExemption`'s own "only after the real write commits" discipline (`../loop/test/
  // exemptions.ts`), never `runBindingCheck`'s own looser stance (see `check-telemetry.ts`'s own
  // header comment for why the two call sites differ).
  await emitParityCheckTelemetry({
    projectRoot: options.projectRoot,
    runId: options.runId,
    clock,
    total: envelopeDeclarations.length,
    verdictCounts: tallyParityVerdicts(envelopeDeclarations),
    evidenceId,
    declarationNames: envelopeDeclarations.map((declaration) => declaration.name),
  });

  return {
    ok: true,
    verdict: counted.verdict,
    ...(topLevelReason === undefined ? {} : { reason: topLevelReason }),
    failing: counted.failing,
    passing: counted.passing,
    evidenceId,
    declarations: envelopeDeclarations,
  };
}

/** `{slug}` in `ParityEvidence`'s own registered path template (`reports/parity/{id}-{slug}.md`) --
 * left open by every earlier piece (`PLAN-M16.md`'s own "Left to a piece's own BUILD" list; P5's
 * Q299 gauntlet entry does not settle it either). This piece's own DECISION (see its report): the
 * given `--story <id>` when there is one (already expected to be a safe identifier elsewhere in this
 * codebase), else, for a single-declaration check, that declaration's own name (already pattern-
 * constrained to `^[a-z0-9][a-z0-9-]*$` by `declaration.ts`'s loader, so always path-safe), else the
 * shared literal `project` (mirroring Decision 5's identical literal for the record's own retention
 * subject when no story is given). Sanitised defensively regardless of source, since a free-text
 * `--story` value is CALLER-supplied and this piece does not otherwise validate its shape: every
 * character outside `[a-zA-Z0-9-]` becomes `-`, so neither a path-escape attempt nor an unusual byte
 * in a declaration name (unreachable given the pattern above, but not assumed) can affect where the
 * record lands -- the allocated id prefixes the file name regardless, so this can never cause a
 * collision, only a less legible suffix.
 */
function parityEvidenceSlug(
  story: string | undefined,
  declarationNames: readonly string[],
): string {
  const raw =
    story ?? (declarationNames.length === 1 ? declarationNames[0] : undefined) ?? 'project';
  const sanitised = raw.replace(/[^a-zA-Z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitised === '' ? 'project' : sanitised.toLowerCase();
}

interface WriteParityEvidenceArgs {
  readonly paths: ProjectPaths;
  readonly reportsRoot: string;
  readonly clock: Clock;
  readonly story: string | undefined;
  readonly trusted: string | null;
  readonly headSha: string;
  readonly dirty: boolean;
  readonly deltaDigest: string;
  readonly verdict: string;
  readonly reason: string | undefined;
  readonly declarations: readonly ProcessedDeclaration[];
}

/**
 * Allocates a real `PAR-###` id, renders and self-validates a real `ParityEvidence` document, and
 * writes it with `writeNewFileAtomic` — the identical allocate-build-write pattern
 * `assembleAndWriteMutationEvidence` (`loop/test/binding-evidence.ts`, M15) already establishes for
 * `MutationEvidence`, mirrored here rather than invented, per this piece's own brief.
 *
 * @throws {RangeError} if the document this function built is itself invalid — a bug here, not a
 * caller-facing failure, the identical stance `assembleAndWriteMutationEvidence` already takes.
 */
async function writeParityEvidenceRecord(
  args: WriteParityEvidenceArgs,
): Promise<{ readonly id: string; readonly path: string }> {
  const allocator = getSharedIdAllocator(args.paths, args.clock);
  const id = await allocator.allocate('ParityEvidence');
  const today = args.clock.now().slice(0, 10);
  const declarations = [...args.declarations].sort(compareByName);

  const frontMatter: Record<string, unknown> = {
    id,
    type: 'ParityEvidence',
    schemaVersion: 1,
    title: `forge parity check -- ${args.story ?? 'project'}`,
    status: 'recorded',
    created: today,
    updated: today,
    revision: 1,
    author: 'engine',
    changelog: [],
    ...(args.story === undefined ? {} : { story: args.story }),
    trusted: args.trusted,
    headSha: args.headSha,
    dirty: args.dirty,
    deltaDigest: args.deltaDigest,
    // No "tool version" concept exists anywhere in the already-landed M16 parity code (this piece's
    // own report: a DECISION, not a transcription); this records the one interpreter whose own
    // behaviour (UTF-8 decoding, JSON parsing) can affect how an observation is read, the harness's
    // own Node runtime -- never a declared surface's own, arbitrary tool, which this piece has no
    // general way to version.
    toolVersions: { node: process.version },
    verdict: args.verdict,
    ...(args.reason === undefined ? {} : { reason: args.reason }),
    declarations: declarations.map((declaration) => {
      const declarationVerdict =
        declaration.result.kind === 'stopped'
          ? declaration.result.verdict
          : declarationVerdictFromCases(declaration.cases);
      return {
        name: declaration.name,
        digest: declaration.fields.digest,
        reference: { ref: declaration.fields.referenceRef, sha: declaration.fields.referenceSha },
        platform: declaration.fields.platform,
        captureDigest: declaration.fields.captureDigest,
        verdict: declarationVerdict,
        ...(declarationVerdict === 'match'
          ? {}
          : { reason: declaration.reason ?? declarationVerdict }),
        cases: declaration.cases.map((entry) => ({
          surface: entry.surface,
          caseIndex: entry.caseIndex,
          verdict: entry.verdict,
          ...(entry.contentHash === undefined ? {} : { contentHash: entry.contentHash }),
        })),
        exemptCount: declaration.exemptCount,
      };
    }),
  };

  const text = `---\n${YAML.stringify(frontMatter)}---\n\n<No further content: every real finding lives in the front matter above, not the body.>\n`;

  const slug = parityEvidenceSlug(
    args.story,
    declarations.map((d) => d.name),
  );
  const pathResult = renderArtifactPath('ParityEvidence', { id, slug });
  if (!pathResult.success) {
    throw new RangeError(
      `renderArtifactPath('ParityEvidence', ...) failed: missing ${pathResult.missingVariable}`,
    );
  }
  const relativePath = `${args.reportsRoot}/${pathResult.path.replace(/^reports\//, '')}`;

  const problems = documentProblems(PARITY_EVIDENCE_TYPE, relativePath, text).problems;
  if (problems.length > 0) {
    throw new RangeError(`the engine built an invalid ${id}: ${problems.join('; ')}`);
  }

  await writeNewFileAtomic(args.paths.resolveWithin(relativePath), text);
  return { id, path: relativePath };
}

/** The declaration-level verdict for a `kind: 'ran'` {@link ProcessedDeclaration}, by the identical
 * precedence `counting.ts`'s own `countDeclaration` already applies to its `cases` list -- reusing
 * `CASE_VERDICT_PRECEDENCE` directly rather than re-deriving the ordering, so the record's own
 * `declarations[].verdict` can never silently diverge from what `countParityResults` itself already
 * decided for the identical cases (the two are computed from the SAME `cases` array by the SAME
 * exported precedence constant, never two independently-maintained copies of the rule). */
function declarationVerdictFromCases(cases: readonly RecordCaseEntry[]): CaseVerdict {
  if (cases.length === 0) {
    // Every surface exempt: `nothing-compared` already stops this declaration before reaching here
    // (`processDeclaration`'s own `nonExemptSurfaces.length === 0` branch), so this is unreachable
    // for a real caller; kept as a defined, honest fallback rather than an unchecked array read.
    return 'match';
  }
  for (const verdict of CASE_VERDICT_PRECEDENCE) {
    if (cases.some((entry) => entry.verdict === verdict)) return verdict;
  }
  // Unreachable: CASE_VERDICT_PRECEDENCE's five members are exhaustive over CaseVerdict.
  throw new Error('unreachable: no case verdict matched any precedence member');
}
