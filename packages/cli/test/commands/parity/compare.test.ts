/**
 * `decideCaseVerdict`: normalise, probe stability, decide one of the five case-level verdicts by
 * `13` F-TEST-9's total precedence (specs/22 M16 P4).
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 */
import { describe, expect, it } from 'vitest';

import type {
  ProcessObservation,
  SurfaceObservation,
} from '../../../src/commands/parity/capture.ts';
import {
  buildMismatchExcerpt,
  decideCaseVerdict,
  observationsEqual,
  type CaseComparisonInput,
} from '../../../src/commands/parity/compare.ts';

function processObservation(stdout: string, exitCode = 0): ProcessObservation {
  return { surface: 'process', stdout, exit: { kind: 'code', code: exitCode } };
}

const NO_ROOT = { asGiven: '', real: '' };

function input(overrides: Partial<CaseComparisonInput> = {}): CaseComparisonInput {
  const reference = processObservation('ok\n');
  return {
    surface: 'process',
    caseIndex: 0,
    rules: [],
    referenceNormalized: reference,
    candidateRawRuns: [processObservation('ok\n')],
    candidateRoot: NO_ROOT,
    unclean: false,
    ...overrides,
  };
}

describe('decideCaseVerdict: match and mismatch on the full normalised content (specs/22 M16 P4)', () => {
  it('is match when the (stable) candidate equals the reference exactly', () => {
    expect(decideCaseVerdict(input())).toEqual({ verdict: 'match' });
  });

  it('is mismatch, naming the differing stream, when the candidate differs from the reference', () => {
    const outcome = decideCaseVerdict(
      input({ candidateRawRuns: [processObservation('different\n')] }),
    );
    expect(outcome).toEqual({
      verdict: 'mismatch',
      location: { surface: 'process', stream: 'stdout' },
    });
  });

  it(
    'the equal-on-display-bytes-but-not-after regression: two observations equal on their first N ' +
      'display-cap bytes and different after it are mismatch, never match',
    () => {
      // A naive "compare what you would display" implementation that only compares, say, the first
      // 200 bytes (a typical display cap) would read these as equal. The real content differs only
      // past byte 200, well beyond any reasonable cap, so this proves equality is decided on the
      // FULL content.
      const displayCap = 200;
      const sharedPrefix = 'x'.repeat(displayCap + 50);
      const reference = processObservation(`${sharedPrefix}REFERENCE-TAIL`);
      const candidate = processObservation(`${sharedPrefix}CANDIDATE-TAIL`);
      expect(reference.stdout?.slice(0, displayCap)).toBe(candidate.stdout?.slice(0, displayCap));
      expect(reference.stdout).not.toBe(candidate.stdout); // genuinely different past the cap

      const outcome = decideCaseVerdict(
        input({ referenceNormalized: reference, candidateRawRuns: [candidate] }),
      );
      expect(outcome.verdict).toBe('mismatch');
    },
  );

  it('compares file-surface text content and reports the differing path', () => {
    const reference: SurfaceObservation = {
      surface: 'file',
      files: [{ path: 'out.txt', content: { mode: 'text', text: 'a' } }],
    };
    const candidate: SurfaceObservation = {
      surface: 'file',
      files: [{ path: 'out.txt', content: { mode: 'text', text: 'b' } }],
    };
    const outcome = decideCaseVerdict(
      input({
        surface: 'file',
        referenceNormalized: reference,
        candidateRawRuns: [candidate],
      }),
    );
    expect(outcome).toEqual({
      verdict: 'mismatch',
      location: { surface: 'file', file: 'out.txt' },
    });
  });

  it('compares file-surface bytes-mode content by sha256 alone', () => {
    const reference: SurfaceObservation = {
      surface: 'file',
      files: [{ path: 'img.bin', content: { mode: 'bytes', sha256: 'aa'.repeat(32) } }],
    };
    const sameHash: SurfaceObservation = {
      surface: 'file',
      files: [{ path: 'img.bin', content: { mode: 'bytes', sha256: 'aa'.repeat(32) } }],
    };
    expect(observationsEqual(reference, sameHash)).toBe(true);
  });

  it('compares library observations structurally, insensitive to key order', () => {
    const reference: SurfaceObservation = {
      surface: 'library',
      result: { ok: true, value: { a: 1, b: 2 } },
    };
    const reordered: SurfaceObservation = {
      surface: 'library',
      result: { ok: true, value: { b: 2, a: 1 } },
    };
    expect(observationsEqual(reference, reordered)).toBe(true);
  });

  it('a library result that genuinely differs is not equal', () => {
    const reference: SurfaceObservation = { surface: 'library', result: { ok: true, value: 1 } };
    const different: SurfaceObservation = { surface: 'library', result: { ok: true, value: 2 } };
    expect(observationsEqual(reference, different)).toBe(false);
  });

  it('compares a process exit decided by signal, not just by code', () => {
    const bySignal: SurfaceObservation = {
      surface: 'process',
      exit: { kind: 'signal', signal: 'SIGKILL' },
    };
    const sameSignal: SurfaceObservation = {
      surface: 'process',
      exit: { kind: 'signal', signal: 'SIGKILL' },
    };
    const differentSignal: SurfaceObservation = {
      surface: 'process',
      exit: { kind: 'signal', signal: 'SIGTERM' },
    };
    expect(observationsEqual(bySignal, sameSignal)).toBe(true);
    expect(observationsEqual(bySignal, differentSignal)).toBe(false);
  });

  it('a code exit and a signal exit are never equal, whatever their values', () => {
    const byCode: SurfaceObservation = processObservation('x', 0);
    const bySignal: SurfaceObservation = {
      surface: 'process',
      stdout: 'x',
      exit: { kind: 'signal', signal: 'SIGKILL' },
    };
    expect(observationsEqual(byCode, bySignal)).toBe(false);
  });

  it('two file entries at the same path with different content modes are not equal', () => {
    // Not reachable from a well-formed declaration (a declared output's `mode` is fixed by the
    // declaration, so both sides of a comparison always observe it the same way) -- exercised
    // directly anyway so `fileContentEqual`'s own mode-mismatch branch is proven, not merely assumed
    // unreachable.
    const textMode: SurfaceObservation = {
      surface: 'file',
      files: [{ path: 'out', content: { mode: 'text', text: 'x' } }],
    };
    const bytesMode: SurfaceObservation = {
      surface: 'file',
      files: [{ path: 'out', content: { mode: 'bytes', sha256: 'a'.repeat(64) } }],
    };
    expect(observationsEqual(textMode, bytesMode)).toBe(false);
  });

  it('observationsEqual’s catch-all is unreached by any real SurfaceObservation, proven by defeating the type system', () => {
    // `SurfaceObservation` has exactly four members (process/file/library/http — `specs/22` M16 P8
    // added the fourth); once `a.surface === b.surface` holds, one of the four `if` branches always
    // matches, so the function's own final `return false` is unreachable through the public type. A
    // value that defeats the type system (the same "escape hatch" pattern `canonical-json.ts` uses for
    // its own catch-all) is the only way to reach it, which this test does explicitly rather than
    // leaving the line unproven. `'bogus'`, not `'http'`: `http` is now a REAL member this function
    // has its own real branch for (see the `http` describe block below), so it would no longer defeat
    // anything.
    const typeDefeating = { surface: 'bogus' } as unknown as SurfaceObservation;
    expect(observationsEqual(typeDefeating, typeDefeating)).toBe(false);
  });

  it('decideCaseVerdict normalises a library case via ignore-json-pointers and finds a match', () => {
    const outcome = decideCaseVerdict(
      input({
        surface: 'library',
        rules: [{ rule: 'ignore-json-pointers', pointers: ['/timestamp'] }],
        referenceNormalized: { surface: 'library', result: { ok: true, value: { kept: 1 } } },
        candidateRawRuns: [
          { surface: 'library', result: { ok: true, value: { kept: 1, timestamp: 123 } } },
        ],
      }),
    );
    expect(outcome).toEqual({ verdict: 'match' });
  });

  it(
    'the round-6 fix reaches the library path too: ascending array-index pointers resolve ' +
      'correctly through decideCaseVerdict, not just through the text path',
    () => {
      // Without `reorderPointersForSafeRemoval` applied here, `/list/0`,`/list/1`,`/list/2` written
      // in ascending order would mistarget (leaving `['B','D']`) and this would read `mismatch`
      // against a reference that correctly expects `['D','E']`.
      const outcome = decideCaseVerdict(
        input({
          surface: 'library',
          rules: [
            {
              rule: 'ignore-json-pointers',
              pointers: ['/list/0', '/list/1', '/list/2'],
            },
          ],
          referenceNormalized: {
            surface: 'library',
            result: { ok: true, value: { list: ['D', 'E'] } },
          },
          candidateRawRuns: [
            {
              surface: 'library',
              result: { ok: true, value: { list: ['A', 'B', 'C', 'D', 'E'] } },
            },
          ],
        }),
      );
      expect(outcome).toEqual({ verdict: 'match' });
    },
  );

  it('decideCaseVerdict passes a thrown library result through normalisation untouched', () => {
    const errorResult: SurfaceObservation = {
      surface: 'library',
      result: { ok: false, error: { name: 'TypeError', message: 'boom' } },
    };
    const outcome = decideCaseVerdict(
      input({
        surface: 'library',
        rules: [{ rule: 'ignore-json-pointers', pointers: ['/anything'] }],
        referenceNormalized: errorResult,
        candidateRawRuns: [errorResult],
      }),
    );
    expect(outcome).toEqual({ verdict: 'match' });
  });

  it('a library ignore-json-pointers rule that removes the root is the identical erase-everything violation', () => {
    const outcome = decideCaseVerdict(
      input({
        surface: 'library',
        rules: [{ rule: 'ignore-json-pointers', pointers: [''] }],
        referenceNormalized: { surface: 'library', result: { ok: true, value: 1 } },
        candidateRawRuns: [{ surface: 'library', result: { ok: true, value: { a: 1 } } }],
      }),
    );
    expect(outcome.verdict).toBe('error');
  });

  it('normalises a file-surface case through the orchestrator (not merely compares it)', () => {
    const outcome = decideCaseVerdict(
      input({
        surface: 'file',
        rules: [{ rule: 'trim-trailing-whitespace' }],
        referenceNormalized: {
          surface: 'file',
          files: [{ path: 'out.txt', content: { mode: 'text', text: 'hello' } }],
        },
        candidateRawRuns: [
          {
            surface: 'file',
            files: [{ path: 'out.txt', content: { mode: 'text', text: 'hello   ' } }],
          },
        ],
      }),
    );
    expect(outcome).toEqual({ verdict: 'match' });
  });

  it('mismatchLocationOf names stderr when stdout matches but stderr differs', () => {
    const outcome = decideCaseVerdict(
      input({
        referenceNormalized: processObservation('same-stdout'),
        candidateRawRuns: [
          {
            surface: 'process',
            stdout: 'same-stdout',
            stderr: 'oops',
            exit: { kind: 'code', code: 0 },
          },
        ],
      }),
    );
    expect(outcome).toEqual({
      verdict: 'mismatch',
      location: { surface: 'process', stream: 'stderr' },
    });
  });

  it('mismatchLocationOf falls back to the bare surface when only the exit differs (no stream differs)', () => {
    const outcome = decideCaseVerdict(
      input({
        referenceNormalized: processObservation('same', 0),
        candidateRawRuns: [processObservation('same', 1)],
      }),
    );
    expect(outcome).toEqual({ verdict: 'mismatch', location: { surface: 'process' } });
  });

  it('mismatchLocationOf falls back to the bare surface for a library mismatch (no stream or file to name)', () => {
    const outcome = decideCaseVerdict(
      input({
        surface: 'library',
        referenceNormalized: { surface: 'library', result: { ok: true, value: 1 } },
        candidateRawRuns: [{ surface: 'library', result: { ok: true, value: 2 } }],
      }),
    );
    expect(outcome).toEqual({ verdict: 'mismatch', location: { surface: 'library' } });
  });

  it('propagates a non-ForgeError throw rather than swallowing it (zero candidate runs is a programming error)', () => {
    // `decideStability` throws a plain `RangeError` for zero runs (its own documented precondition
    // failure, never something a well-formed `stability.runs` 2-10 declaration can trigger) -- this
    // proves `decideCaseVerdict`'s own catch block re-throws anything that is not a `ForgeError`
    // rather than mis-reporting it as a case-level `error` verdict.
    expect(() => decideCaseVerdict(input({ candidateRawRuns: [] }))).toThrow(RangeError);
  });
});

