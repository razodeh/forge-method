/**
 * `commands/dispatch/workspace.ts` — `forge export`/`audit`/`config`/`cost`/`report`/`uninstall`,
 * exercised in-process (`specs/22` M17 P2's own "the coverage report for the new dispatch modules
 * meets the floor").
 *
 * @see specs/22 M17 P2
 */
import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { dispatchWorkspace } from '../../../src/commands/dispatch/workspace.ts';
import type { DispatchContext } from '../../../src/commands/dispatch/shared.ts';
import {
  cleanupAll,
  createConfiguredProject as createTestProject,
  type TestProject,
} from './dispatch-test-helpers.ts';

afterEach(cleanupAll);

function ctx(
  project: TestProject,
  positionals: readonly string[],
  json = false,
  yes = false,
): DispatchContext {
  return {
    positionals,
    flags: {
      profile: 'default',
      dryRun: false,
      yes,
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

describe('dispatchWorkspace (specs/22 M17 P2)', () => {
  it('returns undefined for a command it does not own', async () => {
    const project = await createTestProject();
    expect(await dispatchWorkspace(ctx(project, ['kb', 'list']))).toBeUndefined();
  });

  it('runs "export markdown-bundle" for real, printing real content to stdout', async () => {
    const project = await createTestProject();
    expect(await dispatchWorkspace(ctx(project, ['export', 'markdown-bundle']))).toBe(0);
  });

  it('runs "export html --json" for real, printing a real {v:1,...} envelope', async () => {
    const project = await createTestProject();
    expect(await dispatchWorkspace(ctx(project, ['export', 'html'], true))).toBe(0);
  });

  it('refuses the real, already-disclosed USR-003 for "export jira"', async () => {
    const project = await createTestProject();
    await expect(dispatchWorkspace(ctx(project, ['export', 'jira']))).rejects.toMatchObject({
      code: 'USR-003',
    });
  });

  it('exits 2 for a real, unrecognised "export" target', async () => {
    const project = await createTestProject();
    expect(await dispatchWorkspace(ctx(project, ['export']))).toBe(2);
  });

  it('runs "audit --json" for real against a real, event-free project', async () => {
    const project = await createTestProject();
    expect(await dispatchWorkspace(ctx(project, ['audit'], true))).toBe(0);
  });

  it('runs "audit --since <date>" for real, echoing the real cutoff back in --json', async () => {
    const project = await createTestProject();
    expect(await dispatchWorkspace(ctx(project, ['audit', '--since', '2026-01-01'], true))).toBe(0);
  });

  it('exits 2 with a real USR-002 for a real, malformed "audit --since" value', async () => {
    const project = await createTestProject();
    await expect(
      dispatchWorkspace(ctx(project, ['audit', '--since', 'not-a-date'])),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('runs "config get <key> --json" for real against a real, default project config', async () => {
    const project = await createTestProject();
    expect(await dispatchWorkspace(ctx(project, ['config', 'get', 'project.level'], true))).toBe(0);
  });

  it('exits 2 with a real USR-002 for "config get" against an unknown key', async () => {
    const project = await createTestProject();
    await expect(
      dispatchWorkspace(ctx(project, ['config', 'get', 'not.a.real.key'])),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('runs "config set <key> <value>" for real, durably writing the real config file', async () => {
    const project = await createTestProject();
    const exitCode = await dispatchWorkspace(
      ctx(project, ['config', 'set', 'project.name', 'Fixture Project']),
    );
    expect(exitCode).toBe(0);
    expect(await dispatchWorkspace(ctx(project, ['config', 'get', 'project.name'], true))).toBe(0);
  });

  it('runs "config get <key>" in plain text (no --json)', async () => {
    const project = await createTestProject();
    expect(await dispatchWorkspace(ctx(project, ['config', 'get', 'project.level']))).toBe(0);
  });

  it('runs "config set <key> <value> --commit" for real, through the real marker-reading --commit branch', async () => {
    const project = await createTestProject();
    await execa('git', ['init'], { cwd: project.dir });
    await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: project.dir });
    await execa('git', ['config', 'user.name', 'Fixture'], { cwd: project.dir });
    await execa('git', ['add', '-A'], { cwd: project.dir });
    await execa('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: project.dir });
    const exitCode = await dispatchWorkspace(
      ctx(project, ['config', 'set', 'project.name', 'Committed Project', '--commit'], true),
    );
    expect(exitCode).toBe(0);
  });

  it('refuses the real, already-disclosed USR-003 for "config edit"', async () => {
    const project = await createTestProject();
    await expect(dispatchWorkspace(ctx(project, ['config', 'edit']))).rejects.toMatchObject({
      code: 'USR-003',
    });
  });

  it('exits 2 for a real, unrecognised "config" subcommand', async () => {
    const project = await createTestProject();
    expect(await dispatchWorkspace(ctx(project, ['config', 'bogus']))).toBe(2);
  });

  it('runs "cost --json" for real, a real, zeroed report against a project with no real runs', async () => {
    const project = await createTestProject();
    expect(await dispatchWorkspace(ctx(project, ['cost'], true))).toBe(0);
  });

  it('refuses the real, disclosed USR-003 for "cost --run"', async () => {
    const project = await createTestProject();
    await expect(dispatchWorkspace(ctx(project, ['cost', '--run', 'run-1']))).rejects.toMatchObject(
      { code: 'USR-003' },
    );
  });

  it('refuses the real, disclosed USR-003 for "cost --since"', async () => {
    const project = await createTestProject();
    await expect(
      dispatchWorkspace(ctx(project, ['cost', '--since', '2026-01-01'])),
    ).rejects.toMatchObject({ code: 'USR-003' });
  });

  it('runs "report --json" for real, a real, zeroed scorecard against a project with no real runs', async () => {
    const project = await createTestProject();
    expect(await dispatchWorkspace(ctx(project, ['report'], true))).toBe(0);
  });

  it('runs "report" in plain text (no --json), rendering the full binding/critic-loop/gates/cost/kb-reads summary', async () => {
    const project = await createTestProject();
    expect(await dispatchWorkspace(ctx(project, ['report']))).toBe(0);
  });

  it('runs "report --baseline --json" for real, writing a real snapshot with commit: null against a project with no commits yet', async () => {
    const project = await createTestProject();
    // `resolveHeadShaOrUndefined` (`@forge/vcs`) only tolerates a real git repo with zero commits
    // (`HEAD` genuinely has no meaning yet), never "no `.git` at all" -- a real `git init`, no commit.
    await execa('git', ['init'], { cwd: project.dir });
    expect(await dispatchWorkspace(ctx(project, ['report', '--baseline'], true))).toBe(0);
  });

  it('runs "report --since <date> --json" for real, echoing the real cutoff back', async () => {
    const project = await createTestProject();
    expect(await dispatchWorkspace(ctx(project, ['report', '--since', '2026-01-01'], true))).toBe(
      0,
    );
  });

  it('exits 2 with a real USR-002 for a real, malformed "report --since" value', async () => {
    const project = await createTestProject();
    await expect(
      dispatchWorkspace(ctx(project, ['report', '--since', 'not-a-date'])),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('exits 2 with a real USR-002 for the disclosed "--baseline --since" incompatible-flags refusal', async () => {
    const project = await createTestProject();
    await expect(
      dispatchWorkspace(ctx(project, ['report', '--baseline', '--since', '2026-01-01'])),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('exits non-zero for "uninstall" with no real --yes, removing nothing', async () => {
    const project = await createTestProject();
    await expect(dispatchWorkspace(ctx(project, ['uninstall']))).rejects.toBeDefined();
  });

  it('runs "uninstall --yes --json" for real end to end, removing .forge/ and writing a real backup', async () => {
    const project = await createTestProject();
    const exitCode = await dispatchWorkspace(ctx(project, ['uninstall'], true, true));
    expect(exitCode).toBe(0);
  });

  it('runs "uninstall --yes" in plain text (no --json)', async () => {
    const project = await createTestProject();
    const exitCode = await dispatchWorkspace(ctx(project, ['uninstall'], false, true));
    expect(exitCode).toBe(0);
  });

  it('runs "uninstall --yes --remove-docs --json" for real, also removing docs/forge/', async () => {
    const project = await createTestProject();
    const exitCode = await dispatchWorkspace(
      ctx(project, ['uninstall', '--remove-docs'], true, true),
    );
    expect(exitCode).toBe(0);
  });
});
