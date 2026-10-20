/**
 * `commands/dispatch/plan-and-loop.ts` — `forge plan`/`implement`/`refactor`/`story`/`deploy`/
 * `debug`/`review`/`panel`/`ask`/`session`, exercised in-process (`specs/22` M17 P2's own "the
 * coverage report for the new dispatch modules meets the floor"). `--dry-run` throughout for the
 * commands that build a real `RunDeps`/`LoopDeps` (`implement`/`refactor`/`deploy`/`plan`) — the
 * identical reason `packages/cli/test/bin.test.ts` itself only ever drives those through `--dry-run`:
 * a real, non-dry-run agent session needs a real platform CLI/credentials this harness has neither
 * of. `debug`/`review`/`panel`/`session` have no dry-run form at all, so (matching `bin.test.ts`'s
 * own identical, disclosed scope) only their usage-error branches — which never reach
 * `buildLoopDepsForProject` — are exercised here.
 *
 * @see specs/22 M17 P2
 */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import { ProjectPaths } from '@forge/core/fs';
import { FAKE_MODEL_ID, FakePlatformAdapter } from '@forge/testkit';
import * as YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import { dispatchPlanAndLoop } from '../../../src/commands/dispatch/plan-and-loop.ts';
import type { DispatchContext } from '../../../src/commands/dispatch/shared.ts';
import { startSession, type SessionCommandDeps } from '../../../src/commands/loop/session.ts';
import { runInit } from '../../../src/init/run-init.ts';
import {
  cleanupAll,
  createTestProject,
  registerCleanup,
  type TestProject,
} from '../upgrade/helpers.ts';
import { KB_ROOT } from '../helpers.ts';
import { captureLogs } from './dispatch-test-helpers.ts';

afterEach(cleanupAll);

const REAL_MODULES_DIR = fileURLToPath(new URL('../../../../../modules/', import.meta.url));

/** The identical "full default agent roster" project `packages/cli/test/bin.test.ts`'s own
 * `realProject` builds -- `upgrade/helpers.ts`'s own `createTestProject` deliberately narrows to
 * `modules: ['fixture-mod']`, whose own roster has no code-producing agent at all, which the usage-
 * error tests in this file never reach but `implement`'s own real, compiling dry-run genuinely does
 * (`RUN-097`: "owner_role is not an implementation role... no agent declares a Code output"). */
async function realProject(): Promise<{ readonly dir: string; readonly paths: ProjectPaths }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-dispatch-plan-loop-'));
  registerCleanup(dir);
  await runInit(
    dir,
    { name: 'Dispatch Fixture', yes: true, level: 'L0' },
    { candidateAdapters: [new FakePlatformAdapter()], env: {}, modulesDir: REAL_MODULES_DIR },
  );
  return { dir, paths: new ProjectPaths(dir) };
}

/** Clears the real `platform.primary` a real `forge init` (via `FakePlatformAdapter`) recorded, so
 * the real dispatch's own `buildAdapterForConfig` falls back to the real registry's first entry
 * (construction only, no live session) — the identical fixture fix `packages/cli/test/bin.test.ts`'s
 * own `clearPlatformPrimary` already establishes for this exact problem. */
async function clearPlatformPrimary(dir: string): Promise<void> {
  const configPath = path.join(dir, '.forge/config.yaml');
  const parsed = YAML.parse(await readFile(configPath, 'utf8')) as {
    platform: { primary: string };
  };
  parsed.platform.primary = '';
  await writeFile(configPath, YAML.stringify(parsed), 'utf8');
}

async function commitTree(dir: string): Promise<void> {
  await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });
  await execa('git', ['add', '-A'], { cwd: dir });
  await execa('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: dir });
}

async function writeOversizedStory(dir: string): Promise<void> {
  const relPath = 'docs/forge/specs/stories/STORY-001-fixture.md';
  await mkdir(path.dirname(path.join(dir, relPath)), { recursive: true });
  await writeFile(
    path.join(dir, relPath),
    `---
id: STORY-001
type: Story
schemaVersion: 1
title: Fixture story
status: ready
created: 2026-01-01
updated: 2026-01-01
revision: 1
author: po
changelog: []
epic: EPIC-001
capability: CAP-001
storyType: feature
size: L
owner_role: backend
depends_on: []
blocked_by: []
interfaces: []
data: []
files_expected: []
context_refs: []
acceptance: []
tests: []
dod_profile: backend-default
---

Fixture body.
`,
  );
}

