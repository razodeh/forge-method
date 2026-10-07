/**
 * Shared real-subprocess HTTP server fixtures for this directory's own `http-server.test.ts`/
 * `observe-http.test.ts` (specs/22 M16 P8) — not itself a test file, so it carries no `describe`/`it`
 * of its own. Every fixture is a real, separate `node` process written to disk and spawned for real:
 * `QUALITY-BAR.md` R6 bans a mock here, the identical discipline `observe.test.ts`'s own file header
 * states for the surfaces P3 already built.
 */
import { createServer, type AddressInfo } from 'node:net';

/** Binds an ephemeral port, reads back what the OS assigned, and releases it immediately — the
 * identical pattern `packages/extensions/test/install/npm-fixture-registry.ts` and
 * `packages/adapter-kit/test/security/s4-network-isolation.test.ts` already use to find a real,
 * currently-free port for a test fixture server. A declared `surfaces.http.port` must be a LITERAL
 * number (Q294 Decision 7: never `0`/ephemeral), so every test that needs one picks a real free port
 * this way first, then declares that literal number. */
export async function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

/** One route's own fixed response. Looked up by `"<METHOD> <url>"` (no query-string handling: every
 * test here declares a bare path). */
export interface FixtureRoute {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface HttpServerScriptOptions {
  /** `"<METHOD> <path>"` -> fixed response; an unmatched request reads 404. */
  readonly routes?: Readonly<Record<string, FixtureRoute>>;
  /** When `true`, every request instead reads back exactly what the server received, as JSON:
   * `{"method":...,"url":...,"headers":{...},"body":"..."}` — proves the request this harness sent is
   * really what arrived, not merely what a fixed `routes` table happens to agree with. */
  readonly echo?: boolean;
  /** When given, the process calls `process.exit(code)` this many milliseconds after starting,
   * WITHOUT ever calling `.listen()` first when `neverListens` is also set, or after listening
   * otherwise — the "dies before/after readiness" fixture shape. */
  readonly exitAfterMs?: number;
  readonly exitCode?: number;
  /** When `true`, the process never calls `server.listen(...)` at all (it stays alive via a bare
   * `setInterval`, so a real process-group kill is still meaningful to test) — simulates a server
   * that starts but never becomes reachable, for a readiness-TIMEOUT fixture (distinct from
   * `exitAfterMs`, which simulates one that becomes UNREACHABLE by dying). */
  readonly neverListens?: boolean;
  /** When given, the process writes its own real pid to this path IMMEDIATELY on start (before
   * `.listen()`, so this is available even for a `neverListens`/pre-readiness fixture) — lets a test
   * that only learns about a THROWN refusal, never a success handle, still run a real OS-level
   * liveness check afterward. */
  readonly pidMarkerPath?: string;
}

/** The literal text of a real, small `node:http` fixture server, parameterised for this directory's
 * own real-subprocess tests. `process.argv[2]` is the literal port to listen on (never read from an
 * environment variable this harness might inject — `declaration-types.ts`'s own `HttpReadinessProbe`
 * doc comment states the DECISION that a declared port is purely the harness's own free-check/request
 * concern, and the author's own server script is responsible for listening on it). */
export function httpServerScript(options: HttpServerScriptOptions = {}): string {
  const routesJson = JSON.stringify(options.routes ?? {});
  const lines: string[] = [
    "const http = require('node:http');",
    'const port = Number(process.argv[2]);',
    `const routes = ${routesJson};`,
    `const echo = ${options.echo === true ? 'true' : 'false'};`,
  ];
  if (options.pidMarkerPath !== undefined) {
    lines.push(
      `require('node:fs').writeFileSync(${JSON.stringify(options.pidMarkerPath)}, String(process.pid));`,
    );
  }
  if (options.exitAfterMs !== undefined) {
    lines.push(
      `setTimeout(() => { process.exit(${String(options.exitCode ?? 1)}); }, ${String(options.exitAfterMs)});`,
    );
  }
  lines.push(
    'const server = http.createServer((req, res) => {',
    '  const chunks = [];',
    "  req.on('data', (c) => chunks.push(c));",
    "  req.on('end', () => {",
    "    const body = Buffer.concat(chunks).toString('utf8');",
    '    if (echo) {',
    '      res.writeHead(200, { "content-type": "application/json" });',
    '      res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body }));',
    '      return;',
    '    }',
    '    const route = routes[req.method + " " + req.url];',
    '    if (!route) { res.writeHead(404, {}); res.end("not found: " + req.method + " " + req.url); return; }',
    '    res.writeHead(route.status, route.headers || {});',
    '    res.end(route.body || "");',
    '  });',
    '});',
  );
  if (options.neverListens !== true) {
    lines.push("server.listen(port, '127.0.0.1');");
  } else {
    // Stays alive without ever becoming reachable: a readiness-TIMEOUT fixture, not a dies-before-
    // ready one.
    lines.push('setInterval(() => {}, 1000);');
  }
  return lines.join('\n');
}
