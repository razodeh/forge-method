/**
 * `SessionPhaseMachine` — `16` §16.3's own FRAME → DIVERGE → CONVERGE → DECIDE → RECORD anatomy.
 *
 * @see specs/16 §16.3
 * @see specs/16 §16.7
 * @see specs/16 §16.8
 * @see PLAN-M10.md P9
 */
import type { Clock } from '@forge/core';
import { describe, expect, it } from 'vitest';

import {
  DIVERGE_IDEA_CAP,
  MAX_AGENT_PARTICIPANTS,
  SessionPhaseMachine,
  isStatableInOneSentence,
  isGenericNonObjection,
  expressesDisagreement,
} from '../../src/phase-machine/machine.ts';
import type { SessionParticipant } from '../../src/phase-machine/types.ts';

/** A deterministic, injected clock (`QUALITY-BAR.md` R10) -- each call advances by one second from a
 * fixed start, so `started`/`ended` are real, distinct, reproducible values rather than the wall clock. */
function fakeClock(startIso = '2026-03-08T14:00:00.000Z'): Clock {
  let current = new Date(startIso).getTime();
  return {
    now(): string {
      const iso = new Date(current).toISOString();
      current += 1000;
      return iso;
    },
  };
}

const PARTICIPANTS: readonly SessionParticipant[] = [
  { role: 'pm' },
  { role: 'architect' },
  { role: 'critic' },
];

const NO_CRITIC_PARTICIPANTS: readonly SessionParticipant[] = [
  { role: 'pm' },
  { role: 'architect' },
];

function newMachine(): SessionPhaseMachine {
  return new SessionPhaseMachine({ clock: fakeClock() });
}

describe('isStatableInOneSentence', () => {
  it('accepts a single, plain sentence', () => {
    expect(isStatableInOneSentence('How do we ship faster')).toBe(true);
  });

  it('accepts a single sentence with a trailing terminator', () => {
    expect(isStatableInOneSentence('How do we ship faster?')).toBe(true);
  });

  it('rejects an empty or whitespace-only question', () => {
    expect(isStatableInOneSentence('')).toBe(false);
    expect(isStatableInOneSentence('   ')).toBe(false);
  });

  it('rejects a question containing more than one sentence', () => {
    expect(isStatableInOneSentence('How do we ship faster? What about cost?')).toBe(false);
    expect(isStatableInOneSentence('First. Then what.')).toBe(false);
  });

  it('KNOWN LIMITATION: false-positives on an embedded terminator that is not a real sentence break (e.g. "vs.")', () => {
    // Self-disclosed in this function's own doc comment: a mechanical proxy with no NLP, not a
    // judgement. A gauntlet critic round flagged this as a real, if accepted, failure mode -- pinned
    // here as a real test rather than left undemonstrated, so a future change to the heuristic sees
    // exactly what it is trading off.
    expect(isStatableInOneSentence('Should we use A vs. B for this?')).toBe(false);
  });
});

describe('start', () => {
  it("refuses (RUN-067) more than 5 agent participants, per `16` §16.8's own bound", () => {
    const machine = newMachine();
    const tooMany = Array.from({ length: MAX_AGENT_PARTICIPANTS + 1 }, (_, i) => ({
      role: `agent-${String(i)}`,
    }));
    expect(() => machine.start({ sessionType: 'brainstorm', participants: tooMany })).toThrow(
      expect.objectContaining({ code: 'RUN-067' }),
    );
  });

  it('accepts exactly 5 agent participants plus a human -- the human does not count against the cap', () => {
    const machine = newMachine();
    const fiveAgentsPlusHuman = [
      ...Array.from({ length: MAX_AGENT_PARTICIPANTS }, (_, i) => ({ role: `agent-${String(i)}` })),
      { role: 'human' },
    ];
    expect(() =>
      machine.start({ sessionType: 'brainstorm', participants: fiveAgentsPlusHuman }),
    ).not.toThrow();
  });

  it('treats a miscased "Human" role as human for the purposes of the agent cap', () => {
    const machine = newMachine();
    const fiveAgentsPlusHuman = [
      ...Array.from({ length: MAX_AGENT_PARTICIPANTS }, (_, i) => ({ role: `agent-${String(i)}` })),
      { role: 'Human' },
    ];
    expect(() =>
      machine.start({ sessionType: 'brainstorm', participants: fiveAgentsPlusHuman }),
    ).not.toThrow();
  });
});

