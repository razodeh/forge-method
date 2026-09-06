/**
 * `SYSTEM_CLOCK` — the one place `@forge/core` is allowed to read the real wall clock.
 *
 * @see QUALITY-BAR.md R10
 * @see PLAN-M1.md P13
 */
import { describe, expect, it } from 'vitest';

import { SYSTEM_CLOCK } from '../src/clock.ts';

describe('SYSTEM_CLOCK', () => {
  it('returns an ISO-8601 UTC timestamp', () => {
    expect(SYSTEM_CLOCK.now()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('advances between two calls', async () => {
    const first = SYSTEM_CLOCK.now();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = SYSTEM_CLOCK.now();
    expect(new Date(second).getTime()).toBeGreaterThan(new Date(first).getTime());
  });
});
