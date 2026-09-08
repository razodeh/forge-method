/**
 * `applyWaiver`/`isApproved` — `10` §10.3's own rule 1: "a gate with any failing deterministic check
 * cannot be approved — only waived, and waivers require a reason, an owner, and an expiry." The run-time
 * half of `15` §15.10's own invariant I3 (`GATE-501`'s own comment: "cannot be approved with a failing
 * check is a run-time gate-approval fact — M5's to enforce").
 *
 * @see specs/10 §10.3
 * @see specs/15 §15.10 (I3)
 * @see PLAN-M5.md P14
 */
import { ForgeError } from '@forge/core/errors';

import type { GateEvaluationResult, Waiver } from './types.ts';

/** `Waiver`'s own three fields are all typed `string`, which — unlike a schema built with `zod`'s own
 * `.min(1)` (`@forge/engine/workflow`'s own `nonBlank()`) — cannot itself rule out an empty or
 * whitespace-only value at compile time; this is the actual, reachable shape "a waiver missing any of the
 * three fields" (`PLAN-M5.md` P14's own Checks text) refers to, not literally undefined fields TypeScript
 * would already reject.
 *
 * Strips every Unicode "control" (`\p{Cc}`) and "format" (`\p{Cf}`) character in addition to ordinary
 * whitespace, not just `.trim()` — a critic round found a plain `.trim()` accepts a `reason`/`owner` made
 * entirely of a zero-width space (U+200B, category `Cf`) or a NUL byte (U+0000, category `Cc`) as
 * "non-blank," since neither is ECMAScript `WhiteSpace`. Using the two general Unicode categories rather
 * than enumerating specific code points keeps this a principled rule ("is there anything a human would
 * actually *read* here") instead of a growing, always-incomplete blacklist of individually-discovered
 * invisible characters — a verify round confirmed this also correctly accepts real text across many
 * scripts (CJK, Arabic, Hebrew, Cyrillic, Devanagari, emoji, combining diacritics) with no false rejections,
 * and separately confirmed a small number of *other* "renders as visually blank" characters (`Lo`-category
 * oddities like Hangul filler, U+3164) fall outside both categories this checks — an acknowledged,
 * deliberately bounded gap in the same spirit as this package's other approximations (`globsOverlap`'s own
 * "not a genuine wildcard-vs-wildcard overlap detector," `Q73`/`Q74`), not chased further here. */
function isNonBlank(value: string): boolean {
  return value.replace(/[\p{Cc}\p{Cf}\s]/gu, '').length > 0;
}

/** The shape half of rule 1 alone — a real `reason`/`owner`, and an `expiresAt` that at least parses as an
 * instant — deliberately *not* checking that instant against any particular `now`: shared by `applyWaiver`
 * (which additionally, separately checks expiry against its own caller-supplied `now`) and `isApproved`
 * (below), which re-checks this shape half plus one more thing (see its own doc comment for why expiry
 * itself is checked differently there). */
function isWellFormedWaiver(waiver: Waiver): boolean {
  return isNonBlank(waiver.reason) && isNonBlank(waiver.owner) && isNonBlank(waiver.expiresAt) && !Number.isNaN(Date.parse(waiver.expiresAt));
}

/** Refuses (throws a specific `ForgeError`, never a silent no-op) a waiver missing a `reason`/`owner`, one
 * whose `expiresAt` does not even parse as a real instant, or one that has already lapsed relative to `now`
 * — `now` is caller-injected, not `Date.now()`, the identical determinism-mandate reason (`21` §21.1)
 * `@forge/engine/backpressure` (P13) already takes its own clock as a plain argument. `PLAN-M5.md`'s own
 * Surface text shows `applyWaiver(result, waiver): GateEvaluationResult`, omitting `now` entirely — the
 * same "the plan's own bullet undersells what the signature needs to be" correction `Q70`/`Q71`/`Q73` have
 * each already made once for a different function's own return type; here it is a parameter instead, but
 * the reasoning is identical: expiry cannot be checked against nothing.
 *
 * On success, attaches a *frozen, independent copy* of `waiver` to `result` — not the caller's own object
 * reference — plus `now` itself as `waiverAppliedAt` (`isApproved`'s own doc comment explains what that
 * field is for). A verify round found the earlier version attached the caller's own, still-mutable object
 * directly: mutating it after this call returned would silently rewrite an already-validated result's own
 * audit-trail content, undetectably whenever the new values happened to still look well-formed — the
 * identical "audit record should not silently change" reasoning `ForgeError.details` already applies to
 * itself (`Object.freeze`d for the same reason) elsewhere in this codebase.
 *
 * Attaches unconditionally — even when `result.passed` is already `true`, since nothing about a well-formed
 * waiver is wrong to record just because it turned out not to be needed, and keeping this function's own
 * behaviour uniform (never branching on `passed` itself) is simpler than a caller having to know not to
 * call it in that case. */
