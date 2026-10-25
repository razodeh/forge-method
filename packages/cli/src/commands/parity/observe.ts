/**
 * `observeParityDeclaration` — the observation engine (`PLAN-M16.md` P3, `13` F-TEST-9): given a
 * loaded `ParityDeclaration` and a tree, runs each case's command for real and produces a raw, typed
 * observation per surface. It does NOT normalise, compare, decide a verdict, run `stability.runs`
 * repetitions, or write a `ParityEvidence` record — see `observe-types.ts`'s own doc comment and this
 * piece's own report for the full boundary. The candidate is observed in place; the reference is
 * observed in a scratch worktree this function creates and always removes.
 *
 * **One function, both sides.** `options.side` discriminates: `'candidate'` observes `projectRoot`
 * itself, in place, running no `setup`; `'reference'` builds a scratch worktree at
 * `options.referenceSha` (already resolved against a real repository — see `reference-commit.ts`,
 * which this function's own caller runs first) via `lanes.ts`'s own `createLaneWorktree`/
 * `removeLaneWorktree` (the engine's lane mechanism reused for a tree this piece is not actually a
 * lane of — see this piece's own report for the synthetic `{runId, stepId}` chosen and why) — post-v1.0
 * `specs/22` M17, under a per-project directory in the user's own cache directory, never under
 * `projectRoot`'s own `.forge/state/` as before (`18` §18.3's "Worktree location" paragraph: moving
 * every FORGE-managed worktree, including this one, out of the project tree is what keeps a test
 * runner that globs the whole project from discovering it) — runs each surface's own `setup` first,
 * observes the worktree, and removes it — in a `finally`-equivalent that survives a thrown error from
 * anywhere inside
 * (a real `SIGKILL` delivered to THIS process cannot be survived by any code running inside it; the
 * worktree left behind by that case is reclaimed by the engine's own existing second-layer orphan
 * sweep, `@forge/vcs`'s `listOrphanedWorktrees`/`removeLaneWorktree`, exactly as `PLAN-M15.md`'s own
 * `binding-sigkill` precedent already relies on for the identical reason — this piece's own tests
 * prove both halves).
 *
 * **Overlay bytes are always read from `projectRoot`'s own `.forge/parity/`, never from the tree
 * being observed.** The scratch worktree holds the reference's own tracked files only, which may
 * predate `.forge/parity/`'s own existence entirely; the candidate's own `.forge/parity/` is already
 * the right place either way. So the one real `root`/`overlayRoot` split this function makes
 * internally is: run the command IN the tree being observed, but read every overlaid byte FROM
 * `projectRoot`.
 *
 * **The reference's `node_modules` is bridged in explicitly, not left to accident
 * (`process/SPEC-QUESTIONS.md` Q314).** Before M17 P8 moved the scratch worktree outside the project
 * tree, Node's own directory walk-up reached the project's installed packages from the nested
 * worktree as an emergent property of that nesting; once moved out, nothing reached them at all.
 * `withReferenceWorktree`, below, calls `reference-node-modules.ts`'s own
 * `linkReferenceNodeModules` right after the worktree is created (and before any `setup` or `run`
 * reaches it), which symlinks the project's top-level `node_modules` into the worktree root — see
 * that module's own doc comment for why a symlink, not `NODE_PATH` or a declaration `setup` command,
 * is the right mechanism.
 *
 * **Per-case failures are DATA, not thrown exceptions.** A real `ForgeError` (`QUALITY-BAR.md` R2)
 * is always constructed for a case that cannot be completed (a timeout, a cap breach, a secret or a
 * lossy decode, a malformed probe, a symlinked output path, a missing overlay source) — but it is
 * RETURNED as that case's own `{outcome: 'failed', failure: {error}}`, never thrown, so one case's
 * failure never stops the rest of the declaration's cases from being observed. A genuinely
 * declaration-wide precondition failure (the scratch worktree itself could not be created, a
 * surface's own `setup` failed) still propagates every case of the affected surface(s) as failed,
 * without aborting unrelated surfaces.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M16.md P3
 * @see process/SPEC-QUESTIONS.md Q294 Decision 7
 * @see process/SPEC-QUESTIONS.md Q314
 */
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';

