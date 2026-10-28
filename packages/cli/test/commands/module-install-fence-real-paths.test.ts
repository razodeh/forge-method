/**
 * `withManifestLock`'s own write-time fencing (`module.ts`'s top-of-file doc comment, fix 2) -- driven
 * through the REAL, public `moduleAdd`/`moduleRemove`/`moduleUpdate`/`overlayAdd` entry points, not a
 * synthetic `withManifestLock` callback.
 *
 * **Round-3 critic finding, fixed here.** `module.test.ts`'s own "withManifestLock -- write-time
 * fencing at the EARLY write point" tests (and `overlay.test.ts`'s equivalent) only ever drove
 * `withManifestLock`'s generic retry mechanism through a hand-written `fn` callback -- never the real
 * `moduleAddLocked`/`moduleRemoveLocked`/`moduleUpdateLocked`/`overlayAddLocked` functions this round's
 * actual production fix added `verifyFence()` calls to. A critic proved this by commenting out all 4
 * of those real calls and running the full `module.test.ts` + `overlay.test.ts` suites: 58/58 still
 * passed, zero failures -- removing the real fix was completely invisible to the existing test suite.
 *
 * This file drives the real call paths instead, injecting the identical "lock file reassigned to a
 * different real pid mid-operation" anomaly `collection-lock.test.ts`/`module.test.ts`'s own synthetic
 * tests already use, timed via a `@forge/core` `readTextFile` spy to land during each function's own
 * very first operation (reading `manifest.yaml`, `readManifestDoc`'s own call, common to all four
 * functions) -- well before any of their own early fence points (`installBundleTree`/`rm(destAbs,
 * ...)`). The anomaly is deliberately never "handed back": the rival pid is left on the lock file for
 * the rest of the attempt, the same real race shape `module.test.ts`'s own synthetic tests use.
 *
 * Because `withManifestLock` ALSO still has its own, already-correctly-tested LATER fence (immediately
 * before `writeManifestDocument`), a persistent, never-reverted rival pid gets caught by *whichever*
 * fence call runs first -- which means the FINAL manifest/filesystem state ends up identical whether
 * the early fence fires or not (the later one forces an identical full retry either way). A test that
 * only asserts final state would therefore NOT actually kill the mutation of removing the early fence
 * alone. The real, load-bearing signal used below instead is how many times the early-fenced write
 * itself (`installBundleTree`'s own `cp` into a staging directory, or `moduleRemoveLocked`'s own
 * `rm(destAbs, ...)`) actually ran: with the early fence intact, it runs exactly once (the fenced first
 * attempt never reaches it); with the early fence removed, it runs twice (once wastefully, on stale
 * pre-concurrent-write data, before the later fence catches the still-reassigned lock and forces a
 * second, correct attempt). This is proved by mutation testing in the round-3 report for this piece:
 * commenting out each real early `verifyFence()` call makes its own test here fail on exactly this
 * count, and restoring it makes the test pass again.
 *
 * In a file of its own, not added to `module.test.ts`/`overlay.test.ts` directly, for the identical
 * reason `backup-retry.test.ts`/`context-ancestor-walk.test.ts` already establish: `vi.mock` replaces
 * the whole module every importer in this file sees, and isolating that to a dedicated file keeps it
 * from touching either of those two files' own large, unrelated test suites.
 *
 * @see packages/cli/test/commands/upgrade/backup-retry.test.ts
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as YAML from 'yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as ForgeCore from '@forge/core';
import type * as NodeFsPromises from 'node:fs/promises';

import type { InstallOptions, ModuleCommandContext } from '../../src/commands/module.ts';

/** Mutable, per-test-configured injection/observation state -- `vi.hoisted` so the `vi.mock` factories
 * below (themselves hoisted above every import) can close over the exact same objects the tests
 * configure later. */