export function applyWaiver(result: GateEvaluationResult, waiver: Waiver, now: number): GateEvaluationResult {
  if (!isWellFormedWaiver(waiver)) {
    throw new ForgeError('GATE-504', { gateId: result.gateId });
  }
  // A waiver expiring at exactly `now` is treated as already expired, not still valid for one more instant
  // — the same fail-closed direction this whole build already takes for every other boundary condition on
  // a safety-relevant check (`@forge/engine/scheduler`'s own concurrency guards, `Q74`).
  if (Date.parse(waiver.expiresAt) <= now) {
    throw new ForgeError('GATE-505', { gateId: result.gateId, expiresAt: waiver.expiresAt });
  }
  return { ...result, waiver: Object.freeze({ ...waiver }), waiverAppliedAt: now };
}

/** "A gate cannot be approved with a failing deterministic check present, only waived" (`PLAN-M5.md` P14's
 * own Checks text). `GateEvaluationResult`/`Waiver` are plain, publicly-constructible interfaces, the same
 * as every other data shape in this package (`StepNode`, `ConcurrencyLimits`, ...) — nothing brands or
 * seals a value that actually went through `applyWaiver` from one hand-built to look the same, so this
 * function re-checks two things `applyWaiver` already established, rather than trusting `waiver !==
 * undefined` alone (a critic round found the earlier version did exactly that, and a verify round found the
 * fix after it — shape alone — still accepted a hand-built waiver with a dead-on-arrival `expiresAt`, since
 * shape checking alone cannot tell "legitimately applied, now stale" apart from "fabricated with an already-
 * past expiry" without *some* record of when it was supposedly applied):
 *
 * 1. `isWellFormedWaiver` — the same shape check `applyWaiver` itself uses.
 * 2. `expiresAt` was genuinely still in the future *at the moment `waiverAppliedAt` claims it was applied*
 *    — comparing two fields already sealed onto this result against each other, never against a fresh
 *    clock reading of its own. This is deliberately *not* the same as re-checking expiry against the
 *    current time: a legitimately-applied waiver (validated for real, by `applyWaiver`, against the `now`
 *    that evaluation actually happened at) should not have `isApproved`/`buildGateReport` silently start
 *    returning a *different* answer for the exact same, already-finalised result purely because more
 *    wall-clock time has since passed — `10` §10.3's own rule 3 ("gates are re-runnable") already provides
 *    the correct way to get a fresh, currently-accurate answer: evaluate and (re-)waive again, which
 *    naturally re-validates expiry against a fresh `now` at that point.
 *
 * Like every check in this package, this defends against an *honest* mistake (a future piece reviving a
 * persisted report without correctly carrying `waiverAppliedAt` through, or losing it entirely), not a
 * fully adversarial caller: nothing stops someone willing to also fabricate a self-consistent
 * `waiverAppliedAt` by hand, since this module (like the rest of this codebase) uses plain data, not
 * cryptographic sealing. */
export function isApproved(result: GateEvaluationResult): boolean {
  if (result.passed) return true;
  if (result.waiver === undefined || result.waiverAppliedAt === undefined) return false;
  return isWellFormedWaiver(result.waiver) && Date.parse(result.waiver.expiresAt) > result.waiverAppliedAt;
}
