/**
 * `forge run <workflow> [--dry-run]` — real `dryRunWorkflow` compilation and a real, in-process
 * `runWorkflow` end-to-end run against the real `@forge/engine` scheduler, a real git repository, and a
 * real (fake-adapter) session — never mocked engine internals.
 *
 * @see specs/03 §3.2.4
 * @see PLAN-M5.md P20
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { execa } from 'execa';
import { FakePlatformAdapter } from '@forge/testkit';
import { readEvents, type ForgeEvent } from '@forge/telemetry/events';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { dryRunWorkflow, handleSigterm, runWorkflow } from '../../../src/commands/run/run.ts';
import { gateApprove, type GateCommandContext } from '../../../src/commands/run/gate-commands.ts';
import { acquireRunLock, readRunLock } from '../../../src/commands/run/lock.ts';
import { currentLauncher, type LauncherSpec } from '../../../src/commands/run/launcher-shim.ts';
import { runLanes } from '../../../src/commands/run/status.ts';
import {
  AGENTS_ROOT,
  CHECKS_ROOT,
  FIXTURE_GATE_ID,
  FIXTURE_ITEM_ID,
  FIXTURE_STEP_IMPLEMENT_ID,
  FIXTURE_STEP_PREPARE_ID,
  FIXTURE_STEP_VERIFY_ID,
  FIXTURE_WORKFLOW_ID,
  FIXTURE_WORKFLOW_SOURCE,
  WORKFLOWS_ROOT,
  cleanupAll,
  createTestProject,
  fixtureExpressionContext,
  testRunDeps,
} from './helpers.ts';

afterEach(cleanupAll);

/** A real `LauncherSpec` naming the real `forge` entry point directly (`packages/cli/bin/forge.mjs`,
 * the identical real file `bin.test.ts`'s own `LAUNCHER` constant spawns as a subprocess) -- unlike
 * `currentLauncher(process.env)` (every other real-launcher test in this file), which replays THIS
 * process's own `process.argv[1]`: correct when the calling process genuinely IS the `forge` CLI (a real
 * `bin.test.ts` subprocess, or `bin.ts` itself creating a shim for a run it dispatches), but wrong here,
 * where the calling process is a vitest worker -- replaying vitest's own worker entry point as "forge"
 * spawns vitest's own worker bootstrap with `gate approve ...` as its argv, which throws immediately
 * ("Expected worker to be run in node:child_process"). Only needed by the one test below that spawns a
 * REAL nested `forge` subprocess from a `command` step's own `run:` text (every other real-launcher test
 * in this file only runs `printf`/`echo`, which never resolves `forge` on `PATH` at all). */
const REAL_FORGE_LAUNCHER: LauncherSpec = {
  execPath: process.execPath,
  execArgv: [],
  entry: fileURLToPath(new URL('../../../bin/forge.mjs', import.meta.url)),
  env: process.env,
};

