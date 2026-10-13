/**
 * `observeHttpSurfaceCases` — the `http` surface's own dispatch branch (`specs/22` M16 P8, `13`
 * F-TEST-9), called from `observe.ts`'s own `observeAgainstRoot` in place of the generic
 * `observeOneCase`-per-case loop every other surface uses. See `observe.ts`'s own report section on
 * why `http` needs a genuinely different shape, not a forced reuse of the existing one: the surface's
 * `run` starts a SERVER that must stay alive across every one of this surface's cases, not a command
 * run once per case or once and discarded.
 *
 * **The shape, precisely.** Start the server ONCE (port-free check, launch, readiness poll — all
 * before any case runs); loop every case, each making ONE real HTTP request against that
 * already-running server and nothing else; kill the whole server group in a `finally` that wraps the
 * ENTIRE cases loop for this surface, so the server comes down exactly once per call, on success, on
 * a case failure, or when a request throws something this module does not expect. A failure to START
 * the server (the port was held, the server died before readiness, or never became ready) is a
 * declaration-wide precondition failure: every one of this surface's cases reports the IDENTICAL
 * error, the same propagation `observe.ts`'s own `runSurfaceSetup` failure already gets for every
 * other surface whose own precondition never held.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M16.md P8
 * @see process/SPEC-QUESTIONS.md Q294 Decision 7
 */
import { isForgeError } from '@forge/core/errors';
import { STORED_COMMAND_LIMITS } from '@forge/engine/dispatch';

import { withParityDirHidden } from './candidate-isolation.ts';
import type { ParityCase, SurfaceDeclaration } from './declaration-types.ts';
import { sendHttpRequest } from './http-client.ts';
import { LOOPBACK_HOST, startHttpServer, type HttpServerHandle } from './http-server.ts';
import type { ParityCaseObservationOutcome } from './observe-types.ts';
import {
  cleanDeclaredOutputs,
  probeSourcePaths,
  readOverlaySourceBytes,
  writeOverlayFile,
} from './overlay.ts';
import { lossyUtf8Refusal, secretRefusal } from './refusals.ts';
import { isCleanExcluding, takeTreeSnapshot } from './tree-snapshot.ts';

/** `surface.port`/`surface.readiness` are typed optional on the one shared `SurfaceDeclaration` shape
 * (kind-specific fields, exactly like `network`/`streams` — `declaration-types.ts`'s own doc
 * comments), but `declaration.ts`'s loader REQUIRES both on every `http` surface it accepts: a
 * surface reaching this module without them is a declaration that should never have loaded at all.
 * Reported the identical "unreachable, thrown" way `observe.ts`'s own `composeArgs` re-check already
 * is for an analogous already-validated invariant, never a silent `!`/`as` past the type system. */
function requireHttpConfig(surface: SurfaceDeclaration): {
  readonly port: number;
  readonly readiness: NonNullable<SurfaceDeclaration['readiness']>;
} {
  if (surface.port === undefined || surface.readiness === undefined) {
    throw new Error(
      'unreachable: an "http" surface reached the observer with no "port"/"readiness" -- ' +
        'declaration.ts should have refused it at load.',
    );
  }
  return { port: surface.port, readiness: surface.readiness };
}

/** One case's overlay input, already READ from `.forge/parity/` — `specs/22` M17 P14: every input
 * byte an http surface's cases need is read up front, before the server starts and before the
 * candidate-side isolation window opens (`observeHttpSurfaceCases`'s own doc comment has the full
 * account of why the http surface needs this extra step the other three surfaces do not). */
interface PreReadOverlayInput {
  readonly to: string;
  readonly bytes: Uint8Array;
}

interface ObserveOneHttpCaseArgs {
  readonly parityCase: ParityCase;
  readonly port: number;
  readonly root: string;
  readonly preReadInputs: readonly PreReadOverlayInput[];
}

async function observeOneHttpCase(
  args: ObserveOneHttpCaseArgs,
): Promise<ParityCaseObservationOutcome> {
  const { parityCase, port, root, preReadInputs } = args;
  const request = parityCase.request;
  if (request === undefined) {
    throw new Error(
      'unreachable: an "http" case with no "request" reached the observer -- declaration.ts should ' +
        'have refused it at load.',
    );
  }
  const writtenOverlayDestinations: string[] = [];
  try {
    for (const input of preReadInputs) {
      await writeOverlayFile(root, input.to, input.bytes);
      writtenOverlayDestinations.push(input.to);
    }

    const before = await takeTreeSnapshot(root);
    const observation = await sendHttpRequest({
      host: LOOPBACK_HOST,
      port,
      request,
      timeoutMs: parityCase.timeoutMs ?? STORED_COMMAND_LIMITS.timeoutMs,
      capBytes: parityCase.outputCapBytes ?? STORED_COMMAND_LIMITS.maxOutputBytes,
    });

    // The identical secret/lossy-UTF-8 refusal every other surface's own text content already gets
    // (`observe.ts`'s own stdout/stderr checks, `overlay.ts`'s own declared-file-content check),
    // applied to the response BODY — the one genuinely text-shaped part of an http observation.
    // Headers are structured metadata (an http case's own `request.responseHeaders` is already the
    // reviewed, opt-in control over which ones are even observed) and the status is a raw integer;
    // neither is a "stream" this check was ever meant to scan.
    const refusal =
      lossyUtf8Refusal('http', 'body', observation.body.bytes) ??
      secretRefusal('http', 'body', observation.body.text);
    if (refusal !== undefined) return { outcome: 'failed', failure: { error: refusal } };

    const after = await takeTreeSnapshot(root);
    // No declared `outputs` on an `http` case (`declaration.ts` refuses one) -- nothing of this
    // case's own to exclude from the clean check, unlike a `file`/`process` case's own declared
    // output paths.
    const clean = isCleanExcluding(before, after, new Set());
    return { outcome: 'observed', observation, clean, before, after };
  } catch (cause) {
    if (isForgeError(cause)) return { outcome: 'failed', failure: { error: cause } };
    throw cause;
  } finally {
    // Best-effort bookkeeping, identical in spirit to `observe.ts`'s own `observeOneCase`: a cleanup
    // failure here must never replace this case's own already-decided result with an unrelated thrown
    // exception.
    try {
      await cleanDeclaredOutputs(
        root,
        writtenOverlayDestinations.map((destination) => ({ path: destination })),
      );
    } catch {
      // See above.
    }
  }
}

