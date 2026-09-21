/**
 * Every `forge doctor`, `forge kb lint` and `forge test` command a shipped gate names must be accepted by the real
 * CLI, or pinned below with the piece that owns it (`PLAN-M13.md` P25, Q219). The sibling of
 * `spec/gate-rule-coverage.test.ts`, which covers the `spec validate` family (P24).
 *
 * `10` §10.3 rule 1: a gate with a failing deterministic check can only be waived, so a check that names a command
 * the CLI rejects forces a waiver on every project. The set of command lines is derived from the real gate YAML, and
 * "accepted" is not read from a hand-kept list: each line is run through the real launcher in a temp project, and a
 * line is REJECTED when the CLI answers with its usage refusal (exit 2, "needs a real"). So the test fails while a
 * rejected line is not pinned, fails when a pinned line starts being accepted (delete the pin in the commit that
 * wires it), and fails when a pin outlives its gate check.
 *
 * Every accepted line must also print a `{v:1}` envelope carrying, as a number, the field its `failOn` reads. Before
 * P35 a gate evaluated an absent field as "not failing", so an envelope without `errors` made a check that could never
 * fail (`forge kb lint --json` printed `{v, findings}` for G-Design's `errors > 0` until P25); it now fails the check
 * (`gate-fail-closed.test.ts`), and this test keeps the commands from depending on that.
 *
 * Scope, exactly: the `doctor`, `kb lint` and `test` families. `diagram`, `deploy` and `spec interfaces` (P26) are
 * not derived here; `spec validate` is covered by its own sibling test.
 *
 * @see specs/10 §10.3
 * @see PLAN-M13.md P25, P26
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { evaluateGate, type CheckRunner } from '@forge/engine/gates';
import { DEFAULT_CONFIG } from '@forge/schemas/config';
import { afterEach, describe, expect, it } from 'vitest';
import * as YAML from 'yaml';

const run = promisify(execFile);
const LAUNCHER = fileURLToPath(new URL('../../bin/forge.mjs', import.meta.url));
const CHECKS_DIR = fileURLToPath(new URL('../../../templates/templates/checks/', import.meta.url));

/** Gate command lines the CLI still rejects, and which piece implements each. When a piece wires one, this test
 * fails until the line is removed here: a pin that outlives its reason is as misleading as a missing command. */
const PINNED_REJECTED: Readonly<Record<string, string>> = {
  'forge doctor --rule test-command --json':
    'PLAN-M13.md P23 (G-Foundation test:command: the rule that shows an unset execution.testCommands)',
};

const FAMILY = /^forge (doctor|kb lint|test)\b/;

interface GateCheck {
  readonly gate: string;
  readonly id: string;
  readonly run: string;
  readonly failOn: string;
}

async function familyChecks(): Promise<readonly GateCheck[]> {
  const files = (await readdir(CHECKS_DIR)).filter((name) => name.endsWith('.gate.yaml')).sort();
  const checks: GateCheck[] = [];
  for (const file of files) {
    const gate = YAML.parse(await readFile(path.join(CHECKS_DIR, file), 'utf8')) as {
      readonly id: string;
      readonly checks: {
        readonly deterministic?: readonly { id: string; run: string; failOn: string }[];
      };
    };
    for (const check of gate.checks.deterministic ?? []) {
      if (FAMILY.test(check.run)) {
        checks.push({ gate: gate.id, id: check.id, run: check.run, failOn: check.failOn });
      }
    }
  }
  return checks;
}

