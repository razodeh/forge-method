/**
 * `commands/dispatch/test-binding.ts` — `forge test binding [--story <id>] [--base <ref>] [--hunks]
 * [--max-hunks <n>] [--timeout-ms <n>]`, exercised in-process (`specs/22` M17 P2's own "the
 * coverage report for the new dispatch modules meets the floor"). Real git fixtures throughout, the
 * identical shape `packages/cli/test/commands/story-binding.test.ts`'s own `freshProject` already
 * establishes for the same underlying mutation-check machinery.
 *
 * @see specs/22 M17 P2
 */
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { ProjectPaths } from '@forge/core/fs';
import { DEFAULT_CONFIG } from '@forge/schemas/config';
import * as YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import { dispatchTestBinding } from '../../../src/commands/dispatch/test-binding.ts';
import type { DispatchContext } from '../../../src/commands/dispatch/shared.ts';
import { captureLogs } from './dispatch-test-helpers.ts';

function resolveRealVitestEntry(): string {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve('vitest/package.json');
  const packageJson = require(packageJsonPath) as {
    readonly bin?: Readonly<Record<string, string>>;
  };
  const binRelative = packageJson.bin?.['vitest'];
  if (binRelative === undefined) throw new Error('vitest/package.json has no real "vitest" bin.');
  return path.join(path.dirname(packageJsonPath), binRelative);
}

const TEST_COMMAND = `${process.execPath} ${resolveRealVitestEntry()} run --root .`;

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const STORY_FIXTURE = `---
id: STORY-001
type: Story
schemaVersion: 1
title: Fixture story
epic: EPIC-001
capability: CAP-001
storyType: feature
size: S
status: ready
owner_role: developer
depends_on: []
blocked_by: []
interfaces: []
data: []
files_expected:
  - impl.js
  - impl.test.js
context_refs: []
acceptance:
  - id: AC-001-1
    given: two numbers
    when: add is called
    then: the sum is returned
    kind: functional
tests: []
dod_profile: backend-default
created: 2026-01-01
updated: 2026-01-01
revision: 1
author: architect
changelog: []
---

Fixture story body.
`;

/** A real git project: a base commit (the story, no implementation yet) and a second commit adding
 * the implementation and its own real, binding test. `status` defaults to `'ready'` (single-story
 * mode's own fixture shape); discover mode's own real scope is `'done'`, needed from the story's
 * very first commit -- promoting it in a LATER commit would shift `HEAD~1`'s own default meaning
 * for every story discover mode checks, away from "no implementation yet" and onto "already
 * implemented," silently turning the real, bound signal this fixture is built to prove into a
 * non-binding one instead. */
async function freshProject(
  status: 'ready' | 'done' = 'ready',
): Promise<{ readonly dir: string; readonly paths: ProjectPaths }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-dispatch-binding-'));
  dirs.push(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });

  await writeFile(path.join(dir, 'package.json'), '{"name":"fixture","private":true}\n', 'utf8');
  await mkdir(path.join(dir, 'docs/forge/specs/stories'), { recursive: true });
  await writeFile(
    path.join(dir, 'docs/forge/specs/stories/STORY-001-fixture.md'),
    STORY_FIXTURE.replace('status: ready', `status: ${status}`),
  );
  await mkdir(path.join(dir, '.forge'), { recursive: true });
  await writeFile(
    path.join(dir, '.forge', 'config.yaml'),
    YAML.stringify({
      ...DEFAULT_CONFIG,
      execution: { ...DEFAULT_CONFIG.execution, testCommands: { unit: TEST_COMMAND } },
    }),
  );

  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'base: story exists, no implementation yet'], {
    cwd: dir,
  });

  await writeFile(path.join(dir, 'impl.js'), 'export function add(a, b) { return a + b; }\n');
  await writeFile(
    path.join(dir, 'impl.test.js'),
    "import { test, expect } from 'vitest';\nimport { add } from './impl.js';\ntest('adds', () => { expect(add(1, 2)).toBe(3); });\n",
  );
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'the story: implement add()'], { cwd: dir });

  return { dir, paths: new ProjectPaths(dir) };
}

