/**
 * `analyzeGaps`/`renderGapsReport`/`writeGapArtifacts` — `17` §17.2 phase 7 (GAP ANALYSIS): "the output
 * that makes adoption immediately useful." Deterministic and pure at its core (`analyzeGaps`,
 * `renderGapsReport`): every gap this module finds traces to a concrete field on a real P15 (SURVEY/
 * INVENTORY), P16 (CARTOGRAPHY), P17 (VERIFICATION), or P18 (INFERENCE) output already committed for
 * this milestone — no new LLM dispatch, matching phase 7's own placement after VERIFICATION in `17`
 * §17.2's pipeline diagram with no LLM column of its own. `writeGapArtifacts` is the thin async shell
 * that turns the pure result into real `RISK-###`/`OQ-###` artifacts via `./artifacts.ts`.
 *
 * The six gap classes are `17` §17.2 phase 7's own table, each detector cross-referenced against one of
 * its own named examples:
 *
 * | Class | This module's detector | `17` §17.2 example matched |
 * |---|---|---|
 * | knowledge | low-confidence `component` findings; orphan (unimported, non-entry-point) modules; data-surface signals with no matching `data-ownership` finding | "Unexplained components, dead code candidates... unknown data ownership" |
 * | verification | every `VerificationResult.gaps` entry; an empty `testSetup.testDirs` | "No tests for critical paths, no e2e..." |
 * | delivery | no deployable unit; no CI/CD pipeline | "No reproducible build, manual deploy steps... missing environments" |
 * | operability | no logging/tracing external dependency; no docs at all | "No structured logging, no tracing... no runbooks" |
 * | safety | `CartographyResult.sharedWriteTables`; `secret-reference` config signals; destructive-looking migrations; HTTP routes with no matching authz convention | "Secrets in the repo, shared-write tables... missing authz on routes, destructive migrations" |
 * | consistency | `DependencyGraph.cycles`; low-adherence `convention` findings; `layering` findings whose own statement evidences a violation | "Convention violations, layering violations, cyclic dependencies" |
 *
 * **Scope note** (`SPEC-QUESTIONS.md`): `17` §17.2 phase 7's own prose additionally says an actionable
 * gap is "converted into a story," but `PLAN-M10.md` P19's own Surface bullet for this file names only
 * `RISK-###`/`OQ-###` as the artifact-creation paths to reuse — no `Story` artifact-creation primitive
 * exists anywhere in this codebase yet (a `Story` is a spec-authoring artifact with its own acceptance-
 * criteria structure, `packages/schemas/src/artifacts/story.ts`, never before written by an automated pipeline).
 * Building one is out of this piece's scope; every `actionable: true` gap is written as a `RISK-###`
 * (`critical`/`high` severity) with a concrete `mitigation` string naming the remediation a human would
 * turn into a story, so remediation is plannable from the register even though no `Story` artifact is
 * synthesized. Recorded rather than silently narrowed.
 *
 * @see specs/17 §17.2 phase 7
 * @see PLAN-M10.md P19
 */
import type { Clock } from '@forge/core';
import type { ProjectPaths } from '@forge/core/fs';

import { appendOpenQuestionEntry, appendRiskEntry } from './artifacts.ts';
import type { CartographyResult } from './cartography.ts';
import type { Inventory } from './inventory.ts';
import type { InferenceResult } from './inference.ts';
import type { Survey } from './survey.ts';
import type { VerificationResult } from './verification.ts';

export type GapClass =
  'knowledge' | 'verification' | 'delivery' | 'operability' | 'safety' | 'consistency';

export type GapSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface GapFinding {
  readonly gapClass: GapClass;
  readonly severity: GapSeverity;
  readonly statement: string;
  readonly evidence: readonly string[];
  /** Whether this finding is concrete enough to remediate directly (`17` §17.2 phase 7: "where
   * actionable, converted into a story" — see this file's own top-of-file scope note for what
   * "converted" means here). A non-actionable finding is still reported in `gaps.md`, just not written
   * as a `RISK-###`. */
  readonly actionable: boolean;
  readonly mitigation: string;
}

export interface GapAnalysisResult {
  readonly findings: readonly GapFinding[];
}

