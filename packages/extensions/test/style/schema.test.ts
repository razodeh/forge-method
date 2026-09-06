/**
 * `styleProfileSchema` — `15` §15.8's house style document shape.
 *
 * @see specs/15 §15.8
 * @see PLAN-M2.md P7
 */
import { describe, expect, it } from 'vitest';

import { styleProfileSchema } from '../../src/style/schema.ts';

describe('styleProfileSchema', () => {
  it('accepts the 15 §15.8 worked example', () => {
    const result = styleProfileSchema.safeParse({
      id: 'acme-house',
      language: 'en',
      tone: 'direct, low-ceremony, no marketing register',
      person: 'third',
      banned_phrases: ['leverage', 'seamless', 'best-in-class'],
      artifact_conventions: {
        headings: 'sentence-case',
        dates: 'ISO-8601',
        code_fences: 'always-annotated',
        diagrams: 'mermaid',
      },
      commit_style: 'conventional',
      doc_length: { adr: '≤ 2 pages', story: '≤ 1 page' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts person: first', () => {
    const result = styleProfileSchema.safeParse({
      id: 'x',
      language: 'en',
      tone: 'x',
      person: 'first',
      banned_phrases: [],
      artifact_conventions: {
        headings: 'sentence-case',
        dates: 'ISO-8601',
        code_fences: 'always-annotated',
        diagrams: 'mermaid',
      },
      commit_style: 'conventional',
      doc_length: {},
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown person value', () => {
    const result = styleProfileSchema.safeParse({
      id: 'x',
      language: 'en',
      tone: 'x',
      person: 'second',
      banned_phrases: [],
      artifact_conventions: {
        headings: 'sentence-case',
        dates: 'ISO-8601',
        code_fences: 'always-annotated',
        diagrams: 'mermaid',
      },
      commit_style: 'conventional',
      doc_length: {},
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown diagrams notation', () => {
    const result = styleProfileSchema.safeParse({
      id: 'x',
      language: 'en',
      tone: 'x',
      person: 'third',
      banned_phrases: [],
      artifact_conventions: {
        headings: 'sentence-case',
        dates: 'ISO-8601',
        code_fences: 'always-annotated',
        diagrams: 'visio',
      },
      commit_style: 'conventional',
      doc_length: {},
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing required field', () => {
    const result = styleProfileSchema.safeParse({
      id: 'x',
      language: 'en',
      person: 'third',
      banned_phrases: [],
      artifact_conventions: {
        headings: 'sentence-case',
        dates: 'ISO-8601',
        code_fences: 'always-annotated',
        diagrams: 'mermaid',
      },
      commit_style: 'conventional',
      doc_length: {},
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unrecognised top-level field', () => {
    const result = styleProfileSchema.safeParse({
      id: 'x',
      language: 'en',
      tone: 'x',
      person: 'third',
      banned_phrases: [],
      artifact_conventions: {
        headings: 'sentence-case',
        dates: 'ISO-8601',
        code_fences: 'always-annotated',
        diagrams: 'mermaid',
      },
      commit_style: 'conventional',
      doc_length: {},
      extra: true,
    });
    expect(result.success).toBe(false);
  });
});
