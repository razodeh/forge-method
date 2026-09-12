/**
 * `forge adopt [dir] [--scope <path|module>] [--depth quick|standard|deep] [--no-verify]` —
 * `03` §3.2.1, `17` (brownfield ingestion), replacing the M6-era refusal stub (`SPEC-QUESTIONS.md`'s
 * M6 entry for this file: "no codebase-scanning, KB-population, or component-inference mechanism
 * exists anywhere in this repository as of M6... refused rather than fabricated"). By `PLAN-M10.md`
 * P15-P18, every deterministic/pure phase this command needs is real and committed
 * (`@forge/kb/adopt`'s SURVEY/INVENTORY/CARTOGRAPHY-assembly/INFERENCE-assembly/VERIFICATION-assembly/
 * RECONSTRUCTION, `@forge/engine/adopt`'s VERIFICATION dispatch, `@forge/vcs`'s git primitives); P19
 * (this piece) adds GAP ANALYSIS, BASELINE, and human confirmation, and wires all eight phases into
 * one real, runnable pipeline for the first time.
 *
 * **CARTOGRAPHY/INFERENCE dispatch scope note** (`SPEC-QUESTIONS.md`): `17` §17.2 phases 3-4 are LLM
 * dispatches whose real orchestration (`@forge/engine/adopt`'s `runCartographyPhase`/
 * `runInferencePhase`) needs a full `ExecuteStepContext` — the multi-agent run-engine's own worktree/
 * lane/merge-queue/telemetry machinery (`packages/engine/src/dispatch/types.ts`), built for a
 * concurrent, multi-lane story run, not a single, read-only repository scan. Constructing one here
 * merely to make two read-only session calls is disproportionate machinery this piece does not
 * build. Instead, `AdoptContext.runCartography`/`runInference` accept the dispatch result directly —
 * a real caller that already has a live `ExecuteStepContext` (a future run-engine integration) can
 * call `runCartographyPhase`/`runInferencePhase` itself and hand this function the result; a caller
 * with none gets an honest, disclosed empty result rather than a fabricated one, matching `17` §17.1's
 * own "confident fabrication" warning. VERIFICATION (`runVerificationPhase`, `@forge/engine/adopt`)
 * needs no such context — it is wired for real, unconditionally, below.
 *
 * @see specs/03 §3.2.1
 * @see specs/17
 * @see PLAN-M10.md P19
 * @see SPEC-QUESTIONS.md
 */
import { ForgeError, SYSTEM_CLOCK, type Clock } from '@forge/core';
import {
  ensureDir,
  pathExists,
  readTextFile,
  writeFileAtomic,
  type AbsolutePath,
  type ProjectPaths,
} from '@forge/core/fs';
import { runVerificationPhase } from '@forge/engine/adopt';
import {
  analyzeGaps,
  computeMeasuredFacts,
  diffBaselines,
  evaluateGAdoptGate,
  GAP_REPORT_RELATIVE_PATH,
  renderGapsReport,
  runConfirmationFlow,
  runInventory,
  runSurvey,
  writeGapArtifacts,
  writeReconstruction,
  writeSurveyReport,
  BASELINE_REPORT_RELATIVE_PATH,
  BASELINE_TAG_NAME,
  CONFIRMATION_QUESTION_CAP,
  type AskConfirmation,
  type BaselineDiff,
  type BaselineSnapshot,
  type CartographyResult,
  type ClaimImpact,
  type ConfirmableClaim,
  type ConfirmationFlowResult,
  type GapAnalysisResult,
  type Inventory,
  type InferenceResult,
  type ReconstructionResult,
  type ScopedAdoptionProposal,
  type SizeThresholds,
  type Survey,
  type SurveyResult,
  type VerificationResult,
} from '@forge/kb/adopt';
import { DEFAULT_KB_ROOT, lintKb, parseKbTree } from '@forge/kb';
import {
  analyzeGitProfile,
  createAnnotatedTag,
  resolveHeadShaOrUndefined,
  tagExists,
  type VcsClock,
} from '@forge/vcs';
import { configSchema, type ForgeConfig } from '@forge/schemas/config';
import * as YAML from 'yaml';

