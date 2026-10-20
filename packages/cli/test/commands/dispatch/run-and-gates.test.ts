/**
 * `commands/dispatch/run-and-gates.ts` — `forge run/resume/pause/abort/lanes/logs/gate/parity/
 * evidence/merge/land`, exercised in-process (`specs/22` M17 P2's own "the coverage report for the
 * new dispatch modules meets the floor"). The real, agent-free workflow/gate fixture shape is the
 * identical one `packages/cli/test/bin.test.ts`'s own `realRunProject` already establishes for this
 * same command family — no real platform CLI or network access needed, since no step here ever
 * calls `PlatformAdapter.startSession`.
 *
 * @see specs/22 M17 P2
 */
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { ProjectPaths } from '@forge/core/fs';
import { DEFAULT_CONFIG } from '@forge/schemas/config';
import * as YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import { dispatchRunAndGates } from '../../../src/commands/dispatch/run-and-gates.ts';
import type { DispatchContext } from '../../../src/commands/dispatch/shared.ts';
import { acquireRunLock, isProcessAlive } from '../../../src/commands/run/lock.ts';
import { captureLogs } from './dispatch-test-helpers.ts';

const WORKFLOW_ID = 'dispatch-fixture';
const GATE_ID = 'G-Dispatch-Fixture';
const FAILING_GATE_ID = 'G-Dispatch-Failing';
const WORKFLOWS_ROOT = '.forge/workflows';
const CHECKS_ROOT = '.forge/checks';

const FIXTURE_WORKFLOW = `id: ${WORKFLOW_ID}
name: Dispatch fixture
version: 1.0.0
description: A real, agent-free workflow (command + gate only).

steps:
  - id: prepare
    kind: command
    run: "true"
    inline: true

  - id: verify
    kind: gate
    gate: ${GATE_ID}
    dependsOn: [ prepare ]
`;

const FIXTURE_GATE = `id: ${GATE_ID}
name: Always-passing dispatch fixture gate
phase: verify
checks:
  deterministic:
    - id: always-ok
      run: "echo '{\\"ok\\":true}'"
      failOn: "!ok"
  advisory: []
openQuestionsPolicy: warn
`;

