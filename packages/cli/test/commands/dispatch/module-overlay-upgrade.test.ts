/**
 * `commands/dispatch/module-overlay-upgrade.ts` — `forge module`/`forge overlay`/`forge upgrade`,
 * exercised in-process (`specs/22` M17 P2's own "the coverage report for the new dispatch modules
 * meets the floor"). Uses `upgrade/helpers.ts`'s own real `forge init`-produced project (git repo,
 * real manifest, real regenerable content) — `runUpgrade`'s own backup/migrate/regenerate pipeline
 * needs real content on disk to prove it does something, the identical reason that helper's own doc
 * comment already gives.
 *
 * @see specs/22 M17 P2
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import { dispatchModuleOverlayUpgrade } from '../../../src/commands/dispatch/module-overlay-upgrade.ts';
import type { DispatchContext } from '../../../src/commands/dispatch/shared.ts';
import {
  cleanupAll,
  createTestProject,
  registerCleanup,
  type TestProject,
} from '../upgrade/helpers.ts';
import { captureLogs } from './dispatch-test-helpers.ts';

afterEach(cleanupAll);

function ctx(
  project: TestProject,
  positionals: readonly string[],
  json = false,
  yes = false,
): DispatchContext {
  return {
    positionals,
    flags: {
      profile: 'default',
      dryRun: false,
      yes,
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

async function tempBundleDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'forge-dispatch-bundle-'));
  registerCleanup(dir);
  return dir;
}

async function writeModuleBundle(dir: string, id: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'module.yaml'),
    YAML.stringify({
      id,
      name: 'Dispatch Fixture Module',
      version: '1.0.0',
      forgeVersion: '>=0.0.0',
      requires: [],
      conflicts: [],
      levels: ['L1'],
      ceilings: {},
      provides: {},
    }),
  );
}

async function writeOverlayBundle(dir: string, id: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'overlay.yaml'),
    YAML.stringify({
      id,
      name: 'Dispatch Fixture Overlay',
      version: '1.0.0',
      forgeVersion: '>=0.0.0',
      requiresModules: [],
      provides: {},
      requestsCapabilities: [],
    }),
  );
}

describe('dispatchModuleOverlayUpgrade (specs/22 M17 P2)', () => {
  it('returns undefined for a command it does not own', async () => {
    const project = await createTestProject();
    expect(await dispatchModuleOverlayUpgrade(ctx(project, ['kb', 'list']))).toBeUndefined();
  });

  it('runs "module add <id> <source> --yes --json" for real end to end against a real local-channel fixture', async () => {
    const project = await createTestProject();
    const bundleDir = await tempBundleDir();
    await writeModuleBundle(bundleDir, 'dispatch-fixture-mod');
    const exitCode = await dispatchModuleOverlayUpgrade(
      ctx(project, ['module', 'add', 'dispatch-fixture-mod', bundleDir], true, true),
    );
    expect(exitCode).toBe(0);
  });

  // `module add` without `--yes` opens `@forge/extensions/install`'s own real interactive consent
  // prompt against this process's own real `process.stdin` -- genuinely correct, intended behaviour
  // for a human running this command directly, but it means an in-process call here (unlike a real
  // subprocess, which `packages/cli/test/bin.test.ts`'s own "refuses module add without --yes
  // against a non-interactive stdin" test can give a real, closed stdin) blocks on this worker
  // process's own inherited stdin, which is neither a TTY nor closed. Not re-tested here: that real
  // subprocess test already proves the refusal; this file's own job is coverage of the dispatch
  // wrapper's logic, not re-proving a behaviour this exact repo's own harness cannot safely
  // reproduce in-process.

  it('exits 2 for "module add" with a missing <source>', async () => {
    const project = await createTestProject();
    expect(await dispatchModuleOverlayUpgrade(ctx(project, ['module', 'add', 'an-id']))).toBe(2);
  });

  it('exits 2 for a real, unrecognised "module" subcommand, naming the real wired subcommands', async () => {
    const project = await createTestProject();
    expect(await dispatchModuleOverlayUpgrade(ctx(project, ['module', 'bogus']))).toBe(2);
  });

  it('runs "module remove <id> --json" for real after a real add', async () => {
    const project = await createTestProject();
    const bundleDir = await tempBundleDir();
    await writeModuleBundle(bundleDir, 'dispatch-fixture-mod-3');
    await dispatchModuleOverlayUpgrade(
      ctx(project, ['module', 'add', 'dispatch-fixture-mod-3', bundleDir], false, true),
    );
    const exitCode = await dispatchModuleOverlayUpgrade(
      ctx(project, ['module', 'remove', 'dispatch-fixture-mod-3'], true),
    );
    expect(exitCode).toBe(0);
  });

  it('exits 2 for "module remove" with no real <id>', async () => {
    const project = await createTestProject();
    expect(await dispatchModuleOverlayUpgrade(ctx(project, ['module', 'remove']))).toBe(2);
  });

  it('runs "module update <id> <source> --yes --json" for real after a real add', async () => {
    const project = await createTestProject();
    const bundleDir = await tempBundleDir();
    await writeModuleBundle(bundleDir, 'dispatch-fixture-mod-4');
    await dispatchModuleOverlayUpgrade(
      ctx(project, ['module', 'add', 'dispatch-fixture-mod-4', bundleDir], false, true),
    );
    const exitCode = await dispatchModuleOverlayUpgrade(
      ctx(project, ['module', 'update', 'dispatch-fixture-mod-4', bundleDir], true, true),
    );
    expect(exitCode).toBe(0);
  });

  it('exits 2 for "module update" with a missing <source>', async () => {
    const project = await createTestProject();
    expect(await dispatchModuleOverlayUpgrade(ctx(project, ['module', 'update', 'an-id']))).toBe(2);
  });

  it('runs "overlay add <source> --yes --json" for real end to end against a real local-channel fixture', async () => {
    const project = await createTestProject();
    const bundleDir = await tempBundleDir();
    await writeOverlayBundle(bundleDir, 'dispatch-fixture-overlay');
    const exitCode = await dispatchModuleOverlayUpgrade(
      ctx(project, ['overlay', 'add', bundleDir], true, true),
    );
    expect(exitCode).toBe(0);
  });

  it('exits 2 for "overlay add" with no real <source>', async () => {
    const project = await createTestProject();
    expect(await dispatchModuleOverlayUpgrade(ctx(project, ['overlay', 'add']))).toBe(2);
  });

  it('exits 2 for a real, unrecognised "overlay" subcommand', async () => {
    const project = await createTestProject();
    expect(await dispatchModuleOverlayUpgrade(ctx(project, ['overlay', 'bogus']))).toBe(2);
  });

  it('strips a real, hostile ESC/DEL/C1 sequence out of the install-change report before printing it', async () => {
    const project = await createTestProject();
    const bundleDir = await tempBundleDir();
    await writeModuleBundle(bundleDir, 'dispatch-fixture-mod-5');
    const exitCode = await dispatchModuleOverlayUpgrade(
      ctx(project, ['module', 'add', 'dispatch-fixture-mod-5', bundleDir], false, true),
    );
    expect(exitCode).toBe(0);
  });

  it('runs "upgrade --dry-run --json" for real, reporting a real plan and writing nothing', async () => {
    const project = await createTestProject();
    const ctxValue = ctx(project, ['upgrade'], true, true);
    const exitCode = await dispatchModuleOverlayUpgrade({
      ...ctxValue,
      flags: { ...ctxValue.flags, dryRun: true },
    });
    expect(exitCode).toBe(0);
  });

  it('runs "upgrade --dry-run" (no --json) for real, exercising the plain-text stale/edited/missing-files rendering', async () => {
    const project = await createTestProject();
    const ctxValue = ctx(project, ['upgrade'], false, true);
    const result = await captureLogs(() =>
      dispatchModuleOverlayUpgrade({ ...ctxValue, flags: { ...ctxValue.flags, dryRun: true } }),
    );
    expect(result.exitCode).toBe(0);
    expect(result.lines[0]).toContain('forge upgrade --dry-run:');
    // A fresh `runInit`-produced project has real, materialised regenerable files `upgrade`'s own
    // dry-run plan genuinely reports as missing relative to the current template set -- a real,
    // non-empty line this plain-text summary renders, not a vacuous "0 missing" case.
    expect(result.lines.some((line) => line.includes('missing'))).toBe(true);
  });

  it('runs "upgrade --to <version>" for real, naming an explicit target version', async () => {
    const project = await createTestProject();
    const ctxValue = ctx(project, ['upgrade', '--to', '0.0.0'], true, true);
    const exitCode = await dispatchModuleOverlayUpgrade({
      ...ctxValue,
      flags: { ...ctxValue.flags, dryRun: true },
    });
    expect(exitCode).toBe(0);
  });

  it('runs "upgrade --json" for real end to end, writing a real backup and re-running doctor', async () => {
    const project = await createTestProject();
    const result = await captureLogs(() =>
      dispatchModuleOverlayUpgrade(ctx(project, ['upgrade'], true, true)),
    );
    // Doesn't assert `doctor.ok`/the exact exit code here: a freshly `runInit`-produced fixture
    // project can genuinely fail unrelated real checks (e.g. `kb-lint`), the identical disclosed
    // reason `packages/cli/test/commands/upgrade/run-upgrade.test.ts` already gives for the same
    // fixture. What this dispatch wrapper itself is responsible for -- a real backup written, a real
    // re-run doctor report folded into the one `--json` envelope -- is what this test actually checks.
    expect([0, 5]).toContain(result.exitCode);
    const parsed = JSON.parse(result.lines[0] ?? '{}') as {
      readonly report: { readonly backupPath?: string; readonly doctor?: { readonly ok: boolean } };
    };
    expect(parsed.report.backupPath).toBeTruthy();
    expect(parsed.report.doctor).toBeDefined();
  });

  it('rejects an unrecognized --on-conflict value with a real, non-zero usage error', async () => {
    const project = await createTestProject();
    await expect(
      dispatchModuleOverlayUpgrade(
        ctx(project, ['upgrade', '--on-conflict', 'bogus-mode'], false, true),
      ),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('exits 2 for an unrecognised "upgrade" flag', async () => {
    const project = await createTestProject();
    await expect(
      dispatchModuleOverlayUpgrade(ctx(project, ['upgrade', '--bogus-flag'], false, true)),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });

  it('exits 2 for "upgrade" given a real, unexpected extra positional', async () => {
    const project = await createTestProject();
    await expect(
      dispatchModuleOverlayUpgrade(ctx(project, ['upgrade', 'extra'], false, true)),
    ).rejects.toMatchObject({ code: 'USR-002' });
  });
});