import { CONFIG_REL_PATH } from './config.ts';

const INVENTORY_REPORT_RELATIVE_PATH = 'reports/adoption/inventory.json';

/** Adapts `@forge/core`'s own `Clock` (an ISO-string `now()`, for event logs) to `@forge/vcs`'s
 * `VcsClock` (epoch-milliseconds `now()`, for an age-in-days calculation) — the two packages define
 * their own clock shapes independently (`vcs/src/clock.ts`'s own doc comment: `vcs` has no `core`
 * edge and cannot import `Clock` to share it), so a caller that bridges the two, like this one, is
 * responsible for the conversion. */
function toVcsClock(clock: Clock): VcsClock {
  return { now: () => Date.parse(clock.now()) };
}

export type AdoptDepth = 'quick' | 'standard' | 'deep';

export interface AdoptOptions {
  /** The real, on-disk repository to adopt — defaults to `ctx.paths`'s own root. */
  readonly dir?: string;
  /** When set, bypasses `17` §17.2 phase 1's own size gate (see `adopt`'s own doc comment on
   * `scopedProposal`) — this piece does not itself implement filtering the walk down to the named
   * path/module (a real, disclosed scope narrowing, `SPEC-QUESTIONS.md`); a future piece can thread
   * `scope` into `runSurvey`/`runInventory`'s own file-walk without changing this option's shape. */
  readonly scope?: string;
  readonly depth?: AdoptDepth;
  readonly noVerify?: boolean;
}

export interface AdoptContext {
  readonly paths: ProjectPaths;
  readonly clock?: Clock;
  readonly kbRoot?: string;
  readonly owner?: string;
  /** See this file's own top-of-file "CARTOGRAPHY/INFERENCE dispatch scope note." Defaults to an
   * honest empty result — never fabricated. `options.deep` reflects `AdoptOptions.depth === 'deep'` —
   * this piece does not itself implement `17` §17.6's "adds git-history inference and per-component
   * characterisation-test generation" (a real dispatch-orchestration change to `@forge/engine/adopt`'s
   * own `runInferencePhase`, out of this piece's scope, `SPEC-QUESTIONS.md`), but a caller that
   * supplies its own real `runInference` can use this flag to do so — a fresh critic round found an
   * earlier version accepted `depth: 'deep'` and silently ran the identical `standard` pipeline with
   * no signal anywhere that the deeper analysis never happened. */
  readonly runCartography?: (
    survey: Survey,
    inventory: Inventory,
    options: { readonly deep: boolean },
  ) => Promise<CartographyResult>;
  readonly runInference?: (
    survey: Survey,
    inventory: Inventory,
    options: { readonly deep: boolean },
  ) => Promise<InferenceResult>;
  /** The real human-confirmation prompt — defaults to answering every question `'unknown'`, `17`
   * §17.3's own "never forces a guess" safe default for a non-interactive caller. */
  readonly ask?: AskConfirmation;
  /** Overrides `17` §17.2 phase 1's own size-gate thresholds — real production callers never set
   * this (the real defaults are `runSurvey`'s own `DEFAULT_SIZE_THRESHOLDS`); a test uses a small
   * value to exercise the scoped-adoption-proposal path without generating a 5000-file fixture. */
  readonly sizeThresholds?: SizeThresholds;
}