const { coreHarness, fsHarness } = vi.hoisted(() => ({
  coreHarness: {
    /** The exact `manifest.yaml` path to watch for -- `undefined` disarms injection entirely (every
     * read passes straight through), so setup work (`createTestProject`, writing module bundles, ...)
     * before a test arms this is never affected. */
    watchPath: undefined as string | undefined,
    injected: false,
    onFirstRead: undefined as (() => Promise<void>) | undefined,
  },
  fsHarness: {
    /** Every destination `node:fs/promises` `cp` was called with -- `installBundleTree`'s own
     * staging-then-rename copy, one call per real invocation of that function. */
    cpDestinations: [] as string[],
    /** Every path `node:fs/promises` `rm` was called with -- filtered per-test to the one exact
     * `destAbs` under observation. */
    rmPaths: [] as string[],
  },
}));

vi.mock('@forge/core', async (importOriginal) => {
  const actual = await importOriginal<typeof ForgeCore>();
  return {
    ...actual,
    readTextFile: (async (target: Parameters<typeof actual.readTextFile>[0]) => {
      if (
        !coreHarness.injected &&
        coreHarness.watchPath !== undefined &&
        target === coreHarness.watchPath
      ) {
        coreHarness.injected = true;
        // Captured BEFORE the injected mutation below lands -- the stale, pre-concurrent-write content
        // a real race would hand this process's own in-flight read, the identical "capture, then
        // mutate, then return the STALE value" shape `events.test.ts`'s own fix-3 test uses.
        const staleContent = await actual.readTextFile(target);
        if (coreHarness.onFirstRead !== undefined) await coreHarness.onFirstRead();
        return staleContent;
      }
      return actual.readTextFile(target);
    }) as typeof actual.readTextFile,
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsPromises>();
  return {
    ...actual,
    cp: (async (...args: Parameters<typeof actual.cp>) => {
      fsHarness.cpDestinations.push(String(args[1]));
      return actual.cp(...args);
    }) as typeof actual.cp,
    rm: (async (...args: Parameters<typeof actual.rm>) => {
      fsHarness.rmPaths.push(String(args[0]));
      return actual.rm(...args);
    }) as typeof actual.rm,
  };
});

const { moduleAdd, moduleRemove, moduleUpdate, readManifestDocument, writeManifestDocument } =
  await import('../../src/commands/module.ts');
const { overlayAdd } = await import('../../src/commands/overlay.ts');
const { cleanupAll, createTestProject, registerCleanup } = await import('./upgrade/helpers.ts');

afterEach(() => {
  coreHarness.watchPath = undefined;
  coreHarness.injected = false;
  coreHarness.onFirstRead = undefined;
  fsHarness.cpDestinations = [];
  fsHarness.rmPaths = [];
  return cleanupAll();
});

interface ModuleBundleOverrides {
  readonly id?: string;
  readonly version?: string;
}

async function writeModuleBundle(
  dir: string,
  overrides: ModuleBundleOverrides = {},
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const doc = {
    id: overrides.id ?? 'sample-mod',
    name: 'Sample Module',
    version: overrides.version ?? '1.0.0',
    forgeVersion: '>=1.0 <2',
    requires: [],
    conflicts: [],
    levels: ['L1'],
    ceilings: {},
    provides: {},
  };
  await writeFile(path.join(dir, 'module.yaml'), YAML.stringify(doc));
}

async function writeOverlayBundle(dir: string, id: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'overlay.yaml'),
    YAML.stringify({ id, name: 'Overlay', version: '1.0.0', forgeVersion: '>=1.0 <2' }),
  );
}

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  registerCleanup(dir);
  return dir;
}

/** A real, genuinely-dead pid -- spawned then confirmed exited -- the identical technique
 * `collection-lock.test.ts`/`module.test.ts`'s own `realDeadPid` already establish for this exact
 * anomaly-injection shape. */
async function realDeadPid(): Promise<number> {
  const child = spawn('node', ['-e', 'process.exit(0)']);
  const pid = child.pid;
  if (pid === undefined) throw new Error('child process has no pid');
  await new Promise((resolve) => child.on('exit', resolve));
  return pid;
}

function installOptions(overrides: Partial<InstallOptions> = {}): InstallOptions {
  return { workDir: '', npmCwd: '', forgeVersion: '1.4.0', consent: { yes: true }, ...overrides };
}

