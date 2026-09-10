/**
 * The cost ledger: `18` §18.5's abridged `ledger` table, projected from the `Cost` event group
 * (`18` §18.4) rather than written independently — "if a value cannot be derived from the log, it does
 * not exist." Plus the pure decision functions `20` §20.8's enforcement points and runaway detection are
 * built from; the actual admission/pause/abort *response* to what these functions decide belongs to
 * `@forge/engine`'s own budget piece (`PLAN-M5.md` P17), a capability this package cannot reach yet
 * (`SPEC-QUESTIONS.md` Q62's forward-dependency shape).
 *
 * `18` §18.4's own catalogue names `UsageRecorded`/`BudgetWarning`/`BudgetBreached` but gives no payload
 * shape for any of them — unlike `ForgeEvent`'s envelope fields, entirely this piece's own design.
 *
 * @see specs/06 §6.9
 * @see specs/18 §18.4
 * @see specs/18 §18.5
 * @see specs/20 §20.8
 * @see specs/20 §20.10 S9
 * @see PLAN-M5.md P7
 */
import { TelemetryError } from './errors.ts';
import type { ForgeEvent } from './events.ts';

/** The abridged row shape from `18` §18.5's `ledger` table (`run_id, step_id, agent, model, platform,
 * input_tokens, output_tokens, cache_read_tokens, cost_usd, estimated, duration_ms, ts`), camelCased.
 * `runId`/`ts` come from a `UsageRecorded` event's own envelope fields; the rest from its payload — see
 * `UsageRecordedPayload`. */
export interface LedgerEntry {
  readonly runId: string;
  readonly stepId: string;
  readonly agent: string;
  readonly model: string;
  readonly platform: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly costUsd: number;
  /** `07` §7.3: adapter-reported figures are client-side estimates, never presented as an invoice —
   * `20` §20.8 requires every ledger row to say which one it is. */
  readonly estimated: boolean;
  readonly durationMs: number;
  readonly ts: string;
}

/** A `UsageRecorded` event's own payload — everything a `LedgerEntry` needs beyond what the `ForgeEvent`
 * envelope (`runId`, `stepId`, `agentId`, `ts`) already carries. `agentId`/`stepId` are optional on
 * `ForgeEvent` in general (not every event concerns a specific step or agent), but a `UsageRecorded`
 * event without either is meaningless for a ledger whose entire point is attributing spend — treated as
 * malformed, the same "shape check as a corruption defense" stance `events.ts`'s own `parseEventLine`
 * takes, not a silently-dropped or zero-filled row. */
export interface UsageRecordedPayload {
  readonly model: string;
  readonly platform: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly costUsd: number;
  readonly estimated: boolean;
  readonly durationMs: number;
}

/** A bare `typeof x === 'number'` accepts `NaN`, `Infinity`, and negative values — confirmed empirically
 * that a negative `costUsd` (two real, JSON-round-tripped events netting a step's `attributedSpend`
 * *below* what was actually spent) or a `NaN` one (poisoning a sum: `15 + NaN = NaN`) both make
 * `checkBudget`'s own `>=` comparisons fail closed to `'ok'`, since every relational comparison against
 * `NaN` is `false` — a silent budget-enforcement bypass, not a rounding nicety, for exactly the fields
 * `20` §20.8/S9 need to be trustworthy. None of `inputTokens`/`outputTokens`/`cacheReadTokens`/`costUsd`/
 * `durationMs` has a sensible negative domain for one real, single `UsageRecorded` event (a correction or
 * refund would be a new event, not a negative figure on this one), so this rejects both problems with one
 * check, reused for every numeric field here and in `detectRunaway`'s own input below. */
function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** A syntactically valid, present string can still carry no real information — confirmed this applies
 * not just to the empty string but to a whitespace-only one too (`'   '`), which `.trim()` reduces to
 * empty. Used for every string field this module treats as a meaningful identifier (`model`, `platform`
 * below, `stepId`/`agentId` in `toLedgerEntry`) — none of the four is useful blank, for the same
 * "meaningless for a ledger whose entire point is attributing spend" reasoning throughout. Also
 * correctly rejects `undefined` (fails the `typeof` check), so `toLedgerEntry` needs no separate
 * `=== undefined` check alongside it. */
