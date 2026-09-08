/**
 * `scoreCandidate` -- `12` §12.3 step 3: "Score on weighted criteria: fit-to-requirements, team
 * familiarity, ecosystem maturity, operational burden, hiring/AI-support (how well-represented in
 * training data -- a real factor for agent-driven development), cost, exit cost, `agent_friendliness`."
 *
 * `12` §12.3 names these criteria but gives no scoring algorithm or weights -- a real, invented
 * resolution of that spec silence, recorded here and in `SPEC-QUESTIONS.md` rather than guessed
 * silently. Two real gaps between the spec's own eight named criteria and what `CatalogEntry` (C1)
 * actually carries:
 *
 * - **"hiring/AI-support"** and the separately-listed **`agent_friendliness`** both describe, in
 *   substance, the same underlying idea the spec's own parenthetical names ("how well an AI agent can
 *   work with it... a real factor for agent-driven development") -- `CatalogEntry` has exactly one field
 *   for this, `agent_friendliness`. Rather than double-count one stored field under two different named
 *   criteria (which is equivalent to silently doubling its weight without saying so), this scores it
 *   once, at the combined weight both spec bullets together imply.
 * - **"cost"** has no corresponding `CatalogEntry` field at all -- C1's schema carries no price/cost
 *   data, and no catalog piece (C2-C4) added one. Fabricating a cost signal from an unrelated field
 *   (e.g. inferring it from `operational_burden`) would be a fictitious number dressed as real data.
 *   This criterion is named in the weight table below at weight `0` (not silently dropped from the
 *   type/API, so a future piece adding real cost data to the schema has an obvious place to wire it in)
 *   with the omission stated plainly, not hidden.
 */
import type { CatalogBurdenLevel, CatalogEntry, CatalogMaturity } from '../schema/types.ts';
import type { StackSelectionInput } from './types.ts';

/** `CatalogBurdenLevel` is reused by four `CatalogEntry` fields with two *opposite* polarities:
 * `operational_burden`/`exit_cost` are "low is good" (a low-burden, low-exit-cost technology scores
 * high), while `team_familiarity_weight`/`agent_friendliness` are "high is good" (a highly-familiar,
 * highly-agent-friendly technology scores high). Using one shared low-is-good table for all four --
 * this file's own first-draft bug, caught by its own tests scoring 'high' `agent_friendliness` *lower*
 * than 'low' -- silently inverted two of the four criteria. Two separate tables, one per real polarity. */
const LOW_IS_GOOD_SCORE: Readonly<Record<CatalogBurdenLevel, number>> = {
  low: 1,
  medium: 0.5,
  high: 0,
};

const HIGH_IS_GOOD_SCORE: Readonly<Record<CatalogBurdenLevel, number>> = {
  high: 1,
  medium: 0.5,
  low: 0,
};

const MATURITY_SCORE: Readonly<Record<CatalogMaturity, number>> = {
  mature: 1,
  growing: 0.75,
  emerging: 0.5,
  legacy: 0.2,
  declining: 0,
};

/** The relative weight given to each real, available signal. Fit-to-requirements is weighted highest,
 * matching `12` §12.3's own ordering (it's named first, and is the only criterion that varies per
 * `StackSelectionInput` rather than being a fixed property of the entry). `cost` is `0`, per this file's
 * own doc comment above. Weights need not sum to `1` -- `scoreCandidate`'s own return value is a relative
 * ranking score across candidates of the same kind, not a normalized probability. */
const WEIGHTS = {
  fitToRequirements: 3,
  teamFamiliarity: 1,
  ecosystemMaturity: 1,
  operationalBurden: 1,
  agentFriendliness: 2, // covers both "hiring/AI-support" and "agent_friendliness" -- see doc comment
  cost: 0,
  exitCost: 1,
} as const;

/** A dotted-path-free, deliberately simple fit heuristic: how many of the input's own
 * `architectureStyle`/`accessPatterns`/`nfrs` words appear (case-insensitive substring match) inside any
 * of the entry's own `fits_when` strings, normalized to `[0, 1]` by the number of input signals checked.
 * `12` §12.3 gives no algorithm for this criterion either -- this is the simplest defensible one, given
 * `fits_when` is free-text prose, not structured data a more precise match could key off. */
function scoreFitToRequirements(entry: CatalogEntry, input: StackSelectionInput): number {
  const signals = [input.architectureStyle, ...input.accessPatterns, ...input.nfrs]
    .map((signal) => signal.toLowerCase())
    .filter((signal) => signal.length > 0);
  if (signals.length === 0) return 0;

  const fitsWhenText = entry.fits_when.join(' ').toLowerCase();
  const matched = signals.filter((signal) => fitsWhenText.includes(signal)).length;
  return matched / signals.length;
}

/** `constraints.teamSkills` boosts `team_familiarity_weight` when the entry's own `id`/`name` is named
 * as a real, explicit skill -- otherwise the catalog's own stored weight is used as-is. */
function scoreTeamFamiliarity(entry: CatalogEntry, input: StackSelectionInput): number {
  const base = HIGH_IS_GOOD_SCORE[entry.team_familiarity_weight];
  const named = input.constraints.teamSkills.some(
    (skill) =>
      skill.toLowerCase() === entry.id.toLowerCase() ||
      skill.toLowerCase() === entry.name.toLowerCase(),
  );
  return named ? 1 : base;
}

/** The weighted sum across every real, available criterion -- `12` §12.3 step 3, resolved per this
 * file's own doc comment. Pure and deterministic (R10): identical `entry`/`input` always produce the
 * identical score. */
export function scoreCandidate(entry: CatalogEntry, input: StackSelectionInput): number {
  return (
    WEIGHTS.fitToRequirements * scoreFitToRequirements(entry, input) +
    WEIGHTS.teamFamiliarity * scoreTeamFamiliarity(entry, input) +
    WEIGHTS.ecosystemMaturity * MATURITY_SCORE[entry.maturity] +
    WEIGHTS.operationalBurden * LOW_IS_GOOD_SCORE[entry.operational_burden] +
    WEIGHTS.agentFriendliness * HIGH_IS_GOOD_SCORE[entry.agent_friendliness] +
    WEIGHTS.exitCost * LOW_IS_GOOD_SCORE[entry.exit_cost]
  );
}
