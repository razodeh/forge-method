/**
 * `serialiseCapture`/`captureFileName`/`parseCapture` (specs/22 M16 P2) — `13` F-TEST-9's parity
 * capture: content-addressed, canonical JSON, "no tool or interpreter version, no clock time and no
 * host path of its own, so identical behaviour is the identical file."
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  captureFileName,
  parseCapture,
  serialiseCapture,
  type FileObservation,
  type LibraryObservation,
  type ParityCapture,
} from '../../../src/commands/parity/capture.ts';
import { minimalCapture, minimalCaptureCase } from './fixtures.ts';

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

describe('serialiseCapture (specs/22 M16 P2)', () => {
  it('produces canonical JSON (compact, keys sorted, no trailing newline)', () => {
    const text = serialiseCapture(minimalCapture());
    expect(text).not.toMatch(/\n/);
    expect(JSON.parse(text)).toBeTruthy();
    // key order check: "cases" sorts before "digest" sorts before "name" ... at the top level.
    const topKeys = Object.keys(JSON.parse(text) as Record<string, unknown>);
    expect(topKeys).toEqual([...topKeys].sort());
  });

  it('is deterministic for the same capture content', () => {
    expect(serialiseCapture(minimalCapture())).toBe(serialiseCapture(minimalCapture()));
  });
});

describe('captureFileName (specs/22 M16 P2)', () => {
  it('is the sha256 of the canonical bytes, plus ".json"', () => {
    const capture = minimalCapture();
    const bytes = serialiseCapture(capture);
    expect(captureFileName(bytes)).toBe(`${sha256Hex(bytes)}.json`);
  });

  it('round-trip: a capture serialised then parsed under its own real file name parses cleanly', () => {
    const capture = minimalCapture();
    const bytes = serialiseCapture(capture);
    const fileName = captureFileName(bytes);
    const result = parseCapture(bytes, fileName);
    expect(result.problem).toBeUndefined();
    expect(result.capture).toEqual(capture);
  });
});

describe('parseCapture — schema round-trip and name/hash verification (specs/22 M16 P2)', () => {
  it('round-trips every field of a process observation', () => {
    const capture = minimalCapture();
    const bytes = serialiseCapture(capture);
    const { capture: parsed } = parseCapture(bytes, captureFileName(bytes));
    expect(parsed).toEqual(capture);
  });

  it('round-trips a signal-ended process observation', () => {
    const capture = minimalCapture({
      cases: [
        minimalCaptureCase({
          observation: {
            surface: 'process',
            stderr: 'killed',
            exit: { kind: 'signal', signal: 'SIGKILL' },
          },
        }),
      ],
    });
    const bytes = serialiseCapture(capture);
    const { capture: parsed } = parseCapture(bytes, captureFileName(bytes));
    expect(parsed).toEqual(capture);
  });

  it('round-trips a file observation in both text and bytes mode', () => {
    const observation: FileObservation = {
      surface: 'file',
      files: [
        { path: 'out.txt', content: { mode: 'text', text: 'hello\n' } },
        { path: 'out.bin', content: { mode: 'bytes', sha256: 'f'.repeat(64) } },
      ],
    };
    const capture = minimalCapture({
      cases: [minimalCaptureCase({ surface: 'file', observation })],
    });
    const bytes = serialiseCapture(capture);
    const { capture: parsed } = parseCapture(bytes, captureFileName(bytes));
    expect(parsed).toEqual(capture);
  });

  it('round-trips a library observation, both a return and a thrown error', () => {
    const okObservation: LibraryObservation = {
      surface: 'library',
      result: { ok: true, value: { total: 3, items: ['a', 'b'] } },
    };
    const errObservation: LibraryObservation = {
      surface: 'library',
      result: { ok: false, error: { name: 'RangeError', message: 'out of range' } },
    };
    for (const observation of [okObservation, errObservation]) {
      const capture = minimalCapture({
        cases: [minimalCaptureCase({ surface: 'library', observation })],
      });
      const bytes = serialiseCapture(capture);
      const { capture: parsed } = parseCapture(bytes, captureFileName(bytes));
      expect(parsed).toEqual(capture);
    }
  });

  it('rejects a capture whose file name does not match the sha256 of its own bytes', () => {
    const capture = minimalCapture();
    const bytes = serialiseCapture(capture);
    const result = parseCapture(bytes, 'not-the-real-hash.json');
    expect(result.capture).toBeUndefined();
    expect(result.problem?.message).toMatch(/does not equal the sha256/);
  });

  it('rejects unparseable JSON, naming the file name correctly either way', () => {
    const bytes = 'not json at all {{{';
    const result = parseCapture(bytes, captureFileName(bytes));
    expect(result.capture).toBeUndefined();
    expect(result.problem?.message).toMatch(/not parseable JSON/);
  });

  it('rejects a structurally wrong shape (e.g. cases not a list) even with a correct file name', () => {
    const invalidShapeBytes = JSON.stringify({
      name: 'x',
      digest: 'd'.repeat(64),
      reference: { ref: 'a'.repeat(40), sha: 'a'.repeat(40) },
      platform: 'linux-x64',
      cases: 'not-a-list',
    });
    const result = parseCapture(invalidShapeBytes, captureFileName(invalidShapeBytes));
    expect(result.capture).toBeUndefined();
    expect(result.problem?.message).toMatch(/cases must be a list/);
  });

  it('rejects an observation naming a surface this capture format carries none for (e.g. "websocket" -- "http" is now a real, carried surface, added by a later piece of this milestone)', () => {
    const invalidShapeBytes = JSON.stringify({
      name: 'x',
      digest: 'd'.repeat(64),
      reference: { ref: 'a'.repeat(40), sha: 'a'.repeat(40) },
      platform: 'linux-x64',
      cases: [{ surface: 'websocket', caseIndex: 0, observation: { surface: 'websocket' } }],
    });
    const result = parseCapture(invalidShapeBytes, captureFileName(invalidShapeBytes));
    expect(result.capture).toBeUndefined();
  });
});

describe('parseCapture — every malformed-observation branch (specs/22 M16 P2)', () => {
  function captureWithCase(caseEntry: unknown): {
    readonly bytes: string;
    readonly fileName: string;
  } {
    const raw = {
      name: 'x',
      digest: 'd'.repeat(64),
      reference: { ref: 'a'.repeat(40), sha: 'a'.repeat(40) },
      platform: 'linux-x64',
      cases: [caseEntry],
    };
    const bytes = JSON.stringify(raw);
    return { bytes, fileName: captureFileName(bytes) };
  }

  function expectRejected(caseEntry: unknown): void {
    const { bytes, fileName } = captureWithCase(caseEntry);
    const result = parseCapture(bytes, fileName);
    expect(result.capture).toBeUndefined();
    expect(result.problem).toBeDefined();
  }

  it('rejects the top-level document when it is not an object (an array, a string)', () => {
    for (const bytes of [JSON.stringify([]), JSON.stringify('a string')]) {
      const result = parseCapture(bytes, captureFileName(bytes));
      expect(result.capture).toBeUndefined();
    }
  });

  it('rejects a document whose "reference" is not an object', () => {
    const raw = {
      name: 'x',
      digest: 'd'.repeat(64),
      reference: 'nope',
      platform: 'linux-x64',
      cases: [],
    };
    const bytes = JSON.stringify(raw);
    const result = parseCapture(bytes, captureFileName(bytes));
    expect(result.capture).toBeUndefined();
    expect(result.problem?.message).toMatch(/reference must be an object/);
  });

  it('rejects a case entry that is not an object', () => {
    expectRejected('nope');
  });

  it('rejects a case entry naming an unknown surface', () => {
    expectRejected({
      surface: 'nope',
      caseIndex: 0,
      observation: { surface: 'process', exit: { kind: 'code', code: 0 } },
    });
  });

  it('rejects a case entry whose caseIndex is not a non-negative integer', () => {
    for (const bad of [-1, 1.5, 'nope']) {
      expectRejected({
        surface: 'process',
        caseIndex: bad,
        observation: { surface: 'process', exit: { kind: 'code', code: 0 } },
      });
    }
  });

  it('rejects an observation that is not an object', () => {
    expectRejected({ surface: 'process', caseIndex: 0, observation: 'nope' });
  });

  it('rejects an observation naming a surface this capture format carries no observation shape for', () => {
    expectRejected({ surface: 'process', caseIndex: 0, observation: { surface: 'websocket' } });
  });

  it('rejects a process observation whose stdout/stderr are present but not strings', () => {
    expectRejected({
      surface: 'process',
      caseIndex: 0,
      observation: { surface: 'process', stdout: 42, exit: { kind: 'code', code: 0 } },
    });
    expectRejected({
      surface: 'process',
      caseIndex: 0,
      observation: { surface: 'process', stderr: 42, exit: { kind: 'code', code: 0 } },
    });
  });

  it('rejects a process observation whose "exit" is not an object', () => {
    expectRejected({
      surface: 'process',
      caseIndex: 0,
      observation: { surface: 'process', exit: 'nope' },
    });
  });

  it('rejects a process observation whose exit.code is not an integer', () => {
    expectRejected({
      surface: 'process',
      caseIndex: 0,
      observation: { surface: 'process', exit: { kind: 'code', code: 1.5 } },
    });
  });

  it('rejects a process observation whose exit.signal is missing or not a string', () => {
    expectRejected({
      surface: 'process',
      caseIndex: 0,
      observation: { surface: 'process', exit: { kind: 'signal' } },
    });
  });

  it('rejects a process observation whose exit.kind is neither "code" nor "signal"', () => {
    expectRejected({
      surface: 'process',
      caseIndex: 0,
      observation: { surface: 'process', exit: { kind: 'other' } },
    });
  });

  it('rejects a file observation whose "files" is not a list', () => {
    expectRejected({
      surface: 'file',
      caseIndex: 0,
      observation: { surface: 'file', files: 'nope' },
    });
  });

  it('rejects a file observation entry that is not an object', () => {
    expectRejected({
      surface: 'file',
      caseIndex: 0,
      observation: { surface: 'file', files: ['nope'] },
    });
  });

  it('rejects a file observation entry whose "content" is not an object', () => {
    expectRejected({
      surface: 'file',
      caseIndex: 0,
      observation: { surface: 'file', files: [{ path: 'a', content: 'nope' }] },
    });
  });

  it('rejects a file observation entry whose content.mode is neither "text" nor "bytes"', () => {
    expectRejected({
      surface: 'file',
      caseIndex: 0,
      observation: { surface: 'file', files: [{ path: 'a', content: { mode: 'other' } }] },
    });
  });

  it('rejects a library observation whose "result" is not an object', () => {
    expectRejected({
      surface: 'library',
      caseIndex: 0,
      observation: { surface: 'library', result: 'nope' },
    });
  });

  it('rejects a library observation whose result.error is not an object (when ok is false)', () => {
    expectRejected({
      surface: 'library',
      caseIndex: 0,
      observation: { surface: 'library', result: { ok: false, error: 'nope' } },
    });
  });

  it('rejects a library observation whose result.ok is neither true nor false', () => {
    expectRejected({
      surface: 'library',
      caseIndex: 0,
      observation: { surface: 'library', result: { ok: 'maybe' } },
    });
  });

  // `expectCanonicalValue`'s own "is not a finite number" refusal is NOT exercised here: valid JSON
  // text cannot encode NaN/Infinity as a number token at all (`JSON.parse('{"x":NaN}')` itself
  // throws a SyntaxError, caught earlier by `parseCapture`'s own JSON.parse try/catch), so that
  // branch is unreachable through any text this function's own contract accepts — a disclosed,
  // deliberately-defensive dead branch, not a gap in behaviour.
});

describe('parseCapture is closed-schema: an extra key anywhere is a reported problem, never silently accepted (specs/22 M16 P2)', () => {
  // Each construction below is a fresh-context critic's own real repro against an earlier version
  // of this file, which silently accepted all four. `fileName` is the real sha256 of the crafted
  // bytes (via `captureFileName`) so each test actually reaches the structural checks, never the
  // name/hash guard that runs first.
  function parseRawJson(rawJsonText: string): ReturnType<typeof parseCapture> {
    return parseCapture(rawJsonText, captureFileName(rawJsonText));
  }

  it('refuses an extra top-level key ("capturedAt") beside the five real fields', () => {
    const bytes = JSON.stringify({
      name: 'sample',
      digest: 'd'.repeat(64),
      reference: { ref: 'a'.repeat(40), sha: 'a'.repeat(40) },
      platform: 'linux-x64',
      cases: [],
      capturedAt: '2026-01-01T00:00:00.000Z',
    });
    const result = parseRawJson(bytes);
    expect(result.capture).toBeUndefined();
    expect(result.problem?.message).toMatch(/\(document\).*unknown key "capturedAt"/);
  });

  it('refuses an extra key inside "reference" ("toolVersion")', () => {
    const bytes = JSON.stringify({
      name: 'sample',
      digest: 'd'.repeat(64),
      reference: { ref: 'a'.repeat(40), sha: 'a'.repeat(40), toolVersion: 'node-22.14.0' },
      platform: 'linux-x64',
      cases: [],
    });
    const result = parseRawJson(bytes);
    expect(result.capture).toBeUndefined();
    expect(result.problem?.message).toMatch(/reference.*unknown key "toolVersion"/);
  });

  it('refuses an extra key inside a process observation ("hostPath")', () => {
    const bytes = JSON.stringify({
      name: 'sample',
      digest: 'd'.repeat(64),
      reference: { ref: 'a'.repeat(40), sha: 'a'.repeat(40) },
      platform: 'linux-x64',
      cases: [
        {
          surface: 'process',
          caseIndex: 0,
          observation: {
            surface: 'process',
            exit: { kind: 'code', code: 0 },
            hostPath: '/private/var/tmp/x',
          },
        },
      ],
    });
    const result = parseRawJson(bytes);
    expect(result.capture).toBeUndefined();
    expect(result.problem?.message).toMatch(/unknown key "hostPath"/);
  });

  it('refuses a genuinely duplicated top-level "name" key, which JSON.parse itself resolves before any key list is ever read', () => {
    // Hand-written, not JSON.stringify'd: JSON.stringify cannot produce a duplicate key, which is
    // exactly why this scenario needs its own raw text rather than an object literal. JSON.parse
    // resolves this to `{name: "b", ...}` (the LAST occurrence wins), so `Object.keys` on the
    // parsed value shows one "name", not two — per-level key-checking alone cannot see this; only
    // the round-trip-bytes check can.
    const bytes = `{"name":"a","name":"b","digest":"${'d'.repeat(64)}","reference":{"ref":"${'a'.repeat(40)}","sha":"${'a'.repeat(40)}"},"platform":"linux-x64","cases":[]}`;
    const result = parseRawJson(bytes);
    expect(result.capture).toBeUndefined();
    expect(result.problem?.message).toMatch(/not canonical JSON/);
  });

  it('still accepts a genuinely clean, canonical capture (no false positive from the new checks)', () => {
    const capture = minimalCapture();
    const bytes = serialiseCapture(capture);
    const result = parseCapture(bytes, captureFileName(bytes));
    expect(result.problem).toBeUndefined();
    expect(result.capture).toEqual(capture);
  });
});

describe('a realistic capture never carries a timestamp or an absolute project path (specs/22 M16 P2)', () => {
  const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  const ABSOLUTE_POSIX_PATH = /\/(?:Users|home|private|tmp|var)\/[^"]*/;
  const ABSOLUTE_WINDOWS_PATH = /[A-Za-z]:\\\\[^"]*/;

  it('scans a realistic multi-surface capture for both patterns and finds neither', () => {
    const capture: ParityCapture = minimalCapture({
      cases: [
        minimalCaptureCase({
          surface: 'process',
          caseIndex: 0,
          observation: {
            surface: 'process',
            stdout: 'build ok\n',
            stderr: '',
            exit: { kind: 'code', code: 0 },
          },
        }),
        minimalCaptureCase({
          surface: 'file',
          caseIndex: 0,
          observation: {
            surface: 'file',
            files: [{ path: 'dist/out.txt', content: { mode: 'text', text: 'result: 42\n' } }],
          },
        }),
        minimalCaptureCase({
          surface: 'library',
          caseIndex: 0,
          observation: { surface: 'library', result: { ok: true, value: { sum: 7 } } },
        }),
      ],
    });
    const bytes = serialiseCapture(capture);
    expect(bytes).not.toMatch(ISO_TIMESTAMP);
    expect(bytes).not.toMatch(ABSOLUTE_POSIX_PATH);
    expect(bytes).not.toMatch(ABSOLUTE_WINDOWS_PATH);
  });
});
