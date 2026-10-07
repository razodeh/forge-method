/**
 * The `http` surface's own server-lifecycle helper (`specs/22` M16 P8, `13` F-TEST-9, `process/
 * SPEC-QUESTIONS.md` Q294 Decision 7): verify the declared loopback port is free, start the
 * declaration's own vetted command as a real, detached process group, poll its readiness probe while
 * watching the child stays alive, and kill the whole group on request.
 *
 * **Why this is not `runConfinedCommand`.** `@forge/engine/dispatch`'s `runConfinedCommand`
 * (`confined-command.ts`) AWAITS the child it starts to exit, because every other surface's `run` is
 * a command that finishes — a `process`/`library` probe, a `file`-producing script. An `http`
 * surface's `run` starts a SERVER, which never exits on its own; there is no "await the result" to
 * give back. This module is this piece's own equivalent for exactly that one different shape, built
 * by composing the SAME real primitives `runConfinedCommand` itself is built from — a scrubbed
 * environment (`scrubbedEnvironment`) and the real, already-fixed "kill the whole group AND walk
 * real `ps`-reported descendants individually" logic (`killGroup`/`listDescendantPids`, now exported
 * from `confined-command.ts` for exactly this reuse — see this piece's own report for why that
 * export, rather than a second independently-written copy, is the correct DECISION here) — never a
 * third, independently-invented way to make sure a child is really gone.
 *
 * **Port-free check, precisely (Q294 Decision 7).** The literal declared port is verified free
 * BEFORE the server starts: a held port makes the whole surface's cases `error`, and the harness
 * never contacts whatever is already listening there and treats it as this surface's own server. The
 * check and the real start are two separate operations (bind-and-release, then spawn), which is an
 * inherent, disclosed TOCTOU window — see this module's own report, "Discloses".
 *
 * **Readiness, precisely.** After the process starts, its readiness probe is polled with a GET to
 * the declared `readiness.path` while independently watching whether the child has already exited —
 * checked once at the top of every loop iteration (before that iteration's own probe attempt even
 * starts) and again immediately after one resolves. Only the FIRST of those two checks is actually
 * demonstrated, by this module's own tests, to be the mechanism that catches a child dying mid-poll:
 * in every scenario this piece's test suite constructs, that death is caught on the NEXT iteration's
 * own before-probe check, after the failed probe attempt resolves and the short
 * `READINESS_POLL_INTERVAL_MS` sleep elapses — confirmed directly, not assumed (this piece's own
 * report): mutating the after-probe check away, alone, still leaves every test in this suite passing,
 * including the one built specifically around a death WHILE a probe attempt is in flight. The
 * after-probe check is kept anyway, as additional, plausible-but-unproven redundancy — it may be
 * load-bearing on a different platform, Node version, or timing this suite has not constructed, and
 * neither of this piece's own round-2 critics disproved that, only that it is never the one that
 * fires here — not because both checks are independently shown to make a mid-poll death PROMPT.
 * Promptness here is demonstrated by the combination of the before-probe check and the short, bounded
 * poll interval between iterations, which is what `13` F-TEST-9's own "a server that crashes before
 * answering its readiness probe must become a typed error promptly, never a hang" sentence is
 * actually satisfied by.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M16.md P8
 * @see process/SPEC-QUESTIONS.md Q294 Decision 7
 */
import { createServer } from 'node:net';
import http from 'node:http';

import { ForgeError } from '@forge/core/errors';
import { killGroup, scrubbedEnvironment } from '@forge/engine/dispatch';
import { execa } from 'execa';

import type { HttpReadinessProbe } from './declaration-types.ts';
import { PINNED_ENV } from './pinned-env.ts';

/** Every case's request and the readiness probe both target this literal address, never `localhost`
 * (which a `/etc/hosts` override or a dual-stack resolver could send to `::1` instead of `127.0.0.1`,
 * a DIFFERENT socket a server bound to one specific family would not be listening on) and never
 * `::1` (a server that binds only the IPv4 wildcard, the common default, would never be reachable
 * there at all). One fixed, unambiguous address removes an entire class of "which loopback" bugs. */
export const LOOPBACK_HOST = '127.0.0.1';

/** How often the readiness probe is retried while the port is not yet answering (a fresh connection
 * refusal while the server's own listener has not bound yet is the expected, ordinary case, not a
 * failure). */
const READINESS_POLL_INTERVAL_MS = 50;

/** The longest any SINGLE readiness probe attempt is allowed to hang before being treated as "not
 * ready yet" and retried — bounded well under any realistic `readiness.timeoutMs` so the overall
 * poll loop's own deadline, not a single hung attempt, is what decides a timeout. */
