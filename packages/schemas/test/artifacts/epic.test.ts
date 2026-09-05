/**
 * `epicSchema` — `specs/09` §9.3's Epic.
 *
 * @see specs/09 §9.3
 * @see specs/21 §21.3
 */
import { describe, expect, it } from 'vitest';

import { epicSchema } from '../../src/artifacts/epic.ts';

function validEpic(): Record<string, unknown> {
  return {
    id: 'EPIC-003',
    type: 'Epic',
    schemaVersion: 1,
    title: 'Invoice creation and rendering',
    status: 'active',
    created: '2026-03-04',
    updated: '2026-03-04',
    revision: 1,
    author: 'po',
    changelog: [],
    capability: 'CAP-004',
    stage: 'mvp',
    goal: 'A user can build an invoice and see an accurate preview.',
    scope_in: ['line items', 'tax rates', 'branding logo'],
    scope_out: ['recurring invoices'],
    stories: ['STORY-011', 'STORY-012', 'STORY-014'],
    interfaces: ['INT-004', 'INT-007'],
    data: ['DM-002', 'DM-003'],
    exit_criteria: ["All stories done; e2e 'create and preview invoice' passes in staging."],
  };
}

describe('epicSchema — valid', () => {
  it('accepts the spec §9.3 example', () => {
    expect(epicSchema.safeParse(validEpic()).success).toBe(true);
  });
});

describe('epicSchema — invalid, each asserting the error path', () => {
  it('rejects a missing capability', () => {
    const withoutCapability = validEpic();
    delete withoutCapability['capability'];
    const result = epicSchema.safeParse(withoutCapability);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['capability']);
  });

  it('rejects a non-array exit_criteria', () => {
    const result = epicSchema.safeParse({ ...validEpic(), exit_criteria: 'done' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['exit_criteria']);
  });

  it('rejects an id whose prefix does not match its type', () => {
    const result = epicSchema.safeParse({ ...validEpic(), id: 'CAP-003' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['id']);
  });

  it('rejects an unknown top-level key', () => {
    const result = epicSchema.safeParse({ ...validEpic(), extra: 'nope' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual([]);
  });
});
