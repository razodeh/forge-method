/**
 * `forge deploy record <dry-run|rollback|deployment>` (`PLAN-M14.md` P23): a validating writer for the delivery
 * records `deploy-evidence.ts` (`forge deploy --dry-run`/`--rollback-check`) and `doctor/rules-delivery.ts`
 * (`skeletonDeployedViolations`) read back.
 *
 * Every fixture is a real git repository with the environment register written as a KB collection file and
 * committed, exactly like `deploy-evidence.test.ts`'s own fixtures — this suite proves the two sides agree: what
 * this writer accepts is exactly what those checks later pass.
 *
 * @see specs/03 §3.2.5
 * @see specs/10 §10.3
 * @see specs/14 §14.3, §14.4, §14.9
 * @see PLAN-M14.md P23
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { deployDryRunCheck, deployRollbackCheck } from '../../src/commands/deploy-evidence.ts';
import {
  recordDeployment,
  recordDryRun,
  recordRollback,
  type DeployRecordContext,
  type DeployRecordOutcome,
} from '../../src/commands/deploy-record.ts';
import { skeletonDeployedViolations } from '../../src/commands/doctor/rules-delivery.ts';
import type { DoctorRuleContext } from '../../src/commands/doctor/rules.ts';
import { KB_ROOT, cleanupAll, createTestProject, writeAndCommit } from './doctor/helpers.ts';

afterEach(cleanupAll);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const briefsRoot = path.join(repoRoot, 'packages', 'templates', 'templates', 'briefs');

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

const REPORTS_ROOT = 'docs/forge/reports';
const DEPLOYMENTS = `${REPORTS_ROOT}/deployments`;

async function git(dir: string, ...args: string[]): Promise<string> {
  return (await execa('git', args, { cwd: dir })).stdout.trim();
}

async function commitAll(dir: string, message = 'record'): Promise<void> {
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', message], { cwd: dir });
}

interface Fixture {
  readonly dir: string;
  readonly ctx: DeployRecordContext;
  /** The commit that holds the register — a valid `--sha`/`--from-sha` for every test below. */
  readonly base: string;
  /** An older commit than `base`: a valid `--to-sha`. */
  readonly root: string;
}

async function project(envs: readonly EnvSpec[] | undefined): Promise<Fixture> {
  const { dir, paths } = await createTestProject();
  const root = await git(dir, 'rev-parse', 'HEAD');
  await writeAndCommit(
    dir,
    envs === undefined ? {} : { [`${KB_ROOT}/delivery/environments.md`]: register(envs) },
  );
  const base = await git(dir, 'rev-parse', 'HEAD');
  return {
    dir,
    base,
    root,
    ctx: {
      paths,
      projectRoot: dir,
      kbRoot: KB_ROOT,
      reportsRoot: REPORTS_ROOT,
      clock: { now: () => '2099-01-01T00:00:00.000Z' },
    },
  };
}

function expectWritten(outcome: DeployRecordOutcome, file: string): void {
  expect(outcome).toMatchObject({ ok: true, written: file });
}

function expectRefused(
  outcome: DeployRecordOutcome,
  dir: string,
  file: string,
  messageContains: string,
): void {
  expect(outcome.ok, JSON.stringify(outcome)).toBe(false);
  if (outcome.ok) return;
  expect(outcome.message).toContain(messageContains);
  expect(outcome.remedy.length).toBeGreaterThan(0);
  expect(existsSync(path.join(dir, file)), 'no file must be written on a refusal').toBe(false);
}

