/**
 * `forge story verify <storyId>` — the step `implement-story`'s `self-verify` runs (`10` §10.6 step 6:
 * "run the story's DoD check set; attach outputs").
 *
 * `10` §10.6 names the step and `09` §9.8 defines what it evaluates: the story's `dod_profile`, a named list of
 * `done` checks, "machine-checked", where "A story cannot be marked `done` unless every `done` check passes — and
 * the checks are commands, not opinions." `03` §3.2.5 lists the command (row added by `PLAN-M13.md` P22). It is
 * that evaluation and nothing else: it never edits a story or its status, calls no model, and leaves the
 * project's `test-results.json` and `flaky.json` alone (`persistState: false`; only `forge test run` owns them).
 *
 * What resolves a check. A plain string in the `done` list is a bounded expression over `story` (evaluated by
 * `@forge/methods/dod`, as `spec validate --rule definition-of-ready` does for `ready`). A `{ check: <id> }` entry
 * is answered here, only where a deterministic implementation exists:
 *
 * | id                                               | answer                                                              |
 * |--------------------------------------------------|---------------------------------------------------------------------|
 * | `build:typecheck`, `build:lint`                  | `execution.testCommands.typecheck` / `.lint` (as `test run --rule`) |
 * | `test:unit`, `:integration`, `:contract`, `:e2e` | that layer's `execution.testCommands` entry, run alone              |
 * | `spec:ac-coverage`                               | each acceptance criterion of THIS story has a passing bound test    |
 * |                                                  | and none has a failing one, in the layers run by this invocation    |
 *
 * `spec:ac-coverage` reads only the results of the layers this invocation ran (test layers are run first,
 * whatever their place in the list). It never reads an earlier report from disk: nothing on it says which code it
 * describes. With no layer listed it is `unverifiable`. A trailing ` --scope story` or ` --story` (`09` §9.8's
 * spelling) is accepted; the Story schema has no test-path list to scope by, so the whole layer command runs (never
 * a weaker check than asked for) and the message says so.
 *
 * Fail closed. Any id with no deterministic implementation here (`review:blocking-findings == 0`,
 * `security:secrets-scan`, `docs:public-api-documented`, `kb:no-new-contradictions`, `test:nfr`, a project's own
 * invented ids) is `unverifiable`, which is not a pass: `09` §9.5 (a story cannot reach `verified` while an AC is
 * missing or failing), this codebase's rule that a layer which cannot be verified never reads as passing
 * (`test run`, `test coverage`), and `evaluateDodProfile`'s own rule for an id the resolver does not recognise. A missing
 * profile file, an unparseable one, a profile the file does not define, and a profile whose `done` list is empty
 * (nothing was verified) are each one `unverifiable` `(profile)` check for the same reason. A profile made only of
 * plain expressions over `story` is a real choice (`ready` lists are written that way) and is evaluated as one. `fail` (it ran and the
 * answer was no) and `unverifiable` (it could not be asked) stay distinct in the report, so a reader can tell a
 * broken story from an unfinished setup.
 *
 * Known consequences, recorded in Q213 and not decided here: `10` §10.6 runs self-verify BEFORE review and
 * document, but `09` §9.8's example `done` list contains `review:blocking-findings == 0` and
 * `docs:public-api-documented`, so a profile shaped like the example can never be fully green at this step; and
 * the `scaffold-project` brief says each `done` id "is mapped to its task-runner command in `delivery/build.md`",
 * prose this command does not read (the mapping it uses is the fixed table above plus `execution.testCommands`),
 * so an id outside that table stays `unverifiable`. A layer counts as passing only if at least one test passed and
 * none failed outside quarantine (F-TEST-6 excludes a quarantined flaky test from the gate, and the message says how
 * many); a failing bound test still defeats `spec:ac-coverage`.
 *
 * `errors` is the count of checks that are not `pass`, a bare number, because gate checks read it that way
 * (`failOn: 'errors > 0'`); the rest of the `--json` envelope is `{ v: 1, storyId, profile, phase, passed,
 * errors, checks }`.
 *
 * @see specs/09 §9.5, §9.8
 * @see specs/10 §10.6
 * @see PLAN-M13.md P22
 * @see SPEC-QUESTIONS.md Q213
 */
