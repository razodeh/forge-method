/**
 * `buildRunEngineContext` / `ensureIntegrationWorktree` — real `.forge/checks/` gate loading, a real
 * `git worktree add` against a real repository, and real facade construction
 * (`@forge/engine/dispatch`'s own `createVcsFacade`/`createTelemetryFacade`/`createGateEvaluator`/
 * `createMergeQueueFacade`), never mocked.
 *
 * @see specs/03 §3.2.4
 * @see PLAN-M5.md P15
 */
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformAdapter } from '@forge/adapter-kit/types';

import {
  buildRunEngineContext,
  ensureIntegrationWorktree,
  isTargetRegisteredWorktree,
} from '../../../src/commands/run/context.ts';
import {
  AGENTS_ROOT,
  CHECKS_ROOT,
  FAKE_MODEL_ID,
  FIXTURE_GATE_ID,
  cleanupAll,
  createTestProject,
  fixtureAdapter,
} from './helpers.ts';

afterEach(cleanupAll);

describe('ensureIntegrationWorktree', () => {
  it('creates a real new branch and worktree from base when the branch does not exist yet', async () => {
    const project = await createTestProject();
    const target = await ensureIntegrationWorktree(
      project.paths,
      project.dir,
      'forge/integration/current',
      'main',
    );

    const { stdout } = await execa('git', ['branch', '--list', 'forge/integration/current'], {
      cwd: project.dir,
    });
    expect(stdout.trim()).not.toBe('');
    const { stdout: worktreeList } = await execa('git', ['worktree', 'list'], { cwd: project.dir });
    expect(worktreeList).toContain(target);
  });

  it('throws RUN-055 (not ENV-004) for a real, non-"tool missing" git failure', async () => {
    // A critic round caught the previous code reporting the identical "install git" ENV-004 message
    // for *any* `git worktree add` failure — real or not. This forces a real, reproducible non-ENOENT
    // failure (the branch already checked out at a different real worktree path) and confirms it is
    // reported as RUN-055, carrying the real git failure text, not ENV-004's misleading remedy.
    const project = await createTestProject();
    await execa('git', ['branch', 'forge/integration/current'], { cwd: project.dir });
    await execa('git', ['worktree', 'add', 'other-path', 'forge/integration/current'], {
      cwd: project.dir,
    });

    let threw: unknown;
    try {
      await ensureIntegrationWorktree(
        project.paths,
        project.dir,
        'forge/integration/current',
        'main',
      );
    } catch (error) {
      threw = error;
    }
    expect(threw).toMatchObject({ code: 'RUN-055' });
    expect((threw as Error).message).toContain('already checked out');
  });

  it('throws ENV-004 (not RUN-055) when the git binary itself genuinely cannot be found', async () => {
    // The other real half of `runGitOrThrow`'s own distinction: a real `ENOENT` spawn failure (no
    // `git` on `PATH` at all) is the one case `ENV-004`'s "install the tool" remedy actually fits.
    const project = await createTestProject();
    const realPath = process.env['PATH'];
    process.env['PATH'] = '';
    try {
      await expect(
        ensureIntegrationWorktree(project.paths, project.dir, 'forge/integration/current', 'main'),
      ).rejects.toMatchObject({ code: 'ENV-004' });
    } finally {
      process.env['PATH'] = realPath;
    }
  });

  it('checks out the existing branch when one already exists', async () => {
    const project = await createTestProject();
    await execa('git', ['branch', 'forge/integration/current'], { cwd: project.dir });

    const target = await ensureIntegrationWorktree(
      project.paths,
      project.dir,
      'forge/integration/current',
      'main',
    );
    const { stdout } = await execa('git', ['worktree', 'list'], { cwd: project.dir });
    expect(stdout).toContain(target);
  });

  it('is idempotent: a second call against an already-checked-out path is a real no-op', async () => {
    const project = await createTestProject();
    const first = await ensureIntegrationWorktree(
      project.paths,
      project.dir,
      'forge/integration/current',
      'main',
    );
    const second = await ensureIntegrationWorktree(
      project.paths,
      project.dir,
      'forge/integration/current',
      'main',
    );
    expect(second).toBe(first);
  });

  it('repairs a real "missing but already registered" worktree — a crashed process’s own stale registration outliving its own directory', async () => {
    // Deterministically reproduced (unlike the two-live-process race below): create a real worktree,
    // then delete only its real directory, leaving git's own `.git/worktrees/<name>` registration
    // behind — the exact real state a `SIGKILL`'d process's own incomplete `git worktree add` leaves,
    // confirmed directly with a real, hand-run `git worktree add` reproduction before this test was
    // written.
    const project = await createTestProject();
    const first = await ensureIntegrationWorktree(
      project.paths,
      project.dir,
      'forge/integration/current',
      'main',
    );
    await rm(first, { recursive: true, force: true });

    const repaired = await ensureIntegrationWorktree(
      project.paths,
      project.dir,
      'forge/integration/current',
      'main',
    );
    expect(repaired).toBe(first);
    expect(await isTargetRegisteredWorktree(project.dir, repaired)).toBe(true);
    const { stdout } = await execa('git', ['worktree', 'list', '--porcelain'], {
      cwd: project.dir,
    });
    expect(stdout).toContain(repaired);
  });

  // A genuinely simultaneous pair of calls (fired via `Promise.all` in one process) was tried here and
  // deliberately removed: it reliably reproduces a real, but *different* and more adversarial race
  // than this function's own fix targets — a branch-ref lock collision ("cannot lock ref ...
  // reference already exists"), git's own failure mode when *two* callers race the `-b` branch
  // creation itself, not just the worktree directory. That scenario does not occur in this codebase's
  // own real architecture: `ensureIntegrationWorktree` is only ever reached through
  // `buildRunEngineContext`, itself only ever called by one real `forge run`/`forge resume`
  // invocation at a time (serialized by `.forge/state/lock.json`, `lock.ts`) — the one real exception
  // being the exact resume-after-crash window this fix targets, where a killed process's own
  // already-in-flight `git worktree add` can still be finishing as the resuming process starts a
  // fresh one. `resume.test.ts`'s own real crash-then-resume test is the real regression proof for
  // that actual scenario, run against a genuinely `SIGKILL`'d process, not a synthetic same-process
  // race harder than production ever produces.
});

