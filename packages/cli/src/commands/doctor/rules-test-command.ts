/**
 * `test-command` (`G-Foundation`, `PLAN-M13.md` P23): the project has a usable, single-command test command for the layers
 * FORGE and its agents run, and the program each names exists.
 *
 * `10` §10.3 lists "no test command" among the ways `G-Foundation` fails, and `14` §14.9 asks for "one-command
 * build/test/run". Nothing set `execution.testCommands` (`scaffold-project` only asks the human to), so `forge test run`,
 * `G-Verify`, `forge story verify` and, since P23, the exec grant of every step that runs tests were silently empty. This
 * rule makes that visible where the project first needs it.
 *
 * What it checks, and what it does not:
 * - `unit` is REQUIRED: a project with no unit command has no test command (F-TEST-1: a layer with no command is "unable to
 *   verify", never passing).
 * - Every configured layer in `AGENT_RUN_LAYERS` (`unit`, `integration`, `lint`, `typecheck`, the ones whose command becomes
 *   an exec pattern) must be one plain command (`checkTestCommand`, the same function that decides the derived grant, so
 *   the rule and the grant cannot disagree) and its program must be found: on `PATH` for a bare name, on disk (relative to
 *   the project or absolute) for a path. The check is a DRY lookup: the suite is never run, nothing is installed, no network.
 * - It does not look inside a script (`pnpm run test:unit` naming a `package.json` script that is missing), and it does not
 *   validate `contract`, `e2e`, `nfr` or `smoke` (they have their own gate checks and may chain commands).
 *
 * Every problem is a violation with a subject (the config key), a message and a remedy: the envelope `runDoctorRuleCommand`
 * prints carries `errors`, the field the gate's `failOn` reads, and a value it cannot read is a violation too, never a pass.
 *
 * @see specs/10 §10.3
 * @see specs/13 §13.1 F-TEST-1
 * @see PLAN-M13.md P23
 * @see SPEC-QUESTIONS.md Q230
 */
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

import { AGENT_RUN_LAYERS, checkTestCommand, commandWords } from '@forge/engine/dispatch';

import type { DoctorRuleContext, DoctorRuleViolation } from './rules.ts';

/** Programs that exit without running anything: as a `unit` command they make the check pass and test nothing. */
const NO_OP_PROGRAMS: ReadonlySet<string> = new Set([
  'true',
  ':',
  'echo',
  'printf',
  'exit',
  'false',
  'sleep',
]);

/** The layer every project needs a command for. */
const REQUIRED_LAYER = 'unit';

function violation(subject: string, message: string, remedy: string): DoctorRuleViolation {
  return { subject, message, remedy };
}

async function isExecutableFile(candidate: string): Promise<boolean> {
  try {
    if (!(await stat(candidate)).isFile()) return false;
    await access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether `program` resolves: a name with a path separator is a file (relative to `projectRoot`, or absolute); a bare name
 * is searched along `env.PATH` (and, on Windows, with each `PATHEXT` extension). Reads `env`, never `process.env`.
 */
export async function programResolves(
  program: string,
  projectRoot: string,
  env: Readonly<Record<string, string>>,
): Promise<boolean> {
  const extensions =
    process.platform === 'win32'
      ? ['', ...(env['PATHEXT'] ?? '.EXE;.CMD;.BAT;.COM').split(';').filter((ext) => ext !== '')]
      : [''];
  if (program.includes('/') || program.includes('\\')) {
    const base = path.resolve(projectRoot, program);
    for (const extension of extensions) {
      if (await isExecutableFile(`${base}${extension}`)) return true;
    }
    return false;
  }
  // Windows spells the variable `Path`; a relative entry is relative to where the command runs (the project).
  const searchPath = env['PATH'] ?? env['Path'] ?? env['path'] ?? '';
  for (const directory of searchPath.split(path.delimiter)) {
    if (directory === '') continue;
    for (const extension of extensions) {
      if (await isExecutableFile(path.resolve(projectRoot, directory, `${program}${extension}`))) {
        return true;
      }
    }
  }
  return false;
}

export async function testCommandViolations(
  ctx: DoctorRuleContext,
): Promise<readonly DoctorRuleViolation[]> {
  const testCommands = ctx.testCommands ?? {};
  const violations: DoctorRuleViolation[] = [];
  for (const layer of AGENT_RUN_LAYERS) {
    const key = `execution.testCommands.${layer}`;
    const configured = testCommands[layer];
    if (configured === undefined) {
      if (layer === REQUIRED_LAYER) {
        violations.push(
          violation(
            key,
            'no test command is configured, so FORGE cannot run the project’s tests and every layer reads as unable to verify.',
            `Run \`forge config set ${key} "<command>"\` with the single command that runs the unit tests and exits non-zero on failure (for example \`pnpm test\`).`,
          ),
        );
      }
      continue;
    }
    const checked = checkTestCommand(configured);
    if (!checked.ok) {
      violations.push(
        violation(key, `${key} is not one plain command: ${checked.detail}.`, checked.remedy),
      );
      continue;
    }
    const program = commandWords(checked.command)?.[0];
    if (layer === REQUIRED_LAYER && program !== undefined && NO_OP_PROGRAMS.has(program)) {
      violations.push(
        violation(
          key,
          `${key} runs ${JSON.stringify(program)}, which runs no tests, so the check would pass on a suite that does not exist.`,
          `Set ${key} to the command that runs the unit tests, with \`forge config set ${key} "<command>"\`.`,
        ),
      );
      continue;
    }
    if (program === undefined || !(await programResolves(program, ctx.projectRoot, ctx.env))) {
      violations.push(
        violation(
          key,
          `${key} runs ${JSON.stringify(program ?? checked.command)}, which was not found${program?.includes('/') === true ? ' at that path' : ' on PATH'}.`,
          `Install ${JSON.stringify(program ?? checked.command)} (or put it on PATH), or set ${key} to the command that does run here with \`forge config set ${key} "<command>"\`.`,
        ),
      );
    }
  }
  return violations;
}