export interface GapAnalysisInput {
  readonly survey: Survey;
  readonly inventory: Inventory;
  readonly cartography: CartographyResult;
  readonly inference: InferenceResult;
  readonly verification: VerificationResult;
  /** Whether CARTOGRAPHY/INFERENCE (`17` §17.2 phases 3-4) actually ran for this analysis, as opposed
   * to `cartography`/`inference` both being an honestly-empty placeholder because no dispatch was
   * available (`packages/cli/src/commands/adopt.ts`'s own top-of-file scope note). Required, not
   * defaulted: a fresh critic round found the `safetyGaps` detector below flagging *every* HTTP route
   * in *every* real `forge adopt` run as "no evidenced authorization convention" — not because it had
   * looked and found none, but because INFERENCE had never run at all, so `hasAuthConvention` was
   * always `false` — a systematic false positive indistinguishable from a real finding, exactly the
   * "confident fabrication" `17` §17.1 warns against, just inverted (confidently reporting an absence
   * rather than a presence). This flag lets that one detector — and only that one, since it is the
   * one detector this piece found to be a *systematic* false positive rather than merely inactive —
   * distinguish "we checked and found nothing" from "we never checked." */
  readonly inferenceRan: boolean;
}

const LOGGING_TRACING_LIBRARIES = new Set([
  'winston',
  'pino',
  'bunyan',
  'log4js',
  '@opentelemetry/api',
  '@opentelemetry/sdk-node',
  'dd-trace',
  'newrelic',
]);

const DESTRUCTIVE_MIGRATION_PATTERN = /drop|truncate|delete\s+from/i;

function moduleKey(path: string): string {
  return path.replace(/\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/, '');
}

// ---- knowledge gaps -------------------------------------------------------------------------------

function knowledgeGaps(input: GapAnalysisInput): GapFinding[] {
  const findings: GapFinding[] = [];

  for (const finding of input.cartography.findings) {
    if (finding.kind === 'component' && finding.confidence === 'low') {
      findings.push({
        gapClass: 'knowledge',
        severity: 'medium',
        statement: `Unexplained component: "${finding.statement}" was identified with only low confidence.`,
        evidence: finding.evidence.map((ref) => (ref.kind === 'path' ? ref.path : ref.description)),
        actionable: true,
        mitigation:
          "Confirm this component's real responsibility with a human familiar with the codebase.",
      });
    }
  }

  const imported = new Set<string>();
  for (const node of input.inventory.dependencyGraph.nodes) {
    for (const target of node.imports) imported.add(moduleKey(target));
  }
  const entryPointModules = new Set(input.survey.entryPoints.map((ep) => moduleKey(ep.path)));
  for (const node of input.inventory.dependencyGraph.nodes) {
    const key = moduleKey(node.module);
    if (!imported.has(key) && !entryPointModules.has(key)) {
      findings.push({
        gapClass: 'knowledge',
        severity: 'low',
        statement: `Dead-code candidate: module "${node.module}" is never imported by another module and is not a known entry point.`,
        evidence: [node.module],
        actionable: true,
        mitigation: 'Confirm whether this module is genuinely unused and safe to remove.',
      });
    }
  }

  const ownedTables = new Set(
    input.cartography.findings
      .filter((f) => f.kind === 'data-ownership' && f.table !== undefined)
      // Sound: the preceding `.filter` already excludes every `table === undefined` row, but a plain
      // `.filter(predicate)` does not narrow `CartographyFinding.table` across the chain the way a
      // type-guard filter would, so TypeScript still sees `string | undefined` here without this cast.
      // `as string`, not `!`: `!` is banned (`no-non-null-assertion`) elsewhere in this codebase's own
      // `src/**` — `packages/kb/src/adopt/inventory.ts`'s own `requiredGroup` doc comment gives the
      // full precedent this follows rather than reinvents.
      // eslint-disable-next-line @typescript-eslint/non-nullable-type-assertion-style -- `!` is banned; see comment above.
      .map((f) => f.table as string),
  );
  for (const signal of input.inventory.dataSurface) {
    if (signal.name !== undefined && !ownedTables.has(signal.name)) {
      findings.push({
        gapClass: 'knowledge',
        severity: 'medium',
        statement: `Unknown data ownership: "${signal.name}" (${signal.kind}) has no component recorded as its owner.`,
        evidence: [signal.path],
        actionable: true,
        mitigation: 'Determine which component owns this data surface and record it explicitly.',
      });
    }
  }

  return findings;
}

