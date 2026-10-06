/**
 * `isValidCalendarDate`/`isExpired` (specs/22 M16 P2) — `13` F-TEST-9's calendar-date fields
 * (`expires`, `review.at`, an `unobservable` entry's `expiry`): shape AND calendar validity, and the
 * expiry boundary, pinned against an injected `Clock` (`QUALITY-BAR.md` R10: no uninjected
 * `Date.now()`).
 *
 * @see specs/13-frameworks-testing-and-debugging.md F-TEST-9
 */
import type { Clock } from '@forge/core';
import { describe, expect, it } from 'vitest';

import { isExpired, isValidCalendarDate } from '../../../src/commands/parity/expiry.ts';

function fakeClock(nowIso: string): Clock {
  return { now: () => nowIso };
}

describe('isValidCalendarDate (specs/22 M16 P2)', () => {
  it('accepts an ordinary date', () => {
    expect(isValidCalendarDate('2026-03-04')).toBe(true);
  });

  it('accepts a leap-day that exists', () => {
    expect(isValidCalendarDate('2024-02-29')).toBe(true);
  });

  it('rejects a leap-day in a non-leap year', () => {
    expect(isValidCalendarDate('2026-02-29')).toBe(false);
  });

  it('rejects a day that does not exist (invalid date)', () => {
    expect(isValidCalendarDate('2026-02-30')).toBe(false);
  });

  it('rejects a month that does not exist', () => {
    expect(isValidCalendarDate('2026-13-01')).toBe(false);
  });

  it('rejects wrong shapes outright', () => {
    expect(isValidCalendarDate('2026-3-4')).toBe(false);
    expect(isValidCalendarDate('03/04/2026')).toBe(false);
    expect(isValidCalendarDate('2026-03-04T00:00:00Z')).toBe(false);
    expect(isValidCalendarDate('not-a-date')).toBe(false);
    expect(isValidCalendarDate('')).toBe(false);
  });
});

describe('isExpired (specs/22 M16 P2) — the boundary day, pinned', () => {
  it('is NOT expired the day before "expires"', () => {
    expect(isExpired('2026-06-11', fakeClock('2026-06-10T23:59:59.999Z'))).toBe(false);
  });

  it('IS expired on the day named by "expires" itself (the DECISION: expired when today >= expires)', () => {
    expect(isExpired('2026-06-11', fakeClock('2026-06-11T00:00:00.000Z'))).toBe(true);
  });

  it('is still expired the day after', () => {
    expect(isExpired('2026-06-11', fakeClock('2026-06-12T00:00:00.000Z'))).toBe(true);
  });

  it('reads "today" as the UTC calendar date, not whatever local-time interpretation a zone would give', () => {
    // 23:59 UTC on the 10th is still the 10th in UTC even though many western-hemisphere local zones
    // would already call it the 11th -- the function must not be fooled into reading it as expired.
    expect(isExpired('2026-06-11', fakeClock('2026-06-10T23:59:00.000Z'))).toBe(false);
  });
});
