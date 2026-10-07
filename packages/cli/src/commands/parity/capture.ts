/**
 * The parity **capture** (`13` F-TEST-9): the reference's observed, normalised behaviour, stored at
 * `.forge/parity/captures/<sha256>.json` — content-addressed, digest-bound, holding "no tool or
 * interpreter version, no clock time and no host path of its own, so identical behaviour is the
 * identical file."
 *
 * This module owns three things: the typed shape of a normalised observation per surface (`process`,
 * `file`, `library`, and `http` — the last added by `specs/22` M16 P8, additively, exactly as this
 * module's own `SurfaceObservation` doc comment always said it would be), the capture's own canonical
 * bytes and content-addressed file name, and a strict parser that verifies a capture's claimed name
 * against its own bytes on every read.
 *
 * **`parseCapture` is closed-schema, the identical discipline `declaration.ts`'s own `Collector`
 * gives a declaration** — not merely "read the fields this module expects and ignore the rest".
 * `expectKnownKeys` below rejects an unrecognised key at every level this parser descends (the
 * document itself, `reference`, a case entry, each surface's own observation shape, and that
 * shape's own nested objects), with the identical "did you mean" `suggestKey` gives a declaration's
 * own unknown key, so a capture carrying a field `13` F-TEST-9 forbids — a clock time, a tool
 * version, a host path, or anything else this format never defined — is `invalid`, not silently
 * accepted. A fresh-context critic found exactly that hole in an earlier version of this file (an
 * extra top-level key, an extra key inside `reference`, an extra key inside a process observation,
 * all silently accepted) and reproduced it live; all three are refused now. A FOURTH construction —
 * a genuinely duplicated top-level key — is not something per-level key-checking can even see:
 * `JSON.parse` itself resolves a duplicate to its last occurrence before this module ever reads a
 * key list, so `Object.keys` on the parsed value never shows two of anything. `parseCapture`'s own
 * final step closes that gap a different way: it re-serialises the `ParityCapture` it just built and
 * requires the result to reproduce `rawText` BYTE FOR BYTE. A duplicate key inflates the raw bytes
 * beyond what the one surviving value re-serialises to, so the comparison fails; so does any other
 * respelling (reordered keys, extra whitespace) a genuine `forge parity capture` writer never
 * produces — `13` F-TEST-9's own capture bullet already requires exactly that writer's canonical
 * form, so this is a tightening of an existing requirement, not a new one.
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 * @see process/plans/PLAN-M16.md P2
 */
import { createHash } from 'node:crypto';

import { suggestKey } from '@forge/engine/gates';

import type { CanonicalValue } from './canonical-json.ts';
import { toCanonicalJson } from './canonical-json.ts';
import type { SurfaceKind } from './declaration-types.ts';
import { isSurfaceKind } from './declaration-types.ts';

function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** A `process` surface's observation: the streams it was declared to observe (an unlisted stream is
 * simply absent, never an empty string standing in for "not observed" — `13` F-TEST-9's own "an
 * unlisted stream is unobserved" rule), and the exit: a numeric code, or the signal that ended the
 * process where there was no code. */
export interface ProcessObservation {
  readonly surface: 'process';
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exit:
    | { readonly kind: 'code'; readonly code: number }
    | { readonly kind: 'signal'; readonly signal: string };
}

/** One declared output file's observed content: `bytes` mode stores only its sha256, never the
 * content itself (`13` F-TEST-9). */
export type FileObservationContent =
  | { readonly mode: 'text'; readonly text: string }
  | { readonly mode: 'bytes'; readonly sha256: string };

/** One declared output's observed path and content, within a `file` surface's observation. */
export interface FileObservationEntry {
  readonly path: string;
  readonly content: FileObservationContent;
}

/** A `file` surface's observation: every declared output this case observed, by path. */
export interface FileObservation {
  readonly surface: 'file';
  readonly files: readonly FileObservationEntry[];
}

/** A `library` surface's observation: the probe's own one JSON object (`13` F-TEST-9's library
 * probe protocol) — a return value, or a thrown error's `name`/`message` (never its stack, which
 * carries host paths and is not part of the protocol). */
export interface LibraryObservation {
  readonly surface: 'library';
  readonly result:
    | { readonly ok: true; readonly value: CanonicalValue }
    | { readonly ok: false; readonly error: { readonly name: string; readonly message: string } };
}

