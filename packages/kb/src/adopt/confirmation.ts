/**
 * `rankClaims`/`buildConfirmationBatch`/`applyConfirmationAnswer`/`runConfirmationFlow` — `17` §17.3's
 * own human-confirmation flow: "claims are batched by section and presented ranked by impact ×
 * uncertainty... The default cap is 20 questions; the rest are recorded as `OQ-###` for later... 'I
 * don't know' is always available and converts the claim to `confidence: low` with an open question
 * rather than forcing a guess."
 *
 * Every function through `applyConfirmationAnswer` is pure; `runConfirmationFlow` is the thin async
 * shell that calls a caller-supplied `ask` function (the real interactive prompt in the CLI, an
 * in-memory stub in a test) and writes the deferred/unknown-answer `OQ-###` entries via `./artifacts.ts`.
 *
 * @see specs/17 §17.3
 * @see PLAN-M10.md P19
 */
import type { Clock } from '@forge/core';
import type { ProjectPaths } from '@forge/core/fs';

import { appendOpenQuestionEntry } from './artifacts.ts';
import type { EvidenceRef } from './evidence.ts';
import type { KbEntryConfidence } from '../schema/kb-entry.ts';

export const CONFIRMATION_QUESTION_CAP = 20;

export type ClaimImpact = 'low' | 'medium' | 'high';

/** One claim from any earlier phase, as offered to the human — carries just what `17` §17.3 says a
 * question must show ("the claim, its evidence, and the consequence of it being wrong"), plus what
 * ranking needs (`impact`, `confidence` as the source of uncertainty). */
export interface ConfirmableClaim {
  readonly id: string;
  readonly section: string;
  readonly statement: string;
  readonly evidence: readonly EvidenceRef[];
  readonly confidence: KbEntryConfidence;
  readonly impact: ClaimImpact;
  readonly consequenceIfWrong: string;
}

const IMPACT_WEIGHT: Readonly<Record<ClaimImpact, number>> = { low: 1, medium: 2, high: 3 };

/** `confidence` is this flow's own uncertainty proxy: a claim already `verified` needs no human
 * confirmation at all (weight 0, sorts last and is excluded by `buildConfirmationBatch` — see its own
 * doc comment), `high` is fairly certain, `low` is the least. */