describe('FRAME', () => {
  it('refuses a multi-sentence question with a named RUN-061 error, leaving the state at FRAME', () => {
    const machine = newMachine();
    const start = machine.start({ sessionType: 'brainstorm', participants: PARTICIPANTS });

    const result = machine.frame(start, {
      question: 'How do we ship faster? And cheaper?',
      goodOutcomeLooksLike: 'Faster releases.',
    });

    expect(result.directive.kind).toBe('refused');
    if (result.directive.kind === 'refused') {
      expect(result.directive.error.code).toBe('RUN-061');
    }
    expect(result.state.phase).toBe('FRAME');
    expect(result.state.framing).toBeUndefined();
  });

  it('refuses an empty question', () => {
    const machine = newMachine();
    const start = machine.start({ sessionType: 'brainstorm', participants: PARTICIPANTS });
    const result = machine.frame(start, { question: '   ', goodOutcomeLooksLike: 'x' });
    expect(result.directive.kind).toBe('refused');
  });

  it('accepts a one-sentence question, moves to DIVERGE, and mutes the critic in its own dispatch directive', () => {
    const machine = newMachine();
    const start = machine.start({ sessionType: 'brainstorm', participants: PARTICIPANTS });

    const result = machine.frame(start, {
      question: 'How do we reduce time-to-first-invoice?',
      constraintsApplied: ['KB-CON-0003'],
      goodOutcomeLooksLike: 'A new user sends an invoice within 10 minutes.',
    });

    expect(result.state.phase).toBe('DIVERGE');
    expect(result.state.framing?.question).toBe('How do we reduce time-to-first-invoice?');
    expect(result.state.startedAt).toBeDefined();
    expect(result.directive).toEqual({
      kind: 'dispatch-diverge',
      participants: ['pm', 'architect'],
    });
  });

  it('throws RUN-063 when called out of order (state not at FRAME)', () => {
    const machine = newMachine();
    const start = machine.start({ sessionType: 'brainstorm', participants: PARTICIPANTS });
    const { state: framed } = machine.frame(start, {
      question: 'One sentence question',
      goodOutcomeLooksLike: 'x',
    });
    expect(() => machine.frame(framed, { question: 'x', goodOutcomeLooksLike: 'y' })).toThrow(
      expect.objectContaining({ code: 'RUN-063' }),
    );
  });

  it('mutes a miscased "Critic" role identically to "critic" -- the mute check is case/whitespace-insensitive', () => {
    const machine = newMachine();
    const start = machine.start({
      sessionType: 'brainstorm',
      participants: [{ role: 'pm' }, { role: ' Critic ' }],
    });
    const result = machine.frame(start, {
      question: 'How do we reduce time-to-first-invoice?',
      goodOutcomeLooksLike: 'x',
    });
    expect(result.directive).toEqual({ kind: 'dispatch-diverge', participants: ['pm'] });
  });
});

function framedState(machine: SessionPhaseMachine, participants = PARTICIPANTS) {
  const start = machine.start({ sessionType: 'brainstorm', participants });
  return machine.frame(start, {
    question: 'How do we reduce time-to-first-invoice?',
    goodOutcomeLooksLike: 'Fast first invoice.',
  }).state;
}

