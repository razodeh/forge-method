/**
 * `commands/dispatch/test-binding.ts` — `forge test binding [--story <id>] [--base <ref>] [--hunks]
 * [--max-hunks <n>] [--timeout-ms <n>]` (`specs/22` M15 P4/P5, M16 P10/P11/P12, M17 P4/P13).
 *
 * **DECISION — the `TestLayerIdentity` type.** The piece brief for this extraction flagged a shared
 * `TestLayerIdentity` type as a cross-file wiring decision needing a design call, since both this
 * file and `test-run.ts` reference it. Verified directly against the real, current `bin.ts`: that
 * type is NOT private to this dispatcher at all — it is already defined and exported from
 * `commands/loop/test/binding.ts` (`specs/22` M17 P4's own real command-logic module), and `bin.ts`
 * already imported it from there, unchanged, before this extraction ever started. No new shared type
 * is needed; both `test-run.ts` and this file simply import the existing export directly. Documented
 * here because the brief anticipated a design decision that, on inspection, resolves to "reuse the
 * existing export" rather than "design something new."
 *
 * `runRawBindingCheck`/`resolveStoryById`/`resolveTestLayerIdentity` are exported because
 * `test-exempt-coverage-flaky.ts`'s own `runTestExemptCommand` reuses all three for its own
 * read-only "is this test currently non-binding" pre-check (never `runOneStoryBinding`, which writes
 * `MutationEvidence` — see that function's own doc comment).
 *
 * @see specs/22 M17 P2
 * @see specs/22 M17 P4
 */
import { FORGE_RUN_ID, type Clock, SYSTEM_CLOCK } from '@forge/core';
import { EXIT_CODES, ForgeError } from '@forge/core/errors';
import type { ProjectPaths } from '@forge/core/fs';
import type { Exemption, Story } from '@forge/schemas';
import { storySchema } from '@forge/schemas';
import type { TestCommandEntry } from '@forge/schemas/config';
import { assertCleanWorkingTree } from '@forge/vcs';

import { readConfig } from '../config.ts';
import { listSpecArtifacts, loadDoneStories } from '../shared.ts';
import {
  runBindingCheck,
  type BindingCheckCompleted,
  type TestLayerIdentity,
} from '../loop/test/binding.ts';
import { assembleAndWriteMutationEvidence } from '../loop/test/binding-evidence.ts';
import { emitBindingCheckTelemetry } from '../loop/test/check-telemetry.ts';
import { detectEcosystem } from '../loop/test/ecosystem.ts';
import {
  applyExemptions,
  describeExemptionProblems,
  loadExemptions,
} from '../loop/test/exemptions.ts';
import { createSystemTempPath } from '../loop/test/system-temp.ts';
import {
  DEFAULT_MAX_HUNKS,
  runHunkMutationCheck,
  type HunkMutationEntry,
  type HunkMutationOptions,
  type HunkMutationReport,
} from '../loop/test/hunk-mutation.ts';
import { resolveHunkModeBase } from '../loop/test/hunks.ts';
import { detectToolVersions, parseMaxHunksFlag, parseTimeoutMsFlag } from './test-run.ts';
import {
  assertNoArgs,
  parseCommandFlags,
  realEnvSnapshot,
  SPECS_ROOT,
  type DispatchContext,
} from './shared.ts';

interface TestOutcomeEntry {
  readonly name: string;
  readonly binding: boolean;
}

/** The shared "run a real binding check for one story" core, factored out of `runOneStoryBinding` so
 * `runTestExemptCommand`'s own pre-check (`PLAN-M15.md` P6: "is `testId` currently non-binding") can
 * reuse it WITHOUT also getting `runOneStoryBinding`'s own `assembleAndWriteMutationEvidence` side
 * effect — a real, read-only check against the project tree, the identical "fast local feedback,
 * never a permanent record for an exploratory run" stance `story.ts`'s own `checkBinding` already
 * takes for the same underlying check. */