import { isForgeError } from '@forge/core';
import type { ProjectPaths } from '@forge/core/fs';
import { evaluateDodProfile, readDodProfile, type DodParseResult } from '@forge/methods/dod';
import { storySchema, type Story } from '@forge/schemas';

import { listSpecArtifacts } from './shared.ts';
import type { TestOutcome } from './loop/test/reporter.ts';
import { createSystemTempPath } from './loop/test/system-temp.ts';
import {
  testRun,
  type TestCommands,
  type TestRunContext,
  type TestRunOptions,
  type TestRunResult,
} from './loop/test/run.ts';

/** Where the profiles live: `09` §9.8 names the file, not its place; it is the sibling of
 * `engineering/definition-of-done.md` under the KB root, as `spec validate --rule definition-of-ready` reads it. */
const DOD_PROFILES_RELATIVE_PATH = 'engineering/dod-profiles.yaml';

const TEST_LAYERS = ['unit', 'integration', 'contract', 'e2e'] as const;
type TestLayer = (typeof TEST_LAYERS)[number];

export type StoryCheckStatus = 'pass' | 'fail' | 'unverifiable';

export interface StoryCheckResult {
  /** The entry as written in the profile: the expression text, or the `check:` id. */
  readonly check: string;
  readonly status: StoryCheckStatus;
  readonly message: string;
}

export interface StoryVerifyReport {
  readonly storyId: string;
  readonly profile: string;
  readonly phase: 'done';
  /** True only when every check passed. A profile with no checks (`done: []`) is not a pass. */
  readonly passed: boolean;
  /** The number of checks that are not `pass`. */
  readonly errors: number;
  readonly checks: readonly StoryCheckResult[];
}

export type StoryVerifyOutcome =
  | { readonly kind: 'no-story'; readonly storyId: string }
  | {
      readonly kind: 'not-a-story';
      readonly storyId: string;
      readonly problems: readonly string[];
    }
  | { readonly kind: 'verified'; readonly report: StoryVerifyReport };

/** The one seam: how a project's test commands are run. The default is `testRun`, the very function
 * `forge test run` calls; a test may substitute it to avoid spawning real tools. */
export type TestRunner = (
  ctx: TestRunContext,
  options: TestRunOptions,
  createTempPath: () => string,
) => Promise<TestRunResult>;

export interface StoryVerifyContext {
  readonly paths: ProjectPaths;
  readonly projectRoot: string;
  readonly specsRoot: string;
  readonly kbRoot: string;
  readonly testCommands: TestCommands;
  readonly flakeConfig?: TestRunContext['flakeConfig'];
  readonly runTests?: TestRunner;
}

interface Resolution {
  readonly status: StoryCheckStatus;
  readonly message: string;
}

