/**
 * `forge deploy --dry-run` and `forge deploy --rollback-check` (`G-Deliver`, `PLAN-M13.md` P26, Q228).
 *
 * FORGE has no deploy executor: these commands read the dry-run and rollback-rehearsal records a pipeline commits under
 * `docs/forge/reports/deployments/`, for every delivery-target environment the register records. Every fixture is a real
 * git repository with the environment register written as a KB collection file and the records committed.
 *
 * @see specs/10 §10.3
 * @see specs/14 §14.4, §14.9
 * @see PLAN-M13.md P26
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import {
  deployDryRunCheck,
  deployRollbackCheck,
  type DeployEvidenceContext,
} from '../../src/commands/deploy-evidence.ts';
import { KB_ROOT, cleanupAll, createTestProject, writeAndCommit } from './doctor/helpers.ts';

afterEach(cleanupAll);

interface EnvSpec {
  readonly id: string;
  readonly purpose: string;
  readonly url: string;
}

const DEV: EnvSpec = { id: 'ENV-001', purpose: 'Development', url: 'https://dev.example.com' };
const STAGING: EnvSpec = {
  id: 'ENV-002',
  purpose: 'Staging: the pre-production environment',
  url: 'https://staging.example.com',
};
const PROD: EnvSpec = { id: 'ENV-003', purpose: 'Production', url: 'https://app.example.com' };

function register(envs: readonly EnvSpec[]): string {
  const entries = envs
    .map(
      (env) => `  - id: ${env.id}
    purpose: '${env.purpose}'
    url: '${env.url}'
    deploy_trigger: on merge to main
    data_policy: synthetic only
    secrets_source: the secret manager
    owner: platform
    access: ask the platform role`,
    )
    .join('\n');
  return `---
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
${entries}
---
`;
}

const DEPLOYMENTS = 'docs/forge/reports/deployments';

async function git(dir: string, ...args: string[]): Promise<string> {
  return (await execa('git', args, { cwd: dir })).stdout.trim();
}

interface Fixture {
  readonly dir: string;
  readonly ctx: DeployEvidenceContext;
  /** The commit that holds the register (an ancestor of HEAD once records are committed). */
  readonly base: string;
  /** The initial empty commit: older than `base`. */
  readonly root: string;
}

async function project(
  envs: readonly EnvSpec[] | undefined,
  records: (fx: { base: string; root: string }) => Readonly<Record<string, string>> = () => ({}),
): Promise<Fixture> {
  const { dir, paths } = await createTestProject();
  const root = await git(dir, 'rev-parse', 'HEAD');
  await writeAndCommit(
    dir,
    envs === undefined ? {} : { [`${KB_ROOT}/delivery/environments.md`]: register(envs) },
  );
  const base = await git(dir, 'rev-parse', 'HEAD');
  const files = records({ base, root });
  if (Object.keys(files).length > 0) await writeAndCommit(dir, files, 'records');
  return {
    dir,
    base,
    root,
    ctx: {
      paths,
      projectRoot: dir,
      kbRoot: KB_ROOT,
      reportsRoot: 'docs/forge/reports',
      clock: { now: () => '2099-01-01T00:00:00.000Z' },
    },
  };
}

const dryRun = (env: string, overrides: Record<string, unknown>, sha: string): string =>
  JSON.stringify({
    v: 1,
    kind: 'dry-run',
    environment: env,
    outcome: 'passed',
    sha,
    ran_at: '2050-02-01T10:00:00Z',
    ...overrides,
  });

const rollback = (
  env: string,
  overrides: Record<string, unknown>,
  from: string,
  to: string,
  host = 'staging.example.com',
): string =>
  JSON.stringify({
    v: 1,
    kind: 'rollback',
    environment: env,
    outcome: 'succeeded',
    from_sha: from,
    to_sha: to,
    rehearsed_at: '2050-02-01T10:00:00Z',
    health: { url: `https://${host}/healthz`, status: 200, checked_at: '2050-02-01T10:05:00Z' },
    ...overrides,
  });

