/**
 * Every deterministic check a shipped gate or module carries, run through the REAL CLI in a fresh `forge init`
 * project and the REAL `evaluateGate`, must give a real verdict or fail closed (`PLAN-M13.md` P35, Q223).
 *
 * `evaluateGate` used to read a missing `failOn` field as "not failing", so any refusal, flag-parse error or
 * renamed field on any check passed the gate (`10` §10.3 rule 1: a failing deterministic check can only be
 * waived). It now fails closed. That is only safe if no shipped check depends on the old behaviour: a check whose
 * OWN output lacks the field its `failOn` reads would fail on every project and force a waiver. This test derives
 * every gate check from the shipped `templates/checks/*.gate.yaml` through the REAL `loadGateRegistry`
 * (`PLAN-M14.md` P20's own loader — exercising the identical parse/attach path a real project's `.forge/checks/`
 * goes through, not a second, hand-rolled YAML reader that could silently drift from it) plus each module's own
 * `checks/*.check.yaml` (still hand-derived: the shipped module files carry no `appliesTo`/`severity` of their own
 * yet — P22 — so they are not real attachable checks for the loader to find), runs each, and requires:
 *  - the commands the CLI still rejects are exactly the pinned set, and each of them evaluates to FAIL;
 *  - every other command exits 0 or 1, prints a JSON object, carries every path its `failOn` reads, and the
 *    evaluator gives it a REAL verdict (no fail-closed reason), with exit 0 exactly when it passes;
 *  - a refusal (invalid config) and a flag-parse refusal (an unknown flag appended) fail EVERY `forge` check.
 *
 * @see specs/10 §10.3
 * @see PLAN-M13.md P35
 */
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { ProjectPaths } from '@forge/core/fs';
import { runShellCommand } from '@forge/engine/dispatch';
import { evaluateGate, type CheckRunner, type DeterministicCheckResult } from '@forge/engine/gates';
import { DEFAULT_CONFIG } from '@forge/schemas/config';
import { execa } from 'execa';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as YAML from 'yaml';

import { loadGateRegistry } from '../../src/commands/run/gates.ts';

const run = promisify(execFile);
const LAUNCHER = fileURLToPath(new URL('../../bin/forge.mjs', import.meta.url));
const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const CHECKS_DIR = path.join(REPO, 'packages/templates/templates/checks');
const MODULES_DIR = path.join(REPO, 'modules');
const ENV_OVERLAY = { ANTHROPIC_API_KEY: 'sk-ant-test-fixture-not-real' };
const ENV = { ...process.env, ...ENV_OVERLAY };

/** Command lines the CLI still rejects, and which piece implements each. When a piece wires one, this test fails
 * until the pin is removed: a pin that outlives its reason is as misleading as a missing command. */
const PINNED_REJECTED: Readonly<Record<string, string>> = {};

interface ShippedCheck {
  readonly source: string;
  readonly id: string;
  readonly run: string;
  readonly parser?: string;
  readonly failOn: string;
}

/** `loadGateRegistry` is memoised (real, one-time cost per process — the shipped gate files themselves
 * never change mid-run), rooted directly at `packages/templates/templates/checks/` so `checksRoot` is
 * `.` and the real loader reads exactly this test's own `CHECKS_DIR`, nothing else: that directory has
 * no `.forge/overrides/checks/` or `.forge/manifest.yaml` of its own, so this exercises the plain
 * `*.gate.yaml`-only path (the module checks below carry no `appliesTo` yet, P22, so they cannot attach
 * for real regardless of root). */
let templatesRegistry: ReturnType<typeof loadGateRegistry> | undefined;
function shippedGateRegistry(): ReturnType<typeof loadGateRegistry> {
  templatesRegistry ??= loadGateRegistry(new ProjectPaths(CHECKS_DIR), '.');
  return templatesRegistry;
}

async function shippedChecks(): Promise<readonly ShippedCheck[]> {
  const checks: ShippedCheck[] = [];
  for (const gate of (await shippedGateRegistry()).values()) {
    for (const check of gate.checks.deterministic) {
      checks.push({
        source: gate.id,
        id: check.id,
        run: check.run,
        ...(check.parser === undefined ? {} : { parser: check.parser }),
        failOn: check.failOn,
      });
    }
  }
  for (const module of (await readdir(MODULES_DIR)).sort()) {
    const dir = path.join(MODULES_DIR, module, 'checks');
    let files: string[];
    try {
      files = (await readdir(dir)).filter((name) => name.endsWith('.check.yaml')).sort();
    } catch {
      continue;
    }
    for (const file of files) {
      const check = YAML.parse(await readFile(path.join(dir, file), 'utf8')) as Omit<
        ShippedCheck,
        'source'
      >;
      checks.push({ source: module, ...check });
    }
  }
  return checks;
}

