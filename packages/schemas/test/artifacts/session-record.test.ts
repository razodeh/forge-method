/**
 * `sessionRecordSchema` — `16` §16.5's Session record.
 *
 * @see specs/16 §16.5
 * @see specs/21 §21.3
 * @see SPEC-QUESTIONS.md Q22
 */
import { describe, expect, it } from 'vitest';

import { sessionRecordSchema } from '../../src/artifacts/session-record.ts';

function validSessionRecord(): Record<string, unknown> {
  return {
    id: 'SESSION-012',
    type: 'SessionRecord',
    schemaVersion: 1,
    title: 'Reduce time-to-first-invoice',
    status: 'complete',
    created: '2026-03-08',
    updated: '2026-03-08',
    revision: 1,
    author: 'facilitator',
    changelog: [],
    sessionType: 'brainstorm',
    technique: ['scamper', 'dot-voting'],
    question: 'How do we get a new user from signup to a sent invoice in under 10 minutes?',
    constraints_applied: ['KB-CON-0003', 'NFR-0002', 'ADR-0016'],
    participants: ['facilitator', 'pm', 'architect', 'ux', 'human'],
    started: '2026-03-08T14:02:00Z',
    ended: '2026-03-08T14:41:00Z',
    cost_usd: 2.14,
  };
}

describe('sessionRecordSchema — valid', () => {
  it('accepts the spec §16.5 example (sessionType instead of the spec text\'s colliding "type")', () => {
    expect(sessionRecordSchema.safeParse(validSessionRecord()).success).toBe(true);
  });

  // `16` §16.7 point 4's own additive `no_disagreement_observed` flag (`PLAN-M10.md` P11).
  it('accepts a record with no_disagreement_observed omitted (backward-compatible additive field)', () => {
    const result = sessionRecordSchema.safeParse(validSessionRecord());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.no_disagreement_observed).toBeUndefined();
  });

  it.each([true, false])('accepts a record with no_disagreement_observed: %s', (flag) => {
    const result = sessionRecordSchema.safeParse({
      ...validSessionRecord(),
      no_disagreement_observed: flag,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.no_disagreement_observed).toBe(flag);
  });

  // `16` §16.8's own breach behaviour, named (`PLAN-M10.md` P12) -- the identical additive-field
  // treatment `no_disagreement_observed` above already gets.
  it('accepts a record with truncated_bound omitted', () => {
    const result = sessionRecordSchema.safeParse(validSessionRecord());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.truncated_bound).toBeUndefined();
  });

  it.each(['diverge-rounds', 'converge-rounds', 'diverge-idea-cap', 'wall-clock', 'cost'])(
    'accepts a record with status: truncated and truncated_bound: %s',
    (bound) => {
      const result = sessionRecordSchema.safeParse({
        ...validSessionRecord(),
        status: 'truncated',
        truncated_bound: bound,
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.truncated_bound).toBe(bound);
    },
  );

  it.each([
    'brainstorm',
    'design-review',
    'tradeoff',
    'premortem',
    'retro',
    'war-room',
    'estimation',
    'standup',
    'discovery-interview',
    'story-refinement',
  ])('accepts sessionType %s (16 §16.2)', (sessionType) => {
    expect(sessionRecordSchema.safeParse({ ...validSessionRecord(), sessionType }).success).toBe(
      true,
    );
  });
});

describe('sessionRecordSchema — invalid, each asserting the error path', () => {
  it('rejects a sessionType outside the 16 §16.2 closed enum', () => {
    const result = sessionRecordSchema.safeParse({
      ...validSessionRecord(),
      sessionType: 'kickoff',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['sessionType']);
  });

  it('rejects a date-only started (a full datetime is required)', () => {
    const result = sessionRecordSchema.safeParse({
      ...validSessionRecord(),
      started: '2026-03-08',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['started']);
  });

  it('rejects a negative cost_usd', () => {
    const result = sessionRecordSchema.safeParse({ ...validSessionRecord(), cost_usd: -1 });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['cost_usd']);
  });

  it('rejects a non-boolean no_disagreement_observed', () => {
    const result = sessionRecordSchema.safeParse({
      ...validSessionRecord(),
      no_disagreement_observed: 'yes',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['no_disagreement_observed']);
  });

  it('rejects a truncated_bound outside the real 16 §16.8 bound vocabulary', () => {
    const result = sessionRecordSchema.safeParse({
      ...validSessionRecord(),
      status: 'truncated',
      truncated_bound: 'made-up-bound',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['truncated_bound']);
  });

  it('rejects an id whose prefix does not match its type', () => {
    const result = sessionRecordSchema.safeParse({ ...validSessionRecord(), id: 'RCA-012' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['id']);
  });
});
