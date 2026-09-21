/**
 * The test-running exec grant, derived from `execution.testCommands` (`PLAN-M13.md` P23, owner question 6,
 * `SPEC-QUESTIONS.md` Q230; `13` §13.1 F-TEST-1 rule 4 "every layer has a single command"; `18` §18.3; `20` §20.1).
 *
 * Before this, no agent's `exec` held a test runner (`git *`, `ls*`, `rg*`, `cat*`, `tree*`), so a diagnostician could
 * not run the failing test it was asked to reproduce, an sdet could not see its own red, and a code-owner could not
 * see green. Writing `pnpm test*` into the agent YAML is wrong for most projects and wider than any command the user
 * chose. The project already says what runs each layer: `execution.testCommands`. So the effective session grant is
 *
 *     the agent's declared exec patterns  UNION  one EXACT pattern per test layer the step needs.
 *
 * "Exact" is the whole security argument, and it has four parts:
 *
 * 1. The pattern is the configured string, character for character. `matchesExecPattern` (`adapter-kit`) treats a
 *    pattern with no trailing `*` as an equality test, and the Claude Code adapter emits it as `Bash(<command>)` with
 *    no wildcard, so the model cannot append an argument (`pnpm test -- --reporter=x` is not `pnpm test`).
 * 2. A configured command that could WIDEN when written as a pattern is not derived at all: any `*` (a trailing one
 *    makes `matchesExecPattern` a prefix match, and Claude Code reads `*` as a wildcard anywhere in a rule), a shell
 *    operator (an exact pattern is exempt from the operator veto at enforcement, so an exact `a && b` would grant the
 *    chain), everything the vet (`vetConfiguredCommand`: the syntax stage, then the network, package-manager, git and
 *    argument stages under `network: none`) would refuse for a model (an expansion, the hard denylist, `curl`, `git push`,
 *    `pnpm install`), because a pattern the vet then refused would grant nothing while block [6] said it did, and
 *    anything the Claude Code adapter cannot carry in an exact rule (a parenthesis, a comma, a backslash), glob characters,
 *    unusual whitespace and a quoted program name (the same reasons). Such a layer is reported as unavailable, with its remedy,
 *    never silently granted and never silently dropped (`checkTestCommand`, the rule `forge doctor --rule test-command`
 *    and `forge config set execution.testCommands.<layer>` share).
 * 3. Only the layers the step's BRIEF needs (`TEST_LAYERS_BY_BRIEF`, read off the shipped briefs), and only to an agent
 *    whose own resolved grant already allows running commands (`grantWithTestExec`): an agent that declares no exec is
 *    not handed a command because a step names a brief.
 * 4. A tainted step, a read-only session and a session with no exec at all get nothing: `restrictGrantForTaint` and the
 *    read-only clamp set `exec: false` BEFORE this runs, and `false` stays `false`.
 *
 * Why this sits outside the agent's `ceiling`: `checkToolCeiling` bounds what an agent DEFINITION or an overlay may
 * widen to across a trust boundary (a module's agent, a project overlay). A derived command comes from the project's
 * own `.forge/config.yaml` (a protected path a step cannot write, `20` §20.2), it is exact, and it is a command FORGE
 * itself runs for `forge test run`; it cannot exceed what the user already authorised. Routing it through the ceiling
 * would make every project widen every implementation role's `ceilings:` block (or an escalation per project) to say
 * "yes, run my own test command", and `patternCoversPattern` correctly refuses an exact pattern that no wildcard entry
 * covers. Recorded in Q230; the ceiling blocks are unchanged.
 *
 * @see specs/13 §13.1
 * @see specs/20 §20.1
 * @see PLAN-M13.md P23
 * @see SPEC-QUESTIONS.md Q230
 */
import type { ToolGrant } from '@forge/adapter-kit';

import {
  commandWords,
  vetConfiguredCommand,
  type CommandRefusalReason,
} from './confined-command.ts';

/**
 * The layers of `execution.testCommands` (`@forge/schemas` config `TEST_LAYERS`; a test pins that the two lists are the
 * same). Not imported: the schema keeps its list private and a shared-file change for a name is not worth the drift risk
 * the test already covers.
 */
