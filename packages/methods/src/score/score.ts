/**
 * `score`/`killerRisk` — `11` §11.0's own execution contract, steps 2-3: "score remaining against
 * criteria with evidence per cell → produce a ranked recommendation with the top option's own killer
 * risk stated".
 *
 * @see specs/11 §11.0
 * @see PLAN-M6.md M2
 */
import type { FrameworkDefinition } from '../schema/types.ts';
import type { EvidenceCell, ScoredOption } from './types.ts';

/** Pure weighted sum over every declared option, eliminated or not: an eliminated option is never
 * ranked above a non-eliminated one (`11` §11.0 step 2 only ever *ranks* "remaining" options) and sorts
 * last regardless of its own `totalScore`, but that score is still the real weighted sum of whatever
 * evidence cells it has -- zeroing it would discard real, already-computed evidence (an option can be
 * eliminated by a `rules[].if` condition unrelated to how well it otherwise scores) and would make an
 * ADR's own comparison table unable to show "would have scored well but is disqualified" versus
 * "genuinely scored poorly".
 *
 * A criterion with no matching cell for a given option contributes `0` to that option's own sum rather
 * than erroring -- deliberately lenient, unlike the blank-evidence check below, since `score` may be
 * called on a framework being scored incrementally, before every cell exists yet. */
export function score(
  framework: FrameworkDefinition,
  cells: readonly EvidenceCell[],
  eliminated: ReadonlyMap<string, string> = new Map(),
): readonly ScoredOption[] {
  const criteria = framework.criteria ?? [];
  const cellsByOption = new Map<string, EvidenceCell[]>();
  for (const cell of cells) {
    // Throws rather than returning a discriminated result (unlike `loadFramework`'s own
    // `FrameworkParseResult`): a blank-evidence cell here is a caller-assembled-data bug in the piece
    // that produced `cells` (M3's own orchestration, or a hand-built fixture), not raw, untrusted YAML
    // a human hand-edited -- the same "structural/config error, not runtime data" split this codebase
    // uses elsewhere for a caller-contract violation versus ordinary malformed external input.
    if (cell.evidence.trim().length === 0) {
      throw new Error(
        `evidence cell for option "${cell.optionId}", criterion "${cell.criterionId}" has no evidence -- ` +
          `11 §11.0's "with evidence per cell" is load-bearing, not decorative.`,
      );
    }
    const existing = cellsByOption.get(cell.optionId);
    if (existing === undefined) cellsByOption.set(cell.optionId, [cell]);
    else existing.push(cell);
  }

  const scored = framework.options.map((option): ScoredOption => {
    const isEliminated = eliminated.has(option.id);
    const optionCells = cellsByOption.get(option.id) ?? [];
    const totalScore = criteria.reduce((sum, criterion) => {
      const cell = optionCells.find((candidate) => candidate.criterionId === criterion.id);
      return sum + (cell === undefined ? 0 : cell.score * criterion.weight);
    }, 0);

    return {
      optionId: option.id,
      totalScore,
      cells: optionCells,
      eliminated: isEliminated,
      eliminatedBy: eliminated.get(option.id),
    };
  });

  return [...scored].sort((a, b) => {
    if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
    return b.totalScore - a.totalScore;
  });
}

/** The lowest-scoring criterion cell for `topOption` -- `11` §11.0's own "the top option's own killer
 * risk stated". `topOption` should never itself be eliminated (a caller ranking by `score`'s own output
 * and taking the first entry already guarantees this whenever any non-eliminated option exists), but
 * this function does not re-check that on its own -- it simply has nothing to report for an option with
 * no evidence cells at all. */
export function killerRisk(
  topOption: ScoredOption,
  framework: FrameworkDefinition,
): string | undefined {
  const criterionIds = new Set((framework.criteria ?? []).map((criterion) => criterion.id));
  const relevantCells = topOption.cells.filter((cell) => criterionIds.has(cell.criterionId));
  if (relevantCells.length === 0) return undefined;

  const lowest = relevantCells.reduce((worst, cell) => (cell.score < worst.score ? cell : worst));

  return `${lowest.criterionId} (score ${String(lowest.score)}): ${lowest.evidence}`;
}
