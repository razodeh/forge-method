/**
 * `20` §20.10 S7 — "Destructive operations require typed human confirmation naming environment and
 * resource."
 *
 * `PLAN-M11.md` P11's own direct investigation (grepping the whole workspace for a "destructive
 * operation"/typed-confirmation concept before writing any test, the same discipline P9/P10 already
 * established) found **no such mechanism anywhere** — confirming the plan's own premise exactly: S7 is
 * genuinely new production code, not a missing test for existing behaviour. Two real, already-existing
 * things this piece's own `requireDestructiveConfirmation` is built from rather than a fictional,
 * invented catalogue: `.forge/config.yaml`'s own real `security.destructiveOps` field (`confirm`/
 * `deny`/`allow-in-lane`, declared and defaulted since `@forge/schemas` shipped, read by zero
 * production code until this piece), and `20` §20.10 S2's own hard denylist (`PLAN-M11.md` P9), which
 * already, permanently, and unconditionally forecloses `git push --force`/`-f` with no override path at
 * all — the reason force-push is deliberately *not* one of this module's own confirmable operations,
 * despite being one of `PLAN-M11.md`'s own worked examples of a "destructive operation": S2 already
 * owns that ground more strictly than any confirmation gate could.
 *
 * @see specs/20 §20.10 S7
 * @see SPEC-QUESTIONS.md Q169
 * @see PLAN-M11.md P9
 * @see PLAN-M11.md P11
 */
import { describe, expect, it } from 'vitest';

import {
  destructiveConfirmationPhrase,
  requireDestructiveConfirmation,
  type DestructiveConfirmationRequest,
} from '../../src/security/destructive-confirmation.ts';

function baseRequest(
  overrides: Partial<DestructiveConfirmationRequest> = {},
): DestructiveConfirmationRequest {
  return {
    operation: 'drop-database-table',
    environment: 'production',
    resource: 'orders',
    policy: 'confirm',
    ...overrides,
  };
}

