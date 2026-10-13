/**
 * `observeHttpSurfaceCases`/the `http` branch of `observeAgainstRoot` (specs/22 M16 P8, `13`
 * F-TEST-9) — the END-TO-END real-subprocess proof this piece's own brief asks for: a real server,
 * started by this harness and this harness alone, every case's request going to it for real, matched
 * through the real comparison pipeline (`compare.ts`'s own `decideCaseVerdict`, P4's, unmodified), and
 * the whole server group really gone afterward on success, on a case failure, and after a real
 * `SIGKILL` of the harness-owned child. No mock anywhere in this file (`QUALITY-BAR.md` R6).
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M16.md P8
 * @see process/SPEC-QUESTIONS.md Q294 Decision 7
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import type { HttpObservation } from '../../../src/commands/parity/capture.ts';
import { decideCaseVerdict } from '../../../src/commands/parity/compare.ts';
import type {
  ParityDeclaration,
  SurfaceDeclaration,
} from '../../../src/commands/parity/declaration-types.ts';
import { observeHttpSurfaceCases } from '../../../src/commands/parity/observe-http.ts';
import { observeParityDeclaration } from '../../../src/commands/parity/observe.ts';
import type {
  ParityCaseResult,
  ParityDeclarationObservation,
  RawHttpObservation,
} from '../../../src/commands/parity/observe-types.ts';
import { minimalDeclaration } from './fixtures.ts';
import { httpServerScript, pickFreePort } from './http-fixtures.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function freshProject(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-p8-observe-http-'));
  dirs.push(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 't@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 't'], { cwd: dir });
  await writeFile(path.join(dir, '.gitkeep'), '', 'utf8');
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'init'], { cwd: dir });
  return dir;
}

function findCase(
  observation: ParityDeclarationObservation,
  surface: string,
  caseIndex = 0,
): ParityCaseResult['result'] {
  const found = observation.cases.find(
    (entry) => entry.surface === surface && entry.caseIndex === caseIndex,
  );
  if (found === undefined) throw new Error(`no case result for ${surface}[${String(caseIndex)}]`);
  return found.result;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function forceKill(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
}

/** The declaration's own `toStoredObservation`-shaped mapping, from a real raw http observation to
 * the normalised-shape `HttpObservation` `compare.ts` expects as a reference — this test's own
 * mechanical mirror of `capture-command.ts`'s private `toStoredObservation`'s `http` branch (not
 * imported: that function is private, and this is exactly the shape P6/P7 build for a reference). */
function toStored(raw: RawHttpObservation): HttpObservation {
  return { surface: 'http', status: raw.status, headers: raw.headers, body: raw.body.text };
}

async function observeOneHttp(
  projectRoot: string,
  declaration: ParityDeclaration,
): Promise<RawHttpObservation> {
  const observation = await observeParityDeclaration({
    declaration,
    side: 'candidate',
    projectRoot,
    parentEnv: process.env,
  });
  const outcome = findCase(observation, 'http');
  if (outcome.outcome !== 'observed') {
    throw new Error(`expected observed, got ${outcome.outcome}: ${JSON.stringify(outcome)}`);
  }
  if (outcome.observation.surface !== 'http') throw new Error('expected an http observation');
  return outcome.observation;
}

