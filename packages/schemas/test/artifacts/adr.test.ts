/**
 * `adrSchema` — `08` §8.4's ADR.
 *
 * @see specs/08 §8.4
 * @see specs/21 §21.3
 */
import { describe, expect, it } from 'vitest';

import { adrSchema } from '../../src/artifacts/adr.ts';

function validAdr(): Record<string, unknown> {
  return {
    id: 'ADR-0011',
    type: 'ADR',
    schemaVersion: 1,
    title: 'Use PostgreSQL as the primary transactional store',
    status: 'accepted',
    created: '2026-03-05',
    updated: '2026-03-05',
    revision: 1,
    author: 'data-architect',
    changelog: [],
    category: 'data',
    deciders: ['data-architect', 'architect', 'human'],
    date: '2026-03-05',
    reversibility: 'medium',
    blast_radius: ['data', 'api', 'worker'],
    revisit_trigger: 'write throughput > 5k tps sustained, or multi-region requirement appears',
    supersedes: [],
    superseded_by: null,
    related: ['NFR-0002', 'KB-DATA-0001'],
    diagrams: ['DIAG-009'],
    framework: 'data-store-selection',
  };
}

describe('adrSchema — valid', () => {
  it('accepts the spec §8.4 example', () => {
    expect(adrSchema.safeParse(validAdr()).success).toBe(true);
  });

  it('accepts a superseded ADR naming its successor', () => {
    const result = adrSchema.safeParse({
      ...validAdr(),
      status: 'superseded',
      superseded_by: 'ADR-0022',
    });
    expect(result.success).toBe(true);
  });
});

describe('adrSchema — invalid, each asserting the error path', () => {
  it('rejects a status outside its closed enum (08 §8.4)', () => {
    const result = adrSchema.safeParse({ ...validAdr(), status: 'draft' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['status']);
  });

  it('rejects a reversibility outside its closed enum (08 §8.4)', () => {
    const result = adrSchema.safeParse({ ...validAdr(), reversibility: 'reversible' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['reversibility']);
  });

  it('rejects a missing revisit_trigger (PLAN-M1.md P7 Check)', () => {
    const withoutTrigger = validAdr();
    delete withoutTrigger['revisit_trigger'];
    const result = adrSchema.safeParse(withoutTrigger);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['revisit_trigger']);
  });

  it('rejects status "superseded" with no superseded_by (PLAN-M1.md P7 Check: mutual consistency)', () => {
    const result = adrSchema.safeParse({
      ...validAdr(),
      status: 'superseded',
      superseded_by: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['superseded_by']);
  });

  it('rejects a superseded_by set with a status other than "superseded" (mutual consistency)', () => {
    const result = adrSchema.safeParse({ ...validAdr(), superseded_by: 'ADR-0022' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['status']);
  });

  it('rejects an id with the wrong digit width for ADR (4 digits required)', () => {
    const result = adrSchema.safeParse({ ...validAdr(), id: 'ADR-011' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['id']);
  });
});