/**
 * An `http` surface's normalised observation (`specs/22` M16 P8, `13` F-TEST-9): the response status,
 * the selected response headers (by name, already lower-cased at load — `declaration-types.ts`'s own
 * `HttpRequestSpec` doc comment), and the normalised body text. Additive, following exactly the shape
 * this module's own file header already promised: "adding one is an additive, non-breaking change to
 * this type when P8 builds it, never a redefinition of the three members already here."
 */
export interface HttpObservation {
  readonly surface: 'http';
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** The normalised observation of one case, discriminated by surface. */
export type SurfaceObservation =
  ProcessObservation | FileObservation | LibraryObservation | HttpObservation;

/** One case's entry in a capture: which surface and which case (by its zero-based index within that
 * surface's own `cases` list — see `declaration-types.ts`'s own note on case identity) it is for,
 * and its normalised observation. */
export interface ParityCaptureCaseEntry {
  readonly surface: SurfaceKind;
  readonly caseIndex: number;
  readonly observation: SurfaceObservation;
}

/** A parsed, content-addressed parity capture (`13` F-TEST-9). */
export interface ParityCapture {
  readonly name: string;
  readonly digest: string;
  readonly reference: { readonly ref: string; readonly sha: string };
  readonly platform: string;
  readonly cases: readonly ParityCaptureCaseEntry[];
}

function canonicalObservation(observation: SurfaceObservation): CanonicalValue {
  if (observation.surface === 'process') {
    return {
      surface: observation.surface,
      stdout: observation.stdout,
      stderr: observation.stderr,
      exit:
        observation.exit.kind === 'code'
          ? { kind: 'code', code: observation.exit.code }
          : { kind: 'signal', signal: observation.exit.signal },
    };
  }
  if (observation.surface === 'file') {
    return {
      surface: observation.surface,
      files: observation.files.map((entry) => ({
        path: entry.path,
        content:
          entry.content.mode === 'text'
            ? { mode: entry.content.mode, text: entry.content.text }
            : { mode: entry.content.mode, sha256: entry.content.sha256 },
      })),
    };
  }
  if (observation.surface === 'http') {
    return {
      surface: observation.surface,
      status: observation.status,
      headers: { ...observation.headers },
      body: observation.body,
    };
  }
  return {
    surface: observation.surface,
    result: observation.result.ok
      ? { ok: true, value: observation.result.value }
      : {
          ok: false,
          error: { name: observation.result.error.name, message: observation.result.error.message },
        },
  };
}

/**
 * The capture's digestable fields, as a plain {@link CanonicalValue} tree — every field named
 * explicitly, the identical "no cast through the typed interface" discipline `digest.ts`'s own
 * `digestableDeclarationFields` takes.
 */
export function canonicalCaptureFields(capture: ParityCapture): CanonicalValue {
  return {
    name: capture.name,
    digest: capture.digest,
    reference: { ref: capture.reference.ref, sha: capture.reference.sha },
    platform: capture.platform,
    cases: capture.cases.map((entry) => ({
      surface: entry.surface,
      caseIndex: entry.caseIndex,
      observation: canonicalObservation(entry.observation),
    })),
  };
}

/**
 * The capture's own on-disk bytes: canonical JSON (`13` F-TEST-9 — "compact, with keys sorted at
 * every depth and no trailing newline"), UTF-8.
 */
export function serialiseCapture(capture: ParityCapture): string {
  return toCanonicalJson(canonicalCaptureFields(capture));
}

/** The content-addressed file name for a capture's own canonical bytes: the sha256 of
 * {@link serialiseCapture}'s own output, plus `.json` (`13` F-TEST-9). */
export function captureFileName(canonicalBytes: string): string {
  return `${sha256Hex(canonicalBytes)}.json`;
}

/** Why a capture's raw bytes could not be read back as a trustworthy {@link ParityCapture} — plain
 * data, matching `declaration.ts`'s own "a problem is data, not a throw" discipline (`13` F-TEST-9:
 * a capture that fails its own checks is `invalid`, a verdict a caller computes from this, never an
 * exception {@link parseCapture} raises). */
export interface CaptureProblem {
  readonly message: string;
}

/** The result of {@link parseCapture}: exactly one of `capture`/`problem` is present. */
export interface ParseCaptureResult {
  readonly capture?: ParityCapture;
  readonly problem?: CaptureProblem;
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Thrown only within this module's own parsing helpers, to unwind out of deep recursion with one
 * message, then caught and turned into a {@link CaptureProblem} — never lets `parseCapture` itself
 * throw (a capture that fails to parse is `invalid`, plain data, exactly like a declaration
 * problem). */
class CaptureFormatError extends Error {}

function expectString(value: unknown, at: string): string {
  if (typeof value !== 'string') throw new CaptureFormatError(`${at} must be a string`);
  return value;
}

/** Closed-schema key checking for one level of a parsed capture — the identical "every unknown key
 * is a problem, with a 'did you mean' when one is close" discipline `declaration.ts`'s own
 * `Collector.strictKeys` gives a declaration, reusing the same `suggestKey` helper. Unlike
 * `Collector`, this throws immediately (via {@link CaptureFormatError}, caught once at the top of
 * {@link parseCapture}): a capture is machine-written, never hand-authored, so there is no value in
 * collecting every problem before reporting the first the way a human-edited declaration's loader
 * does. */
function expectKnownKeys(
  record: Readonly<Record<string, unknown>>,
  known: readonly string[],
  at: string,
): void {
  for (const key of Object.keys(record)) {
    if (known.includes(key)) continue;
    const suggestion = suggestKey(key, known);
    throw new CaptureFormatError(
      `${at} has an unknown key "${key}"${suggestion === undefined ? '' : ` (did you mean "${suggestion}"?)`}; the keys here are ${known.map((name) => `"${name}"`).join(', ')}`,
    );
  }
}

function expectCanonicalValue(value: unknown, at: string): CanonicalValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new CaptureFormatError(`${at} is not a finite number`);
    return value;
  }
  if (Array.isArray(value))
    return value.map((entry, index) => expectCanonicalValue(entry, `${at}[${String(index)}]`));
  if (isPlainObject(value)) {
    const entries = Object.keys(value).map((key): readonly [string, CanonicalValue] => [
      key,
      expectCanonicalValue(value[key], `${at}.${key}`),
    ]);
    return Object.fromEntries(entries);
  }
  throw new CaptureFormatError(`${at} is not representable as JSON`);
}