export interface AdoptRunResult {
  /** Set, and every other field left unset, when the target repository triggered `17` §17.2 phase
   * 1's own size gate and `options.scope` was not given — "adopt proposes a scoped adoption... rather
   * than attempting the whole thing." */
  readonly scopedProposal?: ScopedAdoptionProposal;
  readonly survey: SurveyResult;
  readonly inventory: Inventory;
  /** Set only when `options.depth !== 'quick'` — "`quick` runs phases 1-2 plus a minimal
   * cartography," which this piece takes literally: `quick` still runs whatever CARTOGRAPHY
   * `AdoptContext.runCartography` itself already scopes down for a fast pass, but skips INFERENCE/
   * VERIFICATION/RECONSTRUCTION/GAP-ANALYSIS/BASELINE/confirmation entirely, matching phase 8's own
   * placement at the very end of the full pipeline `quick` is explicitly not meant to run. */
  readonly cartography: CartographyResult;
  readonly inference?: InferenceResult;
  readonly verification?: VerificationResult;
  readonly reconstruction?: ReconstructionResult;
  readonly gapAnalysis?: GapAnalysisResult;
  readonly confirmation?: ConfirmationFlowResult;
  readonly baseline?: BaselineSnapshot;
  /** Real, disclosed limitations of *this particular run* a caller/CLI surface should show, never
   * silently absorbed — e.g. "CARTOGRAPHY/INFERENCE did not run" (see this file's own top-of-file
   * scope note), which a fresh critic round found had real downstream consequences worth surfacing
   * explicitly rather than leaving a caller to infer from an empty `cartography.findings` array: with
   * no dispatch supplied, the knowledge/safety gap classes cannot find their own real-world examples
   * at all, and `G-Adopt`'s "high-impact-claims-resolved" condition is vacuously satisfied (there are
   * no claims to resolve), not a real confirmation that none exist. */
  readonly warnings: readonly string[];
}

const EMPTY_CARTOGRAPHY: CartographyResult = { findings: [], rejected: [], sharedWriteTables: [] };
const EMPTY_INFERENCE: InferenceResult = { findings: [], rejected: [] };
const EMPTY_VERIFICATION: VerificationResult = { findings: [], gaps: [] };

/** Never forces a guess — `17` §17.3's own literal rule, applied as this function's safe default for a
 * caller that supplies no real interactive prompt. */
const DEFAULT_ASK: AskConfirmation = (batch) =>
  Promise.resolve(new Map(batch.map((r) => [r.claim.id, 'unknown' as const])));

/** Turns every CARTOGRAPHY/INFERENCE finding into a `ConfirmableClaim` for `17` §17.3's own flow —
 * `impact` is derived structurally from the finding's own kind, never guessed per-statement: a
 * `data-ownership`/shared-write claim is `high` impact (getting data ownership wrong risks real data
 * loss or corruption), a `component`/`layering`/`runtime-topology`/`critical-path` claim is `medium`
 * (architectural, but not itself destructive if wrong), an INFERENCE claim (already capped at
 * `low`/`medium` confidence by INFERENCE itself) is `low` impact. */
function toConfirmableClaims(
  cartography: CartographyResult,
  inference: InferenceResult,
): readonly ConfirmableClaim[] {
  const claims: ConfirmableClaim[] = [];
  for (const finding of cartography.findings) {
    const impact: ClaimImpact = finding.kind === 'data-ownership' ? 'high' : 'medium';
    claims.push({
      id: `cartography:${finding.kind}:${finding.statement}`,
      section: 'architecture',
      statement: finding.statement,
      evidence: finding.evidence,
      confidence: finding.confidence,
      impact,
      consequenceIfWrong:
        finding.kind === 'data-ownership'
          ? 'A wrong data-ownership claim risks uncoordinated writes or data loss.'
          : 'A wrong structural claim risks agents making decisions against an incorrect architecture.',
    });
  }
  for (const finding of inference.findings) {
    claims.push({
      id: `inference:${finding.kind}:${finding.statement}`,
      section: 'engineering',
      statement: finding.statement,
      evidence: finding.evidence,
      confidence: finding.confidence,
      impact: 'low',
      consequenceIfWrong:
        'A wrong inferred convention/intent risks generated code following the wrong pattern.',
    });
  }
  return claims;
}

