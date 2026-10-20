/**
 * `commands/dispatch/help.ts` — `forge help [topic]`, exercised in-process (direct calls to
 * {@link dispatchHelp}, never a spawned subprocess) so v8 coverage can see the real branches this
 * area file's own logic takes — `packages/cli/test/bin.test.ts`'s own real-subprocess tests
 * already prove the end-to-end CLI behaviour; this file's job is coverage of the moved logic itself
 * (`specs/22` M17 P2's own "the coverage report for the new dispatch modules meets the floor").
 *
 * @see specs/22 M17 P2
 */
import { afterEach, describe, expect, it } from 'vitest';

import { dispatchHelp } from '../../../src/commands/dispatch/help.ts';
import type { DispatchContext } from '../../../src/commands/dispatch/shared.ts';
import { cleanupAll, createTestProject, type TestProject } from '../helpers.ts';
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

describe('dispatchHelp (specs/22 M17 P2)', () => {
  it('returns undefined for a command it does not own', async () => {
    const project = await createTestProject();
    expect(await dispatchHelp(ctx(project, ['status']))).toBeUndefined();
  });

  it('recommends "forge init" for a real, never-initialized directory, in plain text', async () => {
    const project = await createTestProject();
    const exitCode = await dispatchHelp(ctx(project, ['help']));
    expect(exitCode).toBe(0);
  });

  it('recommends "forge init" under --json, as a {v:1, recommendation} envelope', async () => {
    const project = await createTestProject();
    const result = await captureLogs(() => dispatchHelp(ctx(project, ['help'], true)));
    expect(result.exitCode).toBe(0);
    expect(result.lines).toHaveLength(1);
    const parsed = JSON.parse(result.lines[0] ?? '{}') as {
      readonly v: number;
      readonly recommendation: { readonly command: string };
    };
    expect(parsed.v).toBe(1);
    expect(parsed.recommendation.command).toBe('forge init');
  });

  it('exits non-zero with a real USR-003 for "forge help <topic>" -- no real per-topic content exists', async () => {
    const project = await createTestProject();
    await expect(dispatchHelp(ctx(project, ['help', 'some-topic']))).rejects.toMatchObject({
      code: 'USR-003',
    });
  });
});
