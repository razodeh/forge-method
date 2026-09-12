/**
 * `forge module <list|info|add|remove|update>` (`19` §19.5, `PLAN-M11.md` P5).
 */
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
// Test-only (`*.test.ts` files are exempted from the "no bare tmpdir" rule — see
// `packages/extensions/test/install/npm-fixture-registry.ts`'s own identical note).
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Writable } from 'node:stream';

import { execa } from 'execa';
import * as YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import {
  moduleAdd,
  moduleInfo,
  moduleList,
  moduleRemove,
  moduleUpdate,
  readManifestDocument,
  type InstallOptions,
  type ModuleCommandContext,
} from '../../src/commands/module.ts';
import { cleanupAll, createTestProject, registerCleanup } from './upgrade/helpers.ts';

afterEach(cleanupAll);

const FORGE_VERSION = '1.4.0';

interface ModuleBundleOverrides {
  readonly id?: string;
  readonly version?: string;
  readonly forgeVersion?: string;
  readonly requires?: readonly string[];
  readonly conflicts?: readonly string[];
  readonly ceilings?: Record<string, unknown>;
  /** Written as `skills/rogue/SKILL.md` when present — lets a test inject secret/injection-shaped
   * content the static safety scan (`PLAN-M11.md` P4) is supposed to refuse. */
  readonly rogueSkillBody?: string;
}

async function writeModuleBundle(dir: string, overrides: ModuleBundleOverrides = {}): Promise<void> {
  await mkdir(dir, { recursive: true });
  const doc = {
    id: overrides.id ?? 'sample-mod',
    name: 'Sample Module',
    version: overrides.version ?? '1.0.0',
    forgeVersion: overrides.forgeVersion ?? '>=1.0 <2',
    requires: overrides.requires ?? [],
    conflicts: overrides.conflicts ?? [],
    levels: ['L1'],
    ceilings: overrides.ceilings ?? {},
    provides: {},
  };
  await writeFile(path.join(dir, 'module.yaml'), YAML.stringify(doc));
  if (overrides.rogueSkillBody !== undefined) {
    const skillDir = path.join(dir, 'skills', 'rogue');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, 'SKILL.md'),
      `---\nid: rogue\nname: Rogue\n---\n${overrides.rogueSkillBody}\n`,
    );
  }
}

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  registerCleanup(dir);
  return dir;
}

function nullWritable(): Writable {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
}

function installOptions(overrides: Partial<InstallOptions> = {}): InstallOptions {
  const consent = overrides.consent === undefined ? undefined : { output: nullWritable(), ...overrides.consent };
  return {
    workDir: '',
    npmCwd: '',
    forgeVersion: FORGE_VERSION,
    ...overrides,
    ...(consent === undefined ? {} : { consent }),
  };
}

function ctxFor(project: {
  readonly paths: ModuleCommandContext['paths'];
  readonly modulesDir: string;
}): ModuleCommandContext {
  return { paths: project.paths, modulesDir: project.modulesDir };
}

describe('moduleList / moduleInfo', () => {
  it('lists every real, installed module row from the real manifest', async () => {
    const project = await createTestProject();
    const modules = await moduleList({ paths: project.paths, modulesDir: project.modulesDir });
    expect(modules.some((module) => module.id === 'fixture-mod')).toBe(true);
  });

  it('shows real manifest data plus real agent ids for one real module', async () => {
    const project = await createTestProject();
    const info = await moduleInfo(
      { paths: project.paths, modulesDir: project.modulesDir },
      'fixture-mod',
    );
    expect(info.manifest.id).toBe('fixture-mod');
    expect(info.agentIds).toContain('tester');
  });

  it('throws KB-015 for a module id that is not really installed', async () => {
    const project = await createTestProject();
    await expect(
      moduleInfo({ paths: project.paths, modulesDir: project.modulesDir }, 'not-real'),
    ).rejects.toMatchObject({ code: 'KB-015' });
  });

  it('throws CFG-017 when the project has never been initialized (no real manifest)', async () => {
    const project = await createTestProject();
    await rm(path.join(project.dir, '.forge/manifest.yaml'));
    await expect(
      moduleList({ paths: project.paths, modulesDir: project.modulesDir }),
    ).rejects.toMatchObject({ code: 'CFG-017' });
  });

  it('reports a real, empty module list for a real manifest with no modules field at all', async () => {
    const project = await createTestProject();
    await writeFile(path.join(project.dir, '.forge/manifest.yaml'), 'version: 1\n');
    const modules = await moduleList({ paths: project.paths, modulesDir: project.modulesDir });
    expect(modules).toEqual([]);
  });

  it('reports a real, empty agentIds list for the synthetic @forge/templates row', async () => {
    const project = await createTestProject();
    const info = await moduleInfo(
      { paths: project.paths, modulesDir: project.modulesDir },
      '@forge/templates',
    );
    expect(info.agentIds).toEqual([]);
  });
});