export const TEST_COMMAND_LAYERS = [
  'unit',
  'integration',
  'contract',
  'e2e',
  'nfr',
  'smoke',
  'lint',
  'typecheck',
] as const;

export type TestCommandLayer = (typeof TEST_COMMAND_LAYERS)[number];

/** `execution.testCommands` as the engine holds it. */
export type TestCommands = Readonly<Partial<Record<string, string>>>;

/** The longest configured command a pattern is derived from: a test command is a short invocation. */
export const MAX_TEST_COMMAND_LENGTH = 1000;

export type TestCommandProblem =
  | 'blank'
  | 'multiline'
  | 'too-long'
  | 'operator'
  | 'expansion'
  | 'denylisted'
  | 'malformed'
  | 'wildcard'
  | 'env-assignment'
  | 'unsupported-character'
  | 'quoted-program'
  | 'not-a-test-command';

export type TestCommandCheck =
  | { readonly ok: true; readonly command: string }
  | {
      readonly ok: false;
      readonly problem: TestCommandProblem;
      /** What is wrong with THIS value, one sentence. */
      readonly detail: string;
      /** The action that clears it, an imperative sentence. */
      readonly remedy: string;
    };

const SCRIPT_REMEDY =
  'Put the steps in a script (a package.json script, a Makefile target) and set the layer to the one command that runs it, for example `pnpm run test:unit`.';

function refusal(
  problem: TestCommandProblem,
  detail: string,
  remedy: string,
): Extract<TestCommandCheck, { ok: false }> {
  return { ok: false, problem, detail, remedy };
}

const REASON_TO_PROBLEM: Readonly<Record<CommandRefusalReason, TestCommandProblem>> = {
  malformed: 'malformed',
  denylisted: 'denylisted',
  'shell-operator': 'operator',
  expansion: 'expansion',
  // The network, package-manager, git and argument stages (`vetConfiguredCommand`): a command that reaches out, installs,
  // publishes or changes a repository is not a test command.
  network: 'not-a-test-command',
  'dangerous-argument': 'not-a-test-command',
  // Not produced for a configured command (no grant, no path stage); named so the map stays total.
  'not-in-grant': 'malformed',
  'path-escape': 'malformed',
  'secret-path': 'malformed',
};

/** Whitespace other than a plain space, and every control, format (zero-width, bidi, soft hyphen, byte-order mark, tag),
 * line/paragraph separator, private-use, unassigned and surrogate character (Unicode general categories, so nothing is
 * listed by hand and the source holds no raw control character). */
const UNUSUAL_CHARACTERS = /[^\S ]|[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}\p{Cs}]/u;

/**
 * Whether `raw` (a configured `execution.testCommands.<layer>` value) is one plain invocation FORGE can run and can
 * grant EXACTLY: one line, no shell operator, no expansion, no `*`, and it starts with a program rather than a
 * `VAR=value` prefix. The returned `command` is the value with surrounding whitespace removed (a YAML block scalar
 * ends in a newline); it is the string a pattern is built from and the string a proposed command is compared with.
 */