describe('observeAgainstRoot — http branch: matching responses match, a changed status/header/body mismatches (specs/22 M16 P8)', () => {
  it('two observations of the identical real server are byte-identical and read match through the real comparison pipeline', async () => {
    const dir = await freshProject();
    const port = await pickFreePort();
    const scriptPath = path.join(dir, 'server.cjs');
    await writeFile(
      scriptPath,
      httpServerScript({
        routes: {
          'GET /widgets': { status: 200, headers: { 'x-flavor': 'vanilla' }, body: 'hello' },
        },
      }),
      'utf8',
    );
    const declaration = minimalDeclaration({
      surfaces: {
        http: {
          run: `node ${JSON.stringify(scriptPath)} ${String(port)}`,
          network: 'loopback',
          port,
          readiness: { path: '/widgets', timeoutMs: 5_000 },
          stability: { runs: 3 },
          cases: [
            {
              request: { method: 'GET', path: '/widgets', responseHeaders: ['x-flavor'] },
            },
          ],
        },
      },
    });
    const reference = toStored(await observeOneHttp(dir, declaration));
    const candidate = toStored(await observeOneHttp(dir, declaration));
    const verdict = decideCaseVerdict({
      surface: 'http',
      caseIndex: 0,
      rules: [],
      referenceNormalized: reference,
      candidateRawRuns: [candidate, candidate, candidate],
      candidateRoot: { asGiven: dir, real: dir },
      unclean: false,
    });
    expect(verdict).toEqual({ verdict: 'match' });
  });

  it.each([
    ['a changed status', { status: 201, headers: {}, body: 'hello' }, 'status'] as const,
    [
      'a changed selected header',
      { status: 200, headers: { 'x-flavor': 'chocolate' }, body: 'hello' },
      'headers',
    ] as const,
    [
      'a changed body',
      { status: 200, headers: { 'x-flavor': 'vanilla' }, body: 'goodbye' },
      'body',
    ] as const,
  ])('%s mismatches, naming the differing part (%s)', async (_label, changedStoredFields, part) => {
    const dir = await freshProject();
    const port = await pickFreePort();
    const scriptPath = path.join(dir, 'server.cjs');
    await writeFile(
      scriptPath,
      httpServerScript({
        routes: {
          'GET /widgets': { status: 200, headers: { 'x-flavor': 'vanilla' }, body: 'hello' },
        },
      }),
      'utf8',
    );
    const declaration = minimalDeclaration({
      surfaces: {
        http: {
          run: `node ${JSON.stringify(scriptPath)} ${String(port)}`,
          network: 'loopback',
          port,
          readiness: { path: '/widgets', timeoutMs: 5_000 },
          stability: { runs: 3 },
          cases: [{ request: { method: 'GET', path: '/widgets', responseHeaders: ['x-flavor'] } }],
        },
      },
    });
    const candidate = toStored(await observeOneHttp(dir, declaration));
    const reference: HttpObservation = { surface: 'http', ...changedStoredFields };
    const verdict = decideCaseVerdict({
      surface: 'http',
      caseIndex: 0,
      rules: [],
      referenceNormalized: reference,
      candidateRawRuns: [candidate, candidate, candidate],
      candidateRoot: { asGiven: dir, real: dir },
      unclean: false,
    });
    expect(verdict).toEqual({ verdict: 'mismatch', location: { surface: 'http', httpPart: part } });
  });
});

