/**
 * Every `kind: command` step of every shipped workflow names a `forge` command the real CLI accepts
 * (`PLAN-M13.md` P22, `P11-TRIAGE.md` register D5, `SPEC-QUESTIONS.md` Q213).
 *
 * A workflow command step is what makes a loop verify anything (`implement-story:self-verify`,
 * `quick-fix:verify`, `debug:prove-fix`, `deliver-stage`'s three steps, `adopt`'s first step,
 * `migrate`'s third, `replan`'s last). When the string it runs is not a command the CLI knows, the step
 * fails on every run, and the loop that was meant to prove something proves nothing. Nine such steps
 * shipped; nothing noticed because no test read them.
 *
 * How the CLI is asked. `bin.ts` runs `main()` when it is loaded, so there is no importable parser. Each
 * distinct `forge ...` invocation is therefore run against the real source CLI, exactly as a command step would
 * run it, in a throwaway project holding only a default `.forge/config.yaml` (no test command, no workflow, no
 * spec, no agent): the CLI validates a subcommand and its flags only once it has a project to build a context
 * from, so an EMPTY directory would stop every command at "no config" (exit 5) before it looked at its
 * arguments, and a typo such as `forge kb synk` would read as accepted. In that project every command has
 * nothing to change and nothing to run.
 *
 * Every invocation must then be classified positively, or the test fails loudly. REJECTED: exit 2 with one of the
 * dispatcher's refusals ("is not wired", "needs a real ...", an unknown flag as `USR-002` "Invalid value", a `USR-003` "is not yet supported").
 * ACCEPTED: it got past its argument checks: exit 0, exit 1 with no stack trace (a verification result, such as
 * "no ecosystem"), or exit 2 with a refusal that can only come after the arguments were read ("No such workflow",
 * "no Story with id"). Anything else (a crash, a timeout, an exit code nobody expected) is UNCLASSIFIED and fails
 * the test, so a new failure mode cannot pass by default. Two known blind spots: a command that ignores unknown
 * flags (`forge test flaky --bogus` runs) cannot be told from one that accepts them, and a wrong WORKFLOW or STORY
 * id (`forge run no-such-workflow`, `forge plan run-plan` over a missing workflow) is "understood but not found",
 * which is accepted, because the throwaway project deliberately has none to find.
 *
 * The pinned list below is the disclosed remainder: invocations the CLI still rejects, each with the reason
 * and who resolves it. It is checked both ways: an entry that becomes accepted fails the test (delete it in
 * the same commit that wires the command), and an entry no shipped workflow uses any more fails it too
 * (a stale pin hides the next real gap).
 *
 * A second check covers what parsing cannot: `forge deploy <env>` accepts ANY word as its `<env>`, so
 * `forge deploy run`, `forge deploy smoke-test` and `forge deploy rollback` all parsed. `03` §3.2.5 gives
 * `deploy` one positional, the environment, and running a delivery workflow's own step through the command
 * that runs that workflow would recurse; a step string must therefore not carry a subcommand-looking word.
 *
 * Lives at the repository root for the reason `test/workflows.test.ts` documents (it needs the bare
 * `modules/` directory and `@forge/templates`, which no single package may import).
 *
 * @see specs/03 §3.2
 * @see specs/10 §10.1, §10.6
 * @see PLAN-M13.md P22
 * @see SPEC-QUESTIONS.md Q213
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { afterAll, describe, expect, it } from 'vitest';
import * as YAML from 'yaml';

import { parseWorkflow } from '@forge/engine/workflow';
import { DEFAULT_CONFIG } from '@forge/schemas/config';
import { WORKFLOW_INDEX } from '@forge/templates';

import { NON_FORGE_STEPS } from './non-forge-steps.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulesDir = path.join(repoRoot, 'modules');
const templatesRoot = path.join(repoRoot, 'packages', 'templates');
const BIN = path.join(repoRoot, 'packages', 'cli', 'src', 'bin.ts');

/**
 * The invocations no shipped workflow may name until the CLI accepts them. Keys are the exact command as it
 * is compiled (template placeholders replaced by `PLACEHOLDER`), values say why it is rejected and which piece
 * of `PLAN-M13.md` (or which owner decision) resolves it. Nothing here is a bug to be quietly deleted:
 * removing an entry requires wiring the command.
 */
