/**
 * `assembleSessionRecord` — its output must validate against the real, already-shipped
 * `sessionRecordSchema` (`@forge/schemas`) on every required field.
 *
 * @see specs/16 §16.5
 * @see PLAN-M10.md P9
 */
import { sessionRecordSchema } from '@forge/schemas';
import { describe, expect, it } from 'vitest';

import { assembleSessionRecord } from '../../src/record/assemble.ts';
import type { SessionState } from '../../src/phase-machine/types.ts';

const FRAMED: SessionState = {
  phase: 'RECORD',
  sessionType: 'brainstorm',
  participants: [{ role: 'facilitator' }, { role: 'pm' }, { role: 'architect' }],
  technique: ['scamper', 'dot-voting'],
  framing: {
    question: 'How do we reduce time-to-first-invoice?',
    constraintsApplied: ['KB-CON-0003', 'NFR-0002'],
    outOfScope: ['multi-currency'],
    goodOutcomeLooksLike: 'A new user sends an invoice within 10 minutes.',
  },
  startedAt: '2026-03-08T14:02:00.000Z',
  ideas: [],
  clusters: [],
  objections: [],
  decisions: [
    { id: 'D-001', decision: 'Ship the quick-invoice path', owner: 'pm', artifactRef: 'CAP-009' },
  ],
  nonDecisions: [
    {
      question: 'Multi-currency defaults',
      reason: 'No signal',
      revisitTrigger: 'First non-US signup',
    },
  ],
  actions: [{ id: 'A-001', action: 'Draft ADR', owner: 'data-architect', artifactRef: 'ADR-0019' }],
  truncated: false,
};

const META = {
  id: 'SESSION-012',
  title: 'Reduce time-to-first-invoice',
  author: 'facilitator',
  schemaVersion: 1,
  revision: 1,
  created: '2026-03-08',
  updated: '2026-03-08',
  changelog: [{ revision: 1, date: '2026-03-08', by: 'facilitator', summary: 'Initial record.' }],
  costUsd: 2.14,
  ended: '2026-03-08T14:41:00.000Z',
};

describe('assembleSessionRecord', () => {
  it('produces a value that validates against the real sessionRecordSchema byte-for-byte on every required field', () => {
    const record = assembleSessionRecord(FRAMED, META);
    const parsed = sessionRecordSchema.parse(record);
    expect(parsed).toEqual(record);
    expect(record).toMatchObject({
      id: 'SESSION-012',
      type: 'SessionRecord',
      sessionType: 'brainstorm',
      technique: ['scamper', 'dot-voting'],
      question: 'How do we reduce time-to-first-invoice?',
      constraints_applied: ['KB-CON-0003', 'NFR-0002'],
      participants: ['facilitator', 'pm', 'architect'],
      started: '2026-03-08T14:02:00.000Z',
      ended: '2026-03-08T14:41:00.000Z',
      cost_usd: 2.14,
      status: 'complete',
    });
  });

  it('sets status "inconclusive" for a session with zero decisions/actions and a stated reason', () => {
    const inconclusive: SessionState = {
      ...FRAMED,
      decisions: [],
      actions: [],
      inconclusiveReason: 'No consensus reached',
    };
    const record = assembleSessionRecord(inconclusive, META);
    expect(record.status).toBe('inconclusive');
  });

  it('sets status "truncated" for a session the DIVERGE idea cap forced through', () => {
    const record = assembleSessionRecord({ ...FRAMED, truncated: true }, META);
    expect(record.status).toBe('truncated');
  });

  it('prefers "truncated" over "inconclusive" when both are true at once', () => {
    const truncatedAndEmpty: SessionState = {
      ...FRAMED,
      truncated: true,
      decisions: [],
      actions: [],
      inconclusiveReason: 'Idea cap forced CONVERGE before anything could be decided',
    };
    const record = assembleSessionRecord(truncatedAndEmpty, META);
    expect(record.status).toBe('truncated');
  });

  it('refuses (RUN-064) a decision with no artifact reference', () => {
    const incomplete: SessionState = {
      ...FRAMED,
      decisions: [{ id: 'D-001', decision: 'x', owner: 'pm' }],
    };
    expect(() => assembleSessionRecord(incomplete, META)).toThrow(
      expect.objectContaining({ code: 'RUN-064' }),
    );
  });

  it('refuses (RUN-064) an action with no owner', () => {
    const incomplete: SessionState = {
      ...FRAMED,
      actions: [{ id: 'A-001', action: 'x' }],
    };
    expect(() => assembleSessionRecord(incomplete, META)).toThrow(
      expect.objectContaining({ code: 'RUN-064' }),
    );
  });

  it('refuses (RUN-064) zero decisions/zero actions with no inconclusive reason', () => {
    const empty: SessionState = { ...FRAMED, decisions: [], actions: [] };
    expect(() => assembleSessionRecord(empty, META)).toThrow(
      expect.objectContaining({ code: 'RUN-064' }),
    );
  });

  it('refuses (RUN-063) a state that has never been through FRAME', () => {
    const unframed: SessionState = {
      ...FRAMED,
      framing: undefined,
      startedAt: undefined,
    };
    expect(() => assembleSessionRecord(unframed, META)).toThrow(
      expect.objectContaining({ code: 'RUN-063' }),
    );
  });

  it('refuses (RUN-066) a malformed meta field, without letting a raw ZodError escape', () => {
    const badMeta = { ...META, id: 'not-a-valid-session-id' };
    expect(() => assembleSessionRecord(FRAMED, badMeta)).toThrow(
      expect.objectContaining({ code: 'RUN-066' }),
    );
  });

  it('refuses (RUN-066) an out-of-range revision', () => {
    const badMeta = { ...META, revision: 0 };
    expect(() => assembleSessionRecord(FRAMED, badMeta)).toThrow(
      expect.objectContaining({ code: 'RUN-066' }),
    );
  });
});
