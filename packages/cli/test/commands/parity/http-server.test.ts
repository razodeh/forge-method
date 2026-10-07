/**
 * `checkPortFree`/`startHttpServer` — the `http` surface's own server-lifecycle helper (specs/22 M16
 * P8, `13` F-TEST-9, Q294 Decision 7). Real subprocess fixtures throughout (`QUALITY-BAR.md` R6): no
 * mock anywhere in this file, and every process-liveness claim is a real OS-level check
 * (`process.kill(pid, 0)`), the identical idiom `confined-command.test.ts`'s own detached-grandchild
 * test already establishes.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M16.md P8
 * @see process/SPEC-QUESTIONS.md Q294 Decision 7
 */
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { isForgeError } from '@forge/core/errors';
import { afterEach, describe, expect, it } from 'vitest';

import { checkPortFree, startHttpServer } from '../../../src/commands/parity/http-server.ts';
import { httpServerScript, pickFreePort } from './http-fixtures.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function scratchDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-p8-http-server-'));
  dirs.push(dir);
  return dir;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Force-kills `pid` and swallows "already gone" — a test's own last-resort cleanup, never a
 * substitute for the real assertion it makes first (the identical discipline
 * `confined-command.test.ts`'s own detached-grandchild test uses). */
function forceKill(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
}

describe('checkPortFree (specs/22 M16 P8)', () => {
  it('reports a port as free when nothing is listening on it', async () => {
    const port = await pickFreePort();
    expect(await checkPortFree(port)).toBeUndefined();
  });

  it('accepts an explicit host argument (not only the default)', async () => {
    const port = await pickFreePort();
    expect(await checkPortFree(port, '127.0.0.1')).toBeUndefined();
  });

  it('reports the real OS reason when the port is already held by a real listener', async () => {
    const port = await pickFreePort();
    const holder = createServer();
    await new Promise<void>((resolve) => holder.listen(port, '127.0.0.1', resolve));
    try {
      const reason = await checkPortFree(port);
      expect(reason).toBeDefined();
      expect(reason).toMatch(/EADDRINUSE/);
    } finally {
      await new Promise<void>((resolve) => {
        holder.close(() => {
          resolve();
        });
      });
    }
  });
});

describe('startHttpServer: success (specs/22 M16 P8)', () => {
  it('starts a real server, waits for its readiness probe, and returns a handle whose pid is really alive', async () => {
    const dir = await scratchDir();
    const port = await pickFreePort();
    const scriptPath = path.join(dir, 'server.cjs');
    await writeFile(
      scriptPath,
      httpServerScript({ routes: { 'GET /healthz': { status: 200, body: 'ok' } } }),
      'utf8',
    );
    const handle = await startHttpServer({
      run: `node ${JSON.stringify(scriptPath)} ${String(port)}`,
      port,
      readiness: { path: '/healthz', timeoutMs: 5_000 },
      root: dir,
      parentEnv: process.env,
    });
    try {
      expect(isAlive(handle.pid)).toBe(true);
    } finally {
      await handle.stop();
    }
  });

  it('stop() really kills the server AND a real detached grandchild it spawned, confirmed by a real pid liveness check on BOTH (reuses confined-command.ts’s own killGroup/listDescendantPids)', async () => {
    const dir = await scratchDir();
    const port = await pickFreePort();
    const scriptPath = path.join(dir, 'server.cjs');
    const markerPath = path.join(dir, 'grandchild.pid');
    // The server itself answers readiness, then spawns its OWN detached grandchild (its own session,
    // exactly the shape M16 P10/Q296 found a plain process-group kill alone does not reach) and
    // records that grandchild's real pid to disk before busy-looping forever.
    await writeFile(
      scriptPath,
      [
        "const http = require('node:http');",
        "const { spawn } = require('node:child_process');",
        'const port = Number(process.argv[2]);',
        `const markerPath = ${JSON.stringify(markerPath)};`,
        'const server = http.createServer((req, res) => { res.writeHead(200, {}); res.end("ok"); });',
        "server.listen(port, '127.0.0.1', () => {",
        '  const child = spawn(process.execPath, ["-e", ' +
          '"require(\'fs\').writeFileSync(process.argv[1], String(process.pid)); for(;;){}", markerPath], ' +
          '{ detached: true, stdio: "ignore" });',
        '  child.unref();',
        '});',
      ].join('\n'),
      'utf8',
    );
    const handle = await startHttpServer({
      run: `node ${JSON.stringify(scriptPath)} ${String(port)}`,
      port,
      readiness: { path: '/', timeoutMs: 5_000 },
      root: dir,
      parentEnv: process.env,
    });
    // Give the grandchild a moment to actually spawn and write its own marker.
    let grandchildPid: number | undefined;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const text = (await readFile(markerPath, 'utf8')).trim();
        if (text !== '') {
          grandchildPid = Number(text);
          break;
        }
      } catch {
        // Not written yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(grandchildPid, 'the grandchild never wrote its own pid marker').toBeDefined();
    try {
      expect(isAlive(handle.pid)).toBe(true);
      if (grandchildPid !== undefined) expect(isAlive(grandchildPid)).toBe(true);
      await handle.stop();
      expect(isAlive(handle.pid)).toBe(false);
      if (grandchildPid !== undefined) {
        expect(
          isAlive(grandchildPid),
          'the detached grandchild must not survive stop() -- group kill alone leaves it orphaned',
        ).toBe(false);
      }
    } finally {
      forceKill(grandchildPid);
    }
  }, 15_000);
});

describe('startHttpServer: a held port makes the start refuse, and the held server is never contacted (specs/22 M16 P8)', () => {
  it('refuses RUN-147 when the declared port is already held, and the holder never receives a single request', async () => {
    const dir = await scratchDir();
    const port = await pickFreePort();
    let requestsReceived = 0;
    // `socket.destroy()`, never `.end()`: a half-closed (`.end()`) connection the client side never
    // itself fully closes is enough to make `holder.close(callback)`'s own callback NEVER fire (M16
    // P8 round-2 fix pass, SHOULD-FIX 3 -- confirmed directly, by a minimal standalone repro, in this
    // piece's own report). This test's own `finally` below only reaches `holder.close()` at all once
    // this describe block's real point already held (zero requests), but `.destroy()` is what keeps
    // this fixture itself from becoming a 60s hang instead of a fast, diagnostic failure on some
    // FUTURE regression that removes the pre-start port check this test exists to prove.
    const holder = createServer((socket) => {
      requestsReceived += 1;
      socket.destroy();
    });
    await new Promise<void>((resolve) => holder.listen(port, '127.0.0.1', resolve));
    try {
      const scriptPath = path.join(dir, 'server.cjs');
      await writeFile(scriptPath, httpServerScript({}), 'utf8');
      await expect(
        startHttpServer({
          run: `node ${JSON.stringify(scriptPath)} ${String(port)}`,
          port,
          readiness: { path: '/', timeoutMs: 2_000 },
          root: dir,
          parentEnv: process.env,
        }),
      ).rejects.toSatisfy((cause: unknown) => isForgeError(cause) && cause.code === 'RUN-147');
      // The real point: this harness never even tried to read from the held server.
      expect(requestsReceived).toBe(0);
    } finally {
      await new Promise<void>((resolve) => {
        holder.close(() => {
          resolve();
        });
      });
    }
  });
});

describe('startHttpServer: a server that dies before readiness is a PROMPT typed error, never a hang (specs/22 M16 P8)', () => {
  it('refuses RUN-148 well before the declared readiness timeout when the process exits immediately', async () => {
    const dir = await scratchDir();
    const port = await pickFreePort();
    const scriptPath = path.join(dir, 'server.cjs');
    // Exits immediately -- never calls .listen() at all, so this is unambiguously "died", not "slow".
    await writeFile(scriptPath, 'process.exitCode = 7; process.exit(7);', 'utf8');
    const started = Date.now();
    await expect(
      startHttpServer({
        run: `node ${JSON.stringify(scriptPath)} ${String(port)}`,
        port,
        // A deliberately LONG timeout: if this piece's own code merely waited out the timeout
        // instead of detecting the exit promptly, this assertion's own elapsed-time check below
        // would catch that directly, not just the error code.
        readiness: { path: '/healthz', timeoutMs: 15_000 },
        root: dir,
        parentEnv: process.env,
      }),
    ).rejects.toSatisfy((cause: unknown) => isForgeError(cause) && cause.code === 'RUN-148');
    const elapsedMs = Date.now() - started;
    expect(
      elapsedMs,
      `took ${String(elapsedMs)}ms; a prompt failure must not wait anywhere near the 15000ms timeout`,
    ).toBeLessThan(5_000);
  }, 20_000);
});

describe('startHttpServer: a server that stays alive but never answers its readiness probe times out (specs/22 M16 P8)', () => {
  it('refuses RUN-149 once readiness.timeoutMs elapses, and the real process group is gone afterward (confirmed by a real pid liveness check, not merely trust that killGroup was called)', async () => {
    const dir = await scratchDir();
    const port = await pickFreePort();
    const scriptPath = path.join(dir, 'server.cjs');
    const markerPath = path.join(dir, 'server.pid');
    await writeFile(
      scriptPath,
      httpServerScript({ neverListens: true, pidMarkerPath: markerPath }),
      'utf8',
    );
    const started = Date.now();
    try {
      await startHttpServer({
        run: `node ${JSON.stringify(scriptPath)} ${String(port)}`,
        port,
        readiness: { path: '/healthz', timeoutMs: 1_200 },
        root: dir,
        parentEnv: process.env,
      });
      expect.unreachable('startHttpServer should have refused with RUN-149');
    } catch (cause) {
      expect(isForgeError(cause) && cause.code === 'RUN-149').toBe(true);
    }
    const elapsedMs = Date.now() - started;
    expect(elapsedMs).toBeGreaterThanOrEqual(1_000);

    const pid = Number((await readFile(markerPath, 'utf8')).trim());
    expect(Number.isInteger(pid)).toBe(true);
    try {
      expect(isAlive(pid)).toBe(false);
    } finally {
      forceKill(pid);
    }
  }, 15_000);
});

describe('startHttpServer: a server that dies WHILE a readiness probe attempt is already in flight (specs/22 M16 P8)', () => {
  it('refuses RUN-148 (not RUN-149), naming the real exit code and the stderr it printed before dying, even though the death happens mid-probe rather than between probes', async () => {
    const dir = await scratchDir();
    const port = await pickFreePort();
    const scriptPath = path.join(dir, 'server.cjs');
    // A raw TCP listener (never `http.createServer`): it accepts the readiness probe's own
    // connection, satisfying the HTTP client's connection phase, but never writes a response at all
    // -- so the in-flight probe attempt hangs for its own full per-attempt timeout
    // (`READINESS_ATTEMPT_TIMEOUT_MS`) rather than failing fast with a connection refusal. The
    // process prints to stderr, then exits WHILE that one probe attempt is still pending, so by the
    // time the attempt's own timeout fires, the process has already died -- proving this module
    // detects that promptly as a `RUN-148` (never waiting out the readiness deadline, set here far
    // longer than the single in-flight probe attempt) and surfaces the stderr it printed. This does
    // NOT, by itself, prove which of the module's two `hasExited()` checks is the one that fires --
    // confirmed directly (mutating the after-probe check away, alone, still leaves this test
    // passing): the before-probe check, on the NEXT loop iteration, is what actually catches it
    // here, exactly as for every other "dies mid-poll" scenario this file constructs. See
    // `http-server.ts`'s own "Readiness, precisely" doc comment.
    await writeFile(
      scriptPath,
      [
        "const net = require('node:net');",
        'const port = Number(process.argv[2]);',
        "process.stderr.write('dying on purpose\\n');",
        'const server = net.createServer((socket) => {',
        '  // accept the connection; never respond.',
        '});',
        "server.listen(port, '127.0.0.1', () => {",
        '  setTimeout(() => { process.exit(3); }, 300);',
        '});',
      ].join('\n'),
      'utf8',
    );
    const started = Date.now();
    await expect(
      startHttpServer({
        run: `node ${JSON.stringify(scriptPath)} ${String(port)}`,
        port,
        readiness: { path: '/healthz', timeoutMs: 15_000 },
        root: dir,
        parentEnv: process.env,
      }),
    ).rejects.toSatisfy(
      (cause: unknown) =>
        isForgeError(cause) &&
        cause.code === 'RUN-148' &&
        cause.message.includes('exited with code 3') &&
        cause.message.includes('dying on purpose'),
    );
    // Well under the 15s readiness deadline: the in-flight probe's own ~1s per-attempt timeout is
    // what actually bounds this, not the overall readiness timeout.
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 20_000);
});

describe('startHttpServer: a server that stays ALIVE and accepts the connection, but never answers even one readiness probe attempt (specs/22 M16 P8)', () => {
  it('retries past the per-attempt timeout and still eventually refuses RUN-149 once the overall readiness deadline elapses', async () => {
    const dir = await scratchDir();
    const port = await pickFreePort();
    const scriptPath = path.join(dir, 'server.cjs');
    const markerPath = path.join(dir, 'server.pid');
    // Accepts the TCP connection (so the readiness probe's own request genuinely reaches the server)
    // but never writes a byte back and never exits -- every probe attempt must hang for its own full
    // per-attempt timeout (`READINESS_ATTEMPT_TIMEOUT_MS`, ~1s) rather than failing fast, and the
    // process stays alive throughout (unlike the "dies mid-probe" fixture above), so this is the one
    // real repro of "the readiness deadline elapses while the server itself never answers a single
    // attempt," distinct from "the server died."
    await writeFile(
      scriptPath,
      [
        "const net = require('node:net');",
        'const port = Number(process.argv[2]);',
        `require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, String(process.pid));`,
        'const server = net.createServer((socket) => {',
        '  // accept the connection; never respond; never close it.',
        '});',
        "server.listen(port, '127.0.0.1');",
      ].join('\n'),
      'utf8',
    );
    const started = Date.now();
    try {
      await startHttpServer({
        run: `node ${JSON.stringify(scriptPath)} ${String(port)}`,
        port,
        // Comfortably longer than one ~1s per-attempt timeout, so at least one full attempt is
        // retried, but still short enough to keep this test fast.
        readiness: { path: '/healthz', timeoutMs: 1_800 },
        root: dir,
        parentEnv: process.env,
      });
      expect.unreachable('startHttpServer should have refused with RUN-149');
    } catch (cause) {
      expect(isForgeError(cause) && cause.code === 'RUN-149').toBe(true);
    }
    const elapsedMs = Date.now() - started;
    // At least one full per-attempt timeout must have elapsed (otherwise this test would not be
    // proving what it claims): comfortably above the ~1s per-attempt timeout, comfortably below a
    // hang.
    expect(elapsedMs).toBeGreaterThanOrEqual(900);
    expect(elapsedMs).toBeLessThan(10_000);

    const pid = Number((await readFile(markerPath, 'utf8')).trim());
    try {
      expect(isAlive(pid)).toBe(false);
    } finally {
      forceKill(pid);
    }
  }, 20_000);
});