describe('DIVERGE', () => {
  it('accumulates ideas across rounds without dropping any', () => {
    const machine = newMachine();
    const state1 = framedState(machine);
    const round1 = machine.diverge(state1, {
      ideas: [
        { text: 'idea A', proposedBy: 'pm' },
        { text: 'idea B', proposedBy: 'architect' },
      ],
    });
    expect(round1.state.ideas).toHaveLength(2);
    expect(round1.directive).toEqual({ kind: 'continue-diverge', ideaCount: 2 });

    const round2 = machine.diverge(round1.state, {
      ideas: [{ text: 'idea C', proposedBy: 'pm' }],
    });
    expect(round2.state.ideas.map((i) => i.text)).toEqual(['idea A', 'idea B', 'idea C']);
    expect(round2.state.phase).toBe('DIVERGE');
  });

  it('enforces the 30-idea cap by forcing clustering, keeping every idea rather than dropping any', () => {
    const machine = newMachine();
    const state = framedState(machine);
    const manyIdeas = Array.from({ length: DIVERGE_IDEA_CAP + 5 }, (_, i) => ({
      text: `idea ${String(i)}`,
      proposedBy: 'pm',
    }));

    const result = machine.diverge(state, { ideas: manyIdeas });

    expect(result.state.ideas).toHaveLength(DIVERGE_IDEA_CAP + 5);
    expect(result.state.phase).toBe('CONVERGE');
    expect(result.state.truncated).toBe(true);
    expect(result.directive).toEqual({ kind: 'diverge-capped', ideaCount: DIVERGE_IDEA_CAP + 5 });
  });

  it('endDiverge moves to CONVERGE and unmutes the critic in the dispatch directive', () => {
    const machine = newMachine();
    const state = framedState(machine);
    const { state: diverged } = machine.diverge(state, {
      ideas: [{ text: 'x', proposedBy: 'pm' }],
    });

    const result = machine.endDiverge(diverged);

    expect(result.state.phase).toBe('CONVERGE');
    expect(result.directive).toEqual({
      kind: 'dispatch-converge',
      participants: ['pm', 'architect', 'critic'],
    });
  });

  it('records the technique id used, deduplicated', () => {
    const machine = newMachine();
    const state = framedState(machine);
    const { state: r1 } = machine.diverge(state, {
      techniqueId: 'scamper',
      ideas: [{ text: 'x', proposedBy: 'pm' }],
    });
    const { state: r2 } = machine.diverge(r1, {
      techniqueId: 'scamper',
      ideas: [{ text: 'y', proposedBy: 'pm' }],
    });
    expect(r2.technique).toEqual(['scamper']);
  });

  it('throws RUN-063 when called before FRAME has run', () => {
    const machine = newMachine();
    const start = machine.start({ sessionType: 'brainstorm', participants: PARTICIPANTS });
    expect(() => machine.diverge(start, { ideas: [] })).toThrow(
      expect.objectContaining({ code: 'RUN-063' }),
    );
  });
});

function convergingState(machine: SessionPhaseMachine, participants = PARTICIPANTS) {
  const framed = framedState(machine, participants);
  const { state: diverged } = machine.diverge(framed, { ideas: [{ text: 'x', proposedBy: 'pm' }] });
  return machine.endDiverge(diverged).state;
}

