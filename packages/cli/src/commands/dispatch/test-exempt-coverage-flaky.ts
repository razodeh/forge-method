/**
 * `commands/dispatch/test-exempt-coverage-flaky.ts` — `forge test exempt`/`forge test coverage`/
 * `forge test flaky`/`forge test adopt` (`specs/22` M15 P6, M8 P4/P6, M17 P5/P6), plus the real,
 * disclosed `USR-003` refusals for `forge test plan`/`generate`/`report`.
 *
 * `runTestAdoptCommand`/`describePromotionResult` (`forge test adopt`, `specs/22` M17 P6) are
 * entirely new since the original investigation that produced this piece's placement map — verified
 * directly against `git show 067352a -- packages/cli/src/bin.ts` (M17 P6's own landed commit): that
 * piece added exactly one new branch to `main()`'s own dispatch chain (`command === 'test' && sub ===
 * 'adopt'`) and two new private functions, both placed here, sibling to the pre-existing
 * `runTestFlakyCommand` this family already groups with. `describeAdoptTestsAgentResult` and the
 * `--agent`/`--check-proof`/`--run` handling inside `runTestAdoptCommand` (`specs/22` M17 P7,
 * reconciled here at landing time since P7 landed on `main` after this piece's own extraction base
 * — verified directly against `git diff dcb145f..c96d9a8 -- packages/cli/src/bin.ts`, P7's own real
 * commit) close the hand-off this doc comment used to describe as a real `USR-003` refusal.
 *
 * `runRawBindingCheck`/`resolveStoryById`/`resolveTestLayerIdentity` are imported from
 * `test-binding.ts`: `runTestExemptCommand`'s own pre-check reuses that file's "read-only, no
 * MutationEvidence write" binding-check core rather than `runOneStoryBinding` (private to that
 * file) — the identical split the original monolithic `bin.ts` already established.
 *
 * @see specs/22 M17 P2
 * @see specs/22 M17 P6
 */
import { FORGE_RUN_ID, SYSTEM_CLOCK } from '@forge/core';
import { EXIT_CODES, ForgeError } from '@forge/core/errors';
import type { ProjectPaths } from '@forge/core/fs';
import { DEFAULT_CONFIG } from '@forge/schemas/config';
import { isWaiverOwnerIdentifier, waiverExceedsCap } from '@forge/engine/gates';
import { assertCleanWorkingTree } from '@forge/vcs';

import { readConfig } from '../config.ts';
import { test as runTestRefusal } from '../loop/test.ts';
import {
  checkTestAdoptionApproved,
  runDetectionAndStage,
  runPromotion,
  type PromotionResult,
} from '../loop/test/adopt.ts';
import { runAdoptTestsAgent, type AdoptTestsAgentResult } from '../loop/test/adopt-agent.ts';
import { testCoverage } from '../loop/test/coverage.ts';
import { DETECTED_LAYER } from '../loop/test/detect.ts';
import { appendExemption, qualifiedTestId } from '../loop/test/exemptions.ts';
import { testFlaky } from '../loop/test/flaky.ts';
import { resolveDispatchRunId } from './run-and-gates.ts';
import { resolveStoryById, resolveTestLayerIdentity, runRawBindingCheck } from './test-binding.ts';
import {
  assertNoArgs,
  buildLoopDepsForProject,
  CHECKS_ROOT,
  findRuleFlag,
  isBlank,
  KB_ROOT,
  parseCommandFlags,
  realEnvSnapshot,
  sanitizeDeep,
  SPECS_ROOT,
  type DispatchContext,
} from './shared.ts';

/** `DEFAULT_CONFIG.gates` is typed optional on `ForgeConfig` (a real, schema-valid config written
 * before `PLAN-M14.md` P16 shipped has no `gates` block at all) even though the real, shipped default
 * object always defines one — the identical narrowing `commands/run/gate-commands.ts`'s own private
 * `defaultWaiverMaxDays` already does for `forge gate waive`, replicated here (that function is not
 * exported) rather than imported. */
