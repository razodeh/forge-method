/**
 * `ArtifactDocument` — round-trip fidelity, surgical `set`/`bumpRevision`, and parse failures.
 *
 * @see specs/18 §18.6
 * @see specs/22 M1 acceptance ("Artifact round-trip preserves formatting exactly")
 * @see PLAN-M1.md P12
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { ArtifactDocument } from '../../src/artifacts/document.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const templatesDir = path.join(repoRoot, 'packages', 'templates', 'templates', 'artifacts');

/**
 * The 21 `@forge/templates` stubs, read directly off disk rather than imported: `@forge/core` has no
 * `@forge/templates` dependency (`02` §2.2), and a plain filesystem read of a sibling package's data
 * files is not a package import the boundary rule has any opinion about.
 */
const templateFiles = readdirSync(templatesDir)
  .filter((name) => name.endsWith('.md'))
  .sort();

describe('ArtifactDocument.parse — round-trip corpus', () => {
  it('found all 21 @forge/templates stubs to test against', () => {
    expect(templateFiles).toHaveLength(21);
  });

  it.each(templateFiles)('%s round-trips byte-for-byte with no edits', (fileName) => {
    const filePath = path.join(templatesDir, fileName);
    const source = readFileSync(filePath, 'utf8');
    const doc = ArtifactDocument.parse(source, filePath);
    expect(doc.toString()).toBe(source);
  });

  const awkward = [
    '---',
    'id: STORY-0142  # trailing comment, two spaces before it',
    'type: Story',
    'title: "double-quoted: with a colon inside"',
    "status: 'single-quoted value'",
    'description: |',
    '  a block scalar',
    '  spanning two lines',
    'tags: [a, b, c]',
    'nested:',
    '  x: 1',
    '',
    '',
    'changelog: []',
    '---',
    '',
    '## A heading',
    '',
    'Body prose, including a literal `---` below as a horizontal rule:',
    '',
    '---',
    '',
    'More prose after it.',
    '',
  ].join('\n');

  it('round-trips a hand-built awkward fixture (comments, quote styles, a block scalar, blank lines)', () => {
    const doc = ArtifactDocument.parse(awkward, 'awkward.md');
    expect(doc.toString()).toBe(awkward);
  });

  it('round-trips the same awkward fixture with CRLF line endings', () => {
    const crlf = awkward.replaceAll('\n', '\r\n');
    const doc = ArtifactDocument.parse(crlf, 'awkward.md');
    expect(doc.toString()).toBe(crlf);
  });

  it('round-trips a document with a leading BOM', () => {
    const bom = String.fromCharCode(0xfeff);
    const source = `${bom}${awkward}`;
    const doc = ArtifactDocument.parse(source, 'awkward.md');
    expect(doc.toString()).toBe(source);
  });

  it('round-trips a document with no trailing newline', () => {
    const source = awkward.replace(/\n$/, '');
    const doc = ArtifactDocument.parse(source, 'awkward.md');
    expect(doc.toString()).toBe(source);
  });
});

describe('ArtifactDocument.get', () => {
  it('reads a top-level scalar', () => {
    const doc = ArtifactDocument.parse('---\nid: X\ntitle: Hello\n---\nbody\n', 'x.md');
    expect(doc.get(['title'])).toBe('Hello');
  });

  it('reads a nested value', () => {
    const doc = ArtifactDocument.parse('---\nnested:\n  x: 1\n---\nbody\n', 'x.md');
    expect(doc.get(['nested', 'x'])).toBe(1);
  });

  it('returns undefined for a path that does not resolve', () => {
    const doc = ArtifactDocument.parse('---\nid: X\n---\nbody\n', 'x.md');
    expect(doc.get(['missing'])).toBeUndefined();
  });
});

