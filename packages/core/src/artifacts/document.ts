/**
 * `ArtifactDocument` — an artifact file's front matter and body, editable without disturbing
 * anything a `set()` call did not touch.
 *
 * `18` §18.6: every artifact is `---`-delimited YAML front matter followed by a Markdown body.
 * `specs/22` M1's acceptance criterion is byte-exact round-tripping, which rules out the obvious
 * design (`yaml.parseDocument(...).toString()` for the whole file): verified directly that this
 * normalises a double space before a trailing comment to one, collapses two consecutive blank lines
 * to one, and silently converts CRLF to LF — a `.toString()` of an *untouched* document would not
 * equal its own source. Instead, `prefix`/`infix`/`body` are stored as the exact original substrings
 * around the front matter and are never regenerated; only `frontMatterText` — and only the specific
 * byte range `set()` targets within it — ever changes. `toString()` on a document nothing has called
 * `set()` on is therefore the original source, verbatim, not a re-serialisation of it.
 *
 * @see specs/18 §18.6
 * @see specs/02 §2.3 rule 4
 * @see PLAN-M1.md P12
 */
import { appendChangelogEntry, getValue, spliceValue } from './edit.ts';
import { parseFrontMatterYaml, splitFrontMatter } from './parse.ts';

/** A path into the front matter's own nested structure — `['nested', 'x']`, `['changelog']`. */
export type FrontMatterPath = readonly (string | number)[];

export class ArtifactDocument {
  private readonly prefix: string;
  private frontMatterText: string;
  private readonly infix: string;
  private readonly bodyText: string;

  /** The path this document was parsed from — `readArtifact`/`writeArtifact` resolve against it. */
  readonly path: string;

  private constructor(
    prefix: string,
    frontMatterText: string,
    infix: string,
    body: string,
    path: string,
  ) {
    this.prefix = prefix;
    this.frontMatterText = frontMatterText;
    this.infix = infix;
    this.bodyText = body;
    this.path = path;
  }

  /**
   * Parses `source` (the file's full text) into front matter and body.
   *
   * Validates the front matter eagerly — a document that cannot be constructed is not a document
   * with something wrong in it, it is not a document at all — so every later `get`/`set`/`frontMatter`
   * access can assume `frontMatterText` is well-formed YAML.
   *
   * @throws {ForgeError} `CFG-005` if `source` does not start with a `---` line.
   * @throws {ForgeError} `CFG-006` if no closing `---` line follows.
   * @throws {ForgeError} `CFG-007` if the front matter is not a YAML mapping.
   */
  static parse(source: string, path: string): ArtifactDocument {
    const split = splitFrontMatter(source, path);
    parseFrontMatterYaml(split.frontMatterText, path); // eager validation; result discarded here
    return new ArtifactDocument(split.prefix, split.frontMatterText, split.infix, split.body, path);
  }

  /** The parsed front matter, as plain data. Re-parsed on every access — see `set()`. */
  get frontMatter(): unknown {
    return parseFrontMatterYaml(this.frontMatterText, this.path);
  }

  /** The body, verbatim — never parsed, never re-serialised, exactly the substring after `---`. */
  get body(): string {
    return this.bodyText;
  }

  /** Reads a value out of the front matter. `undefined` if `path` does not resolve to anything. */
  get(path: FrontMatterPath): unknown {
    return getValue(this.frontMatterText, path);
  }

  /**
   * Replaces the value at `path` in the front matter, touching only that value's own byte range —
   * the surrounding formatting (comments, quoting, blank lines, every other key) is untouched because
   * it is never re-derived, only sliced around.
   *
   * @throws {RangeError} if `path` does not already resolve to a value. Every field this document's
   * own schema declares is already present in any front matter that ever validated — `set()` is for
   * changing a value, not for authoring a field the document does not yet have.
   */
  set(path: FrontMatterPath, value: unknown): void {
    this.frontMatterText = spliceValue(this.frontMatterText, this.path, path, value);
  }

  /**
   * `18` §18.6: "revision, incremented on substantive change" — bumps `revision`, sets `updated` to
   * `today`, and appends one entry to `changelog`, in that order. `today` is a caller-supplied string
   * (not read from the clock here) so this stays pure — `QUALITY-BAR.md` R10.
   */
  bumpRevision(by: string, summary: string, today: string): void {
    const current = this.get(['revision']);
    const nextRevision = typeof current === 'number' ? current + 1 : 1;
    this.set(['revision'], nextRevision);
    this.set(['updated'], today);
    this.frontMatterText = appendChangelogEntry(this.frontMatterText, this.path, {
      revision: nextRevision,
      date: today,
      by,
      summary,
    });
  }

  /** Reassembles the file. Byte-identical to the source if `set`/`bumpRevision` were never called. */
  toString(): string {
    return this.prefix + this.frontMatterText + this.infix + this.bodyText;
  }
}