function defaultWaiverMaxDays(): number {
  const { gates } = DEFAULT_CONFIG;
  if (gates === undefined) {
    throw new Error('DEFAULT_CONFIG.gates is unexpectedly absent (schemas/src/config/defaults.ts)');
  }
  return gates.waiverMaxDays;
}

/** A real `YYYY-MM-DD` calendar date -- the identical strictness `exemptionSchema`'s own `expiry:
 * z.string().date()` already enforces. Deliberately NOT `Number.isNaN(Date.parse(value))` alone:
 * `Date.parse` silently rolls a calendar-invalid day-of-month over into the next month instead of
 * rejecting it. Round-tripping through `Date.UTC` and comparing the parts back out is what actually
 * catches a rolled-over date. */
function isRealCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const [, yearStr, monthStr, dayStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** `forge test exempt <storyId> <testId> --reason <text> --owner <identifier> --expires <iso-date>`
 * (`specs/22` M15 P6): declares one exemption, reusing `forge gate waive`'s own policy machinery
 * rather than inventing a second owner/cap rule. Refusals fire, in order, before anything is written:
 * usage, a dirty working tree, `--owner`/`--expires` cap, then (needing a real binding check)
 * `testId` already binds. */
async function runTestExemptCommand(
  paths: ProjectPaths,
  projectRoot: string,
  storyId: string | undefined,
  testId: string | undefined,
  reason: string | undefined,
  owner: string | undefined,
  expiresAt: string | undefined,
  json: boolean,
): Promise<number> {
  if (storyId === undefined || testId === undefined) {
    console.error('forge: "test exempt" needs exactly two positionals: <storyId> <testId>.');
    return EXIT_CODES.usage;
  }
  if (reason === undefined || owner === undefined || expiresAt === undefined) {
    console.error(
      'forge: "test exempt" needs --reason <text> --owner <identifier> --expires <iso-date>.',
    );
    return EXIT_CODES.usage;
  }
  // A blank `--reason` -- `isBlank()` (`./shared.ts`), the identical Unicode-aware check `kb
  // disclose`'s own `--summary`/`--owner`/`--reason`/`--by` already use.
  if (isBlank(reason)) {
    console.error('forge: "test exempt" needs a real, non-blank --reason.');
    return EXIT_CODES.usage;
  }
  if (!isRealCalendarDate(expiresAt)) {
    console.error('forge: "test exempt" needs a real --expires <iso-date> (YYYY-MM-DD).');
    return EXIT_CODES.usage;
  }

  await assertCleanWorkingTree(projectRoot);

  if (!isWaiverOwnerIdentifier(owner)) {
    throw new ForgeError('GATE-513', { owner });
  }

  const config = await readConfig(paths);
  const maxDays = config.gates?.waiverMaxDays ?? defaultWaiverMaxDays();
  const clock = SYSTEM_CLOCK;
  const grantedAt = Date.parse(clock.now());
  if (waiverExceedsCap({ reason, owner, expiresAt }, grantedAt, maxDays)) {
    throw new ForgeError('GATE-515', { testId, reason: 'expiry-exceeds-cap', maxDays });
  }

  const testLayer = await resolveTestLayerIdentity(
    paths,
    config.execution.testCommands.unit,
    storyId,
  );

  const story = await resolveStoryById(paths, storyId);
  // Never the full `runOneStoryBinding`: this pre-check must write no `MutationEvidence`.
  const raw = await runRawBindingCheck(projectRoot, story, testLayer, clock);
  if (raw.kind === 'skipped') {
    throw new ForgeError('RUN-111', { storyId, reason: 'no-test-paths' });
  }
  if (raw.kind === 'problem') {
    if (json) {
      console.log(JSON.stringify({ v: 1, ok: false, problem: raw.problem }));
    } else {
      console.error(`forge test exempt: ${raw.problem}`);
    }
    return EXIT_CODES.failure;
  }
  if (!raw.rawNonBinding.includes(testId)) {
    throw new ForgeError('GATE-515', { testId, reason: 'exempts-a-binding-test' });
  }

  const qualified = qualifiedTestId(storyId, testId);
  const id = await appendExemption(
    paths,
    config.paths.reports,
    clock,
    { testId: qualified, reason, owner, expiry: expiresAt },
    { projectRoot, runId: realEnvSnapshot()[FORGE_RUN_ID] },
  );
  console.log(
    json
      ? JSON.stringify({ v: 1, recorded: true, id, testId: qualified })
      : `forge test exempt ${storyId} ${testId}: recorded ${id} (expires ${expiresAt}).`,
  );
  return EXIT_CODES.success;
}

const TEST_COVERAGE_RULE_IDS = ['acceptance-criteria', 'ratchet'] as const;
type TestCoverageRuleId = (typeof TEST_COVERAGE_RULE_IDS)[number];

function isTestCoverageRuleId(value: string | undefined): value is TestCoverageRuleId {
  return value !== undefined && (TEST_COVERAGE_RULE_IDS as readonly string[]).includes(value);
}

/** `story:ac-coverage`/`test:coverage`/`coverage:ratchet` (`G-Verify.gate.yaml`) each shell `forge
 * test coverage [--rule acceptance-criteria|ratchet] --json` and read back a top-level numeric
 * `coverage`/`regressions` field. */
async function runTestCoverageCommand(
  paths: ProjectPaths,
  projectRoot: string,
  rule: TestCoverageRuleId | undefined,
  json: boolean,
): Promise<number> {
  const config = await readConfig(paths);
  const ctx = {
    paths,
    projectRoot,
    specsRoot: SPECS_ROOT,
    coverage: config.quality.coverage,
  };
  const options = rule === undefined ? {} : { rule };
  const result = await testCoverage(ctx, options);
  if (json) {
    console.log(JSON.stringify({ v: 1, ...result }));
  } else if ((result.problems ?? []).length > 0) {
    for (const problem of result.problems ?? []) console.error(problem);
  } else {
    console.log(
      `forge test coverage${rule === undefined ? '' : ` --rule ${rule}`}: coverage=${String(result.coverage)} regressions=${String(result.regressions)}.`,
    );
    for (const acId of result.missingAcIds ?? []) console.error(`${acId}: no passing bound test.`);
  }
  return (result.problems ?? []).length > 0 ||
    result.regressions > 0 ||
    (rule === undefined && result.coverage < 80) ||
    (rule === 'acceptance-criteria' && result.coverage < 100)
    ? 1
    : 0;
}

/** `test:flaky` (`G-Stable`, `failOn: 'flaky > 0'`) and `test:quarantine-cap` (`G-Verify`,
 * `failOn: 'quarantined > 5'`) both shell the identical `forge test flaky --json`. A bare `--rule` on
 * this command is always rejected (exit 2): this command has no real rule distinction at all. */
async function runTestFlakyCommand(paths: ProjectPaths, json: boolean): Promise<number> {
  const config = await readConfig(paths);
  const flakeConfig = config.quality.flake;
  const result = await testFlaky(paths, flakeConfig);
  if (json) {
    console.log(JSON.stringify({ v: 1, ...result }));
  } else if ((result.problems ?? []).length > 0) {
    for (const problem of result.problems ?? []) console.error(problem);
  } else {
    console.log(
      `forge test flaky: flaky=${String(result.flaky)} quarantined=${String(result.quarantined)}.`,
    );
    for (const name of result.flakyTests ?? []) console.error(`flaky: ${name}`);
    for (const name of result.quarantinedTests ?? []) console.error(`quarantined: ${name}`);
  }
  return (result.problems ?? []).length > 0 ||
    result.flaky > 0 ||
    result.quarantined > flakeConfig.quarantineCap
    ? 1
    : 0;
}

/** Human-readable text for a {@link PromotionResult} -- `specs/22` M17 P7 closed the hand-off
 * this doc comment used to describe here: `'promoted'` is real now.
 *
 * `'gate-not-available'`/`'not-approved'` no longer say "has a passing translator proof" (`specs/22`
 * M17 P21's own fix): both outcomes are reachable for a confident, built-in-format `'detected'`
 * proposal that never carries a proof at all (`adopt.ts`'s own `runPromotion`/
 * `evaluateTestAdoptionApproval` doc comments), so that wording would be false for exactly the case
 * this fix made reachable; the deterministic half having passed is the only thing either message
 * claims now, true for a `'detected'` proposal and a proven `'agent'`/`'human'` one alike. */
function describePromotionResult(result: PromotionResult): string {
  if (result.outcome === 'no-staged-proposal') {
    return `forge test adopt --write: no staged proposal exists for "${result.layer}" -- run "forge test adopt" first.`;
  }
  if (result.outcome === 'proof-not-passing') {
    return `forge test adopt --write: ${result.detail}`;
  }
  if (result.outcome === 'gate-not-available') {
    return (
      `forge test adopt --write: "${result.layer}"'s staged proposal is ready for promotion, but this ` +
      'project has no G-TestAdopt.gate.yaml yet -- run "forge module update" (or re-run "forge init") ' +
      'to pick it up, then retry.'
    );
  }
  if (result.outcome === 'not-approved') {
    return (
      `forge test adopt --write: "${result.layer}"'s staged proposal is ready for promotion, but no ` +
      'human has approved it at G-TestAdopt yet -- run "forge gate check G-TestAdopt --run <runId>" ' +
      'to see it, then "forge gate approve G-TestAdopt --run <runId>", then retry.'
    );
  }
  return `forge test adopt --write: "${result.layer}" promoted -- execution.testCommands.${result.layer} now reflects the approved proposal.`;
}

/** Human-readable text for an {@link AdoptTestsAgentResult} (`forge test adopt --agent`,
 * `specs/22` M17 P7). Every outcome names the real `runId` the session ran under -- neither this
 * command nor `dispatchAgentStep`'s own ad hoc callers write a `last-run.json` pointer, so a human
 * approving or promoting this exact session's own result needs to be given the id to pass as
 * `--run` themselves. */
function describeAdoptTestsAgentResult(result: AdoptTestsAgentResult): string {
  if (result.outcome === 'staged') {
    const runId = result.runId;
    return (
      `forge test adopt --agent: staged a proposal for "${result.layer}" after ${String(result.rounds)} ` +
      `round(s) -- the translator proof passed. Run "forge gate check G-TestAdopt --run ${runId}", ` +
      `then "forge gate approve G-TestAdopt --run ${runId}", then "forge test adopt --write --run ${runId}".`
    );
  }
  if (result.outcome === 'no-test-setup') {
    return (
      `forge test adopt --agent: no test setup was found for "${result.layer}" -- a conventional ` +
      `runner is proposed and an ADR was written at ${result.adrPath}. Review it, adopt the runner for ` +
      'real, then re-run "forge test adopt --agent" once real tests exist.'
    );
  }
  if (result.cause === 'proof-failed') {
    return (
      `forge test adopt --agent: exhausted ${String(result.rounds)} round(s) for "${result.layer}" -- the ` +
      `translator proof last failed check ${String(result.failedCheck)}: ${result.reason}`
    );
  }
  if (result.cause === 'proof-threw') {
    return (
      `forge test adopt --agent: exhausted ${String(result.rounds)} round(s) for "${result.layer}" -- the ` +
      `translator proof itself could not even run: ${result.reason}`
    );
  }
  return (
    `forge test adopt --agent: exhausted ${String(result.rounds)} round(s) for "${result.layer}" -- the ` +
    `session's structured response was never usable: ${result.reason}`
  );
}

/** `forge test adopt [--write [--run <runId>]] [--agent] [--check-proof <layer>] [--json]`
 * (`03` §3.2.5, `13` F-TEST-11, `specs/22` M17 P6/P7).
 *
 * `--check-proof <layer>` is `G-TestAdopt.gate.yaml`'s own `test-adoption:approved` check command --
 * the exact, real `forge <sub> --json` invocation that gate's own `run:` field names (`test/gates.test.ts`'s
 * own "every deterministic check names a real forge <sub> command" rule), always JSON (a gate check
 * command has no human-readable mode to fall back to). Exits `EXIT_CODES.success`/`failure` (never
 * `gateFailed` -- that code is `forge gate check`'s own aggregate verdict, reported by `forge gate`,
 * never by an individual deterministic check command run directly) -- `unapproved` itself, not the
 * process exit code, is what `failOn: 'unapproved > 0'` reads to decide the GATE's own pass/fail.
 *
 * `--agent` drives `runAdoptTestsAgent` directly (the identical "a real, already-built mechanism
 * exists; call it directly" precedent `forge debug`/`review`/`panel` already set), never through a
 * synthetic in-process workflow run.
 *
 * `--write [--run <runId>]` is the promotion check (`runPromotion`); `--run` defaults to the
 * project's own last dispatched run the identical way `forge gate approve`'s own `--run` already
 * does (`resolveDispatchRunId`) -- which is never the run `--agent` itself produced, since that ad
 * hoc dispatch writes no `last-run.json` pointer -- so a human who just ran `--agent` passes its own
 * printed `runId` explicitly.
 *
 * Bare `forge test adopt` runs deterministic detection and stages (or hands off) its one proposal
 * (`detect.ts`'s own `DETECTED_LAYER`, the only layer this piece's detector ever targets). */
async function runTestAdoptCommand(
  paths: ProjectPaths,
  projectRoot: string,
  options: {
    readonly write: boolean;
    readonly agent: boolean;
    readonly checkProofLayer: string | undefined;
    readonly runId: string | undefined;
  },
  json: boolean,
): Promise<number> {
  if (options.checkProofLayer !== undefined) {
    const result = await checkTestAdoptionApproved(paths, options.checkProofLayer);
    console.log(JSON.stringify(result));
    return result.unapproved === 0 ? EXIT_CODES.success : EXIT_CODES.failure;
  }
  if (options.agent) {
    const loopDeps = await buildLoopDepsForProject(paths, projectRoot);
    const runResult = await runAdoptTestsAgent({ ...loopDeps, kbRoot: KB_ROOT });
    // `runId`/`rounds`/`failedCheck`/`reason` are FORGE's own computed values, not live-model text --
    // only `reason` (the agent's own free-text explanation threaded through `writeStagedProposal`'s
    // own `reason` field) is live-agent output, so this is `sanitizeDeep`d the identical way
    // `review`/`panel`/`debug` already are.
    const result = sanitizeDeep(runResult);
    if (json) {
      console.log(JSON.stringify({ v: 1, result }));
    } else {
      console.log(describeAdoptTestsAgentResult(result));
    }
    return result.outcome === 'exhausted' ? 1 : 0;
  }
  if (options.write) {
    const result = await runPromotion(paths, DETECTED_LAYER, {
      checksRoot: CHECKS_ROOT,
      projectRoot,
      // Resolved lazily (`PromotionContext.resolveRunId`'s own doc comment): a project with no
      // staged proposal, or one with no recorded proof yet, must refuse with ITS OWN real reason --
      // never `RUN-048` ("no prior run at all") for want of a `--run` this call never needed.
      resolveRunId: () => resolveDispatchRunId(paths, options.runId),
    });
    if (json) {
      console.log(JSON.stringify({ v: 1, ...result }));
    } else if (result.outcome === 'promoted') {
      console.log(describePromotionResult(result));
    } else {
      console.error(describePromotionResult(result));
    }
    return result.outcome === 'promoted' ? 0 : 1;
  }
  const result = await runDetectionAndStage(paths);
  if (json) {
    console.log(JSON.stringify({ v: 1, ...result }));
  } else if (result.outcome === 'staged') {
    console.log(
      `forge test adopt: staged a proposal for "${result.layer}" -- ${result.candidate.reason}`,
    );
  } else {
    console.error(`forge test adopt: ${result.candidate.reason}`);
  }
  return result.outcome === 'staged' ? 0 : 1;
}

/**
 * Dispatches `forge test exempt`/`coverage`/`flaky`/`adopt`, and the real, disclosed `USR-003`
 * refusals for `forge test plan`/`generate`/`report`. `undefined` for every other command.
 *
 * @see specs/22 M17 P2
 */
export async function dispatchTestExemptCoverageFlaky(
  ctx: DispatchContext,
): Promise<number | undefined> {
  const [command, sub, ...rest] = ctx.positionals;
  const { paths, projectRoot, flags } = ctx;
  if (command !== 'test') return undefined;

  if (sub === 'coverage') {
    const rawRule = findRuleFlag(rest);
    if (rawRule !== undefined && !isTestCoverageRuleId(rawRule)) {
      console.error(
        `forge: "test coverage --rule" needs a real rule (one of: ${TEST_COVERAGE_RULE_IDS.join(', ')}); ` +
          `got ${JSON.stringify(rawRule)}.`,
      );
      return 2;
    }
    return runTestCoverageCommand(paths, projectRoot, rawRule, flags.json);
  }
  if (sub === 'flaky') {
    // A `--rule` here is a real, reportable error, not a silent no-op -- `test flaky` has no real
    // rule distinction at all.
    if (findRuleFlag(rest) !== undefined) {
      console.error('forge: "test flaky" takes no --rule at all — it answers every rule already.');
      return 2;
    }
    return runTestFlakyCommand(paths, flags.json);
  }
  if (sub === 'exempt') {
    const { values, positionals } = parseCommandFlags(rest, {
      '--reason': true,
      '--owner': true,
      '--expires': true,
    });
    if (positionals.length > 2) {
      throw new ForgeError('USR-002', { flag: '[extra positional]', value: positionals[2] ?? '' });
    }
    return runTestExemptCommand(
      paths,
      projectRoot,
      positionals[0],
      positionals[1],
      values.get('--reason'),
      values.get('--owner'),
      values.get('--expires'),
      flags.json,
    );
  }
  if (sub === 'adopt') {
    // `specs/22` M17 P6/P7 (`03` §3.2.5 row, `13` F-TEST-11): no layer positional at all -- this
    // piece's own deterministic detector and agent workflow both only ever target one layer
    // (`detect.ts`'s `DETECTED_LAYER`), so there is nothing else for a positional to select yet.
    // `--check-proof <layer>` is `G-TestAdopt.gate.yaml`'s own `run:` command (`adopt.ts`'s own
    // `checkTestAdoptionApproved`); `--run <runId>` scopes `--write`'s own approval lookup to one
    // run, the identical convention `forge gate approve`'s own `--run` already uses.
    const {
      flags: adoptFlags,
      values: adoptValues,
      positionals,
    } = parseCommandFlags(rest, {
      '--write': false,
      '--agent': false,
      '--check-proof': true,
      '--run': true,
    });
    assertNoArgs(positionals);
    return runTestAdoptCommand(
      paths,
      projectRoot,
      {
        write: adoptFlags.has('--write'),
        agent: adoptFlags.has('--agent'),
        checkProofLayer: adoptValues.get('--check-proof'),
        runId: adoptValues.get('--run'),
      },
      flags.json,
    );
  }
  // `test plan`/`test generate`/`test report` (`03` §3.2.5) — real, disclosed `USR-003` refusals: no
  // real test-strategy-planning/generation/reporting mechanism exists anywhere in this codebase.
  if (sub === 'plan' || sub === 'generate' || sub === 'report') {
    assertNoArgs(rest);
    return runTestRefusal(sub);
  }
  return undefined;
}
