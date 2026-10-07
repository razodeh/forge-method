/**
 * `sendHttpRequest` — the `http` surface's own loopback client (specs/22 M16 P8, `13` F-TEST-9, Q294
 * Decision 7). Tests the client in isolation against a REAL in-process `node:http` server (no
 * subprocess needed here: this module does not care how the server was started, only that it answers
 * loopback requests — `QUALITY-BAR.md` R6, no mock of the request/response plumbing itself).
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M16.md P8
 * @see process/SPEC-QUESTIONS.md Q294 Decision 7
 */
import { createServer, type AddressInfo } from 'node:net';
import http from 'node:http';

import { isForgeError } from '@forge/core/errors';
import { afterEach, describe, expect, it } from 'vitest';

import { sendHttpRequest } from '../../../src/commands/parity/http-client.ts';
import { LOOPBACK_HOST } from '../../../src/commands/parity/http-server.ts';

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve();
          });
        }),
    ),
  );
});

async function startServer(handler: http.RequestListener): Promise<number> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

const DEFAULT_LIMITS = { timeoutMs: 5_000, capBytes: 1_000_000 };

describe('sendHttpRequest: refuses any host but loopback, directly, before any socket opens (specs/22 M16 P8) (Q294 Decision 7)', () => {
  it('refuses RUN-151 for a non-loopback host, without ever attempting a connection', async () => {
    const started = Date.now();
    await expect(
      sendHttpRequest({
        host: 'example.com',
        port: 80,
        request: { method: 'GET', path: '/' },
        ...DEFAULT_LIMITS,
      }),
    ).rejects.toSatisfy((cause: unknown) => isForgeError(cause) && cause.code === 'RUN-151');
    // A refused host is checked before any socket work: this must be near-instant, not a real DNS
    // resolution / connection attempt against a host that may not even be reachable in this sandbox.
    expect(Date.now() - started).toBeLessThan(200);
  });

  it.each(['0.0.0.0', 'evil.example', '169.254.169.254', '10.0.0.1'])(
    'refuses RUN-151 for %s',
    async (host) => {
      await expect(
        sendHttpRequest({
          host,
          port: 80,
          request: { method: 'GET', path: '/' },
          ...DEFAULT_LIMITS,
        }),
      ).rejects.toSatisfy((cause: unknown) => isForgeError(cause) && cause.code === 'RUN-151');
    },
  );

  it('accepts every one of its own documented loopback spellings', async () => {
    const port = await startServer((_req, res) => {
      res.writeHead(200, {});
      res.end('ok');
    });
    for (const host of [LOOPBACK_HOST, 'localhost', '::1']) {
      // `::1` only answers if the server also bound the v6 loopback; this assertion is about the
      // CLIENT's own refusal, so a connection-level failure (a different, expected code) still proves
      // the host itself was never refused by `RUN-151`.
      try {
        const result = await sendHttpRequest({
          host,
          port,
          request: { method: 'GET', path: '/' },
          ...DEFAULT_LIMITS,
        });
        expect(result.status).toBe(200);
      } catch (cause) {
        expect(isForgeError(cause) && cause.code === 'RUN-151').toBe(false);
      }
    }
  });
});