async function ensureReportsDir(paths: ProjectPaths): Promise<void> {
  await ensureDir(paths.resolveWithin('reports/adoption'));
}

async function writeInventoryReport(paths: ProjectPaths, inventory: Inventory): Promise<void> {
  await ensureReportsDir(paths);
  await writeFileAtomic(
    paths.resolveWithin(INVENTORY_REPORT_RELATIVE_PATH),
    `${JSON.stringify(inventory, null, 2)}\n`,
  );
}

/**
 * Reads and JSON-parses `target`, running `isValid` over the parsed value before ever casting it to
 * `T` — returns `undefined` for a missing file, a genuine JSON syntax error, *or* a structurally
 * wrong shape (an older report-file schema, a hand-edited/truncated file), rather than throwing a bare
 * `SyntaxError` or silently trusting a wrong shape whose missing fields would later read back as
 * `undefined` and be mistaken for "no drift" by `diffBaselines`/`adoptIncremental`. A fresh critic
 * round found the original version of this file did neither — the identical "discard corrupt cache
 * with a warning, never crash" contract `@forge/core/ids`'s own `KbIdAllocator`/id-cache reader already
 * establishes for the same class of problem (a self-written report file this process itself produced,
 * which can still be corrupted by an interrupted write, a manual edit, or a stale schema version).
 */
async function readJsonReportIfValid<T>(
  target: AbsolutePath,
  isValid: (value: unknown) => value is T,
): Promise<T | undefined> {
  if (!(await pathExists(target))) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readTextFile(target));
  } catch {
    // The identical "discard corrupt, warn, don't crash" shape `KbIdAllocator`'s own id-cache reader
    // already uses for a self-written, potentially-corrupted file.
    // eslint-disable-next-line no-console -- see the comment above.
    console.warn(`forge adopt: discarding unparsable report at ${target} (invalid JSON).`);
    return undefined;
  }
  if (!isValid(parsed)) {
    // eslint-disable-next-line no-console -- see the comment above.
    console.warn(
      `forge adopt: discarding report at ${target} (does not match the expected shape).`,
    );
    return undefined;
  }
  return parsed;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isInventoryShaped(value: unknown): value is Inventory {
  return (
    isPlainObject(value) &&
    isPlainObject(value['dependencyGraph']) &&
    Array.isArray(value['dependencyGraph']['nodes']) &&
    Array.isArray(value['publicApiSurface']) &&
    Array.isArray(value['dataSurface']) &&
    Array.isArray(value['configSurface']) &&
    Array.isArray(value['externalDependencies'])
  );
}

function isSurveyResultShaped(value: unknown): value is SurveyResult {
  return isPlainObject(value) && isPlainObject(value['survey']) && isPlainObject(value['gate']);
}

function isBaselineSnapshotShaped(value: unknown): value is BaselineSnapshot {
  return (
    isPlainObject(value) &&
    typeof value['createdAt'] === 'string' &&
    isPlainObject(value['facts']) &&
    isPlainObject(value['gate'])
  );
}

async function readInventoryReport(paths: ProjectPaths): Promise<Inventory | undefined> {
  return readJsonReportIfValid(
    paths.resolveWithin(INVENTORY_REPORT_RELATIVE_PATH),
    isInventoryShaped,
  );
}

async function readSurveyReport(paths: ProjectPaths): Promise<Survey | undefined> {
  const parsed = await readJsonReportIfValid(
    paths.resolveWithin('reports/adoption/survey.json'),
    isSurveyResultShaped,
  );
  return parsed?.survey;
}

