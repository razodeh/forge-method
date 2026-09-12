/**
 * `assembleVerification` — `17` §17.2 phase 5 (VERIFICATION)'s own pure assembly step, the deterministic
 * sibling of `cartography.ts`/`inference.ts`'s LLM-fed assembly: "claims are tested against reality
 * wherever a test is possible... failures are recorded as findings, not as blockers."
 *
 * Two of the table's seven claim types (`static call/import evidence` and `schema introspection`, plus
 * this piece's own structural reading of `pipeline`/`route` re-checks — see `classifyCartographyCheckKind`
 * below) are re-checked *purely*, here, by re-running a CARTOGRAPHY finding's own cited evidence against a
 * freshly rebuilt `EvidenceIndex` — a citation that resolved when CARTOGRAPHY accepted the claim can stop
 * resolving by VERIFICATION time (the file was deleted, the table dropped), which is exactly the kind of
 * drift `17` §17.2 phase 5 exists to catch, applied to CARTOGRAPHY's own claims and not only to a fresh
 * external command run. `convention` claims (the one INFERENCE kind this table names, "lint rule or grep
 * with a counted ratio") are re-checked the identical way, against a freshly recomputed adherence ratio the
 * caller supplies (recomputing one needs a real file re-scan, which this deliberately pure, I/O-free module
 * does not do itself — see `@forge/engine/adopt/verification.ts`'s own doc comment for where that lives).
 *
 * The other three claim types this table names (`build`, `test`, `pipeline`'s own "check for last
 * successful run") are not built *from* a prior CARTOGRAPHY/INFERENCE claim at all — "the build command is
 * Z"/"tests pass" are standalone facts about the target repository, checked by really running a command in
 * a sandboxed clone (`@forge/engine/adopt/verification.ts`, since real process spawning and a real git
 * clone need edges — `vcs`, subprocess execution — this deliberately pure module does not have: `tools/
 * eslint-plugin-forge-boundaries/src/graph.mjs`'s own `PACKAGE_GRAPH` gives `kb: ['core', 'schemas',
 * 'diagrams']`, no `vcs`/`engine` edge, confirmed directly before writing this piece, the identical
 * layering fact `SPEC-QUESTIONS.md` Q152/Q156 already recorded once each for SURVEY's git-profile signal
 * and for CARTOGRAPHY/INFERENCE's own LLM dispatch). This module accepts that engine-produced result as a
 * plain `RawVerificationCheck` — structurally identical regardless of which side constructed it, so
 * `assembleVerification` treats every check the same way once it has one.
 *
 * `intent`/`nfr`/`glossary` (INFERENCE's other three claim kinds) are deliberately never given to this
 * module at all: `17` §17.2's own phase-5 table has no row for "apparent intent" or "a glossary term is
 * accurate" — there is no structural test for either, and inventing one here would be exactly the kind of
 * confident fabrication `17` §17.1 warns against. Those claims stay at INFERENCE's own `low`/`medium`/
 * `draft` rating until a human confirms them (`17` §17.3), a different phase entirely.
 *
 * @see specs/17 §17.2
 * @see PLAN-M10.md P17
 * @see SPEC-QUESTIONS.md Q152
 * @see SPEC-QUESTIONS.md Q156
 */
import type { CartographyFinding } from './cartography.ts';
import { isKnownEvidence, type EvidenceIndex } from './evidence.ts';
import type { AdherenceRatio, InferenceFinding } from './inference.ts';
import type { KbEntryConfidence } from '../schema/kb-entry.ts';

/** `17` §17.2 phase 5's own table, one value per row. */
export type VerificationCheckKind =
  'call-graph' | 'schema' | 'build' | 'test' | 'pipeline' | 'route' | 'convention';

export type VerificationOutcome = 'pass' | 'fail' | 'inconclusive';

/** What a check re-tests: a specific prior CARTOGRAPHY/INFERENCE claim (`statement` is that finding's own
 * statement — findings carry no stable id of their own, matching `cartography.ts`/`inference.ts`'s own
 * shape), or `'repository'` for a standalone fact about the target repo as a whole (a build/test run is
 * not "disproving" any one prior claim). */
export interface VerificationSubject {
  readonly origin: 'cartography' | 'inference' | 'repository';
  readonly statement: string;
}

/** One verification check's own raw result, before promotion/downgrade is decided — this is the shape
 * both this module's own pure structural re-checks (`verifyCartographyFinding`/`verifyConventionFinding`)
 * and `@forge/engine/adopt/verification.ts`'s real sandboxed build/test/pipeline/route checks produce, so
 * `assembleVerification` can treat every one identically regardless of which side constructed it. */
