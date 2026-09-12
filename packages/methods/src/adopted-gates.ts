/**
 * `17` §17.4's three brownfield adjustments this piece expresses as data-driven `@forge/methods`
 * gates, rather than a new mechanism of their own: point 1 (conventions observed, not imposed —
 * a convention change needs an ADR plus a migration story), point 3 (characterisation tests before
 * refactoring untested code), and point 4 (the strangler-fig default for new capability in a legacy
 * area, recorded as an ADR each time).
 *
 * `@forge/methods/dod`'s own `evaluateDodProfile` (`09` §9.8, `PLAN-M8.md` P1) is already exactly the
 * open-ended mechanism these three rules need: a `{ check: id }` entry in a project's own DoD profile
 * resolves to whatever boolean a caller-supplied `resolveCheck(id)` returns (`dod/evaluate.ts`'s own
 * doc comment: "resolution is not this module's job"). Building a second, brownfield-specific gate
 * engine would duplicate that mechanism rather than use it. These three functions are exactly the
 * "caller-supplied `resolveCheck`" half for three named ids (`strangler-fig-compliant`,
 * `characterisation-gate`, `convention-change-compliant`) — real, pure, independently testable
 * predicates over plain structured facts, ready for a project's own `dod-profiles.yaml` (an adopted
 * project's own default profile, or an override on an existing one) to reference and a future
 * `forge run`/`forge adopt` integration to resolve against real per-step facts. Wiring one of these
 * ids into a real, shipped default DoD profile, and supplying `resolveCheck` with genuinely live
 * per-step facts at execution time, is real, disclosed, additive scope for a future piece — the
 * identical "a later phase's own job" boundary `SPEC-QUESTIONS.md` Q159 already draws for
 * `verifyConventionFinding`'s own real adherence-ratio recomputation.
 *
 * The one real, already-shipped `resolveCheck` implementation in this codebase today
 * (`packages/cli/src/commands/spec/validate-rules.ts`'s own `validateDefinitionOfReady`) only answers
 * two ids (`spec:story-refs-resolve`, `spec:no-blocking-open-questions`), both derivable from a
 * `Story` plus the KB tree it already loads — confirmed directly, not assumed, before writing this
 * file. None of this file's own three predicates are answerable from that same data: each needs a
 * real fact (whether a component sits in a legacy area, whether a characterisation test exists for
 * it, whether a convention actually changed) that only `forge adopt`'s own GAP ANALYSIS/INVENTORY
 * output or a real test-file-existence check could supply — signal-gathering wiring genuinely outside
 * this piece's own ~400-line budget, not a trivial extension of `validateDefinitionOfReady`'s own
 * `resolveCheck` closure.
 *
 * @see specs/17 §17.4
 * @see specs/09 §9.8
 * @see PLAN-M10.md P20
 */

export interface StranglerFigCandidate {
  /** Whether the story/step under evaluation builds new capability inside an area of the codebase
   * `17` §17.1's own adoption pipeline (or a human) has flagged as legacy/adopted. `false` makes every
   * other field irrelevant — the strangler-fig default only ever applies to this one situation. */
  readonly touchesLegacyArea: boolean;
  /** The new capability is built alongside the old one, switched over behind a flag — "built
   * alongside... rather than modifying in place," `17` §17.4 point 4's own literal wording. */
  readonly builtBehindFlag: boolean;
  /** "recorded as an ADR each time." */
  readonly hasStranglerFigAdr: boolean;
}

/** `true` when `candidate` satisfies `17` §17.4 point 4's own strangler-fig default, or when the
 * default simply does not apply (`touchesLegacyArea: false`) — vacuously compliant, never a fabricated
 * pass dressed up as a real check of something that was never asked for. */
export function stranglerFigCompliant(candidate: StranglerFigCandidate): boolean {
  if (!candidate.touchesLegacyArea) return true;
  return candidate.builtBehindFlag && candidate.hasStranglerFigAdr;
}

export interface CharacterisationGateInput {
  /** Whether this step changes the behaviour of code that (a) is not covered by an existing test and
   * (b) is being refactored (behaviour-preserving change), rather than extended with new behaviour —
   * `17` §17.4 point 3's own precise trigger: "untested code that must change gets tests capturing
   * *current* behaviour first... only then does it change." A step adding new, tested behaviour to
   * untested code is not this situation at all (there is no "current behaviour" worth capturing that
   * the new tests do not already supersede). */
  readonly isUntestedRefactorTarget: boolean;
  /** A real characterisation test (a differential oracle against the pre-refactor behaviour, `13`
   * F-TEST-2 #5) already exists for the code this step is about to change. */
  readonly hasCharacterisationTest: boolean;
}

/** `true` when a characterisation test already exists for an untested-refactor target, or when the
 * gate does not apply at all (`isUntestedRefactorTarget: false`). */
export function characterisationGatePasses(input: CharacterisationGateInput): boolean {
  if (!input.isUntestedRefactorTarget) return true;
  return input.hasCharacterisationTest;
}

export interface ConventionChangeInput {
  /** Whether this step's own generated code deviates from a convention INFERENCE/CARTOGRAPHY already
   * established for the target repository, rather than following it — `17` §17.4 point 1's own
   * trigger: "conventions are observed, not imposed... FORGE's defaults" losing to the repository's
   * own existing pattern is the default; a *change* to that existing pattern is the exceptional case
   * this gate exists to catch. */
  readonly conventionChanged: boolean;
  /** "A convention change is a deliberate ADR..." */
  readonly hasAdr: boolean;
  /** "...plus a migration story..." */
  readonly hasMigrationStory: boolean;
}

/** `true` when a real convention change is backed by both an ADR and a migration story, or when no
 * convention change is happening at all (`conventionChanged: false`) — "never a side-effect of an
 * agent's preference" is enforced by requiring both artifacts to exist, not by this function itself
 * judging whether the change was a good idea. */
export function conventionChangeCompliant(input: ConventionChangeInput): boolean {
  if (!input.conventionChanged) return true;
  return input.hasAdr && input.hasMigrationStory;
}