import { ForgeError, isForgeError, renderValue } from '@forge/core/errors';
import { runConfinedCommand, STORED_COMMAND_LIMITS } from '@forge/engine/dispatch';
import {
  createLaneWorktree,
  removeLaneWorktree,
  worktreesRootFor,
  VcsError,
  type LaneHandle,
} from '@forge/vcs';

import { withParityDirHidden } from './candidate-isolation.ts';
import { composeArgs } from './compose-args.ts';
import type {
  DeclaredOutput,
  ParityCase,
  ParityDeclaration,
  SurfaceDeclaration,
  SurfaceKind,
} from './declaration-types.ts';
import { SURFACE_KINDS } from './declaration-types.ts';
import { parseLibraryProbeOutput } from './library-protocol.ts';
import { observeHttpSurfaceCases } from './observe-http.ts';
import { PINNED_ENV } from './pinned-env.ts';
import { linkReferenceNodeModules } from './reference-node-modules.ts';
import type {
  ObservedRoot,
  ParityCaseObservationOutcome,
  ParityCaseResult,
  ParityDeclarationObservation,
  RawExit,
  RawFileEntry,
  RawFileObservation,
  RawLibraryObservation,
  RawProcessObservation,
  RawStream,
} from './observe-types.ts';
import {
  cleanDeclaredOutputs,
  probeSourcePaths,
  readDeclaredOutputContent,
  readOverlaySourceBytes,
  writeOverlayFile,
  writeProbeOverlay,
} from './overlay.ts';
import { lossyUtf8Refusal, secretRefusal } from './refusals.ts';
import { isCleanExcluding, takeTreeSnapshot } from './tree-snapshot.ts';

// `PINNED_ENV` moved to its own module, `pinned-env.ts` (`specs/22` M16 P8): `http-server.ts` needs
// the IDENTICAL constant and sits on the other side of an `observe.ts` -> `observe-http.ts` ->
// `http-server.ts` call chain, so re-exporting it from here would create an import cycle back to
// this module. See that module's own doc comment for the full reasoning.

function decodeLossy(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('utf8');
}

interface ObserveOneCaseArgs {
  readonly surfaceKind: SurfaceKind;
  readonly surface: SurfaceDeclaration;
  readonly parityCase: ParityCase;
  readonly side: 'reference' | 'candidate';
  readonly root: string;
  readonly overlayRoot: string;
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
}

/** Every probe file a `library` surface's `run`/`setup` command lines name, de-duplicated and
 * sorted (`QUALITY-BAR.md` R10). */
function librarySurfaceProbePaths(surface: SurfaceDeclaration): readonly string[] {
  const all = new Set<string>(probeSourcePaths(surface.run));
  for (const setupLine of surface.setup ?? []) {
    for (const probePath of probeSourcePaths(setupLine)) all.add(probePath);
  }
  return [...all].sort();
}