/**
 * `17` §17.4's own six brownfield adjustments key off a project's own `adopted: true` marker
 * (`PLAN-M10.md` P20) — no prior piece ever wrote one (confirmed directly before writing this
 * function: `grep -rn "adopted" packages/kb/src/adopt` returns nothing but doc-comment prose). Sets
 * `.forge/config.yaml`'s own `project.adopted` to `true`, once, the same schema-revalidate-then-
 * `writeFileAtomic` write `packages/cli/src/commands/config.ts`'s own `configSet` already establishes
 * for every other config write in this codebase — not a second, invented write path.
 *
 * Tolerant of a missing or invalid config file rather than throwing: `adopt.ts`'s own real test fixtures
 * (and, realistically, a target repository reached via `03` §3.1's own "adopt-or-init" branch before
 * `forge init` has ever run) may have no `.forge/config.yaml` at all yet. A caller that cares whether
 * the marker was actually written reads `AdoptRunResult.warnings` for the disclosed reason it was not,
 * rather than this function throwing and aborting an otherwise-successful adoption run over a config
 * file it has no mandate to create from scratch (`forge init`'s own job, not this one's).
 */
async function markProjectAdopted(paths: ProjectPaths): Promise<string | undefined> {
  const configTarget = paths.resolveWithin(CONFIG_REL_PATH);
  if (!(await pathExists(configTarget))) {
    return (
      'project.adopted was not recorded: no .forge/config.yaml exists yet for this project ' +
      '(run forge init to create one, then re-run forge adopt, so the marker can persist).'
    );
  }
  let raw: unknown;
  try {
    raw = YAML.parse(await readTextFile(configTarget));
  } catch {
    return 'project.adopted was not recorded: .forge/config.yaml could not be parsed as YAML.';
  }
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    return 'project.adopted was not recorded: .forge/config.yaml did not validate against the real config schema.';
  }
  if (parsed.data.project.adopted) return undefined;
  const updated: ForgeConfig = {
    ...parsed.data,
    project: { ...parsed.data.project, adopted: true },
  };
  await writeFileAtomic(configTarget, YAML.stringify(updated));
  return undefined;
}

/**
 * Runs `17` §17.2's full eight-phase pipeline (or a `quick` prefix of it — see `AdoptRunResult`'s own
 * doc comment) against a real, on-disk target repository. Every deterministic phase runs for real
 * (SURVEY, INVENTORY, VERIFICATION unless `--no-verify`, RECONSTRUCTION, GAP ANALYSIS, BASELINE); the
 * two LLM-dispatch phases (CARTOGRAPHY, INFERENCE) run for real when `ctx.runCartography`/
 * `runInference` are supplied, and honestly empty otherwise (see this file's own top-of-file scope
 * note).
 */
