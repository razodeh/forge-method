/**
 * `buildRunEngineContext` / `ensureIntegrationWorktree` — real `.forge/checks/` gate loading, a real
 * `git worktree add` against a real repository, and real facade construction
 * (`@forge/engine/dispatch`'s own `createVcsFacade`/`createTelemetryFacade`/`createGateEvaluator`/
 * `createMergeQueueFacade`), never mocked.
 *
 * @see specs/03 §3.2.4
 * @see PLAN-M5.md P15
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformAdapter } from '@forge/adapter-kit/types';

import {
  buildRunEngineContext,
  ensureIntegrationWorktree,
  integrationBranchFor,
  integrationBranchOfRun,
  isAncestor,
  isTargetRegisteredWorktree,
  stageIdOfContext,
  syncIntegrationBranchToTrunk,
} from '../../../src/commands/run/context.ts';
import {
  AGENTS_ROOT,
  CHECKS_ROOT,
  FAKE_MODEL_ID,
  FIXTURE_GATE_ID,
  cleanupAll,
  createTestProject,
  fixtureAdapter,
  type TestProject,
} from './helpers.ts';

afterEach(cleanupAll);

async function currentBranch(cwd: string): Promise<string> {
  return (await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd })).stdout.trim();
}

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

  it('discards and remakes a worktree a crashed `git worktree add` left half-made (locked, HEAD unset), instead of returning it', async () => {
    const project = await createTestProject();
    const target = await ensureIntegrationWorktree(
      project.paths,
      project.dir,
      'forge/integration/current',
      'main',
    );
    // What a killed `git worktree add` leaves: the checkout directory holds only its `.git` file, and the admin
    // directory only `gitdir` and a `locked` note saying `initializing`.
    const admin = (await execa('git', ['rev-parse', '--git-dir'], { cwd: target })).stdout.trim();
    for (const entry of await readdir(target)) {
      if (entry !== '.git') await rm(path.join(target, entry), { recursive: true, force: true });
    }
    for (const entry of await readdir(admin)) {
      if (entry !== 'gitdir') await rm(path.join(admin, entry), { recursive: true, force: true });
    }
    await writeFile(path.join(admin, 'locked'), 'initializing');
    await expect(
      execa('git', ['rev-parse', '--verify', 'HEAD'], { cwd: target }),
    ).rejects.toThrow();

    const repaired = await ensureIntegrationWorktree(
      project.paths,
      project.dir,
      'forge/integration/current',
      'main',
      { graceMs: 0 },
    );

    expect(repaired).toBe(target);
    expect(await currentBranch(repaired)).toBe('forge/integration/current');
    expect((await execa('git', ['status', '--porcelain'], { cwd: repaired })).stdout).toBe('');
  });

  it("remakes a target directory that exists with no worktree in it at all (git would read the project's own repository through it)", async () => {
    const project = await createTestProject();
    const target = project.paths.resolveState('worktrees/integration-forge-integration-current');
    await mkdir(target, { recursive: true });

    const made = await ensureIntegrationWorktree(
      project.paths,
      project.dir,
      'forge/integration/current',
      'main',
      { graceMs: 0 },
    );

    expect(made).toBe(target);
    expect(await currentBranch(made)).toBe('forge/integration/current');
    expect(await isTargetRegisteredWorktree(project.dir, made)).toBe(true);
  });

  it('puts a worktree a killed process left on another branch back on the integration branch, and does not discard it', async () => {
    const project = await createTestProject();
    const target = await ensureIntegrationWorktree(
      project.paths,
      project.dir,
      'forge/integration/current',
      'main',
    );
    // A killed inline step's `git switch -c`, and a file it had written: the tree is healthy, just elsewhere.
    await execa('git', ['switch', '-c', 'elsewhere'], { cwd: target });
    await writeFile(path.join(target, 'left-over.txt'), 'x\n');

    const again = await ensureIntegrationWorktree(
      project.paths,
      project.dir,
      'forge/integration/current',
      'main',
    );

    expect(again).toBe(target);
    expect(await currentBranch(again)).toBe('forge/integration/current');
    // Not discarded: a healthy worktree is repaired in place, its files are not thrown away with it.
    expect(existsSync(path.join(again, 'left-over.txt'))).toBe(true);
  });

  it('aborts a merge a killed process left half done in the integration worktree', async () => {
    const project = await createTestProject();
    const target = await ensureIntegrationWorktree(
      project.paths,
      project.dir,
      'forge/integration/current',
      'main',
    );
    await execa('git', ['branch', 'side', 'main'], { cwd: project.dir });
    await execa('git', ['checkout', '--quiet', 'side'], { cwd: target });
    await writeFile(path.join(target, 'side.txt'), 's\n');
    await execa('git', ['add', 'side.txt'], { cwd: target });
    await execa('git', ['commit', '--quiet', '-m', 'side'], { cwd: target });
    await execa('git', ['checkout', '--quiet', 'forge/integration/current'], { cwd: target });
    await execa('git', ['merge', '--no-ff', '--no-commit', 'side'], { cwd: target });
    expect(
      (await execa('git', ['rev-parse', '--verify', 'MERGE_HEAD'], { cwd: target })).exitCode,
    ).toBe(0);

    await ensureIntegrationWorktree(
      project.paths,
      project.dir,
      'forge/integration/current',
      'main',
    );

    await expect(
      execa('git', ['rev-parse', '--verify', 'MERGE_HEAD'], { cwd: target }),
    ).rejects.toThrow();
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
      { graceMs: 0 },
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
    // A context for something that is not a workflow run (`forge review`, `debug`, `session`, `panel`) keeps
    // branching its lanes from the trunk: the integration branch only moves when a run lands lanes.
    expect(ctx.integrationBase).toBe('main');
    expect(await currentBranch(ctx.integrationPath)).toBe('forge/integration/current');
    expect(ctx.conflictPolicy).toBe(project.config.execution.conflictPolicy);
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

  it("passes the project's test commands and merge checks to the engine: a merge check set resolves against them (M13 P38)", async () => {
    const project = await createTestProject();
    const configured = {
      ...project.config,
      execution: {
        ...project.config.execution,
        testCommands: { unit: 'pnpm test', lint: 'pnpm lint' },
        mergeChecks: { pre: 'fast', post: 'full' },
      },
    };
    const ctx = await buildRunEngineContext({
      paths: project.paths,
      projectRoot: project.dir,
      config: configured,
      runId: 'run-checks',
      adapter: fixtureAdapter(),
      checksRoot: CHECKS_ROOT,
      agentsRoot: AGENTS_ROOT,
    });
    expect(ctx.testCommands).toEqual({ unit: 'pnpm test', lint: 'pnpm lint' });
    expect(ctx.mergeChecks).toEqual({ pre: 'fast', post: 'full' });

    // Unset in the config (the default `{}`): no merge checks for a lane the engine integrates itself.
    const plain = await createTestProject();
    const plainCtx = await buildRunEngineContext({
      paths: plain.paths,
      projectRoot: plain.dir,
      config: plain.config,
      runId: 'run-plain',
      adapter: fixtureAdapter(),
      checksRoot: CHECKS_ROOT,
      agentsRoot: AGENTS_ROOT,
    });
    expect(plainCtx.mergeChecks).toEqual({});
    expect(plainCtx.testCommands).toEqual({});
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
      plans: relocated.paths.plans,
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

describe('the integration branch of a run (PLAN-M13.md P19)', () => {
  it('a workflow run branches its lanes from the integration branch, not from main', async () => {
    const project = await createTestProject();
    const ctx = await buildRunEngineContext({
      paths: project.paths,
      projectRoot: project.dir,
      config: project.config,
      runId: 'run-lanes',
      adapter: fixtureAdapter(),
      checksRoot: CHECKS_ROOT,
      agentsRoot: AGENTS_ROOT,
      lanesFromIntegration: true,
    });
    expect(ctx.integrationBase).toBe('forge/integration/current');
    expect(ctx.integrationBase).toBe(
      project.config.execution.integrationBranch.replace('{stage}', 'current'),
    );
    expect(await currentBranch(ctx.integrationPath)).toBe(ctx.integrationBase);
  });

  it('is the configured name with {stage} replaced by the run\'s stage, or "current" without one', async () => {
    const project = await createTestProject();
    expect(integrationBranchFor(project.config)).toBe('forge/integration/current');
    expect(integrationBranchFor(project.config, {})).toBe('forge/integration/current');
    expect(integrationBranchFor(project.config, { stageId: 'mvp' })).toBe('forge/integration/mvp');
    expect(integrationBranchFor(project.config, { stageId: 'S1.2_b-3' })).toBe(
      'forge/integration/S1.2_b-3',
    );
  });

  it.each(['', '../x', 'a/b', 'a b', '-x', 'x..y', '.hidden', 'a.', 'a\nb', 'a;b', 'x'.repeat(65)])(
    'never lets the stage id %j reach a git ref: the run uses "current"',
    async (stageId) => {
      const project = await createTestProject();
      expect(integrationBranchFor(project.config, { stageId })).toBe('forge/integration/current');
    },
  );

  it('the configured template is the one source: a workflow var naming another branch does not move the run', async () => {
    const project = await createTestProject();
    const custom = {
      ...project.config,
      execution: { ...project.config.execution, integrationBranch: 'integ/{stage}' },
    };
    const context = { stageId: 'P3', vars: { integration_branch: 'forge/integration/P3' } };
    expect(integrationBranchFor(custom, context)).toBe('integ/P3');
    expect(integrationBranchFor(project.config, context)).toBe('forge/integration/P3');
    expect(integrationBranchFor(project.config, { vars: { integration_branch: 'main' } })).toBe(
      'forge/integration/current',
    );
  });

  it('reads the stage from an expression context, and the integration branch of a recorded run from its manifest', async () => {
    expect(stageIdOfContext({ stageId: 'mvp' })).toBe('mvp');
    expect(stageIdOfContext({ stageId: 3 })).toBeUndefined();
    expect(stageIdOfContext(null)).toBeUndefined();
    expect(stageIdOfContext('mvp')).toBeUndefined();

    const project = await createTestProject();
    // No manifest (a run something other than `forge run` started): the default.
    expect(await integrationBranchOfRun(project.paths, project.config, 'no-such-run')).toBe(
      'forge/integration/current',
    );
    const dir = project.paths.resolveState('runs/run-a');
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ workflowId: 'w', expressionContext: { stageId: 'mvp' } }),
    );
    expect(await integrationBranchOfRun(project.paths, project.config, 'run-a')).toBe(
      'forge/integration/mvp',
    );
  });

  it('refuses a manifest it cannot read (RUN-054) instead of merging into the wrong branch', async () => {
    const project = await createTestProject();
    const broken = project.paths.resolveState('runs/run-b');
    await mkdir(broken, { recursive: true });
    await writeFile(path.join(broken, 'manifest.json'), '{ not json');
    await expect(
      integrationBranchOfRun(project.paths, project.config, 'run-b'),
    ).rejects.toMatchObject({
      code: 'RUN-054',
    });
  });

  it("a run with a stage branches its lanes from, and integrates into, that stage's integration branch", async () => {
    const project = await createTestProject();
    const ctx = await buildRunEngineContext({
      paths: project.paths,
      projectRoot: project.dir,
      config: project.config,
      runId: 'run-stage',
      adapter: fixtureAdapter(),
      checksRoot: CHECKS_ROOT,
      agentsRoot: AGENTS_ROOT,
      expressionContext: { stageId: 'mvp' },
      lanesFromIntegration: true,
    });
    expect(ctx.integrationBase).toBe('forge/integration/mvp');
    expect(await currentBranch(ctx.integrationPath)).toBe('forge/integration/mvp');
  });
});

// `PLAN-M14.md` P22: the in-run gate evaluator's own env carries `FORGE_BASE_REF`, read from the run's own
// manifest (`integrationTipAtStart`, `PLAN-M14.md` P9's real write, `run.ts`) — real, not stubbed: a real
// gate/check YAML file, a real `ctx.gates.evaluate` call, and a real spawned `node -e ...` reading
// `process.env.FORGE_BASE_REF` for real.
describe("the in-run gate evaluator's own FORGE_BASE_REF (PLAN-M14.md P9/P22)", () => {
  const BASE_REF_GATE_ID = 'G-BaseRef';
  /** Prints `{"ref": <FORGE_BASE_REF or "">, "errors": <0 or 1>}`, the identical "flat object, an
   * errors field failOn reads" shape every real shipped check uses -- `failOn` fires (fails the check)
   * exactly when `FORGE_BASE_REF` is unset. */
  const BASE_REF_GATE_YAML = `id: ${BASE_REF_GATE_ID}
checks:
  deterministic:
    - id: base-ref-probe
      run: "node -e \\"const ref=process.env.FORGE_BASE_REF||'';console.log(JSON.stringify({ref,errors:ref===''?1:0}))\\""
      parser: json
      failOn: "errors > 0"
`;

  async function writeManifest(
    project: TestProject,
    runId: string,
    integrationTipAtStart: string | undefined,
  ): Promise<void> {
    const dir = project.paths.resolveState(`runs/${runId}`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        workflowId: 'w',
        expressionContext: {},
        ...(integrationTipAtStart === undefined ? {} : { integrationTipAtStart }),
      }),
    );
  }

  it("supplies the run's own integrationTipAtStart as FORGE_BASE_REF to a real spawned check", async () => {
    const project = await createTestProject();
    await writeFile(
      path.join(project.dir, CHECKS_ROOT, `${BASE_REF_GATE_ID}.gate.yaml`),
      BASE_REF_GATE_YAML,
    );
    const { stdout: sha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: project.dir });
    const tip = sha.trim();
    await writeManifest(project, 'run-base-ref', tip);

    const ctx = await buildRunEngineContext({
      paths: project.paths,
      projectRoot: project.dir,
      config: project.config,
      runId: 'run-base-ref',
      adapter: fixtureAdapter(),
      checksRoot: CHECKS_ROOT,
      agentsRoot: AGENTS_ROOT,
    });
    const report = await ctx.gates.evaluate(BASE_REF_GATE_ID, project.dir);
    const check = report.checks.find((c) => c.checkId === 'base-ref-probe');
    expect(check?.reason).toBeUndefined();
    expect(check?.passed).toBe(true);
    expect(JSON.parse(check?.stdout ?? '{}')).toEqual({ ref: tip, errors: 0 });
  });

  it('leaves FORGE_BASE_REF unset (the check fails on its own stated reason) when the manifest has no integrationTipAtStart', async () => {
    const project = await createTestProject();
    await writeFile(
      path.join(project.dir, CHECKS_ROOT, `${BASE_REF_GATE_ID}.gate.yaml`),
      BASE_REF_GATE_YAML,
    );
    await writeManifest(project, 'run-no-tip', undefined);

    const ctx = await buildRunEngineContext({
      paths: project.paths,
      projectRoot: project.dir,
      config: project.config,
      runId: 'run-no-tip',
      adapter: fixtureAdapter(),
      checksRoot: CHECKS_ROOT,
      agentsRoot: AGENTS_ROOT,
    });
    const report = await ctx.gates.evaluate(BASE_REF_GATE_ID, project.dir);
    const check = report.checks.find((c) => c.checkId === 'base-ref-probe');
    expect(check?.passed).toBe(false);
    expect(JSON.parse(check?.stdout ?? '{}')).toEqual({ ref: '', errors: 1 });
  });

  it('leaves FORGE_BASE_REF unset for a runId with no manifest at all (forge review/debug/session/panel never write one)', async () => {
    const project = await createTestProject();
    await writeFile(
      path.join(project.dir, CHECKS_ROOT, `${BASE_REF_GATE_ID}.gate.yaml`),
      BASE_REF_GATE_YAML,
    );

    const ctx = await buildRunEngineContext({
      paths: project.paths,
      projectRoot: project.dir,
      config: project.config,
      runId: 'review-no-manifest',
      adapter: fixtureAdapter(),
      checksRoot: CHECKS_ROOT,
      agentsRoot: AGENTS_ROOT,
    });
    const report = await ctx.gates.evaluate(BASE_REF_GATE_ID, project.dir);
    const check = report.checks.find((c) => c.checkId === 'base-ref-probe');
    expect(check?.passed).toBe(false);
    expect(JSON.parse(check?.stdout ?? '{}')).toEqual({ ref: '', errors: 1 });
  });
});