const KNOWN_UNACCEPTED: Readonly<Record<string, string>> = {
  'forge adopt inventory --json':
    'Q213: `forge adopt` is wired nowhere in bin.ts (`17` §17.6 defines `forge adopt [dir] [--scope] [--depth] [--no-verify]`, the whole eight-phase pipeline, and no `inventory` subcommand). Wiring it needs the adopt pipeline context (CARTOGRAPHY/INFERENCE dispatch), which is a product decision, not this piece. Deferred by `P11-TRIAGE.md` §5.',
  'forge migrate run --phase expand --json':
    'Q213 / Q202 finding 8: `03` defines no `forge migrate` command and `10` §10.5 gives `migrate` no cut-over step (D7, an L3+ product decision). Deferred by `P11-TRIAGE.md` §5.',
  'forge spec re-derive --json':
    'Q213: `03` §3.2.2 lists `list|show|validate|trace|matrix|orphans|new` for `forge spec`; `09` §9.7 says only that affected tests are re-derived after a spec change, with no command that does it. Deferred by `P11-TRIAGE.md` §5.',
};

interface CommandStep {
  /** `<workflow>:<step id>`, module workflows prefixed `<module>/<file>:`. */
  readonly key: string;
  readonly run: string;
}

function walkCommandSteps(prefix: string, node: unknown, into: CommandStep[]): void {
  if (Array.isArray(node)) {
    for (const item of node) walkCommandSteps(prefix, item, into);
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  const record = node as Record<string, unknown>;
  if (record['kind'] === 'command' && typeof record['run'] === 'string') {
    const id = typeof record['id'] === 'string' ? record['id'] : '(unnamed)';
    into.push({ key: `${prefix}:${id}`, run: record['run'] });
  }
  for (const value of Object.values(record)) walkCommandSteps(prefix, value, into);
}

function shippedCommandSteps(): readonly CommandStep[] {
  const found: CommandStep[] = [];
  const add = (prefix: string, source: string): void => {
    const parsed = parseWorkflow(source);
    if (!parsed.success) throw new Error(`shipped workflow ${prefix} does not parse`);
    walkCommandSteps(prefix, parsed.workflow.steps, found);
    // `onComplete` and `onFailure` escalation steps are steps too; walk the whole document, not `steps` only.
    walkCommandSteps(prefix, { ...parsed.workflow, steps: [] }, found);
  };
  for (const [id, relative] of Object.entries(WORKFLOW_INDEX)) {
    add(id, readFileSync(path.join(templatesRoot, relative), 'utf8'));
  }
  for (const moduleName of readdirSync(modulesDir)) {
    const workflowsDir = path.join(modulesDir, moduleName, 'workflows');
    let files: string[];
    try {
      files = readdirSync(workflowsDir).filter((file) => file.endsWith('.workflow.yaml'));
    } catch {
      continue;
    }
    for (const file of files) {
      add(`${moduleName}/${file}`, readFileSync(path.join(workflowsDir, file), 'utf8'));
    }
  }
  return found;
}

/** The `forge ...` segments of a step's shell string (`a && b`, `a || b`, `a; b`, `a | b`, newlines), as token lists. */
function forgeInvocations(run: string): readonly (readonly string[])[] {
  return run
    .split(/&&|\|\||[;|\n]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment === 'forge' || segment.startsWith('forge '))
    .map((segment) => segment.split(/\s+/));
}

const PLACEHOLDER = 'PLACEHOLDER';
const isTemplateToken = (token: string): boolean => /^\{\{[^}]*\}\}$/.test(token);
const compiled = (tokens: readonly string[]): readonly string[] =>
  tokens.map((token) => token.replaceAll(/\{\{[^}]*\}\}/g, PLACEHOLDER));

const steps = shippedCommandSteps();
const invocations = steps.flatMap((step) =>
  forgeInvocations(step.run).map((tokens) => ({ step: step.key, tokens })),
);
const distinct = [...new Set(invocations.map(({ tokens }) => compiled(tokens).join(' ')))].sort();