/**
 * Observes every case of an `http` surface against `root`, starting its own server once and tearing
 * it down once this surface's entire cases loop has finished, in a `finally` that runs on success, on
 * a case's own failure, and on an unexpected throw from anywhere in the loop.
 *
 * Returns one {@link ParityCaseObservationOutcome} per case, in `surface.cases` order — `observe.ts`'s
 * own caller zips this with each case's index exactly as it already does for every other surface.
 *
 * A server that never starts at all (the port was held, the server died before answering its
 * readiness probe, or never became ready) is reported as the IDENTICAL failure for every one of this
 * surface's cases: a declaration-wide precondition failure, never a partial or per-case retry.
 *
 * **`specs/22` M17 P14: candidate-side isolation spans the server's WHOLE lifetime, not one request.**
 * Unlike a `process`/`file`/`library` case (one command, started and finished per case), an `http`
 * surface's `run` starts a SERVER that stays alive, and able to read or write anything on disk, across
 * every one of this surface's cases — hiding `.forge/parity/` only around one request would leave it
 * visible to that same long-lived process between requests. So every case's own overlay INPUT bytes
 * are read from `.forge/parity/` up front, before the server starts (`readOverlaySourceBytes`, still
 * reading `overlayRoot`, never after this point) — `observeOneHttpCase`'s own per-case overlay WRITE
 * (into the tree being observed, never under `.forge/parity/`) still happens per case, from those
 * already-read bytes — and the directory is hidden from the moment the server starts until the moment
 * it stops, bracketing the server's entire lifetime on the candidate side the identical way
 * `observe.ts`'s own per-case bracket covers one command's entire lifetime.
 */
export async function observeHttpSurfaceCases(
  surface: SurfaceDeclaration,
  side: 'reference' | 'candidate',
  root: string,
  overlayRoot: string,
  parentEnv: Readonly<Record<string, string | undefined>>,
): Promise<readonly ParityCaseObservationOutcome[]> {
  const { port, readiness } = requireHttpConfig(surface);

  const preReadInputsByCase: (readonly PreReadOverlayInput[])[] = [];
  for (const parityCase of surface.cases) {
    const inputs: PreReadOverlayInput[] = [];
    for (const input of parityCase.inputs ?? []) {
      inputs.push({ to: input.to, bytes: await readOverlaySourceBytes(overlayRoot, input.from) });
    }
    preReadInputsByCase.push(inputs);
  }

  const runSurface = async (): Promise<readonly ParityCaseObservationOutcome[]> => {
    let handle: HttpServerHandle;
    try {
      handle = await startHttpServer({ run: surface.run, port, readiness, root, parentEnv });
    } catch (cause) {
      if (!isForgeError(cause)) throw cause;
      const failure: ParityCaseObservationOutcome = {
        outcome: 'failed',
        failure: { error: cause },
      };
      return surface.cases.map(() => failure);
    }

    try {
      const outcomes: ParityCaseObservationOutcome[] = [];
      for (let index = 0; index < surface.cases.length; index += 1) {
        const parityCase = surface.cases[index];
        const preReadInputs = preReadInputsByCase[index];
        if (parityCase === undefined || preReadInputs === undefined) continue; // unreachable: same length
        outcomes.push(await observeOneHttpCase({ parityCase, port, root, preReadInputs }));
      }
      return outcomes;
    } finally {
      await handle.stop();
    }
  };
  // `specs/22` M17 P14: exempted from isolation when THIS surface's own `run` (the server start
  // command, the one line this surface ever executes directly) itself names a path under
  // `.forge/parity/probes/` -- never special-cased on surface kind (a real regression a second
  // critic round found and reproduced live against this exact file: nothing about `http` is
  // structurally different from `process`/`file` here, and `13` F-TEST-9's own library-probe
  // wording already implies the pattern is not library-specific). See `observe.ts`'s own identical
  // check, immediately above its own `withParityDirHidden` call, for the full account.
  const referencesProbePath = probeSourcePaths(surface.run).length > 0;
  return side === 'candidate' && !referencesProbePath
    ? withParityDirHidden(root, runSurface)
    : runSurface();
}
