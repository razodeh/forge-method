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
 * needs no such context — it is wired for real, unconditionally, below. `specs/22` M17 P17 revisited
 * this note (`SPEC-QUESTIONS.md`) rather than assuming it still held, and left it as-is: nothing in
 * P11 (the adapter's own structured-output parsing) or P7 (test adoption, see immediately below)
 * reduces the cost of constructing an `ExecuteStepContext` from nothing for a single read-only scan,
 * and this piece's own builder environment has no live model session to wire or test such a path
 * against regardless.
 *
 * **Test-adoption wiring** (`specs/22` M17 P17, `SPEC-QUESTIONS.md`): this piece additionally runs
 * `forge test adopt`'s own deterministic detection (`loop/test/adopt.ts`'s `runDetectionAndStage`) as
 * a real step of this pipeline, so an adopted project's real `execution.testCommands` is established,
 * not left to a separate command a caller must remember to run — see `AdoptRunResult.testAdoption`'s
 * own doc comment for the full shape and its own disclosed limitation.
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
  ProjectPaths,
  type AbsolutePath,
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
import { DETECTED_LAYER } from './loop/test/detect.ts';
import {
  readStagedProposal,
  runDetectionAndStage,
  type DetectionStageOutcome,
} from './loop/test/adopt.ts';

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
   * path/module (a real, disclosed scope narrowing, surfaced as a real `warnings` entry below, a
   * gauntlet critic finding, `SPEC-QUESTIONS.md`); a future piece can thread `scope` into
   * `runSurvey`/`runInventory`'s own file-walk without changing this option's shape. */
  readonly scope?: string;
  readonly depth?: AdoptDepth;
  readonly noVerify?: boolean;
  /** `03` §3.2's global `--dry-run`: "Plan and print; make no writes, spawn no sessions" (a gauntlet
   * critic finding, `SPEC-QUESTIONS.md` — the real CLI wiring originally never read this flag at all,
   * so `forge adopt --dry-run` ran the full real pipeline, including the one-shot `BASELINE` tag `17`
   * §17.2 phase 8 never recreates or moves once it exists). Every read-only scan/computation still
   * runs for real (SURVEY, INVENTORY, GAP ANALYSIS, measured facts, the `G-Adopt` gate's own verdict)
   * so the printed plan is a real preview, not a guess; every write, subprocess spawn (VERIFICATION's
   * real build/test execution) and session dispatch (CARTOGRAPHY/INFERENCE) is skipped, each with its
   * own `warnings` entry naming what would have happened. Defaults to `false`. */
  readonly dryRun?: boolean;
}