describe('decideCaseVerdict: total precedence over unclean/unstable/error (specs/22 M16 P4)', () => {
  it('unclean outranks a content match: a clean-looking comparison still reads unclean', () => {
    const outcome = decideCaseVerdict(input({ unclean: true }));
    expect(outcome).toEqual({ verdict: 'unclean' });
  });

  it('unstable when the candidate disagrees with itself across stability runs (and is not unclean)', () => {
    const outcome = decideCaseVerdict(
      input({
        candidateRawRuns: [
          processObservation('A'),
          processObservation('A'),
          processObservation('B'),
        ],
      }),
    );
    expect(outcome).toEqual({ verdict: 'unstable' });
  });

  it('unclean outranks unstable: a dirty, flaky candidate reads unclean, not unstable', () => {
    const outcome = decideCaseVerdict(
      input({
        candidateRawRuns: [processObservation('A'), processObservation('B')],
        unclean: true,
      }),
    );
    expect(outcome).toEqual({ verdict: 'unclean' });
  });

  it('error outranks everything: a rule that cannot be applied wins even when the tree is also unclean', () => {
    const outcome = decideCaseVerdict(
      input({
        rules: [{ rule: 'json-canonical' }],
        referenceNormalized: processObservation('{}'),
        candidateRawRuns: [processObservation('not json')],
        unclean: true,
      }),
    );
    expect(outcome.verdict).toBe('error');
  });

  it(
    'an error verdict’s reason is the real RUN-130 message, naming the surface, case and rule ' +
      '-- pinned exactly, not just the verdict discriminant (mutating RUN-130’s own message ' +
      'template must break this test)',
    () => {
      const outcome = decideCaseVerdict(
        input({
          surface: 'process',
          caseIndex: 0,
          rules: [{ rule: 'json-canonical' }],
          referenceNormalized: processObservation('{}'),
          candidateRawRuns: [processObservation('not json')],
        }),
      );
      expect(outcome).toEqual({
        verdict: 'error',
        reason:
          "Surface process case 0's json-canonical rule could not be applied: does not parse as JSON.",
      });
    },
  );

  it(
    'a library observation holding a value toCanonicalJson cannot represent (NaN) is a typed ' +
      'RUN-130 error verdict, never a bare uncaught TypeError',
    () => {
      // Every TEXT path already converts a normalise-time failure to RUN-130; the library/structured
      // comparison path (`observationsEqual`'s own `toCanonicalJson` call, reached from inside
      // `decideStability`'s equality check with only ONE candidate run, comparing it to itself) had
      // no equivalent guard and threw a raw `TypeError` straight out of `decideCaseVerdict` — a
      // critic-found crash, reproduced here and now caught.
      expect(() =>
        decideCaseVerdict(
          input({
            surface: 'library',
            referenceNormalized: { surface: 'library', result: { ok: true, value: 1 } },
            candidateRawRuns: [{ surface: 'library', result: { ok: true, value: Number.NaN } }],
          }),
        ),
      ).not.toThrow();
      const outcome = decideCaseVerdict(
        input({
          surface: 'library',
          referenceNormalized: { surface: 'library', result: { ok: true, value: 1 } },
          candidateRawRuns: [{ surface: 'library', result: { ok: true, value: Number.NaN } }],
        }),
      );
      expect(outcome.verdict).toBe('error');
    },
  );

  it('a RangeError (zero candidate runs, a programming error) is NOT reinterpreted as RUN-130 -- it still propagates', () => {
    // Distinguishes the new TypeError-to-RUN-130 catch from `decideStability`'s own, unrelated
    // "at least one run" precondition failure, which must keep propagating as a real crash (a
    // caller bug), never be silently folded into a case-level verdict.
    expect(() => decideCaseVerdict(input({ candidateRawRuns: [] }))).toThrow(RangeError);
  });

  it('the stability sampling-is-not-proof disclosure: stability.runs=2 can read match by chance even though the case varies', () => {
    // A seeded-but-genuinely-nondeterministic test double: a case that varies on 1 run in 5. With
    // only 2 stability runs sampled, there is a real, demonstrable chance both sampled runs land on
    // the SAME value even though the case is not actually deterministic -- this is `13` F-TEST-9's
    // own "stability is a sample, not a proof" disclosure, shown happening rather than merely stated.
    let callCount = 0;
    const flakyOneInFive = (): ProcessObservation => {
      callCount += 1;
      // Runs 1-4 (of every 5) return "A"; run 5 returns "B" -- a real, deterministic-for-the-test
      // generator standing in for "varies on 1 run in 5", not a `Math.random()` call (QUALITY-BAR.md
      // R10).
      return processObservation(callCount % 5 === 0 ? 'B' : 'A');
    };
    const twoSampledRuns = [flakyOneInFive(), flakyOneInFive()]; // calls 1 and 2: both "A"
    expect(twoSampledRuns.every((run) => run.stdout === 'A')).toBe(true); // the two samples agree...
    const laterCallWouldDiffer = flakyOneInFive(); // call 3: still "A" -- but call 5 would be "B"
    expect(laterCallWouldDiffer.stdout).toBe('A');

    const outcome = decideCaseVerdict(
      input({ candidateRawRuns: twoSampledRuns, referenceNormalized: processObservation('A') }),
    );
    // With only 2 of the 5 real behaviours sampled, and both sampled runs happening to agree, this
    // reads `match` -- exactly the disclosed risk, demonstrated with a real generator rather than
    // restated as prose.
    expect(outcome).toEqual({ verdict: 'match' });
  });
});

