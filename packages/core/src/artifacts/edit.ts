/**
 * `getValue`, `spliceValue`, `appendChangelogEntry` — the byte-range surgery behind
 * `ArtifactDocument.get`/`set`/`bumpRevision`.
 *
 * Every function here re-parses `text` fresh rather than accepting an already-parsed `YAML.Document`:
 * verified directly that a node's `.range` does not update after `Document.setIn` (it is fixed at
 * parse time, from the text that produced it), so a document mutated once and read again with stale
 * ranges would silently splice into the wrong place. Re-parsing on every call is what keeps every
 * range accurate to the text it is about to be sliced out of.
 *
 * @see specs/18 §18.6
 * @see PLAN-M1.md P12
 */
import * as YAML from 'yaml';

import type { FrontMatterPath } from './document.ts';

/**
 * Reads `path` out of front-matter `text`. `undefined` if it does not resolve to anything.
 *
 * `Document.getIn` already unwraps a scalar to its plain value, but — verified directly — returns a
 * live `YAMLMap`/`YAMLSeq` node, not plain data, when `path` resolves to a collection (an array or a
 * nested object). `.toJSON()` is what `ArtifactDocument.frontMatter` itself is built on, so `get()`
 * returning the same shape `frontMatter` would is the plain-data contract callers actually expect.
 */
export function getValue(text: string, path: FrontMatterPath): unknown {
  const value: unknown = YAML.parseDocument(text).getIn(path);
  return YAML.isCollection(value) ? value.toJSON() : value;
}

/**
 * `value`'s own single-line YAML text — no trailing newline, since it is spliced inline into an
 * existing byte range. `{ flow: true }` matters for a non-scalar `value` (an array or object field —
 * `supersedes`, `blast_radius`, `related`, every other `[]`-shaped field `@forge/templates`' own
 * stubs declare): `YAML.stringify`'s default is block style, which for an array is a `- item`-per-
 * line sequence with no way to fit on one line — spliced into a single-line range it produces
 * `key: - item`, which is not valid YAML (a gauntlet critic found `set(['supersedes'], [id])`
 * corrupting the document this way). Flow style (`[item]`) is unaffected for an actual scalar (a
 * string/number/boolean/null stringifies identically either way), so this is safe for every existing
 * caller and correct for the one this had no test covering before.
 *
 * A real *string* value is rendered via `JSON.stringify`, not `YAML.stringify` — confirmed directly,
 * across two separate rounds, that `YAML.stringify` cannot be trusted to produce a guaranteed
 * single-physical-line result no matter which options are passed: its default ~80-column line width
 * wraps a long, unquoted plain scalar across two lines (`lineWidth: 0` alone was tried and fixes only
 * this one case); separately, a value that already *contains* a literal `\n` (an entirely ordinary
 * shape for LLM-authored prose or a raw multi-line failure message — `13` §13's own RCA `symptom`/
 * `reproduction`/`root_cause`/`fix` fields, `PLAN-M8.md` P9) is rendered with a *real* embedded line
 * break rather than an escaped `\n` sequence even with `lineWidth: 0` *and* `defaultStringType:
 * 'QUOTE_DOUBLE'` both set — confirmed directly this is a real, content-dependent heuristic inside the
 * library's own double-quoted-scalar writer, not something either option reliably overrides. `spliceValue`
 * below has no re-indentation logic of its own, so *any* multi-line stringified value corrupts every
 * field the document declares after it the identical way, regardless of which of these two mechanisms
 * produced it. `JSON.stringify`'s own double-quoted string syntax is a strict, YAML-1.2-compatible
 * subset (YAML's core schema accepts JSON directly) that *never* emits a real line break for any input,
 * confirmed directly by round-tripping it back through a real `YAML.parseDocument` for embedded
 * newlines, tabs, unicode, backslashes, and quotes — a deterministic guarantee `YAML.stringify` itself
 * does not make. Every non-string value (an array, a number, a boolean, `null`) still goes through
 * `YAML.stringify(..., { flow: true })`, unaffected — only a string's own *rendering strategy* changes,
 * never a non-string one.
 */
function stringifyScalar(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  return YAML.stringify(value, { flow: true, lineWidth: 0 }).trimEnd();
}

/** Whether `text` uses CRLF line endings — checked once, from whichever line ending appears first. */
function usesCrlf(text: string): boolean {
  const newlineIndex = text.indexOf('\n');
  return newlineIndex > 0 && text[newlineIndex - 1] === '\r';
}

/** Converts a `YAML.stringify`-produced (always-LF) block to `text`'s own line-ending convention. */
function toDocumentEol(block: string, text: string): string {
  return usesCrlf(text) ? block.replaceAll('\n', '\r\n') : block;
}

/**
 * Prefixes every line of `block` with `indent`, including continuation lines.
 *
 * Assumes `block` ends with exactly one `\n` — true of every `YAML.stringify` call in this file, the
 * only caller — so the final element `split('\n')` produces is always the empty string after it, and
 * is deliberately left un-indented rather than turned into trailing whitespace.
 */
function indentLines(block: string, indent: string): string {
  const lines = block.split('\n');
  const lastIndex = lines.length - 1;
  return lines.map((line, i) => (i === lastIndex ? line : indent + line)).join('\n');
}

/** Whether `character` is horizontal whitespace or a line break — "already separated enough". */
function isBlankOrEol(character: string | undefined): boolean {
  return character === ' ' || character === '\t' || character === '\n' || character === '\r';
}

