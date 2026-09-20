/**
 * `writeResultRecord` — keeps an agent session's final text in the run record
 * (`.forge/state/runs/<runId>/steps/<slug>/result.md`, beside `prompt.md` and `context.json`), so what the
 * agent answered is never discarded (`PLAN-M13.md` P12, `Q208` finding 5).
 *
 * The event log carries only a reference (relative path, byte count, whether it was cut, how many secret
 * shapes were redacted), never the text: `events.ndjson` is a per-line, append-only log every projection
 * replays, and an agent's answer can be tens of kilobytes.
 *
 * The text is untrusted model output written to a file a person will `cat` or open: terminal escape
 * sequences and control bytes are stripped (the set `forge`'s own terminal sanitiser strips, plus the Unicode bidirectional overrides, which can make a
 * file read differently from what it says), and the
 * secret shapes the event log redacts at write time (`SECRET_PATTERNS`) are redacted here too. It is capped
 * at `MAX_RESULT_BYTES` with a marker saying so.
 *
 * A resumed adapter session writes its result here too, overwriting whatever an earlier, crashed attempt
 * left: unlike `prompt.md` (which records what the session *received*, and must not be recompiled from
 * inputs that may have drifted), `result.md` records what the *latest* session *produced*, and the latest
 * session is the one whose outcome the step reports.
 *
 * @see specs/05 §5.3
 * @see specs/20 §20.5
 */
import { rm } from 'node:fs/promises';

import { writeFileAtomic, type ProjectPaths } from '@forge/core';
import { SECRET_PATTERNS } from '@forge/extensions/skills';

/** Upper bound on the stored text, in UTF-8 bytes. Large enough for a long report (a 15k-token answer is
 * about 60 KB), small enough that a runaway or hostile session cannot fill the disk one step at a time. */
export const MAX_RESULT_BYTES = 256 * 1024;

const REDACTED = '[REDACTED]';

/** Characters examined at most; see `sanitizeResultText`. */
const MAX_SANITIZE_CHARS = MAX_RESULT_BYTES * 4;