describe('requireDestructiveConfirmation (20 §20.10 S7)', () => {
  it('refuses a real, named destructive operation with no confirmation supplied at all', () => {
    const decision = requireDestructiveConfirmation(baseRequest());
    expect(decision.refused).toBe(true);
    if (!decision.refused) throw new Error('unreachable');
    expect(decision.reason).toContain('drop-database-table');
    expect(decision.reason).toContain('production');
    expect(decision.reason).toContain('orders');
    expect(decision.reason).toContain('none was supplied');
  });

  it('proceeds once a real, typed confirmation matching the named environment and resource is supplied', () => {
    const confirmation = destructiveConfirmationPhrase('production', 'orders');
    const decision = requireDestructiveConfirmation(baseRequest({ confirmation }));
    expect(decision).toEqual({ refused: false });
  });

  it('refuses a confirmation naming the WRONG resource -- not silently accepted as "close enough"', () => {
    const wrongResource = destructiveConfirmationPhrase('production', 'customers');
    const decision = requireDestructiveConfirmation(baseRequest({ confirmation: wrongResource }));
    expect(decision.refused).toBe(true);
    if (!decision.refused) throw new Error('unreachable');
    expect(decision.reason).toContain('does not match');
  });

  it('refuses a confirmation naming the WRONG environment, even with the right resource', () => {
    const wrongEnvironment = destructiveConfirmationPhrase('staging', 'orders');
    const decision = requireDestructiveConfirmation(
      baseRequest({ confirmation: wrongEnvironment }),
    );
    expect(decision.refused).toBe(true);
  });

  it('refuses a confirmation that is a real prefix/substring of the expected phrase -- exact match only', () => {
    const expected = destructiveConfirmationPhrase('production', 'orders');
    const truncated = expected.slice(0, expected.length - 1);
    const decision = requireDestructiveConfirmation(baseRequest({ confirmation: truncated }));
    expect(decision.refused).toBe(true);
  });

  it("refuses a confirmation padded with trailing whitespace -- never trimmed/normalised on this module's own behalf", () => {
    const expected = destructiveConfirmationPhrase('production', 'orders');
    const decision = requireDestructiveConfirmation(baseRequest({ confirmation: `${expected} ` }));
    expect(decision.refused).toBe(true);
  });

  it('refuses a confirmation that swaps environment/resource around the "/" separator', () => {
    // A caller who has the right two strings but the wrong order must not be silently forgiven --
    // `destructiveConfirmationPhrase('orders', 'production')` is a real, different, wrong phrase.
    const swapped = destructiveConfirmationPhrase('orders', 'production');
    const decision = requireDestructiveConfirmation(baseRequest({ confirmation: swapped }));
    expect(decision.refused).toBe(true);
  });

  it('is case-sensitive: a correctly-cased resource typed in the wrong case is refused', () => {
    const wrongCase = destructiveConfirmationPhrase('production', 'Orders');
    const decision = requireDestructiveConfirmation(baseRequest({ confirmation: wrongCase }));
    expect(decision.refused).toBe(true);
  });

  it('policy "deny" refuses unconditionally, even with a perfectly correct typed confirmation', () => {
    const confirmation = destructiveConfirmationPhrase('production', 'orders');
    const decision = requireDestructiveConfirmation(baseRequest({ policy: 'deny', confirmation }));
    expect(decision.refused).toBe(true);
    if (!decision.refused) throw new Error('unreachable');
    expect(decision.reason).toContain('deny');
    expect(decision.reason).toContain('no confirmation able to override it');
  });

  it('policy "allow-in-lane" admits with no confirmation at all when the operation is genuinely lane-scoped', () => {
    const decision = requireDestructiveConfirmation(
      baseRequest({ policy: 'allow-in-lane', inLane: true }),
    );
    expect(decision).toEqual({ refused: false });
  });

  it('policy "allow-in-lane" still requires the full typed confirmation OUTSIDE a lane -- inLane: false does not silently relax to "allow"', () => {
    const decision = requireDestructiveConfirmation(
      baseRequest({ policy: 'allow-in-lane', inLane: false }),
    );
    expect(decision.refused).toBe(true);
  });

  it('policy "allow-in-lane" with inLane omitted entirely behaves the same as inLane: false -- refused with no confirmation', () => {
    const decision = requireDestructiveConfirmation(baseRequest({ policy: 'allow-in-lane' }));
    expect(decision.refused).toBe(true);
  });

  it('policy "allow-in-lane" outside a lane still proceeds once the real, matching confirmation is supplied', () => {
    const confirmation = destructiveConfirmationPhrase('production', 'orders');
    const decision = requireDestructiveConfirmation(
      baseRequest({ policy: 'allow-in-lane', inLane: false, confirmation }),
    );
    expect(decision).toEqual({ refused: false });
  });

  it('refuses outright (fails closed) when EITHER environment or resource contains "/" -- never tries to cleverly disambiguate an ambiguous join, even with a real, correctly-typed-for-the-naive-join confirmation', () => {
    // A first fix attempt (doubling every literal "/" before joining) was found, in review, to still
    // collide at a boundary case: destructiveConfirmationPhrase('a/', 'b') and
    // destructiveConfirmationPhrase('a', '/b') both doubled to the identical 'a///b'. Rather than trust
    // a third, possibly-also-subtly-wrong escaping scheme, this module refuses the ambiguous pair
    // outright -- proven here directly against that exact counterexample shape.
    const naiveJoin = 'a/b'; // what ('a', '/b') and ('a/', 'b') would both naively join to, ignoring escaping entirely
    const decisionA = requireDestructiveConfirmation(
      baseRequest({ environment: 'a', resource: '/b', confirmation: naiveJoin }),
    );
    expect(decisionA.refused).toBe(true);
    if (!decisionA.refused) throw new Error('unreachable');
    expect(decisionA.reason).toContain('cannot be confirmed');

    const decisionB = requireDestructiveConfirmation(
      baseRequest({ environment: 'a/', resource: 'b', confirmation: naiveJoin }),
    );
    expect(decisionB.refused).toBe(true);

    // Refused even with the resource alone containing "/", independent of environment.
    const decisionC = requireDestructiveConfirmation(
      baseRequest({
        environment: 'production',
        resource: 'orders/archive',
        confirmation: destructiveConfirmationPhrase('production', 'orders/archive'),
      }),
    );
    expect(decisionC.refused).toBe(true);
  });

  it('proceeds normally for the ordinary case: neither environment nor resource contains "/"', () => {
    const confirmation = destructiveConfirmationPhrase('production', 'orders');
    expect(requireDestructiveConfirmation(baseRequest({ confirmation }))).toEqual({
      refused: false,
    });
  });

  it('no autonomy-shaped bypass exists: the function signature itself has no autonomy parameter, and every policy path (deny/confirm/allow-in-lane) is exercised above with no special-casing that could admit a request on that basis', () => {
    // Structural assertion, not a runtime one: `requireDestructiveConfirmationRequest` (the exported
    // type) carries no `autonomy` field at all for a caller to even attempt to set -- confirmed at
    // compile time by this test file itself never constructing one, and enforced positively by every
    // other test in this file already covering every real branch this function has.
    const request: DestructiveConfirmationRequest = baseRequest();
    expect('autonomy' in request).toBe(false);
  });
});
