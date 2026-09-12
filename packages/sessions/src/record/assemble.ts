/**
 * `assembleSessionRecord` — `16` §16.5's Session record, produced from a `SessionState`.
 *
 * Writes to the already-real `sessionRecordSchema` (`@forge/schemas`) rather than defining a second
 * one: every field this function assembles is `.parse()`-validated against that exact schema before
 * being returned, so a shape that satisfies this function's own return type but not the real schema
 * is impossible by construction, not merely by convention.
 *
 * @see specs/16 §16.5
 * @see PLAN-M10.md P9
 */
import { ForgeError } from '@forge/core';
import { sessionRecordSchema, type SessionRecord } from '@forge/schemas';

import { canComplete } from '../phase-machine/can-complete.ts';
import type { SessionState, SessionStatus } from '../phase-machine/types.ts';

interface ChangelogEntry {
  readonly revision: number;
  readonly date: string;
  readonly by: string;
  readonly summary: string;
}

/** Everything `SessionState` itself cannot supply -- the base front-matter fields `18` §18.6
 * requires of every artifact, plus the two timestamps/cost this piece has no clock of its own to
 * derive `ended`/`cost_usd` from (the caller's own `Clock` and cost meter, both outside this pure
 * package's own dependency edge). */
export interface AssembleSessionRecordMeta {
  readonly id: string;
  readonly title: string;
  readonly author: string;
  readonly schemaVersion: number;
  readonly revision: number;
  /** `YYYY-MM-DD`, per `baseFrontMatterShape`'s own `z.string().date()`. */
  readonly created: string;
  readonly updated: string;
  readonly run?: string | undefined;
  readonly changelog: readonly ChangelogEntry[];
  readonly costUsd: number;
  /** ISO-8601 datetime, per `sessionRecordSchema`'s own `z.string().datetime()`. */
  readonly ended: string;
}

/**
 * `16` §16.8's own breach behaviour takes precedence over the zero-decisions/zero-actions rule when
 * both are true at once (a session the DIVERGE idea cap forced into CONVERGE early, which then
 * genuinely reaches DECIDE with nothing to rule on): `truncated` names the reason a reader actually
 * needs (the bound fired), where `inconclusive` alone would silently drop that this was a forced
 * outcome, not a deliberate one. Neither `16` §16.5 nor §16.8 states this precedence explicitly --
 * this is a recorded decision, not a spec quote. See `SPEC-QUESTIONS.md`.
 */
function resolveStatus(state: SessionState): SessionStatus {
  if (state.truncated) return 'truncated';
  if (state.decisions.length === 0 && state.actions.length === 0) return 'inconclusive';
  return 'complete';
}

/**
 * @throws {ForgeError} `RUN-063` if `state` has not yet passed through FRAME (`state.framing`/
 * `state.startedAt` are unset) -- a programmer-error guard, not a domain refusal (`RECORD` is
 * unreachable in `state.phase` without FRAME already having run), reported through the identical
 * "phase driven out of order" code `SessionPhaseMachine`'s own `assertPhase` already uses.
 * @throws {ForgeError} `RUN-064` if `canComplete(state)` is `false` -- `16` §16.5's own mandatory
 * write-back gate: every decision needs an artifact reference, every action needs an owner, unless
 * the session is explicitly `inconclusive` with a stated reason.
 * @throws {ForgeError} `RUN-066` if the assembled candidate fails `sessionRecordSchema` itself (a
 * malformed `meta` field: a bad `id`, an out-of-format date, a non-positive `revision`, ...) --
 * `state` alone can pass every check above and still produce an invalid record if the caller-supplied
 * `meta` is itself broken, so this function never lets a raw `ZodError` escape uncaught.
 */
export function assembleSessionRecord(
  state: SessionState,
  meta: AssembleSessionRecordMeta,
): SessionRecord {
  if (state.framing === undefined || state.startedAt === undefined) {
    throw new ForgeError('RUN-063', {
      expected: 'DIVERGE, CONVERGE, DECIDE or RECORD',
      actual: state.phase,
    });
  }
  if (!canComplete(state)) {
    throw new ForgeError('RUN-064', { sessionType: state.sessionType });
  }

  const candidate = {
    id: meta.id,
    type: 'SessionRecord' as const,
    sessionType: state.sessionType,
    technique: state.technique,
    question: state.framing.question,
    constraints_applied: state.framing.constraintsApplied,
    participants: state.participants.map((participant) => participant.role),
    started: state.startedAt,
    ended: meta.ended,
    cost_usd: meta.costUsd,
    schemaVersion: meta.schemaVersion,
    title: meta.title,
    status: resolveStatus(state),
    created: meta.created,
    updated: meta.updated,
    revision: meta.revision,
    author: meta.author,
    run: meta.run,
    changelog: meta.changelog,
  };

  const result = sessionRecordSchema.safeParse(candidate);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new ForgeError('RUN-066', { sessionType: state.sessionType, issues });
  }
  return result.data;
}