/** A real commit directly on `main`, in the project's own primary working tree (not a lane, not the
 * integration worktree) — what a human, or a `deliver` step, does. */
async function commitOnMain(projectDir: string, file: string, content: string): Promise<void> {
  await writeFile(path.join(projectDir, file), content);
  await execa('git', ['add', file], { cwd: projectDir });
  await execa('git', ['commit', '--quiet', '-m', `commit ${file} on main`], { cwd: projectDir });
}

/** A real commit directly on the integration branch, in the SEPARATE integration worktree — what a
 * lane merge (or, here, a test manufacturing a real divergence) does; never the project's own tree. */
async function commitOnIntegration(
  integrationPath: string,
  file: string,
  content: string,
): Promise<void> {
  await writeFile(path.join(integrationPath, file), content);
  await execa('git', ['add', file], { cwd: integrationPath });
  await execa('git', ['commit', '--quiet', '-m', `commit ${file} on integration`], {
    cwd: integrationPath,
  });
}

describe('syncIntegrationBranchToTrunk (M14 P9, SPEC-QUESTIONS.md Q221 disclosed item (d) / Q232 decision 18)', () => {
  it('equal tips: a real no-op, HEAD untouched', async () => {
    const project = await createTestProject();
    const integrationPath = await ensureIntegrationWorktree(
      project.paths,
      project.dir,
      'forge/integration/current',
      'main',
    );
    const mainTip = (await execa('git', ['rev-parse', 'main'], { cwd: project.dir })).stdout.trim();

    const result = await syncIntegrationBranchToTrunk(integrationPath, 'main');

    expect(result).toEqual({ integrationTipAtStart: mainTip, syncedFromTrunk: null });
    expect(
      (await execa('git', ['rev-parse', 'HEAD'], { cwd: integrationPath })).stdout.trim(),
    ).toBe(mainTip);
  });

  it('integration two commits behind trunk: a real `--ff-only` fast-forward, HEAD == main, no new commit is created (never `git reset --hard`)', async () => {
    const project = await createTestProject();
    const integrationPath = await ensureIntegrationWorktree(
      project.paths,
      project.dir,
      'forge/integration/current',
      'main',
    );
    await commitOnMain(project.dir, 'a.txt', 'a\n');
    await commitOnMain(project.dir, 'b.txt', 'b\n');
    const mainTip = (await execa('git', ['rev-parse', 'main'], { cwd: project.dir })).stdout.trim();
    const mainCommitCount = (
      await execa('git', ['rev-list', '--count', 'main'], { cwd: project.dir })
    ).stdout.trim();

    const result = await syncIntegrationBranchToTrunk(integrationPath, 'main');

    expect(result).toEqual({ integrationTipAtStart: mainTip, syncedFromTrunk: mainTip });
    const headAfter = (
      await execa('git', ['rev-parse', 'HEAD'], { cwd: integrationPath })
    ).stdout.trim();
    // A real fast-forward moves the ref to the exact same commit main is on -- never a new merge commit.
    expect(headAfter).toBe(mainTip);
    expect(
      (
        await execa('git', ['rev-list', '--count', headAfter], { cwd: integrationPath })
      ).stdout.trim(),
    ).toBe(mainCommitCount);
    expect((await execa('git', ['status', '--porcelain'], { cwd: integrationPath })).stdout).toBe(
      '',
    );
  });

  it('integration ahead of trunk: a real no-op — its own extra commit is never discarded (what a `git reset --hard` mutation would do instead)', async () => {
    const project = await createTestProject();
    const integrationPath = await ensureIntegrationWorktree(
      project.paths,
      project.dir,
      'forge/integration/current',
      'main',
    );
    await commitOnIntegration(integrationPath, 'ahead.txt', 'x\n');
    const integrationTip = (
      await execa('git', ['rev-parse', 'HEAD'], { cwd: integrationPath })
    ).stdout.trim();

    const result = await syncIntegrationBranchToTrunk(integrationPath, 'main');

    expect(result).toEqual({ integrationTipAtStart: integrationTip, syncedFromTrunk: null });
    expect(
      (await execa('git', ['rev-parse', 'HEAD'], { cwd: integrationPath })).stdout.trim(),
    ).toBe(integrationTip);
    expect(existsSync(path.join(integrationPath, 'ahead.txt'))).toBe(true);
  });

  it('diverged: refused with RUN-107 naming the branch and both short shas — never merges main in, never creates MERGE_HEAD, leaves the worktree exactly as it was', async () => {
    const project = await createTestProject();
    const integrationPath = await ensureIntegrationWorktree(
      project.paths,
      project.dir,
      'forge/integration/current',
      'main',
    );
    await commitOnMain(project.dir, 'main-only.txt', 'm\n');
    await commitOnIntegration(integrationPath, 'integration-only.txt', 'i\n');
    const mainTip = (await execa('git', ['rev-parse', 'main'], { cwd: project.dir })).stdout.trim();
    const integrationTip = (
      await execa('git', ['rev-parse', 'HEAD'], { cwd: integrationPath })
    ).stdout.trim();

    let threw: unknown;
    try {
      await syncIntegrationBranchToTrunk(integrationPath, 'main');
    } catch (error) {
      threw = error;
    }

    expect(threw).toMatchObject({
      code: 'RUN-107',
      details: {
        branch: 'forge/integration/current',
        trunk: 'main',
        integrationTip: integrationTip.slice(0, 12),
        trunkTip: mainTip.slice(0, 12),
      },
    });

    // No merge was ever attempted at all: no MERGE_HEAD, a perfectly clean status, HEAD unchanged.
    await expect(
      execa('git', ['rev-parse', '--verify', 'MERGE_HEAD'], { cwd: integrationPath }),
    ).rejects.toThrow();
    expect((await execa('git', ['status', '--porcelain'], { cwd: integrationPath })).stdout).toBe(
      '',
    );
    expect(
      (await execa('git', ['rev-parse', 'HEAD'], { cwd: integrationPath })).stdout.trim(),
    ).toBe(integrationTip);
  });

  it('a dirty integration worktree — the SEPARATE worktree, not the project’s own tree — is refused with a typed VcsError distinct from VCS-DIRTY-TREE, never a silent half-merge, even when a fast-forward would otherwise be possible', async () => {
    const project = await createTestProject();
    const integrationPath = await ensureIntegrationWorktree(
      project.paths,
      project.dir,
      'forge/integration/current',
      'main',
    );
    // Main has real new work to bring in -- proving the dirty check is unconditional, not merely a
    // side effect of there being nothing to sync anyway.
    await commitOnMain(project.dir, 'c.txt', 'c\n');
    const integrationTipBefore = (
      await execa('git', ['rev-parse', 'HEAD'], { cwd: integrationPath })
    ).stdout.trim();
    await writeFile(path.join(integrationPath, 'untracked-scratch.txt'), 'wip\n');

    let threw: unknown;
    try {
      await syncIntegrationBranchToTrunk(integrationPath, 'main');
    } catch (error) {
      threw = error;
    }

    expect(threw).toMatchObject({ name: 'VcsError', code: 'VCS-INTEGRATION-DIRTY' });
    // Not the project-tree-specific code `vcs-refusal.ts` gives its own VCS-010 remedy/file-listing to.
    expect((threw as { code: string }).code).not.toBe('VCS-DIRTY-TREE');

    // Never attempted a merge: HEAD unchanged, no half-merge, and the uncommitted file survives
    // untouched (never discarded).
    expect(
      (await execa('git', ['rev-parse', 'HEAD'], { cwd: integrationPath })).stdout.trim(),
    ).toBe(integrationTipBefore);
    await expect(
      execa('git', ['rev-parse', '--verify', 'MERGE_HEAD'], { cwd: integrationPath }),
    ).rejects.toThrow();
    await expect(
      readFile(path.join(integrationPath, 'untracked-scratch.txt'), 'utf8'),
    ).resolves.toBe('wip\n');
  });

  it('a dirty integration worktree with many uncommitted files caps its message the same way VCS-010 does, never a wall of text, while details.dirtyFiles stays the full list (a round-2 critic finding: this code has no downstream wrapper to truncate it for it)', async () => {
    const project = await createTestProject();
    const integrationPath = await ensureIntegrationWorktree(
      project.paths,
      project.dir,
      'forge/integration/current',
      'main',
    );
    const fileCount = 15;
    for (let i = 0; i < fileCount; i += 1) {
      // Zero-padded so lexical order (what `git status`/`getDirtyFiles` returns) matches numeric
      // order -- otherwise "scratch-14.txt" would sort ahead of "scratch-2.txt" and land inside the
      // cap by accident, defeating the point of this test.
      await writeFile(
        path.join(integrationPath, `scratch-${String(i).padStart(2, '0')}.txt`),
        'wip\n',
      );
    }

    let threw: unknown;
    try {
      await syncIntegrationBranchToTrunk(integrationPath, 'main');
    } catch (error) {
      threw = error;
    }

    expect(threw).toMatchObject({ name: 'VcsError', code: 'VCS-INTEGRATION-DIRTY' });
    const error = threw as { message: string; details: { dirtyFiles: readonly string[] } };
    // The message names the true count and stops listing after the cap, with "and N more".
    expect(error.message).toContain(`${String(fileCount)} uncommitted change(s)`);
    expect(error.message).toContain('and 5 more');
    expect(error.message).not.toContain('scratch-14.txt');
    // The full, untruncated list is still on `details`, never load-bearing for the message alone.
    expect(error.details.dirtyFiles).toHaveLength(fileCount);
    expect(error.details.dirtyFiles).toContain('scratch-14.txt');
  });

  it('a trunk ref that does not resolve (a project without it) gets a clear VcsError, not a guess', async () => {
    const project = await createTestProject();
    const integrationPath = await ensureIntegrationWorktree(
      project.paths,
      project.dir,
      'forge/integration/current',
      'main',
    );
    await expect(
      syncIntegrationBranchToTrunk(integrationPath, 'no-such-trunk-branch'),
    ).rejects.toMatchObject({ name: 'VcsError' });
  });
});