function ctxFor(project: {
  readonly paths: ModuleCommandContext['paths'];
  readonly modulesDir: string;
}): ModuleCommandContext {
  return { paths: project.paths, modulesDir: project.modulesDir };
}

/** Arms the injection for the operation under test: on the first real read of `manifestPath`, reassigns
 * the lock file to `rivalPid` (never reverted -- the same persistent-until-naturally-reclaimed shape
 * `module.test.ts`'s own synthetic fence tests use) and adds a synthetic `concurrent-mod` row directly
 * to the manifest, standing in for a rival process's own, independently-successful full install cycle
 * landing in the gap between this process's own manifest read and its later write. */
function armConcurrentWriterAnomaly(
  manifestPath: string,
  lockPath: string,
  rivalPid: number,
  paths: ModuleCommandContext['paths'],
): void {
  // Reset the counters here, immediately before the operation under test -- not just in `afterEach` --
  // since any SETUP call made earlier in the same test (e.g. `moduleUpdate`'s own test installs a real
  // v1 first, and `installBundleTree` itself does its own internal, unrelated `rm(destAbs, ...)` to
  // clear any prior content before every rename) would otherwise be miscounted as part of the fenced
  // operation's own signal.
  fsHarness.cpDestinations = [];
  fsHarness.rmPaths = [];
  coreHarness.watchPath = manifestPath;
  coreHarness.injected = false;
  coreHarness.onFirstRead = async () => {
    writeFileSync(lockPath, String(rivalPid));
    const doc = await readManifestDocument(paths);
    await writeManifestDocument(paths, {
      version: 1,
      modules: [
        ...doc.modules,
        { id: 'concurrent-mod', version: '9.9.9', checksum: 'synthetic', source: 'synthetic' },
      ],
      overlays: doc.overlays,
    });
  };
}