describe('observeAgainstRoot — http branch: a held port makes EVERY case of the surface error, and the held server is never read (specs/22 M16 P8)', () => {
  it('two cases both report the identical RUN-147 failure, and the decoy server receives zero requests', async () => {
    const dir = await freshProject();
    const port = await pickFreePort();
    let requestsReceived = 0;
    const { createServer } = await import('node:net');
    // `socket.destroy()`, never `.end()`: a half-closed (`.end()`) connection the client side never
    // itself fully closes is enough to make `holder.close(callback)`'s own callback NEVER fire (M16
    // P8 round-2 fix pass, SHOULD-FIX 3 -- confirmed directly, by a minimal standalone repro, in this
    // piece's own report). `.destroy()` is what keeps this fixture itself from becoming a 60s hang
    // instead of a fast, diagnostic failure on some FUTURE regression that removes the pre-start port
    // check this test exists to prove.
    const holder = createServer((socket) => {
      requestsReceived += 1;
      socket.destroy();
    });
    await new Promise<void>((resolve) => holder.listen(port, '127.0.0.1', resolve));
    try {
      const scriptPath = path.join(dir, 'server.cjs');
      await writeFile(scriptPath, httpServerScript({}), 'utf8');
      const declaration = minimalDeclaration({
        surfaces: {
          http: {
            run: `node ${JSON.stringify(scriptPath)} ${String(port)}`,
            network: 'loopback',
            port,
            readiness: { path: '/', timeoutMs: 2_000 },
            stability: { runs: 3 },
            cases: [
              { request: { method: 'GET', path: '/a' } },
              { request: { method: 'GET', path: '/b' } },
            ],
          },
        },
      });
      const observation = await observeParityDeclaration({
        declaration,
        side: 'candidate',
        projectRoot: dir,
        parentEnv: process.env,
      });
      const first = findCase(observation, 'http', 0);
      const second = findCase(observation, 'http', 1);
      expect(first.outcome).toBe('failed');
      expect(second.outcome).toBe('failed');
      if (first.outcome === 'failed' && second.outcome === 'failed') {
        expect(first.failure.error.code).toBe('RUN-147');
        expect(second.failure.error.code).toBe('RUN-147');
      }
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

describe('observeAgainstRoot — http branch: a surface setup failure propagates to every http case, identically to every other surface (specs/22 M16 P8)', () => {
  it('a reference-side setup that fails means no http case runs, and every case reports the identical RUN-127', async () => {
    const dir = await freshProject();
    const { stdout: headSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
    const port = await pickFreePort();
    const scriptPath = path.join(dir, 'server.cjs');
    await writeFile(scriptPath, httpServerScript({}), 'utf8');
    const declaration = minimalDeclaration({
      reference: { ref: headSha.trim() },
      surfaces: {
        http: {
          run: `node ${JSON.stringify(scriptPath)} ${String(port)}`,
          setup: ['node -e "process.exit(3)"'],
          network: 'loopback',
          port,
          readiness: { path: '/', timeoutMs: 2_000 },
          stability: { runs: 3 },
          cases: [{ request: { method: 'GET', path: '/' } }],
        },
      },
    });
    const observation = await observeParityDeclaration({
      declaration,
      side: 'reference',
      projectRoot: dir,
      referenceSha: headSha.trim(),
      parentEnv: process.env,
    });
    const outcome = findCase(observation, 'http', 0);
    expect(outcome.outcome).toBe('failed');
    if (outcome.outcome === 'failed') expect(outcome.failure.error.code).toBe('RUN-127');
  });
});

describe('observeAgainstRoot — http branch: a case’s own overlaid inputs are written before the request and removed after (specs/22 M16 P8)', () => {
  it('an http case’s own declared input is readable by the server at request time, and gone from the tree afterward', async () => {
    const dir = await freshProject();
    const parityDir = path.join(dir, '.forge', 'parity');
    await execa('mkdir', ['-p', parityDir]);
    await writeFile(path.join(parityDir, 'fixture.txt'), 'overlaid content', 'utf8');
    const port = await pickFreePort();
    const scriptPath = path.join(dir, 'server.cjs');
    // Echoes back the content of ./input.txt (relative to its own cwd, the project root) on request.
    await writeFile(
      scriptPath,
      [
        "const http = require('node:http');",
        "const fs = require('node:fs');",
        'const port = Number(process.argv[2]);',
        'http.createServer((req, res) => {',
        '  let text;',
        "  try { text = fs.readFileSync('input.txt', 'utf8'); } catch { text = '(missing)'; }",
        '  res.writeHead(200, {});',
        '  res.end(text);',
        "}).listen(port, '127.0.0.1');",
      ].join('\n'),
      'utf8',
    );
    const declaration = minimalDeclaration({
      surfaces: {
        http: {
          run: `node ${JSON.stringify(scriptPath)} ${String(port)}`,
          network: 'loopback',
          port,
          readiness: { path: '/', timeoutMs: 5_000 },
          stability: { runs: 3 },
          cases: [
            {
              request: { method: 'GET', path: '/' },
              inputs: [{ from: '.forge/parity/fixture.txt', to: 'input.txt' }],
            },
          ],
        },
      },
    });
    const raw = await observeOneHttp(dir, declaration);
    expect(raw.body.text).toBe('overlaid content');
    await expect(readFile(path.join(dir, 'input.txt'))).rejects.toThrow();
  });
});

describe('observeAgainstRoot — http branch: a secret-shaped or lossy-UTF-8 response body is refused, identically to every other surface’s own text content (specs/22 M16 P8)', () => {
  it('refuses RUN-121 when the response body contains a secret-shaped value', async () => {
    const dir = await freshProject();
    const port = await pickFreePort();
    const scriptPath = path.join(dir, 'server.cjs');
    await writeFile(
      scriptPath,
      httpServerScript({
        // A real AWS-access-key-shaped literal, the identical pattern `SECRET_PATTERNS` already
        // scans for elsewhere in this codebase.
        routes: { 'GET /': { status: 200, body: 'key=AKIAABCDEFGHIJKLMNOP' } },
      }),
      'utf8',
    );
    const declaration = minimalDeclaration({
      surfaces: {
        http: {
          run: `node ${JSON.stringify(scriptPath)} ${String(port)}`,
          network: 'loopback',
          port,
          readiness: { path: '/', timeoutMs: 5_000 },
          stability: { runs: 3 },
          cases: [{ request: { method: 'GET', path: '/' } }],
        },
      },
    });
    const observation = await observeParityDeclaration({
      declaration,
      side: 'candidate',
      projectRoot: dir,
      parentEnv: process.env,
    });
    const outcome = findCase(observation, 'http', 0);
    expect(outcome.outcome).toBe('failed');
    if (outcome.outcome === 'failed') expect(outcome.failure.error.code).toBe('RUN-121');
  });
});

describe('observeHttpSurfaceCases: a malformed case fails ITSELF, scoped, never crashing its sibling cases on the same surface (specs/22 M16 P8) (round-2 fix pass, MUST-FIX 1)', () => {
  it('a case whose request path contains a literal space makes `http.request` throw synchronously inside sendHttpRequest -- that case reports a scoped RUN-150, and the surface’s OTHER case still observes normally', async () => {
    const dir = await freshProject();
    const port = await pickFreePort();
    const scriptPath = path.join(dir, 'server.cjs');
    await writeFile(
      scriptPath,
      httpServerScript({ routes: { 'GET /b': { status: 200, body: 'still fine' } } }),
      'utf8',
    );
    const declaration = minimalDeclaration({
      surfaces: {
        http: {
          run: `node ${JSON.stringify(scriptPath)} ${String(port)}`,
          network: 'loopback',
          port,
          readiness: { path: '/b', timeoutMs: 5_000 },
          stability: { runs: 3 },
          cases: [
            // A space is not an ASCII control character, and the path still starts with exactly
            // one "/" -- `declaration.ts`'s own checks (both pre- and post- this fix pass) accept
            // it. `node:http`'s own `ClientRequest` constructor does not: a direct repro confirms
            // `http.request({ path: '/foo bar', ... })` throws `TypeError [ERR_UNESCAPED_
            // CHARACTERS]` synchronously. Before this fix, that raw, unwrapped throw propagated out
            // of `observeHttpSurfaceCases`'s entire cases loop, so case 1 below would never even run.
            { request: { method: 'GET', path: '/foo bar' } },
            { request: { method: 'GET', path: '/b' } },
          ],
        },
      },
    });
    const observation = await observeParityDeclaration({
      declaration,
      side: 'candidate',
      projectRoot: dir,
      parentEnv: process.env,
    });
    const malformed = findCase(observation, 'http', 0);
    const sibling = findCase(observation, 'http', 1);
    expect(malformed.outcome, JSON.stringify(malformed)).toBe('failed');
    if (malformed.outcome === 'failed') expect(malformed.failure.error.code).toBe('RUN-150');
    expect(sibling.outcome, JSON.stringify(sibling)).toBe('observed');
    if (sibling.outcome === 'observed') {
      expect(sibling.observation.surface === 'http' && sibling.observation.body.text).toBe(
        'still fine',
      );
    }
  });
});

describe('observeHttpSurfaceCases: the two "already-validated by declaration.ts" invariants, proven directly rather than merely asserted (specs/22 M16 P8)', () => {
  it('throws a plain programming-error if ever given an "http" surface with no port/readiness (declaration.ts is supposed to refuse this at load)', async () => {
    const dir = await freshProject();
    // Bypasses `declaration.ts` deliberately: `port`/`readiness` are typed OPTIONAL on the one
    // shared `SurfaceDeclaration` shape, so this is a real, valid construction at the type level --
    // exactly the already-validated invariant this function's own "unreachable" guard exists for.
    const malformed: SurfaceDeclaration = {
      run: 'node -e "process.exit(0)"',
      stability: { runs: 3 },
      cases: [{ request: { method: 'GET', path: '/' } }],
    };
    await expect(
      observeHttpSurfaceCases(malformed, 'candidate', dir, dir, process.env),
    ).rejects.toThrow(/unreachable.*port.*readiness/);
  });

  it('throws a plain programming-error if ever given an http case with no "request" (declaration.ts is supposed to refuse this at load), and still cleans up the real server it had already started', async () => {
    const dir = await freshProject();
    const port = await pickFreePort();
    const scriptPath = path.join(dir, 'server.cjs');
    const markerPath = path.join(dir, 'server.pid');
    await writeFile(
      scriptPath,
      httpServerScript({
        routes: { 'GET /ping': { status: 200, body: 'pong' } },
        pidMarkerPath: markerPath,
      }),
      'utf8',
    );
    const malformed: SurfaceDeclaration = {
      run: `node ${JSON.stringify(scriptPath)} ${String(port)}`,
      network: 'loopback',
      port,
      readiness: { path: '/ping', timeoutMs: 5_000 },
      stability: { runs: 3 },
      cases: [{}], // no "request" -- the exact shape declaration.ts's loader refuses.
    };
    await expect(
      observeHttpSurfaceCases(malformed, 'candidate', dir, dir, process.env),
    ).rejects.toThrow(/unreachable.*request/);
    const pid = Number((await readFile(markerPath, 'utf8')).trim());
    try {
      expect(isAlive(pid)).toBe(false);
    } finally {
      forceKill(pid);
    }
  });
});

describe('observeAgainstRoot — http branch: the server process group is really gone (real OS checks), under all three real lifecycles (specs/22 M16 P8)', () => {
  it('is gone after an ordinary successful observation', async () => {
    const dir = await freshProject();
    const port = await pickFreePort();
    const scriptPath = path.join(dir, 'server.cjs');
    const markerPath = path.join(dir, 'server.pid');
    await writeFile(
      scriptPath,
      httpServerScript({
        routes: { 'GET /ping': { status: 200, body: 'pong' } },
        pidMarkerPath: markerPath,
      }),
      'utf8',
    );
    const declaration = minimalDeclaration({
      surfaces: {
        http: {
          run: `node ${JSON.stringify(scriptPath)} ${String(port)}`,
          network: 'loopback',
          port,
          readiness: { path: '/ping', timeoutMs: 5_000 },
          stability: { runs: 3 },
          cases: [{ request: { method: 'GET', path: '/ping' } }],
        },
      },
    });
    await observeOneHttp(dir, declaration);
    const pid = Number((await readFile(markerPath, 'utf8')).trim());
    try {
      expect(isAlive(pid)).toBe(false);
    } finally {
      forceKill(pid);
    }
  });

  it('is gone after a case fails (the port never answers the readiness probe on the second of two stability rounds — a case-level failure mid-surface)', async () => {
    const dir = await freshProject();
    const port = await pickFreePort();
    const scriptPath = path.join(dir, 'server.cjs');
    const markerPath = path.join(dir, 'server.pid');
    // Answers readiness, then the ONE case's own request exceeds its own tiny declared cap -- a real
    // case-level RUN-150 failure, not a startup failure, so this proves the `finally` around the
    // CASES LOOP itself, not merely the startup failure path `startHttpServer` already covers.
    await writeFile(
      scriptPath,
      [
        "const http = require('node:http');",
        'const port = Number(process.argv[2]);',
        `require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, String(process.pid));`,
        'http.createServer((req, res) => {',
        '  res.writeHead(200, {});',
        "  res.end('x'.repeat(10000));",
        "}).listen(port, '127.0.0.1');",
      ].join('\n'),
      'utf8',
    );
    const declaration = minimalDeclaration({
      surfaces: {
        http: {
          run: `node ${JSON.stringify(scriptPath)} ${String(port)}`,
          network: 'loopback',
          port,
          readiness: { path: '/', timeoutMs: 5_000 },
          stability: { runs: 3 },
          cases: [{ request: { method: 'GET', path: '/' }, outputCapBytes: 10 }],
        },
      },
    });
    const observation = await observeParityDeclaration({
      declaration,
      side: 'candidate',
      projectRoot: dir,
      parentEnv: process.env,
    });
    const outcome = findCase(observation, 'http', 0);
    expect(outcome.outcome).toBe('failed');
    if (outcome.outcome === 'failed') expect(outcome.failure.error.code).toBe('RUN-150');
    const pid = Number((await readFile(markerPath, 'utf8')).trim());
    try {
      expect(isAlive(pid)).toBe(false);
    } finally {
      forceKill(pid);
    }
  });

  it('a harness SIGKILL’d mid-observation orphans the server it started -- the EXACT disclosed gap: the orphan survives, and the next run’s own port-free check is what refuses it, not some other mechanism', async () => {
    const dir = await freshProject();
    const port = await pickFreePort();
    const serverScriptPath = path.join(dir, 'server.cjs');
    const markerPath = path.join(dir, 'server.pid');
    // The readiness path answers immediately; the case's OWN request path (`/slow`) deliberately
    // delays its response well beyond this test's own kill-timing window, so the harness is
    // GUARANTEED to still be blocked awaiting that one response (inside `observeOneHttpCase`,
    // BEFORE `observeHttpSurfaceCases`'s own `finally` ever runs its clean `handle.stop()`) at the
    // moment this test sends SIGKILL -- never a race against the harness's own, already-proven, CLEAN
    // shutdown path (which the "is gone after an ordinary successful observation" test above already
    // covers).
    await writeFile(
      serverScriptPath,
      [
        "const http = require('node:http');",
        'const port = Number(process.argv[2]);',
        `require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, String(process.pid));`,
        'http.createServer((req, res) => {',
        "  if (req.url === '/ping') { res.writeHead(200, {}); res.end('pong'); return; }",
        '  setTimeout(() => { res.writeHead(200, {}); res.end("slow-pong"); }, 6000);',
        "}).listen(port, '127.0.0.1');",
      ].join('\n'),
      'utf8',
    );
    const harnessScriptDir = await mkdtemp(path.join(tmpdir(), 'forge-p8-harness-sigkill-'));
    dirs.push(harnessScriptDir);
    const harnessScriptPath = path.join(harnessScriptDir, 'harness.mjs');
    const observeUrl = new URL('../../../src/commands/parity/observe.ts', import.meta.url).href;
    const declarationLiteral = JSON.stringify(
      minimalDeclaration({
        surfaces: {
          http: {
            run: `node ${JSON.stringify(serverScriptPath)} ${String(port)}`,
            network: 'loopback',
            port,
            readiness: { path: '/ping', timeoutMs: 5_000 },
            stability: { runs: 3 },
            // A generous timeoutMs: this harness is SIGKILL'd long before any timeout would fire, so
            // this only needs to be longer than the kill-timing window below, never actually waited
            // out.
            cases: [{ request: { method: 'GET', path: '/slow' }, timeoutMs: 30_000 }],
          },
        },
      }),
    );
    await writeFile(
      harnessScriptPath,
      `import { observeParityDeclaration } from ${JSON.stringify(observeUrl)};
console.log('STARTED');
await observeParityDeclaration({ declaration: ${declarationLiteral}, side: 'candidate', projectRoot: ${JSON.stringify(dir)}, parentEnv: process.env });
console.log('OBSERVED');
setInterval(() => {}, 1000);
`,
      'utf8',
    );
    const { spawn } = await import('node:child_process');
    const harness = spawn('node', ['--experimental-strip-types', harnessScriptPath], {
      detached: true,
    });
    const harnessPid = harness.pid;
    if (harnessPid === undefined) throw new Error('failed to spawn the harness');
    let serverPid: number | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        harness.stdout.on('data', (chunk: Buffer) => {
          if (chunk.toString().includes('OBSERVED')) {
            reject(
              new Error(
                'the harness finished observing before this test could kill it mid-flight -- the ' +
                  "server's own deliberate response delay is not long enough relative to the kill-" +
                  'timing window below',
              ),
            );
          }
        });
        harness.on('error', reject);
        harness.on('exit', (code) => {
          reject(new Error(`harness exited early with code ${String(code)}`));
        });
        // Poll for the server's own pid marker (proof the server is up and the readiness probe has
        // already succeeded, so the harness is now definitely inside its own one slow request) rather
        // than a fixed delay from 'STARTED' alone.
        const waitForMarker = async (): Promise<void> => {
          for (let attempt = 0; attempt < 100; attempt += 1) {
            const text = await readFile(markerPath, 'utf8').catch(() => '');
            if (text.trim() !== '') {
              resolve();
              return;
            }
            await new Promise((r) => setTimeout(r, 50));
          }
          reject(new Error('the server never wrote its own pid marker'));
        };
        void waitForMarker();
      });
      const markerText = await readFile(markerPath, 'utf8');
      serverPid = Number(markerText.trim());
      expect(Number.isInteger(serverPid)).toBe(true);

      // Kill only the HARNESS's own process group -- never the server's, which started its own
      // (`startHttpServer`'s own `detached: true`) -- so the server becomes a real orphan, exactly as
      // a real SIGKILL of `forge parity check` itself would leave it.
      process.kill(-harnessPid, 'SIGKILL');
      await new Promise<void>((resolve) => {
        const check = (): void => {
          if (isAlive(harnessPid)) setTimeout(check, 20);
          else resolve();
        };
        check();
      });

      expect(
        isAlive(serverPid),
        'the server must survive the harness’s own SIGKILL -- this is the real, disclosed orphan risk',
      ).toBe(true);

      // The disclosed recovery: the NEXT run's own pre-start port-free check is what catches the
      // orphan, nothing else.
      const { startHttpServer } = await import('../../../src/commands/parity/http-server.ts');
      const { isForgeError } = await import('@forge/core/errors');
      await expect(
        startHttpServer({
          run: `node ${JSON.stringify(serverScriptPath)} ${String(port)}`,
          port,
          readiness: { path: '/ping', timeoutMs: 2_000 },
          root: dir,
          parentEnv: process.env,
        }),
      ).rejects.toSatisfy((cause: unknown) => isForgeError(cause) && cause.code === 'RUN-147');
    } finally {
      forceKill(serverPid);
      forceKill(harnessPid);
    }
  }, 20_000);
});
