/**
 * `computeMeasuredFacts`/`evaluateGAdoptGate` — `17` §17.2 phase 8 (BASELINE)'s own two non-git-mutating
 * halves: "the measured facts... this is the ratchet reference" and "`G-Adopt` gate: KB lints clean,
 * every `high`-impact claim is either verified or human-confirmed, the build and test verification
 * results are recorded, and the gap report exists." Both are pure, so `G-Adopt` (unlike `G-Verify`/
 * `G-Design`, which shell out to `forge test ...` subcommands via `.gate.yaml`, `packages/cli/src/
 * commands/run/gates.ts`) is checked directly against real in-memory pipeline output — no new shell
 * command needed, since every fact phase 8 asks for already exists as a typed value by the time
 * BASELINE runs (`PLAN-M10.md` P19's own CLI, `commands/adopt.ts`, is what actually invokes this).
 *
 * The real `BASELINE` git tag/commit itself is **not** built here: `@forge/kb` has no boundary-graph
 * edge to `@forge/vcs` (`tools/eslint-plugin-forge-boundaries/src/graph.mjs`'s own `kb: ['core',
 * 'schemas', 'diagrams']`) — `packages/cli/src/commands/adopt.ts`, which depends on both, is where the
 * measured-facts snapshot this file produces is embedded in the tag message and where
 * `@forge/vcs`'s own `createAnnotatedTag` (`PLAN-M10.md` P19) is actually called.
 *
 * @see specs/17 §17.2 phase 8
 * @see PLAN-M10.md P19
 */
import type { ConfirmableClaim, ConfirmationOutcome } from './confirmation.ts';
import type { GapAnalysisResult, GapClass } from './gap-analysis.ts';
import type { Inventory } from './inventory.ts';
import type { Survey } from './survey.ts';
import type { VerificationResult } from './verification.ts';

export interface MeasuredFacts {
  readonly testCount: number;
  readonly testPassRate: number;
  readonly coverage: number | undefined;
  readonly dependencyCount: number;
  readonly totalLines: number;
  readonly cycleCount: number;
  readonly gapCounts: Readonly<Record<GapClass, number>>;
  readonly measuredAt: string;
}

const GAP_CLASSES: readonly GapClass[] = [
  'knowledge',
  'verification',
  'delivery',
  'operability',
  'safety',
  'consistency',
];

/** Every field here is read directly off a real, already-produced pipeline output — never re-derived
 * or estimated. `testPassRate` is `NaN`-safe: `0/0` (no test findings at all) reports `0`, not `NaN`,
 * so a caller can always format or ratchet-compare this value without a `Number.isNaN` guard of its
 * own. */
export function computeMeasuredFacts(
  input: {
    readonly survey: Survey;
    readonly inventory: Inventory;
    readonly verification: VerificationResult;
    readonly gapAnalysis: GapAnalysisResult;
  },
  measuredAt: string,
): MeasuredFacts {
  const testChecks = input.verification.findings.filter((f) => f.kind === 'test');
  const passedTests = testChecks.filter((f) => f.outcome === 'pass');
  const coverageValues = testChecks
    .map((f) => f.coverage)
    .filter((c): c is number => c !== undefined);

  // Sound: `GAP_CLASSES` enumerates every `GapClass` value exactly once (the same closed-tuple
  // pattern `reconstruction.ts`'s own `CONFIDENCE_RANK` cast documents), so the object built from it
  // provably has every key `Record<GapClass, number>` requires — `Object.fromEntries`'s own generic
  // return type just cannot express that closure back from a plain array `.map`.
  const gapCounts = Object.fromEntries(
    GAP_CLASSES.map((gapClass) => [
      gapClass,
      input.gapAnalysis.findings.filter((f) => f.gapClass === gapClass).length,
    ]),
  ) as Record<GapClass, number>;

  return {
    testCount: testChecks.length,
    testPassRate: testChecks.length === 0 ? 0 : passedTests.length / testChecks.length,
    coverage: coverageValues.length === 0 ? undefined : Math.max(...coverageValues),
    dependencyCount: input.inventory.externalDependencies.length,
    totalLines: input.survey.size.totalLines,
    cycleCount: input.inventory.dependencyGraph.cycles.length,
    gapCounts,
    measuredAt,
  };
}

export interface GAdoptGateInput {
  readonly kbLint: { readonly clean: boolean; readonly errors: readonly string[] };
  /** Every claim GAP ANALYSIS/CARTOGRAPHY marked `impact: 'high'` that went through (or should have
   * gone through) human confirmation, alongside the outcome it actually received — `undefined` for a
   * high-impact claim never answered at all (beyond the 20-question cap, or left unanswered). */
  readonly highImpactClaims: readonly {
    readonly claim: ConfirmableClaim;
    readonly outcome: ConfirmationOutcome | undefined;
  }[];
  readonly verification: VerificationResult;
  readonly gapReportExists: boolean;
}

export interface GAdoptGateResult {
  readonly passed: boolean;
  /** One entry per condition `17` §17.2 phase 8 names, always four entries regardless of `passed` — a
   * caller can render every condition's own pass/fail, not only the first failure. */
  readonly conditions: readonly {
    readonly name: string;
    readonly passed: boolean;
    readonly detail: string;
  }[];
}