describe('CONVERGE', () => {
  it('accumulates clusters and objections across rounds', () => {
    const machine = newMachine();
    const state = convergingState(machine);
    const result = machine.converge(state, {
      clusters: [{ label: 'cluster A', ideaIds: [] }],
      objections: [{ by: 'critic', text: 'this ignores cost' }],
    });
    expect(result.state.clusters).toHaveLength(1);
    expect(result.state.clusters[0]?.id).toBe('CLUSTER-001');
    expect(result.state.objections).toHaveLength(1);
    expect(result.directive).toEqual({ kind: 'continue-converge', clusterCount: 1 });
  });

  it('accepts a round with no clusters and no objections at all', () => {
    const machine = newMachine();
    const state = convergingState(machine);
    const result = machine.converge(state, {});
    expect(result.state.clusters).toHaveLength(0);
    expect(result.state.objections).toHaveLength(0);
  });

  it('advanceToDecide refuses when a critic participant is present but recorded no objection (RUN-062)', () => {
    const machine = newMachine();
    const state = convergingState(machine);
    const result = machine.advanceToDecide(state);
    expect(result.directive.kind).toBe('converge-refused');
    if (result.directive.kind === 'converge-refused') {
      expect(result.directive.error.code).toBe('RUN-062');
    }
    expect(result.state.phase).toBe('CONVERGE');
  });

  it('advanceToDecide succeeds once a critic-sourced objection is present', () => {
    const machine = newMachine();
    const converging = convergingState(machine);
    const { state: withObjection } = machine.converge(converging, {
      objections: [{ by: 'critic', text: 'real objection' }],
    });
    const result = machine.advanceToDecide(withObjection);
    expect(result.directive).toEqual({ kind: 'ready-to-decide' });
    expect(result.state.phase).toBe('DECIDE');
  });

  it('advanceToDecide succeeds with no objection at all when no critic participant is present', () => {
    const machine = newMachine();
    const converging = convergingState(machine, NO_CRITIC_PARTICIPANTS);
    const result = machine.advanceToDecide(converging);
    expect(result.directive).toEqual({ kind: 'ready-to-decide' });
  });

  it('an objection attributed to a non-critic role does not satisfy the gate', () => {
    const machine = newMachine();
    const converging = convergingState(machine);
    const { state: withNonCriticObjection } = machine.converge(converging, {
      objections: [{ by: 'pm', text: 'i disagree' }],
    });
    const result = machine.advanceToDecide(withNonCriticObjection);
    expect(result.directive.kind).toBe('converge-refused');
  });

  it('a miscased "Critic" participant still requires an objection, and a miscased "CRITIC" objection still satisfies it', () => {
    const machine = newMachine();
    const converging = convergingState(machine, [{ role: 'pm' }, { role: 'Critic' }]);

    const refused = machine.advanceToDecide(converging);
    expect(refused.directive.kind).toBe('converge-refused');

    const { state: withObjection } = machine.converge(converging, {
      objections: [{ by: 'CRITIC', text: 'a real objection' }],
    });
    const accepted = machine.advanceToDecide(withObjection);
    expect(accepted.directive).toEqual({ kind: 'ready-to-decide' });
  });
});

function decidingState(machine: SessionPhaseMachine, participants = PARTICIPANTS) {
  const converging = convergingState(machine, participants);
  const withObjection = participants.some((p) => p.role === 'critic')
    ? machine.converge(converging, { objections: [{ by: 'critic', text: 'real objection' }] }).state
    : converging;
  return machine.advanceToDecide(withObjection).state;
}