/** The one field a `failOn` of the shape `<field> <op> <number>` reads. */
function failOnField(failOn: string): string {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*(?:>=|<=|>|<|==)\s*-?\d+(?:\.\d+)?$/.exec(
    failOn.trim(),
  );
  if (match?.[1] === undefined)
    throw new Error(`failOn ${JSON.stringify(failOn)} is not of the shape this test reads`);
  return match[1];
}

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function forge(args: readonly string[], cwd: string) {
  try {
    const { stdout, stderr } = await run(process.execPath, [LAUNCHER, ...args], {
      cwd,
      timeout: 90_000,
    });
    return { status: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { status: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

async function inBatches<T, R>(items: readonly T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let at = 0; at < items.length; at += 4) {
    out.push(...(await Promise.all(items.slice(at, at + 4).map(work))));
  }
  return out;
}

/** A real project: git repo with one commit, a valid config, a KB directory. Nothing else, so every rule that
 * needs project content has nothing to find. */
async function emptyProject(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-gate-family-'));
  dirs.push(dir);
  const git = (args: string[]) => run('git', args, { cwd: dir });
  await git(['init', '--quiet', '-b', 'main']);
  await git(['config', 'user.email', 'fixture@example.com']);
  await git(['config', 'user.name', 'Fixture']);
  await mkdir(path.join(dir, '.forge'), { recursive: true });
  await writeFile(path.join(dir, '.forge/config.yaml'), YAML.stringify(DEFAULT_CONFIG));
  await mkdir(path.join(dir, DEFAULT_CONFIG.paths.kb), { recursive: true });
  await git(['add', '-A']);
  await git(['commit', '--quiet', '-m', 'init']);
  return dir;
}

describe('gate command lines in the doctor, kb lint and test families', () => {
  it('finds the command lines the shipped gates use (the derivation is not vacuous)', async () => {
    const runs = (await familyChecks()).map((check) => check.run);
    for (const known of [
      'forge doctor --rule clean-build --json',
      'forge doctor --rule skeleton-deployed --json',
      'forge doctor --rule secrets-resolved --json',
      'forge kb lint --json',
      'forge kb lint --rule adr-coverage --json',
      'forge kb lint --rule kb-synced --json',
      'forge test run --rule smoke --json',
      'forge test run --rule contract --json',
      'forge test flaky --json',
    ]) {
      expect(runs).toContain(known);
    }
  });

  it('every run string has the shape this test understands: `forge <family> ... --json`, no shell operators', async () => {
    const odd = (await familyChecks())
      .filter((check) => !/^forge [a-z ]+(?: --[a-z-]+(?: [a-z-]+)?)* --json$/.test(check.run))
      .map((check) => `${check.gate} ${check.id}: ${check.run}`);
    expect(odd).toEqual([]);
  });

  it('every failOn reads one numeric field the test can look for', async () => {
    for (const check of await familyChecks()) {
      expect(() => failOnField(check.failOn), `${check.gate} ${check.id}`).not.toThrow();
    }
  });

  it('the CLI rejects exactly the pinned lines, and every other line prints a v1 envelope with its failOn field', async () => {
    const dir = await emptyProject();
    const distinct = [...new Set((await familyChecks()).map((check) => check.run))].sort();
    const outcomes = await inBatches(distinct, async (line) => ({
      line,
      ...(await forge(['-C', dir, ...line.split(' ').slice(1)], dir)),
    }));

    const rejected = outcomes
      .filter((outcome) => outcome.status === 2 && outcome.stderr.includes('needs a real'))
      .map((outcome) => outcome.line);
    expect(rejected.sort()).toEqual(Object.keys(PINNED_REJECTED).sort());

    for (const outcome of outcomes.filter((candidate) => !rejected.includes(candidate.line))) {
      expect([0, 1], `${outcome.line}: ${outcome.stderr}`).toContain(outcome.status);
      const envelope = JSON.parse(outcome.stdout) as Record<string, unknown>;
      expect(envelope['v'], outcome.line).toBe(1);
      for (const check of (await familyChecks()).filter(
        (candidate) => candidate.run === outcome.line,
      )) {
        const field = failOnField(check.failOn);
        expect(
          typeof envelope[field],
          `${outcome.line} must carry a numeric "${field}" for ${check.gate} ${check.id}`,
        ).toBe('number');
      }
    }
  }, 300_000);

  it('every pinned line is still used by a gate check', async () => {
    const used = new Set((await familyChecks()).map((check) => check.run));
    for (const line of Object.keys(PINNED_REJECTED)) {
      expect(used.has(line), `${line} is no longer used by any gate: drop the pin`).toBe(true);
    }
  });

  it('on an empty project the new checks fail (or pass) as their gate condition says, with matching exit codes', async () => {
    const dir = await emptyProject();
    const expected: Readonly<Record<string, number>> = {
      'doctor --rule clean-build --json': 1,
      'doctor --rule reproducible-install --json': 1,
      'doctor --rule ci-skeleton --json': 1,
      'doctor --rule secrets-resolved --json': 0,
      'doctor --rule skeleton-deployed --json': 1,
      'kb lint --rule adr-coverage --json': 1,
      'kb lint --rule kb-synced --json': 1,
      'test run --rule smoke --json': 1,
      'test run --rule contract --json': 1,
    };
    const outcomes = await inBatches(Object.keys(expected), async (line) => ({
      line,
      ...(await forge(['-C', dir, ...line.split(' ')], dir)),
    }));
    for (const outcome of outcomes) {
      expect(outcome.status, `${outcome.line}: ${outcome.stderr}`).toBe(expected[outcome.line]);
      const envelope = JSON.parse(outcome.stdout) as { errors?: number; failed?: number };
      const count = outcome.line.startsWith('test') ? envelope.failed : envelope.errors;
      expect((count ?? 0) > 0, outcome.line).toBe(expected[outcome.line] === 1);
    }
  }, 300_000);

  it('bare `kb lint --json` counts its error findings in `errors`, so the G-Design kb:lint check can fail', async () => {
    const dir = await emptyProject();
    const clean = await forge(['-C', dir, 'kb', 'lint', '--json'], dir);
    expect(clean.status).toBe(0);
    expect(JSON.parse(clean.stdout)).toMatchObject({ v: 1, errors: 0, findings: [] });
    await mkdir(path.join(dir, DEFAULT_CONFIG.paths.kb, 'decisions'), { recursive: true });
    await writeFile(
      path.join(dir, DEFAULT_CONFIG.paths.kb, 'decisions', 'ADR-9999-broken.md'),
      '---\ntype: ADR\n---\nnot a valid ADR\n',
    );
    const broken = await forge(['-C', dir, 'kb', 'lint', '--json'], dir);
    const envelope = JSON.parse(broken.stdout) as { errors: number; findings: unknown[] };
    expect(broken.status).toBe(1);
    expect(envelope.errors).toBeGreaterThan(0);
    expect(envelope.errors).toBe(envelope.findings.length);
  }, 120_000);

  it('a refusal before any rule runs is a FAILING verdict for every gate line: an envelope without its failOn field reads as "not failing"', async () => {
    const dir = await emptyProject();
    // An invalid config: the natural way to write "unset" (an empty string) is rejected by the schema.
    await writeFile(
      path.join(dir, '.forge/config.yaml'),
      YAML.stringify({
        ...DEFAULT_CONFIG,
        execution: { ...DEFAULT_CONFIG.execution, testCommands: { smoke: '' } },
      }),
    );
    const lines = [
      ...new Set(
        (await familyChecks())
          .map((check) => check.run)
          .filter(
            (line) =>
              line.startsWith('forge doctor --rule') ||
              line.startsWith('forge kb lint') ||
              /forge test run --rule (smoke|contract)/.test(line),
          ),
      ),
    ]
      .filter((line) => !(line in PINNED_REJECTED))
      .sort();
    const outcomes = await inBatches(lines, async (line) => ({
      line,
      ...(await forge(['-C', dir, ...line.split(' ').slice(1)], dir)),
    }));
    for (const outcome of outcomes) {
      const envelope = JSON.parse(outcome.stdout) as Record<string, unknown>;
      for (const check of (await familyChecks()).filter(
        (candidate) => candidate.run === outcome.line,
      )) {
        const field = failOnField(check.failOn);
        expect(
          envelope[field],
          `${outcome.line} with an unreadable config, ${field}`,
        ).toBeGreaterThan(0);
      }
      expect(outcome.status, outcome.line).toBe(1);
    }
  }, 300_000);

  it('the same holds through the real gate evaluator', async () => {
    const dir = await emptyProject();
    await writeFile(path.join(dir, '.forge/config.yaml'), 'not: [valid');
    const runner: CheckRunner = async (check, cwd) => {
      const outcome = await forge(['-C', cwd, ...check.run.split(' ').slice(1)], cwd);
      return { stdout: outcome.stdout, exitCode: outcome.status };
    };
    const checks = (await familyChecks())
      .filter((check) => !(check.run in PINNED_REJECTED))
      .filter((check) => /^forge (doctor|kb lint)|--rule (smoke|contract)/.test(check.run))
      .map((check) => ({ id: `${check.gate}:${check.id}`, run: check.run, failOn: check.failOn }));
    const result = await evaluateGate(
      {
        id: 'G-Refused',
        checks: { deterministic: checks, advisory: [] },
        openQuestionsPolicy: 'block',
      },
      dir,
      runner,
    );
    expect(result.checks.filter((check) => check.passed).map((check) => check.checkId)).toEqual([]);
  }, 300_000);

  it('`test run --rule smoke` takes exactly `--rule <name>`: an unknown flag or a repeated --rule is refused', async () => {
    const dir = await emptyProject();
    for (const extra of [['--garbage'], ['--rule', 'contract'], ['--rule=contract']]) {
      const outcome = await forge(
        ['-C', dir, 'test', 'run', '--rule', 'smoke', ...extra, '--json'],
        dir,
      );
      expect(outcome.status, extra.join(' ')).toBe(2);
    }
    expect((await forge(['-C', dir, 'test', 'run', '--rule=smoke', '--json'], dir)).status).toBe(2);
    for (const args of [
      ['doctor', '--rule', 'ci-skeleton', '--rule', 'clean-build'],
      ['kb', 'lint', '--rule', 'kb-synced', '--rule', 'adr-coverage'],
    ]) {
      expect((await forge(['-C', dir, ...args], dir)).status, args.join(' ')).toBe(2);
    }
  }, 120_000);

  it('the unset test command is an envelope with the typed code and a remedy, not an empty stdout', async () => {
    const dir = await emptyProject();
    const outcome = await forge(['-C', dir, 'test', 'run', '--rule', 'smoke', '--json'], dir);
    const envelope = JSON.parse(outcome.stdout) as Record<string, unknown>;
    expect(outcome.status).toBe(1);
    expect(envelope).toMatchObject({ v: 1, rule: 'smoke', failed: 1, code: 'ENV-006' });
    expect(String(envelope['problems'])).toContain('execution.testCommands.smoke');
    expect(String(envelope['remedy'])).toMatch(/^Set /);
  });

  it('an unknown rule name is a usage error (exit 2), for each family', async () => {
    const dir = await emptyProject();
    for (const args of [
      ['doctor', '--rule', 'no-such-rule', '--json'],
      ['kb', 'lint', '--rule', 'no-such-rule', '--json'],
      ['test', 'run', '--rule', 'no-such-rule', '--json'],
      ['doctor', '--rule'],
      ['kb', 'lint', '--rule'],
    ]) {
      const outcome = await forge(['-C', dir, ...args], dir);
      expect(outcome.status, args.join(' ')).toBe(2);
    }
  }, 120_000);

  it('doctor --rule refuses --fix and --rebuild-index, which would mutate a read-only check', async () => {
    const dir = await emptyProject();
    for (const extra of ['--fix', '--rebuild-index']) {
      const outcome = await forge(['-C', dir, 'doctor', '--rule', 'ci-skeleton', extra], dir);
      expect(outcome.status, extra).toBe(2);
    }
  }, 120_000);
});