describe('moduleAdd — local channel', () => {
  it('installs a real local module bundle end to end: manifest row, checksum, .forge/modules content', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    const bundleDir = await tempDir('forge-module-bundle-');
    await writeModuleBundle(bundleDir, { id: 'acme-mod' });

    const report = await moduleAdd(
      ctx,
      'acme-mod',
      bundleDir,
      installOptions({ consent: { yes: true } }),
    );

    expect(report).toMatchObject({
      id: 'acme-mod',
      action: 'installed',
      version: '1.0.0',
      resolvedSetDelta: { added: ['acme-mod'], removed: [] },
    });
    expect(existsSync(path.join(project.dir, '.forge/modules/acme-mod/module.yaml'))).toBe(true);

    const manifest = await readManifestDocument(project.paths);
    const row = manifest.modules.find((module) => module.id === 'acme-mod');
    expect(row).toMatchObject({ id: 'acme-mod', version: '1.0.0', source: bundleDir });
    expect(row?.checksum).toBeTruthy();
  });

  it('refuses an id already present in the manifest (CFG-042), writing nothing', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    const bundleDir = await tempDir('forge-module-bundle-');
    await writeModuleBundle(bundleDir, { id: 'fixture-mod' });

    await expect(
      moduleAdd(ctx, 'fixture-mod', bundleDir, installOptions({ consent: { yes: true } })),
    ).rejects.toMatchObject({ code: 'CFG-042' });
    expect(existsSync(path.join(project.dir, '.forge/modules/fixture-mod'))).toBe(false);
  });

  it('refuses when the bundle declares a different id than requested (CFG-044)', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    const bundleDir = await tempDir('forge-module-bundle-');
    await writeModuleBundle(bundleDir, { id: 'real-id' });

    await expect(
      moduleAdd(ctx, 'wrong-id', bundleDir, installOptions({ consent: { yes: true } })),
    ).rejects.toMatchObject({ code: 'CFG-044' });
    expect(existsSync(path.join(project.dir, '.forge/modules/wrong-id'))).toBe(false);
  });

  it('refuses when forgeVersion does not admit the running version (CFG-024)', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    const bundleDir = await tempDir('forge-module-bundle-');
    await writeModuleBundle(bundleDir, { id: 'acme-mod', forgeVersion: '>=2.0 <3' });

    await expect(
      moduleAdd(ctx, 'acme-mod', bundleDir, installOptions({ consent: { yes: true } })),
    ).rejects.toMatchObject({ code: 'CFG-024' });
  });

  it('refuses when requires names a module not currently installed (CFG-022)', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    const bundleDir = await tempDir('forge-module-bundle-');
    await writeModuleBundle(bundleDir, { id: 'acme-mod', requires: ['not-installed'] });

    await expect(
      moduleAdd(ctx, 'acme-mod', bundleDir, installOptions({ consent: { yes: true } })),
    ).rejects.toMatchObject({ code: 'CFG-022' });
  });

  it('refuses when conflicts names a module currently installed (CFG-023)', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    const bundleDir = await tempDir('forge-module-bundle-');
    await writeModuleBundle(bundleDir, { id: 'acme-mod', conflicts: ['fixture-mod'] });

    await expect(
      moduleAdd(ctx, 'acme-mod', bundleDir, installOptions({ consent: { yes: true } })),
    ).rejects.toMatchObject({ code: 'CFG-023' });
  });

  it('refuses on consent refusal (CFG-040), leaving manifest and .forge/ untouched', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    const bundleDir = await tempDir('forge-module-bundle-');
    await writeModuleBundle(bundleDir, { id: 'acme-mod' });
    const before = await readManifestDocument(project.paths);

    await expect(
      moduleAdd(ctx, 'acme-mod', bundleDir, installOptions({ consent: { json: true } })),
    ).rejects.toMatchObject({ code: 'CFG-040' });

    expect(existsSync(path.join(project.dir, '.forge/modules/acme-mod'))).toBe(false);
    const after = await readManifestDocument(project.paths);
    expect(after).toEqual(before);
  });

  it('refuses a bundle whose skill body fails the static safety scan (CFG-037), installing nothing', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    const bundleDir = await tempDir('forge-module-bundle-');
    await writeModuleBundle(bundleDir, {
      id: 'acme-mod',
      rogueSkillBody: 'Contains a real secret: AKIAABCDEFGHIJKLMNOP in plain text.',
    });

    await expect(
      moduleAdd(ctx, 'acme-mod', bundleDir, installOptions({ consent: { yes: true } })),
    ).rejects.toMatchObject({ code: 'CFG-037' });
    expect(existsSync(path.join(project.dir, '.forge/modules/acme-mod'))).toBe(false);
  });

  it('refuses a bundle that is really an overlay (CFG-043)', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    const bundleDir = await tempDir('forge-overlay-bundle-');
    await mkdir(bundleDir, { recursive: true });
    await writeFile(
      path.join(bundleDir, 'overlay.yaml'),
      YAML.stringify({ id: 'acme-overlay', name: 'Acme', version: '1.0.0', forgeVersion: '>=1.0 <2' }),
    );

    await expect(
      moduleAdd(ctx, 'acme-overlay', bundleDir, installOptions({ consent: { yes: true } })),
    ).rejects.toMatchObject({ code: 'CFG-043' });
  });
});