export async function runRawBindingCheck(
  projectRoot: string,
  story: Story,
  testLayer: TestLayerIdentity,
  clock: Clock,
  // `specs/22` M16 P10: overrides `reporter.ts`'s own `DEFAULT_TEST_RUN_TIMEOUT_MS` for every run this
  // check makes. Optional, and the last-but-two parameter, so `runTestExemptCommand`'s own pre-check
  // call (which has no `--timeout-ms` of its own to thread) keeps compiling unchanged.
  timeoutMs?: number,
  // `specs/22` M16 P11 (`13` F-TEST-10, `--base`): the resolved sha `resolveHunkModeBase` returns for
  // a hunk-mode invocation, replacing the `'HEAD~1'` default below.
  baseRevision?: string,
  // `specs/22` M16 P12: given if and only if `--hunks` was given.
  hunkOptions?: HunkMutationOptions,
): Promise<
  | { readonly kind: 'skipped' }
  | { readonly kind: 'problem'; readonly problem: string }
  | {
      readonly kind: 'completed';
      readonly runId: string;
      readonly result: BindingCheckCompleted;
      readonly rawNonBinding: readonly string[];
      readonly hunkMutation?: HunkMutationReport;
    }
> {
  const runId = `test-binding-${story.id}-${clock.now().replace(/[^0-9]/g, '')}`;
  const input = {
    projectRoot,
    runId,
    storyId: story.id,
    filesExpected: story.files_expected,
    ...testLayer,
    integrationBase: 'HEAD',
    baseRevision: baseRevision ?? 'HEAD~1',
    clock,
    createTempPath: () => createSystemTempPath('forge-test-binding'),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    env: realEnvSnapshot(),
  };
  const { outcome: result, hunkMutation } =
    hunkOptions === undefined
      ? { outcome: await runBindingCheck(input), hunkMutation: undefined }
      : await runHunkMutationCheck(input, hunkOptions);
  if (result.outcome === 'no-test-paths') return { kind: 'skipped' };
  if (result.outcome !== 'completed') {
    const problem =
      result.outcome === 'baseline-not-green'
        ? `${String(result.failing.length)} test(s) already failing before any mutation: ${result.failing.join(', ')}.`
        : result.outcome === 'baseline-timeout'
          ? 'the baseline run timed out before any mutation; binding cannot be established.'
          : result.outcome === 'mutated-timeout'
            ? 'the mutated (reverted) run timed out; no test can be credited as bound from a run that never finished.'
            : result.outcome === 'baseline-zero-outcomes'
              ? 'the baseline run matched or collected zero tests; binding cannot be established.'
              : result.outcome === 'mutated-zero-outcomes'
                ? 'the mutated (reverted) run matched or collected zero tests; no test can be credited as bound from a run that verified nothing.'
                : result.outcome === 'structured-layer-needs-scope'
                  ? 'execution.testCommands.unit is the structured form with no "scope" template declared; binding cannot run scoped to this story\'s own tests.'
                  : result.message;
    return { kind: 'problem', problem };
  }
  const rawNonBinding = result.namedTests.filter(
    (name) => !result.failedUnderMutation.includes(name),
  );
  return {
    kind: 'completed',
    runId,
    result,
    rawNonBinding,
    ...(hunkMutation === undefined ? {} : { hunkMutation }),
  };
}