describe('recordDryRun', () => {
  const file = (env: string): string => `${DEPLOYMENTS}/${env}.dry-run.json`;

  it('writes the record, and the check passes once it is committed', async () => {
    const fx = await project([STAGING]);
    const outcome = await recordDryRun(fx.ctx, {
      env: 'ENV-002',
      sha: fx.base,
      ranAt: '2050-01-01T00:00:00Z',
    });
    expectWritten(outcome, file('ENV-002'));
    if (!outcome.ok) throw new Error('unreachable');
    const written = JSON.parse(
      await readFile(path.join(fx.dir, outcome.written), 'utf8'),
    ) as unknown;
    expect(written).toMatchObject({
      v: 1,
      kind: 'dry-run',
      environment: 'ENV-002',
      outcome: 'passed',
      sha: fx.base,
      ran_at: '2050-01-01T00:00:00Z',
    });
    await commitAll(fx.dir);
    expect((await deployDryRunCheck(fx.ctx)).violations).toEqual([]);
  });

  it('remedy names --env, --sha and --ran-at, and each refusal reports a real reason and writes no file', async () => {
    const fx = await project([DEV, STAGING]);
    const cases: readonly [string, () => Promise<DeployRecordOutcome>, string][] = [
      [
        'unknown env',
        () => recordDryRun(fx.ctx, { env: 'ENV-999', sha: fx.base, ranAt: '2050-01-01T00:00:00Z' }),
        'no environment ENV-999 is recorded',
      ],
      [
        'not a target',
        () => recordDryRun(fx.ctx, { env: 'ENV-001', sha: fx.base, ranAt: '2050-01-01T00:00:00Z' }),
        'is not a delivery-target environment',
      ],
      [
        'sha not in history',
        () =>
          recordDryRun(fx.ctx, {
            env: 'ENV-002',
            sha: 'a'.repeat(40),
            ranAt: '2050-01-01T00:00:00Z',
          }),
        'not in this repository',
      ],
      [
        'zone-less ran_at',
        () => recordDryRun(fx.ctx, { env: 'ENV-002', sha: fx.base, ranAt: '2050-01-01T00:00:00' }),
        'ran_at',
      ],
      [
        'future ran_at',
        () => recordDryRun(fx.ctx, { env: 'ENV-002', sha: fx.base, ranAt: '2200-01-01T00:00:00Z' }),
        'in the future',
      ],
      [
        'ran_at before the commit',
        () => recordDryRun(fx.ctx, { env: 'ENV-002', sha: fx.base, ranAt: '2020-01-01T00:00:00Z' }),
        'before the commit',
      ],
    ];
    for (const [label, run, expected] of cases) {
      const outcome = await run();
      expectRefused(outcome, fx.dir, file('ENV-002'), expected);
      if (!outcome.ok) {
        expect(outcome.remedy, label).toContain('--env');
        expect(outcome.remedy, label).toContain('--sha');
        expect(outcome.remedy, label).toContain('--ran-at');
      }
    }
  });

  it('refuses when the environment register is not committed at all', async () => {
    const fx = await project(undefined);
    const outcome = await recordDryRun(fx.ctx, {
      env: 'ENV-002',
      sha: fx.base,
      ranAt: '2050-01-01T00:00:00Z',
    });
    expectRefused(outcome, fx.dir, file('ENV-002'), 'not committed');
  });

  it('atomically replaces an existing record with the latest write', async () => {
    const fx = await project([STAGING]);
    const first = await recordDryRun(fx.ctx, {
      env: 'ENV-002',
      sha: fx.base,
      ranAt: '2050-01-01T00:00:00Z',
    });
    expect(first.ok).toBe(true);
    const second = await recordDryRun(fx.ctx, {
      env: 'ENV-002',
      sha: fx.base,
      ranAt: '2060-06-01T00:00:00Z',
    });
    expect(second.ok).toBe(true);
    const written = JSON.parse(
      await readFile(path.join(fx.dir, file('ENV-002')), 'utf8'),
    ) as Record<string, unknown>;
    expect(written['ran_at']).toBe('2060-06-01T00:00:00Z');
  });

  it('a record valid at write time is later reported stale by the check, once more of the repository changes', async () => {
    const fx = await project([STAGING]);
    const outcome = await recordDryRun(fx.ctx, {
      env: 'ENV-002',
      sha: fx.base,
      ranAt: '2050-01-01T00:00:00Z',
    });
    expect(outcome.ok).toBe(true);
    await commitAll(fx.dir);
    expect((await deployDryRunCheck(fx.ctx)).violations).toEqual([]);
    await writeAndCommit(fx.dir, { 'src/app.ts': 'export {}' });
    const found = (await deployDryRunCheck(fx.ctx)).violations;
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('is out of date');
  });
});

