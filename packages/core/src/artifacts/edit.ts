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

/** A YAML scalar's own text for `value` — no trailing newline, since it is spliced inline. */
function stringifyScalar(value: unknown): string {
  return YAML.stringify(value).trimEnd();
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

/**
 * Replaces the value at `path` in front-matter `text`, returning the new text. Only `path`'s own
 * value range changes — everything else in `text`, including that value's trailing comment, is an
 * untouched substring of the original.
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
  return text.slice(0, start) + stringifyScalar(value) + text.slice(end);
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
  return text.slice(0, insertAt) + toDocumentEol(entryBlock, text) + text.slice(insertAt);
}