async function observeOneCase(args: ObserveOneCaseArgs): Promise<ParityCaseObservationOutcome> {
  const { surfaceKind, surface, parityCase, side, root, overlayRoot, parentEnv } = args;
  const declaredOutputs: readonly DeclaredOutput[] = parityCase.outputs ?? [];
  const writtenOverlayDestinations: string[] = [];

  try {
    // Before a case runs: clean its declared outputs (a stale file from a PREVIOUS case or run must
    // not leak in), then overlay its declared inputs and (for `library`) its probe(s) — all from
    // bytes read from `overlayRoot`, never from `root`.
    await cleanDeclaredOutputs(root, declaredOutputs);

    for (const input of parityCase.inputs ?? []) {
      const bytes = await readOverlaySourceBytes(overlayRoot, input.from);
      await writeOverlayFile(root, input.to, bytes);
      writtenOverlayDestinations.push(input.to);
    }

    if (surfaceKind === 'library') {
      for (const probePath of librarySurfaceProbePaths(surface)) {
        const bytes = await readOverlaySourceBytes(overlayRoot, probePath);
        // Overwritten, never refused-if-exists, and never cleaned up afterwards -- see
        // `writeProbeOverlay`'s own doc comment for why a probe is not an ordinary case `input`.
        await writeProbeOverlay(root, probePath, bytes);
      }
    }

    const before = await takeTreeSnapshot(root);

    const composed = composeArgs(surface.run, parityCase.args ?? []);
    if (typeof composed !== 'string') {
      // Unreachable for a declaration that passed `declaration.ts`'s own load-time validation,
      // which already refuses any case whose composed line `composeArgs` cannot build.
      throw new Error(
        `unreachable: composeArgs refused an already-loaded case (${composed.invalid})`,
      );
    }

    const limits = {
      timeoutMs: parityCase.timeoutMs ?? STORED_COMMAND_LIMITS.timeoutMs,
      maxOutputBytes: parityCase.outputCapBytes ?? STORED_COMMAND_LIMITS.maxOutputBytes,
    };
    // `specs/22` M17 P14: on the candidate side only, `.forge/parity/` is absent for exactly this
    // command's own run (never wider -- this piece's own `candidate-isolation.ts` doc comment has the
    // full account of why precisely here, between the overlay writes above and the snapshot below).
    //
    // EXCEPT when THIS CASE'S OWN composed command line itself names a path under
    // `.forge/parity/probes/` -- never special-cased on `surfaceKind === 'library'` (a real
    // regression a second critic round found and reproduced live: `13` F-TEST-9 §"library probe
    // protocol" defines `library` as "a `process` surface whose command is a reviewed probe script
    // under `.forge/parity/probes/`" -- the SPEC's own wording already says any `process`-shaped
    // surface may use the identical pattern, and `SurfaceDeclaration.run` is one plain string field
    // every surface kind shares; nothing about the TYPE `'library'` is structurally special here).
    // `probeSourcePaths` (`overlay.ts`) is the same surface-agnostic scan `librarySurfaceProbePaths`
    // above already uses for the overlay step -- reused here rather than re-deriving "does this
    // command need a path this isolation would hide" a second, independently-written way. DISCLOSED
    // GAP: a case whose command needs its own probe script therefore keeps the self-reverting-tamper
    // exposure this piece closes for every other case -- closing it too needs the isolation to stage
    // ONLY the named probe path(s) back into an otherwise-still-hidden directory (so the command can
    // run while nothing else under `.forge/parity/` is reachable), a materially bigger mechanism than
    // this piece's own scope; see this piece's own report.
    const referencesProbePath = probeSourcePaths(composed).length > 0;
    const runCase = (): Promise<Awaited<ReturnType<typeof runConfinedCommand>>> =>
      runConfinedCommand(composed, root, {
        limits,
        parentEnv,
        extraEnv: PINNED_ENV,
        preserveRawOutput: true,
      });
    const result =
      side === 'candidate' && !referencesProbePath
        ? await withParityDirHidden(root, runCase)
        : await runCase();

    if (result.timedOut === true) {
      return {
        outcome: 'failed',
        failure: {
          error: new ForgeError('RUN-118', { command: composed, timeoutMs: limits.timeoutMs }),
        },
      };
    }
    if (result.outputLimitExceeded === true) {
      return {
        outcome: 'failed',
        failure: {
          error: new ForgeError('RUN-119', { command: composed, capBytes: limits.maxOutputBytes }),
        },
      };
    }

    const rawOutput = result.rawOutput;
    if (rawOutput === undefined) {
      throw new Error('unreachable: preserveRawOutput was set but rawOutput is absent');
    }
    const exit: RawExit =
      result.signal === undefined
        ? { kind: 'code', code: result.exitCode }
        : { kind: 'signal', signal: result.signal };

    // `library` never restricts `streams` at load time (`declaration.ts`'s own `readSurface`), so
    // both are always observed there; `process` honours the surface's own declared subset.
    const observeStdout =
      surfaceKind !== 'process' || (surface.streams?.includes('stdout') ?? true);
    const observeStderr =
      surfaceKind !== 'process' || (surface.streams?.includes('stderr') ?? true);

    const stdoutStream: RawStream = {
      bytes: rawOutput.stdout,
      text: decodeLossy(rawOutput.stdout),
    };
    const stderrStream: RawStream = {
      bytes: rawOutput.stderr,
      text: decodeLossy(rawOutput.stderr),
    };

    if (observeStdout) {
      // DECISION: checked in this order (never reversed) so a stream that is BOTH invalid UTF-8 AND
      // secret-shaped always reports RUN-122, never RUN-121 -- deliberate, not arbitrary: the UTF-8
      // check is decided on the raw bytes alone, independent of whatever `secretRefusal`'s own
      // pattern match over the lossy-decoded text might do on content that was not reliably decoded
      // to begin with. Either order refuses the stream (no leak either way); this is only which
      // diagnosis the caller sees.
      const refusal =
        lossyUtf8Refusal(surfaceKind, 'stdout', rawOutput.stdout) ??
        secretRefusal(surfaceKind, 'stdout', stdoutStream.text);
      if (refusal !== undefined) return { outcome: 'failed', failure: { error: refusal } };
    }
    if (observeStderr) {
      // Same DECISION and reasoning as the stdout check immediately above.
      const refusal =
        lossyUtf8Refusal(surfaceKind, 'stderr', rawOutput.stderr) ??
        secretRefusal(surfaceKind, 'stderr', stderrStream.text);
      if (refusal !== undefined) return { outcome: 'failed', failure: { error: refusal } };
    }

    let observation: RawProcessObservation | RawFileObservation | RawLibraryObservation;
    if (surfaceKind === 'process') {
      observation = {
        surface: 'process',
        ...(observeStdout ? { stdout: stdoutStream } : {}),
        ...(observeStderr ? { stderr: stderrStream } : {}),
        exit,
      };
    } else if (surfaceKind === 'library') {
      // `library-protocol.ts`'s own contract expects text already stripped of its SINGLE final
      // newline (`result.stdout`, which `runConfinedCommand` already computed that way) -- never
      // `stdoutStream.text`, which is deliberately the RAW, un-stripped decode this piece hands P4
      // for the observation record itself (`13` F-TEST-9 decides equality on the FULL content, so
      // stripping it here would be a normalisation this piece has no business doing).
      const parsed = parseLibraryProbeOutput(result.stdout);
      if (parsed.outcome === 'malformed') {
        return {
          outcome: 'failed',
          failure: {
            error: new ForgeError('RUN-123', { command: composed, detail: parsed.detail }),
          },
        };
      }
      observation = {
        surface: 'library',
        process: { surface: 'process', stdout: stdoutStream, stderr: stderrStream, exit },
        result: parsed.result,
      };
    } else {
      const files: RawFileEntry[] = [];
      for (const output of declaredOutputs) {
        const content = await readDeclaredOutputContent(root, output);
        if (content.mode === 'text') {
          // Same DECISION and reasoning as the stdout/stderr checks above.
          const refusal =
            lossyUtf8Refusal('file', output.path, content.bytes) ??
            secretRefusal('file', output.path, content.text);
          if (refusal !== undefined) return { outcome: 'failed', failure: { error: refusal } };
        }
        files.push({ path: output.path, content });
      }
      observation = { surface: 'file', files };
    }

    // After the case: read the outputs happens above (file surface); clean them again, and remove
    // the overlay(s) this case's own inputs/probe wrote — both harness bookkeeping, excluded from
    // the "after" snapshot's own comparison by running strictly after it is taken.
    const after = await takeTreeSnapshot(root);
    const clean = isCleanExcluding(
      before,
      after,
      new Set(declaredOutputs.map((output) => output.path)),
    );

    return { outcome: 'observed', observation, clean, before, after };
  } catch (cause) {
    if (isForgeError(cause)) {
      return { outcome: 'failed', failure: { error: cause } };
    }
    throw cause;
  } finally {
    // Best-effort bookkeeping: a cleanup failure here (for example the identical symlink that
    // already failed this case above) must never replace this case's own real, already-decided
    // result with an unrelated thrown exception — `cleanDeclaredOutputs`'s own errors are therefore
    // swallowed here, never surfaced a second time.
    try {
      await cleanDeclaredOutputs(root, [
        ...declaredOutputs,
        ...writtenOverlayDestinations.map((destination) => ({ path: destination })),
      ]);
    } catch {
      // See above.
    }
  }
}