describe('dryRunWorkflow', () => {
  it('plans and returns the real compiled plan without touching the filesystem or spawning a session', () => {
    const result = dryRunWorkflow(FIXTURE_WORKFLOW_SOURCE, fixtureExpressionContext());
    expect(result.kind).toBe('dry-run');
    expect(result.plan.success).toBe(true);
    if (result.plan.success) {
      expect(result.plan.nodes.map((node) => node.id).sort()).toEqual(
        [FIXTURE_STEP_IMPLEMENT_ID, FIXTURE_STEP_PREPARE_ID, FIXTURE_STEP_VERIFY_ID].sort(),
      );
    }
  });

  it('throws RUN-045 for a workflow that fails to parse', () => {
    expect(() => dryRunWorkflow('not: [valid, workflow', fixtureExpressionContext())).toThrow();
  });

  it('returns a failed plan (not a thrown error) for a workflow that parses but fails to compile', () => {
    // `dryRunWorkflow`'s own real contract: only a *parse* failure throws (there is no workflow to
    // report a plan for at all); a *compile* failure — a real, well-formed workflow whose own
    // `dependsOn` graph does not resolve — is itself the real, reportable "plan" `--dry-run` exists to
    // show, so it comes back as `plan.success === false` for the caller to print, not thrown.
    const source = `
id: broken
name: Broken
version: 1.0.0
description: A broken fixture — parses fine, fails to compile.
steps:
  - id: only
    kind: command
    run: "true"
    dependsOn: [ nonexistent ]
`;
    const result = dryRunWorkflow(source, fixtureExpressionContext());
    expect(result.plan.success).toBe(false);
    if (!result.plan.success) {
      expect(result.plan.issues[0]).toMatchObject({ code: 'dangling-dependency' });
    }
  });

  it("carries an agent step's authored taint: external onto its compiled node -- what --json prints, JSON.stringify(result.plan) verbatim (bin.ts's printWorkflowDispatchResult), needs nothing beyond this real field already being there (PLAN-M14.md P27)", () => {
    const source = `
id: w
name: W
version: "1.0.0"
description: d
steps:
  - id: reads-codebase
    kind: agent
    agent: architect
    taint: external
  - id: ordinary
    kind: command
    run: "true"
`;
    const result = dryRunWorkflow(source, fixtureExpressionContext());
    expect(result.plan.success).toBe(true);
    if (!result.plan.success) return;
    const tainted = result.plan.nodes.find((node) => node.id === 'w:reads-codebase');
    const ordinary = result.plan.nodes.find((node) => node.id === 'w:ordinary');
    expect(tainted?.taint).toBe('external');
    expect(ordinary?.taint).toBeUndefined();
    // The exact shape `printWorkflowDispatchResult` serialises for `--json`.
    const printed = JSON.parse(JSON.stringify({ v: 1, plan: result.plan })) as {
      plan: { nodes: readonly { id: string; taint?: string }[] };
    };
    expect(printed.plan.nodes.find((node) => node.id === 'w:reads-codebase')?.taint).toBe(
      'external',
    );
  });

  it("tags a step declaring an mcp:/fetch:https: input, and a step naming a kb: id in the caller's externalKbIds set, without an authored taint: external anywhere (PLAN-M14.md P30, 20 §20.5 point 3)", () => {
    const source = `
id: w
name: W
version: "1.0.0"
description: d
steps:
  - id: search
    kind: agent
    agent: pm
    brief: b
    inputs: [ "mcp:jira/search_issues" ]
  - id: cites-external-kb-entry
    kind: agent
    agent: architect
    brief: b
    inputs: [ "kb:KB-ARCH-0001" ]
  - id: ordinary
    kind: agent
    agent: architect
    brief: b
`;
    const result = dryRunWorkflow(source, fixtureExpressionContext(), new Set(['KB-ARCH-0001']));
    expect(result.plan.success).toBe(true);
    if (!result.plan.success) return;
    expect(result.plan.nodes.find((node) => node.id === 'w:search')?.taint).toBe('external');
    expect(result.plan.nodes.find((node) => node.id === 'w:cites-external-kb-entry')?.taint).toBe(
      'external',
    );
    expect(result.plan.nodes.find((node) => node.id === 'w:ordinary')?.taint).toBeUndefined();
  });

  it('the identical workflow with no externalKbIds argument still tags the mcp: step (needs no option) but not the kb: one', () => {
    const source = `
id: w
name: W
version: "1.0.0"
description: d
steps:
  - id: search
    kind: agent
    agent: pm
    brief: b
    inputs: [ "mcp:jira/search_issues" ]
  - id: cites-external-kb-entry
    kind: agent
    agent: architect
    brief: b
    inputs: [ "kb:KB-ARCH-0001" ]
`;
    const result = dryRunWorkflow(source, fixtureExpressionContext());
    expect(result.plan.success).toBe(true);
    if (!result.plan.success) return;
    expect(result.plan.nodes.find((node) => node.id === 'w:search')?.taint).toBe('external');
    expect(
      result.plan.nodes.find((node) => node.id === 'w:cites-external-kb-entry')?.taint,
    ).toBeUndefined();
  });
});