describe('moduleAdd — git channel', () => {
  async function createTempGitRepo(overrides: ModuleBundleOverrides): Promise<{ url: string }> {
    const dir = await tempDir('forge-module-git-');
    await execa('git', ['init', '--quiet'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Test'], { cwd: dir });
    await writeModuleBundle(dir, overrides);
    await execa('git', ['add', '-A'], { cwd: dir });
    await execa('git', ['commit', '--quiet', '-m', 'init'], { cwd: dir });
    await execa('git', ['tag', '-a', 'v1.0.0', '-m', 'v1.0.0'], { cwd: dir });
    return { url: `file://${dir}` };
  }

  it('installs a real module fetched over the git channel', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    const { url } = await createTempGitRepo({ id: 'git-mod' });
    const workDir = await tempDir('forge-module-workdir-');

    const report = await moduleAdd(
      ctx,
      'git-mod',
      `git+${url}#v1.0.0`,
      installOptions({ workDir, consent: { yes: true } }),
    );

    expect(report.action).toBe('installed');
    expect(existsSync(path.join(project.dir, '.forge/modules/git-mod/module.yaml'))).toBe(true);
  });
});

describe('moduleAdd — npm channel dispatch', () => {
  it('reaches the real npm-spec parser for an npm: source (proves channel dispatch)', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);

    await expect(
      moduleAdd(ctx, 'acme-mod', 'npm:not-a-valid-spec', installOptions({ workDir: await tempDir('forge-module-npm-') })),
    ).rejects.toMatchObject({ code: 'CFG-029' });
  });
});