// prettier-ignore
// eslint-disable-next-line no-control-regex -- deliberately matching control/escape bytes to strip them
const HOSTILE_BYTES = /\x1B\][^\x07\x1B\n]*(?:\x07|\x1B\\)?|\x1B\[[0-9;?]*[ -/]*[@-~]|\r(?!\n)|[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\u061C\u180E\u200B\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/** Unicode tag characters and the variation-selector supplement (invisible, used to smuggle text) and lone
 * surrogates (not valid text at all). */
const INVISIBLE_OR_BROKEN =
  // eslint-disable-next-line no-misleading-character-class -- the tag and variation-selector ranges are matched to be stripped
  /[\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/gu;

/** A PEM private key block, header through footer (or to the end of the text if the footer never comes): the
 * `SECRET_PATTERNS` PEM entry matches the header line only, which would leave the key body on disk. */
const PEM_PRIVATE_KEY_BLOCK =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g;

/** Key shapes `SECRET_PATTERNS` lacks and a coding agent is likely to have seen: Anthropic and OpenAI-style
 * `sk-` keys, GitHub fine-grained and OAuth tokens, and JSON Web Tokens. */
const EXTRA_SECRET_PATTERNS: readonly RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  /sk-[A-Za-z0-9]{32,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /gh[ousr]_[A-Za-z0-9]{36,}/g,
  // Anchored by a lookbehind and bounded: an unanchored `eyJ` start rescans the same run from every `eyJ` in
  // it, which is quadratic on hostile model output.
  /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,4096}\.[A-Za-z0-9_-]{10,4096}\.[A-Za-z0-9_-]{10,4096}/g,
];

/** The `SECRET_PATTERNS` rewritten as global regexes, so every occurrence is replaced, not just the first. */
const GLOBAL_SECRET_PATTERNS: readonly RegExp[] = [
  PEM_PRIVATE_KEY_BLOCK,
  ...SECRET_PATTERNS.map(
    (pattern) =>
      new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`),
  ),
  ...EXTRA_SECRET_PATTERNS,
];

export interface SanitizedResult {
  readonly text: string;
  readonly redactions: number;
  /** How many hostile or invisible sequences were removed: a nonzero count on an answer is itself a signal. */
  readonly stripped: number;
  readonly truncated: boolean;
  /** Bytes of the original (pre-truncation, post-sanitisation) text that did not fit. */
  readonly omittedBytes: number;
}

/** Strips terminal escapes, control bytes (keeping `\n` and `\t`; a bare `\r` would let `cat` overwrite a line) and
 * invisible or bidirectional characters (zero-width space, marks, BOM, overrides; not ZWJ/ZWNJ, which emoji and several scripts need), redacts secret shapes, and caps the
 * result at `maxBytes` UTF-8 bytes, cutting on a character boundary and appending a marker. */
export function sanitizeResultText(
  text: string,
  maxBytes: number = MAX_RESULT_BYTES,
): SanitizedResult {
  // Bound the work before any pattern runs: model output is unbounded and every pattern below is at best linear
  // in it. Anything beyond four times the cap could not survive truncation anyway.
  const excess = text.length > MAX_SANITIZE_CHARS ? text.slice(MAX_SANITIZE_CHARS) : '';
  const input = excess === '' ? text : text.slice(0, MAX_SANITIZE_CHARS);
  let stripped = 0;
  const strip = (): string => {
    stripped += 1;
    return '';
  };
  let cleaned = input.replace(HOSTILE_BYTES, strip).replace(INVISIBLE_OR_BROKEN, strip);
  let redactions = 0;
  for (const pattern of GLOBAL_SECRET_PATTERNS) {
    cleaned = cleaned.replace(pattern, () => {
      redactions += 1;
      return REDACTED;
    });
  }
  const bytes = Buffer.from(cleaned, 'utf8');
  if (bytes.byteLength <= maxBytes && excess === '') {
    return { text: cleaned, redactions, stripped, truncated: false, omittedBytes: 0 };
  }
  // Decoding a prefix that ends inside a multi-byte character yields U+FFFD for it; that trailing
  // replacement character is dropped so the file never ends in a broken glyph.
  const kept =
    bytes.byteLength <= maxBytes
      ? cleaned
      : bytes
          .subarray(0, maxBytes)
          .toString('utf8')
          .replace(/\uFFFD+$/u, '');
  const omittedBytes =
    bytes.byteLength - Buffer.byteLength(kept, 'utf8') + Buffer.byteLength(excess, 'utf8');
  return {
    text: `${kept}\n\n[truncated: ${String(omittedBytes)} bytes omitted; the session's answer was longer than ${String(maxBytes)} bytes]`,
    redactions,
    stripped,
    truncated: true,
    omittedBytes,
  };
}

/** What the `SessionEnded` event records about the stored result. */
export interface ResultRecordRef {
  /** Relative to `.forge/state/runs/<runId>/`, forward slashes. */
  readonly path: string;
  readonly bytes: number;
  readonly truncated: boolean;
  readonly redactions: number;
  /** How many hostile or invisible sequences were removed: a nonzero count on an answer is itself a signal. */
  readonly stripped: number;
}

/** Writes `finalText` to `steps/<dirName>/result.md` and returns its reference, or `undefined` when the
 * session produced no text at all (there is nothing to keep, and an empty file would read as an answer). */
export async function writeResultRecord(
  paths: ProjectPaths,
  runId: string,
  dirName: string,
  finalText: string,
): Promise<ResultRecordRef | undefined> {
  const target = paths.resolveState(`runs/${runId}/steps/${dirName}/result.md`);
  const sanitized = sanitizeResultText(finalText);
  if (sanitized.text.trim() === '') {
    // A resumed or re-run session that said nothing (or only escape sequences) must not leave the earlier
    // attempt's answer standing as if it were this one's: nothing points at it any more.
    await rm(target, { force: true });
    return undefined;
  }
  const body = sanitized.text.endsWith('\n') ? sanitized.text : `${sanitized.text}\n`;
  const relative = `steps/${dirName}/result.md`;
  await writeFileAtomic(target, body);
  return {
    path: relative,
    bytes: Buffer.byteLength(body, 'utf8'),
    truncated: sanitized.truncated,
    redactions: sanitized.redactions,
    stripped: sanitized.stripped,
  };
}

/** Removes a step's `result.md`, for an attempt that ended before producing a result (an adapter crash): the
 * earlier attempt's answer must not sit under the step's name as if this attempt had written it. */
export async function clearResultRecord(
  paths: ProjectPaths,
  runId: string,
  dirName: string,
): Promise<void> {
  await rm(paths.resolveState(`runs/${runId}/steps/${dirName}/result.md`), { force: true });
}