describe('runWorkflow', () => {
  it('throws RUN-053 for an unknown workflow id', async () => {
    const project = await createTestProject();
    await expect(
      runWorkflow(testRunDeps(project), {
        workflowId: 'no-such-workflow',
        expressionContext: fixtureExpressionContext(),
        host: 'test-host',
      }),
    ).rejects.toMatchObject({ code: 'RUN-053' });
  });

  it('dry-run mode never acquires the lock or writes any run state', async () => {
    const project = await createTestProject();
    const result = await runWorkflow(testRunDeps(project), {
      workflowId: FIXTURE_WORKFLOW_ID,
      expressionContext: fixtureExpressionContext(),
      dryRun: true,
      host: 'test-host',
    });
    expect(result.kind).toBe('dry-run');
    expect(await readRunLock(project.paths)).toBeUndefined();
    // `SPEC-QUESTIONS.md` Q232 decision 18: `--dry-run` never syncs the integration branch either —
    // nothing plans or prints without spawning any session or writing any file (`03` §3.2's own
    // `--dry-run` contract) means never even creating the integration worktree this sync would run
    // against.
    expect(existsSync(project.paths.resolveState('worktrees'))).toBe(false);
  });

  it('runs a real workflow to completion: real event log, real lock lifecycle, real produced artifact', async () => {
    const project = await createTestProject();
    const result = await runWorkflow(testRunDeps(project), {
      workflowId: FIXTURE_WORKFLOW_ID,
      expressionContext: fixtureExpressionContext(),
      runId: 'run-fixed',
      host: 'test-host',
    });

    expect(result.kind).toBe('run');
    if (result.kind !== 'run') throw new Error('unreachable');
    expect(result.runId).toBe('run-fixed');
    expect(result.runState.runStatus).toBe('completed');
    expect(result.runState.unresolvedStepIds).toEqual([]);

    // The lock is released once the run finishes.
    expect(await readRunLock(project.paths)).toBeUndefined();

    // The real produced artifact from the fake adapter's own scripted write really landed on disk, in
    // the real lane worktree — this fixture has no merge step, so nothing brings it back to the main
    // project root (the merge-step case below covers that path).
    const lanes = await runLanes(project.paths, project.dir, 'run-fixed');
    const laneId = lanes[0]?.laneId;
    if (laneId === undefined) throw new Error('run left no lane');
    const written = await readFile(
      project.paths.resolveState(`worktrees/${laneId}/${FIXTURE_ITEM_ID}.txt`),
      'utf8',
    );
    expect(written).toBe(`${FIXTURE_ITEM_ID}\n`);

    // A real manifest and last-run pointer, readable back for a later `forge resume`.
    const manifest = JSON.parse(
      await readFile(path.join(project.dir, '.forge/state/runs/run-fixed/manifest.json'), 'utf8'),
    ) as { workflowId: string; integrationTipAtStart: string; syncedFromTrunk: string | null };
    expect(manifest.workflowId).toBe(FIXTURE_WORKFLOW_ID);
    // `SPEC-QUESTIONS.md` Q232 decision 18: the sync's own outcome is recorded on the manifest — this
    // is the very first run, so the integration branch was just created from `main` (equal tips, a
    // no-op sync).
    const mainTip = (await execa('git', ['rev-parse', 'main'], { cwd: project.dir })).stdout.trim();
    expect(manifest.integrationTipAtStart).toBe(mainTip);
    expect(manifest.syncedFromTrunk).toBeNull();
    const lastRun = JSON.parse(
      await readFile(path.join(project.dir, '.forge/state/last-run.json'), 'utf8'),
    ) as { runId: string };
    expect(lastRun.runId).toBe('run-fixed');
  });

  // `PLAN-M14.md` P30: a real run's own manifest records `externalKbIds` from the project's real KB
  // tree, computed by `collectExternalKbIds` before anything else -- proved here against a real KB entry
  // on disk (never a mocked `parseKbTree`), the write half of "forge resume recompiles the same tainted
  // plan" (`resume.test.ts`'s own test proves the read half).
  it("records the project's own KB entries carrying external provenance in the manifest (PLAN-M14.md P30)", async () => {
    const project = await createTestProject();
    await mkdir(path.join(project.dir, 'docs/forge/kb/architecture'), { recursive: true });
    await writeFile(
      path.join(project.dir, 'docs/forge/kb/architecture/KB-ARCH-0001.md'),
      `---
id: KB-ARCH-0001
type: knowledge
section: architecture
title: A test entry citing an MCP server
status: active
confidence: high
owner: architect
sources:
  - kind: external
    ref: mcp:confluence/get_page
created: 2026-01-05
updated: 2026-01-05
review_by: 2026-04-05
supersedes: []
superseded_by: null
related: []
diagrams: []
tags: []
applies_to: []
---

## Statement
A test statement.
`,
    );
    await execa('git', ['add', '-A'], { cwd: project.dir });
    await execa('git', ['commit', '--quiet', '-m', 'add a KB entry with external provenance'], {
      cwd: project.dir,
    });

    await runWorkflow(testRunDeps(project), {
      workflowId: FIXTURE_WORKFLOW_ID,
      expressionContext: fixtureExpressionContext(),
      runId: 'run-with-external-kb',
      host: 'test-host',
    });

    const manifest = JSON.parse(
      await readFile(
        path.join(project.dir, '.forge/state/runs/run-with-external-kb/manifest.json'),
        'utf8',
      ),
    ) as { externalKbIds: readonly string[] };
    expect(manifest.externalKbIds).toEqual(['KB-ARCH-0001']);
  });

  it('20 §20.10 S8: refuses to start a real, non-dry-run run against a dirty working tree, before acquiring the lock or writing any run state', async () => {
    const project = await createTestProject();
    // A real, adversarial uncommitted edit to the user's own working tree -- not a FORGE-internal file,
    // a real source file a human would plausibly still be mid-edit on.
    await writeFile(path.join(project.dir, 'work-in-progress.txt'), 'not yet committed');

    await expect(
      runWorkflow(testRunDeps(project), {
        workflowId: FIXTURE_WORKFLOW_ID,
        expressionContext: fixtureExpressionContext(),
        runId: 'run-dirty',
        host: 'test-host',
      }),
    ).rejects.toMatchObject({ code: 'VCS-DIRTY-TREE' });

    // Halted *before* any of runWorkflow's own side effects -- no lock left behind, no manifest/
    // last-run pointer written for a run that never really started.
    expect(await readRunLock(project.paths)).toBeUndefined();
    await expect(
      readFile(path.join(project.dir, '.forge/state/runs/run-dirty/manifest.json'), 'utf8'),
    ).rejects.toThrow();

    // The uncommitted work itself survives untouched -- S8's own "never discarded" half.
    await expect(readFile(path.join(project.dir, 'work-in-progress.txt'), 'utf8')).resolves.toBe(
      'not yet committed',
    );
  });

  it('SPEC-QUESTIONS.md Q232 decision 18: a diverged integration branch refuses the run before anything exists for it — lock released, no runs/<id>/, last-run.json unchanged, no half-merge', async () => {
    const project = await createTestProject();
    // A real prior run, so there is a real "last known run" state to prove untouched by the refusal.
    const first = await runWorkflow(testRunDeps(project), {
      workflowId: FIXTURE_WORKFLOW_ID,
      expressionContext: fixtureExpressionContext(),
      runId: 'run-1',
      host: 'test-host',
    });
    expect(first.kind).toBe('run');
    const lastRunBefore = await readFile(
      path.join(project.dir, '.forge/state/last-run.json'),
      'utf8',
    );

    // Diverge main and the integration branch for real: a commit on each side the other does not have.
    await writeFile(path.join(project.dir, 'main-only.txt'), 'm\n');
    await execa('git', ['add', 'main-only.txt'], { cwd: project.dir });
    await execa('git', ['commit', '--quiet', '-m', 'main-only'], { cwd: project.dir });
    const integrationPath = path.join(
      project.dir,
      '.forge/state/worktrees/integration-forge-integration-current',
    );
    await writeFile(path.join(integrationPath, 'integration-only.txt'), 'i\n');
    await execa('git', ['add', 'integration-only.txt'], { cwd: integrationPath });
    await execa('git', ['commit', '--quiet', '-m', 'integration-only'], { cwd: integrationPath });

    await expect(
      runWorkflow(testRunDeps(project), {
        workflowId: FIXTURE_WORKFLOW_ID,
        expressionContext: fixtureExpressionContext(),
        runId: 'run-2-diverged',
        host: 'test-host',
      }),
    ).rejects.toMatchObject({ code: 'RUN-107' });

    expect(await readRunLock(project.paths)).toBeUndefined();
    await expect(
      readFile(path.join(project.dir, '.forge/state/runs/run-2-diverged/manifest.json'), 'utf8'),
    ).rejects.toThrow();
    const lastRunAfter = await readFile(
      path.join(project.dir, '.forge/state/last-run.json'),
      'utf8',
    );
    expect(lastRunAfter).toBe(lastRunBefore);

    // No half-merge left behind in the integration worktree either.
    expect((await execa('git', ['status', '--porcelain'], { cwd: integrationPath })).stdout).toBe(
      '',
    );
    await expect(
      execa('git', ['rev-parse', '--verify', 'MERGE_HEAD'], { cwd: integrationPath }),
    ).rejects.toThrow();
  });

  it('a full real run through a real merge step lands the change on the real integration branch', async () => {
    const project = await createTestProject({ variant: 'merge' });
    const result = await runWorkflow(testRunDeps(project), {
      workflowId: FIXTURE_WORKFLOW_ID,
      expressionContext: fixtureExpressionContext(),
      runId: 'run-merge',
      host: 'test-host',
    });
    expect(result.kind).toBe('run');
    if (result.kind !== 'run') throw new Error('unreachable');
    expect(result.runState.runStatus).toBe('completed');

    const integrationPath = path.join(
      project.dir,
      '.forge/state/worktrees/integration-forge-integration-current',
    );
    const written = await readFile(path.join(integrationPath, `${FIXTURE_ITEM_ID}.txt`), 'utf8');
    expect(written).toBe(`${FIXTURE_ITEM_ID}\n`);

    const { stdout } = await execa('git', ['log', '--oneline', 'forge/integration/current'], {
      cwd: project.dir,
    });
    expect(stdout).toContain('Merge lane');
  });

  it('SPEC-QUESTIONS.md Q221 disclosed item (d) / Q232 decision 18: when nothing has landed on the integration branch yet, a human’s direct commit to main between two runs reaches the second run’s first lane', async () => {
    // Run 1's own workflow deliberately has no lane-creating step (one inline `command` only): a
    // successful lane a workflow's own plan does not land with an explicit `merge` step is still
    // auto-integrated by the engine itself as soon as it succeeds (confirmed directly: the regular
    // fixture's own merge-less `implement` lane lands a real `--no-ff` merge commit on the integration
    // branch during the run) -- so a workflow *with* a lane would leave the integration branch already
    // one commit ahead of `main` by the time run 1 finishes. A human's *own* subsequent commit straight
    // to `main` would then be a genuine, structural divergence (two unrelated commits from the same
    // point), which `RUN-107` correctly refuses -- that combination is this piece's own disclosed,
    // known-open residual ("`deliver` still folds nothing back onto `main`"; the diverged case above
    // covers it). The case this test proves is the one `Q221`'s disclosure actually names: successive
    // `forge run` invocations against an integration branch that has not (yet) diverged from `main` --
    // here, because nothing has landed on it yet -- where a human's direct commit to `main` in between
    // them must still reach the very next run's first real lane.
    const project = await createTestProject();
    const noLaneWorkflowId = 'cli-fixture-no-lane';
    await writeFile(
      path.join(project.dir, WORKFLOWS_ROOT, `${noLaneWorkflowId}.workflow.yaml`),
      `id: ${noLaneWorkflowId}\n` +
        'name: CLI fixture (no lane-creating step)\n' +
        'version: 1.0.0\n' +
        'description: One inline command step only -- nothing ever lands on the integration branch.\n' +
        '\n' +
        'steps:\n' +
        '  - id: noop\n' +
        '    kind: command\n' +
        '    run: "true"\n' +
        '    inline: true\n',
    );
    await execa('git', ['add', '-A'], { cwd: project.dir });
    await execa('git', ['commit', '--quiet', '-m', 'add no-lane fixture workflow'], {
      cwd: project.dir,
    });

    const first = await runWorkflow(testRunDeps(project), {
      workflowId: noLaneWorkflowId,
      expressionContext: fixtureExpressionContext(),
      runId: 'run-1',
      host: 'test-host',
    });
    expect(first.kind).toBe('run');
    if (first.kind !== 'run') throw new Error('unreachable');
    expect(first.runState.runStatus).toBe('completed');

    // Confirmed: run 1 left the integration branch exactly where it started, equal to `main`.
    const integrationPathBefore = path.join(
      project.dir,
      '.forge/state/worktrees/integration-forge-integration-current',
    );
    const mainTipBeforeHotfix = (
      await execa('git', ['rev-parse', 'main'], { cwd: project.dir })
    ).stdout.trim();
    expect(
      (await execa('git', ['rev-parse', 'HEAD'], { cwd: integrationPathBefore })).stdout.trim(),
    ).toBe(mainTipBeforeHotfix);

    // A human commits directly to `main` -- never touching a lane, never touching the integration
    // branch.
    await writeFile(path.join(project.dir, 'hotfix.txt'), 'hotfix\n');
    await execa('git', ['add', 'hotfix.txt'], { cwd: project.dir });
    await execa('git', ['commit', '--quiet', '-m', 'hotfix'], { cwd: project.dir });

    const second = await runWorkflow(testRunDeps(project), {
      workflowId: FIXTURE_WORKFLOW_ID,
      expressionContext: fixtureExpressionContext(),
      runId: 'run-2',
      host: 'test-host',
    });
    expect(second.kind).toBe('run');
    if (second.kind !== 'run') throw new Error('unreachable');
    expect(second.runState.runStatus).toBe('completed');

    // Run 2's own `implement` lane was branched from the integration tip *after* this run's own sync —
    // it genuinely contains the hotfix, proving the sync ran before any lane (the run's first real
    // session) was ever created, not merely before the workflow finished.
    const lanes = await runLanes(project.paths, project.dir, 'run-2');
    const laneId = lanes[0]?.laneId;
    if (laneId === undefined) throw new Error('run 2 left no lane');
    const hotfixInLane = await readFile(
      project.paths.resolveState(`worktrees/${laneId}/hotfix.txt`),
      'utf8',
    );
    expect(hotfixInLane).toBe('hotfix\n');

    // And the integration branch itself was really fast-forwarded, not merely the lane rebased past it.
    const integrationPathAfter = path.join(
      project.dir,
      '.forge/state/worktrees/integration-forge-integration-current',
    );
    const hotfixOnIntegration = await readFile(
      path.join(integrationPathAfter, 'hotfix.txt'),
      'utf8',
    );
    expect(hotfixOnIntegration).toBe('hotfix\n');
  });

  it('SPEC-QUESTIONS.md Q221 disclosed item (d) / Q232 decision 18 (the disclosed residual, proved rather than merely asserted): once a lane HAS already landed on the integration branch, a human’s subsequent direct commit to main is a genuine divergence and run 2 correctly refuses with RUN-107, never silently missing the hotfix', async () => {
    // A critic round found the sibling test above (using a lane-less run 1) does not, by itself, prove
    // anything about the far more common real case -- a workflow whose own lane already landed (the
    // standard fixture's merge-less `implement` lane is auto-integrated by the engine the moment it
    // succeeds, `06` §6.4) -- and that nothing in this suite pinned what happens then. This does: run 1
    // uses the STANDARD fixture (a real lane lands a real `--no-ff` merge commit on the integration
    // branch), so by the time it finishes the integration branch already holds one commit `main` does
    // not. A human's own subsequent commit straight to `main` is then two unrelated commits from the
    // same point -- a real, structural divergence, not merely a "behind" case -- and `deliver` still
    // folds nothing back onto `main` (this piece's own disclosed, known-open residual), so there is no
    // path that could make this a clean fast-forward. `RUN-107` is the correct outcome: never a silent
    // continue that would leave run 2 building on stale integration state while quietly missing main's
    // own newer commit.
    const project = await createTestProject();
    const first = await runWorkflow(testRunDeps(project), {
      workflowId: FIXTURE_WORKFLOW_ID,
      expressionContext: fixtureExpressionContext(),
      runId: 'run-1',
      host: 'test-host',
    });
    expect(first.kind).toBe('run');
    if (first.kind !== 'run') throw new Error('unreachable');
    expect(first.runState.runStatus).toBe('completed');

    // Confirmed: run 1's own lane really did land on the integration branch (it is genuinely ahead of
    // the `main` it started from), not merely still 'ready' and unmerged.
    const integrationPath = path.join(
      project.dir,
      '.forge/state/worktrees/integration-forge-integration-current',
    );
    const mainTipBeforeHotfix = (
      await execa('git', ['rev-parse', 'main'], { cwd: project.dir })
    ).stdout.trim();
    const integrationTipAfterRun1 = (
      await execa('git', ['rev-parse', 'HEAD'], { cwd: integrationPath })
    ).stdout.trim();
    expect(integrationTipAfterRun1).not.toBe(mainTipBeforeHotfix);
    const { stdout: log } = await execa('git', ['log', '--oneline', 'forge/integration/current'], {
      cwd: project.dir,
    });
    expect(log).toContain('Merge lane');

    // A human commits directly to `main`.
    await writeFile(path.join(project.dir, 'hotfix.txt'), 'hotfix\n');
    await execa('git', ['add', 'hotfix.txt'], { cwd: project.dir });
    await execa('git', ['commit', '--quiet', '-m', 'hotfix'], { cwd: project.dir });

    await expect(
      runWorkflow(testRunDeps(project), {
        workflowId: FIXTURE_WORKFLOW_ID,
        expressionContext: fixtureExpressionContext(),
        runId: 'run-2',
        host: 'test-host',
      }),
    ).rejects.toMatchObject({ code: 'RUN-107' });

    // Refused cleanly: the integration branch is exactly where run 1's own merge left it, no half-merge.
    expect(
      (await execa('git', ['rev-parse', 'HEAD'], { cwd: integrationPath })).stdout.trim(),
    ).toBe(integrationTipAfterRun1);
    expect((await execa('git', ['status', '--porcelain'], { cwd: integrationPath })).stdout).toBe(
      '',
    );
    await expect(
      execa('git', ['rev-parse', '--verify', 'MERGE_HEAD'], { cwd: integrationPath }),
    ).rejects.toThrow();
  });

  it('a real gate check spawned by a fresh run carries the FORGE run marker (@forge/core/session-marker, PLAN-M14.md P4), through the real commandEnvFor -> commandEnv -> createGateEvaluator chain, not a hand-built env', async () => {
    const project = await createTestProject();
    // The fixture gate's own check, extended (not replaced) to also record $FORGE_RUN_ID to a file in
    // its own cwd (`ctx.integrationPath`) -- still returns the required `{"ok":true}` JSON envelope.
    await writeFile(
      path.join(project.dir, CHECKS_ROOT, `${FIXTURE_GATE_ID}.gate.yaml`),
      `id: ${FIXTURE_GATE_ID}\n` +
        'name: Always-passing fixture gate\n' +
        'phase: verify\n' +
        'checks:\n' +
        '  deterministic:\n' +
        '    - id: always-ok\n' +
        '      run: "printf \'%s\' \\"$FORGE_RUN_ID\\" > run-id-marker.txt && echo \'{\\"ok\\":true}\'"\n' +
        '      failOn: "!ok"\n' +
        '  advisory: []\n' +
        'openQuestionsPolicy: warn\n',
    );
    await execa('git', ['add', '-A'], { cwd: project.dir });
    await execa('git', ['commit', '--quiet', '-m', 'gate check also records FORGE_RUN_ID'], {
      cwd: project.dir,
    });

    const deps = { ...testRunDeps(project), launcher: currentLauncher(process.env) };
    const result = await runWorkflow(deps, {
      workflowId: FIXTURE_WORKFLOW_ID,
      expressionContext: fixtureExpressionContext(),
      runId: 'run-gate-marker',
      host: 'test-host',
    });
    expect(result.kind).toBe('run');
    if (result.kind !== 'run') throw new Error('unreachable');
    expect(result.runState.runStatus).toBe('completed');

    const marker = await readFile(
      path.join(
        project.dir,
        '.forge/state/worktrees/integration-forge-integration-current',
        'run-id-marker.txt',
      ),
      'utf8',
    );
    expect(marker).toBe('run-gate-marker');
  });

  // `PLAN-M14.md` P15, `SPEC-QUESTIONS.md` Q232 decision 9: a run's own `command` step carries the FORGE
  // session marker's `FORGE_RUN_ID`/`FORGE_STEP_ID` (`commandStepEnvironment`, P4) but never
  // `FORGE_AGENT_ID` (only an `agent` step's own session does) -- so a real `forge gate approve` invoked
  // FROM one, naming its own real run, is refused outright (`GATE-510`), never silently recorded as a
  // human or an agent approval.
  it("a `command` step running a real `forge gate approve --run <its own run>` is refused GATE-510 -- a run's own command step is not a person or an agent session (PLAN-M14.md P15)", async () => {
    const project = await createTestProject();
    const gateCommandWorkflowId = 'cli-fixture-gate-command';
    const runId = 'run-p15-gate-cmd';
    await writeFile(
      path.join(project.dir, WORKFLOWS_ROOT, `${gateCommandWorkflowId}.workflow.yaml`),
      `id: ${gateCommandWorkflowId}\n` +
        'name: CLI fixture (a command step calling forge gate approve against its own run)\n' +
        'version: 1.0.0\n' +
        "description: PLAN-M14.md P15 -- a run's own bare command-step marker is refused (GATE-510).\n" +
        '\n' +
        'steps:\n' +
        '  - id: self-approve\n' +
        '    kind: command\n' +
        `    run: "forge gate approve ${FIXTURE_GATE_ID} --json --run ${runId}"\n` +
        '    inline: true\n',
    );
    // `bin.ts`'s own real CLI dispatcher (the nested `forge gate approve` this step's own `run:` text
    // spawns) hard-codes its own gate registry root at `.forge/checks/`, distinct from this fixture
    // project's own in-process `checksRoot` (`CHECKS_ROOT` here, `docs/forge/checks/`, `testRunDeps`'s
    // own value the IN-PROCESS `runWorkflow`/its own `gate` steps use) -- the real nested subprocess
    // needs its OWN copy of the fixture gate under the path it actually reads.
    await mkdir(path.join(project.dir, '.forge/checks'), { recursive: true });
    await writeFile(
      path.join(project.dir, '.forge/checks', `${FIXTURE_GATE_ID}.gate.yaml`),
      `id: ${FIXTURE_GATE_ID}\n` +
        'name: Always-passing fixture gate (real CLI copy)\n' +
        'phase: verify\n' +
        'checks:\n' +
        '  deterministic:\n' +
        '    - id: always-ok\n' +
        '      run: "echo \'{\\"ok\\":true}\'"\n' +
        '      failOn: "!ok"\n' +
        '  advisory: []\n' +
        'openQuestionsPolicy: warn\n',
    );
    await execa('git', ['add', '-A'], { cwd: project.dir });
    await execa('git', ['commit', '--quiet', '-m', 'add gate-command fixture workflow'], {
      cwd: project.dir,
    });

    // `REAL_FORGE_LAUNCHER`, not `currentLauncher(process.env)`: this step's own `run:` text genuinely
    // invokes `forge` as a nested subprocess (unlike the P4 test above, which only runs `printf`/`echo`),
    // and needs the shim to replay a real, working `forge` -- see `REAL_FORGE_LAUNCHER`'s own doc comment.
    const deps = { ...testRunDeps(project), launcher: REAL_FORGE_LAUNCHER };
    const result = await runWorkflow(deps, {
      workflowId: gateCommandWorkflowId,
      expressionContext: fixtureExpressionContext(),
      runId,
      host: 'test-host',
    });

    expect(result.kind).toBe('run');
    if (result.kind !== 'run') throw new Error('unreachable');
    expect(result.runState.runStatus).toBe('failed');
    expect(result.runState.stepStatuses.get(`${gateCommandWorkflowId}:self-approve`)).toBe(
      'failed',
    );

    // The failure is genuinely GATE-510, not merely "some failure": `bin.ts`'s own top-level catch
    // prints `ForgeError.message` (never the bare code) to stderr, and `runCommandStep`'s own failure
    // detail is `stderr || stdout` (`10` §10.1's own real command-step contract) -- stderr is non-empty
    // here, so it wins, and it is this exact refusal's message text, unique to GATE-510 among every
    // other gate refusal code (`GATE-507`/`508`/`509` each read entirely differently). A weaker
    // assertion here (only "the step failed, no GateApproved was recorded") would not catch a regression
    // that swapped this refusal for a different one.
    const events: ForgeEvent[] = [];
    for await (const event of readEvents(project.dir, runId)) events.push(event);
    const failed = events.find((event) => event.type === 'StepFailed');
    expect((failed?.payload as { readonly message?: string } | undefined)?.message).toContain(
      "a run's own command step is not a person or an agent session",
    );

    // No CLI-appended `GateApproved`: this fixture declares no `gate` step of its own, so any
    // `GateApproved` in the log could only be the refused command's own -- there is none.
    expect(events.some((event) => event.type === 'GateApproved')).toBe(false);
  });

  // `PLAN-M14.md` P19, `SPEC-QUESTIONS.md` Q232 decision 8: end to end -- a REAL run's own `agent` step
  // durably writes `StepStarted` with a real `agentId` and `payload.gateEvidence` (`runAgentStep`,
  // `dispatch/steps.ts`, not a hand-built event as `gate-commands.test.ts`'s own unit tests use), and a
  // same-run `forge gate approve` attempt by that identical agent, under the real FORGE session marker
  // (`PLAN-M14.md` P15), is refused `GATE-511` -- while a human, over the identical run and gate, is not.
  it("a real run's own StepStarted carries the real agentId/gateEvidence, and a same-run approval attempt by that agent is refused GATE-511 (05 section 5.2, 10 section 10.3 rule 6)", async () => {
    const project = await createTestProject();
    const workflowId = 'cli-fixture-evidence-conflict';
    const runId = 'run-p19-evidence';

    await writeFile(
      path.join(project.dir, WORKFLOWS_ROOT, `${workflowId}.workflow.yaml`),
      `id: ${workflowId}\n` +
        'name: CLI fixture (an agent step produces evidence for a gate it might later be asked to approve)\n' +
        'version: 1.0.0\n' +
        'description: PLAN-M14.md P19 end-to-end.\n' +
        '\n' +
        'steps:\n' +
        '  - id: propose\n' +
        '    kind: agent\n' +
        '    agent: sre\n' +
        '    brief: briefs/propose.md\n' +
        `    produces: [ "${FIXTURE_ITEM_ID}-sre.txt" ]\n` +
        '    gateEvidence: [ G-Evidence ]\n',
    );

    await mkdir(path.join(project.dir, '.forge', 'briefs'), { recursive: true });
    await writeFile(
      path.join(project.dir, '.forge', 'briefs', 'propose.md'),
      'Propose the design.\n',
    );

    // A real `.forge/agents/sre.yaml`, `may_approve: [G-Evidence]` -- `sre` (not `architect`: the
    // roster loader refuses ANY non-empty `may_approve` for that one id outright, `05` §5.2's own
    // roster rule, `@forge/agents/schema/load.ts`, unrelated to this test's own GATE-511 refusal).
    await mkdir(path.join(project.dir, AGENTS_ROOT), { recursive: true });
    await writeFile(
      path.join(project.dir, AGENTS_ROOT, 'sre.yaml'),
      `id: sre
name: SRE
version: 1.0.0
tier: core
mandate: Fixture mandate for sre.
decisions_owned: []
persona:
  voice: terse
  stance: pragmatic
  disagreement_style: direct
inputs:
  required: []
  optional: []
outputs:
  - type: X
    schema: x.schema.json
    path: x.md
kb_write: []
kb_propose: []
tools:
  read: true
  write: true
  exec: []
  network: false
  git_commit: none
  deploy: false
model:
  tier: balanced
  thinking: medium
limits:
  max_turns: 10
  wall_clock_ms: 600000
  max_cost_usd: 2.0
parallel_safety:
  file_ownership: []
  exclusive: false
gates:
  produces_evidence_for: []
  may_approve: [G-Evidence]
prompt:
  system: prompts/sre.system.md
`,
    );
    await mkdir(path.join(project.dir, '.forge', 'prompts'), { recursive: true });
    await writeFile(
      path.join(project.dir, '.forge', 'prompts', 'sre.system.md'),
      'Fixture role instructions for sre.\n',
    );

    await mkdir(path.join(project.dir, CHECKS_ROOT), { recursive: true });
    await writeFile(
      path.join(project.dir, CHECKS_ROOT, 'G-Evidence.gate.yaml'),
      'id: G-Evidence\n' +
        'checks:\n' +
        '  deterministic:\n' +
        '    - id: always-ok\n' +
        `      run: "echo '{\\"ok\\":true}'"\n` +
        '      failOn: "!ok"\n' +
        '  advisory: []\n' +
        'openQuestionsPolicy: warn\n' +
        'approval:\n' +
        '  roles: [human, sre]\n',
    );

    await execa('git', ['add', '-A'], { cwd: project.dir });
    await execa('git', ['commit', '--quiet', '-m', 'add P19 evidence-conflict fixtures'], {
      cwd: project.dir,
    });

    const adapter = new FakePlatformAdapter();
    adapter.script((request) => request.stepId.includes('propose'), {
      text: ['proposed the design'],
      writeFiles: [{ relativePath: `${FIXTURE_ITEM_ID}-sre.txt`, content: 'note\n' }],
    });

    const result = await runWorkflow(testRunDeps(project, adapter), {
      workflowId,
      expressionContext: fixtureExpressionContext(),
      runId,
      host: 'test-host',
    });
    expect(result.kind).toBe('run');
    if (result.kind !== 'run') throw new Error('unreachable');
    expect(result.runState.runStatus).toBe('completed');

    // The real, engine-emitted StepStarted for this run's own `propose` step -- proven directly before
    // the refusal below, so a failure here clearly names which half broke.
    const events: ForgeEvent[] = [];
    for await (const event of readEvents(project.dir, runId)) events.push(event);
    const started = events.find((event) => event.type === 'StepStarted');
    expect(started).toMatchObject({
      agentId: 'sre',
      payload: { gateEvidence: ['G-Evidence'] },
    });

    const gateCtx: GateCommandContext = {
      paths: project.paths,
      projectRoot: project.dir,
      checksRoot: CHECKS_ROOT,
      agentsRoot: AGENTS_ROOT,
      runId,
      marker: { runId, stepId: 'design', agentId: 'sre' },
    };
    await expect(gateApprove(gateCtx, 'G-Evidence', 'looks fine')).rejects.toMatchObject({
      code: 'GATE-511',
      details: { gateId: 'G-Evidence', agentId: 'sre' },
    });
    const afterRefusal: ForgeEvent[] = [];
    for await (const event of readEvents(project.dir, runId)) afterRefusal.push(event);
    expect(afterRefusal.some((event) => event.type === 'GateApproved')).toBe(false);

    // A human, over the identical run and gate, is unaffected by the agent's own evidence.
    const humanCtx: GateCommandContext = {
      paths: project.paths,
      projectRoot: project.dir,
      checksRoot: CHECKS_ROOT,
      agentsRoot: AGENTS_ROOT,
      runId,
    };
    const summary = await gateApprove(humanCtx, 'G-Evidence', 'fine');
    expect(summary.approver).toBe('human');
  });

  it('derives a deterministic runId from the injected clock when none is given', async () => {
    const project = await createTestProject();
    const clock = { now: () => '2026-01-01T00:00:00.000Z' };
    const result = await runWorkflow(testRunDeps(project), {
      workflowId: FIXTURE_WORKFLOW_ID,
      expressionContext: fixtureExpressionContext(),
      host: 'test-host',
      clock,
    });
    expect(result.kind).toBe('run');
    if (result.kind !== 'run') throw new Error('unreachable');
    expect(result.runId).toBe(`run-${FIXTURE_WORKFLOW_ID}-20260101000000000`);
  });

  it('throws CFG-002 when a real, still-alive lock already holds the project', async () => {
    const project = await createTestProject();
    // Acquire the lock out from under runWorkflow by writing it directly, naming this test process's
    // own real, alive pid.
    await acquireRunLock(project.paths, {
      pid: process.pid,
      host: 'other-host',
      runId: 'run-other',
      startedAt: '2026-01-01T00:00:00.000Z',
    });

    await expect(
      runWorkflow(testRunDeps(project), {
        workflowId: FIXTURE_WORKFLOW_ID,
        expressionContext: fixtureExpressionContext(),
        host: 'test-host',
      }),
    ).rejects.toMatchObject({ code: 'CFG-002' });
  });
});

describe('handleSigterm', () => {
  it('exits with code 0 — this codebase’s own real "pause terminates the process outright" contract', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    handleSigterm();
    expect(exit).toHaveBeenCalledWith(0);
    exit.mockRestore();
  });
});
