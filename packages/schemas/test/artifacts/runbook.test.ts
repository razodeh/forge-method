/**
 * `runbookSchema` — `14` §14's Runbook.
 *
 * @see specs/14-frameworks-delivery-and-operations.md §14
 * @see specs/21 §21.3
 */
import { describe, expect, it } from 'vitest';

import { runbookSchema } from '../../src/artifacts/runbook.ts';

function validRunbook(): Record<string, unknown> {
  return {
    id: 'RUN-001',
    type: 'Runbook',
    schemaVersion: 1,
    title: 'API returns 503 under load',
    status: 'active',
    created: '2026-03-05',
    updated: '2026-03-05',
    revision: 1,
    author: 'sre',
    changelog: [],
    symptoms: 'API p95 latency exceeds 5s and 503s appear in the load balancer logs.',
    immediate_mitigation: 'Scale the API deployment to 2x replicas: kubectl scale ...',
    diagnosis_steps: ['kubectl top pods -n api', 'check connection pool saturation in dashboards'],
    escalation: 'Page the on-call SRE if mitigation does not recover p95 within 10 minutes.',
    post_incident_actions: ['File an RCA', 'Review autoscaling thresholds'],
  };
}

describe('runbookSchema — valid', () => {
  it('accepts a well-formed runbook', () => {
    expect(runbookSchema.safeParse(validRunbook()).success).toBe(true);
  });

  it('accepts with no sources field at all (PLAN-M14.md P11: sources is optional here)', () => {
    const result = runbookSchema.safeParse(validRunbook());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sources).toBeUndefined();
  });

  it('accepts a well-formed sources array', () => {
    const result = runbookSchema.safeParse({
      ...validRunbook(),
      sources: [{ kind: 'human', ref: 'incident review 2026-03-05' }],
    });
    expect(result.success).toBe(true);
  });
});

describe('runbookSchema — sources shape (PLAN-M14.md P11)', () => {
  it('rejects a source with an unknown kind', () => {
    const result = runbookSchema.safeParse({
      ...validRunbook(),
      sources: [{ kind: 'guess', ref: 'x' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['sources', 0, 'kind']);
  });
});

describe('runbookSchema — invalid, each asserting the error path', () => {
  it('rejects a missing immediate_mitigation', () => {
    const withoutMitigation = validRunbook();
    delete withoutMitigation['immediate_mitigation'];
    const result = runbookSchema.safeParse(withoutMitigation);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['immediate_mitigation']);
  });

  it('rejects a non-array diagnosis_steps', () => {
    const result = runbookSchema.safeParse({
      ...validRunbook(),
      diagnosis_steps: 'check the logs',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['diagnosis_steps']);
  });

  it('rejects an id whose prefix does not match its type', () => {
    const result = runbookSchema.safeParse({ ...validRunbook(), id: 'DEF-001' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['id']);
  });

  it('rejects an unknown top-level key', () => {
    const result = runbookSchema.safeParse({ ...validRunbook(), extra: 'nope' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual([]);
  });
});
