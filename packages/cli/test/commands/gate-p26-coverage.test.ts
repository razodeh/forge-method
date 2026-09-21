/**
 * Every `forge spec interfaces`, `forge diagram` and `forge deploy` command a shipped gate names must be accepted by the
 * real CLI and print every field its `failOn` reads on BOTH the passing and the failing path (`PLAN-M13.md` P26, Q228;
 * P35: a gate check passes only when its output carries those fields). The sibling of `gate-family-coverage.test.ts`
 * (`doctor`, `kb lint`, `test`) and `spec/gate-rule-coverage.test.ts` (`spec validate`).
 *
 * The lines are derived from the shipped gate YAML, run through the real launcher and the real `evaluateGate`.
 *
 * @see specs/10 §10.3
 * @see PLAN-M13.md P26, P35
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
const FAMILY = /^forge (spec interfaces|diagram|deploy)\b/;

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

function failOnField(failOn: string): string {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*(?:>=|<=|>|<|==)\s*-?\d+$/.exec(failOn.trim());
  if (match?.[1] === undefined) throw new Error(`failOn ${failOn} is not of the shape read here`);
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

async function emptyProject(level = 'L3'): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-gate-p26-'));
  dirs.push(dir);
  const git = (args: string[]) => run('git', args, { cwd: dir });
  await git(['init', '--quiet', '-b', 'main']);
  await git(['config', 'user.email', 'fixture@example.com']);
  await git(['config', 'user.name', 'Fixture']);
  await mkdir(path.join(dir, '.forge'), { recursive: true });
  await writeFile(
    path.join(dir, '.forge/config.yaml'),
    YAML.stringify({ ...DEFAULT_CONFIG, project: { ...DEFAULT_CONFIG.project, level } }),
  );
  await mkdir(path.join(dir, DEFAULT_CONFIG.paths.kb), { recursive: true });
  await git(['add', '-A']);
  await git(['commit', '--quiet', '-m', 'init']);
  return dir;
}

describe('gate command lines in the spec interfaces, diagram and deploy families', () => {
  it('finds the lines the shipped gates use (the derivation is not vacuous)', async () => {
    const runs = (await familyChecks()).map((check) => check.run);
    for (const known of [
      'forge spec interfaces --check-frozen --json',
      'forge diagram validate --gate G-Design --json',
      'forge diagram validate --gate G-Deliver --json',
      'forge diagram generate --all --check --json',
      'forge deploy --dry-run --json',
      'forge deploy --rollback-check --json',
    ]) {
      expect(runs).toContain(known);
    }
  });

  it('the real CLI accepts every line and prints a v1 envelope with the numeric field its failOn reads, exit code matching', async () => {
    const dir = await emptyProject();
    const checks = await familyChecks();
    const distinct = [...new Set(checks.map((check) => check.run))].sort();
    const outcomes = await inBatches(distinct, async (line) => ({
      line,
      ...(await forge(['-C', dir, ...line.split(' ').slice(1)], dir)),
    }));
    for (const outcome of outcomes) {
      expect([0, 1], `${outcome.line}: ${outcome.stderr}`).toContain(outcome.status);
      const envelope = JSON.parse(outcome.stdout) as Record<string, unknown>;
      expect(envelope['v'], outcome.line).toBe(1);
      expect(envelope['ok'], outcome.line).not.toBe(false);
      expect(typeof envelope['errors'], outcome.line).toBe('number');
      for (const check of checks.filter((candidate) => candidate.run === outcome.line)) {
        const field = failOnField(check.failOn);
        expect(typeof envelope[field], `${outcome.line} must carry a numeric "${field}"`).toBe(
          'number',
        );
        expect(outcome.status, outcome.line).toBe((envelope[field] as number) > 0 ? 1 : 0);
      }
    }
  }, 300_000);

  it('on an empty L3 project each check gives the verdict its gate condition says', async () => {
    const dir = await emptyProject();
    const expected: Readonly<Record<string, number>> = {
      'spec interfaces --check-frozen --json': 0,
      'diagram validate --gate G-Design --json': 1,
      'diagram validate --gate G-Deliver --json': 1,
      'diagram generate --all --check --json': 0,
      'deploy --dry-run --json': 1,
      'deploy --rollback-check --json': 1,
    };
    const outcomes = await inBatches(Object.keys(expected), async (line) => ({
      line,
      ...(await forge(['-C', dir, ...line.split(' ')], dir)),
    }));
    for (const outcome of outcomes) {
      expect(outcome.status, `${outcome.line}: ${outcome.stderr}`).toBe(expected[outcome.line]);
    }
  }, 300_000);

  it('at L1 the diagram coverage is not required, so an empty project passes both diagram checks', async () => {
    const dir = await emptyProject('L1');
    for (const gate of ['G-Design', 'G-Deliver']) {
      const outcome = await forge(
        ['-C', dir, 'diagram', 'validate', '--gate', gate, '--json'],
        dir,
      );
      expect(outcome.status, gate).toBe(0);
    }
  }, 120_000);

  it('committed dry-run and rollback records pass through the real CLI and evaluator, and a rollback from a commit to itself is refused', async () => {
    const dir = await emptyProject();
    const root = (await run('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim();
    await run('git', ['commit', '--quiet', '--allow-empty', '-m', 'second'], { cwd: dir });
    const head = (await run('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim();
    // after the commit it records and not in the future: the check reads the real clock here
    const at = new Date().toISOString();
    await mkdir(path.join(dir, DEFAULT_CONFIG.paths.kb, 'delivery'), { recursive: true });
    await mkdir(path.join(dir, DEFAULT_CONFIG.paths.reports, 'deployments'), { recursive: true });
    await writeFile(
      path.join(dir, DEFAULT_CONFIG.paths.kb, 'delivery/environments.md'),
      `---
type: Environment
schemaVersion: 1
title: Environments
status: active
created: 2026-01-01
updated: 2026-01-01
revision: 1
author: platform
changelog: []
environments:
  - id: ENV-002
    purpose: 'Staging'
    url: 'https://staging.example.com'
    deploy_trigger: on merge to main
    data_policy: synthetic only
    secrets_source: the secret manager
    owner: platform
    access: ask
---
`,
    );
    await writeFile(
      path.join(dir, DEFAULT_CONFIG.paths.reports, 'deployments/ENV-002.dry-run.json'),
      JSON.stringify({
        v: 1,
        kind: 'dry-run',
        environment: 'ENV-002',
        outcome: 'passed',
        sha: head,
        ran_at: at,
      }),
    );
    await writeFile(
      path.join(dir, DEFAULT_CONFIG.paths.reports, 'deployments/ENV-002.rollback.json'),
      JSON.stringify({
        v: 1,
        kind: 'rollback',
        environment: 'ENV-002',
        outcome: 'succeeded',
        from_sha: head,
        to_sha: root,
        rehearsed_at: at,
        health: {
          url: 'https://staging.example.com/h',
          status: 200,
          checked_at: at,
        },
      }),
    );
    await run('git', ['add', '-A'], { cwd: dir });
    await run('git', ['commit', '--quiet', '-m', 'evidence'], { cwd: dir });
    const passing = await forge(['-C', dir, 'deploy', '--dry-run', '--json'], dir);
    expect(passing.status, passing.stdout).toBe(0);
    expect(JSON.parse(passing.stdout)).toMatchObject({ v: 1, errors: 0, checked: 1 });

    const runner: CheckRunner = async (check, cwd) => {
      const outcome = await forge(['-C', cwd, ...check.run.split(' ').slice(1)], cwd);
      return { stdout: outcome.stdout, exitCode: outcome.status };
    };
    const result = await evaluateGate(
      {
        id: 'G-Deliver',
        checks: {
          deterministic: [
            { id: 'deploy:dry-run', run: 'forge deploy --dry-run --json', failOn: 'errors > 0' },
            {
              id: 'deploy:rollback',
              run: 'forge deploy --rollback-check --json',
              failOn: 'errors > 0',
            },
          ],
          advisory: [],
        },
        openQuestionsPolicy: 'block',
      },
      dir,
      runner,
    );
    expect(result.checks.map((check) => [check.checkId, check.passed])).toEqual([
      ['deploy:dry-run', true],
      ['deploy:rollback', true],
    ]);
    // and a rollback from a commit to itself is a real failing verdict
    await writeFile(
      path.join(dir, DEFAULT_CONFIG.paths.reports, 'deployments/ENV-002.rollback.json'),
      JSON.stringify({
        v: 1,
        kind: 'rollback',
        environment: 'ENV-002',
        outcome: 'succeeded',
        from_sha: head,
        to_sha: head,
        rehearsed_at: at,
        health: { url: 'https://staging.example.com/h', status: 200, checked_at: at },
      }),
    );
    await run('git', ['add', '-A'], { cwd: dir });
    await run('git', ['commit', '--quiet', '-m', 'bad rollback'], { cwd: dir });
    const refused = await forge(['-C', dir, 'deploy', '--rollback-check', '--json'], dir);
    expect(refused.status).toBe(1);
    expect(JSON.parse(refused.stdout)).toMatchObject({ errors: 1 });
  }, 300_000);

  it('an unreadable config is a FAILING verdict for every line that reads it, and an unknown flag is a refusal for every line', async () => {
    const dir = await emptyProject();
    await writeFile(path.join(dir, '.forge/config.yaml'), 'not: [valid');
    for (const line of new Set((await familyChecks()).map((check) => check.run))) {
      const outcome = await forge(['-C', dir, ...line.split(' ').slice(1)], dir);
      expect(outcome.status, line).toBe(1);
      const envelope = JSON.parse(outcome.stdout) as Record<string, unknown>;
      expect(envelope['errors'], line).toBe(1);
      expect(JSON.stringify(envelope['violations']), line).toContain('could not run');
    }
    const good = await emptyProject();
    for (const line of new Set((await familyChecks()).map((check) => check.run))) {
      const outcome = await forge(
        ['-C', good, ...line.split(' ').slice(1), '--no-such-flag-p26'],
        good,
      );
      expect(outcome.status, line).toBe(2);
    }
  }, 300_000);

  it('reads the specs root from the configuration: a story under a relocated paths.specs with an undefined interface fails', async () => {
    const dir = await emptyProject();
    await writeFile(
      path.join(dir, '.forge/config.yaml'),
      YAML.stringify({
        ...DEFAULT_CONFIG,
        paths: { ...DEFAULT_CONFIG.paths, specs: 'my-specs' },
      }),
    );
    await mkdir(path.join(dir, 'my-specs/stories'), { recursive: true });
    await writeFile(
      path.join(dir, 'my-specs/stories/STORY-001.md'),
      `---
id: STORY-001
type: Story
schemaVersion: 1
title: A story
status: draft
created: 2026-01-15
updated: 2026-01-15
revision: 1
author: po
changelog: []
epic: EPIC-001
capability: CAP-001
storyType: feature
size: S
owner_role: backend
depends_on: []
blocked_by: []
interfaces: [INT-099]
data: []
files_expected: []
context_refs: []
acceptance: []
tests: []
dod_profile: backend-default
---
`,
    );
    const outcome = await forge(['-C', dir, 'spec', 'interfaces', '--check-frozen', '--json'], dir);
    expect(outcome.status).toBe(1);
    expect(JSON.parse(outcome.stdout)).toMatchObject({ undefined_refs: 1, references: 1 });
  }, 120_000);

  it('the usage forms: a missing or wrong flag is exit 2, never a verdict', async () => {
    const dir = await emptyProject();
    for (const args of [
      ['spec', 'interfaces'],
      ['diagram', 'validate', '--gate', 'G-Ready'],
      ['diagram', 'validate', '--gate', 'G-Design', 'DIAG-001'],
      ['diagram', 'generate', '--all'],
      ['diagram', 'generate', '--check'],
      ['deploy', '--dry-run', '--rollback-check'],
      ['deploy', 'staging', '--rollback-check'],
    ]) {
      const outcome = await forge(['-C', dir, ...args, '--json'], dir);
      expect(outcome.status, args.join(' ')).toBe(2);
      expect(outcome.stderr, args.join(' ')).toContain('needs a real');
    }
  }, 300_000);
});