export function checkTestCommand(raw: string): TestCommandCheck {
  const command = raw.trim();
  if (command === '') {
    return refusal(
      'blank',
      'the command is empty',
      'Set it to the single command that runs the layer and exits non-zero on failure.',
    );
  }
  if (/[\n\r\0]/.test(command)) {
    return refusal('multiline', 'the command spans more than one line', SCRIPT_REMEDY);
  }
  if (command.length > MAX_TEST_COMMAND_LENGTH) {
    return refusal(
      'too-long',
      `the command is longer than ${String(MAX_TEST_COMMAND_LENGTH)} characters`,
      SCRIPT_REMEDY,
    );
  }
  const syntax = vetConfiguredCommand(command);
  if (syntax !== undefined) {
    const problem = REASON_TO_PROBLEM[syntax.reason];
    return refusal(
      problem,
      syntax.detail,
      problem === 'denylisted'
        ? 'Use a command that is not on the hard denylist (`20` §20.1).'
        : problem === 'not-a-test-command'
          ? 'Use a command that only runs tests: it may not fetch from the network, install or publish packages, or run git operations that reach a remote or change the repository.'
          : SCRIPT_REMEDY,
    );
  }
  if (command.includes('*')) {
    return refusal(
      'wildcard',
      'the command contains "*", which would widen an exec grant',
      'Name the files in a script instead of a glob: an exact command cannot contain "*" (a "*" in a grant matches more than the one command).',
    );
  }
  // Whitespace other than a plain space, and control or invisible characters, are read differently by the shell, by the
  // pattern matcher (`\\s` splits on a no-break space, the shell does not) and by block [6] (`oneLine` rewrites line
  // separators), so a grant built from one would not be the string the model is shown or the string that runs.
  if (UNUSUAL_CHARACTERS.test(command)) {
    return refusal(
      'unsupported-character',
      'the command contains a tab, a no-break or invisible space, or a control character',
      'Use plain spaces between words, or put the command in a script.',
    );
  }
  // A parenthesis or a comma cannot be written into an exact permission rule without ambiguity: the Claude Code adapter
  // refuses them (`safeBashRule`: an unbalanced one would close the rule and open a second), so a command holding one would
  // be listed as granted and denied by the platform. A backslash is unescaped by the platform's rule parser, and `?` and `[`
  // are shell globs whose expansion (lane contents a fix session wrote) the exemption for a configured command does not
  // vet. Refused here so the doctor, block [6] and the grant agree.
  if (/[(),\\?[]/.test(command)) {
    return refusal(
      'unsupported-character',
      'the command contains one of ( ) , \\ ? [, which an exact permission rule cannot carry unambiguously (a glob character or an escape is read differently by the shell, the platform and the vet)',
      SCRIPT_REMEDY,
    );
  }
  const program = commandWords(command)?.[0];
  if (program !== undefined && command.split(' ', 1)[0] !== program) {
    return refusal(
      'quoted-program',
      'the program name is quoted, so the grant’s first word and the shell’s would differ',
      'Write the program without quotes (quote arguments only).',
    );
  }
  if (program !== undefined && /^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(program)) {
    return refusal(
      'env-assignment',
      `the command starts with the variable assignment "${program}", not a program`,
      'Move the variable into the script or the tool’s own configuration; the command must start with the program.',
    );
  }
  return { ok: true, command };
}

/**
 * The layers a step needs to run, keyed by the step's BRIEF (the `briefs/<name>.md` basename, or the `briefKey` an
 * ad-hoc session passes). Read off the shipped briefs, not invented (`SPEC-QUESTIONS.md` Q230 has the row-by-row
 * reasoning):
 *
 * - reproducing and diagnosing (`run-rca-framework`, `rca`, `reproduce-defect`, `debug-isolate`, `write-failing-tests`):
 *   `unit` and `integration`, the layers a failing test lives in. `e2e`, `nfr` and `smoke` need an environment (a preview
 *   stack, a deployed target, `14` §14.9) a lane does not have.
 * - making it pass, keeping it passing (`implement-story`, `refactor-story`, `refactor`, `fix-defect`): the same two plus
 *   `typecheck` and `lint`, because those briefs say the code must meet the project's lint and typecheck rules.
 *
 * Deliberately absent: `write-contract-tests` (its one command runs one file, which no layer command is), the migration
 * briefs (they say the NEXT step runs the suite), `performance-hardening-pass` and `verify-nfrs` (the NFR layer needs its
 * own environment, and those briefs mark unrun measurements "not run" on purpose), and every reviewer and author brief.
 */
export const TEST_LAYERS_BY_BRIEF: Readonly<Record<string, readonly TestCommandLayer[]>> = {
  'run-rca-framework': ['unit', 'integration'],
  rca: ['unit', 'integration'],
  'reproduce-defect': ['unit', 'integration'],
  'debug-isolate': ['unit', 'integration'],
  'write-failing-tests': ['unit', 'integration'],
  'implement-story': ['typecheck', 'lint', 'unit', 'integration'],
  'refactor-story': ['typecheck', 'lint', 'unit', 'integration'],
  refactor: ['typecheck', 'lint', 'unit', 'integration'],
  'fix-defect': ['typecheck', 'lint', 'unit', 'integration'],
};

/**
 * The layers some step's brief runs (`TEST_LAYERS_BY_BRIEF`, in `TEST_COMMAND_LAYERS` order): the ones whose command becomes
 * an exec pattern, so the ones `forge doctor --rule test-command` and `forge config set` hold to `checkTestCommand`. The rest
 * (`contract`, `e2e`, `nfr`, `smoke`) run only through `forge test run` and the gates, which accept a chained command
 * (`SPEC-QUESTIONS.md` Q219 lets a `smoke` command chain with `&&`), so they are held only to "one line".
 */
export const AGENT_RUN_LAYERS: readonly TestCommandLayer[] = TEST_COMMAND_LAYERS.filter((layer) =>
  Object.values(TEST_LAYERS_BY_BRIEF).some((layers) => layers.includes(layer)),
);

/** The layers the step with this brief key runs; none for a brief that runs no tests (or no brief). */
export function testLayersForBrief(briefKey: string | undefined): readonly TestCommandLayer[] {
  if (briefKey === undefined || !Object.hasOwn(TEST_LAYERS_BY_BRIEF, briefKey)) return [];
  return TEST_LAYERS_BY_BRIEF[briefKey] ?? [];
}

/** A layer the step needs and cannot be granted, and why: the config key is unset, or its value is not one plain command. */
export interface UnavailableTestLayer {
  readonly layer: TestCommandLayer;
  readonly reason: 'unset' | TestCommandProblem;
  readonly detail: string;
  readonly remedy: string;
}

export interface DerivedTestExec {
  /** The exact exec patterns to add, in layer order, without duplicates. Each is a configured command, verbatim. */
  readonly patterns: readonly string[];
  /** Which layer each granted command runs. */
  readonly granted: readonly { readonly layer: TestCommandLayer; readonly command: string }[];
  /** Needed layers that got nothing (unable to verify, `13` F-TEST-1: never reported as passing). */
  readonly unavailable: readonly UnavailableTestLayer[];
}

/** What a step that needs no test layer, or a project that configures none, derives. */
export const NO_DERIVED_TEST_EXEC: DerivedTestExec = {
  patterns: [],
  granted: [],
  unavailable: [],
};

/**
 * The exact exec patterns for `layers` under `testCommands`. Pure: the same inputs derive the same patterns, in the
 * order of `layers`, and a layer configured with the same command as an earlier one adds no second copy.
 */
export function deriveTestExec(
  testCommands: TestCommands | undefined,
  layers: readonly TestCommandLayer[],
): DerivedTestExec {
  if (layers.length === 0) return NO_DERIVED_TEST_EXEC;
  const patterns: string[] = [];
  const granted: { layer: TestCommandLayer; command: string }[] = [];
  const unavailable: UnavailableTestLayer[] = [];
  for (const layer of layers) {
    const configured = testCommands === undefined ? undefined : testCommands[layer];
    if (configured === undefined) {
      unavailable.push({
        layer,
        reason: 'unset',
        detail: `execution.testCommands.${layer} is not set`,
        remedy: `Run \`forge config set execution.testCommands.${layer} "<command>"\` with the single command that runs the ${layer} layer.`,
      });
      continue;
    }
    const checked = checkTestCommand(configured);
    if (!checked.ok) {
      unavailable.push({
        layer,
        reason: checked.problem,
        detail: `execution.testCommands.${layer}: ${checked.detail}`,
        remedy: checked.remedy,
      });
      continue;
    }
    granted.push({ layer, command: checked.command });
    if (!patterns.includes(checked.command)) patterns.push(checked.command);
  }
  return { patterns, granted, unavailable };
}

/**
 * `grant` with `derived.patterns` added to its exec patterns. An agent whose resolved grant allows no commands
 * (`exec: false`: it declares none, the session is read-only, or the step is tainted and `restrictGrantForTaint`
 * removed them) gets nothing: this never turns "no exec" into "some exec". The agent's own patterns are kept as they
 * are, and a pattern it already holds is not repeated.
 */
export function grantWithTestExec(grant: ToolGrant, derived: DerivedTestExec): ToolGrant {
  if (grant.exec === false || derived.patterns.length === 0) return grant;
  const own = grant.exec;
  return {
    ...grant,
    exec: [...own, ...derived.patterns.filter((pattern) => !own.includes(pattern))],
  };
}
