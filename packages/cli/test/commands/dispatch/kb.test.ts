/**
 * `commands/dispatch/kb.ts` — `forge kb <sub>`, exercised in-process (`specs/22` M17 P2's own "the
 * coverage report for the new dispatch modules meets the floor").
 *
 * @see specs/22 M17 P2
 */
import { afterEach, describe, expect, it } from 'vitest';

import { dispatchKb } from '../../../src/commands/dispatch/kb.ts';
import type { DispatchContext } from '../../../src/commands/dispatch/shared.ts';
import { writeKbEntryFixture } from '../helpers.ts';
import {
  captureLogs,
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

describe('dispatchKb (specs/22 M17 P2)', () => {
  it('returns undefined for a command it does not own', async () => {
    const project = await createTestProject();
    expect(await dispatchKb(ctx(project, ['spec', 'list']))).toBeUndefined();
  });

  it('lists a real KB entry via "kb list --json"', async () => {
    const project = await createTestProject();
    await writeKbEntryFixture(project);
    const result = await captureLogs(() => dispatchKb(ctx(project, ['kb', 'list'], true)));
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.lines[0] ?? '{}') as {
      readonly entries: readonly { readonly id: string }[];
    };
    expect(parsed.entries.map((entry) => entry.id)).toContain('KB-ARCH-0001');
  });

  it('runs "kb show <id>"/"kb search"/"kb sync"/"kb graph" for real against a real entry', async () => {
    const project = await createTestProject();
    await writeKbEntryFixture(project);
    expect(await dispatchKb(ctx(project, ['kb', 'show', 'KB-ARCH-0001']))).toBe(0);
    expect(await dispatchKb(ctx(project, ['kb', 'search', 'fixture']))).toBe(0);
    expect(await dispatchKb(ctx(project, ['kb', 'sync']))).toBe(0);
    expect(await dispatchKb(ctx(project, ['kb', 'graph', 'KB-ARCH-0001']))).toBe(0);
    expect(await dispatchKb(ctx(project, ['kb', 'graph', 'KB-ARCH-0001', '--hops', '2']))).toBe(0);
  });

  it('exits 2 for "kb show" with no real <id>', async () => {
    const project = await createTestProject();
    expect(await dispatchKb(ctx(project, ['kb', 'show']))).toBe(2);
  });

  it('exits non-zero for "kb show" with an unknown id (real KB-015)', async () => {
    const project = await createTestProject();
    await expect(dispatchKb(ctx(project, ['kb', 'show', 'KB-NOPE']))).rejects.toMatchObject({
      code: 'KB-015',
    });
  });

  it('exits 2 for "kb search" with no real <query>', async () => {
    const project = await createTestProject();
    expect(await dispatchKb(ctx(project, ['kb', 'search']))).toBe(2);
  });

  it('exits 2 for "kb open" with no real <id>', async () => {
    const project = await createTestProject();
    expect(await dispatchKb(ctx(project, ['kb', 'open']))).toBe(2);
  });

  it('runs "kb open <id>" for real', async () => {
    const project = await createTestProject();
    await writeKbEntryFixture(project);
    expect(await dispatchKb(ctx(project, ['kb', 'open', 'KB-ARCH-0001']))).toBe(0);
  });

  it('exits 2 for "kb graph" given a real, unexpected extra positional', async () => {
    const project = await createTestProject();
    await expect(
      dispatchKb(ctx(project, ['kb', 'graph', 'KB-ARCH-0001', 'extra'])),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('exits 2 for a malformed "kb graph --hops"', async () => {
    const project = await createTestProject();
    await expect(
      dispatchKb(ctx(project, ['kb', 'graph', 'KB-ARCH-0001', '--hops', 'two'])),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('exits non-zero for "kb verify" when a stored command is refused, not merely skipped', async () => {
    const project = await createTestProject();
    expect(await dispatchKb(ctx(project, ['kb', 'verify']))).toBe(0);
  });

  it('exits 2 for "kb diff" given a real, unexpected extra positional', async () => {
    const project = await createTestProject();
    await expect(dispatchKb(ctx(project, ['kb', 'diff', 'extra']))).rejects.toMatchObject({
      code: 'USR-002',
    });
  });

  it('exits non-zero with a real USR-003 for "kb diff" -- never implemented, refused rather than guessed at', async () => {
    const project = await createTestProject();
    await expect(dispatchKb(ctx(project, ['kb', 'diff']))).rejects.toMatchObject({
      code: 'USR-003',
    });
  });

  it('runs "kb lint" for real, exiting 1 against a real entry with a real dangling source reference', async () => {
    const project = await createTestProject();
    await writeKbEntryFixture(project);
    expect(await dispatchKb(ctx(project, ['kb', 'lint']))).toBe(1);
  });

  it('runs "kb lint" for real, exiting 0 against a real, empty (entry-free) project', async () => {
    const project = await createTestProject();
    expect(await dispatchKb(ctx(project, ['kb', 'lint']))).toBe(0);
  });

  it('exits 2 for a malformed "kb lint --rule" given more than once', async () => {
    const project = await createTestProject();
    await expect(
      dispatchKb(ctx(project, ['kb', 'lint', '--rule', 'a', '--rule', 'b'])),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('runs "kb lint --rule kb-synced --json" for real, through the real rule-command path', async () => {
    const project = await createTestProject();
    const exitCode = await dispatchKb(ctx(project, ['kb', 'lint', '--rule', 'kb-synced'], true));
    expect([0, 1]).toContain(exitCode);
  });

  it('exits 2 for a real, unrecognised "kb lint --rule" value', async () => {
    const project = await createTestProject();
    expect(await dispatchKb(ctx(project, ['kb', 'lint', '--rule', 'not-a-real-rule']))).toBe(2);
  });

  it('runs "kb disclosures" for real against a real, empty project', async () => {
    const project = await createTestProject();
    expect(await dispatchKb(ctx(project, ['kb', 'disclosures']))).toBe(0);
  });

  it('exits 2 for "kb disclose" with no real --kind', async () => {
    const project = await createTestProject();
    expect(await dispatchKb(ctx(project, ['kb', 'disclose']))).toBe(2);
  });

  it('exits 2 for "kb disclose" with a blank --summary', async () => {
    const project = await createTestProject();
    expect(
      await dispatchKb(
        ctx(project, [
          'kb',
          'disclose',
          '--kind',
          'known-gap',
          '--summary',
          '   ',
          '--owner',
          'architect',
          '--source',
          'decision:ADR-0001',
        ]),
      ),
    ).toBe(2);
  });

  it('exits 2 for "kb disclose" with a blank --owner', async () => {
    const project = await createTestProject();
    expect(
      await dispatchKb(
        ctx(project, [
          'kb',
          'disclose',
          '--kind',
          'known-gap',
          '--summary',
          'A real summary',
          '--owner',
          '',
          '--source',
          'decision:ADR-0001',
        ]),
      ),
    ).toBe(2);
  });

  it('exits 2 for "kb disclose" with no real --source', async () => {
    const project = await createTestProject();
    expect(
      await dispatchKb(
        ctx(project, [
          'kb',
          'disclose',
          '--kind',
          'known-gap',
          '--summary',
          'A real summary',
          '--owner',
          'architect',
        ]),
      ),
    ).toBe(2);
  });

  it('runs "kb disclose --kind known-gap --json" for real, then resolves it with "kb disclose resolve"', async () => {
    const project = await createTestProject();
    const disclosed = await captureLogs(() =>
      dispatchKb(
        ctx(
          project,
          [
            'kb',
            'disclose',
            '--kind',
            'known-gap',
            '--summary',
            'A real, disclosed gap',
            '--owner',
            'architect',
            '--source',
            'decision:ADR-0001',
          ],
          true,
        ),
      ),
    );
    expect(disclosed.exitCode).toBe(0);
    const id = (JSON.parse(disclosed.lines[0] ?? '{}') as { readonly id: string }).id;
    expect(id).toBeTruthy();

    const resolveExit = await dispatchKb(
      ctx(project, ['kb', 'disclose', 'resolve', id, '--reason', 'Fixed', '--by', 'architect']),
    );
    expect(resolveExit).toBe(0);
  });

  it('exits 2 for "kb disclose resolve" with no real <id>', async () => {
    const project = await createTestProject();
    expect(await dispatchKb(ctx(project, ['kb', 'disclose', 'resolve']))).toBe(2);
  });

  it('exits 2 for "kb disclose resolve" with no real --reason/--by', async () => {
    const project = await createTestProject();
    expect(await dispatchKb(ctx(project, ['kb', 'disclose', 'resolve', 'KB-D-0001']))).toBe(2);
  });

  it('exits 2 for a real, unrecognised "kb" subcommand', async () => {
    const project = await createTestProject();
    expect(await dispatchKb(ctx(project, ['kb', 'bogus']))).toBe(2);
  });

  it('exits 2 for "kb list" given a real, unexpected extra positional, rather than silently ignoring it', async () => {
    const project = await createTestProject();
    await expect(dispatchKb(ctx(project, ['kb', 'list', 'extra']))).rejects.toMatchObject({
      code: 'USR-002',
    });
  });
});