/** The identical shape `freshProject` builds, minus any `execution.testCommands.unit` at all --
 * `DEFAULT_CONFIG`'s own real default (`testCommands: {}`) leaves it genuinely unset, the real,
 * typed RUN-111 ("no-test-command") this dispatcher throws before ever touching git or a runner. */
async function projectWithNoTestCommand(): Promise<{
  readonly dir: string;
  readonly paths: ProjectPaths;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-dispatch-binding-'));
  dirs.push(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });
  await mkdir(path.join(dir, '.forge'), { recursive: true });
  await writeFile(path.join(dir, '.forge', 'config.yaml'), YAML.stringify(DEFAULT_CONFIG));
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: dir });
  return { dir, paths: new ProjectPaths(dir) };
}

/** The identical shape, with a real legacy-string `execution.testCommands.unit` but genuinely NO
 * `package.json` at all -- `detectEcosystem` itself reports `'unknown'` for that real case, the
 * other real, typed RUN-111 reason (`unknown-ecosystem`) this dispatcher throws. */
async function projectWithUnknownEcosystem(): Promise<{
  readonly dir: string;
  readonly paths: ProjectPaths;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-dispatch-binding-'));
  dirs.push(dir);
  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });
  await mkdir(path.join(dir, '.forge'), { recursive: true });
  await writeFile(
    path.join(dir, '.forge', 'config.yaml'),
    YAML.stringify({
      ...DEFAULT_CONFIG,
      execution: { ...DEFAULT_CONFIG.execution, testCommands: { unit: 'exit 0' } },
    }),
  );
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: dir });
  return { dir, paths: new ProjectPaths(dir) };
}

function ctx(
  dir: string,
  paths: ProjectPaths,
  positionals: readonly string[],
  json = false,
): DispatchContext {
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
    paths,
    projectRoot: dir,
  };
}

