/**
 * `validateParityDeclaration`/`parseParityDeclaration`/`vetParityDeclaration`/
 * `loadParityDeclaration`/`loadParityDeclarationText` (specs/22 M16 P2) — the strict loader for
 * `.forge/parity/<name>.parity.yaml`, `13` F-TEST-9.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M16.md P2
 * @see process/SPEC-QUESTIONS.md Q294 Decisions 5-8
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ForgeError } from '@forge/core/errors';
import { afterEach, describe, expect, it } from 'vitest';

import type { CommandRefusal } from '@forge/engine/dispatch';

import {
  assertParityDeclarationValid,
  loadParityDeclaration,
  loadParityDeclarationText,
  parseParityDeclaration,
  validateParityDeclaration,
  vetParityDeclaration,
  type VetCommand,
} from '../../../src/commands/parity/declaration.ts';
const SHA40 = 'a'.repeat(40);

function alwaysAccept(): Promise<CommandRefusal | undefined> {
  return Promise.resolve(undefined);
}

function rawDeclaration(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'sample',
    reference: { ref: SHA40 },
    review: { by: 'alice', basis: 'read the diff by hand', at: '2026-01-01' },
    expires: '2026-12-31',
    surfaces: { process: { run: 'node check.js', cases: [{}] } },
    ...overrides,
  };
}

const FILE = 'sample.parity.yaml';

describe('validateParityDeclaration — strict unknown-key detection (specs/22 M16 P2)', () => {
  it('refuses an unknown key at the top level, with a "did you mean" suggestion', () => {
    const { declaration, problems } = validateParityDeclaration(
      rawDeclaration({ revie: { by: 'alice', basis: 'x', at: '2026-01-01' }, review: undefined }),
      FILE,
    );
    expect(declaration).toBeUndefined();
    const problem = problems.find((p) => p.key === 'revie');
    expect(problem?.code).toBe('unknown-key');
    expect(problem?.message).toMatch(/did you mean "review"/);
  });

  it('refuses an unknown key nested inside "review", with a suggestion', () => {
    const raw = rawDeclaration({ review: { by: 'alice', bsis: 'x', at: '2026-01-01' } });
    const { declaration, problems } = validateParityDeclaration(raw, FILE);
    expect(declaration).toBeUndefined();
    const problem = problems.find((p) => p.key === 'review.bsis');
    expect(problem?.code).toBe('unknown-key');
    expect(problem?.message).toMatch(/did you mean "basis"/);
  });

  it('refuses an unknown key nested inside a surface', () => {
    const raw = rawDeclaration({ surfaces: { process: { run: 'node x.js', casess: [{}] } } });
    const { problems } = validateParityDeclaration(raw, FILE);
    const problem = problems.find((p) => p.key === 'surfaces.process.casess');
    expect(problem?.code).toBe('unknown-key');
    expect(problem?.message).toMatch(/did you mean "cases"/);
  });

  it('accepts a well-formed declaration with no unknown keys at all', () => {
    const { declaration, problems } = validateParityDeclaration(rawDeclaration(), FILE);
    expect(problems).toEqual([]);
    expect(declaration).toBeDefined();
  });
});

describe('validateParityDeclaration — required fields (specs/22 M16 P2)', () => {
  it('is invalid when "review" is missing', () => {
    const raw = rawDeclaration({ review: undefined });
    delete raw['review'];
    const { declaration, problems } = validateParityDeclaration(raw, FILE);
    expect(declaration).toBeUndefined();
    expect(problems.some((p) => p.key === 'review')).toBe(true);
  });

  it('is invalid when "expires" is missing', () => {
    const raw = rawDeclaration();
    delete raw['expires'];
    const { declaration, problems } = validateParityDeclaration(raw, FILE);
    expect(declaration).toBeUndefined();
    expect(problems.some((p) => p.key === 'expires')).toBe(true);
  });

  it('is invalid when review.by, review.basis individually are missing', () => {
    const raw = rawDeclaration({ review: { at: '2026-01-01' } });
    const { problems } = validateParityDeclaration(raw, FILE);
    expect(problems.some((p) => p.key === 'review.by')).toBe(true);
    expect(problems.some((p) => p.key === 'review.basis')).toBe(true);
  });
});

describe('validateParityDeclaration — name must equal the file stem (specs/22 M16 P2)', () => {
  it('is invalid when "name" does not equal the file stem', () => {
    const { declaration, problems } = validateParityDeclaration(
      rawDeclaration({ name: 'other' }),
      FILE,
    );
    expect(declaration).toBeUndefined();
    expect(problems.find((p) => p.key === 'name')?.message).toMatch(
      /must equal the file's own stem/,
    );
  });

  it('is invalid when "name" does not match the required pattern', () => {
    const { problems } = validateParityDeclaration(
      rawDeclaration({ name: 'Sample_1' }),
      'Sample_1.parity.yaml',
    );
    expect(problems.some((p) => p.key === 'name')).toBe(true);
  });

  it('accepts a name equal to the stem derived from a path with directories', () => {
    const { declaration } = validateParityDeclaration(
      rawDeclaration(),
      '.forge/parity/sample.parity.yaml',
    );
    expect(declaration).toBeDefined();
  });
});

describe('validateParityDeclaration — reference.ref format (specs/22 M16 P2)', () => {
  it('accepts a full 40-digit lower-case sha', () => {
    const { declaration, problems } = validateParityDeclaration(
      rawDeclaration({ reference: { ref: SHA40 } }),
      FILE,
    );
    expect(problems).toEqual([]);
    expect(declaration?.reference.ref).toBe(SHA40);
  });

  it('accepts a full 64-digit lower-case sha', () => {
    const sha64 = 'b'.repeat(64);
    const { problems } = validateParityDeclaration(
      rawDeclaration({ reference: { ref: sha64 } }),
      FILE,
    );
    expect(problems).toEqual([]);
  });

  it('defers a tag-shaped name to the async check (not a sync-level problem)', () => {
    const { declaration, problems } = validateParityDeclaration(
      rawDeclaration({ reference: { ref: 'v1.0' } }),
      FILE,
    );
    expect(problems).toEqual([]);
    expect(declaration?.reference.ref).toBe('v1.0');
  });

  it('rejects the literal "HEAD"', () => {
    const { problems } = validateParityDeclaration(
      rawDeclaration({ reference: { ref: 'HEAD' } }),
      FILE,
    );
    expect(problems.some((p) => p.key === 'reference.ref')).toBe(true);
  });

  it('rejects an abbreviated sha', () => {
    const { problems } = validateParityDeclaration(
      rawDeclaration({ reference: { ref: 'a1b2c3d' } }),
      FILE,
    );
    expect(problems.some((p) => p.key === 'reference.ref')).toBe(true);
  });

  it('rejects an upper-cased sha', () => {
    const { problems } = validateParityDeclaration(
      rawDeclaration({ reference: { ref: SHA40.toUpperCase() } }),
      FILE,
    );
    expect(problems.some((p) => p.key === 'reference.ref')).toBe(true);
  });
});

describe('validateParityDeclaration — stability.runs (specs/22 M16 P2)', () => {
  it('is invalid when stability.runs is below 2', () => {
    const raw = rawDeclaration({
      surfaces: { process: { run: 'x', stability: { runs: 1 }, cases: [{}] } },
    });
    expect(
      validateParityDeclaration(raw, FILE).problems.some(
        (p) => p.key === 'surfaces.process.stability.runs',
      ),
    ).toBe(true);
  });

  it('is invalid when stability.runs is above 10', () => {
    const raw = rawDeclaration({
      surfaces: { process: { run: 'x', stability: { runs: 11 }, cases: [{}] } },
    });
    expect(
      validateParityDeclaration(raw, FILE).problems.some(
        (p) => p.key === 'surfaces.process.stability.runs',
      ),
    ).toBe(true);
  });

  it('is invalid when stability.runs is not an integer', () => {
    const raw = rawDeclaration({
      surfaces: { process: { run: 'x', stability: { runs: 2.5 }, cases: [{}] } },
    });
    expect(
      validateParityDeclaration(raw, FILE).problems.some(
        (p) => p.key === 'surfaces.process.stability.runs',
      ),
    ).toBe(true);
  });

  it('defaults to 3 when stability is omitted, so digests of an implicit and explicit default agree', () => {
    const raw = rawDeclaration({ surfaces: { process: { run: 'x', cases: [{}] } } });
    const { declaration } = validateParityDeclaration(raw, FILE);
    expect(declaration?.surfaces.process?.stability).toEqual({ runs: 3 });
  });

  it('accepts the boundary values 2 and 10', () => {
    for (const runs of [2, 10]) {
      const raw = rawDeclaration({
        surfaces: { process: { run: 'x', stability: { runs }, cases: [{}] } },
      });
      expect(validateParityDeclaration(raw, FILE).problems).toEqual([]);
    }
  });
});

describe('validateParityDeclaration — a surface must list at least one case (specs/22 M16 P2)', () => {
  it('is invalid when a surface lists no cases', () => {
    const raw = rawDeclaration({ surfaces: { process: { run: 'x', cases: [] } } });
    const { problems } = validateParityDeclaration(raw, FILE);
    expect(problems.some((p) => p.key === 'surfaces.process.cases')).toBe(true);
  });
});

describe('validateParityDeclaration — output and overlay path safety (specs/22 M16 P2) (R11)', () => {
  it.each([
    ['absolute', '/etc/passwd'],
    ['parent-escaping', '../escape.txt'],
    ['under .git', '.git/config'],
    ['under .forge', '.forge/secrets.yaml'],
    ['Windows-shaped drive-absolute', 'C:\\Windows\\win.ini'],
  ])('refuses a declared output path that is %s', (_label, badPath) => {
    const raw = rawDeclaration({
      surfaces: { process: { run: 'x', cases: [{ outputs: [{ path: badPath }] }] } },
    });
    const { problems } = validateParityDeclaration(raw, FILE);
    expect(problems.some((p) => p.key === 'surfaces.process.cases[0].outputs[0].path')).toBe(true);
  });

  it.each([
    ['absolute', '/etc/passwd'],
    ['parent-escaping', '../escape.txt'],
    ['under .git', '.git/config'],
    ['under .forge', '.forge/secrets.yaml'],
  ])('refuses an overlay destination ("to") that is %s', (_label, badPath) => {
    const raw = rawDeclaration({
      surfaces: {
        process: { run: 'x', cases: [{ inputs: [{ from: '.forge/parity/in.txt', to: badPath }] }] },
      },
    });
    const { problems } = validateParityDeclaration(raw, FILE);
    expect(problems.some((p) => p.key === 'surfaces.process.cases[0].inputs[0].to')).toBe(true);
  });

  it('accepts an overlay source legitimately under .forge/parity/ (not a destination)', () => {
    const raw = rawDeclaration({
      surfaces: {
        process: {
          run: 'x',
          cases: [{ inputs: [{ from: '.forge/parity/fixtures/in.txt', to: 'in.txt' }] }],
        },
      },
    });
    expect(validateParityDeclaration(raw, FILE).problems).toEqual([]);
  });
});

describe('validateParityDeclaration — unobservable entries (specs/22 M16 P2)', () => {
  it('is invalid when an unobservable entry names a surface the declaration does not have', () => {
    const raw = rawDeclaration({
      unobservable: [
        { surface: 'http', reason: 'no http here', owner: 'alice', expiry: '2099-01-01' },
      ],
    });
    const { problems } = validateParityDeclaration(raw, FILE);
    expect(problems.some((p) => p.key === 'unobservable[0].surface')).toBe(true);
  });

  it('accepts an unobservable entry naming a surface the declaration genuinely declares', () => {
    const raw = rawDeclaration({
      surfaces: { process: { run: 'x', cases: [{}] }, file: { run: 'y', cases: [{}] } },
      unobservable: [
        { surface: 'file', reason: 'no file I/O', owner: 'alice', expiry: '2099-01-01' },
      ],
    });
    const { declaration, problems } = validateParityDeclaration(raw, FILE);
    expect(problems).toEqual([]);
    expect(declaration?.unobservable).toHaveLength(1);
  });

  it('is invalid when an unobservable entry names an unrecognised surface value entirely', () => {
    const raw = rawDeclaration({
      unobservable: [{ surface: 'websocket', reason: 'x', owner: 'alice', expiry: '2099-01-01' }],
    });
    expect(
      validateParityDeclaration(raw, FILE).problems.some(
        (p) => p.key === 'unobservable[0].surface',
      ),
    ).toBe(true);
  });
});

describe('validateParityDeclaration — http surface requires network: loopback (specs/22 M16 P2)', () => {
  it('is invalid when an http surface omits network: loopback', () => {
    const raw = rawDeclaration({ surfaces: { http: { run: 'node server.js', cases: [{}] } } });
    expect(
      validateParityDeclaration(raw, FILE).problems.some((p) => p.key === 'surfaces.http.network'),
    ).toBe(true);
  });

  it("accepts a fully-formed http surface (network, a literal port, a readiness probe, and each case's own request -- the fields a later piece of this milestone added)", () => {
    const raw = rawDeclaration({
      surfaces: {
        http: {
          run: 'node server.js',
          network: 'loopback',
          port: 4123,
          readiness: { path: '/healthz', timeoutMs: 5000 },
          cases: [{ request: { method: 'GET', path: '/' } }],
        },
      },
    });
    expect(validateParityDeclaration(raw, FILE).problems).toEqual([]);
  });

  it('is invalid when a non-http surface declares network at all', () => {
    const raw = rawDeclaration({
      surfaces: { process: { run: 'x', network: 'loopback', cases: [{}] } },
    });
    expect(
      validateParityDeclaration(raw, FILE).problems.some(
        (p) => p.key === 'surfaces.process.network',
      ),
    ).toBe(true);
  });
});

function httpSurface(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    run: 'node server.js',
    network: 'loopback',
    port: 4123,
    readiness: { path: '/healthz', timeoutMs: 5000 },
    cases: [{ request: { method: 'GET', path: '/' } }],
    ...overrides,
  };
}

describe('validateParityDeclaration — http surface: a literal port (specs/22 M16 P8) (Q294 Decision 7)', () => {
  it('is required on an http surface', () => {
    const raw = rawDeclaration({ surfaces: { http: httpSurface({ port: undefined }) } });
    expect(
      validateParityDeclaration(raw, FILE).problems.some((p) => p.key === 'surfaces.http.port'),
    ).toBe(true);
  });

  it.each([0, -1, 1.5, 65_536, 'nope', null])(
    'rejects an out-of-range or non-integer port (%s)',
    (bad) => {
      const raw = rawDeclaration({ surfaces: { http: httpSurface({ port: bad }) } });
      expect(
        validateParityDeclaration(raw, FILE).problems.some((p) => p.key === 'surfaces.http.port'),
      ).toBe(true);
    },
  );

  it('accepts the boundary ports 1 and 65535', () => {
    for (const port of [1, 65_535]) {
      const raw = rawDeclaration({ surfaces: { http: httpSurface({ port }) } });
      expect(validateParityDeclaration(raw, FILE).problems).toEqual([]);
    }
  });

  it('is rejected on every non-http surface', () => {
    const raw = rawDeclaration({ surfaces: { process: { run: 'x', port: 4123, cases: [{}] } } });
    expect(
      validateParityDeclaration(raw, FILE).problems.some((p) => p.key === 'surfaces.process.port'),
    ).toBe(true);
  });
});

describe('validateParityDeclaration — http surface: the readiness probe (specs/22 M16 P8)', () => {
  it('is required on an http surface', () => {
    const raw = rawDeclaration({ surfaces: { http: httpSurface({ readiness: undefined }) } });
    expect(
      validateParityDeclaration(raw, FILE).problems.some(
        (p) => p.key === 'surfaces.http.readiness',
      ),
    ).toBe(true);
  });

  it('rejects a path that does not start with "/"', () => {
    const raw = rawDeclaration({
      surfaces: { http: httpSurface({ readiness: { path: 'healthz', timeoutMs: 1000 } }) },
    });
    expect(
      validateParityDeclaration(raw, FILE).problems.some(
        (p) => p.key === 'surfaces.http.readiness.path',
      ),
    ).toBe(true);
  });

  it('rejects a path carrying a CRLF (request-line injection shape)', () => {
    const raw = rawDeclaration({
      surfaces: {
        http: httpSurface({ readiness: { path: '/healthz\r\nX-Injected: 1', timeoutMs: 1000 } }),
      },
    });
    expect(
      validateParityDeclaration(raw, FILE).problems.some(
        (p) => p.key === 'surfaces.http.readiness.path',
      ),
    ).toBe(true);
  });

  it.each([0, -1, 1.5, 'nope', null])('rejects a non-positive-integer timeoutMs (%s)', (bad) => {
    const raw = rawDeclaration({
      surfaces: { http: httpSurface({ readiness: { path: '/healthz', timeoutMs: bad } }) },
    });
    expect(
      validateParityDeclaration(raw, FILE).problems.some(
        (p) => p.key === 'surfaces.http.readiness.timeoutMs',
      ),
    ).toBe(true);
  });

  it('refuses an unknown key inside readiness, with a "did you mean" suggestion', () => {
    const raw = rawDeclaration({
      surfaces: { http: httpSurface({ readiness: { path: '/healthz', timeoutM: 1000 } }) },
    });
    const problem = validateParityDeclaration(raw, FILE).problems.find(
      (p) => p.key === 'surfaces.http.readiness.timeoutM',
    );
    expect(problem?.message).toMatch(/did you mean "timeoutMs"/);
  });

  it('is rejected on every non-http surface', () => {
    const raw = rawDeclaration({
      surfaces: {
        process: { run: 'x', readiness: { path: '/x', timeoutMs: 1000 }, cases: [{}] },
      },
    });
    expect(
      validateParityDeclaration(raw, FILE).problems.some(
        (p) => p.key === 'surfaces.process.readiness',
      ),
    ).toBe(true);
  });
});

describe('validateParityDeclaration — http case: the request (specs/22 M16 P8)', () => {
  it('is required on every http case', () => {
    const raw = rawDeclaration({ surfaces: { http: httpSurface({ cases: [{}] }) } });
    expect(
      validateParityDeclaration(raw, FILE).problems.some(
        (p) => p.key === 'surfaces.http.cases[0].request',
      ),
    ).toBe(true);
  });

  it('is rejected on every non-http case', () => {
    const raw = rawDeclaration({
      surfaces: { process: { run: 'x', cases: [{ request: { method: 'GET', path: '/' } }] } },
    });
    expect(
      validateParityDeclaration(raw, FILE).problems.some(
        (p) => p.key === 'surfaces.process.cases[0].request',
      ),
    ).toBe(true);
  });

  it.each(['args', 'outputs', 'expect'])(
    'refuses "%s" on an http case -- it has no coherent meaning for a request/response pair',
    (key) => {
      const raw = rawDeclaration({
        surfaces: {
          http: httpSurface({
            cases: [{ request: { method: 'GET', path: '/' }, [key]: key === 'expect' ? 0 : [] }],
          }),
        },
      });
      expect(
        validateParityDeclaration(raw, FILE).problems.some(
          (p) => p.key === `surfaces.http.cases[0].${key}`,
        ),
      ).toBe(true);
    },
  );

  it('accepts "inputs" and "timeoutMs"/"outputCapBytes" on an http case (the generic per-case fields that DO still apply)', () => {
    const raw = rawDeclaration({
      surfaces: {
        http: httpSurface({
          cases: [
            {
              request: { method: 'GET', path: '/' },
              inputs: [{ from: 'a.txt', to: 'b.txt' }],
              timeoutMs: 1000,
              outputCapBytes: 1000,
            },
          ],
        }),
      },
    });
    expect(validateParityDeclaration(raw, FILE).problems).toEqual([]);
  });

  it('rejects a method that is not an upper-case HTTP token', () => {
    for (const method of ['get', 'Get', '', 'G E T']) {
      const raw = rawDeclaration({
        surfaces: { http: httpSurface({ cases: [{ request: { method, path: '/' } }] }) },
      });
      expect(
        validateParityDeclaration(raw, FILE).problems.some(
          (p) => p.key === 'surfaces.http.cases[0].request.method',
        ),
        `expected "${method}" to be refused`,
      ).toBe(true);
    }
  });

  it('accepts real HTTP method tokens', () => {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
      const raw = rawDeclaration({
        surfaces: { http: httpSurface({ cases: [{ request: { method, path: '/' } }] }) },
      });
      expect(validateParityDeclaration(raw, FILE).problems).toEqual([]);
    }
  });

  it('rejects a path that does not start with "/"', () => {
    const raw = rawDeclaration({
      surfaces: {
        http: httpSurface({ cases: [{ request: { method: 'GET', path: 'no-slash' } }] }),
      },
    });
    expect(
      validateParityDeclaration(raw, FILE).problems.some(
        (p) => p.key === 'surfaces.http.cases[0].request.path',
      ),
    ).toBe(true);
  });

  it('rejects a path or header value carrying a CR/LF (request/header-injection shape)', () => {
    const pathRaw = rawDeclaration({
      surfaces: {
        http: httpSurface({
          cases: [{ request: { method: 'GET', path: '/a\r\nX-Injected: 1' } }],
        }),
      },
    });
    expect(
      validateParityDeclaration(pathRaw, FILE).problems.some(
        (p) => p.key === 'surfaces.http.cases[0].request.path',
      ),
    ).toBe(true);

    const headerRaw = rawDeclaration({
      surfaces: {
        http: httpSurface({
          cases: [
            {
              request: {
                method: 'GET',
                path: '/',
                headers: { 'x-trace': 'a\r\nX-Injected: 1' },
              },
            },
          ],
        }),
      },
    });
    expect(
      validateParityDeclaration(headerRaw, FILE).problems.some((p) =>
        p.key.startsWith('surfaces.http.cases[0].request.headers'),
      ),
    ).toBe(true);
  });

  it('accepts a body that is an empty string (a GET-shaped case with an explicitly empty body is not "missing")', () => {
    const raw = rawDeclaration({
      surfaces: {
        http: httpSurface({ cases: [{ request: { method: 'GET', path: '/', body: '' } }] }),
      },
    });
    expect(validateParityDeclaration(raw, FILE).problems).toEqual([]);
  });

  it('lower-cases every declared responseHeaders entry at load', () => {
    const { declaration } = validateParityDeclaration(
      rawDeclaration({
        surfaces: {
          http: httpSurface({
            cases: [
              {
                request: {
                  method: 'GET',
                  path: '/',
                  responseHeaders: ['X-Flavor', 'Content-Type'],
                },
              },
            ],
          }),
        },
      }),
      FILE,
    );
    expect(declaration?.surfaces.http?.cases[0]?.request?.responseHeaders).toEqual([
      'x-flavor',
      'content-type',
    ]);
  });

  it('refuses an unknown key inside a request, with a "did you mean" suggestion', () => {
    const raw = rawDeclaration({
      surfaces: {
        http: httpSurface({ cases: [{ request: { method: 'GET', path: '/', heeaders: {} } }] }),
      },
    });
    const problem = validateParityDeclaration(raw, FILE).problems.find(
      (p) => p.key === 'surfaces.http.cases[0].request.heeaders',
    );
    expect(problem?.message).toMatch(/did you mean "headers"/);
  });
});

describe('validateParityDeclaration — http header NAME must be a valid HTTP token, not merely free of control characters (specs/22 M16 P8)', () => {
  // M16 P8 round-2 fix pass, MUST-FIX 1. Node's own `http.request` enforces the RFC 7230 `tchar`
  // charset on a header NAME internally (`validateHeaderName`) and throws a SYNCHRONOUS, unwrapped
  // `TypeError [ERR_INVALID_HTTP_TOKEN]` for anything outside it -- confirmed by direct experiment
  // (this piece's own report): `node -e "require('node:http').request({host:'127.0.0.1',port:9999,
  // path:'/',method:'GET',headers:{'X-Foo: Bar-Injected':'x'}},()=>{})"` throws exactly that, before
  // `declaration.ts`'s own loader was hardened here. Before this fix, a header name such as
  // `"X-Foo: Bar-Injected"` had NO control character (a colon is not one), so it passed load-time
  // validation and reached `sendHttpRequest` -- this describe block proves it is now refused AT LOAD
  // instead, with a specific, named reason.
  it('rejects a header name containing a colon, even though a colon is not an ASCII control character', () => {
    const raw = rawDeclaration({
      surfaces: {
        http: httpSurface({
          cases: [
            {
              request: {
                method: 'GET',
                path: '/',
                headers: { 'X-Foo: Bar-Injected': 'x' },
              },
            },
          ],
        }),
      },
    });
    const problems = validateParityDeclaration(raw, FILE).problems;
    const problem = problems.find((p) =>
      p.key.startsWith('surfaces.http.cases[0].request.headers'),
    );
    expect(problem, 'expected the malformed header name to be refused at load').toBeDefined();
    expect(problem?.message).toMatch(/HTTP header-name token/);
  });

  it.each([' ', ',', '(', ')', '@', '/', '[', ']', '{', '}', '"', '?', '='])(
    'rejects a header name containing %j -- outside the RFC 7230 tchar set, and not a control character either',
    (badChar) => {
      const raw = rawDeclaration({
        surfaces: {
          http: httpSurface({
            cases: [
              {
                request: { method: 'GET', path: '/', headers: { [`X-Foo${badChar}Bar`]: 'x' } },
              },
            ],
          }),
        },
      });
      expect(
        validateParityDeclaration(raw, FILE).problems.some((p) =>
          p.key.startsWith('surfaces.http.cases[0].request.headers'),
        ),
        `expected a header name containing ${JSON.stringify(badChar)} to be refused`,
      ).toBe(true);
    },
  );

  it('still accepts every ordinary header name shape already in use (letters, digits, hyphen, and the rest of the tchar set)', () => {
    const raw = rawDeclaration({
      surfaces: {
        http: httpSurface({
          cases: [
            {
              request: {
                method: 'GET',
                path: '/',
                headers: {
                  'X-Trace-Id': 'abc',
                  'content-type': 'text/plain',
                  'X-Weird+Token.Name!': 'still valid',
                },
              },
            },
          ],
        }),
      },
    });
    expect(validateParityDeclaration(raw, FILE).problems).toEqual([]);
  });
});

describe('validateParityDeclaration — http request/readiness path: exactly one leading "/" (specs/22 M16 P8)', () => {
  // M16 P8 round-2 fix pass, judgment-call fix 4. Both critics independently proved a "//"-prefixed
  // path is byte-for-byte inert on the wire (the request always lands on loopback regardless; the
  // text travels as one literal request-target token, never interpreted as a protocol-relative URL)
  // -- not an exploit, but it reads like one on review. Tightened rather than merely documented: the
  // check is cheap, and no legitimate declaration needs a literal double-leading-slash path.
  it('rejects a case request path with two leading slashes', () => {
    const raw = rawDeclaration({
      surfaces: {
        http: httpSurface({
          cases: [{ request: { method: 'GET', path: '//attacker.example/evil-path' } }],
        }),
      },
    });
    expect(
      validateParityDeclaration(raw, FILE).problems.some(
        (p) => p.key === 'surfaces.http.cases[0].request.path',
      ),
    ).toBe(true);
  });

  it('rejects a readiness probe path with two leading slashes', () => {
    const raw = rawDeclaration({
      surfaces: { http: httpSurface({ readiness: { path: '//evil', timeoutMs: 1000 } }) },
    });
    expect(
      validateParityDeclaration(raw, FILE).problems.some(
        (p) => p.key === 'surfaces.http.readiness.path',
      ),
    ).toBe(true);
  });

  it('still accepts an ordinary single-leading-slash path for both', () => {
    const raw = rawDeclaration({
      surfaces: {
        http: httpSurface({
          readiness: { path: '/healthz', timeoutMs: 1000 },
          cases: [{ request: { method: 'GET', path: '/widgets' } }],
        }),
      },
    });
    expect(validateParityDeclaration(raw, FILE).problems).toEqual([]);
  });
});

describe('validateParityDeclaration — invalid calendar dates (specs/22 M16 P2)', () => {
  it.each(['expires', 'review.at'])(
    'rejects a date that does not exist on the calendar for %s',
    () => {
      expect(
        validateParityDeclaration(rawDeclaration({ expires: '2026-02-30' }), FILE).problems.length,
      ).toBeGreaterThan(0);
    },
  );

  it('rejects an invalid unobservable expiry', () => {
    const raw = rawDeclaration({
      surfaces: { process: { run: 'x', cases: [{}] }, file: { run: 'y', cases: [{}] } },
      unobservable: [{ surface: 'file', reason: 'x', owner: 'alice', expiry: '2026-02-30' }],
    });
    expect(
      validateParityDeclaration(raw, FILE).problems.some((p) => p.key === 'unobservable[0].expiry'),
    ).toBe(true);
  });
});

describe('parseParityDeclaration — throwing wrapper (specs/22 M16 P2)', () => {
  it('throws CFG-510 naming the file and the first offending key', () => {
    try {
      parseParityDeclaration(rawDeclaration({ name: 'wrong' }), FILE);
      expect.unreachable('expected a throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ForgeError);
      const forgeError = error as ForgeError<'CFG-510'>;
      expect(forgeError.code).toBe('CFG-510');
      expect(forgeError.details['file']).toBe(FILE);
      expect(forgeError.details['key']).toBe('name');
    }
  });

  it('returns the declaration without throwing when it is valid', () => {
    expect(parseParityDeclaration(rawDeclaration(), FILE).name).toBe('sample');
  });
});

describe('vetParityDeclaration — fake vet records the composed line (specs/22 M16 P2)', () => {
  function fakeVet(refuse: (command: string) => boolean = () => false): {
    readonly vet: VetCommand;
    readonly calls: { readonly command: string; readonly root: string }[];
  } {
    const calls: { readonly command: string; readonly root: string }[] = [];
    const vet: VetCommand = (command, root) => {
      calls.push({ command, root });
      return Promise.resolve(
        refuse(command)
          ? { reason: 'denylisted', detail: `fake refusal for "${command}"` }
          : undefined,
      );
    };
    return { vet, calls };
  }

  it('vets the bare run when a case has no arguments', async () => {
    const { vet, calls } = fakeVet();
    const { declaration } = validateParityDeclaration(rawDeclaration(), FILE);
    await vetParityDeclaration(declaration!, '/project', vet);
    expect(calls).toEqual([{ command: 'node check.js', root: '/project' }]);
  });

  it('vets the COMPOSED line, not the bare run, when a case has arguments', async () => {
    const { vet, calls } = fakeVet();
    const raw = rawDeclaration({
      surfaces: { process: { run: 'node check.js', cases: [{ args: ['a b', 'c'] }] } },
    });
    const { declaration } = validateParityDeclaration(raw, FILE);
    await vetParityDeclaration(declaration!, '/project', vet);
    expect(calls).toContainEqual({ command: "node check.js 'a b' 'c'", root: '/project' });
  });

  it("vets every surface's run, every setup entry, and every case independently", async () => {
    const { vet, calls } = fakeVet();
    const raw = rawDeclaration({
      surfaces: {
        process: {
          run: 'node p.js',
          setup: ['node setup1.js', 'node setup2.js'],
          cases: [{ args: ['one'] }, { args: ['two'] }],
        },
        file: { run: 'node f.js', cases: [{}] },
      },
    });
    const { declaration } = validateParityDeclaration(raw, FILE);
    await vetParityDeclaration(declaration!, '/project', vet);
    const commands = calls.map((c) => c.command);
    expect(commands).toContain('node p.js');
    expect(commands).toContain('node setup1.js');
    expect(commands).toContain('node setup2.js');
    expect(commands).toContain("node p.js 'one'");
    expect(commands).toContain("node p.js 'two'");
    expect(commands).toContain('node f.js');
    // Every root is the same project root, for every call.
    expect(calls.every((c) => c.root === '/project')).toBe(true);
  });

  it("reports a vet refusal naming the surface, the field, the command and the engine's reason", async () => {
    const { vet } = fakeVet((command) => command === 'node check.js');
    const { declaration } = validateParityDeclaration(rawDeclaration(), FILE);
    const problems = await vetParityDeclaration(declaration!, '/project', vet);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.code).toBe('command-refused');
    expect(problems[0]?.key).toBe('surfaces.process.run');
    expect(problems[0]?.message).toMatch(/surface "process"/);
    expect(problems[0]?.message).toMatch(/"run"/);
    expect(problems[0]?.message).toMatch(/node check\.js/);
    expect(problems[0]?.message).toMatch(/denylisted/);
  });

  it.each([
    ["holds a single quote (')", "it's"],
    ['holds a literal newline', 'a\nb'],
    ['holds a ";"', 'a;b'],
    ['holds a "|"', 'a|b'],
    ['holds a "&"', 'a&b'],
    ['holds a backtick', 'a`b'],
    ['holds a "$("', 'a$(b)'],
  ])(
    'refuses the declaration at load, before vetting, when an argument %s',
    async (_label, arg) => {
      const { vet, calls } = fakeVet();
      const raw = rawDeclaration({
        surfaces: { process: { run: 'node check.js', cases: [{ args: [arg] }] } },
      });
      const { declaration } = validateParityDeclaration(raw, FILE);
      const problems = await vetParityDeclaration(declaration!, '/project', vet);
      expect(problems.some((p) => p.key === 'surfaces.process.cases[0].args')).toBe(true);
      // The unsafe line was never handed to the vet at all -- composeArgs refused before vetting.
      expect(calls.some((c) => c.command.includes(arg))).toBe(false);
    },
  );
});

describe('vetParityDeclaration — real vetStoredCommand against a real project root (specs/22 M16 P2)', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function freshProject(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'forge-parity-vet-'));
    dirs.push(dir);
    await mkdir(path.join(dir, 'scripts'), { recursive: true });
    await writeFile(path.join(dir, 'scripts', 'a.txt'), 'hi\n');
    return dir;
  }

  it('accepts a command whose glob matches only inside the project root', async () => {
    const root = await freshProject();
    const raw = rawDeclaration({ surfaces: { process: { run: 'ls scripts/*.txt', cases: [{}] } } });
    const { declaration } = validateParityDeclaration(raw, FILE);
    const problems = await vetParityDeclaration(declaration!, root);
    expect(problems).toEqual([]);
  });

  it('refuses a command whose glob would escape the project root', async () => {
    const root = await freshProject();
    const raw = rawDeclaration({ surfaces: { process: { run: 'ls ../*.txt', cases: [{}] } } });
    const { declaration } = validateParityDeclaration(raw, FILE);
    const problems = await vetParityDeclaration(declaration!, root);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toMatch(/path-escape/);
  });

  it("refuses a real unvettable run (a network program), naming the engine's real reason", async () => {
    const root = await freshProject();
    const raw = rawDeclaration({
      surfaces: { process: { run: 'curl http://example.com', cases: [{}] } },
    });
    const { declaration } = validateParityDeclaration(raw, FILE);
    const problems = await vetParityDeclaration(declaration!, root);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.key).toBe('surfaces.process.run');
    expect(problems[0]?.message).toMatch(/network/);
  });

  it('refuses a real unvettable setup command the same way', async () => {
    const root = await freshProject();
    const raw = rawDeclaration({
      surfaces: { process: { run: 'node scripts/a.txt', setup: ['npm install'], cases: [{}] } },
    });
    const { declaration } = validateParityDeclaration(raw, FILE);
    const problems = await vetParityDeclaration(declaration!, root);
    expect(problems.some((p) => p.key === 'surfaces.process.setup[0]')).toBe(true);
  });

  it('refuses a case whose ARGUMENT alone would escape the project, even though the bare run is harmless on its own (proves the COMPOSED line is what is vetted, not the bare run)', async () => {
    const root = await freshProject();
    const raw = rawDeclaration({
      surfaces: {
        process: { run: 'cat', cases: [{ args: ['../../../etc/passwd'] }] },
      },
    });
    const { declaration } = validateParityDeclaration(raw, FILE);
    // The bare run alone is harmless and would be accepted on its own.
    expect(
      await vetParityDeclaration(
        {
          ...declaration!,
          surfaces: { process: { ...declaration!.surfaces.process!, cases: [{}] } },
        },
        root,
      ),
    ).toEqual([]);
    // But the real case, with its escaping argument, must be refused.
    const problems = await vetParityDeclaration(declaration!, root);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.key).toBe('surfaces.process.cases[0].args');
    expect(problems[0]?.message).toMatch(/path-escape/);
    expect(problems[0]?.message).toMatch(/\.\.\/\.\.\/\.\.\/etc\/passwd/);
  });
});

describe('loadParityDeclaration — the full async pipeline (specs/22 M16 P2)', () => {
  it('loads a structurally valid declaration whose reference.ref is an accepted tag name', async () => {
    const raw = rawDeclaration({ reference: { ref: 'v1.0' } });
    const result = await loadParityDeclaration(raw, FILE, '/project', alwaysAccept);
    expect(result.problems).toEqual([]);
    expect(result.declaration?.reference.ref).toBe('v1.0');
  });

  it('is invalid when reference.ref is a tag name git check-ref-format rejects', async () => {
    const raw = rawDeclaration({ reference: { ref: 'v1~1' } });
    const result = await loadParityDeclaration(raw, FILE, '/project', alwaysAccept);
    expect(result.declaration).toBeUndefined();
    expect(result.problems.some((p) => p.key === 'reference.ref')).toBe(true);
  });

  it('returns only the structural problems when structural validation already fails (no vet, no ref check beyond shape)', async () => {
    const raw = rawDeclaration({ name: 'wrong' });
    const result = await loadParityDeclaration(raw, FILE, '/project', alwaysAccept);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]?.key).toBe('name');
  });

  it('combines a vet refusal with an otherwise-clean structural pass', async () => {
    const refuse = (): Promise<CommandRefusal> =>
      Promise.resolve({ reason: 'denylisted', detail: 'no' });
    const result = await loadParityDeclaration(rawDeclaration(), FILE, '/project', refuse);
    expect(result.declaration).toBeUndefined();
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]?.code).toBe('command-refused');
  });
});

describe('loadParityDeclarationText — YAML syntax errors are typed problems, never raw exceptions (specs/22 M16 P2)', () => {
  it('loads valid YAML text end to end', async () => {
    const text = [
      'name: sample',
      `reference: { ref: "${SHA40}" }`,
      'review: { by: alice, basis: "read the diff", at: "2026-01-01" }',
      'expires: "2026-12-31"',
      'surfaces:',
      '  process:',
      '    run: "node check.js"',
      '    cases:',
      '      - {}',
    ].join('\n');
    const result = await loadParityDeclarationText(text, FILE, '/project', alwaysAccept);
    expect(result.problems).toEqual([]);
    expect(result.declaration?.name).toBe('sample');
  });

  it('reports broken YAML as a typed problem naming the file, never throwing', async () => {
    const brokenYaml = 'name: sample\n  bad indentation: [1, 2\n';
    const result = await loadParityDeclarationText(brokenYaml, FILE, '/project', alwaysAccept);
    expect(result.declaration).toBeUndefined();
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]?.message).toMatch(/not parseable YAML/);
  });
});

describe('assertParityDeclarationValid (specs/22 M16 P2)', () => {
  it('throws CFG-510 when given a result with no declaration', () => {
    expect(() => assertParityDeclarationValid({ problems: [] }, FILE)).toThrow(ForgeError);
  });

  it('returns the declaration when there is no problem', () => {
    const result = validateParityDeclaration(rawDeclaration(), FILE);
    expect(assertParityDeclarationValid(result, FILE)).toBe(result.declaration);
  });
});

describe('fileStem (specs/22 M16 P2)', () => {
  it('falls back to a bare basename when the file does not end in ".parity.yaml"', () => {
    // Exercised indirectly through validateParityDeclaration's own use of fileStem (not exported on
    // its own): a file named plainly "sample" (no extension at all) must still accept "name: sample".
    const { problems } = validateParityDeclaration(rawDeclaration(), 'sample');
    expect(problems).toEqual([]);
  });
});

describe('validateParityDeclaration — every remaining type-mismatch branch (specs/22 M16 P2)', () => {
  it('is invalid when the whole document is null, an array, or a string, not a mapping', () => {
    for (const bad of [null, [], 'not an object']) {
      const { declaration, problems } = validateParityDeclaration(bad, FILE);
      expect(declaration).toBeUndefined();
      expect(problems.some((p) => p.key === '(document)')).toBe(true);
    }
  });

  it('is invalid when "reference" is not a mapping (including null)', () => {
    for (const bad of [null, 'x', 42]) {
      const { problems } = validateParityDeclaration(rawDeclaration({ reference: bad }), FILE);
      expect(problems.some((p) => p.key === 'reference')).toBe(true);
    }
  });

  it('is invalid when "reference.ref" is present but not a string', () => {
    const { problems } = validateParityDeclaration(
      rawDeclaration({ reference: { ref: 42 } }),
      FILE,
    );
    expect(problems.some((p) => p.key === 'reference.ref')).toBe(true);
  });

  it('is invalid when "review" is a non-mapping value other than undefined (an array, a string)', () => {
    for (const bad of [[], 'x', 42]) {
      const { problems } = validateParityDeclaration(rawDeclaration({ review: bad }), FILE);
      expect(problems.some((p) => p.key === 'review')).toBe(true);
    }
  });

  it('is invalid when "surfaces" is present but not a mapping', () => {
    const { problems } = validateParityDeclaration(rawDeclaration({ surfaces: 'nope' }), FILE);
    expect(problems.some((p) => p.key === 'surfaces')).toBe(true);
  });

  it('is invalid when "unobservable" is present but not a list', () => {
    const { problems } = validateParityDeclaration(rawDeclaration({ unobservable: 'nope' }), FILE);
    expect(problems.some((p) => p.key === 'unobservable')).toBe(true);
  });

  it('is invalid when a surface entry itself is not a mapping', () => {
    const { problems } = validateParityDeclaration(
      rawDeclaration({ surfaces: { process: 'nope' } }),
      FILE,
    );
    expect(problems.some((p) => p.key === 'surfaces.process')).toBe(true);
  });

  it('is invalid when "run" is present but not a string', () => {
    const { problems } = validateParityDeclaration(
      rawDeclaration({ surfaces: { process: { run: 42, cases: [{}] } } }),
      FILE,
    );
    expect(problems.some((p) => p.key === 'surfaces.process.run')).toBe(true);
  });

  it('is invalid when "setup" is present but not a list of non-blank strings', () => {
    for (const bad of ['nope', ['', 'ok'], [42]]) {
      const { problems } = validateParityDeclaration(
        rawDeclaration({ surfaces: { process: { run: 'x', setup: bad, cases: [{}] } } }),
        FILE,
      );
      expect(problems.some((p) => p.key === 'surfaces.process.setup')).toBe(true);
    }
  });

  it('is invalid when "streams" is present but empty, not a list, or holds an unknown stream name', () => {
    for (const bad of ['nope', [], ['stdin']]) {
      const { problems } = validateParityDeclaration(
        rawDeclaration({ surfaces: { process: { run: 'x', streams: bad, cases: [{}] } } }),
        FILE,
      );
      expect(problems.some((p) => p.key === 'surfaces.process.streams')).toBe(true);
    }
  });

  it('accepts a declared, non-empty "streams" list', () => {
    const { problems, declaration } = validateParityDeclaration(
      rawDeclaration({ surfaces: { process: { run: 'x', streams: ['stdout'], cases: [{}] } } }),
      FILE,
    );
    expect(problems).toEqual([]);
    expect(declaration?.surfaces.process?.streams).toEqual(['stdout']);
  });

  it('is invalid when a non-process surface declares "streams" at all', () => {
    const raw = rawDeclaration({
      surfaces: { file: { run: 'x', streams: ['stdout'], cases: [{ outputs: [{ path: 'a' }] }] } },
    });
    const { problems } = validateParityDeclaration(raw, FILE);
    expect(problems.some((p) => p.key === 'surfaces.file.streams')).toBe(true);
  });

  it('is invalid when "cases" is present but not a list at all (not merely empty)', () => {
    const { problems } = validateParityDeclaration(
      rawDeclaration({ surfaces: { process: { run: 'x', cases: 'nope' } } }),
      FILE,
    );
    expect(problems.some((p) => p.key === 'surfaces.process.cases')).toBe(true);
  });

  it('is invalid when "stability" is present but not a mapping', () => {
    const { problems } = validateParityDeclaration(
      rawDeclaration({ surfaces: { process: { run: 'x', stability: 'nope', cases: [{}] } } }),
      FILE,
    );
    expect(problems.some((p) => p.key === 'surfaces.process.stability')).toBe(true);
  });

  it('is invalid when a case entry itself is not a mapping', () => {
    const { problems } = validateParityDeclaration(
      rawDeclaration({ surfaces: { process: { run: 'x', cases: ['nope'] } } }),
      FILE,
    );
    expect(problems.some((p) => p.key === 'surfaces.process.cases[0]')).toBe(true);
  });

  it.each([
    ['args', 'nope'],
    ['args', [1, 2]],
    ['inputs', 'nope'],
    ['outputs', 'nope'],
    ['normalize', 'nope'],
  ])('is invalid when case field "%s" is the wrong shape (%j)', (field, bad) => {
    const { problems } = validateParityDeclaration(
      rawDeclaration({ surfaces: { process: { run: 'x', cases: [{ [field]: bad }] } } }),
      FILE,
    );
    expect(problems.some((p) => p.key === `surfaces.process.cases[0].${field}`)).toBe(true);
  });

  it.each([0, -1, 1.5, 'nope'])(
    'is invalid when "timeoutMs" is not a positive integer (%j)',
    (bad) => {
      const { problems } = validateParityDeclaration(
        rawDeclaration({ surfaces: { process: { run: 'x', cases: [{ timeoutMs: bad }] } } }),
        FILE,
      );
      expect(problems.some((p) => p.key === 'surfaces.process.cases[0].timeoutMs')).toBe(true);
    },
  );

  it('accepts a positive integer "timeoutMs"', () => {
    const { problems, declaration } = validateParityDeclaration(
      rawDeclaration({ surfaces: { process: { run: 'x', cases: [{ timeoutMs: 5000 }] } } }),
      FILE,
    );
    expect(problems).toEqual([]);
    expect(declaration?.surfaces.process?.cases[0]?.timeoutMs).toBe(5000);
  });

  it.each([0, -1, 1.5, 'nope'])(
    'is invalid when "outputCapBytes" is not a positive integer (%j)',
    (bad) => {
      const { problems } = validateParityDeclaration(
        rawDeclaration({ surfaces: { process: { run: 'x', cases: [{ outputCapBytes: bad }] } } }),
        FILE,
      );
      expect(problems.some((p) => p.key === 'surfaces.process.cases[0].outputCapBytes')).toBe(true);
    },
  );

  it('accepts a positive integer "outputCapBytes"', () => {
    const { problems } = validateParityDeclaration(
      rawDeclaration({ surfaces: { process: { run: 'x', cases: [{ outputCapBytes: 1024 }] } } }),
      FILE,
    );
    expect(problems).toEqual([]);
  });

  it.each([-1, 1.5, 'nope', true])(
    'is invalid when "expect" is neither a non-negative integer nor "empty" (%j)',
    (bad) => {
      const { problems } = validateParityDeclaration(
        rawDeclaration({ surfaces: { process: { run: 'x', cases: [{ expect: bad }] } } }),
        FILE,
      );
      expect(problems.some((p) => p.key === 'surfaces.process.cases[0].expect')).toBe(true);
    },
  );

  it('accepts "expect: 0", a positive exit code, and the literal "empty"', () => {
    for (const ok of [0, 2, 'empty']) {
      const { problems } = validateParityDeclaration(
        rawDeclaration({ surfaces: { process: { run: 'x', cases: [{ expect: ok }] } } }),
        FILE,
      );
      expect(problems).toEqual([]);
    }
  });

  it('is invalid when an overlay input entry itself is not a mapping', () => {
    const { problems } = validateParityDeclaration(
      rawDeclaration({ surfaces: { process: { run: 'x', cases: [{ inputs: ['nope'] }] } } }),
      FILE,
    );
    expect(problems.some((p) => p.key === 'surfaces.process.cases[0].inputs[0]')).toBe(true);
  });

  it('is invalid when an overlay input\'s "from"/"to" are present but not strings (type, not blankness)', () => {
    const { problems } = validateParityDeclaration(
      rawDeclaration({
        surfaces: { process: { run: 'x', cases: [{ inputs: [{ from: 42, to: 42 }] }] } },
      }),
      FILE,
    );
    expect(problems.some((p) => p.key === 'surfaces.process.cases[0].inputs[0].from')).toBe(true);
    expect(problems.some((p) => p.key === 'surfaces.process.cases[0].inputs[0].to')).toBe(true);
  });

  it('is invalid when a declared output entry itself is not a mapping', () => {
    const { problems } = validateParityDeclaration(
      rawDeclaration({ surfaces: { process: { run: 'x', cases: [{ outputs: ['nope'] }] } } }),
      FILE,
    );
    expect(problems.some((p) => p.key === 'surfaces.process.cases[0].outputs[0]')).toBe(true);
  });

  it('is invalid when a declared output\'s "path" is present but not a string', () => {
    const { problems } = validateParityDeclaration(
      rawDeclaration({ surfaces: { process: { run: 'x', cases: [{ outputs: [{ path: 42 }] }] } } }),
      FILE,
    );
    expect(problems.some((p) => p.key === 'surfaces.process.cases[0].outputs[0].path')).toBe(true);
  });

  it('is invalid when a declared output\'s "mode" is neither "text" nor "bytes"', () => {
    const { problems } = validateParityDeclaration(
      rawDeclaration({
        surfaces: { process: { run: 'x', cases: [{ outputs: [{ path: 'a', mode: 'other' }] }] } },
      }),
      FILE,
    );
    expect(problems.some((p) => p.key === 'surfaces.process.cases[0].outputs[0].mode')).toBe(true);
  });

  it('accepts a declared output with mode "bytes"', () => {
    const { problems, declaration } = validateParityDeclaration(
      rawDeclaration({
        surfaces: { process: { run: 'x', cases: [{ outputs: [{ path: 'a', mode: 'bytes' }] }] } },
      }),
      FILE,
    );
    expect(problems).toEqual([]);
    expect(declaration?.surfaces.process?.cases[0]?.outputs?.[0]?.mode).toBe('bytes');
  });

  it('is invalid when a normalize rule entry itself is not a mapping', () => {
    const { problems } = validateParityDeclaration(
      rawDeclaration({ surfaces: { process: { run: 'x', cases: [{ normalize: ['nope'] }] } } }),
      FILE,
    );
    expect(problems.some((p) => p.key === 'surfaces.process.cases[0].normalize[0]')).toBe(true);
  });

  it('is invalid when a normalize rule names an unrecognised "rule"', () => {
    const { problems } = validateParityDeclaration(
      rawDeclaration({
        surfaces: { process: { run: 'x', cases: [{ normalize: [{ rule: 'uppercase' }] }] } },
      }),
      FILE,
    );
    expect(problems.some((p) => p.key === 'surfaces.process.cases[0].normalize[0].rule')).toBe(
      true,
    );
  });

  it('is invalid when a normalize rule carries an unknown extra key', () => {
    const { problems } = validateParityDeclaration(
      rawDeclaration({
        surfaces: {
          process: { run: 'x', cases: [{ normalize: [{ rule: 'line-endings', extra: 1 }] }] },
        },
      }),
      FILE,
    );
    expect(problems.some((p) => p.key === 'surfaces.process.cases[0].normalize[0].extra')).toBe(
      true,
    );
  });

  it('is invalid when "ignore-json-pointers" has no, an empty, or a non-string-entry "pointers" list', () => {
    for (const bad of [undefined, [], [42]]) {
      const rule: Record<string, unknown> = { rule: 'ignore-json-pointers' };
      if (bad !== undefined) rule['pointers'] = bad;
      const { problems } = validateParityDeclaration(
        rawDeclaration({ surfaces: { process: { run: 'x', cases: [{ normalize: [rule] }] } } }),
        FILE,
      );
      expect(
        problems.some((p) => p.key === 'surfaces.process.cases[0].normalize[0].pointers'),
      ).toBe(true);
    }
  });

  it('accepts a well-formed "ignore-json-pointers" rule', () => {
    const { problems, declaration } = validateParityDeclaration(
      rawDeclaration({
        surfaces: {
          process: {
            run: 'x',
            cases: [{ normalize: [{ rule: 'ignore-json-pointers', pointers: ['/a/b'] }] }],
          },
        },
      }),
      FILE,
    );
    expect(problems).toEqual([]);
    expect(declaration?.surfaces.process?.cases[0]?.normalize).toEqual([
      { rule: 'ignore-json-pointers', pointers: ['/a/b'] },
    ]);
  });

  it('is invalid when a "replace" rule\'s pattern is missing, blank, or not a valid regular expression', () => {
    for (const pattern of [undefined, '', '[']) {
      const rule: Record<string, unknown> = { rule: 'replace', replacement: 'x' };
      if (pattern !== undefined) rule['pattern'] = pattern;
      const { problems } = validateParityDeclaration(
        rawDeclaration({ surfaces: { process: { run: 'x', cases: [{ normalize: [rule] }] } } }),
        FILE,
      );
      expect(problems.some((p) => p.key === 'surfaces.process.cases[0].normalize[0].pattern')).toBe(
        true,
      );
    }
  });

  it('is invalid when a "replace" rule\'s replacement is not a string', () => {
    const { problems } = validateParityDeclaration(
      rawDeclaration({
        surfaces: {
          process: {
            run: 'x',
            cases: [{ normalize: [{ rule: 'replace', pattern: 'a', replacement: 1 }] }],
          },
        },
      }),
      FILE,
    );
    expect(
      problems.some((p) => p.key === 'surfaces.process.cases[0].normalize[0].replacement'),
    ).toBe(true);
  });

  it('is invalid when a "replace" rule\'s stream is not "stdout"/"stderr"', () => {
    const { problems } = validateParityDeclaration(
      rawDeclaration({
        surfaces: {
          process: {
            run: 'x',
            cases: [
              { normalize: [{ rule: 'replace', pattern: 'a', replacement: 'b', stream: 'stdin' }] },
            ],
          },
        },
      }),
      FILE,
    );
    expect(problems.some((p) => p.key === 'surfaces.process.cases[0].normalize[0].stream')).toBe(
      true,
    );
  });

  it('is invalid when a "replace" rule\'s file is present but not a non-blank string', () => {
    const { problems } = validateParityDeclaration(
      rawDeclaration({
        surfaces: {
          process: {
            run: 'x',
            cases: [{ normalize: [{ rule: 'replace', pattern: 'a', replacement: 'b', file: '' }] }],
          },
        },
      }),
      FILE,
    );
    expect(problems.some((p) => p.key === 'surfaces.process.cases[0].normalize[0].file')).toBe(
      true,
    );
  });

  it('accepts a well-formed "replace" rule naming a stream and a file', () => {
    const { problems, declaration } = validateParityDeclaration(
      rawDeclaration({
        surfaces: {
          process: {
            run: 'x',
            cases: [
              {
                normalize: [
                  {
                    rule: 'replace',
                    pattern: 'a+',
                    replacement: 'b',
                    stream: 'stdout',
                    file: 'out.txt',
                  },
                ],
              },
            ],
          },
        },
      }),
      FILE,
    );
    expect(problems).toEqual([]);
    expect(declaration?.surfaces.process?.cases[0]?.normalize).toEqual([
      { rule: 'replace', pattern: 'a+', replacement: 'b', stream: 'stdout', file: 'out.txt' },
    ]);
  });

  it('is invalid when an unobservable entry itself is not a mapping', () => {
    const { problems } = validateParityDeclaration(
      rawDeclaration({ unobservable: ['nope'] }),
      FILE,
    );
    expect(problems.some((p) => p.key === 'unobservable[0]')).toBe(true);
  });

  it("is invalid when an unobservable entry's reason/owner are present but not strings (type, not blankness)", () => {
    const { problems } = validateParityDeclaration(
      rawDeclaration({
        unobservable: [{ surface: 'process', reason: 42, owner: 42, expiry: '2099-01-01' }],
      }),
      FILE,
    );
    expect(problems.some((p) => p.key === 'unobservable[0].reason')).toBe(true);
    expect(problems.some((p) => p.key === 'unobservable[0].owner')).toBe(true);
  });
});