describe('deploy --dry-run', () => {
  const file = (env: string): string => `${DEPLOYMENTS}/${env}.dry-run.json`;

  it('passes when every delivery-target environment (staging and production) has a passing record', async () => {
    const fx = await project([DEV, STAGING, PROD], ({ base }) => ({
      [file('ENV-002')]: dryRun('ENV-002', {}, base),
      [file('ENV-003')]: dryRun('ENV-003', {}, base),
    }));
    const outcome = await deployDryRunCheck(fx.ctx);
    expect(outcome.violations).toEqual([]);
    expect(outcome.fields).toMatchObject({
      check: 'deploy-dry-run',
      checked: 2,
      environments: ['ENV-002', 'ENV-003'],
    });
  });

  it('a development environment is not a delivery target: it needs no record', async () => {
    const fx = await project([DEV, STAGING], ({ base }) => ({
      [file('ENV-002')]: dryRun('ENV-002', {}, base),
    }));
    expect((await deployDryRunCheck(fx.ctx)).violations).toEqual([]);
  });

  it('fails when the project records no environment, or only development ones', async () => {
    for (const envs of [undefined, [DEV]] as const) {
      const found = (await deployDryRunCheck((await project(envs)).ctx)).violations;
      expect(found).toHaveLength(1);
      expect(found[0]?.message).toContain('No delivery target environment is recorded');
      expect(found[0]?.remedy).toContain('kb/delivery/environments.md');
    }
  });

  it('fails an environment with no record, naming the file to write and the Waiver route', async () => {
    const fx = await project([STAGING, PROD], ({ base }) => ({
      [file('ENV-002')]: dryRun('ENV-002', {}, base),
    }));
    const found = (await deployDryRunCheck(fx.ctx)).violations;
    expect(found).toHaveLength(1);
    expect(found[0]?.subject).toBe('ENV-003');
    expect(found[0]?.message).toContain(file('ENV-003'));
    expect(found[0]?.remedy).toContain('Waiver');
  });

  it('a record that is only in the working tree, not committed, is not evidence', async () => {
    const fx = await project([STAGING]);
    await mkdir(path.join(fx.dir, DEPLOYMENTS), { recursive: true });
    await writeFile(path.join(fx.dir, file('ENV-002')), dryRun('ENV-002', {}, fx.base));
    const found = (await deployDryRunCheck(fx.ctx)).violations;
    expect(found[0]?.message).toContain('or it is not committed');
  });

  it.each<[string, (base: string) => string, string]>([
    ['is not JSON', () => '{nope', 'could not be read as JSON'],
    ['is a JSON array', () => '[1]', 'is not a JSON object'],
    ['has no version', (b) => dryRun('ENV-002', { v: 2 }, b), 'does not declare "v": 1'],
    ['has the wrong kind', (b) => dryRun('ENV-002', { kind: 'rollback' }, b), 'not "dry-run"'],
    [
      'names another environment',
      (b) => dryRun('ENV-002', { environment: 'ENV-009' }, b),
      'not ENV-002',
    ],
    [
      'records a failed outcome',
      (b) => dryRun('ENV-002', { outcome: 'failed' }, b),
      'not "passed"',
    ],
    ['has no sha', (b) => dryRun('ENV-002', { sha: undefined }, b), 'has no "sha"'],
    ['has a sha that is not hex', (b) => dryRun('ENV-002', { sha: 'HEAD' }, b), 'has no "sha"'],
    [
      'names a commit not in the repository',
      (b) => dryRun('ENV-002', { sha: 'a'.repeat(40) }, b),
      'not in this repository',
    ],
    ['has no ran_at', (b) => dryRun('ENV-002', { ran_at: undefined }, b), 'ran_at'],
    [
      'has a ran_at with no zone',
      (b) => dryRun('ENV-002', { ran_at: '2050-02-01T10:00:00' }, b),
      'ran_at',
    ],
  ])('fails a record that %s', async (_label, build, expected) => {
    const fx = await project([STAGING], ({ base }) => ({ [file('ENV-002')]: build(base) }));
    const found = (await deployDryRunCheck(fx.ctx)).violations;
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain(expected);
  });

  it('fails a record whose commit is not in the history of the checked-out commit', async () => {
    const fx = await project([STAGING]);
    await git(fx.dir, 'switch', '-c', 'side', '--quiet');
    await writeAndCommit(fx.dir, { 'side.txt': 'x' }, 'side');
    const side = await git(fx.dir, 'rev-parse', 'HEAD');
    await git(fx.dir, 'switch', 'main', '--quiet');
    await writeAndCommit(fx.dir, { [file('ENV-002')]: dryRun('ENV-002', {}, side) }, 'record');
    expect((await deployDryRunCheck(fx.ctx)).violations[0]?.message).toContain(
      'not in the history of the checked-out commit',
    );
  });

  it('accepts an abbreviated commit id', async () => {
    const fx = await project([STAGING], ({ base }) => ({
      [file('ENV-002')]: dryRun('ENV-002', {}, base.slice(0, 10)),
    }));
    expect((await deployDryRunCheck(fx.ctx)).violations).toEqual([]);
  });

  it('fails a record over the size ceiling', async () => {
    const fx = await project([STAGING], ({ base }) => ({
      [file('ENV-002')]: dryRun('ENV-002', { pad: 'x'.repeat(1_100_000) }, base),
    }));
    expect((await deployDryRunCheck(fx.ctx)).violations[0]?.message).toContain('byte limit');
  });

  it('a record for older code is stale: a file outside the project documents changed since its commit', async () => {
    const fx = await project([STAGING], ({ base }) => ({
      [file('ENV-002')]: dryRun('ENV-002', {}, base),
    }));
    expect((await deployDryRunCheck(fx.ctx)).violations).toEqual([]);
    // a documents-only change does not make it stale
    await writeAndCommit(fx.dir, { 'docs/forge/specs/stories/S.md': 'x' });
    expect(
      (
        await deployDryRunCheck({
          ...fx.ctx,
          documentRoots: [KB_ROOT, 'docs/forge/specs', 'docs/forge/reports'],
        })
      ).violations,
    ).toEqual([]);
    await writeAndCommit(fx.dir, { 'src/app.ts': 'export {}' });
    const found = (
      await deployDryRunCheck({
        ...fx.ctx,
        documentRoots: [KB_ROOT, 'docs/forge/specs', 'docs/forge/reports'],
      })
    ).violations;
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('is out of date');
    expect(found[0]?.message).toContain('src/app.ts');
  });

  it('fails when the environment register cannot be read, or the directory is not a repository', async () => {
    const broken = await project(undefined);
    await writeAndCommit(broken.dir, {
      [`${KB_ROOT}/delivery/environments.md`]: '---\ntype: Environment\n---\n',
    });
    expect((await deployDryRunCheck(broken.ctx)).violations[0]?.message).toContain(
      'environment register could not be read',
    );
    const fx = await project([STAGING]);
    await execa('rm', ['-rf', path.join(fx.dir, '.git')]);
    const found = (await deployDryRunCheck(fx.ctx)).violations;
    expect(found[0]?.subject).toBe('repository');
  });

  it('is deterministic and reads the same regardless of working-tree edits (register and records are committed state)', async () => {
    const fx = await project([STAGING, PROD], ({ base }) => ({
      [file('ENV-002')]: dryRun('ENV-002', {}, base),
    }));
    const first = JSON.stringify(await deployDryRunCheck(fx.ctx));
    expect((JSON.parse(first) as { violations: unknown[] }).violations).toHaveLength(1);
    // an uncommitted record for the missing environment, and an uncommitted register that drops it
    await writeFile(path.join(fx.dir, file('ENV-003')), dryRun('ENV-003', {}, fx.base));
    await writeFile(path.join(fx.dir, `${KB_ROOT}/delivery/environments.md`), register([STAGING]));
    expect(JSON.stringify(await deployDryRunCheck(fx.ctx))).toBe(first);
  });

  it('an environment whose purpose is free text is a delivery target, not exempt', async () => {
    const live: EnvSpec = {
      id: 'ENV-004',
      purpose: 'Live customer traffic',
      url: 'https://live.example.com',
    };
    const fx = await project([DEV, live]);
    const found = (await deployDryRunCheck(fx.ctx)).violations;
    expect(found.map((v) => v.subject)).toEqual(['ENV-004']);
  });

  it.each([
    'Preview environments for pull requests',
    'Local development',
    'Sandbox for experiments',
  ])('%s is not a delivery target', async (purpose) => {
    const fx = await project([{ id: 'ENV-005', purpose, url: 'https://x.example.com' }]);
    expect((await deployDryRunCheck(fx.ctx)).violations[0]?.message).toContain(
      'No delivery target environment is recorded',
    );
  });

  it.each<[string, boolean, boolean]>([
    // purpose, is a dry-run target, is a rollback-rehearsal target
    ['Production', true, false],
    ['Production (never dev)', true, false],
    ['Pre-production', true, true],
    ['Non-production QA', true, true],
    ['Staging: the pre-production environment', true, true],
    ['Live customer traffic; not a sandbox', true, true],
    ['Non-production sandbox', false, false],
    ['Sandbox for experiments', false, false],
    ['Development', false, false],
  ])('classifies %s: dry-run target %s, rehearsal target %s', async (purpose, dry, rehearse) => {
    const env: EnvSpec = { id: 'ENV-009', purpose, url: 'https://x.example.com' };
    const fx = await project([env]);
    const dryFound = (await deployDryRunCheck(fx.ctx)).violations.some(
      (v) => v.subject === 'ENV-009',
    );
    const rollFound = (await deployRollbackCheck(fx.ctx)).violations.some(
      (v) => v.subject === 'ENV-009',
    );
    expect(dryFound, 'dry-run target').toBe(dry);
    expect(rollFound, 'rehearsal target').toBe(rehearse);
  });

  it('a `.` or escaping document root excludes nothing (stale code is still stale); glob characters are literal', async () => {
    const fx = await project([STAGING], ({ base }) => ({
      [file('ENV-002')]: dryRun('ENV-002', {}, base),
    }));
    await writeAndCommit(fx.dir, { 'src/app.ts': 'export {}' });
    for (const roots of [['.'], ['../x', '/etc'], ['*'], ['[a-z]*']]) {
      expect(
        (await deployDryRunCheck({ ...fx.ctx, documentRoots: roots })).violations[0]?.message,
        roots.join(),
      ).toContain('is out of date');
    }
  });

  it('fails when the committed register is invalid, even if the working tree is fixed', async () => {
    const fx = await project(undefined);
    await writeAndCommit(fx.dir, {
      [`${KB_ROOT}/delivery/environments.md`]: '---\ntype: Environment\n---\n',
    });
    await writeFile(path.join(fx.dir, `${KB_ROOT}/delivery/environments.md`), register([STAGING]));
    expect((await deployDryRunCheck(fx.ctx)).violations[0]?.message).toContain(
      'environment register could not be read',
    );
  });

  it.each<[string, (b: string) => string, string]>([
    ['is missing kind', (b) => dryRun('ENV-002', { kind: undefined }, b), 'records kind undefined'],
    [
      'is missing environment',
      (b) => dryRun('ENV-002', { environment: undefined }, b),
      'records environment undefined',
    ],
    [
      'is missing outcome',
      (b) => dryRun('ENV-002', { outcome: undefined }, b),
      'records outcome undefined',
    ],
    [
      'is dated in the future',
      (b) => dryRun('ENV-002', { ran_at: '2100-01-01T00:00:00Z' }, b),
      'in the future',
    ],
    [
      'predates the commit it records',
      (b) => dryRun('ENV-002', { ran_at: '2020-01-01T00:00:00Z' }, b),
      'before the commit it records',
    ],
  ])('fails a record that %s, with a real diagnosis', async (_label, build, expected) => {
    const fx = await project([STAGING], ({ base }) => ({ [file('ENV-002')]: build(base) }));
    const outcome = await deployDryRunCheck(fx.ctx);
    expect(outcome.violations).toHaveLength(1);
    expect(outcome.violations[0]?.message).toContain(expected);
    expect(outcome.violations[0]?.message).not.toContain('could not run');
  });
});

