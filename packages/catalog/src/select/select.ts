/**
 * `selectStack` -- `12` §12.3's own five-step procedure, run end to end against a real, populated
 * `CatalogRegistry`.
 *
 * @see specs/12 §12.3
 * @see specs/12 §12.4
 * @see PLAN-M6.md C5
 */
import type { CatalogEntry } from '../schema/types.ts';
import type { CatalogRegistry } from '../registry/registry.ts';
import { scoreCoherence } from './coherence.ts';
import { scoreCandidate } from './criteria.ts';
import { filterByConstraints } from './filter.ts';
import { evaluateHardRules, isMandated } from './hard-rules.ts';
import type {
  ChosenEntry,
  RemovedCandidate,
  StackSelectionInput,
  StackSelectionResult,
} from './types.ts';

/** The `kind` values `selectStack` decides one winner for -- `12` §12.4's own worked example's eight ADR
 * lines, mapped onto real catalog kinds (a `language` and a `framework` line combine into one ADR in that
 * worked example's own prose, e.g. "TypeScript + Fastify", but this piece's own catalog treats them as
 * two separate kinds/entries, so they are two separate slots here). `12` §12.3 gives no explicit list of
 * which kinds a selection run must decide -- this is this piece's own invented, documented resolution of
 * that spec silence, scoped to the kinds a typical backend-service stack actually needs a decision for;
 * not every one of the catalog's 18 kinds is relevant to every project (e.g. `mobile` rarely applies to a
 * pure backend service), so `selectStack` does not attempt to decide all 18 -- a kind this list omits
 * simply has no `ChosenEntry` in the result, not a fabricated or forced one. */
const CORE_KINDS = [
  'language',
  'framework',
  'frontend',
  'datastore',
  'orm',
  'queue',
  'observability',
  'ci',
  'container',
  'auth',
] as const;

/** Coherence edges between `candidate` and everything already chosen, counted in both directions (see
 * `scoreCoherence`'s own doc comment for why a mutual edge counts twice) -- the same weight
 * `scoreCoherence` itself uses, kept as a literal `1` here rather than imported, since this is a
 * per-candidate tiebreaker computed *during* selection, not the final whole-set score `scoreCoherence`
 * computes once selection is done. */
function coherenceBonus(candidate: CatalogEntry, chosen: readonly ChosenEntry[]): number {
  let bonus = 0;
  for (const { entry } of chosen) {
    if ((candidate.pairs_with ?? []).includes(entry.id)) bonus += 1;
    if ((entry.pairs_with ?? []).includes(candidate.id)) bonus += 1;
  }
  return bonus;
}

/** Runs all five `12` §12.3 steps for every kind in `CORE_KINDS`, in order, greedily: each kind's own
 * winner (or, for a kind with a real `constraints.mandated` match, every mandated winner -- see above)
 * is chosen before the next kind is considered, with the coherence bonus computed against everything
 * chosen *so far*. `12` §12.3 does not mandate a specific search strategy (a full joint combinatorial
 * optimization across all kinds simultaneously is one honest reading, but is not what "coherence
 * grouping" as a named, separate step from "score" requires) -- this greedy, single-pass approach is a
 * real, deterministic, documented resolution: it satisfies the spec's own "prefers combinations with
 * existing `pairs_with` edges" by construction (later kinds are rewarded for pairing with earlier
 * choices) without requiring a search space that grows combinatorially with the number of kinds and
 * candidates.
 *
 * A real, honestly-owned consequence of that single-pass design: `CORE_KINDS`'s own fixed order is
 * itself a priority lever, not just a list. A candidate's `pairs_with` edge to a kind processed *later*
 * in the array (e.g. `framework`, at index 1, to `datastore`, at index 3) can never contribute to that
 * candidate's own coherence bonus -- only edges to *already-decided* kinds count. Reordering
 * `CORE_KINDS` would change real results for exactly this reason. This is an inherent trade-off of
 * greedy single-pass selection, not a bug, but it is a real property of this implementation a caller
 * relying on a specific coherence outcome should know about.
 *
 * A separate, structural limitation, not fixed here: within one kind, a *non-mandated* decision still
 * ever picks exactly one winner -- `selectStack` has no signal for "this project genuinely needs two
 * independently-scored languages" the way it does for an explicit `constraints.mandated` list (which
 * *can* now select more than one winner of the same kind, see above). A polyglot stack the caller wants
 * the engine itself to *discover* (not simply name via `mandated`) is out of scope for this piece.
 *
 * Pure and deterministic (R10): identical `registry` contents and `input` always produce the identical
 * result -- no `Math.random()`/`Date.now()` anywhere in the selection path. */