/**
 * Replaces the value at `path` in front-matter `text`, returning the new text. Only `path`'s own
 * value range changes — everything else in `text`, including that value's trailing comment, is an
 * untouched substring of the original.
 *
 * An *implicit* null (`key:` with nothing after it, per `18` §18.6's optional `run` field, or any
 * blank field left for a human to fill in later) parses to a genuinely zero-width range — `start`
 * equals `end` — sitting wherever the parser first expected a value to start. Splicing into that
 * exact point with no surrounding space either glues the new value onto the colon itself (`key:5`,
 * which fails to reparse as a `MULTILINE_IMPLICIT_KEY` error) or onto whatever immediately follows,
 * most commonly a trailing comment (`key:  5# comment`, which reparses without error but silently
 * folds the comment into the scalar's own text). Verified both failure modes directly. A normal,
 * already-written scalar's range always has real characters on both sides of it in the source, so
 * this padding is only ever added for the zero-width case.
 *
 * @throws {RangeError} if `path` does not already resolve to a value in `text` — see
 * `ArtifactDocument.set`'s doc comment for why this is a caller's programming error, not a
 * `ForgeError`.
 */
export function spliceValue(
  text: string,
  documentPath: string,
  path: FrontMatterPath,
  value: unknown,
): string {
  const doc = YAML.parseDocument(text);
  const node: unknown = doc.getIn(path, true);
  if (!YAML.isNode(node) || node.range === null || node.range === undefined) {
    throw new RangeError(
      `${documentPath}: cannot set() ${JSON.stringify(path)} — no existing value at that path.`,
    );
  }
  const [start, end] = node.range;
  const newValue = stringifyScalar(value);
  if (start !== end) {
    return text.slice(0, start) + newValue + text.slice(end);
  }
  const leadingSpace = isBlankOrEol(text[start - 1]) ? '' : ' ';
  const trailingSpace = isBlankOrEol(text[end]) ? '' : ' ';
  return text.slice(0, start) + leadingSpace + newValue + trailingSpace + text.slice(end);
}

export interface ChangelogEntry {
  readonly revision: number;
  readonly date: string;
  readonly by: string;
  readonly summary: string;
}

/**
 * Appends one entry to front-matter `text`'s `changelog` array, returning the new text.
 *
 * Two shapes, both real: a fresh document's `changelog: []` (an empty flow sequence, per every
 * `@forge/templates` stub) is replaced outright with a one-item block sequence: an already-populated
 * block sequence has the new item inserted immediately after the last one, at the same indent —
 * `18` §18.6's own example (`08` §8.6-adjacent front matter) shows `changelog` as a top-level key
 * with 2-space-indented `- ` items, which is the only shape this generates or expects.
 *
 * @throws {RangeError} if `text` has no `changelog` array at all — every base front-matter document
 * declares one (`registry/front-matter.ts`), so a document without it did not come from this schema.
 */
export function appendChangelogEntry(
  text: string,
  documentPath: string,
  entry: ChangelogEntry,
): string {
  const doc = YAML.parseDocument(text);
  const node: unknown = doc.getIn(['changelog'], true);
  if (!YAML.isSeq(node)) {
    throw new RangeError(`${documentPath}: cannot append to changelog — no changelog array found.`);
  }

  const entryBlock = indentLines(YAML.stringify([entry]), '  ');

  if (node.items.length === 0) {
    // Non-null: `node` came from parsing `text` itself (never a node built via `doc.createNode`,
    // which is the only way `.range` is ever absent), so a real source range is always present.
    const range = node.range as [number, number, number];
    // "changelog: []" -> "changelog:\n  - ...": the space that used to separate the colon from the
    // flow array's "[" has nothing left to separate once "[]" is gone, so it is dropped along with it
    // rather than left as trailing whitespace on the key's own line.
    let spliceStart = range[0];
    while (spliceStart > 0 && (text[spliceStart - 1] === ' ' || text[spliceStart - 1] === '\t')) {
      spliceStart -= 1;
    }
    const insertion = toDocumentEol(`\n${entryBlock.trimEnd()}`, text);
    return text.slice(0, spliceStart) + insertion + text.slice(range[1]);
  }

  // Cast, not a runtime check: every item a real parse puts in a `YAMLSeq` is at minimum a `Scalar`
  // (itself a `Node`), and — same reasoning as the empty-array branch above — a parsed node's
  // `.range` is always populated. `node.items.length === 0` already returned above, so indexing the
  // last element here can never be the `undefined` `noUncheckedIndexedAccess` otherwise adds.
  const lastItem = node.items[node.items.length - 1] as YAML.Node;
  const insertAt = (lastItem.range as [number, number, number])[1];
  // A block-style last item's range already extends through its own trailing newline (verified
  // directly), so `insertAt` lands at the start of a fresh line and no separator is needed. A
  // *flow*-style item (`{ revision: 1, ... }` — `18` §18.6's own example shows this form) ends its
  // range right after the closing brace, mid-line: without an inserted newline here, the new entry
  // would be glued onto the same line as the old one, corrupting the document. Detected from the
  // text itself rather than the item's own style, since a `YAMLMap`'s flow-vs-block flag is not
  // reliably present after every parse path this function is reached through.
  const atLineStart = insertAt > 0 && text[insertAt - 1] === '\n';
  const insertion = toDocumentEol(atLineStart ? entryBlock : `\n${entryBlock.trimEnd()}`, text);
  return text.slice(0, insertAt) + insertion + text.slice(insertAt);
}
