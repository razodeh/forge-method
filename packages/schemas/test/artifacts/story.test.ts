/**
 * `storySchema` — `specs/09` §9.3's Story, the central execution unit.
 *
 * @see specs/09 §9.3
 * @see specs/21 §21.3
 * @see SPEC-QUESTIONS.md Q19
 */
import { describe, expect, it } from 'vitest';

import { storySchema } from '../../src/artifacts/story.ts';

function validStory(): Record<string, unknown> {
  return {
    id: 'STORY-014',
    type: 'Story',
    schemaVersion: 1,
    title: 'Render invoice preview from line items',
    status: 'ready',
    created: '2026-03-04',
    updated: '2026-03-11',
    revision: 2,
    author: 'po',
    changelog: [],
    epic: 'EPIC-003',
    capability: 'CAP-004',
    storyType: 'feature',
    size: 'M',
    owner_role: 'backend',
    depends_on: ['STORY-011'],
    blocked_by: [],
    interfaces: ['INT-004'],
    data: ['DM-002'],
    files_expected: ['src/billing/preview/**', 'tests/billing/preview/**'],
    context_refs: ['KB-ARCH-0007', 'ADR-0011', 'NFR-0002'],
    acceptance: [
      {
        id: 'AC-014-1',
        given: 'an invoice with 3 line items and a 10% tax rate',
        when: 'the preview is requested',
        then: 'the subtotal, tax and total are computed to 2 decimal places',
        kind: 'functional',
      },
      {
        id: 'AC-014-2',
        given: 'an invoice with 0 line items',
        when: 'the preview is requested',
        then: 'a 422 is returned with error code INVOICE_EMPTY',
        kind: 'error-handling',
      },
      {
        id: 'AC-014-3',
        given: '5000 concurrent preview requests',
        when: 'measured at p95',
        then: 'latency stays under 300ms',
        kind: 'nfr',
        nfr: 'NFR-0002',
      },
    ],
    tests: ['TEST-231', 'TEST-232', 'TEST-233'],
    dod_profile: 'backend-default',
  };
}

describe('storySchema — valid', () => {
  it('accepts the spec §9.3 example (storyType instead of the spec text\'s colliding "type")', () => {
    expect(storySchema.safeParse(validStory()).success).toBe(true);
  });

  it('accepts size L at status draft', () => {
    const result = storySchema.safeParse({ ...validStory(), size: 'L', status: 'draft' });
    expect(result.success).toBe(true);
  });

  it('accepts an empty files_expected before status ready', () => {
    const result = storySchema.safeParse({ ...validStory(), status: 'draft', files_expected: [] });
    expect(result.success).toBe(true);
  });
});

describe('storySchema — invalid, each asserting the error path', () => {
  it('rejects size L at status ready (PLAN-M1.md P6 Check)', () => {
    const result = storySchema.safeParse({ ...validStory(), size: 'L', status: 'ready' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['size']);
  });

  it('rejects size L at every status after draft, not only ready', () => {
    for (const status of ['in-progress', 'in-review', 'verified', 'done', 'blocked']) {
      const result = storySchema.safeParse({ ...validStory(), size: 'L', status });
      expect(result.success, status).toBe(false);
    }
  });

  it('rejects an empty files_expected at status ready (PLAN-M1.md P6 Check)', () => {
    const result = storySchema.safeParse({ ...validStory(), files_expected: [] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['files_expected']);
  });

  it('rejects a duplicate acceptance criterion id within the story', () => {
    const story = validStory() as { acceptance: unknown[] };
    const result = storySchema.safeParse({
      ...story,
      acceptance: [story.acceptance[0], story.acceptance[0]],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['acceptance', 1, 'id']);
  });

  it('rejects an acceptance criterion id not matching ^AC-\\d{3,4}-\\d+$', () => {
    const story = validStory() as { acceptance: Record<string, unknown>[] };
    const result = storySchema.safeParse({
      ...story,
      acceptance: [{ ...story.acceptance[0], id: 'AC-14-1' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['acceptance', 0, 'id']);
  });

  it('rejects an acceptance criterion missing "then"', () => {
    const story = validStory() as { acceptance: Record<string, unknown>[] };
    const withoutThen = { ...story.acceptance[0] };
    delete withoutThen['then'];
    const result = storySchema.safeParse({ ...story, acceptance: [withoutThen] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['acceptance', 0, 'then']);
  });

  it('rejects a storyType outside its closed enum', () => {
    const result = storySchema.safeParse({ ...validStory(), storyType: 'refactor' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['storyType']);
  });

  it('rejects a status outside its closed enum', () => {
    const result = storySchema.safeParse({ ...validStory(), status: 'archived' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['status']);
  });

  it('rejects an id whose prefix does not match its type', () => {
    const result = storySchema.safeParse({ ...validStory(), id: 'EPIC-014' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['id']);
  });
});