describe('ArtifactDocument.set', () => {
  const source = [
    '---',
    'id: STORY-014  # keep me',
    'title: "Old Title"',
    'nested:',
    '  x: 1',
    '',
    'tags: [a, b]',
    '---',
    'body\n',
  ].join('\n');

  it('changes exactly the target line, byte-for-byte elsewhere', () => {
    const doc = ArtifactDocument.parse(source, 'x.md');
    doc.set(['title'], 'New Title');

    const before = source.split('\n');
    const after = doc.toString().split('\n');
    expect(after).toHaveLength(before.length);

    const changedLines = before
      .map((line, i) => [i, line, after[i]] as const)
      .filter(([, a, b]) => a !== b);
    expect(changedLines).toEqual([[2, 'title: "Old Title"', 'title: New Title']]);
  });

  it("preserves an untouched key's trailing comment when a different key is set", () => {
    const doc = ArtifactDocument.parse(source, 'x.md');
    doc.set(['title'], 'New Title');
    expect(doc.toString()).toContain('id: STORY-014  # keep me');
  });

  it('sets a nested value without touching sibling keys', () => {
    const doc = ArtifactDocument.parse(source, 'x.md');
    doc.set(['nested', 'x'], 42);
    expect(doc.get(['nested', 'x'])).toBe(42);
    expect(doc.toString()).toContain('tags: [a, b]');
  });

  it('sets an array-valued field to a new, real array — flow style, not a corrupting block sequence', () => {
    // A gauntlet critic found `set()` on an array field produced `tags: - a` (YAML.stringify's
    // default block style spliced into a single-line range) instead of valid YAML — this is the
    // regression test for that fix.
    const doc = ArtifactDocument.parse(source, 'x.md');
    doc.set(['tags'], ['x', 'y']);
    expect(doc.get(['tags'])).toEqual(['x', 'y']);
    expect(doc.toString()).toContain('tags: [ x, y ]');
  });

  it('sets an empty array back to an empty array', () => {
    const doc = ArtifactDocument.parse(source, 'x.md');
    doc.set(['tags'], []);
    expect(doc.get(['tags'])).toEqual([]);
  });

  it('round-trips through toString(): a document re-parsed after set() still gets the real value', () => {
    const doc = ArtifactDocument.parse(source, 'x.md');
    doc.set(['tags'], ['re-parsed']);
    const reparsed = ArtifactDocument.parse(doc.toString(), 'x.md');
    expect(reparsed.get(['tags'])).toEqual(['re-parsed']);
  });

  it('throws a RangeError for a path with no existing value', () => {
    const doc = ArtifactDocument.parse(source, 'x.md');
    expect(() => {
      doc.set(['does', 'not', 'exist'], 1);
    }).toThrow(RangeError);
  });

  it('does not mutate the body', () => {
    const doc = ArtifactDocument.parse(source, 'x.md');
    doc.set(['title'], 'New Title');
    expect(doc.body).toBe('body\n');
  });

  describe('an implicit ("zero-width") null value — a key with nothing written after it', () => {
    it('sets a bare "key:" with nothing after it on the line', () => {
      const doc = ArtifactDocument.parse('---\nrun:\nfoo: bar\n---\nbody\n', 'x.md');
      doc.set(['run'], 'run_01H');
      expect(doc.get(['run'])).toBe('run_01H');
      expect(doc.toString()).toBe('---\nrun: run_01H\nfoo: bar\n---\nbody\n');
    });

    it('sets "key: " with one trailing space and no comment', () => {
      const doc = ArtifactDocument.parse('---\nrun: \nfoo: bar\n---\nbody\n', 'x.md');
      doc.set(['run'], 'run_01H');
      expect(doc.get(['run'])).toBe('run_01H');
    });

    it('sets an implicit null that has its own trailing comment, keeping the comment intact', () => {
      const doc = ArtifactDocument.parse('---\nrun:  # tbd\nfoo: bar\n---\nbody\n', 'x.md');
      doc.set(['run'], 'run_01H');
      expect(doc.get(['run'])).toBe('run_01H');
      expect(doc.toString()).toContain('# tbd');
      // The whole point: the comment must be a real comment, not folded into the scalar's own text.
      expect(doc.toString()).not.toContain('run_01H#');
    });
  });
});