export interface AdoptContext {
  readonly paths: ProjectPaths;
  readonly clock?: Clock;
  /** The real process environment VERIFICATION's own detected build/test command is confined to
   * (`runVerificationPhase`'s own `VerificationPhaseInput.env`, `PLAN-M14.md` P28) — required, matching
   * `KbCommandContext.env`'s own "no ambient read here" rule (R10): `forge adopt` has no real CLI
   * composition root yet (`bin.ts` does not dispatch it), so there is no single place to default this
   * the way `buildKbContext` defaults `KbCommandContext.env` from `realEnvSnapshot()` for `forge kb
   * verify` — a caller that wires `forge adopt` into the CLI supplies a real snapshot the identical way;
   * a test supplies its own synthetic one. */
  readonly env: Readonly<Record<string, string | undefined>>;
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
  /** `forge test adopt`'s own real, deterministic detection (`loop/test/adopt.ts`'s
   * `runDetectionAndStage`), run as part of this pipeline so an adopted project's REAL test
   * configuration is established, not left to a separate, unconnected command a caller has to
   * remember to run on their own (`SPEC-QUESTIONS.md`, this piece's own DECISION — "adopted end to
   * end" includes the project's own `execution.testCommands`, which is exactly what `forge test
   * adopt` already detects). A confident detection stages a real `.forge/test-adopt/<layer>.
   * proposal.yaml` proposal; it is never promoted into the live config here — that still needs a
   * passing translator proof and a human `G-TestAdopt` approval via the standalone `forge test
   * adopt --write`, exactly as every other staged proposal already requires (`13` F-TEST-11). An
   * unconfident detection hands off, named in `warnings`, to `forge test adopt --agent`. Set for
   * every real run (every `depth`, with or without `--no-verify` — detection reads only manifests/
   * CI config, no sandboxed build or test execution, the identical cheap-and-deterministic class of
   * work SURVEY/INVENTORY already do); unset only for the size-gated scoped-adoption-proposal
   * return above, where no real target has been chosen yet to detect anything for.
   *
   * Runs against `ctx.paths`, not `options.dir`/the resolved `targetRoot` — identical to every
   * other report-writing phase in this function (`writeSurveyReport`/`writeInventoryReport`/GAP
   * ANALYSIS/BASELINE all write to `ctx.paths` regardless of `targetRoot`): a disclosed, bounded
   * limitation for the (currently untested, and likely rare) case a caller explicitly adopts a
   * DIFFERENT directory than `ctx.paths`'s own project root — `runDetectionAndStage` has no
   * separate scan-root/write-root split to thread `targetRoot` through for only this one phase
   * without the identical change needed everywhere else in this file. */
  readonly testAdoption?: DetectionStageOutcome;
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
  const dryRun = options.dryRun ?? false;
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
  if (options.scope !== undefined) {
    // A gauntlet critic finding: `--scope` is reachable from the real CLI (M17 P17) and genuinely
    // bypasses phase 1's own size gate, but this piece does not itself narrow SURVEY/INVENTORY's own
    // file walk to the named path/module (see `AdoptOptions.scope`'s own doc comment) — disclosed
    // here, the identical idiom the CARTOGRAPHY/INFERENCE warning below already uses, rather than a
    // silent no-op a caller could mistake for real scoping.
    warnings.push(
      `--scope ${JSON.stringify(options.scope)} only bypasses phase 1's own size gate for this run — ` +
        "it does not itself narrow SURVEY/INVENTORY's own file walk to that path/module, so the rest " +
        'of this run still scans the whole repository.',
    );
  }
  if (ctx.runCartography === undefined || ctx.runInference === undefined) {
    warnings.push(
      'CARTOGRAPHY/INFERENCE dispatch was not provided for this run (AdoptContext.runCartography/' +
        'runInference) — knowledge/safety gap classes that depend on them cannot find their own ' +
        "real-world examples, and G-Adopt's high-impact-claims-resolved condition is vacuously " +
        'satisfied rather than a real confirmation that no unconfirmed high-impact claim exists.',
    );
  }
  if (dryRun && (ctx.runCartography !== undefined || ctx.runInference !== undefined)) {
    warnings.push(
      '(dry run — CARTOGRAPHY/INFERENCE dispatch was supplied but not invoked: --dry-run spawns no ' +
        'model sessions.)',
    );
  }

  const inventory = await runInventory({ rootDir: targetRoot, survey: surveyResult.survey });
  if (dryRun) {
    warnings.push(
      '(dry run — would have written reports/adoption/survey.json and ' +
        'reports/adoption/inventory.json; neither was written.)',
    );
  } else {
    await writeSurveyReport(ctx.paths, surveyResult);
    await writeInventoryReport(ctx.paths, inventory);
  }

  // See `AdoptRunResult.testAdoption`'s own doc comment for why this runs against a `targetRoot`-
  // rooted `ProjectPaths` for the scan but `ctx.paths` for the write, for every depth, with no
  // `--no-verify` gate: it is deterministic detection, not a build/test run. Skipped wholesale under
  // `--dry-run` (it writes a real staged-proposal file); skipped when an existing staged proposal for
  // this layer already carries a passing translator proof, so a confident-but-unproven re-detection
  // never silently overwrites proven, human-reviewable work with an unproven one (a gauntlet critic
  // finding: the agent-staged `source: 'agent'` proposal `forge test adopt --agent` produces is real
  // work a human may already be mid-review-and-approval on).
  let testAdoption: DetectionStageOutcome | undefined;
  if (dryRun) {
    warnings.push(
      "(dry run — test-command detection/staging was skipped; would have run forge test adopt's " +
        'own detection against this repository and staged a proposal if confident.)',
    );
  } else {
    const existingProposal = await readStagedProposal(ctx.paths, DETECTED_LAYER);
    if (existingProposal.outcome === 'found' && existingProposal.record.proof?.ok === true) {
      warnings.push(
        `An already-proven staged test-adoption proposal exists for layer "${DETECTED_LAYER}" ` +
          `(source: ${existingProposal.record.source}) -- re-detection was skipped so it is not ` +
          'silently overwritten by an unproven one.',
      );
    } else {
      testAdoption = await runDetectionAndStage(ctx.paths, new ProjectPaths(targetRoot));
      if (testAdoption.outcome === 'handoff') {
        warnings.push(
          `No confident test-command detection for this project (${testAdoption.candidate.reason}) -- ` +
            'run "forge test adopt --agent" to investigate and stage a proposal.',
        );
      }
    }
  }