const PROCESS_OBSERVATION_KEYS = ['surface', 'stdout', 'stderr', 'exit'] as const;
const EXIT_CODE_KEYS = ['kind', 'code'] as const;
const EXIT_SIGNAL_KEYS = ['kind', 'signal'] as const;

function parseProcessObservation(
  raw: Readonly<Record<string, unknown>>,
  at: string,
): ProcessObservation {
  expectKnownKeys(raw, PROCESS_OBSERVATION_KEYS, at);
  const stdout = raw['stdout'];
  const stderr = raw['stderr'];
  if (stdout !== undefined && typeof stdout !== 'string') {
    throw new CaptureFormatError(`${at}.stdout must be a string when present`);
  }
  if (stderr !== undefined && typeof stderr !== 'string') {
    throw new CaptureFormatError(`${at}.stderr must be a string when present`);
  }
  const exitRaw = raw['exit'];
  if (!isPlainObject(exitRaw)) throw new CaptureFormatError(`${at}.exit must be an object`);
  const kind = exitRaw['kind'];
  if (kind === 'code') {
    expectKnownKeys(exitRaw, EXIT_CODE_KEYS, `${at}.exit`);
    const code = exitRaw['code'];
    if (typeof code !== 'number' || !Number.isInteger(code)) {
      throw new CaptureFormatError(`${at}.exit.code must be an integer`);
    }
    return {
      surface: 'process',
      ...(stdout === undefined ? {} : { stdout }),
      ...(stderr === undefined ? {} : { stderr }),
      exit: { kind: 'code', code },
    };
  }
  if (kind === 'signal') {
    expectKnownKeys(exitRaw, EXIT_SIGNAL_KEYS, `${at}.exit`);
    const signal = expectString(exitRaw['signal'], `${at}.exit.signal`);
    return {
      surface: 'process',
      ...(stdout === undefined ? {} : { stdout }),
      ...(stderr === undefined ? {} : { stderr }),
      exit: { kind: 'signal', signal },
    };
  }
  throw new CaptureFormatError(`${at}.exit.kind must be "code" or "signal"`);
}

const FILE_OBSERVATION_KEYS = ['surface', 'files'] as const;
const FILE_ENTRY_KEYS = ['path', 'content'] as const;
const FILE_CONTENT_TEXT_KEYS = ['mode', 'text'] as const;
const FILE_CONTENT_BYTES_KEYS = ['mode', 'sha256'] as const;