function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isUsageRecordedPayload(value: unknown): value is UsageRecordedPayload {
  if (typeof value !== 'object' || value === null) return false;
  const payload = value as Record<string, unknown>;
  return (
    isNonBlankString(payload['model']) &&
    isNonBlankString(payload['platform']) &&
    isFiniteNonNegativeNumber(payload['inputTokens']) &&
    isFiniteNonNegativeNumber(payload['outputTokens']) &&
    isFiniteNonNegativeNumber(payload['cacheReadTokens']) &&
    isFiniteNonNegativeNumber(payload['costUsd']) &&
    typeof payload['estimated'] === 'boolean' &&
    isFiniteNonNegativeNumber(payload['durationMs'])
  );
}

function toLedgerEntry(event: ForgeEvent): LedgerEntry {
  if (
    !isNonBlankString(event.stepId) ||
    !isNonBlankString(event.agentId) ||
    !isUsageRecordedPayload(event.payload)
  ) {
    throw new TelemetryError({
      code: 'TELEMETRY-LEDGER-MALFORMED-USAGE-EVENT',
      message: `A "UsageRecorded" event (run "${event.runId}", seq ${String(event.seq)}) is missing/blank stepId or agentId, or has a malformed payload — cannot project it into a ledger entry.`,
      remedy:
        'Ensure every UsageRecorded event is appended with a non-blank stepId, agentId, and a well-formed usage payload.',
    });
  }
  return {
    runId: event.runId,
    stepId: event.stepId,
    agent: event.agentId,
    model: event.payload.model,
    platform: event.payload.platform,
    inputTokens: event.payload.inputTokens,
    outputTokens: event.payload.outputTokens,
    cacheReadTokens: event.payload.cacheReadTokens,
    costUsd: event.payload.costUsd,
    estimated: event.payload.estimated,
    durationMs: event.payload.durationMs,
    ts: event.ts,
  };
}

/** A pure projection: every `UsageRecorded` event becomes one row, in the order read; every other event
 * type (including `BudgetWarning`/`BudgetBreached` — themselves projections of `checkBudget`'s own
 * decision, not additional ledger rows) is not ledger content and is skipped. Takes `AsyncIterable`, not
 * a concrete array, so a caller can pass `readEvents(...)` directly with no intermediate buffering. */
export async function projectLedger(
  events: AsyncIterable<ForgeEvent>,
): Promise<readonly LedgerEntry[]> {
  const entries: LedgerEntry[] = [];
  for await (const event of events) {
    if (event.type !== 'UsageRecorded') continue;
    entries.push(toLedgerEntry(event));
  }
  return entries;
}

/** `20` §20.8's own "reports $6, not $2" rule: every entry for `stepId`, across every retry, summed —
 * never just the latest attempt. */
export function attributedSpend(entries: readonly LedgerEntry[], stepId: string): number {
  return entries
    .filter((entry) => entry.stepId === stepId)
    .reduce((sum, entry) => sum + entry.costUsd, 0);
}

export interface BudgetCheckInput {
  readonly spent: number;
  readonly cap: number;
  /** Fraction of `cap` at which spend first becomes a `'warning'` rather than `'ok'`. Not given anywhere
   * in the spec pack (only the boundary-at-breach rule is stated) — a caller-supplied, documented
   * default rather than a value silently hardcoded with no way for a project to tune it, the same
   * "the caller decides the actual policy value, this function only applies it" shape as `redactPayload`'s
   * own `knownSecrets` parameter. 0.8 is this piece's own default, chosen as a conventional "getting
   * close" threshold with no spec citation behind the specific number. Must be in `(0, 1]`: at or below
   * `0` every spend would immediately warn, and above `1` the boundary is never reachable at all (the
   * breach check above it always fires first) — silently, with no error, if left unchecked. */
  readonly warningThreshold?: number;
}

/** The pure decision function `20` §20.8's three enforcement *levels* (step/run/period) each call with a
 * different `spent`/`cap` pair — the actual admission decision and pause/finish-lanes/abort response is
 * `@forge/engine` P17's own job, this function only classifies. The cap boundary itself is `'breached'`,
 * never `'ok'`: `PLAN-M5.md` P7's own Checks section calls out off-by-one here as "a real financial bug,"
 * not a rounding nicety. Validates its own inputs rather than trusting the caller: `spent`/`cap` are the
 * one safety decision `S9` rests on, and — unlike a typical internal helper — at least one of them
 * (`cap`) can originate straight from project config this package has no visibility into, with no JSON
 * round-trip or other boundary already guaranteeing it is a sane number by the time it gets here. */