describe('decideCaseVerdict: the information boundary (specs/22 M16 P4)', () => {
  it('a mismatch result never carries the observed text anywhere, not merely in one named field', () => {
    const secret = 'sk-live-THIS-IS-SECRET-SHAPED-CONTENT-9f8e7d6c5b4a';
    const reference = processObservation('expected output');
    const candidate = processObservation(secret);
    const outcome = decideCaseVerdict(
      input({ referenceNormalized: reference, candidateRawRuns: [candidate] }),
    );
    expect(outcome.verdict).toBe('mismatch');
    const serialised = JSON.stringify(outcome);
    expect(serialised).not.toContain(secret);
    expect(serialised).not.toContain('expected output');
    // Not just "the secret is absent": the WHOLE result is content-free structurally -- it carries
    // only `verdict` and `location` (surface/stream/file), never a text field at all.
    expect(Object.keys(outcome).sort()).toEqual(['location', 'verdict']);
  });

  it('an error result’s reason never echoes the non-JSON observation text', () => {
    const secret = 'super-secret-token-not-valid-json-at-all';
    const outcome = decideCaseVerdict(
      input({
        rules: [{ rule: 'json-canonical' }],
        referenceNormalized: processObservation('{}'),
        candidateRawRuns: [processObservation(secret)],
      }),
    );
    expect(outcome.verdict).toBe('error');
    expect(JSON.stringify(outcome)).not.toContain(secret);
  });
});