describe('DECIDE', () => {
  it('records decisions/non-decisions/actions and moves to RECORD', () => {
    const machine = newMachine();
    const state = decidingState(machine);

    const result = machine.decide(state, {
      decisions: [{ decision: 'Ship the quick-invoice path', owner: 'pm', artifactRef: 'CAP-009' }],
      nonDecisions: [
        { question: 'Multi-currency', reason: 'No signal', revisitTrigger: 'First non-US signup' },
      ],
      actions: [{ action: 'Draft ADR', owner: 'data-architect', artifactRef: 'ADR-0019' }],
    });

    expect(result.state.phase).toBe('RECORD');
    expect(result.state.decisions).toEqual([
      { id: 'D-001', decision: 'Ship the quick-invoice path', owner: 'pm', artifactRef: 'CAP-009' },
    ]);
    expect(result.state.actions).toEqual([
      { id: 'A-001', action: 'Draft ADR', owner: 'data-architect', artifactRef: 'ADR-0019' },
    ]);
    expect(result.directive).toEqual({ kind: 'ready-to-record' });
  });

  it('moves to RECORD even with zero decisions and zero actions, given an inconclusive reason', () => {
    const machine = newMachine();
    const state = decidingState(machine);
    const result = machine.decide(state, { inconclusiveReason: 'No consensus reached' });
    expect(result.state.phase).toBe('RECORD');
    expect(result.state.decisions).toHaveLength(0);
    expect(result.state.inconclusiveReason).toBe('No consensus reached');
  });

  it('throws RUN-063 when called before advanceToDecide', () => {
    const machine = newMachine();
    const state = convergingState(machine);
    expect(() => machine.decide(state, {})).toThrow(expect.objectContaining({ code: 'RUN-063' }));
  });

  // `16` §16.7 point 5's own "the human's position... enters at CONVERGE, where it outranks" -- see
  // `DecideInput.humanDecision`'s own doc comment for why this piece implements the precedence rule
  // here, at the point a decision is actually recorded, rather than literally inside CONVERGE.
  describe('humanDecision precedence (16 §16.7 point 5)', () => {
    it('a human decision alone is recorded normally', () => {
      const machine = newMachine();
      const state = decidingState(machine);
      const result = machine.decide(state, {
        humanDecision: { decision: 'Ship the manual path', owner: 'human', artifactRef: 'CAP-020' },
      });
      expect(result.state.decisions).toEqual([
        { id: 'D-001', decision: 'Ship the manual path', owner: 'human', artifactRef: 'CAP-020' },
      ]);
    });

    it('a human decision supplied alongside an agent-authored one wins outright -- the agent decision is discarded, not merely deprioritised', () => {
      const machine = newMachine();
      const state = decidingState(machine);
      const result = machine.decide(state, {
        decisions: [{ decision: 'Ship the automated path', owner: 'pm', artifactRef: 'CAP-009' }],
        humanDecision: { decision: 'Ship the manual path instead', owner: 'human' },
      });
      expect(result.state.decisions).toHaveLength(1);
      expect(result.state.decisions[0]?.decision).toBe('Ship the manual path instead');
      expect(result.state.decisions[0]?.owner).toBe('human');
    });
  });
});

describe('isGenericNonObjection (16 §16.7 point 2)', () => {
  it.each([
    'This seems fine.',
    'this all seems fine',
    'Looks good to me.',
    'LGTM',
    'No objections.',
    'No concerns here.',
    'I have nothing to add.',
    'I agree.',
    '   ',
    '',
    'CONCEDE',
    'Conceded.',
  ])('rejects the generic non-objection %j', (text) => {
    expect(isGenericNonObjection(text)).toBe(true);
  });

  it.each([
    'The proposed rollout skips a rollback plan for the payments migration -- that is a real risk.',
    'I disagree with using a single shared database for both tenants.',
    'This seems fine for the happy path, but it silently drops errors on retry, which is a real bug.',
  ])('accepts the real, falsifiable objection %j', (text) => {
    expect(isGenericNonObjection(text)).toBe(false);
  });
});

describe('expressesDisagreement (16 §16.7 point 4)', () => {
  it('a scripted all-agreement panel response does not register as disagreement', () => {
    expect(expressesDisagreement('Sounds good, I am fully on board with this plan.')).toBe(false);
  });

  it('a scripted response with one real disagreement does register', () => {
    expect(
      expressesDisagreement(
        'I disagree with shipping without a rollback plan -- that is too risky.',
      ),
    ).toBe(true);
  });

  // A fresh critic round found the marker list has no negation awareness, so routine agreement
  // phrasing using one of its own marker words was misclassified as real disagreement.
  it.each([
    'Looks good, no concerns here.',
    'Low risk, nothing against it.',
    'No objections from me -- ship it.',
    'Minimal risk, not against this at all.',
  ])('does not register the negated-agreement phrasing %j as disagreement', (text) => {
    expect(expressesDisagreement(text)).toBe(false);
  });
});
