/**
 * `20` §20.10 S10 — "an overlay/module requesting a capability beyond its declared ceiling is refused
 * at compile time."
 *
 * The real mechanism this asserts against is `M10 P2`'s own `checkModuleCeilings`/`moduleOwning`
 * (`packages/extensions/src/module/ceiling.ts`), already covered at the unit level by
 * `test/module/ceiling.test.ts`. This file adds the missing *adversarial* framing that plan calls for:
 * not "does the function return the right violation for a hand-picked input" but "can a hostile module
 * author, or a module that merely loses an install-order `provides` conflict, actually get a grant past
 * its real, resolved ceiling" — exercised through the real `ModuleResolution`/`moduleOwning` path an
 * actual compile would use to find which module's ceiling governs a given agent, not a ceiling object
 * asserted in isolation, plus every real bypass `checkToolCeiling`'s own doc comments already name as a
 * deliberately-guarded case (a forged escalation for the wrong role, an expired escalation, an
 * escalation for a different agent, an escalation `isEscalationRefused` itself rejects even though it
 * is otherwise well-formed and unexpired).
 *
 * @see specs/20 §20.10
 * @see specs/19 §19.1
 * @see specs/15 §15.3.2
 * @see PLAN-M10.md P2
 * @see PLAN-M11.md P12
 */
import { describe, expect, it } from 'vitest';

import type { ToolGrant } from '../../src/agents/index.ts';
import { checkModuleCeilings, moduleOwning } from '../../src/module/ceiling.ts';
import type {
  ModuleCeilingCheckInput,
  ModuleDefinition,
  ModuleEscalation,
  ModuleResolution,
} from '../../src/module/types.ts';

/** `ModuleDefinition.ceilings[role]`'s own zod-inferred type carries every optional field as
 * `T | undefined` (each field is `.optional()`, not simply absent-or-`T`), which
 * `exactOptionalPropertyTypes` treats as distinct from `ToolGrant`'s own `readonly write?: boolean`
 * (present-with-a-real-value or genuinely absent, never present-with-literal-`undefined`). Filtering
 * out explicit `undefined` values is the same normalisation `agents/ceiling.ts`'s own `mergeGrants`
 * already performs for the identical reason (see that function's own doc comment) — there is no
 * existing shared helper for this because no real production caller resolves a `ModuleDefinition`
 * ceiling into a `ToolGrant` yet (confirmed directly: `checkModuleCeilings`'s only caller anywhere in
 * this codebase today is `ceiling.test.ts`/this file). */
function toToolGrant(raw: Readonly<Record<string, unknown>> | undefined): ToolGrant {
  if (raw === undefined) return {};
  return Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined));
}

const NOW = Date.parse('2026-09-12T00:00:00.000Z');
const PAST = '2026-01-01T00:00:00.000Z';
const FUTURE = '2027-01-01T00:00:00.000Z';

function definition(overrides: Partial<ModuleDefinition> & { id: string }): ModuleDefinition {
  return {
    name: overrides.id,
    version: '1.0.0',
    forgeVersion: '>=1.0 <2',
    requires: [],
    conflicts: [],
    levels: ['L1'],
    ceilings: {},
    provides: { agents: [] },
    ...overrides,
  };
}

function escalation(overrides: Partial<ModuleEscalation> = {}): ModuleEscalation {
  return {
    agent: 'contractor-agent',
    grant: { deploy: true },
    reason: 'a forged/attacker-supplied escalation record',
    approvedBy: 'nobody',
    approvedAt: PAST,
    expires: FUTURE,
    ...overrides,
  };
}

/** Builds the real `ModuleCeilingCheckInput` the way an actual compile-time caller would: by looking
 * up which installed module's own `ceilings[agentId]` genuinely governs `agentId` via `moduleOwning`
 * (which itself defers to the real `provideConflicts` winner) — never a hand-asserted ceiling object,
 * so a test that would pass against the wrong module's ceiling fails here instead. */