describe('ArtifactDocument.bumpRevision', () => {
  const source = [
    '---',
    'id: STORY-014',
    'revision: 1',
    'updated: 2026-01-01',
    'changelog: []',
    '---',
    'body\n',
  ].join('\n');

  it('increments revision, sets updated, and appends one changelog entry', () => {
    const doc = ArtifactDocument.parse(source, 'x.md');
    doc.bumpRevision('po', 'Split out AC-3', '2026-02-02');

    expect(doc.get(['revision'])).toBe(2);
    expect(doc.get(['updated'])).toBe('2026-02-02');
    expect(doc.get(['changelog'])).toEqual([
      { revision: 2, date: '2026-02-02', by: 'po', summary: 'Split out AC-3' },
    ]);
  });

  it('appends a second entry after an existing one, preserving the first', () => {
    const doc = ArtifactDocument.parse(source, 'x.md');
    doc.bumpRevision('po', 'First bump', '2026-02-02');
    doc.bumpRevision('architect', 'Second bump', '2026-03-03');

    expect(doc.get(['changelog'])).toEqual([
      { revision: 2, date: '2026-02-02', by: 'po', summary: 'First bump' },
      { revision: 3, date: '2026-03-03', by: 'architect', summary: 'Second bump' },
    ]);
  });

  it('appends after a flow-style last entry ("18" §18.6\'s own example format)', () => {
    // A flow-map item's YAML range ends right after its closing "}", mid-line — not, as a
    // block-style item's does, after a trailing newline. Appending must still separate the two
    // entries onto their own lines rather than gluing the new one onto the old one's closing brace.
    const flowSource = [
      '---',
      'id: STORY-014',
      'revision: 1',
      'updated: 2026-01-01',
      'changelog:',
      '  - { revision: 1, date: 2026-01-01, by: po, summary: Initial }',
      '---',
      'body\n',
    ].join('\n');
    const doc = ArtifactDocument.parse(flowSource, 'x.md');
    doc.bumpRevision('architect', 'Second bump', '2026-02-02');

    expect(doc.get(['changelog'])).toEqual([
      { revision: 1, date: '2026-01-01', by: 'po', summary: 'Initial' },
      { revision: 2, date: '2026-02-02', by: 'architect', summary: 'Second bump' },
    ]);
    // The corruption this guards against reads back as a mis-shapen changelog even when a bug makes
    // it "succeed" here, so also assert the exact rendered form has each entry on its own line.
    expect(doc.toString()).toContain(
      '  - { revision: 1, date: 2026-01-01, by: po, summary: Initial }\n  - revision: 2\n',
    );
  });

  it('keeps the document CRLF if the source was CRLF', () => {
    const crlf = source.replaceAll('\n', '\r\n');
    const doc = ArtifactDocument.parse(crlf, 'x.md');
    doc.bumpRevision('po', 'test', '2026-02-02');
    const out = doc.toString();
    for (let i = 0; i < out.length; i++) {
      if (out[i] === '\n') expect(out[i - 1], `position ${String(i)}`).toBe('\r');
    }
  });

  it('does not touch the body', () => {
    const doc = ArtifactDocument.parse(source, 'x.md');
    doc.bumpRevision('po', 'test', '2026-02-02');
    expect(doc.body).toBe('body\n');
  });

  it('starts at revision 1 when the existing revision is not a number', () => {
    // `revision` must already exist for `set()` to touch it at all, so this is a non-numeric
    // existing value (a malformed document) — not a missing key, which `set()` cannot author.
    const doc = ArtifactDocument.parse(
      '---\nid: X\nrevision: null\nupdated: 2026-01-01\nchangelog: []\n---\nbody\n',
      'x.md',
    );
    doc.bumpRevision('po', 'first', '2026-02-02');
    expect(doc.get(['revision'])).toBe(1);
  });

  it('throws a RangeError when the document has no changelog array at all', () => {
    const doc = ArtifactDocument.parse(
      '---\nid: X\nrevision: 1\nupdated: 2026-01-01\n---\nbody\n',
      'x.md',
    );
    expect(() => {
      doc.bumpRevision('po', 'test', '2026-02-02');
    }).toThrow(RangeError);
  });
});