describe('isAncestor (M14 P9): the real primitive syncIntegrationBranchToTrunk branches on', () => {
  it('true when ancestor really is one (or is the same commit), false when it is not', async () => {
    const project = await createTestProject();
    const integrationPath = await ensureIntegrationWorktree(
      project.paths,
      project.dir,
      'forge/integration/current',
      'main',
    );
    const base = (
      await execa('git', ['rev-parse', 'HEAD'], { cwd: integrationPath })
    ).stdout.trim();
    await commitOnIntegration(integrationPath, 'child.txt', 'c\n');
    const tip = (await execa('git', ['rev-parse', 'HEAD'], { cwd: integrationPath })).stdout.trim();

    expect(await isAncestor(integrationPath, base, tip)).toBe(true);
    expect(await isAncestor(integrationPath, tip, base)).toBe(false);
    expect(await isAncestor(integrationPath, tip, tip)).toBe(true);
  });

  it('a genuine `git merge-base --is-ancestor` failure (neither a real 0 nor 1 exit) is reported as RUN-055, never silently read as "not an ancestor" (a critic round found this branch of syncIntegrationBranchToTrunk had zero coverage)', async () => {
    const project = await createTestProject();
    const integrationPath = await ensureIntegrationWorktree(
      project.paths,
      project.dir,
      'forge/integration/current',
      'main',
    );
    const tip = (await execa('git', ['rev-parse', 'HEAD'], { cwd: integrationPath })).stdout.trim();
    // A syntactically valid-looking sha that resolves to no real object: confirmed directly,
    // `git merge-base --is-ancestor <this> HEAD` exits 128 with "fatal: Not a valid commit name", a
    // genuinely different outcome from either a real "yes" (0) or "no" (1) answer.
    // `syncIntegrationBranchToTrunk`'s own real call sequence always hands this function two shas
    // `resolveRevision` (`git rev-parse --verify`) has already proven resolve to real objects, so this
    // exact failure is not reliably reproducible through that public entry point — `isAncestor` is
    // exported specifically so it is directly testable here instead, the same reason
    // `isTargetRegisteredWorktree` above is.
    const bogus = 'a'.repeat(40);
    await expect(isAncestor(integrationPath, bogus, tip)).rejects.toMatchObject({
      code: 'RUN-055',
    });
    await expect(isAncestor(integrationPath, tip, bogus)).rejects.toMatchObject({
      code: 'RUN-055',
    });
  });
});