/** Runs every `setup` command of a reference-side surface, in order, under the identical pinned
 * environment and `STORED_COMMAND_LIMITS` a case itself runs under (`13` F-TEST-9: "vetted exactly as
 * `run` is"). Returns the first failure's own `ForgeError`, or `undefined` once every command has
 * exited `0`. */
async function runSurfaceSetup(
  surface: SurfaceDeclaration,
  root: string,
  parentEnv: Readonly<Record<string, string | undefined>>,
): Promise<ForgeError | undefined> {
  for (const command of surface.setup ?? []) {
    const result = await runConfinedCommand(command, root, {
      limits: STORED_COMMAND_LIMITS,
      parentEnv,
      extraEnv: PINNED_ENV,
    });
    if (result.timedOut === true) {
      return new ForgeError('RUN-127', {
        command,
        detail: `did not finish within ${String(STORED_COMMAND_LIMITS.timeoutMs)}ms.`,
      });
    }
    if (result.outputLimitExceeded === true) {
      return new ForgeError('RUN-127', { command, detail: 'wrote more than its output cap.' });
    }
    if (result.exitCode !== 0) {
      return new ForgeError('RUN-127', {
        command,
        detail: `exited ${String(result.exitCode)}: ${(result.stderr || result.stdout).slice(0, 2000)}`,
      });
    }
  }
  return undefined;
}