const UNCERTAINTY_WEIGHT: Readonly<Record<KbEntryConfidence, number>> = {
  verified: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export interface RankedClaim {
  readonly claim: ConfirmableClaim;
  readonly rank: number;
}

/** Impact × uncertainty, descending; ties broken by `section` then `statement` for a deterministic,
 * reviewable order (`17` §17.3 says "batched by section," which a stable tie-break within one rank
 * value preserves). A claim already `confidence: verified` (`UNCERTAINTY_WEIGHT.verified === 0`) always
 * ranks 0 and is filtered out entirely — nothing to confirm about a claim already independently proven
 * true. */
export function rankClaims(claims: readonly ConfirmableClaim[]): readonly RankedClaim[] {
  return claims
    .filter((claim) => claim.confidence !== 'verified')
    .map((claim) => ({
      claim,
      rank: IMPACT_WEIGHT[claim.impact] * UNCERTAINTY_WEIGHT[claim.confidence],
    }))
    .sort((a, b) => {
      if (b.rank !== a.rank) return b.rank - a.rank;
      if (a.claim.section !== b.claim.section) return a.claim.section < b.claim.section ? -1 : 1;
      return a.claim.statement < b.claim.statement
        ? -1
        : a.claim.statement > b.claim.statement
          ? 1
          : 0;
    });
}

export interface ConfirmationBatch {
  /** At most `CONFIRMATION_QUESTION_CAP` entries, highest impact × uncertainty first. */
  readonly batch: readonly RankedClaim[];
  /** Every ranked claim beyond the cap — never silently dropped; a caller writes each as a real
   * `OQ-###` (`runConfirmationFlow` does this automatically). */
  readonly deferred: readonly RankedClaim[];
}

export function buildConfirmationBatch(
  claims: readonly ConfirmableClaim[],
  cap: number = CONFIRMATION_QUESTION_CAP,
): ConfirmationBatch {
  const ranked = rankClaims(claims);
  return { batch: ranked.slice(0, cap), deferred: ranked.slice(cap) };
}

export type ConfirmationAnswer = 'confirm' | 'reject' | 'unknown';

export interface ConfirmationOutcome {
  readonly claimId: string;
  readonly answer: ConfirmationAnswer;
  readonly confidence: KbEntryConfidence;
  readonly status: 'active' | 'draft';
  /** Set only for `answer === 'unknown'` (or a deferred claim, via `runConfirmationFlow`) — the real
   * `OQ-###` text to record, never silently omitted. */
  readonly openQuestion: string | undefined;
}

/** "'I don't know' is always available and converts the claim to `confidence: low` with an open
 * question rather than forcing a guess" (`17` §17.3) — this is that conversion, plus the two other
 * real answers a human can give. `confirm` never *lowers* an already-higher confidence (it raises a
 * `low`/`medium` claim to `high`, since a human confirmation is real evidence of correctness, but
 * leaves `high` as `high` — this flow never claims to have independently *verified* anything, that
 * word is reserved for `17` §17.2 phase 5's own VERIFICATION). `reject` always drops to `low` with a
 * status of `draft` and its own open question, since a rejected claim is not knowledge at all until a
 * human corrects it. */
export function applyConfirmationAnswer(
  claim: ConfirmableClaim,
  answer: ConfirmationAnswer,
): ConfirmationOutcome {
  if (answer === 'confirm') {
    return {
      claimId: claim.id,
      answer,
      confidence:
        claim.confidence === 'low' || claim.confidence === 'medium' ? 'high' : claim.confidence,
      status: 'active',
      openQuestion: undefined,
    };
  }
  if (answer === 'reject') {
    return {
      claimId: claim.id,
      answer,
      confidence: 'low',
      status: 'draft',
      openQuestion: `Claim rejected during human confirmation: "${claim.statement}" — what is actually true here?`,
    };
  }
  return {
    claimId: claim.id,
    answer: 'unknown',
    confidence: 'low',
    status: 'draft',
    openQuestion: `Unconfirmed during human confirmation ("I don't know"): "${claim.statement}" (impact: ${claim.impact}; consequence if wrong: ${claim.consequenceIfWrong}).`,
  };
}

export type AskConfirmation = (
  batch: readonly RankedClaim[],
) => Promise<ReadonlyMap<string, ConfirmationAnswer>>;

export interface ConfirmationFlowResult {
  readonly outcomes: readonly ConfirmationOutcome[];
  readonly openQuestionIds: readonly string[];
  /** Every claim never asked about at all, whether because it was beyond the cap or the `ask` callback
   * did not answer it — a caller (`G-Adopt`) should treat these as still `confidence: <original>`,
   * unconfirmed. */
  readonly unresolved: readonly ConfirmableClaim[];
}

/** A real, evidence-derived fragment appended to every `OQ-###` this flow writes — the identical
 * "embed evidence to reduce a realistic text-based-idempotency collision" mitigation
 * `gap-analysis.ts`'s own `withEvidenceSuffix` uses, and for the same reason: `claim.statement` alone
 * can plausibly repeat across two genuinely distinct claims. */
function evidenceSuffix(claim: ConfirmableClaim): string {
  const evidence = claim.evidence.map((ref) => (ref.kind === 'path' ? ref.path : ref.description));
  return `evidence: ${evidence.length === 0 ? 'none' : evidence.join(', ')}`;
}

/**
 * The full flow: ranks, caps at `cap`, asks about the batch via the caller-supplied `ask`, writes a real
 * `OQ-###` for every deferred claim and every batched claim answered `unknown` (or left unanswered),
 * and returns the resolved outcomes. Every `OQ-###` write happens through `./artifacts.ts`'s own
 * per-project queue, so a caller running this concurrently with GAP ANALYSIS's own `writeGapArtifacts`
 * against the same project never races the shared `kb/open-questions.md` file.
 */
export async function runConfirmationFlow(
  deps: { readonly paths: ProjectPaths; readonly clock: Clock; readonly kbRoot: string },
  owner: string,
  claims: readonly ConfirmableClaim[],
  ask: AskConfirmation,
  cap: number = CONFIRMATION_QUESTION_CAP,
): Promise<ConfirmationFlowResult> {
  const { batch, deferred } = buildConfirmationBatch(claims, cap);
  const answers = batch.length > 0 ? await ask(batch) : new Map<string, ConfirmationAnswer>();

  const outcomes: ConfirmationOutcome[] = [];
  const openQuestionIds: string[] = [];
  const unresolved: ConfirmableClaim[] = [];

  for (const { claim } of batch) {
    const answer = answers.get(claim.id);
    if (answer === undefined) {
      unresolved.push(claim);
      openQuestionIds.push(
        await appendOpenQuestionEntry(
          deps,
          owner,
          `Not answered during human confirmation (batch capacity or no response): "${claim.statement}" (${evidenceSuffix(claim)}).`,
        ),
      );
      continue;
    }
    const outcome = applyConfirmationAnswer(claim, answer);
    outcomes.push(outcome);
    if (outcome.openQuestion !== undefined) {
      openQuestionIds.push(
        await appendOpenQuestionEntry(
          deps,
          owner,
          `${outcome.openQuestion} (${evidenceSuffix(claim)}).`,
        ),
      );
    }
  }

  for (const { claim } of deferred) {
    unresolved.push(claim);
    openQuestionIds.push(
      await appendOpenQuestionEntry(
        deps,
        owner,
        `Deferred past the ${String(cap)}-question confirmation cap: "${claim.statement}" (impact: ${claim.impact}; ${evidenceSuffix(claim)}).`,
      ),
    );
  }

  return { outcomes, openQuestionIds, unresolved };
}
