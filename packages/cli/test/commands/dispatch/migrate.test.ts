/**
 * `commands/dispatch/migrate.ts` — `forge migrate run`, exercised in-process (`specs/22` M17 P2's
 * own "the coverage report for the new dispatch modules meets the floor"). `migrateRun`'s own real
 * behaviour (ledger, dependency ordering, failure modes) is already exhaustively covered by
 * `packages/cli/test/commands/migrate/run.test.ts`; this file exercises only the dispatch wrapper's
 * own flag-parsing and usage-error branches.
 *
 * @see specs/22 M17 P2
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { dispatchMigrate } from '../../../src/commands/dispatch/migrate.ts';
import type { DispatchContext } from '../../../src/commands/dispatch/shared.ts';
import { KB_ROOT, cleanupAll, createTestProject, type TestProject } from '../helpers.ts';
import { captureLogs } from './dispatch-test-helpers.ts';

afterEach(cleanupAll);

function ctx(project: TestProject, positionals: readonly string[], json = false): DispatchContext {
  return {
    positionals,
    flags: {
      profile: 'default',
      dryRun: false,
      yes: false,
      json,
      noTui: false,
      verbosity: 0,
      quiet: false,
      positionals,
    },
    paths: project.paths,
    projectRoot: project.dir,
  };
}

async function writeMigrations(project: TestProject, yaml: string): Promise<void> {
  const target = path.join(project.dir, KB_ROOT, 'data', 'migrations.yaml');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, yaml, 'utf8');
}

describe('dispatchMigrate (specs/22 M17 P2)', () => {
  it('returns undefined for a command it does not own', async () => {
    const project = await createTestProject();
    expect(await dispatchMigrate(ctx(project, ['spec', 'list']))).toBeUndefined();
  });

  it('returns undefined for "migrate" with no real "run" subcommand', async () => {
    const project = await createTestProject();
    expect(await dispatchMigrate(ctx(project, ['migrate', 'status']))).toBeUndefined();
  });

  it('refuses USR-006 ("missing-phase") for "forge migrate run" with no --phase', async () => {
    const project = await createTestProject();
    await expect(dispatchMigrate(ctx(project, ['migrate', 'run']))).rejects.toMatchObject({
      code: 'USR-006',
    });
  });

  it('refuses USR-006 ("bad-phase") for an unrecognised --phase value', async () => {
    const project = await createTestProject();
    await expect(
      dispatchMigrate(ctx(project, ['migrate', 'run', '--phase', 'bogus'])),
    ).rejects.toMatchObject({ code: 'USR-006' });
  });

  it('refuses a real, extra positional (USR-002) through assertNoArgs', async () => {
    const project = await createTestProject();
    await writeMigrations(
      project,
      'migrations: []\nnone_reason: no real migrations are needed for this fixture\n',
    );
    await expect(
      dispatchMigrate(ctx(project, ['migrate', 'run', '--phase', 'expand', 'extra'])),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('refuses USR-006 ("unknown-migration") for a --migration id the file does not declare', async () => {
    const project = await createTestProject();
    await writeMigrations(
      project,
      'migrations: []\nnone_reason: no real migrations are needed for this fixture\n',
    );
    await expect(
      dispatchMigrate(ctx(project, ['migrate', 'run', '--phase', 'expand', '--migration', 'nope'])),
    ).rejects.toMatchObject({ code: 'USR-006' });
  });

  it('runs "forge migrate run --phase expand --json" for real, a vacuous success with zero entries', async () => {
    const project = await createTestProject();
    await writeMigrations(
      project,
      'migrations: []\nnone_reason: no real migrations are needed for this fixture\n',
    );
    const result = await captureLogs(() =>
      dispatchMigrate(ctx(project, ['migrate', 'run', '--phase', 'expand'], true)),
    );
    expect(result.exitCode).toBe(0);
    expect(result.lines).toHaveLength(1);
    const parsed = JSON.parse(result.lines[0] ?? '{}') as {
      readonly v: number;
      readonly phase: string;
      readonly applied: readonly string[];
    };
    expect(parsed.v).toBe(1);
    expect(parsed.phase).toBe('expand');
    expect(parsed.applied).toEqual([]);
  });

  it('runs "forge migrate run --phase contract" for real, in plain text, without --json', async () => {
    const project = await createTestProject();
    await writeMigrations(
      project,
      'migrations: []\nnone_reason: no real migrations are needed for this fixture\n',
    );
    const exitCode = await dispatchMigrate(ctx(project, ['migrate', 'run', '--phase', 'contract']));
    expect(exitCode).toBe(0);
  });
});