describe('deploy --rollback-check', () => {
  const file = (env: string): string => `${DEPLOYMENTS}/${env}.rollback.json`;

  it('passes when every staging environment has a successful rollback rehearsal', async () => {
    const fx = await project([DEV, STAGING, PROD], ({ base, root }) => ({
      [file('ENV-002')]: rollback('ENV-002', {}, base, root),
    }));
    const outcome = await deployRollbackCheck(fx.ctx);
    expect(outcome.violations).toEqual([]);
    expect(outcome.fields).toMatchObject({ check: 'deploy-rollback-check', checked: 1 });
  });

  it('a production-only project fails: the rehearsal must be in staging', async () => {
    const fx = await project([PROD]);
    const found = (await deployRollbackCheck(fx.ctx)).violations;
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('No staging environment is recorded');
  });

  it('fails a staging environment with no record', async () => {
    const found = (await deployRollbackCheck((await project([STAGING])).ctx)).violations;
    expect(found[0]?.message).toContain(file('ENV-002'));
  });

  it('a staging environment on a local address cannot have been rehearsed on', async () => {
    const local: EnvSpec = { ...STAGING, url: 'http://localhost:8080' };
    const fx = await project([local], ({ base, root }) => ({
      [file('ENV-002')]: rollback('ENV-002', {}, base, root, 'localhost'),
    }));
    expect((await deployRollbackCheck(fx.ctx)).violations[0]?.message).toContain('local address');
  });

  it.each<[string, (from: string, to: string) => string, string]>([
    ['is not JSON', () => 'nope', 'could not be read as JSON'],
    [
      'has the wrong kind',
      (f, t) => rollback('ENV-002', { kind: 'dry-run' }, f, t),
      'not "rollback"',
    ],
    [
      'names another environment',
      (f, t) => rollback('ENV-002', { environment: 'ENV-009' }, f, t),
      'not ENV-002',
    ],
    [
      'records a failed outcome',
      (f, t) => rollback('ENV-002', { outcome: 'failed' }, f, t),
      'not "succeeded"',
    ],
    ['has no from_sha', (f, t) => rollback('ENV-002', { from_sha: undefined }, f, t), 'from_sha'],
    [
      'has a to_sha not in the repository',
      (f, t) => rollback('ENV-002', { to_sha: 'b'.repeat(40) }, f, t),
      'to_sha names commit',
    ],
    [
      'rolls back to the same commit',
      (f) => rollback('ENV-002', {}, f, f),
      'from a commit to itself',
    ],
    [
      'rolls "back" to a newer commit',
      (f, t) => rollback('ENV-002', {}, t, f),
      'not a rollback to an earlier version',
    ],
    [
      'has no rehearsed_at',
      (f, t) => rollback('ENV-002', { rehearsed_at: undefined }, f, t),
      'rehearsed_at',
    ],
    [
      'has a rehearsed_at with no zone',
      (f, t) => rollback('ENV-002', { rehearsed_at: '2050-02-01T10:00' }, f, t),
      'rehearsed_at',
    ],
    [
      'has no health record',
      (f, t) => rollback('ENV-002', { health: undefined }, f, t),
      'no "health" record',
    ],
    [
      'has a health url that is not a string',
      (f, t) => rollback('ENV-002', { health: { url: 3 } }, f, t),
      'health.url is missing',
    ],
    [
      'has a health check on another host',
      (f, t) => rollback('ENV-002', {}, f, t, 'evil.example.net'),
      "not the environment's staging.example.com",
    ],
    [
      'has a non-2xx health check',
      (f, t) =>
        rollback(
          'ENV-002',
          {
            health: {
              url: 'https://staging.example.com/h',
              status: 503,
              checked_at: '2050-02-01T10:05:00Z',
            },
          },
          f,
          t,
        ),
      'not a 2xx',
    ],
    [
      'has a health check before the rehearsal',
      (f, t) =>
        rollback(
          'ENV-002',
          {
            health: {
              url: 'https://staging.example.com/h',
              status: 200,
              checked_at: '2050-02-01T09:00:00Z',
            },
          },
          f,
          t,
        ),
      'before rehearsed_at',
    ],
    [
      'has a health check with no zone',
      (f, t) =>
        rollback(
          'ENV-002',
          {
            health: {
              url: 'https://staging.example.com/h',
              status: 200,
              checked_at: '2050-02-01T10:05:00',
            },
          },
          f,
          t,
        ),
      'health.checked_at',
    ],
  ])('fails a record that %s', async (_label, build, expected) => {
    const fx = await project([STAGING], ({ base, root }) => ({
      [file('ENV-002')]: build(base, root),
    }));
    const found = (await deployRollbackCheck(fx.ctx)).violations;
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain(expected);
  });

  it('a production-only environment is not rehearsed; an unclassifiable one is', async () => {
    const live: EnvSpec = {
      id: 'ENV-004',
      purpose: 'Live customer traffic',
      url: 'https://live.example.com',
    };
    const found = (await deployRollbackCheck((await project([PROD, live])).ctx)).violations;
    expect(found.map((v) => v.subject)).toEqual(['ENV-004']);
  });

  it.each<[string, (f: string, t: string) => string, string]>([
    [
      'is missing outcome',
      (f, t) => rollback('ENV-002', { outcome: undefined }, f, t),
      'records outcome undefined',
    ],
    [
      'has no health status',
      (f, t) =>
        rollback(
          'ENV-002',
          { health: { url: 'https://staging.example.com/h', checked_at: '2050-02-01T10:05:00Z' } },
          f,
          t,
        ),
      'health.status is undefined',
    ],
    [
      'is dated in the future',
      (f, t) =>
        rollback(
          'ENV-002',
          {
            rehearsed_at: '2100-01-01T00:00:00Z',
            health: {
              url: 'https://staging.example.com/h',
              status: 200,
              checked_at: '2100-01-01T00:01:00Z',
            },
          },
          f,
          t,
        ),
      'in the future',
    ],
    [
      'predates the commit it rolls back from',
      (f, t) =>
        rollback(
          'ENV-002',
          {
            rehearsed_at: '2020-01-01T00:00:00Z',
            health: {
              url: 'https://staging.example.com/h',
              status: 200,
              checked_at: '2020-01-01T00:01:00Z',
            },
          },
          f,
          t,
        ),
      'before the commit it records',
    ],
  ])('fails a record that %s, with a real diagnosis', async (_label, build, expected) => {
    const fx = await project([STAGING], ({ base, root }) => ({
      [file('ENV-002')]: build(base, root),
    }));
    const found = (await deployRollbackCheck(fx.ctx)).violations;
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain(expected);
    expect(found[0]?.message).not.toContain('could not run');
  });

  it('a rehearsal of older code is stale', async () => {
    const fx = await project([STAGING], ({ base, root }) => ({
      [file('ENV-002')]: rollback('ENV-002', {}, base, root),
    }));
    expect((await deployRollbackCheck(fx.ctx)).violations).toEqual([]);
    await writeAndCommit(fx.dir, { 'src/app.ts': 'export {}' });
    expect((await deployRollbackCheck(fx.ctx)).violations[0]?.message).toContain('is out of date');
  });

  it('every violation carries a remedy that names the Waiver route', async () => {
    const found = (await deployRollbackCheck((await project([STAGING])).ctx)).violations;
    expect(found[0]?.remedy).toMatch(/^Rehearse a rollback/);
    expect(found[0]?.remedy).toContain('Waiver');
  });

  it('is deterministic', async () => {
    const fx = await project([STAGING], ({ base, root }) => ({
      [file('ENV-002')]: rollback('ENV-002', {}, base, root),
    }));
    const first = JSON.stringify(await deployRollbackCheck(fx.ctx));
    expect(JSON.stringify(await deployRollbackCheck(fx.ctx))).toBe(first);
  });
});
