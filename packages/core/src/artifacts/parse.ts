/**
 * `splitFrontMatter`, `parseFrontMatterYaml` — turning an artifact file's raw text into a front
 * matter/body split, and that front matter into data.
 *
 * @see specs/18 §18.6
 * @see PLAN-M1.md P12
 */
import * as YAML from 'yaml';

import { ForgeError } from '../errors/forge-error.ts';

/** The UTF-8 BOM, spelled by code point rather than as a literal (invisible) source character. */
const BOM = String.fromCharCode(0xfeff);

export interface FrontMatterSplit {
  /** Everything up to and including the opening `---` line — a leading BOM included, if present. */
  readonly prefix: string;
  /** The front matter's own text, between the two delimiter lines. */
  readonly frontMatterText: string;
  /** The closing `---` line itself, with its own line terminator (absent only at EOF). */
  readonly infix: string;
  /** Everything after the closing delimiter line, verbatim. */
  readonly body: string;
}

/** The line ending `line` was terminated with, or `''` if `line` runs to EOF with none. */
function lineTerminator(line: string): '' | '\n' | '\r\n' {
  if (line.endsWith('\r\n')) return '\r\n';
  if (line.endsWith('\n')) return '\n';
  return '';
}

function withoutTerminator(line: string): string {
  const terminator = lineTerminator(line);
  return terminator === '' ? line : line.slice(0, -terminator.length);
}

/**
 * Splits `source` at its `---`-delimited front matter, per `18` §18.6.
 *
 * Line-oriented, not regex-over-the-whole-string: a document is scanned one line at a time so a
 * `---` that is not alone on its own line (inside the body, inside a multi-line scalar) is never
 * mistaken for a delimiter.
 *
 * @throws {ForgeError} `CFG-005` if `source` (after an optional leading BOM) does not open with a
 * line that is exactly `---`.
 * @throws {ForgeError} `CFG-006` if no later line is exactly `---` — the front matter never closes.
 */
export function splitFrontMatter(source: string, path: string): FrontMatterSplit {
  const bomLength = source.startsWith(BOM) ? BOM.length : 0;

  function lineEndAt(from: number): number {
    const newline = source.indexOf('\n', from);
    return newline === -1 ? source.length : newline + 1;
  }

  const firstLineEnd = lineEndAt(bomLength);
  const firstLine = source.slice(bomLength, firstLineEnd);
  if (withoutTerminator(firstLine) !== '---') {
    throw new ForgeError('CFG-005', { path });
  }

  let cursor = firstLineEnd;
  while (cursor < source.length) {
    const lineEnd = lineEndAt(cursor);
    const line = source.slice(cursor, lineEnd);
    if (withoutTerminator(line) === '---') {
      return {
        prefix: source.slice(0, firstLineEnd),
        frontMatterText: source.slice(firstLineEnd, cursor),
        infix: line,
        body: source.slice(lineEnd),
      };
    }
    cursor = lineEnd;
  }

  throw new ForgeError('CFG-006', { path });
}

/**
 * Parses `text` (a document's front-matter block) as YAML, returning its data.
 *
 * @throws {ForgeError} `CFG-007` if `text` does not parse, or parses to something other than a
 * mapping (a list or a bare scalar has no fields for a schema to validate).
 */
export function parseFrontMatterYaml(text: string, path: string): Record<string, unknown> {
  const doc = YAML.parseDocument(text);
  const firstError = doc.errors[0];
  if (firstError !== undefined) {
    throw new ForgeError('CFG-007', { path, issue: firstError.message });
  }

  const value: unknown = doc.toJSON();
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ForgeError('CFG-007', {
      path,
      issue: 'front matter must be a YAML mapping (key: value pairs), not a list or a bare scalar.',
    });
  }
  return value as Record<string, unknown>;
}