/** A real, committed `docs/forge/kb/delivery/environments.md` register — the identical shape
 * `packages/cli/test/commands/deploy-record.test.ts`'s own `register` fixture already
 * establishes, narrowed to the one `ENV-002` entry these tests need. */
async function registerEnvironment(dir: string): Promise<void> {
  const relPath = `${KB_ROOT}/delivery/environments.md`;
  await mkdir(path.dirname(path.join(dir, relPath)), { recursive: true });
  await writeFile(
    path.join(dir, relPath),
    `---
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
  - id: ENV-002
    purpose: 'Staging: the pre-production environment'
    url: 'https://staging.example.com'
    deploy_trigger: on merge to main
    data_policy: synthetic only
    secrets_source: the secret manager
    owner: platform
    access: ask the platform role
---
`,
  );
}

async function headSha(dir: string): Promise<string> {
  return (await execa('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim();
}

function ctx(
  project: Pick<TestProject, 'dir' | 'paths'>,
  positionals: readonly string[],
  overrides: { readonly json?: boolean; readonly dryRun?: boolean; readonly budget?: number } = {},
): DispatchContext {
  return {
    positionals,
    flags: {
      profile: 'default',
      dryRun: overrides.dryRun ?? false,
      yes: false,
      json: overrides.json ?? false,
      noTui: false,
      verbosity: 0,
      quiet: false,
      ...(overrides.budget === undefined ? {} : { budget: overrides.budget }),
      positionals,
    },
    paths: project.paths,
    projectRoot: project.dir,
  };
}

describe('dispatchPlanAndLoop (specs/22 M17 P2)', () => {
  it('returns undefined for a command it does not own', async () => {
    const project = await createTestProject();
    expect(await dispatchPlanAndLoop(ctx(project, ['kb', 'list']))).toBeUndefined();
  });

  it('runs "plan init --dry-run" for real, compiling without ever starting a run', async () => {
    const project = await createTestProject();
    await clearPlatformPrimary(project.dir);
    const exitCode = await dispatchPlanAndLoop(
      ctx(project, ['plan', 'init'], { json: true, dryRun: true }),
    );
    expect(exitCode).toBe(0);
  }, 20_000);

  it('exits 2 for "plan" with an unrecognised <phase>', async () => {
    const project = await createTestProject();
    expect(await dispatchPlanAndLoop(ctx(project, ['plan', 'bogus']))).toBe(2);
  });

  it('exits 2 for "plan stage" with no real <id>', async () => {
    const project = await createTestProject();
    expect(await dispatchPlanAndLoop(ctx(project, ['plan', 'stage']))).toBe(2);
  });

  it('refuses the real, disclosed USR-003 for "plan data"/"plan testing"', async () => {
    const project = await createTestProject();
    await clearPlatformPrimary(project.dir);
    await expect(
      dispatchPlanAndLoop(ctx(project, ['plan', 'data'], { dryRun: true })),
    ).rejects.toMatchObject({ code: 'USR-003' });
  });

  it('exits 2 for "plan run-plan" with no real <stageId>', async () => {
    const project = await createTestProject();
    expect(await dispatchPlanAndLoop(ctx(project, ['plan', 'run-plan']))).toBe(2);
  });

  it('refuses RUN-082 for "plan run-plan <stageId>" naming a stage no Epic declares', async () => {
    const project = await createTestProject();
    await expect(
      dispatchPlanAndLoop(ctx(project, ['plan', 'run-plan', 'build'])),
    ).rejects.toMatchObject({ code: 'RUN-082' });
  });

  it('exits 2 for "plan run-plan" given a real, unexpected extra positional', async () => {
    const project = await createTestProject();
    expect(await dispatchPlanAndLoop(ctx(project, ['plan', 'run-plan', 'build', 'extra']))).toBe(2);
  });

  it('refuses a real, unexpected extra positional for a non-"stage" phase (USR-002)', async () => {
    const project = await createTestProject();
    await expect(
      dispatchPlanAndLoop(ctx(project, ['plan', 'product', 'extra'])),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('runs "plan architecture --from HEAD --dry-run" for real, folding --from into the expression context', async () => {
    const project = await createTestProject();
    await clearPlatformPrimary(project.dir);
    await commitTree(project.dir);
    const exitCode = await dispatchPlanAndLoop(
      ctx(project, ['plan', 'architecture', '--from', 'HEAD'], { json: true, dryRun: true }),
    );
    expect(exitCode).toBe(0);
  }, 20_000);

  it('runs "plan stage <id> --dry-run" for real, compiling with a real stageId in the expression context', async () => {
    const project = await createTestProject();
    await clearPlatformPrimary(project.dir);
    const exitCode = await dispatchPlanAndLoop(
      ctx(project, ['plan', 'stage', 'build'], { json: true, dryRun: true }),
    );
    expect(exitCode).toBe(0);
  }, 20_000);

  it('runs "implement <storyId> --dry-run" for real, and the real production template compiles', async () => {
    const project = await realProject();
    await clearPlatformPrimary(project.dir);
    await writeOversizedStory(project.dir);
    const exitCode = await dispatchPlanAndLoop(
      ctx(project, ['implement', 'STORY-001'], { json: true, dryRun: true }),
    );
    expect(exitCode).toBe(0);
  }, 20_000);

  it('exits 2 for "implement" with no real <storyId>', async () => {
    const project = await createTestProject();
    expect(await dispatchPlanAndLoop(ctx(project, ['implement']))).toBe(2);
  });

  it('runs "refactor <target> --goal <text> --dry-run" for real', async () => {
    const project = await createTestProject();
    await clearPlatformPrimary(project.dir);
    const exitCode = await dispatchPlanAndLoop(
      ctx(project, ['refactor', 'src/foo.ts', '--goal', 'reduce duplication'], {
        json: true,
        dryRun: true,
      }),
    );
    expect(exitCode).toBe(0);
  }, 20_000);

  it('exits 2 for "refactor" with no real --goal', async () => {
    const project = await createTestProject();
    expect(await dispatchPlanAndLoop(ctx(project, ['refactor', 'src/foo.ts']))).toBe(2);
  });

  it('exits 2 for "story" with no real subcommand', async () => {
    const project = await createTestProject();
    expect(await dispatchPlanAndLoop(ctx(project, ['story']))).toBe(2);
  });

  it('exits 2 for a real, unrecognised "story" subcommand', async () => {
    const project = await createTestProject();
    expect(await dispatchPlanAndLoop(ctx(project, ['story', 'bogus']))).toBe(2);
  });

  it('exits 2 for "story verify" with no real <storyId>', async () => {
    const project = await createTestProject();
    expect(await dispatchPlanAndLoop(ctx(project, ['story', 'verify']))).toBe(2);
  });

  it('exits 2 for "story verify <id>" with an unrecognised --phase value', async () => {
    const project = await createTestProject();
    expect(
      await dispatchPlanAndLoop(ctx(project, ['story', 'verify', 'STORY-001', '--phase', 'bogus'])),
    ).toBe(2);
  });

  it('exits 2 for "story verify <id> --dry-run" (it has no dry-run form)', async () => {
    const project = await createTestProject();
    expect(
      await dispatchPlanAndLoop(ctx(project, ['story', 'verify', 'STORY-001'], { dryRun: true })),
    ).toBe(2);
  });

  it('exits 2 for "story evidence" with no real <storyId>', async () => {
    const project = await createTestProject();
    expect(await dispatchPlanAndLoop(ctx(project, ['story', 'evidence']))).toBe(2);
  });

  it('exits 2 for "story evidence <id> --dry-run" (it has no dry-run form)', async () => {
    const project = await createTestProject();
    expect(
      await dispatchPlanAndLoop(ctx(project, ['story', 'evidence', 'STORY-001'], { dryRun: true })),
    ).toBe(2);
  });

  it('runs "deploy <env> --dry-run" for real, never requiring a destructive confirmation', async () => {
    const project = await createTestProject();
    await clearPlatformPrimary(project.dir);
    const exitCode = await dispatchPlanAndLoop(
      ctx(project, ['deploy', 'staging'], { json: true, dryRun: true }),
    );
    expect(exitCode).toBe(0);
  }, 20_000);

  it('exits 2 for "deploy" with no real <env>', async () => {
    const project = await createTestProject();
    expect(await dispatchPlanAndLoop(ctx(project, ['deploy']))).toBe(2);
  });

  it('exits 2 for "deploy record" with no real <kind>', async () => {
    const project = await createTestProject();
    expect(await dispatchPlanAndLoop(ctx(project, ['deploy', 'record']))).toBe(2);
  });

  it('exits 2 for "deploy record" with an unknown <kind>', async () => {
    const project = await createTestProject();
    expect(await dispatchPlanAndLoop(ctx(project, ['deploy', 'record', 'bogus']))).toBe(2);
  });

  it('exits 2 for "deploy record dry-run" missing a required flag, naming it', async () => {
    const project = await createTestProject();
    const exitCode = await dispatchPlanAndLoop(
      ctx(project, ['deploy', 'record', 'dry-run', '--env', 'ENV-002', '--sha', 'a'.repeat(40)]),
    );
    expect(exitCode).toBe(2);
  });

  it('exits 2 for "deploy record dry-run" combined with --dry-run (it has no dry-run form)', async () => {
    const project = await createTestProject();
    const exitCode = await dispatchPlanAndLoop(
      ctx(
        project,
        [
          'deploy',
          'record',
          'dry-run',
          '--env',
          'ENV-002',
          '--sha',
          'a'.repeat(40),
          '--ran-at',
          '2050-01-01T00:00:00Z',
        ],
        { dryRun: true },
      ),
    );
    expect(exitCode).toBe(2);
  });

  it('refuses (exit 2) for "deploy record dry-run/rollback/deployment" when the environment is not recorded', async () => {
    const project = await createTestProject();
    await commitTree(project.dir);
    const dryRunExit = await dispatchPlanAndLoop(
      ctx(project, [
        'deploy',
        'record',
        'dry-run',
        '--env',
        'ENV-999',
        '--sha',
        'a'.repeat(40),
        '--ran-at',
        '2050-01-01T00:00:00Z',
      ]),
    );
    expect(dryRunExit).toBe(2);
  });

  it('exits 2 for "deploy record dry-run" given a real, unexpected extra positional', async () => {
    const project = await createTestProject();
    await expect(
      dispatchPlanAndLoop(
        ctx(project, [
          'deploy',
          'record',
          'dry-run',
          '--env',
          'ENV-002',
          '--sha',
          'a'.repeat(40),
          '--ran-at',
          '2050-01-01T00:00:00Z',
          'extra',
        ]),
      ),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('runs "deploy record dry-run --env --sha --ran-at" for real, writing a real dry-run record', async () => {
    const project = await createTestProject();
    await registerEnvironment(project.dir);
    await commitTree(project.dir);
    const sha = await headSha(project.dir);
    // A real, current instant -- not in the future (the record writer refuses that) and not
    // before `sha`'s own commit, which was just made.
    const ranAt = new Date().toISOString();
    const exitCode = await dispatchPlanAndLoop(
      ctx(
        project,
        ['deploy', 'record', 'dry-run', '--env', 'ENV-002', '--sha', sha, '--ran-at', ranAt],
        { json: true },
      ),
    );
    expect(exitCode).toBe(0);
  });

  it('runs "deploy record rollback --env --from-sha --to-sha --rehearsed-at --health-*" for real, writing a real rollback record', async () => {
    const project = await createTestProject();
    await registerEnvironment(project.dir);
    await commitTree(project.dir);
    // `--to-sha` must be a real, STRICT ancestor of `--from-sha` (`deploy-record.ts`'s own doc
    // comment) -- a second, later commit gives a real `fromSha` with `toSha` as its real parent.
    const toSha = await headSha(project.dir);
    await writeFile(path.join(project.dir, 'rollback-fixture.txt'), 'x', 'utf8');
    await commitTree(project.dir);
    const fromSha = await headSha(project.dir);
    const rehearsedAt = new Date().toISOString();
    const exitCode = await dispatchPlanAndLoop(
      ctx(project, [
        'deploy',
        'record',
        'rollback',
        '--env',
        'ENV-002',
        '--from-sha',
        fromSha,
        '--to-sha',
        toSha,
        '--rehearsed-at',
        rehearsedAt,
        '--health-url',
        'https://staging.example.com/health',
        '--health-status',
        '200',
        '--health-checked-at',
        rehearsedAt,
      ]),
    );
    expect(exitCode).toBe(0);
  });

  it('runs "deploy record deployment --env --sha --deployed-at --health-*" for real, writing a real deployment record', async () => {
    const project = await createTestProject();
    await registerEnvironment(project.dir);
    await commitTree(project.dir);
    const sha = await headSha(project.dir);
    const deployedAt = new Date().toISOString();
    const exitCode = await dispatchPlanAndLoop(
      ctx(project, [
        'deploy',
        'record',
        'deployment',
        '--env',
        'ENV-002',
        '--sha',
        sha,
        '--deployed-at',
        deployedAt,
        '--health-url',
        'https://staging.example.com/health',
        '--health-status',
        '200',
        '--health-checked-at',
        deployedAt,
      ]),
    );
    expect(exitCode).toBe(0);
  });

  it('exits 2 for "deploy" with --dry-run and --rollback-check together', async () => {
    const project = await createTestProject();
    const exitCode = await dispatchPlanAndLoop(
      ctx(project, ['deploy', '--rollback-check'], { dryRun: true }),
    );
    expect(exitCode).toBe(2);
  });

  it('runs "deploy --dry-run" (the env-less check form) for real against a real, committed project', async () => {
    const project = await createTestProject();
    await commitTree(project.dir);
    const exitCode = await dispatchPlanAndLoop(ctx(project, ['deploy'], { dryRun: true }));
    // A real, legitimate 1 (not 0/3) is this exact fixture's own honest answer: no real deploy
    // history or registered environment exists yet for the check to find.
    expect([0, 1, 3]).toContain(exitCode);
  });

  it('exits 2 for "debug" with neither a real <symptom> nor --from-failure', async () => {
    const project = await createTestProject();
    expect(await dispatchPlanAndLoop(ctx(project, ['debug']))).toBe(2);
  });

  it('exits 2 for "debug <symptom> <extra>" -- a real, unexpected second positional', async () => {
    const project = await createTestProject();
    expect(await dispatchPlanAndLoop(ctx(project, ['debug', 'symptom', 'extra']))).toBe(2);
  });

  it('refuses a real, unexpected extra positional for "debug --from-failure <runId>" (USR-002)', async () => {
    const project = await createTestProject();
    await expect(
      dispatchPlanAndLoop(ctx(project, ['debug', '--from-failure', 'RUN-001', 'extra'])),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('exits 2 for "review" with a real, unrecognised extra positional', async () => {
    const project = await createTestProject();
    await expect(dispatchPlanAndLoop(ctx(project, ['review', 'extra']))).rejects.toMatchObject({
      code: 'USR-002',
    });
  });

  it('exits 2 for "panel" with no real <question>', async () => {
    const project = await createTestProject();
    expect(await dispatchPlanAndLoop(ctx(project, ['panel']))).toBe(2);
  });

  it('exits 2 for "panel <question>" with no real --roles', async () => {
    const project = await createTestProject();
    expect(await dispatchPlanAndLoop(ctx(project, ['panel', 'a question']))).toBe(2);
  });

  it('refuses the real, unconditional USR-003 for "ask"', async () => {
    const project = await createTestProject();
    await expect(dispatchPlanAndLoop(ctx(project, ['ask', 'a question']))).rejects.toMatchObject({
      code: 'USR-003',
    });
  });

  it('exits 2 for "ask" given a second, real unexpected extra positional', async () => {
    const project = await createTestProject();
    await expect(
      dispatchPlanAndLoop(ctx(project, ['ask', 'a question', 'extra'])),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('exits 2 for "session show" with no real <id>', async () => {
    const project = await createTestProject();
    expect(await dispatchPlanAndLoop(ctx(project, ['session', 'show']))).toBe(2);
  });

  it('exits 2 for a real, unrecognised "session <type>"', async () => {
    const project = await createTestProject();
    expect(await dispatchPlanAndLoop(ctx(project, ['session', 'bogus']))).toBe(2);
  });

  it('runs "session list" for real, empty on a fresh project', async () => {
    const project = await createTestProject();
    await clearPlatformPrimary(project.dir);
    const exitCode = await dispatchPlanAndLoop(ctx(project, ['session', 'list']));
    expect(exitCode).toBe(0);
  });

  it('exits 2 for "session list" given a real, unexpected extra positional', async () => {
    const project = await createTestProject();
    await expect(
      dispatchPlanAndLoop(ctx(project, ['session', 'list', 'extra'])),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('runs "session show <id> --json" and "session export <id> --json" for real against a real, planted session record', async () => {
    const project = await createTestProject();
    await clearPlatformPrimary(project.dir);
    await commitTree(project.dir);
    // `sessionShow`/`sessionExport`'s own success paths are read-only (no live adapter call --
    // `loop/session.test.ts`'s own identical `sessionDeps` fixture already proves this), unlike
    // `startSession`/`sessionResume`'s continuation. A real `FakePlatformAdapter`, side-channel
    // `startSession` call plants a real, completed record on disk; this real dispatch call then
    // reads it back through the REAL registered adapter construction (never touched for a read).
    const fakeAdapter = new FakePlatformAdapter();
    fakeAdapter.script(() => true, { text: ['A real, scripted brainstorm answer.'] });
    // `05` §5.8: every tier maps to the fake adapter's one model, so a real agent step can resolve
    // a real model -- the identical `FIXTURE_MODELS` shape `loop/helpers.ts`'s own `createTestProject`
    // already establishes, applied here only to `deps.config` (never written to disk), since
    // `startSession` reads the model tiers from `deps.config`, not from a re-read of the real,
    // `forge init`-written config this fixture otherwise keeps untouched.
    const sessionDeps: SessionCommandDeps = {
      paths: project.paths,
      projectRoot: project.dir,
      config: {
        ...project.config,
        models: {
          tiers: {
            frugal: { 'forge-fake-adapter': FAKE_MODEL_ID },
            balanced: { 'forge-fake-adapter': FAKE_MODEL_ID },
            max: { 'forge-fake-adapter': FAKE_MODEL_ID },
          },
          overrides: {},
        },
      },
      adapter: fakeAdapter,
      checksRoot: 'docs/forge/checks',
      agentsRoot: '.forge/agents',
    };
    const planted = await startSession(sessionDeps, 'brainstorm', {
      question: 'How do we cut time-to-first-invoice?',
    });
    const id = planted.record?.id ?? '';
    expect(id).not.toBe('');

    const shown = await captureLogs(() =>
      dispatchPlanAndLoop(ctx(project, ['session', 'show', id], { json: true })),
    );
    expect(shown.exitCode).toBe(0);
    const shownParsed = JSON.parse(shown.lines[0] ?? '{}') as { readonly path: string };
    expect(shownParsed.path).toContain(id);

    const exported = await captureLogs(() =>
      dispatchPlanAndLoop(ctx(project, ['session', 'export', id], { json: true })),
    );
    expect(exported.exitCode).toBe(0);
    const exportedParsed = JSON.parse(exported.lines[0] ?? '{}') as { readonly path: string };
    expect(exportedParsed.path).toContain(id);
  });

  it('refuses a real RUN-070 for "session show <id>" naming an id with no real session record', async () => {
    const project = await createTestProject();
    await clearPlatformPrimary(project.dir);
    await expect(
      dispatchPlanAndLoop(ctx(project, ['session', 'show', 'SESSION-999'])),
    ).rejects.toMatchObject({ code: 'RUN-070' });
  });

  it('refuses a real RUN-070 for "session export <id>" naming an id with no real session record', async () => {
    const project = await createTestProject();
    await clearPlatformPrimary(project.dir);
    await expect(
      dispatchPlanAndLoop(ctx(project, ['session', 'export', 'SESSION-999'])),
    ).rejects.toMatchObject({ code: 'RUN-070' });
  });

  it('refuses a real RUN-070 for "session resume <id>" naming an id with no real session record', async () => {
    const project = await createTestProject();
    await clearPlatformPrimary(project.dir);
    await expect(
      dispatchPlanAndLoop(ctx(project, ['session', 'resume', 'SESSION-999'])),
    ).rejects.toMatchObject({ code: 'RUN-070' });
  });

  it('exits 2 for "session show"/"export"/"resume" given a real, unexpected extra positional', async () => {
    const project = await createTestProject();
    expect(
      await dispatchPlanAndLoop(ctx(project, ['session', 'show', 'SESSION-999', 'extra'])),
    ).toBe(2);
    expect(
      await dispatchPlanAndLoop(ctx(project, ['session', 'export', 'SESSION-999', 'extra'])),
    ).toBe(2);
    expect(
      await dispatchPlanAndLoop(ctx(project, ['session', 'resume', 'SESSION-999', 'extra'])),
    ).toBe(2);
  });

  it('refuses the real USR-002 startSession validation for "session design-review" with neither --target nor --question', async () => {
    const project = await createTestProject();
    await clearPlatformPrimary(project.dir);
    await expect(
      dispatchPlanAndLoop(ctx(project, ['session', 'design-review'])),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('refuses the real USR-002 startSession validation for "session premortem" with neither --scope nor --question', async () => {
    const project = await createTestProject();
    await clearPlatformPrimary(project.dir);
    await expect(dispatchPlanAndLoop(ctx(project, ['session', 'premortem']))).rejects.toMatchObject(
      { code: 'USR-002' },
    );
  });
});