/** One story's own binding check, factored out of `runTestBindingCommand` so both its single-story
 * mode (`--story <id>`) and its discover mode (`specs/22` M15 P5: no `--story`, every `done` story)
 * share the identical runId/evidence/outcome-mapping logic. Built on `runRawBindingCheck` above,
 * adding matching against declared exemptions and writing `MutationEvidence`.
 *
 * `telemetryProjectRoot` (`specs/22` M17 Phase A hardening, `process/SPEC-QUESTIONS.md` Q324's own
 * disclosed-not-fixed sibling): `G-Verify.gate.yaml`'s own `test:binding` check runs this exact
 * command (`forge test binding --json`) as an in-run gate evaluation, with `projectRoot` resolved from
 * its own `cwd` (`runGateStep`'s own `ctx.integrationPath`, never the real project root) -- the
 * IDENTICAL mechanism gap Q324 Decision 2 fixed for `forge parity check` (`check-command.ts`'s own
 * `telemetryProjectRoot`, mirroring `story.ts`'s pre-existing `StoryVerifyContext.telemetryProjectRoot`
 * split), left unfixed here at the time ("flagged by a critic, not confirmed or chased"). Mirrors that
 * identical split exactly: `projectRoot` stays whatever this invocation's own real check needs (the
 * worktree it actually runs in), `telemetryProjectRoot` is only ever read for where the
 * `CheckRun{kind:'binding'}` event itself lands. `undefined` (the ordinary, standalone human
 * invocation, where the two always coincide) falls back to `projectRoot` unchanged. */
async function runOneStoryBinding(
  paths: ProjectPaths,
  projectRoot: string,
  telemetryProjectRoot: string | undefined,
  reportsRoot: string,
  story: Story,
  testLayer: TestLayerIdentity,
  clock: Clock,
  exemptions: readonly Exemption[],
  telemetryRunId: string | undefined,
  timeoutMs?: number,
  baseRevision?: string,
  hunkOptions?: HunkMutationOptions,
): Promise<
  | {
      readonly kind: 'completed';
      readonly storyId: string;
      readonly bound: readonly string[];
      readonly nonBinding: readonly string[];
      readonly exemptApplied: boolean;
      readonly tests: readonly TestOutcomeEntry[];
      readonly restoreVerified: boolean;
      readonly evidenceId: string;
      readonly hunkMutation?: HunkMutationReport;
    }
  | { readonly kind: 'skipped' }
  | { readonly kind: 'problem'; readonly storyId: string; readonly problem: string }
> {
  const raw = await runRawBindingCheck(
    projectRoot,
    story,
    testLayer,
    clock,
    timeoutMs,
    baseRevision,
    hunkOptions,
  );
  if (raw.kind === 'skipped') return { kind: 'skipped' };
  if (raw.kind === 'problem') return { kind: 'problem', storyId: story.id, problem: raw.problem };
  const { runId, result, rawNonBinding, hunkMutation } = raw;
  const application = applyExemptions(
    story.id,
    rawNonBinding,
    exemptions,
    clock.now().slice(0, 10),
  );
  await emitBindingCheckTelemetry({
    projectRoot: telemetryProjectRoot ?? projectRoot,
    runId: telemetryRunId,
    clock,
    storyId: story.id,
    testsNamed: result.namedTests.length,
    bound: result.failedUnderMutation.length,
    nonBinding: rawNonBinding.length,
    exempted: rawNonBinding.length - application.nonBinding.length,
    expiredExemptionIds: application.expiredExemptions.map((exemption) => exemption.id),
    ...(hunkMutation === undefined ? {} : { hunkMutation }),
  });
  const exemptionProblems = describeExemptionProblems(application);
  if (exemptionProblems.length > 0) {
    return { kind: 'problem', storyId: story.id, problem: exemptionProblems.join(' ') };
  }
  const nonBinding = application.nonBinding;
  const tests: readonly TestOutcomeEntry[] = result.namedTests.map((name) => ({
    name,
    binding: result.failedUnderMutation.includes(name),
  }));
  const written = await assembleAndWriteMutationEvidence({
    paths,
    reportsRoot,
    storyId: story.id,
    runId,
    toolVersions: detectToolVersions(testLayer),
    result,
    clock,
    ...(hunkMutation === undefined ? {} : { hunkMutation }),
  });
  return {
    kind: 'completed',
    storyId: story.id,
    bound: result.failedUnderMutation,
    nonBinding,
    exemptApplied: nonBinding.length < rawNonBinding.length,
    tests,
    restoreVerified: result.restoreVerified,
    evidenceId: written.id,
    ...(hunkMutation === undefined ? {} : { hunkMutation }),
  };
}