describe('recordRollback', () => {
  const file = (env: string): string => `${DEPLOYMENTS}/${env}.rollback.json`;

  const validFields = (fx: Fixture) => ({
    env: 'ENV-002',
    fromSha: fx.base,
    toSha: fx.root,
    rehearsedAt: '2050-01-01T00:00:00Z',
    healthUrl: 'https://staging.example.com/healthz',
    healthStatus: '200',
    healthCheckedAt: '2050-01-01T00:05:00Z',
  });

  it('writes the record, and the check passes once it is committed', async () => {
    const fx = await project([STAGING]);
    const outcome = await recordRollback(fx.ctx, validFields(fx));
    expectWritten(outcome, file('ENV-002'));
    if (!outcome.ok) throw new Error('unreachable');
    const written = JSON.parse(
      await readFile(path.join(fx.dir, outcome.written), 'utf8'),
    ) as unknown;
    expect(written).toMatchObject({
      v: 1,
      kind: 'rollback',
      environment: 'ENV-002',
      outcome: 'succeeded',
      from_sha: fx.base,
      to_sha: fx.root,
      rehearsed_at: '2050-01-01T00:00:00Z',
      health: {
        url: 'https://staging.example.com/healthz',
        status: 200,
        checked_at: '2050-01-01T00:05:00Z',
      },
    });
    await commitAll(fx.dir);
    expect((await deployRollbackCheck(fx.ctx)).violations).toEqual([]);
  });

  it('writes a well-typed JSON number for --health-status, not a string', async () => {
    const fx = await project([STAGING]);
    const outcome = await recordRollback(fx.ctx, validFields(fx));
    if (!outcome.ok) throw new Error('unreachable');
    const written = JSON.parse(await readFile(path.join(fx.dir, outcome.written), 'utf8')) as {
      health: { status: unknown };
    };
    expect(written.health.status).toBe(200);
    expect(typeof written.health.status).toBe('number');
  });

  // Critic round 1 (real bug, empirically proven): `bin.ts`'s `runDeployRecordCommand` used to build its
  // `DeployRecordContext` with no `documentRoots` at all, defaulting to the narrow `[kbRoot, reportsRoot]`
  // `staleProblem`'s own default falls back to -- while the real check (`deployRollbackCheck`, wired a few
  // lines away in the SAME file) builds its context with the wide `[kb, specs, plans, sessions, reports]`
  // list. A `--from-sha` that is not exactly `HEAD`, where the only intervening commit touches `specs/` (in
  // the wide list, not the narrow one), used to make the WRITER refuse a record the CHECK would have accepted
  // -- reproduced here directly against `recordRollback` itself (not the CLI dispatcher, which this suite does
  // not spawn) by passing the two different `documentRoots` lists explicitly, exactly as the two `bin.ts` call
  // sites now agree to build them.
  it('a --from-sha behind HEAD by a specs-only commit is accepted with the wide documentRoots (parity with the check), refused with the narrow default', async () => {
    const fx = await project([STAGING]);
    await writeAndCommit(fx.dir, { 'docs/forge/specs/stories/S-1.md': 'x' });
    const wide = {
      ...fx.ctx,
      documentRoots: [
        KB_ROOT,
        'docs/forge/specs',
        'docs/forge/plans',
        'docs/forge/sessions',
        REPORTS_ROOT,
      ],
    };
    const accepted = await recordRollback(wide, validFields(fx));
    expect(accepted.ok, JSON.stringify(accepted)).toBe(true);

    const narrow = { ...fx.ctx, documentRoots: [KB_ROOT, REPORTS_ROOT] };
    const refused = await recordRollback(narrow, validFields(fx));
    expect(refused.ok, JSON.stringify(refused)).toBe(false);
    if (!refused.ok) expect(refused.message).toContain('is out of date');
  });

  it.each<[string, (fx: Fixture) => Partial<ReturnType<typeof validFields>>, string]>([
    ['unknown env', () => ({ env: 'ENV-999' }), 'no environment ENV-999 is recorded'],
    ['not a target', () => ({ env: 'ENV-001' }), 'is not a delivery-target environment'],
    [
      // Critic round 1 (real bug, empirically proven): `resolveEnvironment` used to gate `recordRollback` on
      // plain `isTarget`, which a pure-production environment satisfies -- so this used to WRITE a "successful"
      // rollback record `deployRollbackCheck` (whose own `pick` is the narrower `isRehearsalTarget`, 14 §14.4
      // rule 2 "in staging") would then silently never read at all.
      'a production-only environment (not a rehearsal target)',
      // `healthUrl` is overridden to PROD's own host (not STAGING's, `validFields`' default): under the
      // reverted bug (gating on plain `isTarget`) this makes the record actually WRITE successfully --
      // the real failure mode a critic round reproduced live -- rather than being refused for the
      // unrelated reason of a health-host mismatch against the wrong environment's host, which would
      // make this regression test pass before the fix for the wrong reason.
      () => ({ env: 'ENV-003', healthUrl: 'https://app.example.com/healthz' }),
      'is not a delivery-target environment',
    ],
    ['from_sha not in history', () => ({ fromSha: 'a'.repeat(40) }), 'not in this repository'],
    ['to_sha not in history', () => ({ toSha: 'b'.repeat(40) }), 'not in this repository'],
    ['equal shas', (fx) => ({ toSha: fx.base }), 'from a commit to itself'],
    [
      'to_sha not an ancestor of from_sha',
      (fx) => ({ fromSha: fx.root, toSha: fx.base }),
      'not a rollback to an earlier version',
    ],
    ['zone-less rehearsed_at', () => ({ rehearsedAt: '2050-01-01T00:00:00' }), 'rehearsed_at'],
    ['future rehearsed_at', () => ({ rehearsedAt: '2200-01-01T00:00:00Z' }), 'in the future'],
    [
      'rehearsed_at before from_sha',
      () => ({ rehearsedAt: '2020-01-01T00:00:00Z' }),
      'before the commit',
    ],
    ['a local health url', () => ({ healthUrl: 'http://localhost:9999/healthz' }), 'local address'],
    [
      'a health url on another host',
      () => ({ healthUrl: 'https://evil.example.net/h' }),
      "not the environment's",
    ],
    ['a non-2xx health status', () => ({ healthStatus: '503' }), 'not a 2xx response'],
    ['a non-numeric health status', () => ({ healthStatus: 'ok' }), 'not a 2xx response'],
    [
      'checked_at before rehearsed_at',
      () => ({ healthCheckedAt: '2020-01-01T00:05:00Z' }),
      'before rehearsed_at',
    ],
    [
      'a zone-less checked_at',
      () => ({ healthCheckedAt: '2050-01-01T00:05:00' }),
      'health.checked_at',
    ],
  ])('refuses %s, with a real reason and no file written', async (_label, delta, expected) => {
    const fx = await project([DEV, STAGING, PROD]);
    const overrides = delta(fx);
    const outcome = await recordRollback(fx.ctx, { ...validFields(fx), ...overrides });
    expectRefused(outcome, fx.dir, file(overrides.env ?? 'ENV-002'), expected);
    if (!outcome.ok) {
      expect(outcome.remedy).toContain('--from-sha');
      expect(outcome.remedy).toContain('--to-sha');
      expect(outcome.remedy).toContain('--health-status');
    }
  });
});

