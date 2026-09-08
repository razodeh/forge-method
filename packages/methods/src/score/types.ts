/**
 * `EvidenceCell`/`ScoredOption` — `11` §11.0's own execution contract, steps 2-3: "score remaining
 * against criteria with evidence per cell".
 *
 * @see specs/11 §11.0
 * @see PLAN-M6.md M2
 */

export interface EvidenceCell {
  readonly optionId: string;
  readonly criterionId: string;
  readonly score: number;
  readonly evidence: string;
}

export interface ScoredOption {
  readonly optionId: string;
  readonly totalScore: number;
  readonly cells: readonly EvidenceCell[];
  readonly eliminated: boolean;
  readonly eliminatedBy?: string | undefined;
}

/** `applyRules`'s own result: which options a rule's `then.eliminate` disqualified (mapped to the
 * eliminating rule's own `if` condition, for `ScoredOption.eliminatedBy`), and which option the last
 * matching rule's own `then.prefer` named -- `11` §11.0's worked example never has two rules disagree
 * on `prefer`, so "last matching rule wins" is a deliberate, simple default, not a spec requirement. */
export interface RuleResult {
  readonly eliminated: ReadonlyMap<string, string>;
  readonly preferred: string | undefined;
}