export async function adopt(
  ctx: AdoptContext,
  options: AdoptOptions = {},
): Promise<AdoptRunResult> {
  const clock = ctx.clock ?? SYSTEM_CLOCK;
  const kbRoot = ctx.kbRoot ?? DEFAULT_KB_ROOT;
  const owner = ctx.owner ?? 'adoption';
  const depth = options.depth ?? 'standard';
  const targetRoot = options.dir ?? ctx.paths.resolveWithin('.');

  const gitProfile = await analyzeGitProfile(targetRoot, { clock: toVcsClock(clock) });
  const surveyResult = await runSurvey({
    rootDir: targetRoot,
    gitProfile,
    ...(ctx.sizeThresholds === undefined ? {} : { sizeThresholds: ctx.sizeThresholds }),
  });

  if (surveyResult.gate.triggered && options.scope === undefined) {
    const emptyInventory: Inventory = {
      dependencyGraph: { nodes: [], cycles: [] },
      publicApiSurface: [],
      dataSurface: [],
      configSurface: [],
      externalDependencies: [],
    };
    return {
      survey: surveyResult,
      inventory: emptyInventory,
      cartography: EMPTY_CARTOGRAPHY,
      warnings: [],
      ...(surveyResult.gate.proposal === undefined
        ? {}
        : { scopedProposal: surveyResult.gate.proposal }),
    };
  }

  const warnings: string[] = [];
  const deepOptions = { deep: depth === 'deep' };
  if (ctx.runCartography === undefined || ctx.runInference === undefined) {
    warnings.push(
      'CARTOGRAPHY/INFERENCE dispatch was not provided for this run (AdoptContext.runCartography/' +
        'runInference) — knowledge/safety gap classes that depend on them cannot find their own ' +
        "real-world examples, and G-Adopt's high-impact-claims-resolved condition is vacuously " +
        'satisfied rather than a real confirmation that no unconfirmed high-impact claim exists.',
    );
  }

  const inventory = await runInventory({ rootDir: targetRoot, survey: surveyResult.survey });
  await writeSurveyReport(ctx.paths, surveyResult);
  await writeInventoryReport(ctx.paths, inventory);

  const cartography = ctx.runCartography
    ? await ctx.runCartography(surveyResult.survey, inventory, deepOptions)
    : EMPTY_CARTOGRAPHY;

  if (depth === 'quick') {
    return { survey: surveyResult, inventory, cartography, warnings };
  }

  const inference = ctx.runInference
    ? await ctx.runInference(surveyResult.survey, inventory, deepOptions)
    : EMPTY_INFERENCE;

  const verification = options.noVerify
    ? EMPTY_VERIFICATION
    : await runVerificationPhase({
        sourceRoot: targetRoot,
        survey: surveyResult.survey,
        inventory,
        cartographyFindings: cartography.findings,
        inferenceFindings: inference.findings,
        clock,
      });

  const reconstruction = await writeReconstruction(
    { paths: ctx.paths, clock, kbRoot },
    { cartography, inference, verification, dependencyGraph: inventory.dependencyGraph },
  );

  const gapAnalysis = analyzeGaps({
    survey: surveyResult.survey,
    inventory,
    cartography,
    inference,
    verification,
    inferenceRan: ctx.runInference !== undefined,
  });
  await ensureReportsDir(ctx.paths);
  await writeFileAtomic(
    ctx.paths.resolveWithin(GAP_REPORT_RELATIVE_PATH),
    renderGapsReport(gapAnalysis),
  );
  await writeGapArtifacts({ paths: ctx.paths, clock, kbRoot }, owner, gapAnalysis);

  const claims = toConfirmableClaims(cartography, inference);
  const confirmation = await runConfirmationFlow(
    { paths: ctx.paths, clock, kbRoot },
    owner,
    claims,
    ctx.ask ?? DEFAULT_ASK,
    CONFIRMATION_QUESTION_CAP,
  );

  const highImpactClaims = claims
    .filter((c) => c.impact === 'high')
    .map((c) => ({
      claim: c,
      outcome: confirmation.outcomes.find((o) => o.claimId === c.id),
    }));

  const tree = await parseKbTree(ctx.paths, kbRoot);
  const lintFindings = lintKb(tree, { capabilities: [], epics: [] }, 'L1', new Date(clock.now()));
  const lintErrors = lintFindings.filter((f) => f.severity === 'error').map((f) => f.message);

  const gate = evaluateGAdoptGate({
    kbLint: { clean: lintErrors.length === 0, errors: lintErrors },
    highImpactClaims,
    verification,
    gapReportExists: true,
  });

  const facts = computeMeasuredFacts(
    { survey: surveyResult.survey, inventory, verification, gapAnalysis },
    clock.now(),
  );

  const headSha = await resolveHeadShaOrUndefined(targetRoot);
  if (headSha === undefined) {
    warnings.push(
      'The target repository has no commits yet, so no real BASELINE tag/commit could be created — ' +
        '`baseline.tag`/`baseline.commit` are both undefined, not a fabricated tag name.',
    );
  }
  let tagExistsNow = false;
  if (headSha !== undefined) {
    tagExistsNow = await tagExists(targetRoot, BASELINE_TAG_NAME);
    if (!tagExistsNow) {
      await createAnnotatedTag(
        targetRoot,
        BASELINE_TAG_NAME,
        `FORGE adoption baseline\n\n${JSON.stringify(facts)}`,
        headSha,
      );
      tagExistsNow = true;
    }
  }
  const baseline: BaselineSnapshot = {
    tag: tagExistsNow ? BASELINE_TAG_NAME : undefined,
    commit: headSha,
    createdAt: clock.now(),
    facts,
    gate,
  };
  await ensureReportsDir(ctx.paths);
  await writeFileAtomic(
    ctx.paths.resolveWithin(BASELINE_REPORT_RELATIVE_PATH),
    `${JSON.stringify(baseline, null, 2)}\n`,
  );

  // `17` §17.4's own brownfield adjustments key off this marker (`markProjectAdopted`'s own doc
  // comment) — set once a full (non-`quick`, non-scoped-proposal) run reaches this point, regardless
  // of whether `G-Adopt` itself passed: "this project went through adoption" is a fact about its
  // origin, not a quality gate outcome.
  const adoptedMarkerWarning = await markProjectAdopted(ctx.paths);
  if (adoptedMarkerWarning !== undefined) warnings.push(adoptedMarkerWarning);

  return {
    survey: surveyResult,
    inventory,
    cartography,
    inference,
    verification,
    reconstruction,
    gapAnalysis,
    confirmation,
    baseline,
    warnings,
  };
}