const REJECTION_MESSAGES = [
  /is not wired into this real/,
  /needs a real /,
  /^Invalid value /m,
  /is not yet supported/,
] as const;
/** Refusals that only exist downstream of argument parsing: the invocation was understood. */
const UNDERSTOOD_REFUSALS = [
  /^No such workflow /m,
  /no Story with id/,
  // `forge config set <key> <value>` found the key and validated the value: a step that passes an elicit answer
  // (`"$FORGE_ANSWER_x"`) reaches it here as the literal text, which is not a valid level (PLAN-M13.md P20).
  /^Invalid configuration in /m,
] as const;
const STACK_TRACE = /^\s+at .+:\d+:\d+\)?$/m;

type Classification = 'accepted' | 'rejected' | 'unclassified';

function classify(exitCode: number, stderr: string): Classification {
  if (exitCode === 2 && REJECTION_MESSAGES.some((pattern) => pattern.test(stderr))) {
    return 'rejected';
  }
  if (exitCode === 2 && UNDERSTOOD_REFUSALS.some((pattern) => pattern.test(stderr))) {
    return 'accepted';
  }
  if ((exitCode === 0 || exitCode === 1) && !STACK_TRACE.test(stderr)) return 'accepted';
  return 'unclassified';
}

interface Verdict {
  readonly exitCode: number;
  readonly stderr: string;
  readonly classification: Classification;
  readonly leftEntries: readonly string[];
}

const scratch = mkdtempSync(path.join(tmpdir(), 'forge-command-steps-'));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** Runs the real CLI on one invocation in a fresh throwaway project and classifies the result. */
async function ask(command: string): Promise<Verdict> {
  const dir = mkdtempSync(path.join(scratch, 'case-'));
  mkdirSync(path.join(dir, '.forge'));
  writeFileSync(path.join(dir, '.forge', 'config.yaml'), YAML.stringify(DEFAULT_CONFIG), 'utf8');
  const args = command.split(' ').slice(1);
  const child = await execa(
    process.execPath,
    ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', BIN, ...args],
    { cwd: dir, reject: false, timeout: 60_000, env: { NO_COLOR: '1' } },
  );
  const exitCode = child.exitCode ?? -1;
  return {
    exitCode,
    stderr: child.stderr,
    classification: classify(exitCode, child.stderr),
    leftEntries: readdirSync(dir).filter((entry) => entry !== '.forge'),
  };
}

const verdicts = new Map<string, Verdict>();
for (const command of distinct) verdicts.set(command, await ask(command));

