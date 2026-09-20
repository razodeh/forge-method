/**
 * `G-Foundation`'s `skeleton:deployed` check, through the real gate machinery (`PLAN-M13.md` P25, Q219).
 *
 * The owner decision (P11 question 8): keep `11` F-INIT-7 / `14` §14.9 (G-Foundation verifies a deployed walking
 * skeleton) as a check that a recorded Waiver can cover on a project with no environment yet. That is only true if
 * `10` §10.3 rule 1 really applies to it, so this drives the shipped `G-Foundation.gate.yaml` through
 * `evaluateGate` with the real `forge` CLI as the runner, then `applyWaiver` / `isApproved`.
 *
 * `test:command` is left out of the gate under test: its `doctor --rule test-command` is P23's and the CLI rejects
 * it today (pinned in `gate-family-coverage.test.ts`), so it would fail every project for a reason unrelated to
 * this check.
 *
 * @see specs/10 §10.3
 * @see specs/11 F-INIT-7
 * @see specs/14 §14.9
 * @see PLAN-M13.md P25
 */
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isForgeError } from '@forge/core/errors';
import { runShellCommand } from '@forge/engine/dispatch';
import {
  applyWaiver,
  evaluateGate,
  isApproved,
  type CheckRunner,
  type GateDefinition,
} from '@forge/engine/gates';
import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';
import * as YAML from 'yaml';

import { KB_ROOT, cleanupAll, createTestProject, writeAndCommit } from './helpers.ts';

afterEach(cleanupAll);

const LAUNCHER = fileURLToPath(new URL('../../../bin/forge.mjs', import.meta.url));
const GATE_PATH = fileURLToPath(
  new URL('../../../../templates/templates/checks/G-Foundation.gate.yaml', import.meta.url),
);
const FIXTURE_GATE_PATH = fileURLToPath(
  new URL(
    '../../../../../fixtures/greenfield-service/.forge/checks/G-Foundation.gate.yaml',
    import.meta.url,
  ),
);

interface RawGate {
  readonly id: string;
  readonly checks: {
    readonly deterministic: GateDefinition['checks']['deterministic'];
    readonly advisory?: GateDefinition['checks']['advisory'];
  };
}

async function loadGate(path_: string, without: readonly string[] = []): Promise<GateDefinition> {
  const raw = YAML.parse(await readFile(path_, 'utf8')) as RawGate;
  return {
    id: raw.id,
    checks: {
      deterministic: raw.checks.deterministic.filter((check) => !without.includes(check.id)),
      advisory: raw.checks.advisory ?? [],
    },
    openQuestionsPolicy: 'block',
  };
}

