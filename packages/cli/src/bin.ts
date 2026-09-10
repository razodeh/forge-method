/**
 * `forge` — a real, minimal argv dispatcher, wired to exactly the subcommands `specs/22` M6's own
 * literal exit-test line invokes (`pnpm forge agent validate --all && pnpm forge workflow validate
 * --all && pnpm forge template validate --all`, plus `pnpm forge --json status`) — not a complete
 * dispatcher for every command this codebase has built since C1.
 *
 * **A real, deliberate scope boundary, not an oversight.** Every command built in C1-C8 (`kb`, `spec`,
 * `adr`, `diagram`, `uninstall`, `run`/`resume`/`pause`/`abort`/`lanes`/`logs`/`gate`/`merge`,
 * `implement`/`debug`/`refactor`/`deploy`/`review`/`panel`/`test`/`ask`/`session`, `doctor`,
 * `upgrade`, `module`, `config`, `cost`, `export`, `help`, `customize`, `compile`, `overlay`,
 * `preset`, `skill`, `mcp`, and the rest of `agent`/`workflow` beyond `validate`) exists only as a
 * real, already-tested plain function taking a hand-built `*CommandContext` — confirmed directly, no
 * real argv dispatcher existed anywhere in this repository before this file. Wiring every one of them
 * into this dispatcher (deciding each command's own real flag shape, output formatting, and exit-code
 * mapping) is real, substantial work this milestone's own C9 mandate does not ask for — its own
 * Surface text names only `forge template validate --all` and `scripts/assert-json-contract.mjs`, not
 * a general CLI. See `SPEC-QUESTIONS.md` for the full record of this decision.
 *
 * `spec validate --rule <name> --json` (M8 P2) and `test run [--rule lint|typecheck] --json`
 * (M8 P4) were added narrowly, for the identical reason: `G-Ready.gate.yaml`/`G-Verify.gate.yaml`/
 * `G-Stable.gate.yaml` (already-shipped `@forge/templates` data) name each as a real `execa`-shelled
 * command a gate check runs, which makes it unreachable until it is a real, invocable subcommand,
 * unlike every other still-unwired command above (each of which is reachable only through this
 * package's own exported functions today, never through a shipped gate). The rest of `spec`/`test`
 * remain exactly as unwired as the paragraph above still says.
 *
 * @see specs/22 M6
 * @see specs/22 M8
 * @see PLAN-M6.md C9
 * @see PLAN-M8.md P2
 * @see PLAN-M8.md P4
 */
import { isForgeError } from '@forge/core/errors';
import { ProjectPaths } from '@forge/core/fs';

import { agentValidateAll } from './commands/agent.ts';
import { readConfig } from './commands/config.ts';
import { workflowValidateAll } from './commands/workflow.ts';
import { templateValidateAll } from './commands/template.ts';
import { testCoverage } from './commands/loop/test/coverage.ts';
import { testFlaky } from './commands/loop/test/flaky.ts';
import { createSystemTempPath } from './commands/loop/test/system-temp.ts';
import { testRun } from './commands/loop/test/run.ts';
import { runStatus, runStatusJson } from './commands/run/status.ts';
import {
  specValidateRule,
  VALIDATE_RULE_IDS,
  type ValidateRuleId,
} from './commands/spec/validate-rules.ts';
import { parseGlobalFlags } from './entry/parse-global-flags.ts';

const AGENTS_ROOT = '.forge/agents';
const WORKFLOWS_ROOT = '.forge/workflows';
const CHECKS_ROOT = '.forge/checks';
const SPECS_ROOT = 'docs/forge/specs';
const KB_ROOT = 'docs/forge/kb';

async function runAgentValidate(paths: ProjectPaths, json: boolean): Promise<number> {
  const findings = await agentValidateAll({ paths, agentsRoot: AGENTS_ROOT });
  if (json) {
    console.log(JSON.stringify({ v: 1, findings }));
  } else if (findings.length === 0) {
    console.log('forge agent validate --all: no real findings.');
  } else {
    for (const finding of findings) {
      console.error(`${finding.severity} ${finding.agentId} ${finding.code}: ${finding.message}`);
    }
  }
  return findings.some((finding) => finding.severity === 'error') ? 1 : 0;
}

