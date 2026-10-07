/**
 * `forge test binding --hunks --base <ref>` — the real, spawned-subprocess CLI wiring for the new
 * `--base`/`--hunks` flags (`specs/22` M16 P11), the `bin-binding.test.ts` style `PLAN-M15.md` P4's
 * own "Tests first" line already established for this command: a real `forge` process against a
 * real, throwaway git project, never a direct function call. `resolveHunkModeBase` itself is unit-
 * tested directly in `hunks.test.ts`; this file exists to prove the CLI dispatch in `bin.ts` actually
 * calls it, with the real flags, before any other binding-command work happens.
 *
 * @see specs/13 F-TEST-10
 * @see specs/22 M16 P11
 * @see process/SPEC-QUESTIONS.md Q294 Decision 8
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

const LAUNCHER = fileURLToPath(new URL('../../../../bin/forge.mjs', import.meta.url));

function run(
  args: readonly string[],
  cwd: string,
): { readonly status: number; readonly stdout: string; readonly stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [LAUNCHER, ...args, '-C', cwd], {
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const execError = error as {
      readonly status: number | null;
      readonly stdout: string;
      readonly stderr: string;
    };
    return { status: execError.status ?? 1, stdout: execError.stdout, stderr: execError.stderr };
  }
}

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A bare real git repository — enough for `resolveHunkModeBase` to run against (it is called BEFORE
 * `runTestBindingCommand`'s own config loading or `assertCleanWorkingTree`), never wired up as a full
 * FORGE project: none of these three refusals needs a story, a test command, or `.forge/config.yaml`
 * at all, which is itself part of what each test below proves (the refusal fires before any of that
 * is ever read). */
async function freshGitRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-bin-hunks-'));
  dirs.push(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

describe('forge test binding --hunks/--base — CLI dispatch (specs/22 M16 P11)', () => {
  it('refuses --hunks without --base: exit 2, USR-005, before any config or story is read', async () => {
    const dir = await freshGitRepo();
    const result = run(['test', 'binding', '--story', 'STORY-DOES-NOT-EXIST', '--hunks'], dir);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--hunks');
    expect(result.stderr).toContain('--base');
    // Never reaches story resolution (which would fail with a DIFFERENT message naming the story).
    expect(result.stderr).not.toContain('STORY-DOES-NOT-EXIST');
  });

  it('refuses --base without --hunks: exit 2, USR-005', async () => {
    const dir = await freshGitRepo();
    const result = run(['test', 'binding', '--base', 'HEAD'], dir);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--base');
    expect(result.stderr).toContain('--hunks');
  });

  it('refuses an unresolvable --base given with --hunks: exit 2, USR-005, naming the real ref it could not resolve', async () => {
    const dir = await freshGitRepo();
    // `--story` given (`specs/22` M16 P12's own "hunks-without-story" precondition is checked FIRST,
    // at the dispatch boundary, before `--base` is ever resolved — the identical ordering
    // `freshGitRepo`'s own doc comment already states for this file as a whole: "before any config or
    // story is read") so this test still isolates `--base`'s OWN resolution failure, exactly as it did
    // before that precondition existed; the story need not resolve to a real one, since story
    // resolution itself happens later, inside `runSingleStoryBindingCommand`, never reached here.
    const result = run(
      [
        'test',
        'binding',
        '--story',
        'STORY-DOES-NOT-EXIST',
        '--hunks',
        '--base',
        'this-ref-does-not-exist-anywhere',
      ],
      dir,
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('this-ref-does-not-exist-anywhere');
  });

  it('--json still prints the one-line {v:1, ok:false, error} refusal envelope for a usage error raised before any command runs', async () => {
    const dir = await freshGitRepo();
    const result = run(['test', 'binding', '--hunks', '--json'], dir);

    expect(result.status).toBe(2);
    const lines = result.stdout
      .trimEnd()
      .split('\n')
      .filter((line) => line.length > 0);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? '') as {
      readonly v: number;
      readonly ok: boolean;
      readonly error?: { readonly code?: string };
    };
    expect(parsed.v).toBe(1);
    expect(parsed.ok).toBe(false);
    expect(parsed.error?.code).toBe('USR-005');
  });

  it('accepts --base HEAD together with --hunks as far as flag validation goes (a real, resolvable ref) — a later, genuine refusal is a DIFFERENT one than USR-005', async () => {
    const dir = await freshGitRepo();
    // `--story` given (`specs/22` M16 P12's own "hunks-without-story" precondition, checked first, at
    // the dispatch boundary) so this run reaches `resolveHunkModeBase` at all; the story need not
    // resolve to a real one, since story resolution happens later, well after the ecosystem/config
    // checks this test is actually about. No `.forge/config.yaml` exists -- `resolveHunkModeBase`
    // resolves `--base` successfully (proving the wiring reached it and it did its job), and the run
    // fails LATER, for an unrelated, already-shipped reason (`RUN-111`'s own "no real test
    // ecosystem"), never USR-005, proving `--base`/`--hunks` themselves were never the problem here.
    const result = run(
      ['test', 'binding', '--story', 'STORY-DOES-NOT-EXIST', '--hunks', '--base', 'HEAD', '--json'],
      dir,
    );

    expect(result.status).not.toBe(0);
    const lines = result.stdout
      .trimEnd()
      .split('\n')
      .filter((line) => line.length > 0);
    const parsed = JSON.parse(lines[0] ?? '{}') as { readonly error?: { readonly code?: string } };
    expect(parsed.error?.code).not.toBe('USR-005');
  });
});