describe('moduleRemove', () => {
  it('refuses to remove a module another installed module still requires (CFG-039)', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);

    const aDir = await tempDir('forge-module-a-');
    await writeModuleBundle(aDir, { id: 'mod-a' });
    await moduleAdd(ctx, 'mod-a', aDir, installOptions({ consent: { yes: true } }));

    const bDir = await tempDir('forge-module-b-');
    await writeModuleBundle(bDir, { id: 'mod-b', requires: ['mod-a'] });
    await moduleAdd(ctx, 'mod-b', bDir, installOptions({ consent: { yes: true } }));

    await expect(moduleRemove(ctx, 'mod-a')).rejects.toMatchObject({ code: 'CFG-039' });
    await expect(moduleRemove(ctx, 'mod-a')).rejects.toThrow(/mod-b/);
    expect(existsSync(path.join(project.dir, '.forge/modules/mod-a'))).toBe(true);
  });

  it('removes a real, unrequired module, updating the manifest and .forge/modules', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    const dir = await tempDir('forge-module-solo-');
    await writeModuleBundle(dir, { id: 'solo-mod' });
    await moduleAdd(ctx, 'solo-mod', dir, installOptions({ consent: { yes: true } }));

    const report = await moduleRemove(ctx, 'solo-mod');

    expect(report).toMatchObject({ id: 'solo-mod', action: 'removed' });
    expect(existsSync(path.join(project.dir, '.forge/modules/solo-mod'))).toBe(false);
    const manifest = await readManifestDocument(project.paths);
    expect(manifest.modules.some((module) => module.id === 'solo-mod')).toBe(false);
  });

  it('throws KB-015 for a module id that is not really installed', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    await expect(moduleRemove(ctx, 'not-real')).rejects.toMatchObject({ code: 'KB-015' });
  });

  it('refuses to remove a built-in module not managed by this lifecycle (CFG-045)', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    await expect(moduleRemove(ctx, 'fixture-mod')).rejects.toMatchObject({ code: 'CFG-045' });
  });
});

describe('moduleUpdate', () => {
  it('re-installs a real new version with no grant widening, prompting no consent at all', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    const v1Dir = await tempDir('forge-module-v1-');
    await writeModuleBundle(v1Dir, { id: 'acme-mod', version: '1.0.0' });
    await moduleAdd(ctx, 'acme-mod', v1Dir, installOptions({ consent: { yes: true } }));

    const v2Dir = await tempDir('forge-module-v2-');
    await writeModuleBundle(v2Dir, { id: 'acme-mod', version: '1.1.0' });

    // No `consent` option at all — proves the update path never prompts when nothing new is requested.
    const report = await moduleUpdate(ctx, 'acme-mod', v2Dir, installOptions());

    expect(report).toMatchObject({
      id: 'acme-mod',
      action: 'updated',
      version: '1.1.0',
      previousVersion: '1.0.0',
      newGrants: [],
    });
    const manifest = await readManifestDocument(project.paths);
    expect(manifest.modules.find((module) => module.id === 'acme-mod')?.version).toBe('1.1.0');
  });

  it('re-runs consent only for newly-widened grants, and reports exactly those in the diff', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    const v1Dir = await tempDir('forge-module-v1-');
    await writeModuleBundle(v1Dir, { id: 'acme-mod', version: '1.0.0', ceilings: {} });
    await moduleAdd(ctx, 'acme-mod', v1Dir, installOptions({ consent: { yes: true } }));

    const v2Dir = await tempDir('forge-module-v2-');
    await writeModuleBundle(v2Dir, {
      id: 'acme-mod',
      version: '2.0.0',
      ceilings: { backend: { write: true } },
    });

    const report = await moduleUpdate(
      ctx,
      'acme-mod',
      v2Dir,
      installOptions({ consent: { yes: true } }),
    );

    expect(report.newGrants).toEqual(['Write files (role "backend")']);
    expect(report.version).toBe('2.0.0');
  });

  it('refuses widened-grant consent (CFG-040), leaving the installed version untouched', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    const v1Dir = await tempDir('forge-module-v1-');
    await writeModuleBundle(v1Dir, { id: 'acme-mod', version: '1.0.0', ceilings: {} });
    await moduleAdd(ctx, 'acme-mod', v1Dir, installOptions({ consent: { yes: true } }));

    const v2Dir = await tempDir('forge-module-v2-');
    await writeModuleBundle(v2Dir, {
      id: 'acme-mod',
      version: '2.0.0',
      ceilings: { backend: { write: true } },
    });

    await expect(
      moduleUpdate(ctx, 'acme-mod', v2Dir, installOptions({ consent: { json: true } })),
    ).rejects.toMatchObject({ code: 'CFG-040' });

    const manifest = await readManifestDocument(project.paths);
    expect(manifest.modules.find((module) => module.id === 'acme-mod')?.version).toBe('1.0.0');
  });

  it('throws KB-015 for a module id that is not really installed', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    await expect(
      moduleUpdate(ctx, 'not-real', '/nowhere', installOptions()),
    ).rejects.toMatchObject({ code: 'KB-015' });
  });

  it('refuses to update a built-in module not managed by this lifecycle (CFG-045)', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    await expect(
      moduleUpdate(ctx, 'fixture-mod', '/nowhere', installOptions()),
    ).rejects.toMatchObject({ code: 'CFG-045' });
  });
});