export interface RawVerificationCheck {
  readonly kind: VerificationCheckKind;
  readonly subject: VerificationSubject;
  readonly outcome: VerificationOutcome;
  /** Human-readable evidence of what was actually checked and what was found — never a bare
   * pass/fail with no explanation, matching `08` §8.3's own "## Verification: how an agent can check
   * this is still true" wording. */
  readonly detail: string;
  /** The real command that was run, for a check `@forge/engine/adopt/verification.ts` performed by
   * actually executing something (`build`/`test`, and `pipeline` when a real last-run check is
   * available) — this is the value `17` §17.2 phase 5's own "verification command stored in the entry"
   * promise refers to. Absent for a purely structural evidence re-check, which has no one command to
   * name. */
  readonly command?: string;
  readonly measuredAt: string;
  /** `test` checks only, and only when the underlying test runner reported one — never fabricated when
   * absent. */
  readonly coverage?: number;
}

export type VerificationPromotion = 'verified' | 'downgraded' | 'unchanged';

export interface VerificationFinding extends RawVerificationCheck {
  readonly promotion: VerificationPromotion;
  /** The confidence value RECONSTRUCTION (`PLAN-M10.md` P18) should write for this subject: `'verified'`
   * on promotion (every origin, including a passing `repository`-origin build/test check — `17` §17.2
   * phase 5's own literal "a fixture repo with a genuinely passing build/test suite is promoted to
   * confidence: verified with the real command stored" names this case explicitly, not only a CARTOGRAPHY/
   * INFERENCE claim), `'low'` on downgrade *for a `cartography`/`inference` claim only* (a disproven claim
   * is never left at whatever confidence it originally had — `17` §17.2 phase 5's own literal "downgraded"
   * is not merely descriptive here). `undefined` for a failed `repository`-origin check (a failed build is
   * a confirmed, verified-negative fact recorded via `gaps`, not a claim with a prior confidence to
   * downgrade — there was never an entry asserting the build works for this to revise) and for every
   * `inconclusive` outcome (nothing was actually disproven, so nothing is downgraded on the strength of a
   * check that could not run). */
  readonly confidenceAfter?: KbEntryConfidence;
}

/** A failed or inconclusive check, carried forward as the phase-7 GAP ANALYSIS input `17` §17.2 phase 5's
 * own "a failed build/test run... produces a GAP entry for phase 7 to consume" describes — this module
 * does not itself write a `RISK-###`/`OQ-###` artifact (that is phase 7's own, later job), it only makes
 * sure a real failure is never silently dropped between the two phases. */
export interface VerificationGap {
  readonly subject: VerificationSubject;
  readonly kind: VerificationCheckKind;
  readonly detail: string;
  readonly command?: string;
}

export interface VerificationResult {
  readonly findings: readonly VerificationFinding[];
  readonly gaps: readonly VerificationGap[];
}

function promotionFor(outcome: VerificationOutcome): VerificationPromotion {
  if (outcome === 'pass') return 'verified';
  if (outcome === 'fail') return 'downgraded';
  return 'unchanged';
}

function confidenceAfter(
  check: RawVerificationCheck,
  promotion: VerificationPromotion,
): KbEntryConfidence | undefined {
  if (promotion === 'verified') return 'verified';
  if (promotion === 'downgraded' && check.subject.origin !== 'repository') return 'low';
  return undefined;
}

/**
 * Runs every raw check through the promotion/downgrade rule and splits every non-`verified` outcome into
 * `gaps` as well — "failures are findings, not blockers" means a failed or inconclusive check is always
 * still a real, visible `VerificationFinding` (never silently discarded the way a rejected CARTOGRAPHY
 * claim is), *and* additionally feeds `gaps` for phase 7. A `pass` outcome never appears in `gaps`.
 */
export function assembleVerification(checks: readonly RawVerificationCheck[]): VerificationResult {
  const findings: VerificationFinding[] = [];
  const gaps: VerificationGap[] = [];
  for (const check of checks) {
    const promotion = promotionFor(check.outcome);
    const confidence = confidenceAfter(check, promotion);
    const finding: VerificationFinding = {
      ...check,
      promotion,
      ...(confidence === undefined ? {} : { confidenceAfter: confidence }),
    };
    findings.push(finding);
    if (promotion !== 'verified') {
      gaps.push({
        subject: check.subject,
        kind: check.kind,
        detail: check.detail,
        ...(check.command === undefined ? {} : { command: check.command }),
      });
    }
  }
  return { findings, gaps };
}

