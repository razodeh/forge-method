/**
 * `applyWaiver`/`isApproved` — `10` §10.3's own rule 1: a gate cannot be approved with a failing
 * deterministic check present, only waived; waivers require a reason, an owner, and an expiry.
 *
 * @see specs/10 §10.3
 * @see PLAN-M5.md P14
 */
import { describe, expect, it } from 'vitest';

import { ForgeError } from '@forge/core/errors';

import {
  applyWaiver,
  isApproved,
  isWaiverOwnerIdentifier,
  validateWaiverPolicy,
  waiverExceedsCap,
} from '../../src/gates/waiver.ts';
import type { GateEvaluationResult, Waiver } from '../../src/gates/types.ts';

function result(
  overrides: Partial<GateEvaluationResult> & { readonly passed: boolean },
): GateEvaluationResult {
  return {
    gateId: 'G-Test',
    checks: [],
    advisory: [],
    openQuestionsPolicy: 'block',
    waiver: undefined,
    waiverAppliedAt: undefined,
    ...overrides,
  };
}

const NOW = Date.parse('2026-01-01T00:00:00.000Z');

function waiver(overrides: Partial<Waiver> = {}): Waiver {
  return {
    reason: 'known false positive',
    owner: 'alice',
    expiresAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('isApproved', () => {
  it('is true when the gate itself passed, with no waiver needed at all', () => {
    expect(isApproved(result({ passed: true }))).toBe(true);
  });

  it('is false when the gate failed and no waiver has been applied -- the "typed refusal, not a constructible state" the Checks text asks for', () => {
    expect(isApproved(result({ passed: false }))).toBe(false);
  });

  it('is true once a valid waiver has been applied to a failing result', () => {
    const failing = result({ passed: false });
    const waived = applyWaiver(failing, waiver(), NOW);
    expect(isApproved(waived)).toBe(true);
  });

  it('is false for a hand-constructed result carrying a blank waiver that never actually went through applyWaiver -- a critic round found the earlier version trusted waiver !== undefined alone, so any caller bypassing applyWaiver entirely (constructing this shape directly, e.g. reviving a corrupted persisted report) could fabricate an approved-looking result', () => {
    const bypassed = result({
      passed: false,
      waiver: { reason: '', owner: '', expiresAt: '2000-01-01T00:00:00.000Z' },
      waiverAppliedAt: NOW,
    });
    expect(isApproved(bypassed)).toBe(false);
  });

  it('is false for a hand-constructed result whose waiver is well-formed in shape but was never really valid -- an expiresAt already in the past relative to its own claimed waiverAppliedAt, which applyWaiver itself could never have produced', () => {
    // A verify round found the shape-only fix above still accepted this: isWellFormedWaiver alone cannot
    // tell "legitimately applied, now stale" (a real, later-time re-inspection, which isApproved must
    // still accept -- see the test below) apart from "fabricated with a dead-on-arrival expiry" (which
    // applyWaiver itself would have refused with GATE-505 had it actually been called).
    const bypassed = result({
      passed: false,
      waiver: { reason: 'looks legitimate', owner: 'alice', expiresAt: '2000-01-01T00:00:00.000Z' },
      waiverAppliedAt: NOW, // NOW is well after 2000 -- applyWaiver would have thrown GATE-505 for this pair
    });
    expect(isApproved(bypassed)).toBe(false);
  });

  it('is false when waiver is set but waiverAppliedAt is missing, or vice versa -- both only ever come from applyWaiver together', () => {
    expect(
      isApproved(result({ passed: false, waiver: waiver(), waiverAppliedAt: undefined })),
    ).toBe(false);
    expect(isApproved(result({ passed: false, waiver: undefined, waiverAppliedAt: NOW }))).toBe(
      false,
    );
  });

  it('does not re-check a legitimately-applied waiver\'s own expiry against a later "now" -- once validated by applyWaiver, a gate\'s own evaluation record does not silently flip to unapproved just because more wall-clock time has since passed', () => {
    const waived = applyWaiver(
      result({ passed: false }),
      waiver({ expiresAt: new Date(NOW + 1).toISOString() }),
      NOW,
    );
    // The waiver above is now, in the real world, long expired -- isApproved must still report true for
    // this already-finalised result; a fresh answer comes from re-evaluating and re-waiving, not from this
    // function silently reappraising an old one.
    expect(isApproved(waived)).toBe(true);
  });
});

describe('applyWaiver', () => {
  it('attaches a well-formed, unexpired waiver to the result', () => {
    const waived = applyWaiver(result({ passed: false }), waiver(), NOW);
    expect(waived.waiver).toEqual(waiver());
  });

  it('records now as waiverAppliedAt alongside the waiver itself', () => {
    const waived = applyWaiver(result({ passed: false }), waiver(), NOW);
    expect(waived.waiverAppliedAt).toBe(NOW);
  });

  it('leaves every other field of the result untouched', () => {
    const failing = result({ passed: false, gateId: 'G-Design', openQuestionsPolicy: 'warn' });
    const waived = applyWaiver(failing, waiver(), NOW);
    expect(waived.gateId).toBe('G-Design');
    expect(waived.openQuestionsPolicy).toBe('warn');
    expect(waived.passed).toBe(false);
  });

  it('succeeds even when the result already passed, attaching the waiver unconditionally rather than requiring the caller to know not to call it', () => {
    const waived = applyWaiver(result({ passed: true }), waiver(), NOW);
    expect(waived.waiver).toEqual(waiver());
  });

  it('refuses (throws a ForgeError GATE-504) a waiver with a blank reason', () => {
    expect(() => applyWaiver(result({ passed: false }), waiver({ reason: '' }), NOW)).toThrow(
      ForgeError,
    );
    expect(() => applyWaiver(result({ passed: false }), waiver({ reason: '   ' }), NOW)).toThrow(
      ForgeError,
    );
  });

  it('refuses a waiver with a blank owner', () => {
    let caught: unknown;
    try {
      applyWaiver(result({ passed: false }), waiver({ owner: '' }), NOW);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForgeError);
    if (caught instanceof ForgeError) expect(caught.code).toBe('GATE-504');
  });

  it('refuses a waiver missing expiresAt (blank)', () => {
    let caught: unknown;
    try {
      applyWaiver(result({ passed: false }), waiver({ expiresAt: '' }), NOW);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForgeError);
    if (caught instanceof ForgeError) expect(caught.code).toBe('GATE-504');
  });

  it('refuses a waiver whose expiresAt does not parse as a real instant at all', () => {
    let caught: unknown;
    try {
      applyWaiver(result({ passed: false }), waiver({ expiresAt: 'not a date' }), NOW);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForgeError);
    if (caught instanceof ForgeError) expect(caught.code).toBe('GATE-504');
  });

  it('refuses (GATE-505, distinct from GATE-504) a well-formed waiver that has already expired', () => {
    let caught: unknown;
    try {
      applyWaiver(
        result({ passed: false }),
        waiver({ expiresAt: '2025-01-01T00:00:00.000Z' }),
        NOW,
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForgeError);
    if (caught instanceof ForgeError) expect(caught.code).toBe('GATE-505');
  });

  it('treats a waiver expiring at exactly "now" as already expired, not valid for one more instant -- the fail-closed direction on a boundary condition', () => {
    expect(() =>
      applyWaiver(
        result({ passed: false }),
        waiver({ expiresAt: new Date(NOW).toISOString() }),
        NOW,
      ),
    ).toThrow(ForgeError);
  });

  it('accepts a waiver expiring one millisecond after "now"', () => {
    const waived = applyWaiver(
      result({ passed: false }),
      waiver({ expiresAt: new Date(NOW + 1).toISOString() }),
      NOW,
    );
    expect(waived.waiver).toBeDefined();
  });

  it('cleanly replaces an already-applied waiver when called a second time, rather than merging or otherwise combining the two', () => {
    const once = applyWaiver(
      result({ passed: false }),
      waiver({ reason: 'first reason', owner: 'alice' }),
      NOW,
    );
    const twice = applyWaiver(once, waiver({ reason: 'second reason', owner: 'bob' }), NOW);
    expect(twice.waiver).toEqual({
      reason: 'second reason',
      owner: 'bob',
      expiresAt: waiver().expiresAt,
    });
  });

  it('refuses a reason/owner made entirely of invisible Unicode characters (a zero-width space, or a NUL byte) as "non-blank" -- a plain .trim() alone does not catch either, since neither is classified as ECMAScript whitespace', () => {
    expect(() => applyWaiver(result({ passed: false }), waiver({ reason: '​​​' }), NOW)).toThrow(
      ForgeError,
    );
    expect(() => applyWaiver(result({ passed: false }), waiver({ owner: ' ' }), NOW)).toThrow(
      ForgeError,
    );
  });

  it('still accepts a reason/owner that legitimately contains non-ASCII text, not just ASCII letters', () => {
    const waived = applyWaiver(
      result({ passed: false }),
      waiver({ reason: '误报 (false positive)', owner: '田中' }),
      NOW,
    );
    expect(waived.waiver?.reason).toBe('误报 (false positive)');
  });

  it("attaches an independent copy of the waiver, not the caller's own object reference -- mutating the original after the call does not affect the already-applied result", () => {
    // A verify round found the earlier version attached the caller's own, still-mutable object directly:
    // mutating it afterward silently rewrote an already-validated result's own audit-trail content.
    const original: { reason: string; owner: string; expiresAt: string } = { ...waiver() };
    const waived = applyWaiver(result({ passed: false }), original, NOW);
    original.reason = 'fabricated after the fact';
    original.owner = 'mallory';
    expect(waived.waiver?.reason).toBe('known false positive');
    expect(waived.waiver?.owner).toBe('alice');
  });

  it('returns a frozen waiver object that cannot itself be mutated after the fact', () => {
    const waived = applyWaiver(result({ passed: false }), waiver(), NOW);
    expect(Object.isFrozen(waived.waiver)).toBe(true);
    expect(() => {
      // @ts-expect-error -- deliberately attempting to mutate a readonly, frozen object
      waived.waiver.reason = 'mutated';
    }).toThrow();
    expect(waived.waiver?.reason).toBe('known false positive');
  });
});

const DAY_MS = 24 * 60 * 60 * 1000;

// `PLAN-M14.md` P16, `SPEC-QUESTIONS.md` Q232 decision 10.
describe('isWaiverOwnerIdentifier', () => {
  it.each(['r.abu-odeh@example.com', 'JIRA-1234', 'ops:oncall', 'a', 'A9z'])(
    'accepts %s',
    (owner) => {
      expect(isWaiverOwnerIdentifier(owner)).toBe(true);
    },
  );

  it('refuses an empty string', () => {
    expect(isWaiverOwnerIdentifier('')).toBe(false);
  });

  it('refuses whitespace only', () => {
    expect(isWaiverOwnerIdentifier('  ')).toBe(false);
  });

  it('refuses a real word with a space -- non-blank (isNonBlank alone would accept it), but not one token', () => {
    expect(isWaiverOwnerIdentifier('the team')).toBe(false);
  });

  it('refuses a zero-width space (Cf), invisible but not ECMAScript whitespace', () => {
    expect(isWaiverOwnerIdentifier('​')).toBe(false);
  });

  it('refuses a tab inside the token', () => {
    expect(isWaiverOwnerIdentifier('a\tb')).toBe(false);
  });

  it('refuses a value starting with punctuation rather than a letter or digit', () => {
    expect(isWaiverOwnerIdentifier('.radwan')).toBe(false);
    expect(isWaiverOwnerIdentifier('-radwan')).toBe(false);
  });

  it('accepts exactly 100 characters, and refuses 101', () => {
    expect(isWaiverOwnerIdentifier('a'.repeat(100))).toBe(true);
    expect(isWaiverOwnerIdentifier('a'.repeat(101))).toBe(false);
  });
});

describe('waiverExceedsCap', () => {
  it('does not exceed a waiver expiring exactly maxDays after its own grant', () => {
    const w = waiver({ expiresAt: new Date(NOW + 90 * DAY_MS).toISOString() });
    expect(waiverExceedsCap(w, NOW, 90)).toBe(false);
  });

  it('exceeds a waiver expiring one millisecond past maxDays after its own grant', () => {
    const w = waiver({ expiresAt: new Date(NOW + 90 * DAY_MS + 1).toISOString() });
    expect(waiverExceedsCap(w, NOW, 90)).toBe(true);
  });

  it('reads maxDays as its own argument, not a hard-coded 90 -- the identical 91-days-out expiry flips from exceeding to within budget purely because a wider cap was passed', () => {
    const w = waiver({ expiresAt: new Date(NOW + 91 * DAY_MS).toISOString() });
    expect(waiverExceedsCap(w, NOW, 90)).toBe(true);
    expect(waiverExceedsCap(w, NOW, 180)).toBe(false);
  });

  it('measures from the given grantedAt, not from any ambient clock -- a waiver granted long ago with a short-relative expiry still reads correctly', () => {
    const grantedLongAgo = Date.parse('2020-01-01T00:00:00.000Z');
    const w = waiver({ expiresAt: new Date(grantedLongAgo + 30 * DAY_MS).toISOString() });
    expect(waiverExceedsCap(w, grantedLongAgo, 90)).toBe(false);
  });

  it('does not itself reject an expiresAt that fails to parse -- that is applyWaiver/GATE-504\'s own job', () => {
    expect(waiverExceedsCap(waiver({ expiresAt: 'not a date' }), NOW, 90)).toBe(false);
  });
});

describe('validateWaiverPolicy', () => {
  it('accepts a well-formed, single-token owner within the cap', () => {
    expect(() => {
      validateWaiverPolicy(
        waiver({ owner: 'radwan', expiresAt: new Date(NOW + 30 * DAY_MS).toISOString() }),
        NOW,
        90,
      );
    }).not.toThrow();
  });

  it('refuses (GATE-512) an expiry beyond the cap, naming maxDays and the expiry', () => {
    let caught: unknown;
    try {
      validateWaiverPolicy(
        waiver({ owner: 'radwan', expiresAt: new Date(NOW + 91 * DAY_MS).toISOString() }),
        NOW,
        90,
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForgeError);
    if (caught instanceof ForgeError) {
      expect(caught.code).toBe('GATE-512');
      expect(caught.details['maxDays']).toBe(90);
    }
  });

  it('refuses (GATE-513) a non-identifier owner, even with an expiry well within the cap', () => {
    let caught: unknown;
    try {
      validateWaiverPolicy(
        waiver({ owner: 'the team', expiresAt: new Date(NOW + DAY_MS).toISOString() }),
        NOW,
        90,
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForgeError);
    if (caught instanceof ForgeError) expect(caught.code).toBe('GATE-513');
  });

  it('leaves applyWaiver/GATE-504/GATE-505 untouched -- a blank owner still reaches applyWaiver\'s own distinct refusal when that is the function actually called', () => {
    expect(() => applyWaiver(result({ passed: false }), waiver({ owner: '' }), NOW)).toThrow(
      expect.objectContaining({ code: 'GATE-504' }),
    );
  });
});
