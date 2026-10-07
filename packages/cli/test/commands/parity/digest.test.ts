/**
 * `computeParityDeclarationDigest` (specs/22 M16 P2) — `13` F-TEST-9: "a sha256 over the whole
 * declaration in canonical form, except `review`, `expires` and `unobservable`, joined with the
 * content hashes of the files it overlays and the bytes of the probes it names, so renewing a review
 * does not invalidate a capture and changing anything that determines what is observed, or how,
 * does."
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { DigestFile } from '../../../src/commands/parity/digest.ts';
import { computeParityDeclarationDigest } from '../../../src/commands/parity/digest.ts';
import type { ParityDeclaration } from '../../../src/commands/parity/declaration-types.ts';
import { minimalCase, minimalDeclaration, minimalSurface } from './fixtures.ts';

function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function digest(
  declaration: ParityDeclaration,
  overlays: readonly DigestFile[] = [],
  probes: readonly DigestFile[] = [],
): string {
  return computeParityDeclarationDigest(declaration, overlays, probes);
}

describe('computeParityDeclarationDigest (specs/22 M16 P2)', () => {
  it('is a 64-character lower-case hex sha256', () => {
    const d = digest(minimalDeclaration());
    expect(d).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same declaration', () => {
    expect(digest(minimalDeclaration())).toBe(digest(minimalDeclaration()));
  });

  it('does not change when the object is built with keys inserted in a different order', () => {
    const a: ParityDeclaration = minimalDeclaration();
    // The identical declaration, built by explicit property order reversed at every level, to prove
    // the digest canonicalises rather than depending on JS object key insertion order.
    const b: ParityDeclaration = {
      unobservable: a.unobservable,
      surfaces: {
        process: {
          cases: a.surfaces.process?.cases ?? [],
          stability: a.surfaces.process?.stability ?? { runs: 3 },
          run: a.surfaces.process?.run ?? '',
        },
      },
      expires: a.expires,
      review: { at: a.review.at, basis: a.review.basis, by: a.review.by },
      reference: { ref: a.reference.ref },
      name: a.name,
    };
    expect(digest(a)).toBe(digest(b));
  });

  describe('fields excluded from the digest (specs/22 M16 P2) (renewing a review must not invalidate a capture)', () => {
    it('review.by does not change it', () => {
      const base = digest(minimalDeclaration());
      const changed = digest(
        minimalDeclaration({
          review: { by: 'bob', basis: 'read the diff by hand', at: '2026-01-01' },
        }),
      );
      expect(changed).toBe(base);
    });

    it('review.basis does not change it', () => {
      const base = digest(minimalDeclaration());
      const changed = digest(
        minimalDeclaration({
          review: { by: 'alice', basis: 'a completely different basis', at: '2026-01-01' },
        }),
      );
      expect(changed).toBe(base);
    });

    it('review.at does not change it', () => {
      const base = digest(minimalDeclaration());
      const changed = digest(
        minimalDeclaration({
          review: { by: 'alice', basis: 'read the diff by hand', at: '2099-01-01' },
        }),
      );
      expect(changed).toBe(base);
    });

    it('expires does not change it', () => {
      const base = digest(minimalDeclaration());
      const changed = digest(minimalDeclaration({ expires: '2030-06-15' }));
      expect(changed).toBe(base);
    });

    it('an unobservable entry (added, removed, or changed) does not change it', () => {
      const base = digest(minimalDeclaration());
      const withExtraSurface = minimalDeclaration({
        surfaces: { process: minimalSurface(), file: minimalSurface() },
      });
      const baseWithTwoSurfaces = digest(withExtraSurface);
      const withUnobservable = digest(
        minimalDeclaration({
          surfaces: { process: minimalSurface(), file: minimalSurface() },
          unobservable: [
            { surface: 'file', reason: 'no file I/O here', owner: 'alice', expiry: '2099-01-01' },
          ],
        }),
      );
      expect(withUnobservable).toBe(baseWithTwoSurfaces);
      expect(baseWithTwoSurfaces).not.toBe(base); // sanity: adding the surface itself DOES change it
    });
  });

  describe('every other field changes it (specs/22 M16 P2) (a table over each)', () => {
    const base = minimalDeclaration();
    const baseDigest = digest(base);

    it.each<readonly [string, ParityDeclaration]>([
      ['name', minimalDeclaration({ name: 'other' })],
      ['reference.ref', minimalDeclaration({ reference: { ref: 'b'.repeat(40) } })],
      [
        'surface.run',
        minimalDeclaration({ surfaces: { process: minimalSurface({ run: 'node other.js' }) } }),
      ],
      [
        'surface.setup',
        minimalDeclaration({ surfaces: { process: minimalSurface({ setup: ['node build.js'] }) } }),
      ],
      [
        'surface.streams',
        minimalDeclaration({ surfaces: { process: minimalSurface({ streams: ['stdout'] }) } }),
      ],
      [
        'surface.stability.runs',
        minimalDeclaration({ surfaces: { process: minimalSurface({ stability: { runs: 5 } }) } }),
      ],
      [
        'case.args',
        minimalDeclaration({
          surfaces: { process: minimalSurface({ cases: [minimalCase({ args: ['x'] })] }) },
        }),
      ],
      [
        'case.inputs',
        minimalDeclaration({
          surfaces: {
            process: minimalSurface({
              cases: [minimalCase({ inputs: [{ from: '.forge/parity/in.txt', to: 'in.txt' }] })],
            }),
          },
        }),
      ],
      [
        'case.outputs',
        minimalDeclaration({
          surfaces: {
            process: minimalSurface({ cases: [minimalCase({ outputs: [{ path: 'out.txt' }] })] }),
          },
        }),
      ],
      [
        'case.normalize (line-endings)',
        minimalDeclaration({
          surfaces: {
            process: minimalSurface({
              cases: [minimalCase({ normalize: [{ rule: 'line-endings' }] })],
            }),
          },
        }),
      ],
      [
        'case.normalize (replace)',
        minimalDeclaration({
          surfaces: {
            process: minimalSurface({
              cases: [
                minimalCase({ normalize: [{ rule: 'replace', pattern: 'a', replacement: 'b' }] }),
              ],
            }),
          },
        }),
      ],
      [
        'case.normalize (ignore-json-pointers)',
        minimalDeclaration({
          surfaces: {
            process: minimalSurface({
              cases: [
                minimalCase({ normalize: [{ rule: 'ignore-json-pointers', pointers: ['/a/b'] }] }),
              ],
            }),
          },
        }),
      ],
      [
        'case.timeoutMs',
        minimalDeclaration({
          surfaces: { process: minimalSurface({ cases: [minimalCase({ timeoutMs: 5000 })] }) },
        }),
      ],
      [
        'case.outputCapBytes',
        minimalDeclaration({
          surfaces: { process: minimalSurface({ cases: [minimalCase({ outputCapBytes: 1024 })] }) },
        }),
      ],
      [
        'case.expect',
        minimalDeclaration({
          surfaces: { process: minimalSurface({ cases: [minimalCase({ expect: 1 })] }) },
        }),
      ],
    ])('%s changes the digest', (_label, changed) => {
      expect(digest(changed)).not.toBe(baseDigest);
    });
  });

  describe('every http-specific field changes it too (specs/22 M16 P8) (a table over each — the soundness property every other case already has: a declaration change that alters observed behaviour must invalidate an existing capture)', () => {
    function httpDeclaration(overrides: {
      readonly port?: number;
      readonly readiness?: { readonly path: string; readonly timeoutMs: number };
      readonly request?: {
        readonly method: string;
        readonly path: string;
        readonly headers?: Readonly<Record<string, string>>;
        readonly body?: string;
        readonly responseHeaders?: readonly string[];
      };
    }): ParityDeclaration {
      return minimalDeclaration({
        surfaces: {
          http: minimalSurface({
            run: 'node server.js',
            network: 'loopback',
            port: overrides.port ?? 4123,
            readiness: overrides.readiness ?? { path: '/healthz', timeoutMs: 5000 },
            cases: [
              minimalCase({
                request: overrides.request ?? { method: 'GET', path: '/' },
              }),
            ],
          }),
        },
      });
    }

    const base = httpDeclaration({});
    const baseDigest = digest(base);

    it.each<readonly [string, ParityDeclaration]>([
      ['surface.port', httpDeclaration({ port: 4124 })],
      [
        'surface.readiness.path',
        httpDeclaration({ readiness: { path: '/other', timeoutMs: 5000 } }),
      ],
      [
        'surface.readiness.timeoutMs',
        httpDeclaration({ readiness: { path: '/healthz', timeoutMs: 9000 } }),
      ],
      ['case.request.method', httpDeclaration({ request: { method: 'POST', path: '/' } })],
      ['case.request.path', httpDeclaration({ request: { method: 'GET', path: '/other' } })],
      [
        'case.request.headers',
        httpDeclaration({ request: { method: 'GET', path: '/', headers: { 'x-a': '1' } } }),
      ],
      ['case.request.body', httpDeclaration({ request: { method: 'POST', path: '/', body: 'x' } })],
      [
        'case.request.responseHeaders',
        httpDeclaration({ request: { method: 'GET', path: '/', responseHeaders: ['x-flavor'] } }),
      ],
    ])('%s changes the digest', (_label, changed) => {
      expect(digest(changed)).not.toBe(baseDigest);
    });
  });

  describe('overlay and probe bytes (specs/22 M16 P2)', () => {
    it('an overlaid file byte change changes the digest', () => {
      const d = minimalDeclaration();
      const a = digest(d, [{ path: 'in.txt', bytes: Buffer.from('hello') }]);
      const b = digest(d, [{ path: 'in.txt', bytes: Buffer.from('world') }]);
      expect(a).not.toBe(b);
    });

    it('a probe byte change changes the digest', () => {
      const d = minimalDeclaration();
      const a = digest(d, [], [{ path: 'probes/x.mjs', bytes: Buffer.from('console.log(1)') }]);
      const b = digest(d, [], [{ path: 'probes/x.mjs', bytes: Buffer.from('console.log(2)') }]);
      expect(a).not.toBe(b);
    });

    it('overlay/probe order given by the caller does not matter (sorted internally)', () => {
      const d = minimalDeclaration();
      const files: DigestFile[] = [
        { path: 'b.txt', bytes: Buffer.from('B') },
        { path: 'a.txt', bytes: Buffer.from('A') },
      ];
      const forward = digest(d, files);
      const reversed = digest(d, [...files].reverse());
      expect(forward).toBe(reversed);
    });

    it('an overlay and a probe with the same bytes still contribute differently (content hash vs raw bytes)', () => {
      const d = minimalDeclaration();
      const asOverlay = digest(d, [{ path: 'x', bytes: Buffer.from('same') }], []);
      const asProbe = digest(d, [], [{ path: 'x', bytes: Buffer.from('same') }]);
      expect(asOverlay).not.toBe(asProbe);
    });

    it('defaults to no overlays/probes, equal to passing empty arrays explicitly', () => {
      const d = minimalDeclaration();
      expect(digest(d)).toBe(computeParityDeclarationDigest(d, [], []));
    });

    describe('the join cannot be forged by a crafted path (specs/22 M16 P2) (a fresh-context critic built this collision against the first version of this function)', () => {
      it('a path crafted to reproduce exactly what the OLD raw-delimited join would have emitted for two separate entries must not collide with those two entries', () => {
        const d = minimalDeclaration();
        const bytesA = Buffer.from('A-CONTENT');
        const bytesB = Buffer.from('B-CONTENT');
        const twoEntries: readonly DigestFile[] = [
          { path: 'a', bytes: bytesA },
          { path: 'b', bytes: bytesB },
        ];
        // The OLD, vulnerable join was `` `overlay ${path} ${sha256Hex(bytes)}\n` `` per entry,
        // concatenated raw. `twoEntries` above would have produced exactly:
        //   `overlay a <sha256(A-CONTENT)>\noverlay b <sha256(B-CONTENT)>\n`
        // A single entry whose OWN path is crafted to contain the first entry's hash, a real
        // newline, and the literal text "overlay b" reproduces that EXACT byte sequence once its
        // own (real) bytes hash to <sha256(B-CONTENT)> too — i.e. its bytes equal bytesB.
        const craftedPath = `a ${sha256Hex(bytesA)}\noverlay b`;
        const craftedSingleEntry: readonly DigestFile[] = [{ path: craftedPath, bytes: bytesB }];
        // Confirm the premise: this really is the old vulnerability, not a strawman. Rebuilding
        // the OLD algorithm's exact join text by hand for both inputs must give identical strings
        // (proving the crafted entry is a genuine forgery under the retired scheme), while this
        // module's CURRENT digest of the two must differ.
        const oldJoinOfTwo = twoEntries
          .map((e) => `overlay ${e.path} ${sha256Hex(e.bytes)}\n`)
          .join('');
        const oldJoinOfCrafted = craftedSingleEntry
          .map((e) => `overlay ${e.path} ${sha256Hex(e.bytes)}\n`)
          .join('');
        expect(oldJoinOfCrafted).toBe(oldJoinOfTwo); // the historical bug, reproduced in isolation
        expect(digest(d, craftedSingleEntry)).not.toBe(digest(d, twoEntries)); // the fix
      });

      it('a path containing a literal quote, backslash and newline is still bound by its real content (no escape-based collision)', () => {
        const d = minimalDeclaration();
        const trickyPath = 'a"b\\c\nd';
        const a = digest(d, [{ path: trickyPath, bytes: Buffer.from('X') }]);
        const b = digest(d, [{ path: trickyPath, bytes: Buffer.from('Y') }]);
        const c = digest(d, [{ path: 'different', bytes: Buffer.from('X') }]);
        expect(a).not.toBe(b);
        expect(a).not.toBe(c);
      });

      it("a probe path crafted to look like a second entry's own header cannot smuggle a different probe set past this module", () => {
        const d = minimalDeclaration();
        const bytesA = Buffer.from('short');
        const bytesB = Buffer.from('other');
        const twoProbes: readonly DigestFile[] = [
          { path: 'a', bytes: bytesA },
          { path: 'b', bytes: bytesB },
        ];
        // An attempt at the length-prefixed scheme's own analogue of the attack: a path holding
        // what looks like a second entry's complete JSON header, so a naive scheme that did not
        // escape the path (or that trusted an attacker-controlled length) might read one entry as
        // two. The real fix does not parse this back apart at all — it is just more bytes inside
        // ONE JSON-escaped string — so this must still land on a different digest than the real
        // two-probe list, for any bytes.
        const craftedPath = `a","bytes":${String(bytesB.length)}}{"probe":"b`;
        expect(digest(d, [], [{ path: craftedPath, bytes: bytesA }])).not.toBe(
          digest(d, [], twoProbes),
        );
      });
    });
  });
});