describe('moduleAdd/moduleRemove — cross-namespace and concurrency (critic-round fixes)', () => {
  it('refuses a module id already claimed by an installed overlay (CFG-042)', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);

    const overlayDir = await tempDir('forge-overlay-collide-');
    await mkdir(overlayDir, { recursive: true });
    await writeFile(
      path.join(overlayDir, 'overlay.yaml'),
      YAML.stringify({
        id: 'shared-id',
        name: 'Shared',
        version: '1.0.0',
        forgeVersion: '>=1.0 <2',
      }),
    );
    const { overlayAdd } = await import('../../src/commands/overlay.ts');
    await overlayAdd({ paths: project.paths }, overlayDir, installOptions({ consent: { yes: true } }));

    const moduleDir = await tempDir('forge-module-collide-');
    await writeModuleBundle(moduleDir, { id: 'shared-id' });
    await expect(
      moduleAdd(ctx, 'shared-id', moduleDir, installOptions({ consent: { yes: true } })),
    ).rejects.toMatchObject({ code: 'CFG-042' });
  });

  it('refuses to remove a module an installed overlay still requires (CFG-039)', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);

    const modDir = await tempDir('forge-module-req-by-overlay-');
    await writeModuleBundle(modDir, { id: 'needed-mod' });
    await moduleAdd(ctx, 'needed-mod', modDir, installOptions({ consent: { yes: true } }));

    const overlayDir = await tempDir('forge-overlay-req-');
    await mkdir(overlayDir, { recursive: true });
    await writeFile(
      path.join(overlayDir, 'overlay.yaml'),
      YAML.stringify({
        id: 'dependent-overlay',
        name: 'Dependent',
        version: '1.0.0',
        forgeVersion: '>=1.0 <2',
        requiresModules: ['needed-mod'],
      }),
    );
    const { overlayAdd } = await import('../../src/commands/overlay.ts');
    await overlayAdd({ paths: project.paths }, overlayDir, installOptions({ consent: { yes: true } }));

    await expect(moduleRemove(ctx, 'needed-mod')).rejects.toMatchObject({ code: 'CFG-039' });
    await expect(moduleRemove(ctx, 'needed-mod')).rejects.toThrow(/dependent-overlay/);
  });

  it('serializes two concurrent installs against the same project without corrupting the manifest', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    const aDir = await tempDir('forge-module-concurrent-a-');
    await writeModuleBundle(aDir, { id: 'concurrent-a' });
    const bDir = await tempDir('forge-module-concurrent-b-');
    await writeModuleBundle(bDir, { id: 'concurrent-b' });

    const results = await Promise.allSettled([
      moduleAdd(ctx, 'concurrent-a', aDir, installOptions({ consent: { yes: true } })),
      moduleAdd(ctx, 'concurrent-b', bDir, installOptions({ consent: { yes: true } })),
    ]);

    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof moduleAdd>>> =>
        result.status === 'fulfilled',
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    for (const failure of rejected) {
      expect(failure.reason).toMatchObject({ code: 'CFG-047' });
    }

    const manifest = await readManifestDocument(project.paths);
    for (const success of fulfilled) {
      expect(manifest.modules.some((module) => module.id === success.value.id)).toBe(true);
    }
    // No lost update: the manifest's own module count grew by exactly the number of installs that
    // actually reported success -- the real, load-bearing assertion a stale-write race would fail.
    expect(manifest.modules.filter((module) => module.source !== undefined)).toHaveLength(
      fulfilled.length,
    );
  });

  it('reclaims a stale lock left by a dead process, rather than refusing forever', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    const lockPath = project.paths.resolveState('module-install.lock');
    await mkdir(path.dirname(lockPath), { recursive: true });
    // A pid this test process almost certainly is not and cannot itself hold — simulating a lock left
    // behind by a crashed `forge module add` (a real `SIGKILL` leaves the lock file exactly like this).
    await writeFile(lockPath, '999999');

    const dir = await tempDir('forge-module-stale-lock-');
    await writeModuleBundle(dir, { id: 'after-stale-lock' });
    const report = await moduleAdd(
      ctx,
      'after-stale-lock',
      dir,
      installOptions({ consent: { yes: true } }),
    );
    expect(report.action).toBe('installed');
  });

  it('refuses immediately (CFG-047) when the lock names this process\'s own still-alive pid', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    const lockPath = project.paths.resolveState('module-install.lock');
    await mkdir(path.dirname(lockPath), { recursive: true });
    // The current test process's own pid is, by definition, always alive — simulating a genuinely
    // live holder without needing to spawn a second real process.
    await writeFile(lockPath, String(process.pid));

    const dir = await tempDir('forge-module-live-lock-');
    await writeModuleBundle(dir, { id: 'blocked-by-live-lock' });
    await expect(
      moduleAdd(ctx, 'blocked-by-live-lock', dir, installOptions({ consent: { yes: true } })),
    ).rejects.toMatchObject({ code: 'CFG-047' });

    // The refusal must not have touched the lock file this test itself planted (a real crash-holder's
    // lock is not this operation's to clean up).
    expect(existsSync(lockPath)).toBe(true);
    await rm(lockPath, { force: true });
  });
});