const isForgeLine = (line: string): boolean => line.startsWith('forge ');

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function inBatches<T, R>(items: readonly T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let at = 0; at < items.length; at += 4) {
    out.push(...(await Promise.all(items.slice(at, at + 4).map(work))));
  }
  return out;
}

/** A directory holding a `forge` executable that runs THIS checkout's launcher, put first on `PATH`: a gate's own
 * runner (`runShellCommand`, `shell: true`, cwd = the project) then resolves `forge` the way it does for a user, with
 * no `-C` and no hand-splitting of the command line. */
let shimDir = '';
beforeAll(async () => {
  shimDir = await mkdtemp(path.join(tmpdir(), 'forge-gate-shim-'));
  const file = path.join(shimDir, 'forge');
  await writeFile(file, `#!/bin/sh\nexec "${process.execPath}" "${LAUNCHER}" "$@"\n`);
  await chmod(file, 0o755);
});
afterAll(async () => {
  await rm(shimDir, { recursive: true, force: true });
});

/** The runner every real gate uses (`createGateEvaluator`: `runShellCommand(check.run, cwd, env)`). */
const runner: CheckRunner = async (check, cwd) => {
  const result = await runShellCommand(check.run, cwd, {
    ...ENV_OVERLAY,
    PATH: `${shimDir}${path.delimiter}${process.env['PATH'] ?? ''}`,
  });
  return { stdout: result.stdout, exitCode: result.exitCode };
};

async function evaluateOne(
  check: ShippedCheck,
  cwd: string,
  withRunner: CheckRunner = runner,
): Promise<DeterministicCheckResult> {
  const result = await evaluateGate(
    {
      id: check.source,
      checks: {
        deterministic: [
          {
            id: check.id,
            run: check.run,
            failOn: check.failOn,
            ...(check.parser === undefined ? {} : { parser: check.parser }),
          },
        ],
        advisory: [],
      },
      openQuestionsPolicy: 'block',
    },
    cwd,
    withRunner,
  );
  const first = result.checks[0];
  if (first === undefined) throw new Error('no result');
  return first;
}

/** A project as `forge init` leaves it, committed clean. Without a usable platform CLI on this machine `init`
 * is refused, and a hand-built project (git, a valid config, a KB directory) stands in: the checks read project
 * state only, so either is a real project to them. */
async function freshProject(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-gate-closed-'));
  dirs.push(dir);
  const init = await execa(
    process.execPath,
    [LAUNCHER, 'init', '-C', dir, '--name', 'Fresh', '--yes', '--json'],
    { reject: false, env: ENV, timeout: 120_000 },
  );
  const git = (args: string[]) => run('git', args, { cwd: dir });
  if (init.exitCode !== 0) {
    await git(['init', '--quiet', '-b', 'main']);
    await mkdir(path.join(dir, '.forge'), { recursive: true });
    await writeFile(path.join(dir, '.forge/config.yaml'), YAML.stringify(DEFAULT_CONFIG));
    await mkdir(path.join(dir, DEFAULT_CONFIG.paths.kb), { recursive: true });
  }
  await git(['config', 'user.email', 'fixture@example.com']);
  await git(['config', 'user.name', 'Fixture']);
  await git(['add', '-A']);
  await git(['commit', '--quiet', '--allow-empty', '-m', 'init']);
  return dir;
}

/** The paths a `failOn` reads, from the parsed expression (never the source text). */
async function failOnPaths(failOn: string): Promise<readonly string[]> {
  const { parseExpression } = await import('@forge/engine/expr');
  const parsed = parseExpression(failOn);
  if (!parsed.success) throw new Error(`failOn ${failOn} does not parse`);
  const out: string[] = [];
  const walk = (expr: unknown): void => {
    if (typeof expr !== 'object' || expr === null) return;
    const node = expr as { kind?: string; segments?: string[] } & Record<string, unknown>;
    if (node.kind === 'path' && node.segments !== undefined) out.push(node.segments.join('.'));
    for (const value of Object.values(node)) if (typeof value === 'object') walk(value);
  };
  walk(parsed.expr);
  return out;
}