export async function resolveStoryById(paths: ProjectPaths, storyId: string): Promise<Story> {
  const specDocs = await listSpecArtifacts(paths, SPECS_ROOT);
  const storyDoc = specDocs.find(
    (doc) => (doc.frontMatter as { readonly id?: unknown }).id === storyId,
  );
  if (storyDoc === undefined) {
    throw new ForgeError('RUN-110', { storyId, reason: 'not-found' });
  }
  const parsedStory = storySchema.safeParse(storyDoc.frontMatter);
  if (!parsedStory.success) {
    const issues = parsedStory.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new ForgeError('RUN-110', { storyId, reason: 'invalid', issues });
  }
  return parsedStory.data;
}

/** One `hunks[]` entry's own JSON shape (`specs/22` M16 P12; `03` §3.2.5 row 117) — flattens
 * `HunkVerdict`'s discriminated union down to the plain, flat `{id, path, verdict, killedBy?,
 * reason?}` shape this family's own envelopes already use elsewhere. */
function hunkEntryToJson(entry: HunkMutationEntry): {
  readonly id: string;
  readonly path: string;
  readonly verdict: string;
  readonly killedBy?: readonly string[];
  readonly reason?: string;
} {
  const { verdict } = entry;
  return {
    id: entry.id,
    path: entry.path,
    verdict: verdict.kind,
    ...(verdict.kind === 'killed' ? { killedBy: verdict.killedBy } : {}),
    ...(verdict.kind === 'invalid' || verdict.kind === 'skipped' || verdict.kind === 'uncovered'
      ? { reason: verdict.reason }
      : {}),
  };
}

/** The `--json` envelope's own additive hunk-mode fields (`specs/22` M16 P12; `13` F-TEST-10). */
function hunkMutationToJson(report: HunkMutationReport): {
  readonly hunks: readonly ReturnType<typeof hunkEntryToJson>[];
  readonly granularity: HunkMutationReport['granularity'];
  readonly uncoveredHunks: number;
  readonly invalidHunks: number;
  readonly timeoutHunks: number;
  readonly skippedHunks: number;
} {
  const count = (kind: 'uncovered' | 'invalid' | 'timeout' | 'skipped'): number =>
    report.hunks.filter((entry) => entry.verdict.kind === kind).length;
  return {
    hunks: report.hunks.map(hunkEntryToJson),
    granularity: report.granularity,
    uncoveredHunks: count('uncovered'),
    invalidHunks: count('invalid'),
    timeoutHunks: count('timeout'),
    skippedHunks: count('skipped'),
  };
}

/**
 * `specs/22` M17 P13 (defect #10): an all-`nonBinding` result over a story's REAL named tests is the
 * expected, correct signature of a behaviour-preserving change. Returns `undefined` for nothing named
 * at all, and a genuine PARTIAL non-binding result.
 */
function allNonBindingNote(tests: readonly TestOutcomeEntry[]): string | undefined {
  if (tests.length === 0 || tests.some((test) => test.binding)) return undefined;
  return (
    'Every named test is classified nonBinding. This is the expected, correct signature of a ' +
    'behaviour-preserving change (for example a pure refactor): a test that passes identically ' +
    'against the old and the new implementation cannot demonstrate AC-test binding by design -- it ' +
    'is not necessarily a false result. Check restoreVerified and, with --hunks, the per-hunk ' +
    'verdicts for the finer-grained picture.'
  );
}

/** `--story <id>` given: `specs/22` M15 P4's own single-story behavior; `specs/22` M16 P12 adds
 * `hunkOptions`, additive. */