describe('buildMismatchExcerpt: display-only, never reached from decideCaseVerdict itself (specs/22 M16 P4)', () => {
  it('finds the first differing line and the line immediately before it as context', () => {
    const reference = 'line1\nline2\nline3-ref';
    const candidate = 'line1\nline2\nline3-candidate';
    expect(buildMismatchExcerpt(reference, candidate, 100)).toEqual({
      line: 3,
      context: 'line2',
      reference: 'line3-ref',
      candidate: 'line3-candidate',
    });
  });

  it('caps each side under the given length, appending an ellipsis', () => {
    const excerpt = buildMismatchExcerpt('a'.repeat(50), 'b'.repeat(50), 10);
    expect(excerpt?.reference).toBe(`${'a'.repeat(10)}…`);
    expect(excerpt?.candidate).toBe(`${'b'.repeat(10)}…`);
  });

  it('returns undefined when the two texts are equal (nothing to excerpt)', () => {
    expect(buildMismatchExcerpt('same', 'same', 100)).toBeUndefined();
  });

  it('has no context on the very first line', () => {
    expect(buildMismatchExcerpt('a', 'b', 100)?.context).toBeUndefined();
  });
});

describe('decideCaseVerdict: the root-path-to-token rewrite runs before any declared rule (specs/22 M16 P4)', () => {
  it('a candidate run whose stdout differs only by its own root path still matches the reference', () => {
    // The reference was captured with its OWN (scratch-worktree) root path baked into the stored,
    // already-rewritten `referenceNormalized` value as the fixed token (exactly what P6's own
    // capture-time call to `normalizeAndCheckStability` would have produced). The candidate's raw
    // stdout instead carries the CANDIDATE's own, differently-spelled root path. Without the
    // rewrite, these would never match on an unrelated, uninteresting difference (where the tree
    // happens to live); with it, both reduce to the identical token and genuinely match.
    const outcome = decideCaseVerdict(
      input({
        referenceNormalized: processObservation('wrote to <PARITY-ROOT>/out.txt'),
        candidateRawRuns: [processObservation('wrote to /home/ci/checkout-7f3/out.txt')],
        candidateRoot: { asGiven: '/home/ci/checkout-7f3', real: '/home/ci/checkout-7f3' },
      }),
    );
    expect(outcome).toEqual({ verdict: 'match' });
  });

  it('rewrites both the as-given and the real candidate root path before comparing', () => {
    const outcome = decideCaseVerdict(
      input({
        referenceNormalized: processObservation('<PARITY-ROOT>/data'),
        candidateRawRuns: [processObservation('/private/tmp/proj-x/data')],
        candidateRoot: { asGiven: '/tmp/proj-x', real: '/private/tmp/proj-x' },
      }),
    );
    expect(outcome).toEqual({ verdict: 'match' });
  });

  it('a genuine content difference beyond the root path still reads mismatch', () => {
    const outcome = decideCaseVerdict(
      input({
        referenceNormalized: processObservation('<PARITY-ROOT>/out.txt: 3 passed'),
        candidateRawRuns: [processObservation('/home/ci/checkout-7f3/out.txt: 2 passed')],
        candidateRoot: { asGiven: '/home/ci/checkout-7f3', real: '/home/ci/checkout-7f3' },
      }),
    );
    expect(outcome.verdict).toBe('mismatch');
  });

  it('also rewrites a file surface’s text content against the candidate root', () => {
    const outcome = decideCaseVerdict(
      input({
        surface: 'file',
        referenceNormalized: {
          surface: 'file',
          files: [{ path: 'out.txt', content: { mode: 'text', text: '<PARITY-ROOT>/log' } }],
        },
        candidateRawRuns: [
          {
            surface: 'file',
            files: [{ path: 'out.txt', content: { mode: 'text', text: '/srv/build-42/log' } }],
          },
        ],
        candidateRoot: { asGiven: '/srv/build-42', real: '/srv/build-42' },
      }),
    );
    expect(outcome).toEqual({ verdict: 'match' });
  });
});