  const cartography =
    !dryRun && ctx.runCartography
      ? await ctx.runCartography(surveyResult.survey, inventory, deepOptions)
      : EMPTY_CARTOGRAPHY;

  if (depth === 'quick') {
    return {
      survey: surveyResult,
      inventory,
      cartography,
      warnings,
      ...(testAdoption === undefined ? {} : { testAdoption }),
    };
  }

  const inference =
    !dryRun && ctx.runInference
      ? await ctx.runInference(surveyResult.survey, inventory, deepOptions)
      : EMPTY_INFERENCE;

  let verification: VerificationResult;
  if (options.noVerify) {
    verification = EMPTY_VERIFICATION;
  } else if (dryRun) {
    warnings.push(
      '(dry run — would have run the real, sandboxed build/test verification (a real git clone and ' +
        'subprocess); no subprocess was spawned.)',
    );
    verification = EMPTY_VERIFICATION;
  } else {
    verification = await runVerificationPhase({
      sourceRoot: targetRoot,
      survey: surveyResult.survey,
      inventory,
      cartographyFindings: cartography.findings,
      inferenceFindings: inference.findings,
      clock,
      env: ctx.env,
    });
  }

  let reconstruction: ReconstructionResult | undefined;
  if (dryRun) {
    warnings.push(
      '(dry run — would have written the KB reconstruction (architecture/data/delivery/engineering/' +
        'decisions); nothing was written.)',
    );
  } else {
    reconstruction = await writeReconstruction(
      { paths: ctx.paths, clock, kbRoot },
      { cartography, inference, verification, dependencyGraph: inventory.dependencyGraph },
    );
  }

  const gapAnalysis = analyzeGaps({
    survey: surveyResult.survey,
    inventory,
    cartography,
    inference,
    verification,
    inferenceRan: ctx.runInference !== undefined,
  });
  if (dryRun) {
    warnings.push(
      '(dry run — would have written reports/adoption/gaps.md and the real RISK-###/OQ-### gap ' +
        'artifacts; nothing was written.)',
    );
  } else {
    await ensureReportsDir(ctx.paths);
    await writeFileAtomic(
      ctx.paths.resolveWithin(GAP_REPORT_RELATIVE_PATH),
      renderGapsReport(gapAnalysis),
    );
    await writeGapArtifacts({ paths: ctx.paths, clock, kbRoot }, owner, gapAnalysis);
  }

  const claims = toConfirmableClaims(cartography, inference);
  let confirmation: ConfirmationFlowResult | undefined;
  if (dryRun) {
    warnings.push(
      `(dry run — would have run the human-confirmation flow over ${String(claims.length)} real ` +
        'claim(s); no prompt was shown and no OQ-### was written.)',
    );
  } else {
    confirmation = await runConfirmationFlow(
      { paths: ctx.paths, clock, kbRoot },
      owner,
      claims,
      ctx.ask ?? DEFAULT_ASK,
      CONFIRMATION_QUESTION_CAP,
    );
  }