describe('recordDeployment', () => {
  const file = (env: string): string => `${DEPLOYMENTS}/${env}.json`;

  const validFields = (fx: Fixture) => ({
    env: 'ENV-001',
    sha: fx.base,
    deployedAt: '2050-01-01T00:00:00Z',
    healthUrl: 'https://dev.example.com/healthz',
    healthStatus: '200',
    healthCheckedAt: '2050-01-01T00:05:00Z',
  });

  it('writes the record for the DEVELOPMENT environment (not a delivery target), and skeletonDeployedViolations passes once committed', async () => {
    const fx = await project([DEV]);
    const outcome = await recordDeployment(fx.ctx, validFields(fx));
    expectWritten(outcome, file('ENV-001'));
    if (!outcome.ok) throw new Error('unreachable');
    const written = JSON.parse(
      await readFile(path.join(fx.dir, outcome.written), 'utf8'),
    ) as unknown;
    expect(written).toMatchObject({
      v: 1,
      environment: 'ENV-001',
      outcome: 'succeeded',
      sha: fx.base,
      deployed_at: '2050-01-01T00:00:00Z',
      health: {
        url: 'https://dev.example.com/healthz',
        status: 200,
        checked_at: '2050-01-01T00:05:00Z',
      },
    });
    expect(written).not.toHaveProperty('kind');
    await commitAll(fx.dir);
    const ctx: DoctorRuleContext = { ...fx.ctx, env: {} };
    expect(await skeletonDeployedViolations(ctx)).toEqual([]);
  });

  it.each<[string, (fx: Fixture) => Partial<ReturnType<typeof validFields>>, string]>([
    ['unknown env', () => ({ env: 'ENV-999' }), 'no environment ENV-999 is recorded'],
    ['sha not in history', () => ({ sha: 'a'.repeat(40) }), 'not in this repository'],
    ['zone-less deployed_at', () => ({ deployedAt: '2050-01-01T00:00:00' }), 'deployed_at'],
    ['future deployed_at', () => ({ deployedAt: '2200-01-01T00:00:00Z' }), 'in the future'],
    [
      'deployed_at before the commit',
      () => ({ deployedAt: '2020-01-01T00:00:00Z' }),
      'before the commit',
    ],
    ['a local health url', () => ({ healthUrl: 'http://localhost:9999/healthz' }), 'local address'],
    [
      'a health url on another host',
      () => ({ healthUrl: 'https://evil.example.net/h' }),
      "not the environment's",
    ],
    ['a non-2xx health status', () => ({ healthStatus: '503' }), 'not a 2xx response'],
    [
      'checked_at before deployed_at',
      () => ({ healthCheckedAt: '2020-01-01T00:05:00Z' }),
      'before deployed_at',
    ],
  ])('refuses %s, with a real reason and no file written', async (_label, delta, expected) => {
    const fx = await project([DEV]);
    const outcome = await recordDeployment(fx.ctx, { ...validFields(fx), ...delta(fx) });
    expectRefused(outcome, fx.dir, file('ENV-001'), expected);
  });

  it('a development environment on a local address cannot have received a recorded deployment', async () => {
    const fx = await project([{ ...DEV, url: 'http://localhost:3000' }]);
    const outcome = await recordDeployment(fx.ctx, validFields(fx));
    expectRefused(outcome, fx.dir, file('ENV-001'), 'local address');
  });
});

