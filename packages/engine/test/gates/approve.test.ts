/**
 * `approveGate` — the decision behind `forge gate approve` (`10` §10.3 rule 1, `PLAN-M13.md` P41): approval needs the
 * checks to pass or a valid unexpired waiver, and an approver the gate names.
 *
 * @see specs/10 §10.3
 */
import { describe, expect, it } from 'vitest';

import { approveGate, approverRefusal, evidenceArtifactType } from '../../src/gates/approve.ts';
import { evaluateGate } from '../../src/gates/evaluate.ts';
import type { GateDefinition, GateEvaluationResult, Waiver } from '../../src/gates/types.ts';

/** `expect.stringContaining` is typed `any`; the assertion is a string match, so say so. */
const like = (text: string): string => expect.stringContaining(text) as string;

const NOW = Date.parse('2026-01-01T00:00:00.000Z');
const WAIVER: Waiver = { reason: 'known', owner: 'radwan', expiresAt: '2027-01-01T00:00:00.000Z' };

function gate(over: Partial<GateDefinition> = {}): GateDefinition {
  return {
    id: 'G-T',
    checks: {
      deterministic: [
        { id: 'a', run: 'a', failOn: 'errors > 0' },
        { id: 'b', run: 'b', failOn: 'errors > 0' },
      ],
      advisory: [{ id: 'rev', agent: 'critic', brief: 'briefs/x.md' }],
    },
    openQuestionsPolicy: 'block',
    ...over,
  };
}

async function evaluated(
  definition: GateDefinition,
  failing: readonly string[] = [],
): Promise<GateEvaluationResult> {
  return evaluateGate(definition, '/', (check) =>
    Promise.resolve({
      stdout: JSON.stringify({ errors: failing.includes(check.id) ? 1 : 0 }),
      stderr: `err-${check.id}`,
      exitCode: 0,
    }),
  );
}

const HUMAN = { kind: 'human' } as const;