// ---- verification gaps ----------------------------------------------------------------------------

function verificationGaps(input: GapAnalysisInput): GapFinding[] {
  const findings: GapFinding[] = input.verification.gaps.map((gap) => ({
    gapClass: 'verification' as const,
    severity: gap.subject.origin === 'repository' ? ('high' as const) : ('medium' as const),
    statement: `Verification gap (${gap.kind}): ${gap.detail}`,
    evidence: gap.command === undefined ? [gap.subject.statement] : [gap.command],
    actionable: true,
    mitigation: `Investigate and fix the underlying ${gap.kind} check, then re-run verification.`,
  }));

  if (input.survey.testSetup.testDirs.length === 0) {
    findings.push({
      gapClass: 'verification',
      severity: 'critical',
      statement: 'No test directories were found anywhere in the repository.',
      evidence: ['survey.testSetup.testDirs = []'],
      actionable: true,
      mitigation:
        'Add automated tests, starting with the critical paths identified in CARTOGRAPHY.',
    });
  }

  return findings;
}

// ---- delivery gaps --------------------------------------------------------------------------------

function deliveryGaps(input: GapAnalysisInput): GapFinding[] {
  const findings: GapFinding[] = [];
  if (input.survey.deployableUnits.length === 0) {
    findings.push({
      gapClass: 'delivery',
      severity: 'high',
      statement:
        'No deployable unit (Dockerfile, compose service, k8s manifest, or CI deploy job) was found.',
      evidence: ['survey.deployableUnits = []'],
      actionable: true,
      mitigation: 'Define a reproducible deployable unit and record the deploy process.',
    });
  }
  if (input.survey.ci.length === 0) {
    findings.push({
      gapClass: 'delivery',
      severity: 'high',
      statement: 'No CI/CD pipeline configuration was found.',
      evidence: ['survey.ci = []'],
      actionable: true,
      mitigation: 'Add a CI pipeline that runs the build and test suite on every change.',
    });
  }
  return findings;
}

// ---- operability gaps -----------------------------------------------------------------------------

function operabilityGaps(input: GapAnalysisInput): GapFinding[] {
  const findings: GapFinding[] = [];
  const hasLoggingOrTracing = input.inventory.externalDependencies.some((dep) =>
    LOGGING_TRACING_LIBRARIES.has(dep.name),
  );
  if (!hasLoggingOrTracing) {
    findings.push({
      gapClass: 'operability',
      severity: 'medium',
      statement: 'No structured logging or tracing library was found among external dependencies.',
      evidence: input.inventory.externalDependencies.map((d) => d.name),
      actionable: true,
      mitigation: 'Adopt a structured logging/tracing library and instrument critical paths.',
    });
  }
  if (input.survey.existingDocs.length === 0) {
    findings.push({
      gapClass: 'operability',
      severity: 'low',
      statement:
        'No existing documentation (README, docs directory, ADRs, changelog) was found — no runbooks either.',
      evidence: ['survey.existingDocs = []'],
      actionable: true,
      mitigation: 'Write operational runbooks for the critical paths identified in CARTOGRAPHY.',
    });
  }
  return findings;
}

// ---- safety gaps ----------------------------------------------------------------------------------