const FAILING_GATE = `id: ${FAILING_GATE_ID}
name: Always-failing dispatch fixture gate
phase: verify
checks:
  deterministic:
    - id: always-fail
      run: "echo '{\\"errors\\":1}'"
      failOn: 'errors > 0'
  advisory: []
openQuestionsPolicy: warn
`;

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function freshProject(): Promise<{ readonly dir: string; readonly paths: ProjectPaths }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-dispatch-run-gates-'));
  dirs.push(dir);

  await execa('git', ['init', '--quiet', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Fixture'], { cwd: dir });

  await mkdir(path.join(dir, '.forge'), { recursive: true });
  await writeFile(path.join(dir, '.forge/config.yaml'), YAML.stringify(DEFAULT_CONFIG), 'utf8');
  await mkdir(path.join(dir, WORKFLOWS_ROOT), { recursive: true });
  await writeFile(path.join(dir, WORKFLOWS_ROOT, `${WORKFLOW_ID}.workflow.yaml`), FIXTURE_WORKFLOW);
  await mkdir(path.join(dir, CHECKS_ROOT), { recursive: true });
  await writeFile(path.join(dir, CHECKS_ROOT, `${GATE_ID}.gate.yaml`), FIXTURE_GATE);
  await writeFile(path.join(dir, CHECKS_ROOT, `${FAILING_GATE_ID}.gate.yaml`), FAILING_GATE);
  await writeFile(path.join(dir, '.gitignore'), '.forge/state/\n');

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

describe('dispatchRunAndGates (specs/22 M17 P2)', () => {
  it('returns undefined for a command it does not own', async () => {
    const { dir, paths } = await freshProject();
    expect(await dispatchRunAndGates(ctx(dir, paths, ['kb', 'list']))).toBeUndefined();
  });

  it('exits 2 for "run" with no real <workflow> id', async () => {
    const { dir, paths } = await freshProject();
    expect(await dispatchRunAndGates(ctx(dir, paths, ['run']))).toBe(2);
  });

  it('runs "run <workflow> --json" for real end to end, a real "completed" status', async () => {
    const { dir, paths } = await freshProject();
    const result = await captureLogs(() =>
      dispatchRunAndGates(ctx(dir, paths, ['run', WORKFLOW_ID], true)),
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.lines[0] ?? '{}') as {
      readonly runState: { readonly runStatus: string };
    };
    expect(parsed.runState.runStatus).toBe('completed');
  }, 20_000);

  it('runs "run <workflow> --dry-run" for real, compiling without ever starting a run', async () => {
    const { dir, paths } = await freshProject();
    const dryCtx = ctx(dir, paths, ['run', WORKFLOW_ID]);
    const exitCode = await dispatchRunAndGates({
      ...dryCtx,
      flags: { ...dryCtx.flags, dryRun: true },
    });
    expect(exitCode).toBe(0);
  }, 20_000);

  it('runs "gate check <id> --run <id>"/"logs --run <id>"/"land --run <id>"/"merge --all --run <id>" for real, the real explicit-run-id branch of resolveDispatchRunId', async () => {
    const { dir, paths } = await freshProject();
    const ran = await captureLogs(() =>
      dispatchRunAndGates(ctx(dir, paths, ['run', WORKFLOW_ID], true)),
    );
    const runId = (
      JSON.parse(ran.lines[0] ?? '{}') as { readonly runState: { readonly runId: string } }
    ).runState.runId;
    expect(runId).toBeTruthy();

    // Every one of these takes an optional `--run <id>`, defaulting to the project's own
    // `last-run.json` pointer when omitted (already exercised elsewhere) -- this is the real,
    // EXPLICIT branch of `resolveDispatchRunId`, never exercised until now. `land`/`merge` run
    // BEFORE `gate check`: `gate check` writes a real, uncommitted report file, and `land` itself
    // refuses a dirty working tree first.
    expect(await dispatchRunAndGates(ctx(dir, paths, ['land', '--run', runId]))).toBe(0);
    expect(await dispatchRunAndGates(ctx(dir, paths, ['merge', '--all', '--run', runId]))).toBe(0);
    expect(
      await dispatchRunAndGates(ctx(dir, paths, ['gate', 'check', GATE_ID, '--run', runId])),
    ).toBe(0);
    expect(await dispatchRunAndGates(ctx(dir, paths, ['logs', '--run', runId]))).toBe(0);
  }, 20_000);

  it('refuses a real, unexpected extra positional for "run <workflow> <extra>" (USR-002)', async () => {
    const { dir, paths } = await freshProject();
    await expect(
      dispatchRunAndGates(ctx(dir, paths, ['run', WORKFLOW_ID, 'extra'])),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('refuses a real, unexpected extra positional for "resume <runId> <extra>" (USR-002)', async () => {
    const { dir, paths } = await freshProject();
    await expect(
      dispatchRunAndGates(ctx(dir, paths, ['resume', 'RUN-001', 'extra'])),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('refuses a real RUN-048 for "abort <runId>" naming an id that does not match any real active run', async () => {
    const { dir, paths } = await freshProject();
    await expect(dispatchRunAndGates(ctx(dir, paths, ['abort', 'RUN-999']))).rejects.toMatchObject({
      code: 'RUN-048',
    });
  });

  it('runs "pause --json" for real, sending a real SIGTERM to a real, locked process', async () => {
    const { dir, paths } = await freshProject();
    const child = spawn('node', ['-e', 'setInterval(() => {}, 1000)']);
    const pid = child.pid;
    if (pid === undefined) throw new Error('unreachable: spawn always sets a real pid');
    await acquireRunLock(paths, {
      pid,
      host: 'fixture-host',
      runId: 'run-fixture-paused',
      startedAt: '2026-01-01T00:00:00.000Z',
    });
    const result = await captureLogs(() => dispatchRunAndGates(ctx(dir, paths, ['pause'], true)));
    expect(result.exitCode).toBe(0);
    expect(isProcessAlive(pid)).toBe(false);
    const parsed = JSON.parse(result.lines[0] ?? '{}') as { readonly stopped: boolean };
    expect(parsed.stopped).toBe(true);
  });

  it('runs "abort --json" for real, sending a real SIGKILL to a real, locked process', async () => {
    const { dir, paths } = await freshProject();
    const child = spawn('node', ['-e', 'setInterval(() => {}, 1000)']);
    const pid = child.pid;
    if (pid === undefined) throw new Error('unreachable: spawn always sets a real pid');
    await acquireRunLock(paths, {
      pid,
      host: 'fixture-host',
      runId: 'run-fixture-aborted',
      startedAt: '2026-01-01T00:00:00.000Z',
    });
    const result = await captureLogs(() => dispatchRunAndGates(ctx(dir, paths, ['abort'], true)));
    expect(result.exitCode).toBe(0);
    expect(isProcessAlive(pid)).toBe(false);
  });

  it('exits non-zero for "lanes"/"pause"/"abort" with no real run yet (RUN-048)', async () => {
    const { dir, paths } = await freshProject();
    await expect(dispatchRunAndGates(ctx(dir, paths, ['pause']))).rejects.toMatchObject({
      code: 'RUN-048',
    });
    await expect(dispatchRunAndGates(ctx(dir, paths, ['abort']))).rejects.toMatchObject({
      code: 'RUN-048',
    });
    await expect(dispatchRunAndGates(ctx(dir, paths, ['lanes']))).rejects.toMatchObject({
      code: 'RUN-048',
    });
  });

  it('lists real lanes for real, through a real, completed run', async () => {
    const { dir, paths } = await freshProject();
    await dispatchRunAndGates(ctx(dir, paths, ['run', WORKFLOW_ID], true));
    expect(await dispatchRunAndGates(ctx(dir, paths, ['lanes']))).toBe(0);
  }, 20_000);

  it('lists every real gate from a real project\'s own .forge/checks/ via "gate list"', async () => {
    const { dir, paths } = await freshProject();
    const result = await captureLogs(() =>
      dispatchRunAndGates(ctx(dir, paths, ['gate', 'list'], true)),
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.lines[0] ?? '{}') as {
      readonly gates: readonly { readonly id: string }[];
    };
    expect(parsed.gates.some((gate) => gate.id === GATE_ID)).toBe(true);
  });

  it('lists every real gate in plain text (no --json)', async () => {
    const { dir, paths } = await freshProject();
    const result = await captureLogs(() => dispatchRunAndGates(ctx(dir, paths, ['gate', 'list'])));
    expect(result.exitCode).toBe(0);
    expect(result.lines[0]).toContain(GATE_ID);
  });

  it('exits 2 for "gate list --run <id>" -- list takes no real --run at all', async () => {
    const { dir, paths } = await freshProject();
    await expect(
      dispatchRunAndGates(ctx(dir, paths, ['gate', 'list', '--run', 'r1'])),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('runs a real run, then "gate check <id>" for real against a real, passing gate', async () => {
    const { dir, paths } = await freshProject();
    await dispatchRunAndGates(ctx(dir, paths, ['run', WORKFLOW_ID], true));
    const exitCode = await dispatchRunAndGates(ctx(dir, paths, ['gate', 'check', GATE_ID]));
    expect(exitCode).toBe(0);
  }, 20_000);

  it('runs a real run, then "gate check <id>" against a real, failing gate, exiting 3', async () => {
    const { dir, paths } = await freshProject();
    await dispatchRunAndGates(ctx(dir, paths, ['run', WORKFLOW_ID], true));
    const exitCode = await dispatchRunAndGates(ctx(dir, paths, ['gate', 'check', FAILING_GATE_ID]));
    expect(exitCode).toBe(3);
  }, 20_000);

  it('exits 2 for "gate reject <id>" with no --reason', async () => {
    const { dir, paths } = await freshProject();
    await dispatchRunAndGates(ctx(dir, paths, ['run', WORKFLOW_ID], true));
    expect(await dispatchRunAndGates(ctx(dir, paths, ['gate', 'reject', GATE_ID]))).toBe(2);
  }, 20_000);

  it('runs a real run, then "gate approve <id> --json" for real', async () => {
    const { dir, paths } = await freshProject();
    await dispatchRunAndGates(ctx(dir, paths, ['run', WORKFLOW_ID], true));
    const result = await captureLogs(() =>
      dispatchRunAndGates(ctx(dir, paths, ['gate', 'approve', GATE_ID], true)),
    );
    expect(result.exitCode).toBe(0);
  }, 20_000);

  it('exits 2 for "gate waive <id>" with none of --reason/--owner/--expires', async () => {
    const { dir, paths } = await freshProject();
    await dispatchRunAndGates(ctx(dir, paths, ['run', WORKFLOW_ID], true));
    expect(await dispatchRunAndGates(ctx(dir, paths, ['gate', 'waive', FAILING_GATE_ID]))).toBe(2);
  }, 20_000);

  it('runs a real run, then "gate waive <id> --reason --owner --expires" for real', async () => {
    const { dir, paths } = await freshProject();
    await dispatchRunAndGates(ctx(dir, paths, ['run', WORKFLOW_ID], true));
    // `gates.waiverMaxDays` caps a real waiver at 90 days from grant -- 30 real days out stays well
    // inside that cap regardless of when this test actually runs.
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const exitCode = await dispatchRunAndGates(
      ctx(dir, paths, [
        'gate',
        'waive',
        FAILING_GATE_ID,
        '--reason',
        'a known, accepted flake',
        '--owner',
        'fixture-owner',
        '--expires',
        expiresAt,
      ]),
    );
    // The waived gate's own underlying check still genuinely fails (`always-fail`'s real exit 0
    // with a matching `failOn`) -- a real waiver records the exception, it does not retroactively
    // make the check itself pass, so `report.passed` is still `false` here (exit 3).
    expect(exitCode).toBe(3);
  }, 20_000);

  it('exits 2 for a real, unrecognised "gate" subcommand', async () => {
    const { dir, paths } = await freshProject();
    expect(await dispatchRunAndGates(ctx(dir, paths, ['gate', 'bogus']))).toBe(2);
  });

  it('exits 2 for "pause"/"resume"/"abort"/"lanes" given a real, unrecognised flag', async () => {
    const { dir, paths } = await freshProject();
    await expect(dispatchRunAndGates(ctx(dir, paths, ['pause', '--bogus']))).rejects.toMatchObject({
      code: 'USR-002',
    });
  });

  it('runs "parity capture --json" for real end to end', async () => {
    const { dir, paths } = await freshProject();
    const result = await captureLogs(() =>
      dispatchRunAndGates(ctx(dir, paths, ['parity', 'capture'], true)),
    );
    expect(result.exitCode).toBe(0);
  });

  it('exits 2 for a real, unrecognised "parity" subcommand', async () => {
    const { dir, paths } = await freshProject();
    expect(await dispatchRunAndGates(ctx(dir, paths, ['parity', 'bogus']))).toBe(2);
  });

  it('refuses a real RUN-132 for "parity capture --name <name>" naming a declaration that does not exist', async () => {
    const { dir, paths } = await freshProject();
    // The real, explicit `--name` branch (never previously exercised): `runParityCapture` itself
    // validates the name against `.forge/parity/`'s own real declarations, none of which exist in
    // this fixture -- a real, typed refusal, not a silent "capture everything" fallback.
    await expect(
      dispatchRunAndGates(ctx(dir, paths, ['parity', 'capture', '--name', 'fixture-capture'])),
    ).rejects.toMatchObject({ code: 'RUN-132' });
  });

  it('refuses a real RUN-140 for "parity check --name --story --no-record" naming a declaration that does not exist', async () => {
    const { dir, paths } = await freshProject();
    await expect(
      dispatchRunAndGates(
        ctx(dir, paths, [
          'parity',
          'check',
          '--name',
          'fixture-capture',
          '--story',
          'STORY-001',
          '--no-record',
        ]),
      ),
    ).rejects.toMatchObject({ code: 'RUN-140' });
  });

  it('runs "parity check --json --no-record" for real end to end, a real "invalid"/"no-declarations" verdict', async () => {
    const { dir, paths } = await freshProject();
    const result = await captureLogs(() =>
      dispatchRunAndGates(ctx(dir, paths, ['parity', 'check', '--no-record'], true)),
    );
    // No real `.forge/parity/*.parity.yaml` declaration exists in this fixture -- a real,
    // disclosed "invalid" verdict (treated as a real failure, exit 1), never a silent, vacuous
    // pass for "nothing to check."
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.lines[0] ?? '{}') as {
      readonly verdict: string;
      readonly reason: string;
      readonly failing: number;
    };
    expect(parsed.verdict).toBe('invalid');
    expect(parsed.reason).toBe('no-declarations');
    expect(parsed.failing).toBe(1);
  });

  it('runs "parity check --trusted @trunk --no-record" for real, resolving the real configured trunk', async () => {
    const { dir, paths } = await freshProject();
    // `--no-record` means `resolveTrunkForTrustedFlag` takes its own, separate, tolerant read
    // (never the one `runParityCommand` already made) -- a real, valid `.forge/config.yaml`
    // resolves `@trunk` to its own real `vcs.trunk`, never falling back to the schema default.
    const exitCode = await dispatchRunAndGates(
      ctx(dir, paths, ['parity', 'check', '--trusted', '@trunk', '--no-record']),
    );
    expect(exitCode).toBe(1);
  });

  it('exits 2 for "parity check" given a real, unexpected extra positional', async () => {
    const { dir, paths } = await freshProject();
    await expect(
      dispatchRunAndGates(ctx(dir, paths, ['parity', 'check', 'extra'])),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('exits 2 for "evidence" with no real subcommand', async () => {
    const { dir, paths } = await freshProject();
    expect(await dispatchRunAndGates(ctx(dir, paths, ['evidence']))).toBe(2);
  });

  it('runs "evidence prune --json" for real, a dry run that writes nothing', async () => {
    const { dir, paths } = await freshProject();
    const result = await captureLogs(() =>
      dispatchRunAndGates(ctx(dir, paths, ['evidence', 'prune'], true)),
    );
    expect(result.exitCode).toBe(0);
  });

  it('runs "evidence prune --apply --json" for real, the real "removed" (not "would remove") branch', async () => {
    const { dir, paths } = await freshProject();
    const result = await captureLogs(() =>
      dispatchRunAndGates(ctx(dir, paths, ['evidence', 'prune', '--apply'], true)),
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.lines[0] ?? '{}') as {
      readonly kept: readonly unknown[];
      readonly removed: readonly unknown[];
    };
    expect(Array.isArray(parsed.removed)).toBe(true);
  });

  it('exits 2 for "evidence prune" given a real, unexpected extra positional', async () => {
    const { dir, paths } = await freshProject();
    await expect(
      dispatchRunAndGates(ctx(dir, paths, ['evidence', 'prune', 'extra'])),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('exits 2 for "merge" with neither --lane nor --all', async () => {
    const { dir, paths } = await freshProject();
    expect(await dispatchRunAndGates(ctx(dir, paths, ['merge']))).toBe(2);
  });

  it('refuses the real, already-disclosed USR-003 for "merge --abort"', async () => {
    const { dir, paths } = await freshProject();
    await expect(dispatchRunAndGates(ctx(dir, paths, ['merge', '--abort']))).rejects.toBeDefined();
  });

  it('runs a real run, then "merge --all" for real, a real, empty result (nothing ready)', async () => {
    const { dir, paths } = await freshProject();
    await dispatchRunAndGates(ctx(dir, paths, ['run', WORKFLOW_ID], true));
    const exitCode = await dispatchRunAndGates(ctx(dir, paths, ['merge', '--all']));
    expect(exitCode).toBe(0);
  }, 20_000);

  it('runs a real run, then "merge --lane <id>" for real (the single-lane branch, not --all)', async () => {
    const { dir, paths } = await freshProject();
    await dispatchRunAndGates(ctx(dir, paths, ['run', WORKFLOW_ID], true));
    // This fixture workflow declares no real parallel lane -- a real, honest rejection (the lane
    // this dispatch's own `mergeLane` call looks for genuinely does not exist) still proves the
    // `laneId`-not-`--all` branch itself runs, as distinct from the `--all` branch above.
    await expect(
      dispatchRunAndGates(ctx(dir, paths, ['merge', '--lane', 'lane-1'])),
    ).rejects.toBeDefined();
  }, 20_000);

  it('runs a real run, then "land --json" for real, a real no-op (nothing to land)', async () => {
    const { dir, paths } = await freshProject();
    await dispatchRunAndGates(ctx(dir, paths, ['run', WORKFLOW_ID], true));
    const result = await captureLogs(() => dispatchRunAndGates(ctx(dir, paths, ['land'], true)));
    expect(result.exitCode).toBe(0);
  }, 20_000);

  it('refuses RUN-048 for "land" with no --run and no real last-run.json', async () => {
    const { dir, paths } = await freshProject();
    await expect(dispatchRunAndGates(ctx(dir, paths, ['land']))).rejects.toMatchObject({
      code: 'RUN-048',
    });
  });

  it('exits 2 for "land" given a real, unexpected extra positional', async () => {
    const { dir, paths } = await freshProject();
    await expect(dispatchRunAndGates(ctx(dir, paths, ['land', 'extra']))).rejects.toMatchObject({
      code: 'USR-002',
    });
  });

  it('runs "logs" for real against a real, completed run\'s own real event log', async () => {
    const { dir, paths } = await freshProject();
    await dispatchRunAndGates(ctx(dir, paths, ['run', WORKFLOW_ID], true));
    expect(await dispatchRunAndGates(ctx(dir, paths, ['logs']))).toBe(0);
  }, 20_000);

  it('runs "logs --step <id>" for real, the real explicit --step filter branch', async () => {
    const { dir, paths } = await freshProject();
    await dispatchRunAndGates(ctx(dir, paths, ['run', WORKFLOW_ID], true));
    expect(
      await dispatchRunAndGates(ctx(dir, paths, ['logs', '--step', 'dispatch-fixture:prepare'])),
    ).toBe(0);
  }, 20_000);

  it('refuses USR-003 for "logs --follow"/"logs --lane"', async () => {
    const { dir, paths } = await freshProject();
    await expect(dispatchRunAndGates(ctx(dir, paths, ['logs', '--follow']))).rejects.toMatchObject({
      code: 'USR-003',
    });
    await expect(
      dispatchRunAndGates(ctx(dir, paths, ['logs', '--lane', 'x'])),
    ).rejects.toMatchObject({ code: 'USR-003' });
  });
});
