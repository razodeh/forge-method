/**
 * `parseTransclusionMarkers`/`checkTransclusion` — `08` §8.11.4.
 *
 * @see PLAN-M3.md P4
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkTransclusion, parseTransclusionMarkers } from '../../src/index.ts';

const FIXTURE_ROOT = path.resolve(
  import.meta.dirname,
  '../../../../fixtures/diagram-drift/docs/forge/kb/architecture',
);

describe('parseTransclusionMarkers', () => {
  it('parses id, src, and fenced content out of a real worked-example marker', () => {
    const markdown = [
      '<!-- forge:diagram id=DIAG-014 src=architecture/views/containers.mmd -->',
      '```mermaid',
      '%% forge:generated-from architecture/views/containers.mmd — do not edit here',
      'flowchart TB',
      '  A --> B',
      '```',
      '<!-- /forge:diagram -->',
    ].join('\n');

    expect(parseTransclusionMarkers(markdown)).toEqual([
      {
        diagramId: 'DIAG-014',
        src: 'architecture/views/containers.mmd',
        fencedContent: [
          '%% forge:generated-from architecture/views/containers.mmd — do not edit here',
          'flowchart TB',
          '  A --> B',
        ].join('\n'),
      },
    ]);
  });

  it('returns [] for a document with no marker at all', () => {
    expect(parseTransclusionMarkers('# Just a heading\n\nSome prose.')).toEqual([]);
  });

  it('parses more than one marker in the same document', () => {
    const one = [
      '<!-- forge:diagram id=DIAG-001 src=a.mmd -->',
      '```mermaid',
      '%% forge:generated-from a.mmd — do not edit here',
      'flowchart TB',
      '```',
      '<!-- /forge:diagram -->',
    ].join('\n');
    const two = [
      '<!-- forge:diagram id=DIAG-002 src=b.mmd -->',
      '```mermaid',
      '%% forge:generated-from b.mmd — do not edit here',
      'erDiagram',
      '```',
      '<!-- /forge:diagram -->',
    ].join('\n');
    const blocks = parseTransclusionMarkers(`${one}\n\nSome prose in between.\n\n${two}`);
    expect(blocks.map((block) => block.diagramId)).toEqual(['DIAG-001', 'DIAG-002']);
  });

  it("finds the real fixture's own marker", () => {
    const markdown = readFileSync(path.join(FIXTURE_ROOT, 'architecture-spec.md'), 'utf8');
    const blocks = parseTransclusionMarkers(markdown);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.diagramId).toBe('DIAG-001');
    expect(blocks[0]?.src).toBe('docs/forge/kb/architecture/views/containers.mmd');
  });

  // A gauntlet critic fed a first version of this parser real, ordinary Markdown formatting
  // variance — none of it adversarial — and found it silently returned [] for every one of these.
  it('finds a marker whose attributes appear in the opposite order (src before id)', () => {
    const markdown = [
      '<!-- forge:diagram src=a.mmd id=DIAG-001 -->',
      '```mermaid',
      '%% forge:generated-from a.mmd — do not edit here',
      'flowchart TB',
      '```',
      '<!-- /forge:diagram -->',
    ].join('\n');
    expect(parseTransclusionMarkers(markdown)).toEqual([
      {
        diagramId: 'DIAG-001',
        src: 'a.mmd',
        fencedContent: '%% forge:generated-from a.mmd — do not edit here\nflowchart TB',
      },
    ]);
  });

  // A gauntlet verify pass, probing beyond the original findings, found this one: the marker syntax
  // visually mimics HTML attributes, where quoting is the norm, but the original parser took `\S+`
  // literally and included the quote characters themselves in the value.
  it.each([`id="DIAG-001" src="a.mmd"`, `id='DIAG-001' src='a.mmd'`])(
    'strips quotes from a quoted attribute value (%s)',
    (attributes) => {
      const markdown = [
        `<!-- forge:diagram ${attributes} -->`,
        '```mermaid',
        'flowchart TB',
        '```',
        '<!-- /forge:diagram -->',
      ].join('\n');
      const blocks = parseTransclusionMarkers(markdown);
      expect(blocks[0]?.diagramId).toBe('DIAG-001');
      expect(blocks[0]?.src).toBe('a.mmd');
    },
  );

  it('tolerates a blank line between the marker comment and the fence, and before the closing comment', () => {
    const markdown = [
      '<!-- forge:diagram id=DIAG-001 src=a.mmd -->',
      '',
      '```mermaid',
      '%% forge:generated-from a.mmd — do not edit here',
      'flowchart TB',
      '```',
      '',
      '<!-- /forge:diagram -->',
    ].join('\n');
    expect(parseTransclusionMarkers(markdown)).toHaveLength(1);
  });

  it('tolerates trailing whitespace on the marker and fence lines', () => {
    const markdown = [
      '<!-- forge:diagram id=DIAG-001 src=a.mmd -->   ',
      '```mermaid   ',
      '%% forge:generated-from a.mmd — do not edit here',
      'flowchart TB',
      '```   ',
      '<!-- /forge:diagram -->   ',
    ].join('\n');
    expect(parseTransclusionMarkers(markdown)).toHaveLength(1);
  });

  it('tolerates CRLF line endings throughout the block', () => {
    const markdown = [
      '<!-- forge:diagram id=DIAG-001 src=a.mmd -->',
      '```mermaid',
      '%% forge:generated-from a.mmd — do not edit here',
      'flowchart TB',
      '```',
      '<!-- /forge:diagram -->',
    ].join('\r\n');
    const blocks = parseTransclusionMarkers(markdown);
    expect(blocks).toEqual([
      {
        diagramId: 'DIAG-001',
        src: 'a.mmd',
        fencedContent: '%% forge:generated-from a.mmd — do not edit here\nflowchart TB',
      },
    ]);
  });

  it('does not match an opening marker followed by ordinary prose instead of a fence', () => {
    const markdown = [
      '<!-- forge:diagram id=DIAG-001 src=a.mmd -->',
      'Just some prose, no fence at all.',
      '<!-- /forge:diagram -->',
    ].join('\n');
    expect(parseTransclusionMarkers(markdown)).toEqual([]);
  });

  it('does not match a fence that is opened but never closed before the document ends', () => {
    const markdown = [
      '<!-- forge:diagram id=DIAG-001 src=a.mmd -->',
      '```mermaid',
      'flowchart TB',
    ].join('\n');
    expect(parseTransclusionMarkers(markdown)).toEqual([]);
  });

  it('does not match an opening marker with no closing marker at all', () => {
    const markdown = [
      '<!-- forge:diagram id=DIAG-001 src=a.mmd -->',
      '```mermaid',
      'flowchart TB',
      '```',
    ].join('\n');
    expect(parseTransclusionMarkers(markdown)).toEqual([]);
  });

  it('does not match an opening marker missing one of its two attributes', () => {
    const markdown = [
      '<!-- forge:diagram id=DIAG-001 -->',
      '```mermaid',
      'flowchart TB',
      '```',
      '<!-- /forge:diagram -->',
    ].join('\n');
    expect(parseTransclusionMarkers(markdown)).toEqual([]);
  });
});

describe('checkTransclusion', () => {
  it('is true when the fenced copy matches its source exactly, header included', () => {
    const block = {
      diagramId: 'DIAG-001',
      src: 'a.mmd',
      fencedContent: '%% forge:generated-from a.mmd — do not edit here\nflowchart TB\n  A --> B',
    };
    expect(checkTransclusion(block, 'flowchart TB\n  A --> B')).toBe(true);
  });

  it('is false when the fenced copy has diverged from its source', () => {
    const block = {
      diagramId: 'DIAG-001',
      src: 'a.mmd',
      fencedContent: '%% forge:generated-from a.mmd — do not edit here\nflowchart TB\n  A --> B',
    };
    expect(checkTransclusion(block, 'flowchart TB\n  A --> C')).toBe(false);
  });

  it('normalises a trailing newline difference between the two sides', () => {
    const block = {
      diagramId: 'DIAG-001',
      src: 'a.mmd',
      fencedContent: '%% forge:generated-from a.mmd — do not edit here\nflowchart TB\n  A --> B',
    };
    expect(checkTransclusion(block, 'flowchart TB\n  A --> B\n')).toBe(true);
  });

  it('does not report drift purely from a CRLF-vs-LF line-ending difference', () => {
    const block = {
      diagramId: 'DIAG-001',
      src: 'a.mmd',
      fencedContent:
        '%% forge:generated-from a.mmd — do not edit here\r\nflowchart TB\r\n  A --> B',
    };
    expect(checkTransclusion(block, 'flowchart TB\n  A --> B')).toBe(true);
  });

  it("catches the real fixture's own diverged transclusion block", () => {
    const markdown = readFileSync(path.join(FIXTURE_ROOT, 'architecture-spec.md'), 'utf8');
    const block = parseTransclusionMarkers(markdown)[0];
    if (block === undefined) throw new Error('fixture has no transclusion marker');
    const sourceContent = readFileSync(path.join(FIXTURE_ROOT, 'views/containers.mmd'), 'utf8');
    // The fixture's embedded copy says "API"; the real .mmd file (also drifted) says "API Service" —
    // the two kinds of drift this fixture demonstrates are independent of one another.
    expect(checkTransclusion(block, sourceContent)).toBe(false);
  });
});