function parseFileObservation(raw: Readonly<Record<string, unknown>>, at: string): FileObservation {
  expectKnownKeys(raw, FILE_OBSERVATION_KEYS, at);
  const filesRaw = raw['files'];
  if (!Array.isArray(filesRaw)) throw new CaptureFormatError(`${at}.files must be a list`);
  const files = filesRaw.map((entry, index): FileObservationEntry => {
    const entryAt = `${at}.files[${String(index)}]`;
    if (!isPlainObject(entry)) throw new CaptureFormatError(`${entryAt} must be an object`);
    expectKnownKeys(entry, FILE_ENTRY_KEYS, entryAt);
    const entryPath = expectString(entry['path'], `${entryAt}.path`);
    const content = entry['content'];
    if (!isPlainObject(content))
      throw new CaptureFormatError(`${entryAt}.content must be an object`);
    if (content['mode'] === 'text') {
      expectKnownKeys(content, FILE_CONTENT_TEXT_KEYS, `${entryAt}.content`);
      return {
        path: entryPath,
        content: { mode: 'text', text: expectString(content['text'], `${entryAt}.content.text`) },
      };
    }
    if (content['mode'] === 'bytes') {
      expectKnownKeys(content, FILE_CONTENT_BYTES_KEYS, `${entryAt}.content`);
      return {
        path: entryPath,
        content: {
          mode: 'bytes',
          sha256: expectString(content['sha256'], `${entryAt}.content.sha256`),
        },
      };
    }
    throw new CaptureFormatError(`${entryAt}.content.mode must be "text" or "bytes"`);
  });
  return { surface: 'file', files };
}

const LIBRARY_OBSERVATION_KEYS = ['surface', 'result'] as const;
const LIBRARY_RESULT_OK_KEYS = ['ok', 'value'] as const;
const LIBRARY_RESULT_ERROR_KEYS = ['ok', 'error'] as const;
const LIBRARY_ERROR_KEYS = ['name', 'message'] as const;

function parseLibraryObservation(
  raw: Readonly<Record<string, unknown>>,
  at: string,
): LibraryObservation {
  expectKnownKeys(raw, LIBRARY_OBSERVATION_KEYS, at);
  const resultRaw = raw['result'];
  if (!isPlainObject(resultRaw)) throw new CaptureFormatError(`${at}.result must be an object`);
  if (resultRaw['ok'] === true) {
    expectKnownKeys(resultRaw, LIBRARY_RESULT_OK_KEYS, `${at}.result`);
    return {
      surface: 'library',
      result: { ok: true, value: expectCanonicalValue(resultRaw['value'], `${at}.result.value`) },
    };
  }
  if (resultRaw['ok'] === false) {
    expectKnownKeys(resultRaw, LIBRARY_RESULT_ERROR_KEYS, `${at}.result`);
    const errorRaw = resultRaw['error'];
    if (!isPlainObject(errorRaw))
      throw new CaptureFormatError(`${at}.result.error must be an object`);
    expectKnownKeys(errorRaw, LIBRARY_ERROR_KEYS, `${at}.result.error`);
    return {
      surface: 'library',
      result: {
        ok: false,
        error: {
          name: expectString(errorRaw['name'], `${at}.result.error.name`),
          message: expectString(errorRaw['message'], `${at}.result.error.message`),
        },
      },
    };
  }
  throw new CaptureFormatError(`${at}.result.ok must be true or false`);
}

const HTTP_OBSERVATION_KEYS = ['surface', 'status', 'headers', 'body'] as const;

function parseHttpObservation(raw: Readonly<Record<string, unknown>>, at: string): HttpObservation {
  expectKnownKeys(raw, HTTP_OBSERVATION_KEYS, at);
  const status = raw['status'];
  if (typeof status !== 'number' || !Number.isInteger(status)) {
    throw new CaptureFormatError(`${at}.status must be an integer`);
  }
  const headersRaw = raw['headers'];
  if (!isPlainObject(headersRaw)) throw new CaptureFormatError(`${at}.headers must be an object`);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(headersRaw)) {
    headers[name] = expectString(value, `${at}.headers["${name}"]`);
  }
  const body = expectString(raw['body'], `${at}.body`);
  return { surface: 'http', status, headers, body };
}

function parseObservation(raw: unknown, at: string): SurfaceObservation {
  if (!isPlainObject(raw)) throw new CaptureFormatError(`${at} must be an object`);
  const surface = raw['surface'];
  if (surface === 'process') return parseProcessObservation(raw, at);
  if (surface === 'file') return parseFileObservation(raw, at);
  if (surface === 'library') return parseLibraryObservation(raw, at);
  if (surface === 'http') return parseHttpObservation(raw, at);
  throw new CaptureFormatError(
    `${at}.surface ("${String(surface)}") is not a surface this capture format carries an observation for`,
  );
}

