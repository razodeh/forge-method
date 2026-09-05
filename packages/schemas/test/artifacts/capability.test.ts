/**
 * `capabilitySchema` — `specs/09` §9.3's Capability.
 *
 * @see specs/09 §9.3
 * @see specs/21 §21.3
 */
import { describe, expect, it } from 'vitest';

import { capabilitySchema } from '../../src/artifacts/capability.ts';

function validCapability(): Record<string, unknown> {
  return {
    id: 'CAP-004',
    type: 'Capability',
    schemaVersion: 1,
    title: 'Send an invoice to a client',
    status: 'active',
    created: '2026-03-04',
    updated: '2026-03-04',
    revision: 1,
    author: 'po',
    changelog: [],
    statement: 'As an agency owner, I can create and send a branded invoice so that I get paid.',
    priority: 'must',
    stage: 'mvp',
    depends_on: ['CAP-002'],
    nfrs: ['NFR-0002', 'NFR-0007'],
    metrics: ['MET-001'],
    acceptance_summary: 'An invoice can be created, previewed, sent by email, and viewed.',
    epics: ['EPIC-003', 'EPIC-005'],
  };
}

describe('capabilitySchema — valid', () => {
  it('accepts the spec §9.3 example', () => {
    expect(capabilitySchema.safeParse(validCapability()).success).toBe(true);
  });

  it.each(['must', 'should', 'could', 'wont'])('accepts MoSCoW priority %s', (priority) => {
    expect(capabilitySchema.safeParse({ ...validCapability(), priority }).success).toBe(true);
  });
});

describe('capabilitySchema — invalid, each asserting the error path', () => {
  it('rejects a priority outside the MoSCoW literal union', () => {
    const result = capabilitySchema.safeParse({ ...validCapability(), priority: 'high' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['priority']);
  });

  it('rejects a missing stage', () => {
    const withoutStage = validCapability();
    delete withoutStage['stage'];
    const result = capabilitySchema.safeParse(withoutStage);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['stage']);
  });

  it('rejects an id whose prefix does not match its type', () => {
    const result = capabilitySchema.safeParse({ ...validCapability(), id: 'EPIC-004' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['id']);
  });

  it('rejects a non-array epics', () => {
    const result = capabilitySchema.safeParse({ ...validCapability(), epics: 'EPIC-003' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['epics']);
  });
});
