/**
 * `commands/dispatch/adr.ts` — `forge adr <sub>`, exercised in-process (`specs/22` M17 P2's own
 * "the coverage report for the new dispatch modules meets the floor").
 *
 * @see specs/22 M17 P2
 */
import { afterEach, describe, expect, it } from 'vitest';

import { dispatchAdr } from '../../../src/commands/dispatch/adr.ts';
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

describe('dispatchAdr (specs/22 M17 P2)', () => {
  it('returns undefined for a command it does not own', async () => {
    const project = await createTestProject();
    expect(await dispatchAdr(ctx(project, ['kb', 'list']))).toBeUndefined();
  });

  it('exits 2 for "adr new" with no real <title>', async () => {
    const project = await createTestProject();
    const exitCode = await dispatchAdr(ctx(project, ['adr', 'new']));
    expect(exitCode).toBe(2);
  });

  it('runs "adr new <title> --json" for real, writing a real ADR', async () => {
    const project = await createTestProject();
    const created = await captureLogs(() =>
      dispatchAdr(ctx(project, ['adr', 'new', 'Use fixtures'], true)),
    );
    expect(created.exitCode).toBe(0);
    const parsed = JSON.parse(created.lines[0] ?? '{}') as {
      readonly path: string;
      readonly id: string;
    };
    expect(parsed.path).toContain('.md');
    const adrId = parsed.id;

    const listed = await captureLogs(() => dispatchAdr(ctx(project, ['adr', 'list'], true)));
    expect(listed.exitCode).toBe(0);
    const list = JSON.parse(listed.lines[0] ?? '{}') as {
      readonly entries: readonly { readonly id: string }[];
    };
    expect(list.entries.some((entry) => entry.id === adrId)).toBe(true);

    const showExit = await dispatchAdr(ctx(project, ['adr', 'show', adrId]));
    expect(showExit).toBe(0);

    const acceptExit = await dispatchAdr(ctx(project, ['adr', 'accept', adrId]));
    expect(acceptExit).toBe(0);
  });

  it('runs "adr new <title>" and "adr list" in plain text (no --json)', async () => {
    const project = await createTestProject();
    const exitCode = await dispatchAdr(ctx(project, ['adr', 'new', 'Plain text decision']));
    expect(exitCode).toBe(0);
    const listExit = await dispatchAdr(ctx(project, ['adr', 'list']));
    expect(listExit).toBe(0);
  });

  it('refuses USR-002 for "adr list" given a real, unexpected extra positional', async () => {
    const project = await createTestProject();
    await expect(dispatchAdr(ctx(project, ['adr', 'list', 'extra']))).rejects.toMatchObject({
      code: 'USR-002',
    });
  });

  it('exits non-zero for "adr show" with an unknown id', async () => {
    const project = await createTestProject();
    await expect(dispatchAdr(ctx(project, ['adr', 'show', 'ADR-9999']))).rejects.toBeDefined();
  });

  it('exits 2 for "adr show" with no real <id>', async () => {
    const project = await createTestProject();
    const exitCode = await dispatchAdr(ctx(project, ['adr', 'show']));
    expect(exitCode).toBe(2);
  });

  it('exits 2 for "adr supersede" with no real <id> <newTitle>', async () => {
    const project = await createTestProject();
    const exitCode = await dispatchAdr(ctx(project, ['adr', 'supersede']));
    expect(exitCode).toBe(2);
  });

  it('runs "adr supersede <id> <newTitle>" for real, then "adr reject <id>" on the replacement', async () => {
    const project = await createTestProject();
    const created = await captureLogs(() =>
      dispatchAdr(ctx(project, ['adr', 'new', 'Original decision'], true)),
    );
    const originalId = (JSON.parse(created.lines[0] ?? '{}') as { readonly id: string }).id;

    const superseded = await captureLogs(() =>
      dispatchAdr(ctx(project, ['adr', 'supersede', originalId, 'Replacement decision'], true)),
    );
    expect(superseded.exitCode).toBe(0);
    const supersedeResult = JSON.parse(superseded.lines[0] ?? '{}') as {
      readonly replacement: string;
    };
    // The real, written replacement file's own id, read back from its path -- never guessed.
    const replacementId = /(ADR-\d+)/.exec(supersedeResult.replacement)?.[1] ?? '';
    expect(replacementId).not.toBe('');

    const rejectExit = await dispatchAdr(ctx(project, ['adr', 'reject', replacementId]));
    expect(rejectExit).toBe(0);
  });

  it('runs "adr show <id> --json" and "adr accept <id> --json" for real', async () => {
    const project = await createTestProject();
    const created = await captureLogs(() =>
      dispatchAdr(ctx(project, ['adr', 'new', 'A JSON-rendered decision'], true)),
    );
    const adrId = (JSON.parse(created.lines[0] ?? '{}') as { readonly id: string }).id;

    const shown = await captureLogs(() => dispatchAdr(ctx(project, ['adr', 'show', adrId], true)));
    expect(shown.exitCode).toBe(0);
    const shownParsed = JSON.parse(shown.lines[0] ?? '{}') as { readonly path: string };
    expect(shownParsed.path).toContain('.md');

    const accepted = await captureLogs(() =>
      dispatchAdr(ctx(project, ['adr', 'accept', adrId], true)),
    );
    expect(accepted.exitCode).toBe(0);
    const acceptedParsed = JSON.parse(accepted.lines[0] ?? '{}') as { readonly status: string };
    expect(acceptedParsed.status).toBeTruthy();
  });

  it('exits 2 for "adr new" given a real, unexpected extra positional', async () => {
    const project = await createTestProject();
    const exitCode = await dispatchAdr(ctx(project, ['adr', 'new', 'Title', 'extra']));
    expect(exitCode).toBe(2);
  });

  it('exits 2 for a real, unrecognised "adr" subcommand', async () => {
    const project = await createTestProject();
    const exitCode = await dispatchAdr(ctx(project, ['adr', 'bogus']));
    expect(exitCode).toBe(2);
  });
});