function safetyGaps(input: GapAnalysisInput): GapFinding[] {
  const findings: GapFinding[] = [];

  for (const shared of input.cartography.sharedWriteTables) {
    findings.push({
      gapClass: 'safety',
      severity: 'critical',
      statement: `Shared-write table: "${shared.table}" is written by more than one component (${shared.owners.join(', ')}).`,
      evidence: shared.owners,
      actionable: true,
      mitigation:
        'Assign single ownership of this table, or make the shared write explicit and coordinated.',
    });
  }

  for (const signal of input.inventory.configSurface) {
    if (signal.kind === 'secret-reference') {
      findings.push({
        gapClass: 'safety',
        severity: 'critical',
        statement: `Possible secret reference in the repository: "${signal.name}".`,
        evidence: [`${signal.path}:${String(signal.line)}`],
        actionable: true,
        mitigation:
          'Remove the secret from source control and rotate it; use a secret manager instead.',
      });
    }
  }

  for (const signal of input.inventory.dataSurface) {
    if (signal.kind === 'migration' && DESTRUCTIVE_MIGRATION_PATTERN.test(signal.path)) {
      findings.push({
        gapClass: 'safety',
        severity: 'high',
        statement: `Potentially destructive migration: "${signal.path}".`,
        evidence: [signal.path],
        actionable: true,
        mitigation:
          'Review this migration for a safe rollback path before it runs against production data.',
      });
    }
  }

  // Gated on `inferenceRan`: see `GapAnalysisInput.inferenceRan`'s own doc comment for the real,
  // fresh-critic-found false-positive this guard prevents. Without INFERENCE having actually run,
  // "no evidenced authorization convention" is not a real finding about this route at all — it is a
  // statement about how far the pipeline got.
  const routes = input.inventory.publicApiSurface.filter((s) => s.kind === 'http-route');
  const hasAuthConvention = input.inference.findings.some(
    (f) => f.kind === 'convention' && /auth/i.test(f.statement),
  );
  if (input.inferenceRan && !hasAuthConvention) {
    for (const route of routes) {
      findings.push({
        gapClass: 'safety',
        severity: 'high',
        statement: `Route "${route.name}" has no evidenced authorization convention.`,
        evidence: [route.path],
        actionable: true,
        mitigation:
          "Confirm this route's authorization requirement and add an explicit check if missing.",
      });
    }
  }

  return findings;
}

// ---- consistency gaps -----------------------------------------------------------------------------

function consistencyGaps(input: GapAnalysisInput): GapFinding[] {
  const findings: GapFinding[] = [];

  for (const cycle of input.inventory.dependencyGraph.cycles) {
    findings.push({
      gapClass: 'consistency',
      severity: 'medium',
      statement: `Cyclic dependency: ${cycle.join(' -> ')}.`,
      evidence: cycle,
      actionable: true,
      mitigation:
        'Break the cycle by introducing an interface or inverting one of the dependencies.',
    });
  }

  for (const finding of input.inference.findings) {
    if (finding.kind !== 'convention' || finding.adherenceRatio === undefined) continue;
    const parsed = /^(\d+) of (\d+)$/.exec(finding.adherenceRatio);
    if (parsed?.[1] === undefined || parsed[2] === undefined) continue;
    const matched = Number(parsed[1]);
    const total = Number(parsed[2]);
    if (total > 0 && matched / total < 0.5) {
      findings.push({
        gapClass: 'consistency',
        severity: 'medium',
        statement: `Low adherence to convention "${finding.statement}" (${String(matched)}/${String(total)}).`,
        evidence: finding.evidence.map((ref) => (ref.kind === 'path' ? ref.path : ref.description)),
        actionable: true,
        mitigation:
          'Decide whether to enforce or abandon this convention, then apply it consistently.',
      });
    }
  }

  for (const finding of input.cartography.findings) {
    if (finding.kind === 'layering' && /violat/i.test(finding.statement)) {
      findings.push({
        gapClass: 'consistency',
        severity: 'high',
        statement: `Layering violation: ${finding.statement}`,
        evidence: finding.evidence.map((ref) => (ref.kind === 'path' ? ref.path : ref.description)),
        actionable: true,
        mitigation: 'Restore the intended layering, or record the exception as a deliberate ADR.',
      });
    }
  }

  return findings;
}

/** Pure — every finding traces to a concrete field on `input`; see this file's own top-of-file table
 * for the exact detector-to-example mapping. */
export function analyzeGaps(input: GapAnalysisInput): GapAnalysisResult {
  return {
    findings: [
      ...knowledgeGaps(input),
      ...verificationGaps(input),
      ...deliveryGaps(input),
      ...operabilityGaps(input),
      ...safetyGaps(input),
      ...consistencyGaps(input),
    ],
  };
}

const GAP_CLASS_ORDER: readonly GapClass[] = [
  'knowledge',
  'verification',
  'delivery',
  'operability',
  'safety',
  'consistency',
];