/** What one `verify` run has learned, shared by the checks that follow it. */
interface RunMemory {
  /** Outcomes from every test layer run during THIS invocation (the on-disk report holds only the last). */
  readonly outcomes: TestOutcome[];
  ranLayer: boolean;
  /** A layer returned `problems` (could not run, zero tests, unreadable state): its outcomes are not the whole story. */
  incomplete: boolean;
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function findStoryDocuments(
  ctx: StoryVerifyContext,
  storyId: string,
): Promise<readonly { readonly frontMatter: unknown }[]> {
  const docs = await listSpecArtifacts(ctx.paths, ctx.specsRoot);
  return docs.filter((doc) => (doc.frontMatter as { readonly id?: unknown }).id === storyId);
}

async function loadProfiles(ctx: StoryVerifyContext): Promise<DodParseResult> {
  const relative = `${ctx.kbRoot}/${DOD_PROFILES_RELATIVE_PATH}`;
  try {
    return await readDodProfile(ctx.paths, relative);
  } catch (cause) {
    // `RUN-034`: the file does not exist. Anything else (an unreadable file) is reported the same way, as a
    // profile that could not be loaded, never as a crash and never as a pass.
    const message =
      isForgeError(cause) && cause.code === 'RUN-034' ? 'no such file' : describeCause(cause);
    return { success: false, issues: [{ path: relative, message }] };
  }
}

/** ` --scope story` / ` --story` (`09` §9.8's spelling) stripped from an id, and whether it was there. */
function splitScope(id: string): { readonly key: string; readonly scoped: boolean } {
  const trimmed = id.trim();
  const stripped = trimmed.replace(/\s+--(?:scope\s+story|story)$/, '');
  return { key: stripped, scoped: stripped !== trimmed };
}

/** At most this many failing test names are quoted in a message: enough to act on, not a transcript. */
const NAMED_FAILURES = 5;

/**
 * Maps one `testRun` result to a check answer. `requirePass` is for test layers, whose outcomes are individual
 * tests: a layer in which no test passed (every one skipped or pending) ran nothing, and reading it as a pass
 * would verify nothing. Lint and typecheck have no per-test outcomes and pass on a clean count.
 */
function outcomeFromRun(
  result: TestRunResult,
  what: string,
  scopeNote: string,
  requirePass: boolean,
): Resolution {
  const problems = result.problems ?? [];
  const outcomes = result.outcomes ?? [];
  const failing = outcomes.filter((outcome) => outcome.status === 'fail');
  if (problems.length === 0 && result.failed === 0 && result.errors === 0) {
    if (requirePass && !outcomes.some((outcome) => outcome.status === 'pass')) {
      return {
        status: 'unverifiable',
        message: `${what} ran but no test passed (every test skipped?), so nothing was verified.`,
      };
    }
    // `testRun` leaves a test already quarantined as flaky out of `failed` (F-TEST-6, "excluded from the gate").
    const note =
      failing.length > 0
        ? ` (${String(failing.length)} failing quarantined test${failing.length === 1 ? '' : 's'} excluded, F-TEST-6)`
        : '';
    return { status: 'pass', message: `${what} passed${scopeNote}${note}.` };
  }
  if (failing.length > 0 || (problems.length === 0 && (result.failed > 0 || result.errors > 0))) {
    const counts =
      result.failed > 0
        ? `${String(result.failed)} failing`
        : `${String(result.errors)} diagnostics`;
    const names = failing.slice(0, NAMED_FAILURES).map((outcome) => outcome.name);
    const more =
      failing.length > NAMED_FAILURES
        ? `, and ${String(failing.length - NAMED_FAILURES)} more`
        : '';
    const named = names.length > 0 ? `: ${names.join('; ')}${more}` : '';
    return { status: 'fail', message: `${what}: ${counts}${named}${scopeNote}.` };
  }
  return {
    status: 'unverifiable',
    message: `${what} could not be verified: ${problems.join('; ')}`,
  };
}

async function runRule(ctx: StoryVerifyContext, rule: 'lint' | 'typecheck'): Promise<Resolution> {
  const command = ctx.testCommands[rule];
  if (command === undefined) {
    return {
      status: 'unverifiable',
      message: `execution.testCommands.${rule} is not configured, so the ${rule} check cannot run.`,
    };
  }
  const result = await (ctx.runTests ?? testRun)(
    {
      paths: ctx.paths,
      projectRoot: ctx.projectRoot,
      testCommands: ctx.testCommands,
      persistState: false,
      ...(ctx.flakeConfig !== undefined ? { flakeConfig: ctx.flakeConfig } : {}),
    },
    { rule },
    () => createSystemTempPath('forge-story-verify'),
  );
  return outcomeFromRun(result, `${rule} (\`${command}\`)`, '', false);
}

async function runLayer(
  ctx: StoryVerifyContext,
  layer: TestLayer,
  scoped: boolean,
  memory: RunMemory,
): Promise<Resolution> {
  const command = ctx.testCommands[layer];
  if (command === undefined) {
    return {
      status: 'unverifiable',
      message: `execution.testCommands.${layer} is not configured, so the ${layer} tests cannot run.`,
    };
  }
  // Only this layer's command is handed over, so `test:unit` never runs (or is failed by) another layer.
  const result = await (ctx.runTests ?? testRun)(
    {
      paths: ctx.paths,
      projectRoot: ctx.projectRoot,
      testCommands: { [layer]: command },
      persistState: false,
      ...(ctx.flakeConfig !== undefined ? { flakeConfig: ctx.flakeConfig } : {}),
    },
    {},
    () => createSystemTempPath('forge-story-verify'),
  );
  memory.ranLayer = true;
  if ((result.problems ?? []).length > 0) memory.incomplete = true;
  memory.outcomes.push(...(result.outcomes ?? []));
  const scopeNote = scoped
    ? ' (the whole layer ran: a Story has no test-path list to scope it by)'
    : '';
  return outcomeFromRun(result, `${layer} tests (\`${command}\`)`, scopeNote, true);
}

function checkAcCoverage(story: Story, memory: RunMemory): Resolution {
  const acIds = story.acceptance.map((criterion) => criterion.id);
  if (acIds.length === 0) {
    return { status: 'fail', message: `${story.id} has no acceptance criteria to cover.` };
  }
  // Only what THIS invocation just ran counts. A report left on disk by an earlier run has no age or revision
  // that could prove it describes the code being verified, so reading it would be an opinion, not a command.
  if (!memory.ranLayer) {
    return {
      status: 'unverifiable',
      message:
        'no test layer ran in this verification, so there are no results to check: list `test:unit` (or another layer) in the profile.',
    };
  }
  const passing = new Set<string | undefined>();
  const failing = new Set<string | undefined>();
  for (const outcome of memory.outcomes) {
    if (outcome.status === 'pass') passing.add(outcome.acId);
    if (outcome.status === 'fail') failing.add(outcome.acId);
  }
  const failed = acIds.filter((id) => failing.has(id));
  const missing = acIds.filter((id) => !passing.has(id) && !failing.has(id));
  // A layer that could not be fully run leaves some tests unseen: a failure already seen still stands, but
  // "covered" and "not covered" both need the whole run.
  if (failed.length === 0 && memory.incomplete) {
    return {
      status: 'unverifiable',
      message:
        'a test layer could not be fully run (see its own check), so coverage cannot be judged from its partial results.',
    };
  }
  if (failed.length === 0 && missing.length === 0) {
    return {
      status: 'pass',
      message: 'every acceptance criterion has a passing bound test and none has a failing one.',
    };
  }
  const parts = [
    ...(failed.length > 0 ? [`a bound test fails for ${failed.join(', ')}`] : []),
    ...(missing.length > 0 ? [`no passing bound test for ${missing.join(', ')}`] : []),
  ];
  return { status: 'fail', message: `${parts.join('; ')} (in the test layers run just now).` };
}

async function resolveCheckId(
  ctx: StoryVerifyContext,
  story: Story,
  id: string,
  memory: RunMemory,
): Promise<Resolution> {
  const { key, scoped } = splitScope(id);
  if (key === 'build:typecheck') return runRule(ctx, 'typecheck');
  if (key === 'build:lint') return runRule(ctx, 'lint');
  const layer = TEST_LAYERS.find((candidate) => key === `test:${candidate}`);
  if (layer !== undefined) return runLayer(ctx, layer, scoped, memory);
  if (key === 'spec:ac-coverage') return checkAcCoverage(story, memory);
  return {
    status: 'unverifiable',
    message: `"${id}" has no deterministic implementation in forge story verify, so it is not counted as passing.`,
  };
}

/** Runs one check, never throwing: a tool that will not start is `unverifiable`, not a crash. */
async function resolveGuarded(
  ctx: StoryVerifyContext,
  story: Story,
  id: string,
  memory: RunMemory,
): Promise<Resolution> {
  try {
    return await resolveCheckId(ctx, story, id, memory);
  } catch (cause) {
    return { status: 'unverifiable', message: `could not run: ${describeCause(cause)}` };
  }
}

function reportOf(story: Story, checks: readonly StoryCheckResult[]): StoryVerifyReport {
  const errors = checks.filter((check) => check.status !== 'pass').length;
  return {
    storyId: story.id,
    profile: story.dod_profile,
    phase: 'done',
    passed: errors === 0,
    errors,
    checks,
  };
}

/**
 * Evaluates `storyId`'s `done` profile. Never throws for an ordinary condition (an unknown story, a missing
 * profile file, a tool that will not run): each is a typed outcome or an `unverifiable` check.
 */
export async function storyVerify(
  ctx: StoryVerifyContext,
  storyId: string,
): Promise<StoryVerifyOutcome> {
  const docs = await findStoryDocuments(ctx, storyId);
  const [doc] = docs;
  if (doc === undefined) return { kind: 'no-story', storyId };
  // An id two documents claim cannot be verified: which one is "the" story is not something to guess at.
  if (docs.length > 1) {
    return {
      kind: 'not-a-story',
      storyId,
      problems: [`${String(docs.length)} documents under ${ctx.specsRoot} share this id`],
    };
  }
  const parsed = storySchema.safeParse(doc.frontMatter);
  if (!parsed.success) {
    return {
      kind: 'not-a-story',
      storyId,
      problems: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    };
  }
  const story = parsed.data;

  const profiles = await loadProfiles(ctx);
  if (!profiles.success) {
    return {
      kind: 'verified',
      report: reportOf(story, [
        {
          check: '(profile)',
          status: 'unverifiable',
          message: `cannot read the DoD profiles at ${ctx.kbRoot}/${DOD_PROFILES_RELATIVE_PATH}: ${profiles.issues.map((issue) => issue.message).join('; ')}`,
        },
      ]),
    };
  }
  // Own properties only: a story naming `constructor` or `toString` must not find a function on the prototype.
  const profile = Object.hasOwn(profiles.profileFile.profiles, story.dod_profile)
    ? profiles.profileFile.profiles[story.dod_profile]
    : undefined;
  if (profile === undefined) {
    return {
      kind: 'verified',
      report: reportOf(story, [
        {
          check: '(profile)',
          status: 'unverifiable',
          message: `no DoD profile "${story.dod_profile}" in ${ctx.kbRoot}/${DOD_PROFILES_RELATIVE_PATH}.`,
        },
      ]),
    };
  }

  // A profile with nothing to check has verified nothing, and an empty list is more likely an unfinished profile
  // than a decision: it is not a pass. (A profile of plain expressions is a real choice and is evaluated as one.)
  if (profile.done.length === 0) {
    return {
      kind: 'verified',
      report: reportOf(story, [
        {
          check: '(profile)',
          status: 'unverifiable',
          message: `the "${story.dod_profile}" profile lists no done checks, so nothing was verified: list at least one.`,
        },
      ]),
    };
  }

  // Each distinct `check:` id is answered once before the pure evaluation below. Test layers go first whatever
  // their place in the list, so a check that reads their results (`spec:ac-coverage`) never depends on order.
  const memory: RunMemory = { outcomes: [], ranLayer: false, incomplete: false };
  const resolved = new Map<string, Resolution>();
  const references = profile.done.flatMap((entry) =>
    typeof entry === 'string' ? [] : [entry.check],
  );
  const isLayerCheck = (id: string): boolean =>
    TEST_LAYERS.some((layer) => splitScope(id).key === `test:${layer}`);
  const ordered = [
    ...references.filter(isLayerCheck),
    ...references.filter((id) => !isLayerCheck(id)),
  ];
  for (const id of ordered) {
    if (resolved.has(id)) continue;
    resolved.set(id, await resolveGuarded(ctx, story, id, memory));
  }
  // The plain-expression entries are evaluated on their own (a `{ check: }` entry cannot be mistaken for one that
  // shares its text); the `{ check: }` entries were answered above.
  const expressions = profile.done.filter((entry): entry is string => typeof entry === 'string');
  const violations = evaluateDodProfile(
    { profiles: { expressions: { ready: [], done: expressions } } },
    'expressions',
    'done',
    { story },
    () => false,
  );

  const checks: StoryCheckResult[] = profile.done.map((entry) => {
    if (typeof entry !== 'string') {
      const resolution = resolved.get(entry.check);
      return {
        check: entry.check,
        status: resolution?.status ?? 'unverifiable',
        message: resolution?.message ?? 'not resolved.',
      };
    }
    const violation = violations.find((candidate) => candidate.check === entry);
    return violation === undefined
      ? { check: entry, status: 'pass', message: 'expression holds.' }
      : { check: entry, status: 'fail', message: violation.message };
  });
  return { kind: 'verified', report: reportOf(story, checks) };
}

export interface StoryVerifyRendering {
  readonly stdout?: string;
  readonly stderr?: string;
  /** `0` all checks pass, `1` some check does not, `2` the story cannot be found or read. */
  readonly exitCode: 0 | 1 | 2;
}

/** One line of text for a person: control characters (from project-authored ids and messages) never reach a
 * terminal. */
function oneLine(text: string): string {
  // C0, DEL, C1; the bidirectional marks, embeddings, overrides and isolates (they reorder a line on screen);
  // zero-width characters, the word joiner range, line/paragraph separators and the BOM.
  return text.replaceAll(
    // eslint-disable-next-line no-control-regex -- stripping them is the point
    /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g,
    ' ',
  );
}

/** Turns an outcome into what `forge story verify` prints and the exit code it returns, so the dispatcher stays
 * a thin argument parser and this stays testable without a subprocess. */
export function renderStoryVerify(
  outcome: StoryVerifyOutcome,
  json: boolean,
): StoryVerifyRendering {
  if (outcome.kind === 'no-story') {
    return {
      stderr: `forge: no Story with id ${JSON.stringify(oneLine(outcome.storyId))}. Run \`forge spec list\` to see the ids that exist.`,
      exitCode: 2,
    };
  }
  if (outcome.kind === 'not-a-story') {
    return {
      stderr: `forge: ${JSON.stringify(oneLine(outcome.storyId))} is not a valid Story: ${oneLine(outcome.problems.join('; '))}`,
      exitCode: 2,
    };
  }
  const { report } = outcome;
  if (json) {
    // `JSON.stringify` escapes only U+0000-U+001F, so project-authored text is cleaned first (as the sibling
    // commands do with `sanitizeDeep`): a check id or a message can carry C1 and bidi characters.
    const safe: StoryVerifyReport = {
      ...report,
      storyId: oneLine(report.storyId),
      profile: oneLine(report.profile),
      checks: report.checks.map((check) => ({
        ...check,
        check: oneLine(check.check),
        message: oneLine(check.message),
      })),
    };
    return { stdout: JSON.stringify({ v: 1, ...safe }), exitCode: report.passed ? 0 : 1 };
  }
  const header = report.passed
    ? `forge story verify ${oneLine(report.storyId)} (profile ${oneLine(report.profile)}): every ${report.phase} check passed.`
    : `forge story verify ${oneLine(report.storyId)} (profile ${oneLine(report.profile)}): ${String(report.errors)} of ${String(report.checks.length)} ${report.phase} checks did not pass.`;
  const marks: Readonly<Record<StoryCheckStatus, string>> = {
    pass: 'pass',
    fail: 'FAIL',
    unverifiable: 'UNVERIFIABLE',
  };
  const lines = report.checks.map(
    (check) => `  ${marks[check.status]} ${oneLine(check.check)}: ${oneLine(check.message)}`,
  );
  return { stdout: [header, ...lines].join('\n'), exitCode: report.passed ? 0 : 1 };
}