async function runSingleStoryBindingCommand(
  paths: ProjectPaths,
  projectRoot: string,
  telemetryProjectRoot: string | undefined,
  reportsRoot: string,
  storyId: string,
  testLayer: TestLayerIdentity,
  clock: Clock,
  exemptions: readonly Exemption[],
  json: boolean,
  runId: string | undefined,
  timeoutMs: number | undefined,
  baseRevision: string | undefined,
  hunkOptions: HunkMutationOptions | undefined,
): Promise<number> {
  const story = await resolveStoryById(paths, storyId);
  const outcome = await runOneStoryBinding(
    paths,
    projectRoot,
    telemetryProjectRoot,
    reportsRoot,
    story,
    testLayer,
    clock,
    exemptions,
    runId,
    timeoutMs,
    baseRevision,
    hunkOptions,
  );
  if (outcome.kind === 'skipped') {
    throw new ForgeError('RUN-111', { storyId, reason: 'no-test-paths' });
  }
  if (outcome.kind === 'problem') {
    if (json) {
      console.log(JSON.stringify({ v: 1, ok: false, problem: outcome.problem }));
    } else {
      console.error(`forge test binding: ${outcome.problem}`);
    }
    return EXIT_CODES.failure;
  }
  // `incomplete` counts every real reason this check does not deserve a pass; `passed` is the
  // derived, human-convenient boolean. Named `passed`, never `ok` — `evaluateGate`'s own
  // `failureMarker` treats `ok` as a reserved refusal marker.
  const incomplete = outcome.nonBinding.length + (outcome.restoreVerified ? 0 : 1);
  const singleStoryNote = allNonBindingNote(outcome.tests);
  const notes: readonly string[] = singleStoryNote === undefined ? [] : [singleStoryNote];
  if (json) {
    console.log(
      JSON.stringify({
        v: 1,
        passed: incomplete === 0,
        incomplete,
        bound: outcome.bound,
        nonBinding: outcome.nonBinding,
        exempt: outcome.exemptApplied,
        evidenceId: outcome.evidenceId,
        restoreVerified: outcome.restoreVerified,
        tests: outcome.tests,
        notes,
        ...(outcome.hunkMutation === undefined ? {} : hunkMutationToJson(outcome.hunkMutation)),
      }),
    );
  } else {
    console.log(
      `forge test binding --story ${storyId}: bound=${String(outcome.bound.length)} ` +
        `nonBinding=${String(outcome.nonBinding.length)} restoreVerified=${String(outcome.restoreVerified)} ` +
        `evidence=${outcome.evidenceId}.`,
    );
    for (const name of outcome.nonBinding) console.error(`non-binding: ${name}`);
    if (outcome.hunkMutation !== undefined) {
      for (const hunk of outcome.hunkMutation.hunks) {
        if (hunk.verdict.kind !== 'killed') {
          console.error(`hunk ${hunk.verdict.kind}: ${hunk.id} ${hunk.path}`);
        }
      }
    }
  }
  return incomplete === 0 ? EXIT_CODES.success : EXIT_CODES.failure;
}

/** No `--story`: `specs/22` M15 P5's own discover mode, the shape `G-Verify.gate.yaml`'s own
 * `test:binding` check actually invokes. Every `done` story is checked concurrently. A story whose
 * own `files_expected` names no test path is silently skipped.
 *
 * **Known, disclosed limitation (`SPEC-QUESTIONS.md` Q284 decision 6):** `runOneStoryBinding`
 * resolves `'HEAD~1'` fresh for EVERY story this mode checks, against whatever the current tip of
 * history happens to be — correct only for a story whose own implementation happens to be the single
 * most recent commit. */
