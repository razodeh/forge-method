/**
 * `resolveClaimPolicy` — `17` §17.4 point 5 / `06` §6.7's own per-autonomy default table.
 *
 * @see specs/17 §17.4
 * @see specs/06 §6.7
 * @see PLAN-M10.md P20
 */
import { describe, expect, it } from 'vitest';

import { resolveClaimPolicy } from '../../src/adopt/claim-policy.ts';

describe('resolveClaimPolicy', () => {
  it('06 §6.7: defaults to strict for autonomous, on a non-adopted project', () => {
    expect(resolveClaimPolicy('autonomous', false)).toBe('strict');
  });

  it('06 §6.7: defaults to warn for guided, on a non-adopted project', () => {
    expect(resolveClaimPolicy('guided', false)).toBe('warn');
  });

  it('supervised (unstated by 06 §6.7) defaults to strict, matching autonomous', () => {
    expect(resolveClaimPolicy('supervised', false)).toBe('strict');
  });

  it('17 §17.4 point 5: an adopted project forces strict even at guided autonomy', () => {
    expect(resolveClaimPolicy('guided', true)).toBe('strict');
  });

  it('an adopted project stays strict for autonomous and supervised too', () => {
    expect(resolveClaimPolicy('autonomous', true)).toBe('strict');
    expect(resolveClaimPolicy('supervised', true)).toBe('strict');
  });
});