const READINESS_ATTEMPT_TIMEOUT_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Whether `port` on {@link LOOPBACK_HOST} can be bound right now: briefly binds a throwaway
 * listener and releases it immediately. `undefined` means free; otherwise the OS error code/message
 * that bind failed with (`EADDRINUSE` for an ordinary held port, but never assumed — any bind
 * failure at all is treated as "not usable", the conservative reading: a port this process cannot
 * bind for WHATEVER reason is a port the real server could not have bound either).
 *
 * A genuine, disclosed TOCTOU window: another process can bind the identical port in the gap between
 * this check releasing it and {@link startHttpServer}'s own spawn binding it for real. Not a flaw
 * this function can close by itself — see this module's own report.
 */
export async function checkPortFree(
  port: number,
  host: string = LOOPBACK_HOST,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', (cause: NodeJS.ErrnoException) => {
      resolve(`${cause.code ?? 'EUNKNOWN'}: ${cause.message}`);
    });
    probe.once('listening', () => {
      probe.close(() => {
        resolve(undefined);
      });
    });
    probe.listen(port, host);
  });
}

/** One readiness probe attempt: a plain `GET` to `readiness.path` (the probe is a liveness check,
 * not a case — it has no method/headers/body of its own to declare), resolving `true` the moment a
 * complete HTTP response of ANY status is read back, `false` on any error, refusal or the attempt's
 * own timeout (`declaration-types.ts`'s own `HttpReadinessProbe` doc comment has the full DECISION on
 * why any status counts). */
function probeReadinessOnce(port: number, probePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const request = http.request(
      {
        host: LOOPBACK_HOST,
        port,
        path: probePath,
        method: 'GET',
        timeout: READINESS_ATTEMPT_TIMEOUT_MS,
      },
      (response) => {
        response.resume(); // drain and discard: readiness cares only that a response arrived.
        response.on('end', () => {
          resolve(true);
        });
        response.on('error', () => {
          resolve(false);
        });
      },
    );
    // `request.destroy()` with no argument emits no `error` event (only `close`), confirmed by
    // direct experiment: without an explicit argument here, a probe attempt that genuinely times out
    // would neither resolve `true` nor `false`, hanging the whole readiness loop instead of letting
    // it retry (`http-client.ts`'s own identical fix has the fuller account).
    request.on('timeout', () => {
      request.destroy(new Error('readiness probe attempt timed out'));
    });
    request.on('error', () => {
      resolve(false);
    });
    request.end();
  });
}

/** How the child ended, for a `RUN-148` ("exited before answering its readiness probe") message —
 * never a raw `Error` object interpolated directly (`QUALITY-BAR.md` R2: the observed value, stated
 * plainly). */
function describeExit(code: number | null, signal: NodeJS.Signals | null): string {
  if (signal !== null) return `ended by signal ${signal}`;
  return `exited with code ${String(code)}`;
}

/** A running `http` surface server: its pid (for a test's own real OS-level liveness check) and a
 * `stop` that kills the whole group and waits for the OS to confirm the process is actually gone —
 * never a fire-and-forget signal a caller cannot rely on having taken effect by the time it returns
 * (the very next stability round's own {@link checkPortFree} needs the port released by THEN, not
 * merely "a kill signal was sent at some point"). */
export interface HttpServerHandle {
  readonly pid: number;
  stop(): Promise<void>;
}

/** {@link startHttpServer}'s own inputs: the declaration's vetted `run` (the server-start command),
 * the declared literal `port` and `readiness` probe (`13` F-TEST-9's surfaces bullet), the tree to
 * run it in, and the parent environment to scrub (`scrubbedEnvironment`) before handing it to the
 * child — the identical shape every other surface's own command already takes. */
export interface StartHttpServerOptions {
  readonly run: string;
  readonly port: number;
  readonly readiness: HttpReadinessProbe;
  readonly root: string;
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
}

/**
 * Starts the declaration's own vetted `run` command as a detached process group under the identical
 * scrubbed, pinned environment every other surface's commands run under, verifies the declared port
 * was free immediately before doing so, and polls readiness before returning.
 *
 * @throws {ForgeError} `RUN-147` if the port cannot be bound right now.
 * @throws {ForgeError} `RUN-148` if the server process exits before its readiness probe ever
 * succeeds.
 * @throws {ForgeError} `RUN-149` if the server process stays alive but never answers its readiness
 * probe within `readiness.timeoutMs`.
 */