describe('shipped workflow command steps name commands the CLI accepts (P22 / Q213)', () => {
  it('finds every command step: the count equals an independent count of `kind: command` in the files', () => {
    let expected = 0;
    const count = (source: string): void => {
      expected += (source.match(/^\s*(?:-\s+)?kind:\s*command\b/gm) ?? []).length;
    };
    for (const relative of Object.values(WORKFLOW_INDEX)) {
      count(readFileSync(path.join(templatesRoot, relative), 'utf8'));
    }
    for (const moduleName of readdirSync(modulesDir)) {
      const dir = path.join(modulesDir, moduleName, 'workflows');
      try {
        for (const file of readdirSync(dir).filter((f) => f.endsWith('.workflow.yaml'))) {
          count(readFileSync(path.join(dir, file), 'utf8'));
        }
      } catch {
        continue;
      }
    }
    expect(steps.length).toBe(expected);
    expect(steps.length).toBeGreaterThan(0);
    for (const wanted of [
      'forge story verify PLACEHOLDER --json',
      'forge test run --json',
      'forge kb sync',
    ]) {
      expect(distinct, `expected ${wanted} among ${distinct.join(' | ')}`).toContain(wanted);
    }
  });

  it('the steps that run no forge command are exactly the pinned ones', () => {
    const forgeless = steps
      .filter((step) => forgeInvocations(step.run).length === 0)
      .map((step) => step.key)
      .sort();
    expect(forgeless).toEqual([...NON_FORGE_STEPS].sort());
  });

  it('every distinct invocation is classified: a crash, a timeout or a surprise exit code fails loudly', () => {
    const unclassified = distinct
      .filter((command) => verdicts.get(command)?.classification === 'unclassified')
      .map((command) => ({
        command,
        exitCode: verdicts.get(command)?.exitCode,
        stderr: verdicts.get(command)?.stderr.split('\n').slice(0, 2),
      }));
    expect(unclassified).toEqual([]);
  });

  it('every distinct invocation is accepted, except the pinned, disclosed ones', () => {
    const rejected = distinct.filter(
      (command) => verdicts.get(command)?.classification === 'rejected',
    );
    const unpinned = rejected.filter((command) => KNOWN_UNACCEPTED[command] === undefined);
    expect(
      unpinned.map((command) => ({
        command,
        steps: invocations
          .filter(({ tokens }) => compiled(tokens).join(' ') === command)
          .map(({ step }) => step),
        stderr: verdicts.get(command)?.stderr.split('\n')[0],
      })),
      'these workflow command steps run a string the CLI rejects',
    ).toEqual([]);
  });

  it('a pinned command that the CLI now accepts is removed from the pin list', () => {
    const nowAccepted = Object.keys(KNOWN_UNACCEPTED).filter(
      (command) => verdicts.has(command) && verdicts.get(command)?.classification !== 'rejected',
    );
    expect(nowAccepted, 'wired: delete these from KNOWN_UNACCEPTED').toEqual([]);
  });

  it('a pinned command that no shipped workflow runs is removed from the pin list', () => {
    const stale = Object.keys(KNOWN_UNACCEPTED).filter((command) => !distinct.includes(command));
    expect(stale, 'no longer in any workflow: delete these from KNOWN_UNACCEPTED').toEqual([]);
  });

  it('the classifier is not vacuous: typos, unknown flags and a missing argument are rejected; a real command is accepted', async () => {
    for (const bad of [
      'forge nonsense verify',
      'forge kb synk',
      'forge deploy staging --no-such-flag',
      'forge deploy staging --rollback-check',
      'forge deploy --dry-run --rollback-check',
      'forge story verify',
      'forge spec re-derive --json',
    ]) {
      expect((await ask(bad)).classification, bad).toBe('rejected');
    }
    for (const good of [
      'forge kb sync',
      'forge spec matrix --json',
      'forge story verify STORY-1',
      'forge deploy --dry-run --json',
      'forge deploy --rollback-check --json',
    ]) {
      expect((await ask(good)).classification, good).toBe('accepted');
    }
  });

  it('probing stays inside the throwaway project: nothing is written beside .forge except docs', () => {
    for (const [command, verdict] of verdicts) {
      expect(
        verdict.leftEntries.filter((entry) => entry !== 'docs'),
        `${command} wrote outside the project's own directories`,
      ).toEqual([]);
    }
  });
});

describe('command step strings are shaped as the spec says (P22 / Q213)', () => {
  it('no step passes a subcommand-looking word to `forge deploy` (its one positional is the environment)', () => {
    const bad = invocations
      .filter(({ tokens }) => tokens[1] === 'deploy')
      .flatMap(({ step, tokens }) =>
        tokens
          .slice(2)
          .filter((token) => !token.startsWith('--') && !isTemplateToken(token))
          .map((token) => `${step}: forge deploy ${token}`),
      );
    expect(bad).toEqual([]);
  });

  it('every `forge story verify` names its story with a template expression (a defect loop has no story)', () => {
    const verifies = invocations.filter(
      ({ tokens }) => tokens[1] === 'story' && tokens[2] === 'verify',
    );
    expect(verifies.length).toBeGreaterThanOrEqual(1);
    for (const { step, tokens } of verifies) {
      const positionals = tokens.slice(3).filter((token) => !token.startsWith('--'));
      expect(positionals.length, `${step} must name exactly one story`).toBe(1);
      expect(isTemplateToken(positionals[0] ?? ''), `${step} names its story by expression`).toBe(
        true,
      );
    }
  });

  it('the two defect loops verify their fix with the test suite, not a story', () => {
    const byStep = new Map(steps.map((step) => [step.key, step.run]));
    expect(byStep.get('quick-fix:verify')).toBe('forge test run --json');
    expect(byStep.get('debug:prove-fix')).toBe('forge test run --json');
  });
});