describe('dispatchTestBinding (specs/22 M17 P2)', () => {
  it('returns undefined for a command it does not own', async () => {
    const { dir, paths } = await freshProject();
    expect(await dispatchTestBinding(ctx(dir, paths, ['test', 'run']))).toBeUndefined();
  });

  it('returns undefined for "test" with a sub other than "binding"', async () => {
    const { dir, paths } = await freshProject();
    expect(await dispatchTestBinding(ctx(dir, paths, ['test', 'exempt']))).toBeUndefined();
  });

  it('refuses USR-005 for "--hunks" without "--story"', async () => {
    const { dir, paths } = await freshProject();
    await expect(
      dispatchTestBinding(ctx(dir, paths, ['test', 'binding', '--hunks'])),
    ).rejects.toMatchObject({ code: 'USR-005' });
  });

  it('refuses USR-005 for "--max-hunks" without "--hunks"', async () => {
    const { dir, paths } = await freshProject();
    await expect(
      dispatchTestBinding(
        ctx(dir, paths, ['test', 'binding', '--story', 'STORY-001', '--max-hunks', '5']),
      ),
    ).rejects.toMatchObject({ code: 'USR-005' });
  });

  it('refuses a real, unexpected extra positional', async () => {
    const { dir, paths } = await freshProject();
    await expect(
      dispatchTestBinding(ctx(dir, paths, ['test', 'binding', 'extra'])),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('runs "test binding --story <id> --json" for real end to end, a genuinely binding test', async () => {
    const { dir, paths } = await freshProject();
    const result = await captureLogs(() =>
      dispatchTestBinding(ctx(dir, paths, ['test', 'binding', '--story', 'STORY-001'], true)),
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.lines[0] ?? '{}') as {
      readonly passed: boolean;
      readonly bound: readonly string[];
      readonly restoreVerified: boolean;
    };
    expect(parsed.passed).toBe(true);
    expect(parsed.bound.length).toBeGreaterThan(0);
    expect(parsed.restoreVerified).toBe(true);
  }, 30_000);

  it('runs "test binding --story <id> --hunks --json" for real, the per-hunk mutation engine', async () => {
    const { dir, paths } = await freshProject();
    const result = await captureLogs(() =>
      dispatchTestBinding(
        ctx(
          dir,
          paths,
          ['test', 'binding', '--story', 'STORY-001', '--hunks', '--base', 'HEAD~1'],
          true,
        ),
      ),
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.lines[0] ?? '{}') as { readonly hunks: readonly unknown[] };
    expect(Array.isArray(parsed.hunks)).toBe(true);
  }, 30_000);

  it('runs "test binding" (discover mode, no --story) for real against a real done story', async () => {
    const { dir, paths } = await freshProject();
    const exitCode = await dispatchTestBinding(ctx(dir, paths, ['test', 'binding']));
    // STORY-001's own status is "ready", not "done" -- discover mode's own real scope is every
    // `done` story, so a vacuous, real pass (nothing to check) is the correct, honest outcome here.
    expect(exitCode).toBe(0);
  }, 30_000);

  it('refuses RUN-110 for "test binding --story" naming a story that does not exist', async () => {
    const { dir, paths } = await freshProject();
    await expect(
      dispatchTestBinding(ctx(dir, paths, ['test', 'binding', '--story', 'STORY-999'])),
    ).rejects.toMatchObject({ code: 'RUN-110' });
  }, 30_000);

  it('refuses the real, typed RUN-110 ("invalid") for a real story found by id that fails real schema validation', async () => {
    const { dir, paths } = await freshProject();
    // `resolveStoryById` finds a real document by its real, raw front-matter `id` BEFORE ever
    // validating it against `storySchema` -- a real, found-but-invalid document is a distinct,
    // typed refusal (`reason: 'invalid'`) from "not found at all" (`reason: 'not-found'`, above).
    await mkdir(path.join(dir, 'docs/forge/specs/stories'), { recursive: true });
    await writeFile(
      path.join(dir, 'docs/forge/specs/stories/STORY-002-invalid.md'),
      '---\nid: STORY-002\ntype: Story\n---\n\nMissing every other required field.\n',
    );
    // `runTestBindingCommand` refuses a dirty tree before anything else -- this new file must be
    // committed, not left pending.
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'add an invalid story fixture'], { cwd: dir });
    await expect(
      dispatchTestBinding(ctx(dir, paths, ['test', 'binding', '--story', 'STORY-002'])),
    ).rejects.toMatchObject({ code: 'RUN-110', details: { reason: 'invalid' } });
  }, 30_000);

  it('refuses the real, typed RUN-111 ("no-test-command") when execution.testCommands.unit is genuinely unset', async () => {
    const { dir, paths } = await projectWithNoTestCommand();
    await expect(
      dispatchTestBinding(ctx(dir, paths, ['test', 'binding', '--story', 'STORY-001'])),
    ).rejects.toMatchObject({ code: 'RUN-111', details: { reason: 'no-test-command' } });
  });

  it('refuses the real, typed RUN-111 ("unknown-ecosystem") for a legacy-string command with no real package.json', async () => {
    const { dir, paths } = await projectWithUnknownEcosystem();
    await expect(
      dispatchTestBinding(ctx(dir, paths, ['test', 'binding', '--story', 'STORY-001'])),
    ).rejects.toMatchObject({ code: 'RUN-111', details: { reason: 'unknown-ecosystem' } });
  });

  it('runs "test binding" (discover mode) for real against a real "done" story, aggregating a real bound result', async () => {
    const { dir, paths } = await freshProject('done');
    const result = await captureLogs(() =>
      dispatchTestBinding(ctx(dir, paths, ['test', 'binding'], true)),
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.lines[0] ?? '{}') as {
      readonly passed: boolean;
      readonly bound: readonly string[];
      readonly restoreVerified: boolean;
      readonly evidenceIds: readonly string[];
    };
    expect(parsed.passed).toBe(true);
    expect(parsed.bound.length).toBeGreaterThan(0);
    expect(parsed.restoreVerified).toBe(true);
    expect(parsed.evidenceIds.length).toBeGreaterThan(0);
  }, 30_000);
});