describe('sendHttpRequest: the real request/response plumbing (specs/22 M16 P8)', () => {
  it('sends the declared method, path, headers and body, and the server receives exactly them', async () => {
    let received: {
      method: string | undefined;
      url: string | undefined;
      headers: http.IncomingHttpHeaders;
      body: string;
    } = { method: undefined, url: undefined, headers: {}, body: '' };
    const port = await startServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        received = {
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        };
        res.writeHead(201, {});
        res.end('created');
      });
    });
    const observation = await sendHttpRequest({
      host: LOOPBACK_HOST,
      port,
      request: {
        method: 'POST',
        path: '/widgets?x=1',
        headers: { 'x-trace-id': 'abc-123' },
        body: '{"name":"gadget"}',
      },
      ...DEFAULT_LIMITS,
    });
    expect(received.method).toBe('POST');
    expect(received.url).toBe('/widgets?x=1');
    expect(received.headers['x-trace-id']).toBe('abc-123');
    expect(received.body).toBe('{"name":"gadget"}');
    expect(observation.status).toBe(201);
    expect(observation.body.text).toBe('created');
  });

  it('observes ONLY the response headers the case selected, by name — an unselected header the server sent is absent, never silently included', async () => {
    const port = await startServer((_req, res) => {
      res.writeHead(200, { 'x-selected': 'keep-me', 'x-not-selected': 'drop-me' });
      res.end('');
    });
    const observation = await sendHttpRequest({
      host: LOOPBACK_HOST,
      port,
      request: { method: 'GET', path: '/', responseHeaders: ['x-selected'] },
      ...DEFAULT_LIMITS,
    });
    expect(observation.headers).toEqual({ 'x-selected': 'keep-me' });
    expect(observation.headers['x-not-selected']).toBeUndefined();
  });

  it('a selected header the server never sent is simply absent as a key — never present with an empty/null value standing in for "not sent"', async () => {
    const port = await startServer((_req, res) => {
      res.writeHead(200, {});
      res.end('');
    });
    const observation = await sendHttpRequest({
      host: LOOPBACK_HOST,
      port,
      request: { method: 'GET', path: '/', responseHeaders: ['x-never-sent'] },
      ...DEFAULT_LIMITS,
    });
    expect(Object.hasOwn(observation.headers, 'x-never-sent')).toBe(false);
  });

  it('defaults to no response headers observed at all when the case selects none', async () => {
    const port = await startServer((_req, res) => {
      res.writeHead(200, { 'x-anything': 'present' });
      res.end('');
    });
    const observation = await sendHttpRequest({
      host: LOOPBACK_HOST,
      port,
      request: { method: 'GET', path: '/' },
      ...DEFAULT_LIMITS,
    });
    expect(observation.headers).toEqual({});
  });

  it('a GET with no declared body sends no request body', async () => {
    let bodyLength = -1;
    const port = await startServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        bodyLength = Buffer.concat(chunks).length;
        res.writeHead(200, {});
        res.end('');
      });
    });
    await sendHttpRequest({
      host: LOOPBACK_HOST,
      port,
      request: { method: 'GET', path: '/' },
      ...DEFAULT_LIMITS,
    });
    expect(bodyLength).toBe(0);
  });
});