function checkFor(
  resolution: ModuleResolution,
  agentId: string,
  roleTags: { readonly isReviewOrCritic: boolean; readonly isOps: boolean },
  requested: ModuleCeilingCheckInput['requested'],
  escalations: readonly ModuleEscalation[] = [],
): ModuleCeilingCheckInput {
  const owner = moduleOwning(agentId, resolution);
  if (owner === undefined) {
    throw new Error(`no installed module provides agent "${agentId}" in this fixture`);
  }
  return {
    agentId,
    roleTags,
    ceiling: toToolGrant(owner.ceilings[agentId]),
    requested,
    escalations,
  };
}

describe('S10 — ceiling refusal (adversarial)', () => {
  it('a malicious overlay requesting deploy/network/exec beyond its module-declared ceiling, with no escalation at all, is refused for every exceeded dimension', () => {
    const core = definition({
      id: 'fm-core',
      provides: { agents: ['contractor-agent'] },
      ceilings: {
        'contractor-agent': { write: false, network: 'none', deploy: false, exec: [] },
      },
    });
    const resolution: ModuleResolution = {
      modules: new Map([['fm-core', core]]),
      provideConflicts: [],
    };

    const check = checkFor(
      resolution,
      'contractor-agent',
      { isReviewOrCritic: false, isOps: false },
      { write: true, network: 'full', deploy: true, exec: ['rm -rf *'] },
    );
    const violations = checkModuleCeilings([check], NOW);

    expect(violations.length).toBeGreaterThanOrEqual(4);
    for (const v of violations) expect(v.code).toBe('CFG-507');
    for (const field of ['write', 'network', 'deploy', 'exec']) {
      expect(violations.some((v) => v.message.includes(`"${field}"`))).toBe(true);
    }
  });

  it("a module that loses a provides-conflict cannot escape a stricter winning module's ceiling by declaring its own, weaker one", () => {
    // Two modules both provide "shared-agent." fm-b wins the conflict (per `provideConflicts`), and
    // fm-b's own ceiling is strict; fm-a (the loser) declares a wide-open ceiling for the same id. A
    // compile-time caller must resolve via the real conflict winner, never the loser's own declaration
    // — `moduleOwning` is exactly the function that must get this right, so this test drives the real
    // ceiling check through it rather than picking a ceiling object by hand.
    const fmA = definition({
      id: 'fm-a',
      provides: { agents: ['shared-agent'] },
      ceilings: { 'shared-agent': { deploy: true, network: 'full' } },
    });
    const fmB = definition({
      id: 'fm-b',
      provides: { agents: ['shared-agent'] },
      ceilings: { 'shared-agent': { deploy: false, network: 'none' } },
    });
    const resolution: ModuleResolution = {
      modules: new Map([
        ['fm-a', fmA],
        ['fm-b', fmB],
      ]),
      provideConflicts: [
        { kind: 'agents', id: 'shared-agent', winner: 'fm-b', contributors: ['fm-a', 'fm-b'] },
      ],
    };

    expect(moduleOwning('shared-agent', resolution)?.id).toBe('fm-b');

    const check = checkFor(
      resolution,
      'shared-agent',
      { isReviewOrCritic: false, isOps: true },
      { deploy: true, network: 'full' },
    );
    const violations = checkModuleCeilings([check], NOW);
    // Both requested fields (deploy, network) exceed fm-b's own strict ceiling -- fm-a's own wide-open
    // declaration for the same id never even enters the picture.
    expect(violations).toHaveLength(2);
    for (const v of violations) expect(v.code).toBe('CFG-507');
    expect(violations.some((v) => v.message.includes('"deploy"'))).toBe(true);
    expect(violations.some((v) => v.message.includes('"network"'))).toBe(true);
  });

  it("a forged escalation naming a different agent id never suppresses this agent's own violation", () => {
    const core = definition({
      id: 'fm-core',
      provides: { agents: ['contractor-agent'] },
      ceilings: { 'contractor-agent': { deploy: false } },
    });
    const resolution: ModuleResolution = {
      modules: new Map([['fm-core', core]]),
      provideConflicts: [],
    };

    const check = checkFor(
      resolution,
      'contractor-agent',
      { isReviewOrCritic: false, isOps: true },
      { deploy: true },
      [escalation({ agent: 'someone-else', expires: FUTURE })],
    );
    const violations = checkModuleCeilings([check], NOW);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe('CFG-507');
  });

  it('an escalation that has already expired does not suppress the violation, even when everything else about it is well-formed', () => {
    const core = definition({
      id: 'fm-core',
      provides: { agents: ['ops-agent'] },
      ceilings: { 'ops-agent': { deploy: false } },
    });
    const resolution: ModuleResolution = {
      modules: new Map([['fm-core', core]]),
      provideConflicts: [],
    };

    const check = checkFor(
      resolution,
      'ops-agent',
      { isReviewOrCritic: false, isOps: true },
      { deploy: true },
      [escalation({ agent: 'ops-agent', expires: PAST })],
    );
    expect(checkModuleCeilings([check], NOW)).toHaveLength(1);
  });

  it('a review/critic-role agent cannot use even a real, unexpired, correctly-named escalation to widen write access -- separation of duties survives a "valid" escalation record', () => {
    const core = definition({
      id: 'fm-core',
      provides: { agents: ['critic-agent'] },
      ceilings: { 'critic-agent': { write: false } },
    });
    const resolution: ModuleResolution = {
      modules: new Map([['fm-core', core]]),
      provideConflicts: [],
    };

    const check = checkFor(
      resolution,
      'critic-agent',
      { isReviewOrCritic: true, isOps: false },
      { write: true },
      [escalation({ agent: 'critic-agent', grant: { write: true }, expires: FUTURE })],
    );
    expect(checkModuleCeilings([check], NOW)).toHaveLength(1);
  });

  it('a non-ops agent cannot use a real, unexpired, correctly-named escalation to widen deploy access', () => {
    const core = definition({
      id: 'fm-core',
      provides: { agents: ['backend-agent'] },
      ceilings: { 'backend-agent': { deploy: false } },
    });
    const resolution: ModuleResolution = {
      modules: new Map([['fm-core', core]]),
      provideConflicts: [],
    };

    const check = checkFor(
      resolution,
      'backend-agent',
      { isReviewOrCritic: false, isOps: false },
      { deploy: true },
      [escalation({ agent: 'backend-agent', grant: { deploy: true }, expires: FUTURE })],
    );
    expect(checkModuleCeilings([check], NOW)).toHaveLength(1);
  });

  it('positive control -- an ops agent with a real, unexpired, correctly-named escalation genuinely is allowed (proving this suite can actually distinguish allow from deny, not merely always fail closed)', () => {
    const core = definition({
      id: 'fm-core',
      provides: { agents: ['sre-agent'] },
      ceilings: { 'sre-agent': { deploy: false } },
    });
    const resolution: ModuleResolution = {
      modules: new Map([['fm-core', core]]),
      provideConflicts: [],
    };

    const check = checkFor(
      resolution,
      'sre-agent',
      { isReviewOrCritic: false, isOps: true },
      { deploy: true },
      [escalation({ agent: 'sre-agent', grant: { deploy: true }, expires: FUTURE })],
    );
    expect(checkModuleCeilings([check], NOW)).toEqual([]);
  });

  it('a request already within the declared ceiling is never refused, escalation or not -- the ceiling is a maximum, not a fixed grant', () => {
    const core = definition({
      id: 'fm-core',
      provides: { agents: ['reader-agent'] },
      ceilings: { 'reader-agent': { write: true, network: 'allowlist' } },
    });
    const resolution: ModuleResolution = {
      modules: new Map([['fm-core', core]]),
      provideConflicts: [],
    };

    const check = checkFor(
      resolution,
      'reader-agent',
      { isReviewOrCritic: false, isOps: false },
      { write: false, network: 'allowlist' },
    );
    expect(checkModuleCeilings([check], NOW)).toEqual([]);
  });
});