async function runWorkflowValidate(paths: ProjectPaths, json: boolean): Promise<number> {
  const results = await workflowValidateAll({
    paths,
    workflowsRoot: WORKFLOWS_ROOT,
    agentsRoot: AGENTS_ROOT,
    checksRoot: CHECKS_ROOT,
  });
  const allIssues = [...results.values()].flat();
  if (json) {
    console.log(JSON.stringify({ v: 1, results: Object.fromEntries(results) }));
  } else if (allIssues.length === 0) {
    console.log('forge workflow validate --all: no real issues.');
  } else {
    for (const [id, issues] of results) {
      for (const issue of issues) console.error(`${id}: ${issue.code} ${issue.message}`);
    }
  }
  return allIssues.length > 0 ? 1 : 0;
}

async function runTemplateValidate(json: boolean): Promise<number> {
  const results = await templateValidateAll();
  const invalid = results.filter((result) => !result.valid);
  if (json) {
    console.log(JSON.stringify({ v: 1, results }));
  } else if (invalid.length === 0) {
    console.log('forge template validate --all: no real errors.');
  } else {
    for (const result of invalid) console.error(`${result.type}: ${result.errors.join('; ')}`);
  }
  return invalid.length > 0 ? 1 : 0;
}

async function runStatusCommand(
  paths: ProjectPaths,
  projectRoot: string,
  json: boolean,
): Promise<number> {
  if (json) {
    const report = await runStatusJson(paths, projectRoot, undefined);
    console.log(JSON.stringify(report));
  } else {
    const status = await runStatus(paths, projectRoot, undefined);
    console.log(JSON.stringify(status, null, 2));
  }
  return 0;
}

function isValidateRuleId(value: string | undefined): value is ValidateRuleId {
  return value !== undefined && (VALIDATE_RULE_IDS as readonly string[]).includes(value);
}

/** `--rule <name>` is not a global flag (`parseGlobalFlags`' own `KNOWN_FLAGS` has no entry for it),
 * so it survives into `rest` verbatim — found and validated here rather than adding it to the shared
 * global-flags parser, matching `requireAllFlag`'s own precedent of parsing a command-specific flag
 * out of `rest` locally instead of widening a parser every other command also goes through.
 *
 * Returns `''` (never a real rule id), not `undefined`, when `--rule` is present but is the very last
 * token — a fresh critic round reproduced this directly: `rest[index + 1]` is `undefined` for that
 * case too, indistinguishable from "no `--rule` at all," so `forge test coverage --rule` (trailing,
 * no value) silently ran the default rule instead of erroring, the identical gap `findRawTestRuleFlag`
 * below already exists to close for a *misspelled* value. `''` fails every real rule-id check exactly
 * like a misspelled one does, with no new branching needed at any call site. */
function findRuleFlag(rest: readonly string[]): string | undefined {
  const index = rest.indexOf('--rule');
  if (index === -1) return undefined;
  return rest[index + 1] ?? '';
}

/** `story:dor`/`story:file-claim-overlap`/etc. (`G-Ready.gate.yaml`/`G-Stable.gate.yaml`) each shell
 * `forge spec validate --rule <name> --json` and read a top-level numeric `errors` field back
 * (`failOn: 'errors > 0'`) — `specValidateRule`'s own return value carries the full `violations` list
 * instead (real callers want to know *what*, `@forge/methods/dod`'s own doc comment gives the fuller
 * reasoning), so this is the one place that numeric field is actually produced. */
async function runSpecValidateRule(
  paths: ProjectPaths,
  rule: ValidateRuleId,
  json: boolean,
): Promise<number> {
  const ctx = { paths, specsRoot: SPECS_ROOT, kbRoot: KB_ROOT };
  const result = await specValidateRule(ctx, rule);
  if (json) {
    console.log(
      JSON.stringify({ v: 1, errors: result.violations.length, violations: result.violations }),
    );
  } else if (result.violations.length === 0) {
    console.log(`forge spec validate --rule ${rule}: no real violations.`);
  } else {
    for (const violation of result.violations) {
      console.error(`${violation.subject}: ${violation.message}`);
    }
  }
  return result.violations.length > 0 ? 1 : 0;
}