describe('sendHttpRequest: typed, distinct request-level failures, never a truncated observation (specs/22 M16 P8)', () => {
  it('refuses RUN-150 when the response body exceeds its own declared cap, and cuts the connection rather than buffering past it', async () => {
    const port = await startServer((_req, res) => {
      res.writeHead(200, {});
      res.write('x'.repeat(100));
      // Deliberately never .end()s quickly on its own terms: the client's own cap must be what cuts
      // this off, not the server choosing to stop.
      const interval = setInterval(() => {
        try {
          res.write('x'.repeat(100));
        } catch {
          clearInterval(interval);
        }
      }, 5);
    });
    await expect(
      sendHttpRequest({
        host: LOOPBACK_HOST,
        port,
        request: { method: 'GET', path: '/' },
        timeoutMs: 5_000,
        capBytes: 50,
      }),
    ).rejects.toSatisfy(
      (cause: unknown) =>
        isForgeError(cause) && cause.code === 'RUN-150' && cause.message.includes('cap'),
    );
  });

  it('refuses RUN-150 promptly when the request exceeds its own timeout, never waiting indefinitely for a response that never comes', async () => {
    const port = await startServer(() => {
      // Never responds at all.
    });
    const started = Date.now();
    await expect(
      sendHttpRequest({
        host: LOOPBACK_HOST,
        port,
        request: { method: 'GET', path: '/' },
        timeoutMs: 300,
        capBytes: DEFAULT_LIMITS.capBytes,
      }),
    ).rejects.toSatisfy((cause: unknown) => isForgeError(cause) && cause.code === 'RUN-150');
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('refuses RUN-150 when nothing is listening on the declared port at all', async () => {
    const probe = createServer();
    const port = await new Promise<number>((resolve) => {
      probe.listen(0, '127.0.0.1', () => {
        resolve((probe.address() as AddressInfo).port);
      });
    });
    await new Promise<void>((resolve) => {
      probe.close(() => {
        resolve();
      });
    });
    await expect(
      sendHttpRequest({
        host: LOOPBACK_HOST,
        port,
        request: { method: 'GET', path: '/' },
        ...DEFAULT_LIMITS,
      }),
    ).rejects.toSatisfy((cause: unknown) => isForgeError(cause) && cause.code === 'RUN-150');
  });
});

describe('sendHttpRequest: a malformed request that makes `http.request` itself throw SYNCHRONOUSLY is a scoped RUN-150, never a raw, unwrapped exception (specs/22 M16 P8) (round-2 fix pass, MUST-FIX 1)', () => {
  // `node:http`'s own `ClientRequest` constructor validates a header NAME/VALUE and the request
  // `path` internally, and throws a SYNCHRONOUS, unwrapped `TypeError` for anything it refuses --
  // confirmed by direct experiment (this piece's own report has the transcript). Node's own `Promise`
  // constructor semantics catch a synchronous throw from its executor and reject with the raw thrown
  // value, so before this fix `sendHttpRequest` rejected with a bare `TypeError`
  // (`isForgeError(cause)` false), which `observe-http.ts`'s own `observeOneHttpCase` then RE-THREW
  // instead of reporting as this one case's own failure -- crashing the entire surface's cases loop.
  // Each case below is a DIFFERENT way to reach that synchronous throw, confirmed unreachable through
  // `declaration.ts`'s own load-time checks is not assumed, only the header-name one is (the other is
  // the "if you can still reach it with some OTHER malformed input" case this piece's report asks
  // for).
  it('a header name containing a colon (no control character, and the orchestrator’s own confirmed repro) rejects with a typed RUN-150, not a raw TypeError', async () => {
    const port = await startServer((_req, res) => {
      res.writeHead(200, {});
      res.end('unreachable');
    });
    await expect(
      sendHttpRequest({
        host: LOOPBACK_HOST,
        port,
        request: { method: 'GET', path: '/', headers: { 'X-Foo: Bar-Injected': 'x' } },
        ...DEFAULT_LIMITS,
      }),
    ).rejects.toSatisfy((cause: unknown) => isForgeError(cause) && cause.code === 'RUN-150');
  });

  it('a request path containing a literal space is NOT refused by declaration.ts’s own control-character check (a space is not a control character) and still reaches this synchronous-throw path -- also rejects with a typed RUN-150', async () => {
    // Real, direct confirmation this is still a live path to the synchronous throw, independent of
    // this module: `node -e "require('node:http').request({host:'127.0.0.1',port:9999,path:'/ x',
    // method:'GET'},()=>{})"` throws `TypeError [ERR_UNESCAPED_CHARACTERS]` synchronously, and
    // `declaration.ts`'s own `unsafeHttpTextReason`/`hasSingleLeadingSlash` checks both pass a path
    // such as `"/foo bar"` (a space is not an ASCII control character, and the path still starts
    // with exactly one "/") -- so hardening the header-name check alone (this fix's load-time half)
    // does not make this synchronous-throw path unreachable in general, which is exactly why
    // `sendHttpRequest` itself is separately hardened too.
    const port = await startServer((_req, res) => {
      res.writeHead(200, {});
      res.end('unreachable');
    });
    await expect(
      sendHttpRequest({
        host: LOOPBACK_HOST,
        port,
        request: { method: 'GET', path: '/foo bar' },
        ...DEFAULT_LIMITS,
      }),
    ).rejects.toSatisfy((cause: unknown) => isForgeError(cause) && cause.code === 'RUN-150');
  });
});