/** `options.side === 'candidate'` observes `projectRoot` directly: `declaration`, `projectRoot` and
 * `parentEnv` only. `options.side === 'reference'` additionally requires `referenceSha` (the real
 * commit `reference-commit.ts`'s own `resolveReferenceCommit` already resolved) and observes a
 * scratch worktree built at it instead. */
export type ObserveParityDeclarationOptions =
  | {
      readonly side: 'candidate';
      readonly declaration: ParityDeclaration;
      readonly projectRoot: string;
      readonly parentEnv: Readonly<Record<string, string | undefined>>;
    }
  | {
      readonly side: 'reference';
      readonly declaration: ParityDeclaration;
      readonly projectRoot: string;
      readonly referenceSha: string;
      readonly parentEnv: Readonly<Record<string, string | undefined>>;
    };

async function observeAgainstRoot(
  declaration: ParityDeclaration,
  side: 'reference' | 'candidate',
  root: string,
  overlayRoot: string,
  parentEnv: Readonly<Record<string, string | undefined>>,
): Promise<readonly ParityCaseResult[]> {
  const results: ParityCaseResult[] = [];
  for (const surfaceKind of SURFACE_KINDS) {
    const surface = declaration.surfaces[surfaceKind];
    if (surface === undefined) continue;

    // `setup` runs once per surface, only on the reference side, before any of that surface's own
    // cases (`13` F-TEST-9: "run only in the scratch tree, before the reference is observed"). A
    // failure there means no case of THIS surface can be observed; every one of its cases reports
    // the identical failure rather than being silently skipped, and unrelated surfaces are
    // unaffected.
    const setupFailure =
      side === 'reference' ? await runSurfaceSetup(surface, root, parentEnv) : undefined;

    // `http` is dispatched to its own branch, not the generic per-case loop below: that loop composes
    // the CASE's own args onto the surface's `run` and runs ONE confined command invocation PER CASE
    // (`observeOneCase`), which fits a `process`/`file`/`library` surface's own `run` (a command that
    // finishes) but not an `http` surface's own `run` (a command that starts a SERVER, which must stay
    // alive across every one of this surface's cases, never a command run once per case or once and
    // discarded) -- see this piece's own report, "How `observeAgainstRoot` was restructured", for the
    // full account of why this is a deliberate top-level branch rather than a forced stretch of the
    // existing shape. `setupFailure` is honoured identically here: an `http` surface's own `setup` (a
    // build step, say, before the server itself starts) runs through the IDENTICAL `runSurfaceSetup`
    // every other surface's reference side already uses, above, before this branch is ever reached.
    if (surfaceKind === 'http') {
      const outcomes: readonly ParityCaseObservationOutcome[] =
        setupFailure !== undefined
          ? surface.cases.map(() => ({ outcome: 'failed', failure: { error: setupFailure } }))
          : await observeHttpSurfaceCases(surface, side, root, overlayRoot, parentEnv);
      outcomes.forEach((outcome, caseIndex) => {
        results.push({ surface: surfaceKind, caseIndex, result: outcome });
      });
      continue;
    }

    // Sequential, one case at a time: each case's own overlay-write/clean bookkeeping must not
    // overlap a sibling case's (they share the one tree being observed).
    for (let caseIndex = 0; caseIndex < surface.cases.length; caseIndex += 1) {
      const parityCase = surface.cases[caseIndex];
      if (parityCase === undefined) continue;
      const outcome: ParityCaseObservationOutcome =
        setupFailure !== undefined
          ? { outcome: 'failed', failure: { error: setupFailure } }
          : await observeOneCase({
              surfaceKind,
              surface,
              parityCase,
              side,
              root,
              overlayRoot,
              parentEnv,
            });
      results.push({ surface: surfaceKind, caseIndex, result: outcome });
    }
  }
  return results;
}