  const highImpactClaims = claims
    .filter((c) => c.impact === 'high')
    .map((c) => ({
      claim: c,
      outcome: confirmation?.outcomes.find((o) => o.claimId === c.id),
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
      if (dryRun) {
        // `17` §17.2 phase 8: a `BASELINE` tag, once it exists, is never recreated or moved — a
        // one-shot, irreversible write a gauntlet critic found `--dry-run` silently performed for
        // real. Previewed here (the real `headSha` this run would have tagged), never created.
        warnings.push(
          `(dry run — would have created the real, one-shot BASELINE git tag at ${headSha}; no tag ` +
            'was created.)',
        );
      } else {
        await createAnnotatedTag(
          targetRoot,
          BASELINE_TAG_NAME,
          `FORGE adoption baseline\n\n${JSON.stringify(facts)}`,
          headSha,
        );
        tagExistsNow = true;
      }
    }
  }
  const baseline: BaselineSnapshot = {
    tag: tagExistsNow ? BASELINE_TAG_NAME : undefined,
    commit: headSha,
    createdAt: clock.now(),
    facts,
    gate,
  };
  if (dryRun) {
    warnings.push(
      '(dry run — would have written reports/adoption/baseline.json; nothing was written.)',
    );
  } else {
    await ensureReportsDir(ctx.paths);
    await writeFileAtomic(
      ctx.paths.resolveWithin(BASELINE_REPORT_RELATIVE_PATH),
      `${JSON.stringify(baseline, null, 2)}\n`,
    );
  }

  // `17` §17.4's own brownfield adjustments key off this marker (`markProjectAdopted`'s own doc
  // comment) — set once a full (non-`quick`, non-scoped-proposal) run reaches this point, regardless
  // of whether `G-Adopt` itself passed: "this project went through adoption" is a fact about its
  // origin, not a quality gate outcome. Skipped under `--dry-run`: it is itself a real config write.
  if (dryRun) {
    warnings.push(
      '(dry run — would have set project.adopted: true in .forge/config.yaml; nothing was written.)',
    );
  } else {
    const adoptedMarkerWarning = await markProjectAdopted(ctx.paths);
    if (adoptedMarkerWarning !== undefined) warnings.push(adoptedMarkerWarning);
  }

  return {
    survey: surveyResult,
    inventory,
    cartography,
    inference,
    verification,
    gapAnalysis,
    baseline,
    warnings,
    ...(reconstruction === undefined ? {} : { reconstruction }),
    ...(confirmation === undefined ? {} : { confirmation }),
    ...(testAdoption === undefined ? {} : { testAdoption }),
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
  const dryRun = options.dryRun ?? false;
  const targetRoot = options.dir ?? ctx.paths.resolveWithin('.');
  const gitProfile = await analyzeGitProfile(targetRoot, { clock: toVcsClock(clock) });
  const surveyResult = await runSurvey({ rootDir: targetRoot, gitProfile });
  const inventory = await runInventory({ rootDir: targetRoot, survey: surveyResult.survey });
  let verification: VerificationResult;
  if (options.noVerify) {
    verification = EMPTY_VERIFICATION;
  } else if (dryRun) {
    // `BaselineDiff` (`@forge/kb/adopt`) carries no `warnings` field of its own for this function to
    // append to — the identical direct-`console.warn` disclosure `readJsonReportIfValid` above
    // already uses for the same reason (a self-contained data shape this file does not own and does
    // not widen). `forge baseline diff` is not wired into the real CLI yet (a gauntlet-critic finding
    // recorded `SPEC-QUESTIONS.md`), so this is reached only by a direct library caller today.
    // eslint-disable-next-line no-console -- see the comment above.
    console.warn(
      '(dry run — would have run the real, sandboxed build/test verification (a real git clone and ' +
        'subprocess); no subprocess was spawned.)',
    );
    verification = EMPTY_VERIFICATION;
  } else {
    verification = await runVerificationPhase({
      sourceRoot: targetRoot,
      survey: surveyResult.survey,
      inventory,
      cartographyFindings: [],
      inferenceFindings: [],
      clock,
      env: ctx.env,
    });
  }
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
  /** `(dry run — would have...)` notices — see `AdoptRunResult.warnings`'s own sibling field; this
   * form has the identical two write/subprocess call sites (survey+inventory reports, VERIFICATION's
   * real build/test subprocess) a gauntlet critic found `--dry-run` silently ran for real. */
  readonly warnings: readonly string[];
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
  const dryRun = options.dryRun ?? false;
  const targetRoot = options.dir ?? ctx.paths.resolveWithin('.');
  const previousInventory = await readInventoryReport(ctx.paths);
  const warnings: string[] = [];

  const gitProfile = await analyzeGitProfile(targetRoot, { clock: toVcsClock(clock) });
  const surveyResult = await runSurvey({ rootDir: targetRoot, gitProfile });
  const inventory = await runInventory({ rootDir: targetRoot, survey: surveyResult.survey });
  if (dryRun) {
    warnings.push(
      '(dry run — would have written reports/adoption/survey.json and ' +
        'reports/adoption/inventory.json; neither was written.)',
    );
  } else {
    await writeSurveyReport(ctx.paths, surveyResult);
    await writeInventoryReport(ctx.paths, inventory);
  }

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
    let verification: VerificationResult;
    if (options.noVerify) {
      verification = EMPTY_VERIFICATION;
    } else if (dryRun) {
      warnings.push(
        '(dry run — would have run the real, sandboxed build/test verification (a real git clone ' +
          'and subprocess); no subprocess was spawned.)',
      );
      verification = EMPTY_VERIFICATION;
    } else {
      verification = await runVerificationPhase({
        sourceRoot: targetRoot,
        survey: surveyResult.survey,
        inventory,
        cartographyFindings: [],
        inferenceFindings: [],
        clock,
        env: ctx.env,
      });
    }
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

  return { newRoutes, newComponents, newTables, gapDeltas, warnings };
}