export function selectStack(
  registry: CatalogRegistry,
  input: StackSelectionInput,
): StackSelectionResult {
  const chosen: ChosenEntry[] = [];
  const eliminated: RemovedCandidate[] = [];

  for (const kind of CORE_KINDS) {
    const candidates = registry.byKind(kind);
    if (candidates.length === 0) continue;

    // Every mandated entry of this kind is chosen, not just the first match -- a first-draft version
    // of this loop used `.find` and stopped at one, which silently capped every kind (including
    // `language`) at a single winner even when the caller's own `constraints.mandated` named more than
    // one. That made `12` §12.3's own "2 max at L3" language-count hard rule, and `scoreCoherence`'s own
    // runtime-count penalty, structurally unreachable from real `selectStack` output -- a fresh critic
    // round caught this by testing the actual orchestrator, not just the hard-rule/coherence functions
    // in isolation. Mandated entries already bypass scoring entirely (hard rule 3: "does not
    // re-litigate"), so there is no principled reason to also cap how many of them win.
    const mandatedEntries = candidates.filter((entry) =>
      isMandated(entry, input.constraints.mandated),
    );
    if (mandatedEntries.length > 0) {
      for (const entry of mandatedEntries) {
        chosen.push({ catalogKind: kind, entry, reason: { kind: 'mandated' } });
      }
      continue;
    }

    const filterResult = filterByConstraints(candidates, input.constraints);
    eliminated.push(...filterResult.removed);
    if (filterResult.kept.length === 0) continue;

    // Coherence is compared first, weighted score only as a tiebreaker within equal coherence -- `12`
    // §12.3 orders "coherence grouping" (step 2) before "score" (step 3), and an additive combination
    // (bonus + weighted, both summed into one number) let a high raw-criteria score from a completely
    // unrelated ecosystem outscore a real, explicit pairs_with edge to what was already chosen -- verified
    // directly against the real shipped catalog before this fix: mandating `typescript-js` and scoring
    // the `framework` kind by an additive total picked `phoenix` (Elixir) over `fastify`, despite
    // `fastify`'s own real, mutual `pairs_with` edge to `typescript-js`, because Phoenix's raw
    // maturity/burden/agent-friendliness score happened to be higher. Comparing coherence lexicographically
    // first fixes this by construction: a real edge always outranks a merely-higher raw score.
    let winner: { entry: CatalogEntry; weighted: number; bonus: number } | undefined;
    for (const entry of filterResult.kept) {
      const weighted = scoreCandidate(entry, input);
      const bonus = coherenceBonus(entry, chosen);
      const isBetter =
        winner === undefined ||
        bonus > winner.bonus ||
        (bonus === winner.bonus && weighted > winner.weighted);
      if (isBetter) winner = { entry, weighted, bonus };
    }

    if (winner !== undefined) {
      chosen.push({
        catalogKind: kind,
        entry: winner.entry,
        reason: { kind: 'scored', weightedScore: winner.weighted, coherenceBonus: winner.bonus },
      });
    }
  }

  return {
    chosen,
    eliminated,
    coherenceScore: scoreCoherence(chosen.map((c) => c.entry)),
    hardRuleFlags: evaluateHardRules(chosen, input.level),
  };
}