describe('isTargetRegisteredWorktree', () => {
  it('is true for a real, genuinely registered worktree', async () => {
    const project = await createTestProject();
    const target = await ensureIntegrationWorktree(
      project.paths,
      project.dir,
      'forge/integration/current',
      'main',
    );
    expect(await isTargetRegisteredWorktree(project.dir, target)).toBe(true);
  });

  it('is false for a real directory that merely exists but was never registered by git', async () => {
    const project = await createTestProject();
    const strayTarget = path.join(project.dir, '.forge/state/worktrees/not-a-real-worktree');
    await mkdir(strayTarget, { recursive: true });
    expect(await isTargetRegisteredWorktree(project.dir, strayTarget)).toBe(false);
  });
});

describe('buildRunEngineContext', () => {
  it('assembles a real RunEngineContext with the real gate registry and config-derived fields', async () => {
    const project = await createTestProject();
    const ctx = await buildRunEngineContext({
      paths: project.paths,
      projectRoot: project.dir,
      config: project.config,
      runId: 'run-1',
      adapter: fixtureAdapter(),
      checksRoot: CHECKS_ROOT,
      agentsRoot: AGENTS_ROOT,
    });

    expect(ctx.runId).toBe('run-1');
    expect(ctx.projectRoot).toBe(project.dir);
    expect(ctx.integrationBase).toBe('main');
    // A real, adapter-reported model id — never the bare tier label ('balanced') a stale version of
    // this code once hardcoded.
    expect(ctx.model).toBe(FAKE_MODEL_ID);
    // `PLAN-M10.md` P20 / `06` §6.7: the fixture project's own config uses the built-in default
    // (`execution.autonomy: 'guided'`, `project.adopted: false`), which `resolveClaimPolicy` resolves
    // to `warn` — this used to assert the bare, hard-coded `'strict'` literal `context.ts` wrote
    // regardless of autonomy; see the dedicated `claimPolicy` describe block below for the full
    // per-autonomy/adopted matrix.
    expect(ctx.claimPolicy).toBe('warn');
    expect(ctx.signCommits).toBe(project.config.vcs.signCommits);
    expect(ctx.gateRegistry.has(FIXTURE_GATE_ID)).toBe(true);
    expect(ctx.laneRegistry.size).toBe(0);
    expect(ctx.seed).toBe('run-1');
    // 'auto' concurrency resolves to a real, finite global limit (`context.ts`'s own `concurrencyLimits`).
    expect(ctx.limits.global).toBeGreaterThan(0);
  });

  it('honours an explicit numeric concurrency instead of resolving "auto"', async () => {
    const project = await createTestProject();
    const explicitConcurrency = {
      ...project.config,
      execution: { ...project.config.execution, concurrency: 7 as const },
    };
    const ctx = await buildRunEngineContext({
      paths: project.paths,
      projectRoot: project.dir,
      config: explicitConcurrency,
      runId: 'run-1',
      adapter: fixtureAdapter(),
      checksRoot: CHECKS_ROOT,
      agentsRoot: AGENTS_ROOT,
    });
    expect(ctx.limits.global).toBe(7);
  });

  it('derives retainLaneWorktrees from config, honouring "never" specifically', async () => {
    const project = await createTestProject();
    const neverRetain = {
      ...project.config,
      execution: { ...project.config.execution, retainLaneWorktrees: 'never' as const },
    };
    const ctx = await buildRunEngineContext({
      paths: project.paths,
      projectRoot: project.dir,
      config: neverRetain,
      runId: 'run-1',
      adapter: fixtureAdapter(),
      checksRoot: CHECKS_ROOT,
      agentsRoot: AGENTS_ROOT,
    });
    expect(ctx.retainLaneWorktrees).toBe(false);
  });

  describe('claimPolicy — 06 §6.7 / 17 §17.4 point 5 (PLAN-M10.md P20)', () => {
    interface ClaimPolicyCase {
      readonly autonomy: 'supervised' | 'guided' | 'autonomous';
      readonly adopted: boolean;
    }

    async function claimPolicyFor(overrides: ClaimPolicyCase): Promise<string> {
      const project = await createTestProject();
      const merged = {
        ...project.config,
        execution: { ...project.config.execution, autonomy: overrides.autonomy },
        project: { ...project.config.project, adopted: overrides.adopted },
      };
      const ctx = await buildRunEngineContext({
        paths: project.paths,
        projectRoot: project.dir,
        config: merged,
        runId: 'run-1',
        adapter: fixtureAdapter(),
        checksRoot: CHECKS_ROOT,
        agentsRoot: AGENTS_ROOT,
      });
      return ctx.claimPolicy;
    }

    it('06 §6.7: autonomous defaults to strict on a non-adopted project', async () => {
      expect(await claimPolicyFor({ autonomy: 'autonomous', adopted: false })).toBe('strict');
    });

    it('06 §6.7: guided defaults to warn on a non-adopted project', async () => {
      expect(await claimPolicyFor({ autonomy: 'guided', adopted: false })).toBe('warn');
    });

    it('17 §17.4 point 5: an adopted project forces strict even at guided autonomy', async () => {
      expect(await claimPolicyFor({ autonomy: 'guided', adopted: true })).toBe('strict');
    });
  });

  it('always carries the real prompt-assembly deps (M13 P5, D4): an agent step can never reach the raw-brief-path behaviour through a context built here', async () => {
    const project = await createTestProject();
    const ctx = await buildRunEngineContext({
      paths: project.paths,
      projectRoot: project.dir,
      config: project.config,
      runId: 'run-assembly',
      adapter: fixtureAdapter(),
      checksRoot: CHECKS_ROOT,
      agentsRoot: AGENTS_ROOT,
    });

    for (const key of [
      'paths',
      'loadAgent',
      'loadContent',
      'openKb',
      'models',
      'escalations',
      'autonomy',
      'kbPackBudgetTokens',
      'skillsPackBudgetTokens',
      'templatesPackageRoot',
      'pinnedCore',
    ] as const) {
      expect(ctx.assembly[key], key).toBeDefined();
    }
    // It is wired to the project's own real files, not stubs: the fixture's agent and brief resolve...
    expect((await ctx.assembly.loadAgent('engineer')).id).toBe('engineer');
    expect(await ctx.assembly.loadContent('briefs/implement.md')).toContain('Implement story-1');
    // ...and a reference that is not a real brief is refused rather than returned as text.
    await expect(ctx.assembly.loadContent('implement story-1')).rejects.toMatchObject({
      code: 'CFG-053',
    });
    await expect(ctx.assembly.loadAgent('nobody')).rejects.toMatchObject({ code: 'RUN-056' });
    // config-sourced pieces come from the project's own config.
    expect(ctx.assembly.models).toEqual(project.config.models);
    expect(ctx.assembly.autonomy).toBe(project.config.execution.autonomy);
    expect(ctx.assembly.kbPackBudgetTokens).toBe(project.config.kb.packBudgetTokens);
    // A fresh project has no KB: the pack still opens (D6), empty.
    const kb = await ctx.assembly.openKb();
    expect(kb.tree.entries).toEqual([]);
    kb.close();
  });

  it("wires the project's own configured docs roots into the output contract check (M13 P7): a relocated paths.specs is where declared outputs are looked for", async () => {
    const project = await createTestProject();
    const relocated = {
      ...project.config,
      paths: { ...project.config.paths, specs: 'documentation/specs', kb: 'documentation/kb' },
    };
    const ctx = await buildRunEngineContext({
      paths: project.paths,
      projectRoot: project.dir,
      config: relocated,
      runId: 'run-docroots',
      adapter: fixtureAdapter(),
      checksRoot: CHECKS_ROOT,
      agentsRoot: AGENTS_ROOT,
    });
    expect(ctx.docRoots).toEqual({
      kb: 'documentation/kb',
      specs: 'documentation/specs',
      sessions: relocated.paths.sessions,
      reports: relocated.paths.reports,
    });
  });

  it('refuses to build a context from a malformed security.toolCeilingEscalations entry (CFG-054)', async () => {
    const project = await createTestProject();
    await expect(
      buildRunEngineContext({
        paths: project.paths,
        projectRoot: project.dir,
        config: {
          ...project.config,
          security: { ...project.config.security, toolCeilingEscalations: [{ agent: 'sre' }] },
        },
        runId: 'run-bad-escalation',
        adapter: fixtureAdapter(),
        checksRoot: CHECKS_ROOT,
        agentsRoot: AGENTS_ROOT,
      }),
    ).rejects.toMatchObject({ code: 'CFG-054' });
  });

  it('throws RUN-052 when the real adapter reports no available models', async () => {
    const project = await createTestProject();
    const noModelsAdapter = { listModels: () => Promise.resolve([]) } as unknown as PlatformAdapter;
    await expect(
      buildRunEngineContext({
        paths: project.paths,
        projectRoot: project.dir,
        config: project.config,
        runId: 'run-1',
        adapter: noModelsAdapter,
        checksRoot: CHECKS_ROOT,
        agentsRoot: AGENTS_ROOT,
      }),
    ).rejects.toMatchObject({ code: 'RUN-052' });
  });
});
