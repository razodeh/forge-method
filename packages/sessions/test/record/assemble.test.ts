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

  // `16` §16.7 point 4 -- "the record flags a session where no participant disagreed with any other,
  // so the user can see when a session was theatre." `FRAMED` above has zero objections, matching a
  // real all-agreement panel exactly; these two tests are `PLAN-M10.md` P11's own literal Checks text
  // for this measure ("a scripted all-agreement panel correctly flags itself; a scripted panel with
  // one real disagreement does not").
  describe('no_disagreement_observed (16 §16.7 point 4)', () => {
    it('a scripted all-agreement session (zero recorded objections) flags itself', () => {
      const record = assembleSessionRecord(FRAMED, META);
      expect(record.no_disagreement_observed).toBe(true);
    });

    it('a scripted session with one real, recorded disagreement does not flag itself', () => {
      const withDisagreement: SessionState = {
        ...FRAMED,
        objections: [{ by: 'architect', text: 'I disagree with the proposed data model.' }],
      };
      const record = assembleSessionRecord(withDisagreement, META);
      expect(record.no_disagreement_observed).toBe(false);
    });

    // A fresh critic round found an earlier draft trusted `state.objections.length > 0` outright, so
    // a structurally-required-but-generic objection (e.g. a debate concession recorded verbatim to
    // satisfy CONVERGE's own gate) was misread as real disagreement.
    it('a recorded objection whose own text is itself a generic non-objection (e.g. a debate "CONCEDE") does not clear the flag', () => {
      const criticConceded: SessionState = {
        ...FRAMED,
        objections: [{ by: 'critic', text: 'CONCEDE' }],
      };
      const record = assembleSessionRecord(criticConceded, META);
      expect(record.no_disagreement_observed).toBe(true);
    });

    it('flags itself even when critic is the only participant and never actually objects (structurally impossible to reach RECORD in that shape, but the flag itself is a pure function of state.objections alone)', () => {
      const criticPresentNoObjection: SessionState = {
        ...FRAMED,
        participants: [{ role: 'facilitator' }, { role: 'pm' }, { role: 'critic' }],
        objections: [],
      };
      const record = assembleSessionRecord(criticPresentNoObjection, META);
      expect(record.no_disagreement_observed).toBe(true);
    });
  });

  // `16` §16.8's own breach behaviour, named -- `PLAN-M10.md` P12.
  describe('truncatedBound (16 §16.8)', () => {
    it('omits truncated_bound from the record when meta.truncatedBound is not given', () => {
      const record = assembleSessionRecord(FRAMED, META);
      expect(record.truncated_bound).toBeUndefined();
    });

    it("carries meta.truncatedBound through as the record's own truncated_bound field", () => {
      const truncatedState: SessionState = { ...FRAMED, truncated: true };
      const record = assembleSessionRecord(truncatedState, { ...META, truncatedBound: 'cost' });
      expect(record.status).toBe('truncated');
      expect(record.truncated_bound).toBe('cost');
    });
  });
});
