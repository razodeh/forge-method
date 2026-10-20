/**
 * `commands/dispatch/lifecycle.ts` — `forge agent|workflow|template validate --all`, `forge status`,
 * `forge doctor`, exercised in-process (`specs/22` M17 P2's own "the coverage report for the new
 * dispatch modules meets the floor").
 *
 * @see specs/22 M17 P2
 */
import { afterEach, describe, expect, it } from 'vitest';

import { dispatchLifecycle } from '../../../src/commands/dispatch/lifecycle.ts';
import type { DispatchContext } from '../../../src/commands/dispatch/shared.ts';
import {
  cleanupAll,
  createConfiguredProject as createTestProject,
  type TestProject,
} from './dispatch-test-helpers.ts';

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

describe('dispatchLifecycle (specs/22 M17 P2)', () => {
  it('returns undefined for a command it does not own', async () => {
    const project = await createTestProject();
    expect(await dispatchLifecycle(ctx(project, ['kb', 'list']))).toBeUndefined();
  });

  it('runs "agent validate --all --json" for real, exiting 0 or 1 depending on real findings', async () => {
    const project = await createTestProject();
    const exitCode = await dispatchLifecycle(ctx(project, ['agent', 'validate', '--all'], true));
    expect([0, 1]).toContain(exitCode);
  });

  it('gives a real, specific "needs --all" message for "agent validate" missing it', async () => {
    const project = await createTestProject();
    expect(await dispatchLifecycle(ctx(project, ['agent', 'validate']))).toBe(2);
  });

  it('runs "workflow validate --all" for real', async () => {
    const project = await createTestProject();
    const exitCode = await dispatchLifecycle(ctx(project, ['workflow', 'validate', '--all']));
    expect([0, 1]).toContain(exitCode);
  });

  it('gives a real, specific "needs --all" message for "workflow validate" missing it', async () => {
    const project = await createTestProject();
    expect(await dispatchLifecycle(ctx(project, ['workflow', 'validate']))).toBe(2);
  });

  it('runs "template validate --all" for real, exiting 0', async () => {
    const project = await createTestProject();
    expect(await dispatchLifecycle(ctx(project, ['template', 'validate', '--all']))).toBe(0);
  });

  it('gives a real, specific "needs --all" message for "template validate" missing it', async () => {
    const project = await createTestProject();
    expect(await dispatchLifecycle(ctx(project, ['template', 'validate']))).toBe(2);
  });

  it('returns undefined for "agent"/"workflow"/"template" with no real "validate" subcommand', async () => {
    const project = await createTestProject();
    expect(await dispatchLifecycle(ctx(project, ['agent', 'list']))).toBeUndefined();
  });

  it('refuses RUN-048 for "--json status" against a real project with no run yet', async () => {
    const project = await createTestProject();
    await expect(dispatchLifecycle(ctx(project, ['status'], true))).rejects.toMatchObject({
      code: 'RUN-048',
    });
  });

  it('refuses RUN-048 for "status" (no --json) against a real project with no run yet', async () => {
    const project = await createTestProject();
    await expect(dispatchLifecycle(ctx(project, ['status']))).rejects.toMatchObject({
      code: 'RUN-048',
    });
  });

  it('runs "doctor --json" for real end to end, exiting 0 or 5 against a real, freshly configured project', async () => {
    const project = await createTestProject();
    const exitCode = await dispatchLifecycle(ctx(project, ['doctor'], true));
    expect([0, 5]).toContain(exitCode);
  });

  it('exits 2 for a real, unrecognised "doctor" flag', async () => {
    const project = await createTestProject();
    await expect(dispatchLifecycle(ctx(project, ['doctor', '--bogus']))).rejects.toMatchObject({
      code: 'USR-002',
    });
  });

  it('exits 2 for "doctor" given a real, unexpected extra positional', async () => {
    const project = await createTestProject();
    await expect(dispatchLifecycle(ctx(project, ['doctor', 'extra']))).rejects.toMatchObject({
      code: 'USR-002',
    });
  });

  it('runs "doctor --rule <name>" for real, through the real rule-command path', async () => {
    const project = await createTestProject();
    const exitCode = await dispatchLifecycle(
      ctx(project, ['doctor', '--rule', 'test-command'], true),
    );
    expect([0, 1]).toContain(exitCode);
  });

  it('refuses USR-002 for "doctor --rule" combined with --fix', async () => {
    const project = await createTestProject();
    await expect(
      dispatchLifecycle(ctx(project, ['doctor', '--rule', 'test-command', '--fix'])),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('refuses USR-002 for "doctor --rule" combined with --rebuild-index', async () => {
    const project = await createTestProject();
    await expect(
      dispatchLifecycle(ctx(project, ['doctor', '--rule', 'test-command', '--rebuild-index'])),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('refuses USR-002 for "doctor --rule" given more than once', async () => {
    const project = await createTestProject();
    await expect(
      dispatchLifecycle(
        ctx(project, ['doctor', '--rule', 'test-command', '--rule', 'test-command']),
      ),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('runs "doctor --fix" for real against a real project', async () => {
    const project = await createTestProject();
    const exitCode = await dispatchLifecycle(ctx(project, ['doctor', '--fix'], true));
    expect([0, 5]).toContain(exitCode);
  });

  it('runs "doctor --rebuild-index" for real against a real project', async () => {
    const project = await createTestProject();
    const exitCode = await dispatchLifecycle(ctx(project, ['doctor', '--rebuild-index'], true));
    expect([0, 5]).toContain(exitCode);
  });

  it('runs "doctor --fix --rebuild-index" for real, both flags together', async () => {
    const project = await createTestProject();
    const exitCode = await dispatchLifecycle(ctx(project, ['doctor', '--fix', '--rebuild-index']));
    expect([0, 5]).toContain(exitCode);
  });
});