export function checkBudget({
  spent,
  cap,
  warningThreshold = 0.8,
}: BudgetCheckInput): 'ok' | 'warning' | 'breached' {
  if (!isFiniteNonNegativeNumber(spent) || !isFiniteNonNegativeNumber(cap)) {
    throw new TelemetryError({
      code: 'TELEMETRY-BUDGET-INVALID-INPUT',
      message: `checkBudget requires finite, non-negative spent/cap values; got spent=${String(spent)}, cap=${String(cap)}.`,
      remedy:
        'Ensure the ledger sum and the configured budget cap are both real, non-negative numbers before calling checkBudget.',
    });
  }
  if (!Number.isFinite(warningThreshold) || warningThreshold <= 0 || warningThreshold > 1) {
    throw new TelemetryError({
      code: 'TELEMETRY-BUDGET-INVALID-INPUT',
      message: `checkBudget requires warningThreshold in (0, 1]; got ${String(warningThreshold)}.`,
      remedy: 'Pass a warningThreshold greater than 0 and at most 1, such as the default 0.8.',
    });
  }
  if (spent >= cap) return 'breached';
  if (spent >= cap * warningThreshold) return 'warning';
  return 'ok';
}

/** One attempt's worth of the two signals `detectRunaway` needs — deliberately not `LedgerEntry` itself:
 * `18` §18.5's own DB schema has no "did this attempt make progress" column, and none should be added to
 * match a fixed, spec-given schema just for this one check. `totalTokens` is intentionally a single,
 * caller-pre-summed number (not separate input/output/cache-read fields) since this function only cares
 * about one growing quantity — exactly which components a caller sums into it is their own call.
 * `progressed` — "a file changed or an artifact was produced on this attempt" (`20` §20.8) — is derived
 * by the caller from the same run's own `Artifact*`/`KbWritten` events already in `18` §18.4's catalogue;
 * per `PLAN-M5.md` P7's own mandate, "no new event type needed," this deliberately isn't one either. */
export interface RetryAttempt {
  readonly totalTokens: number;
  readonly progressed: boolean;
}

/** `20` §20.8's runaway-detection requirement: token consumption growing monotonically across retries
 * with no accompanying progress. `attempts` must already be every attempt for one step, in chronological
 * order — this function does no filtering or sorting of its own, matching the minimal-surface shape of
 * `checkBudget` above. Requires at least three attempts (the original plus two retries) before ever
 * firing: a single retry costing more than the first attempt is ordinary variance, not yet a suspected
 * loop — this threshold has no spec citation behind the specific number either, the same kind of
 * self-imposed default `checkBudget`'s own `warningThreshold` is. Any progress *anywhere* in the given
 * window suppresses the signal entirely, not just progress on the latest attempt — a caller that wants
 * the check to "reset" after a progressing attempt achieves that by only passing attempts since the last
 * one that progressed, not by this function tracking that itself.
 *
 * Validates every `totalTokens` up front, before any other logic: confirmed empirically that a single
 * `NaN` sandwiched between two real, *decreasing* values (`500, NaN, 100`) made the naive monotonic-
 * growth loop report a runaway anyway — every relational comparison against `NaN` is `false`, so the
 * loop's own "did this decrease" bail-out silently never fires for the pair straddling it. Throwing
 * instead of returning `false` (the direction `NaN` happens to bias toward) treats corrupt caller data
 * as its own explicit error, the same choice `checkBudget` above makes for the identical underlying
 * problem, rather than risk a *different* corruption shape someday biasing the other, unsafe way. */
export function detectRunaway(attempts: readonly RetryAttempt[]): boolean {
  const MIN_ATTEMPTS_TO_DETECT = 3;
  for (const attempt of attempts) {
    if (!isFiniteNonNegativeNumber(attempt.totalTokens)) {
      throw new TelemetryError({
        code: 'TELEMETRY-LEDGER-INVALID-NUMBER',
        message: `detectRunaway requires every attempt's totalTokens to be a finite, non-negative number; got ${String(attempt.totalTokens)}.`,
        remedy:
          'Ensure every RetryAttempt.totalTokens is a real, non-negative number before calling detectRunaway.',
      });
    }
  }
  if (attempts.length < MIN_ATTEMPTS_TO_DETECT) return false;
  if (attempts.some((attempt) => attempt.progressed)) return false;
  let previousTokens: number | undefined;
  for (const attempt of attempts) {
    if (previousTokens !== undefined && attempt.totalTokens <= previousTokens) return false;
    previousTokens = attempt.totalTokens;
  }
  return true;
}
