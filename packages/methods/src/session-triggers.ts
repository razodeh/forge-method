/**
 * `SESSION_TRIGGERS` — the real, evaluable trigger conditions behind `16` §16.6's own four *triggered*
 * (not unconditional) built-in session placements: `standup` "on long runs (triggered by elapsed time
 * or blocked-lane count)", `premortem` "at L3+", and `war-room` "on Sev1". Each is written in this
 * package's own `./expr.ts` grammar (dotted-path access, `==`/`!=`/ordering comparisons, `&&`/`||`/`!`)
 * — the same closed grammar `11` §11.0's own `rules[].if` already uses — over field names chosen to
 * mirror what a real run's own read model conceptually tracks: `run.elapsedMs` and
 * `run.blockedLaneCount` correspond to `@forge/tui`'s own `RunReadModel` (`stepStatuses`/`laneStatuses`,
 * `packages/tui/src/state/run-read-model.ts`) once elapsed wall-clock time and a "how many lanes are
 * stuck" count are derived from it (neither is a field that read model tracks *today*, only concepts a
 * caller could compute from the event log it already reduces over — `RunReadModel` has no timestamp or
 * lane-blocked-status field yet); `level` mirrors `@forge/methods/level`'s own resolved project level;
 * `severity` mirrors a real `Defect` artifact's own severity field.
 *
 * `PLAN-M10.md` P14's own explicit scope: this piece adds a real, *evaluable* trigger — proven by
 * `evaluateSessionTrigger` below, which is the exact same `evaluateCondition` this package's own
 * `applyRules` (`score.ts`) already trusts for real framework rule conditions, not a bespoke or weaker
 * evaluator — carried onto each `kind: 'session'` step's own `when` field
 * (`@forge/engine/workflow`'s own `SessionStep.when`). It does **not** wire that condition into the
 * scheduler's own dispatch decision: no per-step conditional-inclusion or conditional-dispatch mechanism
 * exists anywhere in `@forge/engine` today (confirmed directly against `compilePlan`/`scheduler/*.ts` —
 * `workflow.levels` gates a whole workflow, never one step), and building one is a real, separate,
 * cross-cutting scheduler feature outside this piece's own `packages/methods/src` surface. A future
 * scheduler piece that actually evaluates `StepNode.when` against a real, elapsed-time- and
 * blocked-lane-count-carrying read model can reuse `evaluateSessionTrigger` unchanged — the expression
 * and its evaluator are already real; only the runtime wiring remains.
 *
 * @see specs/16 §16.6
 * @see PLAN-M10.md P14
 * @see SPEC-QUESTIONS.md Q165
 */
import { evaluateCondition, parseExpression } from './expr.ts';

/** The four `16` §16.6 placements whose own placement table cell names a real trigger condition rather
 * than "always" — `discovery-interview`/`brainstorm`/`story-refinement`/`tradeoff`/`design-review`/
 * `estimation`/`retro` all run unconditionally wherever they are placed, so they have no entry here. */
export type TriggeredSessionPlacement = 'premortem' | 'standup' | 'war-room';

/** One `SESSION_TRIGGERS` entry per triggered placement, plus a human-readable `reason` restating `16`
 * §16.6's own placement-table cell — kept alongside the expression so a workflow author (or this
 * piece's own tests) can confirm the expression actually says what the spec table claims it says,
 * without re-deriving it from the raw string. */
export interface SessionTrigger {
  readonly expression: string;
  readonly reason: string;
}

export const SESSION_TRIGGERS: Readonly<Record<TriggeredSessionPlacement, SessionTrigger>> = {
  premortem: {
    expression: "level == 'L3' || level == 'L4'",
    reason: '16 §16.6: premortem at L3+',
  },
  standup: {
    expression: 'run.elapsedMs > 3600000 || run.blockedLaneCount >= 2',
    reason:
      '16 §16.6: standup on long runs, triggered by elapsed time (>1h) or blocked-lane count (>=2)',
  },
  'war-room': {
    expression: "defect.severity == 'Sev1'",
    reason: '16 §16.6: war-room on Sev1',
  },
} as const;

/** Every `SESSION_TRIGGERS` entry parses as a well-formed expression in this package's own grammar —
 * asserted once, eagerly, at module load, rather than left to be discovered only if some future caller
 * happens to call `evaluateSessionTrigger`: a placeholder or malformed string here would otherwise sit
 * silently unused, the exact "not a placeholder" failure mode `PLAN-M10.md` P14 explicitly calls out. */
for (const [placement, trigger] of Object.entries(SESSION_TRIGGERS)) {
  if (parseExpression(trigger.expression) === undefined) {
    throw new Error(
      `SESSION_TRIGGERS["${placement}"].expression does not parse as a well-formed expression: ${trigger.expression}`,
    );
  }
}

/** Evaluates `placement`'s own real trigger condition against `context` — the same `evaluateCondition`
 * this package's own framework-rule engine (`score.ts`'s `applyRules`) already trusts for real
 * conditions, not a separate or weaker evaluator built just for this. */
export function evaluateSessionTrigger(
  placement: TriggeredSessionPlacement,
  context: Readonly<Record<string, unknown>>,
): boolean {
  return evaluateCondition(SESSION_TRIGGERS[placement].expression, context);
}