async function runDiscoverModeBindingCommand(
  paths: ProjectPaths,
  projectRoot: string,
  telemetryProjectRoot: string | undefined,
  reportsRoot: string,
  specsRoot: string,
  testLayer: TestLayerIdentity,
  clock: Clock,
  exemptions: readonly Exemption[],
  json: boolean,
  runId: string | undefined,
  timeoutMs: number | undefined,
  baseRevision: string | undefined,
): Promise<number> {
  const doneStories = await loadDoneStories(paths, specsRoot);
  const outcomes = await Promise.all(
    doneStories.map((story) =>
      runOneStoryBinding(
        paths,
        projectRoot,
        telemetryProjectRoot,
        reportsRoot,
        story,
        testLayer,
        clock,
        exemptions,
        runId,
        timeoutMs,
        baseRevision,
      ),
    ),
  );
  const bound: string[] = [];
  const nonBinding: string[] = [];
  const evidenceIds: string[] = [];
  const problems: string[] = [];
  const notes: string[] = [];
  let restoreVerified = true;
  let exempt = false;
  for (const outcome of outcomes) {
    if (outcome.kind === 'skipped') continue;
    if (outcome.kind === 'problem') {
      problems.push(`${outcome.storyId}: ${outcome.problem}`);
      continue;
    }
    bound.push(...outcome.bound.map((name) => `${outcome.storyId}: ${name}`));
    nonBinding.push(...outcome.nonBinding.map((name) => `${outcome.storyId}: ${name}`));
    evidenceIds.push(outcome.evidenceId);
    if (!outcome.restoreVerified) restoreVerified = false;
    if (outcome.exemptApplied) exempt = true;
    const note = allNonBindingNote(outcome.tests);
    if (note !== undefined) notes.push(`${outcome.storyId}: ${note}`);
  }
  const incomplete = nonBinding.length + (restoreVerified ? 0 : 1) + problems.length;
  if (json) {
    console.log(
      JSON.stringify({
        v: 1,
        passed: incomplete === 0,
        incomplete,
        bound,
        nonBinding,
        exempt,
        evidenceIds,
        restoreVerified,
        problems,
        notes,
      }),
    );
  } else {
    console.log(
      `forge test binding: checked ${String(doneStories.length)} done stor${doneStories.length === 1 ? 'y' : 'ies'}, ` +
        `bound=${String(bound.length)} nonBinding=${String(nonBinding.length)} ` +
        `restoreVerified=${String(restoreVerified)} evidence=[${evidenceIds.join(', ')}].`,
    );
    for (const name of nonBinding) console.error(`non-binding: ${name}`);
    for (const problem of problems) console.error(`problem: ${problem}`);
  }
  return incomplete === 0 ? EXIT_CODES.success : EXIT_CODES.failure;
}

/** Resolves `rawCommand` (`config.execution.testCommands.unit`) into a real `TestLayerIdentity`
 * (`specs/22` M17 P4): a legacy string still needs `detectEcosystem`. `undefined` is the real, typed
 * `RUN-111` refusal both real callers already threw before this piece, factored out here so this one
 * decision lives in exactly one place. Exported for `test-exempt-coverage-flaky.ts`'s own
 * `runTestExemptCommand`. */
export async function resolveTestLayerIdentity(
  paths: ProjectPaths,
  rawCommand: TestCommandEntry | undefined,
  storyId: string | undefined,
): Promise<TestLayerIdentity> {
  if (rawCommand === undefined) {
    throw new ForgeError('RUN-111', { storyId, reason: 'no-test-command' });
  }
  if (typeof rawCommand !== 'string') return { structuredCommand: rawCommand };
  const detectedEcosystem = await detectEcosystem(paths);
  if (detectedEcosystem === 'unknown') {
    throw new ForgeError('RUN-111', { storyId, reason: 'unknown-ecosystem' });
  }
  return { testCommand: rawCommand, ecosystem: detectedEcosystem };
}

/** `forge test binding [--story <id>] [--json]` (`specs/22` M15 P4, extended by M15 P5): refuses a
 * dirty tree before any git work, then dispatches to single-story mode or discover mode.
 * `baseRevision` is `HEAD~1` by default; `resolvedBaseRevision` (`specs/22` M16 P11) replaces that
 * default for the whole run when given. `hunkOptions` (`specs/22` M16 P12) is threaded ONLY to
 * single-story mode. */