function isConfirmedOrVerified(entry: {
  readonly claim: ConfirmableClaim;
  readonly outcome: ConfirmationOutcome | undefined;
}): boolean {
  if (entry.claim.confidence === 'verified') return true;
  return entry.outcome?.answer === 'confirm';
}

/**
 * `17` §17.2 phase 8's own four conditions, checked exactly, in order, and unconditionally (no
 * short-circuit) so every condition's own detail is always available to a caller — the CLI's `--report`
 * surface renders all four whether the gate passed or not, not just the first failure.
 */
export function evaluateGAdoptGate(input: GAdoptGateInput): GAdoptGateResult {
  const unconfirmedHighImpact = input.highImpactClaims.filter(
    (entry) => !isConfirmedOrVerified(entry),
  );

  const hasBuildRecord = input.verification.findings.some(
    (f) => f.subject.origin === 'repository' && f.kind === 'build',
  );
  const hasTestRecord = input.verification.findings.some(
    (f) => f.subject.origin === 'repository' && f.kind === 'test',
  );

  const conditions = [
    {
      name: 'kb-lint-clean',
      passed: input.kbLint.clean,
      detail: input.kbLint.clean
        ? 'KB lints clean.'
        : `KB lint reported ${String(input.kbLint.errors.length)} error(s): ${input.kbLint.errors.join('; ')}`,
    },
    {
      name: 'high-impact-claims-resolved',
      passed: unconfirmedHighImpact.length === 0,
      detail:
        unconfirmedHighImpact.length === 0
          ? 'Every high-impact claim is verified or human-confirmed.'
          : `${String(unconfirmedHighImpact.length)} high-impact claim(s) are neither verified nor confirmed: ${unconfirmedHighImpact.map((e) => e.claim.statement).join('; ')}`,
    },
    {
      name: 'build-and-test-recorded',
      passed: hasBuildRecord && hasTestRecord,
      detail:
        hasBuildRecord && hasTestRecord
          ? 'Build and test verification results are recorded.'
          : `Missing verification record(s): ${[
              hasBuildRecord ? undefined : 'build',
              hasTestRecord ? undefined : 'test',
            ]
              .filter((v): v is string => v !== undefined)
              .join(', ')}.`,
    },
    {
      name: 'gap-report-exists',
      passed: input.gapReportExists,
      detail: input.gapReportExists
        ? 'Gap report exists.'
        : 'Gap report (reports/adoption/gaps.md) does not exist.',
    },
  ];

  return { passed: conditions.every((c) => c.passed), conditions };
}

export const BASELINE_TAG_NAME = 'BASELINE';
export const BASELINE_REPORT_RELATIVE_PATH = 'reports/adoption/baseline.json';

/** The JSON `reports/adoption/baseline.json` snapshot — `forge baseline show` reads this back directly;
 * `forge baseline diff` (`packages/cli/src/commands/adopt.ts`) compares a freshly-computed
 * `MeasuredFacts` against one previously written here. */
export interface BaselineSnapshot {
  /** `undefined` when no real git tag was created — a target repository with no commits yet has
   * nothing to tag (`@forge/vcs`'s own `createAnnotatedTag` needs a real commit-ish). A fresh critic
   * round found an earlier version wrote the literal tag name here regardless, which is a fabricated
   * fact `forge baseline show`/`diff` would then repeat as true — `17` §17.1's own "confident
   * fabrication" risk, applied to this piece's own output rather than only to CARTOGRAPHY/INFERENCE. */
  readonly tag: string | undefined;
  /** `undefined` for the identical "no commits yet" case above. */
  readonly commit: string | undefined;
  readonly createdAt: string;
  readonly facts: MeasuredFacts;
  readonly gate: GAdoptGateResult;
}

export interface BaselineDiff {
  readonly previous: BaselineSnapshot;
  readonly current: MeasuredFacts;
  /** One entry per numeric field of `MeasuredFacts` (every `gapCounts` class included individually) —
   * `delta > 0` for `gapCounts.*`/`cycleCount` is a regression, `delta > 0` for `testPassRate`/
   * `coverage` is an improvement; this function does not itself judge direction, only reports the raw
   * numeric delta, since which direction is "better" differs per field. */
  readonly deltas: Readonly<Record<string, number | undefined>>;
}

/** Never throws on a missing prior coverage value: `undefined - number` and `number - undefined` both
 * report `undefined` (no meaningful delta), not `NaN`. */
function numericDelta(
  previous: number | undefined,
  current: number | undefined,
): number | undefined {
  if (previous === undefined || current === undefined) return undefined;
  return current - previous;
}

export function diffBaselines(previous: BaselineSnapshot, current: MeasuredFacts): BaselineDiff {
  const deltas: Record<string, number | undefined> = {
    testCount: numericDelta(previous.facts.testCount, current.testCount),
    testPassRate: numericDelta(previous.facts.testPassRate, current.testPassRate),
    coverage: numericDelta(previous.facts.coverage, current.coverage),
    dependencyCount: numericDelta(previous.facts.dependencyCount, current.dependencyCount),
    totalLines: numericDelta(previous.facts.totalLines, current.totalLines),
    cycleCount: numericDelta(previous.facts.cycleCount, current.cycleCount),
  };
  for (const gapClass of GAP_CLASSES) {
    deltas[`gapCounts.${gapClass}`] = numericDelta(
      previous.facts.gapCounts[gapClass],
      current.gapCounts[gapClass],
    );
  }
  return { previous, current, deltas };
}
