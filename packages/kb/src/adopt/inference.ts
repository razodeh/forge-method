/**
 * `assembleInference` — `17` §17.2 phase 4 (INFERENCE)'s own pure assembly step, the sibling of
 * `cartography.ts`'s `assembleCartography` for the phase spec text calls out as deliberately "the
 * riskier claims, kept... distinct from cartography so they can be trusted differently": "everything
 * from this phase starts at `confidence: low|medium` and `status: draft`."
 *
 * That rule is enforced structurally here, not by convention: `clampInferenceConfidence`'s own return
 * type is the two-value literal union `'low' | 'medium'`, not the full `KbEntryConfidence`, so an
 * `InferenceFinding` cannot carry `'high'`/`'verified'` regardless of what a dispatched session's own
 * `RawInferenceClaim.confidence` claimed — there is no code path in this module that could produce one,
 * which is what `PLAN-M10.md` P16's own Surface text means by "no path to a higher value from this
 * phase alone." `status` is not even a field on `RawInferenceClaim` at all — `InferenceFinding.status`
 * is a fixed literal `'draft'`, so nothing upstream can set it to anything else.
 *
 * Evidence citation is the identical rule `cartography.ts` already enforces (`validateClaimEvidence`'s
 * own doc comment there has the fuller anti-fabrication reasoning); `convention` claims additionally
 * require a real, structurally-valid adherence ratio (`17` §17.2: "'17 of 21' is a convention; '3 of 21'
 * is a mess" — both are real ratios, "real numbers" is the bar, not any particular strength).
 *
 * @see specs/17 §17.2
 * @see PLAN-M10.md P16
 */
import { isKnownEvidence, type EvidenceIndex, type EvidenceRef } from './evidence.ts';

export type InferenceClaimKind = 'convention' | 'intent' | 'nfr' | 'glossary';

/** A real `matched`/`total` pair, e.g. "17 of 21" — `convention` claims only. */
export interface AdherenceRatio {
  readonly matched: number;
  readonly total: number;
}

export interface RawInferenceClaim {
  readonly kind: InferenceClaimKind;
  readonly statement: string;
  readonly evidence: readonly EvidenceRef[];
  /** The claim's own self-reported confidence, from the full `KbEntryConfidence` vocabulary — accepted
   * as untrusted input precisely because `buildInferenceFinding` never returns it unclamped. */
  readonly confidence: string;
  /** `convention` only. */
  readonly adherence?: AdherenceRatio;
  /** `glossary` only. */
  readonly term?: string;
  readonly definition?: string;
}

export interface InferenceFinding {
  readonly kind: InferenceClaimKind;
  readonly statement: string;
  readonly evidence: readonly EvidenceRef[];
  readonly confidence: 'low' | 'medium';
  readonly status: 'draft';
  /** `convention` only — the human-readable "17 of 21" rendering of a real, validated ratio. */
  readonly adherenceRatio?: string;
  readonly term?: string;
  readonly definition?: string;
}

export interface RejectedInferenceClaim {
  readonly claim: RawInferenceClaim;
  readonly reason: string;
}

export interface InferenceResult {
  readonly findings: readonly InferenceFinding[];
  readonly rejected: readonly RejectedInferenceClaim[];
}

/** Any confidence value other than the literal string `'low'` clamps to `'medium'` — this is a ceiling,
 * not a translation table: a session that claims `'high'` or `'verified'` (or anything malformed) for an
 * INFERENCE finding gets the same `'medium'` a session claiming `'medium'` honestly would, never a
 * distinct third bucket that could be mistaken for a stronger signal. */
export function clampInferenceConfidence(raw: string): 'low' | 'medium' {
  return raw === 'low' ? 'low' : 'medium';
}

function formatAdherenceRatio(ratio: AdherenceRatio): string | undefined {
  if (
    !Number.isInteger(ratio.matched) ||
    !Number.isInteger(ratio.total) ||
    ratio.total <= 0 ||
    ratio.matched < 0 ||
    ratio.matched > ratio.total
  ) {
    return undefined;
  }
  return `${String(ratio.matched)} of ${String(ratio.total)}`;
}

export function validateInferenceEvidence(
  claim: RawInferenceClaim,
  index: EvidenceIndex,
): string | undefined {
  if (claim.evidence.length === 0) return 'no evidence cited';
  const unknown = claim.evidence.find((ref) => !isKnownEvidence(ref, index));
  if (unknown !== undefined) {
    const named = unknown.kind === 'path' ? unknown.path : unknown.description;
    return `evidence not found in SURVEY/INVENTORY: ${named}`;
  }
  if (claim.kind === 'convention') {
    if (claim.adherence === undefined) return 'convention claim has no adherence ratio';
    if (formatAdherenceRatio(claim.adherence) === undefined) {
      return `convention claim has an invalid adherence ratio: ${JSON.stringify(claim.adherence)}`;
    }
  }
  if (claim.kind === 'glossary' && (claim.term === undefined || claim.definition === undefined)) {
    return 'glossary claim missing term or definition';
  }
  return undefined;
}

export function assembleInference(
  rawClaims: readonly RawInferenceClaim[],
  index: EvidenceIndex,
): InferenceResult {
  const findings: InferenceFinding[] = [];
  const rejected: RejectedInferenceClaim[] = [];
  for (const claim of rawClaims) {
    const reason = validateInferenceEvidence(claim, index);
    if (reason !== undefined) {
      rejected.push({ claim, reason });
      continue;
    }
    const adherenceRatio =
      claim.kind === 'convention' && claim.adherence !== undefined
        ? formatAdherenceRatio(claim.adherence)
        : undefined;
    findings.push({
      kind: claim.kind,
      statement: claim.statement,
      evidence: claim.evidence,
      confidence: clampInferenceConfidence(claim.confidence),
      status: 'draft',
      ...(adherenceRatio === undefined ? {} : { adherenceRatio }),
      ...(claim.term === undefined ? {} : { term: claim.term }),
      ...(claim.definition === undefined ? {} : { definition: claim.definition }),
    });
  }
  return { findings, rejected };
}