async function runTestBindingCommand(
  paths: ProjectPaths,
  projectRoot: string,
  storyId: string | undefined,
  json: boolean,
  timeoutMs: number | undefined,
  resolvedBaseRevision: string | undefined,
  hunkOptions: HunkMutationOptions | undefined,
): Promise<number> {
  await assertCleanWorkingTree(projectRoot);

  const config = await readConfig(paths);
  const testLayer = await resolveTestLayerIdentity(
    paths,
    config.execution.testCommands.unit,
    storyId,
  );
  const clock = SYSTEM_CLOCK;
  const { exemptions } = await loadExemptions(paths, config.paths.reports);
  const runId = realEnvSnapshot()[FORGE_RUN_ID];
  // `specs/22` M17 Phase A hardening (Q324's own disclosed sibling): the real project root for THIS
  // check's own telemetry, when this invocation is an in-run `G-Verify` gate evaluation (`gateEnv`,
  // `run/context.ts`) -- mirrors `run-and-gates.ts`'s own identical `forge parity check` wiring exactly.
  const telemetryProjectRoot = realEnvSnapshot()['FORGE_PROJECT_ROOT'];

  if (storyId === undefined) {
    return runDiscoverModeBindingCommand(
      paths,
      projectRoot,
      telemetryProjectRoot,
      config.paths.reports,
      SPECS_ROOT,
      testLayer,
      clock,
      exemptions,
      json,
      runId,
      timeoutMs,
      resolvedBaseRevision,
    );
  }
  return runSingleStoryBindingCommand(
    paths,
    projectRoot,
    telemetryProjectRoot,
    config.paths.reports,
    storyId,
    testLayer,
    clock,
    exemptions,
    json,
    runId,
    timeoutMs,
    resolvedBaseRevision,
    hunkOptions,
  );
}

/**
 * Dispatches `forge test binding`. `undefined` for every other command.
 *
 * @see specs/22 M17 P2
 */
export async function dispatchTestBinding(ctx: DispatchContext): Promise<number | undefined> {
  const [command, sub, ...rest] = ctx.positionals;
  const { paths, projectRoot, flags } = ctx;
  if (command !== 'test' || sub !== 'binding') return undefined;

  // `specs/22` M16 P11 (`13` F-TEST-10): `--base <ref>` and `--hunks` are additive. `--hunks` takes
  // no value (`false`). `specs/22` M16 P12 adds `--max-hunks <n>`.
  const {
    values,
    flags: bindingFlags,
    positionals,
  } = parseCommandFlags(rest, {
    '--story': true,
    '--timeout-ms': true,
    '--base': true,
    '--hunks': false,
    '--max-hunks': true,
  });
  // `positionals` is already flag-free (the parse above already separated every real flag out of
  // it) -- `assertNoArgs` re-parsing it with its own empty spec is a harmless no-op pass that
  // still reuses the real, shared "extra positional" refusal, rather than this file duplicating
  // that refusal's own exact shape a second time.
  assertNoArgs(positionals);
  const timeoutMs = parseTimeoutMsFlag(values.get('--timeout-ms'));
  const storyId = values.get('--story');
  const hunksRequested = bindingFlags.has('--hunks');
  const rawMaxHunks = values.get('--max-hunks');
  // `specs/22` M16 P12: `--hunks` mutates one story at a time, and `--max-hunks` means nothing
  // outside hunk mode — both share `--base`-without-`--hunks`'s own code (`USR-005`).
  if (hunksRequested && storyId === undefined) {
    throw new ForgeError('USR-005', { value: '', reason: 'hunks-without-story' });
  }
  if (!hunksRequested && rawMaxHunks !== undefined) {
    throw new ForgeError('USR-005', { value: rawMaxHunks, reason: 'max-hunks-without-hunks' });
  }
  const resolvedBaseRevision = await resolveHunkModeBase({
    cwd: projectRoot,
    base: values.get('--base'),
    hunks: hunksRequested,
  });
  const maxHunks = parseMaxHunksFlag(rawMaxHunks);
  const hunkOptions: HunkMutationOptions | undefined = hunksRequested
    ? { maxHunks: maxHunks ?? DEFAULT_MAX_HUNKS }
    : undefined;
  return runTestBindingCommand(
    paths,
    projectRoot,
    storyId,
    flags.json,
    timeoutMs,
    resolvedBaseRevision,
    hunkOptions,
  );
}