function httpObservation(
  overrides: Partial<{
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
  }> = {},
): SurfaceObservation {
  return { surface: 'http', status: 200, headers: {}, body: 'ok', ...overrides };
}

describe('decideCaseVerdict: the http surface (specs/22 M16 P8)', () => {
  it('an identical status/headers/body matches', () => {
    const outcome = decideCaseVerdict(
      input({
        surface: 'http',
        referenceNormalized: httpObservation({ headers: { 'x-flavor': 'vanilla' } }),
        candidateRawRuns: [httpObservation({ headers: { 'x-flavor': 'vanilla' } })],
      }),
    );
    expect(outcome).toEqual({ verdict: 'match' });
  });

  it('a differing status mismatches, naming "status"', () => {
    const outcome = decideCaseVerdict(
      input({
        surface: 'http',
        referenceNormalized: httpObservation({ status: 200 }),
        candidateRawRuns: [httpObservation({ status: 404 })],
      }),
    );
    expect(outcome).toEqual({
      verdict: 'mismatch',
      location: { surface: 'http', httpPart: 'status' },
    });
  });

  it('a differing selected header mismatches, naming "headers" -- status and body both equal', () => {
    const outcome = decideCaseVerdict(
      input({
        surface: 'http',
        referenceNormalized: httpObservation({ headers: { 'x-flavor': 'vanilla' } }),
        candidateRawRuns: [httpObservation({ headers: { 'x-flavor': 'chocolate' } })],
      }),
    );
    expect(outcome).toEqual({
      verdict: 'mismatch',
      location: { surface: 'http', httpPart: 'headers' },
    });
  });

  it('a differing body mismatches, naming "body" -- status and headers both equal', () => {
    const outcome = decideCaseVerdict(
      input({
        surface: 'http',
        referenceNormalized: httpObservation({ body: 'ok' }),
        candidateRawRuns: [httpObservation({ body: 'not ok' })],
      }),
    );
    expect(outcome).toEqual({
      verdict: 'mismatch',
      location: { surface: 'http', httpPart: 'body' },
    });
  });

  it('a header present on one side and absent on the other mismatches too -- key presence is part of equality, never conflated with "sent empty"', () => {
    const outcome = decideCaseVerdict(
      input({
        surface: 'http',
        referenceNormalized: httpObservation({ headers: { 'x-request-id': 'abc' } }),
        candidateRawRuns: [httpObservation({ headers: {} })],
      }),
    );
    expect(outcome.verdict).toBe('mismatch');
  });

  it('a normalize rule with no stream/file scope applies to the body, never to a header or the status', () => {
    const outcome = decideCaseVerdict(
      input({
        surface: 'http',
        rules: [{ rule: 'trim-trailing-whitespace' }],
        referenceNormalized: httpObservation({ body: 'ok' }),
        candidateRawRuns: [httpObservation({ body: 'ok   ' })],
      }),
    );
    expect(outcome).toEqual({ verdict: 'match' });
  });

  it('a stream-scoped replace rule never applies to an http body -- inert, the identical behaviour a file-scoped rule already has on a process case', () => {
    const outcome = decideCaseVerdict(
      input({
        surface: 'http',
        rules: [{ rule: 'replace', pattern: 'ok', replacement: 'CHANGED', stream: 'stdout' }],
        referenceNormalized: httpObservation({ body: 'ok' }),
        candidateRawRuns: [httpObservation({ body: 'ok' })],
      }),
    );
    // Both sides are still literally "ok" (the rule never applied), so this still matches -- proving
    // inertness, not merely "did not crash".
    expect(outcome).toEqual({ verdict: 'match' });
  });

  it('json-canonical normalises the body when both sides are JSON with differently-ordered keys', () => {
    const outcome = decideCaseVerdict(
      input({
        surface: 'http',
        rules: [{ rule: 'json-canonical' }],
        referenceNormalized: httpObservation({ body: '{"a":1,"b":2}' }),
        candidateRawRuns: [httpObservation({ body: '{"b":2,"a":1}' })],
      }),
    );
    expect(outcome).toEqual({ verdict: 'match' });
  });

  it('an http case’s own stability probe is proven exactly like every other surface’s: a candidate that disagrees across its own runs is unstable, and when it does not, the value its runs share is what is compared', () => {
    const flaky = decideCaseVerdict(
      input({
        surface: 'http',
        referenceNormalized: httpObservation({ body: 'ok' }),
        candidateRawRuns: [httpObservation({ body: 'ok' }), httpObservation({ body: 'different' })],
      }),
    );
    expect(flaky).toEqual({ verdict: 'unstable' });

    const stable = decideCaseVerdict(
      input({
        surface: 'http',
        referenceNormalized: httpObservation({ body: 'ok' }),
        candidateRawRuns: [httpObservation({ body: 'ok' }), httpObservation({ body: 'ok' })],
      }),
    );
    expect(stable).toEqual({ verdict: 'match' });
  });

  it('observationsEqual’s own http branch is order-insensitive on header keys (sorted-key canonical comparison, not textual string equality)', () => {
    const a = httpObservation({ headers: { 'x-a': '1', 'x-b': '2' } });
    const b = httpObservation({ headers: { 'x-b': '2', 'x-a': '1' } });
    expect(observationsEqual(a, b)).toBe(true);
  });
});