/** Markdown prose wraps at ~100 columns, so a long literal command can have a hard line break (plus
 * indentation) in the middle of it; collapsing all whitespace runs to a single space is what makes
 * "contains the literal command" a check of the text's *content*, not of where the wrap happened to
 * fall. */
function unwrapped(text: string): string {
  return text.replace(/\s+/g, ' ');
}

describe('the delivery briefs carry the literal forge deploy record commands (PLAN-M14.md P23)', () => {
  it('design-cicd-pipeline.md names the dry-run and rollback forms', async () => {
    const text = unwrapped(
      await readFile(path.join(briefsRoot, 'design-cicd-pipeline.md'), 'utf8'),
    );
    expect(text).toContain(
      'forge deploy record dry-run --env <ENV-id> --sha <commit> --ran-at <instant>',
    );
    expect(text).toContain(
      'forge deploy record rollback --env <ENV-id> --from-sha --to-sha --rehearsed-at --health-url ' +
        '--health-status --health-checked-at',
    );
  });

  it('design-deployment-strategy.md names the deployment form', async () => {
    const text = unwrapped(
      await readFile(path.join(briefsRoot, 'design-deployment-strategy.md'), 'utf8'),
    );
    expect(text).toContain(
      'forge deploy record deployment --env <ENV-id> --sha <commit> --deployed-at <instant> ' +
        '--health-url --health-status --health-checked-at',
    );
  });
});