const GAP_CLASS_TITLE: Readonly<Record<GapClass, string>> = {
  knowledge: 'Knowledge gaps',
  verification: 'Verification gaps',
  delivery: 'Delivery gaps',
  operability: 'Operability gaps',
  safety: 'Safety gaps',
  consistency: 'Consistency gaps',
};

export const GAP_REPORT_RELATIVE_PATH = 'reports/adoption/gaps.md';

/** `reports/adoption/gaps.md` — one section per gap class, in `17` §17.2 phase 7's own table order,
 * every finding severity-rated with its evidence listed underneath. */
export function renderGapsReport(result: GapAnalysisResult): string {
  const lines: string[] = [
    '# Adoption gap analysis',
    '',
    `Total gaps found: ${String(result.findings.length)}.`,
    '',
  ];
  for (const gapClass of GAP_CLASS_ORDER) {
    const inClass = result.findings.filter((f) => f.gapClass === gapClass);
    lines.push(`## ${GAP_CLASS_TITLE[gapClass]} (${String(inClass.length)})`, '');
    if (inClass.length === 0) {
      lines.push('None found.', '');
      continue;
    }
    for (const finding of inClass) {
      lines.push(`- **[${finding.severity}]** ${finding.statement}`);
      lines.push(`  - Mitigation: ${finding.mitigation}`);
      if (finding.evidence.length > 0) {
        lines.push(`  - Evidence: ${finding.evidence.join(', ')}`);
      }
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export interface WriteGapArtifactsResult {
  readonly riskIds: readonly string[];
  readonly openQuestionIds: readonly string[];
}

const SEVERITY_TO_RISK: ReadonlySet<GapSeverity> = new Set(['high', 'critical']);

/** Appends a real, evidence-derived suffix to `statement` before it is ever handed to `./artifacts.ts`
 * — `appendRiskEntry`/`appendOpenQuestionEntry`'s own idempotency is necessarily text-based (their own
 * doc comment explains why the schema leaves no room for anything better), so two distinct findings
 * that happen to share boilerplate `statement` wording (realistic for LLM-authored CARTOGRAPHY output,
 * e.g. two different low-confidence components both worded "Unexplained utility module") would
 * otherwise collide and silently collapse into one KB entry — a fresh critic round found exactly this
 * gap. Evidence (file paths, line numbers) is realistically always distinct even when wording is not,
 * which is what makes this a real, if not airtight, mitigation rather than cosmetic. */
function withEvidenceSuffix(statement: string, evidence: readonly string[]): string {
  return evidence.length === 0 ? statement : `${statement} (evidence: ${evidence.join(', ')})`;
}

/**
 * Writes every `actionable` `high`/`critical` finding as a real `RISK-###`, and every `actionable`
 * `low`/`medium` `knowledge`-class finding (the class `17` §17.2 phase 7 pairs with "open questions" in
 * its own worked examples — "unexplained," "unknown") as a real `OQ-###`. Every other actionable
 * finding is still reported in `gaps.md`; only these two classes get a structured KB artifact, matching
 * this file's own top-of-file scope note.
 */
export async function writeGapArtifacts(
  deps: { readonly paths: ProjectPaths; readonly clock: Clock; readonly kbRoot: string },
  owner: string,
  result: GapAnalysisResult,
): Promise<WriteGapArtifactsResult> {
  const riskIds: string[] = [];
  const openQuestionIds: string[] = [];
  for (const finding of result.findings) {
    if (!finding.actionable) continue;
    if (SEVERITY_TO_RISK.has(finding.severity)) {
      riskIds.push(
        await appendRiskEntry(deps, owner, {
          statement: withEvidenceSuffix(finding.statement, finding.evidence),
          likelihood: 'unknown',
          impact: finding.severity,
          mitigation: finding.mitigation,
        }),
      );
    } else if (finding.gapClass === 'knowledge') {
      openQuestionIds.push(
        await appendOpenQuestionEntry(
          deps,
          owner,
          withEvidenceSuffix(finding.statement, finding.evidence),
        ),
      );
    }
  }
  return { riskIds, openQuestionIds };
}