function syntheticLaneRef(
  declarationName: string,
  referenceSha: string,
): { readonly runId: string; readonly stepId: string } {
  // Deterministic (QUALITY-BAR.md R10: no uninjected randomness) and collision-resistant per
  // (declaration name, reference sha) pair, mirroring `lanes.ts`'s own `slugifyStepId` hashing. Two
  // CONCURRENT invocations for the identical pair collide on git's own "branch already exists"
  // refusal -- disclosed, the identical "no lock" limitation `13` F-TEST-9 already states for
  // `forge parity capture`/`check` (see this piece's own report).
  const digest = createHash('sha256').update(`${declarationName}:${referenceSha}`).digest('hex');
  return { runId: `parity-${digest.slice(0, 16)}`, stepId: declarationName };
}

/** Creates the reference's scratch worktree, runs `fn` against it, and always removes it again —
 * surviving `fn` throwing (never `fn`'s own process being `SIGKILL`'d, which no in-process `finally`
 * can survive; the engine's own second-layer orphan sweep is what reclaims that case, proven by this
 * piece's own tests). A genuine removal failure is surfaced ONLY when `fn` itself did not already
 * fail — never silently dropped, and never allowed to replace a real failure from `fn` with a less
 * useful one from cleanup (`try`/`finally`'s own "the `finally` block's throw wins" pitfall, avoided
 * here explicitly rather than relied upon).
 *
 * Once the worktree exists, {@link linkReferenceNodeModules} bridges in the project's own
 * `node_modules` (`process/SPEC-QUESTIONS.md` Q314) before `fn` ever runs — a failure there is
 * treated identically to `fn` itself throwing: the worktree is still removed, and the error
 * propagates the same way.
 *
 * @throws {ForgeError} `RUN-124` if the worktree itself cannot be created.
 * @throws {ForgeError} `RUN-163` if the project's `node_modules` cannot be linked into it.
 */