/** `forge adopt --report` — re-prints the survey/gaps already on disk from a prior run, without
 * re-running anything. */
export interface AdoptReportResult {
  readonly survey: Survey | undefined;
  readonly gapsReport: string | undefined;
  readonly baseline: BaselineSnapshot | undefined;
}

export async function adoptReport(ctx: AdoptContext): Promise<AdoptReportResult> {
  const survey = await readSurveyReport(ctx.paths);
  const gapsTarget = ctx.paths.resolveWithin(GAP_REPORT_RELATIVE_PATH);
  const gapsReport = (await pathExists(gapsTarget)) ? await readTextFile(gapsTarget) : undefined;
  const baseline = await baselineShow(ctx);
  return { survey, gapsReport, baseline };
}

/** `forge baseline show`. */
export async function baselineShow(ctx: AdoptContext): Promise<BaselineSnapshot | undefined> {
  return readJsonReportIfValid(
    ctx.paths.resolveWithin(BASELINE_REPORT_RELATIVE_PATH),
    isBaselineSnapshotShaped,
  );
}

/** `forge baseline diff` — a fresh `MeasuredFacts` snapshot (from whatever survey/inventory/
 * verification/gap-analysis reports are currently on disk, re-run) compared against the stored
 * baseline. Throws a real, actionable error if no baseline exists yet — there is nothing to diff
 * against. */
export async function baselineDiff(
  ctx: AdoptContext,
  options: AdoptOptions = {},
): Promise<BaselineDiff> {
  const previous = await baselineShow(ctx);
  if (previous === undefined) {
    throw new ForgeError('USR-003', { feature: 'forge baseline diff (no baseline recorded yet)' });
  }
  const clock = ctx.clock ?? SYSTEM_CLOCK;
  const targetRoot = options.dir ?? ctx.paths.resolveWithin('.');
  const gitProfile = await analyzeGitProfile(targetRoot, { clock: toVcsClock(clock) });
  const surveyResult = await runSurvey({ rootDir: targetRoot, gitProfile });
  const inventory = await runInventory({ rootDir: targetRoot, survey: surveyResult.survey });
  const verification = options.noVerify
    ? EMPTY_VERIFICATION
    : await runVerificationPhase({
        sourceRoot: targetRoot,
        survey: surveyResult.survey,
        inventory,
        cartographyFindings: [],
        inferenceFindings: [],
        clock,
      });
  const gapAnalysis = analyzeGaps({
    survey: surveyResult.survey,
    inventory,
    cartography: EMPTY_CARTOGRAPHY,
    inference: EMPTY_INFERENCE,
    inferenceRan: false,
    verification,
  });
  const current = computeMeasuredFacts(
    { survey: surveyResult.survey, inventory, verification, gapAnalysis },
    clock.now(),
  );
  return diffBaselines(previous, current);
}

