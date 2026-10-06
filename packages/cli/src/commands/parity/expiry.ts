/**
 * `isValidCalendarDate`/`isExpired` — the two pure calendar operations every date field in a parity
 * declaration needs: `expires`, `review.at` and an `unobservable` entry's own `expiry` are all
 * `YYYY-MM-DD` calendar dates (`13` F-TEST-9), validated for SHAPE *and* for actually naming a day
 * that exists (`2026-02-30` is a problem, not a date), and evaluated against an injected {@link Clock}
 * — never an ambient one (`QUALITY-BAR.md` R10: no uninjected `Date.now()`/`new Date()`).
 *
 * **The expiry boundary (a DECISION, not a transcription).** `13` F-TEST-9 says only "a declaration
 * that has reached its `expires` date" and "expires at its start" — it does not spell out whether the
 * day NAMED by `expires` still counts. This module takes the fail-closed reading `applyExemptions`
 * (`packages/cli/src/commands/loop/test/exemptions.ts`, `specs/22` M15 P6) and `applyWaiver`
 * (`@forge/engine/gates/waiver.ts`) already both take for the identical shape of field: the day named
 * by `expires` is the FIRST day the thing no longer counts — `expired` when `today >= expires`, read
 * as plain UTC calendar-date STRINGS compared lexicographically (which is exactly date order for a
 * zero-padded `YYYY-MM-DD` string, the same trick `applyExemptions`'s own `exemption.expiry <=
 * todayIso` relies on). `clock.now()` is an ISO-8601 UTC instant; `.slice(0, 10)` is "today" in UTC,
 * the identical derivation `appendExemption` already uses for the same reason.
 *
 * @see specs/13 F-TEST-9
 * @see QUALITY-BAR.md R10
 */
import type { Clock } from '@forge/core';

const DATE_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Whether `value` is both shaped like `YYYY-MM-DD` and names a calendar day that exists.
 *
 * `Date.UTC`/`getUTCFullYear` etc. are used here as a pure calendar CALCULATOR, with every input
 * explicit and supplied by the caller — never as a clock: `Date.UTC(2026, 1, 30)` normalises to March
 * 2nd rather than throwing, and the round-trip check below is what turns that normalisation into a
 * rejection (`2026-02-30` round-trips to a March date, which does not match the digits given, so it
 * is rejected) rather than a silently "corrected" one.
 */
export function isValidCalendarDate(value: string): boolean {
  const match = DATE_SHAPE.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const asUtcMillis = Date.UTC(year, month - 1, day);
  const roundTrip = new Date(asUtcMillis);
  return (
    roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() === month - 1 &&
    roundTrip.getUTCDate() === day
  );
}

/**
 * Whether a `YYYY-MM-DD` date (an `expires`, a `review.at`, or an `unobservable` entry's own
 * `expiry`) has been reached, against `clock`'s own notion of "now" — never the process's ambient
 * clock. See this module's own doc comment for the boundary this takes and why.
 *
 * Does not itself validate `dateIso`'s shape — call {@link isValidCalendarDate} first; a caller that
 * skips it gets a string comparison against whatever text it passed, which is wrong input, not this
 * function's job to detect twice.
 */
export function isExpired(dateIso: string, clock: Clock): boolean {
  const today = clock.now().slice(0, 10);
  return today >= dateIso;
}