/** Structural classification from a CARTOGRAPHY finding's own cited evidence — never from English text
 * in `statement`, which would be fragile and gameable. `data-ownership` claims are always `schema`
 * ("Entity X lives in table Y"). Every other CARTOGRAPHY kind claims a structural relationship; this
 * narrows further by which *evidence facts* it actually cites: a claim citing a `ci:...` fact
 * (`evidence.ts`'s own canonical CI-signal fact string) is checking a deployment pipeline ("pipeline");
 * one citing a `public-api:http-route:...` fact is checking a route ("route"); anything else falls back
 * to the general "static call/import evidence" bucket ("call-graph"), which covers `component`/`layering`/
 * `critical-path` claims about calls and dependency structure. */
export function classifyCartographyCheckKind(finding: CartographyFinding): VerificationCheckKind {
  if (finding.kind === 'data-ownership') return 'schema';
  const citesPipeline = finding.evidence.some(
    (ref) => ref.kind === 'fact' && ref.description.startsWith('ci:'),
  );
  if (citesPipeline) return 'pipeline';
  const citesRoute = finding.evidence.some(
    (ref) => ref.kind === 'fact' && ref.description.startsWith('public-api:http-route:'),
  );
  if (citesRoute) return 'route';
  return 'call-graph';
}

/**
 * Re-runs every one of `finding`'s own evidence citations against `freshIndex` — built from a fresh
 * SURVEY/INVENTORY pass, not necessarily the identical one CARTOGRAPHY validated against at assembly
 * time. A claim mixing one still-real citation with one that no longer resolves fails whole, matching
 * `validateClaimEvidence`'s own "partial credit would let a fabricated fact ride in alongside a genuine
 * one" reasoning at CARTOGRAPHY time — the same rule applied a second time, later, against reality.
 */
export function verifyCartographyFinding(
  finding: CartographyFinding,
  freshIndex: EvidenceIndex,
  measuredAt: string,
): RawVerificationCheck {
  const kind = classifyCartographyCheckKind(finding);
  const subject: VerificationSubject = { origin: 'cartography', statement: finding.statement };
  const missing = finding.evidence.find((ref) => !isKnownEvidence(ref, freshIndex));
  if (missing === undefined) {
    return {
      kind,
      subject,
      outcome: 'pass',
      detail:
        `every cited evidence entry for "${finding.statement}" still resolves against a fresh ` +
        `SURVEY/INVENTORY pass.`,
      measuredAt,
    };
  }
  const named = missing.kind === 'path' ? missing.path : missing.description;
  return {
    kind,
    subject,
    outcome: 'fail',
    detail: `evidence no longer resolves against a fresh SURVEY/INVENTORY pass: ${named}`,
    measuredAt,
  };
}

/** `convention` claims only ("17 of 21 handlers use X" — `17` §17.2's own "lint rule or grep with a
 * counted ratio"). `freshRatio` is `undefined` when the caller could not recompute one (e.g. the file set
 * changed shape entirely) — reported as `inconclusive`, never guessed at as a pass or a fail. An exact
 * string match against `finding.adherenceRatio` is the bar: a re-count that lands on a genuinely
 * different ratio than the one INFERENCE claimed is real, measured disagreement, not noise to smooth
 * over. */
export function verifyConventionFinding(
  finding: InferenceFinding,
  freshRatio: AdherenceRatio | undefined,
  measuredAt: string,
): RawVerificationCheck {
  const subject: VerificationSubject = { origin: 'inference', statement: finding.statement };
  if (freshRatio === undefined) {
    return {
      kind: 'convention',
      subject,
      outcome: 'inconclusive',
      detail: `no fresh adherence ratio could be recomputed for "${finding.statement}".`,
      measuredAt,
    };
  }
  const ratioText = `${String(freshRatio.matched)} of ${String(freshRatio.total)}`;
  const priorRatio = finding.adherenceRatio;
  if (priorRatio === undefined || priorRatio === ratioText) {
    return {
      kind: 'convention',
      subject,
      outcome: 'pass',
      detail: `re-counted adherence ratio for "${finding.statement}" is ${ratioText}, consistent with the claim.`,
      measuredAt,
    };
  }
  return {
    kind: 'convention',
    subject,
    outcome: 'fail',
    detail:
      `re-counted adherence ratio for "${finding.statement}" is ${ratioText}, which disagrees with ` +
      `the claimed ${priorRatio}.`,
    measuredAt,
  };
}