const TEST_RULE_IDS = ['lint', 'typecheck', 'oracle-lint'] as const;
type TestRuleId = (typeof TEST_RULE_IDS)[number];

function isTestRuleId(value: string | undefined): value is TestRuleId {
  return value !== undefined && (TEST_RULE_IDS as readonly string[]).includes(value);
}

/** `--rule lint|typecheck`, the same "not a global flag, found locally in `rest`" pattern
 * `findRuleFlag` above already establishes for `spec validate`. Returns the raw value verbatim
 * (never silently narrowed to `undefined` for an unrecognised one) — a fresh critic round found
 * the original version collapsed "no `--rule` given" and "a `--rule` given but misspelled" into
 * the identical `undefined`, so a typo (`--rule typecheckk`) silently ran the entire default test
 * suite instead of erroring, the same real, reported gap `isValidateRuleId` below already avoids
 * for `spec validate`. A later critic round (`PLAN-M8.md` P6) found the identical collapse still
 * happened for a *trailing, valueless* `--rule` (the very last token in `rest`) — `findRuleFlag`'s
 * own doc comment above has the fuller reasoning for returning `''` rather than `undefined` there. */
function findRawTestRuleFlag(rest: readonly string[]): string | undefined {
  const index = rest.indexOf('--rule');
  return index === -1 ? undefined : (rest[index + 1] ?? '');
}

/** `test:run`/`test:lint`/`test:typecheck` (`G-Verify.gate.yaml`) each shell `forge test run
 * [--rule lint|typecheck] --json` and read back a top-level numeric `failed` or `errors` field
 * (`failOn: 'failed > 0'` / `'errors > 0'`) — `testRun`'s own return value already carries both,
 * per its own doc comment's reasoning; this wiring just adds the real project config and a real
 * `createTempPath`. */
async function runTestRunCommand(
  paths: ProjectPaths,
  projectRoot: string,
  rule: TestRuleId | undefined,
  json: boolean,
): Promise<number> {
  const config = await readConfig(paths);
  const ctx = {
    paths,
    projectRoot,
    testCommands: config.execution.testCommands,
    flakeConfig: config.quality.flake,
  };
  const options = rule === undefined ? {} : { rule };
  const result = await testRun(ctx, options, () => createSystemTempPath('forge-test-run'));
  if (json) {
    console.log(JSON.stringify({ v: 1, ...result }));
  } else if ((result.problems ?? []).length > 0) {
    for (const problem of result.problems ?? []) console.error(problem);
  } else {
    console.log(
      `forge test run${rule === undefined ? '' : ` --rule ${rule}`}: failed=${String(result.failed)} errors=${String(result.errors)}.`,
    );
  }
  return result.failed > 0 || result.errors > 0 ? 1 : 0;
}

const TEST_COVERAGE_RULE_IDS = ['acceptance-criteria', 'ratchet'] as const;
type TestCoverageRuleId = (typeof TEST_COVERAGE_RULE_IDS)[number];

function isTestCoverageRuleId(value: string | undefined): value is TestCoverageRuleId {
  return value !== undefined && (TEST_COVERAGE_RULE_IDS as readonly string[]).includes(value);
}

/** `story:ac-coverage`/`test:coverage`/`coverage:ratchet` (`G-Verify.gate.yaml`) each shell `forge
 * test coverage [--rule acceptance-criteria|ratchet] --json` and read back a top-level numeric
 * `coverage`/`regressions` field (`failOn: 'coverage < 100'`/`'coverage < 80'`/`'regressions > 0'`)
 * — `testCoverage`'s own return value already carries both, per its own doc comment's reasoning. */
