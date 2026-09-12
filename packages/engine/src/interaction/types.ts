/**
 * Types for `@forge/engine/interaction` — the real, empirically-resolved mechanism `PLAN-M6.md`'s own
 * top-level open design question asks piece A6 to settle: `pair`/`panel`/`debate`/`swarm-review` need a
 * small, additive extension to this already-committed M5 package (`@forge/engine/dispatch`), not
 * something `@forge/agents` alone can drive — `@forge/agents` has no boundary-graph edge to
 * `@forge/engine` at all (`02` §2.2: `agents ← core, kb, schemas, adapter-kit, templates, extensions`,
 * no `engine`), while `engine ← ... agents` already runs the other way. See `SPEC-QUESTIONS.md` Q104
 * for the full resolution record.
 *
 * @see specs/05 §5.7
 * @see specs/10 §10.1
 * @see SPEC-QUESTIONS.md Q104
 * @see PLAN-M6.md A6
 */
import type { SessionResult } from '@forge/adapter-kit';

import type { StepOutcome } from '../dispatch/types.ts';

/** F-REVIEW-1's own real three-level scale — "each perspective... produces findings at `blocking` /
 * `major` / `minor`," `13` §13.3's own literal wording. */
export type ReviewSeverity = 'blocking' | 'major' | 'minor';

/** One finding a single perspective's own review session reported, per `10` §10.1's own worked
 * `swarm-review` example. `perspectives` lists every perspective that independently reported an
 * identical `summary` — the real de-duplication `05` §5.7's own "one real, de-duplicated ReviewReport
 * merging every perspective" describes: two perspectives raising the same concern become one finding
 * with two attributions, not two separate findings a reader has to notice are the same thing.
 * `severity` on a merged, multi-perspective finding is the *more severe* of every perspective's own
 * real rating for that identical summary — `PLAN-M8.md` P10's own real, deliberate policy: requiring
 * every perspective to agree on a severity before it counts would silently drop a legitimate
 * more-severe report the moment even one other perspective rated the same real concern lower;
 * under-reporting severity is the one failure mode that actually matters here (`13` §13.3's own
 * "blocking findings must be resolved" — a downgraded blocking finding is a real gate escaping its
 * own gate, an upgraded minor one is merely a human double-checking something that was already fine). */
export interface ReviewFinding {
  readonly summary: string;
  readonly severity: ReviewSeverity;
  readonly perspectives: readonly string[];
}

export interface ReviewReport {
  readonly perspectives: readonly string[];
  readonly findings: readonly ReviewFinding[];
}

/** One non-primary session a multi-session mode drove — a panelist's own independent answer, a debate
 * round's proposer/critic turn, or one swarm-review perspective's own raw session (before its findings
 * were folded into `InteractionOutcome.reviewReport`). Kept alongside the primary `outcome` rather than
 * discarded once merged, so a caller/test can inspect exactly how many real sessions ran and what each
 * one said — `05` §5.7's own Checks text ("a fixture proving the chosen mechanism actually drives more
 * than one real session/perspective for one logical step") needs this to be a real, inspectable list,
 * not only provable indirectly through the merged result. */
export interface InteractionParticipant {
  readonly role: string;
  readonly session: SessionResult;
}

/**
 * `dispatchAgentStep`'s own return type — a deliberate deviation from `PLAN-M6.md` A6's own literal
 * `Promise<StepOutcome>` Surface text, recorded here rather than silently: `solo`/`fan-out`/`relay`
 * genuinely need nothing more than the existing `StepOutcome` (and `dispatchAgentStep` returns exactly
 * that, wrapped, for those three modes — no behavioural change from delegating straight to
 * `runAgentStep`), but `panel`/`debate`/`swarm-review` drive more than one real session per logical
 * step and produce data (`reviewReport`, the panelist/round-by-round record) `StepOutcome`'s own
 * already-committed, closed `StepOutcomeDetail` union (`@forge/engine/dispatch`, M5) has no field for —
 * extending that closed union itself would be the "small additive extension" the plan's own preamble
 * anticipates, but every one of its six variants is real, already-tested M5 content this piece has no
 * reason to touch. Wrapping instead keeps `outcome` exactly what every existing `StepOutcome` consumer
 * (P12's `Scheduler`, P16's `classifyFailure`) already expects unchanged, while giving the genuinely new
 * multi-session data its own, honestly-optional home.
 */
export interface InteractionOutcome {
  readonly outcome: StepOutcome;
  readonly participants?: readonly InteractionParticipant[];
  readonly reviewReport?: ReviewReport;
}

export interface DispatchAgentStepOptions {
  /** `panel`/`swarm-review` only — `10` §10.1's own worked `perspectives: [design, security, testing,
   * performance]` field. Required for those two modes (`RUN-046` if absent); ignored otherwise. */
  readonly perspectives?: readonly string[];
  /** `debate` only — `05` §5.7's own "≤3 rounds." Defaults to 3; a caller may lower it, never raise it
   * past 3 (clamped), since `05` §5.7's own table gives 3 as the hard ceiling, not a mere default. */
  readonly maxDebateRounds?: number;
  /** `swarm-review` only — F-REVIEW-2's own "a reviewer may not approve a change it authored (`CFG-
   * 501`)," the runtime half of that compile-time invariant. `dispatchAgentStep` itself never resolves
   * a step's own inputs (`review.ts`'s own doc comment has the fuller reasoning) and cannot determine
   * on its own which real commit — or which agent(s) authored it — the diff under review even came
   * from; whichever caller *does* know that (`forge review`'s own `reviewChange`, reading real commit
   * trailers against the real diff range it was given) supplies it here. Plural, not singular: a fresh
   * critic round reproduced directly that a real merge commit (`@forge/vcs`'s own merge queue, `06`
   * §6.7) can genuinely carry more than one real agent's own work — a multi-lane merge step processes
   * several lanes into one merge commit at once, and the merge commit's own message never carries a
   * `Co-Authored-By` trailer itself (only `Forge-Step`/`Forge-Run`); the real authorship lives on each
   * merged-in lane's own tip commit instead. Refused if the reviewing agent's own id appears *anywhere*
   * in this list. Omitted entirely — not merely an empty array — means this specific call site has no
   * way to know, and no check runs; a real, disclosed non-goal for a caller in that position
   * (`SPEC-QUESTIONS.md`), not a silent gap. */
  readonly authoringAgentIds?: readonly string[];
  /** `debate` only — `16` §16.7 point 3's own `steel-man-debate` requirement ("each side to state the
   * opposing case convincingly before its own"): when set, round 1's proposer AND critic prompts both
   * embed this exact text and both require stating the opposing side's case first, as round 1's own
   * required content. The caller supplies the real technique's own prompt text (`@forge/sessions`'s
   * `loadTechnique(modulesDir, 'steel-man-debate')`) rather than this dispatch layer inventing generic
   * instruction text of its own — real, technique-driven sequencing, not a hard-coded assumption about
   * what "steel-man" means. Ignored on round 2 onward and ignored entirely for every other mode. */
  readonly steelManRequirement?: string;
}