const CASE_ENTRY_KEYS = ['surface', 'caseIndex', 'observation'] as const;

function parseCaseEntry(raw: unknown, at: string): ParityCaptureCaseEntry {
  if (!isPlainObject(raw)) throw new CaptureFormatError(`${at} must be an object`);
  expectKnownKeys(raw, CASE_ENTRY_KEYS, at);
  const surface = raw['surface'];
  if (!isSurfaceKind(surface))
    throw new CaptureFormatError(`${at}.surface must be a known surface kind`);
  const caseIndex = raw['caseIndex'];
  if (typeof caseIndex !== 'number' || !Number.isInteger(caseIndex) || caseIndex < 0) {
    throw new CaptureFormatError(`${at}.caseIndex must be a non-negative integer`);
  }
  return {
    surface,
    caseIndex,
    observation: parseObservation(raw['observation'], `${at}.observation`),
  };
}

const TOP_LEVEL_KEYS = ['name', 'digest', 'reference', 'platform', 'cases'] as const;
const REFERENCE_KEYS = ['ref', 'sha'] as const;

/**
 * Parses a capture's raw file TEXT (as read from disk) into a typed {@link ParityCapture}, verifying
 * first that `fileName` equals the sha256 of `rawText`'s own bytes (`13` F-TEST-9: "its file name
 * must equal the sha256 of its canonical bytes, which is verified whenever a capture is read").
 *
 * Non-throwing: a problem — a name/hash mismatch, malformed JSON, or a structurally wrong shape — is
 * returned as plain data, never thrown, exactly as a declaration's own load-time problems are;
 * `13` F-TEST-9 says a capture that fails the check "is `invalid`, and so is the declaration whose
 * name it records," which is a verdict a caller computes from this result, not an exception this
 * function raises.
 */
export function parseCapture(rawText: string, fileName: string): ParseCaptureResult {
  const expectedName = captureFileName(rawText);
  if (expectedName !== fileName) {
    return {
      problem: {
        message: `the capture's file name ("${fileName}") does not equal the sha256 of its own bytes ("${expectedName}"); it is invalid, and so is the declaration whose name it records`,
      },
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch (cause) {
    return {
      problem: {
        message: `the capture is not parseable JSON (${cause instanceof Error ? cause.message : 'unknown error'})`,
      },
    };
  }
  try {
    if (!isPlainObject(parsed)) throw new CaptureFormatError('the capture must be an object');
    expectKnownKeys(parsed, TOP_LEVEL_KEYS, '(document)');
    const name = expectString(parsed['name'], 'name');
    const digest = expectString(parsed['digest'], 'digest');
    const referenceRaw = parsed['reference'];
    if (!isPlainObject(referenceRaw)) throw new CaptureFormatError('reference must be an object');
    expectKnownKeys(referenceRaw, REFERENCE_KEYS, 'reference');
    const reference = {
      ref: expectString(referenceRaw['ref'], 'reference.ref'),
      sha: expectString(referenceRaw['sha'], 'reference.sha'),
    };
    const platform = expectString(parsed['platform'], 'platform');
    const casesRaw = parsed['cases'];
    if (!Array.isArray(casesRaw)) throw new CaptureFormatError('cases must be a list');
    const cases = casesRaw.map((entry, index) => parseCaseEntry(entry, `cases[${String(index)}]`));
    const capture: ParityCapture = { name, digest, reference, platform, cases };
    // Closes the one gap per-level key-checking above cannot see: `JSON.parse` resolves a
    // DUPLICATE key to its last occurrence before this function ever reads a key list, so a raw
    // document holding the same key twice looks, by the time `parsed` exists, identical to one
    // holding it once — `Object.keys` cannot tell them apart. Re-serialising the capture this
    // function just built and requiring an EXACT match against `rawText` catches that (the raw
    // bytes are longer than what the one surviving value re-serialises to) along with any other
    // respelling (reordered keys, insignificant whitespace) a real `forge parity capture` writer
    // never produces — this module's own doc comment has the full reasoning.
    const reserialised = serialiseCapture(capture);
    if (reserialised !== rawText) {
      return {
        problem: {
          message:
            'the capture is not canonical JSON (re-serialising its parsed content does not reproduce the same bytes byte-for-byte, which can hide a duplicated key or other non-canonical formatting that per-field checking alone cannot see); it is invalid',
        },
      };
    }
    return { capture };
  } catch (cause) {
    if (cause instanceof CaptureFormatError) return { problem: { message: cause.message } };
    throw cause;
  }
}
