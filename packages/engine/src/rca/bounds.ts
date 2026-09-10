/**
 * `bounds.ts` — F-DEBUG-2's own loop-bounds table, as real, named constants `loop.ts` actually
 * enforces at every phase boundary, never merely documented.
 *
 * @see specs/13 §13.2 F-DEBUG-2
 * @see PLAN-M8.md P8
 */

/** F-DEBUG-2's own table: "Reproduction attempts | 5 | Exit to NEEDS-MORE-EVIDENCE...". */
export const MAX_REPRODUCTION_ATTEMPTS = 5;

/** F-DEBUG-2's own table: "Hypothesis rounds | 3 | Escalate...". One round = a fresh ISOLATE, then
 * propose ≥3 hypotheses and falsify every one; a round where all three survive or all three die
 * returns to ISOLATE for another round (`13` §13.2 step 5's own explicit rule). `loop.ts` also spends
 * this same bound on F-DEBUG-2's own anti-thrash back-edge — a hash-colliding FIX attempt is the
 * *other* real trigger the spec's own diagram draws returning to ISOLATE, not a separately-named
 * bound of its own, so it counts against this one rather than inventing a second, undocumented cap. */
export const MAX_HYPOTHESIS_ROUNDS = 3;

/** F-DEBUG-1 step 4's own explicit "at least three" — a real, enforced minimum, not a should. */
export const MIN_HYPOTHESES = 3;

/** F-DEBUG-2's own table: "Fix attempts | 3 | Revert all fix attempts, restore the lane, escalate —
 * never leave partial fixes". */
export const MAX_FIX_ATTEMPTS = 3;

/** F-DEBUG-2's own table: "Wall clock | 45 min | Checkpoint and escalate". */
export const WALL_CLOCK_MS = 45 * 60 * 1000;

/** A real, disclosed bound beyond F-DEBUG-2's own table: DIAGNOSE's own five-whys stop rule
 * (`13` §13.2 step 6) is condition-based ("continue asking why until the answer is a decision, a
 * missing check, or a wrong assumption"), not depth-based — but a condition an injected fake session
 * never actually satisfies would loop the engine forever with no bound at all. "Five whys" is itself
 * the spec's own literal name for the technique; capping the real loop at five rounds turns the name
 * into a real, enforced ceiling rather than leaving the condition-based loop genuinely unbounded. */
export const MAX_WHYS = 5;