async function withReferenceWorktree<T>(
  projectRoot: string,
  referenceSha: string,
  declarationName: string,
  fn: (worktreeRoot: string) => Promise<T>,
): Promise<T> {
  const { runId, stepId } = syntheticLaneRef(declarationName, referenceSha);
  let handle: LaneHandle;
  try {
    handle = await createLaneWorktree(projectRoot, {
      runId,
      stepId,
      integrationBase: referenceSha,
    });
  } catch (cause) {
    if (cause instanceof VcsError) {
      // The real location `createLaneWorktree` itself just tried and failed against — post-v1.0
      // `specs/22` M17, the per-project cache directory `worktreesRootFor` computes (removing this
      // piece's own former in-tree special case, which hardcoded the pre-M17 `.forge/state/worktrees`
      // path unconditionally and would otherwise now report somewhere this attempt never touched,
      // `PLAN-M17.md` P8). Recomputed from a fresh `realpath`, exactly as `createLaneWorktree` computes
      // it internally before this same failure: not returned by the failed call, which has no handle to
      // read a resolved path back from.
      const realProjectRoot = await realpath(projectRoot);
      throw new ForgeError(
        'RUN-124',
        {
          path: await worktreesRootFor(realProjectRoot),
          vcsCode: cause.code,
          vcsMessage: cause.message,
        },
        { cause },
      );
    }
    throw cause;
  }

  let outcome:
    { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };
  try {
    await linkReferenceNodeModules(projectRoot, handle.path);
    outcome = { ok: true, value: await fn(handle.path) };
  } catch (cause) {
    outcome = { ok: false, error: cause };
  }

  try {
    await removeLaneWorktree(projectRoot, handle, { retain: false });
  } catch (removalError) {
    if (outcome.ok) throw removalError;
  }

  if (!outcome.ok) {
    if (outcome.error instanceof Error) throw outcome.error;
    throw new Error(renderValue(outcome.error));
  }
  return outcome.value;
}

/**
 * `root`, as given, alongside its real path (`fs.realpath`) — the raw pair `13` F-TEST-9's
 * Normalisation bullet needs for its always-on "rewrite each observed tree's root path, both as
 * given and as its real path, to a fixed token" first step, which P4 owns performing (see
 * `observe-types.ts`'s own `ObservedRoot` doc comment for why this piece supplies the data rather
 * than doing the rewrite itself).
 */
async function observedRootOf(root: string): Promise<ObservedRoot> {
  return { asGiven: root, real: await realpath(root) };
}

/**
 * THE observation entry point P4 (normalise/compare), P6 (`forge parity capture`) and P7
 * (`forge parity check`) all call into — see this module's own doc comment for the full contract.
 * Returns `{root, cases}`: `cases` is one {@link ParityCaseResult} per case of every declared
 * surface, in `SURFACE_KINDS` order then case index (`QUALITY-BAR.md` R10) — never normalised,
 * never compared, never assigned a verdict; `root` is the ONE tree this call observed (the
 * candidate's own project root, or the reference's own scratch worktree), both as given and
 * resolved (`observe-types.ts`'s own `ObservedRoot` doc comment) — the raw input P4's own
 * always-on root-path normalisation step needs, which P4 performs, never this piece.
 *
 * @throws {ForgeError} `ENV-007` on `win32`: `composeArgs`'s single-quote defense (P2) is not safe
 * under `cmd.exe`, and this milestone's own DECISION (this piece's report) is to refuse outright on
 * this platform rather than compose something unproven — see that code's own doc comment in
 * `codes.ts` for the full reasoning. Checked once, before anything else, so a non-POSIX host never
 * even creates a scratch worktree or spawns a process for a declaration it cannot safely observe.
 */
export async function observeParityDeclaration(
  options: ObserveParityDeclarationOptions,
): Promise<ParityDeclarationObservation> {
  if (process.platform === 'win32') {
    throw new ForgeError('ENV-007', undefined);
  }
  if (options.side === 'candidate') {
    const [cases, root] = await Promise.all([
      observeAgainstRoot(
        options.declaration,
        'candidate',
        options.projectRoot,
        options.projectRoot,
        options.parentEnv,
      ),
      observedRootOf(options.projectRoot),
    ]);
    return { root, cases };
  }
  let observedWorktreeRoot: ObservedRoot | undefined;
  const cases = await withReferenceWorktree(
    options.projectRoot,
    options.referenceSha,
    options.declaration.name,
    async (worktreeRoot) => {
      observedWorktreeRoot = await observedRootOf(worktreeRoot);
      return observeAgainstRoot(
        options.declaration,
        'reference',
        worktreeRoot,
        options.projectRoot,
        options.parentEnv,
      );
    },
  );
  if (observedWorktreeRoot === undefined) {
    // Unreachable: `withReferenceWorktree` only ever resolves by returning what its own callback
    // returned, and the callback above always assigns this before returning.
    throw new Error('unreachable: the reference worktree root was never recorded');
  }
  return { root: observedWorktreeRoot, cases };
}