const extraDirs: string[] = [];
afterEach(async () => {
  await Promise.all(extraDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function runnerWithForgeOnPath(): Promise<CheckRunner> {
  const binDir = await mkdtemp(path.join(tmpdir(), 'forge-skeleton-gate-bin-'));
  extraDirs.push(binDir);
  const wrapper = path.join(binDir, 'forge');
  await writeFile(
    wrapper,
    `#!/usr/bin/env sh\nexec "${process.execPath}" "${LAUNCHER}" "$@"\n`,
    'utf8',
  );
  await chmod(wrapper, 0o755);
  const env = { PATH: `${binDir}:${process.env['PATH'] ?? ''}` };
  return async (check, cwd) => {
    const result = await runShellCommand(`${check.run} -C ${cwd}`, cwd, env);
    return { stdout: result.stdout, exitCode: result.exitCode };
  };
}

const ENVIRONMENTS = `---
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
  - id: ENV-001
    purpose: Local development
    url: http://localhost:3000
    deploy_trigger: manual
    data_policy: synthetic
    secrets_source: .env
    owner: platform
    access: anyone
  - id: ENV-002
    purpose: Development environment for the walking skeleton
    url: https://dev.example.com
    deploy_trigger: on merge to main
    data_policy: synthetic
    secrets_source: secret manager
    owner: platform
    access: ask platform
---
`;

/** A project satisfying the five environment checks, except that the deployment record is added by the caller. */
async function healthyProject(withRecord: boolean): Promise<string> {
  const { dir } = await createTestProject();
  await writeAndCommit(dir, {
    'package.json': JSON.stringify({ name: 'x', scripts: { build: 'tsc -b' } }),
    'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
    '.nvmrc': '22\n',
    '.github/workflows/ci.yml':
      'on: pull_request\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - run: make verify\n',
    [`${KB_ROOT}/delivery/environments.md`]: ENVIRONMENTS,
  });
  if (withRecord) {
    const sha = (await execa('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim();
    await writeAndCommit(dir, {
      'docs/forge/reports/deployments/ENV-002.json': JSON.stringify({
        v: 1,
        environment: 'ENV-002',
        outcome: 'succeeded',
        sha,
        deployed_at: '2026-01-02T10:00:00Z',
        health: {
          url: 'https://dev.example.com/healthz',
          status: 200,
          checked_at: '2026-01-02T10:01:00Z',
        },
      }),
    });
  }
  return dir;
}

describe('G-Foundation names skeleton:deployed, and the fixture copy matches', () => {
  it('the shipped gate has the check, reading errors, running the doctor rule', async () => {
    const gate = await loadGate(GATE_PATH);
    expect(
      gate.checks.deterministic.find((check) => check.id === 'skeleton:deployed'),
    ).toMatchObject({
      run: 'forge doctor --rule skeleton-deployed --json',
      failOn: 'errors > 0',
    });
  });

  it('the greenfield-service fixture copy of the gate has the same checks', async () => {
    const shipped = await loadGate(GATE_PATH);
    const fixture = await loadGate(FIXTURE_GATE_PATH);
    expect(fixture.checks.deterministic).toEqual(shipped.checks.deterministic);
  });
});

describe('G-Foundation, all implemented checks, through the real CLI', () => {
  it('passes a project with a build, a locked install, a pipeline and a healthy deployed skeleton', async () => {
    const dir = await healthyProject(true);
    const gate = await loadGate(GATE_PATH, ['test:command']);
    const result = await evaluateGate(gate, dir, await runnerWithForgeOnPath());
    expect(result.checks.map((check) => `${check.checkId}:${String(check.passed)}`)).toEqual([
      'repo:clean-build:true',
      'repo:reproducible-install:true',
      'ci:skeleton:true',
      'skeleton:deployed:true',
    ]);
    expect(result.passed).toBe(true);
    expect(isApproved(result)).toBe(true);
  }, 120_000);

  it('fails ONLY skeleton:deployed when the skeleton was never deployed, and the failure says why', async () => {
    const dir = await healthyProject(false);
    const gate = await loadGate(GATE_PATH, ['test:command']);
    const result = await evaluateGate(gate, dir, await runnerWithForgeOnPath());
    expect(result.passed).toBe(false);
    expect(result.checks.filter((check) => !check.passed).map((check) => check.checkId)).toEqual([
      'skeleton:deployed',
    ]);
    const failing = result.checks.find((check) => check.checkId === 'skeleton:deployed');
    expect(failing?.stdout).toContain('no deployment record');
    expect(isApproved(result)).toBe(false);
  }, 120_000);

  it('a recorded Waiver covers the failing skeleton:deployed check, as 10 §10.3 rule 1 says of any failing check', async () => {
    const dir = await healthyProject(false);
    const gate = await loadGate(GATE_PATH, ['test:command']);
    const result = await evaluateGate(gate, dir, await runnerWithForgeOnPath());
    const now = Date.parse('2026-06-01T00:00:00Z');
    const waived = applyWaiver(
      result,
      {
        reason:
          'No development environment exists yet; the first deployment is scheduled with the delivery phase.',
        owner: 'platform',
        expiresAt: '2026-07-01T00:00:00Z',
      },
      now,
    );
    expect(waived.passed).toBe(false);
    expect(isApproved(waived)).toBe(true);
  }, 120_000);

  it('a gate-wide Waiver does not hide the other failures: the waived result still lists every failing check', async () => {
    const dir = await healthyProject(false);
    await writeAndCommit(dir, { '.github/workflows/ci.yml': 'jobs: [broken' });
    const gate = await loadGate(GATE_PATH, ['test:command']);
    const result = await evaluateGate(gate, dir, await runnerWithForgeOnPath());
    const waived = applyWaiver(
      result,
      {
        reason: 'No development environment yet.',
        owner: 'platform',
        expiresAt: '2026-07-01T00:00:00Z',
      },
      Date.parse('2026-06-01T00:00:00Z'),
    );
    expect(isApproved(waived)).toBe(true);
    expect(waived.checks.filter((check) => !check.passed).map((check) => check.checkId)).toEqual([
      'ci:skeleton',
      'skeleton:deployed',
    ]);
    expect(waived.waiver?.reason).toContain('No development environment');
  }, 120_000);

  it('a Waiver still needs a reason and an unexpired date: it is not a way around the rule', async () => {
    const dir = await healthyProject(false);
    const gate = await loadGate(GATE_PATH, ['test:command']);
    const result = await evaluateGate(gate, dir, await runnerWithForgeOnPath());
    const now = Date.parse('2026-06-01T00:00:00Z');
    const blank = (() => {
      try {
        applyWaiver(
          result,
          { reason: ' ', owner: 'platform', expiresAt: '2026-07-01T00:00:00Z' },
          now,
        );
        return undefined;
      } catch (error) {
        return error;
      }
    })();
    expect(isForgeError(blank) && blank.code).toBe('GATE-504');
    const expired = (() => {
      try {
        applyWaiver(
          result,
          { reason: 'x', owner: 'platform', expiresAt: '2026-05-01T00:00:00Z' },
          now,
        );
        return undefined;
      } catch (error) {
        return error;
      }
    })();
    expect(isForgeError(expired) && expired.code).toBe('GATE-505');
  }, 120_000);

  it('the deployment record is required even when the environment entry is: an ENV entry alone does not pass', async () => {
    const dir = await healthyProject(false);
    await mkdir(path.join(dir, 'docs/forge/reports/deployments'), { recursive: true });
    const gate = await loadGate(GATE_PATH, ['test:command']);
    const result = await evaluateGate(gate, dir, await runnerWithForgeOnPath());
    expect(result.passed).toBe(false);
  }, 120_000);
});
