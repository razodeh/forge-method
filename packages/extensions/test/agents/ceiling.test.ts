/**
 * `checkToolCeiling` — `15` §15.3.2's ceiling/escalation rules.
 *
 * @see specs/15 §15.3.2
 * @see PLAN-M2.md P3
 */
import { describe, expect, it } from 'vitest';

import { checkToolCeiling, isEscalationRefused } from '../../src/agents/ceiling.ts';
import type { Escalation, ToolGrant } from '../../src/agents/types.ts';

const NOT_REVIEW_NOT_OPS = { isReviewOrCritic: false, isOps: false };
const OPS = { isReviewOrCritic: false, isOps: true };
const REVIEW = { isReviewOrCritic: true, isOps: false };

describe('checkToolCeiling — narrowing and widening within the ceiling', () => {
  const ceiling: ToolGrant = {
    write: true,
    exec: ['git *', 'pnpm *'],
    network: 'allowlist',
    deploy: false,
  };

  it('allows a request narrower than the ceiling on every dimension', () => {
    const result = checkToolCeiling(
      'backend',
      NOT_REVIEW_NOT_OPS,
      ceiling,
      { write: false, exec: ['git *'] },
      [],
    );
    expect(result).toEqual({ allowed: true, usedEscalation: false });
  });

  it('allows a request exactly at the ceiling', () => {
    const result = checkToolCeiling('backend', NOT_REVIEW_NOT_OPS, ceiling, ceiling, []);
    expect(result).toEqual({ allowed: true, usedEscalation: false });
  });

  it('refuses a request exceeding the ceiling with no matching escalation', () => {
    const result = checkToolCeiling('backend', NOT_REVIEW_NOT_OPS, ceiling, { deploy: true }, []);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.violations).toContainEqual({
        field: 'deploy',
        detail: 'requests deploy access the ceiling does not grant',
      });
    }
  });

  it('refuses exec patterns outside the ceiling, naming them', () => {
    const result = checkToolCeiling(
      'backend',
      NOT_REVIEW_NOT_OPS,
      ceiling,
      { exec: ['kubectl *'] },
      [],
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.violations[0]?.detail).toMatch(/kubectl \*/);
    }
  });

  it('refuses a network tier above the ceiling', () => {
    const result = checkToolCeiling(
      'backend',
      NOT_REVIEW_NOT_OPS,
      ceiling,
      { network: 'full' },
      [],
    );
    expect(result.allowed).toBe(false);
  });

  it('refuses allowlistHosts outside the ceiling, naming them', () => {
    const withHosts: ToolGrant = { ...ceiling, allowlistHosts: ['artifactory.internal'] };
    const result = checkToolCeiling(
      'backend',
      NOT_REVIEW_NOT_OPS,
      withHosts,
      { allowlistHosts: ['evil.example'] },
      [],
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.violations[0]?.detail).toMatch(/evil\.example/);
    }
  });

  it('treats an entirely empty ceiling and request as within bounds on every dimension', () => {
    const result = checkToolCeiling('backend', NOT_REVIEW_NOT_OPS, {}, {}, []);
    expect(result).toEqual({ allowed: true, usedEscalation: false });
  });
});

describe('checkToolCeiling — escalations (15 §15.3.2)', () => {
  const ceiling: ToolGrant = { write: false, network: 'none', deploy: false };

  function escalation(overrides: Partial<Escalation> = {}): Escalation {
    return {
      agent: 'sre',
      grant: { deploy: true, network: 'full' },
      reason: 'SRE role owns our internal deploy CLI which calls our private control plane',
      approvedBy: 'radwan',
      approvedAt: '2026-08-19',
      expires: '2026-11-19',
      ...overrides,
    };
  }

  it('allows a request past the ceiling when a matching, valid escalation covers it', () => {
    const result = checkToolCeiling('sre', OPS, ceiling, { deploy: true, network: 'full' }, [
      escalation(),
    ]);
    expect(result).toEqual({ allowed: true, usedEscalation: true });
  });

  it('allows a request that is within the ceiling on fields the escalation does not restate', () => {
    // 15 §15.3.2's own worked example states an escalation's grant as only the fields it widens
    // (deploy/network) — a request whose write/exec are already within the plain ceiling must not be
    // refused just because the escalation itself is silent on write/exec.
    const wideCeiling: ToolGrant = { write: true, exec: ['git *'], network: 'allowlist' };
    const result = checkToolCeiling(
      'sre',
      OPS,
      wideCeiling,
      { write: true, exec: ['git *'], deploy: true, network: 'full' },
      [escalation()],
    );
    expect(result).toEqual({ allowed: true, usedEscalation: true });
  });

  it("an escalation's explicit narrowing overrides the ceiling's own grant, not just fills gaps", () => {
    // If mergeGrants ever treated `escalation.grant.write === false` as "not stated" and fell back to
    // the ceiling's `write: true`, this would incorrectly allow the request; the escalation
    // deliberately narrows write even while it widens deploy.
    const mixedCeiling: ToolGrant = { write: true, deploy: false };
    const result = checkToolCeiling('sre', OPS, mixedCeiling, { write: true, deploy: true }, [
      escalation({ grant: { deploy: true, write: false } }),
    ]);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.violations.map((v) => v.field)).toEqual(['write']);
    }
  });

  it('refuses when the escalation names a different agent', () => {
    const result = checkToolCeiling('backend', OPS, ceiling, { deploy: true }, [
      escalation({ agent: 'sre' }),
    ]);
    expect(result.allowed).toBe(false);
  });

  it('refuses when the escalation does not cover the full requested widening', () => {
    const result = checkToolCeiling('sre', OPS, ceiling, { deploy: true, write: true }, [
      escalation(),
    ]);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.violations.map((v) => v.field)).toEqual(['write']);
    }
  });

  it('refuses an escalation granting write:true to a review/critic role outright', () => {
    const writeEscalation = escalation({ agent: 'reviewer', grant: { write: true } });
    const result = checkToolCeiling('reviewer', REVIEW, ceiling, { write: true }, [
      writeEscalation,
    ]);
    expect(result.allowed).toBe(false);
  });

  it('refuses an escalation granting deploy:true to a non-ops role outright', () => {
    const deployEscalation = escalation({ agent: 'backend', grant: { deploy: true } });
    const result = checkToolCeiling('backend', NOT_REVIEW_NOT_OPS, ceiling, { deploy: true }, [
      deployEscalation,
    ]);
    expect(result.allowed).toBe(false);
  });

  it('isEscalationRefused flags write:true to review/critic', () => {
    expect(isEscalationRefused(escalation({ grant: { write: true } }), REVIEW)).toBe(true);
  });

  it('isEscalationRefused flags deploy:true to a non-ops role', () => {
    expect(isEscalationRefused(escalation({ grant: { deploy: true } }), NOT_REVIEW_NOT_OPS)).toBe(
      true,
    );
  });

  it('isEscalationRefused allows deploy:true to an ops role', () => {
    expect(isEscalationRefused(escalation({ grant: { deploy: true } }), OPS)).toBe(false);
  });

  it('isEscalationRefused allows write:true to a non-review role', () => {
    expect(isEscalationRefused(escalation({ grant: { write: true } }), NOT_REVIEW_NOT_OPS)).toBe(
      false,
    );
  });
});
