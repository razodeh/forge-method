/**
 * `kbEntrySchema` — `08` §8.3's own worked example, plus each named Check from `PLAN-M3.md` P6.
 *
 * @see specs/08 §8.3
 * @see PLAN-M3.md P6
 */
import { describe, expect, it } from 'vitest';

import { kbEntrySchema } from '../../src/schema/kb-entry.ts';

/** `08` §8.3's own worked example, transcribed verbatim, plus a body carrying its own four named
 * sections (Statement/Rationale/Implications/Verification) so the "verified requires Verification"
 * check has real content to look at. */
function workedExample(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'KB-ARCH-0007',
    type: 'knowledge',
    section: 'architecture',
    title: 'Asynchronous work execution strategy',
    status: 'active',
    confidence: 'high',
    owner: 'architect',
    sources: [
      { kind: 'decision', ref: 'ADR-0011' },
      { kind: 'human', ref: 'elicitation 2026-03-04, stage MVP' },
      { kind: 'code', ref: 'src/worker/queue.ts@a1b2c3d' },
    ],
    created: '2026-03-04',
    updated: '2026-03-11',
    verified: '2026-03-11',
    review_by: '2026-06-11',
    supersedes: [],
    superseded_by: null,
    related: ['KB-DATA-0003', 'ADR-0011', 'NFR-0004'],
    diagrams: ['DIAG-014', 'DIAG-022'],
    tags: ['async', 'queue', 'reliability'],
    applies_to: ['component:worker', 'component:api'],
    body: [
      '## Statement',
      'Work is executed asynchronously via a durable queue.',
      '',
      '## Rationale',
      'See ADR-0011 and the throughput NFR.',
      '',
      '## Implications',
      'Callers must not assume synchronous completion.',
      '',
      '## Verification',
      'Run `pnpm test -- packages/worker` and inspect the queue depth metric.',
    ].join('\n'),
    ...overrides,
  };
}

describe('kbEntrySchema — 08 §8.3 worked example', () => {
  it('parses the exact field values §8.3 shows', () => {
    const result = kbEntrySchema.safeParse(workedExample());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('KB-ARCH-0007');
      expect(result.data.section).toBe('architecture');
      expect(result.data.sources).toHaveLength(3);
      expect(result.data.related).toEqual(['KB-DATA-0003', 'ADR-0011', 'NFR-0004']);
      expect(result.data.applies_to).toEqual(['component:worker', 'component:api']);
    }
  });
});

describe('kbEntrySchema — id/section consistency', () => {
  it('rejects an id whose section token does not match the section field', () => {
    const result = kbEntrySchema.safeParse(workedExample({ id: 'KB-DATA-0001' }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['id']);
  });

  it('accepts every section/token pairing this piece registers', () => {
    const pairs: [string, string][] = [
      ['product', 'PROD'],
      ['constraints', 'CON'],
      ['architecture', 'ARCH'],
      ['domain', 'DOM'],
      ['data', 'DATA'],
      ['delivery', 'DELIV'],
      ['ops', 'OPS'],
      ['engineering', 'ENG'],
      ['glossary', 'GLOSS'],
    ];
    for (const [section, token] of pairs) {
      const result = kbEntrySchema.safeParse(
        workedExample({ id: `KB-${token}-0001`, section, confidence: 'low', verified: undefined }),
      );
      expect(result.success).toBe(true);
    }
  });

  it('rejects an id shape with fewer than four digits', () => {
    const result = kbEntrySchema.safeParse(workedExample({ id: 'KB-ARCH-7' }));
    expect(result.success).toBe(false);
  });
});

describe('kbEntrySchema — confidence: verified requires a real Verification section', () => {
  it('fails with no Verification heading at all', () => {
    const result = kbEntrySchema.safeParse(
      workedExample({ confidence: 'verified', body: '## Statement\nSomething is true.\n' }),
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['confidence']);
  });

  it('fails with a Verification heading but no content beneath it', () => {
    const result = kbEntrySchema.safeParse(
      workedExample({
        confidence: 'verified',
        body: '## Statement\nSomething is true.\n\n## Verification\n',
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['confidence']);
  });

  it('passes with a Verification heading followed by real content', () => {
    expect(kbEntrySchema.safeParse(workedExample()).success).toBe(true);
  });

  it('fails when the only content under Verification is an HTML comment', () => {
    // A gauntlet critic found a first version satisfied by a comment alone — GitHub/GitLab render an
    // HTML comment as nothing at all, so this would pass a document that looks empty to a human.
    const result = kbEntrySchema.safeParse(
      workedExample({
        confidence: 'verified',
        body: '## Verification\n<!-- TODO: fill this in -->\n',
      }),
    );
    expect(result.success).toBe(false);
  });

  it('passes when a Verification heading is indented up to 3 spaces, per CommonMark', () => {
    // A gauntlet critic found a first version anchored the heading pattern at column 0 exactly,
    // rejecting a heading that would render identically to an unindented one.
    const result = kbEntrySchema.safeParse(
      workedExample({
        confidence: 'verified',
        body: '## Statement\nSomething.\n\n  ## Verification\nRun the real command.\n',
      }),
    );
    expect(result.success).toBe(true);
  });

  it('does not require Verification content for a lower confidence level', () => {
    const result = kbEntrySchema.safeParse(
      workedExample({
        confidence: 'high',
        verified: undefined,
        body: '## Statement\nSomething.\n',
      }),
    );
    expect(result.success).toBe(true);
  });
});

describe('kbEntrySchema — provenance is mandatory', () => {
  it('rejects an empty sources array', () => {
    const result = kbEntrySchema.safeParse(workedExample({ sources: [] }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['sources']);
  });
});

describe('kbEntrySchema — status/superseded_by consistency', () => {
  it('rejects status: superseded with superseded_by: null', () => {
    const result = kbEntrySchema.safeParse(workedExample({ status: 'superseded' }));
    expect(result.success).toBe(false);
  });

  it('rejects a non-superseded status with superseded_by set', () => {
    const result = kbEntrySchema.safeParse(workedExample({ superseded_by: 'KB-ARCH-0008' }));
    expect(result.success).toBe(false);
  });

  it('accepts status: superseded with superseded_by set', () => {
    const result = kbEntrySchema.safeParse(
      workedExample({ status: 'superseded', superseded_by: 'KB-ARCH-0008' }),
    );
    expect(result.success).toBe(true);
  });
});

describe('kbEntrySchema — other structural rules', () => {
  it('rejects an unknown top-level key', () => {
    const result = kbEntrySchema.safeParse(workedExample({ extra: 'nope' }));
    expect(result.success).toBe(false);
  });

  it('rejects a type value outside the six §8.3 names', () => {
    const result = kbEntrySchema.safeParse(workedExample({ type: 'story' }));
    expect(result.success).toBe(false);
  });

  it('accepts every type in the §8.3 comment, not only "knowledge"', () => {
    for (const type of ['knowledge', 'adr', 'risk', 'assumption', 'open-question', 'glossary']) {
      expect(kbEntrySchema.safeParse(workedExample({ type })).success).toBe(true);
    }
  });
});