describe('approveGate: the checks', () => {
  it('approves a gate whose checks all pass, recording counts, digests and the advisory checks as not run', async () => {
    const definition = gate();
    const summary = approveGate({
      definition,
      evaluated: await evaluated(definition),
      approver: HUMAN,
      now: NOW,
    });
    expect(summary).toMatchObject({
      gateId: 'G-T',
      basis: 'checks',
      checksPassed: 2,
      checksFailed: 0,
      checksWaived: 0,
      advisory: [{ id: 'rev', agent: 'critic' }],
      advisoryRun: false,
      openQuestionsPolicy: 'block',
      approver: 'human',
    });
    expect(summary.checks[0]?.stdoutSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(summary.checks[0]?.stderrSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(summary).not.toHaveProperty('waiver');
  });

  it('REFUSES (GATE-507, naming the failing check) a gate with a failing check and no waiver', async () => {
    const definition = gate();
    const result = await evaluated(definition, ['b']);
    expect(() => approveGate({ definition, evaluated: result, approver: HUMAN, now: NOW })).toThrow(
      expect.objectContaining({ code: 'GATE-507', message: like('check b') }),
    );
  });

  it('approves a failing gate under a valid waiver and records the waiver and which checks it covered', async () => {
    const definition = gate();
    const summary = approveGate({
      definition,
      evaluated: await evaluated(definition, ['a']),
      waiver: WAIVER,
      waivedCheckIds: ['a', 'b'],
      approver: HUMAN,
      now: NOW,
    });
    expect(summary).toMatchObject({
      basis: 'waiver',
      checksPassed: 1,
      checksFailed: 1,
      checksWaived: 1,
      waiver: WAIVER,
    });
    expect(summary.checks.map((c) => [c.checkId, c.passed, c.waived])).toEqual([
      ['a', false, true],
      ['b', true, false],
    ]);
  });

  it.each([
    ['an expired waiver', { ...WAIVER, expiresAt: '2025-01-01T00:00:00.000Z' }, 'GATE-505'],
    [
      'a waiver expiring exactly now',
      { ...WAIVER, expiresAt: '2026-01-01T00:00:00.000Z' },
      'GATE-505',
    ],
    ['a blank owner', { ...WAIVER, owner: ' ' }, 'GATE-504'],
    ['an unparseable expiry', { ...WAIVER, expiresAt: 'soon' }, 'GATE-504'],
  ])('refuses %s', async (_l, waiver, code) => {
    const definition = gate();
    const result = await evaluated(definition, ['a']);
    expect(() =>
      approveGate({
        definition,
        evaluated: result,
        waiver,
        waivedCheckIds: ['a'],
        approver: HUMAN,
        now: NOW,
      }),
    ).toThrow(expect.objectContaining({ code }));
  });

  it('ignores a stale waiver when every check passed (it must not turn a clean approval into an error)', async () => {
    const definition = gate();
    const summary = approveGate({
      definition,
      evaluated: await evaluated(definition),
      waiver: { ...WAIVER, expiresAt: '2020-01-01T00:00:00.000Z' },
      approver: HUMAN,
      now: NOW,
    });
    expect(summary.basis).toBe('checks');
    expect(summary).not.toHaveProperty('waiver');
  });

  it('refuses a hand-built definition with no deterministic check (GATE-502) rather than approve nothing', () => {
    const definition = gate({ checks: { deterministic: [], advisory: [] } });
    expect(() =>
      approveGate({
        definition,
        evaluated: { passed: true, checks: [], advisory: [] } as never,
        approver: HUMAN,
        now: NOW,
      }),
    ).toThrow(expect.objectContaining({ code: 'GATE-502' }));
  });
});

describe('approveGate: who may approve', () => {
  it('a human approves a gate whose roles name human, or that has no approval block (the spec default)', () => {
    expect(approverRefusal(gate(), HUMAN)).toBeUndefined();
    expect(
      approverRefusal(gate({ approval: { required: true, roles: ['human'], quorum: 1 } }), HUMAN),
    ).toBeUndefined();
  });

  it('a human may not approve a gate whose roles do not name human', () => {
    expect(
      approverRefusal(gate({ approval: { required: true, roles: ['pm'], quorum: 1 } }), HUMAN),
    ).toContain('do not include `human`');
  });

  it('a quorum above 1 cannot be met by this command, for a human or an agent', () => {
    const definition = gate({ approval: { required: true, roles: ['human', 'pm'], quorum: 2 } });
    expect(approverRefusal(definition, HUMAN)).toContain('2 distinct approvers');
    expect(
      approverRefusal(definition, { kind: 'agent', agentId: 'pm', mayApprove: ['G-T'] }),
    ).toContain('2 distinct');
  });

  // The agent path is a SEAM: nothing in the CLI can authenticate an agent (Q229), so `forge gate approve` never
  // passes one. It is tested so the rules are pinned for the caller that can.
  describe('an agent approver (seam; needs every one of: not alwaysHuman, role in approval.roles, gate in may_approve)', () => {
    const approval = { required: true, roles: ['human', 'pm'], quorum: 1 };
    it('is approved when all three hold', () => {
      expect(
        approverRefusal(gate({ approval }), { kind: 'agent', agentId: 'pm', mayApprove: ['G-T'] }),
      ).toBeUndefined();
    });
    it('is refused when the agent role is not in approval.roles', () => {
      expect(
        approverRefusal(gate({ approval }), { kind: 'agent', agentId: 'po', mayApprove: ['G-T'] }),
      ).toContain('po');
    });
    it('is refused when the gate is not in gates.may_approve (architects never self-approve: may_approve is [])', () => {
      expect(
        approverRefusal(gate({ approval }), { kind: 'agent', agentId: 'pm', mayApprove: [] }),
      ).toContain('may_approve');
    });
    it('is refused for an alwaysHuman gate whatever else holds', () => {
      expect(
        approverRefusal(gate({ approval, autonomyOverride: 'alwaysHuman' }), {
          kind: 'agent',
          agentId: 'pm',
          mayApprove: ['G-T'],
        }),
      ).toContain('alwaysHuman');
    });
    it('a human still approves an alwaysHuman gate', () => {
      expect(
        approverRefusal(gate({ approval, autonomyOverride: 'alwaysHuman' }), HUMAN),
      ).toBeUndefined();
    });
  });

  it('checks the approver BEFORE evaluating success: an unauthorised approver of a passing gate gets GATE-508', () => {
    const definition = gate({ approval: { required: true, roles: ['pm'], quorum: 1 } });
    expect(() =>
      approveGate({ definition, evaluated: undefined as never, approver: HUMAN, now: NOW }),
    ).toThrow(expect.objectContaining({ code: 'GATE-508' }));
  });
});

// `PLAN-M14.md` P19, `SPEC-QUESTIONS.md` Q232 decision 8, `05` §5.2 / `10` §10.3 rule 6 / `20` §20.10 S6:
// an agent that produced this run's own evidence for the gate it is trying to approve is refused
// (`GATE-511`), even when the ordinary role/quorum/`may_approve` checks above would otherwise clear it.
describe('approveGate: same-run conflict of interest (producedEvidenceFor)', () => {
  const approval = { required: true, roles: ['human', 'pm'], quorum: 1 };
  const AGENT_PM = { kind: 'agent', agentId: 'pm', mayApprove: ['G-T'] } as const;

  it('GATE-511 when the approving agent produced evidence for THIS gate in this run', async () => {
    const definition = gate({ approval });
    const result = await evaluated(definition);
    expect(() =>
      approveGate({
        definition,
        evaluated: result,
        approver: AGENT_PM,
        now: NOW,
        producedEvidenceFor: ['G-X', 'G-T'],
      }),
    ).toThrow(
      expect.objectContaining({ code: 'GATE-511', details: { gateId: 'G-T', agentId: 'pm' } }),
    );
  });

  it('approved when producedEvidenceFor names only OTHER gates, not this one', async () => {
    const definition = gate({ approval });
    const summary = approveGate({
      definition,
      evaluated: await evaluated(definition),
      approver: AGENT_PM,
      now: NOW,
      producedEvidenceFor: ['G-Y'],
    });
    expect(summary.approver).toBe('agent pm');
  });

  it('approved when producedEvidenceFor is absent entirely (the ordinary, no-conflict case)', async () => {
    const definition = gate({ approval });
    const summary = approveGate({
      definition,
      evaluated: await evaluated(definition),
      approver: AGENT_PM,
      now: NOW,
    });
    expect(summary.approver).toBe('agent pm');
  });

  it('a human approver ignores producedEvidenceFor entirely, whatever it names', async () => {
    const definition = gate();
    const summary = approveGate({
      definition,
      evaluated: await evaluated(definition),
      approver: HUMAN,
      now: NOW,
      producedEvidenceFor: ['G-T'],
    });
    expect(summary.approver).toBe('human');
  });

  it('checked after the ordinary authorisation refusal: an agent not in approval.roles at all still gets GATE-508, not GATE-511', async () => {
    const definition = gate({ approval: { required: true, roles: ['human'], quorum: 1 } });
    const result = await evaluated(definition);
    expect(() =>
      approveGate({
        definition,
        evaluated: result,
        approver: { kind: 'agent', agentId: 'pm', mayApprove: ['G-T'] },
        now: NOW,
        producedEvidenceFor: ['G-T'],
      }),
    ).toThrow(expect.objectContaining({ code: 'GATE-508' }));
  });
});

describe('approveGate does not trust the evaluation flag', () => {
  it('an evaluation that says passed while a check verdict failed, or that lacks a declared check, is not approvable', async () => {
    const definition = gate();
    const failing = await evaluated(definition, ['a']);
    expect(() =>
      approveGate({
        definition,
        evaluated: { ...failing, passed: true },
        approver: HUMAN,
        now: NOW,
      }),
    ).toThrow(expect.objectContaining({ code: 'GATE-507' }));
    const full = await evaluated(definition);
    expect(() =>
      approveGate({
        definition,
        evaluated: { ...full, checks: full.checks.slice(0, 1) },
        approver: HUMAN,
        now: NOW,
      }),
    ).toThrow(expect.objectContaining({ code: 'GATE-507' }));
  });
});

describe('a waiver excuses the checks it was granted for, not a later regression', () => {
  it('is refused when a check outside the waiver (granted for `a`) fails now', async () => {
    const definition = gate();
    const result = await evaluated(definition, ['a', 'b']);
    expect(() =>
      approveGate({
        definition,
        evaluated: result,
        waiver: WAIVER,
        waivedCheckIds: ['a'],
        approver: HUMAN,
        now: NOW,
      }),
    ).toThrow(expect.objectContaining({ code: 'GATE-507', message: like('check b') }));
  });
  it('is refused when the waiver recorded no covered checks (granted while the gate was green)', async () => {
    const definition = gate();
    const result = await evaluated(definition, ['a']);
    expect(() =>
      approveGate({
        definition,
        evaluated: result,
        waiver: WAIVER,
        waivedCheckIds: [],
        approver: HUMAN,
        now: NOW,
      }),
    ).toThrow(expect.objectContaining({ code: 'GATE-507' }));
  });
  it('covers a subset of what it excused (a fixed check is no problem)', async () => {
    const definition = gate();
    const result = await evaluated(definition, ['a']);
    const summary = approveGate({
      definition,
      evaluated: result,
      waiver: WAIVER,
      waivedCheckIds: ['a', 'b'],
      approver: HUMAN,
      now: NOW,
    });
    expect(summary.basis).toBe('waiver');
  });
  it('refuses an evaluation of a different gate', async () => {
    const definition = gate();
    const other = await evaluated(gate({ id: 'G-Other' }));
    expect(() => approveGate({ definition, evaluated: other, approver: HUMAN, now: NOW })).toThrow(
      expect.objectContaining({ code: 'GATE-507' }),
    );
  });
  it('an agent id of `human` is not the person at the terminal', () => {
    expect(
      approverRefusal(gate({ approval: { required: true, roles: ['human'], quorum: 1 } }), {
        kind: 'agent',
        agentId: 'human',
        mayApprove: ['G-T'],
      }),
    ).toContain('not an agent id');
  });
});

describe('a check with no verdict is never approvable, waiver or not', () => {
  it.each([[undefined], [[]], [['a']]])('waivedCheckIds %j', async (covered) => {
    const definition = gate();
    const full = await evaluated(definition);
    expect(() =>
      approveGate({
        definition,
        evaluated: { ...full, checks: [] },
        waiver: WAIVER,
        waivedCheckIds: covered,
        approver: HUMAN,
        now: NOW,
      }),
    ).toThrow(expect.objectContaining({ code: 'GATE-507', message: like('no verdict') }));
  });
  it('a hand-built quorum that is not a whole number of at least 1 cannot be met', () => {
    for (const quorum of [0, -1, Number.NaN, 1.5]) {
      expect(
        approverRefusal(gate({ approval: { required: true, roles: ['human'], quorum } }), HUMAN),
      ).toContain('quorum');
    }
  });
});

// `PLAN-M14.md` P19, Discloses: "the Type(*)/Type(id) grammar is parsed as the name before (, never a
// wildcard."
describe('evidenceArtifactType', () => {
  it('reads the text before the first "(" as the type name', () => {
    expect(evidenceArtifactType('InterfaceContract(*)')).toBe('InterfaceContract');
    expect(evidenceArtifactType('ADR(*)')).toBe('ADR');
    expect(evidenceArtifactType('ADR(ADR-0011)')).toBe('ADR');
  });
  it('a bare type name with no "(" at all is returned unchanged', () => {
    expect(evidenceArtifactType('ArchitectureSpec')).toBe('ArchitectureSpec');
  });
});