describe('every shipped check fails closed or gives a real verdict', () => {
  it('derives a non-vacuous set: gate checks and module checks, forge lines and shell lines', async () => {
    const checks = await shippedChecks();
    const lines = new Set(checks.map((check) => check.run));
    expect(lines.has('forge spec validate --json')).toBe(true);
    expect(lines.has('forge kb lint --json')).toBe(true);
    expect(lines.has('forge test coverage --rule ratchet --json')).toBe(true);
    expect(checks.some((check) => !isForgeLine(check.run))).toBe(true);
    expect(checks.map((check) => check.source)).toEqual(
      expect.arrayContaining(['G-Design', 'G-Verify', 'fm-web', 'fm-service', 'fm-data']),
    );
  });

  it('every pin is still used by some shipped check', async () => {
    const lines = new Set((await shippedChecks()).map((check) => check.run));
    for (const pinned of Object.keys(PINNED_REJECTED)) {
      expect(lines.has(pinned), `${pinned} is no longer used: drop the pin`).toBe(true);
    }
  });

  it('the CLI rejects exactly the pinned lines (each fails closed); every other check has a real verdict', async () => {
    const dir = await freshProject();
    const checks = await shippedChecks();
    const outcomes = await inBatches(checks, async (check) => ({
      check,
      result: await evaluateOne(check, dir),
    }));

    const rejected = outcomes
      .filter((o) => isForgeLine(o.check.run) && o.result.exitCode >= 2)
      .map((o) => o.check.run);
    expect([...new Set(rejected)].sort()).toEqual(Object.keys(PINNED_REJECTED).sort());

    for (const { check, result } of outcomes) {
      const label = `${check.source} ${check.id}: ${check.run}`;
      if (check.run in PINNED_REJECTED) {
        expect(result.passed, `${label} is rejected and must fail`).toBe(false);
        continue;
      }
      // `forge` exits 0 (clean) or 1 (findings); the shell checks print a count and exit 0.
      expect(
        isForgeLine(check.run) ? [0, 1] : [0],
        `${label} exited ${String(result.exitCode)}`,
      ).toContain(result.exitCode);
      const envelope = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(typeof envelope, label).toBe('object');
      expect(envelope['ok'], `${label} must not print a refusal`).not.toBe(false);
      for (const field of await failOnPaths(check.failOn)) {
        expect(
          field
            .split('.')
            .reduce<unknown>(
              (value, key) =>
                typeof value === 'object' && value !== null
                  ? (value as Record<string, unknown>)[key]
                  : undefined,
              envelope,
            ),
          `${label} must print "${field}" (its failOn reads it)`,
        ).toBeDefined();
      }
      // A REAL verdict: a pass or a failOn that fired, never a fail-closed reason caused by the command's own output.
      expect(result.reason, label).toBeUndefined();
    }
  }, 480_000);

  it('one command serving two gates: with 2 quarantined tests `test flaky --json` exits 1, G-Stable fails and the G-Verify cap (5) still passes', async () => {
    const dir = await freshProject();
    const failing = ['fail', ...Array.from({ length: 19 }, () => 'pass')];
    await mkdir(path.join(dir, 'docs/forge/reports'), { recursive: true });
    await writeFile(
      path.join(dir, 'docs/forge/reports/flaky.json'),
      JSON.stringify({
        v: 1,
        tests: {
          'a.test.ts::one': { outcomes: failing, quarantined: true },
          'a.test.ts::two': { outcomes: failing, quarantined: true },
        },
      }),
    );
    const flaky = (await shippedChecks()).filter(
      (check) => check.run === 'forge test flaky --json',
    );
    expect(flaky.map((check) => check.source).sort()).toEqual(['G-Stable', 'G-Verify']);
    for (const check of flaky) {
      const result = await evaluateOne(check, dir);
      expect(result.exitCode, check.id).toBe(1);
      expect(result.reason, check.id).toBeUndefined();
      expect(result.passed, `${check.source} ${check.id}`).toBe(check.source === 'G-Verify');
    }
  }, 120_000);

  it('`spec validate --json` counts what is wrong in `errors`, so G-Design spec:validate fails on a broken document (an exit-1 body with `v:1` is trusted, so the count is what stops it)', async () => {
    const dir = await freshProject();
    await mkdir(path.join(dir, 'docs/forge/specs/capabilities'), { recursive: true });
    await writeFile(
      path.join(dir, 'docs/forge/specs/capabilities/CAP-001.md'),
      '---\ntype: Capability\nid: CAP-001\n---\nbroken\n',
    );
    const check = (await shippedChecks()).find((c) => c.run === 'forge spec validate --json');
    if (check === undefined) throw new Error('G-Design spec:validate is not shipped');
    const result = await evaluateOne(check, dir);
    const body = JSON.parse(result.stdout) as {
      errors: number;
      documents: { valid: boolean; errors: string[] }[];
      missingRequiredEdges: unknown[];
      cycles: unknown[];
    };
    const expected =
      body.documents.reduce((sum, doc) => sum + (doc.valid ? 0 : doc.errors.length), 0) +
      body.missingRequiredEdges.length +
      body.cycles.length;
    expect(body.documents.some((doc) => !doc.valid)).toBe(true);
    expect(body.errors).toBe(expected);
    expect(body.errors).toBeGreaterThan(0);
    expect(result.exitCode).toBe(1);
    expect(result.passed).toBe(false);
    expect(result.reason).toBeUndefined();
  }, 120_000);

  /** Lines that give a real verdict even under the perturbation, because they do not read what was perturbed:
   * `spec validate` and `test coverage --rule acceptance-criteria` read spec documents, not
   * `.forge/config.yaml`;
   * these commands (and `test flaky`, `test run --rule oracle-lint`) also ignore a flag they do not know rather
   * than refusing it. They pass only by printing a real, non-refusal `{v:1}` verdict; everything else must fail. */
  const IGNORES_CONFIG = (line: string): boolean =>
    line.startsWith('forge spec validate') ||
    line === 'forge test coverage --rule acceptance-criteria --json';
  const IGNORES_UNKNOWN_FLAG = (line: string): boolean =>
    IGNORES_CONFIG(line) ||
    line === 'forge test flaky --json' ||
    line === 'forge test run --rule oracle-lint --json';

  interface Perturbed {
    readonly passed: readonly { readonly line: string; readonly stdout: string }[];
    /** Reasons of the checks that failed for a reason other than their own `failOn` firing. */
    readonly reasons: readonly string[];
  }

  async function runPerturbed(
    project: string,
    perturb: (check: ShippedCheck) => ShippedCheck,
    sentinel: string,
  ): Promise<Perturbed> {
    const checks = (await shippedChecks()).filter((check) => isForgeLine(check.run));
    const results = await inBatches(checks, async (check) => ({
      check,
      result: await evaluateOne(perturb(check), project),
    }));
    // Not vacuous: a `forge` that was not found (127) would fail every check for the wrong reason...
    expect(results.filter((r) => r.result.exitCode === 127).map((r) => r.check.run)).toEqual([]);
    const passed = results
      .filter((r) => r.result.passed)
      .map((r) => ({ line: r.check.run, stdout: r.result.stdout }));
    // ...and a broken shim or launcher fails every check with empty output. Commands that do not read what was
    // perturbed must still get through, or the whole run proves nothing.
    expect(
      passed.map((p) => p.line),
      'commands that ignore the perturbation must still pass',
    ).toContain(sentinel);
    return {
      passed,
      reasons: results.flatMap((r) => (r.result.reason === undefined ? [] : [r.result.reason])),
    };
  }

  function expectNoVerdictOnRefusal(
    perturbed: Perturbed,
    allowed: (line: string) => boolean,
  ): void {
    expect(perturbed.passed.filter((p) => !allowed(p.line)).map((p) => p.line)).toEqual([]);
    for (const { line, stdout } of perturbed.passed) {
      const envelope = JSON.parse(stdout) as Record<string, unknown>;
      expect(envelope['v'], line).toBe(1);
      expect(envelope['ok'], line).not.toBe(false);
    }
    // The new evaluator logic, not the command's own `errors`/`failed` count, is what caught at least one
    // refusal: before P35 a `{"v":1,"ok":false,"error":...}` envelope read as "not failing".
    expect(
      perturbed.reasons.filter((reason) => reason.includes('refusal')),
      'some check must have been failed closed on a refusal envelope',
    ).not.toEqual([]);
  }

  it('a refusal (a config the schema rejects) fails every forge check that reads the config, and no check passes on a refusal', async () => {
    const dir = await freshProject();
    // `execution.testCommands.smoke: ''` is `CFG-001` from the schema (the natural way to write "unset").
    await writeFile(
      path.join(dir, '.forge/config.yaml'),
      YAML.stringify({
        ...DEFAULT_CONFIG,
        execution: { ...DEFAULT_CONFIG.execution, testCommands: { smoke: '' } },
      }),
    );
    expectNoVerdictOnRefusal(
      await runPerturbed(dir, (check) => check, 'forge spec validate --json'),
      IGNORES_CONFIG,
    );
  }, 480_000);

  it('a flag-parse refusal (an unknown flag appended) fails every forge check that does not ignore unknown flags', async () => {
    const dir = await freshProject();
    expectNoVerdictOnRefusal(
      await runPerturbed(
        dir,
        (check) => ({ ...check, run: `${check.run} --no-such-flag-p35` }),
        'forge spec validate --rule definition-of-ready --json',
      ),
      IGNORES_UNKNOWN_FLAG,
    );
  }, 480_000);
});