describe('withManifestLock fencing, driven through the real public functions (round-3 fix)', () => {
  it('moduleAdd: a lock file reassigned to a different real pid between reading the manifest and installBundleTree runs installBundleTree exactly once -- the fenced first attempt never reaches it, and no concurrent writer row is lost', async () => {
    const project = await createTestProject();
    const bundleDir = await tempDir('forge-module-fence-add-');
    await writeModuleBundle(bundleDir, { id: 'acme-mod' });
    const rivalPid = await realDeadPid();
    const lockPath = project.paths.resolveState('module-install.lock');
    const manifestPath = project.paths.resolveWithin('.forge/manifest.yaml');
    armConcurrentWriterAnomaly(manifestPath, lockPath, rivalPid, project.paths);

    const report = await moduleAdd(ctxFor(project), 'acme-mod', bundleDir, installOptions());

    expect(report.action).toBe('installed');
    const stagingCpCalls = fsHarness.cpDestinations.filter((dest) =>
      dest.includes('.install-staging-'),
    );
    // THE MUTATION-KILLING SIGNAL -- see this file's own top-of-file doc comment for the full
    // reasoning: exactly 1 with the real early fence intact. Comment out `moduleAddLocked`'s own early
    // `verifyFence()` call (immediately before its `installBundleTree` call) and this becomes 2.
    expect(stagingCpCalls).toHaveLength(1);

    const manifest = await readManifestDocument(project.paths);
    expect(manifest.modules.some((module) => module.id === 'concurrent-mod')).toBe(true);
    expect(manifest.modules.some((module) => module.id === 'acme-mod')).toBe(true);
  });

  it('moduleRemove: a lock file reassigned to a different real pid between reading the manifest and the destructive rm(destAbs) runs that rm exactly once -- the fenced first attempt never reaches it, and no concurrent writer row is lost', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    const bundleDir = await tempDir('forge-module-fence-remove-');
    await writeModuleBundle(bundleDir, { id: 'solo-mod' });
    await moduleAdd(ctx, 'solo-mod', bundleDir, installOptions());

    const rivalPid = await realDeadPid();
    const lockPath = project.paths.resolveState('module-install.lock');
    const manifestPath = project.paths.resolveWithin('.forge/manifest.yaml');
    const destAbs = project.paths.resolveWithin('.forge/modules/solo-mod');
    armConcurrentWriterAnomaly(manifestPath, lockPath, rivalPid, project.paths);

    const report = await moduleRemove(ctx, 'solo-mod');

    expect(report.action).toBe('removed');
    const destRmCalls = fsHarness.rmPaths.filter((rmPath) => rmPath === destAbs);
    // THE MUTATION-KILLING SIGNAL -- exactly 1 with the real early fence intact. Comment out
    // `moduleRemoveLocked`'s own early `verifyFence()` call (immediately before its `rm(destAbs, ...)`
    // call) and this becomes 2.
    expect(destRmCalls).toHaveLength(1);

    const manifest = await readManifestDocument(project.paths);
    expect(manifest.modules.some((module) => module.id === 'concurrent-mod')).toBe(true);
    expect(manifest.modules.some((module) => module.id === 'solo-mod')).toBe(false);
  });

  it('moduleUpdate: a lock file reassigned to a different real pid between reading the manifest and installBundleTree runs installBundleTree exactly once -- the fenced first attempt never reaches it, and no concurrent writer row is lost', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    const v1Dir = await tempDir('forge-module-fence-update-v1-');
    await writeModuleBundle(v1Dir, { id: 'acme-mod', version: '1.0.0' });
    await moduleAdd(ctx, 'acme-mod', v1Dir, installOptions());

    const v2Dir = await tempDir('forge-module-fence-update-v2-');
    await writeModuleBundle(v2Dir, { id: 'acme-mod', version: '2.0.0' });

    const rivalPid = await realDeadPid();
    const lockPath = project.paths.resolveState('module-install.lock');
    const manifestPath = project.paths.resolveWithin('.forge/manifest.yaml');
    armConcurrentWriterAnomaly(manifestPath, lockPath, rivalPid, project.paths);

    const report = await moduleUpdate(ctx, 'acme-mod', v2Dir, installOptions());

    expect(report).toMatchObject({ action: 'updated', version: '2.0.0' });
    const stagingCpCalls = fsHarness.cpDestinations.filter((dest) =>
      dest.includes('.install-staging-'),
    );
    // THE MUTATION-KILLING SIGNAL -- exactly 1 with the real early fence intact. Comment out
    // `moduleUpdateLocked`'s own early `verifyFence()` call (immediately before its `installBundleTree`
    // call) and this becomes 2.
    expect(stagingCpCalls).toHaveLength(1);

    const manifest = await readManifestDocument(project.paths);
    expect(manifest.modules.some((module) => module.id === 'concurrent-mod')).toBe(true);
    expect(manifest.modules.find((module) => module.id === 'acme-mod')?.version).toBe('2.0.0');
  });

  it('overlayAdd: a lock file reassigned to a different real pid between reading the manifest and installBundleTree runs installBundleTree exactly once -- the fenced first attempt never reaches it, and no concurrent writer row is lost', async () => {
    const project = await createTestProject();
    const overlayDir = await tempDir('forge-overlay-fence-add-');
    await writeOverlayBundle(overlayDir, 'acme-overlay');

    const rivalPid = await realDeadPid();
    const lockPath = project.paths.resolveState('module-install.lock');
    const manifestPath = project.paths.resolveWithin('.forge/manifest.yaml');
    armConcurrentWriterAnomaly(manifestPath, lockPath, rivalPid, project.paths);

    const report = await overlayAdd({ paths: project.paths }, overlayDir, installOptions());

    expect(report.action).toBe('installed');
    const stagingCpCalls = fsHarness.cpDestinations.filter((dest) =>
      dest.includes('.install-staging-'),
    );
    // THE MUTATION-KILLING SIGNAL -- exactly 1 with the real early fence intact. Comment out
    // `overlayAddLocked`'s own early `verifyFence()` call (immediately before its `installBundleTree`
    // call) and this becomes 2.
    expect(stagingCpCalls).toHaveLength(1);

    const manifest = await readManifestDocument(project.paths);
    expect(manifest.modules.some((module) => module.id === 'concurrent-mod')).toBe(true);
    expect(manifest.overlays.some((overlay) => overlay.id === 'acme-overlay')).toBe(true);
  });
});