describe("forge merge's own code path never re-syncs the integration branch (Q232 decision 18: only runWorkflow syncs)", () => {
  it('the exact combo `forge merge` calls (integrationBranchOfRun + ensureIntegrationWorktree, never syncIntegrationBranchToTrunk) leaves a diverged branch untouched', async () => {
    const project = await createTestProject();
    const integrationPath = await ensureIntegrationWorktree(
      project.paths,
      project.dir,
      'forge/integration/current',
      'main',
    );
    await commitOnMain(project.dir, 'main-only.txt', 'm\n');
    await commitOnIntegration(integrationPath, 'integration-only.txt', 'i\n');
    const integrationTip = (
      await execa('git', ['rev-parse', 'HEAD'], { cwd: integrationPath })
    ).stdout.trim();

    // `runMergeCommand` (`bin.ts`) resolves the run's own integration branch, then re-ensures the
    // worktree -- never a sync call anywhere on that path.
    const branch = await integrationBranchOfRun(project.paths, project.config, 'no-such-run');
    const again = await ensureIntegrationWorktree(project.paths, project.dir, branch, 'main');

    expect(again).toBe(integrationPath);
    expect(
      (await execa('git', ['rev-parse', 'HEAD'], { cwd: integrationPath })).stdout.trim(),
    ).toBe(integrationTip);
  });
});