export interface IncrementalReport {
  /** `17` §17.5: "new components/routes/tables not in the KB (someone built something
   * undocumented)." Each is the exact `PublicApiSurfaceSignal`/`DataSurfaceSignal` name+kind pair
   * that appears in the freshly-recomputed `Inventory` but not in the last stored one. */
  readonly newRoutes: readonly string[];
  readonly newComponents: readonly string[];
  readonly newTables: readonly string[];
  readonly gapDeltas: BaselineDiff | undefined;
}

function diffNames(
  previous: readonly { readonly kind: string; readonly name: string | undefined }[],
  current: readonly { readonly kind: string; readonly name: string | undefined }[],
): readonly string[] {
  const priorKeys = new Set(previous.map((s) => `${s.kind}:${s.name ?? ''}`));
  return current
    .filter((s) => !priorKeys.has(`${s.kind}:${s.name ?? ''}`))
    .map((s) => `${s.kind}:${s.name ?? '(unnamed)'}`);
}

/**
 * `forge adopt --incremental` — `17` §17.5: re-runs SURVEY through INVENTORY (never CARTOGRAPHY/
 * INFERENCE/VERIFICATION — those are LLM/build dispatches too expensive to re-run on every
 * incremental check) and diffs the result against whatever `reports/adoption/inventory.json` a prior
 * `forge adopt` run last wrote, plus the stored baseline's own measured facts when one exists.
 */
export async function adoptIncremental(
  ctx: AdoptContext,
  options: AdoptOptions = {},
): Promise<IncrementalReport> {
  const clock = ctx.clock ?? SYSTEM_CLOCK;
  const targetRoot = options.dir ?? ctx.paths.resolveWithin('.');
  const previousInventory = await readInventoryReport(ctx.paths);

  const gitProfile = await analyzeGitProfile(targetRoot, { clock: toVcsClock(clock) });
  const surveyResult = await runSurvey({ rootDir: targetRoot, gitProfile });
  const inventory = await runInventory({ rootDir: targetRoot, survey: surveyResult.survey });
  await writeSurveyReport(ctx.paths, surveyResult);
  await writeInventoryReport(ctx.paths, inventory);

  const newRoutes = previousInventory
    ? diffNames(
        previousInventory.publicApiSurface.filter((s) => s.kind === 'http-route'),
        inventory.publicApiSurface.filter((s) => s.kind === 'http-route'),
      )
    : [];
  const newComponents = previousInventory
    ? diffNames(
        previousInventory.publicApiSurface
          .filter((s) => s.kind !== 'http-route')
          .map((s) => ({ kind: s.kind, name: s.name })),
        inventory.publicApiSurface
          .filter((s) => s.kind !== 'http-route')
          .map((s) => ({ kind: s.kind, name: s.name })),
      )
    : [];
  const newTables = previousInventory
    ? diffNames(previousInventory.dataSurface, inventory.dataSurface)
    : [];

  const baseline = await baselineShow(ctx);
  let gapDeltas: BaselineDiff | undefined;
  if (baseline !== undefined) {
    const verification = options.noVerify
      ? EMPTY_VERIFICATION
      : await runVerificationPhase({
          sourceRoot: targetRoot,
          survey: surveyResult.survey,
          inventory,
          cartographyFindings: [],
          inferenceFindings: [],
          clock,
        });
    const gapAnalysis = analyzeGaps({
      survey: surveyResult.survey,
      inventory,
      cartography: EMPTY_CARTOGRAPHY,
      inference: EMPTY_INFERENCE,
      inferenceRan: false,
      verification,
    });
    const currentFacts = computeMeasuredFacts(
      { survey: surveyResult.survey, inventory, verification, gapAnalysis },
      clock.now(),
    );
    gapDeltas = diffBaselines(baseline, currentFacts);
  }

  return { newRoutes, newComponents, newTables, gapDeltas };
}