async function runTestCoverageCommand(
  paths: ProjectPaths,
  projectRoot: string,
  rule: TestCoverageRuleId | undefined,
  json: boolean,
): Promise<number> {
  const ctx = { paths, projectRoot, specsRoot: SPECS_ROOT };
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
    // A fresh critic round found the non-`--json` path told a human "coverage=50" with no way to
    // learn *which* AC was unproven — `result.missingAcIds` already names every one.
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
 * `failOn: 'quarantined > 5'`, `quality.flake.quarantineCap`'s own literal default) both shell the
 * identical `forge test flaky --json` — `testFlaky`'s own return value always carries both fields
 * together (the same "both always present, only one is semantically meaningful per caller" shape
 * `TestRunResult`/`TestCoverageResult` already establish), so one real invocation answers both
 * already-shipped checks with no `--rule` needed at all — a bare `--rule` on this command is always
 * rejected (exit 2), the same strict-unrecognised-flag discipline `test run`/`test coverage` already
 * apply, rather than the first draft's own silent no-op for one. This command's own bare exit code
 * (for a human running it directly, outside either gate) fails on *either* condition, since it has no
 * way to know which gate is asking. */
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

async function main(): Promise<number> {
  const flags = parseGlobalFlags(process.argv.slice(2));
  const [command, sub, ...rest] = flags.positionals;
  const projectRoot = flags.project ?? process.cwd();
  const paths = new ProjectPaths(projectRoot);

  // A critic round caught the original version falling through to the generic "not wired" message
  // below for e.g. `agent validate` with no real `--all` -- wrong: this command *is* wired, the real
  // problem is a missing required flag, and the generic message pointed a caller at dozens of
  // genuinely-unimplemented commands instead of naming the one real thing they actually got wrong.
  const isValidateAll = (name: string): boolean => command === name && sub === 'validate';
  const requireAllFlag = (): boolean => {
    if (rest.includes('--all')) return true;
    console.error(
      `forge: "${String(command)} ${String(sub)}" is real, but needs --all (only the real "--all" form is wired ` +
        'here yet; a real single-id form does not exist).',
    );
    return false;
  };

  if (isValidateAll('agent')) {
    return requireAllFlag() ? runAgentValidate(paths, flags.json) : 2;
  }
  if (isValidateAll('workflow')) {
    return requireAllFlag() ? runWorkflowValidate(paths, flags.json) : 2;
  }
  if (isValidateAll('template')) {
    return requireAllFlag() ? runTemplateValidate(flags.json) : 2;
  }
  if (command === 'status') {
    return runStatusCommand(paths, projectRoot, flags.json);
  }
  if (command === 'spec' && sub === 'validate') {
    const ruleFlag = findRuleFlag(rest);
    if (!isValidateRuleId(ruleFlag)) {
      console.error(
        `forge: "spec validate" needs a real --rule <name> (one of: ${VALIDATE_RULE_IDS.join(', ')}); ` +
          `got ${JSON.stringify(ruleFlag)}. The bare, no-rule form of "spec validate" is not wired here yet.`,
      );
      return 2;
    }
    return runSpecValidateRule(paths, ruleFlag, flags.json);
  }
  if (command === 'test' && sub === 'run') {
    const rawRule = findRawTestRuleFlag(rest);
    if (rawRule !== undefined && !isTestRuleId(rawRule)) {
      console.error(
        `forge: "test run --rule" needs a real rule (one of: ${TEST_RULE_IDS.join(', ')}); ` +
          `got ${JSON.stringify(rawRule)}.`,
      );
      return 2;
    }
    return runTestRunCommand(paths, projectRoot, rawRule, flags.json);
  }
  if (command === 'test' && sub === 'coverage') {
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
  if (command === 'test' && sub === 'flaky') {
    // A fresh critic round found the first draft silently accepted (and ignored) any `--rule` value
    // here, including a real typo of the plan's own first-drafted `--rule quarantine-cap` form —
    // `test flaky` has no real rule distinction at all (this doc comment's own fuller reasoning is on
    // `runTestFlakyCommand`), so any `--rule` at all is a real, reportable error, not a silent no-op.
    if (findRuleFlag(rest) !== undefined) {
      console.error('forge: "test flaky" takes no --rule at all — it answers every rule already.');
      return 2;
    }
    return runTestFlakyCommand(paths, flags.json);
  }

  console.error(
    `forge: "${[command, sub].filter((token) => token !== undefined).join(' ')}" is not wired into ` +
      "this real, deliberately minimal dispatcher yet (see bin.ts's own doc comment for the full " +
      'list of commands that exist as real functions but have no CLI wiring yet).',
  );
  return 2;
}

try {
  process.exitCode = await main();
} catch (error) {
  if (isForgeError(error)) {
    console.error(error.message);
    console.error(error.remedy);
    process.exitCode = error.exitCode;
  } else {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  }
}