export async function startHttpServer(options: StartHttpServerOptions): Promise<HttpServerHandle> {
  const portProblem = await checkPortFree(options.port);
  if (portProblem !== undefined) {
    throw new ForgeError('RUN-147', { port: options.port, detail: portProblem });
  }

  const env = scrubbedEnvironment(options.parentEnv, PINNED_ENV);
  // Deliberately NOT annotated `: ResultPromise` -- execa's own return type is a conditional type
  // keyed on the EXACT options object passed, and widening it to the generic `ResultPromise`
  // (defaulting its own type parameter) loses enough optional-property exactness to fail
  // `exactOptionalPropertyTypes`; inference gives the precise type, which already has every member
  // (`pid`, `exitCode`, `signalCode`, `on`, `kill`, and the promise interface) this function uses.
  // `reject: false` means this promise ALWAYS resolves, never rejects -- confirmed by direct
  // experiment, not assumed (this piece's own report has the transcript): even a completely missing
  // program resolves, because `shell: true` means the SHELL always spawns successfully and reports
  // the failure (a real `/bin/sh`-reported exit code, 127 for "command not found") as an ordinary
  // non-zero exit, which `reject: false` folds into the resolved result rather than a rejection --
  // execa's own documented contract for the option. So, under `shell: true` specifically, there is no
  // live "failed to spawn at all" case for this module to detect SEPARATELY from an ordinary non-zero
  // exit, and no promise here ever needs a `.catch()`.
  const subprocess = execa(options.run, {
    cwd: options.root,
    shell: true,
    env,
    extendEnv: false,
    stdin: 'ignore',
    detached: process.platform !== 'win32',
    reject: false,
  });

  const pid = subprocess.pid;
  if (pid === undefined) {
    // Unreachable under `shell: true` (see this function's own report section), kept only because
    // `Subprocess['pid']` is typed `number | undefined` and a silent `!`/`as` past that would be an
    // unexplained `as` this piece's own `QUALITY-BAR.md` R1 refuses -- the identical "already proven
    // impossible, reported the same way as a real unreachable branch" shape `observe.ts`'s own
    // `composeArgs` re-check already uses.
    throw new Error(
      `unreachable: execa with shell:true never leaves "pid" undefined, for ${options.run}`,
    );
  }

  /** Whether the child has already ended, by any means this module can see: `exitCode`/`signalCode`
   * are the identical properties a plain `node:child_process.ChildProcess` sets the moment its own
   * real `exit` event fires (execa's `Subprocess` type passes them through unchanged), so reading
   * them needs no event listener of this module's own and cannot miss a race with one. */
  const hasExited = (): boolean => subprocess.exitCode !== null || subprocess.signalCode !== null;

  /** Builds the `RUN-148` detail once the child is known to have ended: awaiting `subprocess` itself
   * (never rejecting, `reject: false`) is what gives this module the buffered stdout/stderr tail
   * alongside the real exit code/signal — the identical "name the command, quote what it said"
   * shape `RUN-127` already gives a failed `setup` command. */
  async function describeChildExit(): Promise<string> {
    const result = await subprocess;
    const ended = describeExit(result.exitCode ?? null, result.signal ?? null);
    const tail = (result.stderr || result.stdout || '').slice(0, 2000).trim();
    return tail === '' ? ended : `${ended}: ${tail}`;
  }

  // A `setTimeout` that flips a flag, never `Date.now()` arithmetic (`QUALITY-BAR.md` R10: "take the
  // time from an injected clock" -- the identical pattern `confined-command.ts`'s own
  // `armConfinedTimeout` already uses for a real subprocess timeout, reused in shape here since this
  // is the same class of concern: a real wall-clock deadline against a real external process, not a
  // computation R10 asks to be made deterministic).
  const timedOutState = { value: false };
  const readinessTimer = setTimeout(() => {
    timedOutState.value = true;
  }, options.readiness.timeoutMs);
  // Read through a function, never the bare variable: the identical reason {@link hasExited} reads
  // `subprocess.exitCode`/`spawnError` through a function rather than a captured local -- a plain
  // `let` boolean only ever written inside the timer callback above gives `no-unnecessary-condition`
  // nothing to narrow across (TypeScript's own flow analysis cannot see the callback as a possible
  // mutation of a bare local the way it can an object field read back through a call), so it reads
  // the check below as "always false" although it plainly is not.
  const readinessTimedOut = (): boolean => timedOutState.value;
  try {
    for (;;) {
      if (hasExited()) {
        killGroup(subprocess);
        throw new ForgeError('RUN-148', {
          command: options.run,
          detail: await describeChildExit(),
        });
      }
      const ready = await probeReadinessOnce(options.port, options.readiness.path);
      if (ready) break;
      if (hasExited()) {
        killGroup(subprocess);
        throw new ForgeError('RUN-148', {
          command: options.run,
          detail: await describeChildExit(),
        });
      }
      if (readinessTimedOut()) {
        killGroup(subprocess);
        // Awaited before throwing (the identical reason `stop()` awaits below): a caller that catches
        // this refusal must be able to trust the process group is REALLY gone by the time control
        // returns to it, not merely that a signal was sent at some point -- confirmed necessary by a
        // real, reproduced flake (this piece's own report) where an immediate post-throw liveness
        // check still found the process alive without this await. Never `.catch(...)`: `reject: false`
        // already means this promise only ever resolves (this function's own report has the
        // confirming experiment), so there is nothing here to catch.
        await subprocess;
        throw new ForgeError('RUN-149', {
          path: options.readiness.path,
          timeoutMs: options.readiness.timeoutMs,
        });
      }
      await sleep(READINESS_POLL_INTERVAL_MS);
    }
  } finally {
    clearTimeout(readinessTimer);
  }

  return {
    pid,
    stop: async () => {
      killGroup(subprocess);
      await subprocess;
    },
  };
}