describe('installBundleTree — round-2 critic fixes', () => {
  it('refuses a source that overlaps its own install destination (CFG-049)', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    const dir = await tempDir('forge-module-overlap-');
    await writeModuleBundle(dir, { id: 'ov-mod' });
    await moduleAdd(ctx, 'ov-mod', dir, installOptions({ consent: { yes: true } }));

    const installedPath = path.join(project.dir, '.forge/modules/ov-mod');
    await expect(
      moduleUpdate(ctx, 'ov-mod', installedPath, installOptions({ consent: { yes: true } })),
    ).rejects.toMatchObject({ code: 'CFG-049' });
  });

  it('gives a named, recoverable error when the installed module.yaml has gone missing (CFG-048)', async () => {
    const project = await createTestProject();
    const ctx = ctxFor(project);
    const dir = await tempDir('forge-module-missing-yaml-');
    await writeModuleBundle(dir, { id: 'gone-mod' });
    await moduleAdd(ctx, 'gone-mod', dir, installOptions({ consent: { yes: true } }));

    await rm(path.join(project.dir, '.forge/modules/gone-mod/module.yaml'));

    await expect(
      moduleUpdate(ctx, 'gone-mod', dir, installOptions({ consent: { yes: true } })),
    ).rejects.toMatchObject({ code: 'CFG-048' });

    // The documented recovery path (remove, then add again) actually works.
    await moduleRemove(ctx, 'gone-mod');
    const secondDir = await tempDir('forge-module-missing-yaml-2-');
    await writeModuleBundle(secondDir, { id: 'gone-mod' });
    const report = await moduleAdd(
      ctx,
      'gone-mod',
      secondDir,
      installOptions({ consent: { yes: true } }),
    );
    expect(report.action).toBe('installed');
  });

  it('leaves no partial install and no leaked staging directory when the copy fails partway', async () => {
    // Root bypasses the permission bit this test relies on to force `cp` to fail mid-copy — nothing
    // real to assert there, so this test is a no-op under root rather than a false failure.
    if (typeof process.getuid === 'function' && process.getuid() === 0) return;

    const project = await createTestProject();
    const ctx = ctxFor(project);
    const dir = await tempDir('forge-module-fail-copy-');
    await writeModuleBundle(dir, { id: 'fail-mod' });
    const blockedFile = path.join(dir, 'blocked.txt');
    await writeFile(blockedFile, 'unreadable');
    await chmod(blockedFile, 0o000);

    try {
      await expect(
        moduleAdd(ctx, 'fail-mod', dir, installOptions({ consent: { yes: true } })),
      ).rejects.toBeDefined();
    } finally {
      await chmod(blockedFile, 0o644);
    }

    expect(existsSync(path.join(project.dir, '.forge/modules/fail-mod'))).toBe(false);
    const manifest = await readManifestDocument(project.paths);
    expect(manifest.modules.some((module) => module.id === 'fail-mod')).toBe(false);

    const modulesDir = path.join(project.dir, '.forge/modules');
    const leftoverStaging = existsSync(modulesDir)
      ? (await readdir(modulesDir)).filter((name) => name.startsWith('.install-staging-'))
      : [];
    expect(leftoverStaging).toEqual([]);
  });
});
